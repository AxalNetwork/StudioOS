/**
 * D6168 (#6168) — the deal page's Team, Market and Traction tabs draw their
 * scopes' scorecard rows as the Scorecard tab does (`ScopeRows`), and a
 * scope's drawer has an address (`/deals/:id/scorecard?scope=team`):
 *
 *   · each row: the shared score (band and confidence, or the state's own
 *     word), the value only after the NDA, coverage, and Open to the drawer;
 *   · locked, masked, not on the deal, no access and unreadable each read as
 *     the Scorecard tab says them; nothing is a zero;
 *   · Open lands on the Scorecard tab with that drawer open, and Back closes
 *     it; the drawer's own close leaves no step in history to reopen it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_tabs_scorecard_rows_6168.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import VentureScorecard, { ScopeRows } from '../src/components/scoring/scorecard/Scorecard.jsx';
import { scopeParam } from '../src/components/scoring/scorecard/scorecardModel.js';
import { SCORECARD_ROWS } from '../src/pages/deal/dealInsightsModel.js';

const h = React.createElement;
const sc = (scope, value, band, word) => ({ scope, state: 'scored', value, band, confidence_word: word, coverage: { present: 3, applies: 4 }, masked: false, review: null, inputs: [] });
const OPEN = {
  project_id: 7, deal_id: 4, locked: false, nda: true, model: '1.0',
  scopes: [
    sc('team', 62, 'Fair', 'Medium'), sc('market', 74, 'Strong', 'High'), { scope: 'pmf', state: 'not_enough', masked: false, inputs: [] },
    sc('technical', 55, 'Fair', 'Medium'), { scope: 'traction', state: 'unreadable', masked: false }, sc('financial', 58, 'Fair', 'Low'),
    sc('risk', 51, 'Fair', 'Medium'), { scope: 'geographic', state: 'not_expected', masked: false, inputs: [] }, { scope: 'political', state: 'not_read', masked: false },
    sc('governance', 81, 'Strong', 'High'), sc('legal_ip', 40, 'Weak', 'Low'),
  ],
};
const MASKED = { ...OPEN, nda: false, scopes: OPEN.scopes.map((s) => ({ scope: s.scope, state: s.state, band: s.band ?? null, confidence_word: s.confidence_word ?? null, masked: true })) };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The tab's page as DealRoomPage draws it: a reading tab's rows, or the Scorecard tab's addressed panel. */
function Tab() {
  const { tab } = useParams();
  if (tab === 'scorecard') return h(VentureScorecard, { dealId: 4, ndaHref: '/deals/4/documents', addressed: true, weighting: false });
  return h(ScopeRows, { dealId: 4, keys: SCORECARD_ROWS[tab], ndaHref: '/deals/4/documents', testId: `deal-${tab}-scorecard` });
}

