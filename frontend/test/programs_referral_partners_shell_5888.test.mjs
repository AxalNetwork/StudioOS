/**
 * D5888 (#5888) — Referral partners in the generic program shell (PG03a), after Perks (D5313).
 *
 * What is pinned:
 *   · the shell's six core sections (Overview, Playbook, Availability & grants, Participation, History, Settings) in
 *     PG03's order and words, with the Referral queue module between Participation and History at MODULE_PATHS'
 *     `/queue`;
 *   · every Referral partners address (the four D953 and D963 gave it, and the shell's three new ones) is a literal
 *     route onto the one ProgramPage, and each opens its own section with its tab lit, a query, a hash or a trailing
 *     slash included;
 *   · Participation: the program's own summary figures, and the partners behind the introductions "Not recorded",
 *     never 0;
 *   · the signed-terms dialogs (`ReferralTermsDialogs.jsx`) still open from Overview and the queue;
 *   · a failed registry read marks only the sections that need it.
 * Every name and id is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/programs_referral_partners_shell_5888.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { Suspense, act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { readRoutesSource } from './_routesSource.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import adminProgramsGenericRoutes from '../src/routes/adminProgramsGeneric.jsx';
import adminProgramsReferralPartnersRoutes from '../src/routes/adminProgramsReferralPartners.jsx';
// Loaded first, so a route's first mount does not wait on a cold import (as programs_perks_shell_5313 does).
import ProgramPage from '../src/pages/admin/programs/ProgramPage.jsx';
import '../src/pages/admin/programs/GenericProgramPage.jsx';
import { PAGES, routeFor } from '../src/pages/admin/programs/programsModel.js';
import { genericTabs, moduleRows, shellModules } from '../src/pages/admin/programs/genericProgramModel.js';
import { PARTNERS_INTRODUCING_UNRECORDED, partnerParticipationTiles } from '../src/pages/admin/programs/referralPartnersModel.js';

const h = React.createElement;
const root = process.cwd();
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const KEY = 'referral-partners';
const BASE = `/admin/programs/${KEY}`;
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.test' };
const ADMIN = { id: 902, role: 'admin', name: 'Ana Admin', email: 'ana@example.test' };
const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});
const HQ = { available: false, reason: 'hq_reads', message: 'HQ reads these figures.' };

const DETAIL = {
  program: { key: KEY, group: 'Network and referrals', name: 'Referral partners', purpose: 'People who bring the studio deals.', who: 'Partners', join_method: 'Added by HQ', status: 'partly_built', position: 5, updated_at: '2026-11-07T10:00:00Z', studio_only: null, member_access: 'assigned', modules: ['referral_queue'] },
  playbook: { published: true, version: 1, published_at: '2026-10-01 10:00:00', sections: [{ key: 'terms', title: 'Terms', body: 'Signed terms pay instead of the standard rule.', computed: false, template_keys: [] }] },
  draft: null,
  grant: { state: 'held_by_hq' }, grantable: false, approved_proposal: null, capabilities: [],
};
const SUMMARY = { quarter: '2026-Q4', from: '2026-10-01', to: '2027-01-01', active_partners: 12, with_signed_terms: 9, waiting_to_sign: 3, introductions: 31, money: HQ };
const SERIES = { weeks_from: '2026-08-10', months_from: '2025-11-01', outcomes: ['pending', 'converted'], introductions: [], commission: HQ };
const partner = (id) => ({
  user_id: id, name: `Partner ${id}`, active: true, segment: 'deal_makers', segment_label: 'Deal makers', terms_state: 'none',
  code: `LIS-DM-${id}`, introductions: 3, converted: 1, last_activity: '2026-10-12 10:00:00', added_at: '2026-09-01 10:00:00', money: HQ,
});
const TERMS = {
  uid: 't1', partner_user_id: 41, partner_name: 'Partner 41', segment: 'deal_makers', segment_label: 'Deal makers', stored_status: 'submitted', state: 'submitted',
  starts_on: '2026-11-01', ends_on: null, cap_per_intro_cents: null, overall_cap_cents: null, currency: 'USD', sectors: null,
  contract_slug: 'partner_custom', envelope_id: null, note: null, triggers: [{ rule_key: 'referral_kyc_approved', amount_cents: 5000, percentage_bps: null }],
  created: { by: 1, at: '2026-10-20 10:00:00' }, submitted: { by: 1, at: '2026-10-21 10:00:00' },
};

function worker(user, o = {}) {
  const { detail = () => response(DETAIL), summary = () => response(SUMMARY), queue = { items: [TERMS], total: 1 }, write = null } = o;
  return (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const [path, qs] = url.split('?');
    const q = new URLSearchParams(qs || '');
    if (path === '/api/auth/me') return response(user);
    if (method !== 'GET') return write ? write(path, method, options) : never();
    if (/^\/api\/admin\/programs\/[^/]+\/activity$/.test(path)) return response({ program: KEY, rows: [], next_before: null, not_audited: null });
    if (path === `/api/admin/programs/${KEY}`) return detail();
    if (path === '/api/admin/programs/learning') return response({ ...DETAIL, program: { ...DETAIL.program, key: 'learning', name: 'Learning', modules: ['learners'] } });
    if (path === '/api/admin/referral-partners') return response({ items: [partner(41)], total: 1 });
    if (path === '/api/admin/referral-partners/summary') return summary();
    if (path === '/api/admin/referral-partners/series') return response(SERIES);
    if (path === '/api/admin/referral-partners/terms') return response(q.get('limit') === '1' ? { items: [], total: queue.total } : queue);
    if (/^\/api\/admin\/referral-partners\/\d+\/terms$/.test(path)) return response({ items: [] });
    if (path === '/api/network/admin/commission-rules') return response([{ rule_key: 'referral_kyc_approved', amount_cents: 5000, percentage_bps: null, description: 'A referred member completes KYC', active: 1, fires: true }]);
    return never();
  };
}

/** The routes as the app has them: the four literal lines (as `App.jsx` writes them), this task's module, and `:key`. */
const APP_PARTNERS = [BASE, `${BASE}/how-it-runs`, `${BASE}/queue`, `${BASE}/activity`];
const Table = () => h(Suspense, { fallback: null }, h(Routes, null,
  ...APP_PARTNERS.map((p) => h(Route, { key: p, path: p, element: h(ProgramPage) })),
  adminProgramsReferralPartnersRoutes({ guard: (_roles, element) => element }),
  adminProgramsGenericRoutes({ guard: (_roles, element) => element })));

