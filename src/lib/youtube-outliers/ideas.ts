import { generateJSONMiniMax } from "../minimax";
import { normalizeAngles, originalityResults } from "../instagram-brain/angles";
import { ACCOUNTS, CONTENT_TYPES, PILLAR_DEFINITIONS, YUNA_PILLARS, activeAccounts } from "../instagram-brain/config";
import type { CostLedger } from "../instagram-brain/cost";
import type { AnglePreview } from "../instagram-brain/types";
import { YOUTUBE_OUTLIER_CONFIG } from "./config";
import type { ScoredVideo } from "./types";

function targetLine(): string {
  const active = activeAccounts();
  return `Target account${active.length === 1 ? "" : "s"}: ${active.join(", ") || "none"}.\n${active.map((name) => `- ${ACCOUNTS[name].persona}`).join("\n")}\nContent pillars:\n${Object.values(PILLAR_DEFINITIONS).map((value) => `- ${value}`).join("\n")}`;
}

export const YOUTUBE_IDEA_SYSTEM = `You are the Instagram Creator Brain's YouTube-to-Reel Idea Strategist.
You receive one YouTube video that is doing far better than normal for its own channel. Work out WHY it outperformed
(topic, promise, curiosity gap, payoff, format), then turn that transferable insight into original short-form
Instagram Reel ideas (10-60s, vertical, hook in the first 1-3s) for the target account below.
${targetLine()}
A long-form video is a source of topics, promises and payoffs, not a script to shorten: pick ONE sharp payoff that works in under 60 seconds.
Never reuse the creator's title wording, characters, thumbnails, signature phrasing, exact step sequence, or finished visuals. The idea must stand on its own as Yuna's.
AI must be central to every idea: an AI-created visual, an AI creative process, or an AI-powered workflow.
Do not invent a finished production, a named tool result, or numbers Yuna has not achieved. An unmade concept is a proposal.
The ideas must use different core actions and narrative shapes from one another.
Return valid JSON only.`;

export function buildYouTubeIdeaPrompt(video: ScoredVideo, count = YOUTUBE_OUTLIER_CONFIG.ideasPerVideo, rejectedFeedback = ""): string {
  const s = video.score;
  const transcript = (video.transcript || "").slice(0, YOUTUBE_OUTLIER_CONFIG.transcriptCharBudget);
  return `Create ${count} original Instagram Reel ideas from this YouTube outlier.

SOURCE: ${video.title}
URL: ${video.url}
CHANNEL: ${video.channelName}
FORMAT: ${video.format} (${Math.round(video.durationSeconds / 60 * 10) / 10} min)
VIEWS: ${video.views.toLocaleString("en-US")} at ${s.ageDays ?? "?"} days old; her normal ${video.format} at that age: ${s.expectedViews?.toLocaleString("en-US") ?? "?"} → ${s.multiple ?? "?"}x normal.

DESCRIPTION:
${video.description.slice(0, 1_500) || "None."}

TRANSCRIPT${video.transcript.length > transcript.length ? " (truncated)" : ""}:
${transcript || "No transcript. Work from the title, description and performance only, and say so in outlierInsight."}

${rejectedFeedback ? `PREVIOUS IDEAS FAILED ORIGINALITY OR AI CREATIVE FIT:\n${rejectedFeedback}\nWrite new ideas with a different opening action, central motion and payoff.\n` : ""}
Label each idea with its OWN pillar and contentType. Pillars: ${YUNA_PILLARS.join(", ")}. Content types: ${CONTENT_TYPES.join(", ")}.
Every idea needs a non-empty visualHook (exact 0-3s image or action).

Return JSON:
{
  "outlierInsight": "1-3 sentences: why this video outperformed her normal (topic/promise/format), as a transferable pattern",
  "angles": [{
    "title": "2-7 words",
    "summary": "original Reel premise for Yuna, and how it compresses the source's payoff into <60s",
    "spokenHook": "opening spoken line, or blank for a silent visual-first Reel",
    "textHook": "six words or fewer, or blank",
    "visualHook": "exact original 0-3s action",
    "audioHook": "music/SFX direction",
    "threeBeatOutline": ["setup", "escalation", "payoff"],
    "whyItWorks": "the transferable mechanism from the outlier",
    "whatNotToCopy": "source elements to avoid",
    "deliveryProfile": "Visual-first | Operator-first | Hybrid",
    "scriptEngine": "Kallaway | RPN | Hybrid",
    "pillar": "${YUNA_PILLARS.join(" | ")}",
    "contentType": "${CONTENT_TYPES.join(" | ")}"
  }]
}`;
}

