/**
 * D893 (#2366, #2660) — Admin › Insights at /admin/insights, built to the
 * "Admin Insights" canvas (INS1–INS11), on its one read, `GET /api/admin/insights`.
 *
 * What this file holds the page to:
 *   · every tile and block has four states, and a read or a store that failed is never a zero;
 *   · the model builds every block from a fixture of the read, and no block
 *     the read fills says "Not recorded";
 *   · the range, profile, country and compare controls are live, and the read
 *     is made with exactly what the URL holds;
 *   · INS3 (the group lightbox), INS10 (no permission), the moved notice and
 *     the export's counts-only CSV.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import AdminInsights, { Block, Tile } from '../src/pages/admin/insights/AdminInsights.jsx';
import { Chart } from '../src/pages/admin/insights/InsightsCharts.jsx';
import {
  MOVED_NOTICE, NO_PERMISSION, PROFILE_FILTERS, activationCohort, activeFilterCount, blockState, buildBlocks, buildGroup,
  buildKpis, countryOptions, dayLabel, definitionOf, exportBody, filterCountries, filtersFromSearch, groupFromSearch,
  isEmptyStudio, pageFailed, profileOf, rangeLine, readParams, scopeState,
} from '../src/pages/admin/insights/insightsModel.js';
import { renderedText } from './_renderedText.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

/* ------------------------------------------------------------------ *
 * A fixture of the read, in the shape the Worker sends (admin_insights_d893.test.ts)
 * ------------------------------------------------------------------ */

const WEEKS = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
const cohort = (week, created, open = false) => ({
  week, created, signed_in: created - 5, terms_accepted: created - 7, active_week_two: open ? null : Math.round(created / 2), week_two_open: open, invited: 3,
});
const RESPONSE = {
  range: '8w', weeks: WEEKS, current_week: '2026-10-19', last_complete_week: '2026-10-12', as_of: '2026-10-24T09:40:00.000Z',
  scope: { key: 'hq', label: 'HQ-held accounts · axal.vc' },
  filters: { profile: null, country: null, compare: false, group: null },
  kpis: {
    accounts: { available: true, total: 1284, new_30d: 204, deactivated: 46 },
    new_this_week: { available: true, count: 23, last_week: 58 },
    active_last_week: { available: true, week: '2026-10-12', value: 642, week_before: 617 },
    activated: { available: true, rate_pct: 50.5, cohorts_counted: 2 },
  },
  blocks: {
    who: {
      available: true, total: 1284,
      by_profile: [
        { profile: 'founder', count: 500 }, { profile: 'exploring', count: 371 }, { profile: 'investor', count: 229 },
        { profile: 'advisor', count: 84 }, { profile: 'partner', count: 63 }, { profile: 'admin', count: 13 },
        { profile: 'mentor', count: 12 }, { profile: 'no role', count: 12 },
      ],
      lps: 41,
      product_testers: { recorded: false, reason: 'A Product tester is a sub-account that #2377 and #2318 have not defined yet.' },
    },
    plan: { available: true, by_tier: [{ tier: 'free', count: 1027 }, { tier: 'pro', count: 200 }, { tier: 'plus', count: 57 }], paid: 257, paid_pct: 20 },
    growth: {
      available: true,
      weeks: WEEKS.map((w, i) => ({ week: w, total: [31, 44, 38, 52, 47, 61, 58, 23][i], to_date: i === 7, by_profile: { founder: [20, 30, 25, 30, 27, 40, 38, 13][i], investor: [11, 14, 13, 22, 20, 21, 20, 10][i] } })),
    },
    activity: { available: true, weeks: WEEKS, values: [null, 588, 603, 597, 615, 618, 642, 412], previous: null },
    activation: {
      available: true, weeks: WEEKS, cohorts: [cohort('2026-09-28', 47), cohort('2026-10-05', 52), cohort('2026-10-12', 58, true)],
      steps: { terms_accepted: { available: true }, invited: { available: true } },
    },
    retention: { available: true, cohorts: WEEKS.map((w, i) => ({ week: w, signups: [31, 44, 0, 0, 0, 0, 58, 23][i], retained_30d: [22, 29, 0, 0, 0, 0, 22, 23][i] })) },
    countries: { available: true, rows: [{ country: 'Canada', count: 600 }, { country: 'France', count: 300 }], not_stated: 384 },
    identity: { available: true, not_started: 900, pending: 120, approved: 250, rejected: 14, other: 0 },
    completeness: { available: true, bands: [{ band: '0–25', count: 400 }, { band: '26–50', count: 300 }, { band: '51–75', count: 284 }, { band: '76–100', count: 290 }], not_recorded: 10 },
    dormant: { available: true, days: 30, count: 311, never_seen: 40, last_month: null, last_month_reason: 'Only the latest request is kept per account.' },
    tickets: { available: true, open: 17, by_status: { open: 9, in_progress: 8, closed: 400 } },
    spend: { available: true, month: '2026-10', usd: 412.369, calls: 9318, by_profile: [{ profile: 'founder', usd: 300.1, calls: 7000 }, { profile: 'mentor', usd: 12.269, calls: 300 }, { profile: 'advisor', usd: 100, calls: 2018 }] },
  },
  definitions: { activity: 'An active account is … (the Worker\'s sentence).' },
};
const ok = (data = RESPONSE) => ({ status: 'ready', data });
const loading = { status: 'loading', data: null };
const failed = { status: 'error', data: null };
const byKey = (list) => Object.fromEntries(list.map((x) => [x.key, x]));
const F = filtersFromSearch('');

