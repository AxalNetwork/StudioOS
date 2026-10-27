/**
 * D1304 (#3401, part 5 of #2377) — Admin › Accounts' Overview complete (ACC1,
 * ACC8–ACC11) over D1301's read (`GET /api/admin/accounts/overview`).
 *
 * The model's rules, then the page mounted against the Worker's own shape
 * (routes/admin_accounts_overview.ts `accountsOverview`) with a stubbed fetch:
 * each block from a fixture, one failed block keeping the others, the empty
 * studio's measured zeros, loading, the whole read failing, and dark classes.
 * The fixture's people are fake.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/accounts_overview_d1304.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import AccountsOverview from '../src/pages/admin/accounts/AccountsOverview.jsx';
import {
  attentionRows, attentionWord, initials, isEmptyStudio, kpiTiles, lpByProfileLine, lpProfilesWord, mixParts, newestRows,
  profileWidgets, readinessRows, sparkline, stateOf,
} from '../src/pages/admin/accounts/overviewModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-27T12:00:00Z');

/* ------------------------------------------------------------------ *
 * The Worker's shape (fake figures and people)
 * ------------------------------------------------------------------ */

const WEEKS = (vals) => vals.map((count, i) => ({ week: new Date(Date.parse('2026-09-07T00:00:00Z') + i * 7 * 86_400_000).toISOString().slice(0, 10), count, to_date: i === vals.length - 1 }));
const UNREAD = (what) => ({ available: false, unreadable: true, reason: `${what} could not be read on this database. That is not the same as none.` });
const steps = (total, ev, ta, ia, pr, ac) => ({ total, email_verified: ev, terms_accepted: ta, identity_approved: ia, profile_ready: pr, active_30d: ac });
const OV = () => ({
  as_of: '2026-10-27T12:00:00.000Z',
  scope: { key: 'hq', label: 'HQ' },
  weeks: [], current_week: '2026-10-26',
  kpis: {
    accounts: { available: true, total: 120, new_30d: 18, deactivated: 4 },
    active_30d: { available: true, count: 84, of: 120, never_seen: 6, dormant: 30 },
    unverified: { available: true, count: 9, overdue: 3, overdue_days: 7 },
    waiting: { available: true, total: 7, explorers_ready: 5, lp_applications: 2, tester_applications: { available: false, recorded: false, reason: 'Applications to become a Product tester are D1302’s store.' } },
  },
  profiles: {
    available: true, other: 3, admins: 3,
    rows: [
      { profile: 'founder', label: 'Founders', count: 50, new_30d: 8, weeks: WEEKS([2, 3, 1, 4, 2, 3, 5, 1]) },
      { profile: 'investor', label: 'Investors', count: 25, new_30d: 4, weeks: WEEKS([1, 0, 2, 1, 1, 0, 2, 0]) },
      { profile: 'advisor', label: 'Advisors', count: 0, new_30d: 0, weeks: WEEKS([0, 0, 0, 0, 0, 0, 0, 0]) },
      { profile: 'partner', label: 'Operating Partners', count: 12, new_30d: 2, weeks: null, weeks_reason: 'Sign-ups could not be read on this database. That is not the same as none.' },
      { profile: 'exploring', label: 'Explorers', count: 30, new_30d: 4, weeks: WEEKS([1, 1, 2, 1, 0, 2, 1, 1]) },
    ],
  },
  lps: { available: true, count: 6, by_profile: [{ profile: 'investor', count: 5 }, { profile: 'founder', count: 1 }], open_applications: 2 },
  product_testers: { available: false, recorded: false, reason: 'A Product tester is a sub-account D1302 adds; until its store lands nothing on this database marks one, so no figure is shown.' },
  readiness: {
    available: true,
    all: steps(120, 111, 100, 40, 30, 84),
    by_profile: [
      { profile: 'founder', ...steps(50, 48, 45, 20, 15, 40) },
      { profile: 'investor', ...steps(25, 24, 22, 10, 8, 18) },
      { profile: 'advisor', ...steps(0, 0, 0, 0, 0, 0) },
      { profile: 'partner', ...steps(12, 12, 11, 6, 4, 9) },
      { profile: 'exploring', ...steps(30, 25, 20, 2, 1, 15) },
    ],
  },
  explorers: { available: true, total: 30, not_sent: 18, sent_unsigned: 7, signed_ready: 5 },
  newest: { available: true, rows: [
    { id: 41, name: 'Ivy Example', profile: 'exploring', country: 'Brazil', joined_at: '2026-10-24 09:00:00' },
    { id: 40, name: '', profile: 'founder', country: null, joined_at: null },
  ] },
  attention: {
    available: true,
    rows: [
      { id: 12, name: 'Ben Sample', profile: 'founder', country: null, kind: 'email_unverified', since: '2026-10-18 12:00:00' },
      { id: 13, name: 'Dev Testcase', profile: 'partner', country: 'Kenya', kind: 'identity_waiting', since: '2026-10-02 08:00:00' },
      { id: 14, name: 'Gus Demo', profile: 'exploring', country: null, kind: 'explorer_signed', since: null },
    ],
    by_kind: { email_unverified: { available: true, count: 3 }, identity_waiting: { available: true, count: 1 }, explorer_signed: { available: true, count: 5 }, lp_application: { available: true, count: 0 } },
    not_recorded: { tester_application: 'Applications to become a Product tester are D1302’s store.', limited_access: 'How long an account has had limited access is not recorded.' },
    partial: false,
  },
  definitions: { accounts: 'Accounts that are not deactivated.' },
});
const EMPTY = () => {
  const o = OV();
  o.kpis.accounts = { available: true, total: 0, new_30d: 0, deactivated: 0 };
  o.kpis.active_30d = { available: true, count: 0, of: 0, never_seen: 0, dormant: 0 };
  o.kpis.unverified = { available: true, count: 0, overdue: 0, overdue_days: 7 };
  o.kpis.waiting = { ...o.kpis.waiting, total: 0, explorers_ready: 0, lp_applications: 0 };
  o.profiles = { available: true, other: 0, admins: 0, rows: o.profiles.rows.map((r) => ({ ...r, count: 0, new_30d: 0, weeks: WEEKS([0, 0, 0, 0, 0, 0, 0, 0]) })) };
  o.lps = { available: true, count: 0, by_profile: [], open_applications: 0 };
  o.explorers = { available: true, total: 0, not_sent: 0, sent_unsigned: 0, signed_ready: 0 };
  o.newest = { available: true, rows: [] };
  o.attention = { ...o.attention, rows: [], by_kind: {} };
  return o;
};

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('a block is ok, unreadable (Try again) or not recorded (why); a missing block is never none', () => {
  assert.equal(stateOf({ available: true }).kind, 'ok');
  assert.equal(stateOf(UNREAD('X')).kind, 'unreadable');
  assert.equal(stateOf({ available: false, recorded: false, reason: 'r' }).kind, 'not_recorded');
  // Mutation checked: read a missing block as ok → 'ok'.
  assert.equal(stateOf(undefined).kind, 'unreadable');
  assert.match(stateOf(undefined).reason, /not the same as none/);
});

