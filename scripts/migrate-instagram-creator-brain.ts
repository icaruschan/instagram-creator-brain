import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import { CONTENT_TYPES, INSTAGRAM_BRAIN_PILLARS, YUNA_PILLARS } from "../src/lib/instagram-brain/config";

dotenv.config({ override: true });

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const dryRun = process.argv.includes("--dry-run");
const ROOT_TITLE = "Instagram Creator Brain";

type PropertyMap = Record<string, any>;
type DatabaseRef = { databaseId: string; dataSourceId: string };

const rich = (content: string) => [{ type: "text", text: { content } }];
const title = () => ({ type: "title", title: {} });
const text = () => ({ type: "rich_text", rich_text: {} });
const number = () => ({ type: "number", number: { format: "number" } });
const url = () => ({ type: "url", url: {} });
const date = () => ({ type: "date", date: {} });
const checkbox = () => ({ type: "checkbox", checkbox: {} });
const createdTime = () => ({ type: "created_time", created_time: {} });
const lastEditedTime = () => ({ type: "last_edited_time", last_edited_time: {} });
const select = (names: string[]) => ({
  type: "select",
  select: { options: names.map((name) => ({ name })) },
});
const multiSelect = (names: readonly string[]) => ({
  type: "multi_select",
  multi_select: { options: names.map((name) => ({ name })) },
});
const dualRelation = (dataSourceId: string, inverseName: string) => ({
  type: "relation",
  relation: {
    data_source_id: dataSourceId,
    type: "dual_property",
    dual_property: { synced_property_name: inverseName },
  },
});

const CREATOR_PROPERTIES: PropertyMap = {
  Name: title(),
  "Instagram Handle": text(),
  "Profile URL": url(),
  Status: select(["Active", "Paused", "Archived"]),
  "Primary Pillar": select([...INSTAGRAM_BRAIN_PILLARS]),
  Pillars: multiSelect(INSTAGRAM_BRAIN_PILLARS),
  "Format Sub-tags": multiSelect([
    "Cinematic storytelling",
    "AI characters",
    "World-building",
    "AI VFX",
    "AI commercials",
    "Art direction",
    "Tool tutorial",
    "Model comparison",
    "Prompt workflow",
    "Video editing",
    "Creator automation",
    "AI commentary",
  ]),
  "Why Tracked": text(),
  "Monitoring Tier": select(["Unassigned", "Core", "Rotational", "Manual only"]),
  "Follower Count": number(),
  "Last Profile Check": date(),
  "Last Checked": date(),
  "Baseline Median Views": number(),
  "Baseline Engagement Rate": number(),
  Created: createdTime(),
  "Last Edited": lastEditedTime(),
};

const REEL_PROPERTIES: PropertyMap = {
  Reel: title(),
  URL: url(),
  "Video URL": url(),
  Shortcode: text(),
  Caption: text(),
  Transcript: text(),
  "Cover URL": url(),
  "Published Date": date(),
  "Duration Seconds": number(),
  Views: number(),
  Likes: number(),
  Comments: number(),
  "Pinned Reel": checkbox(),
  "Manual Override": checkbox(),
  "Primary Pillar": select([...INSTAGRAM_BRAIN_PILLARS]),
  Pillars: multiSelect(INSTAGRAM_BRAIN_PILLARS),
  Status: select([
    "Raw",
    "Qualified",
    "Visual Analysis Ready",
    "Angles Ready",
    "Watchlist",
    "Ignored",
    "Failed",
  ]),
  "Action Requested": select([
    "None",
    "Generate Visual Angles",
    "Generate Operator Angles",
    "Generate Both",
    "Save for Later",
    "Ignore",
  ]),
  "Action State": select(["Idle", "Queued", "Processing", "Complete", "Failed"]),
  "Performance Score": number(),
  "Score Mode": select(["Static", "Velocity"]),
  "View Lift": number(),
  "Engagement Lift": number(),
  "Velocity Lift": number(),
  "Strategic Fit": select(["Core", "Supporting", "Adjacent", "Irrelevant"]),
  "Strategic Fit Score": number(),
  "Visual Pattern Value": number(),
  "Workflow Value": number(),
  "Recommended Mode": select(["Visual Storyteller", "AI Creative Operator", "Both", "Neither"]),
  "Jev Confidence": number(),
  "Priority Score": number(),
  "Gemini Analysis": text(),
  Pillar: select([...YUNA_PILLARS]),
  "Content Type": select([...CONTENT_TYPES]),
  "Last Analyzed": date(),
  "Last Error": text(),
  Created: createdTime(),
  "Last Edited": lastEditedTime(),
};

