import { AbortTaskRunError, task } from "@trigger.dev/sdk/v3";
import { generateJSONMiniMax } from "../../lib/minimax";
import { buildScriptPrompt, buildScriptSystem } from "../../lib/instagram-brain/prompts";
import { createProductionItem, findProductionByIdea, getIdea, getReel, setIdeaActionState } from "../../lib/instagram-brain/notion";
import { normalizeScriptPackage } from "../../lib/instagram-brain/production-brief";
import { resolveTargetAccount } from "../../lib/instagram-brain/config";
import { actionLedger, publishCostSummary, rethrowNonRetryable } from "../../lib/instagram-brain/cost";

export interface GenerateScriptPayload { ideaPageId: string }

/**
 * Picking an angle ("Generate Script") still writes the AI ScriptWriter V2.3 script as before.
 * The new Production Queue item is also flagged for Lara: "Lara Script Status" = Needed, with an empty
 * "Lara Script" field next to the AI script, and "Chosen Script" = Undecided for Fortune's A/B pick.
 */
export const generateInstagramScript = task({
  id: "instagram-brain-generate-script",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async ({ ideaPageId }: GenerateScriptPayload) => {
    await setIdeaActionState(ideaPageId, "Processing");
    const ledger = actionLedger("generate-script");
    try {
      const idea = await getIdea(ideaPageId);
      let account: ReturnType<typeof resolveTargetAccount>;
      try {
        account = resolveTargetAccount(idea.account);
      } catch (error) {
        // Account on hold / not chosen: a retry would fail the same way.
        throw new AbortTaskRunError((error as Error).message);
      }
      if (!idea.sourceReelId) throw new Error("Selected angle is not linked to a source Reel");
      const existingProductionPageId = await findProductionByIdea(ideaPageId);
      if (existingProductionPageId) {
        await setIdeaActionState(ideaPageId, "Complete", "", true);
        return { ideaPageId, productionPageId: existingProductionPageId, alreadyExists: true };
      }
      const reel = await getReel(idea.sourceReelId);
      const sourceFacts = [reel.caption, reel.transcript, reel.geminiAnalysis].filter(Boolean).join("\n\n");
      const raw = await generateJSONMiniMax(
        buildScriptPrompt({
          account,
          deliveryProfile: idea.deliveryProfile,
          engine: idea.scriptEngine,
          angle: idea.angle as unknown as Record<string, unknown>,
          sourceFacts,
        }),
        buildScriptSystem(idea.scriptEngine),
        0.55,
        { ledger, label: "minimax scriptwriter v2.3" },
      );
      const productionPageId = await createProductionItem(idea, normalizeScriptPackage(raw, idea.title), account);
      await publishCostSummary(ledger);
      return { ideaPageId, productionPageId, account, laraScriptStatus: "Needed", cost: ledger.summary() };
    } catch (error) {
      await publishCostSummary(ledger);
      await setIdeaActionState(ideaPageId, "Failed", (error as Error).message, true);
      return rethrowNonRetryable(error);
    }
  },
});
