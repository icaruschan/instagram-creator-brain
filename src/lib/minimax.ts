import OpenAI from "openai";
import dotenv from "dotenv";

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

export async function generateJSONMiniMax(
  prompt: string,
  systemPrompt: string,
  temperature = 0.5,
  model = process.env.IG_BRAIN_MINIMAX_MODEL || "minimax/minimax-m3",
): Promise<Record<string, unknown>> {
  const stream = await getClient().chat.completions.create({
    model,
    stream: true,
    temperature,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
  });
  let raw = "";
  for await (const chunk of stream) {
    raw += chunk.choices[0]?.delta?.content || "";
  }
  return parseJson(raw);
}
