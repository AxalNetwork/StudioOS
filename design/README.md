# Design: Gamified Assessment + Event Systems

This folder is the design package for two new StudioOS systems. It is meant to
be handed to Replit (with this branch + the PR) to build against. It contains
the full design, the **canonical D1 schema** (already written as migrations),
and a **sequenced prompt pack**.

> Placed in `design/` (not `docs/`, which is the committed **frontend build
> output** per CLAUDE.md). Nothing here changes runtime behaviour: it is
> documentation + additive, unapplied SQL migrations. CI (`test:drift`, `tsc`)
> stays green because no worker route, `api.js` method, or frontend file is
> touched yet — that is the Replit build's job.

## Contents

| File | What it is |
|---|---|
| [`GAMIFIED_ASSESSMENT_SYSTEM.md`](./GAMIFIED_ASSESSMENT_SYSTEM.md) | Full design of the value + skill assessment "games" (6 persona tracks, mechanics, scoring, archetypes, matching, frontend) |
| [`EVENT_SYSTEM.md`](./EVENT_SYSTEM.md) | Full design of the event system (admin publish gate, invitations, comp eligibility, capacity caps, QR check-in, public calendar) |
| [`REPLIT_PROMPTS.md`](./REPLIT_PROMPTS.md) | Copy-paste, sequenced build prompts (Phases A1–A4, E1–E4, F) with the non-negotiable repo rules |

## Schema (already committed, additive, unapplied)

| Migration | Adds |
|---|---|
| `cloudflare-worker/sql/migrations/107_assessment_engine.sql` | Game content: `assessment_games`, `assessment_chapters`, `assessment_items`, `assessment_archetypes`, `badge_catalog` (+ a playable seeded **Founder Origin** game and per-track templates) |
| `cloudflare-worker/sql/migrations/108_assessment_play.sql` | Per-user play: `assessment_sessions`, `assessment_responses`, `assessment_results`, `user_xp` (side table), `user_badges` |
| `cloudflare-worker/sql/migrations/109_events_core.sql` | Events: `events`, `event_hosts`, `event_agenda`, `event_invitations`, `event_registrations` |

## The two ideas in one breath

1. **Assessment is a game, not a survey.** Short, scenario-driven mechanics
   (trade-off dilemmas, card-sort drafts, situational skill quests, timed
   gut-checks, fund allocations) infer values + skills from *choices*. The
   result writes into the **canonical tables matching already reads**
   (`user_values`, `user_skills`, `investor_profiles`) and surfaces as a
   shareable **archetype card** — so mentor / co-founder / investor / partner
   matching lights up with no changes to those consumers. Six tailored tracks:
   new founders, existing founders, investors/LPs, service partners, mentors,
   coaches.

2. **Events with an admin publish gate.** Founders create and self-publish
   **private** demo days and invite the investors/partners/clients they know
   (personally or via a landing link); **public** events require **admin
   approval** before they hit the public calendar. **Official partners and
   invested LPs get automatic free seats.** Capacity caps with waitlists, QR
   check-in, and a public `/events` calendar that promotes the platform.

## Build order

`REPLIT_PROMPTS.md` → Prompt 0 (apply migrations) → A1…A4 → E1…E4 → F. Each
phase: worker route first, then `api.js`, then frontend; finish with
`npm run test:drift` + `tsc --noEmit` green.
