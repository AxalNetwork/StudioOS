/**
 * D951 (#2727) — Partner invitations part 8: Deals, one deal and Referrals on
 * the server reads. What this file holds them to:
 *   · C5 "Terms ending" draws the stored dates over −20…+120 days, at the
 *     window's edges exactly, amber at 30 days or less, "Term ended, not yet
 *     closed" past the end, and "Showing [n] of [m]" from the Worker's total;
 *   · the Deals list is D926's: its filters, sort and pages reach the Worker,
 *     and the pager says the exact total;
 *   · one deal is D928's read: the KYB section ("Completed", never
 *     "Cleared"), each obligation's own state, the history with who
 *     terminated, and "Signed, deal not activated" with Re-run activation in
 *     a dialog that says what it does;
 *   · Terminate states D928's preview: "[n] members lose the grant this deal
 *     gave them";
 *   · Referrals is D928's cross-deal read: the four tiles, C4, C6 (windows on
 *     ended deals not counted) and Every redemption with the member's role,
 *     paged by the Worker;
 *   · each block draws its own state, so one failure costs that block only;
 *   · PI11d on a phone: cards, the filter sheet's four groups and an exact
 *     "Show [n] deals", and a sort select.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import PartnerInvitations from '../src/pages/admin/PartnerInvitations.jsx';
import { ChartTable } from '../src/ui/Charts.jsx';
import {
  C5_SHOWN, PHONE_STATE_GROUPS, REDEMPTION_CAP, dealListParams, dueDiligence, groupsOfStates, historyRows, obligationRows, phoneFilterCount,
  serverPage, serverRedemptionRow, statesOfGroups, terminatePreviewLines, termsEnding, windowTiles, windowsClosing,
} from '../src/pages/admin/partners/dealsReferralsModel.js';

const h = React.createElement;
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-25T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const d1 = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const ready = (data) => ({ status: 'ready', data, error: null });
const failed = (status = 503) => ({ status: 'error', data: null, error: { status } });

// GET /api/admin/partners/deals — one row (D926 adds the pre-signing partner).
const deal = (id, o = {}) => ({
  id, invitation_id: null, user_id: 500 + id, deal_type: 'services_partnership', granted_tier_founder: 'founder_pro', granted_tier_investor: null,
  term_months: 12, referral_code: `PART-${id}`, envelope_id: 900 + id, status: 'active', activated_at: d1(NOW - 300 * DAY),
  expires_at: iso(NOW + 60 * DAY), terminated_at: null, created_at: d1(NOW - 301 * DAY), partner_email: `d${id}@example.com`,
  partner_name: `Dana ${id}`, redemptions_count: 0, ...o,
});
// GET /api/admin/partners/redemptions — one row (D928).
const red = (id, o = {}) => ({
  id, redeemed_at: d1(NOW - 10 * DAY), granted_tier_founder: 'founder_pro', granted_tier_investor: null, granted_until: iso(NOW + 300 * DAY),
  attribution_kind: 'referral', member_user_id: 700 + id, member_name: `Member ${id}`, member_email: `m${id}@example.com`, member_role: 'founder',
  deal_id: 7, deal_type: 'services_partnership', deal_status: 'active', referral_code: 'PART-7', partner_user_id: 507, partner_name: 'Dana 7',
  partner_email: 'd7@example.com', window_days_left: null, ...o,
});

/* ------------------------------------------------------------------ *
 * C5 at the window's edges
 * ------------------------------------------------------------------ */

test('C5 draws a deal whose end is inside −20…+120 days, at both edges exactly, and none just outside', () => {
  // Mutations checked: the window's lower edge as < ; the upper as < ; a deal past +120 drawn.
  const ends = { a: -20 * DAY, b: -20 * DAY - 1, c: 120 * DAY, d: 120 * DAY + 1 };
  const items = Object.entries(ends).map(([k, off], i) => deal(i + 1, { partner_name: k, expires_at: iso(NOW + off) }));
  const b = termsEnding(ready({ items, total: 4 }), { now: NOW });
  assert.equal(b.state, 'ready');
  assert.deepEqual(b.chart.rows.map((r) => r.label), ['a', 'c']);
  assert.equal(b.showing, 'Showing 2 of 4 active deals', 'n drawn, m the Worker\'s count of active deals');
  assert.deepEqual([b.chart.from, b.chart.to], [-20, 120]);
});

