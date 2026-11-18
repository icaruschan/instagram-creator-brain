/**
 * One-off: recompute stale Priority Scores on analysed Reels from their CURRENT stored Performance / Strategic Fit
 * Score / Visual Pattern Value / Workflow Value (no model calls). Fortune 2026-11-18: "Yes, fix the stale Priority scores".
 * Read-only by default; writes only "Priority Score" with --apply. Needs NOTION_API_KEY (never printed).
 */
import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import { INSTAGRAM_BRAIN_NOTION_IDS as ids } from "../src/lib/instagram-brain/notion-ids";
import { INSTAGRAM_BRAIN_CONFIG } from "../src/lib/instagram-brain/config";
import { refreshedPriorityScore } from "../src/lib/instagram-brain/scoring";

dotenv.config({ override: true });
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const apply = process.argv.includes("--apply");
const text = (p: any) => (p?.rich_text || []).map((t: any) => t.plain_text || "").join("");

async function main(): Promise<void> {
  const rows: any[] = [];
  let cursor: string | undefined;
  do {
    const page: any = await notion.dataSources.query({
      data_source_id: ids.reelIntelligence.dataSourceId,
      filter: { property: "Priority Score", number: { greater_than: 0 } },
      page_size: 100,
      start_cursor: cursor,
    });
    rows.push(...page.results);
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  const blocked = new Set(INSTAGRAM_BRAIN_CONFIG.blockedShortcodes);
  let changed = 0;
  for (const row of rows) {
    const p = row.properties;
    const shortcode = text(p.Shortcode);
    if (blocked.has(shortcode)) continue;
    const old = p["Priority Score"]?.number || 0;
    const next = refreshedPriorityScore({
      priorityScore: old,
      strategicFitScore: p["Strategic Fit Score"]?.number || 0,
      visualPatternValue: p["Visual Pattern Value"]?.number || 0,
      workflowValue: p["Workflow Value"]?.number || 0,
    }, p["Performance Score"]?.number || 0);
    if (next == null || Math.abs(next - old) < 0.05) continue;
    changed++;
    const min = INSTAGRAM_BRAIN_CONFIG.topOpportunitiesMinPriority;
    const crossing = (old >= min) !== (next >= min) ? ` (Top Opportunities ${old >= min ? "out" : "in"})` : "";
    console.log(`${shortcode}: ${old} -> ${next}${crossing}`);
    if (apply) await notion.pages.update({ page_id: row.id, properties: { "Priority Score": { number: next } } });
  }
  console.log(`${rows.length} analysed rows, ${changed} ${apply ? "updated" : "would change (dry run; --apply to write)"}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
