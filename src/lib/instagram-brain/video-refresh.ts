import type { CostLedger } from "./cost";
import { isBudgetExceeded } from "./cost";

/**
 * Auto re-fetch of an expired Instagram CDN video link (Fortune approved 2026-11-20).
 * Stored "Video URL"s are signed CDN links that expire (the `oe=` query param is the expiry, unix seconds in hex).
 * When a task finds the link expired (past oe=, or the download fails with 403/404/410 / a bad body), it re-scrapes
 * just that one Reel, saves the fresh Video URL + Cover URL to Notion, and carries on. One refresh per run.
 */

/** Expiry encoded in an Instagram CDN link (`oe=` hex unix seconds), or null when absent/unreadable. */
export function videoUrlExpiry(url: string): Date | null {
  if (!url) return null;
  let oe: string | null = null;
  try {
    oe = new URL(url).searchParams.get("oe");
  } catch {
    return null;
  }
  if (!oe || !/^[0-9a-f]{6,10}$/i.test(oe)) return null;
  const seconds = parseInt(oe, 16);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

/** True when there's no link, or its oe= expiry is past (or within `marginMinutes`, default 10). */
export function isVideoUrlExpired(url: string, now: Date = new Date(), marginMinutes = 10): boolean {
  if (!url) return true;
  const expiry = videoUrlExpiry(url);
  if (!expiry) return false; // no oe= -> unknown; rely on the download error path
  return expiry.getTime() - marginMinutes * 60_000 <= now.getTime();
}

/** Errors (or fallback reasons) that mean "the stored link is dead", not "the model failed". */
export function isVideoUrlError(errorOrMessage: unknown): boolean {
  const message = typeof errorOrMessage === "string" ? errorOrMessage : (errorOrMessage as Error | undefined)?.message || String(errorOrMessage ?? "");
  return /Video download failed \((403|404|410)\)/i.test(message)
    || /Downloaded Reel video is unexpectedly small/i.test(message)
    || /no Video URL on the Reel|direct Reel video URL is required/i.test(message)
    || /URL signature expired|url.{0,20}expired/i.test(message);
}

export interface FreshReelMedia { videoUrl: string; coverUrl: string }

export interface VideoRefreshDeps {
  /** Re-scrape one Reel by its Instagram URL (costed in the ledger). */
  fetchFresh: (reelUrl: string, shortcode: string, ledger?: CostLedger) => Promise<FreshReelMedia>;
  /** Save the fresh links to the Notion row. */
  save: (pageId: string, media: FreshReelMedia) => Promise<void>;
  now?: () => Date;
}

export interface RefreshOutcome {
  attempted: boolean;
  refreshed: boolean;
  reason?: string;
  error?: string;
}

/** Tracks one Reel's video link through a run; refreshes at most once. */
export class ReelVideoRefresher {
  private attempted = false;
  outcome: RefreshOutcome = { attempted: false, refreshed: false };

  private readonly reel: { pageId: string; shortcode: string; url: string; videoUrl: string };

  constructor(
    reel: { pageId: string; shortcode: string; url: string; videoUrl: string },
    private readonly deps: VideoRefreshDeps,
    private readonly ledger?: CostLedger,
  ) {
    this.reel = { ...reel };
  }

  get videoUrl(): string { return this.reel.videoUrl; }
  get canRefresh(): boolean { return !this.attempted; }

  /** Before using the link: refresh when it's missing or its oe= expiry is past. */
  async ensureFresh(): Promise<string> {
    if (this.attempted) return this.reel.videoUrl;
    if (isVideoUrlExpired(this.reel.videoUrl, this.deps.now ? this.deps.now() : new Date())) {
      await this.refresh(this.reel.videoUrl ? "oe= expiry passed" : "no Video URL");
    }
    return this.reel.videoUrl;
  }

  /** After a failure: refresh (once) when it looks like a dead link. Returns true when a fresh link is ready. */
  async refreshAfterError(error: unknown): Promise<boolean> {
    if (this.attempted || isBudgetExceeded(error) || !isVideoUrlError(error)) return false;
    const message = typeof error === "string" ? error : (error as Error)?.message || String(error);
    return this.refresh(`download failed: ${message}`.slice(0, 200));
  }

  private async refresh(reason: string): Promise<boolean> {
    this.attempted = true;
    try {
      if (!this.reel.url) throw new Error("Reel has no Instagram URL to re-fetch");
      const media = await this.deps.fetchFresh(this.reel.url, this.reel.shortcode, this.ledger);
      if (!media.videoUrl) throw new Error("re-fetch returned no video URL");
      await this.deps.save(this.reel.pageId, media);
      this.reel.videoUrl = media.videoUrl;
      this.outcome = { attempted: true, refreshed: true, reason };
      console.log(`[video-refresh] ${JSON.stringify({ shortcode: this.reel.shortcode, refreshed: true, reason })}`);
      return true;
    } catch (error) {
      if (isBudgetExceeded(error)) throw error;
      this.outcome = { attempted: true, refreshed: false, reason, error: (error as Error).message.slice(0, 300) };
      console.warn(`[video-refresh] ${JSON.stringify({ shortcode: this.reel.shortcode, refreshed: false, reason, error: this.outcome.error })}`);
      return false;
    }
  }
}

/** Production deps: Apify single-Reel re-scrape + Notion write (lazy imports keep tests hermetic). */
export async function defaultVideoRefreshDeps(): Promise<VideoRefreshDeps> {
  const { fetchSingleReelMedia } = await import("../apify");
  const { updateReelMedia } = await import("./notion");
  return {
    fetchFresh: (reelUrl, shortcode, ledger) => fetchSingleReelMedia(reelUrl, shortcode, ledger),
    save: (pageId, media) => updateReelMedia(pageId, media),
  };
}

export async function createReelVideoRefresher(
  reel: { pageId: string; shortcode: string; url: string; videoUrl: string },
  ledger?: CostLedger,
): Promise<ReelVideoRefresher> {
  return new ReelVideoRefresher(reel, await defaultVideoRefreshDeps(), ledger);
}
