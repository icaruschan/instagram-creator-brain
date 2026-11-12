/**
 * Notion migration for the 2026-11-12 Yuna guardrails branch.
 *
 * DRY RUN BY DEFAULT: reads the live schemas and prints what it would change. Nothing is written
 * unless you pass --apply. It only ADDS properties / select options; it never renames, deletes or
 * changes existing ones, and it touches no rows.
 *
 *   npx tsx scripts/migrate-yuna-guardrails.ts            # dry run (read-only)
 *   npx tsx scripts/migrate-yuna-guardrails.ts --apply    # apply
 *   npx tsx scripts/migrate-yuna-guardrails.ts --plan     # offline: print the planned additions, no Notion calls
 */
import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import { CONTENT_TYPES, YUNA_PILLARS } from "../src/lib/instagram-brain/config";
import { INSTAGRAM_BRAIN_NOTION_IDS } from "../src/lib/instagram-brain/notion-ids";

dotenv.config({ override: true });

type PropertyDefinition =
  | { type: "select"; select: { options: Array<{ name: string; color?: string }> } }
  | { type: "rich_text"; rich_text: Record<string, never> };

const select = (names: readonly string[], colors: string[] = []): PropertyDefinition => ({
  type: "select",
  select: { options: names.map((name, index) => (colors[index] ? { name, color: colors[index] } : { name })) },
});
const text = (): PropertyDefinition => ({ type: "rich_text", rich_text: {} });

const PILLAR = select(YUNA_PILLARS, ["purple", "blue", "orange"]);
const CONTENT_TYPE = select(CONTENT_TYPES);

export const DESIRED: Record<string, { dataSourceId: string; properties: Record<string, PropertyDefinition> }> = {
  "Reel Intelligence": {
    dataSourceId: INSTAGRAM_BRAIN_NOTION_IDS.reelIntelligence.dataSourceId,
    properties: {
      Pillar: PILLAR,
      "Content Type": CONTENT_TYPE,
    },
  },
  "Idea Lab": {
    dataSourceId: INSTAGRAM_BRAIN_NOTION_IDS.ideaLab.dataSourceId,
    properties: {
      Pillar: PILLAR,
      "Content Type": CONTENT_TYPE,
      "Revision Notes": text(),
      // "Revise Angle" already exists as an Action Requested option (verified 2026-11-03), so no change.
    },
  },
  "Production Queue": {
    dataSourceId: INSTAGRAM_BRAIN_NOTION_IDS.productionQueue.dataSourceId,
    properties: {
      Pillar: PILLAR,
      "Content Type": CONTENT_TYPE,
      "Lara Script": text(),
      "Lara Script Status": select(["Needed", "Drafted"], ["red", "green"]),
      "Chosen Script": select(["Undecided", "AI V2.3", "Lara"], ["gray", "blue", "pink"]),
    },
  },
};

export interface PlannedChange {
  database: string;
  property: string;
  action: "add property" | "add options" | "type conflict";
  detail: string;
}

/** Pure planner: compares a live schema (properties map) with the desired additions. */
export function planChanges(
  database: string,
  liveProperties: Record<string, any> | null,
  desired: Record<string, PropertyDefinition>,
): { changes: PlannedChange[]; update: Record<string, any> } {
  const changes: PlannedChange[] = [];
  const update: Record<string, any> = {};
  for (const [name, definition] of Object.entries(desired)) {
    const live = liveProperties?.[name];
    if (!live) {
      update[name] = definition;
      const detail = definition.type === "select"
        ? `select: ${definition.select.options.map((option) => option.name).join(", ")}`
        : "rich text";
      changes.push({ database, property: name, action: "add property", detail });
      continue;
    }
    if (live.type !== definition.type) {
      changes.push({ database, property: name, action: "type conflict", detail: `exists as ${live.type}, expected ${definition.type}; left unchanged` });
      continue;
    }
    if (definition.type === "select") {
      const existing: Array<{ id?: string; name: string; color?: string }> = live.select?.options || [];
      const existingNames = new Set(existing.map((option) => option.name));
      const missing = definition.select.options.filter((option) => !existingNames.has(option.name));
      if (missing.length) {
        // Notion replaces the option list on update, so send existing options (by id) plus the new ones.
        update[name] = { select: { options: [...existing.map((option) => (option.id ? { id: option.id } : { name: option.name })), ...missing] } };
        changes.push({ database, property: name, action: "add options", detail: missing.map((option) => option.name).join(", ") });
      }
    }
  }
  return { changes, update };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const offline = process.argv.includes("--plan");
  if (offline) {
    console.log("Offline plan (assumes none of the new properties exist yet; no Notion calls):");
    for (const [database, spec] of Object.entries(DESIRED)) {
      for (const change of planChanges(database, {}, spec.properties).changes) {
        console.log(`- ${change.database} → ${change.property}: ${change.action} (${change.detail})`);
      }
    }
    return;
  }
  if (!process.env.NOTION_API_KEY) throw new Error("NOTION_API_KEY is required");
  const notion = new Client({ auth: process.env.NOTION_API_KEY });
  console.log(`Yuna guardrails Notion migration (${apply ? "APPLY" : "dry run, read-only"})`);
  let total = 0;
  for (const [database, spec] of Object.entries(DESIRED)) {
    const source: any = await notion.dataSources.retrieve({ data_source_id: spec.dataSourceId });
    const { changes, update } = planChanges(database, source.properties || {}, spec.properties);
    if (!changes.length) {
      console.log(`${database}: up to date`);
      continue;
    }
    for (const change of changes) console.log(`- ${change.database} → ${change.property}: ${change.action} (${change.detail})`);
    total += changes.length;
    if (apply && Object.keys(update).length) {
      await notion.dataSources.update({ data_source_id: spec.dataSourceId, properties: update as any });
      console.log(`${database}: applied ${Object.keys(update).length} property update(s)`);
    }
  }
  console.log(apply ? `Done: ${total} change(s) applied.` : `Dry run: ${total} change(s) would be made. Re-run with --apply to write.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
