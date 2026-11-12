export const INSTAGRAM_BRAIN_PILLARS = [
  "Creative AI Video",
  "AI Creative Workflow",
  "AI Tools & Model Experiments",
  "Creator AI Systems & Automation",
  "AI & Creative Commentary",
] as const;

export type InstagramBrainPillar = (typeof INSTAGRAM_BRAIN_PILLARS)[number];

/**
 * Yuna's three content pillars (Fortune-approved 2026-11-12). Notion select "Pillar".
 * The older 5-way taxonomy above is still used for Creator Bench tagging.
 */
export const YUNA_PILLARS = ["Visual Storyteller", "Creative Operator", "Storytelling"] as const;
export type YunaPillar = (typeof YUNA_PILLARS)[number];

/** Content types under the pillars. Notion select "Content Type". */
export const CONTENT_TYPES = [
  "Creative AI Video",
  "AI Creative Workflow",
  "Tool/Model Test",
  "Creator Automation",
  "Commentary",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const PILLAR_DEFINITIONS: Record<YunaPillar, string> = {
  "Visual Storyteller": "AI Visual Storyteller: cinematic scenes, visual worlds, AI characters, VFX, creative experiments (what AI can make look amazing).",
  "Creative Operator": "AI Creative Operator: workflows, tool breakdowns, prompts, systems, \"how I made this\".",
  Storytelling: "Storytelling: short films, animated films, commercials, viral video concepts, narrative pieces (the story leads, visuals serve it).",
};

export const CONTENT_TYPE_DEFINITIONS: Record<ContentType, string> = {
  "Creative AI Video": "A finished AI-made visual/video piece whose payoff is the visual itself.",
  "AI Creative Workflow": "Shows the process, prompts, or pipeline used to make AI creative work.",
  "Tool/Model Test": "Tests, compares, or reviews an AI tool or model.",
  "Creator Automation": "AI systems or automations that help a creator produce, post, or scale.",
  Commentary: "Opinion, news reaction, or discussion about AI and creativity.",
};

export const DELIVERY_PROFILES = [
  "Visual-first",
  "Operator-first",
  "Hybrid",
] as const;

export type DeliveryProfile = (typeof DELIVERY_PROFILES)[number];

export const SCRIPT_ENGINES = ["Kallaway", "RPN", "Hybrid"] as const;
export type ScriptEngine = (typeof SCRIPT_ENGINES)[number];

export type AccountName = "Alisha" | "Yuna";

/**
 * Account targeting. Alisha is on hold (2026-11-12): her config is kept but disabled.
 * Re-enable by setting IG_BRAIN_ACTIVE_ACCOUNTS=Yuna,Alisha (or flipping `enabled`).
 */
export const ACCOUNTS: Record<AccountName, { enabled: boolean; persona: string; note?: string }> = {
  Yuna: {
    enabled: true,
    persona: "Yuna: an AI-generated creator in the AI Creative niche. Warm, relatable, a bit flawed but confident; she invites people into her process rather than lecturing.",
  },
  Alisha: {
    enabled: false,
    persona: "Alisha: confident, outspoken AI creator.",
    note: "On hold since 2026-11-12 (Fortune). Kept for later; not targeted.",
  },
};

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export type VideoProvider = "openrouter" | "gemini";

function videoProvider(name: string, fallback: VideoProvider): VideoProvider;
function videoProvider(name: string, fallback: "none"): VideoProvider | "none";
function videoProvider(name: string, fallback: VideoProvider | "none"): VideoProvider | "none" {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "openrouter" || raw === "gemini") return raw;
  if (fallback === "none" && (raw === "none" || raw === "off")) return "none";
  throw new Error(`${name} must be "openrouter" or "gemini"${fallback === "none" ? ' or "none"' : ""} (got "${raw}")`);
}

/** Optional spending cap: a positive number, otherwise unlimited (Infinity). */
export function parseCap(raw: string | undefined | null): number {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text || ["off", "none", "unlimited", "false", "no"].includes(text)) return Infinity;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : Infinity;
}

function envCap(name: string): number {
  return parseCap(process.env[name]);
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
}

export function activeAccounts(): AccountName[] {
  const raw = process.env.IG_BRAIN_ACTIVE_ACCOUNTS?.trim();
  if (raw) {
    return raw.split(",").map((value) => value.trim()).filter((value): value is AccountName => value === "Yuna" || value === "Alisha");
  }
  return (Object.keys(ACCOUNTS) as AccountName[]).filter((name) => ACCOUNTS[name].enabled);
}

