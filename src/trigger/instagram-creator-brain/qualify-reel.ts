import { task } from "@trigger.dev/sdk/v3";
import { getInstagramCreator, getReel, updateReelStrategicFit } from "../../lib/instagram-brain/notion";
import { buildFitState, runFitCheck } from "../../lib/instagram-brain/fit-check";
import { actionLedger, publishCostSummary, type CostLedger } from "../../lib/instagram-brain/cost";

export interface QualifyReelPayload { reelPageId: string }

/**
 * Fit check (one decision call): strategic fit for Yuna, plus her Pillar and the Content Type.
 * Since 2026-11-18 (Fortune approved): Gemini Decision 1 watching the Reel video, Jev text as fallback.
 * Notion has no field for the deciding model; it is logged as a [fit] line, in the cost ledger label, and in the return value.
 */
export async function runQualifyInstagramReel({ reelPageId }: QualifyReelPayload, ledger?: CostLedger) {
    const reel = await getReel(reelPageId);
    const creator = await getInstagramCreator(reel.creatorPageId);
    const state = buildFitState({
      creatorHandle: creator.handle,
      creatorPillars: creator.pillars,
      caption: reel.caption,
      transcript: reel.transcript,
    });
    const result = await runFitCheck({ shortcode: reel.shortcode, videoUrl: reel.videoUrl, state }, ledger);
    const label = result.fit;
    console.log(`[fit] ${JSON.stringify({ shortcode: reel.shortcode, fit: label, score: result.score, ...result.decidedBy })}`);
    await updateReelStrategicFit({
      pageId: reelPageId,
      fit: label,
      score: result.score,
      confidence: result.confidence,
      pillar: label === "Irrelevant" ? null : result.pillar,
      contentType: label === "Irrelevant" ? null : result.contentType,
    });
    return { reelPageId, fit: label, score: result.score, pillar: result.pillar, contentType: result.contentType, decidedBy: result.decidedBy };
}

export const qualifyInstagramReel = task({
  id: "instagram-brain-qualify-reel",
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: async (payload: QualifyReelPayload) => {
    const ledger = actionLedger("qualify-reel");
    const result = await runQualifyInstagramReel(payload, ledger);
    await publishCostSummary(ledger);
    return { ...result, cost: ledger.summary() };
  },
});