async function mounted(url, handle, user) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const requests = [];
  globalThis.fetch = async (u, options = {}) => { requests.push({ url: String(u), method: String(options.method || 'GET'), body: options.body }); return handle(String(u), options); };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootNode = createRoot(container);
  const at = { path: url };
  function Probe() { const l = useLocation(); at.path = `${l.pathname}${l.search}${l.hash}`; return null; }
  await act(async () => rootNode.render(h(MemoryRouter, { initialEntries: [url] }, h(AuthProvider, null, h(Table), h(Probe)))));
  // No real clock (D5614): every stubbed read answers from a promise, so draining the event loop's turns settles them.
  const turn = () => new Promise((r) => setImmediate(r));
  const flush = () => act(async () => { for (let i = 0; i < 60; i += 1) await turn(); });
  for (let turns = 0; !container.childNodes?.length && turns < 2000; turns += 1) await act(async () => { await turn(); });
  await flush();
  // The dialogs portal to the body, so the walk starts there.
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const event = { button: 0, preventDefault() {}, stopPropagation() {}, defaultPrevented: false };
  return {
    requests, at, text: () => text(container), textOf: (id) => text(byId(id)), has: (id) => Boolean(byId(id)), props: (id) => props(byId(id)),
    async change(id, value) { await act(async () => { props(byId(id)).onChange({ target: { value } }); }); await flush(); },
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick(event); }); await flush(); },
    async close() { await act(async () => rootNode.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; localStorage.removeItem?.('user'); restore(); },
  };
}

/* ------------------------------------------------------------------ *
 * The model and the wiring
 * ------------------------------------------------------------------ */

const TABS = PAGES[KEY].tabs;
/** Each tab and the section it opens. */
const SECTION = {
  overview: 'programs-partners-overview-tab', how: 'programs-partners-how', availability: 'programs-generic-availability',
  participation: 'programs-partners-participation', queue: 'programs-partners-queue', activity: 'programs-partners-activity', settings: 'programs-generic-settings',
};

