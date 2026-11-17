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
import { getPendingOutlierActions, setOutlierActionState, setOutlierDisposition } from "../../lib/youtube-outliers/notion";
import { YOUTUBE_OUTLIER_NOTION_IDS } from "../../lib/youtube-outliers/notion-ids";

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
  // YouTube Outliers actions (skipped until the YouTube Outliers database exists / its ids are set).
  const youtubeActions = YOUTUBE_OUTLIER_NOTION_IDS.dataSourceId ? await getPendingOutlierActions() : [];
  for (const item of youtubeActions) {
    if (item.action === "Save for Later") {
      await setOutlierDisposition(item.pageId, "Watchlist");
    } else if (item.action === "Ignore") {
      await setOutlierDisposition(item.pageId, "Ignored");
    } else if (item.action === "Generate Reel Ideas") {
      await setOutlierActionState(item.pageId, "Queued");
      await tasks.trigger("youtube-outliers-generate-reel-ideas", { outlierPageId: item.pageId });
    } else {
      await setOutlierActionState(item.pageId, "Failed", `Unsupported YouTube action: ${item.action}`, true);
    }
  }
  return { reels: reelActions.length, ideas: ideaActions.length, production: productionActions.length, youtube: youtubeActions.length };
}

/** Manual task until the user explicitly approves recurring action polling. */
export const routeInstagramCreatorBrainActions = task({
  id: "instagram-brain-action-router",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: runInstagramActionRouter,
});
