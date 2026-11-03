import { task } from "@trigger.dev/sdk/v3";
import { generateJSONMiniMax } from "../../lib/minimax";
import { ANGLE_STRATEGIST_SYSTEM, buildAnglePrompt } from "../../lib/instagram-brain/prompts";
import { createAngleIdeas, getOwnPerformanceLearnings, getReel, setReelActionState } from "../../lib/instagram-brain/notion";
import type { AnglePreview } from "../../lib/instagram-brain/types";
import { runJevDecision } from "../../lib/instagram-brain/jev";

export interface GenerateAnglesPayload {
  reelPageId: string;
  requestedMode: "Visual" | "Operator" | "Both";
}

function normalizeAngles(raw: Record<string, unknown>): AnglePreview[] {
  const rows = Array.isArray(raw.angles) ? raw.angles : [];
  return rows.slice(0, 5).map((item: any) => ({
    title: String(item.title || "Untitled angle").trim(),
    summary: String(item.summary || "").trim(),
    spokenHook: String(item.spokenHook || "").trim(),
    textHook: String(item.textHook || "").trim(),
    visualHook: String(item.visualHook || "").trim(),
    audioHook: String(item.audioHook || "").trim(),
    threeBeatOutline: Array.isArray(item.threeBeatOutline) ? item.threeBeatOutline.map(String).slice(0, 5) : [],
    whyItWorks: String(item.whyItWorks || "").trim(),
    whatNotToCopy: String(item.whatNotToCopy || "").trim(),
    deliveryProfile: ["Visual-first", "Operator-first", "Hybrid"].includes(item.deliveryProfile) ? item.deliveryProfile : "Hybrid",
    scriptEngine: ["Kallaway", "RPN", "Hybrid"].includes(item.scriptEngine) ? item.scriptEngine : "Kallaway",
  }));
}

async function originalityResults(
  sourceVisualAnalysis: string,
  angles: AnglePreview[],
): Promise<Array<{ title: string; tooClose: number; aiFit: number }>> {
  const questions = Object.fromEntries(angles.flatMap((_, index) => [
    [`angle_${index}_too_close`, {
      type: "noul" as const,
      instructions: `Does \`angles[${index}]\` substantially repeat the source Reel's opening action, movement sequence, or visual payoff, even if its characters, setting, or tools have changed?`,
    }],
    [`angle_${index}_ai_fit`, {
      type: "noul" as const,
      instructions: `Is AI creation essential to \`angles[${index}]\`'s premise and viewer payoff? Answer low for an ordinary filmed lifestyle story that could work unchanged without AI. Answer high only when an AI-created visual, AI creative process, or AI-powered workflow is central and explicit.`,
    }],
  ]));
  const response = await runJevDecision(
    { sourceVisualAnalysis, angles: angles.map((angle) => ({ title: angle.title, summary: angle.summary, visualHook: angle.visualHook, beats: angle.threeBeatOutline })) },
    questions,
  );
  return angles.map((angle, index) => ({
    title: angle.title,
    tooClose: Number(response.answers[`angle_${index}_too_close`]?.noul ?? 1),
    aiFit: Number(response.answers[`angle_${index}_ai_fit`]?.noul ?? 0),
  }));
}

export const generateInstagramAngles = task({
  id: "instagram-brain-generate-angles",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async ({ reelPageId, requestedMode }: GenerateAnglesPayload) => {
    await setReelActionState(reelPageId, "Processing");
    try {
      const reel = await getReel(reelPageId);
      const ownPerformanceLearnings = await getOwnPerformanceLearnings();
      const baseBrief = {
          requestedMode,
          sourceTitle: reel.title,
          sourceUrl: reel.url,
          caption: reel.caption,
          transcript: reel.transcript,
          geminiAnalysis: reel.geminiAnalysis,
          pillars: reel.pillars,
          performanceScore: reel.performanceScore,
          priorityScore: reel.priorityScore,
          ownPerformanceLearnings,
      };
      let feedback = "";
      let angles: AnglePreview[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const raw = await generateJSONMiniMax(
          buildAnglePrompt({ ...baseBrief, rejectedFeedback: feedback }),
          ANGLE_STRATEGIST_SYSTEM,
          0.65,
        );
        const proposed = normalizeAngles(raw);
        if (proposed.length === 0) throw new Error("MiniMax returned no usable angle previews");
        const checks = await originalityResults(reel.geminiAnalysis, proposed);
        angles = proposed.filter((_, index) => checks[index].tooClose < 0.5 && checks[index].aiFit >= 0.6);
        if (angles.length >= 2) break;
        feedback = checks.map((check) => `${check.title}: source-sequence similarity ${check.tooClose.toFixed(2)}, AI Creative fit ${check.aiFit.toFixed(2)}`).join("; ");
      }
      if (angles.length < 2) throw new Error(`MiniMax did not produce enough original angles: ${feedback}`);
      const ideaIds = await createAngleIdeas(reel, angles);
      return { reelPageId, ideaIds };
    } catch (error) {
      await setReelActionState(reelPageId, "Failed", (error as Error).message, true);
      throw error;
    }
  },
});