async function mount(url, answer) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  globalThis.fetch = async (u) => {
    const p = new URL(String(u), 'http://x').pathname;
    calls.push(p);
    return p === '/api/venture-scores/deal/4' ? answer(calls.length) : json({});
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = () => {}; n.children = []; return n; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const nav = {};
  function Grab() { nav.go = useNavigate(); nav.at = useLocation(); return null; }
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Grab), h(Routes, null, h(Route, { path: '/deals/:dealId/:tab', element: h(Tab) })))));
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join(' ') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const click = async (id, event = {}) => {
    const n = by(id); assert.ok(n, `no ${id}`);
    await act(async () => { await props(n).onClick?.({ button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...event }); });
    await flush();
  };
  return {
    calls, by, props, nav, has: (id) => Boolean(by(id)), click, flush,
    ids: () => walk(container).map((n) => props(n)['data-testid']).filter(Boolean),
    of: (id) => { const n = by(id); assert.ok(n, `no ${id}`); return text(n).replace(/\s+/g, ' ').trim(); },
    where: () => `${nav.at.pathname}${nav.at.search}`,
    async back() { await act(async () => { nav.go(-1); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

const rowIds = (v, tab) => v.ids().filter((id) => new RegExp(`^deal-${tab}-scorecard-(${OPEN.scopes.map((s) => s.scope).join('|')})$`).test(id));

test('scopeParam: only one of the eleven scope keys opens a drawer', () => {
  assert.equal(scopeParam('team'), 'team');
  assert.equal(scopeParam('legal_ip'), 'legal_ip');
  for (const w of [null, undefined, '', 'overall', 'Team', 'team ']) assert.equal(scopeParam(w), null, String(w));
});

test('Team, Market and Traction: each tab its own scopes, drawn as the Scorecard tab draws them, from one read', async () => {
  // v1 canvas DL4, DL5 and DL6, written out: the tab draws these, whatever the model says.
  const CANVAS = { team: ['team'], market: ['market', 'pmf', 'geographic', 'political'], traction: ['traction', 'financial'] };
  for (const [tab, keys] of Object.entries(CANVAS)) {
    const v = await mount(`/deals/4/${tab}`, () => json(OPEN));
    try {
      assert.deepEqual(rowIds(v, tab), keys.map((k) => `deal-${tab}-scorecard-${k}`), tab);
      assert.equal(v.calls.filter((p) => p === '/api/venture-scores/deal/4').length, 1, `${tab}: one read`);
    } finally { await v.close(); }
  }
  const v = await mount('/deals/4/market', () => json(OPEN));
  try {
    assert.equal(v.props(v.by('deal-market-scorecard-score-market'))['aria-label'], 'Market: Strong, high confidence');
    assert.equal(v.of('deal-market-scorecard-value-market'), 'Value 74');
    assert.equal(v.of('deal-market-scorecard-coverage-market'), '3 of 4 inputs');
    assert.equal(v.props(v.by('deal-market-scorecard-open-market')).href, '/deals/4/scorecard?scope=market');
    // A scope with no value has its own word and no value at all, never a zero.
    assert.equal(v.of('deal-market-scorecard-pmf'), 'Product-market fit Not enough recorded Open');
    assert.equal(v.has('deal-market-scorecard-value-pmf'), false);
    assert.equal(v.of('deal-market-scorecard-geographic'), 'Geographic Not expected yet Open');
    assert.equal(v.of('deal-market-scorecard-political'), 'Political and regulatory Not scored yet Open');
    assert.doesNotMatch(v.of('deal-market-scorecard'), /\b0\b/);
  } finally { await v.close(); }
});

test('a scope that could not be read says so with Try again, which reads again; the other rows stand', async () => {
  const v = await mount('/deals/4/traction', (n) => json(n === 1 ? OPEN : { ...OPEN, scopes: OPEN.scopes.map((s) => (s.scope === 'traction' ? sc('traction', 31, 'Weak', 'Medium') : s)) }));
  try {
    assert.match(v.of('deal-traction-scorecard-traction'), /Traction could not be read\. The other scopes are current\./);
    assert.equal(v.has('deal-traction-scorecard-open-traction'), false, 'no drawer to open for a scope that was not read');
    assert.equal(v.of('deal-traction-scorecard-value-financial'), 'Value 58');
    await v.click('deal-traction-scorecard-retry-traction');
    assert.equal(v.calls.filter((p) => p === '/api/venture-scores/deal/4').length, 2);
    assert.equal(v.of('deal-traction-scorecard-value-traction'), 'Value 31');
  } finally { await v.close(); }
});

test('before the NDA: band and confidence, the value Locked, no figure and no Open; the way to the NDA', async () => {
  const v = await mount('/deals/4/market', () => json(MASKED));
  try {
    assert.equal(v.props(v.by('deal-market-scorecard-score-market'))['data-family'], 'value');
    assert.equal(v.of('deal-market-scorecard-value-market'), 'Locked');
    assert.doesNotMatch(v.of('deal-market-scorecard'), /\b74\b|\b0\b/);
    assert.equal(v.has('deal-market-scorecard-open-market'), false);
    assert.match(v.of('deal-market-scorecard-masked'), /Values, grades and inputs open after you sign\. Sign NDA/);
  } finally { await v.close(); }
});

test('locked, not on the deal, no access and unreadable each read as the Scorecard tab says them; no row, no zero', async () => {
  const cases = [
    [() => json({ locked: true, reason: 'The founders keep this scorecard to themselves for now.' }), 'deal-team-scorecard-locked', /^Scorecard locked The founders keep this scorecard to themselves for now\.$/],
    [() => json({ code: 'not_on_deal', detail: 'x' }, 403), 'deal-team-scorecard-not-on-deal', /^This scorecard opens when this venture is in your deal flow\./],
    [() => json({ code: 'forbidden', detail: 'x' }, 403), 'deal-team-scorecard-no-access', /^Scorecards are for investors, founders and studio staff\./],
    [() => json({ detail: 'down' }, 503), 'deal-team-scorecard-unreadable', /could not be read\. That is not a score of zero\./],
  ];
  for (const [answer, id, words] of cases) {
    const v = await mount('/deals/4/team', answer);
    try {
      assert.match(v.of(id), words, id);
      assert.deepEqual(rowIds(v, 'team'), [], `${id}: no row is drawn`);
      assert.doesNotMatch(v.of('deal-team-scorecard'), /\b0\b/);
    } finally { await v.close(); }
  }
});

test('Open lands on the Scorecard tab with that drawer open, and Back closes it', async () => {
  const v = await mount('/deals/4/team', () => json(OPEN));
  try {
    await v.click('deal-team-scorecard-open-team');
    assert.equal(v.where(), '/deals/4/scorecard?scope=team');
    assert.ok(v.has('scorecard-drawer-team'), 'the Team drawer is open');
    await v.back();
    assert.equal(v.where(), '/deals/4/team');
    assert.equal(v.has('scorecard-drawer-team'), false);
  } finally { await v.close(); }
});

test('on the Scorecard tab: Open full detail is a step Back undoes; the drawer’s own close leaves none behind', async () => {
  const v = await mount('/deals/4/scorecard', () => json(OPEN));
  try {
    await v.click('scorecard-scope-market');
    await v.click('scorecard-detail-market');
    assert.equal(v.where(), '/deals/4/scorecard?scope=market');
    assert.ok(v.has('scorecard-drawer-market'));
    await v.back();
    assert.equal(v.where(), '/deals/4/scorecard');
    assert.equal(v.has('scorecard-drawer-market'), false, 'Back closes the drawer');
    await v.click('scorecard-detail-market');
    const depth = v.nav.at.key;
    await v.click('scorecard-drawer-market-close');
    assert.equal(v.where(), '/deals/4/scorecard');
    assert.equal(v.has('scorecard-drawer-market'), false);
    assert.notEqual(v.nav.at.key, depth);
    await v.back();
    assert.equal(v.where(), '/deals/4/scorecard', 'the close replaced the drawer’s address: Back does not reopen it');
    assert.equal(v.has('scorecard-drawer-market'), false);
  } finally { await v.close(); }
});

test('an address opens no drawer for a scope not read, before the NDA, or for a word that is not a scope', async () => {
  for (const [url, deal, id] of [['/deals/4/scorecard?scope=traction', OPEN, 'scorecard-drawer-traction'], ['/deals/4/scorecard?scope=team', MASKED, 'scorecard-drawer-team'], ['/deals/4/scorecard?scope=overall', OPEN, 'scorecard-drawer-overall']]) {
    const v = await mount(url, () => json(deal));
    try {
      assert.ok(v.has('scorecard-scopes'), url);
      assert.equal(v.ids().some((x) => x.startsWith('scorecard-drawer-')), false, `${url}: no ${id}`);
    } finally { await v.close(); }
  }
});
