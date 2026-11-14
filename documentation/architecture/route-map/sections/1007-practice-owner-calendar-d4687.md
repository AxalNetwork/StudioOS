## Practice › owner calendar order (D4687, #4687)

`routes/advisors.ts` only. No route is added; one is reordered.

| Route | Who | What it answers |
| --- | --- | --- |
| `GET /api/advisors/me/slots` (changed) | the advisor | The owner's calendar (`items` with `recording_state`, `payment_state`, `blocked_reason`, and `window`). It is now registered before `GET /api/advisors/:uid/slots`, so it is no longer taken by that route with uid `me` and answered 404 "Advisor not found". |
| `GET /api/advisors/:uid/slots` | any signed-in user | Unchanged: the public, lean slot list for one advisor. |
