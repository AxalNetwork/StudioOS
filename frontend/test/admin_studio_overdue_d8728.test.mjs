/**
 * D8728 (#8728) — Admin Studio: the overdue decision first, carried into a
 * filtered Approvals and back.
 *
 * One fixture runs through every test: a territory, [Lisbon Studio], whose
 * inbox holds three waiting items — one overdue (a Spin-Out Lab application,
 * 4 d 2 h, unassigned) and two on time (KYC 1 d 6 h, Events 5 h) — and an
 * admin bank with 0 of 11 answers recorded. Studio's count and the landing's
 * rows are checked against the same reply, including zero and unreadable.
 * All names and figures are fictional.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';

import {
  FROM_STUDIO, OVERDUE_TO, RETURN_KEY, fromStudio, keepStudio, laneTo, overdueView, rememberStudioExit, takeStudioExit,
} from '../src/pages/admin/studioOverdue.js';
import StudioOverdueCard, { OPEN_IDS, REVIEW_ID, laneLinkId } from '../src/pages/admin/StudioOverdueCard.jsx';
import { StudioNeedsDecisionView, glanceExceptions } from '../src/pages/admin/StudioNeedsDecision.jsx';
import { StudioSetupRow } from '../src/pages/admin/StudioSetup.jsx';
import StudioSetup from '../src/pages/admin/StudioSetup.jsx';
import { StudioPostureView } from '../src/pages/admin/StudioPosture.jsx';
import { hiddenByFilter, inboxRows } from '../src/pages/admin/approvals/inboxModel.js';
import { ApprovalsPage } from '../src/pages/admin/approvals/AdminApprovals.jsx';
import { resultCount } from '../src/pages/admin/approvals/ApprovalsInbox.jsx';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';

const h = React.createElement;
const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (el, url = '/studio') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [url] }, el));
const text = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ fixture

const LANES = [
  { key: 'cohort', label: 'Spin-Out Lab applications', group: 'programs', count: 1, bands: { ok: 0, due_soon: 0, past: 1, unknown: 0 } },
  { key: 'kyc', label: 'KYC', group: 'people', count: 1, bands: { ok: 0, due_soon: 1, past: 0, unknown: 0 } },
  { key: 'events', label: 'Events', group: 'community', count: 1, bands: { ok: 1, due_soon: 0, past: 0, unknown: 0 } },
];
const OVERDUE_ITEM = {
  lane: 'cohort', lane_label: 'Spin-Out Lab applications', id: 219, who: '[Rui Matos]', what: 'Spin-Out Lab application',
  created_at: '2026-11-22 06:10:00', age_hours: 98, sla: 'past', assignee: null,
};
/** `GET /api/admin/approvals?age=past` as the Worker answers it for the fixture. */
const PAST = {
  items: [OVERDUE_ITEM], total: 1, unfiltered_total: 3, page: 1, page_size: 25,
  lanes: LANES, unreadable: [], tiles: { over_72h: 1, unassigned: 2 }, reviewers: [{ id: 7, name: 'Admin A' }],
};
const ALL = {
  ...PAST,
  items: [
    OVERDUE_ITEM,
    { lane: 'kyc', lane_label: 'KYC', id: 4, who: '[Inês Duarte]', what: 'KYC · founder', age_hours: 30, sla: 'due_soon', assignee: { user_id: 7, name: 'Admin A' } },
    { lane: 'events', lane_label: 'Events', id: 9, who: '[Marta Silva]', what: 'Event', age_hours: 5, sla: 'ok', assignee: null },
  ],
  total: 3,
};
delete ALL.unfiltered_total;
const EMPTY_LANES = LANES.map((l) => ({ ...l, count: 0, bands: { ok: 0, due_soon: 0, past: 0, unknown: 0 } }));
const ready = (reply) => ({ status: 'ready', reply });
const TERR = '[Lisbon Studio]';

const card = (read, extra = {}) => html(h(StudioOverdueCard, { read, scope: TERR, ...extra }));

// ------------------------------------------------------------------ the card

