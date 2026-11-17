import { AbortTaskRunError, task } from "@trigger.dev/sdk/v3";
import { actionLedger, publishCostSummary, rethrowNonRetryable } from "../../lib/instagram-brain/cost";
import { generateYouTubeReelIdeas } from "../../lib/youtube-outliers/ideas";
import { createYouTubeIdeas, getOutlier, setOutlierActionState, setOutlierTranscript } from "../../lib/youtube-outliers/notion";
import { fetchTranscriptsWithApify } from "../../lib/youtube-outliers/scan";

export interface GenerateYouTubeReelIdeasPayload { outlierPageId: string }

/** YouTube Outliers row → 2-3 original Reel ideas in Idea Lab (Angle Ready). Triggered by the scan or the router. */
export const generateYouTubeReelIdeasTask = task({
  id: "youtube-outliers-generate-reel-ideas",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async ({ outlierPageId }: GenerateYouTubeReelIdeasPayload) => {
    await setOutlierActionState(outlierPageId, "Processing");
    const ledger = actionLedger("youtube-reel-ideas");
    try {
      const outlier = await getOutlier(outlierPageId);
      if (outlier.status === "Ideas Ready") {
        await setOutlierActionState(outlierPageId, "Complete", "", true);
        return { outlierPageId, alreadyDone: true };
      }
      if (!outlier.video.transcript && outlier.video.url) {
        const transcript = (await fetchTranscriptsWithApify([outlier.video.url], ledger)).get(outlier.video.id) || "";
        if (transcript) {
          await setOutlierTranscript(outlierPageId, transcript);
          outlier.video.transcript = transcript;
        }
      }
      const result = await generateYouTubeReelIdeas(outlier.video, { ledger });
      if (!result.passedOriginality) {
        throw new AbortTaskRunError(`No Reel idea passed the originality / AI-fit check: ${result.rejected.map((r) => `${r.title} (too close ${r.tooClose.toFixed(2)}, AI fit ${r.aiFit.toFixed(2)})`).join("; ")}`);
      }
      const ideaIds = await createYouTubeIdeas(outlier, result.ideas, result.outlierInsight);
      await publishCostSummary(ledger);
      return { outlierPageId, ideaIds, insight: result.outlierInsight, cost: ledger.summary() };
    } catch (error) {
      await publishCostSummary(ledger);
      await setOutlierActionState(outlierPageId, "Failed", (error as Error).message, true);
      return rethrowNonRetryable(error);
    }
  },
});