/**
 * Resolve which account a picked angle is for.
 * - Unassigned → the single active account (Yuna) when only one is active.
 * - A disabled account (Alisha) or "Both" while Alisha is off → error with a clear message.
 */
export function resolveTargetAccount(
  requested: "Unassigned" | "Alisha" | "Yuna" | "Both",
  active: AccountName[] = activeAccounts(),
): "Alisha" | "Yuna" | "Both" {
  if (active.length === 0) throw new Error("No Instagram account is active (IG_BRAIN_ACTIVE_ACCOUNTS is empty)");
  if (requested === "Unassigned") {
    if (active.length === 1) return active[0];
    throw new Error("Choose Yuna, Alisha, or Both before generating a script");
  }
  if (requested === "Both") {
    const missing = (["Alisha", "Yuna"] as AccountName[]).filter((name) => !active.includes(name));
    if (missing.length) throw new Error(`"Both" is not available: ${missing.join(", ")} is on hold. Set Account to ${active.join(" or ")}.`);
    return "Both";
  }
  if (!active.includes(requested)) throw new Error(`${requested} is on hold. Set Account to ${active.join(" or ")}.`);
  return requested;
}

/**
 * Estimated USD cost per paid call, used for the spending cap before a call is made.
 * After the call, the provider-reported cost replaces the estimate in the log when available
 * (Jev usage.cost, OpenRouter usage.cost for MiniMax, Apify run usageTotalUsd if higher).
 * Estimates are deliberately on the high side (see creator-brain-guardrails-2026-11-12.md for sources).
 */
export const COST_ESTIMATES_USD = {
  /** apify/instagram-reel-scraper: $2.60 / 1,000 results on the Free plan (per result). */
  apifyReelResult: envNumber("IG_BRAIN_COST_APIFY_REEL_RESULT", 0.0026),
  /** apple_yang/instagram-transcripts-scraper: $0.001/result + audio-to-text + enhanced crawl (per reel, padded). */
  apifyTranscript: envNumber("IG_BRAIN_COST_APIFY_TRANSCRIPT", 0.02),
  /** typesafe/jev-1.13 decision call via OpenRouter. Measured ~$0.00001/decision in Sept tests; padded 100x. */
  jevCall: envNumber("IG_BRAIN_COST_JEV_CALL", 0.001),
  /** Gemini Flash video analysis of one Reel (~60s video ≈ 18k input tokens + ~2k output), padded ~2x. */
  geminiAnalysis: envNumber("IG_BRAIN_COST_GEMINI_ANALYSIS", 0.03),
  /**
   * Qwen3.8 Omni Flash via OpenRouter ($0.15/M input, $0.47/M output), one Reel attempt.
   * A 60-90s Reel at the provider's frame sampling + audio is roughly 20-50k input tokens
   * (~$0.003-0.0075) plus output incl. uncapped reasoning (measured 1.9-7k tokens, ~$0.001-0.0035). Padded to $0.015.
   * The real figure comes from OpenRouter usage.cost and replaces this in the log.
   */
  openrouterVideoAnalysis: envNumber("IG_BRAIN_COST_OPENROUTER_VIDEO_ANALYSIS", 0.015),
  /** MiniMax M3 via OpenRouter, one JSON generation call (angles / script / blueprint). */
  minimaxCall: envNumber("IG_BRAIN_COST_MINIMAX_CALL", 0.03),
} as const;