const SNAPSHOT_PROPERTIES: PropertyMap = {
  Snapshot: title(),
  "Captured At": date(),
  Views: number(),
  Likes: number(),
  Comments: number(),
  "Age Hours": number(),
  "Views Delta": number(),
  "Hours Delta": number(),
  "Views Per Hour": number(),
  Source: select(["Apify", "vidIQ", "Manual"]),
  Created: createdTime(),
};

const IDEA_PROPERTIES: PropertyMap = {
  Idea: title(),
  Status: select(["Angle Ready", "Selected", "Script Requested", "Script Ready", "Parked", "Rejected", "Failed"]),
  Account: select(["Unassigned", "Alisha", "Yuna", "Both"]),
  "Delivery Profile": select(["Visual-first", "Operator-first", "Hybrid"]),
  "Script Engine": select(["Kallaway", "RPN", "Hybrid"]),
  "Primary Pillar": select([...INSTAGRAM_BRAIN_PILLARS]),
  Pillars: multiSelect(INSTAGRAM_BRAIN_PILLARS),
  "Angle Summary": text(),
  "Spoken Hook": text(),
  "Text Hook": text(),
  "Visual Hook": text(),
  "Audio Hook": text(),
  "Three-Beat Outline": text(),
  "Why It Works": text(),
  "What Not To Copy": text(),
  Pillar: select([...YUNA_PILLARS]),
  "Content Type": select([...CONTENT_TYPES]),
  "Revision Notes": text(),
  "Action Requested": select(["None", "Generate Script", "Revise Angle", "Park", "Reject"]),
  "Action State": select(["Idle", "Queued", "Processing", "Complete", "Failed"]),
  "Priority Score": number(),
  "Last Error": text(),
  Created: createdTime(),
  "Last Edited": lastEditedTime(),
};

const PRODUCTION_PROPERTIES: PropertyMap = {
  "Content Brief": title(),
  Status: select([
    "Script Requested",
    "Script Ready",
    "Production Requested",
    "Blueprint Ready",
    "In Production",
    "Ready to Post",
    "Published",
    "Blocked",
    "Failed",
  ]),
  Account: select(["Unassigned", "Alisha", "Yuna", "Both"]),
  "Delivery Profile": select(["Visual-first", "Operator-first", "Hybrid"]),
  "Script Engine": select(["Kallaway", "RPN", "Hybrid"]),
  "Action Requested": select(["None", "Generate Script", "Generate Blueprint", "Mark Ready", "Mark Published"]),
  "Action State": select(["Idle", "Queued", "Processing", "Complete", "Failed"]),
  "Spoken Script": text(),
  "Lara Script": text(),
  "Lara Script Status": select(["Needed", "Drafted"]),
  "Chosen Script": select(["Undecided", "AI V2.3", "Lara"]),
  Pillar: select([...YUNA_PILLARS]),
  "Content Type": select([...CONTENT_TYPES]),
  "Spoken Hook": text(),
  "Text Hook": text(),
  "Visual Hook": text(),
  "Audio Hook": text(),
  "Production Blueprint": text(),
  "Required Assets": text(),
  "Production Risks": text(),
  "Decisions Needed": text(),
  Complexity: select(["Low", "Medium", "High"]),
  "Complexity Reason": text(),
  "Estimated Production Minutes": number(),
  "Post URL": url(),
  "Published At": date(),
  "Last Error": text(),
  Created: createdTime(),
  "Last Edited": lastEditedTime(),
};