test('the four figures, each from its block; a failed block says why and draws no number', () => {
  const t = Object.fromEntries(kpiTiles(OV()).map((x) => [x.key, x]));
  assert.deepEqual([t.accounts.value, t.active.value, t.unverified.value, t.waiting.value], ['120', '84', '9', '7']);
  assert.deepEqual([t.accounts.delta, t.accounts.sub], ['+18 in 30 days', '4 deactivated, not counted']);
  assert.equal(t.active.sub, '70% of accounts · 6 never seen');
  assert.equal(t.unverified.sub, '3 for more than 7 days');
  assert.equal(t.waiting.sub, '5 explorers ready for a profile · 2 LP applications');
  assert.match(t.waiting.note, /Product tester applications are not counted here yet/);
  const o = OV();
  o.kpis.active_30d = UNREAD('Last activity');
  o.kpis.waiting = UNREAD('The Exploring board');
  const f = Object.fromEntries(kpiTiles(o).map((x) => [x.key, x]));
  // Mutation checked: draw a failed figure as 0 → '0'.
  assert.deepEqual([f.active.value, f.waiting.value], [null, null]);
  assert.equal(f.active.state.kind, 'unreadable');
  assert.equal(f.accounts.value, '120', 'one failed figure keeps the others');
  const z = Object.fromEntries(kpiTiles(EMPTY()).map((x) => [x.key, x]));
  assert.deepEqual([z.accounts.value, z.accounts.sub, z.accounts.delta, z.active.value], ['0', 'None deactivated', null, '0'], 'ACC9a: measured zeros');
});

test('the profile mix: four profiles, then Other with Explorers and Admins', () => {
  const m = mixParts(OV());
  assert.deepEqual(m.parts.map((p) => [p.key, p.value]), [['founder', 50], ['investor', 25], ['advisor', 0], ['partner', 12], ['other', 33]]);
  assert.equal(m.parts.at(-1).label, 'Other (Explorers 30 · Admins 3)');
  assert.equal(m.total, 120);
  assert.match(m.alt, /^Profile mix of 120 accounts: Founders 50, Investors 25, Advisors 0, Operating Partners 12, Other 33\.$/);
  assert.equal(mixParts({ profiles: UNREAD('The account table') }), null);
});

