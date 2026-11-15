/**
 * D4819 L16 (#5926) — the licence History as an attributable
 * timeline.
 *
 *   · each entry names who, when, what changed as before → after, and the
 *     recorded reason; a missing actor or reason reads Not recorded;
 *   · the title is in operator words, and a raw event key is never the
 *     primary text;
 *   · the branch line says what the push record and `sync` say, and Not
 *     recorded where nothing records it;
 *   · Load older pages over the read's own cursor;
 *   · a failed read is Unreadable with Try again, never an empty timeline.
 *
 * Every licence, person and value is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/licence_history_timeline_5926.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import { renderedText } from './_renderedText.mjs';
import LicenceHistory, { HistoryRow } from '../src/pages/admin/LicenceHistory.jsx';
import {
  EVENT_TITLES, UNKNOWN_EVENT_TITLE, actorLabel, branchOutcome, eventTitle, reasonLabel, whenLabel,
} from '../src/pages/admin/licenceHistoryModel.js';

const row = (over = {}) => ({
  id: 1, event: 'terms_changed', created_at: '2026-11-03 14:32:00', note: 'Annual licence review', outcome: 'committed',
  actor: { state: 'known', id: 7, name: 'Ada Example' },
  change: { recorded: true, before: { term_years: 3 }, after: { term_years: 5 } },
  detail: null,
  ...over,
});
const rowText = (e, sync) => renderedText(renderToStaticMarkup(h(HistoryRow, { e, sync })));

// Mutation checked: eventTitle returning the raw key for a known kind (fails); the unknown title replaced by the key (fails).
test('L16: the title is in operator words; a raw event key is never the primary text', () => {
  const kinds = ['created', 'activated', 'suspended', 'reinstated', 'renewed', 'terminated', 'territory_changed',
    'seats_changed', 'terms_changed', 'contract_instantiated', 'contract_sent', 'program_changed'];
  assert.deepEqual(Object.keys(EVENT_TITLES).sort(), [...kinds].sort(), 'every kind the Worker writes has a title');
  for (const k of kinds) {
    const t = eventTitle(k);
    assert.equal(t.key, null, k);
    assert.ok(!t.title.includes('_') && t.title !== k, `${k} reads ${t.title}`);
  }
  const unknown = eventTitle('brand_new_kind');
  assert.deepEqual(unknown, { title: UNKNOWN_EVENT_TITLE, key: 'brand_new_kind' });
  const html = renderToStaticMarkup(h(HistoryRow, { e: row({ event: 'brand_new_kind' }) }));
  const title = html.match(/data-testid="licence-history-title"[^>]*>([^<]*)</)[1];
  assert.equal(title, UNKNOWN_EVENT_TITLE, 'the primary text is the operator title');
  assert.match(renderedText(html), /brand_new_kind/, 'the key is still there, as a secondary line');
  assert.equal(renderToStaticMarkup(h(HistoryRow, { e: row() })).match(/data-testid="licence-history-title"[^>]*>([^<]*)</)[1], 'Terms amended');
});

// Mutation checked: actorLabel returning 'System' for any missing actor (fails); reasonLabel ignoring detail.reason (fails);
// whenLabel printing the raw stamp (fails).
test('L16: who, when, before → after and the reason; a missing actor or reason reads Not recorded', () => {
  const t = rowText(row());
  assert.match(t, /Terms amended/);
  assert.match(t, /3 Nov 2026 · 14:32 UTC/);
  assert.match(t, /Ada Example/);
  assert.match(t, /Term \(years\)Before: 3 → , after: 5/);
  assert.match(t, /Reason: Annual licence review/);

  assert.equal(actorLabel({ state: 'none' }, null), 'Not recorded');
  assert.equal(actorLabel({ state: 'none' }, { automatic: true }), 'System', 'the compliance ladder marks its own rows');
  assert.equal(actorLabel({ state: 'unknown', id: 9 }), 'Unknown account');
  assert.deepEqual(reasonLabel(row({ note: null, detail: { reason: 'Finance hire' } })), { recorded: true, text: 'Finance hire' });
  assert.deepEqual(reasonLabel(row({ note: '  ', detail: null })), { recorded: false, text: 'Not recorded' });
  assert.equal(whenLabel(null), 'Not recorded');
  assert.equal(whenLabel('2026-09-01T09:00:00.000Z'), '1 Sep 2026 · 09:00 UTC');

  const bare = rowText(row({ actor: { state: 'none' }, note: null, detail: null, created_at: null }));
  assert.match(bare, /Not recorded/);
  assert.match(bare, /Reason: Not recorded/);
  assert.doesNotMatch(bare, /System/, 'a row that names nobody is not claimed as automatic');
});

// Mutation checked: partial read as no failure (fails); committed read as Not recorded (fails); the sync "now" line dropped (fails);
// a created licence claimed as pushed (fails).
test('L16: the branch line says what the push record and sync say; Not recorded where nothing records it', () => {
  assert.equal(branchOutcome(row({ outcome: null })).state, 'not_recorded');
  assert.equal(branchOutcome(row({ outcome: 'weird' })).state, 'not_recorded');
  assert.equal(branchOutcome(row({ outcome: 'committed' })).state, 'no_failure');
  assert.equal(branchOutcome(row({ event: 'created', outcome: 'committed' })).text, 'No branch change');

  const partial = row({ outcome: 'partial' });
  const pending = { available: true, hq_revision: 143, branch_revision: 142, pending: { revision: 143, failure_code: null } };
  const caught = { available: true, hq_revision: 143, branch_revision: 143, pending: null };
  assert.equal(branchOutcome(partial, pending).state, 'out_of_sync');
  assert.match(branchOutcome(partial, pending).now, /^Still pending now \(revision 143\)\./);
  assert.equal(branchOutcome(partial, caught).now, 'The branch has since accepted revision 143.');
  assert.equal(branchOutcome(partial, { available: false }).now, null, 'an unreadable sync adds nothing');
  assert.equal(branchOutcome(partial, null).now, null);

  const t = rowText(partial, caught);
  assert.match(t, /Branch: HQ done · branch pending/);
  assert.match(t, /The branch has since accepted revision 143\./);
  assert.match(rowText(row({ outcome: null })), /Branch: Not recorded/);
});

// ── mounted ──────────────────────────────────────────────────────────────

async function mount(handle, licence = { uid: 'lic-ex', sync: null }) {
  const restore = installDocument();
  const store = new Map();
  const previous = { fetch: globalThis.fetch, localStorage: globalThis.localStorage };
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const requests = [];
  globalThis.fetch = async (u) => { requests.push(String(u)); return handle(String(u), requests.length); };
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  await act(async () => rootNode.render(h(LicenceHistory, { licence })));
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const allById = (id) => walk(container).filter((n) => props(n)['data-testid'] === id);
  return {
    requests, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)), count: (id) => allById(id).length,
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick(); }); await flush(); },
    async close() {
      await act(async () => rootNode.unmount());
      globalThis.fetch = previous.fetch; globalThis.localStorage = previous.localStorage;
      restore();
    },
  };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Mutation checked: Load older sending no cursor (fails); the second page replacing the first (fails).
test('L16: Load older pages over the read\'s own cursor and keeps the newer entries', async () => {
  const v = await mount((u) => (/before=2\b/.test(u)
    ? json({ items: [row({ id: 1, event: 'created' })], next_before: null })
    : json({ items: [row({ id: 3 }), row({ id: 2, event: 'renewed' })], next_before: 2 })));
  try {
    assert.equal(v.count('licence-history-row'), 2);
    assert.match(v.requests[0], /\/admin\/licences\/lic-ex\/events\?limit=50$/);
    await v.click('licence-history-older');
    assert.match(v.requests[1], /events\?limit=50&before=2$/);
    assert.equal(v.count('licence-history-row'), 3, 'the older page is added below the newer one');
    assert.ok(!v.has('licence-history-older'), 'no cursor, no Load older');
  } finally { await v.close(); }
});

// Mutation checked: a failed first read drawn as "Nothing recorded yet" (fails); Try again removed (fails);
// a failed older page clearing the rows already shown (fails).
test('L16: a failed read is Unreadable with Try again, never an empty timeline; a failed older page keeps the rows', async () => {
  let fail = true;
  const v = await mount(() => (fail ? json({ error: 'boom' }, 500) : json({ items: [row()], next_before: null })));
  try {
    assert.ok(v.has('licence-history-unreadable'));
    assert.match(v.textOf('licence-history-unreadable'), /^Unreadable: the history could not be read\. This is not a claim that nothing happened\./);
    assert.doesNotMatch(v.textOf('licence-history'), /Nothing recorded yet/);
    fail = false;
    await v.click('licence-history-retry');
    assert.ok(!v.has('licence-history-unreadable'));
    assert.equal(v.count('licence-history-row'), 1);
  } finally { await v.close(); }

  const w = await mount((u) => (/before=/.test(u) ? json({ error: 'boom' }, 500) : json({ items: [row({ id: 5 })], next_before: 5 })));
  try {
    await w.click('licence-history-older');
    assert.equal(w.count('licence-history-row'), 1, 'the newer entries stay');
    assert.ok(w.has('licence-history-older-unreadable'));
    assert.ok(!w.has('licence-history-older'), 'Try again replaces Load older for the failed page');
    await w.click('licence-history-retry');
    assert.match(w.requests.at(-1), /before=5$/, 'Try again asks for the same page');
  } finally { await w.close(); }
});
