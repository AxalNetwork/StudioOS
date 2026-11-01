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
});

export type ContractMethod = keyof typeof CONTRACTS;