test('the strip is the shell\'s: the six core sections in PG03\'s order and words, and the Referral queue module at its MODULE_PATHS address', () => {
  assert.deepEqual(TABS.map((t) => t.label), ['Overview', 'Playbook', 'Availability & grants', 'Participation', 'Referral queue', 'History', 'Settings']);
  // The core six are the generic shell's own, address for address and word for word.
  const core = genericTabs(KEY).map(({ label, path }) => ({ label, path }));
  assert.deepEqual(TABS.filter((t) => !t.module).map(({ label, path }) => ({ label, path })), core);
  // The module tab is where the registry's `referral_queue` module says its screen runs.
  const [mod] = moduleRows(KEY, { modules: ['referral_queue'] }).rows;
  assert.deepEqual(TABS.filter((t) => t.module).map(({ module, label, path }) => ({ key: module, label, path })), [mod]);
  // Every address it had keeps its path.
  for (const p of APP_PARTNERS) assert.ok(TABS.some((t) => t.path === p), p);
  for (const t of TABS) {
    assert.deepEqual(routeFor(t.path), { program: KEY, tab: t.key }, t.path);
    assert.deepEqual(routeFor(`${t.path}/`), { program: KEY, tab: t.key }, `${t.path}/`);
  }
  // The strip in ProgramTabs.jsx writes the same tabs as literal doors, in the same order.
  const strip = /export function PartnersTabs[\s\S]*?<\/Strip>/.exec(read('frontend/src/pages/admin/programs/ProgramTabs.jsx'))[0];
  const doors = [...strip.matchAll(/<Tab to="([^"]+)"[^>]*>([^<]+)<\/Tab>/g)].map(([, to, label]) => ({ path: to, label: label.replace('&amp;', '&') }));
  assert.deepEqual(doors, TABS.map(({ path, label }) => ({ path, label })));
});

