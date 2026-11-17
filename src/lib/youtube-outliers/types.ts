export type YouTubeFormat = "Long-form" | "Short";

export interface YouTubeVideo {
  id: string;
  url: string;
  title: string;
  description: string;
  format: YouTubeFormat;
  durationSeconds: number;
  views: number;
  likes: number | null;
  comments: number | null;
  /** ISO publish time, or "" when unknown. */
  publishedAt: string;
  /** True when publishedAt came from a relative label ("3 weeks ago"), so the age is approximate. */
  approximateDate: boolean;
  channelName: string;
  channelUrl: string;
  transcript: string;
}

export interface OutlierScore {
  videoId: string;
  format: YouTubeFormat;
  ageDays: number | null;
  views: number;
  /** Views her typical same-format video had at this age. */
  expectedViews: number | null;
  /** views / expectedViews. */
  multiple: number | null;
  /** 50 = normal, 75 = 2x, 100 = 4x+ (same lift scale as the Reel scores). */
  outlierScore: number | null;
  baselineMethod: "age-curve" | "plain-median" | "insufficient";
  baselinePeers: number;
  growthExponent: number;
  inWindow: boolean;
  isOutlier: boolean;
  /** Why it is not an outlier (or "" when it is). */
  reason: string;
}

export interface ScoredVideo extends YouTubeVideo {
  score: OutlierScore;
}
