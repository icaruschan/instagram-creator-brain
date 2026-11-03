import assert from "node:assert/strict";
import {
  BRIEF_MARKER,
  PRODUCTION_PLAN_TITLE,
  normalizeBlueprint,
  normalizeScriptPackage,
  renderCreativeBrief,
  renderProductionPlan,
} from "../src/lib/instagram-brain/production-brief";

function visibleText(blocks: any[]): string {
  return blocks.flatMap((block) => [
    (block[block.type]?.rich_text || []).map((part: any) => part.text?.content || "").join(""),
    ...(block[block.type]?.children || []).map((child: any) => visibleText([child])),
  ]).join("\n");
}

const rawScript = {
  spokenScript: "What if I could visit another era?",
  durationSeconds: 24,
  beats: [{ time: "0–3s", visual: "A door opens onto another world.", spoken: "What if I could visit another era?", text: "One door, many worlds", audio: "Door sound" }],
  captionOptions: ["I made seven AI worlds", "Which era should I explore?"],
  ctaOptions: ["Comment ERA and I'll send the prompt stack", "Comment DOOR for the generation prompts", "Get the free prompt pack", "Which era comes next?"],
  audit: { muteTest: "Passed. Looks good.", radioTest: "Verified." },
};
const script = normalizeScriptPackage(rawScript, "Seven eras");
assert.deepEqual(script.captionOptions, ["Which era should I explore?"]);
assert.deepEqual(script.ctaOptions, ["Which era comes next?"]);
assert.doesNotMatch(JSON.stringify(script.audit), /Passed|Verified/i);

for (const profile of ["Visual-first", "Operator-first", "Hybrid"] as const) {
  const blocks = renderCreativeBrief({ account: "Alisha", deliveryProfile: profile, summary: "A proposed AI-era Reel.", script });
  const text = visibleText(blocks);
  assert.match(text, new RegExp(BRIEF_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(text, /At a glance/);
  assert.match(text, /A door opens onto another world/);
  assert.match(text, /Voice:/);
  assert.match(text, /On-screen:/);
  assert.match(text, /Sound:/);
  assert.match(text, new RegExp(PRODUCTION_PLAN_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(text, /\{\s*"spokenScript"/);
  assert.doesNotMatch(text, /prompt stack|Passed|Verified/i);
  if (profile === "Visual-first") assert.match(text, /Visual script · mostly silent/);
  else assert.match(text, /Spoken script/);
}

const blueprint = normalizeBlueprint({
  shotPlan: Array.from({ length: 7 }, (_, index) => ({ order: index + 1 })),
  requiredAssets: [{ name: "Higgsfield Seedance identity reference" }, { name: "Door transition" }],
  blockers: ["Test face consistency", "Caption/CTA selection should be finalized"],
  qualityChecklist: ["Verified: face consistency across every transition", "The final composite passed the mute test"],
  editingRhythm: ["Cut on the door swing"],
  estimatedProductionMinutes: 540,
});
assert.equal(blueprint.complexity, "High");
assert.deepEqual(blueprint.productionRisks, ["Test face consistency"]);
assert.equal(blueprint.estimatedProductionMinutes, undefined);
assert.doesNotMatch(blueprint.requiredAssets[0].name, /Higgsfield|Seedance/i);
const guide = renderProductionPlan(blueprint);
const guideText = visibleText(guide);
assert.match(guideText, /Complexity: High/);
assert.match(guideText, /Production risks · not automatic blockers/);
assert.match(guideText, /Preflight checks · unchecked until footage exists/);
assert.doesNotMatch(guideText, /Verified:|540 minutes/);
assert.doesNotMatch(guideText, /\bPassed\b/i);
assert.ok(guide.filter((item) => item.type === "to_do").every((item) => item.to_do.checked === false));

console.log("Production brief tests passed.");