const PERFORMANCE_PROPERTIES: PropertyMap = {
  "Performance Check": title(),
  Window: select(["24h", "7d", "30d"]),
  "Due At": date(),
  "Captured At": date(),
  Account: select(["Alisha", "Yuna", "Both"]),
  Views: number(),
  Reach: number(),
  Likes: number(),
  Comments: number(),
  Saves: number(),
  Shares: number(),
  "Average Watch Time": number(),
  "Completion Rate": number(),
  Follows: number(),
  "Profile Visits": number(),
  "Result Notes": text(),
  Source: select(["Instagram Insights", "Manual"]),
  Created: createdTime(),
};

interface CreatorSeed {
  name: string;
  handle: string;
  primary: (typeof INSTAGRAM_BRAIN_PILLARS)[number];
  pillars: Array<(typeof INSTAGRAM_BRAIN_PILLARS)[number]>;
  subTags: string[];
  why: string;
  followers: number;
}

const CREATORS: CreatorSeed[] = [
  { name: "Tim Koda", handle: "timkoda_", primary: "AI Creative Workflow", pillars: ["AI Creative Workflow", "Creative AI Video", "Creator AI Systems & Automation"], subTags: ["AI characters", "Prompt workflow", "Creator automation"], why: "Creative storytelling paired with repeatable AI production systems.", followers: 118700 },
  { name: "Soft Girl No Code", handle: "softgirlnocode", primary: "AI Creative Workflow", pillars: ["AI Creative Workflow", "AI Tools & Model Experiments"], subTags: ["Tool tutorial", "Video editing"], why: "Accessible AI and no-code creative workflows.", followers: 185700 },
  { name: "Sebastien Jefferies", handle: "sebastien", primary: "AI Creative Workflow", pillars: ["AI Creative Workflow", "Creative AI Video", "AI Tools & Model Experiments"], subTags: ["AI characters", "Tool tutorial"], why: "Creator-facing AI character, image, and video education.", followers: 781700 },
  { name: "Olivia in the City", handle: "olivia.inthecity", primary: "AI Creative Workflow", pillars: ["AI Creative Workflow", "AI Tools & Model Experiments"], subTags: ["Video editing", "Model comparison"], why: "AI-native video editing workflows and informed model commentary.", followers: 7100 },
  { name: "Shlabu", handle: "by.shlabu", primary: "Creator AI Systems & Automation", pillars: ["Creator AI Systems & Automation", "AI Creative Workflow"], subTags: ["Creator automation", "Tool tutorial"], why: "AI-driven systems for creator production and scale.", followers: 108900 },
  { name: "Sophie", handle: "nextbysophie", primary: "Creator AI Systems & Automation", pillars: ["Creator AI Systems & Automation", "AI Tools & Model Experiments"], subTags: ["Creator automation", "Tool tutorial"], why: "Practical AI agents, no-code systems, and business workflows.", followers: 11600 },
  { name: "Andries Ohneisser", handle: "ohneis652", primary: "Creative AI Video", pillars: ["Creative AI Video", "AI Creative Workflow"], subTags: ["Art direction", "AI commercials", "World-building"], why: "AI art direction, campaign visuals, and brand workflows.", followers: 423000 },
  { name: "Kaye Creatives", handle: "kaye.creatives", primary: "Creative AI Video", pillars: ["Creative AI Video", "AI Creative Workflow"], subTags: ["Cinematic storytelling", "AI characters", "World-building"], why: "High-performing visual-first AI storytelling and cinematic worlds.", followers: 295300 },
  { name: "Cindy Zhu", handle: "cindiezhu", primary: "AI Creative Workflow", pillars: ["AI Creative Workflow", "AI Tools & Model Experiments"], subTags: ["Prompt workflow", "Tool tutorial"], why: "AI image, creative prompting, and accessible no-code education.", followers: 157100 },
  { name: "Emily Higgins", handle: "itsemilyhiggins", primary: "AI & Creative Commentary", pillars: ["AI & Creative Commentary"], subTags: ["AI commentary"], why: "AI, psychology, creativity, and idea-led creator education.", followers: 243200 },
  { name: "Zoe Lu", handle: "leadwithzoe", primary: "Creator AI Systems & Automation", pillars: ["Creator AI Systems & Automation", "Creative AI Video", "AI & Creative Commentary"], subTags: ["Creator automation", "Cinematic storytelling"], why: "Personal AI use cases spanning routines, business, and creative family stories.", followers: 97500 },
  { name: "Sabrina Ramonov", handle: "sabrina_ramonov", primary: "AI Tools & Model Experiments", pillars: ["AI Tools & Model Experiments", "Creator AI Systems & Automation"], subTags: ["Tool tutorial", "Creator automation"], why: "High-reach AI tools, tactics, and creator growth systems.", followers: 1100000 },
  { name: "Sanjar Nai-Chien", handle: "sanji.chien", primary: "AI Creative Workflow", pillars: ["AI Creative Workflow", "AI Tools & Model Experiments", "Creative AI Video"], subTags: ["Tool tutorial", "Video editing", "AI VFX"], why: "Deep AI tutorials and creative motion/video workflows.", followers: 53500 },
  { name: "Zoe Wu", handle: "zoewu_", primary: "Creator AI Systems & Automation", pillars: ["Creator AI Systems & Automation", "AI & Creative Commentary"], subTags: ["Creator automation", "AI commentary"], why: "AI team systems, operator learning, and business-building observations.", followers: 50300 },
  { name: "Mariah Brunner", handle: "itsmariahbrunner", primary: "Creator AI Systems & Automation", pillars: ["Creator AI Systems & Automation", "AI Tools & Model Experiments"], subTags: ["Creator automation", "Tool tutorial"], why: "AI systems, skills, agents, and practical founder education.", followers: 256400 },
  { name: "Soojin", handle: "soojintech", primary: "AI Tools & Model Experiments", pillars: ["AI Tools & Model Experiments", "Creator AI Systems & Automation"], subTags: ["Tool tutorial", "Model comparison"], why: "Friendly technical explainers for AI tools and coding workflows.", followers: 114400 },
  { name: "Sati Mukhanova", handle: "sadiesfactionn", primary: "Creative AI Video", pillars: ["Creative AI Video", "AI Creative Workflow"], subTags: ["AI VFX", "Cinematic storytelling"], why: "Visual-first AI/VFX concepts and meme storytelling.", followers: 21000 },
  { name: "Leah Kia", handle: "leahtalkstech", primary: "Creative AI Video", pillars: ["Creative AI Video", "AI Creative Workflow", "AI Tools & Model Experiments"], subTags: ["World-building", "AI VFX", "AI commercials"], why: "Fantasy visuals, creative effects, and practical creator workflows.", followers: 8200 },
  { name: "Zami Zafar", handle: "thezamizafar", primary: "Creative AI Video", pillars: ["Creative AI Video", "AI Creative Workflow"], subTags: ["Cinematic storytelling", "World-building", "AI VFX"], why: "Fantasy visual stories, effects, and prompt-led workflows.", followers: 34000 },
  { name: "Skai", handle: "skaigenerated", primary: "AI Tools & Model Experiments", pillars: ["AI Tools & Model Experiments", "Creative AI Video", "AI Creative Workflow"], subTags: ["Model comparison", "Tool tutorial", "AI commercials"], why: "AI video/image model comparisons and production experiments.", followers: 169700 },
];

