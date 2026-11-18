import assert from "node:assert/strict";

// Hermetic: no network, no cost-log file, default fit config.
process.env.IG_BRAIN_COST_LOG_FILE = "";
delete process.env.IG_BRAIN_FIT_MODEL;
delete process.env.IG_BRAIN_FIT_USE_VIDEO;
delete process.env.IG_BRAIN_FIT_TIMEOUT_MS;
delete process.env.IG_BRAIN_JEV_MODEL;
delete process.env.IG_BRAIN_ANALYSIS_FIT_MODEL;
delete process.env.IG_BRAIN_ANALYSIS_FIT_USE_VIDEO;
delete process.env.IG_BRAIN_TOP_OPPORTUNITIES_MIN_PRIORITY;
delete process.env.IG_BRAIN_MIN_PRIORITY_FOR_ANGLES;

async function main() {
  const { INSTAGRAM_BRAIN_CONFIG } = await import("../src/lib/instagram-brain/config");
  const { CostLedger, BudgetExceededError, estimateCost } = await import("../src/lib/instagram-brain/cost");
  const { runFitCheck, parseFitResponse, prepareFitVideo, buildFitQuestions, expectedFit, FIT_VALUES, runSourceValueDecision, parseSourceValueResponse } = await import("../src/lib/instagram-brain/fit-check");
  const { STRATEGIC_FIT_CRITERIA, buildSourceValueQuestions } = await import("../src/lib/instagram-brain/jev");

  // Defaults (Fortune, 2026-11-18): Gemini Decision 1 + video, 60s timeout, Jev 1.13 fallback.
  assert.equal(INSTAGRAM_BRAIN_CONFIG.fitModel, "google/gemini-decision-1");
  assert.equal(INSTAGRAM_BRAIN_CONFIG.fitUseVideo, true);
  assert.equal(INSTAGRAM_BRAIN_CONFIG.fitTimeoutMs, 60_000);
  assert.equal(INSTAGRAM_BRAIN_CONFIG.jevModel, "typesafe/jev-1.13");
  assert.ok(estimateCost("fit-decision") > 0);

  // Score mapping unchanged.
  assert.deepEqual(FIT_VALUES, { core: 100, supporting: 65, adjacent: 30, irrelevant: 0 });
  assert.equal(expectedFit({ core: 0.5, supporting: 0.5 }), 82.5);
  // Same questions as prod.
  const q = buildFitQuestions() as any;
  assert.deepEqual(Object.keys(q).sort(), ["content_type", "pillar", "strategic_fit"]);
  assert.deepEqual(q.strategic_fit.criteria, STRATEGIC_FIT_CRITERIA);

  // Response parsing.
  const good = { answers: {
    strategic_fit: { choice: "core", confidence: 0.91, probabilities: { core: 0.9, supporting: 0.1 } },
    pillar: { choice: "visual_storyteller" }, content_type: { choice: "creative_ai_video" },
  } };
  const parsed = parseFitResponse(good);
  assert.deepEqual(parsed, { fit: "Core", score: 96.5, confidence: 0.91, pillar: "Visual Storyteller", contentType: "Creative AI Video" });
  assert.equal(parseFitResponse({ answers: { strategic_fit: { choice: "Adjacent" } } }).score, 30, "no probabilities -> choice gets 1.0; case-insensitive");
  assert.throws(() => parseFitResponse({ answers: {} }), /no valid strategic_fit/);
  assert.throws(() => parseFitResponse({ answers: { strategic_fit: { choice: "maybe" } } }), /no valid strategic_fit/);

  // Video prep: shrink used; shrink failure -> original if small; too large -> throw.
  const big = new Uint8Array(3_000_000);
  big.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73], 0); // "ftyp" -> video/mp4
  const small = big.slice(0, 50_000);
  const v1 = await prepareFitVideo("https://x/v.mp4", { download: async () => big, shrink: async () => small });
  assert.equal(v1.form, "shrunk");
  assert.equal(v1.bytes, 50_000);
  assert.ok(v1.dataUrl.startsWith("data:video/mp4;base64,"));
  const v2 = await prepareFitVideo("https://x/v.mp4", { download: async () => big, shrink: async () => { throw new Error("no ffmpeg"); } });
  assert.equal(v2.form, "original");
  await assert.rejects(prepareFitVideo("https://x/v.mp4", { download: async () => big, shrink: async () => { throw new Error("no ffmpeg"); } }, 1_000_000), /could not shrink/);
  await assert.rejects(prepareFitVideo("https://x/v.mp4", { download: async () => big, shrink: async () => big }, 1_000_000), /too large/);
  await assert.rejects(prepareFitVideo("", {}), /no Video URL/);

  // runFitCheck with a fake decide(): records calls.
  const input = { shortcode: "TEST1", videoUrl: "https://x/v.mp4", state: { caption: "c" } };
  const mkDecide = (behaviour: Record<string, (state: any) => any>) => {
    const calls: any[] = [];
    const decide = async (state: any, _q: any, opts: any) => {
      calls.push({ state, opts });
      const r = behaviour[opts.model](state);
      if (r instanceof Error) throw r;
      if (opts.ledger) opts.ledger.record(opts.costKind || "jev", opts.label, 0.001, r.usage?.cost);
      return { model: opts.model, ...r };
    };
    return { calls, decide };
  };
  const videoDeps = { download: async () => big, shrink: async () => small };

  // a) Happy path: Gemini + video decides, cost recorded as fit-decision with usage.cost.
  {
    const ledger = new CostLedger("t", Infinity, () => undefined);
    const { calls, decide } = mkDecide({ "google/gemini-decision-1": () => ({ ...good, usage: { cost: 0.00055 } }) });
    const r = await runFitCheck(input, ledger, { decide, ...videoDeps });
    assert.equal(r.fit, "Core");
    assert.deepEqual(r.decidedBy, { model: "google/gemini-decision-1", mode: "video", videoBytes: 50_000 });
    assert.equal(calls.length, 1);
    assert.ok(Array.isArray(calls[0].state) && calls[0].state[1].type === "video_url");
    assert.deepEqual(calls[0].state[0], input.state);
    assert.equal(calls[0].opts.timeoutMs, 60_000);
    assert.equal(ledger.entries[0].kind, "fit-decision");
    assert.equal(ledger.entries[0].actualUsd, 0.00055);
  }
  // b) Video can't be downloaded -> Jev text, Gemini never called.
  {
    const { calls, decide } = mkDecide({ "typesafe/jev-1.13": () => ({ answers: { strategic_fit: { choice: "supporting" } } }) });
    const r = await runFitCheck(input, undefined, { decide, download: async () => { throw new Error("Video download failed (403)"); } });
    assert.equal(r.fit, "Supporting");
    assert.equal(r.decidedBy.model, "typesafe/jev-1.13");
    assert.equal(r.decidedBy.mode, "text");
    assert.match(r.decidedBy.fallbackReason!, /video unavailable: Video download failed \(403\)/);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].state, input.state, "Jev gets the plain text state");
  }
  // c) No Video URL -> Jev text.
  {
    const { decide } = mkDecide({ "typesafe/jev-1.13": () => good });
    const r = await runFitCheck({ ...input, videoUrl: "" }, undefined, { decide });
    assert.match(r.decidedBy.fallbackReason!, /no Video URL/);
  }
  // d) Gemini errors / times out -> Jev text.
  for (const err of [new Error("Decision call failed (google/gemini-decision-1, 502): bad gateway"), new Error("Decision call timed out after 60000ms (google/gemini-decision-1)")]) {
    const { calls, decide } = mkDecide({ "google/gemini-decision-1": () => err, "typesafe/jev-1.13": () => good });
    const r = await runFitCheck(input, undefined, { decide, ...videoDeps });
    assert.equal(r.decidedBy.model, "typesafe/jev-1.13");
    assert.match(r.decidedBy.fallbackReason!, /google\/gemini-decision-1 failed/);
    assert.equal(calls.length, 2);
  }
  // e) Gemini returns junk -> Jev text.
  {
    const { decide } = mkDecide({ "google/gemini-decision-1": () => ({ answers: { strategic_fit: { choice: "" } } }), "typesafe/jev-1.13": () => good });
    const r = await runFitCheck(input, undefined, { decide, ...videoDeps });
    assert.equal(r.decidedBy.mode, "text");
  }
  // f) Budget errors are not swallowed.
  {
    const { decide } = mkDecide({ "google/gemini-decision-1": () => new BudgetExceededError("t", 0.01, 0.01, 0.005, "x"), "typesafe/jev-1.13": () => good });
    await assert.rejects(runFitCheck(input, undefined, { decide, ...videoDeps }), /Spending cap reached/);
  }
  // g) Both fail -> error surfaces (scan records the creator as failed, like before).
  {
    const { decide } = mkDecide({ "google/gemini-decision-1": () => new Error("down"), "typesafe/jev-1.13": () => new Error("jev down") });
    await assert.rejects(runFitCheck(input, undefined, { decide, ...videoDeps }), /jev down/);
  }
  // h) IG_BRAIN_FIT_USE_VIDEO=false -> Gemini text only, no download.
  {
    const { calls, decide } = mkDecide({ "google/gemini-decision-1": () => good });
    const r = await runFitCheck(input, undefined, { decide, download: async () => { throw new Error("should not download"); }, config: { fitUseVideo: false } });
    assert.deepEqual(r.decidedBy, { model: "google/gemini-decision-1", mode: "text" });
    assert.deepEqual(calls[0].state, input.state);
  }
  // i) IG_BRAIN_FIT_MODEL = the Jev model -> old behaviour (Jev text, single call, no video).
  {
    const { calls, decide } = mkDecide({ "typesafe/jev-1.13": () => good });
    const r = await runFitCheck(input, undefined, { decide, download: async () => { throw new Error("should not download"); }, config: { fitModel: "typesafe/jev-1.13" } });
    assert.deepEqual(r.decidedBy, { model: "typesafe/jev-1.13", mode: "text" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.label, "jev fit check TEST1");
  }

  // ---- Post-analysis source-value decision (analyze-reel.ts), Fortune 2026-11-18 ----
  assert.equal(INSTAGRAM_BRAIN_CONFIG.analysisFitModel, "google/gemini-decision-1");
  assert.equal(INSTAGRAM_BRAIN_CONFIG.analysisFitUseVideo, true);
  assert.equal(INSTAGRAM_BRAIN_CONFIG.topOpportunitiesMinPriority, 67);
  assert.equal(INSTAGRAM_BRAIN_CONFIG.minPriorityScoreForAngles, 60, "angle cut stays 60");
  const rid = "TEST_2";
  const svGood = { answers: {
    [`${rid}__strategic_fit`]: { choice: "core", confidence: 0.65, probabilities: { core: 0.65, supporting: 0.24, adjacent: 0.11 } },
    [`${rid}__visual_pattern_value`]: { noul: 0.9 },
    [`${rid}__workflow_value`]: { noul: 0.2 },
    [`${rid}__best_execution_mode`]: { choice: "visual_storyteller" },
  } };
  const svJev = { answers: {
    [`${rid}__strategic_fit`]: { choice: "core", confidence: 0.98, probabilities: { core: 0.98, supporting: 0.02 } },
    [`${rid}__visual_pattern_value`]: { noul: 0.8 },
    [`${rid}__workflow_value`]: { noul: 0.1 },
    [`${rid}__best_execution_mode`]: { choice: "both" },
  } };
  // Parsing: same mapping as before (expected value over core 100 / supporting 65 / adjacent 30 / irrelevant 0).
  assert.deepEqual(parseSourceValueResponse(svGood, rid), { fit: "Core", fitScore: 83.9, confidence: 0.65, visualValue: 0.9, workflowValue: 0.2, recommendedMode: "Visual Storyteller" });
  assert.throws(() => parseSourceValueResponse({ answers: {} }, rid), /no valid strategic_fit/);
  assert.throws(() => parseSourceValueResponse({ answers: { [`${rid}__strategic_fit`]: { choice: "core" } } }, rid), /visual\/workflow/);
  // Lenient (Jev) parsing keeps the old defaults.
  assert.deepEqual(parseSourceValueResponse({ answers: {} }, rid, false), { fit: "Irrelevant", fitScore: 0, confidence: 0, visualValue: 0, workflowValue: 0, recommendedMode: "Neither" });
  const svInput = { shortcode: "TEST-2", recordId: rid, videoUrl: "https://x/v.mp4", state: { description: "d", records: [{ id: rid }] } };
  // a) Gemini + video decides; same questions as prod; fit-decision cost.
  {
    const ledger = new CostLedger("t", Infinity, () => undefined);
    const { calls, decide } = mkDecide({ "google/gemini-decision-1": () => ({ ...svGood, usage: { cost: 0.0006 } }) });
    const r = await runSourceValueDecision(svInput, ledger, { decide, ...videoDeps });
    assert.equal(r.fit, "Core");
    assert.deepEqual(r.decidedBy, { model: "google/gemini-decision-1", mode: "video", videoBytes: 50_000 });
    assert.equal(calls.length, 1);
    assert.deepEqual(Object.keys(calls[0].opts).sort(), ["costKind", "label", "ledger", "model", "timeoutMs"]);
    assert.ok(Array.isArray(calls[0].state) && calls[0].state[1].type === "video_url");
    assert.deepEqual(calls[0].state[0], svInput.state);
    assert.equal(ledger.entries[0].kind, "fit-decision");
  }
  // b) Video unavailable / no URL / Gemini error / junk -> Jev text with the old lenient parse.
  for (const deps of [
    { download: async () => { throw new Error("Video download failed (403)"); } },
    { ...videoDeps, gem: () => new Error("Decision call timed out after 60000ms (google/gemini-decision-1)") },
    { ...videoDeps, gem: () => ({ answers: { [`${rid}__strategic_fit`]: { choice: "core" } } }) },
  ] as any[]) {
    const { calls, decide } = mkDecide({ "google/gemini-decision-1": deps.gem || (() => svGood), "typesafe/jev-1.13": () => svJev });
    const r = await runSourceValueDecision(svInput, undefined, { decide, ...deps });
    assert.equal(r.decidedBy.model, "typesafe/jev-1.13");
    assert.equal(r.decidedBy.mode, "text");
    assert.ok(r.decidedBy.fallbackReason);
    assert.equal(r.recommendedMode, "Both");
    assert.equal(r.fitScore, 99.3);
    assert.deepEqual(calls[calls.length - 1].state, svInput.state, "Jev gets the plain text state");
    assert.equal(calls[calls.length - 1].opts.label, "jev source value TEST-2 (fallback)");
  }
  {
    const { decide } = mkDecide({ "typesafe/jev-1.13": () => svJev });
    const r = await runSourceValueDecision({ ...svInput, videoUrl: "" }, undefined, { decide });
    assert.match(r.decidedBy.fallbackReason!, /no Video URL/);
  }
  // c) Budget errors not swallowed.
  {
    const { decide } = mkDecide({ "google/gemini-decision-1": () => new BudgetExceededError("t", 0.01, 0.01, 0.005, "x"), "typesafe/jev-1.13": () => svJev });
    await assert.rejects(runSourceValueDecision(svInput, undefined, { decide, ...videoDeps }), /Spending cap reached/);
  }
  // d) Rollback: IG_BRAIN_ANALYSIS_FIT_MODEL = a Jev model -> exactly the old single Jev text call.
  {
    const { calls, decide } = mkDecide({ "typesafe/jev-1.13": () => svJev });
    const r = await runSourceValueDecision(svInput, undefined, { decide, download: async () => { throw new Error("should not download"); }, config: { analysisFitModel: "typesafe/jev-1.13" } });
    assert.deepEqual(r.decidedBy, { model: "typesafe/jev-1.13", mode: "text" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.label, "jev source value TEST-2");
    assert.deepEqual(calls[0].state, svInput.state);
  }
  // e) Text-only switch.
  {
    const { calls, decide } = mkDecide({ "google/gemini-decision-1": () => svGood });
    const r = await runSourceValueDecision(svInput, undefined, { decide, download: async () => { throw new Error("should not download"); }, config: { analysisFitUseVideo: false } });
    assert.deepEqual(r.decidedBy, { model: "google/gemini-decision-1", mode: "text" });
    assert.deepEqual(calls[0].state, svInput.state);
  }
  // Questions are the prod source-value questions.
  assert.deepEqual(Object.keys(buildSourceValueQuestions(rid)).sort(), [`${rid}__best_execution_mode`, `${rid}__strategic_fit`, `${rid}__visual_pattern_value`, `${rid}__workflow_value`]);

  // ---- Priority follows refreshed Performance (stale Priority fix) ----
  const { refreshedPriorityScore, calculatePriorityScore } = await import("../src/lib/instagram-brain/scoring");
  const analysed = { priorityScore: 75.6, strategicFitScore: 64.3, visualPatternValue: 0.92, workflowValue: 0.7, geminiAnalysis: "{...}" };
  const p = refreshedPriorityScore(analysed, 54.1)!;
  assert.equal(p, calculatePriorityScore({ performanceScore: 54.1, strategicFitScore: 64.3, visualPatternValue: 0.92, workflowValue: 0.7 }).priorityScore);
  assert.equal(p, Math.round((54.1 * 0.45 + 64.3 * 0.3 + 92 * 0.25) * 10) / 10);
  assert.equal(refreshedPriorityScore({ priorityScore: 0, strategicFitScore: 65, visualPatternValue: 0, workflowValue: 0, geminiAnalysis: "" }, 80), null, "never analysed -> Priority untouched");

  console.log("fit-check tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
