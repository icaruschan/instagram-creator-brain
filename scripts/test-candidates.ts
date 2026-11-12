import assert from "node:assert/strict";
import { freshSlotCount, planCandidateSlots, recheckReason, type SlotEntry } from "../src/lib/instagram-brain/candidates";

// --- recheckReason ---
const base = { pinned: false, publishedAt: "2026-11-07T00:49:00Z", status: "Raw", strategicFit: "", geminiAnalysis: "", shortcode: "Dfa7cDzIgxF" };
const opts = { ageDays: 5, windowDays: 14, performanceScore: 93.6, minPerformanceScore: 60, blocked: new Set(["DarI4g8hBMc"]) };
assert.equal(recheckReason(base, opts), "never-fit-checked"); // Raw baseline row like Dfa7cDzIgxF
assert.equal(recheckReason(base, { ...opts, performanceScore: 20 }), "never-fit-checked"); // fit check doesn't need a score; the gate does
assert.equal(recheckReason({ ...base, pinned: true }, opts), null);
assert.equal(recheckReason(base, { ...opts, ageDays: 15 }), null); // outside window
assert.equal(recheckReason(base, { ...opts, ageDays: null }), null); // undated
assert.equal(recheckReason({ ...base, shortcode: "DarI4g8hBMc" }, opts), null); // blocked (trashed)
assert.equal(recheckReason({ ...base, status: "Ignored", strategicFit: "Irrelevant" }, opts), null);
assert.equal(recheckReason({ ...base, status: "Ignored" }, opts), null);
assert.equal(recheckReason({ ...base, status: "Failed" }, opts), null);
assert.equal(recheckReason({ ...base, geminiAnalysis: "{\"summary\":\"x\"}" }, opts), null); // already analysed
const fitted = { ...base, status: "Qualified", strategicFit: "Supporting" };
assert.equal(recheckReason(fitted, { ...opts, performanceScore: 77.5 }), "fit-ok-not-analysed"); // e.g. DfnxvIiIBgI
assert.equal(recheckReason(fitted, { ...opts, performanceScore: 59.9 }), null); // still below the cut-off
assert.equal(recheckReason({ ...fitted, strategicFit: "Core" }, { ...opts, performanceScore: 60 }), "fit-ok-not-analysed");
assert.equal(recheckReason({ ...fitted, strategicFit: "Adjacent" }, opts), null);
assert.equal(recheckReason({ ...fitted, strategicFit: "Core", geminiAnalysis: "done" }, opts), null);

// --- planCandidateSlots ---
assert.equal(freshSlotCount(8), 2);
assert.equal(freshSlotCount(3), 1);
assert.equal(freshSlotCount(0), 0);
const day = 86_400_000;
const t0 = Date.parse("2026-11-12T00:00:00Z");
const n = (key: string, performanceScore: number, daysAgo: number): SlotEntry => ({ key, source: "new", performanceScore, publishedTime: t0 - daysAgo * day });
const r = (key: string, performanceScore: number, daysAgo: number): SlotEntry => ({ key, source: "recheck", performanceScore, publishedTime: t0 - daysAgo * day });

// 2 newest NEW are guaranteed even with low scores; the other 6 go by Performance across both pools.
const fresh = [n("n1", 20, 0.1), n("n2", 30, 0.5), n("n3", 80, 3), n("n4", 10, 4), n("n5", 55, 6)];
const rechecks = [r("r1", 93.6, 5), r("r2", 77.5, 1), r("r3", 71.5, 2), r("r4", 62.5, 4), r("r5", 40, 7), r("r6", 35, 9)];
const plan = planCandidateSlots(8, fresh, rechecks);
assert.equal(plan.picked.length, 8);
assert.deepEqual(plan.picked.slice(0, 2).map((p) => [p.key, p.slot]), [["n1", "fresh"], ["n2", "fresh"]]);
assert.deepEqual(plan.picked.slice(2).map((p) => p.key), ["r1", "n3", "r2", "r3", "r4", "n5"]);
assert.deepEqual(plan.overflow, { new: 1, recheck: 2 });

// Tie on Performance: NEW wins, then the newer post.
const tie = planCandidateSlots(4, [n("a", 10, 0), n("b", 50, 2)], [r("c", 50, 1), r("d", 50, 0.5)]);
assert.deepEqual(tie.picked.map((p) => p.key), ["a", "b", "d", "c"]);
const tie3 = planCandidateSlots(3, [n("a", 10, 0), n("b", 50, 2)], [r("c", 50, 1), r("d", 50, 0.5)]);
assert.deepEqual(tie3.picked.map((p) => p.key), ["a", "b", "d"]);

// No NEW Reels → all slots by Performance among rechecks; fewer candidates than slots → take all.
assert.deepEqual(planCandidateSlots(8, [], [r("x", 10, 1), r("y", 90, 2)]).picked.map((p) => p.key), ["y", "x"]);
assert.equal(planCandidateSlots(8, [], []).picked.length, 0);
// Only NEW Reels → behaves like before (newest guaranteed, rest by score).
assert.deepEqual(planCandidateSlots(3, [n("a", 90, 3), n("b", 10, 0), n("c", 50, 1)], []).picked.map((p) => p.key), ["b", "a", "c"]);
// No duplicates.
assert.equal(new Set(plan.picked.map((p) => p.key)).size, plan.picked.length);

console.log("Candidate slot + recheck tests passed.");