function pageTitle(page: any): string {
  for (const value of Object.values(page.properties || {}) as any[]) {
    if (value?.type === "title" && Array.isArray(value.title)) {
      return value.title.map((item: any) => item.plain_text || "").join("");
    }
  }
  return "";
}

async function findRootPage(): Promise<any | null> {
  const explicitRootId = process.env.IG_BRAIN_ROOT_PAGE_ID?.trim();
  if (explicitRootId) {
    try {
      const page: any = await notion.pages.retrieve({ page_id: explicitRootId });
      if (pageTitle(page) === ROOT_TITLE) return page;
      throw new Error(`IG_BRAIN_ROOT_PAGE_ID points to "${pageTitle(page)}", not ${ROOT_TITLE}`);
    } catch (error) {
      throw new Error(`Unable to access IG_BRAIN_ROOT_PAGE_ID: ${(error as Error).message}`);
    }
  }
  const response = await notion.search({ query: ROOT_TITLE, page_size: 100 });
  for (const item of response.results as any[]) {
    if (
      item.object === "page" &&
      pageTitle(item) === ROOT_TITLE
    ) {
      return item;
    }
  }
  return null;
}

async function ensureRootPage(): Promise<string> {
  const existing = await findRootPage();
  if (existing) {
    console.log(`Root page already exists: ${existing.id}`);
    return existing.id;
  }
  console.log(`Create workspace page: ${ROOT_TITLE}`);
  if (dryRun) return "DRY_RUN_ROOT";
  const page: any = await notion.pages.create({
    parent: { type: "workspace", workspace: true },
    icon: { type: "emoji", emoji: "🎬" },
    properties: { title: { type: "title", title: rich(ROOT_TITLE) } },
    children: [
      {
        object: "block",
        type: "callout",
        callout: {
          icon: { type: "emoji", emoji: "🧠" },
          color: "blue_background",
          rich_text: rich("Your selective Instagram research-to-production desk. Review qualified opportunities here; raw processing remains backstage."),
        },
      },
      { object: "block", type: "heading_1", heading_1: { rich_text: rich("Creator Desk") } },
      { object: "block", type: "paragraph", paragraph: { rich_text: rich("Scan → qualify → study → choose an angle → generate a script → build the production plan. Nothing publishes automatically.") } },
      { object: "block", type: "divider", divider: {} },
      { object: "block", type: "heading_2", heading_2: { rich_text: rich("How to use this workspace") } },
      { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich("Reel Intelligence: review Top Outliers, Visual-first sources, Workflow-first sources, and Watchlist items.") } },
      { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich("Idea Lab: choose one original angle (Account defaults to Yuna while Alisha is on hold) and a delivery profile.") } },
      { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich("Production Queue: work from the approved script and blueprint; publishing remains manual.") } },
    ] as any,
  });
  return page.id;
}

