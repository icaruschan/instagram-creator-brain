import dotenv from "dotenv";
import { INSTAGRAM_BRAIN_CONFIG } from "./config";
import { estimateCost, type CostLedger } from "./cost";
import { ANALYSIS_PROMPT, downloadVideoBytes, parseAnalysisJson, type GeminiReelAnalysis } from "./gemini";
import { HttpStatusError, retryTransient, withTimeout } from "./retry";

dotenv.config({ override: true });

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface VideoAnalysisInput {
  shortcode: string;
  videoUrl: string;
  caption?: string;
  transcript?: string;
}

/** Same prompt + caption/transcript context as the Gemini path, so the JSON stays identical. */
export function buildAnalysisContext(input: Pick<VideoAnalysisInput, "caption" | "transcript">): string {
  return [
    ANALYSIS_PROMPT,
    input.caption ? `SOURCE CAPTION:\n${input.caption}` : "",
    input.transcript ? `SOURCE TRANSCRIPT:\n${input.transcript}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Detect the container from magic bytes; OpenRouter accepts video/mp4, video/mpeg, video/mov, video/webm. */
export function sniffVideoMime(bytes: Uint8Array): string {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length > 12 && ascii(4, 8) === "ftyp") return ascii(8, 10) === "qt" ? "video/mov" : "video/mp4";
  if (bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  if (bytes.length > 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && (bytes[3] === 0xba || bytes[3] === 0xb3)) return "video/mpeg";
  return "video/mp4";
}

export function toDataUrl(bytes: Uint8Array, mime = sniffVideoMime(bytes)): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Chat Completions body for one Reel, per OpenRouter's video-input docs (`video_url` content part). */
export function buildOpenRouterVideoRequest(
  model: string,
  videoUrlOrDataUrl: string,
  context: string,
  reasoningMaxTokens = INSTAGRAM_BRAIN_CONFIG.videoAnalysisReasoningMaxTokens,
) {
  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "video_url", video_url: { url: videoUrlOrDataUrl } },
          { type: "text", text: context },
        ],
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 8_000,
    // Bound the thinking: unbounded it is slow (risking the timeout) and output-token heavy.
    reasoning: reasoningMaxTokens > 0 ? { max_tokens: reasoningMaxTokens, exclude: true } : { enabled: false },
    // OpenRouter returns usage.cost (USD) with this; it is what the cost log records.
    usage: { include: true },
  };
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Qwen Omni (or any OpenRouter video model) analysis of one Reel. Returns the same JSON as Gemini. */
export async function analyzeReelVideoOpenRouter(
  input: VideoAnalysisInput,
  ledger?: CostLedger,
): Promise<GeminiReelAnalysis> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for OpenRouter video analysis");
  if (!input.videoUrl) throw new Error("A direct Reel video URL is required for video analysis");
  const model = INSTAGRAM_BRAIN_CONFIG.openrouterVideoModel;
  const estimate = estimateCost("openrouter-video-analysis");
  const label = `openrouter video analysis ${input.shortcode} (${model})`;
  ledger?.ensure(estimate, label);

  let videoRef = input.videoUrl;
  if (INSTAGRAM_BRAIN_CONFIG.openrouterVideoSendMode === "data-url") {
    const bytes = await downloadVideoBytes(input.videoUrl);
    const maxBytes = INSTAGRAM_BRAIN_CONFIG.maxInlineVideoMb * 1024 * 1024;
    if (bytes.byteLength > maxBytes) {
      throw new Error(`Reel video is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB, above the ${INSTAGRAM_BRAIN_CONFIG.maxInlineVideoMb}MB inline limit (VIDEO_ANALYSIS_MAX_INLINE_MB)`);
    }
    videoRef = toDataUrl(bytes);
  }
  const body = JSON.stringify(buildOpenRouterVideoRequest(model, videoRef, buildAnalysisContext(input)));

  const data: any = await retryTransient(async (attempt) => {
    ledger?.ensure(estimate, `${label} attempt ${attempt}`);
    let reportedCost: number | null = null;
    let billedUnknown = true;
    try {
      const result = await withTimeout(label, INSTAGRAM_BRAIN_CONFIG.videoAnalysisTimeoutMs, async (signal) => {
        const response = await fetch(OPENROUTER_CHAT_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Instagram Creator Brain",
          },
          body,
          signal,
        });
        const text = await response.text();
        if (!response.ok) {
          // OpenRouter does not bill requests it rejects with an HTTP error.
          billedUnknown = false;
          reportedCost = 0;
          throw new HttpStatusError(`OpenRouter video analysis failed (${response.status}): ${text.slice(0, 500)}`, response.status, retryAfterSeconds(response));
        }
        const parsed = JSON.parse(text);
        const cost = Number(parsed?.usage?.cost);
        if (Number.isFinite(cost)) { reportedCost = cost; billedUnknown = false; }
        // Upstream errors can arrive inside a 200 body.
        if (parsed?.error) {
          const code = Number(parsed.error.code) || 502;
          throw new HttpStatusError(`OpenRouter video analysis error (${code}): ${String(parsed.error.message || "").slice(0, 500)}`, code);
        }
        return parsed;
      });
      return result;
    } finally {
      ledger?.record("openrouter-video-analysis", `${label} attempt ${attempt}`, estimate, billedUnknown ? null : reportedCost);
    }
  }, { label, maxAttempts: INSTAGRAM_BRAIN_CONFIG.videoAnalysisMaxAttempts });

  const content = data?.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content) ? content.map((part: any) => part?.text || "").join("") : "";
  if (!text) throw new Error(`OpenRouter video analysis returned no text (finish_reason: ${data?.choices?.[0]?.finish_reason || "unknown"})`);
  const usage = data?.usage || {};
  console.log(`[video-analysis] ${JSON.stringify({ provider: "openrouter", model: data?.model || model, upstream: data?.provider, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, reasoningTokens: usage.completion_tokens_details?.reasoning_tokens, costUsd: usage.cost })}`);
  return parseAnalysisJson(text, "OpenRouter");
}

