import { task } from "@trigger.dev/sdk/v3";
import { getInstagramCreator, getReel, updateReelStrategicFit } from "../../lib/instagram-brain/notion";
import { STRATEGIC_FIT_CRITERIA, buildPillarQuestions, readPillarAnswers, runJevDecision } from "../../lib/instagram-brain/jev";
import { PILLAR_DEFINITIONS } from "../../lib/instagram-brain/config";
import { actionLedger, publishCostSummary, type CostLedger } from "../../lib/instagram-brain/cost";

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

/**
 * Jev fit check (one decision call): strategic fit for Yuna, plus her Pillar and the Content Type.
 */
export async function runQualifyInstagramReel({ reelPageId }: QualifyReelPayload, ledger?: CostLedger) {
    const reel = await getReel(reelPageId);
    const creator = await getInstagramCreator(reel.creatorPageId);
    const state = {
      account: "Yuna (AI Creative niche)",
      creator: `@${creator.handle}`,
      creatorPillars: creator.pillars,
      caption: reel.caption,
      transcript: reel.transcript,
      yunaPillars: Object.values(PILLAR_DEFINITIONS),
    };
    const response = await runJevDecision(state, {
      strategic_fit: {
        type: "choice",
        instructions: "How directly does this source Reel fit Yuna's AI Creative pillars as inspiration for an original Instagram Reel?",
        criteria: STRATEGIC_FIT_CRITERIA,
      },
      ...buildPillarQuestions(),
    }, { ledger, label: `jev fit check ${reel.shortcode}` });
    const answer = response.answers.strategic_fit;
    const fit = String(answer.choice || "irrelevant");
    const label = (fit.charAt(0).toUpperCase() + fit.slice(1)) as "Core" | "Supporting" | "Adjacent" | "Irrelevant";
    const score = expectedFit(answer.probabilities || { [fit]: 1 });
    const { pillar, contentType } = readPillarAnswers(response.answers);
    await updateReelStrategicFit({
      pageId: reelPageId,
      fit: label,
      score,
      confidence: Number(answer.confidence || 0),
      pillar: label === "Irrelevant" ? null : pillar,
      contentType: label === "Irrelevant" ? null : contentType,
    });
    return { reelPageId, fit: label, score, pillar, contentType };
}

export const qualifyInstagramReel = task({
  id: "instagram-brain-qualify-reel",
  maxDuration: 300,
  retry: { maxAttempts: 2 },
  run: async (payload: QualifyReelPayload) => {
    const ledger = actionLedger("qualify-reel");
    const result = await runQualifyInstagramReel(payload, ledger);
    await publishCostSummary(ledger);
    return { ...result, cost: ledger.summary() };
  },
});
