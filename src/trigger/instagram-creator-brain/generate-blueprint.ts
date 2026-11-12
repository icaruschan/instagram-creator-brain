import { task } from "@trigger.dev/sdk/v3";
import { generateJSONMiniMax } from "../../lib/minimax";
import { BLUEPRINT_SYSTEM, buildBlueprintPrompt } from "../../lib/instagram-brain/prompts";
import { getProductionItem, setProductionActionState, updateProductionBlueprint } from "../../lib/instagram-brain/notion";
import { normalizeBlueprint } from "../../lib/instagram-brain/production-brief";
import { actionLedger, publishCostSummary, rethrowNonRetryable } from "../../lib/instagram-brain/cost";

export interface GenerateBlueprintPayload { productionPageId: string }

export const generateInstagramBlueprint = task({
  id: "instagram-brain-generate-blueprint",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async ({ productionPageId }: GenerateBlueprintPayload) => {
    await setProductionActionState(productionPageId, "Processing");
    const ledger = actionLedger("generate-blueprint");
    try {
      const item = await getProductionItem(productionPageId);
      // A/B scripts: if Fortune picked Lara's version, plan production from her script instead.
      const useLara = item.chosenScript === "Lara" && item.laraScript.trim().length > 0;
      const scriptPackage = useLara
        ? {
          ...item.scriptPackage,
          spokenScript: item.laraScript,
          beats: [],
          note: "Chosen script is Lara's (human-written). Plan production from spokenScript; ignore AI beat timings.",
        }
        : item.scriptPackage;
      const raw = await generateJSONMiniMax(
        buildBlueprintPrompt({
          account: item.account,
          deliveryProfile: item.deliveryProfile,
          scriptPackage,
        }),
        BLUEPRINT_SYSTEM,
        0.35,
        { ledger, label: `minimax blueprint (${useLara ? "Lara script" : "AI script"})` },
      );
      await updateProductionBlueprint(productionPageId, normalizeBlueprint(raw));
      await publishCostSummary(ledger);
      return { productionPageId, blueprintReady: true, scriptSource: useLara ? "Lara" : "AI V2.3", cost: ledger.summary() };
    } catch (error) {
      await publishCostSummary(ledger);
      await setProductionActionState(productionPageId, "Failed", (error as Error).message, true);
      return rethrowNonRetryable(error);
    }
  },
});
