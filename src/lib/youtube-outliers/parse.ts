import { YOUTUBE_OUTLIER_CONFIG } from "./config";
import type { YouTubeFormat, YouTubeVideo } from "./types";

/** "00:03:17", "29:54", "PT14M35S", 875 → seconds. */
export function parseDurationSeconds(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  const text = String(value).trim();
  const iso = text.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (iso && /\d/.test(text)) {
    const [, d, h, m, s] = iso;
    return Math.round(Number(d || 0) * 86_400 + Number(h || 0) * 3_600 + Number(m || 0) * 60 + Number(s || 0));
  }
  const parts = text.split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

const UNIT_DAYS: Record<string, number> = {
  second: 1 / 86_400, minute: 1 / 1_440, hour: 1 / 24, day: 1, week: 7, month: 30.44, year: 365.25,
};

/**
 * Publish date from an absolute date ("2026-11-14", ISO, "20261114", epoch) or a relative label
 * ("3 weeks ago", "Streamed 2 days ago"). Relative labels are approximate (YouTube rounds them).
 */
export function parsePublishDate(value: unknown, now: Date = new Date()): { iso: string; approximate: boolean } {
  if (value == null || value === "") return { iso: "", approximate: false };
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return { iso: new Date(value < 1e12 ? value * 1000 : value).toISOString(), approximate: false };
  }
  const text = String(value).trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return { iso: new Date(`${compact[1]}-${compact[2]}-${compact[3]}T00:00:00Z`).toISOString(), approximate: false };
  const relative = text.toLowerCase().match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (relative) {
    const days = Number(relative[1]) * UNIT_DAYS[relative[2]];
    return { iso: new Date(now.getTime() - days * 86_400_000).toISOString(), approximate: true };
  }
  const time = Date.parse(text);
  return Number.isFinite(time) ? { iso: new Date(time).toISOString(), approximate: false } : { iso: "", approximate: false };
}

/** Strip SRT / VTT timing and numbering into plain text (also de-duplicates rolling auto-caption lines). */
export function cleanSubtitles(raw: string): string {
  if (!raw) return "";
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/<[^>]+>/g, "").trim())
    .filter((line) => line && line !== "WEBVTT" && !line.includes("-->") && !/^\d+$/.test(line) && !/^(Kind|Language):/i.test(line));
  const out: string[] = [];
  for (const line of lines) if (out[out.length - 1] !== line) out.push(line);
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export function formatFrom(input: { url?: string; type?: string; durationSeconds: number; fromUrl?: string }): YouTubeFormat {
  const hint = `${input.type || ""} ${input.url || ""} ${input.fromUrl || ""}`.toLowerCase();
  if (hint.includes("short")) return "Short";
  if (input.durationSeconds > 0 && input.durationSeconds <= YOUTUBE_OUTLIER_CONFIG.shortMaxSeconds && !hint.includes("/videos")) return "Short";
  return "Long-form";
}

function toCount(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/[, ]/g, "").toUpperCase();
  const match = text.match(/^(\d+(?:\.\d+)?)([KMB])?$/);
  if (!match) return null;
  const mult = match[2] === "K" ? 1e3 : match[2] === "M" ? 1e6 : match[2] === "B" ? 1e9 : 1;
  return Math.round(Number(match[1]) * mult);
}

/** One streamers/youtube-scraper dataset item → YouTubeVideo. */
export function normalizeApifyYouTubeItem(item: any, now: Date = new Date()): YouTubeVideo {
  const durationSeconds = parseDurationSeconds(item?.duration);
  const url = String(item?.url || (item?.id ? `https://www.youtube.com/watch?v=${item.id}` : ""));
  const date = parsePublishDate(item?.date ?? item?.uploadDate ?? item?.publishedAt, now);
  const sub = Array.isArray(item?.subtitles) ? item.subtitles.find((entry: any) => entry?.srt || entry?.vtt || entry?.plaintext || entry?.xml) : null;
  return {
    id: String(item?.id || ""),
    url,
    title: String(item?.title || ""),
    description: String(item?.text || item?.description || "").slice(0, 4_000),
    format: formatFrom({ url, type: item?.type, durationSeconds, fromUrl: item?.fromYTUrl || item?.input }),
    durationSeconds,
    views: toCount(item?.viewCount) ?? 0,
    likes: toCount(item?.likes),
    comments: toCount(item?.commentsCount),
    publishedAt: date.iso,
    approximateDate: date.approximate,
    channelName: String(item?.channelName || ""),
    channelUrl: String(item?.channelUrl || ""),
    transcript: sub ? cleanSubtitles(String(sub.srt || sub.vtt || sub.plaintext || sub.xml || "")) : "",
  };
}

export function youtubeVideoId(url: string): string {
  const match = String(url).match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : "";
}
