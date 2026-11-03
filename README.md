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
