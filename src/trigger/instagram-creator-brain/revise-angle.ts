import { task } from "@trigger.dev/sdk/v3";
import { generateJSONMiniMax } from "../../lib/minimax";
import { ANGLE_STRATEGIST_SYSTEM, buildReviseAnglePrompt } from "../../lib/instagram-brain/prompts";
import { getIdea, getReel, reviseIdeaAngle, setIdeaActionState } from "../../lib/instagram-brain/notion";
import { actionLedger, publishCostSummary, rethrowNonRetryable } from "../../lib/instagram-brain/cost";
import type { AnglePreview } from "../../lib/instagram-brain/types";
import { normalizeAngles, originalityResults } from "../../lib/instagram-brain/angles";

export interface ReviseAnglePayload { ideaPageId: string }

/**
 * Idea Lab "Revise Angle": rewrite one angle in place using the reviewer's "Revision Notes"
 * (optional), keep the old version in a toggle on the page, and put the idea back to Angle Ready.
 * At most 2 MiniMax attempts + 2 Jev originality checks, inside the per-action spending cap.
 */
export const reviseInstagramAngle = task({
  id: "instagram-brain-revise-angle",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async ({ ideaPageId }: ReviseAnglePayload) => {
    await setIdeaActionState(ideaPageId, "Processing");
    const ledger = actionLedger("revise-angle");
    try {
      const idea = await getIdea(ideaPageId);
      if (!idea.sourceReelId) throw new Error("This angle is not linked to a source Reel");
      const reel = await getReel(idea.sourceReelId);
      let feedback = "";
      let revised: AnglePreview | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await generateJSONMiniMax(
          buildReviseAnglePrompt({
            angle: idea.angle as unknown as Record<string, unknown>,
            revisionNotes: idea.revisionNotes,
            sourceTitle: reel.title,
            geminiAnalysis: reel.geminiAnalysis,
            pillar: idea.pillar,
            contentType: idea.contentType,
            rejectedFeedback: feedback,
          }),
          ANGLE_STRATEGIST_SYSTEM,
          0.6,
          { ledger, label: `minimax revise attempt ${attempt + 1}` },
        );
        const [candidate] = normalizeAngles(raw);
        if (!candidate) throw new Error("MiniMax returned no usable revised angle");
        if (!reel.geminiAnalysis) {
          revised = candidate;
          break;
        }
        const [check] = await originalityResults(reel.geminiAnalysis, [candidate], ledger);
        if (check.tooClose < 0.5 && check.aiFit >= 0.6) {
          revised = candidate;
          break;
        }
        feedback = `source-sequence similarity ${check.tooClose.toFixed(2)}, AI Creative fit ${check.aiFit.toFixed(2)}`;
      }
      if (!revised) throw new Error(`Revision did not pass the originality / AI-fit check: ${feedback}`);
      await reviseIdeaAngle(idea, revised);
      await publishCostSummary(ledger);
      return { ideaPageId, revisedTitle: revised.title, cost: ledger.summary() };
    } catch (error) {
      await publishCostSummary(ledger);
      await setIdeaActionState(ideaPageId, "Failed", (error as Error).message, true);
      return rethrowNonRetryable(error);
    }
  },
});
