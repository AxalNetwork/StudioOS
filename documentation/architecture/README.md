# documentation/architecture — how the system is put together, and why

Maintained documents. Unlike `../audits/`, these are kept current — if one
disagrees with the code, the document is the thing to fix.

| File | Answers |
| --- | --- |
| `CODEBASE_MAP.md` | Where does anything live? |
| `ROUTE_MAP.md` | Which design canvas maps to which route, what shipped from it, and what deliberately did not. One row per canvas. |
| `DECISIONS.md` | Why is it built this way and not the obvious way? Numbered, D1…, each recording what was decided and what it cost. |
| `GOTCHAS.md` | What will bite me? |
| `PRODUCTION.md` | What production actually is, and how a deploy works. |
| `CLOUDFLARE-CUTOVER.md` | The plan for retiring GitHub Pages at the apex. |
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
