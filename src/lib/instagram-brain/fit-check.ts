import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { INSTAGRAM_BRAIN_CONFIG, PILLAR_DEFINITIONS, type ContentType, type YunaPillar } from "./config";
import { isBudgetExceeded, type CostLedger } from "./cost";
import { downloadVideoBytes } from "./gemini";
import {
  STRATEGIC_FIT_CRITERIA,
  buildPillarQuestions,
  buildSourceValueQuestions,
  readPillarAnswers,
  runJevDecision,
  type JevCallOptions,
  type JevDecisionResponse,
  type JevQuestion,
} from "./jev";
import { sniffVideoMime, toDataUrl } from "./openrouter-video";

const execFileAsync = promisify(execFile);

/** Score mapping is unchanged from the Jev-only fit check (Fortune, Nov 12). */
export const FIT_VALUES: Record<string, number> = { core: 100, supporting: 65, adjacent: 30, irrelevant: 0 };

export type FitLabel = "Core" | "Supporting" | "Adjacent" | "Irrelevant";

export function expectedFit(probabilities: Record<string, number>): number {
  return Math.round(Object.entries(probabilities).reduce(
    (sum, [key, probability]) => sum + (FIT_VALUES[key] || 0) * probability,
    0,
  ) * 10) / 10;
}

/** The same questions the Jev fit check has always asked (strategic fit + Pillar + Content Type). */
export function buildFitQuestions(): Record<string, JevQuestion> {
  return {
    strategic_fit: {
      type: "choice",
      instructions: "How directly does this source Reel fit Yuna's AI Creative pillars as inspiration for an original Instagram Reel?",
      criteria: STRATEGIC_FIT_CRITERIA,
    },
    ...buildPillarQuestions(),
  };
}

export function buildFitState(input: { creatorHandle: string; creatorPillars: unknown; caption?: string; transcript?: string }) {
  return {
    account: "Yuna (AI Creative niche)",
    creator: `@${input.creatorHandle}`,
    creatorPillars: input.creatorPillars,
    caption: input.caption,
    transcript: input.transcript,
    yunaPillars: Object.values(PILLAR_DEFINITIONS),
  };
}

export interface ParsedFit {
  fit: FitLabel;
  score: number;
  confidence: number;
  pillar: YunaPillar | null;
  contentType: ContentType | null;
}

/** Read a decisions response. Throws when strategic_fit is missing or not one of the four labels. */
export function parseFitResponse(response: Pick<JevDecisionResponse, "answers">): ParsedFit {
  const answer = response?.answers?.strategic_fit;
  const choice = String(answer?.choice || "").toLowerCase();
  if (!(choice in FIT_VALUES)) throw new Error(`Fit decision returned no valid strategic_fit choice (${JSON.stringify(answer?.choice ?? null)})`);
  const probabilities = answer.probabilities && typeof answer.probabilities === "object" && Object.keys(answer.probabilities).length
    ? answer.probabilities as Record<string, number>
    : { [choice]: 1 };
  const fit = (choice.charAt(0).toUpperCase() + choice.slice(1)) as FitLabel;
  const { pillar, contentType } = readPillarAnswers(response.answers);
  return { fit, score: expectedFit(probabilities), confidence: Number(answer.confidence || 0), pillar, contentType };
}

export interface PreparedVideo {
  dataUrl: string;
  bytes: number;
  originalBytes: number;
  /** "480p" when shrunk with ffmpeg, "original" when ffmpeg was unavailable/failed and the file was small enough. */
  form: "shrunk" | "original";
}