test('C5: amber at 30 days or less, violet after; past the end it reads "Term ended, not yet closed"; a start before the window is clipped', () => {
  // Mutations checked: amber at < 30; the past end drawn as negative days; the start not clipped.
  const items = [
    deal(1, { partner_name: 'thirty', expires_at: iso(NOW + 30 * DAY) }),
    deal(2, { partner_name: 'thirty-one', expires_at: iso(NOW + 30 * DAY + 1) }),
    deal(3, { partner_name: 'past', expires_at: iso(NOW - 2 * DAY) }),
  ];
  const rows = termsEnding(ready({ items, total: 3 }), { now: NOW }).chart.rows;
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.deepEqual([by.thirty.tone, by.thirty.text], ['amber', '30 days']);
  assert.deepEqual([by['thirty-one'].tone, by['thirty-one'].text], ['violet', '31 days']);
  assert.deepEqual([by.past.tone, by.past.text, by.past.past], ['amber', 'Term ended, not yet closed', true]);
  assert.equal(by.thirty.start, -20, 'a deal started 300 days ago starts at the window\'s edge');
  assert.equal(by.thirty.startClipped, true);
  assert.deepEqual(rows.map((r) => r.label), ['past', 'thirty', 'thirty-one'], 'soonest end first');
});

test('C5 says what it leaves out: a deal with no end date, more than twelve in the window, a first page that stops inside it', () => {
  const many = Array.from({ length: 15 }, (_, i) => deal(i + 1, { expires_at: iso(NOW + (i + 1) * DAY) }));
  const b = termsEnding(ready({ items: [deal(99, { expires_at: null }), ...many], total: 140 }), { now: NOW });
  assert.equal(b.chart.rows.length, C5_SHOWN);
  assert.equal(b.showing, `Showing ${C5_SHOWN} of 140 active deals`);
  assert.ok(b.lines.includes('1 active deal has no end date recorded and is not drawn.'));
  assert.ok(b.lines.some((l) => /^Drawn from the first 16 active deals by end date\.$/.test(l)), 'a full page whose last deal ends inside the window may stop short');
  assert.equal(termsEnding({ status: 'loading', data: null }, { now: NOW }).state, 'loading');
  const down = termsEnding(failed(), { now: NOW });
  assert.equal(down.state, 'unreadable');
  assert.match(down.reason, /That is not a claim that no term is ending\./);
});

test('C5 "View as table" holds the same deals, their end dates and days left', () => {
  const b = termsEnding(ready({ items: [deal(1, { partner_name: 'Ann', expires_at: iso(NOW + 10 * DAY) })], total: 1 }), { now: NOW });
  const html = renderToStaticMarkup(h(ChartTable, { chart: b.chart, caption: b.alt }));
  const cells = [...html.matchAll(/<t[dh][^>]*>([^<]*)<\/t[dh]>/g)].map((m) => m[1]);
  assert.deepEqual(cells, ['Deal', 'Ends', 'Days left', 'Ann', '4 Nov 2026', '10 days']);
});

/* ------------------------------------------------------------------ *
 * The model's server parameters, the phone groups, one deal, the preview
 * ------------------------------------------------------------------ */

test('the Deals list asks the Worker for its filters: no chip is every state, the sort in D926\'s words, 25 a page', () => {
  assert.deepEqual(dealListParams({ states: [], page: 3 }), { status: 'all', q: undefined, dealType: undefined, endsWithin: undefined, hasRedemptions: undefined, sort: 'ends_soonest', limit: 25, offset: 50 });
  assert.deepEqual(dealListParams({ q: ' lio ', states: ['active', 'expired'], type: 'referral_partner', endsWithin: '30', hasRedemptions: true, sort: 'redemptions' }),
    { status: ['active', 'expired'], q: 'lio', dealType: 'referral_partner', endsWithin: 30, hasRedemptions: true, sort: 'most_redemptions', limit: 25, offset: 0 });
  assert.deepEqual(serverPage({ items: new Array(25).fill({}), total: 60 }, 2), { rows: new Array(25).fill({}), page: 2, pages: 3, from: 26, to: 50, total: 60 });
  assert.deepEqual(serverPage({ items: [], total: 0 }, 1).total, 0);
});

