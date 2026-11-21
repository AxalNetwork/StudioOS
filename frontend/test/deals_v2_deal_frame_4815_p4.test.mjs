/**
 * D4815 part 4 (#5903) — `/deals/:id` redrawn to board DE04 (canvas section
 * DX4): the header (Back to Deals, venture, sector and place, company-stage
 * chip, website icon, the investor's progress as its own element), the one
 * financial strip, the investment progress with its reason and one next
 * action, the eight tabs with every older tab under one of them at its old
 * address, and Your position, which is never another firm's or another
 * investor's commitment.
 *
 * Model tests, then the real DealRoomPage mounted with a fetch the test
 * controls and a firm the test selects.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deals_v2_deal_frame_4815_p4.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import DealRoomPage from '../src/pages/DealRoomPage.jsx';
import { forgetVisits } from '../src/pages/deal/dealVisit.js';
import { ActiveCompanyContext } from '../src/contexts/ActiveCompanyContext.js';
import { DEAL_TABS, TAB_DEFS, SUB_PAGES, dealGroupsFor, dealTabsFor, dealViewsIn, groupHref, groupOf, tabOf } from '../src/pages/dealPageModel.js';
import {
  NO_COMPANY_STAGE, NO_PLACE, backOf, closesOn, financialStrip, headerOf, progressChip, termsAtGlance, trackOf, viewerCommitment, websiteHref,
} from '../src/pages/deal/dealFrameModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const EIGHT = ['Overview', 'Scorecard', 'Evidence', 'Diligence', 'Data room', 'Terms', 'Investment', 'Activity'];
const ROLES = ['investor', 'founder', 'admin', 'partner'];
const DEAL = { id: 4, project_id: 7, project_name: 'Harbor Ledger', project_sector: 'Fintech', status: 'active', currency: 'USD', target_raise: 1000000, capital_committed: 250000, minimum_check: 25000, instrument: 'Post-money SAFE', closing_deadline: '2026-12-01', website: 'harbor.example', valuation_cap: 8000000 };
const INVESTOR = { id: 21, role: 'investor', name: 'Ada', email: 'ada@example.com', subscription_tier: 'professional' };
// The investor's own row under firm 501, as `GET /api/deals/:id/commitments` returns it to an investor (D4633).
const OWN = { uid: 'c-own', deal_id: 4, investor_user_id: 21, company_id: 501, company_name: 'Alder Ventures', firm_context: 501, in_context: true, amount: 50000, status: 'pending' };

// ------------------------------------------------------------------ the eight tabs

test('the eight tabs, in the canvas order, and every view a role held before sits under exactly one of them', () => {
  assert.deepEqual(DEAL_TABS.map((g) => g.label), EIGHT);
  assert.deepEqual(dealGroupsFor('investor').map((g) => g.label), EIGHT, 'an investor sees all eight');
  for (const role of ROLES) {
    const held = dealTabsFor(role);
    const placed = dealGroupsFor(role).flatMap((g) => g.views);
    assert.deepEqual([...placed].sort(), [...held].sort(), `${role}: every view is under a tab, none dropped`);
    assert.equal(new Set(placed).size, placed.length, `${role}: no view under two tabs`);
  }
  for (const view of Object.keys(TAB_DEFS)) assert.equal(DEAL_TABS.filter((g) => g.views.includes(view)).length, 1, view);
  assert.deepEqual(Object.fromEntries(Object.keys(TAB_DEFS).map((v) => [v, groupOf(v)])), {
    // D6164 part 3 (the owner's answer A): Team, Market and Traction sit under Scorecard; Notes is Activity's filter, not a view.
    overview: 'overview', scorecard: 'scorecard', evidence: 'evidence', team: 'scorecard', market: 'scorecard', traction: 'scorecard',
    diligence: 'diligence', documents: 'dataroom', terms: 'terms', commitment: 'investment', invitations: 'investment',
    transfers: 'investment', activity: 'activity',
  });
  assert.equal(groupOf('closing'), 'investment', 'the closing room sits under Investment');
  assert.ok(Object.keys(SUB_PAGES).every((k) => DEAL_TABS.some((g) => g.subPages?.includes(k))));
});

test('old tab addresses still open their view; the two new addresses open their tab\'s first view', () => {
  for (const role of ROLES) for (const view of dealTabsFor(role)) {
    if (view === 'overview') continue;
    assert.equal(tabOf(TAB_DEFS[view].path, role), view, `${role} /${TAB_DEFS[view].path}`);
  }
  assert.equal(tabOf('data-room', 'investor'), 'documents');
  assert.equal(tabOf('investment', 'investor'), 'commitment');
  assert.equal(tabOf('activity', 'investor'), 'activity', 'D6164 part 3: an investor holds Activity, with Firm notes as its filter');
  assert.equal(tabOf('activity', 'founder'), 'activity');
  assert.equal(tabOf('investment', 'partner'), 'commitment');
  assert.equal(tabOf('closing', 'investor'), 'closing');
  assert.equal(tabOf('diligence', 'partner'), 'overview', 'a view the role never held still opens Overview (D609)');
  assert.equal(tabOf('notes', 'admin'), 'overview', 'an investor\'s notes are never the studio\'s');
  assert.equal(groupHref(4, 'dataroom'), '/deals/4/data-room');
  assert.equal(groupHref(4, 'overview'), '/deals/4');
  assert.equal(groupHref('4x', 'investment'), '/deals//investment', 'a bad id never reaches the address');
  assert.deepEqual(dealViewsIn('scorecard', 'investor').map((v) => v.label), ['Eleven scopes', 'Team', 'Market', 'Traction'], 'D6164 part 3: under Scorecard');
  assert.deepEqual(dealViewsIn('evidence', 'investor'), [], 'Evidence is one view now');
  assert.deepEqual(dealViewsIn('investment', 'admin').map((v) => v.id), ['commitment', 'invitations', 'transfers']);
  assert.deepEqual(dealViewsIn('investment', 'investor'), [], 'one view, no second row');
});

// ------------------------------------------------------------------ the header and the strip

test('the header: Back to Deals, sector and place, company stage and website, each said when not recorded', () => {
  assert.deepEqual(backOf('investor'), { path: '/deals', label: 'Back to Deals' });
  assert.equal(backOf('founder').label, 'Back to Capital relationships');
  const head = headerOf(DEAL);
  assert.deepEqual([head.name, head.sector, head.place, head.stage.value, head.website], ['Harbor Ledger', 'Fintech', 'Place not recorded', 'Not recorded', 'https://harbor.example/']);
  assert.deepEqual([head.placeReason, head.stage.reason], [NO_PLACE, NO_COMPANY_STAGE]);
  assert.equal(headerOf({ id: 9 }).sector, 'Sector not recorded');
  assert.equal(websiteHref('https://acme.example/about'), 'https://acme.example/about');
  for (const bad of ['javascript:alert(1)', 'ftp://acme.example', 'data:text/html,x', 'not a site', '', null]) assert.equal(websiteHref(bad), null, String(bad));
});

test('the strip: Round, Instrument, Committed, Minimum, Closes; Not recorded when absent, Unreadable when held but unreadable, never 0', () => {
  const full = financialStrip(DEAL);
  assert.deepEqual(full.map((c) => c.label), ['Round', 'Instrument', 'Committed', 'Minimum', 'Closes']);
  assert.deepEqual(full.map((c) => c.value), ['$1,000,000', 'Post-money SAFE', '$250,000', '$25,000', '1 Dec 2026']);
  assert.equal(full.find((c) => c.key === 'committed').sub, 'Confirmed, all investors', 'the round\'s total, never the viewer\'s');
  const none = financialStrip({ currency: 'USD' });
  assert.ok(none.every((c) => c.state === 'nr' && c.value === 'Not recorded' && c.reason), 'absent is Not recorded with a reason');
  const bad = financialStrip({ currency: 'USD', target_raise: 'lots', instrument: 'SAFE', capital_committed: 'n/a', minimum_check: '', closing_deadline: 'soon' });
  assert.deepEqual(bad.map((c) => [c.key, c.value]), [['round', 'Unreadable'], ['instrument', 'SAFE'], ['committed', 'Unreadable'], ['minimum', 'Not recorded'], ['closes', 'Unreadable']]);
  assert.deepEqual(financialStrip({ ...DEAL, currency: 'dollars' }).filter((c) => c.state === 'ur').map((c) => c.key), ['round', 'committed', 'minimum'], 'an unreadable currency is never drawn as a figure');
  for (const c of [...none, ...bad]) assert.ok(!/^\$?0$/.test(c.value), c.key);
  assert.deepEqual([closesOn('2026-12-20'), closesOn('2026-02-30'), closesOn('20 Dec')], ['20 Dec 2026', null, null]);
  // Not repeated above the fold: the terms card no longer prints the strip's two terms.
  assert.deepEqual(termsAtGlance(DEAL).map((t) => t.label), ['Valuation cap', 'Carry', 'Management fee']);
});

test('the progress chip and the sequence come only from the stage read', () => {
  const ready = (my_stage, ic = { state: 'used' }) => trackOf({ status: 'ready', data: { my_stage, next_action: { label: 'Open', href: '/x', kind: 'navigate' }, ic } });
  assert.equal(progressChip(ready('Diligence')).text, 'Diligence · Step 3 of 8');
  assert.equal(progressChip(ready('Funded')).text, 'Funded · Step 8 of 8');
  assert.equal(progressChip(ready('You passed')).text, 'You passed');
  assert.deepEqual(progressChip(trackOf({ status: 'unreadable' })), { state: 'unreadable', text: 'Your step: Unreadable' });
  assert.equal(progressChip(trackOf({ status: 'loading' })).state, 'loading');
  assert.equal(progressChip(trackOf({ status: 'ready', data: { my_stage: null, reason: 'No current invitation or progress fact is recorded.' } })).text, 'No step recorded for you');
});

// ------------------------------------------------------------------ Your position

test('Your position is the viewer\'s own live commitment in the firm the read was for, and nothing else', () => {
  const at = { userId: 21, dealId: 4, firmId: 501 };
  const r = (items, over = {}) => ({ status: 'ready', dealId: 4, firmId: 501, items, ...over });
  assert.deepEqual(viewerCommitment(r([OWN]), at), { state: 'ready', amount: '$50,000', status: 'Pending', firm: 'Held for Alder Ventures.' });
  const OTHER_FIRM = { ...OWN, uid: 'c-birch', company_id: 502, company_name: 'Birch Capital', in_context: false };
  const OTHER_FIRM_IN_CONTEXT_FLAG = { ...OWN, uid: 'c-birch2', company_id: 502, company_name: 'Birch Capital' };
  const OTHER_INVESTOR = { ...OWN, uid: 'c-bob', investor_user_id: 99, company_name: 'Elsewhere LP' };
  const STAFF_SHAPED = { uid: 'c-staff', deal_id: 4, investor_user_id: 21, company_id: 502, company_name: 'Birch Capital', amount: 90000, status: 'confirmed' };
  for (const [why, row] of [['another firm', OTHER_FIRM], ['a row outside the read\'s firm', OTHER_FIRM_IN_CONTEXT_FLAG], ['another investor', OTHER_INVESTOR],
    ['a row with no firm context (the staff read)', STAFF_SHAPED], ['a staff-read row in no firm', { ...STAFF_SHAPED, company_id: null, company_name: null }],['withdrawn', { ...OWN, status: 'withdrawn' }], ['another deal', { ...OWN, deal_id: 5 }]]) {
    assert.equal(viewerCommitment(r([row]), at).state, 'none', why);
  }
  assert.equal(viewerCommitment(r([OTHER_INVESTOR, OTHER_FIRM, OWN]), at).amount, '$50,000', 'the own row, wherever it sits');
  assert.equal(viewerCommitment(r([OWN]), { ...at, firmId: 502 }).state, 'loading', 'a read for the earlier firm is never this firm\'s');
  assert.equal(viewerCommitment(r([OWN]), { ...at, dealId: 5 }).state, 'loading', 'a read for deal 4 is never deal 5\'s');
  assert.equal(viewerCommitment(r([OWN]), { ...at, userId: null }).state, 'none', 'no viewer, no commitment of theirs');
  assert.equal(viewerCommitment({ status: 'unreadable', dealId: 4, firmId: 501 }, at).state, 'unreadable');
  assert.equal(viewerCommitment(r([{ ...OWN, company_id: null, firm_context: null }], { firmId: null }), { ...at, firmId: null }).firm, 'Held in your own name.');
});

// ------------------------------------------------------------------ mounted

async function mounted(url, handler, { phone = false, user = INVESTOR } = {}) {
  forgetVisits();
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, init) => { requests.push(`${(init?.method || 'GET').toUpperCase()} ${String(u)}`); return handler(String(u), init); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  let pickFirm = null;
  const Firm = ({ children }) => {
    const [company, setCompany] = React.useState({ id: 501 });
    pickFirm = setCompany;
    return h(ActiveCompanyContext.Provider, { value: { company, setCompany, companies: [], setCompanies() {} } }, children);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Firm, null,
    h(Routes, null, h(Route, { path: '/deals/:dealId', element: h(DealRoomPage) }), h(Route, { path: '/deals/:dealId/:tab', element: h(DealRoomPage) })))))));
  const settle = async () => { await act(async () => { for (let i = 0; i < 14; i += 1) await new Promise((r) => setImmediate(r)); }); };
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).filter((n) => props(n)['data-testid'] === id);
  return {
    requests, settle, text: () => text(container), has: (id) => byId(id).length > 0, count: (id) => byId(id).length, textOf: (id) => text(byId(id)[0]),
    propOf: (id, key) => props(byId(id)[0])[key],
    ids: () => walk(container).map((n) => props(n)['data-testid']).filter(Boolean),
    current: () => walk(container).filter((n) => props(n)['aria-current'] === 'page').map((n) => props(n)['data-testid']),
    tags: (t) => walk(container).filter((n) => n.tagName === t),
    async firm(id) { await act(async () => pickFirm({ id })); await settle(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); localStorage.removeItem('user'); restore(); },
  };
}

function base(over = {}) {
  return (url, init = {}) => {
    const m = (init.method || 'GET').toUpperCase();
    for (const [re, fn] of Object.entries(over)) if (new RegExp(re).test(url)) { const r = fn(url, m, init); if (r) return r; }
    if (/\/api\/deals\/4\/stage/.test(url)) return response({ my_stage: 'Diligence', reason: null, next_action: { label: 'Open the diligence case', href: '/due-diligence/dd1', kind: 'navigate' }, ic: { state: 'used' } });
    if (/\/api\/deals\/4\/whats-new/.test(url)) return response({ first_visit: true, changes: [] });
    if (/\/api\/deals\/4\/commitments/.test(url)) return response([OWN]);
    if (/\/api\/deals\/4\/round/.test(url)) return response({ investors: 1, confirmed_total: 250000, pending_total: 0, currency: 'USD' });
    if (/\/api\/deals\/4\/notes/.test(url)) return response({ items: [], total: 0 });
    if (/\/api\/deals\/4\/activity/.test(url)) return response([]);
    if (/\/networkfx\/syndicates/.test(url)) return response([]);
    if (/\/api\/deals\/4(\?|$)/.test(url)) return response(DEAL);
    return response({});
  };
}

test('mounted, an investor at /deals/4: the DE04 header, one strip, the sequence, one next action, Your position', async () => {
  const v = await mounted('/deals/4', base());
  try {
    assert.equal(v.tags('H1').length, 1);
    assert.match(v.textOf('deal-crumb'), /Back to Deals$/);
    assert.match(v.textOf('deal-header'), /^Harbor Ledger/);
    assert.equal(v.textOf('deal-company-stage'), 'Company stage · Not recorded');
    assert.equal(v.propOf('deal-website', 'href'), 'https://harbor.example/');
    assert.equal(v.propOf('deal-website', 'rel'), 'noopener noreferrer');
    assert.equal(v.textOf('deal-sector-place'), 'Fintech · Place not recorded');
    assert.equal(v.textOf('deal-progress-chip'), 'Diligence · Step 3 of 8', 'the investor\'s progress, its own element');
    assert.ok(!v.has('deal-status'), 'the studio\'s round status is not drawn as the investor\'s');
    assert.equal(v.count('deal-strip'), 1, 'one financial strip');
    assert.equal(v.count('deal-next-action'), 1, 'one next action');
    assert.ok(v.textOf('deal-header').includes('Open the diligence case'), 'the next action is the header\'s');
    assert.equal(v.count('deal-step-now'), 1);
    assert.match(v.textOf('deal-track-why'), /diligence case is open/);
    assert.match(v.textOf('deal-position-amount'), /\$50,000 · Pending/);
    assert.equal(v.textOf('deal-position-firm'), 'Held for Alder Ventures.');
    assert.equal(v.ids().filter((id) => id.startsWith('deal-tab-')).length, 8);
    assert.deepEqual(v.ids().filter((id) => id.startsWith('deal-tab-')).map((id) => v.textOf(id)), EIGHT);
    // The strip's figures are drawn once on the page, never again in the header or the Overview cards.
    const page = v.text();
    for (const figure of ['$1,000,000', 'Post-money SAFE', '$250,000', '$25,000', '1 Dec 2026']) {
      assert.equal(page.split(figure).length - 1, 1, `${figure} is drawn once`);
    }
  } finally { await v.close(); }
});

test('mounted, old addresses open under their tab: Documents, Commitment, Notes and Team; the new ones too', async () => {
  const cases = [
    ['/deals/4/documents', ['deal-tab-dataroom'], /\/api\/deals\/4\/room-access$/],
    ['/deals/4/data-room', ['deal-tab-dataroom'], /\/api\/deals\/4\/room-access$/],
    ['/deals/4/commitment', ['deal-tab-investment'], /\/api\/deals\/4\/commitments/],
    ['/deals/4/investment', ['deal-tab-investment'], /\/api\/deals\/4\/round/],
    ['/deals/4/notes', ['deal-tab-activity'], /\/api\/deals\/4\/notes/],
    ['/deals/4/activity', ['deal-tab-activity'], /\/api\/deals\/4\/activity/],
    ['/deals/4/team', ['deal-tab-scorecard', 'deal-subtab-team'], /\/api\/deals\/4\/team/],
    ['/deals/4/overview', ['deal-tab-overview'], /\/api\/deals\/4\/whats-new/],
  ];
  for (const [url, lit, reads] of cases) {
    const v = await mounted(url, base());
    try {
      assert.deepEqual(v.current(), lit, url);
      assert.ok(v.requests.some((r) => reads.test(r)), `${url} reads its view`);
    } finally { await v.close(); }
  }
});

test('mounted, another firm\'s commitment is never shown as the viewer\'s, and a firm switch reads again', async () => {
  const BIRCH = { ...OWN, uid: 'c-birch', company_id: 502, company_name: 'Birch Capital', firm_context: 502, amount: 90000, status: 'confirmed' };
  const STRANGER = { ...OWN, uid: 'c-x', investor_user_id: 99, company_name: 'Elsewhere LP', amount: 70000 };
  // Firm 501's read carries a stray row of another firm and another investor; neither is the viewer's.
  let v = await mounted('/deals/4', base({ 'deals/4/commitments': (u, m) => (m === 'GET' ? response([{ ...BIRCH, firm_context: 501, in_context: false }, STRANGER]) : null) }));
  try {
    assert.ok(v.has('deal-position-none'));
    assert.doesNotMatch(v.textOf('deal-position'), /90,000|70,000|Birch|Elsewhere/);
  } finally { await v.close(); }
  // A switch to firm 502 reads again; the earlier firm's late answer is not drawn.
  const held = [];
  let calls = 0;
  v = await mounted('/deals/4', base({
    'deals/4/commitments': (u, m) => {
      if (m !== 'GET') return null;
      calls += 1;
      return calls === 1 ? new Promise((resolve) => held.push(() => resolve(response([OWN])))) : response([BIRCH]);
    },
  }));
  try {
    assert.match(v.textOf('deal-position'), /Reading your commitment/);
    await v.firm(502);
    assert.equal(calls, 2, 'the switch read the commitment again');
    assert.equal(v.textOf('deal-position-firm'), 'Held for Birch Capital.');
    await act(async () => { for (const r of held.splice(0)) r(); });
    await v.settle();
    assert.equal(v.textOf('deal-position-firm'), 'Held for Birch Capital.', 'Alder\'s late answer did not land');
    assert.match(v.textOf('deal-position-amount'), /\$90,000 · Confirmed/);
  } finally { await v.close(); }
});

test('mounted, honesty: an unreadable field and a failed commitment read each say Unreadable, never 0', async () => {
  const v = await mounted('/deals/4', base({
    '/api/deals/4(\\?|$)': () => response({ ...DEAL, closing_deadline: 'when ready', minimum_check: null, website: 'javascript:alert(1)' }),
    'deals/4/commitments': () => response({ error: 'unreadable' }, 503),
  }));
  try {
    assert.equal(v.textOf('deal-strip-closes'), 'ClosesUnreadable');
    assert.equal(v.textOf('deal-strip-minimum'), 'MinimumNot recorded');
    assert.match(v.textOf('deal-position'), /could not be read/);
    assert.ok(!v.has('deal-website') && v.has('deal-website-none'), 'an address that is not http(s) is never a link');
    assert.doesNotMatch(v.textOf('deal-strip'), /\$0\b/);
  } finally { await v.close(); }
});

test('mounted, a phone: the one next action sits at the foot, not in the header', async () => {
  const v = await mounted('/deals/4', base(), { phone: true });
  try {
    assert.equal(v.count('deal-next-action'), 1);
    assert.ok(v.has('deal-next-bar'));
    assert.ok(!v.textOf('deal-header').includes('Open the diligence case'));
  } finally { await v.close(); }
});

test('mounted, an Admin: the tabs holding their views, Investment with its second row, and no investor position', async () => {
  let v = await mounted('/deals/4/transfers', base({ 'deals/4/transfers': () => response([]) }), { user: { id: 1, role: 'admin', name: 'Ops', email: 'ops@example.com' } });
  try {
    assert.deepEqual(v.ids().filter((id) => id.startsWith('deal-tab-')).map((id) => v.textOf(id)), EIGHT);
    assert.deepEqual(v.current(), ['deal-tab-investment', 'deal-subtab-transfers']);
    assert.deepEqual(v.ids().filter((id) => id.startsWith('deal-subtab-')), ['deal-subtab-commitment', 'deal-subtab-invitations', 'deal-subtab-transfers']);
    assert.ok(!v.has('deal-progress-chip'));
  } finally { await v.close(); }
  // On Overview too, an Admin is shown no commitment as theirs.
  v = await mounted('/deals/4', base(), { user: { id: 1, role: 'admin', name: 'Ops', email: 'ops@example.com' } });
  try {
    assert.ok(v.has('deal-overview') && !v.has('deal-position') && !v.has('deal-progress-chip'));
  } finally { await v.close(); }
});

// ------------------------------------------------------------------ the record

test('the decision part names the mapping, the unbacked steps and the departures; the route map row says what was built', () => {
  const f = 'documentation/architecture/decisions/D4815-p4.md';
  assert.ok(existsSync(f));
  const d = read(f);
  assert.match(d, /^## D4815 part 4 — .+ \(#4815\)/);
  for (const view of Object.keys(TAB_DEFS)) assert.match(d, new RegExp(`\\| ${TAB_DEFS[view].label} \\|`), `the mapping names ${view}`);
  assert.match(d, /### Steps with no field behind them/);
  assert.match(d, /### Departures from the canvas/);
  assert.match(read('documentation/architecture/route-map/canvases/part-3/0230-pages-investor-deals.md'), /DX4 frame built \(D4815 part 4, #5903\)/);
});
