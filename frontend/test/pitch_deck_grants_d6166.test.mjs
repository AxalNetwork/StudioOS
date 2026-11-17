// D6166 (#6166; D1587's founder control) — "Shared on a deal" on Share &
// analytics: the venture's deals, each deal's grants (name, firm, version,
// ticks, granted, withdrawn; never a note, score or decision), the grant
// dialog with the replace line before anything is sent, Withdraw behind a
// confirm that says what the investor loses, and the Worker's refusals in
// its own words. A failed read is never an empty list.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_deck_grants_d6166.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import DeckGrants from '../src/pages/raise/pitch/DeckGrants.jsx';
import { grantBody, grantRows, investorOptions, replaceLine, tickWords, ventureDeals } from '../src/pages/raise/pitch/deckGrantsModel.js';

const h = React.createElement;
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: 'x', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const refusal = (status, code, message) => response({ error: { code, message } }, status);

const VERSIONS = [
  { id: 70, version: 2, title: 'Seed deck', created_at: '2026-11-01 09:00:00' },
  { id: 71, version: 3, title: 'Seed deck', created_at: '2026-11-10 09:00:00', is_current: true },
];
const DEALS = [
  { id: 9, project_id: 5, status: 'active', created_at: '2026-10-01 09:00:00' },
  { id: 12, project_id: 6, status: 'active', created_at: '2026-10-02 09:00:00' },
];
const PAT = { user_id: 31, company_id: 4, name: '[Pat Partner]', firm: '[Fund A]' };
const GRANT = (over = {}) => ({
  uid: 'g1', investor: { user_id: 31, name: '[Pat Partner]', firm: '[Fund A]' }, version: 2,
  included: { figures: true, sources: true, notes: false, bands: false }, granted_at: '2026-11-03 10:00:00', withdrawn_at: null, ...over,
});

