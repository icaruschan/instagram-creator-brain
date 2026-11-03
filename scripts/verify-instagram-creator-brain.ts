import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import { INSTAGRAM_BRAIN_NOTION_IDS } from "../src/lib/instagram-brain/notion-ids";

dotenv.config({ override: true });
const notion = new Client({ auth: process.env.NOTION_API_KEY });

const REQUIRED: Record<string, { id: string; properties: string[] }> = {
  "Creator Bench": {
    id: INSTAGRAM_BRAIN_NOTION_IDS.creatorBench.dataSourceId,
    properties: ["Name", "Instagram Handle", "Primary Pillar", "Pillars", "Reels", "Status", "Monitoring Tier", "Last Checked"],
  },
  "Reel Intelligence": {
    id: INSTAGRAM_BRAIN_NOTION_IDS.reelIntelligence.dataSourceId,
    properties: ["Reel", "Creator", "URL", "Shortcode", "Snapshots", "Ideas", "Performance Score", "Strategic Fit Score", "Visual Pattern Value", "Workflow Value", "Priority Score", "Action Requested", "Action State"],
  },
  "Reel Snapshots": {
    id: INSTAGRAM_BRAIN_NOTION_IDS.reelSnapshots.dataSourceId,
    properties: ["Snapshot", "Reel", "Captured At", "Views", "Likes", "Comments", "Views Per Hour"],
  },
  "Idea Lab": {
    id: INSTAGRAM_BRAIN_NOTION_IDS.ideaLab.dataSourceId,
    properties: ["Idea", "Source Reel", "Account", "Delivery Profile", "Script Engine", "Production Item", "Action Requested", "Action State"],
  },
  "Production Queue": {
    id: INSTAGRAM_BRAIN_NOTION_IDS.productionQueue.dataSourceId,
    properties: ["Content Brief", "Idea", "Spoken Script", "Production Blueprint", "Production Risks", "Decisions Needed", "Complexity", "Complexity Reason", "Performance Records", "Action Requested", "Action State"],
  },
  "Performance Log": {
    id: INSTAGRAM_BRAIN_NOTION_IDS.performanceLog.dataSourceId,
    properties: ["Performance Check", "Production Item", "Window", "Views", "Saves", "Shares", "Completion Rate"],
  },
};

async function main(): Promise<void> {
  const root: any = await notion.pages.retrieve({ page_id: INSTAGRAM_BRAIN_NOTION_IDS.rootPageId });
  console.log(`Root page accessible: ${root.url}`);
  let failures = 0;
  for (const [label, config] of Object.entries(REQUIRED)) {
    const source: any = await notion.dataSources.retrieve({ data_source_id: config.id });
    const missing = config.properties.filter((name) => !source.properties?.[name]);
    if (missing.length) {
      failures++;
      console.error(`${label}: missing ${missing.join(", ")}`);
    } else {
      console.log(`${label}: schema OK`);
    }
  }

  const creators: any = await notion.dataSources.query({
    data_source_id: INSTAGRAM_BRAIN_NOTION_IDS.creatorBench.dataSourceId,
    page_size: 100,
  });
  const handles = creators.results
    .map((page: any) => page.properties?.["Instagram Handle"]?.rich_text?.[0]?.plain_text)
    .filter(Boolean);
  if (handles.length !== 20 || new Set(handles).size !== 20) {
    failures++;
    console.error(`Creator Bench: expected 20 unique creators, found ${handles.length}/${new Set(handles).size}`);
  } else {
    console.log("Creator Bench: 20 unique creators seeded");
  }
  if (failures) throw new Error(`${failures} Instagram Creator Brain verification group(s) failed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