export const INSTAGRAM_BRAIN_CONFIG = {
  jevModel: process.env.IG_BRAIN_JEV_MODEL || "typesafe/jev-1.13",
  minimaxModel: process.env.IG_BRAIN_MINIMAX_MODEL || "minimax/minimax-m3",
  geminiModel: process.env.IG_BRAIN_GEMINI_MODEL || "gemini-3.8-flash",
  /** Who analyses Reel videos: "openrouter" (default, Qwen Omni) or "gemini" (native Gemini API). */
  videoAnalysisProvider: videoProvider("VIDEO_ANALYSIS_PROVIDER", "openrouter"),
  /**
   * Optional second provider tried once when the first fails for good ("gemini" | "openrouter" | "none").
   * Default "none" so one Reel never pays two providers without someone choosing that.
   */
  videoAnalysisFallback: videoProvider("VIDEO_ANALYSIS_FALLBACK", "none"),
  /** OpenRouter video model. qwen/qwen3.8-omni-flash: text+image+audio+video in, 1M context. */
  openrouterVideoModel: process.env.VIDEO_ANALYSIS_OPENROUTER_MODEL || "qwen/qwen3.8-omni-flash",
  /**
   * How the video reaches OpenRouter: "data-url" (default; we download the Instagram CDN file and send
   * base64, because signed CDN links often refuse/expire for provider fetchers) or "url" (send the CDN link).
   */
  openrouterVideoSendMode: (process.env.VIDEO_ANALYSIS_SEND_MODE === "url" ? "url" : "data-url") as "url" | "data-url",
  /** Largest video (MB, before base64) we will inline as a data URL. */
  maxInlineVideoMb: envNumber("VIDEO_ANALYSIS_MAX_INLINE_MB", 40),
  /** Attempts per provider for transient errors (HTTP 429 / 503), with backoff. */
  videoAnalysisMaxAttempts: envNumber("VIDEO_ANALYSIS_MAX_ATTEMPTS", 3),
  /**
   * Candidate slots per creator per scan (fit check, then the analysis gate). Shared between new Reels and
   * rechecks of existing rows; see lib/instagram-brain/candidates.ts. Default 8 (Fortune, Nov 12).
   */
  reelsPerCreator: envNumber("IG_BRAIN_REELS_PER_CREATOR", 8),
  /**
   * Shortcodes removed by hand (trashed in Notion). The Notion API can't see trashed rows, so without this a
   * trashed Reel would come back as "unseen" on the next scrape. Extra codes: IG_BRAIN_BLOCKED_SHORTCODES (comma list).
   */
  blockedShortcodes: [
    "DaEbLcHhEe8", // Kaye, pinned Spider-Verse Reel (Jun 27), trashed Nov 12
    "DarI4g8hBMc", // Kaye, Fantasy World portal Reel (Jul 12), trashed Nov 12
    ...String(process.env.IG_BRAIN_BLOCKED_SHORTCODES || "").split(",").map((code) => code.trim()).filter(Boolean),
  ] as string[],
  creatorsPerScan: envNumber("IG_BRAIN_CREATORS_PER_SCAN", 5),
  deepAnalysisLimitPerRun: envNumber("IG_BRAIN_DEEP_ANALYSIS_LIMIT", 5),
  /**
   * Only Reels published within this many days can become new candidates (scored, fit-checked, analysed).
   * Pinned Reels and Reels with no publish date are always skipped as candidates. Default 14 (Fortune, Nov 12).
   */
  recentWindowDays: envNumber("IG_BRAIN_RECENT_WINDOW_DAYS", 14),
  /** Apify reel scraper: exclude Instagram Trial Reels (they pollute baselines and create "duplicates"). */
  skipTrialReels: envBool("IG_BRAIN_SKIP_TRIAL_REELS", true),
  /**
   * Spending caps are OFF by default (Fortune, Nov 12 3:27 PM WAT: "Eliminate the spending cap").
   * Unset / empty / "off" / "none" / 0 = unlimited (Infinity): no run is ever stopped for budget.
   * Every paid call is still logged ([cost] lines + the run's cost summary).
   * Optional opt-in: set IG_BRAIN_SCAN_BUDGET_USD (per scan run, incl. analyses it queues) or
   * IG_BRAIN_ACTION_BUDGET_USD (per action task) to a positive USD amount, or pass payload.budgetUsd on a scan.
   */
  scanBudgetUsd: envCap("IG_BRAIN_SCAN_BUDGET_USD"),
  actionBudgetUsd: envCap("IG_BRAIN_ACTION_BUDGET_USD"),
  /**
   * Minimum Performance Score (0-100; 50 = the creator's median Reel) a new Reel needs before it is
   * sent to Gemini. Default 60: clearly above the creator's own typical Reel.
   */
  minPerformanceScoreForAnalysis: envNumber("IG_BRAIN_MIN_PERFORMANCE_FOR_ANALYSIS", 60),
  /**
   * Minimum Priority Score (0-100) an analysed Reel needs before MiniMax angles are generated.
   * Default 60 (Top Opportunities shows >= 70). Tick "Manual Override" on the Reel to bypass.
   */
  minPriorityScoreForAngles: envNumber("IG_BRAIN_MIN_PRIORITY_FOR_ANGLES", 60),
  /** Optional JSONL cost log path (best effort; Trigger's run output + metadata is the durable record). */
  costLogFile: process.env.IG_BRAIN_COST_LOG_FILE ?? ".tmp/ig-brain-cost-log.jsonl",
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
