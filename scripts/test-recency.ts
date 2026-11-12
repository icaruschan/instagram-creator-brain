import assert from "node:assert/strict";
import {
  candidateSkipReason,
  expectedViewsAtAge,
  expectedViewsPerHourAtAge,
  filterRecentCandidates,
  fitAgeCurve,
  fitVelocityCurve,
  reelAgeDays,
} from "../src/lib/instagram-brain/recency";
import { calculatePerformanceScore } from "../src/lib/instagram-brain/scoring";

const now = new Date("2026-11-12T13:30:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

// --- Recency filter ---
assert.equal(reelAgeDays(daysAgo(3), now), 3);
assert.equal(reelAgeDays("", now), null);
assert.equal(reelAgeDays("not a date", now), null);
assert.equal(reelAgeDays(new Date(now.getTime() + 3_600_000).toISOString(), now), 0); // future clock skew → 0

assert.equal(candidateSkipReason({ pinned: false, publishedAt: daysAgo(2) }, 14, now), null);
assert.equal(candidateSkipReason({ pinned: false, publishedAt: daysAgo(14) }, 14, now), null); // boundary inclusive
assert.equal(candidateSkipReason({ pinned: false, publishedAt: daysAgo(14.01) }, 14, now), "too-old");
assert.equal(candidateSkipReason({ pinned: true, publishedAt: daysAgo(1) }, 14, now), "pinned"); // pinned always skipped
assert.equal(candidateSkipReason({ pinned: true, publishedAt: daysAgo(200) }, 14, now), "pinned");
assert.equal(candidateSkipReason({ pinned: false, publishedAt: "" }, 14, now), "no-date");
assert.equal(candidateSkipReason({ pinned: false, publishedAt: daysAgo(20) }, 30, now), null); // window is configurable

const items = [
  { id: "fresh", isPinned: false, timestamp: daysAgo(1) },
  { id: "pinnedOld", isPinned: true, timestamp: daysAgo(120) }, // like Kaye's pinned "portal" Reel
  { id: "old", isPinned: false, timestamp: daysAgo(40) },
  { id: "nodate", isPinned: false, timestamp: "" },
  { id: "week", isPinned: false, timestamp: daysAgo(7) },
];
const { eligible, counts } = filterRecentCandidates(items, (i) => ({ pinned: i.isPinned, publishedAt: i.timestamp }), 14, now);
assert.deepEqual(eligible.map((i) => i.id), ["fresh", "week"]);
assert.deepEqual(counts, { eligible: 2, skippedPinned: 1, skippedTooOld: 1, skippedNoDate: 1 });

// --- Age curve ---
// Synthetic creator: views = 10,000 * age^0.5 (fast early growth, then slows).
const synthetic = [0.5, 1, 2, 4, 7, 10, 14, 21, 30, 45, 60].map((ageDays) => ({ ageDays, views: 10_000 * Math.sqrt(ageDays) }));
const curve = fitAgeCurve(synthetic)!;
assert.equal(curve.method, "age-curve");
assert.ok(Math.abs(curve.exponent - 0.5) < 1e-9, `exponent ${curve.exponent}`);
assert.ok(Math.abs(expectedViewsAtAge(curve, 4) - 20_000) < 1);

// A typical-for-its-age 1-day Reel scores ~50 on views; a 60-day Reel with 77k views also ~50.
const young = calculatePerformanceScore({ reel: { views: 10_000, likes: 500, comments: 50 }, medianViews: expectedViewsAtAge(curve, 1), medianEngagementRate: 0.055 });
const oldTypical = calculatePerformanceScore({ reel: { views: 77_460, likes: 4_000, comments: 260 }, medianViews: expectedViewsAtAge(curve, 60), medianEngagementRate: 0.055 });
assert.ok(Math.abs(young.viewLift - 50) < 0.2, `young viewLift ${young.viewLift}`);
assert.ok(Math.abs(oldTypical.viewLift - 50) < 0.2, `old viewLift ${oldTypical.viewLift}`);
// Same 10k views at 1 day vs. against a plain all-ages median (~38.7k): plain median would unfairly bury it.
const plainMedian = 10_000 * Math.sqrt(10);
assert.ok(calculatePerformanceScore({ reel: { views: 10_000, likes: 500, comments: 50 }, medianViews: plainMedian, medianEngagementRate: 0.055 }).viewLift < 10);

// Robust to one viral outlier: level uses the median residual.
const withViral = [...synthetic, { ageDays: 3, views: 5_000_000 }];
const robust = fitAgeCurve(withViral)!;
assert.ok(expectedViewsAtAge(robust, 1) < 15_000, `viral outlier dragged baseline to ${expectedViewsAtAge(robust, 1)}`);

// Too few points or no age spread → plain median (no age adjustment).
const few = fitAgeCurve([{ ageDays: 1, views: 100 }, { ageDays: 10, views: 300 }, { ageDays: 30, views: 200 }])!;
assert.equal(few.method, "plain-median");
assert.equal(few.exponent, 0);
assert.equal(Math.round(expectedViewsAtAge(few, 5)), 200);
const sameAge = fitAgeCurve([1, 2, 3, 4, 5].map((v) => ({ ageDays: 3, views: v * 100 })))!;
assert.equal(sameAge.method, "plain-median");
assert.equal(fitAgeCurve([]), null);
// Exponent clamped to [0, 1] (shrinking views with age makes no sense).
assert.equal(fitAgeCurve([1, 2, 4, 8, 16].map((ageDays) => ({ ageDays, views: 10_000 / ageDays })))!.exponent, 0);

// --- Age-fair velocity ---
// Under views = 10k*sqrt(t), true views/hour = 10k*0.5*t^-0.5 / 24.
const trueVph = (t: number) => (10_000 * 0.5 / Math.sqrt(t)) / 24;
const vCurve = fitVelocityCurve([1, 3, 10, 30].map((ageDays) => ({ ageDays, viewsPerHour: trueVph(ageDays) })), curve)!;
assert.ok(Math.abs(expectedViewsPerHourAtAge(vCurve, 2) - trueVph(2)) < 0.01);
// An old Reel growing at its age's typical pace isn't "slow", and a young Reel at its age's pace isn't "hot".
const typicalYoung = calculatePerformanceScore({ reel: { views: 10_000, likes: 500, comments: 50 }, medianViews: expectedViewsAtAge(curve, 1), medianEngagementRate: 0.055, currentViewsPerHour: trueVph(1), medianViewsPerHour: expectedViewsPerHourAtAge(vCurve, 1) });
assert.equal(typicalYoung.mode, "velocity");
assert.ok(Math.abs(typicalYoung.velocityLift! - 50) < 0.2);
assert.ok(Math.abs(typicalYoung.score - 50) < 0.5, `score ${typicalYoung.score}`);
// Needs >= 3 measured velocities.
assert.equal(fitVelocityCurve([{ ageDays: 1, viewsPerHour: 10 }, { ageDays: 2, viewsPerHour: 5 }], curve), null);
// Plain-median fallback leaves velocity unadjusted (exponent 0).
assert.equal(fitVelocityCurve([1, 3, 10].map((ageDays) => ({ ageDays, viewsPerHour: 10 * ageDays })), few)!.exponent, 0);

console.log("Recency + age-fair scoring tests passed.");
