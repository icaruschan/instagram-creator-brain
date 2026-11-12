import dotenv from "dotenv";
import {
  CONTENT_TYPES,
  CONTENT_TYPE_DEFINITIONS,
  INSTAGRAM_BRAIN_CONFIG,
  PILLAR_DEFINITIONS,
  type ContentType,
  type YunaPillar,
} from "./config";
import { estimateCost, type CostLedger } from "./cost";

dotenv.config({ override: true });

export type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type JevScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type JevNoulQuestion = {
  type: "noul";
  instructions: string;
};

export type JevQuestion = JevChoiceQuestion | JevScoreQuestion | JevNoulQuestion;

export interface JevDecisionResponse {
  model: string;
  answers: Record<string, any>;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
  id?: string;
  provider?: string;
}

export interface JevCallOptions {
  model?: string;
  ledger?: CostLedger;
  label?: string;
}

export async function runJevDecision(
  state: string | Record<string, unknown> | unknown[],
  questions: Record<string, JevQuestion>,
  options: JevCallOptions = {},
): Promise<JevDecisionResponse> {
  const model = options.model || INSTAGRAM_BRAIN_CONFIG.jevModel;
  const label = options.label || "jev decision";
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for Jev decisions");
  const estimate = estimateCost("jev");
  options.ledger?.ensure(estimate, label);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Instagram Creator Brain",
      },
      signal: controller.signal,
      body: JSON.stringify({ model, state, questions }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Jev decision failed (${response.status}): ${text.slice(0, 1000)}`);
    }
    const parsed = JSON.parse(text) as JevDecisionResponse;
    options.ledger?.record("jev", label, estimate, parsed.usage?.cost);
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

export function buildSourceValueQuestions(recordId: string): Record<string, JevQuestion> {
  return {
    [`${recordId}__strategic_fit`]: {
      type: "choice",
      instructions: `For record "${recordId}", how directly does it fit Yuna's AI Creative pillars: ${PILLAR_LIST}?`,
      criteria: STRATEGIC_FIT_CRITERIA,
    },
    [`${recordId}__visual_pattern_value`]: {
      type: "noul",
      instructions: `For record "${recordId}", does it contain a distinctive visual hook, scene device, character/world-building method, visual storytelling pattern, or production treatment worth studying for an original Creative AI Video?`,
    },
    [`${recordId}__workflow_value`]: {
      type: "noul",
      instructions: `For record "${recordId}", does it contain a concrete, repeatable tool, prompt, workflow, editing process, or system worth studying for an AI Creative Workflow?`,
    },
    [`${recordId}__best_execution_mode`]: {
      type: "choice",
      instructions: `For record "${recordId}", which content mode is the best source adaptation?`,
      criteria: {
        visual_storyteller: "Best adapted as a visual world, character story, VFX, or visual experiment.",
        creative_operator: "Best adapted as a workflow, tool breakdown, prompt/process, or system.",
        both: "Supports both a visual experiment and a separate workflow/breakdown execution.",
        neither: "Not worth adapting.",
      },
    },
  };
}


const PILLAR_LIST = Object.values(PILLAR_DEFINITIONS).join(" | ");

export const STRATEGIC_FIT_CRITERIA: Record<string, string> = {
  core: "Directly fits one of Yuna's pillars (AI Visual Storyteller, AI Creative Operator, Storytelling) and is a valuable source for an original AI Creative Reel.",
  supporting: "Fits a supporting lane under the pillars, such as an AI tool/model test, creator automation, or AI & creative commentary.",
  adjacent: "Relevant to broader AI but weakly connected to Yuna's AI Creative pillars.",
  irrelevant: "Not useful for this AI Creative source system.",
};

const PILLAR_KEYS: Record<string, YunaPillar> = {
  visual_storyteller: "Visual Storyteller",
  creative_operator: "Creative Operator",
  storytelling: "Storytelling",
};

const CONTENT_TYPE_KEYS: Record<string, ContentType> = {
  creative_ai_video: "Creative AI Video",
  ai_creative_workflow: "AI Creative Workflow",
  tool_model_test: "Tool/Model Test",
  creator_automation: "Creator Automation",
  commentary: "Commentary",
};

/** Jev questions that tag a source Reel with Yuna's Pillar and Content Type. */
export function buildPillarQuestions(prefix = ""): Record<string, JevQuestion> {
  const contentTypeCriteria = Object.fromEntries(Object.entries(CONTENT_TYPE_KEYS)
    .map(([key, name]) => [key, `${name}: ${CONTENT_TYPE_DEFINITIONS[name]}`]));
  return {
    [`${prefix}pillar`]: {
      type: "choice",
      instructions: "Which of Yuna's content pillars would an original Reel inspired by this source belong to?",
      criteria: {
        visual_storyteller: PILLAR_DEFINITIONS["Visual Storyteller"],
        creative_operator: PILLAR_DEFINITIONS["Creative Operator"],
        storytelling: PILLAR_DEFINITIONS.Storytelling,
      },
    },
    [`${prefix}content_type`]: {
      type: "choice",
      instructions: "Which content type best describes this source Reel?",
      criteria: contentTypeCriteria,
    },
  };
}

export function readPillarAnswers(
  answers: Record<string, any>,
  prefix = "",
): { pillar: YunaPillar | null; contentType: ContentType | null } {
  const pillarKey = String(answers[`${prefix}pillar`]?.choice || "");
  const typeKey = String(answers[`${prefix}content_type`]?.choice || "");
  const contentType = CONTENT_TYPE_KEYS[typeKey] || null;
  return {
    pillar: PILLAR_KEYS[pillarKey] || null,
    contentType: contentType && (CONTENT_TYPES as readonly string[]).includes(contentType) ? contentType : null,
  };
}