test('PI11d: four state groups, Ended being term over, terminated and voided; the filter count leaves Active alone out', () => {
  assert.deepEqual(PHONE_STATE_GROUPS.map((g) => g.word), ['Active', 'Awaiting', 'Offer chosen', 'Ended']);
  assert.deepEqual(statesOfGroups(['ended']), ['expired', 'terminated', 'voided']);
  assert.deepEqual(groupsOfStates(['active', 'expired', 'terminated']), ['active'], 'a group is on only when all its states are');
  assert.deepEqual(groupsOfStates(['expired', 'terminated', 'voided', 'proposed']), ['chosen', 'ended']);
  assert.equal(phoneFilterCount({ states: ['active'] }), 0);
  assert.equal(phoneFilterCount({ states: ['active', 'proposed'], type: 'x', endsWithin: '30' }), 3);
});

test('one deal: the KYB section in the stored words ("Completed", never "Cleared"), and two candidate cases are both named', () => {
  assert.deepEqual(dueDiligence({ match: 'one', case: { uid: 'c1', status: 'open', opened_at: d1(NOW), kyb: { status: 'completed', verdict: 'pass' } } }).case,
    { uid: 'c1', text: 'Open', opened: '25 Oct 2026', kyb: 'Completed' });
  assert.equal(dueDiligence({ match: 'one', case: { uid: 'c1', status: 'open', kyb: null } }).case.kyb, 'No KYB section on this case');
  const two = dueDiligence({ match: 'ambiguous', candidates: [{ uid: 'a', status: 'open' }, { uid: 'b', status: 'archived' }] });
  assert.deepEqual(two.cases.map((c) => c.uid), ['a', 'b']);
  assert.match(two.text, /none is picked/);
  assert.equal(dueDiligence({ match: 'not_activated' }).text, 'Opened when the deal is activated');
});

test('one deal: each obligation\'s own state; one never seeded is "Not recorded", never satisfied; a waived one is listed', () => {
  // Mutation checked: an unrecorded key read as its status.
  const rows = obligationRows([
    { key: 'partner_msa_v1', recorded: true, required: true, status: 'satisfied', expires_at: null },
    { key: 'kyb_v1', recorded: true, required: true, status: 'pending' },
    { key: 'kyc_v1', recorded: false, required: null, status: null },
    { key: 'accreditation_v1', recorded: true, required: false, status: 'waived' },
  ]).rows;
  assert.deepEqual(rows.map((r) => [r.label, r.state, r.tone]), [
    ['Partner agreement', 'Satisfied', null], ['KYB', 'Outstanding', 'amber'], ['KYC', 'Not recorded', null], ['Accreditation', 'Waived', null],
  ]);
  assert.equal(rows[2].note, 'Never opened for this member');
  assert.equal(rows[3].note, 'Not required');
  assert.equal(obligationRows(null).state, 'none');
});

test('one deal: the history says who terminated and who re-ran activation, with its outcome', () => {
  const rows = historyRows([
    { kind: 'created', at: d1(NOW - 30 * DAY) },
    { kind: 'activation_failed', at: d1(NOW - 20 * DAY), reason: 'activation_failed' },
    { kind: 'activation_retried', at: d1(NOW - 19 * DAY), by_user_id: 3, by_name: 'Ada Admin', outcome: 'activated' },
    { kind: 'terminated', at: d1(NOW), by_user_id: 4, by_name: null, reason: 'Breach of terms' },
  ]).map((r) => r.text);
  assert.deepEqual(rows, [
    'Offer chosen · 25 Sep 2026',
    'Activation failed · 5 Oct 2026',
    'Activation re-run · 6 Oct 2026 · it activated the deal · by Ada Admin',
    'Terminated · 25 Oct 2026 · by an admin whose name is not recorded · Breach of terms',
  ]);
});

test('the terminate preview: "[n] members lose the grant this deal gave them", the partner\'s own grant, and never a count it could not read', () => {
  // Mutations checked: the count taken from `registered`; the singular; a failed preview drawn as 0.
  const d = deal(7, { partner_name: 'Lio' });
  const lines = (p) => terminatePreviewLines(d, ready(p)).lines;
  assert.deepEqual(lines({ can_terminate: true, partner: { founder_still_granted: true }, registered: 5, members_losing: 3 }), [
    'The tiers this deal granted Lio end now.',
    '3 members lose the grant this deal gave them.',
    '2 other members who registered with the code keep their plans: they pay for one, or no longer hold this deal’s grant.',
    'This cannot be undone.',
  ]);
  assert.deepEqual(lines({ can_terminate: true, partner: { founder_still_granted: false, investor_still_granted: false }, registered: 1, members_losing: 1 }).slice(0, 2),
    ['Lio no longer holds this deal’s grant, so their tiers do not change.', '1 member loses the grant this deal gave them.']);
  assert.equal(lines({ can_terminate: true, partner: null, registered: 0, members_losing: 0 })[0], 'No member loses a grant this deal gave them.');
  assert.equal(terminatePreviewLines(d, ready({ can_terminate: false })).state, 'closed');
  const down = terminatePreviewLines(d, failed());
  assert.equal(down.state, 'unreadable');
  assert.doesNotMatch(down.lines.join(' '), /\d/, 'no number stands in for one not read');
});