async function childDatabaseMap(rootPageId: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (rootPageId === "DRY_RUN_ROOT") return found;
  let cursor: string | undefined;
  do {
    const response: any = await notion.blocks.children.list({
      block_id: rootPageId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const block of response.results) {
      if (block.type === "child_database") {
        found.set(block.child_database.title, block.id);
      }
    }
    cursor = response.has_more ? response.next_cursor || undefined : undefined;
  } while (cursor);
  return found;
}

async function ensureDatabase(
  rootPageId: string,
  name: string,
  icon: string,
  properties: PropertyMap,
): Promise<DatabaseRef> {
  const children = await childDatabaseMap(rootPageId);
  const existingId = children.get(name);
  if (existingId) {
    const database: any = await notion.databases.retrieve({ database_id: existingId });
    const dataSourceId = database.data_sources?.[0]?.id;
    if (!dataSourceId) throw new Error(`${name} has no data source`);
    let source: any = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
    if (name === "Production Queue" && source.properties?.Blockers && !source.properties?.["Production Risks"]) {
      if (!dryRun) {
        await notion.dataSources.update({
          data_source_id: dataSourceId,
          properties: { [source.properties.Blockers.id]: { name: "Production Risks" } } as any,
        });
        source = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
      } else {
        console.log("Production Queue: would rename Blockers to Production Risks");
      }
    }
    const missing: PropertyMap = {};
    for (const [propertyName, definition] of Object.entries(properties)) {
      if (!source.properties?.[propertyName]) missing[propertyName] = definition;
    }
    if (Object.keys(missing).length > 0 && !dryRun) {
      await notion.dataSources.update({
        data_source_id: dataSourceId,
        properties: missing as any,
      });
    }
    console.log(`${name}: already exists`);
    return { databaseId: database.id, dataSourceId };
  }

  console.log(`${name}: create database`);
  if (dryRun) {
    const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    return { databaseId: `DRY_${slug}_DB`, dataSourceId: `DRY_${slug}_DS` };
  }
  const database: any = await notion.databases.create({
    parent: { type: "page_id", page_id: rootPageId },
    title: rich(name),
    icon: { type: "emoji", emoji: icon } as any,
    is_inline: false,
    initial_data_source: { properties },
  });
  const dataSourceId = database.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error(`Created ${name} without a data source`);
  return { databaseId: database.id, dataSourceId };
}

async function ensureRelation(
  source: DatabaseRef,
  propertyName: string,
  target: DatabaseRef,
  inverseName: string,
): Promise<void> {
  if (dryRun) {
    console.log(`Relation: ${propertyName} ↔ ${inverseName}`);
    return;
  }
  const schema: any = await notion.dataSources.retrieve({ data_source_id: source.dataSourceId });
  if (schema.properties?.[propertyName]) return;
  await notion.dataSources.update({
    data_source_id: source.dataSourceId,
    properties: { [propertyName]: dualRelation(target.dataSourceId, inverseName) } as any,
  });
}

async function seedCreators(database: DatabaseRef): Promise<void> {
  if (dryRun) {
    console.log(`Creator Bench: seed ${CREATORS.length} creators`);
    return;
  }
  const existingHandles = new Set<string>();
  let cursor: string | undefined;
  do {
    const response: any = await notion.dataSources.query({
      data_source_id: database.dataSourceId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const page of response.results) {
      const handle = page.properties?.["Instagram Handle"]?.rich_text?.[0]?.plain_text;
      if (handle) existingHandles.add(handle.toLowerCase());
    }
    cursor = response.has_more ? response.next_cursor || undefined : undefined;
  } while (cursor);

  for (const creator of CREATORS) {
    if (existingHandles.has(creator.handle.toLowerCase())) continue;
    await notion.pages.create({
      parent: { database_id: database.databaseId },
      properties: {
        Name: { title: rich(creator.name) },
        "Instagram Handle": { rich_text: rich(creator.handle) },
        "Profile URL": { url: `https://www.instagram.com/${creator.handle}/` },
        Status: { select: { name: "Active" } },
        "Primary Pillar": { select: { name: creator.primary } },
        Pillars: { multi_select: creator.pillars.map((name) => ({ name })) },
        "Format Sub-tags": { multi_select: creator.subTags.map((name) => ({ name })) },
        "Why Tracked": { rich_text: rich(creator.why) },
        "Monitoring Tier": { select: { name: "Unassigned" } },
        "Follower Count": { number: creator.followers },
        "Last Profile Check": { date: { start: "2026-09-21" } },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

async function main(): Promise<void> {
  if (!process.env.NOTION_API_KEY) throw new Error("NOTION_API_KEY is required");
  console.log(`Instagram Creator Brain migration (${dryRun ? "dry run" : "apply"})`);
  const rootPageId = await ensureRootPage();
  const creatorBench = await ensureDatabase(rootPageId, "Creator Bench", "👥", CREATOR_PROPERTIES);
  const reelIntelligence = await ensureDatabase(rootPageId, "Reel Intelligence", "🎞️", REEL_PROPERTIES);
  const reelSnapshots = await ensureDatabase(rootPageId, "Reel Snapshots", "📈", SNAPSHOT_PROPERTIES);
  const ideaLab = await ensureDatabase(rootPageId, "Idea Lab", "💡", IDEA_PROPERTIES);
  const productionQueue = await ensureDatabase(rootPageId, "Production Queue", "🎬", PRODUCTION_PROPERTIES);
  const performanceLog = await ensureDatabase(rootPageId, "Performance Log", "📊", PERFORMANCE_PROPERTIES);

  await ensureRelation(creatorBench, "Reels", reelIntelligence, "Creator");
  await ensureRelation(reelIntelligence, "Snapshots", reelSnapshots, "Reel");
  await ensureRelation(reelIntelligence, "Ideas", ideaLab, "Source Reel");
  await ensureRelation(ideaLab, "Production Item", productionQueue, "Idea");
  await ensureRelation(productionQueue, "Performance Records", performanceLog, "Production Item");
  await seedCreators(creatorBench);

  const manifest = {
    rootPageId,
    creatorBench,
    reelIntelligence,
    reelSnapshots,
    ideaLab,
    productionQueue,
    performanceLog,
  };
  console.log(`INSTAGRAM_BRAIN_IDS_JSON=${JSON.stringify(manifest)}`);
  console.log(dryRun ? "Dry run complete; no Notion changes were made." : "Migration complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
