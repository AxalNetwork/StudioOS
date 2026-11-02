// D1524 (#3776, deck v2 A25) — the AIRail's plain usage meter: the adapter's
// `deckUsage` swap (dollars, null for a figure the Worker could not read), the
// rail rows (Estimated, Spent, the plain-units line), the balance from
// /api/ai-budget/me, and no action or prompt control in the usage rows.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_usage_d1524.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import { deckRail, plainUnits } from '../src/pages/raise/pitch/deckRailGroups.js';
import { deckUsageApi } from '../src/lib/api/deckUsage.js';
import { aiBudgetApi } from '../src/lib/api/aiBudget.js';

const read = (p) => readFileSync(p, 'utf8');
const ANSWER = {
  deck_id: 7, project_id: 1,
  estimated: { available: true, value_microusd: 350_000, lines: [] },
  spent: { available: true, value_microusd: 210_000, runs: 4 },
  units: { text_area_microusd: 105_000, image_microusd: 350_000 },
};

async function withStubs(usage, mine, fn) {
  const realU = deckUsageApi.usage; const realM = aiBudgetApi.mine;
  deckUsageApi.usage = usage; aiBudgetApi.mine = mine;
  try { return await fn(); } finally { deckUsageApi.usage = realU; aiBudgetApi.mine = realM; }
}
const rows = (deckId = 7) => Object.fromEntries(deckRail(deckId).usage.map((r) => [r.id, r]));

test('deckUsage: the Worker\'s estimate and spend in dollars; a figure it could not read is null, never $0.00', async () => {
  // Mutation checked: an unavailable spend formatted as $0.00 → the null assert fails.
  await withStubs(async () => ANSWER, async () => ({}), async () => {
    const r = await adapter.deckUsage(7);
    assert.deepEqual(r, { available: true, value: { estimated: '$0.35', spent: '$0.21', units: ANSWER.units } });
  });
  await withStubs(async () => ({ ...ANSWER, spent: { available: false, reason: 'Could not be read' } }), async () => ({}), async () => {
    assert.equal((await adapter.deckUsage(7)).value.spent, null);
    assert.deepEqual(await rows().spent.read(), { available: false, unreadable: true }, 'the row says "Could not be read"');
  });
  await withStubs(async () => { throw Object.assign(new Error('x'), { status: 404 }); }, async () => ({}), async () => {
    assert.equal((await adapter.deckUsage(7)).available, false, 'a route that answers 404 is still off');
  });
});

test('the rows: Estimated and Spent drawn from the route, and the balance in plain units from /api/ai-budget/me', async () => {
  // Mutation checked: plainUnits reading the plan allowance instead of balance_microusd → the "About 40" assert fails.
  await withStubs(async () => ANSWER, async () => ({ balance_microusd: 4_200_000, month_used_microusd: 3_100_000 }), async () => {
    const r = rows();
    assert.deepEqual(await r.estimated.read(), { available: true, value: '$0.35' });
    assert.deepEqual(await r.spent.read(), { available: true, value: '$0.21' });
    assert.deepEqual(await r.units.read(), { available: true, value: 'About 40 text areas or 12 images' });
  });
  assert.equal(plainUnits(4_200_000, { text_area_microusd: null, image_microusd: 350_000 }), null, 'an unpriced unit draws no line');
  assert.equal(plainUnits(null, ANSWER.units), null);
  assert.equal(plainUnits(0, ANSWER.units), 'About 0 text areas or 0 images', 'an empty balance is a recorded zero');
});

test('the rail renders no action or prompt control: the usage rows only read, and dollars, never credits', () => {
  // Mutation checked: an `action` / `onClick` on a usage row → the keys assert fails.
  for (const r of deckRail(7).usage) {
    assert.deepEqual(Object.keys(r).filter((k) => !['id', 'label', 'read', 'hideUnavailable'].includes(k)), [], `${r.id} has a control`);
  }
  const src = codeOnly(read('frontend/src/pages/raise/pitch/deckRailGroups.js'));
  assert.doesNotMatch(src, /credits?\b/i, 'never credits');
  assert.match(codeOnly(read('frontend/src/lib/api/deckUsage.js')), /request\(`\/decks\/\$\{encodeURIComponent\(deckId\)\}\/usage`\)/);
  assert.match(codeOnly(read('cloudflare-worker/src/index.ts')), /app\.route\(['"]\/api\/decks['"],\s*deckUsage\)/);
});
