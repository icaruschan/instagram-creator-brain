import type { DeliveryProfile } from "./config";

export const BRIEF_MARKER = "CREATIVE BRIEF · DRAFT — not yet produced";
export const PRODUCTION_PLAN_TITLE = "🛠 Production plan · expand for the shot guide";
export const SCRIPT_DATA_TITLE = "▶️ Full Script Package";
export const BLUEPRINT_DATA_TITLE = "▶️ Full Production Blueprint";

type Json = Record<string, any>;

const asText = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const rt = (value: string) => [{ type: "text" as const, text: { content: value.slice(0, 2000) } }];
const block = (type: string, value: string): any => ({ object: "block", type, [type]: { rich_text: rt(value) } });
const bullet = (value: string): any => block("bulleted_list_item", value);

function promisesUnavailableResource(value: string): boolean {
  return /(comment|dm|message|reply).{0,70}(?:send|share|give|for).{0,70}(prompt|template|guide|pack|workflow)/i.test(value)
    || /(?:i'll|i will|we'll|we will).{0,35}(send|dm|share|give).{0,60}(prompt|template|guide|pack|workflow)/i.test(value)
    || /(?:get|grab|download|link in bio).{0,60}(prompt|template|guide|pack|workflow)/i.test(value);
}

function claimsCompletedProduction(value: string): boolean {
  return /\b(?:I|we)\s+(?:asked AI|made|built|generated|created|rendered|finished)\b/i.test(value);
}

export function normalizeScriptPackage(raw: Json, title: string): Json {
  const beats = Array.isArray(raw.beats) ? raw.beats : [];
  const captions = (Array.isArray(raw.captionOptions) ? raw.captionOptions : [])
    .map(asText).filter((value) => value && !claimsCompletedProduction(value));
  const ctas = (Array.isArray(raw.ctaOptions) ? raw.ctaOptions : [])
    .map(asText).filter((value) => value && !promisesUnavailableResource(value));
  return {
    ...raw,
    beats,
    captionOptions: captions.length ? captions : [`${title} — which version would you want to see?`],
    ctaOptions: ctas.length ? ctas : ["Which version should I explore next?"],
    audit: {
      muteTest: "Check the finished cut without sound: is the subject and payoff understandable?",
      radioTest: "Listen to the finished cut without the screen: does the spoken premise make sense?",
      combinedTest: "Review the finished cut: do text, visuals, voice, and sound point to one idea?",
      factDiscipline: "Before posting, verify tool use, achieved results, caption claims, and any promised resource.",
    },
  };
}

const cleanCheck = (value: unknown): string => asText(value)
  .replace(/^\s*(verified|passed|confirmed)\s*:\s*/i, "")
  .replace(/\b(?:is|are) verified\b/gi, "needs checking")
  .replace(/\b(?:verified|passed|confirmed)\b/gi, "to check");

function neutralizeUnselectedTool(value: string): string {
  return value.replace(/\b(?:Higgsfield(?:\s+Seedance(?:\s+\d+(?:\.\d+)?)?)?|Seedance(?:\s+\d+(?:\.\d+)?)?|Runway|Kling|Veo|Sora|Pika|Luma)\b/gi, "the chosen AI video tool");
}

function complexityFromPlan(raw: Json): "Low" | "Medium" | "High" {
  if (["Low", "Medium", "High"].includes(raw.complexity)) return raw.complexity;
  const shots = Array.isArray(raw.shotPlan) ? raw.shotPlan.length : 0;
  const assets = Array.isArray(raw.requiredAssets) ? raw.requiredAssets.length : 0;
  return shots >= 6 || assets >= 10 ? "High" : shots >= 3 || assets >= 5 ? "Medium" : "Low";
}

export function normalizeBlueprint(raw: Json): Json {
  const { blockers, qualityChecklist, estimatedProductionMinutes, ...safeRaw } = raw;
  const legacy = Array.isArray(blockers) ? blockers.map(asText) : [];
  const risks = (Array.isArray(raw.productionRisks) ? raw.productionRisks : legacy)
    .map(asText).map(neutralizeUnselectedTool).filter(Boolean).filter((value) => !/caption\/CTA selection/i.test(value)).slice(0, 5);
  const decisions = (Array.isArray(raw.decisionsNeeded) ? raw.decisionsNeeded : [])
    .map(asText).filter(Boolean).slice(0, 4);
  const checks = (Array.isArray(raw.preflightChecklist) ? raw.preflightChecklist : qualityChecklist || [])
    .map(cleanCheck).filter(Boolean).slice(0, 8);
  const complexity = complexityFromPlan(raw);
  return {
    ...safeRaw,
    shotPlan: Array.isArray(raw.shotPlan) ? raw.shotPlan.map(({ proof, ...shot }: Json) => shot) : [],
    requiredAssets: Array.isArray(raw.requiredAssets) ? raw.requiredAssets.map((asset: Json) => ({
      ...asset,
      name: neutralizeUnselectedTool(asText(asset.name)),
      purpose: neutralizeUnselectedTool(asText(asset.purpose)),
    })) : [],
    editingRhythm: Array.isArray(raw.editingRhythm) ? raw.editingRhythm.map((value: unknown) => neutralizeUnselectedTool(asText(value))) : [],
    productionRisks: risks,
    decisionsNeeded: decisions,
    complexity,
    complexityReason: asText(raw.complexityReason) || (
      complexity === "High" ? "Several distinct shots, assets, or transitions need testing."
        : complexity === "Medium" ? "A few production elements need coordination." : "A compact production with few dependencies."
    ),
    preflightChecklist: checks,
    toolCandidates: Array.isArray(raw.toolCandidates) ? raw.toolCandidates : [],
  };
}

