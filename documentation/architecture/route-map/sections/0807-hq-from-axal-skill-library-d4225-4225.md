### HQ › AI agents › From Axal: the skill library and its seed (D4225, #4225)

The library is about eighty SKILL.md files in `cloudflare-worker/src/services/agents/skills/`, each with its golden case in `skills/cases/`. Every area of the taxonomy has at least ten. `node scripts/build-skill-library.mjs` embeds them in `services/agents/skillLibrary.generated.ts`; the Worker reads no file at run time. `services/agents/skillLibrarySeed.ts` checks each against the store's own draft and case checks and seeds them.

Both routes are in `routes/admin_hq_skills.ts`, before `/:uid`, so `library` is never read as a skill uid. Both are Super Admin only (403 otherwise).

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/admin/ai-agents/skills/library` | Super Admin | `{ skills: [{ slug, name, area, level, cases, check: { ok, code?, message? }, in_store: draft\|published\|retired\|null }] }` |
| `POST /api/admin/ai-agents/skills/library/seed` | Super Admin | `{ reason }` → `{ seeded: [{ slug, outcome: created\|cases_added\|present\|refused, code?, message?, cases? }], created, refused }`; 400 `reason_required` |

The seed creates each skill not yet in the store as an Axal **draft** with its tags, roles and golden cases. It publishes nothing: each draft then goes through D4160's review, evals and publish. Running it again creates nothing. A draft that lost a library case gets it back, and a published or retired skill is left alone. A seed that changed something writes one `ai_admin_audit` row (`skills.library_seed`) with the reason.
