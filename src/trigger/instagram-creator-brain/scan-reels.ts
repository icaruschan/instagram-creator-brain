import { task, tasks } from "@trigger.dev/sdk/v3";
import { fetchReelTranscripts, reelScrapeResultsLimit, scrapeInstagramReels, type InstagramReel } from "../../lib/apify";
import { CostLedger, estimateCost, estimateVideoAnalysisCost, isBudgetExceeded, publishCostSummary } from "../../lib/instagram-brain/cost";
import { INSTAGRAM_BRAIN_CONFIG, parseCap } from "../../lib/instagram-brain/config";
import {
  createOrUpdateReel,
  createReelSnapshot,
  getActiveInstagramCreators,
  getInstagramCreator,
  getCreatorReels,
  getLatestReelSnapshot,
  getReel,
  updateCreatorCheckpoint,
  updateReelScore,
  type StoredReel,
} from "../../lib/instagram-brain/notion";
import { planCandidateSlots, recheckReason, type RecheckReason, type SlotEntry } from "../../lib/instagram-brain/candidates";
import { calculatePerformanceScore, engagementRate, median } from "../../lib/instagram-brain/scoring";
import {
  candidateSkipReason,
  expectedViewsAtAge,
  expectedViewsPerHourAtAge,
  fitAgeCurve,
  fitVelocityCurve,
  reelAgeDays,
  type AgeCurve,
} from "../../lib/instagram-brain/recency";
import { runQualifyInstagramReel } from "./qualify-reel";

export interface ScanInstagramPayload {
  creatorPageId?: string;
  creatorLimit?: number;
  reelsPerCreator?: number;
  /** Optional per-run spending cap (USD). Default: none (unlimited) unless IG_BRAIN_SCAN_BUDGET_USD is set. */
  budgetUsd?: number;
  /** Override the video-analysis cut-off (Performance Score 0-100). Defaults to IG_BRAIN_MIN_PERFORMANCE_FOR_ANALYSIS / 60. */
  minPerformanceScore?: number;
  /** Override how many video analyses this run may queue. Defaults to IG_BRAIN_DEEP_ANALYSIS_LIMIT / 5. */
  analysisLimit?: number;
  /** Override the recent window (days) for new candidates. Defaults to IG_BRAIN_RECENT_WINDOW_DAYS / 14. */
  recentWindowDays?: number;
}

/** Estimated cost of one queued video analysis task (video analysis + one Jev value call). */
export function estimatedAnalysisCost(): number {
  return estimateVideoAnalysisCost() + estimateCost("jev");
}

/** Estimated worst-case cost of scanning one creator. */
export function estimatedCreatorScanCost(reelsPerCreator: number): number {
  return estimateCost("apify-reel-scrape", reelScrapeResultsLimit(reelsPerCreator))
    + estimateCost("apify-transcript", reelsPerCreator)
    + estimateCost("jev", reelsPerCreator);
}