test('the overdue card: the count, the item, its age and owner, and one action to the filtered Inbox', () => {
  const t = text(card(ready(PAST)));
  assert.match(t, /^1 overdue · over 72 hours in Approvals · \[Lisbon Studio\]/, 'the count is not first, or not in the Inbox\'s words');
  assert.match(t, /\[Rui Matos\] Spin-Out Lab application Lane: Spin-Out Lab applications 4 d 2 h ! Overdue Unassigned No one holds it yet/);
  assert.match(t, /Review overdue in Approvals →/);
  assert.match(t, /2 more waiting under 72 hours, not overdue\./);
  const m = card(ready(PAST));
  assert.match(m, new RegExp(`id="${REVIEW_ID}"[^>]*href="/admin/approvals\\?age=past"|href="/admin/approvals\\?age=past"[^>]*id="${REVIEW_ID}"`));
  assert.equal(OVERDUE_TO, '/admin/approvals?age=past');
  assert.doesNotMatch(t, /Past the window/, 'the retired band word is back');
  // One primary action: the item row is text, not a second control.
  assert.equal((m.match(/href="\/admin\/approvals\?age=past"/g) || []).length, 1);
});

test('Studio\'s count and the landing\'s rows come from one reply: 1 overdue is 1 row, 0 is 0, and a failure is neither', () => {
  for (const reply of [PAST, { ...PAST, items: [], total: 0, unfiltered_total: 2, lanes: LANES.map((l) => ({ ...l, bands: { ...l.bands, past: 0 } })) }]) {
    const v = overdueView(ready(reply));
    assert.equal(v.overdue, inboxRows(reply).length, 'Studio counts a different number than the Inbox lists');
    assert.equal(v.overdue, reply.total);
  }
  const failed = text(card({ status: 'error', reply: null }));
  assert.match(failed, /Approvals could not be read/);
  assert.match(failed, /This is not a claim that nothing is overdue/);
  assert.match(failed, /Retry/, 'the platform\'s Unavailable has no retry');
  assert.doesNotMatch(failed, /\b0\b|nothing needs a decision|Every lane answered/, 'a failed read was drawn as zero or all clear');
  assert.equal(overdueView({ status: 'loading' }).state, 'loading');
  assert.match(text(card({ status: 'loading' })), /Reading the approval queue…/);
});

test('zero overdue: two on time is a quiet line, an empty territory is all clear, and all clear is never claimed beside another exception', () => {
  const quietReply = { ...PAST, items: [], total: 0, unfiltered_total: 2, lanes: LANES.map((l) => ({ ...l, bands: { ...l.bands, past: 0 } })) };
  const quiet = text(card(ready(quietReply)));
  assert.match(quiet, /^0 overdue · 2 waiting under 72 hours Nothing is overdue\./);
  assert.doesNotMatch(quiet, /nothing needs a decision|Every lane answered/);

  const clearReply = { ...PAST, items: [], total: 0, unfiltered_total: 0, lanes: EMPTY_LANES };
  const clear = text(card(ready(clearReply)));
  assert.match(clear, /^0 nothing needs a decision ✓ Every lane answered/);
  assert.match(clear, /Nothing is waiting in Approvals for \[Lisbon Studio\]: all 3 lanes answered with 0 open\./);

  const beside = text(card(ready(clearReply), { othersWaiting: true }));
  assert.doesNotMatch(beside, /nothing needs a decision/, 'all clear was claimed while a programme gate is closing');

  // No on-time figure sent: neither "2 waiting" nor "every lane answered".
  const unsent = overdueView(ready({ ...clearReply, unfiltered_total: undefined }));
  assert.equal(unsent.kind, 'zero');
});

test('a lane that did not answer is Partial, a floor ("1+"), and never all clear', () => {
  const partial = { ...PAST, unreadable: ['Events'], lanes: LANES.map((l) => (l.key === 'events' ? { ...l, count: null, bands: null } : l)) };
  const v = overdueView(ready(partial));
  assert.equal(v.figure, '1+');
  const t = text(card(ready(partial)));
  assert.match(t, /Partial · 2 of 3 lanes/);
  assert.match(t, /Events could not be read, so there may be more overdue\./);
  const zero = { ...partial, items: [], total: 0, unfiltered_total: 2, lanes: partial.lanes.map((l) => (l.bands ? { ...l, bands: { ...l.bands, past: 0 } } : l)) };
  const z = text(card(ready(zero)));
  assert.equal(overdueView(ready(zero)).kind, 'partial-zero');
  assert.doesNotMatch(z, /nothing needs a decision|Every lane answered/);
  // A total the Worker withheld is a floor too, never short.
  assert.equal(overdueView(ready({ ...PAST, total: null, tiles: { at_least: { over_72h: 25 } } })).figure, '25+');
});

