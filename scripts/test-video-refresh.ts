import assert from "node:assert/strict";

// Hermetic: no network, no Notion, no cost-log file.
process.env.IG_BRAIN_COST_LOG_FILE = "";

async function main() {
  const { videoUrlExpiry, isVideoUrlExpired, isVideoUrlError, ReelVideoRefresher } = await import("../src/lib/instagram-brain/video-refresh");
  const { CostLedger, BudgetExceededError, estimateCost } = await import("../src/lib/instagram-brain/cost");
  const { prepareFitVideoWithRefresh, runFitCheck } = await import("../src/lib/instagram-brain/fit-check");

  const now = new Date("2026-11-20T00:00:00Z");
  const hex = (d: Date) => Math.floor(d.getTime() / 1000).toString(16).toUpperCase();
  const cdn = (d: Date) => `https://instagram.fxyz1-1.fna.fbcdn.net/o1/v/t2/f2/m86/abc.mp4?_nc_cat=1&oh=00_x&oe=${hex(d)}`;
  const past = cdn(new Date(now.getTime() - 3_600_000));
  const soon = cdn(new Date(now.getTime() + 5 * 60_000));
  const later = cdn(new Date(now.getTime() + 6 * 3_600_000));

  // oe= parsing and expiry.
  assert.equal(videoUrlExpiry(later)?.getTime(), Math.floor((now.getTime() + 6 * 3_600_000) / 1000) * 1000);
  assert.equal(videoUrlExpiry("https://example.com/v.mp4"), null);
  assert.equal(videoUrlExpiry("not a url"), null);
  assert.equal(isVideoUrlExpired(past, now), true);
  assert.equal(isVideoUrlExpired(soon, now), true, "inside the 10-minute margin counts as expired");
  assert.equal(isVideoUrlExpired(later, now), false);
  assert.equal(isVideoUrlExpired("", now), true);
  assert.equal(isVideoUrlExpired("https://example.com/v.mp4", now), false, "no oe= -> unknown, use the error path");

  // Dead-link errors vs model errors.
  assert.ok(isVideoUrlError(new Error("Video download failed (403)")));
  assert.ok(isVideoUrlError("video unavailable: Video download failed (410)"));
  assert.ok(isVideoUrlError(new Error("Video analysis failed on openrouter (Video download failed (404)) and fallback gemini (x)")));
  assert.ok(isVideoUrlError(new Error("no Video URL on the Reel")));
  assert.ok(!isVideoUrlError(new Error("OpenRouter video analysis error (504): A Timeout Occurred")));
  assert.ok(!isVideoUrlError(new Error("Video download failed (500)")));

  // Refresher: refreshes an expired link once, saves it, and costs it.
  const calls: string[] = [];
  const saved: any[] = [];
  const ledger = new CostLedger("test", Infinity, () => undefined);
  const deps = {
    now: () => now,
    fetchFresh: async (url: string, code: string, l?: any) => {
      calls.push(`${url}|${code}`);
      l?.record("apify-reel-refresh", `reel link refresh ${code}`, estimateCost("apify-reel-refresh"), 0.0026);
      return { videoUrl: later, coverUrl: "https://cover/x.jpg" };
    },
    save: async (pageId: string, media: any) => { saved.push({ pageId, ...media }); },
  };
  const reel = { pageId: "p1", shortcode: "Dabc", url: "https://www.instagram.com/p/Dabc/", videoUrl: past };
  const r1 = new ReelVideoRefresher(reel, deps, ledger);
  assert.equal(await r1.ensureFresh(), later);
  assert.deepEqual(calls, ["https://www.instagram.com/p/Dabc/|Dabc"]);
  assert.deepEqual(saved, [{ pageId: "p1", videoUrl: later, coverUrl: "https://cover/x.jpg" }]);
  assert.deepEqual(r1.outcome, { attempted: true, refreshed: true, reason: "oe= expiry passed" });
  assert.equal(ledger.summary().byKind["apify-reel-refresh"], 0.0026);
  // Only one refresh per run.
  assert.equal(await r1.refreshAfterError(new Error("Video download failed (403)")), false);
  assert.equal(calls.length, 1);
  assert.equal(reel.videoUrl, past, "caller's object is not mutated");

  // Fresh link: no refresh before use; refresh after a 403; never for a model error.
  calls.length = 0;
  const r2 = new ReelVideoRefresher({ ...reel, videoUrl: later }, deps, ledger);
  await r2.ensureFresh();
  assert.equal(calls.length, 0);
  assert.equal(await r2.refreshAfterError(new Error("OpenRouter video analysis error (504)")), false);
  assert.equal(calls.length, 0);
  assert.equal(await r2.refreshAfterError(new Error("Video download failed (403)")), true);
  assert.equal(calls.length, 1);

  // Refresh failure: keeps old behaviour, records the reason.
  const r3 = new ReelVideoRefresher(reel, { ...deps, fetchFresh: async () => { throw new Error("actor failed"); } }, ledger);
  assert.equal(await r3.ensureFresh(), past);
  assert.equal(r3.outcome.refreshed, false);
  assert.equal(r3.outcome.error, "actor failed");
  // Budget errors are never swallowed.
  const r4 = new ReelVideoRefresher(reel, { ...deps, fetchFresh: async () => { throw new BudgetExceededError("t", 0, 0, 1, "x"); } }, ledger);
  await assert.rejects(() => r4.ensureFresh(), /Spending cap/);
  // Empty fresh URL = failure, nothing saved.
  saved.length = 0;
  const r5 = new ReelVideoRefresher(reel, { ...deps, fetchFresh: async () => ({ videoUrl: "", coverUrl: "" }) }, ledger);
  await r5.ensureFresh();
  assert.equal(r5.outcome.refreshed, false);
  assert.equal(saved.length, 0);

  // Fit video prep: retries once on the fresh link from the hook.
  const okBytes = new Uint8Array(5_000);
  const downloads: string[] = [];
  const download = async (url: string) => { downloads.push(url); if (url === past) throw new Error("Video download failed (403)"); return okBytes; };
  const shrink = async (b: Uint8Array) => b;
  const video = await prepareFitVideoWithRefresh(past, { download, shrink, refreshVideoUrl: async () => later }, 10 * 1048576);
  assert.equal(video.bytes, 5_000);
  assert.deepEqual(downloads, [past, later]);
  // No fresh link -> original error (-> Jev fallback upstream).
  await assert.rejects(() => prepareFitVideoWithRefresh(past, { download, shrink, refreshVideoUrl: async () => null }, 10 * 1048576), /403/);

  // runFitCheck end to end: dead link -> hook -> fit model watches the video (no Jev fallback).
  const decided: string[] = [];
  const decide = async (_state: any, _q: any, options: any) => {
    decided.push(options.model);
    return { model: options.model, answers: { strategic_fit: { choice: "core", confidence: 0.9, probabilities: { core: 1 } }, pillar: { choice: "visual_storyteller" }, content_type: { choice: "creative_ai_video" } } } as any;
  };
  const fit = await runFitCheck({ shortcode: "Dabc", videoUrl: past, state: {} }, undefined, { decide, download, shrink, refreshVideoUrl: async () => later });
  assert.equal(fit.decidedBy.mode, "video");
  assert.equal(fit.decidedBy.fallbackReason, undefined);
  const fit2 = await runFitCheck({ shortcode: "Dabc", videoUrl: past, state: {} }, undefined, { decide, download, shrink, refreshVideoUrl: async () => null });
  assert.equal(fit2.decidedBy.mode, "text");
  assert.match(fit2.decidedBy.fallbackReason || "", /Video download failed \(403\)/);

  assert.ok(estimateCost("apify-reel-refresh") > 0);
  console.log("video-refresh tests passed");
}

main().catch((error) => { console.error(error); process.exit(1); });
