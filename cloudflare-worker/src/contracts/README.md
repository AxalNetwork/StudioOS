# `contracts/`

D1511 (#3762, deck v2 A18). The reply shape of every deck v2 adapter method
whose route is on `main`, as JSON Schema. `test:drift` checks each route's
reply against its schema, not only that the route exists.

| File | What it is |
|---|---|
| `deckBatch.schema.json` | `GET /api/decks/areas/batches/:uid` and `POST …/cancel` (D1502, #3753): the run, its counts and each step's row as pd2b draws it. |
| `deckBrandLocks.schema.json` | `GET /api/decks/brand-kit/locks` (D1572, #3819): the brand kit's three locks, each with who locked it and when, whether this member may lock, and "Only the venture’s admins can lock." |
| `deckCardStatus.schema.json` | `GET /api/decks/:id/card-status` (D1579, #3826): each card's status and assignee under the filter, every card's count, the cards not Done, and who a card can be assigned to. |
| `deckComments.schema.json` | `GET /api/decks/:id/comments` (D1570, #3817): the venture's comment threads, who is reading, the people who can be mentioned and the open count. |
| `deckConsistency.schema.json` | `GET /api/decks/:id/check`'s `consistency` key (D1555, #3802): the free consistency rules' state and findings, or null for a reader who is not the founder. |
| `deckCritique.schema.json` | `POST /api/decks/:id/critique/quote` and `POST /api/decks/:id/critique` (D1552, #3799): the critique's quote (score, blocks to shorten, the vision check of another family than the writer's, the hold), or its run (scores, findings, fixes kept as proposals, what was fixed, what is left). |
| `deckDiscardDraft.schema.json` | `DELETE /api/decks/:id/draft` (D1501, #3751): ok, the deck and how many card copies were discarded. |
| `deckDraft.schema.json` | `GET /api/decks/:id/draft` (D1501, #3751): the version, its rev and each card's working copy. |
| `deckElementModels.schema.json` | `GET /api/decks/:id/element-models` (D1503, #3754): each routed element with its pick, the element groups and the free elements. |
| `deckElements.schema.json` | `GET /api/decks/elements` (D1541, #3779): the icon set's licence record, the decor cap, the shapes, dividers and textures with their sanitised SVG, and Generate (Coming later). |
| `deckFigures.schema.json` | `GET /api/decks/:id/figures` (D1523, #3775): every figure on the version with its state (Linked, Stated, Uncited, Not recorded) and source, and the counts. |
| `deckGrid.schema.json` | `GET /api/decks/:id/grid` (D1499, #3749): the geometry, the 17 structures and each card's areas with their boxes. |
| `deckImageVary.schema.json` | `POST /api/decks/images/:uid/edit/quote` (D1544, #3784): an image edit's model, its one hold for the edit and its checks, the references it sends, or why it cannot run. |
| `deckInvestorLinks.schema.json` | `GET /api/decks/:id/investor-links` (D1565, #3812): the deck, its version and its per-investor links. |
| `deckMarkSeen.schema.json` | `POST /api/decks/areas/batches/:uid/seen` (D1600, #3879): `{ ok: true }` when the return banner's Review is opened. |
| `deckModelPresets.schema.json` | `GET /api/decks/:id/model-presets` (D1549, #3796): the preset in force, the stored one, and per element group each preset's model, the resolved model and HQ's lock. |
| `deckMyTemplates.schema.json` | `GET /api/decks/templates/mine` (D1535, #3782): the caller's own templates. |
| `deckOrgLocks.schema.json` | The same reply's `locks` key (D1549; the adapter row is #3786's): each element group HQ locked, with "Set by Axal VC HQ". |
| `deckPresence.schema.json` | `GET /api/decks/:id/presence` (D1577, #3824): the deck and who is editing it now (user id, name, colour, card, area, cursor). |
| `deckRehearsals.schema.json` | `GET /api/decks/:id/rehearsals` (D1580 F1, #3827): the founder's own rehearsals of the version, newest first, each a summary. |
| `deckRemix.schema.json` | `POST /api/decks/:id/remix` (D1553, #3800): the card's structure, the card and its layout options. |
| `deckReorderForStage.schema.json` | `POST /api/decks/:id/reorder-for-stage` (D1561, #3808): the new version in the stage plan's order, the stage, how many cards moved and one undo step; or `unchanged` when nothing moved. |
| `deckReplaceImages.schema.json` | `POST /api/decks/:id/images/replace-all/quote` (D1561, #3808): every image area priced as one quote, the hold with one redraw each, the areas left out and why, or why it cannot run. |
| `deckRetryFailed.schema.json` | `POST /api/decks/areas/batches/:uid/retry-failed` (D1600, #3879): the new run of only the failed areas, the areas it retries and its quote. |
| `deckSaveAsTemplate.schema.json` | `POST /api/decks/:id/save-as-template` (D1535, #3782): the template a deck was saved as. |
| `deckSaveCard.schema.json` | `PATCH /api/decks/:id/cards/:uid` (D1501, #3751): the card's working copy with its new revision. |
| `deckSlideAnalytics.schema.json` | `GET /api/decks/:id/investor-links/:shareId/analytics` (D1573, #3820): one investor link's views, its Time per slide consent, seconds per card by uid, the most-read card and the visit timeline; missing is null, never 0. |
| `deckSource.schema.json` | `PUT /api/data-room/:projectUid/files/:uid/deck-source` (#3881): the public opt-in and extraction state, without internal job or billing fields. |
| `deckStagePlan.schema.json` | `GET /api/decks/:id/stage-plan` (D1522, #3774): the keys the route adds to `stagePlan()`'s plan. |
| `deckTemplateImport.schema.json` | `POST /api/decks/templates/import` (D1572, #3819): pd30's mapping report for a .pptx template: colours, fonts with their OFL stand-in, each layout on whole cells or with its reason, and the counts. |
| `deckTemplates.schema.json` | `GET /api/decks/templates` (D1535, #3782): HQ's Gallery templates, filtered, with New deck's seven audiences. |
| `deckTypedTables.schema.json` | `GET /api/decks/:id/typed-values` (D1538, #3787): the deck and the venture's typed figures, graded Stated. |
| `deckUnseenBatches.schema.json` | `GET /api/decks/:id/batches?state=done&unseen=1` (D1600, #3879): the finished runs nobody opened, newest first, at most five, each with its count of cards waiting. |
| `deckUsage.schema.json` | `GET /api/decks/:id/usage` (D1524, #3776): the deck's estimate, its spend from the ledger and the per-run unit prices; unread is `{ available: false }`, never 0. |
| `deckVentureElements.schema.json` | `GET /api/decks/:id/venture-elements` and `/venture-elements/:element` (D1543, #3781): every venture-record element placed or refused by its gate, or one placed element, with its blocks and bindings. |
| `deckWithdrawInvestorLink.schema.json` | `POST /api/decks/:id/investor-links/:shareId/withdraw` (D1565, #3812): ok and the withdrawn link. |

## Rule for adding here

When a `deckV2Adapter.js` method's body becomes `through(() => client.method(…))`,
the same PR adds `<surface>.schema.json` for the reply that method passes on
and one `CONTRACTS` entry. `cloudflare-worker/test/deck_contracts_d1511.test.ts`
fails until both exist, and fails when the route's reply leaves its schema.
