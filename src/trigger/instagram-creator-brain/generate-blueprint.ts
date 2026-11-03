import { task } from "@trigger.dev/sdk/v3";
import { generateJSONMiniMax } from "../../lib/minimax";
import { BLUEPRINT_SYSTEM, buildBlueprintPrompt } from "../../lib/instagram-brain/prompts";
import { getProductionItem, setProductionActionState, updateProductionBlueprint } from "../../lib/instagram-brain/notion";
import { normalizeBlueprint } from "../../lib/instagram-brain/production-brief";

export interface GenerateBlueprintPayload { productionPageId: string }

export const generateInstagramBlueprint = task({
  id: "instagram-brain-generate-blueprint",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async ({ productionPageId }: GenerateBlueprintPayload) => {
    await setProductionActionState(productionPageId, "Processing");
    try {
      const item = await getProductionItem(productionPageId);
      const raw = await generateJSONMiniMax(
        buildBlueprintPrompt({
          account: item.account,
          deliveryProfile: item.deliveryProfile,
          scriptPackage: item.scriptPackage,
        }),
        BLUEPRINT_SYSTEM,
        0.35,
      );
      await updateProductionBlueprint(productionPageId, normalizeBlueprint(raw));
      return { productionPageId, blueprintReady: true };
    } catch (error) {
      await setProductionActionState(productionPageId, "Failed", (error as Error).message, true);
      throw error;
    }
  },
});