/** Shrink to <= fitVideoHeight with ffmpeg (FFMPEG_PATH set by Trigger's ffmpeg build extension). */
export async function shrinkVideo(bytes: Uint8Array, height = INSTAGRAM_BRAIN_CONFIG.fitVideoHeight): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ig-fit-"));
  try {
    const input = path.join(dir, "in.mp4");
    const output = path.join(dir, "out.mp4");
    await writeFile(input, bytes);
    await execFileAsync(process.env.FFMPEG_PATH || "ffmpeg", [
      "-y", "-v", "error", "-i", input,
      "-vf", `scale=-2:'min(${height},ih)'`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
      "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart",
      output,
    ], { timeout: 90_000 });
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface FitVideoDeps {
  download?: (url: string) => Promise<Uint8Array>;
  shrink?: (bytes: Uint8Array) => Promise<Uint8Array>;
  /**
   * Auto re-fetch hook (2026-11-20): called once when the video can't be prepared. Return a fresh Video URL to
   * try again, or null to fall back to Jev text as before. See lib/instagram-brain/video-refresh.ts.
   */
  refreshVideoUrl?: (error: unknown) => Promise<string | null>;
}

/** prepareFitVideo, with one retry on a fresh link when the refresh hook provides one. */
export async function prepareFitVideoWithRefresh(videoUrl: string, deps: FitVideoDeps, maxBytes: number): Promise<PreparedVideo> {
  try {
    return await prepareFitVideo(videoUrl, deps, maxBytes);
  } catch (error) {
    const fresh = deps.refreshVideoUrl ? await deps.refreshVideoUrl(error) : null;
    if (!fresh) throw error;
    return prepareFitVideo(fresh, deps, maxBytes);
  }
}

/** Download + shrink the Reel video for the fit model. Throws (-> Jev text fallback) when it can't. */
export async function prepareFitVideo(
  videoUrl: string,
  deps: FitVideoDeps = {},
  maxBytes = INSTAGRAM_BRAIN_CONFIG.fitVideoMaxMb * 1024 * 1024,
): Promise<PreparedVideo> {
  if (!videoUrl) throw new Error("no Video URL on the Reel");
  const original = await (deps.download || downloadVideoBytes)(videoUrl);
  let bytes: Uint8Array;
  let form: PreparedVideo["form"] = "shrunk";
  try {
    bytes = await (deps.shrink || shrinkVideo)(original);
    if (bytes.byteLength < 1_000) throw new Error("shrunk video is unexpectedly small");
  } catch (error) {
    if (original.byteLength > maxBytes) throw new Error(`could not shrink video (${(error as Error).message}) and original is ${(original.byteLength / 1048576).toFixed(1)}MB`);
    console.warn(`[fit] ffmpeg shrink failed (${(error as Error).message}); sending original ${(original.byteLength / 1048576).toFixed(1)}MB video`);
    bytes = original;
    form = "original";
  }
  if (bytes.byteLength > maxBytes) throw new Error(`video too large for fit check (${(bytes.byteLength / 1048576).toFixed(1)}MB > ${(maxBytes / 1048576).toFixed(0)}MB)`);
  return { dataUrl: toDataUrl(bytes, sniffVideoMime(bytes)), bytes: bytes.byteLength, originalBytes: original.byteLength, form };
}

export interface FitDecidedBy {
  model: string;
  mode: "video" | "text";
  /** Set when the primary fit model was not used (or failed) and Jev text decided. */
  fallbackReason?: string;
  videoBytes?: number;
}

export interface FitCheckResult extends ParsedFit {
  decidedBy: FitDecidedBy;
}

export interface FitCheckInput {
  shortcode: string;
  videoUrl?: string;
  state: Record<string, unknown>;
}

export interface FitCheckDeps extends FitVideoDeps {
  decide?: (state: any, questions: Record<string, JevQuestion>, options: JevCallOptions) => Promise<JevDecisionResponse>;
  config?: Partial<Pick<typeof INSTAGRAM_BRAIN_CONFIG, "fitModel" | "fitUseVideo" | "fitTimeoutMs" | "jevModel" | "fitVideoMaxMb">>;
}

const isJevModel = (model: string) => /(^|\/)jev-/i.test(model);

/**
 * Fit check for one Reel: the fit model (default Gemini Decision 1) watching the shrunk video, with
 * Jev text as fallback when the video can't be prepared or the call errors / times out / returns junk.
 * Budget errors are never swallowed.
 */
export async function runFitCheck(input: FitCheckInput, ledger?: CostLedger, deps: FitCheckDeps = {}): Promise<FitCheckResult> {
  const cfg = { ...INSTAGRAM_BRAIN_CONFIG, ...(deps.config || {}) };
  const decide = deps.decide || runJevDecision;
  const questions = buildFitQuestions();
  const jevText = async (fallbackReason?: string): Promise<FitCheckResult> => {
    const response = await decide(input.state, questions, { model: cfg.jevModel, ledger, label: `jev fit check ${input.shortcode}${fallbackReason ? " (fallback)" : ""}` });
    return { ...parseFitResponse(response), decidedBy: { model: response.model || cfg.jevModel, mode: "text", ...(fallbackReason ? { fallbackReason } : {}) } };
  };

  // Fit model is itself a Jev model: plain Jev text, as before.
  if (isJevModel(cfg.fitModel) && cfg.fitModel === cfg.jevModel) return jevText();

  let state: unknown = input.state;
  let videoBytes: number | undefined;
  if (cfg.fitUseVideo) {
    try {
      const video = await prepareFitVideoWithRefresh(input.videoUrl || "", deps, cfg.fitVideoMaxMb * 1024 * 1024);
      state = [input.state, { type: "video_url", video_url: { url: video.dataUrl } }];
      videoBytes = video.bytes;
    } catch (error) {
      return jevText(`video unavailable: ${(error as Error).message}`.slice(0, 300));
    }
  }
  try {
    const response = await decide(state, questions, {
      model: cfg.fitModel,
      ledger,
      label: `fit check ${cfg.fitModel}${videoBytes ? " +video" : ""} ${input.shortcode}`,
      costKind: isJevModel(cfg.fitModel) ? "jev" : "fit-decision",
      timeoutMs: cfg.fitTimeoutMs,
    });
    return { ...parseFitResponse(response), decidedBy: { model: response.model || cfg.fitModel, mode: videoBytes ? "video" : "text", ...(videoBytes ? { videoBytes } : {}) } };
  } catch (error) {
    if (isBudgetExceeded(error)) throw error;
    return jevText(`${cfg.fitModel} failed: ${(error as Error).message}`.slice(0, 300));
  }
}

// ---------------------------------------------------------------------------------------------------------
// Post-analysis source-value decision (analyze-reel.ts). Fortune approved 2026-11-18 ("Yes, switch the score
// check to Gemini + video"): the same buildSourceValueQuestions() (strategic fit, visual pattern value,
// workflow value, best execution mode) go to the analysis fit model (default Gemini Decision 1) with the Reel
// video at 480p, Jev text as automatic fallback. Score mapping and calculatePriorityScore are unchanged.
// Rollback without redeploy: IG_BRAIN_ANALYSIS_FIT_MODEL=typesafe/jev-1.13 (plain Jev text, as before).
// ---------------------------------------------------------------------------------------------------------

export type RecommendedMode = "Visual Storyteller" | "AI Creative Operator" | "Both" | "Neither";

const MODE_MAP: Record<string, RecommendedMode> = {
  visual_storyteller: "Visual Storyteller",
  creative_operator: "AI Creative Operator",
  both: "Both",
  neither: "Neither",
};

export interface ParsedSourceValue {
  fit: FitLabel;
  fitScore: number;
  confidence: number;
  visualValue: number;
  workflowValue: number;
  recommendedMode: RecommendedMode;
}

export interface SourceValueResult extends ParsedSourceValue {
  decidedBy: FitDecidedBy;
}

const unitValue = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
};

