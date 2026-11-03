# `contracts/`

D1511 (#3762, deck v2 A18). The reply shape of every deck v2 adapter method
whose route is on `main`, as JSON Schema. `test:drift` checks each route's
reply against its schema, not only that the route exists.

| File | What it is |
|---|---|
| `deckBrandLocks.schema.json` | `GET /api/decks/brand-kit/locks` (D1572, #3819): the brand kit's three locks, each with who locked it and when, whether this member may lock, and "Only the venture’s admins can lock." |
| `deckAreasProposals.schema.json` | `GET /api/decks/:id/areas/proposals?batch=` (D1512, #3764): the run's charged-of-held, whether every area settled, and each area's proposal with its variants (model, seed, cost, seconds, error, critique). |
| `deckAreasQuote.schema.json` | `POST /api/decks/:id/areas/quote` (D1512, #3764): per-area lines that sum to the area's hold, each row's gates and refusal, the total hold and its expiry. |
| `deckCardStatus.schema.json` | `GET /api/decks/:id/card-status` (D1579, #3826): each card's status and assignee under the filter, every card's count, the cards not Done, and who a card can be assigned to. |
| `deckBatch.schema.json` | `GET /api/decks/areas/batches/:uid` and `POST …/cancel` (D1502, #3753): the run, its counts and each step's row as pd2b draws it. |
| `deckCritique.schema.json` | `POST /api/decks/:id/critique/quote` and `POST /api/decks/:id/critique` (D1552, #3799): the critique's quote (score, blocks to shorten, the vision check of another family than the writer's, the hold), or its run (scores, findings, fixes kept as proposals, what was fixed, what is left). |
| `deckComments.schema.json` | `GET /api/decks/:id/comments` (D1570, #3817): the venture's comment threads, who is reading, the people who can be mentioned and the open count. |
| `deckConsistency.schema.json` | `GET /api/decks/:id/check`'s `consistency` key (D1555, #3802): the free consistency rules' state and findings, or null for a reader who is not the founder. |
| `deckDiscardDraft.schema.json` | `DELETE /api/decks/:id/draft` (D1501, #3751): ok, the deck and how many card copies were discarded. |
| `deckDraft.schema.json` | `GET /api/decks/:id/draft` (D1501, #3751): the version, its rev and each card's working copy. |
| `deckElementModels.schema.json` | `GET /api/decks/:id/element-models` (D1503, #3754): each routed element with its pick, the element groups and the free elements. |
| `deckElements.schema.json` | `GET /api/decks/elements` (D1541, #3779): the icon set's licence record, the decor cap, the shapes, dividers and textures with their sanitised SVG, and Generate (Coming later). |
| `deckFigures.schema.json` | `GET /api/decks/:id/figures` (D1523, #3775): every figure on the version with its state (Linked, Stated, Uncited, Not recorded) and source, and the counts. |
| `deckGrid.schema.json` | `GET /api/decks/:id/grid` (D1499, #3749): the geometry, the 17 structures and each card's areas with their boxes. |
| `deckImageTools.schema.json` | `GET /api/decks/images/tools` (D1534, #3778 phase 2): the AI image tools (background removal through AI Gateway, Upscale with no model), each with whether it can run, its model, its per-image price and why not. |
| `deckImageVary.schema.json` | `POST /api/decks/images/:uid/edit/quote` (D1544, #3784): an image edit's model, its one hold for the edit and its checks, the references it sends, or why it cannot run. |
| `deckInstruct.schema.json` | `POST /api/decks/:id/areas/instruct/quote` and `POST /api/decks/:id/areas/instruct` (D1521, #3773): an instruction on at most six areas of one card, quoted as #3764's areas quote, or its one run: the batch, replay, the selection, what was asked and one proposal per area. |
| `deckInvestorLinks.schema.json` | `GET /api/decks/:id/investor-links` (D1565, #3812): the deck, its version and its per-investor links. |
| `deckJudge.schema.json` | `POST /api/decks/areas/:uid/judge/quote` and `POST /api/decks/areas/:uid/judge` (D1525, #3783): the judge's input-only hold and family, or its blind ranking of an area's variants (rank, probability, "Ranked n of m"), the score AUTO-5 reads and the panel's agreement. |
| `deckMarkSeen.schema.json` | `POST /api/decks/areas/batches/:uid/seen` (D1600, #3879): `{ ok: true }` when the return banner's Review is opened. |
| `deckRehearsals.schema.json` | `GET /api/decks/:id/rehearsals` (D1580 F1, #3827): the founder's own rehearsals of the version, newest first, each a summary. |
| `deckMyTemplates.schema.json` | `GET /api/decks/templates/mine` (D1535, #3782): the caller's own templates. |
| `deckPresence.schema.json` | `GET /api/decks/:id/presence` (D1577, #3824): the deck and who is editing it now (user id, name, colour, card, area, cursor). |
| `deckRemix.schema.json` | `POST /api/decks/:id/remix` (D1553, #3800): the card's structure, the card and its layout options. |
| `deckRetryFailed.schema.json` | `POST /api/decks/areas/batches/:uid/retry-failed` (D1600, #3879): the new run of only the failed areas, the areas it retries and its quote. |
| `deckReorderForStage.schema.json` | `POST /api/decks/:id/reorder-for-stage` (D1561, #3808): the new version in the stage plan's order, the stage, how many cards moved and one undo step; or `unchanged` when nothing moved. |
| `deckReplaceImages.schema.json` | `POST /api/decks/:id/images/replace-all/quote` (D1561, #3808): every image area priced as one quote, the hold with one redraw each, the areas left out and why, or why it cannot run. |
| `deckSource.schema.json` | `PUT /api/data-room/:projectUid/files/:uid/deck-source` (#3881): the public opt-in and extraction state, without internal job or billing fields. |
| `deckSaveCard.schema.json` | `PATCH /api/decks/:id/cards/:uid` (D1501, #3751): the card's working copy with its new revision. |
| `deckSaveAsTemplate.schema.json` | `POST /api/decks/:id/save-as-template` (D1535, #3782): the template a deck was saved as. |
| `deckSlideAnalytics.schema.json` | `GET /api/decks/:id/investor-links/:shareId/analytics` (D1573, #3820): one investor link's views, its Time per slide consent, seconds per card by uid, the most-read card and the visit timeline; missing is null, never 0. |
| `deckStagePlan.schema.json` | `GET /api/decks/:id/stage-plan` (D1522, #3774): the keys the route adds to `stagePlan()`'s plan. |
| `deckUnseenBatches.schema.json` | `GET /api/decks/:id/batches?state=done&unseen=1` (D1600, #3879): the finished runs nobody opened, newest first, at most five, each with its count of cards waiting. |
| `deckUsage.schema.json` | `GET /api/decks/:id/usage` (D1524, #3776): the deck's estimate, its spend from the ledger and the per-run unit prices; unread is `{ available: false }`, never 0. |
| `deckTemplateImport.schema.json` | `POST /api/decks/templates/import` (D1572, #3819): pd30's mapping report for a .pptx template: colours, fonts with their OFL stand-in, each layout on whole cells or with its reason, and the counts. |
| `deckTemplates.schema.json` | `GET /api/decks/templates` (D1535, #3782): HQ's Gallery templates, filtered, with New deck's seven audiences. |
| `deckVentureElements.schema.json` | `GET /api/decks/:id/venture-elements` and `/venture-elements/:element` (D1543, #3781): every venture-record element placed or refused by its gate, or one placed element, with its blocks and bindings. |
| `deckTypedTables.schema.json` | `GET /api/decks/:id/typed-values` (D1538, #3787): the deck and the venture's typed figures, graded Stated. |
| `deckWithdrawInvestorLink.schema.json` | `POST /api/decks/:id/investor-links/:shareId/withdraw` (D1565, #3812): ok and the withdrawn link. |
| `index.ts` | `CONTRACTS`: each adapter method with a route, its issue, its route and its schema file. The tests read the schemas; the Worker never loads one. |
| `validate.ts` | `contractErrors`, the subset of JSON Schema the contracts use. A keyword it does not check is an error, never skipped. |
| `deckModelPresets.schema.json` | `GET /api/decks/:id/model-presets` (D1549, #3796): the preset in force, the stored one, and per element group each preset's model, the resolved model and HQ's lock. |
| `deckNarrativeOutline.schema.json` | `POST /api/decks/narrative/outline` and `POST /api/decks/narrative/build` (D1516, #3768): the outline from the narrative (its version, the stage's cards with their grid plan, the cards left out, the theme and template picked, the `deck_build` quote), or the build (the version, not current, bound to its narrative version; the one run, its hold and its proposals). |
| `deckOrgLocks.schema.json` | The same reply's `locks` key (D1549; the adapter row is #3786's): each element group HQ locked, with "Set by Axal VC HQ". |
| `deckDiagramCheck.schema.json` | `POST /api/decks/:id/diagrams/check` (D1542, #3780): an edited diagram as it would be saved, whether it fits its area, each fit problem, the numbers its labels name and the steps the area holds. |

## Rule for adding here

When a `deckV2Adapter.js` method's body becomes `through(() => client.method(…))`,
the same PR adds `<surface>.schema.json` for the reply that method passes on
and one `CONTRACTS` entry. `cloudflare-worker/test/deck_contracts_d1511.test.ts`
fails until both exist, and fails when the route's reply leaves its schema.
