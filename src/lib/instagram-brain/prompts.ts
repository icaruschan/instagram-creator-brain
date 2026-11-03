import { readFileSync } from "node:fs";
import path from "node:path";
import type { DeliveryProfile, ScriptEngine } from "./config";

function loadScriptWriterV23(): string {
  const candidates = [
    path.resolve(process.cwd(), "src/data/scriptwriter-v2.3.md"),
    path.resolve(__dirname, "../../data/scriptwriter-v2.3.md"),
  ];
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // Try the next bundled location.
    }
  }
  throw new Error("Bundled ScriptWriter V2.3 instructions were not found");
}

export const ANGLE_STRATEGIST_SYSTEM = `You are the Instagram Creator Brain's MiniMax Angle Strategist.
Turn one qualified source Reel into original content opportunities for Alisha, Yuna, or Both.
Study the transferable viewer psychology, never the creator's protected expression.
Do not reuse characters, dialogue, distinctive phrasing, opening action, movement choreography, escalation sequence, or visual payoff. Changing the setting or costume while retaining the source sequence is copying.
The three angles must use different core actions and narrative shapes from one another.
AI must be central to every angle: an AI-created visual transformation, an AI creative-making process, or an AI-powered production workflow. Ordinary lifestyle footage with no essential AI component is out of niche.
The source is evidence and inspiration, not a template to copy.
Do not invent a completed production, exact number of attempts, named tool usage, or achieved result. An unmade concept is a proposal, not evidence that it already happened.
Return valid JSON only.`;

export function buildAnglePrompt(input: {
  requestedMode: "Visual" | "Operator" | "Both";
  sourceTitle: string;
  sourceUrl: string;
  caption: string;
  transcript: string;
  geminiAnalysis: string;
  pillars: string[];
  performanceScore: number;
  priorityScore: number;
  ownPerformanceLearnings?: string;
  rejectedFeedback?: string;
}): string {
  return `Create 3 original Instagram Reel angles from this qualified Outlier Card.

REQUESTED MODE: ${input.requestedMode}
SOURCE: ${input.sourceTitle}
SOURCE URL: ${input.sourceUrl}
PILLARS: ${input.pillars.join(", ")}
PERFORMANCE SCORE: ${input.performanceScore}
PRIORITY SCORE: ${input.priorityScore}

OWN POST LEARNINGS (use cautiously; never treat correlation as proof):
${input.ownPerformanceLearnings || "No validated owned-post pattern yet."}

CAPTION:
${input.caption || "No useful caption."}

TRANSCRIPT:
${input.transcript || "No useful transcript. Treat visual evidence as primary."}

GROUNDED VISUAL ANALYSIS:
${input.geminiAnalysis}

${input.rejectedFeedback ? `PREVIOUS ANGLES FAILED ORIGINALITY OR AI CREATIVE FIT:\n${input.rejectedFeedback}\nCreate new ideas with a different opening action, central motion, and payoff, and make AI creation essential.` : ""}

For every angle, identify the transferable viewer psychology and explicitly state what must not be copied.
Treat the source's first three seconds, main movement, and payoff as protected creative expression. Do not transform them into a new costume or location.
Propose three different story engines, not three settings for the same story.
For each angle, explain in the premise or beats exactly what AI creates or enables. Do not propose an ordinary real-world walk, light change, or emotional scene merely branded as AI.

Return JSON:
{
  "angles": [{
    "title": "2-7 words",
    "summary": "original premise",
    "spokenHook": "opening spoken line or intentionally blank for silent visual-first",
    "textHook": "six words or fewer, or intentionally blank",
    "visualHook": "exact original 0-3s action",
    "audioHook": "music/SFX direction",
    "threeBeatOutline": ["setup", "escalation", "payoff"],
    "whyItWorks": "specific mechanism",
    "whatNotToCopy": "protected or distinctive source elements to avoid",
    "deliveryProfile": "Visual-first | Operator-first | Hybrid",
    "scriptEngine": "Kallaway | RPN | Hybrid"
  }]
}`;
}

