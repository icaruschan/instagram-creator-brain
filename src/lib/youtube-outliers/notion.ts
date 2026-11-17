import { Client } from "@notionhq/client";
import { INSTAGRAM_BRAIN_NOTION_IDS } from "../instagram-brain/notion-ids";
import { defaultIdeaAccount } from "../instagram-brain/notion";
import type { AnglePreview } from "../instagram-brain/types";
import { KNOWN_YOUTUBE_CHANNELS } from "./config";
import { requireYouTubeOutlierIds } from "./notion-ids";
import type { ScoredVideo, YouTubeFormat } from "./types";

// No dotenv here on purpose: Trigger env vars are the source of truth (a stray .env must not override them).
const notion = new Client({ auth: process.env.NOTION_API_KEY });

/** Notion caps one rich-text object at 2,000 chars and a property at 100 objects. */
export function richLong(content: string, maxChars = 20_000): Array<{ type: "text"; text: { content: string } }> {
  const text = String(content || "").slice(0, maxChars);
  const out: Array<{ type: "text"; text: { content: string } }> = [];
  for (let i = 0; i < text.length && out.length < 100; i += 2_000) out.push({ type: "text", text: { content: text.slice(i, i + 2_000) } });
  return out;
}
const rich = (content: string) => richLong(content, 2_000);
const plain = (property: any) => (property?.rich_text || property?.title || []).map((item: any) => item.plain_text || "").join("");
const pause = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));

export interface YouTubeChannelTarget {
  creatorPageId: string;
  name: string;
  channelUrl: string;
  lastChecked: string | null;
}

/** Active Creator Bench rows with a YouTube channel (property, or the KNOWN_YOUTUBE_CHANNELS starter map). */
export async function getYouTubeChannels(limit = 5, onlyCreatorPageIds: string[] = []): Promise<YouTubeChannelTarget[]> {
  const response: any = await notion.dataSources.query({
    data_source_id: INSTAGRAM_BRAIN_NOTION_IDS.creatorBench.dataSourceId,
    filter: { property: "Status", select: { equals: "Active" } },
    page_size: 100,
  });
  const targets: YouTubeChannelTarget[] = [];
  for (const page of response.results as any[]) {
    const p = page.properties || {};
    const known = KNOWN_YOUTUBE_CHANNELS[page.id];
    const channelUrl = p["YouTube Channel URL"]?.url || known?.channelUrl || "";
    if (!channelUrl) continue;
    if (onlyCreatorPageIds.length && !onlyCreatorPageIds.includes(page.id)) continue;
    targets.push({ creatorPageId: page.id, name: plain(p.Name), channelUrl, lastChecked: p["YouTube Last Checked"]?.date?.start || null });
  }
  targets.sort((a, b) => (a.lastChecked || "").localeCompare(b.lastChecked || ""));
  return targets.slice(0, limit);
}

export async function updateCreatorYouTubeCheckpoint(
  creatorPageId: string,
  summary: Record<YouTubeFormat, { medianViews: number }>,
  channelUrl: string,
): Promise<void> {
  await notion.pages.update({
    page_id: creatorPageId,
    properties: {
      "YouTube Channel URL": { url: channelUrl },
      "YouTube Last Checked": { date: { start: new Date().toISOString() } },
      "YouTube Median Views (Long)": { number: summary["Long-form"].medianViews || null },
      "YouTube Median Views (Shorts)": { number: summary.Short.medianViews || null },
    },
  });
}

export interface StoredOutlier {
  pageId: string;
  status: string;
  hasTranscript: boolean;
  video: ScoredVideo;
}

function toStored(page: any): StoredOutlier {
  const p = page.properties || {};
  const multiple = p["Outlier Multiple"]?.number ?? null;
  const video: ScoredVideo = {
    id: plain(p["Video ID"]),
    url: p["Video URL"]?.url || "",
    title: plain(p.Video),
    description: plain(p.Description),
    format: (p.Format?.select?.name || "Long-form") as YouTubeFormat,
    durationSeconds: p["Duration Seconds"]?.number || 0,
    views: p.Views?.number || 0,
    likes: p.Likes?.number ?? null,
    comments: p.Comments?.number ?? null,
    publishedAt: p.Published?.date?.start || "",
    approximateDate: Boolean(p["Approx Date"]?.checkbox),
    channelName: plain(p.Channel),
    channelUrl: "",
    transcript: plain(p.Transcript),
    score: {
      videoId: plain(p["Video ID"]),
      format: (p.Format?.select?.name || "Long-form") as YouTubeFormat,
      ageDays: p["Age Days"]?.number ?? null,
      views: p.Views?.number || 0,
      expectedViews: p["Expected Views"]?.number ?? null,
      multiple,
      outlierScore: p["Outlier Score"]?.number ?? null,
      baselineMethod: p["Baseline Method"]?.select?.name || "insufficient",
      baselinePeers: p["Baseline Peers"]?.number || 0,
      growthExponent: 0,
      inWindow: true,
      isOutlier: Boolean(p["Is Outlier"]?.checkbox),
      reason: "",
    },
  };
  return { pageId: page.id, status: p.Status?.select?.name || "New", hasTranscript: Boolean(video.transcript), video };
}