/* ------------------------------------------------------------------ *
 * Referrals' model
 * ------------------------------------------------------------------ */

test('the window tiles and C6 count open windows on active deals only (D923, until O-WIN), amber at 30 days or less', () => {
  // Mutations checked: an ended deal's window counted; the 30-day line as < 30.
  const items = [
    red(1, { deal_type: 'deal_sourcing_revshare', window_days_left: 30 }),
    red(2, { deal_type: 'deal_sourcing_revshare', window_days_left: 200 }),
    red(3, { deal_type: 'deal_sourcing_revshare', window_days_left: 5, deal_status: 'terminated' }),
  ];
  const [open, closing] = windowTiles(ready({ items, total: 3, complete: true }));
  assert.deepEqual([open.value, open.sub, closing.value], ['2', 'On active deals only', '1']);
  const c6 = windowsClosing(ready({ items, total: 3, complete: true }));
  assert.deepEqual(c6.chart.rows.map((r) => [r.label, r.text, r.tone]), [['Member 1 · Dana 7', '30 days', 'amber'], ['Member 2 · Dana 7', '200 days', 'violet']]);
  assert.equal(c6.chart.max, 365);
  assert.equal(c6.showing, 'Showing 2 of 2 open windows');
  assert.ok(c6.lines.includes('1 window on an ended deal is not counted.'));
  const partial = windowTiles(ready({ items, total: 2500, complete: false }));
  assert.equal(partial[0].value, '2+');
  assert.equal(partial[0].sub, `Counted over the first ${REDEMPTION_CAP.toLocaleString('en-US')} open windows.`);
  assert.equal(windowTiles(failed())[0].state, 'unreadable');
  assert.equal(windowsClosing(failed()).state, 'unreadable');
});

test('a redemption row names the member\'s role, its window, and an ended deal\'s grant', () => {
  const row = serverRedemptionRow(red(1, { member_role: 'investor', deal_type: 'deal_sourcing_revshare', window_days_left: 12 }));
  assert.deepEqual([row.role, row.window.text, row.tiers], ['Investor', '12 days left', 'Founder grant: no plan']);
  assert.equal(serverRedemptionRow(red(2, { member_role: null })).role, 'Not recorded');
  assert.equal(serverRedemptionRow(red(3, { deal_status: 'terminated' })).grantedUntil, 'Ended with the deal');
  assert.equal(serverRedemptionRow(red(4, { deal_type: 'deal_sourcing_revshare', deal_status: 'expired', window_days_left: 40 })).window.text, 'Deal ended');
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

/** D927's overview reply, every block available and empty, with C4's twelve weeks (Referrals draws the Overview's C4). */
function overviewReply() {
  const ok = (o) => ({ available: true, ...o });
  const monday = (i) => { const d = new Date(Date.now() - (11 - i) * 7 * DAY); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  return {
    as_of: new Date().toISOString(),
    tiles: Object.fromEntries(['open', 'lapsed', 'signed_90d', 'redemptions_90d'].map((t) => [t, ok({ count: 0 })]).concat([
      ['days_to_sign', ok({ median_days: null, over_signed: 0 })], ['active_deals', ok({ count: 0, ending_within_30d: 0, term_over_not_closed: 0 })],
      ['awaiting_signature', ok({ count: 0, invitation_lapsed: 0 })], ['failed_sends_30d', ok({ count: 0, by_reason: {} })]])),
    needs_you: { available: true, kinds: {}, rows: [], unreadable_kinds: [] },
    c1: ok({ stages: {}, closed: { signed: 0, lapsed: 0, revoked: 0, signed_after_lapse: 0 } }), c2: ok({ weeks: [] }), c3: ok({ by_type: {} }),
    c4: ok({ weeks: Array.from({ length: 12 }, (_, i) => ({ week_start: monday(i), referral: i, deal_sourcing_revshare: 0, other: 0 })) }),
  };
}

/** The desk's reads, answered; `routes` overrides one path (a function of the query) or adds one. */
function worker(routes = {}) {
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path, qs] = url.split('?');
    const q = new URLSearchParams(qs || '');
    const key = `${method} ${path}`;
    if (routes[key]) return routes[key](q, options);
    if (method === 'POST') return response({ ok: true });
    if (path === '/api/admin/partners/invitations') return response({ items: [] });
    if (path === '/api/admin/partners/deals') return response({ items: [], total: 0 });
    if (path === '/api/admin/partners/deals/top') return response({ items: [] });
    if (path === '/api/admin/contracts/partner-deals') return response({ items: [], total: 0, limit: 500, offset: 0 });
    if (path === '/api/admin/partners/links') return response({ accounts: [], firms: [] });
    if (path === '/api/admin/partners/agreement-ready') return response({ ready: true, reason: null, fields: [] });
    if (path === '/api/dd/cases') return response({ items: [] });
    if (path === '/api/admin/partners/redemptions') return response({ items: [], total: 0, page: 1, limit: 25, pages: 1 });
    if (/^\/api\/admin\/partners\/deals\/\d+\/redemptions$/.test(path)) return response({ deal: {}, items: [] });
    if (path === '/api/admin/partners/overview') return response(overviewReply());
    return response({ error: 'not stubbed' }, 404);
  };
}

async function mounted(url, handle, { phone = false } = {}) {
  const restore = installDocument('', { focus: true });
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET') }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: phone, addEventListener() {}, removeEventListener() {} });
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(PartnerInvitations))));
  const flush = () => act(async () => { for (let i = 0; i < 16; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    requests, flush,
    has: (id) => Boolean(byId(id)),
    textOf: (id) => text(byId(id)),
    props: (id) => props(byId(id)),
    testIds: () => nodes().map((n) => props(n)['data-testid']).filter(Boolean),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); assert.ok(!p.disabled, `${id} is disabled`); await act(async () => { await p.onClick(event); }); await flush(); },
    async press(label, scope) {
      const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
      const node = walk(byId(scope)).find((n) => String(n.tagName).toUpperCase() === 'BUTTON' && text(n).trim() === label);
      assert.ok(node, `no button "${label}" in ${scope}`);
      await act(async () => { await props(node).onClick(event); }); await flush();
    },
    async change(id, target) { await act(async () => { props(byId(id)).onChange({ target }); }); await flush(); },
    async wait(ms) { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; restore(); },
  };
}

