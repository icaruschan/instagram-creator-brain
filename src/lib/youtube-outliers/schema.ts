/**
 * Notion schema for the YouTube outlier system. Used by scripts/migrate-youtube-outliers.ts (creates it)
 * and by notion.ts (writes it). Property names are the contract; keep both in sync.
 */
export const YT_DB_TITLE = "YouTube Outliers";

export const YT_STATUS = ["New", "Outlier", "Ideas Ready", "Watchlist", "Ignored", "Failed"] as const;
export const YT_ACTIONS = ["None", "Generate Reel Ideas", "Save for Later", "Ignore"] as const;
export const ACTION_STATES = ["Idle", "Queued", "Processing", "Complete", "Failed"] as const;
export const YT_FORMATS = ["Long-form", "Short"] as const;
export const SOURCE_TYPES = ["Instagram Reel", "YouTube"] as const;

const select = (names: readonly string[]) => ({ select: { options: names.map((name) => ({ name })) } });
const number = (format = "number") => ({ number: { format } });
const text = { rich_text: {} };

/** Properties of the new "YouTube Outliers" database (title property: "Video"). Creator relation added separately. */
export const YT_OUTLIER_PROPERTIES: Record<string, any> = {
  Video: { title: {} },
  "Video URL": { url: {} },
  "Video ID": text,
  Channel: text,
  Format: select(YT_FORMATS),
  Published: { date: {} },
  "Approx Date": { checkbox: {} },
  "Age Days": number(),
  Views: number("number_with_commas"),
  Likes: number("number_with_commas"),
  Comments: number("number_with_commas"),
  "Duration Seconds": number(),
  "Expected Views": number("number_with_commas"),
  "Outlier Multiple": number(),
  "Outlier Score": number(),
  "Baseline Method": select(["age-curve", "plain-median", "insufficient"]),
  "Baseline Peers": number(),
  "Is Outlier": { checkbox: {} },
  "Why It Popped": text,
  Description: text,
  Transcript: text,
  Status: select(YT_STATUS),
  "Action Requested": select(YT_ACTIONS),
  "Action State": select(ACTION_STATES),
  "Last Error": text,
  "Last Scanned": { date: {} },
};

/** Added to Creator Bench. */
export const CREATOR_BENCH_ADDITIONS: Record<string, any> = {
  "YouTube Channel URL": { url: {} },
  "YouTube Last Checked": { date: {} },
  "YouTube Median Views (Long)": number("number_with_commas"),
  "YouTube Median Views (Shorts)": number("number_with_commas"),
};

/** Added to Idea Lab ("Source YouTube Video" relation is created by the migration with the new DB id). */
export const IDEA_LAB_ADDITIONS: Record<string, any> = {
  "Source Type": select(SOURCE_TYPES),
};
