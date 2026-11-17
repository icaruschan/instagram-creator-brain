import { CONTENT_TYPES, INSTAGRAM_BRAIN_CONFIG, YUNA_PILLARS, type ContentType, type YunaPillar } from "./config";
import type { CostLedger } from "./cost";
import { runJevDecision } from "./jev";
import type { StoredReel } from "./notion";
import type { AnglePreview } from "./types";

function canonicalLabel<T extends string>(value: unknown, allowed: readonly T[], aliases: Record<string, T> = {}): T | "" {
  if (typeof value !== "string") return "";
  const key = value.trim().toLowerCase().replace(/^ai\s+/, "").replace(/[\s_-]+/g, " ");
  if (!key) return "";
  for (const option of allowed) {
    const opt = option.toLowerCase().replace(/^ai\s+/, "").replace(/[\s_-]+/g, " ");
    if (opt === key) return option;
  }
  return aliases[key] || "";
}

const PILLAR_ALIASES: Record<string, YunaPillar> = {
  "visual storytelling": "Visual Storyteller",
  "creative operator": "Creative Operator",
  operator: "Creative Operator",
  story: "Storytelling",
  "story telling": "Storytelling",
};

const CONTENT_TYPE_ALIASES: Record<string, ContentType> = {
  "creative video": "Creative AI Video",
  "creative workflow": "AI Creative Workflow",
  workflow: "AI Creative Workflow",
  "tool test": "Tool/Model Test",
  "model test": "Tool/Model Test",
  "tool/model test": "Tool/Model Test",
  "tool model test": "Tool/Model Test",
  "tools & model experiments": "Tool/Model Test",
  automation: "Creator Automation",
  "creator ai systems & automation": "Creator Automation",
  "creative commentary": "Commentary",
  "& creative commentary": "Commentary",
};

export function normalizePillar(value: unknown): YunaPillar | "" {
  return canonicalLabel(value, YUNA_PILLARS, PILLAR_ALIASES);
}

export function normalizeContentType(value: unknown): ContentType | "" {
  return canonicalLabel(value, CONTENT_TYPES, CONTENT_TYPE_ALIASES);
}

/**
 * Guarantee a Visual-first angle has a usable hook: if both the visual and on-screen text hooks are blank,
 * build a visual hook description from the first beat (or the summary) so the 0-3s opening is never empty.
 */
export function ensureVisualHook(angle: AnglePreview): AnglePreview {
  if (angle.deliveryProfile !== "Visual-first") return angle;
  if (angle.visualHook || angle.textHook) return angle;
  const source = angle.threeBeatOutline[0] || angle.summary || angle.title;
  return { ...angle, visualHook: `Opening 0-3s: ${source}`.trim() };
}

export function normalizeAngles(
  raw: Record<string, unknown>,
  fallback: { pillar?: string; contentType?: string } = {},
): AnglePreview[] {
  const rows = Array.isArray(raw.angles) ? raw.angles : [];
  const fallbackPillar = normalizePillar(fallback.pillar);
  const fallbackType = normalizeContentType(fallback.contentType);
  return rows.slice(0, 5).map((item: any) => ensureVisualHook({
    title: String(item.title || "Untitled angle").trim(),
    summary: String(item.summary || "").trim(),
    spokenHook: String(item.spokenHook || "").trim(),
    textHook: String(item.textHook || "").trim(),
    visualHook: String(item.visualHook || "").trim(),
    audioHook: String(item.audioHook || "").trim(),
    threeBeatOutline: Array.isArray(item.threeBeatOutline) ? item.threeBeatOutline.map(String).slice(0, 5) : [],
    whyItWorks: String(item.whyItWorks || "").trim(),
    whatNotToCopy: String(item.whatNotToCopy || "").trim(),
    deliveryProfile: ["Visual-first", "Operator-first", "Hybrid"].includes(item.deliveryProfile) ? item.deliveryProfile : "Hybrid",
    scriptEngine: ["Kallaway", "RPN", "Hybrid"].includes(item.scriptEngine) ? item.scriptEngine : "Kallaway",
    pillar: normalizePillar(item.pillar) || fallbackPillar,
    contentType: normalizeContentType(item.contentType) || fallbackType,
  }));
}

export async function originalityResults(
  sourceVisualAnalysis: string,
  angles: AnglePreview[],
  ledger?: CostLedger,
): Promise<Array<{ title: string; tooClose: number; aiFit: number }>> {
  const questions = Object.fromEntries(angles.flatMap((_, index) => [
    [`angle_${index}_too_close`, {
      type: "noul" as const,
      instructions: `Does \`angles[${index}]\` substantially repeat the source Reel's opening action, movement sequence, or visual payoff, even if its characters, setting, or tools have changed?`,
    }],
    [`angle_${index}_ai_fit`, {
      type: "noul" as const,
      instructions: `Is AI creation essential to \`angles[${index}]\`'s premise and viewer payoff? Answer low for an ordinary filmed lifestyle story that could work unchanged without AI. Answer high only when an AI-created visual, AI creative process, or AI-powered workflow is central and explicit.`,
    }],
  ]));
  const response = await runJevDecision(
    { sourceVisualAnalysis, angles: angles.map((angle) => ({ title: angle.title, summary: angle.summary, visualHook: angle.visualHook, beats: angle.threeBeatOutline })) },
    questions,
    { ledger, label: `jev originality check (${angles.length} angles)` },
  );
  return angles.map((angle, index) => ({
    title: angle.title,
    tooClose: Number(response.answers[`angle_${index}_too_close`]?.noul ?? 1),
    aiFit: Number(response.answers[`angle_${index}_ai_fit`]?.noul ?? 0),
  }));
}

/**
 * Cut-off before MiniMax angles: the Reel must have a Gemini analysis and a Priority Score at or above
 * IG_BRAIN_MIN_PRIORITY_FOR_ANGLES (default 60). Ticking "Manual Override" on the Reel bypasses the score
 * cut-off (not the analysis requirement). Returns a reason string when blocked, otherwise null.
 */
export function angleGate(reel: Pick<StoredReel, "geminiAnalysis" | "priorityScore" | "manualOverride">): string | null {
  if (!reel.geminiAnalysis?.trim()) {
    return "No Gemini analysis yet: angles need an analysed Reel. Run analyze-reel on it first.";
  }
  const floor = INSTAGRAM_BRAIN_CONFIG.minPriorityScoreForAngles;
  if (!reel.manualOverride && reel.priorityScore < floor) {
    return `Priority ${reel.priorityScore} is below the angle cut-off (${floor}). Tick Manual Override to generate anyway.`;
  }
  return null;
}

