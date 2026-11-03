import dotenv from "dotenv";
import { INSTAGRAM_BRAIN_CONFIG } from "./config";

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

export async function runJevDecision(
  state: string | Record<string, unknown> | unknown[],
  questions: Record<string, JevQuestion>,
  model = INSTAGRAM_BRAIN_CONFIG.jevModel,
): Promise<JevDecisionResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for Jev decisions");

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
    return JSON.parse(text) as JevDecisionResponse;
  } finally {
    clearTimeout(timer);
  }
}

export function buildSourceValueQuestions(recordId: string): Record<string, JevQuestion> {
  return {
    [`${recordId}__strategic_fit`]: {
      type: "choice",
      instructions: `For record "${recordId}", how directly does it fit the active Instagram AI Creative pillars: Creative AI Video and AI Creative Workflow?`,
      criteria: {
        core: "Directly fits Creative AI Video or AI Creative Workflow and is valuable as a source.",
        supporting: "Fits a supporting lane such as AI Tools, model tests, or creator automation.",
        adjacent: "Relevant to broader AI but weakly connected to the active pillars.",
        irrelevant: "Not useful for this AI Creative source system.",
      },
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

