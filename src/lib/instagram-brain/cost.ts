import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { COST_ESTIMATES_USD, INSTAGRAM_BRAIN_CONFIG } from "./config";

export type CostKind =
  | "apify-reel-scrape"
  | "apify-transcript"
  | "jev"
  | "gemini-analysis"
  | "openrouter-video-analysis"
  | "minimax";

export interface CostEntry {
  at: string;
  task: string;
  kind: CostKind;
  label: string;
  estimatedUsd: number;
  actualUsd: number | null;
  /** The figure logged (and counted against an opt-in cap): actual when reported, otherwise the estimate. */
  chargedUsd: number;
}

export class BudgetExceededError extends Error {
  constructor(
    public readonly task: string,
    public readonly capUsd: number,
    public readonly spentUsd: number,
    public readonly neededUsd: number,
    public readonly label: string,
  ) {
    super(
      `Spending cap reached for ${task}: $${spentUsd.toFixed(4)} spent + $${neededUsd.toFixed(4)} needed for ${label} > cap $${capUsd.toFixed(2)}`,
    );
    this.name = "BudgetExceededError";
  }
}

export function isBudgetExceeded(error: unknown): error is BudgetExceededError {
  return error instanceof BudgetExceededError || (error as Error | undefined)?.name === "BudgetExceededError";
}

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

/** Estimated cost for one call of a kind. `units` = result count for Apify reel scrapes. */
export function estimateCost(kind: CostKind, units = 1): number {
  switch (kind) {
    case "apify-reel-scrape": return COST_ESTIMATES_USD.apifyReelResult * units;
    case "apify-transcript": return COST_ESTIMATES_USD.apifyTranscript * units;
    case "jev": return COST_ESTIMATES_USD.jevCall * units;
    case "gemini-analysis": return COST_ESTIMATES_USD.geminiAnalysis * units;
    case "openrouter-video-analysis": return COST_ESTIMATES_USD.openrouterVideoAnalysis * units;
    case "minimax": return COST_ESTIMATES_USD.minimaxCall * units;
  }
}

/** Ledger kind for one video analysis by a provider. */
export function videoAnalysisKind(provider: "openrouter" | "gemini"): CostKind {
  return provider === "openrouter" ? "openrouter-video-analysis" : "gemini-analysis";
}

/**
 * Estimate for analysing one Reel's video: one billed call to the primary provider (429/503 retries
 * are rejected before inference and logged at $0), plus the fallback provider when one is configured.
 * Used to reserve budget before queuing an analysis.
 */
export function estimateVideoAnalysisCost(): number {
  const primary = estimateCost(videoAnalysisKind(INSTAGRAM_BRAIN_CONFIG.videoAnalysisProvider));
  const fallback = INSTAGRAM_BRAIN_CONFIG.videoAnalysisFallback;
  return round(primary + (fallback === "none" || fallback === INSTAGRAM_BRAIN_CONFIG.videoAnalysisProvider ? 0 : estimateCost(videoAnalysisKind(fallback))));
}

/**
 * Per-run spending tracker. Call `ensure()` before every paid call (throws BudgetExceededError
 * when the call would push the run over its cap), then `record()` once the call returns.
 * `reserve()` books money for work queued to another task (e.g. Gemini analyses queued by a scan).
 */
export class CostLedger {
  readonly entries: CostEntry[] = [];
  private reservedUsd = 0;

  constructor(
    public readonly task: string,
    public readonly capUsd: number,
    private readonly sink: (entry: CostEntry) => void = defaultSink,
  ) {}

  get spentUsd(): number {
    return round(this.entries.reduce((sum, entry) => sum + entry.chargedUsd, 0));
  }

  get committedUsd(): number {
    return round(this.spentUsd + this.reservedUsd);
  }

  get remainingUsd(): number {
    return round(Math.max(0, this.capUsd - this.committedUsd));
  }

  /** True when no cap is set (the default): ensure()/reserve() never throw. */
  get unlimited(): boolean {
    return !Number.isFinite(this.capUsd);
  }

  canAfford(amountUsd: number): boolean {
    if (this.unlimited) return true;
    return this.committedUsd + amountUsd <= this.capUsd + 1e-9;
  }

  ensure(amountUsd: number, label: string): void {
    if (!this.canAfford(amountUsd)) {
      throw new BudgetExceededError(this.task, this.capUsd, this.committedUsd, amountUsd, label);
    }
  }

  /** Check-then-record helper for one call of a known kind. */
  ensureKind(kind: CostKind, label: string, units = 1): number {
    const estimate = estimateCost(kind, units);
    this.ensure(estimate, label);
    return estimate;
  }

  record(kind: CostKind, label: string, estimatedUsd: number, actualUsd?: number | null): CostEntry {
    const actual = typeof actualUsd === "number" && Number.isFinite(actualUsd) && actualUsd >= 0 ? actualUsd : null;
    const entry: CostEntry = {
      at: new Date().toISOString(),
      task: this.task,
      kind,
      label,
      estimatedUsd: round(estimatedUsd),
      actualUsd: actual == null ? null : round(actual),
      chargedUsd: round(actual ?? estimatedUsd),
    };
    this.entries.push(entry);
    this.sink(entry);
    return entry;
  }

  reserve(amountUsd: number, label: string): void {
    this.ensure(amountUsd, label);
    this.reservedUsd = round(this.reservedUsd + amountUsd);
  }

  /** Give back (part of) an earlier reservation. */
  release(amountUsd: number): void {
    this.reservedUsd = round(Math.max(0, this.reservedUsd - amountUsd));
  }

  summary() {
    const byKind: Record<string, number> = {};
    for (const entry of this.entries) byKind[entry.kind] = round((byKind[entry.kind] || 0) + entry.chargedUsd);
    return {
      task: this.task,
      // null = no cap (JSON can't hold Infinity).
      capUsd: this.unlimited ? null : this.capUsd,
      spentUsd: this.spentUsd,
      reservedForQueuedTasksUsd: round(this.reservedUsd),
      committedUsd: this.committedUsd,
      remainingUsd: this.unlimited ? null : this.remainingUsd,
      calls: this.entries.length,
      byKind,
    };
  }
}

/** Default sink: one JSON line to stdout (shows in Trigger logs) plus a best-effort JSONL file. */
function defaultSink(entry: CostEntry): void {
  console.log(`[cost] ${JSON.stringify(entry)}`);
  const file = INSTAGRAM_BRAIN_CONFIG.costLogFile;
  if (!file) return;
  try {
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // Read-only or ephemeral filesystem: stdout + run output remain the record.
  }
}

/** Attach the ledger summary to the Trigger run metadata when running inside a task. */
export async function publishCostSummary(ledger: CostLedger): Promise<void> {
  try {
    const { metadata } = await import("@trigger.dev/sdk/v3");
    metadata.set("cost", ledger.summary() as any);
  } catch {
    // Outside a Trigger run (local scripts/tests): nothing to attach to.
  }
}

/** A ledger for a single router-triggered action task. */
export function actionLedger(task: string, capUsd = INSTAGRAM_BRAIN_CONFIG.actionBudgetUsd): CostLedger {
  return new CostLedger(task, capUsd);
}

/** Re-throw budget errors as non-retryable so Trigger doesn't retry (and re-spend) a capped run. */
export async function rethrowNonRetryable(error: unknown): Promise<never> {
  if (isBudgetExceeded(error)) {
    const { AbortTaskRunError } = await import("@trigger.dev/sdk/v3");
    throw new AbortTaskRunError((error as Error).message);
  }
  throw error;
}
