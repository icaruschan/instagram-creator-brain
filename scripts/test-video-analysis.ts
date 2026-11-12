import assert from "node:assert/strict";

// Hermetic: no cost-log file, no network, default provider config.
process.env.IG_BRAIN_COST_LOG_FILE = "";
delete process.env.VIDEO_ANALYSIS_PROVIDER;
delete process.env.VIDEO_ANALYSIS_FALLBACK;
delete process.env.VIDEO_ANALYSIS_SEND_MODE;

async function main() {
  const { INSTAGRAM_BRAIN_CONFIG } = await import("../src/lib/instagram-brain/config");
  const { CostLedger, estimateCost, estimateVideoAnalysisCost } = await import("../src/lib/instagram-brain/cost");
  const { retryTransient, withTimeout, statusOf, isTransient, HttpStatusError, RequestTimeoutError } = await import("../src/lib/instagram-brain/retry");
  const { buildOpenRouterVideoRequest, buildAnalysisContext, sniffVideoMime, toDataUrl } = await import("../src/lib/instagram-brain/openrouter-video");
  const { ANALYSIS_PROMPT, parseAnalysisJson } = await import("../src/lib/instagram-brain/gemini");
  const { isFlaggedTrialReel } = await import("../src/lib/apify");
  const { estimatedAnalysisCost } = await import("../src/trigger/instagram-creator-brain/scan-reels");

  // Defaults: OpenRouter + Qwen Omni, base64 data URL, 120s timeout, no paid fallback.
  assert.equal(INSTAGRAM_BRAIN_CONFIG.videoAnalysisProvider, "openrouter");
  assert.equal(INSTAGRAM_BRAIN_CONFIG.openrouterVideoModel, "qwen/qwen3.8-omni-flash");
  assert.equal(INSTAGRAM_BRAIN_CONFIG.openrouterVideoSendMode, "data-url");
  assert.equal(INSTAGRAM_BRAIN_CONFIG.videoAnalysisTimeoutMs, 120_000);
  assert.equal(INSTAGRAM_BRAIN_CONFIG.videoAnalysisFallback, "none");
  assert.equal(estimateVideoAnalysisCost(), estimateCost("openrouter-video-analysis"));
  assert.ok(estimatedAnalysisCost() < 0.02, "Qwen analysis + Jev should estimate under $0.02");

  // Request shape follows OpenRouter's Chat Completions video docs, with the same prompt as Gemini.
  const context = buildAnalysisContext({ caption: "cap", transcript: "tr" });
  assert.ok(context.startsWith(ANALYSIS_PROMPT));
  assert.match(context, /SOURCE CAPTION:\ncap/);
  const request = buildOpenRouterVideoRequest("qwen/qwen3.8-omni-flash", "data:video/mp4;base64,AAAA", context);
  const parts = (request.messages[0] as any).content;
  assert.deepEqual(parts[0], { type: "video_url", video_url: { url: "data:video/mp4;base64,AAAA" } });
  assert.equal(parts[1].type, "text");
  assert.deepEqual(request.usage, { include: true });
  assert.deepEqual(request.reasoning, { max_tokens: 1024, exclude: true });
  assert.deepEqual(buildOpenRouterVideoRequest("m", "u", "c", 0).reasoning, { enabled: false });

  // Data URL + MIME sniffing.
  const mp4 = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypisom"), 0, 0, 0, 0]);
  assert.equal(sniffVideoMime(mp4), "video/mp4");
  assert.equal(sniffVideoMime(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0])), "video/webm");
  assert.ok(toDataUrl(mp4).startsWith("data:video/mp4;base64,"));

  // Same JSON parser for both providers (handles fences and <think> blocks).
  assert.equal(parseAnalysisJson("<think>x</think>```json\n{\"summary\":\"ok\"}\n```").summary, "ok");

  // Status detection across SDK shapes.
  assert.equal(statusOf(new HttpStatusError("x", 429)), 429);
  assert.equal(statusOf(new Error("503 gemini-3.8-flash is currently experiencing high demand")), 503);
  assert.equal(statusOf({ status: 500 }), 500);
  assert.ok(isTransient(new HttpStatusError("x", 503)));
  assert.ok(!isTransient(new HttpStatusError("x", 400)));
  assert.ok(!isTransient(new RequestTimeoutError("x", 1)));

  // Retry: transient errors back off and retry; others fail at once; attempts are capped.
  const sleeps: number[] = [];
  const sleep = async (ms: number) => { sleeps.push(ms); };
  let calls = 0;
  const value = await retryTransient(async () => {
    calls += 1;
    if (calls < 3) throw new HttpStatusError("busy", calls === 1 ? 429 : 503);
    return "done";
  }, { label: "t", maxAttempts: 3, baseDelayMs: 1000, sleep });
  assert.equal(value, "done");
  assert.equal(calls, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[1] > sleeps[0] * 1.2, "backoff grows");
  calls = 0;
  await assert.rejects(retryTransient(async () => { calls += 1; throw new HttpStatusError("bad", 400); }, { label: "t", maxAttempts: 3, sleep }), /bad/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(retryTransient(async () => { calls += 1; throw new HttpStatusError("busy", 503); }, { label: "t", maxAttempts: 2, sleep }), /busy/);
  assert.equal(calls, 2);
  const retryAfterSleeps: number[] = [];
  await assert.rejects(retryTransient(async () => { throw new HttpStatusError("slow", 429, 7); }, { label: "t", maxAttempts: 2, baseDelayMs: 1, sleep: async (ms) => { retryAfterSleeps.push(ms); } }));
  assert.equal(retryAfterSleeps[0], 7000, "Retry-After is honoured");

  // Timeout fires and aborts the signal.
  let aborted = false;
  await assert.rejects(
    withTimeout("slow call", 20, (signal) => new Promise((resolve) => { signal.addEventListener("abort", () => { aborted = true; }); setTimeout(resolve, 500); })),
    RequestTimeoutError,
  );
  assert.ok(aborted);

  // Ledger takes the provider's real cost and $0 for rejected attempts.
  const ledger = new CostLedger("t", 0.25, () => undefined);
  ledger.record("openrouter-video-analysis", "rejected 503", 0.015, 0);
  ledger.record("openrouter-video-analysis", "ok", 0.015, 0.0042);
  assert.equal(ledger.summary().byKind["openrouter-video-analysis"], 0.0042);

  // Trial Reel backstop flags.
  assert.ok(isFlaggedTrialReel({ isTrialReel: true }));
  assert.ok(!isFlaggedTrialReel({ url: "x" }));

  console.log("Video analysis tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
