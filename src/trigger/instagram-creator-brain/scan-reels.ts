import { task, tasks } from "@trigger.dev/sdk/v3";
import { reelScrapeResultsLimit, scrapeInstagramReels } from "../../lib/apify";
import { CostLedger, estimateCost, isBudgetExceeded, publishCostSummary } from "../../lib/instagram-brain/cost";
import { INSTAGRAM_BRAIN_CONFIG } from "../../lib/instagram-brain/config";
import {
  createOrUpdateReel,
  createReelSnapshot,
  getActiveInstagramCreators,
  getInstagramCreator,
  getCreatorReelUrls,
  getCreatorReels,
  getLatestReelSnapshot,
  getReel,
  updateCreatorCheckpoint,
  updateReelScore,
} from "../../lib/instagram-brain/notion";
import { calculatePerformanceScore, engagementRate, median } from "../../lib/instagram-brain/scoring";
import { runQualifyInstagramReel } from "./qualify-reel";

export interface ScanInstagramPayload {
  creatorPageId?: string;
  creatorLimit?: number;
  reelsPerCreator?: number;
  /** Override the per-run spending cap (USD). Defaults to IG_BRAIN_SCAN_BUDGET_USD / $1.00. */
  budgetUsd?: number;
  /** Override the Gemini cut-off (Performance Score 0-100). Defaults to IG_BRAIN_MIN_PERFORMANCE_FOR_ANALYSIS / 60. */
  minPerformanceScore?: number;
  /** Override how many Gemini analyses this run may queue. Defaults to IG_BRAIN_DEEP_ANALYSIS_LIMIT / 5. */
  analysisLimit?: number;
}

/** Estimated cost of one queued Gemini analysis task (video analysis + one Jev value call). */
export function estimatedAnalysisCost(): number {
  return estimateCost("gemini-analysis") + estimateCost("jev");
}

/** Estimated worst-case cost of scanning one creator. */
export function estimatedCreatorScanCost(reelsPerCreator: number): number {
  return estimateCost("apify-reel-scrape", reelScrapeResultsLimit(reelsPerCreator))
    + estimateCost("apify-transcript", reelsPerCreator)
    + estimateCost("jev", reelsPerCreator);
}

