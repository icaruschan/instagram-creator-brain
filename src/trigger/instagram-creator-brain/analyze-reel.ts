import { task } from "@trigger.dev/sdk/v3";
import { analyzeReelVideo } from "../../lib/instagram-brain/video-analysis";
import { runSourceValueDecision } from "../../lib/instagram-brain/fit-check";
import { calculatePriorityScore } from "../../lib/instagram-brain/scoring";
import { clearReelFailedState, getInstagramCreator, getReel, setReelActionState, updateReelIntelligence } from "../../lib/instagram-brain/notion";
import { actionLedger, publishCostSummary, rethrowNonRetryable } from "../../lib/instagram-brain/cost";
import { createReelVideoRefresher } from "../../lib/instagram-brain/video-refresh";

export interface AnalyzeReelPayload { reelPageId: string }

export const analyzeInstagramReel = task({
  id: "instagram-brain-analyze-reel",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  /** Runs once, after the last attempt fails: put the reason on the Reel so it isn't a silent failure. */
  onFailure: async ({ payload, error }) => {
    const message = `Video analysis failed: ${(error as Error)?.message || String(error)}`.slice(0, 1_900);
    await setReelActionState(payload.reelPageId, "Failed", message).catch((notionError) => {
      console.error(`Could not write Last Error to ${payload.reelPageId}: ${(notionError as Error).message}`);
    });
  },
  run: async ({ reelPageId }: AnalyzeReelPayload) => {
    const ledger = actionLedger("analyze-reel");
    const reel = await getReel(reelPageId);
    const creator = await getInstagramCreator(reel.creatorPageId);
    // Auto re-fetch (Fortune 2026-11-20): an expired stored link is refreshed once (Apify, one Reel) and saved to Notion.
    const refresher = await createReelVideoRefresher(
      { pageId: reelPageId, shortcode: reel.shortcode, url: reel.url, videoUrl: reel.videoUrl },
      ledger,
    );
    const analyse = () => analyzeReelVideo({
      shortcode: reel.shortcode,
      videoUrl: refresher.videoUrl,
      caption: reel.caption,
      transcript: reel.transcript,
    }, ledger);
    let analysisResult;
    try {
      await refresher.ensureFresh();
      try {
        analysisResult = await analyse();
      } catch (error) {
        if (!(await refresher.refreshAfterError(error))) throw error;
        analysisResult = await analyse();
      }
    } catch (error) {
      await publishCostSummary(ledger);
      await rethrowNonRetryable(error);
      const outcome = refresher.outcome;
      if (outcome.attempted && !outcome.refreshed) {
        throw new Error(`${(error as Error).message} [video link refresh failed: ${outcome.error || "unknown"}]`);
      }
      throw error;
    }
    const visual = analysisResult.analysis;
    const recordId = reel.shortcode.replace(/[^a-z0-9]/gi, "_");
    const state = {
      description: "One candidate Instagram Reel for an AI Creative source system.",
      records: [{
        id: recordId,
        creator: `@${creator.handle}`,
        creatorPillars: creator.pillars,
        caption: reel.caption,
        transcript: reel.transcript,
        groundedVisualAnalysis: visual,
      }],
    };
    // Source-value decision (fit + visual/workflow value + mode). Fortune 2026-11-18: Gemini Decision 1 watching the
    // 480p Reel video, Jev text as automatic fallback; rollback IG_BRAIN_ANALYSIS_FIT_MODEL=typesafe/jev-1.13.
    const decision = await runSourceValueDecision({ shortcode: reel.shortcode, recordId, videoUrl: refresher.videoUrl, state }, ledger, {
      refreshVideoUrl: async (error) => (await refresher.refreshAfterError(error)) ? refresher.videoUrl : null,
    });
    console.log(`[analysis-fit] ${JSON.stringify({ shortcode: reel.shortcode, fit: decision.fit, fitScore: decision.fitScore, visual: decision.visualValue, workflow: decision.workflowValue, ...decision.decidedBy })}`);
    const fitScore = decision.fitScore;
    const visualValue = decision.visualValue;
    const workflowValue = decision.workflowValue;
    const priority = calculatePriorityScore({
      performanceScore: reel.performanceScore,
      strategicFitScore: fitScore,
      visualPatternValue: visualValue,
      workflowValue,
    });
    await updateReelIntelligence({
      pageId: reelPageId,
      geminiAnalysis: JSON.stringify(visual, null, 2),
      strategicFit: decision.fit,
      strategicFitScore: fitScore,
      visualPatternValue: visualValue,
      workflowValue,
      recommendedMode: decision.recommendedMode,
      jevConfidence: decision.confidence,
      priorityScore: priority.priorityScore,
    });
    await clearReelFailedState(reelPageId);
    await publishCostSummary(ledger);
    return { reelPageId, analysisProvider: analysisResult.provider, analysisModel: analysisResult.model, priorityScore: priority.priorityScore, fit: decision.fit, fitScore, visualValue, workflowValue, sourceValueDecidedBy: decision.decidedBy, videoRefresh: refresher.outcome, cost: ledger.summary() };
  },
});

