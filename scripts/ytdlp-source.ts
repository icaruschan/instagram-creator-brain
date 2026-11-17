/**
 * LOCAL-ONLY YouTube source for dry runs on the box: reads public channel pages with the yt-dlp binary.
 * Free, read-only, no API key. Not bundled into Trigger (lives in scripts/), not used in production.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { cleanSubtitles, parsePublishDate } from "../src/lib/youtube-outliers/parse";
import type { YouTubeFormat, YouTubeVideo } from "../src/lib/youtube-outliers/types";

const run = promisify(execFile);
const BIN = process.env.YTDLP_BIN || "yt-dlp";

async function json(args: string[]): Promise<any> {
  const { stdout } = await run(BIN, ["--no-warnings", ...args], { maxBuffer: 64 * 1024 * 1024, timeout: 180_000 });
  return JSON.parse(stdout);
}

async function pool<T, R>(items: T[], size: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await worker(items[index]);
    }
  }));
  return out;
}

export async function scrapeChannelWithYtDlp(channelUrl: string, longForm = 30, shorts = 30): Promise<YouTubeVideo[]> {
  const base = channelUrl.replace(/\/+$/, "").replace(/\/(videos|shorts)$/i, "");
  const listed: Array<{ id: string; format: YouTubeFormat }> = [];
  for (const [tab, format, limit] of [["videos", "Long-form", longForm], ["shorts", "Short", shorts]] as const) {
    if (limit <= 0) continue;
    try {
      const flat = await json(["--flat-playlist", "--playlist-items", `1:${limit}`, "-J", `${base}/${tab}`]);
      for (const entry of flat.entries || []) if (entry?.id) listed.push({ id: entry.id, format });
    } catch (error) {
      console.warn(`yt-dlp: no ${tab} tab for ${base} (${(error as Error).message.split("\n")[0]})`);
    }
  }
  const videos = await pool(listed, 6, async ({ id, format }) => {
    try {
      const d = await json(["--skip-download", "-j", `https://www.youtube.com/watch?v=${id}`]);
      const date = parsePublishDate(d.timestamp ?? d.upload_date);
      return {
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: d.title || "",
        description: String(d.description || "").slice(0, 4_000),
        format,
        durationSeconds: Number(d.duration || 0),
        views: Number(d.view_count || 0),
        likes: d.like_count ?? null,
        comments: d.comment_count ?? null,
        publishedAt: date.iso,
        approximateDate: date.approximate,
        channelName: d.channel || "",
        channelUrl: d.channel_url || "",
        transcript: "",
      } satisfies YouTubeVideo;
    } catch {
      return null;
    }
  });
  return videos.filter((video): video is YouTubeVideo => Boolean(video));
}

export async function fetchTranscriptWithYtDlp(videoUrl: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "ytsubs-"));
  try {
    await run(BIN, ["--no-warnings", "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en.*,en", "--sub-format", "vtt", "-o", path.join(dir, "%(id)s.%(ext)s"), videoUrl], { timeout: 180_000 });
    const files = readdirSync(dir).filter((name) => name.endsWith(".vtt")).sort((a, b) => Number(/orig|auto/.test(a)) - Number(/orig|auto/.test(b)));
    return files.length ? cleanSubtitles(readFileSync(path.join(dir, files[0]), "utf8")) : "";
  } catch {
    return "";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
