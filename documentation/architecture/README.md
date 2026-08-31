# documentation/architecture — how the system is put together, and why

Maintained documents. Unlike `../audits/`, these are kept current — if one
disagrees with the code, the document is the thing to fix.

| File | Answers |
| --- | --- |
| `CODEBASE_MAP.md` | Where does anything live? |
| `ROUTE_MAP.md` | Which design canvas maps to which route, what shipped from it, and what deliberately did not. One row per canvas. |
| `PROFILE_ROUTING.md` | **Generated.** Which workspace sees each canvas, under which nav section, as what surface, and how it is reached. |
| `PAGE_INVENTORY.md` | **Generated.** The same projection from the nav side: every destination each role sidebar can reach, and which canvas is behind it. |
| `UNRESOLVED_ITEMS.md` | The routing decisions that cannot be made from the code, what each blocks, and what a wrong guess would cost. |
| `ASSUMPTIONS_LOG.md` | Routing calls taken without an explicit instruction, what each was decided from, and what would make it wrong. |
| `DECISIONS.md` | Why is it built this way and not the obvious way? Numbered, D1…, each recording what was decided and what it cost. |
| `GOTCHAS.md` | What will bite me? |
| `PRODUCTION.md` | What production actually is, and how a deploy works. |
| `CLOUDFLARE-CUTOVER.md` | The plan for retiring GitHub Pages at the apex. |
| `CLOUDFLARE-PAGES-MIGRATION.md` | The frontend moves to Cloudflare Pages; the Worker keeps the API. Converges with the cutover at its step 6. |
| `MIGRATE_TO_CUSTOM_DOMAIN.md` | Domain migration notes. |
| `LEGAL_ENTITIES.md` | The entity set and what each is for. |
| `SIGNALS.md` | The signals subsystem. |
| `SOCIAL_PREVIEWS.md` | OG images and how they are generated. |
| `ANALYTICS_FUNNEL.md` | The funnel events and what they mean. |

**`CLAUDE.md` at the repo root outranks everything here.** Where this folder
disagrees with it, that file wins.

The two read most often are `ROUTE_MAP.md` (before building any surface) and
`DECISIONS.md` (before undoing something that looks wrong — several entries
exist precisely because the obvious fix was tried and was worse).

**`PROFILE_ROUTING.md` and `PAGE_INVENTORY.md` are build output.** They are
emitted by `scripts/build-profile-routing.mjs` from `ROUTE_MAP.md` and
`frontend/src/sidebarConfig.js`; editing them by hand is pointless because the
next run overwrites it, and `frontend/test/profile_routing_fresh.test.mjs`
fails the build if either falls behind its sources. Change the source, then
re-run the generator.
