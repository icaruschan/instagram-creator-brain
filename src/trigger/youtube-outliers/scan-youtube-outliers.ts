import { task, tasks } from "@trigger.dev/sdk/v3";
import { CostLedger, publishCostSummary } from "../../lib/instagram-brain/cost";
import { INSTAGRAM_BRAIN_CONFIG, parseCap } from "../../lib/instagram-brain/config";
import { YOUTUBE_OUTLIER_CONFIG } from "../../lib/youtube-outliers/config";
import {
  getCreatorOutliers,
  getYouTubeChannels,
  setOutlierTranscript,
  updateCreatorYouTubeCheckpoint,
  upsertOutlierRow,
} from "../../lib/youtube-outliers/notion";
import { analyseChannel, fetchChannelVideos, fetchTranscriptsWithApify } from "../../lib/youtube-outliers/scan";

export interface ScanYouTubeOutliersPayload {
  /** Limit to these Creator Bench pages (default: every Active creator with a YouTube channel, oldest check first). */
  creatorPageIds?: string[];
  channelLimit?: number;
  /** New outliers that get Reel ideas queued automatically (default YT_OUTLIERS_AUTO_IDEAS_PER_SCAN / 3; 0 = none). */
  autoIdeas?: number;
  /** Optional per-run spending cap (USD); default none, like the Reel scan. */
  budgetUsd?: number;
}

/**
 * YouTube outlier scan (MANUAL ONLY: no schedule until Fortune approves one).
 * Per channel: pull newest long-form + Shorts → age-fair, same-format outlier scores → upsert every video into
 * "YouTube Outliers" (outliers only; past rows refreshed; the baseline medians go on Creator Bench) → subtitles for NEW outliers only → queue Reel ideas
 * for the top N new outliers (Idea Lab, Angle Ready).
 */
export async function runYouTubeOutlierScan(payload: ScanYouTubeOutliersPayload = {}) {
  const ledger = new CostLedger("scan-youtube-outliers", payload.budgetUsd != null ? parseCap(String(payload.budgetUsd)) : INSTAGRAM_BRAIN_CONFIG.scanBudgetUsd);
  const channels = await getYouTubeChannels(payload.channelLimit ?? YOUTUBE_OUTLIER_CONFIG.channelsPerScan, payload.creatorPageIds || []);
  const autoIdeas = payload.autoIdeas ?? YOUTUBE_OUTLIER_CONFIG.autoIdeasPerScan;
  const report: any[] = [];
  const newOutliers: Array<{ pageId: string; multiple: number }> = [];

  for (const channel of channels) {
    const videos = await fetchChannelVideos(channel.channelUrl, { ledger });
    const { scored, outliers, summary } = analyseChannel(videos);
    const pageIds = new Map<string, { pageId: string; isNew: boolean; hasTranscript: boolean }>();
    const stored = await getCreatorOutliers(channel.creatorPageId);
    for (const video of scored) {
      const existing = stored.get(video.id) || null;
      // Only outliers get a row; rows already stored (past outliers) are refreshed so their numbers stay current.
      if (!video.score.isOutlier && !existing) continue;
      const pageId = await upsertOutlierRow(channel.creatorPageId, video, existing);
      const isNewOutlier = video.score.isOutlier && (!existing || !existing.video.score.isOutlier) && !(existing && ["Ideas Ready", "Ignored"].includes(existing.status));
      pageIds.set(video.id, { pageId, isNew: isNewOutlier, hasTranscript: Boolean(existing?.hasTranscript) });
    }
    const needTranscript = outliers.filter((video) => pageIds.get(video.id)?.isNew && !pageIds.get(video.id)?.hasTranscript);
    const transcripts = await fetchTranscriptsWithApify(needTranscript.map((video) => video.url), ledger);
    for (const video of needTranscript) {
      const transcript = transcripts.get(video.id);
      if (transcript) await setOutlierTranscript(pageIds.get(video.id)!.pageId, transcript);
    }
    for (const video of outliers) {
      const entry = pageIds.get(video.id);
      if (entry?.isNew) newOutliers.push({ pageId: entry.pageId, multiple: video.score.multiple ?? 0 });
    }
    await updateCreatorYouTubeCheckpoint(channel.creatorPageId, summary, channel.channelUrl);
    report.push({
      creator: channel.name,
      channelUrl: channel.channelUrl,
      videos: scored.length,
      summary,
      outliers: outliers.map((video) => ({ id: video.id, title: video.title, format: video.format, views: video.views, multiple: video.score.multiple, ageDays: video.score.ageDays })),
    });
  }

  const queued = newOutliers.sort((a, b) => b.multiple - a.multiple).slice(0, Math.max(0, autoIdeas));
  for (const item of queued) {
    await tasks.trigger("youtube-outliers-generate-reel-ideas", { outlierPageId: item.pageId });
  }
  await publishCostSummary(ledger);
  return { channels: report, newOutliers: newOutliers.length, ideasQueued: queued.length, cost: ledger.summary() };
}

/** Manual task until Fortune explicitly approves a schedule. */
export const scanYouTubeOutliers = task({
  id: "youtube-outliers-scan",
  maxDuration: 3_600,
  retry: { maxAttempts: 2 },
  run: runYouTubeOutlierScan,
});