/* ------------------------------------------------------------------ *
 * The filters and the URL
 * ------------------------------------------------------------------ */

test('the URL holds the filters, and the read is made with exactly them', () => {
  assert.deepEqual(F, { range: '8w', profile: null, country: null, compare: false });
  const f = filtersFromSearch('?range=year&profile=founder&country=C%C3%B4te%20d%27Ivoire&compare=1');
  assert.deepEqual(f, { range: 'year', profile: 'founder', country: 'Côte d\'Ivoire', compare: true });
  assert.deepEqual(readParams(f, 'investor'), { range: 'year', profile: 'founder', country: 'Côte d\'Ivoire', compare: true, group: 'investor' });
  assert.deepEqual(readParams(F), { range: undefined, profile: undefined, country: undefined, compare: undefined, group: undefined }, 'the defaults are not sent');
  assert.deepEqual(filtersFromSearch('?range=month&profile=Founder'), F, 'a value the page does not know is the default, never sent');
  assert.equal(activeFilterCount(f), 4);
  assert.equal(activeFilterCount(F), 0);
});

test('the profile chips are role keys; LPs and Product testers say why they cannot be chosen', () => {
  const roles = PROFILE_FILTERS.filter((p) => p.role).map((p) => p.role);
  assert.deepEqual(roles, ['founder', 'investor', 'advisor', 'partner', 'exploring']);
  for (const label of ['LPs', 'Product testers']) {
    const chip = PROFILE_FILTERS.find((p) => p.label === label);
    assert.equal(chip.role, null);
    assert.ok(chip.waits && chip.waits.length > 30, `${label} has no reason`);
  }
  assert.equal(profileOf('exploring').label, 'Explorers');
  assert.equal(profileOf('mentor').key, 'advisor');
});

/* ------------------------------------------------------------------ *
 * The tiles
 * ------------------------------------------------------------------ */

test('the KPI row reads the four KPIs for every admin', () => {
  const k = byKey(buildKpis({ insights: ok() }));
  assert.equal(k.accounts.value, '1,284');
  assert.equal(k.accounts.delta, '+204 in 30 days');
  assert.equal(k.accounts.sub, '46 deactivated');
  assert.equal(k.new.value, '23');
  assert.equal(k.new.tag, 'to date');
  assert.equal(k.new.sub, '58 last week');
  assert.equal(k.active.value, '642');
  assert.equal(k.active.sub, '50% of accounts');
  assert.equal(k.active.delta, '+4% on the week before');
  assert.equal(k.activated.value, '51%');
  assert.match(k.activated.sub, /2 sign-up weeks/);
});

