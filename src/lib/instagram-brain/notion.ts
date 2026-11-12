import { Client } from "@notionhq/client";
import { summarizeOwnPostResults, type OwnPostResult } from "./learning";
import dotenv from "dotenv";
import { INSTAGRAM_BRAIN_NOTION_IDS } from "./notion-ids";
import {
  BLUEPRINT_DATA_TITLE,
  BRIEF_MARKER,
  PRODUCTION_PLAN_TITLE,
  SCRIPT_DATA_TITLE,
  normalizeBlueprint,
  normalizeScriptPackage,
  renderCreativeBrief,
  renderProductionPlan,
} from "./production-brief";
import type { InstagramCreator, ReelMetrics } from "./types";
import { activeAccounts, type ContentType, type YunaPillar } from "./config";
import type { AnglePreview } from "./types";

dotenv.config({ override: true });

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const rich = (content: string) => [
  { type: "text" as const, text: { content: content.slice(0, 2000) } },
];

function requireIds(): void {
  if (!INSTAGRAM_BRAIN_NOTION_IDS.creatorBench.dataSourceId) {
    throw new Error("Instagram Creator Brain Notion IDs are not configured");
  }
}

function titlePlain(property: any): string {
  return (property?.title || []).map((item: any) => item.plain_text || "").join("");
}

function textPlain(property: any): string {
  return (property?.rich_text || []).map((item: any) => item.plain_text || "").join("");
}

export async function getActiveInstagramCreators(limit = 100): Promise<InstagramCreator[]> {
  requireIds();
  const response: any = await notion.dataSources.query({
    data_source_id: INSTAGRAM_BRAIN_NOTION_IDS.creatorBench.dataSourceId,
    filter: { and: [
      { property: "Status", select: { equals: "Active" } },
      { property: "Monitoring Tier", select: { does_not_equal: "Manual only" } },
    ] },
    sorts: [{ property: "Last Checked", direction: "ascending" }],
    page_size: Math.min(100, limit),
  });

  return response.results.map((page: any) => {
    const p = page.properties || {};
    return {
      pageId: page.id,
      name: titlePlain(p.Name),
      handle: textPlain(p["Instagram Handle"]),
      profileUrl: p["Profile URL"]?.url || "",
      status: p.Status?.select?.name || "Active",
      primaryPillar: p["Primary Pillar"]?.select?.name,
      pillars: (p.Pillars?.multi_select || []).map((item: any) => item.name),
      lastChecked: p["Last Checked"]?.date?.start || null,
      followerCount: p["Follower Count"]?.number || 0,
      baselineMedianViews: p["Baseline Median Views"]?.number || 0,
      baselineEngagementRate: p["Baseline Engagement Rate"]?.number || 0,
    } as InstagramCreator;
  });
}

export async function getInstagramCreator(pageId: string): Promise<InstagramCreator> {
  const page: any = await notion.pages.retrieve({ page_id: pageId });
  const p = page.properties || {};
  return {
    pageId: page.id,
    name: titlePlain(p.Name),
    handle: textPlain(p["Instagram Handle"]),
    profileUrl: p["Profile URL"]?.url || "",
    status: p.Status?.select?.name || "Active",
    primaryPillar: p["Primary Pillar"]?.select?.name,
    pillars: (p.Pillars?.multi_select || []).map((item: any) => item.name),
    lastChecked: p["Last Checked"]?.date?.start || null,
    followerCount: p["Follower Count"]?.number || 0,
    baselineMedianViews: p["Baseline Median Views"]?.number || 0,
    baselineEngagementRate: p["Baseline Engagement Rate"]?.number || 0,
  } as InstagramCreator;
}

