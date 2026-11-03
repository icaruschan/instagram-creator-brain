import type { DeliveryProfile, InstagramBrainPillar, ScriptEngine } from "./config";

export interface InstagramCreator {
  pageId: string;
  name: string;
  handle: string;
  profileUrl: string;
  status: "Active" | "Paused" | "Archived";
  primaryPillar: InstagramBrainPillar;
  pillars: InstagramBrainPillar[];
  lastChecked: string | null;
  followerCount: number;
  baselineMedianViews: number;
  baselineEngagementRate: number;
}

export interface ReelMetrics {
  views: number;
  likes: number;
  comments: number;
}

export interface ReelSnapshot extends ReelMetrics {
  capturedAt: string;
  publishedAt: string;
}

export interface PerformanceScoreInput {
  reel: ReelMetrics;
  medianViews: number;
  medianEngagementRate: number;
  currentViewsPerHour?: number | null;
  medianViewsPerHour?: number | null;
}

export interface PerformanceScoreBreakdown {
  viewLift: number;
  engagementLift: number;
  velocityLift: number | null;
  score: number;
  mode: "static" | "velocity";
}

export interface ReelDecisionEvidence {
  strategicFitScore: number;
  visualPatternValue: number;
  workflowValue: number;
  performanceScore: number;
}

export interface PriorityScoreBreakdown extends ReelDecisionEvidence {
  sourceValue: number;
  priorityScore: number;
}

export interface AnglePreview {
  title: string;
  summary: string;
  spokenHook: string;
  textHook: string;
  visualHook: string;
  audioHook: string;
  threeBeatOutline: string[];
  whyItWorks: string;
  whatNotToCopy: string;
  deliveryProfile: DeliveryProfile;
  scriptEngine: ScriptEngine;
}

