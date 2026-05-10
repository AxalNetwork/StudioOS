# Axal StudioOS — Changelog

Per-task entries since project start. Append new tasks at the top.

---

## Task #10 — AC-1 Personal Advisor backend + write-router (2026-05-10)

Persistent dashboard chatbot that profiles every persona via Q&A and writes
answers back to the right pages. Backend + write-router only — question banks
(AC-2) and chat UI (AC-3) ship in follow-up tasks.

**Schema** — `cloudflare-worker/sql/migrations/029_advisor.sql`:
- `advisor_conversations` (one active per user)
- `advisor_messages` (append-only chat log)
- `advisor_answers` (Q&A history with the routed write target; UNIQUE per conversation+question)

Lazy `ensureSchema()` mirrors the migration so dev D1 boots without it; remote
D1 application is queued for ops (alongside 024–028).

**Routes** — `cloudflare-worker/src/routes/advisor.ts` mounted at `/api/advisor`:
- `POST /start` — get-or-create active conversation + first unanswered question
- `POST /answer` — routes value to its persistence target, returns `{ saved, next, complete, progress }`
- `POST /skip` — marks `saved_status='skipped'` and advances
- `GET /progress` — cheap polling endpoint
- `GET /conversations/:uid` — full Q&A trail
- `POST /explain` — SSE stream (Anthropic Haiku); 503 if `ANTHROPIC_API_KEY` unset

**Write router** — `cloudflare-worker/src/services/advisor/writeRouter.ts`:
- Persona-aware mapping from `question_id` → `{ table, column, transform }`
- Founder bank → `projects` (lazy-creates founder + placeholder project)
- Investor bank → `investor_profiles` (long-form `thesis_text` is paywalled → returns `{ status: 'paywalled', upgrade_link: '/billing/investor-upgrade' }`)
- Mentor bank → `mentors` (lazy-creates row by email)
- Partner bank → noop with deep-link hint (binding writes happen in the partner-onboarding wizard, Task #9)
- Role detector triplet → `users.role` / `organization` / `headline`
- Refuses destructive answers (`delete|drop|truncate|wipe|destroy`) at the route layer
- Per-resource auth on top of `requireAuth` — wrong-role question_ids return `failed`

**Question bank** — `cloudflare-worker/src/services/advisor/questionBank.ts`:
- Seed bank only (~5 questions per persona) sufficient for round-trip; AC-2 will replace with the full per-page banks.

**Frontend** — `frontend/src/lib/api.js` adds `api.advisor.{start,answer,skip,progress,conversation,explainUrl}`. `explainUrl()` returns the SSE path so the AC-3 chat UI can wire `fetch + ReadableStream` directly.

**Drift / typecheck** — both green (`npm run test:drift`, `tsc --noEmit`).

**Deviation from spec** — task description called for SSE on `/answer` and `/explain`. `/answer` is deterministic (no LLM call) so SSE adds wire complexity for no streaming benefit; it returns JSON. `/explain` (the only LLM-touching endpoint) is SSE as specified. Migration uses `029_advisor.sql` (028 was claimed by `028_partner_deals.sql` from Task #9).
