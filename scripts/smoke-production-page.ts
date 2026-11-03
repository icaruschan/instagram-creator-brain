import assert from "node:assert/strict";
import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import { INSTAGRAM_BRAIN_NOTION_IDS } from "../src/lib/instagram-brain/notion-ids";
import { BRIEF_MARKER, SCRIPT_DATA_TITLE, renderCreativeBrief } from "../src/lib/instagram-brain/production-brief";

dotenv.config({ override: true });

async function main(): Promise<void> {
  if (!process.env.NOTION_API_KEY) throw new Error("NOTION_API_KEY is required");
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const script = {
    spokenScript: "A short test line.", durationSeconds: 12,
    beats: [{ time: "0–3s", visual: "A doorway opens.", spoken: "A short test line.", text: "A new world", audio: "Soft door sound" }],
    captionOptions: ["A test concept"], ctaOptions: ["Which scene next?"],
  };
  let pageId = "";
  try {
    const page: any = await notion.pages.create({
      parent: { database_id: INSTAGRAM_BRAIN_NOTION_IDS.productionQueue.databaseId },
      properties: {
        "Content Brief": { title: [{ text: { content: "[QA] Production Brief Renderer" } }] },
        Status: { select: { name: "Script Ready" } },
        Account: { select: { name: "Alisha" } },
        "Delivery Profile": { select: { name: "Visual-first" } },
      },
      children: [
        ...renderCreativeBrief({ account: "Alisha", deliveryProfile: "Visual-first", summary: "A test concept.", script }),
        { object: "block", type: "toggle", toggle: {
          rich_text: [{ text: { content: SCRIPT_DATA_TITLE } }],
          children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: JSON.stringify(script) } }] } }],
        } },
      ] as any,
    });
    pageId = page.id;
    const blocks: any = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
    const label = (item: any) => (item[item.type]?.rich_text || []).map((part: any) => part.plain_text).join("");
    assert.match(label(blocks.results[0]), new RegExp(BRIEF_MARKER));
    assert.equal(label(blocks.results.at(-1)), SCRIPT_DATA_TITLE);
    console.log("Notion page-create smoke test passed; readable brief precedes internal JSON.");
  } finally {
    if (pageId) {
      await notion.pages.update({ page_id: pageId, archived: true });
      console.log("Archived temporary QA page.");
    }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
