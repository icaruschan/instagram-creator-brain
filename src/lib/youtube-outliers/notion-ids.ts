/**
 * Filled in after `npm run migrate:youtube-outliers` (--apply) creates the "YouTube Outliers" database.
 * Env overrides (YT_OUTLIERS_DATABASE_ID / YT_OUTLIERS_DATA_SOURCE_ID) win, so the ids can be set in Trigger
 * without a code change. Empty = not migrated yet: Notion writes throw a clear error, the dry run never needs them.
 */
export const YOUTUBE_OUTLIER_NOTION_IDS = {
  get databaseId(): string {
    return process.env.YT_OUTLIERS_DATABASE_ID || "";
  },
  get dataSourceId(): string {
    return process.env.YT_OUTLIERS_DATA_SOURCE_ID || "";
  },
};

export function requireYouTubeOutlierIds(): { databaseId: string; dataSourceId: string } {
  const { databaseId, dataSourceId } = YOUTUBE_OUTLIER_NOTION_IDS;
  if (!databaseId || !dataSourceId) {
    throw new Error("YouTube Outliers database is not set up yet: run the migration (npm run migrate:youtube-outliers -- --apply) and set YT_OUTLIERS_DATABASE_ID / YT_OUTLIERS_DATA_SOURCE_ID");
  }
  return { databaseId, dataSourceId };
}
