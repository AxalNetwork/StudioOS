# `contracts/`

D1511 (#3762, deck v2 A18). The reply shape of every deck v2 adapter method
whose route is on `main`, as JSON Schema. `test:drift` checks each route's
reply against its schema, not only that the route exists.

| File | What it is |
|---|---|
| `deckComments.schema.json` | `GET /api/decks/:id/comments` (D1570, #3817): the venture's comment threads, who is reading, the people who can be mentioned and the open count. |
| `deckConsistency.schema.json` | `GET /api/decks/:id/check`'s `consistency` key (D1555, #3802): the free consistency rules' state and findings, or null for a reader who is not the founder. |
| `deckDiscardDraft.schema.json` | `DELETE /api/decks/:id/draft` (D1501, #3751): ok, the deck and how many card copies were discarded. |
| `deckDraft.schema.json` | `GET /api/decks/:id/draft` (D1501, #3751): the version, its rev and each card's working copy. |
| `deckElementModels.schema.json` | `GET /api/decks/:id/element-models` (D1503, #3754): each routed element with its pick, the element groups and the free elements. |
| `deckFigures.schema.json` | `GET /api/decks/:id/figures` (D1523, #3775): every figure on the version with its state (Linked, Stated, Uncited, Not recorded) and source, and the counts. |
| `deckGrid.schema.json` | `GET /api/decks/:id/grid` (D1499, #3749): the geometry, the 17 structures and each card's areas with their boxes. |
| `deckInvestorLinks.schema.json` | `GET /api/decks/:id/investor-links` (D1565, #3812): the deck, its version and its per-investor links. |
| `deckMyTemplates.schema.json` | `GET /api/decks/templates/mine` (D1535, #3782): the caller's own templates. |
| `deckRemix.schema.json` | `POST /api/decks/:id/remix` (D1553, #3800): the card's structure, the card and its layout options. |
| `deckSaveAsTemplate.schema.json` | `POST /api/decks/:id/save-as-template` (D1535, #3782): the template a deck was saved as. |
| `deckStagePlan.schema.json` | `GET /api/decks/:id/stage-plan` (D1522, #3774): the keys the route adds to `stagePlan()`'s plan. |
| `deckTemplates.schema.json` | `GET /api/decks/templates` (D1535, #3782): HQ's Gallery templates, filtered, with New deck's seven audiences. |
| `deckSaveCard.schema.json` | `PATCH /api/decks/:id/cards/:uid` (D1501, #3751): the card's working copy with its new revision. |
| `deckTypedTables.schema.json` | `GET /api/decks/:id/typed-values` (D1538, #3787): the deck and the venture's typed figures, graded Stated. |
| `deckWithdrawInvestorLink.schema.json` | `POST /api/decks/:id/investor-links/:shareId/withdraw` (D1565, #3812): ok and the withdrawn link. |
| `index.ts` | `CONTRACTS`: each adapter method with a route, its issue, its route and its schema file. The tests read the schemas; the Worker never loads one. |
| `validate.ts` | `contractErrors`, the subset of JSON Schema the contracts use. A keyword it does not check is an error, never skipped. |
| `deckModelPresets.schema.json` | `GET /api/decks/:id/model-presets` (D1549, #3796): the preset in force, the stored one, and per element group each preset's model, the resolved model and HQ's lock. |
| `deckOrgLocks.schema.json` | The same reply's `locks` key (D1549; the adapter row is #3786's): each element group HQ locked, with "Set by Axal VC HQ". |

## Rule for adding here

When a `deckV2Adapter.js` method's body becomes `through(() => client.method(…))`,
the same PR adds `<surface>.schema.json` for the reply that method passes on
and one `CONTRACTS` entry. `cloudflare-worker/test/deck_contracts_d1511.test.ts`
fails until both exist, and fails when the route's reply leaves its schema.