export async function getCreatorReelUrls(creatorPageId: string): Promise<string[]> {
  requireIds();
  const urls: string[] = [];
  let cursor: string | undefined;
  do {
    const response: any = await notion.dataSources.query({
      data_source_id: INSTAGRAM_BRAIN_NOTION_IDS.reelIntelligence.dataSourceId,
      filter: { property: "Creator", relation: { contains: creatorPageId } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const page of response.results) {
      const value = page.properties?.URL?.url;
      if (value) urls.push(value);
    }
    cursor = response.has_more ? response.next_cursor || undefined : undefined;
  } while (cursor);
  return urls;
}

export interface StoredReel {
  pageId: string;
  creatorPageId: string;
  shortcode: string;
  url: string;
  videoUrl: string;
  title: string;
  caption: string;
  transcript: string;
  primaryPillar: string;
  pillars: string[];
  publishedAt: string;
  pinned: boolean;
  metrics: ReelMetrics;
  metricsTrusted?: boolean;
  performanceScore: number;
  geminiAnalysis: string;
  strategicFitScore: number;
  visualPatternValue: number;
  workflowValue: number;
  priorityScore: number;
  status: string;
  strategicFit: string;
  manualOverride: boolean;
  pillar: YunaPillar | "";
  contentType: ContentType | "";
}

function mapReel(page: any): StoredReel {
  const p = page.properties || {};
  return {
    pageId: page.id,
    creatorPageId: p.Creator?.relation?.[0]?.id || "",
    shortcode: textPlain(p.Shortcode),
    url: p.URL?.url || "",
    videoUrl: p["Video URL"]?.url || "",
    title: titlePlain(p.Reel),
    caption: textPlain(p.Caption),
    transcript: textPlain(p.Transcript),
    primaryPillar: p["Primary Pillar"]?.select?.name || "",
    pillars: (p.Pillars?.multi_select || []).map((item: any) => item.name),
    publishedAt: p["Published Date"]?.date?.start || "",
    pinned: Boolean(p["Pinned Reel"]?.checkbox),
    metrics: {
      views: p.Views?.number || 0,
      likes: p.Likes?.number || 0,
      comments: p.Comments?.number || 0,
    },
    performanceScore: p["Performance Score"]?.number || 0,
    geminiAnalysis: textPlain(p["Gemini Analysis"]),
    strategicFitScore: p["Strategic Fit Score"]?.number || 0,
    visualPatternValue: p["Visual Pattern Value"]?.number || 0,
    workflowValue: p["Workflow Value"]?.number || 0,
    priorityScore: p["Priority Score"]?.number || 0,
    status: p.Status?.select?.name || "",
    strategicFit: p["Strategic Fit"]?.select?.name || "",
    manualOverride: Boolean(p["Manual Override"]?.checkbox),
    pillar: p.Pillar?.select?.name || "",
    contentType: p["Content Type"]?.select?.name || "",
  };
}

export async function getCreatorReels(creatorPageId: string): Promise<StoredReel[]> {
  requireIds();
  const rows: StoredReel[] = [];
  let cursor: string | undefined;
  do {
    const response: any = await notion.dataSources.query({
      data_source_id: INSTAGRAM_BRAIN_NOTION_IDS.reelIntelligence.dataSourceId,
      filter: { property: "Creator", relation: { contains: creatorPageId } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    rows.push(...response.results.map(mapReel));
    cursor = response.has_more ? response.next_cursor || undefined : undefined;
  } while (cursor);
  return rows;
}

export interface CreateReelInput {
  creatorPageId: string;
  creatorName: string;
  primaryPillar: string;
  pillars: string[];
  shortcode: string;
  url: string;
  caption: string;
  transcript: string;
  publishedAt: string;
  durationSeconds: number;
  pinned?: boolean;
  coverUrl?: string;
  videoUrl?: string;
  metrics: ReelMetrics;
}

export async function findReelByUrl(urlValue: string): Promise<StoredReel | null> {
  requireIds();
  const response: any = await notion.dataSources.query({
    data_source_id: INSTAGRAM_BRAIN_NOTION_IDS.reelIntelligence.dataSourceId,
    filter: { property: "URL", url: { equals: urlValue } },
    page_size: 1,
  });
  return response.results[0] ? mapReel(response.results[0]) : null;
}

export async function createOrUpdateReel(input: CreateReelInput): Promise<StoredReel> {
  requireIds();
  const existing = await findReelByUrl(input.url);
  const metricsTrusted = input.metrics.views > 0 && (!existing || input.metrics.views >= existing.metrics.views);
  const metrics: ReelMetrics = existing ? {
    views: metricsTrusted ? input.metrics.views : existing.metrics.views,
    likes: input.metrics.likes > 0 ? input.metrics.likes : existing.metrics.likes,
    comments: input.metrics.comments > 0 ? input.metrics.comments : existing.metrics.comments,
  } : input.metrics;
  const properties: Record<string, any> = {
    Reel: { title: rich(`${input.creatorName}: ${input.caption.slice(0, 90) || input.shortcode}`) },
    URL: { url: input.url },
    Shortcode: { rich_text: rich(input.shortcode) },
    Caption: { rich_text: rich(input.caption) },
    "Published Date": input.publishedAt ? { date: { start: input.publishedAt } } : { date: null },
    "Duration Seconds": { number: input.durationSeconds || 0 },
    Views: { number: metrics.views },
    Likes: { number: metrics.likes },
    Comments: { number: metrics.comments },
    "Pinned Reel": { checkbox: Boolean(input.pinned) },
    "Primary Pillar": { select: { name: input.primaryPillar } },
    Pillars: { multi_select: input.pillars.map((name) => ({ name })) },
    Creator: { relation: [{ id: input.creatorPageId }] },
  };
  if (input.transcript || !existing) properties.Transcript = { rich_text: rich(input.transcript) };
  if (input.coverUrl) properties["Cover URL"] = { url: input.coverUrl };
  if (input.videoUrl) properties["Video URL"] = { url: input.videoUrl };

  if (existing) {
    await notion.pages.update({ page_id: existing.pageId, properties });
    return { ...existing, caption: input.caption, transcript: input.transcript || existing.transcript, metrics, metricsTrusted };
  }

  const page: any = await notion.pages.create({
    parent: { database_id: INSTAGRAM_BRAIN_NOTION_IDS.reelIntelligence.databaseId },
    properties: { ...properties, Status: { select: { name: "Raw" } }, "Action Requested": { select: { name: "None" } }, "Action State": { select: { name: "Idle" } } },
  });
  return { ...mapReel(page), metricsTrusted };
}

export async function createReelSnapshot(
  reel: StoredReel,
  source: "Apify" | "vidIQ" | "Manual" = "Apify",
  capturedAt = new Date(),
  previous?: { capturedAt: string; views: number },
): Promise<string> {
  requireIds();
  const published = reel.publishedAt ? new Date(reel.publishedAt) : capturedAt;
  const ageHours = Math.max(0, (capturedAt.getTime() - published.getTime()) / 3_600_000);
  const hoursDelta = previous
    ? Math.max(0, (capturedAt.getTime() - new Date(previous.capturedAt).getTime()) / 3_600_000)
    : 0;
  const viewsDelta = previous ? Math.max(0, reel.metrics.views - previous.views) : 0;
  const page: any = await notion.pages.create({
    parent: { database_id: INSTAGRAM_BRAIN_NOTION_IDS.reelSnapshots.databaseId },
    properties: {
      Snapshot: { title: rich(`${reel.shortcode} @ ${capturedAt.toISOString()}`) },
      Reel: { relation: [{ id: reel.pageId }] },
      "Captured At": { date: { start: capturedAt.toISOString() } },
      Views: { number: reel.metrics.views },
      Likes: { number: reel.metrics.likes },
      Comments: { number: reel.metrics.comments },
      "Age Hours": { number: Math.round(ageHours * 10) / 10 },
      "Views Delta": { number: viewsDelta },
      "Hours Delta": { number: Math.round(hoursDelta * 100) / 100 },
      "Views Per Hour": { number: hoursDelta > 0 ? Math.round((viewsDelta / hoursDelta) * 10) / 10 : 0 },
      Source: { select: { name: source } },
    },
  });
  return page.id;
}

export async function getLatestReelSnapshot(
  reelPageId: string,
): Promise<{ capturedAt: string; views: number; likes: number; comments: number } | null> {
  const response: any = await notion.dataSources.query({
    data_source_id: INSTAGRAM_BRAIN_NOTION_IDS.reelSnapshots.dataSourceId,
    filter: { property: "Reel", relation: { contains: reelPageId } },
    sorts: [{ property: "Captured At", direction: "descending" }],
    page_size: 20,
  });
  const page = response.results.reduce((best: any, candidate: any) => {
    if (!best) return candidate;
    return (candidate.properties?.Views?.number || 0) > (best.properties?.Views?.number || 0) ? candidate : best;
  }, null);
  if (!page) return null;
  const p = page.properties || {};
  return {
    capturedAt: p["Captured At"]?.date?.start || "",
    views: p.Views?.number || 0,
    likes: p.Likes?.number || 0,
    comments: p.Comments?.number || 0,
  };
}

export async function updateReelScore(
  pageId: string,
  score: { viewLift: number; engagementLift: number; velocityLift: number | null; score: number; mode: "static" | "velocity" },
): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "View Lift": { number: score.viewLift },
      "Engagement Lift": { number: score.engagementLift },
      "Velocity Lift": { number: score.velocityLift },
      "Performance Score": { number: score.score },
      "Score Mode": { select: { name: score.mode === "velocity" ? "Velocity" : "Static" } },
    },
  });
}

export async function updateCreatorCheckpoint(
  creatorPageId: string,
  values: { lastChecked?: string; medianViews?: number; medianEngagementRate?: number },
): Promise<void> {
  const properties: Record<string, any> = {};
  if (values.lastChecked) properties["Last Checked"] = { date: { start: values.lastChecked } };
  if (values.medianViews != null) properties["Baseline Median Views"] = { number: values.medianViews };
  if (values.medianEngagementRate != null) properties["Baseline Engagement Rate"] = { number: values.medianEngagementRate };
  if (Object.keys(properties).length > 0) await notion.pages.update({ page_id: creatorPageId, properties });
}

export async function getReel(pageId: string): Promise<StoredReel> {
  requireIds();
  const page: any = await notion.pages.retrieve({ page_id: pageId });
  const reel = mapReel(page);
  const fullAnalysis = await readToggleBody(pageId, "▶️ Full Gemini Visual Analysis");
  if (fullAnalysis) reel.geminiAnalysis = fullAnalysis;
  return reel;
}

function textBlocks(value: string): any[] {
  const chunks = value.match(/[\s\S]{1,1800}/g) || [];
  return chunks.map((content) => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: rich(content) },
  }));
}

