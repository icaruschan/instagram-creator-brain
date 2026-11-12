import { ApifyClient } from "apify-client";
import dotenv from "dotenv";
import { INSTAGRAM_BRAIN_CONFIG } from "./instagram-brain/config";
import { estimateCost, isBudgetExceeded, type CostLedger } from "./instagram-brain/cost";
import { filterRecentCandidates, type RecencyCounts } from "./instagram-brain/recency";

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

export interface TrialReelReport {
  /** skipTrialReels was sent to the actor. */
  skipRequested: boolean;
  /** Results the actor returned (after its own Trial Reel filtering). */
  resultsReturned: number;
  /** Items our backstop dropped because they still carried a trial flag (normally 0). */
  droppedLocally: number;
  /**
   * The actor filters Trial Reels server-side and does not report how many it removed, and its output
   * does not mark Trial Reels (per its README, the only way to count them is a second scrape without
   * the filter and a diff, which doubles the scrape cost). So the skipped count is not available.
   */
  skippedByActor: null;
}

export interface InstagramReelScan {
  recent: InstagramReel[];
  selected: InstagramReel[];
  /** Every scraped Reel (same capture moment), used for the age-fair baseline. No transcripts. */
  all: InstagramReel[];
  trialReels: TrialReelReport;
  /** Unseen Reels skipped as candidates: pinned, too old for the recent window, or no publish date. */
  recency: RecencyCounts & { windowDays: number };
}

export function isFlaggedTrialReel(item: any): boolean {
  return item?.isTrialReel === true || item?.trialReel === true || item?.is_trial_reel === true || item?.productType === "trial_reel";
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

/** How many items the reel scraper is asked for per creator (baseline pool + selection). */
export function reelScrapeResultsLimit(resultsLimit: number): number {
  return Math.max(30, resultsLimit * 2);
}

export async function scrapeInstagramReels(
  username: string,
  resultsLimit = 3,
  excludeUrls: string[] = [],
  ledger?: CostLedger,
  options: { windowDays?: number; now?: Date } = {},
): Promise<InstagramReelScan> {
  const handle = cleanHandle(username);
  const scrapeLimit = reelScrapeResultsLimit(resultsLimit);
  const scrapeEstimate = estimateCost("apify-reel-scrape", scrapeLimit);
  ledger?.ensure(scrapeEstimate, `reel scrape @${handle}`);
  const metadata = await withApify(async (client) => {
    const run: any = await client.actor("apify/instagram-reel-scraper").call({
      username: [handle],
      resultsLimit: scrapeLimit,
      // Trial Reels are test posts shown to non-followers; they skew baselines and look like duplicates.
      skipTrialReels: INSTAGRAM_BRAIN_CONFIG.skipTrialReels,
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const resultCount = (items || []).length;
    // Pay-per-event actor: charge is per result. Count what came back, and take Apify's own usage figure if higher.
    const byResults = estimateCost("apify-reel-scrape", resultCount);
    const reported = Number(run?.usageTotalUsd);
    ledger?.record("apify-reel-scrape", `reel scrape @${handle} (${resultCount} results)`, scrapeEstimate,
      Math.max(byResults, Number.isFinite(reported) ? reported : 0));
    return (items || []) as any[];
  });

  const skip = INSTAGRAM_BRAIN_CONFIG.skipTrialReels;
  const droppedLocally = skip ? metadata.filter(isFlaggedTrialReel).length : 0;
  const trialReels: TrialReelReport = { skipRequested: skip, resultsReturned: metadata.length, droppedLocally, skippedByActor: null };
  console.log(`[trial-reels] ${JSON.stringify({ creator: handle, ...trialReels })}`);
  const chronological = metadata
    .filter((item) => item.url)
    // Belt and braces: drop anything the actor still flags as a trial reel.
    .filter((item) => !(skip && isFlaggedTrialReel(item)))
    .sort((a, b) => Date.parse(String(b.timestamp || b.createdAt || "")) - Date.parse(String(a.timestamp || a.createdAt || "")));
  const unseenAll = chronological.filter((item) => !excludeUrls.includes(item.url));
  // Recency filter: pinned, undated and older-than-window Reels never become candidates (and we don't pay
  // for their transcripts). They can still be stored as baseline rows below.
  const windowDays = options.windowDays ?? INSTAGRAM_BRAIN_CONFIG.recentWindowDays;
  const { eligible: unseen, counts } = filterRecentCandidates(
    unseenAll,
    (item) => ({ pinned: Boolean(item.isPinned || item.pinned), publishedAt: item.timestamp || item.createdAt }),
    windowDays,
    options.now,
  );
  const recency = { windowDays, ...counts };
  console.log(`[recency] ${JSON.stringify({ creator: handle, unseen: unseenAll.length, ...recency })}`);
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
      const transcriptEstimate = estimateCost("apify-transcript");
      try {
        ledger?.ensure(transcriptEstimate, `transcript ${item.url}`);
        await withApify(async (client) => {
          const run: any = await client.actor("apple_yang/instagram-transcripts-scraper").call({ videoUrl: item.url });
          const reported = Number(run?.usageTotalUsd);
          ledger?.record("apify-transcript", `transcript ${shortcode(item)}`, transcriptEstimate,
            Number.isFinite(reported) && reported > transcriptEstimate ? reported : null);
          const { items } = await client.dataset(run.defaultDatasetId).listItems();
          const transcript = (items?.[0] as any)?.text;
          const code = (items?.[0] as any)?.code || shortcode(item);
          if (code && transcript) transcripts.set(code, transcript);
        });
      } catch (error) {
        if (isBudgetExceeded(error)) {
          console.warn(`Transcript skipped for ${item.url}: spending cap reached`);
          return;
        }
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
    all: chronological.map(normalize),
    trialReels,
    recency,
  };
}