test('overdue in two lanes: each lane line carries its lane into the Inbox\'s address', () => {
  const two = {
    ...PAST,
    items: [OVERDUE_ITEM, { ...OVERDUE_ITEM, id: 220, age_hours: 80 }, { lane: 'kyc', lane_label: 'KYC', id: 4, who: 'X', what: 'KYC', age_hours: 73, sla: 'past', assignee: null }],
    total: 3,
    unfiltered_total: 5,
    lanes: [{ ...LANES[0], count: 2, bands: { ok: 0, due_soon: 0, past: 2, unknown: 0 } }, { ...LANES[1], bands: { ok: 0, due_soon: 0, past: 1, unknown: 0 } }, LANES[2]],
  };
  const m = card(ready(two));
  const t = text(m);
  assert.match(t, /^3 overdue · over 72 hours in 2 lanes/);
  assert.match(t, /Spin-Out Lab applications · 2 overdue · oldest 4 d 2 h Lane: Spin-Out Lab applications →/);
  assert.match(t, /Review 3 overdue in Approvals →/);
  assert.match(m, /href="\/admin\/approvals\?age=past&amp;lane=cohort"/);
  assert.match(m, /href="\/admin\/approvals\?age=past&amp;lane=kyc"/);
  assert.equal(laneTo('cohort'), '/admin/approvals?age=past&lane=cohort');
});

test('a suspended territory still shows what is overdue, and says deciding is blocked', () => {
  const t = text(card(ready(PAST), { frozen: true }));
  assert.match(t, /^1 overdue/);
  assert.match(t, /Suspended · writes are blocked\. Reading is never gated\./);
});

// ------------------------------------------------------------------ the page order

const BRANCH_USER = { role: 'admin', branch: { code: 'pt', name: TERR, territories: ['[Portugal]'], status: 'active' } };
const BRANCH_GLANCE = {
  tier: 'branch',
  seats: { recorded: true, seats_used_by_type: { founder: 18, investor: 0, advisor: 0, partner: 0 }, seats: { founder: 25, investor: 1, advisor: 1, partner: 1 } },
  approvals: { recorded: true, lanes: [{ key: 'cohort', label: 'Spin-Out Lab applications', count: 1, oldest_age_hours: 98, sla: 'past' }] },
  programme: { recorded: true, open_week: 4, zone: 'Europe/Lisbon', week_closes_at: '2026-11-30T18:00:00.000Z', hours_to_close: 90 },
  agreements: { recorded: true, expiring: 0, window_days: 60, undated: { reason: 'r' } },
  revenue: { recorded: true, share_bps: 2000 },
  licence: { recorded: true, revenue_share_bps: 2000, status: 'active', kind: 'subsidiary', domain_available: false, domain_reason: 'hq' },
  templates: { recorded: true, available: true, items: [{ slug: 'a' }], pushed_at: null },
  insights: { recorded: true, benchmarks_available: true, benchmarks: [] },
};

test('Needs a decision comes first and holds the overdue card; the totals are At a glance, after it', () => {
  const m = html(h(StudioNeedsDecisionView, { user: BRANCH_USER, glance: BRANCH_GLANCE, overdue: ready(PAST) }));
  const at = (s) => m.indexOf(s);
  assert.ok(at('Needs a decision') >= 0 && at('Needs a decision') < at('studio-overdue-count'));
  assert.ok(at('studio-overdue-count') < at('At a glance'), 'the overdue card is not ahead of the totals');
  assert.ok(at('At a glance') < at('studio-decide-approvals'), 'a total sits under Needs a decision');
  assert.match(text(m), /At a glance Totals for information · nothing here is due/);
  assert.doesNotMatch(m, /Past the window|Due soon/, 'At a glance carries an urgency word');
  // The scope the card names is the territory.
  assert.match(text(m), /in Approvals · \[Lisbon Studio\]/);
});

