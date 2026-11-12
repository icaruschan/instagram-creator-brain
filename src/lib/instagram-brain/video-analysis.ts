import { INSTAGRAM_BRAIN_CONFIG, type VideoProvider } from "./config";
import { isBudgetExceeded, type CostLedger } from "./cost";
import { analyzeReelVideoGemini, type GeminiReelAnalysis } from "./gemini";
import { analyzeReelVideoOpenRouter, type VideoAnalysisInput } from "./openrouter-video";

export interface VideoAnalysisResult {
  analysis: GeminiReelAnalysis;
  provider: VideoProvider;
  model: string;
}

function modelFor(provider: VideoProvider): string {
  return provider === "openrouter" ? INSTAGRAM_BRAIN_CONFIG.openrouterVideoModel : INSTAGRAM_BRAIN_CONFIG.geminiModel;
}

function run(provider: VideoProvider, input: VideoAnalysisInput, ledger?: CostLedger): Promise<GeminiReelAnalysis> {
  return provider === "openrouter" ? analyzeReelVideoOpenRouter(input, ledger) : analyzeReelVideoGemini(input, ledger);
}

/**
 * Analyse one Reel video with the configured provider (VIDEO_ANALYSIS_PROVIDER, default "openrouter"
 * = Qwen Omni). If VIDEO_ANALYSIS_FALLBACK names the other provider, it gets one go when the first
 * fails for good (never after a spending-cap stop). Output JSON is the same for both providers.
 */
export async function analyzeReelVideo(input: VideoAnalysisInput, ledger?: CostLedger): Promise<VideoAnalysisResult> {
  const primary = INSTAGRAM_BRAIN_CONFIG.videoAnalysisProvider;
  const fallback = INSTAGRAM_BRAIN_CONFIG.videoAnalysisFallback;
  try {
    return { analysis: await run(primary, input, ledger), provider: primary, model: modelFor(primary) };
  } catch (error) {
    if (fallback === "none" || fallback === primary || isBudgetExceeded(error)) throw error;
    console.warn(`Video analysis via ${primary} failed (${(error as Error).message}); trying fallback ${fallback}`);
    try {
      return { analysis: await run(fallback, input, ledger), provider: fallback, model: modelFor(fallback) };
    } catch (fallbackError) {
      throw new Error(`Video analysis failed on ${primary} (${(error as Error).message}) and fallback ${fallback} (${(fallbackError as Error).message})`);
    }
  }
}
