# documentation/architecture — how the system is put together, and why

Maintained documents. Unlike `../audits/`, these are kept current — if one
disagrees with the code, the document is the thing to fix.

| File | Answers |
| --- | --- |
| `CODEBASE_MAP.md` | Where does anything live? |
| `ROUTE_MAP.md` | A pointer to `route-map/` (D4102). |
| `route-map/` | Which design canvas maps to which route, what shipped from it, and what deliberately did not: one file per section and one file per canvas row. `node scripts/build-route-map.mjs` joins them into one document. |
| `SHELL_MIGRATION.md` | The four workspace shell migrations (Founder, Investor/LP, Advisor, Partner): IA rules, zone inventory, shipped vs open, verification commands. |
| Profile routing map | **Generated, not committed** (D4103). Which workspace sees each canvas, under which nav section, as what surface, and how it is reached. `npm run docs:routing` writes it here; CI keeps it as the `routing-docs` artifact. |
| `AI_MODEL_COVERAGE.md` | **Generated** (D1478). Every Workers AI catalogue model against the 14 platform modules: wired, offered, gap or n/a, with the file and line or page that does it, the picks the run never reads, and Pitch deck v2's models priced per run. `cloudflare-worker/test/ai_model_coverage_d1478.test.ts` fails when it differs from `renderCoverage()`. |
| `SKILL_LIBRARY_CONTRACT.md` | Versioned, importer-compatible source definition and golden-case contract: current enforcement, compatibility aliases, evaluation limits, and the staged v2 path. |
| `MODEL_TERMS.md` | D1504. Every model a run can reach: grandfathered or not, where it is routed from, and what its provider's terms allow (licence, commercial output, attribution, flow-down), "Not recorded" until reviewed. `cloudflare-worker/test/ai_model_terms_d1504.test.ts` holds it equal to `cloudflare-worker/src/services/ai/modelTerms.ts`. |
| Page inventory | **Generated, not committed** (D4103). The same projection from the nav side: every destination each role sidebar can reach, and which canvas is behind it. Written beside the routing map by the same command. |
| `UNRESOLVED_ITEMS.md` | The routing decisions that cannot be made from the code, what each blocks, and what a wrong guess would cost. |
| `ASSUMPTIONS_LOG.md` | Routing calls taken without an explicit instruction, what each was decided from, and what would make it wrong. |
| `DECISIONS.md` | Why is it built this way and not the obvious way? Numbered, D1…D525, each recording what was decided and what it cost. Takes no new entries. |
| `decisions/` | The same record from D526 on: one file per decision, `D<n>.md`. Its README has the naming rule and what checks it. |
| `GOTCHAS.md` | What will bite me? |
| `MCP_API_PLATFORM.md` | The MCP engine, member API keys and AI token metering: what exists, the contracts, the security decisions, and which task builds what (#2463). Updated every session. |
| `PROFILING_V2.md` | The Profiling v2 spec (D356): trait model, question formats, skills evidence, values across roles, the evolution model and its parameters, and what Sessions 7–15 build. The source of truth for that programme; `cloudflare-worker/test/fixtures/profiling-v2-personas.json` is held to it. |
| `PRODUCTION.md` | What production actually is, and how a deploy works. |
| `CLOUDFLARE-CUTOVER.md` | **Superseded record (2026-08).** The plan that retired GitHub Pages at the apex — executed, then overtaken: since 2026-09-01 the Worker serves both hosts (`PRODUCTION.md` has the current topology). Kept for the 5xx baseline table and the OAuth re-registration table, which is still live work. |
| `CLOUDFLARE-PAGES-MIGRATION.md` | **Superseded record (2026-08-31).** How the apex moved to Cloudflare Pages for one day, and what bit — the failure mode that still forbids path-scoped apex routes. Pages is a mirror of `docs/` now, not a host. |
| `MIGRATE_TO_CUSTOM_DOMAIN.md` | **Superseded record (2026-05).** The runbook that made `app.axal.vc` a Workers Custom Domain; its apex rows predate the 2026-09-01 flip that made `axal.vc` one too. |
| `LEGAL_ENTITIES.md` | The entity set and what each is for. |
| `SIGNALS.md` | The signals subsystem. |
| `SOCIAL_PREVIEWS.md` | OG images and how they are generated. |
| `SOCIAL_CARDS_MAP.md` | D1440: which card each route group shares as, who can open it, whether it is meant to be shared, where its title and image come from, and the retirement calls. |
| `ANALYTICS_FUNNEL.md` | The funnel events and what they mean. |

**`CLAUDE.md` at the repo root outranks everything here.** Where this folder
disagrees with it, that file wins.

The two read most often are the route map, `route-map/` (before building any surface), and
`DECISIONS.md` with `decisions/` (before undoing something that looks wrong —
several entries exist precisely because the obvious fix was tried and was
worse).

**The profile routing map and the page inventory are build output, and are
not committed (D4103, #4103).** `scripts/build-profile-routing.mjs` emits them
from the route map (`route-map/`) and `frontend/src/sidebarConfig.js`. Every
routing change used to rewrite both, so parallel branches conflicted on them;
now `.gitignore` lists them. To read them, run `npm run docs:routing`, which
writes them into this folder, or download the `routing-docs` artifact of any CI
run's `routing docs (artifact)` job. `node scripts/build-profile-routing.mjs --check` (in
`npm run test:guards`) fails when the projection cannot be built, a canvas
reaches no workspace, a table is malformed, or either file is committed again.
Change the sources; never edit or commit the output.
