/**
 * YouTube outlier DRY RUN. Prints outliers and sample Reel ideas. NEVER writes to Notion (no Notion import).
 *
 *   npx tsx scripts/dry-run-youtube-outliers.ts                       # Kaye, yt-dlp (free, box only), scores only
 *   npx tsx scripts/dry-run-youtube-outliers.ts --ideas 2             # + Reel ideas for the top 2 (MiniMax + Jev, ~$0.01-0.06)
 *   npx tsx scripts/dry-run-youtube-outliers.ts --source apify        # production source (APIFY_TOKEN; ~$0.24 for 30+30)
 *   npx tsx scripts/dry-run-youtube-outliers.ts --source data-api     # YouTube Data API (YOUTUBE_API_KEY; free quota)
 *   npx tsx scripts/dry-run-youtube-outliers.ts --file videos.json    # replay a saved pull (--save videos.json)
 * Options: --channel URL  --long 30  --shorts 30  --no-originality  --json out.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { CostLedger } from "../src/lib/instagram-brain/cost";
import { KNOWN_YOUTUBE_CHANNELS } from "../src/lib/youtube-outliers/config";
import { generateYouTubeReelIdeas } from "../src/lib/youtube-outliers/ideas";
import { analyseChannel, fetchChannelVideos, fetchTranscriptsWithApify } from "../src/lib/youtube-outliers/scan";
import type { ScoredVideo, YouTubeVideo } from "../src/lib/youtube-outliers/types";
import { fetchTranscriptWithYtDlp, scrapeChannelWithYtDlp } from "./ytdlp-source";

const args = process.argv.slice(2);
const opt = (name: string, fallback = "") => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const flag = (name: string) => args.includes(`--${name}`);

const channelUrl = opt("channel", Object.values(KNOWN_YOUTUBE_CHANNELS)[0].channelUrl);
const source = opt("source", opt("file") ? "file" : "ytdlp");
const longForm = Number(opt("long", "30"));
const shorts = Number(opt("shorts", "30"));
const ideaCount = Number(opt("ideas", "0"));

const fmt = (n: number | null | undefined) => (n == null ? "-" : Math.round(n).toLocaleString("en-US"));

async function main() {
  const ledger = new CostLedger("dry-run-youtube-outliers", Infinity, () => {});
  console.log(`Dry run: ${channelUrl} via ${source} (${longForm} long-form + ${shorts} Shorts). Notion: not touched.`);
  let videos: YouTubeVideo[];
  if (source === "file") videos = JSON.parse(readFileSync(opt("file"), "utf8"));
  else if (source === "ytdlp") videos = await scrapeChannelWithYtDlp(channelUrl, longForm, shorts);
  else videos = await fetchChannelVideos(channelUrl, { source: source as "apify" | "data-api", ledger, longForm, shorts });
  if (opt("save")) writeFileSync(opt("save"), JSON.stringify(videos, null, 2));

  const { scored, outliers, summary } = analyseChannel(videos);
  console.log(`\nPulled ${videos.length} videos. Baseline per format:`);
  for (const [format, s] of Object.entries(summary)) {
    console.log(`  ${format.padEnd(9)} ${String(s.videos).padStart(3)} videos, median ${fmt(s.medianViews)} views, growth exponent b=${s.growthExponent}, outliers ${s.outliers}`);
  }

  const row = (v: ScoredVideo) => `  ${(v.score.multiple ?? 0).toFixed(1).padStart(5)}x  ${v.format.padEnd(9)} ${fmt(v.views).padStart(9)} views vs ~${fmt(v.score.expectedViews).padStart(8)} normal  ${String(v.score.ageDays).padStart(5)}d  ${v.title.slice(0, 70)}`;
  console.log(`\nOUTLIERS (>= 2x her normal ${"for the same format and age"}, inside the window):`);
  console.log(outliers.length ? outliers.map(row).join("\n") : "  none");
  const near = scored
    .filter((v) => !v.score.isOutlier && (v.score.multiple ?? 0) >= 1.5)
    .sort((a, b) => (b.score.multiple ?? 0) - (a.score.multiple ?? 0))
    .slice(0, 8);
  console.log(`\nNEAR MISSES / OUT OF WINDOW (>= 1.5x, not flagged):`);
  console.log(near.length ? near.map((v) => `${row(v)}  [${v.score.reason}]`).join("\n") : "  none");

  const results: any[] = [];
  for (const video of outliers.slice(0, ideaCount)) {
    if (!video.transcript) {
      video.transcript = source === "apify"
        ? (await fetchTranscriptsWithApify([video.url], ledger)).get(video.id) || ""
        : await fetchTranscriptWithYtDlp(video.url);
    }
    console.log(`\n=== Reel ideas from: ${video.title} (${video.score.multiple}x, transcript ${video.transcript.length} chars) ===`);
    const result = await generateYouTubeReelIdeas(video, { ledger, originalityCheck: !flag("no-originality") });
    console.log(`Why it popped: ${result.outlierInsight}`);
    console.log(`Originality check: ${result.passedOriginality ? "passed" : "FAILED"} after ${result.attempts} round(s); dropped ${result.rejected.length}`);
    for (const idea of result.ideas) {
      console.log(`\n  • ${idea.title}  [${idea.pillar || "?"} / ${idea.contentType || "?"} / ${idea.deliveryProfile}]`);
      console.log(`    ${idea.summary}`);
      console.log(`    Hook: ${idea.visualHook}${idea.spokenHook ? ` | "${idea.spokenHook}"` : ""}${idea.textHook ? ` | text: ${idea.textHook}` : ""}`);
      console.log(`    Beats: ${idea.threeBeatOutline.join(" → ")}`);
    }
    results.push({ video: { id: video.id, title: video.title, url: video.url, score: video.score }, ...result });
  }

  const cost = ledger.summary();
  console.log(`\nCost this dry run: $${cost.spentUsd.toFixed(4)} (${cost.calls} paid calls: ${JSON.stringify(cost.byKind)})${source === "ytdlp" || source === "file" ? "; video data via yt-dlp/file = $0" : ""}`);
  if (opt("json")) writeFileSync(opt("json"), JSON.stringify({ channelUrl, source, summary, outliers: outliers.map((v) => ({ id: v.id, title: v.title, url: v.url, format: v.format, views: v.views, score: v.score })), ideas: results, cost }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