export async function findOutlierByVideoId(videoId: string): Promise<StoredOutlier | null> {
  const { dataSourceId } = requireYouTubeOutlierIds();
  const response: any = await notion.dataSources.query({
    data_source_id: dataSourceId,
    filter: { property: "Video ID", rich_text: { equals: videoId } },
    page_size: 1,
  });
  return response.results[0] ? toStored(response.results[0]) : null;
}

/** Every stored row for one creator, keyed by video id (one paginated query instead of one per video). */
export async function getCreatorOutliers(creatorPageId: string): Promise<Map<string, StoredOutlier>> {
  const { dataSourceId } = requireYouTubeOutlierIds();
  const out = new Map<string, StoredOutlier>();
  let cursor: string | undefined;
  do {
    const response: any = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: { property: "Creator", relation: { contains: creatorPageId } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const page of response.results) {
      const stored = toStored(page);
      if (stored.video.id) out.set(stored.video.id, stored);
    }
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return out;
}

export async function getOutlier(pageId: string): Promise<StoredOutlier> {
  return toStored(await notion.pages.retrieve({ page_id: pageId }));
}

const KEEP_STATUS = new Set(["Ideas Ready", "Watchlist", "Ignored"]);

/** Create or refresh one video row (metrics + score). Human dispositions (Ideas Ready / Watchlist / Ignored) are kept. */
export async function upsertOutlierRow(creatorPageId: string, video: ScoredVideo, existing?: StoredOutlier | null): Promise<string> {
  const { databaseId } = requireYouTubeOutlierIds();
  const s = video.score;
  const status = existing && KEEP_STATUS.has(existing.status) ? existing.status : s.isOutlier ? "Outlier" : "New";
  const properties: Record<string, any> = {
    Video: { title: rich(video.title || video.id) },
    "Video URL": { url: video.url || null },
    "Video ID": { rich_text: rich(video.id) },
    Channel: { rich_text: rich(video.channelName) },
    Creator: { relation: [{ id: creatorPageId }] },
    Format: { select: { name: video.format } },
    ...(video.publishedAt ? { Published: { date: { start: video.publishedAt } } } : {}),
    "Approx Date": { checkbox: video.approximateDate },
    "Age Days": { number: s.ageDays },
    Views: { number: video.views },
    Likes: { number: video.likes },
    Comments: { number: video.comments },
    "Duration Seconds": { number: video.durationSeconds || null },
    "Expected Views": { number: s.expectedViews },
    "Outlier Multiple": { number: s.multiple },
    "Outlier Score": { number: s.outlierScore },
    "Baseline Method": { select: { name: s.baselineMethod } },
    "Baseline Peers": { number: s.baselinePeers },
    "Is Outlier": { checkbox: s.isOutlier },
    Description: { rich_text: rich(video.description) },
    Status: { select: { name: status } },
    "Last Scanned": { date: { start: new Date().toISOString() } },
  };
  if (existing) {
    await notion.pages.update({ page_id: existing.pageId, properties });
    return existing.pageId;
  }
  const page: any = await notion.pages.create({
    parent: { database_id: databaseId },
    properties: { ...properties, "Action Requested": { select: { name: "None" } }, "Action State": { select: { name: "Idle" } } },
  });
  return page.id;
}

export async function setOutlierTranscript(pageId: string, transcript: string): Promise<void> {
  await notion.pages.update({ page_id: pageId, properties: { Transcript: { rich_text: richLong(transcript) } } });
}

export async function setOutlierActionState(
  pageId: string,
  state: (typeof import("./schema").ACTION_STATES)[number],
  error = "",
  clearAction = false,
): Promise<void> {
  const properties: Record<string, any> = {
    "Action State": { select: { name: state } },
    "Last Error": { rich_text: error ? rich(error) : [] },
  };
  if (clearAction) properties["Action Requested"] = { select: { name: "None" } };
  if (state === "Failed") properties.Status = { select: { name: "Failed" } };
  await notion.pages.update({ page_id: pageId, properties });
}

export async function setOutlierDisposition(pageId: string, status: "Watchlist" | "Ignored"): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: { select: { name: status } },
      "Action Requested": { select: { name: "None" } },
      "Action State": { select: { name: "Complete" } },
    },
  });
}

