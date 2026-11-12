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

  // Cap stays $1 (raising it needs Fortune's approval). With 8 slots per creator the worst-case estimate is
  // $0.246/creator: a 1-creator scan fits easily, a full 5-creator scan (~$1.31 worst case) does not, so the cap
  // stops it cleanly after 3 creators (the 5 analyses are held back first).
  assert.equal(INSTAGRAM_BRAIN_CONFIG.scanBudgetUsd, 1);
  assert.equal(INSTAGRAM_BRAIN_CONFIG.reelsPerCreator, 8);
  const perCreator = estimatedCreatorScanCost(INSTAGRAM_BRAIN_CONFIG.reelsPerCreator);
  assert.equal(Math.round(perCreator * 1000) / 1000, 0.246);
  const holdback = estimatedAnalysisCost() * INSTAGRAM_BRAIN_CONFIG.deepAnalysisLimitPerRun;
  const defaultScan = perCreator * INSTAGRAM_BRAIN_CONFIG.creatorsPerScan + holdback;
  assert.equal(Math.round(defaultScan * 100) / 100, 1.31);
  assert.ok(perCreator + holdback <= INSTAGRAM_BRAIN_CONFIG.scanBudgetUsd, "a 1-creator scan should fit the cap");
  assert.equal(Math.floor((INSTAGRAM_BRAIN_CONFIG.scanBudgetUsd - holdback) / perCreator), 3, "cap covers 3 full creators");
  assert.ok(perCreator * 20 > INSTAGRAM_BRAIN_CONFIG.scanBudgetUsd, "a 20-creator scan should hit the cap");
  assert.equal(estimateCost("apify-reel-scrape", 30), 0.078);
  // Worst-case angle generation (3 MiniMax + 3 Jev) fits the per-action cap.
  assert.ok(3 * (estimateCost("minimax") + estimateCost("jev")) <= INSTAGRAM_BRAIN_CONFIG.actionBudgetUsd);

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