async function appendToggle(pageId: string, titleValue: string, body: string): Promise<void> {
  if (!body.trim()) return;
  await notion.blocks.children.append({
    block_id: pageId,
    children: [
      {
        object: "block",
        type: "toggle",
        toggle: { rich_text: rich(titleValue), children: textBlocks(body) },
      },
    ] as any,
  });
}

function blockText(block: any): string {
  return (block?.[block?.type]?.rich_text || []).map((item: any) => item.plain_text || item.text?.content || "").join("");
}

async function productionBlocks(pageId: string): Promise<any[]> {
  const response: any = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
  return response.results;
}

async function findProductionBlock(pageId: string, value: string): Promise<any | null> {
  return (await productionBlocks(pageId)).find((block) => blockText(block).includes(value)) || null;
}

async function ensureReadableBrief(
  pageId: string,
  input: { account: string; deliveryProfile: "Visual-first" | "Operator-first" | "Hybrid"; summary: string; script: Record<string, any> },
): Promise<void> {
  if (await findProductionBlock(pageId, BRIEF_MARKER)) return;
  await notion.blocks.children.append({
    block_id: pageId,
    position: { type: "start" },
    children: renderCreativeBrief(input) as any,
  });
}

async function ensureReadableProductionPlan(pageId: string, blueprint: Record<string, any>): Promise<void> {
  const planBlock = await findProductionBlock(pageId, PRODUCTION_PLAN_TITLE);
  if (!planBlock) throw new Error("Readable production-plan section was not found");
  if (planBlock.has_children) return;
  await notion.blocks.children.append({
    block_id: planBlock.id,
    children: renderProductionPlan(blueprint) as any,
  });
}

