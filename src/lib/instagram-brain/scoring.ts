import { INSTAGRAM_BRAIN_CONFIG } from "./config";
import type {
  PerformanceScoreBreakdown,
  PerformanceScoreInput,
  PriorityScoreBreakdown,
  ReelDecisionEvidence,
  ReelMetrics,
} from "./types";

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function median(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const midpoint = Math.floor(clean.length / 2);
  return clean.length % 2 === 1
    ? clean[midpoint]
    : (clean[midpoint - 1] + clean[midpoint]) / 2;
}

export function engagementRate(metrics: ReelMetrics): number {
  if (!metrics.views || metrics.views <= 0) return 0;
  return (Math.max(0, metrics.likes) + Math.max(0, metrics.comments)) / metrics.views;
}

/**
 * Maps a creator-relative ratio to a stable 0-100 score.
 * 1x baseline = 50, 2x = 75, 4x+ = 100, 0.5x = 25.
 */
export function relativeLiftScore(value: number, baseline: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(baseline) || value <= 0 || baseline <= 0) {
    return 0;
  }
  return clamp(50 + 25 * Math.log2(value / baseline));
}

export function calculatePerformanceScore(
  input: PerformanceScoreInput,
): PerformanceScoreBreakdown {
  const viewLift = relativeLiftScore(input.reel.views, input.medianViews);
  const engagementLift = relativeLiftScore(
    engagementRate(input.reel),
    input.medianEngagementRate,
  );
  const hasVelocity =
    input.currentViewsPerHour != null &&
    input.medianViewsPerHour != null &&
    input.currentViewsPerHour >= 0 &&
    input.medianViewsPerHour > 0;

  if (hasVelocity) {
    const velocityLift = relativeLiftScore(
      input.currentViewsPerHour!,
      input.medianViewsPerHour!,
    );
    const weights = INSTAGRAM_BRAIN_CONFIG.performanceWeights.withVelocity;
    return {
      viewLift: round1(viewLift),
      engagementLift: round1(engagementLift),
      velocityLift: round1(velocityLift),
      score: round1(
        viewLift * weights.views +
          engagementLift * weights.engagement +
          velocityLift * weights.velocity,
      ),
      mode: "velocity",
    };
  }

  const weights = INSTAGRAM_BRAIN_CONFIG.performanceWeights.withoutVelocity;
  return {
    viewLift: round1(viewLift),
    engagementLift: round1(engagementLift),
    velocityLift: null,
    score: round1(viewLift * weights.views + engagementLift * weights.engagement),
    mode: "static",
  };
}

export function calculatePriorityScore(
  evidence: ReelDecisionEvidence,
): PriorityScoreBreakdown {
  const sourceValue = clamp(
    Math.max(evidence.visualPatternValue, evidence.workflowValue) * 100,
  );
  const weights = INSTAGRAM_BRAIN_CONFIG.priorityWeights;
  const priorityScore =
    clamp(evidence.performanceScore) * weights.performance +
    clamp(evidence.strategicFitScore) * weights.strategicFit +
    sourceValue * weights.sourceValue;

  return {
    ...evidence,
    sourceValue: round1(sourceValue),
    priorityScore: round1(priorityScore),
  };
}

export function eligibleDeliveryProfiles(
  visualPatternValue: number,
  workflowValue: number,
  threshold = 0.6,
): Array<"Visual-first" | "Operator-first"> {
  const profiles: Array<"Visual-first" | "Operator-first"> = [];
  if (visualPatternValue >= threshold) profiles.push("Visual-first");
  if (workflowValue >= threshold) profiles.push("Operator-first");
  return profiles;
}
