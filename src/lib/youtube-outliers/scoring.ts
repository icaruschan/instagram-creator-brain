import { expectedViewsAtAge, fitAgeCurve, reelAgeDays } from "../instagram-brain/recency";
import { YOUTUBE_OUTLIER_CONFIG } from "./config";
import type { OutlierScore, ScoredVideo, YouTubeFormat, YouTubeVideo } from "./types";

export interface OutlierOptions {
  now?: Date;
  minMultiple?: number;
  minPeers?: number;
  minAgeDays?: number;
  windowDays?: Partial<Record<YouTubeFormat, number>>;
  minViews?: Partial<Record<YouTubeFormat, number>>;
}

const lift = (multiple: number) => Math.min(100, Math.max(0, 50 + 25 * Math.log2(multiple)));
const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * Score every video against the SAME channel's SAME-format videos (Shorts vs Shorts, long-form vs long-form).
 *
 * Baseline (age-fair, leave-one-out): fit the channel's views-vs-age curve
 *   log(views) = a + b·log(ageDays)   (Theil-Sen slope, b clamped to [0,1], level = median → robust to viral hits)
 * on the other same-format videos (the video itself is left out so a hit can't raise its own bar), then
 *   expected = exp(a)·age^b,  multiple = views / expected,  outlierScore = 50 + 25·log2(multiple) (0-100).
 * With fewer than 5 dated peers, or no real spread of ages, b = 0 (plain median of peers).
 *
 * Outlier = multiple >= minMultiple (default 2x), age between minAgeDays and the format's window
 * (default 60 days long-form, 30 days Shorts), views >= the format's floor, and enough peers.
 */
export function scoreOutliers(videos: YouTubeVideo[], options: OutlierOptions = {}): ScoredVideo[] {
  const now = options.now || new Date();
  const minMultiple = options.minMultiple ?? YOUTUBE_OUTLIER_CONFIG.minMultiple;
  const minPeers = options.minPeers ?? YOUTUBE_OUTLIER_CONFIG.minPeers;
  const minAge = options.minAgeDays ?? YOUTUBE_OUTLIER_CONFIG.minAgeDays;
  const windowDays = { Short: YOUTUBE_OUTLIER_CONFIG.candidateWindowDays.short, "Long-form": YOUTUBE_OUTLIER_CONFIG.candidateWindowDays.long, ...options.windowDays };
  const minViews = { Short: YOUTUBE_OUTLIER_CONFIG.minViews.short, "Long-form": YOUTUBE_OUTLIER_CONFIG.minViews.long, ...options.minViews };

  const unique = dedupe(videos);
  const aged = unique.map((video) => ({ video, ageDays: reelAgeDays(video.publishedAt, now) }));

  return aged.map(({ video, ageDays }) => {
    const peers = aged
      .filter((other) => other.video.id !== video.id && other.video.format === video.format && other.ageDays != null && other.video.views > 0)
      .map((other) => ({ views: other.video.views, ageDays: other.ageDays as number }));
    const base: OutlierScore = {
      videoId: video.id,
      format: video.format,
      ageDays: ageDays == null ? null : round(ageDays, 1),
      views: video.views,
      expectedViews: null,
      multiple: null,
      outlierScore: null,
      baselineMethod: "insufficient",
      baselinePeers: peers.length,
      growthExponent: 0,
      inWindow: ageDays != null && ageDays >= minAge && ageDays <= windowDays[video.format],
      isOutlier: false,
      reason: "",
    };
    if (ageDays == null) return { ...video, score: { ...base, reason: "no publish date" } };
    if (peers.length < minPeers) return { ...video, score: { ...base, reason: `only ${peers.length} same-format peers (need ${minPeers})` } };
    const curve = fitAgeCurve(peers);
    if (!curve) return { ...video, score: { ...base, reason: "no usable peer data" } };
    const expected = expectedViewsAtAge(curve, ageDays);
    const multiple = video.views > 0 && expected > 0 ? video.views / expected : 0;
    const score: OutlierScore = {
      ...base,
      expectedViews: Math.round(expected),
      multiple: round(multiple),
      outlierScore: multiple > 0 ? round(lift(multiple), 1) : 0,
      baselineMethod: curve.method,
      growthExponent: round(curve.exponent, 3),
    };
    const reasons: string[] = [];
    if (multiple < minMultiple) reasons.push(`${round(multiple)}x < ${minMultiple}x`);
    if (ageDays < minAge) reasons.push(`too new (${round(ageDays, 1)}d < ${minAge}d)`);
    if (ageDays > windowDays[video.format]) reasons.push(`older than ${windowDays[video.format]}d window`);
    if (video.views < minViews[video.format]) reasons.push(`views ${video.views} < ${minViews[video.format]} floor`);
    return { ...video, score: { ...score, isOutlier: reasons.length === 0, reason: reasons.join("; ") } };
  });
}

/** Outliers first by multiple (highest first). */
export function rankOutliers(scored: ScoredVideo[]): ScoredVideo[] {
  return scored
    .filter((video) => video.score.isOutlier)
    .sort((a, b) => (b.score.multiple ?? 0) - (a.score.multiple ?? 0));
}

/** Per-format channel summary for logs and the Creator Bench. */
export function channelSummary(scored: ScoredVideo[]) {
  const out: Record<YouTubeFormat, { videos: number; medianViews: number; outliers: number; growthExponent: number }> = {
    "Long-form": { videos: 0, medianViews: 0, outliers: 0, growthExponent: 0 },
    Short: { videos: 0, medianViews: 0, outliers: 0, growthExponent: 0 },
  };
  for (const format of ["Long-form", "Short"] as YouTubeFormat[]) {
    const rows = scored.filter((video) => video.format === format);
    const views = rows.map((video) => video.views).sort((x, y) => x - y);
    const mid = Math.floor(views.length / 2);
    out[format] = {
      videos: rows.length,
      medianViews: views.length ? (views.length % 2 ? views[mid] : Math.round((views[mid - 1] + views[mid]) / 2)) : 0,
      outliers: rows.filter((video) => video.score.isOutlier).length,
      growthExponent: rows.find((video) => video.score.baselineMethod !== "insufficient")?.score.growthExponent ?? 0,
    };
  }
  return out;
}

function dedupe(videos: YouTubeVideo[]): YouTubeVideo[] {
  const seen = new Map<string, YouTubeVideo>();
  for (const video of videos) {
    if (!video.id) continue;
    const existing = seen.get(video.id);
    // Same video from two tabs: keep the one with the most views (latest read) and a real date.
    if (!existing || (video.views > existing.views) || (!existing.publishedAt && video.publishedAt)) seen.set(video.id, video);
  }
  return [...seen.values()];
}
