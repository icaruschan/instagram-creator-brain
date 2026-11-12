/**
 * Recency filter + age-fair baseline for the Instagram Creator Brain scan.
 *
 * Why: a creator's pinned Reels sit at the top of the profile and are usually old, high-view clips.
 * Comparing them (or any old Reel) with a young Reel is unfair both ways: old Reels have had weeks to
 * pile up views, and old Reels gain views slowly, so "views per hour" makes young Reels look great.
 *
 * 1. Candidate filter: only unpinned Reels with a publish date inside the recent window
 *    (IG_BRAIN_RECENT_WINDOW_DAYS, default 14) can become new candidates. Pinned, undated and too-old
 *    Reels are skipped and counted.
 *
 * 2. Age-fair baseline ("age curve"). Using the creator's own unpinned, dated Reels from the same scrape
 *    (all measured at the same moment), fit how views grow with age:
 *        log(views) = a + b * log(ageDays)        (b = growth exponent, clamped to [0, 1])
 *    b is a robust (Theil-Sen: median of pairwise slopes) fit when there are >= 5 dated Reels with a real
 *    spread of ages;
 *    otherwise b = 0 (no age adjustment, i.e. the old plain-median behaviour). The level `a` is the
 *    MEDIAN of log(views) - b*log(age), so one viral Reel can't drag the baseline.
 *    Expected views at age t = exp(a) * t^b. A candidate's View Lift compares its views with the views
 *    her typical Reel had at the SAME age (b = 0 → plain median).
 *
 * 3. Age-fair velocity. Views/hour since the last snapshot is compared with the typical views/hour at
 *    the same age: growth curve slope says velocity scales like t^(b-1). The level is the median of
 *    log(vph) - (b-1)*log(age) over Reels with a measured velocity (needs >= 3, as before).
 *    If there is no age curve (b = 0 fallback) velocity is compared with the plain median, as before.
 */

export const MIN_AGE_DAYS = 0.25; // 6 hours: avoids log(0) and wild numbers for brand-new Reels
const MIN_POINTS_FOR_SLOPE = 5;
const MIN_LOG_AGE_SPREAD = 0.3; // stdev of ln(age); below this the slope is noise
const MIN_POINTS_FOR_VELOCITY = 3;

export type CandidateSkipReason = "pinned" | "no-date" | "too-old";

export interface RecencyCounts {
  eligible: number;
  skippedPinned: number;
  skippedTooOld: number;
  skippedNoDate: number;
}

export function parsePublishedAt(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const time = typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : Date.parse(String(value));
  return Number.isFinite(time) && time > 0 ? new Date(time) : null;
}

/** Age in days (never negative). Null when the date is missing/unparseable. */
export function reelAgeDays(publishedAt: unknown, now: Date = new Date()): number | null {
  const date = parsePublishedAt(publishedAt);
  if (!date) return null;
  return Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
}

/** Why a Reel can't be a new candidate, or null if it can. Pinned wins over the date checks. */
export function candidateSkipReason(
  reel: { pinned: boolean; publishedAt: unknown },
  windowDays: number,
  now: Date = new Date(),
): CandidateSkipReason | null {
  if (reel.pinned) return "pinned";
  const age = reelAgeDays(reel.publishedAt, now);
  if (age == null) return "no-date";
  if (age > windowDays) return "too-old";
  return null;
}

export function filterRecentCandidates<T>(
  items: T[],
  read: (item: T) => { pinned: boolean; publishedAt: unknown },
  windowDays: number,
  now: Date = new Date(),
): { eligible: T[]; counts: RecencyCounts } {
  const counts: RecencyCounts = { eligible: 0, skippedPinned: 0, skippedTooOld: 0, skippedNoDate: 0 };
  const eligible: T[] = [];
  for (const item of items) {
    const reason = candidateSkipReason(read(item), windowDays, now);
    if (reason === "pinned") counts.skippedPinned++;
    else if (reason === "no-date") counts.skippedNoDate++;
    else if (reason === "too-old") counts.skippedTooOld++;
    else eligible.push(item);
  }
  counts.eligible = eligible.length;
  return { eligible, counts };
}

function medianOf(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!sorted.length) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface AgeCurve {
  /** ln of expected views at 1 day old. */
  logLevel: number;
  /** Growth exponent b (0 = no age adjustment). */
  exponent: number;
  /** Reels used for the fit. */
  points: number;
  method: "age-curve" | "plain-median";
}

/** Fit the creator's views-vs-age curve. Returns null when there is no usable data at all. */
export function fitAgeCurve(points: Array<{ views: number; ageDays: number }>): AgeCurve | null {
  const clean = points
    .filter((p) => Number.isFinite(p.views) && p.views > 0 && Number.isFinite(p.ageDays) && p.ageDays >= 0)
    .map((p) => ({ x: Math.log(Math.max(MIN_AGE_DAYS, p.ageDays)), y: Math.log(p.views) }));
  if (!clean.length) return null;
  let exponent = 0;
  if (clean.length >= MIN_POINTS_FOR_SLOPE) {
    const mx = clean.reduce((s, p) => s + p.x, 0) / clean.length;
    const spread = Math.sqrt(clean.reduce((s, p) => s + (p.x - mx) ** 2, 0) / clean.length);
    if (spread >= MIN_LOG_AGE_SPREAD) {
      // Theil-Sen slope: median of all pairwise slopes, so one viral (or flopped) Reel can't tilt the curve.
      const slopes: number[] = [];
      for (let i = 0; i < clean.length; i++) {
        for (let j = i + 1; j < clean.length; j++) {
          const dx = clean[j].x - clean[i].x;
          if (Math.abs(dx) > 1e-9) slopes.push((clean[j].y - clean[i].y) / dx);
        }
      }
      const slope = medianOf(slopes);
      if (Number.isFinite(slope)) exponent = Math.min(1, Math.max(0, slope));
    }
  }
  const logLevel = medianOf(clean.map((p) => p.y - exponent * p.x));
  return { logLevel, exponent, points: clean.length, method: exponent > 0 ? "age-curve" : "plain-median" };
}

/** Typical views for this creator's Reel at the given age. */
export function expectedViewsAtAge(curve: AgeCurve, ageDays: number): number {
  return Math.exp(curve.logLevel + curve.exponent * Math.log(Math.max(MIN_AGE_DAYS, ageDays)));
}

export interface VelocityCurve {
  logLevel: number;
  exponent: number; // b - 1
  points: number;
}

/** Fit typical views/hour vs age, reusing the growth exponent. Null with < 3 measured velocities. */
export function fitVelocityCurve(
  points: Array<{ viewsPerHour: number; ageDays: number }>,
  curve: AgeCurve,
): VelocityCurve | null {
  // With no age curve (plain median), keep velocity unadjusted too (old behaviour) rather than guess a shape.
  const exponent = curve.method === "age-curve" ? curve.exponent - 1 : 0;
  const clean = points.filter((p) => Number.isFinite(p.viewsPerHour) && p.viewsPerHour > 0 && Number.isFinite(p.ageDays));
  if (clean.length < MIN_POINTS_FOR_VELOCITY) return null;
  const logLevel = medianOf(clean.map((p) => Math.log(p.viewsPerHour) - exponent * Math.log(Math.max(MIN_AGE_DAYS, p.ageDays))));
  return { logLevel, exponent, points: clean.length };
}

export function expectedViewsPerHourAtAge(curve: VelocityCurve, ageDays: number): number {
  return Math.exp(curve.logLevel + curve.exponent * Math.log(Math.max(MIN_AGE_DAYS, ageDays)));
}