async function ensureBlueprintData(pageId: string, blueprint: Record<string, any>): Promise<void> {
  if (await findProductionBlock(pageId, BLUEPRINT_DATA_TITLE)) return;
  await appendToggle(pageId, BLUEPRINT_DATA_TITLE, JSON.stringify(blueprint, null, 2));
}

async function readToggleBody(pageId: string, titleValue: string): Promise<string> {
  const blocks: any = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
  const toggle = blocks.results.find((block: any) =>
    block.type === "toggle" &&
    (block.toggle?.rich_text || []).map((item: any) => item.plain_text || item.text?.content || "").join("") === titleValue,
  );
  if (!toggle) return "";
  const children: any = await notion.blocks.children.list({ block_id: toggle.id, page_size: 100 });
  return children.results
    .filter((block: any) => block.type === "paragraph")
    .map((block: any) => (block.paragraph?.rich_text || []).map((item: any) => item.plain_text || item.text?.content || "").join(""))
    .join("");
}

export async function updateReelIntelligence(input: {
  pageId: string;
  geminiAnalysis: string;
  strategicFit: "Core" | "Supporting" | "Adjacent" | "Irrelevant";
  strategicFitScore: number;
  visualPatternValue: number;
  workflowValue: number;
  recommendedMode: "Visual Storyteller" | "AI Creative Operator" | "Both" | "Neither";
  jevConfidence: number;
  priorityScore: number;
}): Promise<void> {
  await notion.pages.update({
    page_id: input.pageId,
    properties: {
      "Gemini Analysis": { rich_text: rich(input.geminiAnalysis) },
      "Strategic Fit": { select: { name: input.strategicFit } },
      "Strategic Fit Score": { number: input.strategicFitScore },
      "Visual Pattern Value": { number: input.visualPatternValue },
      "Workflow Value": { number: input.workflowValue },
      "Recommended Mode": { select: { name: input.recommendedMode } },
      "Jev Confidence": { number: input.jevConfidence },
      "Priority Score": { number: input.priorityScore },
      Status: { select: { name: "Qualified" } },
      "Last Analyzed": { date: { start: new Date().toISOString() } },
      "Last Error": { rich_text: [] },
    },
  });
  await appendToggle(input.pageId, "▶️ Full Gemini Visual Analysis", input.geminiAnalysis);
}

export async function updateReelStrategicFit(input: {
  pageId: string;
  fit: "Core" | "Supporting" | "Adjacent" | "Irrelevant";
  score: number;
  confidence: number;
  pillar?: YunaPillar | null;
  contentType?: ContentType | null;
}): Promise<void> {
  const properties: Record<string, any> = {
    "Strategic Fit": { select: { name: input.fit } },
    "Strategic Fit Score": { number: input.score },
    "Jev Confidence": { number: input.confidence },
    Status: { select: { name: input.fit === "Irrelevant" ? "Ignored" : "Qualified" } },
  };
  // Requires the 2026-11-12 migration (scripts/migrate-yuna-guardrails.ts) to have added these selects.
  if (input.pillar) properties.Pillar = { select: { name: input.pillar } };
  if (input.contentType) properties["Content Type"] = { select: { name: input.contentType } };
  await notion.pages.update({ page_id: input.pageId, properties });
}

export interface ReelActionItem {
  pageId: string;
  action: "Generate Visual Angles" | "Generate Operator Angles" | "Generate Both" | "Save for Later" | "Ignore";
}

export async function getPendingReelActions(limit = 20): Promise<ReelActionItem[]> {
  const response: any = await notion.dataSources.query({
    data_source_id: INSTAGRAM_BRAIN_NOTION_IDS.reelIntelligence.dataSourceId,
    filter: {
      and: [
        { property: "Action State", select: { does_not_equal: "Queued" } },
        { property: "Action State", select: { does_not_equal: "Processing" } },
        { property: "Action Requested", select: { does_not_equal: "None" } },
      ],
    },
    page_size: Math.min(100, limit),
  });
  return response.results.map((page: any) => ({
    pageId: page.id,
    action: page.properties["Action Requested"].select.name,
  }));
}

