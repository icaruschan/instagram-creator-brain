import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import { INSTAGRAM_BRAIN_NOTION_IDS as ids } from "../src/lib/instagram-brain/notion-ids";

dotenv.config({ override: true });
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const creatorPageId = process.argv.find((arg) => arg.startsWith("--creator="))?.split("=")[1];
const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  if (!creatorPageId) throw new Error("Pass --creator=<Notion creator page ID>");
  const reels: any = await notion.dataSources.query({
    data_source_id: ids.reelIntelligence.dataSourceId,
    filter: { property: "Creator", relation: { contains: creatorPageId } },
    page_size: 100,
  });
  let repaired = 0;
  for (const reel of reels.results) {
    const snapshots: any = await notion.dataSources.query({
      data_source_id: ids.reelSnapshots.dataSourceId,
      filter: { property: "Reel", relation: { contains: reel.id } },
      page_size: 100,
    });
    const views = Math.max(reel.properties.Views?.number || 0, ...snapshots.results.map((row: any) => row.properties.Views?.number || 0));
    const current = reel.properties.Views?.number || 0;
    if (views <= current) continue;
    repaired++;
    console.log(`${reel.properties.Shortcode?.rich_text?.[0]?.plain_text || reel.id}: ${current} -> ${views}`);
    if (apply) await notion.pages.update({ page_id: reel.id, properties: { Views: { number: views } } });
  }
  console.log(`${apply ? "Repaired" : "Would repair"} ${repaired} of ${reels.results.length} Reel records.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