/**
 * Read a source-value decisions response. strict=true (the primary model) throws on a missing/invalid fit label
 * or missing visual/workflow values so the caller falls back to Jev; strict=false (Jev) keeps the old lenient
 * defaults (irrelevant / 0 / Neither) exactly as analyze-reel.ts always did.
 */
export function parseSourceValueResponse(
  response: Pick<JevDecisionResponse, "answers">,
  recordId: string,
  strict = true,
): ParsedSourceValue {
  const answers = response?.answers || {};
  const fitAnswer = answers[`${recordId}__strategic_fit`] || {};
  const visualAnswer = answers[`${recordId}__visual_pattern_value`] || {};
  const workflowAnswer = answers[`${recordId}__workflow_value`] || {};
  const modeAnswer = answers[`${recordId}__best_execution_mode`] || {};
  let choice = String(fitAnswer.choice || "").toLowerCase();
  if (!(choice in FIT_VALUES)) {
    if (strict) throw new Error(`Source-value decision returned no valid strategic_fit choice (${JSON.stringify(fitAnswer.choice ?? null)})`);
    choice = "irrelevant";
  }
  let visualValue = unitValue(visualAnswer.noul);
  let workflowValue = unitValue(workflowAnswer.noul);
  if (strict && (visualValue == null || workflowValue == null)) {
    throw new Error(`Source-value decision returned no valid visual/workflow values (${JSON.stringify([visualAnswer.noul ?? null, workflowAnswer.noul ?? null])})`);
  }
  visualValue ??= Number(visualAnswer.noul || 0) || 0;
  workflowValue ??= Number(workflowAnswer.noul || 0) || 0;
  const probabilities = fitAnswer.probabilities && typeof fitAnswer.probabilities === "object" && Object.keys(fitAnswer.probabilities).length
    ? fitAnswer.probabilities as Record<string, number>
    : { [choice]: 1 };
  return {
    fit: (choice.charAt(0).toUpperCase() + choice.slice(1)) as FitLabel,
    fitScore: expectedFit(probabilities),
    confidence: Number(fitAnswer.confidence || 0),
    visualValue,
    workflowValue,
    recommendedMode: MODE_MAP[String(modeAnswer.choice || "").toLowerCase()] || "Neither",
  };
}