test('a read that failed is unreadable, and a read that has not answered is loading — never 0', () => {
  for (const t of buildKpis({ insights: failed })) {
    assert.equal(t.state, 'unreadable', `${t.key} is ${t.state}`);
    assert.equal(t.value, undefined);
  }
  assert.ok(buildKpis({ insights: loading }).every((t) => t.state === 'loading'));
});

test('a KPI whose store failed is unreadable with the Worker\'s reason, and the others answer', () => {
  const r = structuredClone(RESPONSE);
  r.kpis.active_last_week = { available: false, unreadable: true, reason: 'The request log could not be read on this database. That is not the same as none.' };
  r.kpis.activated = { available: true, rate_pct: null, cohorts_counted: 0 };
  const k = byKey(buildKpis({ insights: ok(r) }));
  assert.equal(k.active.state, 'unreadable');
  assert.match(k.active.reason, /not the same as none/);
  assert.equal(k.activated.state, 'unrecorded', 'no closed cohort is not 0%');
  assert.equal(k.accounts.state, 'ready');
});

/* ------------------------------------------------------------------ *
 * The blocks
 * ------------------------------------------------------------------ */

test('every block the read fills is drawn, and none says "Not recorded"', () => {
  const b = byKey(buildBlocks({ insights: ok(), filters: F }));
  assert.deepEqual(Object.keys(b), ['who', 'plan', 'growth', 'activity', 'activation', 'retention', 'countries', 'identity', 'completeness', 'dormant', 'tickets', 'spend']);
  for (const [k, v] of Object.entries(b)) assert.equal(v.state, 'ready', `${k} is ${v.state}`);
});

test('Who merges mentors into Advisors, names the largest group and counts LPs; Product testers keep their reason', () => {
  const b = byKey(buildBlocks({ insights: ok(), filters: F }));
  const rows = b.who.chart.rows;
  assert.deepEqual(rows.map((r) => r.label), ['Founders', 'Explorers', 'Investors', 'Advisors', 'Operating Partners', 'Admins', 'No role']);
  assert.equal(rows.find((r) => r.label === 'Advisors').value, 96);
  assert.equal(b.who.take, 'Founders are the largest group, 39% of accounts.');
  assert.ok(b.who.chart.clickable, 'the profile bars open the group lightbox');
  assert.deepEqual(b.who.badges[0], ['LPs', '41 investors with an approved LP application']);
  assert.match(b.who.badges[1][1], /^not recorded: .*#2377/);
});

test('Plan is the donut with the paid share in the middle', () => {
  const { plan } = byKey(buildBlocks({ insights: ok(), filters: F }));
  assert.equal(plan.chart.type, 'donut');
  assert.equal(plan.chart.center, '20%');
  assert.deepEqual(plan.chart.parts.map((p) => [p.label, p.value, p.tone]), [['Free', 1027, 'muted'], ['Pro', 200, 'violet'], ['Plus', 57, 'sky']]);
  assert.equal(plan.take, '20% of accounts are on a paid plan.');
  assert.match(renderToStaticMarkup(h(Chart, { chart: plan.chart })), /<circle/);
});

test('Growth is stacked by profile and hatches the current week', () => {
  const { growth } = byKey(buildBlocks({ insights: ok(), filters: F }));
  assert.equal(growth.chart.type, 'stack');
  const rows = growth.chart.rows;
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[0].parts.map((p) => p.value), [20, 11]);
  assert.equal(rows[7].toDate, true);
  assert.equal(rows[7].text, '23 to date');
  assert.deepEqual(growth.legend.map((l) => l.label), ['Founders', 'Investors', 'This week, to date']);
  assert.equal(growth.take, '354 new accounts in 8 weeks, 58 last week.');
});