export async function setReelActionState(
  pageId: string,
  state: "Idle" | "Queued" | "Processing" | "Complete" | "Failed",
  error = "",
  clearAction = false,
): Promise<void> {
  const properties: Record<string, any> = {
    "Action State": { select: { name: state } },
    "Last Error": { rich_text: error ? rich(error) : [] },
  };
  if (clearAction) properties["Action Requested"] = { select: { name: "None" } };
  await notion.pages.update({ page_id: pageId, properties });
}

export async function setReelDisposition(
  pageId: string,
  status: "Watchlist" | "Ignored",
): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: { select: { name: status } },
      "Action Requested": { select: { name: "None" } },
      "Action State": { select: { name: "Complete" } },
    },
  });
}

export function defaultIdeaAccount(): "Unassigned" | "Yuna" | "Alisha" {
  const active = activeAccounts();
  return active.length === 1 ? active[0] : "Unassigned";
}

export async function createAngleIdeas(
  reel: StoredReel,
  angles: AnglePreview[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const angle of angles) {
    const page: any = await notion.pages.create({
      parent: { database_id: INSTAGRAM_BRAIN_NOTION_IDS.ideaLab.databaseId },
      properties: {
        Idea: { title: rich(angle.title) },
        "Source Reel": { relation: [{ id: reel.pageId }] },
        Status: { select: { name: "Angle Ready" } },
        // Yuna-only targeting: pre-assign the single active account so picking an angle is one click.
        Account: { select: { name: defaultIdeaAccount() } },
        ...(reel.pillar ? { Pillar: { select: { name: reel.pillar } } } : {}),
        ...(reel.contentType ? { "Content Type": { select: { name: reel.contentType } } } : {}),
        "Delivery Profile": { select: { name: angle.deliveryProfile } },
        "Script Engine": { select: { name: angle.scriptEngine } },
        "Angle Summary": { rich_text: rich(angle.summary) },
        "Spoken Hook": { rich_text: rich(angle.spokenHook) },
        "Text Hook": { rich_text: rich(angle.textHook) },
        "Visual Hook": { rich_text: rich(angle.visualHook) },
        "Audio Hook": { rich_text: rich(angle.audioHook) },
        "Three-Beat Outline": { rich_text: rich(angle.threeBeatOutline.join(" → ")) },
        "Why It Works": { rich_text: rich(angle.whyItWorks) },
        "What Not To Copy": { rich_text: rich(angle.whatNotToCopy) },
        "Action Requested": { select: { name: "None" } },
        "Action State": { select: { name: "Idle" } },
        "Priority Score": { number: reel.priorityScore },
      },
      children: [
        { object: "block", type: "heading_2", heading_2: { rich_text: rich("Angle Preview") } },
        { object: "block", type: "paragraph", paragraph: { rich_text: rich(angle.summary) } },
        { object: "block", type: "heading_3", heading_3: { rich_text: rich("Four-layer hook") } },
        { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(`Spoken: ${angle.spokenHook || "Intentionally minimal"}`) } },
        { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(`Text: ${angle.textHook || "Intentionally minimal"}`) } },
        { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(`Visual: ${angle.visualHook}`) } },
        { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(`Audio: ${angle.audioHook}`) } },
      ] as any,
    });
    ids.push(page.id);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  await notion.pages.update({
    page_id: reel.pageId,
    properties: {
      Status: { select: { name: "Angles Ready" } },
      "Action Requested": { select: { name: "None" } },
      "Action State": { select: { name: "Idle" } },
    },
  });
  return ids;
}

export interface IdeaRecord {
  pageId: string;
  title: string;
  sourceReelId: string;
  status: string;
  pillar: string;
  contentType: string;
  revisionNotes: string;
  account: "Unassigned" | "Alisha" | "Yuna" | "Both";
  deliveryProfile: "Visual-first" | "Operator-first" | "Hybrid";
  scriptEngine: "Kallaway" | "RPN" | "Hybrid";
  angle: AnglePreview;
}

export async function findProductionByIdea(ideaPageId: string): Promise<string | null> {
  const response: any = await notion.dataSources.query({
    data_source_id: INSTAGRAM_BRAIN_NOTION_IDS.productionQueue.dataSourceId,
    filter: { property: "Idea", relation: { contains: ideaPageId } },
    page_size: 1,
  });
  return response.results[0]?.id || null;
}

