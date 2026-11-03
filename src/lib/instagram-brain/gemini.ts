import { GoogleGenAI } from "@google/genai";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { INSTAGRAM_BRAIN_CONFIG } from "./config";

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

const ANALYSIS_PROMPT = `Analyze this Instagram Reel as grounded evidence for an AI Creative research system.

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

function parseJson(text: string): GeminiReelAnalysis {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Gemini visual analysis did not return JSON");
  return JSON.parse(match[0]) as GeminiReelAnalysis;
}

async function downloadVideo(videoUrl: string, shortcode: string): Promise<string> {
  const response = await fetch(videoUrl, {
    headers: { "User-Agent": "Mozilla/5.0 InstagramCreatorBrain/1.0" },
  });
  if (!response.ok) throw new Error(`Video download failed (${response.status})`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 100 * 1024 * 1024) throw new Error("Reel video exceeds 100MB safety limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 100 * 1024 * 1024) throw new Error("Reel video exceeds 100MB safety limit");
  if (bytes.byteLength < 1_000) throw new Error("Downloaded Reel video is unexpectedly small");
  const filePath = path.join(os.tmpdir(), `ig-brain-${shortcode}-${Date.now()}.mp4`);
  await writeFile(filePath, bytes);
  return filePath;
}

export async function analyzeReelVideo(input: {
  shortcode: string;
  videoUrl: string;
  caption?: string;
  transcript?: string;
}): Promise<GeminiReelAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for visual Reel analysis");
  if (!input.videoUrl) throw new Error("A direct Reel video URL is required for Gemini analysis");

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

    const interaction: any = await ai.interactions.create({
      model: INSTAGRAM_BRAIN_CONFIG.geminiModel,
      input: [
        { type: "video", uri: uploaded.uri, mime_type: uploaded.mimeType || "video/mp4", processing: "static" },
        { type: "text", text: context },
      ],
    } as any);
    const output = interaction.outputText || interaction.output_text || "";
    return parseJson(output);
  } finally {
    await unlink(localPath).catch(() => undefined);
    if (remoteName) await ai.files.delete({ name: remoteName }).catch(() => undefined);
  }
}