test('Activity leaves the weeks before the log blank, and Compare draws the period before dotted', () => {
  const a = byKey(buildBlocks({ insights: ok(), filters: F })).activity;
  assert.deepEqual(a.chart.values, [null, 588, 603, 597, 615, 618, 642, 412]);
  assert.equal(a.chart.previous, null);
  assert.equal(a.take, '642 accounts were active last week, the most in this range.');
  assert.match(a.note, /left blank, not drawn as zero/);
  const r = structuredClone(RESPONSE);
  r.blocks.activity.previous = [500, 510, null, 520, 530, 540, 550, 560];
  const c = byKey(buildBlocks({ insights: ok(r), filters: { ...F, compare: true } })).activity;
  assert.deepEqual(c.chart.previous, r.blocks.activity.previous);
  assert.ok(c.legend.some((l) => l.tone === 'dotted'));
  assert.match(renderToStaticMarkup(h(Chart, { chart: c.chart })), /insights-previous-line/);
  assert.doesNotMatch(renderToStaticMarkup(h(Chart, { chart: a.chart })), /insights-previous-line/);
});

test('Activation reads the funnel for every admin, and the pick falls back to the newest closed week', () => {
  const b = byKey(buildBlocks({ insights: ok(), filters: F }));
  assert.equal(b.activation.state, 'ready');
  assert.equal(b.activation.select.value, '2026-10-05');
  assert.equal(b.activation.chart.rows[3].text, '26 · 50%');
  assert.equal(b.activation.chart2.rows[2].open, true);
  assert.equal(b.activation.note, '3 of them came from an invitation.');
  const cohorts = RESPONSE.blocks.activation.cohorts;
  assert.equal(activationCohort(cohorts, '2026-09-28').week, '2026-09-28');
  assert.equal(activationCohort(cohorts, '1999-01-04').week, '2026-10-05');
});

test('retention, countries, identity, completeness, dormant, tickets and spend', () => {
  const b = byKey(buildBlocks({ insights: ok(), filters: F }));
  assert.deepEqual(b.retention.chart.rows.map((r) => [r.label, r.value]), [['31 Aug', 71], ['7 Sep', 66], ['12 Oct', 38], ['19 Oct', 100]], 'weeks with no sign-up are left out');
  assert.deepEqual(b.countries.chart.rows.map((r) => r.label), ['Canada', 'France']);
  assert.match(b.countries.foot, /^384 accounts stated no country/);
  assert.deepEqual(b.identity.chart.rows.map((r) => r.label), ['Not started', 'Waiting', 'Approved', 'Rejected'], '#2384\'s words; no Other when there is none');
  assert.equal(b.identity.link.to, '/admin?tab=kyc');
  assert.deepEqual(b.completeness.chart.rows.map((r) => r.label), ['0–25%', '26–50%', '51–75%', '76–100%']);
  assert.match(b.completeness.note, /^10 accounts have no completeness figure/);
  assert.equal(b.dormant.big, '311');
  assert.match(b.dormant.note, /40 accounts have made no request/);
  assert.match(b.dormant.note, /No comparison with last month/);
  assert.equal(b.tickets.big, '17');
  assert.deepEqual(b.tickets.chart.parts.map((p) => p.value), [9, 8]);
  assert.equal(b.spend.big, '$412.37');
  assert.equal(b.spend.bigSub, 'over 9,318 calls');
  assert.deepEqual(b.spend.chart.rows.map((r) => [r.label, r.text]), [['Founders', '$300.10'], ['Advisors', '$112.27']], 'mentors are added to Advisors');
});

test('a block whose store failed is unreadable with its reason, a block nothing records is not recorded, and the rest answer', () => {
  const r = structuredClone(RESPONSE);
  r.blocks.tickets = { available: false, unreadable: true, reason: 'The support ticket table could not be read on this database. That is not the same as none.' };
  r.blocks.spend = { recorded: false, reason: 'Nothing records it here.' };
  delete r.blocks.dormant;
  const b = byKey(buildBlocks({ insights: ok(r), filters: F }));
  assert.equal(b.tickets.state, 'unreadable');
  assert.match(b.tickets.reason, /not the same as none/);
  assert.equal(b.spend.state, 'unrecorded');
  assert.equal(b.dormant.state, 'unreadable', 'a block missing from the answer is not a zero');
  assert.equal(b.who.state, 'ready');
  assert.equal(blockState(ok(), { available: true }), null);
});