test('a programme gate closing within 24 hours is a second exception under Needs a decision, worst first', () => {
  const glance = { ...BRANCH_GLANCE, programme: { ...BRANCH_GLANCE.programme, hours_to_close: 19 } };
  const m = html(h(StudioNeedsDecisionView, { user: BRANCH_USER, glance, overdue: ready({ ...PAST, items: [], total: 0, unfiltered_total: 0, lanes: EMPTY_LANES }) }));
  assert.ok(m.indexOf('studio-exception-programme') > 0 && m.indexOf('studio-exception-programme') < m.indexOf('At a glance'));
  assert.match(text(m), /Programme · Closes within 24 hours/);
  assert.doesNotMatch(text(m), /nothing needs a decision/, 'all clear beside a closing gate');
  const ex = glanceExceptions([
    { key: 'approvals', glance: { kind: 'ready', sla: 'past', unreadable: 0 } },
    { key: 'programme', glance: { kind: 'ready', hoursToClose: 12 } },
    { key: 'contracts', glance: { kind: 'unreadable', reason: 'x' } },
  ]);
  assert.deepEqual(ex.map((t) => t.key), ['programme'], 'Approvals or an unreadable tile became an exception');
});

test('the page: Needs a decision, then Setup, then Admin pages; the chat is mounted once, inside Setup', () => {
  const src = codeOnly(read('frontend/src/pages/admin/AdminStudioHome.jsx'));
  const decide = src.indexOf('<StudioNeedsDecisionView');
  const setup = src.indexOf('<StudioSetup');
  const pages = src.indexOf('<AdminStudioOverview');
  assert.ok(decide > 0 && decide < setup && setup < pages, 'the order is not Needs a decision, Setup, Admin pages');
  assert.match(src, /<StudioSetup chat=\{<StudioInterview persona="admin" \/>\} \/>/);
  assert.doesNotMatch(src, /<StudioPosture\b/, 'the posture is a section above the decisions again');
  assert.doesNotMatch(src, /useEffect|useState|\bapi\b/, 'the page reads something of its own (D512)');
});

// ------------------------------------------------------------------ setup

const UNANSWERED = {
  available: true, bank_size: 11, recorded: 0,
  fields: Array.from({ length: 11 }, (_, i) => ({ id: `admin.q${i}`, section: ['OVERSIGHT', 'OPERATIONS', 'GOVERNANCE', 'PREFS'][i % 4], label: `Q${i}`, state: 'not_recorded', value: null })),
};

test('eleven unanswered questions are one Setup row with one Resume setup, not eleven links', () => {
  const row = html(h(StudioSetupRow, { posture: UNANSWERED, open: false, onToggle: () => {} }));
  assert.match(text(row), /Admin setup with Eadwyn · 11 answers remaining 0 of 11 admin-bank questions recorded · Oversight, Operations, Governance, Preferences Resume setup/);
  assert.match(row, /aria-expanded="false"[^>]*aria-controls="studio-chat"|aria-controls="studio-chat"[^>]*aria-expanded="false"/);
  assert.equal(html(h(StudioPostureView, { posture: UNANSWERED })), '', 'unanswered questions are listed again');
  const page = html(h(StudioSetup, { chat: h('div', { id: 'studio-chat' }, 'CHAT') }));
  assert.doesNotMatch(page, /CHAT/, 'the chat is open before Resume setup');
  assert.doesNotMatch(page, /Continue in the chat/);
  const opened = html(h(StudioSetupRow, { posture: UNANSWERED, open: true, onToggle: () => {} }));
  assert.match(opened, /aria-expanded="true"/);
  assert.match(text(opened), /Close setup/);
  // A failed count read is Unavailable, never "0 of 11".
  const failed = text(html(h(StudioSetupRow, { posture: { available: false }, open: false, onToggle: () => {} })));
  assert.match(failed, /Setup progress could not be read/);
  assert.doesNotMatch(failed, /0 of 11|answers remaining/);
});

// ------------------------------------------------------------------ the landing

