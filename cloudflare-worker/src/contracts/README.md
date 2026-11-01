# cloudflare-worker/src/contracts — the replies the v2 adapter swaps on

One JSON Schema (2020-12) per `deckV2Adapter.js` `SWAPPED` method: the reply
its route answers, which the method's `through(() => client.method(…))`
hands to the screen (D1511, #3762). The schema is the contract that lets an
adapter swap change no screen.

| File | Method | Route | Issue |
| --- | --- | --- | --- |
| `deckGrid.schema.json` | `grid` | `GET /api/decks/:id/grid` (`cloudflare-worker/src/routes/deck_grid.ts`, D1499; `?aspect=` adds `reflow` and `reflow_map`, D1554) | #3749 |
| `deckStagePlan.schema.json` | `stagePlan` | `GET /api/decks/:id/stage-plan` (`cloudflare-worker/src/routes/deck_stage.ts`, D1522) | #3774 |
| `deckConsistency.schema.json` | `consistency` | the `consistency` part of `GET /api/decks/:id/check` (`cloudflare-worker/src/routes/deck_check.ts`, D1555); `x-reads` names the part, null for a reader who is not the founder | #3802 |
| `deckElementModels.schema.json` | `elementModels` | `GET /api/decks/:id/element-models` (`cloudflare-worker/src/routes/deck_element_models.ts`, D1503) | #3754 |
| `deckInvestorLinks.schema.json` | `investorLinks` | `GET /api/decks/:id/investor-links` (`cloudflare-worker/src/routes/deck_investor_links.ts`, D1565) | #3812 |
| `deckWithdrawInvestorLink.schema.json` | `withdrawInvestorLink` | `POST /api/decks/:id/investor-links/:shareId/withdraw` (same route file). Its `$defs.link` is the list's, and the test holds the two equal | #3812 |
| `deckRemix.schema.json` | `remix` | `POST /api/decks/:id/remix` (`cloudflare-worker/src/routes/deck_remix.ts`, D1553). Its `card`s are the slide model a save keeps; the schema holds what the remix screen reads (blocks on whole cells) | #3800 |

## Rules

- **One schema per swapped method, and none for a method that is not swapped.**
  `cloudflare-worker/test/contracts_d1511.test.ts` reads `SWAPPED` from
  `frontend/src/pages/raise/pitch/deckV2Adapter.js` and fails on a swap with no
  schema here, or a schema here with no swap.
- **Tag it.** `x-adapter` is the method's name, `x-issue` its `SURFACES` row's
  issue, `x-route` the route it answers. The test holds all three.
- **Closed objects.** Every object says `additionalProperties: false`, so a
  field added or dropped on either side fails `npm run test:drift` until this
  file says so. Change the schema in the same PR as the route.
- **Only what the validator checks.** The schemas are read by
  `cloudflare-worker/test/_json_schema.mjs`, which throws on any keyword it
  does not support rather than skip it.
- Nothing here is imported by the Worker at runtime; the files ship no code.