export async function getIdea(pageId: string): Promise<IdeaRecord> {
  const page: any = await notion.pages.retrieve({ page_id: pageId });
  const p = page.properties || {};
  return {
    pageId,
    title: titlePlain(p.Idea),
    sourceReelId: p["Source Reel"]?.relation?.[0]?.id || "",
    status: p.Status?.select?.name || "",
    pillar: p.Pillar?.select?.name || "",
    contentType: p["Content Type"]?.select?.name || "",
    revisionNotes: textPlain(p["Revision Notes"]),
    account: p.Account?.select?.name || "Unassigned",
    deliveryProfile: p["Delivery Profile"]?.select?.name || "Hybrid",
    scriptEngine: p["Script Engine"]?.select?.name || "Kallaway",
    angle: {
      title: titlePlain(p.Idea),
      summary: textPlain(p["Angle Summary"]),
      spokenHook: textPlain(p["Spoken Hook"]),
      textHook: textPlain(p["Text Hook"]),
      visualHook: textPlain(p["Visual Hook"]),
      audioHook: textPlain(p["Audio Hook"]),
      threeBeatOutline: textPlain(p["Three-Beat Outline"]).split(" → ").filter(Boolean),
      whyItWorks: textPlain(p["Why It Works"]),
      whatNotToCopy: textPlain(p["What Not To Copy"]),
      deliveryProfile: p["Delivery Profile"]?.select?.name || "Hybrid",
      scriptEngine: p["Script Engine"]?.select?.name || "Kallaway",
    },
  };
}

export interface IdeaActionItem {
  pageId: string;
  action: "Generate Script" | "Revise Angle" | "Park" | "Reject";
}

export async function getPendingIdeaActions(limit = 20): Promise<IdeaActionItem[]> {
  const response: any = await notion.dataSources.query({
    data_source_id: INSTAGRAM_BRAIN_NOTION_IDS.ideaLab.dataSourceId,
    filter: {
      and: [
        { property: "Action State", select: { does_not_equal: "Queued" } },
        { property: "Action State", select: { does_not_equal: "Processing" } },
        { property: "Action Requested", select: { does_not_equal: "None" } },
      ],
    },
    page_size: Math.min(100, limit),
  });
  return response.results.map((page: any) => ({
    pageId: page.id,
    action: page.properties["Action Requested"].select.name,
  }));
}

export async function setIdeaActionState(
  pageId: string,
  state: "Idle" | "Queued" | "Processing" | "Complete" | "Failed",
  error = "",
  clearAction = false,
): Promise<void> {
  const properties: Record<string, any> = {
    "Action State": { select: { name: state } },
    "Last Error": { rich_text: error ? rich(error) : [] },
  };
  if (clearAction) properties["Action Requested"] = { select: { name: "None" } };
  await notion.pages.update({ page_id: pageId, properties });
}

/**
 * Overwrite an Idea Lab angle in place with a revised version (Revise Angle).
 * The previous version is kept in a collapsed toggle on the page so nothing is lost.
 */
export async function reviseIdeaAngle(
  idea: IdeaRecord,
  revised: AnglePreview,
): Promise<void> {
  await appendToggle(
    idea.pageId,
    `Previous version (before revision ${new Date().toISOString().slice(0, 10)})`,
    JSON.stringify(idea.angle, null, 2),
  );
  await notion.pages.update({
    page_id: idea.pageId,
    properties: {
      Idea: { title: rich(revised.title) },
      Status: { select: { name: "Angle Ready" } },
      "Delivery Profile": { select: { name: revised.deliveryProfile } },
      "Script Engine": { select: { name: revised.scriptEngine } },
      "Angle Summary": { rich_text: rich(revised.summary) },
      "Spoken Hook": { rich_text: rich(revised.spokenHook) },
      "Text Hook": { rich_text: rich(revised.textHook) },
      "Visual Hook": { rich_text: rich(revised.visualHook) },
      "Audio Hook": { rich_text: rich(revised.audioHook) },
      "Three-Beat Outline": { rich_text: rich(revised.threeBeatOutline.join(" → ")) },
      "Why It Works": { rich_text: rich(revised.whyItWorks) },
      "What Not To Copy": { rich_text: rich(revised.whatNotToCopy) },
      "Action Requested": { select: { name: "None" } },
      "Action State": { select: { name: "Complete" } },
      "Last Error": { rich_text: [] },
    },
  });
}

export async function setIdeaDisposition(
  pageId: string,
  status: "Parked" | "Rejected",
): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: { select: { name: status } },
      "Action Requested": { select: { name: "None" } },
      "Action State": { select: { name: "Complete" } },
    },
  });
}

