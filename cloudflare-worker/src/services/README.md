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

## Subfolders

| Folder | What lives there |
| --- | --- |
| `advisor/` | The advisor state machine and its question banks. |
| `calendar/` | Calendar sync. |
| `decks/` | Deck assembly and export. |
| `email/` | Transactional mail. |
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
