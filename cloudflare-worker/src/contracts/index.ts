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
export const CONTRACTS = Object.freeze({
  grid: { issue: 3749, route: 'GET /api/decks/:id/grid', schema: 'deckGrid.schema.json' },
  // The five swaps that reached main before this file did (D1503, D1522, D1553, D1565).
  elementModels: { issue: 3754, route: 'GET /api/decks/:id/element-models', schema: 'deckElementModels.schema.json' },
  stagePlan: { issue: 3774, route: 'GET /api/decks/:id/stage-plan', schema: 'deckStagePlan.schema.json' },
  remix: { issue: 3800, route: 'POST /api/decks/:id/remix', schema: 'deckRemix.schema.json' },
  investorLinks: { issue: 3812, route: 'GET /api/decks/:id/investor-links', schema: 'deckInvestorLinks.schema.json' },
  withdrawInvestorLink: { issue: 3812, route: 'POST /api/decks/:id/investor-links/:shareId/withdraw', schema: 'deckWithdrawInvestorLink.schema.json' },
  // The two swaps that merged beside this file's own PR (D1538, D1555).
  typedTables: { issue: 3787, route: 'GET /api/decks/:id/typed-values', schema: 'deckTypedTables.schema.json' },
  consistency: { issue: 3802, route: 'GET /api/decks/:id/check (its consistency key)', schema: 'deckConsistency.schema.json' },
  // D1549 (#3796): the deck's preset, and HQ's locks from the same reply (the orgLocks row keeps #3786, B10's issue).
  presets: { issue: 3796, route: 'GET /api/decks/:id/model-presets', schema: 'deckModelPresets.schema.json' },
  orgLocks: { issue: 3786, route: 'GET /api/decks/:id/model-presets (its locks key)', schema: 'deckOrgLocks.schema.json' },
});

export type ContractMethod = keyof typeof CONTRACTS;
