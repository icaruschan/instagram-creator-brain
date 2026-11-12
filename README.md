# Instagram Creator Brain

An isolated Trigger.dev automation for Instagram-native AI Creative research, source analysis, original angle generation, ScriptWriter V2.3 execution, and Reel production planning.

## Separation guarantee

This project owns its own Trigger.dev project, schedules, environment variables, source database IDs, and Notion workspace. It does not import, deploy, or write into Ultimate Creator Brain.

## Local setup

1. Copy `.env.example` to `.env` and provide only the Instagram Brain credentials.
2. Run `npm install`.
3. Run `npm run verify:notion`.
4. Use `npm run dev` for the separate Trigger.dev project.

Trigger.dev project: `proj_xsktxkyadeapydcirmck` (Instagram Creator Brain).
Trigger.dev runtime: `node-24` with matching CLI, SDK, and build packages pinned to 4.6.4.
Jev and MiniMax M3 are routed through OpenRouter. Gemini uses the Gemini API.

The scan and Notion action-router tasks are currently manual-only. Both recurring schedules remain disabled until the user explicitly approves activation. When scheduling is approved, the intended scan cadence is Monday/Wednesday/Friday at 9:00 a.m. Africa/Lagos, up to five creators per run (configurable with `IG_BRAIN_CREATORS_PER_SCAN`) and at most five Gemini deep analyses. No content is auto-published.

In Notion, choose an action on an Outlier Card to generate angles. Pick an account and angle in Idea Lab before requesting a script, then request a production blueprint from the resulting Production Queue item. After manually publishing, enter its Instagram Post URL and choose **Mark Published**; this creates 24h, 7d, and 30d manual Insights check-ins. Private Instagram metrics are not auto-fetched.

Production Queue pages lead with a readable creative brief and timed script. The production shot guide is collapsed beneath it; machine-readable JSON remains at the bottom for downstream tasks. Until action polling is explicitly enabled, choosing a Notion action records the choice but does not automatically run a task.

The Notion workspace contains Creator Bench, Reel Intelligence, Reel Snapshots, Idea Lab, Production Queue, and Performance Log.

## Guardrails (branch feat/yuna-guardrails, 2026-11-12)

- **Yuna only.** `IG_BRAIN_ACTIVE_ACCOUNTS` defaults to `Yuna`. Alisha's config is kept in `ACCOUNTS` but disabled; angles default to Account = Yuna, and scripts for Alisha/Both are refused with a clear message.
- **Trial Reels skipped.** The Apify reel scraper is called with `skipTrialReels: true` (`IG_BRAIN_SKIP_TRIAL_REELS`).
- **Spending caps + cost log.** Every paid call (Apify, Jev, Gemini, MiniMax) is checked against a per-run cap before it is made and logged after (`[cost]` lines in the Trigger log, a `cost` block in each run's output and metadata, and best-effort `.tmp/ig-brain-cost-log.jsonl`). Scan cap `IG_BRAIN_SCAN_BUDGET_USD` (default $1.00); per action task `IG_BRAIN_ACTION_BUDGET_USD` (default $0.25). A capped scan stops cleanly and reports `stoppedReason`.
- **Score cut-offs.** Gemini analysis needs Performance Score ≥ `IG_BRAIN_MIN_PERFORMANCE_FOR_ANALYSIS` (60). Angles need a Gemini analysis and Priority ≥ `IG_BRAIN_MIN_PRIORITY_FOR_ANGLES` (60); tick **Manual Override** on the Reel to bypass the score cut-off.
- **Revise Angle** works: write optional feedback in the idea's **Revision Notes**, choose Revise Angle; the angle is rewritten in place and the old version is kept in a toggle.
- **A/B scripts.** Generate Script still writes the AI ScriptWriter V2.3 script, and sets **Lara Script Status = Needed** next to an empty **Lara Script** field. Fortune records the pick in **Chosen Script** (Undecided / AI V2.3 / Lara); the blueprint uses Lara's script when she is chosen.
- **Pillar / Content Type.** The Jev fit check tags each Reel with Yuna's Pillar (Visual Storyteller, Creative Operator, Storytelling) and a Content Type; angles and briefs inherit them.
- **Notion migration:** run `npm run migrate:yuna-guardrails:dry` (read-only), then `npm run migrate:yuna-guardrails` **before** deploying this branch — the new code writes the new properties.
