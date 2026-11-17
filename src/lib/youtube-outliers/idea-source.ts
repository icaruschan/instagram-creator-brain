import { getReel, type IdeaRecord } from "../instagram-brain/notion";
import { youtubeSourceFacts } from "./ideas";
import { getIdeaYouTubeSource } from "./notion";
import { YOUTUBE_OUTLIER_NOTION_IDS } from "./notion-ids";

export interface IdeaSource {
  kind: "Instagram Reel" | "YouTube";
  title: string;
  /** Facts + boundaries for ScriptWriter V2.3. */
  facts: string;
  /** What the originality check compares against (Reel video analysis, or the YouTube transcript summary). */
  analysis: string;
}

/**
 * The source behind an Idea Lab row: its Instagram Reel (as before) or, for YouTube-sourced ideas,
 * its YouTube Outliers row. Throws the same message as before when neither is linked.
 */
export async function loadIdeaSource(idea: Pick<IdeaRecord, "pageId" | "sourceReelId">): Promise<IdeaSource> {
  if (idea.sourceReelId) {
    const reel = await getReel(idea.sourceReelId);
    return {
      kind: "Instagram Reel",
      title: reel.title,
      facts: [reel.caption, reel.transcript, reel.geminiAnalysis].filter(Boolean).join("\n\n"),
      analysis: reel.geminiAnalysis,
    };
  }
  if (YOUTUBE_OUTLIER_NOTION_IDS.dataSourceId) {
    const outlier = await getIdeaYouTubeSource(idea.pageId);
    if (outlier) {
      const facts = youtubeSourceFacts(outlier.video);
      return { kind: "YouTube", title: outlier.video.title, facts, analysis: facts };
    }
  }
  throw new Error("Selected angle is not linked to a source Reel or YouTube video");
}
