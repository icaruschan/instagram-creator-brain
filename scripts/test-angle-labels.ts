import assert from "node:assert/strict";

process.env.IG_BRAIN_COST_LOG_FILE = "";

async function main() {
  const { normalizeAngles, normalizePillar, normalizeContentType, ensureVisualHook } = await import("../src/lib/instagram-brain/angles");
  const source = { pillar: "Creative Operator", contentType: "Commentary" };

  // 1. Each angle keeps its own validated Pillar / Content Type (the DfnxvIiIBgI bug: all 3 inherited the source labels).
  const raw = {
    angles: [
      { title: "I Tested AI's Honesty", visualHook: "Phone screen", deliveryProfile: "Hybrid", pillar: "Creative Operator", contentType: "Tool/Model Test" },
      { title: "60-Second Film", visualHook: "Prompt typed", deliveryProfile: "Operator-first", pillar: "creative operator", contentType: "AI Creative Workflow" },
      { title: "The Bench at 6 AM", deliveryProfile: "Visual-first", spokenHook: "", textHook: "", visualHook: "", threeBeatOutline: ["Lone figure on a park bench at blue hour", "b", "c"], pillar: "Visual Storyteller", contentType: "Creative AI Video" },
    ],
  };
  const angles = normalizeAngles(raw, source);
  assert.deepEqual(angles.map((a) => [a.pillar, a.contentType]), [
    ["Creative Operator", "Tool/Model Test"],
    ["Creative Operator", "AI Creative Workflow"],
    ["Visual Storyteller", "Creative AI Video"],
  ]);

  // 2. Missing or invalid labels fall back to the source Reel's labels (only then).
  const fb = normalizeAngles({ angles: [{ title: "x", visualHook: "v" }, { title: "y", visualHook: "v", pillar: "Lifestyle", contentType: "Vlog" }] }, source);
  assert.deepEqual(fb.map((a) => [a.pillar, a.contentType]), [["Creative Operator", "Commentary"], ["Creative Operator", "Commentary"]]);
  // Mixed: valid pillar kept, invalid type falls back.
  const mixed = normalizeAngles({ angles: [{ title: "z", visualHook: "v", pillar: "Storytelling", contentType: "nonsense" }] }, source);
  assert.equal(mixed[0].pillar, "Storytelling");
  assert.equal(mixed[0].contentType, "Commentary");
  // No fallback and nothing valid: empty, so Notion select is left unset.
  const none = normalizeAngles({ angles: [{ title: "z", visualHook: "v", pillar: "??" }] });
  assert.equal(none[0].pillar, "");
  assert.equal(none[0].contentType, "");
  // Invalid fallback values are not written either.
  assert.equal(normalizeAngles({ angles: [{ title: "z" }] }, { pillar: "Old Pillar", contentType: "Old" })[0].pillar, "");

  // 3. Label normalisation: case, spacing, "AI " prefix, legacy names.
  assert.equal(normalizePillar("AI Visual Storyteller"), "Visual Storyteller");
  assert.equal(normalizePillar("  storytelling "), "Storytelling");
  assert.equal(normalizePillar("AI Creative Operator"), "Creative Operator");
  assert.equal(normalizePillar(42), "");
  assert.equal(normalizeContentType("tool/model test"), "Tool/Model Test");
  assert.equal(normalizeContentType("Creative AI Video"), "Creative AI Video");
  assert.equal(normalizeContentType("AI Tools & Model Experiments"), "Tool/Model Test");
  assert.equal(normalizeContentType("AI & Creative Commentary"), "Commentary");
  assert.equal(normalizeContentType("Creator Automation"), "Creator Automation");

  // 4. Visual-first angles always get a non-empty hook.
  const bench = angles[2];
  assert.ok(bench.visualHook.length > 0, "visual-first angle must have a visual hook");
  assert.match(bench.visualHook, /park bench/);
  // Falls back to summary, then title, when there are no beats.
  const noBeats = normalizeAngles({ angles: [{ title: "Quiet Room", summary: "AI dust motes become constellations", deliveryProfile: "Visual-first" }] })[0];
  assert.match(noBeats.visualHook, /constellations/);
  const titleOnly = normalizeAngles({ angles: [{ title: "Quiet Room", deliveryProfile: "Visual-first" }] })[0];
  assert.match(titleOnly.visualHook, /Quiet Room/);
  // A text hook alone counts as a hook; existing visual hooks are untouched.
  const textOnly = normalizeAngles({ angles: [{ title: "t", textHook: "Watch the sky", deliveryProfile: "Visual-first" }] })[0];
  assert.equal(textOnly.visualHook, "");
  assert.equal(textOnly.textHook, "Watch the sky");
  const kept = ensureVisualHook({ ...bench, visualHook: "Custom" });
  assert.equal(kept.visualHook, "Custom");
  for (const a of normalizeAngles(raw, source).filter((x) => x.deliveryProfile === "Visual-first")) {
    assert.ok(a.visualHook || a.textHook);
  }

  console.log("angle label + visual hook tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
