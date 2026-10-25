/**
 * D1125 (#3005) — Advisors & Partners gaps, on the page: the header tabs'
 * counts (AP1), the paused-studio notice (AP12b) and a linked deck card's
 * account fields (AP8b). Each mounted on a stubbed fetch, with a failed read.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_ap_gaps_d1125.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import AdvisorsPartners from '../src/pages/admin/advisors/AdvisorsPartners.jsx';
import { CardDialog } from '../src/pages/admin/advisors/DeckRosterDialogs.jsx';
import { PAUSED, PAUSE_EVENTS, tabCountOf } from '../src/pages/admin/advisors/apModel.js';
import { accountFacts, cardOf } from '../src/pages/admin/advisors/deckRosterModel.js';

const ok = (value) => ({ available: true, recorded: true, value });
const down = (reason) => ({ available: false, reason });
const TABS = { overview: ok(4), people: ok(82), firms: ok(17), deck: ok(12), unreadable: [] };
const text = (n) => (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');

// ---------------------------------------------------------------- the model

test('a tab count is a number, a dash that says why, or the reading bar — never a zero for a count nobody read', () => {
  assert.deepEqual(tabCountOf({ status: 'loading' }, 'firms'), { kind: 'load' });
  assert.deepEqual(tabCountOf({ status: 'ready', data: TABS }, 'people'), { kind: 'num', value: '82' });
  assert.deepEqual(tabCountOf({ status: 'ready', data: { ...TABS, firms: ok(0) } }, 'firms'), { kind: 'num', value: '0' }, 'a read zero is a zero');
  assert.deepEqual(tabCountOf({ status: 'ready', data: { ...TABS, firms: down('firms could not be read. Try again.') } }, 'firms'), { kind: 'dash', tip: 'firms could not be read. Try again.' });
  assert.equal(tabCountOf({ status: 'error' }, 'deck').kind, 'dash');
  assert.equal(tabCountOf({ status: 'ready', data: {} }, 'deck').kind, 'dash', 'a count missing from the answer is not a zero');
});

test('AP8b: a linked card\'s account facts, read only, each one said when the account does not hold it', () => {
  assert.equal(accountFacts(null), null);
  assert.equal(accountFacts({ id: 2, name: 'Pat' }), null, 'a read without the account\'s columns draws nothing');
  const facts = accountFacts({ id: 2, account: { name: 'Pat P.', headline: null, company: 'Sample Ventures', has_photo: false } });
  assert.deepEqual(facts.map((f) => [f.key, f.text]), [['name', 'Pat P.'], ['headline', 'Not recorded on the account'], ['company', 'Sample Ventures'], ['photo', 'None on the account']]);
  assert.equal(accountFacts({ account: { has_photo: null } }).at(-1).text, 'Not recorded on the account');
  assert.deepEqual(cardOf({ id: 3, name: 'Card', linked_user: { id: 2, name: 'Pat', account: { name: 'Pat P.' } } }).linked_user.account, { name: 'Pat P.' }, 'the dialog form keeps the account');
});

test('AP12b says what is true here: reading is not paused, changes wait', () => {
  assert.match(PAUSED.title, /HQ has paused this studio’s admin access/);
  assert.match(PAUSED.line, /still read everything here/);
  assert.doesNotMatch(PAUSED.line, /No data is drawn/, 'reads are never gated (D107, D142), so the canvas line would be false');
  assert.deepEqual(PAUSE_EVENTS, ['studioos:admin_frozen', 'studioos:branch_suspended'], 'the two events lib/api.js dispatches on a 423');
  assert.match(readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8'), /studioos:admin_frozen[\s\S]*studioos:branch_suspended/);
});

// ---------------------------------------------------------------- mounted

async function page(url, { tabs = TABS, fail = [] } = {}) {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u) => {
    const p = new URL(String(u), 'http://x').pathname;
    calls.push(p);
    if (p === '/api/admin/network/tabs') return fail.includes('tabs') ? Response.json({ detail: 'down' }, { status: 503 }) : Response.json(tabs);
    return Response.json({});
  };
  const m = await mountContracts(React.createElement(AdvisorsPartners), url);
  for (let i = 0; i < 6; i += 1) await m.flush();
  const by = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
  return {
    ...m, calls, by,
    of: (id) => { const n = by(id); assert.ok(n, `no ${id}`); return text(n); },
    async done() { await m.unmount(); globalThis.fetch = previous; },
  };
}

test('mounted: each tab carries its count from one read; a failed count is a dash, and the tabs still lead', async () => {
  const m = await page('/admin/advisors-partners/firms');
  try {
    assert.match(m.of('ap-tab-overview'), /Overview\s*4/);
    assert.match(m.of('ap-tab-firms'), /Firms\s*17/);
    assert.match(m.of('ap-tab-deck'), /Deck roster\s*12/);
    assert.equal(m.calls.filter((p) => p === '/api/admin/network/tabs').length, 1);
  } finally { await m.done(); }
  const half = await page('/admin/advisors-partners/firms', { tabs: { ...TABS, firms: down('firms could not be read. Try again.') } });
  try {
    assert.match(half.of('ap-tab-firms'), /Firms—/, 'a dash, not a zero');
    assert.match(half.of('ap-tab-deck'), /12/, 'the others stay');
  } finally { await half.done(); }
  const bad = await page('/admin/advisors-partners/firms', { fail: ['tabs'] });
  try {
    assert.match(bad.of('ap-tab-firms'), /Firms—/);
    assert.ok(bad.by('ap-firms-tab'), 'the tab\'s own content still draws');
  } finally { await bad.done(); }
});

/** The test DOM's window listeners are no-ops; this test needs real ones, which the harness cannot overwrite. */
function realWindowEvents() {
  const target = new EventTarget();
  const keep = ['addEventListener', 'removeEventListener', 'dispatchEvent'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent']) {
    Object.defineProperty(globalThis, k, { configurable: true, get: () => target[k].bind(target), set() {} });
  }
  return () => { for (const [k, d] of keep) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } };
}

