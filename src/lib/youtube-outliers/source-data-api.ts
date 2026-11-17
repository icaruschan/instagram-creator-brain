import { YOUTUBE_OUTLIER_CONFIG } from "./config";
import { parseDurationSeconds } from "./parse";
import type { YouTubeVideo } from "./types";

/**
 * Optional free source: YouTube Data API v3 (needs YOUTUBE_API_KEY, 10k units/day free).
 * One channel ≈ 1 (channels) + 1-2 (playlistItems) + 1-2 (videos) = ~5 units.
 * The API has no Shorts flag, so format = duration <= YT_OUTLIERS_SHORT_MAX_SECONDS (default 180s).
 * It can't read captions without OAuth, so transcripts still come from Apify (subtitles only).
 */
const API = "https://www.googleapis.com/youtube/v3";

async function get(path: string, params: Record<string, string>): Promise<any> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is required when YT_OUTLIERS_SOURCE=data-api");
  const query = new URLSearchParams({ ...params, key });
  const response = await fetch(`${API}/${path}?${query}`);
  if (!response.ok) throw new Error(`YouTube Data API ${path} failed: HTTP ${response.status}`);
  return response.json();
}

async function channelId(channelUrl: string): Promise<string> {
  const direct = channelUrl.match(/(UC[\w-]{22})/);
  if (direct) return direct[1];
  const handle = channelUrl.match(/@([\w.-]+)/)?.[1];
  if (!handle) throw new Error(`Can't read a channel id or @handle from ${channelUrl}`);
  const data = await get("channels", { part: "id", forHandle: `@${handle}` });
  const id = data.items?.[0]?.id;
  if (!id) throw new Error(`No YouTube channel for @${handle}`);
  return id;
}

export async function scrapeChannelWithDataApi(channelUrl: string, maxVideos = YOUTUBE_OUTLIER_CONFIG.longFormPerChannel + YOUTUBE_OUTLIER_CONFIG.shortsPerChannel): Promise<YouTubeVideo[]> {
  const id = await channelId(channelUrl);
  const uploads = `UU${id.slice(2)}`;
  const ids: string[] = [];
  let pageToken = "";
  while (ids.length < maxVideos) {
    const page = await get("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
    ids.push(...(page.items || []).map((item: any) => item.contentDetails?.videoId).filter(Boolean));
    pageToken = page.nextPageToken || "";
    if (!pageToken) break;
  }
  const out: YouTubeVideo[] = [];
  for (let i = 0; i < Math.min(ids.length, maxVideos); i += 50) {
    const batch = ids.slice(i, Math.min(i + 50, maxVideos));
    const data = await get("videos", { part: "snippet,statistics,contentDetails", id: batch.join(",") });
    for (const item of data.items || []) {
      const durationSeconds = parseDurationSeconds(item.contentDetails?.duration);
      out.push({
        id: item.id,
        url: `https://www.youtube.com/watch?v=${item.id}`,
        title: item.snippet?.title || "",
        description: String(item.snippet?.description || "").slice(0, 4_000),
        format: durationSeconds > 0 && durationSeconds <= YOUTUBE_OUTLIER_CONFIG.shortMaxSeconds ? "Short" : "Long-form",
        durationSeconds,
        views: Number(item.statistics?.viewCount || 0),
        likes: item.statistics?.likeCount != null ? Number(item.statistics.likeCount) : null,
        comments: item.statistics?.commentCount != null ? Number(item.statistics.commentCount) : null,
        publishedAt: item.snippet?.publishedAt || "",
        approximateDate: false,
        channelName: item.snippet?.channelTitle || "",
        channelUrl: `https://www.youtube.com/channel/${id}`,
        transcript: "",
      });
    }
  }
  return out;
}