const STUDIO_ADMIN = { id: 7, role: 'admin', is_super_admin: 0, branch: { code: 'pt', name: TERR } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function mountLanding(entry, viewer = STUDIO_ADMIN, inbox = (p) => json(p.get('age') === 'past' ? PAST : ALL)) {
  const restore = installDocument('', { focus: true });
  const original = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const x = new URL(String(u), 'http://x');
    if (x.pathname === '/api/admin/approvals') return inbox(x.searchParams);
    if (x.pathname === '/api/admin/studio/glance') return json({ tier: 'branch', approvals: { lanes: [] } });
    return json({});
  };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: null, state: null };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}`; at.state = l.state; return null; }
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [entry] }, h(Routes, null, h(Route, { path: '*', element: h(ApprovalsPage, { viewer }) })), h(Probe))); });
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n?.nodeType === 3 ? n.textContent || '' : n?.childNodes?.length ? n.childNodes.map(textOf).join('') : n?.textContent || '');
  const props = (n) => (n ? Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {} : {});
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  return {
    at,
    has: (id) => Boolean(byId(id)),
    of: (id) => { const n = byId(id); assert.ok(n, `no ${id}`); return textOf(n); },
    props: (id) => props(byId(id)),
    async click(id) { const p = props(byId(id)); await act(async () => { await p.onClick({ button: 0, preventDefault() {}, stopPropagation() {} }); }); await flush(); },
    async unmount() { await act(async () => root.unmount()); globalThis.fetch = original; restore(); },
  };
}

test('opened from Studio, the landing shows the crumb, the territory, the chip, Filters · 1, one result and what the filter hides', async () => {
  const v = await mountLanding({ pathname: '/admin/approvals', search: '?age=past', state: FROM_STUDIO });
  try {
    assert.ok(v.has('admin-page-crumb'), 'no Studio crumb');
    assert.match(v.of('admin-page-crumb'), /Studio›Approvals/);
    assert.equal(v.props('admin-page-back').href, '/studio');
    assert.match(v.of('admin-page-scope'), /\[Lisbon Studio\] · this territory/);
    assert.match(v.of('approvals-chips'), /Age: Over 72 hours/);
    assert.match(v.of('approvals-chips'), /1 result/);
    assert.equal(v.of('approvals-filters-count'), '1');
    assert.match(v.of('approvals-hidden'), /^2 more waiting are hidden by this filter\.$/);
    // The same reply Studio counted: one overdue on Studio, one row here.
    assert.equal(overdueView(ready(PAST)).overdue, 1);
    assert.match(v.of('approvals-count'), /1–1 of 1/);
  } finally { await v.unmount(); }
});

test('refining the filter keeps the crumb; a direct visit or a shared link has none', async () => {
  const v = await mountLanding({ pathname: '/admin/approvals', search: '?age=past', state: FROM_STUDIO });
  try {
    await v.click('approvals-chip-remove-age');
    assert.equal(v.at.path, '/admin/approvals');
    assert.ok(fromStudio(v.at.state), 'the router state was dropped on a filter change');
    assert.ok(v.has('admin-page-crumb'), 'the crumb went with the filter');
  } finally { await v.unmount(); }
  const direct = await mountLanding('/admin/approvals?age=past');
  try {
    assert.ok(!direct.has('admin-page-crumb'), 'a direct visit claims it came from Studio');
    assert.ok(!direct.has('admin-page-back'));
  } finally { await direct.unmount(); }
});

test('a failed landing keeps its filter and says so; HQ keeps its fixed scope label', async () => {
  const v = await mountLanding({ pathname: '/admin/approvals', search: '?age=past', state: FROM_STUDIO }, STUDIO_ADMIN, () => json({ detail: 'down' }, 503));
  try {
    assert.match(v.of('approvals-failed'), /Your filter Age: Over 72 hours is kept\./);
    assert.ok(v.has('admin-page-crumb'));
  } finally { await v.unmount(); }
  const hq = await mountLanding('/admin/approvals?age=past', { id: 7, role: 'admin', is_super_admin: 0 });
  try {
    assert.match(hq.of('admin-page-scope'), /HQ-held accounts · axal\.vc/);
  } finally { await hq.unmount(); }
});

test('hiddenByFilter: a count of what the filter leaves out, or nothing rather than a guess', () => {
  assert.equal(hiddenByFilter(PAST, { age: 'past' }), '2 more waiting are hidden by this filter.');
  assert.equal(hiddenByFilter({ ...PAST, unfiltered_total: 2 }, { age: 'past' }), '1 more waiting is hidden by this filter.');
  assert.equal(hiddenByFilter(PAST, { age: 'past', lane: 'cohort' }), '2 more waiting are hidden by these filters.');
  assert.equal(hiddenByFilter({ ...PAST, total: null }, { age: 'past' }), null, 'a withheld total was guessed');
  assert.equal(hiddenByFilter(ALL, {}), null, 'an unfiltered read claims a hidden remainder');
  assert.equal(hiddenByFilter({ ...PAST, unfiltered_total: 1 }, { age: 'past' }), null);
  assert.equal(hiddenByFilter(PAST, {}), null, 'no chip, so no filter to name');
});

// ------------------------------------------------------------------ the way back

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test('the way out notes the scroll and the control; the way back takes the note once', () => {
  const store = memoryStore();
  rememberStudioExit(REVIEW_ID, { scrollY: 412.4, now: 1000, store });
  assert.deepEqual(takeStudioExit({ now: 2000, store }), { target: REVIEW_ID, y: 412 });
  assert.equal(takeStudioExit({ now: 2000, store }), null, 'the note was taken twice');
  rememberStudioExit(REVIEW_ID, { scrollY: 10, now: 0, store });
  assert.equal(takeStudioExit({ now: 31 * 60 * 1000, store }), null, 'a stale note restored an old position');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  assert.doesNotThrow(() => rememberStudioExit(REVIEW_ID, { store: blocked }));
  assert.equal(takeStudioExit({ store: blocked }), null);
  assert.equal(RETURN_KEY, 'axal:studio-return');
});

test('back on Studio, the card restores the scroll and puts focus on the action that left it', async () => {
  const restore = installDocument('', { focus: true });
  const store = memoryStore();
  const prev = { ss: globalThis.sessionStorage, st: globalThis.scrollTo };
  globalThis.sessionStorage = store;
  let scrolled = null;
  globalThis.scrollTo = (x, y) => { scrolled = y; };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => (n ? Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {} : {});
  document.getElementById = (id) => walk(container).find((n) => props(n).id === id) || null;
  const root = createRoot(container);
  try {
    rememberStudioExit(REVIEW_ID, { scrollY: 300, store });
    await act(async () => { root.render(h(MemoryRouter, null, h(StudioOverdueCard, { read: ready(PAST), scope: TERR }))); });
    assert.equal(scrolled, 300, 'the scroll was not restored');
    assert.equal(props(document.activeElement).id, REVIEW_ID, 'focus is not on the action that left');
    assert.equal(store.getItem(RETURN_KEY), null, 'the note outlived the return');

    // The item was decided meanwhile: no action to return to, so focus lands on the heading.
    await act(async () => root.unmount());
    const second = createRoot(container);
    const heading = document.createElement('h2');
    Object.defineProperty(heading, 'id', { value: 'studio-decide-heading' });
    container.appendChild(heading);
    document.getElementById = (id) => (id === 'studio-decide-heading' ? heading : walk(container).find((n) => props(n).id === id) || null);
    rememberStudioExit(REVIEW_ID, { scrollY: 0, store });
    const clear = { ...PAST, items: [], total: 0, unfiltered_total: 0, lanes: EMPTY_LANES };
    await act(async () => { second.render(h(MemoryRouter, null, h(StudioOverdueCard, { read: ready(clear), scope: TERR }))); });
    assert.equal(document.activeElement, heading, 'focus fell to the top of the page');
    await act(async () => second.unmount());
  } finally {
    globalThis.sessionStorage = prev.ss;
    globalThis.scrollTo = prev.st;
    restore();
  }
});

// ------------------------------------------------------------------ part 3 (D8728-p3)

/** A live card in the fake DOM, with sessionStorage and getElementById wired to it. */
async function mountCard(read, extra = {}) {
  const restore = installDocument('', { focus: true });
  const store = memoryStore();
  const prev = { ss: globalThis.sessionStorage, st: globalThis.scrollTo };
  globalThis.sessionStorage = store;
  globalThis.scrollTo = () => {};
  const container = document.createElement('div');
  document.body.appendChild(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => (n ? Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {} : {});
  document.getElementById = (id) => walk(container).find((n) => props(n).id === id) || null;
  const root = createRoot(container);
  const at = { path: null, state: null };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}`; at.state = l.state; return null; }
  return {
    store, at, props,
    byId: (id) => walk(container).find((n) => props(n)['data-testid'] === id),
    async render() { await act(async () => { root.render(h(MemoryRouter, { initialEntries: ['/studio'] }, h(StudioOverdueCard, { read, scope: TERR, ...extra }), h(Probe))); }); },
    async click(id) {
      const p = props(walk(container).find((n) => props(n)['data-testid'] === id));
      assert.ok(p.onClick, `no ${id}`);
      await act(async () => { p.onClick({ button: 0, defaultPrevented: false, preventDefault() {}, stopPropagation() {}, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, currentTarget: { target: '' } }); });
    },
    async unmount() {
      await act(async () => root.unmount());
      globalThis.sessionStorage = prev.ss;
      globalThis.scrollTo = prev.st;
      restore();
    },
  };
}

