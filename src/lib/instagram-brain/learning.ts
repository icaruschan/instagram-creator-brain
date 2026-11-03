import { median } from "./scoring";

export interface OwnPostResult {
  title: string;
  account: string;
  window: string;
  views: number;
  saves: number;
  shares: number;
  completionRate: number | null;
}

/** Do not infer a winning format from one or two posts. */
export function summarizeOwnPostResults(rows: OwnPostResult[]): string {
  const groups = new Map<string, OwnPostResult[]>();
  for (const row of rows) {
    if (row.views <= 0 || !["24h", "7d"].includes(row.window)) continue;
    const key = `${row.account} / ${row.window}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const summaries: string[] = [];
  for (const [key, group] of groups) {
    if (group.length < 5) continue;
    const baseline = median(group.map((row) => row.views));
    const ranked = group.map((row) => ({ row, lift: baseline > 0 ? row.views / baseline : 0 }))
      .sort((a, b) => b.lift - a.lift);
    const above = ranked.filter((item) => item.lift >= 1.5).slice(0, 3);
    const below = ranked.filter((item) => item.lift <= 0.5).slice(-2);
    summaries.push(`${key}: ${group.length} measured posts, median ${Math.round(baseline)} views. ` +
      `Strong: ${above.map(({ row, lift }) => `${row.title} (${lift.toFixed(1)}x)`).join("; ") || "none clear"}. ` +
      `Weak: ${below.map(({ row, lift }) => `${row.title} (${lift.toFixed(1)}x)`).join("; ") || "none clear"}.`);
  }
  return summaries.join("\n") || "Insufficient owned-post data: wait for at least five measured posts in the same account and time window before inferring a pattern.";
}