export function buildScriptSystem(engine: ScriptEngine): string {
  return `${loadScriptWriterV23()}

INSTAGRAM CREATOR BRAIN OVERRIDE:
- Active engine: ${engine}.
- MiniMax M3 is the writer.
- The selected angle and source facts are authoritative.
- Preserve the requested delivery profile. Visual-first may be 10-30 seconds with minimal or no spoken dialogue. Never force a talking-head script onto a visual-first concept.
- Do not claim the creator has already made a shot, used a named tool, run a specific number of generations, or achieved a result unless the approved angle includes verified evidence. Frame unmade visuals as production directions.
- CTA options must not promise a prompt stack, template, free guide, DM, or other deliverable unless it already exists in the selected-angle data. Prefer a natural question, save prompt, or discussion cue.
- Caption options for an unmade concept must be draft copy, not a factual claim that a generation or experiment has already succeeded. The human can update them after production.
- The mute/radio/combined audit is a preflight checklist until a rendered video has actually been reviewed; do not mark it "Passed" in advance.
- Describe each beat plainly for a creator: what viewers see, hear, and read. Do not put framework labels such as "dopamine hit" or "Pope in the Pool" in production directions.
- Return the JSON contract requested by the user prompt, not Markdown.`;
}

export function buildScriptPrompt(input: {
  account: "Alisha" | "Yuna" | "Both";
  deliveryProfile: DeliveryProfile;
  engine: ScriptEngine;
  angle: Record<string, unknown>;
  sourceFacts: string;
}): string {
  return `Write the selected original Instagram Reel package.

ACCOUNT: ${input.account}
DELIVERY PROFILE: ${input.deliveryProfile}
ENGINE: ${input.engine}
SELECTED ANGLE:
${JSON.stringify(input.angle, null, 2)}

SOURCE FACTS AND BOUNDARIES:
${input.sourceFacts}

Return JSON only:
{
  "spokenScript": "teleprompter-ready; may be minimal/blank for a deliberately silent Visual-first Reel",
  "spokenHook": "...",
  "textHook": "six words or fewer, or blank",
  "visualHook": "exact 0-3s action",
  "audioHook": "...",
  "durationSeconds": 30,
  "beats": [{"time":"0-3s","spoken":"...","visual":"...","text":"...","audio":"...","mechanic":"..."}],
  "captionOptions": ["...", "...", "..."],
  "ctaOptions": ["...", "..."],
  "audit": {"muteTest":"...","radioTest":"...","combinedTest":"...","factDiscipline":"..."},
  "assumptions": ["..."]
}`;
}

export const BLUEPRINT_SYSTEM = `You are the Instagram Creator Brain's Reel Production Architect.
Turn an approved script package into an executable, source-grounded production plan.
Do not generate media, claim assets exist, copy source visuals, or label any unrendered quality check "Verified" or "Passed".
Name a production tool only as a candidate to confirm unless the selected angle explicitly approves it. Do not infer the chosen tool from the source Reel.
Production risks are uncertainties to test, not automatic blockers. Decisions needed are choices the creator must make. Use Low, Medium, or High complexity with a short reason, never an invented hour estimate.
Return JSON only.`;

export function buildBlueprintPrompt(input: {
  account: string;
  deliveryProfile: string;
  scriptPackage: Record<string, unknown>;
}): string {
  return `Create the Reel-native production blueprint.

ACCOUNT: ${input.account}
DELIVERY PROFILE: ${input.deliveryProfile}
APPROVED SCRIPT PACKAGE:
${JSON.stringify(input.scriptPackage, null, 2)}

Return JSON:
{
  "objective": "...",
  "shotPlan": [{"order":1,"time":"0-3s","shot":"...","visual":"...","text":"...","audio":"..."}],
  "requiredAssets": [{"name":"...","type":"AI visual | A-roll | screen recording | B-roll | audio | text graphic","purpose":"...","required":true}],
  "editingRhythm": ["..."],
  "transitions": ["..."],
  "visualPayoff": "...",
  "complexity": "Low | Medium | High",
  "complexityReason": "specific production reason, not an hour estimate",
  "productionRisks": ["uncertain technical or creative outcome to test"],
  "decisionsNeeded": ["choice for the creator, if any"],
  "toolCandidates": [{"name":"optional candidate, not selected","reason":"why it may fit"}],
  "preflightChecklist": ["imperative check to perform after a first render exists"]
}`;
}