const TWO_LANES = {
  ...PAST,
  items: [OVERDUE_ITEM, { lane: 'kyc', lane_label: 'KYC', id: 4, who: 'X', what: 'KYC', age_hours: 73, sla: 'past', assignee: null }],
  total: 2,
  unfiltered_total: 3,
  lanes: [LANES[0], { ...LANES[1], bands: { ok: 0, due_soon: 0, past: 1, unknown: 0 } }, LANES[2]],
};

test('part 3: every way from the card into Approvals sends Studio\'s state and notes itself, so Back returns to that control', async () => {
  const cases = [
    [TWO_LANES, laneLinkId('kyc'), '/admin/approvals?age=past&lane=kyc'],
    [PAST, OPEN_IDS.onTime, '/admin/approvals'],
    [{ ...PAST, items: [], total: 0, unfiltered_total: 2, lanes: LANES.map((l) => ({ ...l, bands: { ...l.bands, past: 0 } })) }, OPEN_IDS.zero, '/admin/approvals'],
    [{ ...PAST, items: [], total: 0, unfiltered_total: 0, lanes: EMPTY_LANES }, OPEN_IDS.decided, '/admin/approvals/decided'],
  ];
  for (const [reply, id, path] of cases) {
    const v = await mountCard(ready(reply));
    try {
      await v.render();
      assert.equal(v.props(v.byId(id)).id, id, `${id} carries no id to return focus to`);
      await v.click(id);
      assert.equal(v.at.path, path, `${id} opened the wrong place`);
      assert.ok(fromStudio(v.at.state), `${id} did not tell Approvals that Studio opened it`);
      assert.equal(takeStudioExit({ store: v.store })?.target, id, `${id} left no note, so Back cannot return to it`);
    } finally { await v.unmount(); }
  }
  const failed = await mountCard({ status: 'error', reply: null });
  try {
    await failed.render();
    await failed.click(OPEN_IDS.unavailable);
    assert.equal(takeStudioExit({ store: failed.store })?.target, OPEN_IDS.unavailable);
  } finally { await failed.unmount(); }
});

