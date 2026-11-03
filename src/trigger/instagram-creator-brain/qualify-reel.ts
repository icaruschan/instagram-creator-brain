import { task } from "@trigger.dev/sdk/v3";
import { getInstagramCreator, getReel, updateReelStrategicFit } from "../../lib/instagram-brain/notion";
import { runJevDecision } from "../../lib/instagram-brain/jev";

export interface QualifyReelPayload { reelPageId: string }

const FIT_VALUES: Record<string, number> = {
  core: 100,
  supporting: 65,
  adjacent: 30,
  irrelevant: 0,
};

function expectedFit(probabilities: Record<string, number>): number {
  return Math.round(Object.entries(probabilities).reduce(
    (sum, [key, probability]) => sum + (FIT_VALUES[key] || 0) * probability,
    0,
  ) * 10) / 10;
}

export async function runQualifyInstagramReel({ reelPageId }: QualifyReelPayload) {
    const reel = await getReel(reelPageId);
    const creator = await getInstagramCreator(reel.creatorPageId);
    const state = {
      creator: `@${creator.handle}`,
      creatorPillars: creator.pillars,
      caption: reel.caption,
      transcript: reel.transcript,
      activePillars: ["Creative AI Video", "AI Creative Workflow"],
      supportingPillars: ["AI Tools & Model Experiments", "Creator AI Systems & Automation", "AI & Creative Commentary"],
    };
    const response = await runJevDecision(state, {
      strategic_fit: {
        type: "choice",
        instructions: "How directly does this source Reel fit the Instagram Creator Brain?",
        criteria: {
          core: "Directly fits Creative AI Video or AI Creative Workflow.",
          supporting: "Fits a supporting AI tools, creator systems, or creative commentary lane.",
          adjacent: "Broadly relevant to AI but weakly connected to the active content pillars.",
          irrelevant: "Unrelated, generic, or unsuitable as a source for this creator brain.",
        },
      },
    });
    const answer = response.answers.strategic_fit;
    const fit = String(answer.choice || "irrelevant");
    const label = (fit.charAt(0).toUpperCase() + fit.slice(1)) as "Core" | "Supporting" | "Adjacent" | "Irrelevant";
    const score = expectedFit(answer.probabilities || { [fit]: 1 });
    await updateReelStrategicFit({
      pageId: reelPageId,
      fit: label,
      score,
      confidence: Number(answer.confidence || 0),
    });
    return { reelPageId, fit: label, score };
}

export const qualifyInstagramReel = task({
  id: "instagram-brain-qualify-reel",
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: runQualifyInstagramReel,
});