test('a widget per profile: count, new in 30 days, eight weeks with the last to date, and facts; the sub-accounts say why', () => {
  const w = Object.fromEntries(profileWidgets(OV()).map((x) => [x.key, x]));
  assert.deepEqual(Object.keys(w), ['founder', 'investor', 'advisor', 'partner', 'exploring', 'lp', 'tester']);
  assert.deepEqual([w.founder.value, w.founder.delta], ['50', '+8 in 30 days']);
  assert.deepEqual(w.founder.facts.map((f) => [f.label, f.value]), [['Identity check approved', '20'], ['Profile at least 75% complete', '15']]);
  assert.deepEqual(w.investor.facts.at(-1), { key: 'lps', label: 'LPs among them', value: '5' });
  assert.deepEqual([w.advisor.value, w.advisor.none, w.advisor.delta], ['0', 'No advisors yet', null], 'a counted 0 is a 0');
  // Mutation checked: draw no weeks as an empty line → spark present.
  assert.equal(w.partner.spark, null);
  assert.match(w.partner.weeksReason, /could not be read/);
  assert.deepEqual(w.exploring.facts.map((f) => [f.label, f.value]), [['Agreement not sent', '18'], ['Sent, not signed', '7'], ['Signed, ready for a profile', '5']]);
  assert.equal(w.exploring.facts[2].link.to, '/admin/exploring');
  assert.deepEqual([w.lp.value, w.lp.facts[0].label, w.lp.facts[1].value], ['6', '5 investors · 1 other profile', '2']);
  assert.equal(w.tester.state.kind, 'not_recorded');
  assert.equal(w.tester.value, undefined, 'never a figure for a store that does not exist');
});

test('ACC11a: the Explorers split failing keeps the widget and every other one', () => {
  const o = OV();
  o.explorers = UNREAD('The Exploring board');
  const w = Object.fromEntries(profileWidgets(o).map((x) => [x.key, x]));
  assert.equal(w.exploring.value, '30');
  assert.equal(w.exploring.facts.length, 1);
  assert.equal(w.exploring.facts[0].failed, true);
  assert.match(w.exploring.facts[0].reason, /^Could not be read\. The Exploring board did not answer\. This is not a claim that there are none\.$/);
  assert.equal(w.founder.value, '50');
  const gone = profileWidgets({ ...OV(), profiles: UNREAD('The account table') });
  assert.ok(gone.slice(0, 5).every((x) => x.state.kind === 'unreadable' && x.value === undefined));
});

test('the sparkline: the to-date week is the dashed last segment', () => {
  const s = sparkline(WEEKS([1, 2, 3, 4, 5, 6, 7, 8]));
  assert.equal(s.solid.split(' ').length, 7);
  assert.ok(s.dash && s.toDate);
  // Mutation checked: never dash → no `dash`.
  assert.equal(sparkline(WEEKS([1, 2]).map((x) => ({ ...x, to_date: false }))).dash, null);
  assert.equal(s.table.at(-1)[0].endsWith('(to date)'), true);
  assert.equal(sparkline([]), null);
});

test('readiness: five steps by segment, each a count and share; Terms unread is said, the rest still draw', () => {
  const all = readinessRows(OV(), 'all');
  assert.deepEqual(all.rows.map((r) => r.text), ['111 (93%)', '100 (83%)', '40 (33%)', '30 (25%)', '84 (70%)']);
  assert.match(all.alt, /^Account readiness: 93% verified their email, 83% accepted the terms/);
  assert.deepEqual(readinessRows(OV(), 'investor').rows.map((r) => r.value), [24, 22, 10, 8, 18]);
  assert.deepEqual(readinessRows(OV(), 'advisor').rows.map((r) => r.text), ['0 (0%)', '0 (0%)', '0 (0%)', '0 (0%)', '0 (0%)']);
  const o = OV();
  o.readiness.all.terms_accepted = null;
  o.readiness.terms_reason = 'The Terms acceptances could not be read on this database.';
  const r = readinessRows(o, 'all');
  // Mutation checked: read a null step as 0 → '0 (0%)'.
  assert.deepEqual([r.rows[1].value, r.rows[1].text], [null, 'Not read']);
  assert.match(r.rows[1].reason, /Terms acceptances/);
  assert.equal(r.rows[0].text, '111 (93%)');
  assert.equal(readinessRows({ readiness: UNREAD('X') }, 'all'), null);
});