test('"How is this counted?" uses the Worker\'s sentence when it sends one', () => {
  assert.equal(definitionOf('activity', ok()).body, RESPONSE.definitions.activity);
  assert.match(definitionOf('plan', ok()).body, /Paid is every plan that is not free/);
  assert.equal(definitionOf('nothing', ok()), null);
});

/* ------------------------------------------------------------------ *
 * Page states, scope, group, export
 * ------------------------------------------------------------------ */

test('the whole page fails only when the read fails; an empty studio is unfiltered and a measured zero', () => {
  assert.equal(pageFailed(failed), true);
  assert.equal(pageFailed(loading), false);
  const empty = structuredClone(RESPONSE);
  empty.kpis.accounts = { available: true, total: 0, new_30d: 0, deactivated: 0 };
  assert.equal(isEmptyStudio(ok(empty), F), true);
  assert.equal(isEmptyStudio(ok(empty), { ...F, profile: 'founder' }), false, 'no founders is not an empty studio');
  assert.equal(isEmptyStudio(ok(), F), false);
  assert.equal(isEmptyStudio(failed, F), false, 'a failed read is not an empty studio');
});

test('the country filter offers the counted countries, and keeps the chosen one', () => {
  assert.deepEqual(countryOptions(ok(), null), ['Canada', 'France']);
  assert.deepEqual(countryOptions(ok(), 'Peru'), ['Peru', 'Canada', 'France']);
  assert.deepEqual(countryOptions(failed, null), []);
});

test('INS10: a plain Admin asking for another studio\'s scope gets no permission; HQ gets its own', () => {
  assert.equal(scopeState('?scope=north', false).kind, 'noperm');
  assert.equal(scopeState('?scope=north', true).kind, 'unknown');
  assert.equal(scopeState('?scope=hq', false).kind, 'own');
  assert.equal(scopeState('', false).kind, 'own');
});

test('INS3: ?group= opens a profile, filled from the read with group=<role>, with its table by country and search', () => {
  assert.equal(groupFromSearch('?group=founders'), 'founder');
  assert.equal(groupFromSearch('?group=Operating%20Partners'), 'partner');
  assert.equal(groupFromSearch('?group=explorers'), 'exploring');
  assert.equal(groupFromSearch('?group=nobody'), null);
  const groupData = {
    ...RESPONSE,
    group: {
      available: true, profile: 'advisor', count: 96, new_30d: 7, active_last_week: 40, activated_pct: 33.3, dormant: 12,
      signups_by_week: WEEKS.map((w, i) => ({ week: w, count: i, to_date: i === 7 })),
      active_by_week: WEEKS.map((w, i) => ({ week: w, count: i === 0 ? null : 30 + i })),
      by_country: [{ country: 'Canada', accounts: 60, new_30d: 5, active_last_week: 30 }, { country: null, accounts: 36, new_30d: 2, active_last_week: 10 }],
    },
  };
  const g = buildGroup('advisor', ok(groupData));
  assert.equal(g.state, 'ready');
  assert.equal(g.count, 96);
  assert.equal(g.label, 'Advisors');
  assert.deepEqual(g.tiles.map(([t, v]) => [t, v.text]), [['New in 30 days', '7'], ['Active last week', '40'], ['Activated', '33%'], ['Dormant', '12']]);
  assert.equal(g.signups.rows[7].text, '7 to date');
  assert.equal(g.active.values[0], null);
  assert.equal(g.accountsHref, '/admin/held/accounts?profile=advisor');
  assert.deepEqual(filterCountries(g.countries, 'can').map((r) => r.country), ['Canada']);
  assert.deepEqual(filterCountries(g.countries, 'not st').map((r) => r.country), [null], 'the blank country is searchable as Not stated');
  assert.equal(filterCountries(g.countries, '').length, 2);
  const missing = buildGroup('advisor', ok({ ...groupData, group: { ...groupData.group, activated_pct: null } }));
  assert.equal(missing.tiles[2][1].missing, true, 'no activation rate is Not recorded, not 0%');
  assert.equal(buildGroup('advisor', failed).state, 'unreadable');
  assert.equal(buildGroup('advisor', loading).state, 'loading');
  assert.equal(buildGroup(null, ok()), null);
});

