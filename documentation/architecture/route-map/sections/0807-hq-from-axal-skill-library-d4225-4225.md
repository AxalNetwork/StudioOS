### HQ › AI agents › From Axal: the skill library and its seed (D4225, #4225)

The library is about eighty SKILL.md files in `cloudflare-worker/src/services/agents/skills/`, each with its golden case in `skills/cases/`. Every area of the taxonomy has at least ten. `node scripts/build-skill-library.mjs` builds them into two outputs (D4574 H3): `services/agents/skillLibrary.generated.ts`, the index the Worker imports (slugs, digest, asset path), and `frontend/public/skill-library/library-<digest16>.json`, the entries, a static asset the routes read through the Worker's assets binding (`services/agents/skillLibraryAsset.ts`). `/skill-library/*` runs the Worker first, which answers 404 there, so the entries reach no one but these routes. `services/agents/skillLibrarySeed.ts` checks each against the store's own draft and case checks and seeds them.

Both routes are in `routes/admin_hq_skills.ts`, before `/:uid`, so `library` is never read as a skill uid. Both are Super Admin only (403 otherwise).

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/admin/ai-agents/skills/library` | Super Admin | `{ skills: [{ slug, name, area, level, cases, check: { ok, code?, message? }, in_store: draft\|published\|retired\|null }] }` |
| `POST /api/admin/ai-agents/skills/library/seed` | Super Admin | `{ reason }` → `{ seeded: [{ slug, outcome: created\|cases_added\|present\|refused, code?, message?, cases? }], created, refused }`; 400 `reason_required` |

D4574 H3 (#4574): where the library's asset cannot be read, both routes (and D5335's `GET …/library/reconcile`) answer 503 `library_unreadable`, "The skill library could not be read. Nothing was changed; try again.", and write and audit nothing; the seed checks its reason first. The page already shows an unreadable library as unreadable, never as empty.

The seed creates each skill not yet in the store as an Axal **draft** with its tags, roles and golden cases. It publishes nothing: each draft then goes through D4160's review, evals and publish. Running it again creates nothing. A draft that lost a library case gets it back, and a published or retired skill is left alone. A seed that changed something writes one `ai_admin_audit` row (`skills.library_seed`) with the reason.