test('newest and needs attention: each row opens its record; a missing name, country or date says so', () => {
  const n = newestRows(OV(), NOW);
  assert.deepEqual(n.map((r) => [r.id, r.name, r.profile, r.country, r.joined]), [
    [41, 'Ivy Example', 'Explorer', 'Brazil', '24 Oct 2026'], [40, 'Name not recorded', 'Founder', 'Country not recorded', 'Date not recorded'],
  ]);
  assert.deepEqual([initials('Ivy Example'), initials(''), initials('Ben')], ['IE', '?', 'B']);
  const a = attentionRows(OV(), NOW);
  assert.deepEqual(a.rows.map((r) => r.why), ['Email not verified for 9 days', 'Identity check waiting since 2 Oct 2026', 'Explorer, agreement signed on a date not recorded']);
  assert.equal(attentionWord({ kind: 'lp_application', since: '2026-10-26 12:00:00' }, NOW), 'LP application waiting 1 day');
  assert.equal(attentionWord({ kind: 'explorer_signed', since: '2026-10-27 08:00:00' }, NOW), 'Explorer, agreement signed today');
  assert.equal(a.partial, null);
  assert.equal(a.notCounted.length, 2);
  const o = OV();
  o.attention.partial = true;
  o.attention.by_kind.identity_waiting = UNREAD('Identity checks');
  // Mutation checked: ignore `partial` → null.
  assert.match(attentionRows(o, NOW).partial, /^Some of this list could not be read: identity checks\./);
  assert.equal(newestRows({ newest: UNREAD('X') }), null);
});

