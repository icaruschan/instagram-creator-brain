export const INSTAGRAM_BRAIN_PILLARS = [
  "Creative AI Video",
  "AI Creative Workflow",
  "AI Tools & Model Experiments",
  "Creator AI Systems & Automation",
  "AI & Creative Commentary",
] as const;

export type InstagramBrainPillar = (typeof INSTAGRAM_BRAIN_PILLARS)[number];

export const DELIVERY_PROFILES = [
  "Visual-first",
  "Operator-first",
  "Hybrid",
] as const;

export type DeliveryProfile = (typeof DELIVERY_PROFILES)[number];

export const SCRIPT_ENGINES = ["Kallaway", "RPN", "Hybrid"] as const;
export type ScriptEngine = (typeof SCRIPT_ENGINES)[number];

export const INSTAGRAM_BRAIN_CONFIG = {
  jevModel: process.env.IG_BRAIN_JEV_MODEL || "typesafe/jev-1.13",
  minimaxModel: process.env.IG_BRAIN_MINIMAX_MODEL || "minimax/minimax-m3",
  geminiModel: process.env.IG_BRAIN_GEMINI_MODEL || "gemini-3.8-flash",
  reelsPerCreator: Number(process.env.IG_BRAIN_REELS_PER_CREATOR || 3),
  creatorsPerScan: Number(process.env.IG_BRAIN_CREATORS_PER_SCAN || 5),
  deepAnalysisLimitPerRun: Number(process.env.IG_BRAIN_DEEP_ANALYSIS_LIMIT || 5),
  priorityWeights: {
    performance: 0.45,
    strategicFit: 0.3,
    sourceValue: 0.25,
  },
  performanceWeights: {
    withVelocity: { views: 0.55, engagement: 0.25, velocity: 0.2 },
    withoutVelocity: { views: 0.7, engagement: 0.3 },
  },
} as const;
