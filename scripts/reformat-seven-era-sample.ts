import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import { reformatProductionPage } from "../src/lib/instagram-brain/notion";

dotenv.config({ override: true });
const SAMPLE_PAGE_ID = "3e44a5db-f371-8142-b0cb-c36f32e0ed14";
const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  if (!process.env.NOTION_API_KEY) throw new Error("NOTION_API_KEY is required");
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  const page: any = await notion.pages.retrieve({ page_id: SAMPLE_PAGE_ID });
  const title = (page.properties?.["Content Brief"]?.title || []).map((item: any) => item.plain_text).join("");
  if (title !== "AI Cast Me Across Every Era") throw new Error(`Unexpected sample title: ${title}`);
  if (!apply) {
    console.log(`Dry run: would reformat ${title} (${SAMPLE_PAGE_ID}); no Notion changes made.`);
    return;
  }
  await reformatProductionPage(SAMPLE_PAGE_ID, {
    objective: "A proposed 30-second, mostly silent AI visual Reel: Alisha crosses seven eras through doorways and ends on a composite of the journey. No footage has been produced yet.",
    requiredAssets: [
      { name: "Approved Alisha identity reference", required: true },
      { name: "Seven short era scenes with doorway transitions", required: true },
      { name: "Final seven-door composite frame", required: true },
      { name: "One-line voiceover and era-transition audio", required: true },
      { name: "Opening and closing text overlays", required: true },
    ],
    editingRhythm: [
      "Test one doorway transition and Alisha's identity consistency before producing the remaining scenes.",
      "Keep each era visually distinct; let the door motion link the scenes rather than forcing a continuous AI take.",
      "Build a clear sound motif around the transitions without requiring seven separate music tracks.",
      "Give the final composite enough time to read; adjust the 30-second timing after the first rough cut.",
    ],
    productionRisks: [
      "Alisha's appearance may drift across eras; test an identity reference and one transition first.",
      "The seven-door ending may need layered compositing rather than a single generation.",
      "Seven changes in 30 seconds may feel rushed; test the pacing in a rough cut.",
    ],
    decisionsNeeded: [
      "Confirm the AI video tool and identity-reference workflow. Higgsfield/Seedance is a candidate, not a selected tool.",
      "Choose whether Alisha's face remains visible in the astronaut scene.",
      "After the first test, decide whether all seven eras remain in the final cut.",
    ],
    complexity: "High",
    complexityReason: "Seven visual transformations, identity consistency, and a composite ending require testing.",
    toolCandidates: [{ name: "Higgsfield / Seedance", reason: "Possible visual-generation route; confirm fit before use." }],
    preflightChecklist: [
      "Render one doorway transition and inspect Alisha's identity consistency.",
      "Watch the rough cut muted and check whether each era is legible.",
      "Listen without the screen and check that the voice and sound cues support the idea.",
      "Inspect the final composite for clean edges, readable faces, and a clear payoff.",
      "Confirm any tool claims, caption copy, CTA, and music rights before posting.",
    ],
  });
  const blocks: any = await notion.blocks.children.list({ block_id: SAMPLE_PAGE_ID, page_size: 100 });
  const blockText = (block: any) => (block?.[block?.type]?.rich_text || []).map((item: any) => item.plain_text || item.text?.content || "").join("");
  const overview = blocks.results.find((block: any) => block.type === "paragraph" && blockText(block).includes("Alisha uses AI video generation to render herself"));
  const cta = blocks.results.find((block: any) => block.type === "bulleted_list_item" && blockText(block).startsWith("CTA:"));
  const internalNote = blocks.results.find((block: any) => block.type === "paragraph" && blockText(block).startsWith("Internal automation data is kept below"));
  if (overview) await notion.blocks.update({
    block_id: overview.id,
    paragraph: { rich_text: [{ type: "text", text: { content: "Proposed concept: Alisha crosses seven AI-created eras through doorways, then sees the journey in a final composite. This is an unproduced idea; the first transition and identity consistency still need testing." } }] },
  });
  if (cta) await notion.blocks.update({
    block_id: cta.id,
    bulleted_list_item: { rich_text: [{ type: "text", text: { content: "CTA: Which version should I explore next?" } }] },
  });
  if (internalNote) await notion.blocks.update({
    block_id: internalNote.id,
    paragraph: { rich_text: [{ type: "text", text: { content: "Internal JSON below is preserved from the original QA run. It may contain unverified wording; use the readable brief and unchecked production guide above as the working draft." } }] },
  });
  console.log(`Reformatted ${title} in place; source concept and automation JSON remain on the page.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