export async function createProductionItem(
  idea: IdeaRecord,
  scriptPackage: Record<string, any>,
  account: "Alisha" | "Yuna" | "Both" = idea.account === "Unassigned" ? "Yuna" : idea.account,
): Promise<string> {
  const script = normalizeScriptPackage(scriptPackage, idea.title);
  const page: any = await notion.pages.create({
    parent: { database_id: INSTAGRAM_BRAIN_NOTION_IDS.productionQueue.databaseId },
    properties: {
      "Content Brief": { title: rich(idea.title) },
      Idea: { relation: [{ id: idea.pageId }] },
      Status: { select: { name: "Script Ready" } },
      Account: { select: { name: account } },
      // A/B scripts: the AI V2.3 script lands in Spoken Script; Lara writes hers in "Lara Script".
      "Lara Script Status": { select: { name: "Needed" } },
      "Chosen Script": { select: { name: "Undecided" } },
      ...(idea.pillar ? { Pillar: { select: { name: idea.pillar } } } : {}),
      ...(idea.contentType ? { "Content Type": { select: { name: idea.contentType } } } : {}),
      "Delivery Profile": { select: { name: idea.deliveryProfile } },
      "Script Engine": { select: { name: idea.scriptEngine } },
      "Action Requested": { select: { name: "None" } },
      "Action State": { select: { name: "Idle" } },
      "Spoken Script": { rich_text: rich(String(script.spokenScript || "")) },
      "Spoken Hook": { rich_text: rich(String(script.spokenHook || "")) },
      "Text Hook": { rich_text: rich(String(script.textHook || "")) },
      "Visual Hook": { rich_text: rich(String(script.visualHook || "")) },
      "Audio Hook": { rich_text: rich(String(script.audioHook || "")) },
    },
    children: [
      ...renderCreativeBrief({
        account,
        deliveryProfile: idea.deliveryProfile,
        summary: idea.angle.summary,
        script,
      }),
      { object: "block", type: "toggle", toggle: {
        rich_text: rich(SCRIPT_DATA_TITLE),
        children: textBlocks(JSON.stringify(script, null, 2)),
      } },
    ] as any,
  });
  await notion.pages.update({
    page_id: idea.pageId,
    properties: {
      Status: { select: { name: "Script Ready" } },
      Account: { select: { name: account } },
      "Action Requested": { select: { name: "None" } },
      "Action State": { select: { name: "Idle" } },
    },
  });
  return page.id;
}

export async function updateProductionBlueprint(
  pageId: string,
  blueprint: Record<string, any>,
): Promise<void> {
  const plan = normalizeBlueprint(blueprint);
  const requiredAssets = Array.isArray(plan.requiredAssets)
    ? plan.requiredAssets.map((asset: any) => asset.name).filter(Boolean).join(", ")
    : "";
  await ensureReadableBriefFromStored(pageId);
  await ensureReadableProductionPlan(pageId, plan);
  await ensureBlueprintData(pageId, plan);
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: { select: { name: "Blueprint Ready" } },
      "Production Blueprint": { rich_text: rich(String(plan.objective || plan.visualPayoff || "Production plan ready; open the page for the shot guide.")) },
      "Required Assets": { rich_text: rich(requiredAssets) },
      "Production Risks": { rich_text: rich(plan.productionRisks.join("; ")) },
      "Decisions Needed": { rich_text: rich(plan.decisionsNeeded.join("; ")) },
      Complexity: { select: { name: plan.complexity } },
      "Complexity Reason": { rich_text: rich(plan.complexityReason) },
      "Estimated Production Minutes": { number: null },
      "Action Requested": { select: { name: "None" } },
      "Action State": { select: { name: "Idle" } },
    },
  });
}

async function ensureReadableBriefFromStored(pageId: string): Promise<void> {
  if (await findProductionBlock(pageId, BRIEF_MARKER)) return;
  const page: any = await notion.pages.retrieve({ page_id: pageId });
  const ideaPageId = page.properties?.Idea?.relation?.[0]?.id;
  const idea = ideaPageId ? await getIdea(ideaPageId) : null;
  const script = await getProductionItem(pageId);
  await ensureReadableBrief(pageId, {
    account: script.account,
    deliveryProfile: script.deliveryProfile as "Visual-first" | "Operator-first" | "Hybrid",
    summary: idea?.angle.summary || script.title,
    script: script.scriptPackage,
  });
}

export async function reformatProductionPage(
  pageId: string,
  blueprintOverrides: Record<string, unknown> = {},
): Promise<void> {
  await ensureReadableBriefFromStored(pageId);
  const fullBlueprint = await readToggleBody(pageId, BLUEPRINT_DATA_TITLE);
  if (!fullBlueprint) return;
  const raw = JSON.parse(fullBlueprint) as Record<string, any>;
  await updateProductionBlueprint(pageId, { ...raw, ...blueprintOverrides });
}

export interface ProductionRecord {
  pageId: string;
  title: string;
  account: string;
  deliveryProfile: string;
  scriptEngine: string;
  scriptPackage: Record<string, unknown>;
  laraScript: string;
  laraScriptStatus: string;
  chosenScript: string;
}

export async function getProductionItem(pageId: string): Promise<ProductionRecord> {
  const page: any = await notion.pages.retrieve({ page_id: pageId });
  const p = page.properties || {};
  const fullScript = await readToggleBody(pageId, SCRIPT_DATA_TITLE);
  let scriptPackage: Record<string, unknown>;
  try {
    scriptPackage = fullScript ? JSON.parse(fullScript) : {};
  } catch {
    scriptPackage = {};
  }
  return {
    pageId,
    title: titlePlain(p["Content Brief"]),
    account: p.Account?.select?.name || "Unassigned",
    deliveryProfile: p["Delivery Profile"]?.select?.name || "Hybrid",
    scriptEngine: p["Script Engine"]?.select?.name || "Kallaway",
    laraScript: textPlain(p["Lara Script"]),
    laraScriptStatus: p["Lara Script Status"]?.select?.name || "",
    chosenScript: p["Chosen Script"]?.select?.name || "Undecided",
    scriptPackage: normalizeScriptPackage(Object.keys(scriptPackage).length ? scriptPackage : {
      spokenScript: textPlain(p["Spoken Script"]),
      spokenHook: textPlain(p["Spoken Hook"]),
      textHook: textPlain(p["Text Hook"]),
      visualHook: textPlain(p["Visual Hook"]),
      audioHook: textPlain(p["Audio Hook"]),
    }, titlePlain(p["Content Brief"])),
  };
}

