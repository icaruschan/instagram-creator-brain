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

  // Default scan fits under the default cap; a 20-creator scan does not.
  const perCreator = estimatedCreatorScanCost(INSTAGRAM_BRAIN_CONFIG.reelsPerCreator);
  const defaultScan = perCreator * INSTAGRAM_BRAIN_CONFIG.creatorsPerScan + estimatedAnalysisCost() * INSTAGRAM_BRAIN_CONFIG.deepAnalysisLimitPerRun;
  assert.ok(defaultScan <= INSTAGRAM_BRAIN_CONFIG.scanBudgetUsd, `default scan ${defaultScan} should fit the cap`);
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
