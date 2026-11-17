import { schedules } from "@trigger.dev/sdk/v3";
import { runInstagramScan } from "./scan-reels";
import { runInstagramActionRouter } from "./action-router";

/**
 * Recurring jobs (Fortune approved, 2026-11-17 "Go ahead"). These are the ONLY two schedules in the project.
 * - Daily scan at 06:00 Africa/Lagos: default creator count (IG_BRAIN_CREATORS_PER_SCAN / 5), rotating by
 *   Creator Bench "Last Checked" (oldest first), with all default scan settings.
 * - Action router every 15 minutes, so the Notion action dropdowns run on their own.
 */
export const dailyInstagramScan = schedules.task({
  id: "instagram-brain-daily-scan",
  cron: { pattern: "0 6 * * *", timezone: "Africa/Lagos" },
  maxDuration: 14_400,
  retry: { maxAttempts: 1 }, // a retry would re-scrape and re-pay for everything
  run: async () => runInstagramScan({}),
});

export const instagramActionRouterSchedule = schedules.task({
  id: "instagram-brain-action-router-15m",
  cron: "*/15 * * * *",
  maxDuration: 900,
  retry: { maxAttempts: 2 },
  run: async () => runInstagramActionRouter(),
});
