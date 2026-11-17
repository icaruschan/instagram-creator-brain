import type { CostLedger } from "../instagram-brain/cost";
import { YOUTUBE_OUTLIER_CONFIG, type YouTubeSourceKind } from "./config";
import { channelSummary, rankOutliers, scoreOutliers, type OutlierOptions } from "./scoring";
import { fetchTranscriptsWithApify, scrapeChannelWithApify } from "./source-apify";
import { scrapeChannelWithDataApi } from "./source-data-api";
import type { YouTubeVideo } from "./types";

export async function fetchChannelVideos(
  channelUrl: string,
  options: { source?: YouTubeSourceKind; ledger?: CostLedger; longForm?: number; shorts?: number } = {},
): Promise<YouTubeVideo[]> {
  const source = options.source ?? YOUTUBE_OUTLIER_CONFIG.source;
  if (source === "data-api") {
    const videos = await scrapeChannelWithDataApi(channelUrl, (options.longForm ?? YOUTUBE_OUTLIER_CONFIG.longFormPerChannel) + (options.shorts ?? YOUTUBE_OUTLIER_CONFIG.shortsPerChannel));
    options.ledger?.record("youtube-data-api", `youtube data api ${channelUrl}`, 0, 0);
    return videos;
  }
  return scrapeChannelWithApify(channelUrl, options);
}

/** Score a channel's videos and pick the outliers (Shorts and long-form ranked in one list by multiple). */
export function analyseChannel(videos: YouTubeVideo[], options: OutlierOptions = {}) {
  const scored = scoreOutliers(videos, options);
  return { scored, outliers: rankOutliers(scored), summary: channelSummary(scored) };
}

export { fetchTranscriptsWithApify };