const LIVE = Date.now();
const liveDeal = (id, o = {}) => deal(id, { activated_at: d1(LIVE - 300 * DAY), expires_at: iso(LIVE + 60 * DAY), created_at: d1(LIVE - 301 * DAY), ...o });
const dealsOf = (q) => q.getAll('status');
const listUrl = (requests) => requests.filter((r) => r.url.startsWith('/api/admin/partners/deals?') && /[?&]limit=25(&|$)/.test(r.url));

test('Deals reads D926\'s list: filters, sort and pages reach the Worker, and the pager says the exact total', async () => {
  // Mutations checked: the offset not sent; the total taken from the page's length.
  const rows = Array.from({ length: 25 }, (_, i) => liveDeal(i + 1));
  const view = await mounted('/admin/partner-invitations/deals', worker({
    'GET /api/admin/partners/deals': (q) => (q.get('limit') === '100' ? response({ items: [], total: 0 }) : response({ items: rows, total: 60 })),
  }));
  try {
    const first = listUrl(view.requests).at(-1).url;
    assert.match(first, /status=active/);
    assert.match(first, /sort=ends_soonest/);
    assert.match(first, /limit=25/);
    assert.doesNotMatch(first, /offset=/, 'the first page has no offset');
    assert.equal(view.textOf('partners-deals-range'), '1–25 of 60');
    await view.press('Next', 'partners-deals');
    assert.match(listUrl(view.requests).at(-1).url, /offset=25/);
    assert.equal(view.textOf('partners-deals-range'), '26–50 of 60');
    await view.click('partners-deals-chip-expired');
    await view.change('partners-deals-sort', { value: 'partner' });
    const asked = new URLSearchParams(listUrl(view.requests).at(-1).url.split('?')[1]);
    assert.deepEqual(asked.getAll('status'), ['active', 'expired']);
    assert.equal(asked.get('sort'), 'partner');
    assert.equal(asked.get('offset'), null, 'a new filter starts at page one');
    await view.change('partners-deals-search', { value: 'lio' });
    await view.wait(300);
    assert.equal(new URLSearchParams(listUrl(view.requests).at(-1).url.split('?')[1]).get('q'), 'lio', 'the search reaches the Worker once it settles');
    await view.click('partners-deals-chip-active');
    await view.click('partners-deals-chip-expired');
    assert.deepEqual(new URLSearchParams(listUrl(view.requests).at(-1).url.split('?')[1]).getAll('status'), ['all'], 'no chip is every state');
  } finally { await view.close(); }
});

