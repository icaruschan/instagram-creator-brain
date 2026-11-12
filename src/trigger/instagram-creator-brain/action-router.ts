import { task, tasks } from "@trigger.dev/sdk/v3";
import {
  getPendingIdeaActions,
  getPendingProductionActions,
  getPendingReelActions,
  markProductionPublished,
  setIdeaActionState,
  setIdeaDisposition,
  setProductionActionState,
  setProductionStatus,
  setReelActionState,
  setReelDisposition,
} from "../../lib/instagram-brain/notion";

export async function runInstagramActionRouter() {
  const reelActions = await getPendingReelActions();
  const ideaActions = await getPendingIdeaActions();
  const productionActions = await getPendingProductionActions();

  for (const item of reelActions) {
    if (item.action === "Save for Later") {
      await setReelDisposition(item.pageId, "Watchlist");
      continue;
    }
    if (item.action === "Ignore") {
      await setReelDisposition(item.pageId, "Ignored");
      continue;
    }
    const mode = item.action === "Generate Visual Angles"
      ? "Visual"
      : item.action === "Generate Operator Angles"
        ? "Operator"
        : "Both";
    await setReelActionState(item.pageId, "Queued");
    await tasks.trigger("instagram-brain-generate-angles", { reelPageId: item.pageId, requestedMode: mode });
  }

  for (const item of ideaActions) {
    if (item.action === "Park") {
      await setIdeaDisposition(item.pageId, "Parked");
      continue;
    }
    if (item.action === "Reject") {
      await setIdeaDisposition(item.pageId, "Rejected");
      continue;
    }
    if (item.action === "Generate Script") {
      await setIdeaActionState(item.pageId, "Queued");
      await tasks.trigger("instagram-brain-generate-script", { ideaPageId: item.pageId });
    } else if (item.action === "Revise Angle") {
      // Optional: write what to change in the idea's "Revision Notes" before choosing Revise Angle.
      await setIdeaActionState(item.pageId, "Queued");
      await tasks.trigger("instagram-brain-revise-angle", { ideaPageId: item.pageId });
    } else {
      await setIdeaActionState(item.pageId, "Failed", `Unsupported idea action: ${item.action}`, true);
    }
  }

  for (const item of productionActions) {
    if (item.action === "Generate Blueprint") {
      await setProductionActionState(item.pageId, "Queued");
      await tasks.trigger("instagram-brain-generate-blueprint", { productionPageId: item.pageId });
    } else if (item.action === "Mark Ready") {
      await setProductionStatus(item.pageId, "Ready to Post");
    } else if (item.action === "Mark Published") {
      try {
        await markProductionPublished(item.pageId);
      } catch (error) {
        await setProductionActionState(item.pageId, "Failed", (error as Error).message, true);
      }
    } else {
      await setProductionActionState(item.pageId, "Failed", "Unsupported production action", true);
    }
  }
  return { reels: reelActions.length, ideas: ideaActions.length, production: productionActions.length };
}

/** Manual task until the user explicitly approves recurring action polling. */
export const routeInstagramCreatorBrainActions = task({
  id: "instagram-brain-action-router",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: runInstagramActionRouter,
});
