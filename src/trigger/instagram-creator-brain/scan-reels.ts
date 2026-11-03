import { task, tasks } from "@trigger.dev/sdk/v3";
import { scrapeInstagramReels } from "../../lib/apify";
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
}

export async function runInstagramScan(payload: ScanInstagramPayload = {}) {
  const creators = payload.creatorPageId
    ? [await getInstagramCreator(payload.creatorPageId)]
    : await getActiveInstagramCreators(payload.creatorLimit ?? INSTAGRAM_BRAIN_CONFIG.creatorsPerScan);
  const results: Array<Record<string, unknown>> = [];
  const candidates: Array<{ reelPageId: string; performanceScore: number; fitScore: number }> = [];
  for (const creator of creators) {
    try {
      const existingUrls = await getCreatorReelUrls(creator.pageId);
      const scan = await scrapeInstagramReels(
        creator.handle,
        payload.reelsPerCreator ?? INSTAGRAM_BRAIN_CONFIG.reelsPerCreator,
        existingUrls,
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
        const qualification = await runQualifyInstagramReel({ reelPageId });
        if (qualification.fit === "Core" || qualification.fit === "Supporting") {
          const stored = await getReel(reelPageId);
          candidates.push({ reelPageId, performanceScore: stored.performanceScore, fitScore: qualification.score });
        }
      }
      results.push({ creator: creator.handle, newReels: newPageIds.size, baselineReels: reelsByUrl.size, status: "ok" });
    } catch (error) {
      console.error(`Instagram Creator Brain scan failed for @${creator.handle}:`, error);
      results.push({ creator: creator.handle, status: "failed", error: (error as Error).message });
    }
  }
  const selected = candidates
    .sort((a, b) => (b.performanceScore * 0.7 + b.fitScore * 0.3) - (a.performanceScore * 0.7 + a.fitScore * 0.3))
    .slice(0, INSTAGRAM_BRAIN_CONFIG.deepAnalysisLimitPerRun);
  for (const candidate of selected) {
    await tasks.trigger("instagram-brain-analyze-reel", { reelPageId: candidate.reelPageId });
  }
  return { creators: creators.length, results, visualAnalysesQueued: selected.length };
}

/** Manual task until the user explicitly approves recurring scans. */
export const scanInstagramCreatorBrain = task({
  id: "instagram-brain-scan-reels",
  maxDuration: 14_400,
  retry: { maxAttempts: 2 },
  run: async (payload: ScanInstagramPayload) => runInstagramScan(payload || {}),
});