export function renderCreativeBrief(input: {
  account: string;
  deliveryProfile: DeliveryProfile;
  summary: string;
  script: Json;
}): any[] {
  const { account, deliveryProfile, summary, script } = input;
  const visualFirst = deliveryProfile === "Visual-first";
  const blocks: any[] = [
    { object: "block", type: "callout", callout: {
      rich_text: rt(`${BRIEF_MARKER}\n${account} · ${deliveryProfile} · ${Number(script.durationSeconds) || "Flexible"}s`),
      icon: { type: "emoji", emoji: "🎬" },
    } },
    block("heading_2", "At a glance"),
    block("paragraph", summary ? `Proposed concept: ${summary}` : "An original AI-creative Reel concept. Review the timed draft below before production."),
    block("heading_2", visualFirst ? "Visual script · mostly silent" : "Spoken script"),
  ];
  if (visualFirst) {
    blocks.push(block("paragraph", `Voiceover: ${asText(script.spokenScript) || "None planned. Visuals and on-screen text carry the story."}`));
  } else {
    blocks.push(block("paragraph", asText(script.spokenScript) || "No spoken copy supplied; review before production."));
    blocks.push(block("heading_3", "Timed visual and audio cues"));
  }
  for (const beat of script.beats || []) {
    const lines = [
      `${asText(beat.time) || "Beat"} — ${asText(beat.visual) || "Visual to define"}`,
      `Voice: ${asText(beat.spoken) || "—"}`,
      `On-screen: ${asText(beat.text) || "—"}`,
      `Sound: ${asText(beat.audio) || "—"}`,
    ];
    blocks.push(bullet(lines.join("\n")));
  }
  blocks.push(
    block("heading_2", "Caption and CTA · drafts"),
    bullet(`Caption: ${asText(script.captionOptions?.[0]) || "Write after production."}`),
    bullet(`CTA: ${asText(script.ctaOptions?.[0]) || "Optional."}`),
    { object: "block", type: "toggle", toggle: {
      rich_text: rt(PRODUCTION_PLAN_TITLE),
    } },
    { object: "block", type: "divider", divider: {} },
    block("paragraph", "Internal automation data is kept below for the workflow; the creative brief above is the working version."),
  );
  return blocks;
}

export function renderProductionPlan(raw: Json): any[] {
  const plan = normalizeBlueprint(raw);
  const assets = (Array.isArray(plan.requiredAssets) ? plan.requiredAssets : [])
    .map((asset: any) => asText(asset.name)).filter(Boolean);
  const editing = (Array.isArray(plan.editingRhythm) ? plan.editingRhythm : [])
    .map(asText).filter(Boolean).slice(0, 5);
  const blocks: any[] = [
    { object: "block", type: "callout", callout: {
      rich_text: rt(`Complexity: ${plan.complexity} — ${plan.complexityReason}\nThis is a production estimate, not a completed render or an hour estimate.`),
      icon: { type: "emoji", emoji: "🛠️" },
    } },
    block("heading_3", "Assets to prepare"),
    ...(assets.length ? assets.map(bullet) : [bullet("Confirm the required visual, audio, and reference assets.")]),
    block("heading_3", "Edit notes"),
    ...(editing.length ? editing.map(bullet) : [bullet("Match the cut rhythm to the timed script; test transitions before final assembly.")]),
    block("heading_3", "Production risks · not automatic blockers"),
    ...(plan.productionRisks.length ? plan.productionRisks.map(bullet) : [bullet("No specific risk identified yet; test the first render before proceeding.")]),
    block("heading_3", "Decisions needed"),
    ...(plan.decisionsNeeded.length ? plan.decisionsNeeded.map(bullet) : [bullet("Confirm the production tool and final creative treatment before generation.")]),
  ];
  if (plan.toolCandidates.length) {
    const candidate = plan.toolCandidates[0];
    const name = asText(typeof candidate === "string" ? candidate : candidate?.name);
    if (name) blocks.push(bullet(`Tool candidate to confirm: ${name}. This is not a selected or verified production tool.`));
  }
  blocks.push(block("heading_3", "Preflight checks · unchecked until footage exists"));
  for (const item of plan.preflightChecklist) {
    blocks.push({ object: "block", type: "to_do", to_do: { rich_text: rt(item), checked: false } });
  }
  return blocks;
}
