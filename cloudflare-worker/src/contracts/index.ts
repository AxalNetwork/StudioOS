/**
 * D1511 (#3762, deck v2 A18) — the contract of every deck v2 adapter method
 * whose route is on `main`: the method, its route, and the schema of the reply
 * its `through()` swap expects (`frontend/src/pages/raise/pitch/deckV2Adapter.js`).
 *
 * A method joins here in the same PR that swaps its adapter body to
 * `through(…)`; `cloudflare-worker/test/deck_contracts_d1511.test.ts` fails
 * when a swapped method has no contract, or when a route's reply leaves its
 * schema, so an adapter swap changes no screen.
 */
/**
 * Each schema is a JSON file beside this one, named here and read by the
 * tests; the Worker itself never loads one, so no reply pays for a check.
 */
/**
 * One row per method, in key order (#4134). Two swaps that land together add
 * rows at different places instead of both appending to the end, so they no
 * longer conflict; `deck_contracts_d1511.test.ts` fails a row out of order.
 * Which decision added a row is in its issue, and in `git log -L` here.
 */
export const CONTRACTS = Object.freeze({
  batch: { issue: 3753, route: 'GET /api/decks/areas/batches/:uid', schema: 'deckBatch.schema.json' },
  cancelBatch: { issue: 3753, route: 'POST /api/decks/areas/batches/:uid/cancel', schema: 'deckBatch.schema.json' },
  comments: { issue: 3817, route: 'GET /api/decks/:id/comments', schema: 'deckComments.schema.json' },
  consistency: { issue: 3802, route: 'GET /api/decks/:id/check (its consistency key)', schema: 'deckConsistency.schema.json' },
  discardDraft: { issue: 3751, route: 'DELETE /api/decks/:id/draft', schema: 'deckDiscardDraft.schema.json' },
  draft: { issue: 3751, route: 'GET /api/decks/:id/draft', schema: 'deckDraft.schema.json' },
  elementModels: { issue: 3754, route: 'GET /api/decks/:id/element-models', schema: 'deckElementModels.schema.json' },
  // D1541 (#3779): the elements library.
  elementsLibrary: { issue: 3779, route: 'GET /api/decks/elements', schema: 'deckElements.schema.json' },
  figures: { issue: 3775, route: 'GET /api/decks/:id/figures', schema: 'deckFigures.schema.json' },
  grid: { issue: 3749, route: 'GET /api/decks/:id/grid', schema: 'deckGrid.schema.json' },
  investorLinks: { issue: 3812, route: 'GET /api/decks/:id/investor-links', schema: 'deckInvestorLinks.schema.json' },
  myTemplates: { issue: 3782, route: 'GET /api/decks/templates/mine', schema: 'deckMyTemplates.schema.json' },
  orgLocks: { issue: 3786, route: 'GET /api/decks/:id/model-presets (its locks key)', schema: 'deckOrgLocks.schema.json' },
  presence: { issue: 3824, route: 'GET /api/decks/:id/presence', schema: 'deckPresence.schema.json' },
  presets: { issue: 3796, route: 'GET /api/decks/:id/model-presets', schema: 'deckModelPresets.schema.json' },
  remix: { issue: 3800, route: 'POST /api/decks/:id/remix', schema: 'deckRemix.schema.json' },
  saveAsTemplate: { issue: 3782, route: 'POST /api/decks/:id/save-as-template', schema: 'deckSaveAsTemplate.schema.json' },
  saveCard: { issue: 3751, route: 'PATCH /api/decks/:id/cards/:uid', schema: 'deckSaveCard.schema.json' },
  setDeckSource: { issue: 3881, route: 'PUT /api/data-room/:projectUid/files/:uid/deck-source', schema: 'deckSource.schema.json' },
  stagePlan: { issue: 3774, route: 'GET /api/decks/:id/stage-plan', schema: 'deckStagePlan.schema.json' },
  templates: { issue: 3782, route: 'GET /api/decks/templates', schema: 'deckTemplates.schema.json' },
  typedTables: { issue: 3787, route: 'GET /api/decks/:id/typed-values', schema: 'deckTypedTables.schema.json' },
  ventureElements: { issue: 3781, route: 'GET /api/decks/:id/venture-elements(/:element)', schema: 'deckVentureElements.schema.json' },
  withdrawInvestorLink: { issue: 3812, route: 'POST /api/decks/:id/investor-links/:shareId/withdraw', schema: 'deckWithdrawInvestorLink.schema.json' },
});

export type ContractMethod = keyof typeof CONTRACTS;