test('mounted AP12b: a write refused for a paused studio puts the notice on the page, and the page keeps its data', async () => {
  const undo = realWindowEvents();
  const m = await page('/admin/advisors-partners/firms');
  try {
    assert.ok(!m.by('ap-paused'));
    await act(async () => { globalThis.dispatchEvent(new CustomEvent('studioos:branch_suspended', { detail: {} })); });
    await m.flush();
    assert.match(m.of('ap-paused'), /HQ has paused this studio’s admin access\..*still read everything.*Contact HQ/s);
    assert.ok(m.by('ap-firms-tab'), 'data is not hidden: reading is not paused');
    assert.match(m.of('ap-tab-firms'), /17/);
  } finally { await m.done(); undo(); }
});

test('mounted AP8b: a linked card shows what its account says, read only, and an unlinked card shows nothing of the kind', async () => {
  const row = { id: 3, name: 'Card name', kind: 'advisor', role: 'Card role', is_active: true, state: 'shown',
    linked_user: { id: 2, name: 'Pat Partner', account: { name: 'Pat P.', headline: 'Operating partner, GTM', company: null, has_photo: true } } };
  const m = await mountContracts(React.createElement(CardDialog, { row, onClose() {}, onSaved() {}, save: async () => ({ row }) }), '/admin/advisors-partners/deck');
  try {
    await m.flush();
    const by = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
    assert.ok(by('deck-card-account'), 'no account block');
    assert.match(text(by('deck-card-account')), /From the account · read only/);
    assert.equal(text(by('deck-card-account-name')), 'Pat P.');
    assert.equal(text(by('deck-card-account-headline')), 'Operating partner, GTM');
    assert.equal(text(by('deck-card-account-company')), 'Not recorded on the account');
    assert.equal(text(by('deck-card-account-photo')), 'On the account');
  } finally { await m.unmount(); }
  const plain = await mountContracts(React.createElement(CardDialog, { row: { ...row, linked_user: null }, onClose() {}, onSaved() {}, save: async () => ({ row }) }), '/admin/advisors-partners/deck');
  try {
    await plain.flush();
    assert.ok(!plain.nodes().some((n) => plain.props(n)?.['data-testid'] === 'deck-card-account'));
  } finally { await plain.unmount(); }
});
