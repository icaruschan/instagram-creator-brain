/**
 * Notion migration for the YouTube outlier system (branch feat/youtube-outliers). NOT RUN YET: needs Fortune's OK.
 *
 *   npx tsx scripts/migrate-youtube-outliers.ts --plan     # offline: print the plan, no Notion calls
 *   npx tsx scripts/migrate-youtube-outliers.ts            # dry run: reads live schemas (read-only), prints what it would do
 *   npx tsx scripts/migrate-youtube-outliers.ts --apply    # writes
 *
 * What --apply does (additive only; never renames or deletes anything):
 * 1. Creates the "YouTube Outliers" database under the Instagram Creator Brain page (skipped if one with that title
 *    already exists there), with a "Creator" ↔ "YouTube Videos" relation to Creator Bench.
 * 2. Creator Bench: adds YouTube Channel URL, YouTube Last Checked, YouTube Median Views (Long), (Shorts).
 * 3. Idea Lab: adds "Source Type" (Instagram Reel | YouTube) and "Source YouTube Video" ↔ "Reel Ideas" relation.
 * 4. Sets Kaye's "YouTube Channel URL" (one row) from KNOWN_YOUTUBE_CHANNELS.
 * Then prints the two ids to put in Trigger env: YT_OUTLIERS_DATABASE_ID and YT_OUTLIERS_DATA_SOURCE_ID.
 */
import { Client } from "@notionhq/client";
import { INSTAGRAM_BRAIN_NOTION_IDS } from "../src/lib/instagram-brain/notion-ids";
import { KNOWN_YOUTUBE_CHANNELS } from "../src/lib/youtube-outliers/config";
import { CREATOR_BENCH_ADDITIONS, IDEA_LAB_ADDITIONS, YT_DB_TITLE, YT_OUTLIER_PROPERTIES } from "../src/lib/youtube-outliers/schema";

const apply = process.argv.includes("--apply");
const offline = process.argv.includes("--plan");
const ids = INSTAGRAM_BRAIN_NOTION_IDS;
const dual = (dataSourceId: string, inverse: string) => ({
  relation: { data_source_id: dataSourceId, type: "dual_property", dual_property: { synced_property_name: inverse } },
});

function plan(): void {
  console.log(`1. Create database "${YT_DB_TITLE}" under ${ids.rootPageId} with ${Object.keys(YT_OUTLIER_PROPERTIES).length} properties:`);
  console.log(`   ${Object.keys(YT_OUTLIER_PROPERTIES).join(", ")}`);
  console.log(`   + relation "Creator" ↔ Creator Bench "YouTube Videos"`);
  console.log(`2. Creator Bench (${ids.creatorBench.dataSourceId}): add ${Object.keys(CREATOR_BENCH_ADDITIONS).join(", ")}`);
  console.log(`3. Idea Lab (${ids.ideaLab.dataSourceId}): add ${Object.keys(IDEA_LAB_ADDITIONS).join(", ")}, relation "Source YouTube Video" ↔ "${YT_DB_TITLE}" "Reel Ideas"`);
  for (const [pageId, channel] of Object.entries(KNOWN_YOUTUBE_CHANNELS)) console.log(`4. Creator Bench row ${channel.name} (${pageId}): YouTube Channel URL = ${channel.channelUrl}`);
  console.log(`5. Print YT_OUTLIERS_DATABASE_ID / YT_OUTLIERS_DATA_SOURCE_ID for Trigger env.`);
}

async function main(): Promise<void> {
  if (offline) return plan();
  if (!process.env.NOTION_API_KEY) throw new Error("NOTION_API_KEY is required");
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  console.log(`YouTube outliers migration (${apply ? "APPLY" : "dry run, read-only"})`);

  // 1. Find or create the database.
  const children: any = await notion.blocks.children.list({ block_id: ids.rootPageId, page_size: 100 });
  const existingDb = children.results.find((block: any) => block.type === "child_database" && block.child_database?.title === YT_DB_TITLE);
  let databaseId = existingDb?.id || "";
  let dataSourceId = "";
  if (databaseId) {
    const db: any = await notion.databases.retrieve({ database_id: databaseId });
    dataSourceId = db.data_sources?.[0]?.id || "";
    console.log(`${YT_DB_TITLE}: already exists (${databaseId})`);
  } else {
    console.log(`${YT_DB_TITLE}: would create with ${Object.keys(YT_OUTLIER_PROPERTIES).length} properties`);
    if (apply) {
      const db: any = await notion.databases.create({
        parent: { type: "page_id", page_id: ids.rootPageId },
        title: [{ type: "text", text: { content: YT_DB_TITLE } }],
        icon: { type: "emoji", emoji: "📺" } as any,
        is_inline: false,
        initial_data_source: { properties: YT_OUTLIER_PROPERTIES },
      } as any);
      databaseId = db.id;
      dataSourceId = db.data_sources?.[0]?.id || "";
      if (!dataSourceId) throw new Error("Created the database without a data source");
    }
  }

  // Relation YouTube Outliers.Creator ↔ Creator Bench."YouTube Videos"
  if (dataSourceId) {
    const schema: any = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
    if (!schema.properties?.Creator) {
      console.log(`${YT_DB_TITLE}: add relation Creator ↔ Creator Bench.YouTube Videos`);
      if (apply) await notion.dataSources.update({ data_source_id: dataSourceId, properties: { Creator: dual(ids.creatorBench.dataSourceId, "YouTube Videos") } as any });
    }
  } else {
    console.log(`${YT_DB_TITLE}: add relation Creator ↔ Creator Bench.YouTube Videos (after create)`);
  }

  // 2 + 3. Additive properties.
  const additions: Array<[string, string, Record<string, any>]> = [
    ["Creator Bench", ids.creatorBench.dataSourceId, CREATOR_BENCH_ADDITIONS],
    ["Idea Lab", ids.ideaLab.dataSourceId, { ...IDEA_LAB_ADDITIONS, ...(dataSourceId ? { "Source YouTube Video": dual(dataSourceId, "Reel Ideas") } : {}) }],
  ];
  for (const [name, sourceId, desired] of additions) {
    const live: any = await notion.dataSources.retrieve({ data_source_id: sourceId });
    const missing = Object.fromEntries(Object.entries(desired).filter(([key]) => !live.properties?.[key]));
    if (!Object.keys(missing).length) {
      console.log(`${name}: up to date`);
      continue;
    }
    console.log(`${name}: add ${Object.keys(missing).join(", ")}`);
    if (apply) await notion.dataSources.update({ data_source_id: sourceId, properties: missing as any });
  }
  if (!dataSourceId) console.log(`Idea Lab: add relation Source YouTube Video ↔ ${YT_DB_TITLE}.Reel Ideas (after create)`);

  // 4. Seed known channel URLs (only when empty).
  for (const [pageId, channel] of Object.entries(KNOWN_YOUTUBE_CHANNELS)) {
    const page: any = await notion.pages.retrieve({ page_id: pageId });
    if (page.properties?.["YouTube Channel URL"]?.url) {
      console.log(`${channel.name}: YouTube Channel URL already set`);
      continue;
    }
    console.log(`${channel.name}: set YouTube Channel URL = ${channel.channelUrl}`);
    if (apply) await notion.pages.update({ page_id: pageId, properties: { "YouTube Channel URL": { url: channel.channelUrl } } as any });
  }

  console.log(apply
    ? `Done. Set in Trigger env (prod): YT_OUTLIERS_DATABASE_ID=${databaseId}  YT_OUTLIERS_DATA_SOURCE_ID=${dataSourceId}`
    : "Dry run only: nothing was written. Re-run with --apply.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
