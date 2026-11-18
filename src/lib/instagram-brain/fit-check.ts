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
      const video = await prepareFitVideo(input.videoUrl || "", deps, cfg.fitVideoMaxMb * 1024 * 1024);
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
