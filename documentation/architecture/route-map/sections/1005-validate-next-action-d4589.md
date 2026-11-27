### Validate next action, desktop and phone (#4589, part of #4584)

No new route. `GET /api/cycles/validate/overview`'s `focus` is now produced by
one pure policy, `cloudflare-worker/src/services/validateNextAction.ts`, over
the facts `services/validateFocus.ts` reads. It adds `secondary` (actions kept
in reach) and `state` (`ok`, or `unavailable` with no `cta` when a fact could
not be read) to the focus shape.

| Surface | Draws |
| --- | --- |
| `/validate` on a phone (`cycles/PhoneCycleRoot.jsx`) | The focus as One Next Thing, its secondary links under the CTA; no meter under a Stop or an unavailable step |
| `/validate` on desktop (`cycles/ValidateNextAction.jsx`, the overview's lead row) | The same focus through the same adapter (`validatePhone.js` `phoneFocus`), in VB2a's panel; the header's Record a session is unchanged |

Rules, in order: unavailable, first interview, (reader: the first card's next),
review, Stop, missing fit, unrecorded result, mixed evidence, decision ready,
Plan the build (the founder only, D1069's href), next conversation. The read
never records a decision. See D4589.
