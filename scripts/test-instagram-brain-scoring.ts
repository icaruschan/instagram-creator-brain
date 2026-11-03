import assert from "node:assert/strict";
import {
  calculatePerformanceScore,
  calculatePriorityScore,
  eligibleDeliveryProfiles,
  engagementRate,
  relativeLiftScore,
} from "../src/lib/instagram-brain/scoring";
import { summarizeOwnPostResults } from "../src/lib/instagram-brain/learning";

assert.equal(engagementRate({ views: 1000, likes: 80, comments: 20 }), 0.1);
assert.equal(relativeLiftScore(100, 100), 50);
assert.equal(relativeLiftScore(200, 100), 75);
assert.equal(relativeLiftScore(400, 100), 100);

const staticScore = calculatePerformanceScore({
  reel: { views: 72_000, likes: 1_100, comments: 613 },
  medianViews: 25_150,
  medianEngagementRate: 0.0191,
});
assert.equal(staticScore.mode, "static");
assert.ok(staticScore.score > 70, `expected strong static score, got ${staticScore.score}`);

const velocityScore = calculatePerformanceScore({
  reel: { views: 42_200, likes: 3, comments: 56 },
  medianViews: 8_500,
  medianEngagementRate: 0.0099,
  currentViewsPerHour: 880,
  medianViewsPerHour: 110,
});
assert.equal(velocityScore.mode, "velocity");
assert.ok(velocityScore.velocityLift != null && velocityScore.velocityLift >= 99);
const stalledVelocity = calculatePerformanceScore({
  reel: { views: 42_200, likes: 3, comments: 56 },
  medianViews: 8_500,
  medianEngagementRate: 0.0099,
  currentViewsPerHour: 0,
  medianViewsPerHour: 110,
});
assert.equal(stalledVelocity.mode, "velocity");
assert.equal(stalledVelocity.velocityLift, 0);

const priority = calculatePriorityScore({
  performanceScore: 96.3,
  strategicFitScore: 99,
  visualPatternValue: 0.89,
  workflowValue: 0.16,
});
assert.equal(priority.sourceValue, 89);
assert.equal(priority.priorityScore, 95.3);

assert.deepEqual(eligibleDeliveryProfiles(0.89, 0.16), ["Visual-first"]);
assert.deepEqual(eligibleDeliveryProfiles(0.84, 0.89), ["Visual-first", "Operator-first"]);

const ownResults = [100, 100, 100, 100, 300].map((views, index) => ({
  title: `Post ${index + 1}`, account: "Alisha", window: "7d", views,
  saves: 0, shares: 0, completionRate: null,
}));
assert.match(summarizeOwnPostResults(ownResults.slice(0, 4)), /Insufficient/);
assert.match(summarizeOwnPostResults(ownResults), /Post 5 \(3\.0x\)/);

console.log("Instagram Creator Brain scoring tests passed.");