test('part 3: back from a lane line, focus lands on that lane line, not on the primary action', async () => {
  const v = await mountCard(ready(TWO_LANES));
  try {
    rememberStudioExit(laneLinkId('kyc'), { scrollY: 0, store: v.store });
    await v.render();
    assert.equal(v.props(document.activeElement).id, laneLinkId('kyc'));
  } finally { await v.unmount(); }
});

test('part 3: keepStudio passes on Studio\'s marker only', () => {
  assert.equal(keepStudio(FROM_STUDIO), FROM_STUDIO);
  assert.equal(keepStudio({ from: '/studio', other: 1 }), FROM_STUDIO);
  assert.equal(keepStudio(null), undefined);
  assert.equal(keepStudio({ moved: true }), undefined, 'unrelated router state was carried into an item');
});

test('part 3: opening and closing an item keeps Studio\'s crumb; a direct visit still has none', async () => {
  const v = await mountLanding({ pathname: '/admin/approvals', search: '?age=past', state: FROM_STUDIO });
  try {
    await v.click('approvals-open-cohort:219');
    assert.equal(v.at.path, '/admin/approvals/items/cohort-219?age=past');
    assert.ok(fromStudio(v.at.state), 'opening the item dropped the visit Studio opened');
    assert.ok(v.has('admin-page-crumb'), 'the crumb went when the item opened');
    await v.click('approvals-item-close');
    assert.equal(v.at.path, '/admin/approvals?age=past');
    assert.ok(fromStudio(v.at.state), 'closing the item dropped the visit Studio opened');
    assert.ok(v.has('admin-page-crumb'), 'the crumb went when the item closed');
  } finally { await v.unmount(); }
  const direct = await mountLanding('/admin/approvals?age=past');
  try {
    await direct.click('approvals-open-cohort:219');
    assert.ok(!fromStudio(direct.at.state), 'a direct visit gained Studio\'s state by opening an item');
    assert.ok(!direct.has('admin-page-crumb'));
  } finally { await direct.unmount(); }
  // The phone card, the Review cell and the item's own steps pass the same state.
  const inbox = codeOnly(read('frontend/src/pages/admin/approvals/ApprovalsInbox.jsx'));
  assert.match(inbox, /<RowCard [^>]*state=\{studioState\}/);
  assert.match(inbox, /<ReviewCell [^>]*state=\{studioState\}/);
  const assign = codeOnly(read('frontend/src/pages/admin/approvals/ApprovalsAssign.jsx'));
  assert.equal((assign.match(/to=\{`\/admin\/approvals\/items\/[^`]+`\} state=\{state\}/g) || []).length, 5, 'an item link drops the state');
});

test('part 3: the result count is a live status: Reading…, the count, and the lanes read when one did not answer', async () => {
  assert.equal(resultCount({ status: 'loading' }), 'Reading…');
  assert.equal(resultCount(ready(PAST)), '1 result');
  assert.equal(resultCount(ready({ ...PAST, total: 3 })), '3 results');
  assert.equal(resultCount(ready({ ...PAST, unreadable: ['Events'] })), '1 result · 2 of 3 lanes');
  assert.equal(resultCount(ready({ ...PAST, total: null })), null, 'a withheld total was drawn');
  assert.equal(resultCount({ status: 'error', reply: null }), null);
  const v = await mountLanding({ pathname: '/admin/approvals', search: '?age=past', state: FROM_STUDIO });
  try {
    assert.equal(v.props('approvals-result-count').role, 'status');
    assert.equal(v.of('approvals-result-count'), '1 result');
  } finally { await v.unmount(); }
});

test('part 3: removing the last chip, or Clear all, puts focus on Filters', async () => {
  const onFilters = () => Object.entries(document.activeElement || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1]?.['data-testid'] === 'approvals-filters-open';
  const v = await mountLanding({ pathname: '/admin/approvals', search: '?age=past', state: FROM_STUDIO });
  try {
    document.activeElement = null;
    await v.click('approvals-chip-remove-age');
    assert.ok(onFilters(), 'focus fell to the page when the last chip went');
  } finally { await v.unmount(); }
  const two = await mountLanding({ pathname: '/admin/approvals', search: '?age=past&lane=cohort', state: FROM_STUDIO });
  try {
    document.activeElement = null;
    await two.click('approvals-chip-remove-age');
    assert.ok(!onFilters(), 'a chip that was not the last moved focus to Filters');
    await two.click('approvals-chips-clear');
    assert.ok(onFilters(), 'Clear all left focus nowhere');
  } finally { await two.unmount(); }
});

test('part 3 (⚑2 A): on a branch the Approvals row lights on /admin/approvals, where Studio\'s count lands', () => {
  const row = SIDEBAR_GROUPS.branch_admin[0].items.find((i) => i.label === 'Approvals');
  assert.equal(row.to, '/branch/approvals');
  assert.ok(row.match?.includes('/admin/approvals'), 'the branch row stays dark on the landing');
  assert.ok(row.match?.includes('/branch/approvals'), 'the row no longer lights on its own page');
});

test('part 3 (SAD21): "past the window" is retired on Studio in any case, At a glance and Admin pages included', () => {
  const m = text(html(h(StudioNeedsDecisionView, { user: BRANCH_USER, glance: BRANCH_GLANCE, overdue: ready(PAST) })));
  const glance = m.slice(m.indexOf('At a glance'));
  assert.match(glance, /Spin-Out Lab applications · oldest 4 days · 1 open/);
  assert.doesNotMatch(glance, /past the window|due within 24h/i, 'At a glance carries an urgency word');
});