export interface OutlierActionItem {
  pageId: string;
  action: "Generate Reel Ideas" | "Save for Later" | "Ignore";
}

export async function getPendingOutlierActions(limit = 20): Promise<OutlierActionItem[]> {
  const { dataSourceId } = requireYouTubeOutlierIds();
  const response: any = await notion.dataSources.query({
    data_source_id: dataSourceId,
    filter: {
      and: [
        { property: "Action State", select: { does_not_equal: "Queued" } },
        { property: "Action State", select: { does_not_equal: "Processing" } },
        { property: "Action Requested", select: { does_not_equal: "None" } },
      ],
    },
    page_size: Math.min(100, limit),
  });
  return response.results.map((page: any) => ({ pageId: page.id, action: page.properties["Action Requested"].select.name }));
}

/** Write Reel ideas to Idea Lab as "Angle Ready" rows, so the existing pick-an-angle → Generate Script path applies. */
export async function createYouTubeIdeas(outlier: StoredOutlier, ideas: AnglePreview[], outlierInsight: string): Promise<string[]> {
  const ids: string[] = [];
  const s = outlier.video.score;
  for (const idea of ideas) {
    const page: any = await notion.pages.create({
      parent: { database_id: INSTAGRAM_BRAIN_NOTION_IDS.ideaLab.databaseId },
      properties: {
        Idea: { title: rich(idea.title) },
        "Source Type": { select: { name: "YouTube" } },
        "Source YouTube Video": { relation: [{ id: outlier.pageId }] },
        Status: { select: { name: "Angle Ready" } },
        Account: { select: { name: defaultIdeaAccount() } },
        ...(idea.pillar ? { Pillar: { select: { name: idea.pillar } } } : {}),
        ...(idea.contentType ? { "Content Type": { select: { name: idea.contentType } } } : {}),
        "Delivery Profile": { select: { name: idea.deliveryProfile } },
        "Script Engine": { select: { name: idea.scriptEngine } },
        "Angle Summary": { rich_text: rich(idea.summary) },
        "Spoken Hook": { rich_text: rich(idea.spokenHook) },
        "Text Hook": { rich_text: rich(idea.textHook) },
        "Visual Hook": { rich_text: rich(idea.visualHook) },
        "Audio Hook": { rich_text: rich(idea.audioHook) },
        "Three-Beat Outline": { rich_text: rich(idea.threeBeatOutline.join(" → ")) },
        "Why It Works": { rich_text: rich(idea.whyItWorks) },
        "What Not To Copy": { rich_text: rich(idea.whatNotToCopy) },
        "Action Requested": { select: { name: "None" } },
        "Action State": { select: { name: "Idle" } },
        // Same 0-100 scale as Reel priority: 50 = her normal, 75 = 2x, 100 = 4x+.
        "Priority Score": { number: s.outlierScore },
      },
      children: [
        { object: "block", type: "callout", callout: { rich_text: rich(`From YouTube ${outlier.video.format}: "${outlier.video.title}" (${outlier.video.views.toLocaleString("en-US")} views, ${s.multiple}x her normal at ${s.ageDays} days). ${outlier.video.url}`) } },
        { object: "block", type: "heading_2", heading_2: { rich_text: rich("Why the source popped") } },
        { object: "block", type: "paragraph", paragraph: { rich_text: rich(outlierInsight || "Not stated.") } },
        { object: "block", type: "heading_2", heading_2: { rich_text: rich("Reel idea") } },
        { object: "block", type: "paragraph", paragraph: { rich_text: rich(idea.summary) } },
        { object: "block", type: "heading_3", heading_3: { rich_text: rich("Four-layer hook") } },
        { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(`Spoken: ${idea.spokenHook || "Intentionally minimal"}`) } },
        { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(`Text: ${idea.textHook || "Intentionally minimal"}`) } },
        { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(`Visual: ${idea.visualHook || "Intentionally minimal"}`) } },
        { object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(`Audio: ${idea.audioHook}`) } },
      ] as any,
    });
    ids.push(page.id);
    await pause();
  }
  await notion.pages.update({
    page_id: outlier.pageId,
    properties: {
      Status: { select: { name: "Ideas Ready" } },
      "Why It Popped": { rich_text: rich(outlierInsight) },
      "Action Requested": { select: { name: "None" } },
      "Action State": { select: { name: "Complete" } },
      "Last Error": { rich_text: [] },
    },
  });
  return ids;
}

/** For Generate Script / Revise Angle on a YouTube-sourced idea: the source facts. */
export async function getIdeaYouTubeSource(ideaPageId: string): Promise<StoredOutlier | null> {
  const page: any = await notion.pages.retrieve({ page_id: ideaPageId });
  const id = page?.properties?.["Source YouTube Video"]?.relation?.[0]?.id;
  return id ? getOutlier(id) : null;
}
