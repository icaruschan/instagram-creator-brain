import OpenAI from "openai";
import dotenv from "dotenv";
import { estimateCost, type CostLedger } from "./instagram-brain/cost";

dotenv.config({ override: true });

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for MiniMax M3");
    client = new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1", timeout: 300_000 });
  }
  return client;
}

function parseJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("MiniMax response did not contain JSON");
  return JSON.parse(match[0]) as Record<string, unknown>;
}

export interface MiniMaxCallOptions {
  ledger?: CostLedger;
  label?: string;
  model?: string;
}

export async function generateJSONMiniMax(
  prompt: string,
  systemPrompt: string,
  temperature = 0.5,
  options: MiniMaxCallOptions = {},
): Promise<Record<string, unknown>> {
  const model = options.model || process.env.IG_BRAIN_MINIMAX_MODEL || "minimax/minimax-m3";
  const label = options.label || "minimax call";
  const estimate = estimateCost("minimax");
  options.ledger?.ensure(estimate, label);
  const stream = await getClient().chat.completions.create({
    model,
    stream: true,
    temperature,
    // OpenRouter: report token usage (and cost) in the final stream chunk.
    stream_options: { include_usage: true },
    usage: { include: true },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
  } as any) as unknown as AsyncIterable<any>;
  let raw = "";
  let reportedCost: number | null = null;
  try {
    for await (const chunk of stream) {
      raw += chunk.choices?.[0]?.delta?.content || "";
      const cost = Number(chunk?.usage?.cost);
      if (Number.isFinite(cost)) reportedCost = cost;
    }
  } finally {
    // Record even if the stream breaks part-way: the call was still (at least partly) billed.
    options.ledger?.record("minimax", label, estimate, reportedCost);
  }
  return parseJson(raw);
}
