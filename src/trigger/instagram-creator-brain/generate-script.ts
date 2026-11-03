import { task } from "@trigger.dev/sdk/v3";
import { generateJSONMiniMax } from "../../lib/minimax";
import { buildScriptPrompt, buildScriptSystem } from "../../lib/instagram-brain/prompts";
import { createProductionItem, findProductionByIdea, getIdea, getReel, setIdeaActionState } from "../../lib/instagram-brain/notion";
import { normalizeScriptPackage } from "../../lib/instagram-brain/production-brief";

export interface GenerateScriptPayload { ideaPageId: string }

export const generateInstagramScript = task({
  id: "instagram-brain-generate-script",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async ({ ideaPageId }: GenerateScriptPayload) => {
    await setIdeaActionState(ideaPageId, "Processing");
    try {
      const idea = await getIdea(ideaPageId);
      if (idea.account === "Unassigned") throw new Error("Choose Alisha, Yuna, or Both before generating a script");
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
          account: idea.account,
          deliveryProfile: idea.deliveryProfile,
          engine: idea.scriptEngine,
          angle: idea.angle as unknown as Record<string, unknown>,
          sourceFacts,
        }),
        buildScriptSystem(idea.scriptEngine),
        0.55,
      );
      const productionPageId = await createProductionItem(idea, normalizeScriptPackage(raw, idea.title));
      return { ideaPageId, productionPageId };
    } catch (error) {
      await setIdeaActionState(ideaPageId, "Failed", (error as Error).message, true);
      throw error;
    }
  },
});
