import assert from "node:assert/strict";

// Keep the test hermetic: no cost-log file, default config values.
process.env.IG_BRAIN_COST_LOG_FILE = "";
delete process.env.IG_BRAIN_ACTIVE_ACCOUNTS;

async function main() {
  const { INSTAGRAM_BRAIN_CONFIG, activeAccounts, resolveTargetAccount } = await import("../src/lib/instagram-brain/config");
  const { CostLedger, BudgetExceededError, estimateCost, isBudgetExceeded } = await import("../src/lib/instagram-brain/cost");
  const { angleGate } = await import("../src/lib/instagram-brain/angles");
  const { readPillarAnswers } = await import("../src/lib/instagram-brain/jev");
  const { planChanges, DESIRED } = await import("./migrate-yuna-guardrails");
  const { estimatedAnalysisCost, estimatedCreatorScanCost } = await import("../src/trigger/instagram-creator-brain/scan-reels");

  // 1. Trial Reels are skipped by default.
  assert.equal(INSTAGRAM_BRAIN_CONFIG.skipTrialReels, true);

  // 2. Spending cap: ensure() blocks a call that would cross the cap; record() uses actual cost when given.
  const quiet = () => undefined;
  const ledger = new CostLedger("test", 0.1, quiet);
  ledger.record("jev", "a", 0.001, 0.00002);
  assert.equal(ledger.spentUsd, 0.00002);
  ledger.record("minimax", "b", 0.03);
  assert.equal(ledger.spentUsd, 0.03002);
  ledger.reserve(0.05, "queued");
  assert.equal(ledger.committedUsd, 0.08002);
  assert.throws(() => ledger.ensure(0.03, "too much"), BudgetExceededError);
  try { ledger.ensure(0.03, "too much"); } catch (error) { assert.ok(isBudgetExceeded(error)); }
  ledger.release(0.05);
  ledger.ensure(0.03, "fits again");
  assert.equal(ledger.summary().byKind.minimax, 0.03);

  // Spending caps are off by default (Fortune, Nov 12): unlimited, never stops a run; logging stays.
  assert.equal(INSTAGRAM_BRAIN_CONFIG.scanBudgetUsd, Infinity);
  assert.equal(INSTAGRAM_BRAIN_CONFIG.actionBudgetUsd, Infinity);
  assert.equal(INSTAGRAM_BRAIN_CONFIG.reelsPerCreator, 8);
  const { parseCap } = await import("../src/lib/instagram-brain/config");
  assert.equal(parseCap(undefined), Infinity);
  assert.equal(parseCap(""), Infinity);
  assert.equal(parseCap("off"), Infinity);
  assert.equal(parseCap("0"), Infinity);
  assert.equal(parseCap("-1"), Infinity);
  assert.equal(parseCap("abc"), Infinity);
  assert.equal(parseCap("1.5"), 1.5); // opt-in still works
  const open = new CostLedger("open", INSTAGRAM_BRAIN_CONFIG.scanBudgetUsd, quiet);
  assert.equal(open.unlimited, true);
  open.reserve(1_000, "huge reservation");
  open.ensure(1_000_000, "huge call");
  open.record("apify-transcript", "t", 0.02, 0.5);
  assert.equal(open.canAfford(Number.MAX_SAFE_INTEGER), true);
  const openSummary = open.summary();
  assert.equal(openSummary.capUsd, null);
  assert.equal(openSummary.remainingUsd, null);
  assert.equal(openSummary.spentUsd, 0.5);
  assert.doesNotThrow(() => JSON.stringify(openSummary));
  const { actionLedger } = await import("../src/lib/instagram-brain/cost");
  assert.equal(actionLedger("angles", undefined).unlimited, true);
  // Worst-case estimate for a full default scan (5 creators x 8 slots + 5 analyses), for the notes: ~$1.31.
  const perCreator = estimatedCreatorScanCost(INSTAGRAM_BRAIN_CONFIG.reelsPerCreator);
  assert.equal(Math.round(perCreator * 1000) / 1000, 0.246);
  const defaultScan = perCreator * INSTAGRAM_BRAIN_CONFIG.creatorsPerScan + estimatedAnalysisCost() * INSTAGRAM_BRAIN_CONFIG.deepAnalysisLimitPerRun;
  assert.equal(Math.round(defaultScan * 100) / 100, 1.31);
  assert.equal(estimateCost("apify-reel-scrape", 30), 0.078);
  // Worst-case angle generation (3 MiniMax + 3 Jev) ≈ $0.093 estimated (no cap now).
  assert.equal(Math.round(3 * (estimateCost("minimax") + estimateCost("jev")) * 1000) / 1000, 0.093);

  // 3. Score cut-off before angles (and Manual Override bypass).
  assert.match(String(angleGate({ geminiAnalysis: "", priorityScore: 90, manualOverride: false })), /No Gemini analysis/);
  assert.match(String(angleGate({ geminiAnalysis: "{}", priorityScore: 40, manualOverride: false })), /below the angle cut-off/);
  assert.equal(angleGate({ geminiAnalysis: "{}", priorityScore: 40, manualOverride: true }), null);
  assert.equal(angleGate({ geminiAnalysis: "{}", priorityScore: 75, manualOverride: false }), null);

  // 5. Yuna only.
  assert.deepEqual(activeAccounts(), ["Yuna"]);
  assert.equal(resolveTargetAccount("Unassigned"), "Yuna");
  assert.equal(resolveTargetAccount("Yuna"), "Yuna");
  assert.throws(() => resolveTargetAccount("Alisha"), /on hold/);
  assert.throws(() => resolveTargetAccount("Both"), /on hold/);
  assert.equal(resolveTargetAccount("Both", ["Yuna", "Alisha"]), "Both");

  // 7. Pillar / Content Type parsing from Jev answers.
  assert.deepEqual(
    readPillarAnswers({ pillar: { choice: "storytelling" }, content_type: { choice: "tool_model_test" } }),
    { pillar: "Storytelling", contentType: "Tool/Model Test" },
  );
  assert.deepEqual(readPillarAnswers({}), { pillar: null, contentType: null });

  // Migration planner: adds missing properties, merges missing select options, never touches others.
  const plan = planChanges("Production Queue", {
    "Lara Script Status": { type: "select", select: { options: [{ id: "x1", name: "Needed" }] } },
    "Lara Script": { type: "rich_text", rich_text: {} },
  }, DESIRED["Production Queue"].properties);
  const byProperty = Object.fromEntries(plan.changes.map((change) => [change.property, change.action]));
  assert.equal(byProperty["Lara Script"], undefined);
  assert.equal(byProperty["Lara Script Status"], "add options");
  assert.deepEqual(plan.update["Lara Script Status"].select.options.map((o: any) => o.id || o.name), ["x1", "Drafted"]);
  assert.equal(byProperty["Chosen Script"], "add property");
  const conflict = planChanges("Idea Lab", { Pillar: { type: "multi_select" } }, DESIRED["Idea Lab"].properties);
  assert.equal(conflict.changes.find((change) => change.property === "Pillar")?.action, "type conflict");
  assert.equal(conflict.update.Pillar, undefined);

  console.log("Guardrail tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
