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
Jev, MiniMax M3 and Reel video analysis (Qwen3.8 Omni Flash by default) are routed through OpenRouter. The native Gemini API path is kept as an option (`VIDEO_ANALYSIS_PROVIDER=gemini` or `VIDEO_ANALYSIS_FALLBACK=gemini`).

The scan and Notion action-router tasks are currently manual-only. Both recurring schedules remain disabled until the user explicitly approves activation. When scheduling is approved, the intended scan cadence is Monday/Wednesday/Friday at 9:00 a.m. Africa/Lagos, up to five creators per run (configurable with `IG_BRAIN_CREATORS_PER_SCAN`) and at most five Gemini deep analyses. No content is auto-published.

In Notion, choose an action on an Outlier Card to generate angles. Pick an account and angle in Idea Lab before requesting a script, then request a production blueprint from the resulting Production Queue item. After manually publishing, enter its Instagram Post URL and choose **Mark Published**; this creates 24h, 7d, and 30d manual Insights check-ins. Private Instagram metrics are not auto-fetched.

Production Queue pages lead with a readable creative brief and timed script. The production shot guide is collapsed beneath it; machine-readable JSON remains at the bottom for downstream tasks. Until action polling is explicitly enabled, choosing a Notion action records the choice but does not automatically run a task.

The Notion workspace contains Creator Bench, Reel Intelligence, Reel Snapshots, Idea Lab, Production Queue, and Performance Log.

## Guardrails (branch feat/yuna-guardrails, 2026-11-12)

- **Yuna only.** `IG_BRAIN_ACTIVE_ACCOUNTS` defaults to `Yuna`. Alisha's config is kept in `ACCOUNTS` but disabled; angles default to Account = Yuna, and scripts for Alisha/Both are refused with a clear message.
- **Trial Reels skipped.** The Apify reel scraper is called with `skipTrialReels: true` (`IG_BRAIN_SKIP_TRIAL_REELS`).
- **Recent Reels only.** New candidates must be unpinned and published within `IG_BRAIN_RECENT_WINDOW_DAYS` (default 14). Pinned, too-old and undated Reels are skipped and counted (`[recency]` log lines, `recency` in the run output); they are never fit-checked, analysed or rescored.
- **8 candidate slots per creator, shared with rechecks.** `IG_BRAIN_REELS_PER_CREATOR` (default 8). Pools: NEW (unseen, recent, unpinned) and RECHECK (existing in-window, unpinned rows never fit-checked, or Core/Supporting but never analysed whose age-fair Performance now clears the analysis cut-off). The 2 newest NEW Reels (`ceil(slots/4)`) get guaranteed slots; the rest go by Performance across both pools. Never rechecked: pinned, older than the window, Ignored/Failed/Irrelevant/Adjacent, anything already analysed, or shortcodes in `blockedShortcodes` / `IG_BRAIN_BLOCKED_SHORTCODES` (trashed rows; the Notion API can't see Trash). Transcripts are fetched only for slot winners. `[slots]` log line per creator.
- **Age-fair scoring.** View Lift compares a Reel with what the creator's typical Reel had at the same age: a robust views-vs-age curve (`views ≈ A·age^b`, Theil-Sen slope, median level) fitted on the same scrape's unpinned Reels. Velocity is compared with the typical views/hour at that age (`∝ age^(b-1)`). Too little data → plain median, as before. Weights unchanged (55/25/20). See `src/lib/instagram-brain/recency.ts`.
- **Spending caps + cost log.** Every paid call (Apify, Jev, Gemini, MiniMax) is checked against a per-run cap before it is made and logged after (`[cost]` lines in the Trigger log, a `cost` block in each run's output and metadata, and best-effort `.tmp/ig-brain-cost-log.jsonl`). Scan cap `IG_BRAIN_SCAN_BUDGET_USD` (default $1.00); per action task `IG_BRAIN_ACTION_BUDGET_USD` (default $0.25). A capped scan stops cleanly and reports `stoppedReason`.
- **Score cut-offs.** Gemini analysis needs Performance Score ≥ `IG_BRAIN_MIN_PERFORMANCE_FOR_ANALYSIS` (60). Angles need a Gemini analysis and Priority ≥ `IG_BRAIN_MIN_PRIORITY_FOR_ANGLES` (60); tick **Manual Override** on the Reel to bypass the score cut-off.
- **Revise Angle** works: write optional feedback in the idea's **Revision Notes**, choose Revise Angle; the angle is rewritten in place and the old version is kept in a toggle.
- **A/B scripts.** Generate Script still writes the AI ScriptWriter V2.3 script, and sets **Lara Script Status = Needed** next to an empty **Lara Script** field. Fortune records the pick in **Chosen Script** (Undecided / AI V2.3 / Lara); the blueprint uses Lara's script when she is chosen.
- **Pillar / Content Type.** The Jev fit check tags each Reel with Yuna's Pillar (Visual Storyteller, Creative Operator, Storytelling) and a Content Type; angles and briefs inherit them.
- **Video analysis provider.** `VIDEO_ANALYSIS_PROVIDER` = `openrouter` (default; model `VIDEO_ANALYSIS_OPENROUTER_MODEL`, default `qwen/qwen3.8-omni-flash`) or `gemini`. The Reel is downloaded from the Instagram CDN and sent to OpenRouter's Chat Completions API as a base64 `data:video/mp4` URL in a `video_url` content part (`VIDEO_ANALYSIS_SEND_MODE=url` sends the CDN link instead; capped at `VIDEO_ANALYSIS_MAX_INLINE_MB`, default 40). Same prompt and JSON schema as Gemini, so downstream code is unchanged. No output or thinking cap is set (the model's own maximum applies); an empty or non-JSON answer is retried once. Real cost comes from OpenRouter `usage.cost`. Optional one-shot fallback to the other provider: `VIDEO_ANALYSIS_FALLBACK` (default `none`).
- **Retries.** Video-analysis model calls have no request timeout (the task's maxDuration is the backstop); HTTP 429/503 are retried with exponential backoff (honouring Retry-After) up to `VIDEO_ANALYSIS_MAX_ATTEMPTS` (3). Rejected 429/503 attempts are logged at $0.
- **Failures are visible.** When analyze-reel fails for good, the Reel's **Action State** is set to Failed and **Last Error** gets the reason; a later successful analysis clears both.
- **Trial Reel count.** Each scan result has `trialReels` (`resultsReturned`, `droppedLocally`, `skippedByActor: null`). The actor filters Trial Reels server-side, does not report how many, and does not mark them in its output, so the skipped count is not available without a second, unfiltered scrape.
- **Notion migration:** run `npm run migrate:yuna-guardrails:dry` (read-only), then `npm run migrate:yuna-guardrails` **before** deploying this branch — the new code writes the new properties.
