import assert from "node:assert/strict";

// Hermetic: no network, no cost-log file, default fit config.
process.env.IG_BRAIN_COST_LOG_FILE = "";
delete process.env.IG_BRAIN_FIT_MODEL;
delete process.env.IG_BRAIN_FIT_USE_VIDEO;
delete process.env.IG_BRAIN_FIT_TIMEOUT_MS;
delete process.env.IG_BRAIN_JEV_MODEL;

async function main() {
  const { INSTAGRAM_BRAIN_CONFIG } = await import("../src/lib/instagram-brain/config");
  const { CostLedger, BudgetExceededError, estimateCost } = await import("../src/lib/instagram-brain/cost");
  const { runFitCheck, parseFitResponse, prepareFitVideo, buildFitQuestions, expectedFit, FIT_VALUES } = await import("../src/lib/instagram-brain/fit-check");
  const { STRATEGIC_FIT_CRITERIA } = await import("../src/lib/instagram-brain/jev");

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

  console.log("fit-check tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