export interface YouTubeIdeaResult {
  outlierInsight: string;
  ideas: AnglePreview[];
  attempts: number;
  /** False when no idea passed the Jev originality / AI-fit check after all rounds (ideas = last round, flagged). */
  passedOriginality: boolean;
  rejected: Array<{ title: string; tooClose: number; aiFit: number }>;
}

/** Source summary used by the originality check (and by Generate Script for a YouTube-sourced idea). */
export function youtubeSourceFacts(video: Pick<ScoredVideo, "title" | "description" | "transcript" | "format" | "durationSeconds">): string {
  return [
    `YouTube ${video.format} (${Math.round(video.durationSeconds)}s): ${video.title}`,
    video.description ? `Description: ${video.description.slice(0, 1_200)}` : "",
    video.transcript ? `Transcript excerpt: ${video.transcript.slice(0, 6_000)}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * MiniMax writes the ideas; Jev checks each against the source (too close? AI essential?), up to 2 rounds.
 * Ideas that pass are kept; if none pass after 2 rounds the last round is returned with passedOriginality=false
 * (the caller writes nothing to Idea Lab in that case and marks the video Failed with the reason).
 */
export async function generateYouTubeReelIdeas(
  video: ScoredVideo,
  options: { ledger?: CostLedger; count?: number; originalityCheck?: boolean; maxRounds?: number } = {},
): Promise<YouTubeIdeaResult> {
  const count = options.count ?? YOUTUBE_OUTLIER_CONFIG.ideasPerVideo;
  const rounds = options.maxRounds ?? 2;
  let feedback = "";
  let lastIdeas: AnglePreview[] = [];
  let insight = "";
  const rejected: YouTubeIdeaResult["rejected"] = [];
  for (let attempt = 1; attempt <= rounds; attempt++) {
    const raw = await generateJSONMiniMax(buildYouTubeIdeaPrompt(video, count, feedback), YOUTUBE_IDEA_SYSTEM, 0.7, {
      ledger: options.ledger,
      label: `minimax youtube reel ideas ${video.id} #${attempt}`,
    });
    insight = String(raw.outlierInsight || insight || "").trim();
    const ideas = normalizeAngles(raw).slice(0, count);
    if (!ideas.length) throw new Error("MiniMax returned no usable Reel ideas");
    lastIdeas = ideas;
    if (options.originalityCheck === false) return { outlierInsight: insight, ideas, attempts: attempt, passedOriginality: true, rejected };
    const checks = await originalityResults(youtubeSourceFacts(video), ideas, options.ledger);
    const passed = ideas.filter((_, i) => checks[i].tooClose < 0.5 && checks[i].aiFit >= 0.6);
    rejected.push(...checks.filter((c) => !(c.tooClose < 0.5 && c.aiFit >= 0.6)));
    if (passed.length) return { outlierInsight: insight, ideas: passed, attempts: attempt, passedOriginality: true, rejected };
    feedback = checks.map((c) => `${c.title}: too close ${c.tooClose.toFixed(2)}, AI fit ${c.aiFit.toFixed(2)}`).join("\n");
  }
  return { outlierInsight: insight, ideas: lastIdeas, attempts: rounds, passedOriginality: false, rejected };
}
