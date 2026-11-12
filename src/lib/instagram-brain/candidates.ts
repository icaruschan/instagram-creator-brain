/**
 * Which Reels get a candidate slot in a scan (fit check → analysis gate).
 *
 * Two pools per creator:
 *  - NEW: Reels not yet in Notion that pass the recency filter (unpinned, dated, inside the window).
 *  - RECHECK: Reels already in Reel Intelligence that slipped through earlier, e.g. stored only as a
 *    baseline row and never fit-checked, or fit-checked (Core/Supporting) but never analysed and whose
 *    age-fair Performance now clears the analysis cut-off.
 *
 * Slot sharing (IG_BRAIN_REELS_PER_CREATOR, default 8):
 *  1. The newest NEW Reels get up to ceil(slots / 4) guaranteed slots (2 of 8). Fresh Reels are a
 *     few hours old with no velocity yet, so their score is the least reliable; this keeps the scan
 *     from missing a Reel that is about to take off.
 *  2. Every remaining slot goes to the highest age-fair Performance across BOTH pools (the rest of NEW
 *     plus RECHECK). Ties: NEW first, then newer post.
 *  Whatever doesn't fit is counted (overflow) and stays eligible for the next scan.
 */

export type RecheckReason = "never-fit-checked" | "fit-ok-not-analysed";

export interface RecheckRow {
  pinned: boolean;
  publishedAt: string;
  status: string;
  strategicFit: string;
  geminiAnalysis: string;
  shortcode: string;
}

/**
 * Why an existing row should go back through the candidate steps, or null.
 * Never: pinned, outside the window / undated (ageDays null or > window), blocked, Status Ignored or
 * Failed, fit Irrelevant or Adjacent, or anything that already has an analysis.
 */
export function recheckReason(
  row: RecheckRow,
  opts: { ageDays: number | null; windowDays: number; performanceScore: number; minPerformanceScore: number; blocked?: Set<string> },
): RecheckReason | null {
  if (row.pinned) return null;
  if (opts.ageDays == null || opts.ageDays > opts.windowDays) return null;
  if (opts.blocked?.has(row.shortcode)) return null;
  if (row.status === "Ignored" || row.status === "Failed") return null;
  if (row.geminiAnalysis && row.geminiAnalysis.trim()) return null;
  if (!row.strategicFit) return "never-fit-checked";
  if ((row.strategicFit === "Core" || row.strategicFit === "Supporting") && opts.performanceScore >= opts.minPerformanceScore) {
    return "fit-ok-not-analysed";
  }
  return null;
}

export interface SlotEntry {
  key: string;
  source: "new" | "recheck";
  performanceScore: number;
  /** ms epoch; used for "newest" and tie-breaks. */
  publishedTime: number;
}

export interface SlotPlan<T extends SlotEntry> {
  picked: Array<T & { slot: "fresh" | "performance" }>;
  overflow: { new: number; recheck: number };
  freshSlots: number;
}

export function freshSlotCount(slots: number): number {
  return Math.ceil(Math.max(0, slots) / 4);
}

export function planCandidateSlots<T extends SlotEntry>(slots: number, fresh: T[], rechecks: T[]): SlotPlan<T> {
  const total = Math.max(0, Math.floor(slots));
  const byNewest = [...fresh].sort((a, b) => b.publishedTime - a.publishedTime);
  const freshSlots = Math.min(freshSlotCount(total), byNewest.length, total);
  const guaranteed = byNewest.slice(0, freshSlots).map((entry) => ({ ...entry, slot: "fresh" as const }));
  const rest = [...byNewest.slice(freshSlots), ...rechecks].sort((a, b) =>
    b.performanceScore - a.performanceScore
    || (a.source === b.source ? 0 : a.source === "new" ? -1 : 1)
    || b.publishedTime - a.publishedTime);
  const byPerformance = rest.slice(0, total - guaranteed.length).map((entry) => ({ ...entry, slot: "performance" as const }));
  const picked = [...guaranteed, ...byPerformance];
  const pickedKeys = new Set(picked.map((entry) => entry.key));
  return {
    picked,
    overflow: {
      new: fresh.filter((entry) => !pickedKeys.has(entry.key)).length,
      recheck: rechecks.filter((entry) => !pickedKeys.has(entry.key)).length,
    },
    freshSlots,
  };
}