test('LP words; the empty studio is only a counted 0', () => {
  assert.equal(lpProfilesWord([{ profile: 'investor', count: 38 }, { profile: 'founder', count: 2 }, { profile: 'advisor', count: 1 }]), '38 investors · 3 other profiles');
  assert.equal(lpProfilesWord([]), 'No LP yet');
  assert.equal(lpByProfileLine([{ profile: 'founder', count: 2 }, { profile: 'investor', count: 38 }]), 'LPs by profile: Investors 38 · Founders 2.');
  assert.equal(isEmptyStudio(EMPTY()), true);
  assert.equal(isEmptyStudio(OV()), false);
  // Mutation checked: a failed accounts block reads as empty → the "No accounts yet" panel over a failure.
  assert.equal(isEmptyStudio({ kpis: { accounts: UNREAD('The account table') } }), false);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({
  ok: status < 400, status, type: 'basic', redirected: false,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body, text: async () => JSON.stringify(body),
});

async function mounted(answer) {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (u) => {
    if (String(u).includes('/client-error')) return response({});
    requests.push(String(u));
    return answer(requests.length);
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/admin/accounts'] }, h(AccountsOverview, { now: NOW }))));
  const flush = () => act(async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    requests, flush, has: (id) => Boolean(byId(id)), textOf: (id) => text(byId(id)),
    count: (id) => nodes().filter((n) => props(n)['data-testid'] === id).length,
    attr: (id, k) => props(byId(id))[k],
    click: async (id) => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = previous; restore(); },
  };
}

test('mounted ACC1: one read, the four figures, the mix, seven widgets, readiness, testers, newest and needs attention', async () => {
  const r = await mounted(() => response(OV()));
  try {
    assert.deepEqual(r.requests, ['/api/admin/accounts/overview']);
    assert.equal(r.textOf('accounts-kpi-accounts-value'), '120');
    assert.equal(r.textOf('accounts-kpi-waiting-sub'), '5 explorers ready for a profile · 2 LP applications');
    assert.ok(r.has('accounts-mix-chart'));
    assert.equal(r.count('accounts-profile-widgets') && ['founder', 'investor', 'advisor', 'partner', 'exploring', 'lp', 'tester'].filter((k) => r.has(`accounts-widget-${k}`)).length, 7);
    assert.equal(r.textOf('accounts-widget-founder-count'), '50');
    assert.ok(r.has('accounts-widget-founder-spark'));
    assert.match(r.textOf('accounts-widget-tester-absent'), /^Not recorded\. A Product tester is a sub-account D1302 adds/);
    assert.ok(!r.has('accounts-widget-tester-count'), 'no figure for the testers');
    assert.equal(r.textOf('accounts-admins-line'), 'Admins: 3. HQ opens administrator accounts on a licence.');
    assert.equal(r.textOf('accounts-lps-by-profile'), 'LPs by profile: Investors 5 · Founders 1.');
    assert.equal(r.count('accounts-newest-row'), 2);
    assert.equal(r.attr('accounts-newest-open-41', 'href'), '/admin/accounts/all/41');
    assert.equal(r.count('accounts-attention-row'), 3);
    assert.equal(r.attr('accounts-attention-open-13', 'href'), '/admin/accounts/all/13');
    assert.ok(r.has('accounts-attention-not-counted'));
    // View as table, then a readiness segment.
    await r.click('accounts-readiness-toggle');
    assert.match(r.textOf('accounts-readiness-table'), /Email verified111 \(93%\)/);
    await r.click('accounts-readiness-seg-investor');
    assert.match(r.textOf('accounts-readiness-table'), /Email verified24 \(96%\)/);
    assert.equal(r.attr('accounts-readiness-seg-investor', 'aria-checked'), true);
  } finally { await r.close(); }
});

test('mounted ACC11a: one failed block keeps the others; Try again reads again', async () => {
  const r = await mounted((n) => {
    const o = OV();
    if (n === 1) { o.explorers = UNREAD('The Exploring board'); o.newest = UNREAD('The newest accounts'); o.kpis.active_30d = UNREAD('Last activity'); }
    return response(o);
  });
  try {
    assert.ok(r.has('accounts-fact-exploring-split-failed'));
    assert.ok(r.has('accounts-newest-absent-retry'));
    assert.ok(r.has('accounts-kpi-active-absent'));
    // Mutation checked: draw a failed figure → a value node.
    assert.ok(!r.has('accounts-kpi-active-value'));
    assert.equal(r.textOf('accounts-widget-exploring-count'), '30');
    assert.equal(r.count('accounts-attention-row'), 3, 'one failed block never blanks the page');
    await r.click('accounts-newest-absent-retry');
    assert.equal(r.requests.length, 2);
    assert.equal(r.count('accounts-newest-row'), 2);
    assert.ok(!r.has('accounts-fact-exploring-split-failed'));
  } finally { await r.close(); }
});

test('mounted ACC9a: a new studio draws measured zeros and the empty panel, no charts', async () => {
  const r = await mounted(() => response(EMPTY()));
  try {
    assert.equal(r.textOf('accounts-kpi-accounts-value'), '0');
    assert.equal(r.textOf('accounts-widget-founder-none'), 'No founders yet');
    assert.ok(r.has('accounts-empty'));
    assert.match(r.textOf('accounts-empty'), /^No accounts yet\.People appear here when they sign up or accept an invitation\.Open Partner invitations$/);
    // Mutation checked: draw the charts for an empty studio → 'accounts-mix'.
    assert.ok(!r.has('accounts-mix') && !r.has('accounts-readiness') && !r.has('accounts-newest'));
  } finally { await r.close(); }
});

test('mounted ACC10 and the whole read failing: Reading…, then a failed block with Try again, never a blank or a zero', async () => {
  let resolve;
  const pending = await mounted(() => new Promise((res) => { resolve = res; }));
  try {
    assert.ok(pending.has('accounts-overview-loading'));
    assert.match(pending.textOf('accounts-overview-loading'), /AccountsReading…Active in the last 30 daysReading…/);
    resolve(response(OV()));
    await pending.flush();
    assert.ok(pending.has('accounts-overview') && !pending.has('accounts-overview-loading'));
  } finally { await pending.close(); }
  const r = await mounted((n) => (n === 1 ? response({ error: 'down' }, 503) : response(OV())));
  try {
    assert.ok(r.has('accounts-overview-failed'));
    assert.ok(!r.has('accounts-kpis'));
    await r.click('accounts-overview-failed-block-retry');
    assert.ok(r.has('accounts-kpis'));
  } finally { await r.close(); }
});

test('the source: dark classes (ACC8), the phone grid, the record address, no browser pop-up, and the docs', () => {
  const src = read('frontend/src/pages/admin/accounts/AccountsOverview.jsx');
  for (const c of ['dark:bg-gray-900', 'dark:border-gray-800', 'dark:text-gray-100', 'dark:text-[#a78bfa]', 'dark:stroke-[#a78bfa]']) assert.ok(src.includes(c), c);
  assert.ok(src.includes('grid gap-3 sm:grid-cols-2 lg:grid-cols-4'), 'one column on a phone');
  assert.ok(src.includes('to={accountRecordHref(r.id)}'));
  assert.ok(!/(?<![.\w])(alert|confirm|prompt)\(|window\.open/.test(src));
  assert.ok(read('frontend/src/pages/admin/HeldAccounts.jsx').includes('<AccountsOverview />'));
  assert.match(read('documentation/architecture/decisions/D1304.md'), /UNVERIFIED/);
  assert.ok(read('documentation/architecture/ROUTE_MAP.md').includes('D1304'));
});