export async function runInstagramScan(payload: ScanInstagramPayload = {}) {
  // No cap by default (unlimited); payload.budgetUsd / IG_BRAIN_SCAN_BUDGET_USD opt back in.
  const ledger = new CostLedger("scan-reels", payload.budgetUsd != null ? parseCap(String(payload.budgetUsd)) : INSTAGRAM_BRAIN_CONFIG.scanBudgetUsd);
  const reelsPerCreator = payload.reelsPerCreator ?? INSTAGRAM_BRAIN_CONFIG.reelsPerCreator;
  const minPerformanceScore = payload.minPerformanceScore ?? INSTAGRAM_BRAIN_CONFIG.minPerformanceScoreForAnalysis;
  const analysisLimit = payload.analysisLimit ?? INSTAGRAM_BRAIN_CONFIG.deepAnalysisLimitPerRun;
  const windowDays = payload.recentWindowDays ?? INSTAGRAM_BRAIN_CONFIG.recentWindowDays;
  const perAnalysis = estimatedAnalysisCost();
  const perCreator = estimatedCreatorScanCost(reelsPerCreator);
  // With an opt-in cap: hold back money for the video analyses this scan may queue, so scraping can't eat all of it.
  const analysisHoldback = ledger.unlimited ? 0 : Math.min(analysisLimit, Math.floor(ledger.capUsd / perAnalysis)) * perAnalysis;
  if (analysisHoldback > 0) ledger.reserve(analysisHoldback, "held back for queued video analyses");
  let stoppedReason: string | null = null;

  const creators = payload.creatorPageId
    ? [await getInstagramCreator(payload.creatorPageId)]
    : await getActiveInstagramCreators(payload.creatorLimit ?? INSTAGRAM_BRAIN_CONFIG.creatorsPerScan);
  const results: Array<Record<string, unknown>> = [];
  const candidates: Array<{ reelPageId: string; performanceScore: number; fitScore: number }> = [];
  const recencyTotals = { windowDays, skippedPinned: 0, skippedTooOld: 0, skippedNoDate: 0, skippedBlocked: 0 };
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
      const blocked = new Set(INSTAGRAM_BRAIN_CONFIG.blockedShortcodes);
      const existingRows = await getCreatorReels(creator.pageId);
      const existingUrls = existingRows.map((row) => row.url).filter(Boolean);
      const knownUrls = new Set(existingUrls);
      const scan = await scrapeInstagramReels(creator.handle, reelsPerCreator, existingUrls, ledger, {
        windowDays,
        blockedShortcodes: blocked,
      });
      const scoredAt = new Date();
      const scrapedByUrl = new Map(scan.all.map((reel) => [reel.url, reel]));
      const unseenEligibleUrls = new Set(scan.unseenEligible.map((reel) => reel.url));

      // 1. Refresh metrics (free: Notion writes only): the 12 newest scraped Reels, plus every existing row
      //    inside the window that is in this scrape, so rechecks are scored on fresh numbers.
      const refresh = scan.all.filter((reel) => scan.recent.includes(reel)
        || (knownUrls.has(reel.url) && candidateSkipReason({ pinned: reel.isPinned, publishedAt: reel.timestamp }, windowDays, scoredAt) === null));
      const velocityByReel = new Map<string, number>();
      const freshRows = new Set<string>(); // URLs whose metrics were refreshed this scan
      const trustedPageIds = new Set<string>();
      const storeReel = async (reel: InstagramReel, snapshot = true) => {
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
        if (!snapshot) return stored; // second write of the same Reel this scan (adding its transcript)
        const previous = knownUrls.has(reel.url) ? await getLatestReelSnapshot(stored.pageId) : null;
        const capturedAt = new Date();
        if (stored.metricsTrusted) {
          await createReelSnapshot(stored, "Apify", capturedAt, previous || undefined);
          trustedPageIds.add(stored.pageId);
        }
        if (stored.metricsTrusted && previous) {
          const hours = (capturedAt.getTime() - new Date(previous.capturedAt).getTime()) / 3_600_000;
          if (hours >= 1) velocityByReel.set(stored.pageId, Math.max(0, stored.metrics.views - previous.views) / hours);
        }
        freshRows.add(reel.url);
        return stored;
      };
      for (const reel of refresh) await storeReel(reel);

      // 2. Age-fair baseline (see lib/instagram-brain/recency.ts).
      let allReels = await getCreatorReels(creator.pageId);
      const baselinePool = allReels.filter((reel) => !reel.pinned && reel.metrics.views > 0);
      const medianViews = median(baselinePool.map((reel) => reel.metrics.views));
      const medianEngagementRate = median(baselinePool.map((reel) => engagementRate(reel.metrics)));
      const scrapePoints = scan.all
        .filter((reel) => !reel.isPinned)
        .map((reel) => ({ views: reel.videoPlayCount || reel.videoViewCount, ageDays: reelAgeDays(reel.timestamp, scoredAt) }))
        .filter((point): point is { views: number; ageDays: number } => point.ageDays != null && point.views > 0);
      let ageCurve: AgeCurve | null = fitAgeCurve(scrapePoints);
      if ((!ageCurve || ageCurve.points < 5) && medianViews > 0) {
        ageCurve = { logLevel: Math.log(medianViews), exponent: 0, points: baselinePool.length, method: "plain-median" };
      }
      const velocityCurve = ageCurve
        ? fitVelocityCurve(
          allReels
            .filter((reel) => !reel.pinned && velocityByReel.has(reel.pageId))
            .map((reel) => ({ viewsPerHour: velocityByReel.get(reel.pageId)!, ageDays: reelAgeDays(reel.publishedAt, scoredAt) ?? NaN })),
          ageCurve,
        )
        : null;
      const ageCurveSummary = ageCurve
        ? { method: ageCurve.method, growthExponent: Math.round(ageCurve.exponent * 100) / 100, points: ageCurve.points,
          expectedViewsAt1d: Math.round(expectedViewsAtAge(ageCurve, 1)), expectedViewsAt7d: Math.round(expectedViewsAtAge(ageCurve, 7)),
          expectedViewsAt14d: Math.round(expectedViewsAtAge(ageCurve, 14)), velocityPoints: velocityCurve?.points ?? 0 }
        : null;
      console.log(`[age-curve] ${JSON.stringify({ creator: creator.handle, ...ageCurveSummary })}`);
      const scoreFor = (metrics: { views: number; likes: number; comments: number }, publishedAt: string, pageId?: string) => {
        if (!ageCurve) return null;
        const ageDays = reelAgeDays(publishedAt, scoredAt);
        if (ageDays == null) return null;
        return calculatePerformanceScore({
          reel: metrics,
          medianViews: expectedViewsAtAge(ageCurve, ageDays),
          medianEngagementRate,
          currentViewsPerHour: pageId ? velocityByReel.get(pageId) : null,
          medianViewsPerHour: velocityCurve ? expectedViewsPerHourAtAge(velocityCurve, ageDays) : null,
        });
      };

      // 3. Rescore refreshed rows that are unpinned and inside the window. Pinned / old / undated keep their old score.
      const notRescored = { pinned: 0, tooOld: 0, noDate: 0 };
      const performanceByPage = new Map<string, number>();
      for (const reel of allReels) {
        if (!freshRows.has(reel.url)) continue;
        const skip = candidateSkipReason(reel, windowDays, scoredAt);
        if (skip) {
          if (skip === "pinned") notRescored.pinned++;
          else if (skip === "too-old") notRescored.tooOld++;
          else notRescored.noDate++;
          continue;
        }
        const score = scoreFor(reel.metrics, reel.publishedAt, reel.pageId);
        if (!score) continue;
        await updateReelScore(reel.pageId, score);
        performanceByPage.set(reel.pageId, score.score);
      }

      // 4. Build the two pools and share the slots (lib/instagram-brain/candidates.ts).
      const rowByUrl = new Map(allReels.map((row) => [row.url, row]));
      type PoolEntry = SlotEntry & { reel?: InstagramReel; row?: StoredReel; reason?: RecheckReason };
      const freshPool: PoolEntry[] = scan.unseenEligible.map((reel): PoolEntry => {
        const row = rowByUrl.get(reel.url);
        const performanceScore = row && performanceByPage.has(row.pageId)
          ? performanceByPage.get(row.pageId)!
          : scoreFor({ views: reel.videoPlayCount || reel.videoViewCount, likes: reel.likesCount, comments: reel.commentsCount }, reel.timestamp)?.score ?? 0;
        return { key: reel.url, source: "new", performanceScore, publishedTime: Date.parse(reel.timestamp) || 0, reel };
      });
      const recheckPool: PoolEntry[] = [];
      for (const row of allReels) {
        if (unseenEligibleUrls.has(row.url) || !knownUrls.has(row.url)) continue; // new this scan → NEW pool
        const performanceScore = performanceByPage.get(row.pageId) ?? row.performanceScore;
        const reason = recheckReason(row, {
          ageDays: reelAgeDays(row.publishedAt, scoredAt), windowDays, performanceScore, minPerformanceScore, blocked,
        });
        if (reason) recheckPool.push({ key: row.url, source: "recheck", performanceScore, publishedTime: Date.parse(row.publishedAt) || 0, row, reason });
      }
      const plan = planCandidateSlots(reelsPerCreator, freshPool, recheckPool);

      // 5. Transcripts only for slot winners that don't have one yet, then store/refresh them.
      const needTranscript = plan.picked
        .map((pick) => pick.source === "new" ? pick.reel : scrapedByUrl.get(pick.key))
        .filter((reel, index): reel is InstagramReel => Boolean(reel)
          && plan.picked[index].reason !== "fit-ok-not-analysed" // already fit-checked; analysis works from the video
          && !(rowByUrl.get(reel!.url)?.transcript));
      const transcripts = await fetchReelTranscripts(needTranscript, ledger);
      const picks: Array<{ pageId: string; source: "new" | "recheck"; reason: RecheckReason | "new"; slot: string; alreadyFit: boolean }> = [];
      for (const pick of plan.picked) {
        const scraped = pick.source === "new" ? pick.reel : scrapedByUrl.get(pick.key);
        let pageId = rowByUrl.get(pick.key)?.pageId;
        const transcript = scraped ? transcripts.get(scraped.id) : undefined;
        if (scraped && (!pageId || transcript)) {
          const stored = await storeReel({ ...scraped, transcript: transcript || "" }, !freshRows.has(scraped.url));
          pageId = stored.pageId;
          if (!rowByUrl.has(pick.key)) {
            const score = scoreFor(stored.metrics, scraped.timestamp, stored.pageId);
            if (score) await updateReelScore(stored.pageId, score);
          }
        }
        if (!pageId) continue;
        // A new Reel whose views couldn't be trusted (0 views) isn't a candidate (as before).
        if (pick.source === "new" && !trustedPageIds.has(pageId)) continue;
        const reason = pick.source === "new" ? "new" : pick.reason!;
        picks.push({ pageId, source: pick.source, reason, slot: pick.slot, alreadyFit: reason === "fit-ok-not-analysed" });
      }
      const slotSummary = {
        slots: reelsPerCreator,
        freshSlots: plan.freshSlots,
        picked: { new: picks.filter((p) => p.source === "new").length, recheck: picks.filter((p) => p.source === "recheck").length },
        rechecksByReason: {
          neverFitChecked: picks.filter((p) => p.reason === "never-fit-checked").length,
          fitOkNotAnalysed: picks.filter((p) => p.reason === "fit-ok-not-analysed").length,
        },
        pool: { new: freshPool.length, recheck: recheckPool.length },
        overflow: plan.overflow,
      };
      console.log(`[slots] ${JSON.stringify({ creator: creator.handle, ...slotSummary })}`);

      allReels = await getCreatorReels(creator.pageId);
      await updateCreatorCheckpoint(creator.pageId, {
        lastChecked: new Date().toISOString(),
        medianViews,
        medianEngagementRate,
      });

      // 6. Normal candidate steps: fit check (skipped for rows already Core/Supporting), then the analysis gate below.
      for (const pick of picks) {
        if (pick.alreadyFit) {
          const stored = await getReel(pick.pageId);
          candidates.push({ reelPageId: pick.pageId, performanceScore: stored.performanceScore, fitScore: stored.strategicFitScore });
          continue;
        }
        const qualification = await runQualifyInstagramReel({ reelPageId: pick.pageId }, ledger);
        if (qualification.fit === "Core" || qualification.fit === "Supporting") {
          const stored = await getReel(pick.pageId);
          candidates.push({ reelPageId: pick.pageId, performanceScore: stored.performanceScore, fitScore: qualification.score });
        }
      }
      recencyTotals.skippedPinned += scan.recency.skippedPinned;
      recencyTotals.skippedTooOld += scan.recency.skippedTooOld;
      recencyTotals.skippedNoDate += scan.recency.skippedNoDate;
      recencyTotals.skippedBlocked += scan.recency.skippedBlocked;
      results.push({
        creator: creator.handle,
        newReels: slotSummary.picked.new,
        rechecks: slotSummary.picked.recheck,
        slots: slotSummary,
        storedRows: allReels.length,
        trialReels: scan.trialReels,
        recency: scan.recency,
        notRescored,
        ageCurve: ageCurveSummary,
        status: "ok",
      });
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
      stoppedReason = stoppedReason || `Spending cap: no budget left to queue more video analyses`;
      break;
    }
    ledger.reserve(perAnalysis, `queued video analysis ${candidate.reelPageId}`);
    await tasks.trigger("instagram-brain-analyze-reel", { reelPageId: candidate.reelPageId });
    queued.push(candidate.reelPageId);
  }
  const cost = ledger.summary();
  await publishCostSummary(ledger);
  console.log(`[cost] scan summary ${JSON.stringify(cost)}`);
  console.log(`[recency] scan totals ${JSON.stringify(recencyTotals)}`);
  return {
    creators: creators.length,
    results,
    visualAnalysesQueued: queued.length,
    analysisCutoff: { minPerformanceScore, candidates: candidates.length, belowCutoff },
    recency: recencyTotals,
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