async function mount(element, handle) {
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify({ id: 1, role: 'founder', name: '[Fay Founder]' }));
  const previous = globalThis.fetch;
  const seen = [];
  const bodies = [];
  globalThis.fetch = async (u, init = {}) => {
    const key = `${(init.method || 'GET').toUpperCase()} ${new URL(String(u), 'http://x').pathname}`;
    seen.push(key);
    if (init.body) bodies.push([key, JSON.parse(init.body)]);
    return (handle[key] || (() => response({ error: 'unhandled' }, 500)))(init);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };
  await act(async () => root.render(element));
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  return {
    seen, bodies, text: () => textOf(document.body), has: (id) => Boolean(byId(id)),
    textOf: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    disabled: (id) => Boolean(props(byId(id))?.disabled),
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick(); }); await settle(); },
    choose: async (id, value) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { value: String(value) } }); }); await settle(); },
    tick: async (id, checked) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { checked } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('the model: only this venture\'s deals, rows built field by field, ticks in words, the body\'s four keys', () => {
  assert.deepEqual(ventureDeals(DEALS, 5).map((d) => d.id), [9]);
  assert.match(ventureDeals(DEALS, 5)[0].label, /^Deal #9 · Active · opened 1 Oct$/);
  const [row] = grantRows([{ ...GRANT(), note: 'Weak team', score: 41, decision: 'pass', investor: { ...GRANT().investor, note: 'x', score: 2 } }]);
  assert.deepEqual(Object.keys(row).sort(), ['firm', 'granted', 'live', 'name', 'ticks', 'uid', 'userId', 'version', 'withdrawn']);
  assert.equal(row.name, '[Pat Partner]');
  assert.equal(row.version, 'v2');
  assert.equal(grantRows([GRANT({ investor: { user_id: 31, name: null, firm: null } })])[0].firm, 'Not recorded');
  assert.equal(tickWords({ figures: true, sources: false, notes: true, bands: false }), 'Figures · Notes');
  assert.equal(tickWords({}), 'None of the four');
  assert.deepEqual(investorOptions([PAT, { ...PAT, company_id: 8, firm: '[Fund B]' }]).map((i) => i.id), [31], 'one per person, as the Worker grants');
  assert.deepEqual(grantBody({ deckId: 71, investorId: 31, ticks: { figures: true, notes: true, cap_table: true } }),
    { deck_id: 71, investor_user_id: 31, include: { figures: true, sources: false, notes: true, bands: false } });
  assert.equal(replaceLine(null, 'v3'), null);
});

test('the list shows each grant, live and withdrawn, and never a note, score or decision', async () => {
  const v = await mount(h(DeckGrants, { projectId: 5, versions: VERSIONS }), {
    'GET /api/deals': () => response(DEALS),
    'GET /api/deals/9/deck-grants': () => response({
      grants: [GRANT({ note: 'Weak team', score: 41, decision: 'pass' }), GRANT({ uid: 'g0', version: 1, included: { figures: false, sources: false, notes: false, bands: true }, granted_at: '2026-10-20 10:00:00', withdrawn_at: '2026-11-03 10:00:00' })],
      investors: [PAT],
    }),
  });
  try {
    const row = v.textOf('deck-grant-g1');
    for (const w of ['[Pat Partner]', '[Fund A]', 'v2', 'Figures · Sources', '3 Nov', 'Live']) assert.ok(row.includes(w), w);
    const old = v.textOf('deck-grant-g0');
    for (const w of ['v1', 'Bands', '20 Oct']) assert.ok(old.includes(w), w);
    assert.equal(v.textOf('deck-grant-withdrawn-g0'), '3 Nov');
    assert.ok(v.has('deck-grant-withdraw-g1'));
    assert.ok(!v.has('deck-grant-withdraw-g0'), 'a withdrawn grant cannot be withdrawn again');
    assert.doesNotMatch(v.text(), /Weak team|41|pass/i);
    assert.ok(!v.seen.includes('GET /api/deals/12/deck-grants'), 'another venture\'s deal is not read');
  } finally { await v.close(); }
});

test('grant: the dialog sends the deal, investor, version and four ticks, then re-reads', async () => {
  let granted = false;
  const v = await mount(h(DeckGrants, { projectId: 5, versions: VERSIONS }), {
    'GET /api/deals': () => response(DEALS),
    'GET /api/deals/9/deck-grants': () => response({ grants: granted ? [GRANT({ version: 3 })] : [], investors: [PAT] }),
    'POST /api/deals/9/deck-grants': () => { granted = true; return response({ uid: 'g1' }, 201); },
  });
  try {
    assert.ok(v.has('deck-grants-empty'));
    await v.click('deck-grants-open');
    assert.ok(v.disabled('deck-grant-send'), 'nothing to send before an investor is chosen');
    await v.choose('deck-grant-investor', 31);
    assert.ok(!v.has('deck-grant-replace'), 'no live grant, no replace line');
    assert.equal(v.textOf('deck-grant-send'), 'Share');
    await v.tick('deck-grant-tick-bands', true);
    await v.tick('deck-grant-tick-sources', false);
    await v.click('deck-grant-send');
    assert.deepEqual(v.bodies, [['POST /api/deals/9/deck-grants', { deck_id: 71, investor_user_id: 31, include: { figures: true, sources: false, notes: false, bands: true } }]]);
    assert.ok(!v.has('deck-grant-dialog'));
    assert.match(v.textOf('deck-grants-toast'), /\[Pat Partner\] can open v3 on this deal\./);
    assert.ok(v.has('deck-grant-g1'), 'the list is read again');
  } finally { await v.close(); }
});

test('replace: the dialog says so before it is sent, naming both versions', async () => {
  const v = await mount(h(DeckGrants, { projectId: 5, versions: VERSIONS }), {
    'GET /api/deals': () => response(DEALS),
    'GET /api/deals/9/deck-grants': () => response({ grants: [GRANT()], investors: [PAT] }),
    'POST /api/deals/9/deck-grants': () => response({ uid: 'g2' }, 201),
  });
  try {
    await v.click('deck-grants-open');
    await v.choose('deck-grant-investor', 31);
    assert.ok(v.has('deck-grant-replace'));
    assert.match(v.textOf('deck-grant-replace'), /\[Pat Partner\] already has v2 on this deal, shared 3 Nov\. Sharing replaces it: v2 stops opening for them and v3 opens instead/);
    assert.equal(v.textOf('deck-grant-send'), 'Replace and share');
    assert.ok(!v.seen.includes('POST /api/deals/9/deck-grants'), 'the line comes before anything is sent');
    await v.click('deck-grant-send');
    assert.ok(v.seen.includes('POST /api/deals/9/deck-grants'));
    assert.match(v.textOf('deck-grants-toast'), /The earlier grant is withdrawn\./);
  } finally { await v.close(); }
});

test('withdraw asks first, says what the investor loses, then keeps the row as withdrawn', async () => {
  let withdrawn = false;
  const v = await mount(h(DeckGrants, { projectId: 5, versions: VERSIONS }), {
    'GET /api/deals': () => response(DEALS),
    'GET /api/deals/9/deck-grants': () => response({ grants: [GRANT(withdrawn ? { withdrawn_at: '2026-11-16 10:00:00' } : {})], investors: [PAT] }),
    'DELETE /api/deals/9/deck-grants/g1': () => { withdrawn = true; return response({ withdrawn: true }); },
  });
  try {
    await v.click('deck-grant-withdraw-g1');
    assert.ok(v.has('deck-grant-withdraw-dialog'));
    assert.match(v.text(), /Withdraw \[Pat Partner\]'s grant\?/);
    assert.match(v.textOf('deck-grant-withdraw-line'), /can no longer open v2 on their deal page\. Their deck panel will say the venture has not shared its deck with them\./);
    assert.ok(!v.seen.includes('DELETE /api/deals/9/deck-grants/g1'), 'nothing is withdrawn before the confirm');
    await v.click('deck-grant-withdraw-confirm');
    assert.ok(v.seen.includes('DELETE /api/deals/9/deck-grants/g1'));
    assert.ok(!v.has('deck-grant-withdraw-dialog'));
    assert.equal(v.textOf('deck-grant-withdrawn-g1'), '16 Nov');
    assert.ok(!v.has('deck-grant-withdraw-g1'));
  } finally { await v.close(); }
});

test('refused: the Worker\'s words on a grant, a withdraw and a read; a failed read is not an empty list', async () => {
  let reads = 0;
  const v = await mount(h(DeckGrants, { projectId: 5, versions: VERSIONS }), {
    'GET /api/deals': () => response(DEALS),
    'GET /api/deals/9/deck-grants': () => { reads += 1; return reads === 1 ? refusal(404, 'deal_not_found', 'Deal not found.') : response({ grants: [GRANT()], investors: [PAT] }); },
    'POST /api/deals/9/deck-grants': () => refusal(409, 'investor_not_on_deal', 'That investor has no invitation or commitment on this deal.'),
    'DELETE /api/deals/9/deck-grants/g1': () => refusal(404, 'grant_not_found', 'That grant is not live on this deal.'),
  });
  try {
    assert.match(v.textOf('deck-grants-error'), /Deal not found\./);
    assert.ok(!v.has('deck-grants-empty'), 'a refused read is never "No investor has been given a version"');
    await v.click('deck-grants-error-retry');
    assert.ok(v.has('deck-grant-g1'));

    await v.click('deck-grants-open');
    await v.choose('deck-grant-investor', 31);
    await v.click('deck-grant-send');
    assert.ok(v.has('deck-grant-dialog'), 'the dialog stays open on a refusal');
    assert.equal(v.textOf('deck-grant-error'), 'That investor has no invitation or commitment on this deal.');
    await v.click('deck-grant-send');
    await v.choose('deck-grant-version', 70);
    assert.ok(!v.has('deck-grant-error'), 'a change clears the refusal');

    await v.click('deck-grant-withdraw-g1');
    await v.click('deck-grant-withdraw-confirm');
    assert.equal(v.textOf('deck-grant-withdraw-error'), 'That grant is not live on this deal.');
    assert.ok(v.has('deck-grant-withdraw-dialog'));
  } finally { await v.close(); }
});

test('a failed deals read says so with Try again, never "no deal"; a reader gets no Share or Withdraw', async () => {
  let calls = 0;
  const v = await mount(h(DeckGrants, { projectId: 5, versions: VERSIONS }), {
    'GET /api/deals': () => { calls += 1; return calls === 1 ? response({ error: 'boom' }, 500) : response([]); },
  });
  try {
    assert.match(v.textOf('deck-grants-deals-error'), /Your deals could not be read\./);
    assert.ok(!v.has('deck-grants-no-deal'));
    await v.click('deck-grants-deals-error-retry');
    assert.ok(v.has('deck-grants-no-deal'));
  } finally { await v.close(); }

  const r = await mount(h(DeckGrants, { projectId: 5, versions: VERSIONS, readOnly: true }), {
    'GET /api/deals': () => response(DEALS),
    'GET /api/deals/9/deck-grants': () => response({ grants: [GRANT()], investors: [PAT] }),
  });
  try {
    assert.ok(r.has('deck-grant-g1'));
    assert.ok(!r.has('deck-grants-open'));
    assert.ok(!r.has('deck-grant-withdraw-g1'));
  } finally { await r.close(); }
});