export interface ProductionActionItem {
  pageId: string;
  action: "Generate Script" | "Generate Blueprint" | "Mark Ready" | "Mark Published";
}

export async function getPendingProductionActions(limit = 20): Promise<ProductionActionItem[]> {
  const response: any = await notion.dataSources.query({
    data_source_id: INSTAGRAM_BRAIN_NOTION_IDS.productionQueue.dataSourceId,
    filter: {
      and: [
        { property: "Action State", select: { does_not_equal: "Queued" } },
        { property: "Action State", select: { does_not_equal: "Processing" } },
        { property: "Action Requested", select: { does_not_equal: "None" } },
      ],
    },
    page_size: Math.min(100, limit),
  });
  return response.results.map((page: any) => ({
    pageId: page.id,
    action: page.properties["Action Requested"].select.name,
  }));
}

export async function setProductionActionState(
  pageId: string,
  state: "Idle" | "Queued" | "Processing" | "Complete" | "Failed",
  error = "",
  clearAction = false,
): Promise<void> {
  const properties: Record<string, any> = {
    "Action State": { select: { name: state } },
    "Last Error": { rich_text: error ? rich(error) : [] },
  };
  if (clearAction) properties["Action Requested"] = { select: { name: "None" } };
  await notion.pages.update({ page_id: pageId, properties });
}

export async function setProductionStatus(
  pageId: string,
  status: "Ready to Post" | "Published",
): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: { select: { name: status } },
      "Action Requested": { select: { name: "None" } },
      "Action State": { select: { name: "Complete" } },
    },
  });
}

export async function markProductionPublished(pageId: string): Promise<void> {
  const page: any = await notion.pages.retrieve({ page_id: pageId });
  const p = page.properties || {};
  const postUrl = p["Post URL"]?.url;
  if (!postUrl || !/^https?:\/\/(www\.)?instagram\.com\//i.test(postUrl)) {
    throw new Error("Add the published Instagram Post URL before choosing Mark Published");
  }
  const publishedAt = p["Published At"]?.date?.start || new Date().toISOString();
  const existing: any = await notion.dataSources.query({
    data_source_id: INSTAGRAM_BRAIN_NOTION_IDS.performanceLog.dataSourceId,
    filter: { property: "Production Item", relation: { contains: pageId } },
    page_size: 100,
  });
  const existingWindows = new Set(existing.results.map((row: any) => row.properties.Window?.select?.name));
  const account = p.Account?.select?.name || "Unassigned";
  const title = titlePlain(p["Content Brief"]);
  for (const [window, hours] of [["24h", 24], ["7d", 168], ["30d", 720]] as const) {
    if (existingWindows.has(window)) continue;
    const dueAt = new Date(new Date(publishedAt).getTime() + hours * 3_600_000);
    await notion.pages.create({
      parent: { database_id: INSTAGRAM_BRAIN_NOTION_IDS.performanceLog.databaseId },
      properties: {
        "Performance Check": { title: rich(`${title} — ${window}`) },
        Window: { select: { name: window } },
        "Due At": { date: { start: dueAt.toISOString() } },
        Account: { select: { name: account } },
        "Production Item": { relation: [{ id: pageId }] },
        Source: { select: { name: "Manual" } },
        "Result Notes": { rich_text: rich("Enter Instagram Insights at or after the due time. Leave unavailable metrics blank; do not estimate them.") },
      },
    });
  }
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: { select: { name: "Published" } },
      "Published At": { date: { start: publishedAt } },
      "Action Requested": { select: { name: "None" } },
      "Action State": { select: { name: "Complete" } },
      "Last Error": { rich_text: [] },
    },
  });
}

export async function getOwnPerformanceLearnings(): Promise<string> {
  const response: any = await notion.dataSources.query({
    data_source_id: INSTAGRAM_BRAIN_NOTION_IDS.performanceLog.dataSourceId,
    filter: { and: [
      { property: "Captured At", date: { is_not_empty: true } },
      { property: "Views", number: { greater_than: 0 } },
    ] },
    sorts: [{ property: "Captured At", direction: "descending" }],
    page_size: 100,
  });
  const rows: OwnPostResult[] = response.results.map((page: any) => {
    const p = page.properties || {};
    return {
      title: titlePlain(p["Performance Check"]),
      account: p.Account?.select?.name || "Unassigned",
      window: p.Window?.select?.name || "",
      views: p.Views?.number || 0,
      saves: p.Saves?.number || 0,
      shares: p.Shares?.number || 0,
      completionRate: p["Completion Rate"]?.number ?? null,
    };
  });
  return summarizeOwnPostResults(rows);
}
