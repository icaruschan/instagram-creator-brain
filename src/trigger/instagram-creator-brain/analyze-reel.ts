import { task } from "@trigger.dev/sdk/v3";
import { analyzeReelVideo } from "../../lib/instagram-brain/gemini";
import { buildSourceValueQuestions, runJevDecision } from "../../lib/instagram-brain/jev";
import { calculatePriorityScore } from "../../lib/instagram-brain/scoring";
import { getInstagramCreator, getReel, updateReelIntelligence } from "../../lib/instagram-brain/notion";

export interface AnalyzeReelPayload { reelPageId: string }

const FIT_VALUES: Record<string, number> = { core: 100, supporting: 65, adjacent: 30, irrelevant: 0 };

function expectedFit(probabilities: Record<string, number>): number {
  return Math.round(Object.entries(probabilities).reduce((sum, [key, probability]) => sum + (FIT_VALUES[key] || 0) * probability, 0) * 10) / 10;
}

export const analyzeInstagramReel = task({
  id: "instagram-brain-analyze-reel",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async ({ reelPageId }: AnalyzeReelPayload) => {
    const reel = await getReel(reelPageId);
    const creator = await getInstagramCreator(reel.creatorPageId);
    const visual = await analyzeReelVideo({
      shortcode: reel.shortcode,
      videoUrl: reel.videoUrl,
      caption: reel.caption,
      transcript: reel.transcript,
    });
    const recordId = reel.shortcode.replace(/[^a-z0-9]/gi, "_");
    const state = {
      description: "One candidate Instagram Reel for an AI Creative source system.",
      records: [{
        id: recordId,
        creator: `@${creator.handle}`,
        creatorPillars: creator.pillars,
        caption: reel.caption,
        transcript: reel.transcript,
        groundedVisualAnalysis: visual,
      }],
    };
    const decisions = await runJevDecision(state, buildSourceValueQuestions(recordId));
    const fitAnswer = decisions.answers[`${recordId}__strategic_fit`];
    const visualAnswer = decisions.answers[`${recordId}__visual_pattern_value`];
    const workflowAnswer = decisions.answers[`${recordId}__workflow_value`];
    const modeAnswer = decisions.answers[`${recordId}__best_execution_mode`];
    const fit = String(fitAnswer.choice || "irrelevant");
    const fitScore = expectedFit(fitAnswer.probabilities || { [fit]: 1 });
    const visualValue = Number(visualAnswer.noul || 0);
    const workflowValue = Number(workflowAnswer.noul || 0);
    const priority = calculatePriorityScore({
      performanceScore: reel.performanceScore,
      strategicFitScore: fitScore,
      visualPatternValue: visualValue,
      workflowValue,
    });
    const modeMap: Record<string, "Visual Storyteller" | "AI Creative Operator" | "Both" | "Neither"> = {
      visual_storyteller: "Visual Storyteller",
      creative_operator: "AI Creative Operator",
      both: "Both",
      neither: "Neither",
    };
    await updateReelIntelligence({
      pageId: reelPageId,
      geminiAnalysis: JSON.stringify(visual, null, 2),
      strategicFit: (fit.charAt(0).toUpperCase() + fit.slice(1)) as "Core" | "Supporting" | "Adjacent" | "Irrelevant",
      strategicFitScore: fitScore,
      visualPatternValue: visualValue,
      workflowValue,
      recommendedMode: modeMap[modeAnswer.choice] || "Neither",
      jevConfidence: Number(fitAnswer.confidence || 0),
      priorityScore: priority.priorityScore,
    });
    return { reelPageId, priorityScore: priority.priorityScore, visualValue, workflowValue };
  },
});

