# cloudflare-worker/src/services — logic, not HTTP

Everything a route needs that is not request parsing or response shaping. A file
here takes `env` and plain values; it does not take a Hono `Context` and does
not return a `Response`.

The split matters because it is what makes the logic testable: the worker suite
runs these directly against an in-process SQLite, with no request at all.

## The ones worth knowing

| File | Why it matters |
| --- | --- |
| `tenancyScope.ts` | **The one place row-level scoping is decided.** Returns composable SQL clauses (`esignEnvelopeScope`, `fundGpScope`, `lpMembershipScope`) and fails closed — an actor it cannot identify gets `NO_ROWS`, not everything. |
| `signedDownload.ts` | One-time, short-TTL, HMAC-signed R2 download tokens. Every private file download goes through it. |
| `dealPassTaxonomy.ts` | The five pass reasons and the stage-event recorder. |
| `backup.ts` | The nightly D1 export to R2. |
| `fundSheets.ts` | Super Admin fund research ↔ Google Sheets. Dedicated OAuth, never calendar tokens. Founders cannot Connect. |
| `researchFundRead.ts` | The dossier overlap sentence. A missing cheque end stays open; a missing raise is not an overlap of zero. |
| `securityEvents.ts` | The `security_events` ledger (D200): refusals and step-ups at the auth boundary, subject hashed and network bucketed, one row per minute, 90-day retention sealed by trigger. Never throws — a refusal's own status is never changed by its telemetry. |
| `deadLetters.ts` | The dead-letter backlog counted once, over **both** of its tables (`dead_letter_queue` and `cf_dlq_mirror`). Read-only, and either table failing makes the whole answer unreadable with the table named — half a sum is never sent as the sum (D202). |
| `platformSwitches.ts` | The switches the platform does have, for HQ Platform (D202) and Switches (D203). **It parses no variable of its own**: each entry calls the predicate its reader calls, because the readers disagree about what "on" means. States only — never a value, never a variable name. `eadwyn_off` is the one with two halves, the deployment's and HQ's, and both are read through `advisorKillState` — the predicate every advisor route calls. |
| `operatorSwitches.ts` | The switch store HQ throws from Platform → Switches (D203, migration 283). **Kill-only**: it can switch a capability off and release its own kill, never switch one on and never lift a deployment's. Read as one 30-second reading per database binding; the writing isolate clears its own reading, a failed read keeps the last good one and retries after the same 30 seconds rather than latching, and with none the store is unreadable — which the gate reads as "not thrown", because a D1 blip must not switch Eadwyn off for everyone. The D1 reads live here and not in `platformSwitches.ts`, whose guard forbids it reading the environment. |
| `supportQueues.ts` | HQ Support's three queues read from HQ's own records (D204). **One definition of an open ticket** — `OPEN_TICKET_STATUSES` and `ticketBacklog`, which HQ Home's Queue backlog reads too — and `personaOf`, which sorts each open ticket by its requester's standing NOW: no account, a closed account, bound in `licence_admins` (the binding beats the role), HQ staff, else an HQ-held user. The licence kind is never read. Every read answers for itself: a failed one is `available: false` with its reason, a read past its ceiling is `complete: false` and its count is withheld rather than shown as the length of a cut list. The GET never runs the sync bootstrap. |
| `escalationConcerns.ts` | What a content escalation can name (D208): HQ's template library as pushed to the branch, and the branch's own newest hundred articles. **One label format**, `concernLabel`, builds both what the drawer lists and what the route stores and sends to HQ, so the two are the same bytes; a long title gives way before the slug does, and the whole fits the 300 characters both escalation tables keep. The list never throws — each source reads in its own try, and an unreadable one is its own state with its reason, never an empty list. A pick is read again at the raise (`resolveConcern`), never taken from the client, and one that no longer resolves is a typed refusal the route turns into a 400 or a 503 before HQ is called. A label names an item; it does not say the submission localises it, which is why HQ's Localised count stays unrecorded. |

## Subfolders

| Folder | What lives there |
| --- | --- |
| `advisor/` | The advisor state machine and its question banks. |
| `calendar/` | Calendar sync. |
| `decks/` | Deck assembly and export. |
| `email/` | Transactional mail. |
| `fills/` | "AI fills the blanks" — the fill-kind registry and the provenance of an accepted fill. A `sourced` fill carries a citation or it is dropped. |
| `market_intel/` | Sourcing, extraction and scoring for market intelligence. |
| `referrals/` | Referral submissions. |
| `signals/` | Signal ingestion and evidence. |
| `wellbeing/` | Wellbeing check-ins. |

## Rules

- No `Context`, no `Response`. If you need one, the code belongs in `routes/`.
- Never build SQL by interpolation. `check-sql-prepare` fails the build on a
  `${}` inside `DB.prepare(...)` unless it is a provably safe fragment, and
  every exception is written down in a baseline.
- Fail closed. A rate limiter or a scope that cannot decide must deny, not
  allow — both have been fixed here after doing the opposite.