export async function runInstagramScan(payload: ScanInstagramPayload = {}) {
  const ledger = new CostLedger("scan-reels", payload.budgetUsd ?? INSTAGRAM_BRAIN_CONFIG.scanBudgetUsd);
  const reelsPerCreator = payload.reelsPerCreator ?? INSTAGRAM_BRAIN_CONFIG.reelsPerCreator;
  const minPerformanceScore = payload.minPerformanceScore ?? INSTAGRAM_BRAIN_CONFIG.minPerformanceScoreForAnalysis;
  const analysisLimit = payload.analysisLimit ?? INSTAGRAM_BRAIN_CONFIG.deepAnalysisLimitPerRun;
  const perAnalysis = estimatedAnalysisCost();
  const perCreator = estimatedCreatorScanCost(reelsPerCreator);
  // Hold back money for the Gemini analyses this scan may queue, so scraping can't eat all of it.
  const analysisHoldback = Math.min(analysisLimit, Math.floor(ledger.capUsd / perAnalysis)) * perAnalysis;
  if (analysisHoldback > 0) ledger.reserve(analysisHoldback, "held back for queued Gemini analyses");
  let stoppedReason: string | null = null;

  const creators = payload.creatorPageId
    ? [await getInstagramCreator(payload.creatorPageId)]
    : await getActiveInstagramCreators(payload.creatorLimit ?? INSTAGRAM_BRAIN_CONFIG.creatorsPerScan);
  const results: Array<Record<string, unknown>> = [];
  const candidates: Array<{ reelPageId: string; performanceScore: number; fitScore: number }> = [];
  for (const creator of creators) {
    if (stoppedReason) {
      results.push({ creator: creator.handle, status: "skipped", reason: stoppedReason });
      continue;
    }
    if (!ledger.canAfford(perCreator)) {
      stoppedReason = `Spending cap: scanning @${creator.handle} needs ~$${perCreator.toFixed(3)}, only $${ledger.remainingUsd.toFixed(3)} left of $${ledger.capUsd.toFixed(2)}`;
      results.push({ creator: creator.handle, status: "skipped", reason: stoppedReason });
      continue;
    }
    try {
      const existingUrls = await getCreatorReelUrls(creator.pageId);
      const scan = await scrapeInstagramReels(
        creator.handle,
        reelsPerCreator,
        existingUrls,
        ledger,
      );
      const newPageIds = new Set<string>();
      const velocityByReel = new Map<string, number>();
      const selectedByUrl = new Map(scan.selected.map((reel) => [reel.url, reel]));
      const reelsByUrl = new Map(
        [...scan.recent, ...scan.selected].map((reel) => [reel.url, selectedByUrl.get(reel.url) || reel]),
      );
      const knownUrls = new Set(existingUrls);
      for (const reel of reelsByUrl.values()) {
        const stored = await createOrUpdateReel({
          creatorPageId: creator.pageId,
          creatorName: creator.name,
          primaryPillar: creator.primaryPillar,
          pillars: creator.pillars,
          shortcode: reel.id,
          url: reel.url,
          caption: reel.caption,
          transcript: reel.transcript,
          publishedAt: reel.timestamp,
          durationSeconds: reel.videoDuration,
          pinned: reel.isPinned,
          coverUrl: reel.coverUrl,
          videoUrl: reel.videoUrl,
          metrics: {
            views: reel.videoPlayCount || reel.videoViewCount,
            likes: reel.likesCount,
            comments: reel.commentsCount,
          },
        });
        const previous = knownUrls.has(reel.url)
          ? await getLatestReelSnapshot(stored.pageId)
          : null;
        const capturedAt = new Date();
        if (stored.metricsTrusted) await createReelSnapshot(stored, "Apify", capturedAt, previous || undefined);
        if (stored.metricsTrusted && previous) {
          const hours = (capturedAt.getTime() - new Date(previous.capturedAt).getTime()) / 3_600_000;
          if (hours >= 1) {
            velocityByReel.set(stored.pageId, Math.max(0, stored.metrics.views - previous.views) / hours);
          }
        }
        if (!knownUrls.has(reel.url) && selectedByUrl.has(reel.url) && stored.metricsTrusted) newPageIds.add(stored.pageId);
      }

      const allReels = await getCreatorReels(creator.pageId);
      const baselinePool = allReels.filter((reel) => !reel.pinned && reel.metrics.views > 0);
      const medianViews = median(baselinePool.map((reel) => reel.metrics.views));
      const medianEngagementRate = median(baselinePool.map((reel) => engagementRate(reel.metrics)));
      const positiveVelocities = [...velocityByReel.values()].filter((value) => value > 0);
      const medianViewsPerHour = positiveVelocities.length >= 3 ? median(positiveVelocities) : null;
      for (const reel of allReels) {
        const score = calculatePerformanceScore({
          reel: reel.metrics,
          medianViews,
          medianEngagementRate,
          currentViewsPerHour: velocityByReel.get(reel.pageId),
          medianViewsPerHour,
        });
        await updateReelScore(reel.pageId, score);
      }
      await updateCreatorCheckpoint(creator.pageId, {
        lastChecked: new Date().toISOString(),
        medianViews,
        medianEngagementRate,
      });
      for (const reelPageId of newPageIds) {
        const qualification = await runQualifyInstagramReel({ reelPageId }, ledger);
        if (qualification.fit === "Core" || qualification.fit === "Supporting") {
          const stored = await getReel(reelPageId);
          candidates.push({ reelPageId, performanceScore: stored.performanceScore, fitScore: qualification.score });
        }
      }
      results.push({ creator: creator.handle, newReels: newPageIds.size, baselineReels: reelsByUrl.size, status: "ok" });
    } catch (error) {
      if (isBudgetExceeded(error)) {
        stoppedReason = error.message;
        console.warn(`Instagram Creator Brain scan stopped at @${creator.handle}: ${error.message}`);
        results.push({ creator: creator.handle, status: "stopped", reason: error.message });
        continue;
      }
      console.error(`Instagram Creator Brain scan failed for @${creator.handle}:`, error);
      results.push({ creator: creator.handle, status: "failed", error: (error as Error).message });
    }
  }

  // Release the hold-back, then reserve one slot per analysis actually queued.
  ledger.release(analysisHoldback);
  const aboveCutoff = candidates.filter((candidate) => candidate.performanceScore >= minPerformanceScore);
  const belowCutoff = candidates
    .filter((candidate) => candidate.performanceScore < minPerformanceScore)
    .map((candidate) => ({ reelPageId: candidate.reelPageId, performanceScore: candidate.performanceScore }));
  const ranked = aboveCutoff
    .sort((a, b) => (b.performanceScore * 0.7 + b.fitScore * 0.3) - (a.performanceScore * 0.7 + a.fitScore * 0.3))
    .slice(0, analysisLimit);
  const queued: string[] = [];
  for (const candidate of ranked) {
    if (!ledger.canAfford(perAnalysis)) {
      stoppedReason = stoppedReason || `Spending cap: no budget left to queue more Gemini analyses`;
      break;
    }
    ledger.reserve(perAnalysis, `queued gemini analysis ${candidate.reelPageId}`);
    await tasks.trigger("instagram-brain-analyze-reel", { reelPageId: candidate.reelPageId });
    queued.push(candidate.reelPageId);
  }
  const cost = ledger.summary();
  await publishCostSummary(ledger);
  console.log(`[cost] scan summary ${JSON.stringify(cost)}`);
  return {
    creators: creators.length,
    results,
    visualAnalysesQueued: queued.length,
    analysisCutoff: { minPerformanceScore, candidates: candidates.length, belowCutoff },
    stoppedReason,
    cost,
  };
}

/**
 * Manual task until the user explicitly approves recurring scans.
 * Retries are off: a retry would re-scrape (and re-pay for) everything, outside the run's spending cap.
 * Per-creator failures are already caught inside the run.
 */
export const scanInstagramCreatorBrain = task({
  id: "instagram-brain-scan-reels",
  maxDuration: 14_400,
  retry: { maxAttempts: 1 },
  run: async (payload: ScanInstagramPayload) => runInstagramScan(payload || {}),
});