test('INS5: the export asks the Worker for the page\'s filters, and the group only when it is that group (#2661)', () => {
  const filters = { ...F, profile: 'founder', country: 'Canada', compare: true };
  assert.deepEqual(exportBody({ what: 'page', format: 'csv', filters, group: 'founder' }), { what: 'page', format: 'csv', range: '8w', profile: 'founder', country: 'Canada' });
  assert.deepEqual(exportBody({ what: 'group', format: 'pdf', filters: { ...F, range: 'year' }, group: 'investor' }), { what: 'group', format: 'pdf', range: 'year', group: 'investor' });
  assert.match(rangeLine(ok(), Date.parse('2026-10-24T12:00:00Z')), /^8 weeks · 31 Aug 2026 to 24 Oct 2026$/);
  assert.equal(dayLabel('2026-08-31'), '31 Aug');
});

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

const page = (url) => renderedText(renderToStaticMarkup(h(MemoryRouter, { initialEntries: [url] }, h(AdminInsights))));
const html = (url) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [url] }, h(AdminInsights)));

test('the page draws its title, scope, live filters and reading tiles before the read answers (INS8)', () => {
  const t = page('/admin/insights');
  assert.match(t, /Insights/);
  assert.match(t, /The accounts you manage, in figures and charts\./);
  assert.match(t, /HQ-held accounts · axal\.vc/);
  assert.match(t, /Reading…/);
  assert.doesNotMatch(t, /arrives with the Insights read/, 'the old "waits" sentence is gone');
  assert.doesNotMatch(t, /Admin Console/);
  const m = html('/admin/insights?range=year&profile=investor&compare=1');
  assert.match(m, /data-testid="insights-range-year"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-testid="insights-range-year"/);
  assert.match(m, /aria-pressed="true"[^>]*data-testid="insights-profile-investor"/);
  assert.match(m, /data-testid="insights-compare"[^>]*checked=""|checked=""[^>]*data-testid="insights-compare"/);
  assert.match(page('/admin/insights?range=year&profile=investor&compare=1'), /Year · Investors · compared with the period before/);
  for (const p of PROFILE_FILTERS.filter((x) => x.role)) assert.match(m, new RegExp(`data-testid="insights-profile-${p.role}"`));
});

test('INS3 opens from the URL, with the filters it was opened under, and reads while it waits', () => {
  const m = html('/admin/insights?group=founders&range=year&country=France');
  assert.match(m, /data-testid="insights-group"/);
  const box = m.slice(m.indexOf('data-testid="insights-group"'));
  for (const chip of ['>Year<', '>Founders<', '>France<']) assert.ok(box.includes(chip), `the lightbox has no ${chip} chip`);
  assert.match(renderedText(box), /Reading…/);
  assert.doesNotMatch(html('/admin/insights?group=nobody'), /data-testid="insights-group"/);
});

test('the moved notice shows once, from the old address', () => {
  assert.ok(page('/admin/insights?moved=held-insights').includes(MOVED_NOTICE));
  assert.ok(!page('/admin/insights').includes(MOVED_NOTICE));
});

test('INS10 replaces the page with one card for a plain Admin', () => {
  const t = page('/admin/insights?scope=north');
  assert.ok(t.includes(NO_PERMISSION));
  assert.match(t, /Show my accounts/);
  assert.match(t, /Only HQ can look at another studio’s accounts\./);
});