test('on Deals each block draws its own state: a failed list leaves C5 drawn, and a failed C5 leaves the list', async () => {
  const listDown = await mounted('/admin/partner-invitations/deals', worker({
    'GET /api/admin/partners/deals': (q) => (q.get('limit') === '100' ? response({ items: [liveDeal(1, { expires_at: iso(LIVE + 10 * DAY) })], total: 1 }) : response({ error: 'down' }, 503)),
  }));
  try {
    assert.match(listDown.textOf('partners-deals-read-unreadable').trim(), /^The deals could not be read\. A failed list is not a claim that there are none\.Try again$/);
    assert.ok(!listDown.has('partners-deals-none'), 'never "No partner deals yet"');
    assert.ok(listDown.has('partners-c5-chart'), 'C5 is drawn');
    assert.equal(listDown.textOf('partners-c5-showing'), 'Showing 1 of 1 active deal');
  } finally { await listDown.close(); }
  const c5Down = await mounted('/admin/partner-invitations/deals', worker({
    'GET /api/admin/partners/deals': (q) => (q.get('limit') === '100' ? response({ error: 'down' }, 503) : response({ items: [liveDeal(1)], total: 1 })),
  }));
  try {
    assert.ok(c5Down.has('partners-c5-unreadable'));
    assert.ok(c5Down.has('partners-deals-row-1'), 'the list is drawn');
  } finally { await c5Down.close(); }
});

test('on a phone Deals is cards, a sort select, and a filter sheet whose "Show [n] deals" is the Worker\'s count for what it holds', async () => {
  const view = await mounted('/admin/partner-invitations/deals', worker({
    'GET /api/admin/partners/deals': (q) => {
      if (q.get('limit') === '1') return response({ items: [], total: dealsOf(q).includes('voided') ? 7 : 2 });
      return response({ items: [liveDeal(1)], total: 1 });
    },
  }), { phone: true });
  try {
    assert.ok(view.has('partners-deals-card-1') && !view.has('partners-deals-table'), 'cards, not the table');
    assert.ok(view.has('partners-deals-sort'));
    assert.equal(view.textOf('partners-deals-filters'), 'Filters');
    await view.click('partners-deals-filters');
    assert.equal(view.textOf('partners-deals-sheet-show'), 'Show 2 deals');
    await view.click('partners-deals-sheet-ended');
    assert.equal(view.textOf('partners-deals-sheet-show'), 'Show 7 deals', 'the count follows the sheet before it is applied');
    await view.click('partners-deals-sheet-show');
    const asked = new URLSearchParams(listUrl(view.requests).at(-1).url.split('?')[1]);
    assert.deepEqual(asked.getAll('status'), ['active', 'expired', 'terminated', 'voided'], 'Ended is term over, terminated and voided');
    assert.equal(view.textOf('partners-deals-filters'), 'Filters · 1');
  } finally { await view.close(); }
});

const dealRead = (o = {}) => ({
  deal: { ...liveDeal(7, { partner_name: 'Lio Testwell' }), proposal: null, proposal_unreadable: false, redemptions_total: 4 },
  invitation: null, invitation_missing: false, envelope: { id: 907, status: 'completed', sent_at: d1(LIVE - 302 * DAY), completed_at: d1(LIVE - 300 * DAY) },
  due_diligence: { match: 'one', case: { uid: 'dd-1', status: 'open', opened_at: d1(LIVE - 299 * DAY), kyb: { status: 'completed', verdict: 'pass' } }, candidates: [] },
  obligations: [{ key: 'kyb_v1', recorded: true, required: true, status: 'pending' }, { key: 'kyc_v1', recorded: false, required: null, status: null }],
  history: [{ kind: 'created', at: d1(LIVE - 301 * DAY) }, { kind: 'terminated', at: d1(LIVE - 1 * DAY), by_user_id: 3, by_name: 'Ada Admin', reason: 'Breach' }],
  ...o,
});

