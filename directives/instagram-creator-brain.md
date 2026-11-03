# Directive: Instagram Creator Brain

## Goal

Build and operate a separate, Instagram-native creator research-to-production system. It shares the existing TypeScript, Trigger.dev, Notion, Apify, and model-client infrastructure, but it must not read from or write to the Ultimate Creator Brain's X-first Ideas Bank, Scouted Content, Content Pipeline, or creator databases.

The user-facing experience is a calm Creator Desk. Raw ingestion, snapshots, model evidence, and scores stay available for audit without becoming the default interface.

## Core pipeline

```text
Creator Bench
→ creator Reel scan (manual until schedule approval)
→ Reel Intelligence + metric snapshots
→ deterministic Performance Outlier Score
→ Jev strategic-fit gate
→ Gemini visual analysis
→ Jev Visual Pattern Value + Workflow Value
→ Priority Score
→ MiniMax angle strategy
→ human selects account, delivery profile, and angle
→ MiniMax + ScriptWriter V2.3
→ MiniMax production blueprint
→ human publishes
→ 24h / 7d performance learning
```

## Model responsibilities

- **Deterministic code:** scraping, deduplication, metric snapshots, creator baselines, score arithmetic, state transitions, and schedules.
- **Jev (`typesafe/jev-1.13` through OpenRouter):** bounded relevance, fit, visual-value, workflow-value, mode, and routing decisions.
- **Gemini:** multimodal Reel perception. It describes visible hooks, pacing, text, audio cues, visual payoff, production mechanics, and scene structure. It does not invent missing visuals.
- **MiniMax M3:** original angle strategy, ScriptWriter V2.3 execution, revisions, and Reel-native production blueprints.
- **ScriptWriter V2.3:** editorial rulebook. Kallaway is the default engine; RPN and Hybrid are explicit alternatives.
- **Human:** selects, edits, approves, creates, and publishes. The system never auto-publishes.

## Pillars

1. Creative AI Video
2. AI Creative Workflow
3. AI Tools & Model Experiments
4. Creator AI Systems & Automation
5. AI & Creative Commentary

Creator tags are evidence-based niche/pillar tags. They are not fixed account roles. Both Alisha and Yuna can use Visual-first, Operator-first, or Hybrid delivery profiles.

## Priority score

```text
Priority Score
= 45% Performance Outlier Score
+ 30% Strategic Fit Score
+ 25% max(Visual Pattern Value, Workflow Value)
```

When velocity is unavailable, Performance Outlier uses creator-relative view lift and engagement lift. After multiple snapshots, it uses view lift, engagement lift, and velocity lift. A manual override must always exist for visually exceptional or strategically important Reels with immature metrics.

## Notion system

Create a top-level **Instagram Creator Brain** page, separate from **Ultimate Creator Brain**, with these databases:

1. **Creator Bench** — who to watch, pillar tags, profile snapshot, and baseline metrics.
2. **Reel Intelligence** — one canonical record per source Reel. An Outlier Card is a filtered view of this record, never a duplicate.
3. **Reel Snapshots** — time-stamped public metrics used for velocity and baselines.
4. **Idea Lab** — original angle previews linked to one source Reel.
5. **Production Queue** — a readable creative brief first, then a collapsible shot guide; automation JSON remains collapsed below for continuity.
6. **Performance Log** — 24h / 7d / 30d results for the user's published content.

## Decision actions

- `Generate Visual Angles`
- `Generate Operator Angles`
- `Generate Both`
- `Save for Later`
- `Ignore`
- `Generate Script`
- `Generate Blueprint`
- `Mark Ready`
- `Mark Published`

Notion records the requested action. Once action polling is explicitly approved and activated, Trigger.dev workers claim it idempotently, mark it processing, perform the authorized task, write the result back to the same record or its linked downstream record, and clear the action. Until then, selecting an action in Notion does not automatically run the workflow.

## Creator-facing production deliverables

- Open with a draft/unproduced label, concise concept, and timed visual/voice/text/sound script. Visual-first may have minimal dialogue; Operator-first leads with spoken copy.
- Keep the production shot guide collapsed: assets, edit notes, production risks, decisions needed, and unchecked preflight checks. Do not repeat the entire script in the shot guide.
- Name tools as candidates unless the creator has explicitly selected them. Never promise a prompt pack or other resource that has not been made.
- A model cannot mark a draft render "Verified" or "Passed". High/Medium/Low complexity is a planning signal, not a measured duration.
- Preserve machine-readable script and blueprint JSON beneath the readable brief so downstream tasks can still parse them.

## Safety and cost controls

- Never process the same shortcode twice.
- Store raw video only temporarily; persist URL, cover, caption, transcript, snapshots, and grounded analysis.
- Run Gemini only after deterministic/Jev qualification or manual override.
- Run MiniMax only after a source qualifies or the user explicitly requests an action.
- Never generate scripts for every angle automatically.
- Never auto-select an angle, account, delivery profile, or publishing state.
- Failed scrapes do not advance `Last Checked`.
- Scans and action routing remain manual-only until the user explicitly approves schedules. When approved, the intended scans rotate through at most five creators per Monday/Wednesday/Friday run; the 5-per-run ceiling and 5 Gemini analyses cap bound recurring spend. Change `IG_BRAIN_CREATORS_PER_SCAN` only after reviewing costs.
- Keep `trigger.config.ts` on the `node-24` runtime and keep `trigger.dev`, `@trigger.dev/sdk`, and `@trigger.dev/build` on matching versions. The previous `node` runtime resolves to deprecated Node 21; verify the current Production runtime after each runtime migration.
- Reject an Instagram metric scrape if views are missing or regress below the previous trustworthy count; never treat unavailable metrics as genuine negative growth.
- The live two-snapshot velocity test and manual Notion action → script → blueprint smoke test passed on the separate project. These tests do not authorize activating production schedules.
- Publishing requires the real Instagram post URL. The action creates 24h, 7d, and 30d manual Insights check-ins; do not fabricate private reach, saves, shares, or watch-time data.
- Only feed owned-post performance patterns back into angle strategy after at least five measured posts in the same account and time window.
