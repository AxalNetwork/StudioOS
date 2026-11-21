// D6129 (#6129, canvas D6126): the investor catalogue and default after Investor
// Studio home v2. A layout saved before this change (#6132's eight-key default,
// or one holding a key the registry no longer offers) still loads: every key
// still offered is kept in its order and size, and a retired one is named in
// `dropped`, never a failed read. Pure: `layoutView` over a synthetic row.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/investor_home_v2_d6129.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutView } from '../src/routes/studio_layout.ts';
import { STUDIO_DEFAULTS, STUDIO_MODULES, catalogueOf, lockOf } from '../src/services/studioModules.ts';

const PRO = { id: 2, role: 'investor', investor_tier: 'professional', investor_subscription_status: 'active' } as any;
const FREE = { id: 2, role: 'investor', investor_tier: 'free' } as any;
const OLD_DEFAULT = ['usage_quota', 'deal_lifecycle', 'quick_stats', 'portfolio_glance', 'upcoming_events', 'fund_commitment', 'needs_you'];
const row = (layout: unknown) => ({ layout: JSON.stringify(layout), updated_at: '2026-11-14 10:00:00', revision: 3, reset_at: null });

test('the five canvas modules are in the catalogue, on reads that exist, with the canvas titles', () => {
  const inv = new Map(catalogueOf('investor', PRO).map((m) => [m.key, m]));
  assert.deepEqual(['needs_you', 'fund_commitment', 'returns', 'thesis_fit', 'arrivals'].map((k) => inv.get(k)?.title), ['Needs you', 'Funds', 'Returns', 'Thesis fit on live deals', 'Arrivals']);
  assert.deepEqual(inv.get('returns')!.reads, ['/api/positions/analytics']);
  assert.deepEqual(inv.get('thesis_fit')!.reads, ['/api/deals/flow', '/api/deals/fit']);
  assert.ok(inv.get('needs_you')!.reads.includes('/api/notifications/unread-count'));
  assert.equal(inv.size, 10, 'five of today\'s after #6622 retired Historical match scores, #6132\'s two and three new');
  assert.ok(!inv.has('scored_opportunities'), 'Historical match scores is retired (#6622)');
  for (const k of ['quick_stats', 'portfolio_glance']) assert.ok(inv.has(k) && !STUDIO_DEFAULTS.investor.some((d) => d.key === k), `${k} stays placeable, off the default (owner pick A, Q1 and Q2)`);
});

test('the default is Needs you and Funds full width, then six halves, each at its module\'s own size', () => {
  assert.deepEqual(STUDIO_DEFAULTS.investor.map((d) => `${d.key} ${d.size}`), ['needs_you full', 'fund_commitment full', 'returns 1/2', 'thesis_fit 1/2', 'arrivals 1/2', 'upcoming_events 1/2', 'usage_quota 1/2', 'deal_lifecycle 1/2']);
  for (const d of STUDIO_DEFAULTS.investor) assert.equal(STUDIO_MODULES.find((m) => m.key === d.key)!.default_size, d.size);
});

test('Thesis fit is locked below Investor Pro, as its /api/deals reads are; the other new modules are not', () => {
  const mod = (k: string) => STUDIO_MODULES.find((m) => m.key === k)!;
  assert.equal(lockOf(FREE, mod('thesis_fit'))?.tier, 'professional');
  assert.equal(lockOf(PRO, mod('thesis_fit')), null);
  for (const k of ['needs_you', 'fund_commitment', 'returns', 'arrivals']) assert.equal(lockOf(FREE, mod(k)), null, k);
});

test('a layout saved under the old default still loads, in its order and sizes, with nothing dropped', () => {
  const saved = OLD_DEFAULT.map((key) => ({ key, size: '1/2' }));
  const v = layoutView(PRO, 'investor', row(saved));
  assert.equal(v.source, 'saved');
  assert.deepEqual(v.layout, saved);
  assert.deepEqual(v.dropped, []);
});

test('a saved layout holding a key the registry no longer offers loads the rest and names the removed one', () => {
  const saved = [{ key: 'needs_you', size: 'full' }, { key: 'founder_actions', size: '1/2' }, { key: 'retired_investor_tile', size: '1/2' }, { key: 'returns', size: '1/2' }];
  const v = layoutView(PRO, 'investor', row(saved));
  assert.deepEqual(v.layout, [{ key: 'needs_you', size: 'full' }, { key: 'returns', size: '1/2' }]);
  assert.deepEqual(v.dropped.map((d: any) => [d.key, d.title, d.reason]), [['founder_actions', 'Do these next', 'not_offered'], ['retired_investor_tile', null, 'not_offered']]);
  const free = layoutView(FREE, 'investor', row([{ key: 'thesis_fit', size: '1/2' }, { key: 'arrivals', size: '1/2' }]));
  assert.deepEqual(free.layout, [{ key: 'arrivals', size: '1/2' }]);
  assert.deepEqual(free.dropped.map((d: any) => [d.key, d.reason]), [['thesis_fit', 'plan']]);
});