test('one deal from D928\'s read: the KYB section, each obligation, and the history with who terminated', async () => {
  const view = await mounted('/admin/partner-invitations/deals/7', worker({ 'GET /api/admin/partners/deals/7': () => response(dealRead()) }));
  try {
    assert.match(view.textOf('partners-deal-dd-case'), /^Case: Open · opened /);
    assert.equal(view.textOf('partners-deal-kyb'), 'KYB section: Completed');
    assert.doesNotMatch(view.textOf('partners-deal-dd'), /Cleared/);
    assert.match(view.textOf('partners-deal-obligation-kyb_v1'), /^KYBOutstanding/);
    assert.match(view.textOf('partners-deal-obligation-kyc_v1'), /^KYCNot recordedNever opened for this member$/);
    assert.match(view.textOf('partners-deal-history-list'), /Terminated · .* · by Ada Admin · Breach$/);
    assert.equal(view.textOf('partners-deal-count'), 'Redemptions: 4', 'D928\'s uncapped count');
  } finally { await view.close(); }
});

test('"Signed, deal not activated" opens Re-run activation in a dialog that says what it does; its refusal and result stay inside it', async () => {
  // Mutation checked: the button shown on an active deal.
  let tries = 0;
  const pending = dealRead({ deal: { ...dealRead().deal, status: 'awaiting_signature', activated_at: null, activation_failed_at: iso(LIVE - DAY) }, history: [] });
  const view = await mounted('/admin/partner-invitations/deals/7', worker({
    'GET /api/admin/partners/deals/7': () => response(pending),
    'POST /api/admin/partners/deals/7/activate': () => { tries += 1; return tries === 1 ? response({ error: 'Activation failed', code: 'activation_failed' }, 503) : response({ ok: true, activated: true }); },
  }));
  try {
    assert.match(view.textOf('partners-deal-not-activated'), /^Signed, deal not activated\. Activation failed /);
    assert.equal(view.textOf('partners-deal-agreement-state'), 'Signed, deal not activated');
    await view.click('partners-deal-rerun');
    assert.match(view.textOf('partners-rerun-lines'), /This runs the activation again\./);
    assert.match(view.textOf('partners-rerun-lines'), /A plan the partner pays for is kept\./);
    await view.click('partners-rerun-go');
    assert.equal(view.textOf('partners-rerun-go-refusal'), 'Activation failed again. Nothing changed, and the failure is kept on the deal.');
    await view.click('partners-rerun-go');
    assert.equal(view.textOf('partners-rerun-result'), 'Activated. The deal is active.');
    assert.ok(view.has('partners-rerun-dialog'), 'the result stays in the dialog');
  } finally { await view.close(); }
  const active = await mounted('/admin/partner-invitations/deals/7', worker({ 'GET /api/admin/partners/deals/7': () => response(dealRead()) }));
  try { assert.ok(!active.has('partners-deal-rerun'), 'an active deal offers no re-run'); } finally { await active.close(); }
});

test('Terminate states D928\'s preview count; a preview that could not be read says so, with Try again, and never a number', async () => {
  let previews = 0;
  const view = await mounted('/admin/partner-invitations/deals/7', worker({
    'GET /api/admin/partners/deals/7': () => response(dealRead({ history: [] })),
    'GET /api/admin/partners/deals/7/terminate-preview': () => {
      previews += 1;
      return previews === 1 ? response({ error: 'down' }, 503)
        : response({ deal_id: 7, status: 'active', can_terminate: true, partner: { founder_still_granted: true }, registered: 6, members_losing: 4, members: [], members_truncated: false });
    },
  }));
  try {
    await view.click('partners-deal-terminate');
    assert.match(view.textOf('partners-terminate-lines'), /^Who would lose a grant could not be read\. That is not a claim that nobody would\./);
    assert.doesNotMatch(view.textOf('partners-terminate-lines'), /\d/);
    await view.click('partners-terminate-preview-retry');
    assert.match(view.textOf('partners-terminate-lines'), /4 members lose the grant this deal gave them\./);
    assert.match(view.textOf('partners-terminate-lines'), /The tiers this deal granted Lio Testwell end now\./);
  } finally { await view.close(); }
});

/** D928's cross-deal read over `rows`, with its filters, sort and pages as the Worker applies them. */
function crossDeal(rows, { down = [] } = {}) {
  return (q) => {
    const kind = q.get('window_within') ? 'windows' : q.get('from') ? 'from' : q.get('limit') === '1' ? 'count' : 'page';
    if (down.includes(kind)) return response({ error: 'down' }, 503);
    let out = rows;
    if (q.get('deal')) out = out.filter((r) => String(r.deal_id) === q.get('deal'));
    if (q.get('window_within')) out = out.filter((r) => r.deal_type === 'deal_sourcing_revshare' && r.window_days_left > 0 && r.window_days_left <= Number(q.get('window_within')));
    if (q.get('from')) out = out.filter((r) => r.redeemed_at.slice(0, 10) >= q.get('from'));
    const limit = Number(q.get('limit')) || 25;
    const page = Number(q.get('page')) || 1;
    return response({ items: out.slice((page - 1) * limit, page * limit), total: out.length, page, limit, pages: Math.max(1, Math.ceil(out.length / limit)) });
  };
}

