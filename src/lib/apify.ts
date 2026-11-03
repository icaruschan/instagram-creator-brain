import { ApifyClient } from "apify-client";
import dotenv from "dotenv";

dotenv.config({ override: true });

export interface InstagramReel {
  id: string;
  caption: string;
  url: string;
  transcript: string;
  likesCount: number;
  commentsCount: number;
  videoViewCount: number;
  videoPlayCount: number;
  videoDuration: number;
  timestamp: string;
  ownerUsername: string;
  videoUrl: string;
  coverUrl: string;
  isPinned: boolean;
}

export interface InstagramReelScan {
  recent: InstagramReel[];
  selected: InstagramReel[];
}

function tokens(): string[] {
  return [
    process.env.APIFY_TOKEN,
    process.env.BACKUP_APIFY_TOKEN,
    process.env.BACKUP_APIFY_TOKEN_2,
    process.env.BACKUP_APIFY_TOKEN_3,
    process.env.BACKUP_APIFY_TOKEN_4,
  ].filter((token): token is string => Boolean(token));
}

async function withApify<T>(operation: (client: ApifyClient) => Promise<T>): Promise<T> {
  const available = tokens();
  if (!available.length) throw new Error("APIFY_TOKEN is required for Instagram source scans");
  let lastError: unknown;
  for (const token of available) {
    try {
      return await operation(new ApifyClient({ token }));
    } catch (error) {
      lastError = error;
      console.warn("Apify token attempt failed; trying the next configured token.");
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All Apify token attempts failed");
}

function cleanHandle(value: string): string {
  return value.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\/$/, "");
}

function shortcode(item: any): string {
  return item.shortCode || item.code || item.id || "";
}

export async function scrapeInstagramReels(
  username: string,
  resultsLimit = 3,
  excludeUrls: string[] = [],
): Promise<InstagramReelScan> {
  const handle = cleanHandle(username);
  const metadata = await withApify(async (client) => {
    const run = await client.actor("apify/instagram-reel-scraper").call({
      username: [handle],
      resultsLimit: Math.max(30, resultsLimit * 2),
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    return (items || []) as any[];
  });

  const chronological = metadata
    .filter((item) => item.url)
    .sort((a, b) => Date.parse(String(b.timestamp || b.createdAt || "")) - Date.parse(String(a.timestamp || a.createdAt || "")));
  const unseen = chronological.filter((item) => !excludeUrls.includes(item.url));
  const newestCount = Math.ceil(resultsLimit / 2);
  const newest = unseen.slice(0, newestCount);
  const top = unseen.slice(newestCount)
    .sort((a, b) => Number(b.videoPlayCount || b.videoViewCount || 0) - Number(a.videoPlayCount || a.videoViewCount || 0))
    .slice(0, resultsLimit - newestCount);
  const selected = [...newest, ...top];

  const transcripts = new Map<string, string>();
  for (let index = 0; index < selected.length; index += 3) {
    const batch = selected.slice(index, index + 3);
    await Promise.all(batch.map(async (item) => {
      if (!item.url) return;
      try {
        await withApify(async (client) => {
          const run = await client.actor("apple_yang/instagram-transcripts-scraper").call({ videoUrl: item.url });
          const { items } = await client.dataset(run.defaultDatasetId).listItems();
          const transcript = (items?.[0] as any)?.text;
          const code = (items?.[0] as any)?.code || shortcode(item);
          if (code && transcript) transcripts.set(code, transcript);
        });
      } catch (error) {
        console.warn(`Transcript unavailable for ${item.url}: ${(error as Error).message}`);
      }
    }));
    if (index + 3 < selected.length) await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  const normalize = (item: any): InstagramReel => {
    const code = shortcode(item);
    return {
      id: code,
      caption: String(item.caption || "").slice(0, 2_000),
      url: String(item.url || ""),
      transcript: String(transcripts.get(code) || "").slice(0, 5_000),
      likesCount: Number(item.likesCount || item.likeCount || 0),
      commentsCount: Number(item.commentsCount || item.commentCount || 0),
      videoViewCount: Number(item.videoViewCount || item.videoPlayCount || item.viewCount || 0),
      videoPlayCount: Number(item.videoPlayCount || item.videoViewCount || item.playCount || 0),
      videoDuration: Number(item.videoDuration || 0),
      timestamp: String(item.timestamp || item.createdAt || ""),
      ownerUsername: String(item.ownerUsername || item.owner?.username || handle),
      videoUrl: String(item.videoUrl || item.video_url || ""),
      coverUrl: String(item.displayUrl || item.thumbnailUrl || item.coverUrl || ""),
      isPinned: Boolean(item.isPinned || item.pinned),
    };
  };
  return {
    recent: chronological.slice(0, 12).map(normalize),
    selected: selected.map(normalize),
  };
}
