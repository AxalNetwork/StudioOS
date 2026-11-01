# `contracts/`

D1511 (#3762, deck v2 A18). The reply shape of every deck v2 adapter method
whose route is on `main`, as JSON Schema. `test:drift` checks each route's
reply against its schema, not only that the route exists.

| File | What it is |
|---|---|
| `deckElementModels.schema.json` | `GET /api/decks/:id/element-models` (D1503, #3754): each routed element with its pick, the element groups and the free elements. |
| `deckGrid.schema.json` | `GET /api/decks/:id/grid` (D1499, #3749): the geometry, the 17 structures and each card's areas with their boxes. |
| `deckInvestorLinks.schema.json` | `GET /api/decks/:id/investor-links` (D1565, #3812): the deck, its version and its per-investor links. |
| `deckRemix.schema.json` | `POST /api/decks/:id/remix` (D1553, #3800): the card's structure, the card and its layout options. |
| `deckStagePlan.schema.json` | `GET /api/decks/:id/stage-plan` (D1522, #3774): the keys the route adds to `stagePlan()`'s plan. |
| `deckWithdrawInvestorLink.schema.json` | `POST /api/decks/:id/investor-links/:shareId/withdraw` (D1565, #3812): ok and the withdrawn link. |
| `index.ts` | `CONTRACTS`: each adapter method with a route, its issue, its route and its schema file. The tests read the schemas; the Worker never loads one. |
| `validate.ts` | `contractErrors`, the subset of JSON Schema the contracts use. A keyword it does not check is an error, never skipped. |

## Rule for adding here

When a `deckV2Adapter.js` method's body becomes `through(() => client.method(…))`,
the same PR adds `<surface>.schema.json` for the reply that method passes on
and one `CONTRACTS` entry. `cloudflare-worker/test/deck_contracts_d1511.test.ts`
fails until both exist, and fails when the route's reply leaves its schema.

| File | What it is |
|---|---|
| `deckSource.schema.json` | #3881: the public opt-in/extraction state, without internal job or billing fields. |
| `deckTypedValues.schema.json` | D1538: typed figures, including numeric/text values and erased authors. |
| `deckConsistency.schema.json` | D1555: the adapter passes the check reply’s consistency field; null for non-founders. |
