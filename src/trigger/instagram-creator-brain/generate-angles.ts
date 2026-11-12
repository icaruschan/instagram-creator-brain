import { task } from "@trigger.dev/sdk/v3";
import { generateJSONMiniMax } from "../../lib/minimax";
import { ANGLE_STRATEGIST_SYSTEM, buildAnglePrompt } from "../../lib/instagram-brain/prompts";
import { createAngleIdeas, getOwnPerformanceLearnings, getReel, setReelActionState } from "../../lib/instagram-brain/notion";
import type { AnglePreview } from "../../lib/instagram-brain/types";
import { actionLedger, publishCostSummary, rethrowNonRetryable } from "../../lib/instagram-brain/cost";
import { angleGate, normalizeAngles, originalityResults } from "../../lib/instagram-brain/angles";

export interface GenerateAnglesPayload {
  reelPageId: string;
  requestedMode: "Visual" | "Operator" | "Both";
}

export const generateInstagramAngles = task({
  id: "instagram-brain-generate-angles",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async ({ reelPageId, requestedMode }: GenerateAnglesPayload) => {
    await setReelActionState(reelPageId, "Processing");
    const ledger = actionLedger("generate-angles");
    try {
      const reel = await getReel(reelPageId);
      const gate = angleGate(reel);
      if (gate) {
        await setReelActionState(reelPageId, "Failed", gate, true);
        return { reelPageId, skipped: true, reason: gate };
      }
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
          { ledger, label: `minimax angles attempt ${attempt + 1}` },
        );
        const proposed = normalizeAngles(raw);
        if (proposed.length === 0) throw new Error("MiniMax returned no usable angle previews");
        const checks = await originalityResults(reel.geminiAnalysis, proposed, ledger);
        angles = proposed.filter((_, index) => checks[index].tooClose < 0.5 && checks[index].aiFit >= 0.6);
        if (angles.length >= 2) break;
        feedback = checks.map((check) => `${check.title}: source-sequence similarity ${check.tooClose.toFixed(2)}, AI Creative fit ${check.aiFit.toFixed(2)}`).join("; ");
      }
      if (angles.length < 2) throw new Error(`MiniMax did not produce enough original angles: ${feedback}`);
      const ideaIds = await createAngleIdeas(reel, angles);
      await publishCostSummary(ledger);
      return { reelPageId, ideaIds, cost: ledger.summary() };
    } catch (error) {
      await publishCostSummary(ledger);
      await setReelActionState(reelPageId, "Failed", (error as Error).message, true);
      return rethrowNonRetryable(error);
    }
  },
});
