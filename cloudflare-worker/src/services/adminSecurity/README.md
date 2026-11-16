# services/adminSecurity

D4708 (#4708). The reads behind HQ › Security (`/admin/security`), moved out of
`routes/admin_security.ts` unchanged. The router keeps every gate, every
request parse and every act (sessions, support sessions, force re-auth,
branch sign-out, data-subject close); it calls `loadSecurityOverview` and
`loadGovernance` and sends what they return. Read
[D4708](../../../../documentation/architecture/decisions/D4708.md) first.

| File | What it owns |
| --- | --- |
| `overview.ts` | `/overview`'s payload, store by store (`readPart`, the security-events and DSR blocks, the KYC and Backup / DR absences, `sources[]`). |
| `aiSafety.ts` | The AI-safety block (`aiSafetyBlock`), what it cannot count, its window, and `GUARDRAILS_POINTER`, the field `/governance` serves instead of a second copy. |
| `governanceFeed.ts` | The ledger: the five stores' statements (complete literals), the filters, the merge (`feedOrder`, the stores' own order), the whole-second page, its continuation inside one second ([D4708-p2](../../../../documentation/architecture/decisions/D4708-p2.md)) and the reply (`loadGovernance`, `feedFilterOf`). |
| `feedQuery.ts` | The ledger's cursor and filters (`parseFeedQuery`), which stores a filtered read can hold, the binds, `trimToSecond`, and `skip` with its cap `FEED_SKIP_MAX`. |
| `feedFormat.ts` | How a stored row is worded: names, reasons, clipped text, minute stamps, a support session's outcome. |
| `dataAccess.ts` | Canvas H7's Data access zone: support sessions and exports, each half with its own availability. |
| `contract.ts` | The Worker's import of `frontend/src/lib/securityContract.js`, and `CONTRACT_HOLDS`, which fails the typecheck when a service's own status or outcome union drifts from it. |

## Rules for adding here

- A file here takes `env` and plain values, never a Hono `Context`; the gate stays in the router, first.
- Every `DB.prepare` is a complete literal; a value is bound, never interpolated.
- An unreadable store is `absent(reason)` from `./contract`, never a zero or an empty list.
- A new status, outcome or result word goes in `securityContract.js` and its `.d.ts` first.