test('Referrals is D928\'s cross-deal read: exact tiles, windows on active deals only, the member\'s role, and Every redemption paged by the Worker', async () => {
  // Mutations checked: the page not sent; the role column dropped; an ended deal's window in the tile.
  const rows = [
    ...Array.from({ length: 58 }, (_, i) => red(i + 1, { redeemed_at: d1(LIVE - (i + 1) * 3 * DAY) })),
    red(101, { deal_type: 'deal_sourcing_revshare', window_days_left: 20, member_role: 'investor', deal_id: 9 }),
    red(102, { deal_type: 'deal_sourcing_revshare', window_days_left: 50, deal_status: 'terminated', deal_id: 9 }),
  ];
  const view = await mounted('/admin/partner-invitations/referrals', worker({ 'GET /api/admin/partners/redemptions': crossDeal(rows) }));
  try {
    assert.equal(view.textOf('partners-ref-tile-all'), 'Redemptions, all time60');
    assert.equal(view.textOf('partners-ref-tile-open'), 'Rev-share windows open1On active deals only');
    assert.equal(view.textOf('partners-ref-tile-closing'), 'Closing within 30 days1');
    assert.ok(view.has('partners-c4-chart') && view.has('partners-c6-chart'));
    assert.equal(view.textOf('partners-c6-showing'), 'Showing 1 of 1 open window');
    assert.equal(view.textOf('partners-ref-range'), '1–25 of 60');
    assert.match(view.textOf('partners-ref-row-1'), /Role: Founder/);
    await view.press('Next', 'partners-referrals-table-card');
    const page = view.requests.filter((r) => r.url.startsWith('/api/admin/partners/redemptions?') && /limit=25/.test(r.url)).at(-1).url;
    assert.match(page, /page=2/);
    assert.equal(view.textOf('partners-ref-range'), '26–50 of 60');
    await view.press('Next', 'partners-referrals-table-card');
    assert.equal(view.textOf('partners-ref-range'), '51–60 of 60');
    assert.match(view.textOf('partners-ref-row-101'), /Role: Investor.*20 days left/);
    assert.match(view.textOf('partners-ref-row-102'), /Deal ended$/);
  } finally { await view.close(); }
  const one = await mounted('/admin/partner-invitations/referrals?deal=9', worker({ 'GET /api/admin/partners/redemptions': crossDeal(rows) }));
  try {
    assert.ok(one.requests.some((r) => /redemptions\?.*deal=9/.test(r.url)), '?deal= reaches the Worker');
    assert.equal(one.textOf('partners-ref-range'), '1–2 of 2');
  } finally { await one.close(); }
});

test('on Referrals each block draws its own state: a failed window read costs C6 and two tiles, never the table or C4', async () => {
  const rows = [red(1), red(2, { deal_type: 'deal_sourcing_revshare', window_days_left: 9 })];
  const view = await mounted('/admin/partner-invitations/referrals', worker({ 'GET /api/admin/partners/redemptions': crossDeal(rows, { down: ['windows'] }) }));
  try {
    assert.ok(view.has('partners-c6-unreadable'));
    for (const key of ['open', 'closing']) assert.match(view.textOf(`partners-ref-tile-${key}`), /could not be read.*Try again$/, key);
    assert.equal(view.textOf('partners-ref-tile-all'), 'Redemptions, all time2');
    assert.ok(view.has('partners-c4-chart'));
    assert.ok(view.has('partners-ref-row-1'));
  } finally { await view.close(); }
  const tableDown = await mounted('/admin/partner-invitations/referrals', worker({ 'GET /api/admin/partners/redemptions': crossDeal(rows, { down: ['page'] }) }));
  try {
    assert.ok(tableDown.has('partners-ref-read-unreadable'));
    assert.ok(!tableDown.has('partners-ref-none'), 'never "No member has registered"');
    assert.ok(tableDown.has('partners-c6-chart'), 'C6 is drawn');
  } finally { await tableDown.close(); }
});