test('every Referral partners address is a literal route onto ProgramPage under the admin guard, never hqOnly; the old four stay in App.jsx', () => {
  const app = read('frontend/src/App.jsx');
  for (const p of APP_PARTNERS) assert.ok(app.includes(`\n      <Route path="${p}" element={guard(['admin'], <AdminProgramPage />)} />`), p);
  const routes = readRoutesSource(root);
  for (const t of TABS) assert.ok(routes.includes(`<Route path="${t.path}" element={guard(['admin'], <AdminProgramPage />)} />`), t.path);
  const mod = read('frontend/src/routes/adminProgramsReferralPartners.jsx');
  assert.match(mod, /const AdminProgramPage = lazy\(\(\) => import\('\.\.\/pages\/admin\/programs\/ProgramPage'\)\);/);
  assert.doesNotMatch(mod, /hqOnly\(/);
});

test('the model: modules from the page\'s own read; Participation is the summary\'s figures, and the partners behind them Not recorded, never 0', () => {
  assert.equal(shellModules(KEY, { status: 'loading' }).state, 'loading');
  assert.equal(shellModules(KEY, { status: 'error', error: {} }).state, 'unreadable', 'a failed read is not "none"');
  assert.deepEqual(shellModules(KEY, { status: 'ready', data: DETAIL }).rows.map((r) => [r.key, r.path]), [['referral_queue', `${BASE}/queue`]]);

  const [partners, intros, introducing] = partnerParticipationTiles({ status: 'ready', data: SUMMARY });
  assert.deepEqual([partners.label, partners.state, partners.value], ['Partners taking part', 'ready', '12']);
  assert.deepEqual([intros.label, intros.state, intros.value], ['Introductions this quarter', 'ready', '31']);
  assert.match(intros.sub, /2026-Q4/, 'the figure names its window');
  assert.deepEqual([introducing.state, introducing.word, introducing.reason], ['placeholder', 'Not recorded', PARTNERS_INTRODUCING_UNRECORDED]);
  const zero = partnerParticipationTiles({ status: 'ready', data: { ...SUMMARY, active_partners: 0, introductions: 0 } });
  assert.deepEqual([zero[0].value, zero[1].value], ['0', '0'], 'a measured zero is a zero');
  assert.equal(zero[2].word, 'Not recorded', 'the partners behind them are still not recorded');
  const missing = partnerParticipationTiles({ status: 'ready', data: { quarter: '2026-Q4' } });
  assert.deepEqual(missing.slice(0, 2).map((t) => t.word), ['Not recorded', 'Not recorded'], 'a figure the summary did not carry is never 0');
  const failed = partnerParticipationTiles({ status: 'error', error: {} });
  assert.deepEqual(failed.slice(0, 2).map((t) => t.state), ['unreadable', 'unreadable']);
  assert.equal(failed[2].word, 'Not recorded');
});

/* ------------------------------------------------------------------ *
 * Mounted on the route table
 * ------------------------------------------------------------------ */

test('each Referral partners address opens the shell with its own section and its own tab lit; old addresses and deep links still resolve', async () => {
  const cases = [
    ...TABS.map((t) => [t.path, t.key]),
    [`${BASE}/queue?status=submitted#rows`, 'queue'],
    [`${BASE}/queue/`, 'queue'],
    [`${BASE}/how-it-runs#terms`, 'how'],
    [`${BASE}/participation?x=1`, 'participation'],
    [`${BASE}/settings/`, 'settings'],
  ];
  for (const [url, key] of cases) {
    const view = await mounted(url, worker(SUPER), SUPER);
    try {
      assert.ok(view.has(`programs-page-${KEY}`), `${url}: the Referral partners page`);
      assert.ok(view.has('admin-board-program') && !view.has('admin-board-program-generic'), `${url}: ProgramPage, not the registry-backed page`);
      assert.ok(view.has(SECTION[key]), `${url}: ${SECTION[key]}`);
      for (const other of Object.keys(SECTION).filter((k) => k !== key)) assert.ok(!view.has(SECTION[other]), `${url}: not ${other}`);
      for (const t of TABS) assert.equal(view.props(`programs-tab-${t.key}`)['aria-current'], t.key === key ? 'page' : undefined, `${url}: tab ${t.key}`);
      for (const t of TABS) assert.ok(view.textOf(`programs-tab-${t.key}`).startsWith(t.label), `${url}: tab ${t.key} reads ${t.label}`);
      assert.ok(view.has('programs-partners-invite'), `${url}: the header's Invite a partner`);
      assert.equal(view.at.path, url, `${url}: no redirect`);
    } finally { await view.close(); }
  }
});

test('Overview keeps its screen and adds the shell\'s Capability modules; the module tab carries the terms waiting for HQ; the status is the registry\'s', async () => {
  const view = await mounted(BASE, worker(ADMIN), ADMIN);
  try {
    assert.equal(view.textOf('programs-tile-active-value'), '12');
    assert.ok(view.has('programs-partners-table') && view.has('programs-partners-rules'));
    assert.ok(view.has('programs-generic-module-referral_queue'));
    assert.equal(view.textOf('programs-tab-queue'), 'Referral queue1, Terms waiting for HQ');
    assert.match(view.props('programs-tab-queue-count').className, /amber/);
  } finally { await view.close(); }
  const paused = await mounted(BASE, worker(ADMIN, { detail: () => response({ ...DETAIL, program: { ...DETAIL.program, status: 'paused' } }) }), ADMIN);
  try { assert.match(paused.textOf('programs-header-status'), /Paused$/); } finally { await paused.close(); }
});

test('Participation: the summary\'s partners and introductions as recorded; the partners behind them Not recorded, never 0; a failed summary is Unreadable', async () => {
  const view = await mounted(`${BASE}/participation`, worker(ADMIN), ADMIN);
  try {
    assert.equal(view.textOf('programs-tile-participation-partners-value'), '12');
    assert.equal(view.textOf('programs-tile-participation-intros-value'), '31');
    assert.match(view.textOf('programs-tile-participation-intros'), /2026-Q4/);
    assert.match(view.textOf('programs-tile-participation-introducing'), /^Partners who introduced someoneNot recorded/);
    assert.doesNotMatch(view.textOf('programs-tile-participation-introducing'), /\b0\b/);
    assert.ok(view.requests.some((r) => r.url === '/api/admin/referral-partners/summary'), 'Participation reads the summary');
    assert.ok(!view.has('programs-generic-participation'), 'not the generic "no store" section: the program records its own figures');
  } finally { await view.close(); }
  const down = await mounted(`${BASE}/participation`, worker(ADMIN, { summary: () => response({ error: 'down' }, 503) }), ADMIN);
  try {
    assert.match(down.textOf('programs-tile-participation-partners'), /Could not be read/);
    assert.doesNotMatch(down.textOf('programs-tile-participation-partners'), /\b0\b/);
    assert.match(down.textOf('programs-tile-participation-introducing'), /Not recorded/);
  } finally { await down.close(); }
});

test('the signed-terms dialogs still open: Set custom terms from a partner row, and Approve from the Referral queue, which posts once', async () => {
  const view = await mounted(BASE, worker(ADMIN), ADMIN);
  try {
    await view.click('programs-partner-row-41-menu');
    await view.click('programs-partner-row-41-terms');
    assert.ok(view.has('programs-terms-dialog'));
    assert.match(view.textOf('programs-terms-foot'), /Terms take effect only when signed\./);
  } finally { await view.close(); }
  const writes = [];
  const write = (path, method) => { writes.push({ path, method }); return response({ ok: true }); };
  const hq = await mounted(`${BASE}/queue`, worker(SUPER, { write }), SUPER);
  try {
    await hq.click('programs-partners-queue-t1-approve');
    assert.match(hq.textOf('programs-approve-lines'), /Partner 41 earns \$50/);
    await hq.click('programs-approve-go');
    assert.deepEqual(writes.filter((w) => /\/terms\/t1\/approve$/.test(w.path)).map((w) => w.method), ['POST']);
  } finally { await hq.close(); }
});

test('Settings and Availability are the shell\'s: HQ sets member access on referral-partners; a failed registry read marks only those sections', async () => {
  const writes = [];
  const write = (path, method, options) => { writes.push({ path, method, body: JSON.parse(options.body) }); return response({ program: { ...DETAIL.program, member_access: 'invite' } }); };
  const hq = await mounted(`${BASE}/settings`, worker(SUPER, { write }), SUPER);
  try {
    assert.equal(hq.props('programs-generic-access').value, 'assigned');
    await hq.change('programs-generic-access', 'invite');
    await hq.click('programs-generic-access-save');
    assert.deepEqual(writes, [{ path: `/api/admin/programs/${KEY}`, method: 'PATCH', body: { member_access: 'invite' } }]);
  } finally { await hq.close(); }
  const avail = await mounted(`${BASE}/availability`, worker(ADMIN), ADMIN);
  try {
    assert.match(avail.textOf('programs-generic-availability'), /not switched on to be offered to studios/);
    assert.ok(avail.has('studio-program-access'));
    assert.ok(!avail.has('programs-generic-manage-grants'), 'a studio Admin cannot manage HQ grants');
  } finally { await avail.close(); }

  const down = () => response({ error: 'down' }, 503);
  for (const url of [`${BASE}/settings`, `${BASE}/availability`]) {
    const view = await mounted(url, worker(SUPER, { detail: down }), SUPER);
    try {
      assert.ok(view.has(`programs-page-${KEY}`), `${url}: the page still draws`);
      assert.ok(view.has('programs-shell-registry-failed'), `${url}: says the program could not be read`);
      assert.ok(!view.has('programs-generic-access') && !view.has('programs-generic-availability'), `${url}: draws nothing from a read that failed`);
    } finally { await view.close(); }
  }
  const overview = await mounted(BASE, worker(ADMIN, { detail: down }), ADMIN);
  try {
    assert.equal(overview.textOf('programs-tile-active-value'), '12', 'the program\'s own reads still draw');
    assert.ok(!overview.has('programs-shell-registry-failed'), 'Overview\'s own screen is not marked');
    assert.match(overview.textOf('programs-generic-modules'), /Could not be read/, 'never "None yet"');
    assert.ok(!overview.has('programs-generic-modules-none'));
    await overview.click('programs-partner-row-41-menu');
    await overview.click('programs-partner-row-41-terms');
    assert.ok(overview.has('programs-terms-dialog'), 'the terms dialog does not need the registry read');
  } finally { await overview.close(); }
  const participation = await mounted(`${BASE}/participation`, worker(ADMIN, { detail: down }), ADMIN);
  try {
    assert.equal(participation.textOf('programs-tile-participation-partners-value'), '12', 'Participation reads the program\'s own summary');
    assert.ok(!participation.has('programs-shell-registry-failed'));
  } finally { await participation.close(); }
});

test('only Referral partners moved here: another built-in program\'s new sections still open the registry-backed page', async () => {
  const view = await mounted('/admin/programs/learning/settings', worker(ADMIN), ADMIN);
  try {
    assert.ok(view.has('admin-board-program-generic'));
    assert.ok(view.has('programs-generic-settings'));
    assert.ok(!view.has(`programs-page-${KEY}`));
  } finally { await view.close(); }
});
