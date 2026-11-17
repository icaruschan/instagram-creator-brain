/**
 * YouTube Outlier + Reel idea system (Yuna). Approved by Fortune 2026-11-17 2:06 PM WAT.
 * Finds YouTube videos (long-form and Shorts, scored separately) doing far better than normal for their
 * own channel at the same age, and turns the best ones into Instagram Reel ideas in Idea Lab.
 * Manual-only: no schedule is declared in code.
 */

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export type YouTubeSourceKind = "apify" | "data-api";

function sourceKind(): YouTubeSourceKind {
  const raw = String(process.env.YT_OUTLIERS_SOURCE || "").trim().toLowerCase();
  if (!raw || raw === "apify") return "apify";
  if (raw === "data-api" || raw === "youtube-data-api") return "data-api";
  throw new Error(`YT_OUTLIERS_SOURCE must be "apify" or "data-api" (got "${raw}")`);
}

/**
 * Channels to start with until Creator Bench carries a "YouTube Channel URL" (see the migration).
 * Keyed by the Creator Bench page id. Kaye only, per Fortune (Nov 12 + Nov 17).
 * Verified 2026-11-17: channel "kaye.creatives", handle @Kaye.creates, ~101k subscribers; titles match her IG
 * (Fable 5.2 animated shorts, How to Train Your Dragon, Spider-Verse Gwen).
 */
export const KNOWN_YOUTUBE_CHANNELS: Record<string, { name: string; channelUrl: string; channelId: string }> = {
  "3e34a5db-f371-8184-a2e9-e2121eaa1e19": {
    name: "Kaye Creatives",
    channelUrl: "https://www.youtube.com/@Kaye.creates",
    channelId: "UCDHy_qf3CJ8azlfbJKEGIHw",
  },
};

export const YOUTUBE_OUTLIER_CONFIG = {
  source: sourceKind(),
  /** Newest long-form videos pulled per channel per scan (baseline pool + candidates). */
  longFormPerChannel: envNumber("YT_OUTLIERS_LONG_PER_CHANNEL", 30),
  /** Newest Shorts pulled per channel per scan. */
  shortsPerChannel: envNumber("YT_OUTLIERS_SHORTS_PER_CHANNEL", 30),
  /** Channels per scan run (oldest "YouTube Last Checked" first). */
  channelsPerScan: envNumber("YT_OUTLIERS_CHANNELS_PER_SCAN", 5),
  /** Only videos at most this old can be flagged as outliers (older ones still count for the baseline). */
  candidateWindowDays: {
    long: envNumber("YT_OUTLIERS_LONG_WINDOW_DAYS", 60),
    short: envNumber("YT_OUTLIERS_SHORT_WINDOW_DAYS", 30),
  },
  /** Videos younger than this are too early to judge (YouTube views arrive in bursts in the first day). */
  minAgeDays: envNumber("YT_OUTLIERS_MIN_AGE_DAYS", 1),
  /** Views / expected-at-same-age needed to count as an outlier. 2 = twice her normal. */
  minMultiple: envNumber("YT_OUTLIERS_MIN_MULTIPLE", 2),
  /** Ignore tiny absolute numbers (a 300-view Short at 3x is noise). */
  minViews: { long: envNumber("YT_OUTLIERS_MIN_VIEWS_LONG", 5_000), short: envNumber("YT_OUTLIERS_MIN_VIEWS_SHORT", 2_000) },
  /** Same-format peers needed for a baseline; fewer → the video is "insufficient baseline" and never flagged. */
  minPeers: envNumber("YT_OUTLIERS_MIN_PEERS", 5),
  /** A Short is <= this many seconds when the source can't tell us the format directly. */
  shortMaxSeconds: envNumber("YT_OUTLIERS_SHORT_MAX_SECONDS", 180),
  /** New outliers per scan that get Reel ideas written automatically (0 = only via the Notion action). */
  autoIdeasPerScan: envNumber("YT_OUTLIERS_AUTO_IDEAS_PER_SCAN", 3),
  /** Reel ideas written per outlier video. */
  ideasPerVideo: envNumber("YT_OUTLIERS_IDEAS_PER_VIDEO", 3),
  /** Transcript characters sent to MiniMax per video (long-form transcripts are long). */
  transcriptCharBudget: envNumber("YT_OUTLIERS_TRANSCRIPT_CHARS", 14_000),
} as const;

/**
 * Cost estimates (USD). Apify streamers/youtube-scraper is pay-per-event: $0.004 per video written to the
 * dataset on the Free plan (checked 2026-11-17 on the actor's pricing). Existing subtitles cost nothing extra;
 * the speech-to-text fallback ($0.048/min) is never requested. YouTube Data API v3 is free within the daily quota.
 */
export const YOUTUBE_COST_ESTIMATES_USD = {
  apifyYouTubeVideo: envNumber("YT_OUTLIERS_COST_APIFY_VIDEO", 0.004),
  youtubeDataApiCall: 0,
} as const;
