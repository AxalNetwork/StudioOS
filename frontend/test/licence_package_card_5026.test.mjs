/** #5026 part 2 (board L35): the studio's read-only "Your Axal VC package" card, its model and its states. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import PackageCard, { packageCardModel } from '../src/pages/subsidiary/licence/PackageCard.jsx';

const h = React.createElement;
// Synthetic package term with fixed dates (no clock is read).
const term = {
  package_key: 'venture_building', package_name: 'Synthetic Venture Package', package_version: 2,
  starts_on: '2026-12-01', ends_on: '2027-11-30', state: 'active',
  programs: ['spinout-lab', 'product-testing'], annual_fee_cents: 0, currency: 'EUR',
};
const read = (value) => ({ value, error: null });
const rowsOf = (m) => Object.fromEntries(m.rows);

test('a package reads its frozen programs, standalone extras, a real zero price and the next term', () => {
  const m = packageCardModel(read({ source: 'hq', recorded: true, current: term, next: { ...term, package_version: 3, starts_on: '2027-12-01' }, standalone: ['perks'] }));
  assert.equal(m.kind, 'package');
  const r = rowsOf(m);
  assert.equal(r.Package, 'Synthetic Venture Package · v2');
  assert.match(r['Included programs'], /Spin-Out Lab/);
  assert.match(r['Standalone extras'], /Perks/);
  assert.match(r['Annual price'], /0/, 'an accepted zero is a price, not a missing value');
  assert.notEqual(r['Annual price'], null);
  assert.equal(r.Effective, '1 Dec 2026 – 30 Nov 2027');
  assert.equal(r.Status, 'Active');
  assert.equal(r['Next term'], 'Synthetic Venture Package · v3 from 1 Dec 2027');
});

test('an unrecorded price is Not recorded, an empty standalone list is None and an unread one is Not recorded', () => {
  const r = rowsOf(packageCardModel(read({ recorded: true, source: 'hq', current: { ...term, annual_fee_cents: null }, next: null, standalone: [] })));
  assert.equal(r['Annual price'], null);
  assert.equal(r['Standalone extras'], 'None');
  assert.match(r['Next term'], /None accepted yet · this term ends 30 Nov 2027/);
  assert.equal(rowsOf(packageCardModel(read({ recorded: true, source: 'hq', current: term, standalone: null })))['Standalone extras'], null);
});

test('no package is never no programs; a branch copy is Not recorded; a failed read is unreadable; no licence draws nothing', () => {
  const withExtras = packageCardModel(read({ recorded: true, source: 'hq', current: null, standalone: ['perks', 'learning'] }));
  assert.equal(withExtras.kind, 'none');
  assert.match(withExtras.line, /standalone grants: Perks, Learning\. No package does not mean no programs/);
  const bare = packageCardModel(read({ recorded: true, source: 'hq', current: null, standalone: [] }));
  assert.match(bare.line, /No package does not mean no programs/);
  const branch = packageCardModel(read({ recorded: false, source: 'copy', current: null, reason: 'Branch reason' }));
  assert.deepEqual(branch, { kind: 'not_recorded', reason: 'Branch reason' });
  assert.equal(packageCardModel(read({ recorded: true, source: 'copy', current: term })).kind, 'not_recorded', 'a copy is never read as a package');
  assert.equal(packageCardModel({ value: null, error: { status: 503 } }).kind, 'unreadable');
  assert.equal(packageCardModel({ value: null, error: { status: 404 } }).kind, 'none_linked');
  assert.equal(packageCardModel({ value: undefined, error: null }).kind, 'loading');
});

test('the card renders the package, says Unavailable with Retry on a failed read, and retries the same read', async () => {
  let calls = 0; let fail = true;
  const api = { mine: async () => { calls += 1; if (fail) throw Object.assign(new Error('private raw'), { status: 503 }); return { recorded: true, source: 'hq', current: term, next: null, standalone: ['perks'] }; } };
  const m = await mountContracts(h(PackageCard, { api }), '/admin/my-licence/summary');
  try {
    await m.flush();
    assert.match(m.text(), /Your Axal VC package/);
    assert.match(m.text(), /Unavailable/);
    assert.match(m.text(), /not the same as no package/);
    assert.doesNotMatch(m.text(), /private raw|No Axal VC package recorded/);
    fail = false;
    const retry = m.nodes().find((n) => n.tagName === 'BUTTON' && /Retry/.test(n.textContent || (n.childNodes || []).map((c) => c.textContent || '').join('')));
    assert.ok(retry, 'a Retry button');
    await m.props(retry).onClick({ stopPropagation() {} });
    await m.flush();
    assert.equal(calls, 2);
    assert.match(m.text(), /Synthetic Venture Package · v2/);
    assert.match(m.text(), /Read-only/);
    assert.doesNotMatch(m.text(), /recommend|override|country index|snapshot/i, 'no HQ model internals');
  } finally { await m.unmount(); }
});

test('an account no licence binds draws no package card at all, not an unreadable one', async () => {
  const api = { mine: async () => { throw Object.assign(new Error('no licence'), { status: 404 }); } };
  const m = await mountContracts(h(PackageCard, { api }), '/admin/my-licence/summary');
  try {
    await m.flush();
    assert.doesNotMatch(m.text(), /Your Axal VC package|Unavailable/);
  } finally { await m.unmount(); }
});

test('the Summary tab mounts the card and every light surface in it has its dark pair', () => {
  const summary = readFileSync(new URL('../src/pages/subsidiary/LicenceSummary.jsx', import.meta.url), 'utf8');
  assert.match(summary, /<PackageCard \/>/);
  const src = readFileSync(new URL('../src/pages/subsidiary/licence/PackageCard.jsx', import.meta.url), 'utf8');
  for (const cls of src.match(/\b(bg-white|text-gray-900|border-gray-200)\b/g) || []) {
    assert.ok(src.includes(`dark:${cls === 'bg-white' ? 'bg-gray-900' : cls === 'text-gray-900' ? 'text-gray-100' : 'border-gray-800'}`), cls);
  }
});