test('a block and a tile draw each state, and the ready block offers its definition and its table', () => {
  const draw = (b) => renderedText(renderToStaticMarkup(h(MemoryRouter, null, h(Block, { b, onRetry() {}, onCount() {}, onSelect() {}, onPick() {} }))));
  const blocks = byKey(buildBlocks({ insights: ok(), filters: F }));
  const who = draw(blocks.who);
  assert.match(who, /Founders are the largest group/);
  assert.match(who, /How is this counted\?/);
  assert.match(who, /View as table/);
  const r = structuredClone(RESPONSE);
  r.blocks.retention = { available: false, unreadable: true, reason: 'Retention could not be read on this database. That is not the same as none.' };
  r.blocks.plan = { recorded: false, reason: 'Nothing counts plans here.' };
  const b2 = byKey(buildBlocks({ insights: ok(r), filters: F }));
  assert.match(draw(b2.retention), /Could not be read.*Try again/);
  assert.match(draw(b2.plan), /Not recorded.*Nothing counts plans here\./);
  const tile = (k) => renderedText(renderToStaticMarkup(h(Tile, { k, onRetry() {} })));
  assert.match(tile(buildKpis({ insights: failed })[0]), /Could not be read\..*Try again/);
});

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

test('the address moved: the route, the redirect, the row, the rail map and the redirect count agree', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<Route path="\/admin\/insights" element=\{guard\(\['admin'\], <AdminInsights \/>\)\} \/>/);
  assert.match(app, /<Route path="\/admin\/held\/insights" element=\{<HeldInsightsRedirect \/>\} \/>/);
  assert.match(read('frontend/src/sidebarConfig.js'), /\{ to: '\/admin\/insights', icon: TrendingUp, label: 'Insights' \}/);
  assert.match(read('frontend/src/lib/railPages.js'), /own\('\/admin\/insights', key\(AD, 'Insights'\)\)/);
  assert.match(read('cloudflare-worker/src/services/redirectRoutes.ts'), /\{ path: '\/admin\/held\/insights' \}/);
  const redirect = read('frontend/src/pages/admin/insights/HeldInsightsRedirect.jsx');
  assert.match(redirect, /next\.set\('moved', MOVED_KEY\)/);
  assert.match(redirect, /hash: loc\.hash/);
  assert.ok(!existsSync(resolve(root, 'frontend/src/pages/admin/HeldInsights.jsx')), 'the old page is still on disk');
});

test('the page makes one read, the Insights read, and no other', () => {
  const src = read('frontend/src/pages/admin/insights/AdminInsights.jsx');
  assert.equal((src.match(/insightsApi\.adminInsights\(/g) || []).length, 2, 'the page read and the group read');
  for (const old of ['adminStudioGlance', 'analyticsCohorts', 'analyticsOverview', 'hqAnalytics']) {
    assert.ok(!src.includes(old), `the page still calls ${old}`);
  }
  assert.match(src, /if \(!enabled\) return undefined;/, 'INS10 makes no read');
  assert.doesNotMatch(src, /analyticsUsers|analyticsExport/, 'a read that carries emails reached the page');
  assert.doesNotMatch(read('frontend/src/pages/admin/insights/insightsModel.js'), /WAITS_FOR_READ|FILTER_WAITS/, 'a "waits for the read" sentence survived');
});

test('the canvas is committed in integrated/, and both READMEs count the folder', () => {
  for (const f of ['Admin Insights Page.dc.html', 'Admin Insights · Boards.dc.html']) {
    const htmlSrc = read(`design/canvases/integrated/${f}`);
    assert.equal(/<script src="([^"]*)"/.exec(htmlSrc)?.[1], './support.js', `${f}: the first script is the shared runtime`);
    for (const banned of ['@font-face', '__claude_design_branding']) assert.ok(!htmlSrc.includes(banned), `${f} holds ${banned}`);
  }
  assert.match(read('design/canvases/integrated/Admin Insights · Boards.dc.html'), /dc-import name="Admin Insights Page"/);
  assert.match(read('documentation/architecture/decisions/D893.md'), /^## D893 — /);
});
