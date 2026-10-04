# documentation/architecture — how the system is put together, and why

Maintained documents. Unlike `../audits/`, these are kept current — if one
disagrees with the code, the document is the thing to fix.

| File | Answers |
| --- | --- |
| `CODEBASE_MAP.md` | Where does anything live? |
| `ROUTE_MAP.md` | Which design canvas maps to which route, what shipped from it, and what deliberately did not. One row per canvas. |
| `SHELL_MIGRATION.md` | The four workspace shell migrations (Founder, Investor/LP, Advisor, Partner): IA rules, zone inventory, shipped vs open, verification commands. |
| `PROFILE_ROUTING.md` | **Generated.** Which workspace sees each canvas, under which nav section, as what surface, and how it is reached. |
| `PAGE_INVENTORY.md` | **Generated.** The same projection from the nav side: every destination each role sidebar can reach, and which canvas is behind it. |
| `UNRESOLVED_ITEMS.md` | The routing decisions that cannot be made from the code, what each blocks, and what a wrong guess would cost. |
| `ASSUMPTIONS_LOG.md` | Routing calls taken without an explicit instruction, what each was decided from, and what would make it wrong. |
| `PROFILING_V2.md` | Profiling v2 (archetype, skills, values that evolve with use). Holds S9's skill-evidence tool map; S7 owns the rest of the spec. |
| `DECISIONS.md` | Why is it built this way and not the obvious way? Numbered, D1…D525, each recording what was decided and what it cost. Takes no new entries. |
| `decisions/` | The same record from D526 on: one file per decision, `D<n>.md`. Its README has the naming rule and what checks it. |
| `GOTCHAS.md` | What will bite me? |
| `PROFILING_V2.md` | The Profiling v2 spec (D356): trait model, question formats, skills evidence, values across roles, the evolution model and its parameters, and what Sessions 7–15 build. The source of truth for that programme; `cloudflare-worker/test/fixtures/profiling-v2-personas.json` is held to it. |
| `PRODUCTION.md` | What production actually is, and how a deploy works. |
| `CLOUDFLARE-CUTOVER.md` | **Superseded record (2026-08).** The plan that retired GitHub Pages at the apex — executed, then overtaken: since 2026-09-01 the Worker serves both hosts (`PRODUCTION.md` has the current topology). Kept for the 5xx baseline table and the OAuth re-registration table, which is still live work. |
| `CLOUDFLARE-PAGES-MIGRATION.md` | **Superseded record (2026-08-31).** How the apex moved to Cloudflare Pages for one day, and what bit — the failure mode that still forbids path-scoped apex routes. Pages is a mirror of `docs/` now, not a host. |
| `MIGRATE_TO_CUSTOM_DOMAIN.md` | **Superseded record (2026-05).** The runbook that made `app.axal.vc` a Workers Custom Domain; its apex rows predate the 2026-09-01 flip that made `axal.vc` one too. |
| `LEGAL_ENTITIES.md` | The entity set and what each is for. |
| `SIGNALS.md` | The signals subsystem. |
| `SOCIAL_PREVIEWS.md` | OG images and how they are generated. |
| `ANALYTICS_FUNNEL.md` | The funnel events and what they mean. |

**`CLAUDE.md` at the repo root outranks everything here.** Where this folder
disagrees with it, that file wins.

The two read most often are `ROUTE_MAP.md` (before building any surface) and
`DECISIONS.md` with `decisions/` (before undoing something that looks wrong —
several entries exist precisely because the obvious fix was tried and was
worse).

**`PROFILE_ROUTING.md` and `PAGE_INVENTORY.md` are build output.** They are
emitted by `scripts/build-profile-routing.mjs` from `ROUTE_MAP.md` and
`frontend/src/sidebarConfig.js`; editing them by hand is pointless because the
next run overwrites it, and `frontend/test/profile_routing_fresh.test.mjs`
fails the build if either falls behind its sources. Change the source, then
re-run the generator.
