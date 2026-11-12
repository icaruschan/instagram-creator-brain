import { GoogleGenAI } from "@google/genai";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { INSTAGRAM_BRAIN_CONFIG } from "./config";
import { estimateCost, type CostLedger } from "./cost";
import { InvalidModelOutputError, retryOnInvalidOutput, retryTransient, statusOf } from "./retry";

dotenv.config({ override: true });

export interface GeminiScene {
  start: string;
  end: string;
  description: string;
  function: string;
}

export interface GeminiReelAnalysis {
  summary: string;
  visualPremise: string;
  firstThreeSecondHook: string;
  onScreenText: string[];
  spokenHook: string;
  audioPattern: string;
  pacingAndEditing: string;
  visualPayoff: string;
  productionMechanics: string[];
  contentClassification: string[];
  valueDriver: "Visual spectacle" | "Repeatable workflow" | "Both";
  scenes: GeminiScene[];
  confidenceNotes: string[];
}

/** Shared by every video-analysis provider so downstream code sees the same JSON. */
export const ANALYSIS_PROMPT = `Analyze this Instagram Reel as grounded evidence for an AI Creative research system.

Return JSON only. Do not infer tools, prompts, or production methods unless they are visible, spoken, or explicitly shown. If a detail is uncertain, put it in confidenceNotes rather than presenting it as fact.

Identify:
- scene-by-scene factual events with timestamps
- the first 3-second visual hook
- visible on-screen text
- spoken hook when discernible
- audio/music/SFX pattern when discernible
- pacing and editing pattern
- visual payoff
- visible production mechanics
- whether the source is Creative AI Video, AI Creative Workflow, AI Tools & Model Experiments, Creator AI Systems & Automation, AI & Creative Commentary, or multiple
- whether its main value is visual spectacle, a repeatable workflow, or both

JSON schema:
{
  "summary": "...",
  "visualPremise": "...",
  "firstThreeSecondHook": "...",
  "onScreenText": ["..."],
  "spokenHook": "...",
  "audioPattern": "...",
  "pacingAndEditing": "...",
  "visualPayoff": "...",
  "productionMechanics": ["..."],
  "contentClassification": ["..."],
  "valueDriver": "Visual spectacle | Repeatable workflow | Both",
  "scenes": [{"start":"00:00","end":"00:03","description":"...","function":"..."}],
  "confidenceNotes": ["..."]
}`;

export function parseAnalysisJson(text: string, provider = "Gemini"): GeminiReelAnalysis {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new InvalidModelOutputError(`${provider} visual analysis did not return JSON`);
  try {
    return JSON.parse(match[0]) as GeminiReelAnalysis;
  } catch (error) {
    throw new InvalidModelOutputError(`${provider} visual analysis returned invalid JSON: ${(error as Error).message}`);
  }
}

/** Download the Reel video from the Instagram CDN (60s timeout, 100MB cap). */
export async function downloadVideoBytes(videoUrl: string): Promise<Uint8Array> {
  const response = await fetch(videoUrl, {
    headers: { "User-Agent": "Mozilla/5.0 InstagramCreatorBrain/1.0" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Video download failed (${response.status})`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 100 * 1024 * 1024) throw new Error("Reel video exceeds 100MB safety limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 100 * 1024 * 1024) throw new Error("Reel video exceeds 100MB safety limit");
  if (bytes.byteLength < 1_000) throw new Error("Downloaded Reel video is unexpectedly small");
  return bytes;
}

async function downloadVideo(videoUrl: string, shortcode: string): Promise<string> {
  const bytes = await downloadVideoBytes(videoUrl);
  const filePath = path.join(os.tmpdir(), `ig-brain-${shortcode}-${Date.now()}.mp4`);
  await writeFile(filePath, bytes);
  return filePath;
}

/** Native Gemini API path (kept as an option: VIDEO_ANALYSIS_PROVIDER=gemini or VIDEO_ANALYSIS_FALLBACK=gemini). */
export async function analyzeReelVideoGemini(input: {
  shortcode: string;
  videoUrl: string;
  caption?: string;
  transcript?: string;
}, ledger?: CostLedger): Promise<GeminiReelAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for visual Reel analysis");
  if (!input.videoUrl) throw new Error("A direct Reel video URL is required for Gemini analysis");
  const estimate = estimateCost("gemini-analysis");
  const label = `gemini analysis ${input.shortcode}`;
  ledger?.ensure(estimate, label);

  const ai = new GoogleGenAI({ apiKey });
  const localPath = await downloadVideo(input.videoUrl, input.shortcode);
  let remoteName: string | undefined;
  try {
    let uploaded: any = await ai.files.upload({
      file: localPath,
      config: { mimeType: "video/mp4", displayName: input.shortcode },
    });
    remoteName = uploaded.name;
    const started = Date.now();
    while (uploaded.state === "PROCESSING") {
      if (Date.now() - started > 180_000) throw new Error("Gemini file processing timed out");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      uploaded = await ai.files.get({ name: uploaded.name });
    }
    if (uploaded.state === "FAILED") throw new Error("Gemini file processing failed");
    if (!uploaded.uri) throw new Error("Gemini upload returned no file URI");

    const context = [
      ANALYSIS_PROMPT,
      input.caption ? `SOURCE CAPTION:\n${input.caption}` : "",
      input.transcript ? `SOURCE TRANSCRIPT:\n${input.transcript}` : "",
    ].filter(Boolean).join("\n\n");

    // No request timeout (Fortune, 2026-11-12): the task's maxDuration is the only backstop.
    const callOnce = () => retryTransient(async (attempt) => {
      ledger?.ensure(estimate, `${label} (attempt ${attempt})`);
      try {
        const result = await ai.interactions.create({
          model: INSTAGRAM_BRAIN_CONFIG.geminiModel,
          input: [
            { type: "video", uri: uploaded.uri, mime_type: uploaded.mimeType || "video/mp4", processing: "static" },
            { type: "text", text: context },
          ],
        } as any);
        // Gemini does not return a dollar cost; log the estimate for every completed analysis.
        ledger?.record("gemini-analysis", label, estimate, null);
        return result;
      } catch (error) {
        // 429/503 are rejected before inference (not billed); anything else may have been billed.
        const status = statusOf(error);
        ledger?.record("gemini-analysis", `${label} (failed${status ? ` ${status}` : ""})`, estimate, status === 429 || status === 503 ? 0 : null);
        throw error;
      }
    }, { label, maxAttempts: INSTAGRAM_BRAIN_CONFIG.videoAnalysisMaxAttempts });
    return await retryOnInvalidOutput(label, async () => {
      const interaction: any = await callOnce();
      const output = interaction.outputText || interaction.output_text || "";
      if (!output.trim()) throw new InvalidModelOutputError("Gemini visual analysis returned empty output");
      return parseAnalysisJson(output, "Gemini");
    });
  } finally {
    await unlink(localPath).catch(() => undefined);
    if (remoteName) await ai.files.delete({ name: remoteName }).catch(() => undefined);
  }
}