export interface SourceValueInput {
  shortcode: string;
  recordId: string;
  videoUrl?: string;
  state: Record<string, unknown>;
}

export interface SourceValueDeps extends FitVideoDeps {
  decide?: FitCheckDeps["decide"];
  config?: Partial<Pick<typeof INSTAGRAM_BRAIN_CONFIG, "analysisFitModel" | "analysisFitUseVideo" | "fitTimeoutMs" | "jevModel" | "fitVideoMaxMb">>;
}

export async function runSourceValueDecision(input: SourceValueInput, ledger?: CostLedger, deps: SourceValueDeps = {}): Promise<SourceValueResult> {
  const cfg = { ...INSTAGRAM_BRAIN_CONFIG, ...(deps.config || {}) };
  const decide = deps.decide || runJevDecision;
  const questions = buildSourceValueQuestions(input.recordId);
  const jevText = async (fallbackReason?: string): Promise<SourceValueResult> => {
    const response = await decide(input.state, questions, { model: cfg.jevModel, ledger, label: `jev source value ${input.shortcode}${fallbackReason ? " (fallback)" : ""}` });
    return { ...parseSourceValueResponse(response, input.recordId, false), decidedBy: { model: response.model || cfg.jevModel, mode: "text", ...(fallbackReason ? { fallbackReason } : {}) } };
  };

  // Analysis fit model is a Jev model (rollback): plain Jev text, exactly as before.
  if (isJevModel(cfg.analysisFitModel)) {
    const response = await decide(input.state, questions, { model: cfg.analysisFitModel, ledger, label: `jev source value ${input.shortcode}` });
    return { ...parseSourceValueResponse(response, input.recordId, false), decidedBy: { model: response.model || cfg.analysisFitModel, mode: "text" } };
  }

  let state: unknown = input.state;
  let videoBytes: number | undefined;
  if (cfg.analysisFitUseVideo) {
    try {
      const video = await prepareFitVideoWithRefresh(input.videoUrl || "", deps, cfg.fitVideoMaxMb * 1024 * 1024);
      state = [input.state, { type: "video_url", video_url: { url: video.dataUrl } }];
      videoBytes = video.bytes;
    } catch (error) {
      return jevText(`video unavailable: ${(error as Error).message}`.slice(0, 300));
    }
  }
  try {
    const response = await decide(state, questions, {
      model: cfg.analysisFitModel,
      ledger,
      label: `source value ${cfg.analysisFitModel}${videoBytes ? " +video" : ""} ${input.shortcode}`,
      costKind: "fit-decision",
      timeoutMs: cfg.fitTimeoutMs,
    });
    return { ...parseSourceValueResponse(response, input.recordId, true), decidedBy: { model: response.model || cfg.analysisFitModel, mode: videoBytes ? "video" : "text", ...(videoBytes ? { videoBytes } : {}) } };
  } catch (error) {
    if (isBudgetExceeded(error)) throw error;
    return jevText(`${cfg.analysisFitModel} failed: ${(error as Error).message}`.slice(0, 300));
  }
}
