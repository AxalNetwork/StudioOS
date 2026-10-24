/**
 * D893 (#2366) — Admin › Insights at /admin/insights, built to the "Admin
 * Insights" canvas (INS1–INS11) from the reads that already exist.
 *
 * What this file holds the page to:
 *   · every tile and block has four states, and a read that failed is never a zero;
 *   · the blocks no read counts yet say "Not recorded" with a reason, and the
 *     disabled filters say what they wait for;
 *   · the dates are the Worker's: Monday weeks in UTC, and SQLite's `%W` cohorts;
 *   · INS10 (no permission), the moved notice and the export's counts-only CSV.
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
import {
  WAITS_FOR_READ, FILTER_WAITS, MOVED_NOTICE, NO_PERMISSION, activationCohort, buildBlocks, buildGroup, buildKpis,
  cohortMonday, dayLabel, figuresCsv, groupFromSearch, isEmptyStudio, lastTwoWeeks, mondayOf, pageFailed, profileOf, scopeState,
} from '../src/pages/admin/insights/insightsModel.js';
import { renderedText } from './_renderedText.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

/* ------------------------------------------------------------------ *
 * Fixtures, in the shapes the Worker sends
 * ------------------------------------------------------------------ */

const WEEKS = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
const glanceOk = {
  status: 'ready',
  data: {
    hq: {
      accounts: {
        recorded: true, total: 1284, new_7d: 23, new_30d: 204, deactivated: 46,
        by_role: [
          { role: 'founder', count: 500 }, { role: 'mentor', count: 12 }, { role: 'explorer', count: 371 },
          { role: 'investor', count: 229 }, { role: 'advisor', count: 84 }, { role: 'partner', count: 63 },
          { role: 'admin', count: 13 }, { role: 'no role', count: 12 },
        ],
      },
      insights: {
        signups_by_week: { available: true, weeks: WEEKS.map((w, i) => ({ week_start: w, count: [31, 44, 38, 52, 47, 61, 58, 23][i], to_date: i === 7 })) },
        ai_spend_month: { available: true, month: '2026-10', usd: 412.369, calls: 9318 },
        open_tickets: { available: true, open: 17, by_status: { open: 9, in_progress: 8, closed: 400 } },
        active_accounts: { recorded: false, reason: 'x' },
      },
    },
  },
};
const overviewOk = { last: { status: 'ready', data: { active_users: 642 } }, before: { status: 'ready', data: { active_users: 617 } } };
const cohortsOk = {
  status: 'ready',
  data: {
    cohorts: [
      { cohort: '2026-W35', signups: 31, retained_30d: 22 },
      { cohort: '2026-W36', signups: 44, retained_30d: 29 },
      { cohort: '2026-W41', signups: 58, retained_30d: 22 },
    ],
  },
};
const cohort = (week, created, open = false) => ({
  week, created, signed_in: created - 5, terms_accepted: created - 7, active_week_two: open ? null : Math.round(created / 2), week_two_open: open, invited: 3,
});
const hqOk = {
  status: 'ready',
  data: {
    weeks: WEEKS,
    active_accounts: { available: true, series: [{ code: 'hq', values: [571, 588, 603, 597, 615, 618, 642, 412] }] },
    activation: {
      lines: [{ code: 'hq', available: true, weeks: WEEKS, cohorts: [cohort('2026-09-28', 47), cohort('2026-10-05', 52), cohort('2026-10-12', 58, true)] }],
    },
  },
};
const loading = { status: 'loading', data: null };
const failed = { status: 'error', data: null };

const byKey = (list) => Object.fromEntries(list.map((x) => [x.key, x]));

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

test('weeks are the Worker\'s Monday weeks in UTC, and %W cohorts land on their Monday', () => {
  assert.equal(mondayOf(Date.parse('2026-10-24T12:00:00Z')), '2026-10-19');
  assert.equal(mondayOf(Date.parse('2026-10-19T00:00:00Z')), '2026-10-19');
  assert.deepEqual(lastTwoWeeks(Date.parse('2026-10-24T12:00:00Z')), {
    last: { from: '2026-10-12', to: '2026-10-18' },
    before: { from: '2026-10-05', to: '2026-10-11' },
  });
  // 1 Jan 2026 is a Thursday: week 01 starts on Monday 5 Jan, week 00 on 29 Dec 2025.
  assert.equal(cohortMonday('2026-W01'), '2026-01-05');
  assert.equal(cohortMonday('2026-W00'), '2025-12-29');
  assert.equal(cohortMonday('2026-W41'), '2026-10-12');
  assert.equal(cohortMonday('not a week'), null);
  assert.equal(dayLabel('2026-08-31'), '31 Aug');
});

/* ------------------------------------------------------------------ *
 * The tiles
 * ------------------------------------------------------------------ */

test('the KPI row reads the glance, the two overview weeks and, for HQ, the funnel', () => {
  const k = byKey(buildKpis({ glance: glanceOk, overview: overviewOk, hq: hqOk, superAdmin: true }));
  assert.equal(k.accounts.value, '1,284');
  assert.equal(k.accounts.delta, '+204 in 30 days');
  assert.equal(k.accounts.sub, '46 deactivated');
  assert.equal(k.new.value, '23');
  assert.equal(k.new.tag, 'to date');
  assert.equal(k.new.sub, '58 last week');
  assert.equal(k.active.value, '642');
  assert.equal(k.active.sub, '50% of accounts');
  assert.equal(k.active.delta, '+4% on the week before');
  // Two closed cohorts (47 → 24, 52 → 26): 50 of 99. The open week is left out.
  assert.equal(k.activated.value, '51%');
  assert.match(k.activated.sub, /last 2 sign-up weeks/);
});

test('a plain Admin\'s Activated tile is not recorded, never a number', () => {
  const k = byKey(buildKpis({ glance: glanceOk, overview: overviewOk, hq: null, superAdmin: false }));
  assert.equal(k.activated.state, 'unrecorded');
  assert.equal(k.activated.reason, WAITS_FOR_READ.activated);
});

test('a read that failed is unreadable, and a read that has not answered is loading — never 0', () => {
  const k = byKey(buildKpis({ glance: failed, overview: { last: failed, before: failed }, hq: failed, superAdmin: true }));
  for (const t of Object.values(k)) {
    assert.equal(t.state, 'unreadable', `${t.key} is ${t.state}`);
    assert.equal(t.value, undefined, `${t.key} carries a value`);
  }
  assert.match(k.active.reason, /not a claim that nobody was active/);
  const l = buildKpis({ glance: loading, overview: { last: loading, before: loading }, hq: loading, superAdmin: true });
  assert.ok(l.every((t) => t.state === 'loading'));
});

test('a glance with no HQ block is unreadable for the figures it should carry', () => {
  const k = byKey(buildKpis({ glance: { status: 'ready', data: {} }, overview: overviewOk, hq: null, superAdmin: false }));
  assert.equal(k.accounts.state, 'unreadable');
  assert.equal(k.new.state, 'unreadable');
  // The overview still answers on its own.
  assert.equal(k.active.state, 'ready');
  assert.equal(k.active.sub, '', 'a share of an unread total is not drawn');
});

/* ------------------------------------------------------------------ *
 * The blocks
 * ------------------------------------------------------------------ */

test('Who your accounts are merges mentors into Advisors, sorts by size and names the largest group', () => {
  const b = byKey(buildBlocks({ glance: glanceOk, cohorts: cohortsOk, hq: hqOk, superAdmin: true }));
  const rows = b.who.chart.rows;
  assert.deepEqual(rows.map((r) => r.label), ['Founders', 'Explorers', 'Investors', 'Advisors', 'Operating Partners', 'Admins', 'No role']);
  assert.equal(rows.find((r) => r.label === 'Advisors').value, 96);
  assert.equal(b.who.take, 'Founders are the largest group, 39% of accounts.');
  assert.ok(b.who.chart.clickable, 'the profile bars open the group lightbox');
  assert.match(b.who.foot, /Total 1,284/);
  assert.equal(profileOf('partner').label, 'Operating Partners');
});

test('Growth hatches the current week and says the profile split waits', () => {
  const b = byKey(buildBlocks({ glance: glanceOk, cohorts: cohortsOk, hq: null, superAdmin: false }));
  const rows = b.growth.chart.rows;
  assert.equal(rows.length, 8);
  assert.equal(rows[7].toDate, true);
  assert.equal(rows[7].text, '23 to date');
  assert.equal(rows[0].label, '31 Aug');
  assert.equal(b.growth.note, WAITS_FOR_READ.growthSplit);
});

test('the blocks no read counts yet are not recorded, each with its own reason', () => {
  const b = byKey(buildBlocks({ glance: glanceOk, cohorts: cohortsOk, hq: null, superAdmin: false }));
  for (const key of ['plan', 'countries', 'identity', 'completeness', 'dormant', 'activity', 'activation']) {
    assert.equal(b[key].state, 'unrecorded', `${key} is ${b[key].state}`);
    assert.ok(b[key].reason && b[key].reason.length > 20, `${key} has no reason`);
  }
  assert.equal(b.identity.link.to, '/admin?tab=kyc');
});

test('Activity and Activation come from HQ analytics for the Super Admin', () => {
  const b = byKey(buildBlocks({ glance: glanceOk, cohorts: cohortsOk, hq: hqOk, superAdmin: true }));
  assert.equal(b.activity.state, 'ready');
  assert.deepEqual(b.activity.chart.values, [571, 588, 603, 597, 615, 618, 642, 412]);
  assert.equal(b.activity.take, '642 accounts were active last week, the most in this range.');
  assert.equal(b.activation.state, 'ready');
  assert.equal(b.activation.select.value, '2026-10-05', 'the newest cohort whose second week has ended');
  assert.equal(b.activation.chart.rows[3].text, '26 · 50%');
  assert.equal(b.activation.chart2.rows[2].open, true);
  assert.equal(b.activation.note, '3 of them came from an invitation.');
  // A pick that is one of the weeks is kept; one that is not falls back.
  const line = hqOk.data.activation.lines[0];
  assert.equal(activationCohort(line, '2026-09-28').week, '2026-09-28');
  assert.equal(activationCohort(line, '1999-01-04').week, '2026-10-05');
});

test('Still active after sign-up draws each cohort\'s share on its Monday', () => {
  const b = byKey(buildBlocks({ glance: glanceOk, cohorts: cohortsOk, hq: null, superAdmin: false }));
  const rows = b.retention.chart.rows;
  assert.deepEqual(rows.map((r) => r.label), ['31 Aug', '7 Sep', '12 Oct']);
  assert.deepEqual(rows.map((r) => r.value), [71, 66, 38]);
  assert.equal(b.retention.take, '71% of the oldest week are still active; newer weeks are lower.');
});

test('tickets split open from in progress, and spend keeps cents', () => {
  const b = byKey(buildBlocks({ glance: glanceOk, cohorts: cohortsOk, hq: null, superAdmin: false }));
  assert.equal(b.tickets.big, '17');
  assert.equal(b.tickets.take, '9 tickets are waiting for a first answer.');
  assert.deepEqual(b.tickets.chart.parts.map((p) => p.value), [9, 8]);
  assert.equal(b.spend.big, '$412.37');
  assert.equal(b.spend.bigSub, 'over 9,318 calls');
});

test('one failed read costs only its own blocks', () => {
  const b = byKey(buildBlocks({ glance: glanceOk, cohorts: failed, hq: null, superAdmin: false }));
  assert.equal(b.retention.state, 'unreadable');
  assert.equal(b.who.state, 'ready');
  assert.equal(b.growth.state, 'ready');
});

/* ------------------------------------------------------------------ *
 * Page states, scope, group, export
 * ------------------------------------------------------------------ */

test('the whole page fails only when every read fails, and an empty studio is a measured zero', () => {
  assert.equal(pageFailed({ glance: failed, cohorts: failed, overview: { last: failed } }, false), true);
  assert.equal(pageFailed({ glance: failed, cohorts: failed, overview: { last: failed }, hq: hqOk }, true), false);
  assert.equal(pageFailed({ glance: glanceOk, cohorts: failed, overview: { last: failed } }, false), false);
  const empty = { status: 'ready', data: { hq: { accounts: { total: 0, by_role: [], new_7d: 0, new_30d: 0, deactivated: 0 }, insights: {} } } };
  assert.equal(isEmptyStudio(empty), true);
  assert.equal(isEmptyStudio(glanceOk), false);
  assert.equal(isEmptyStudio(failed), false, 'a failed read is not an empty studio');
});

test('INS10: a plain Admin asking for another studio\'s scope gets no permission; HQ gets its own', () => {
  assert.equal(scopeState('?scope=north', false).kind, 'noperm');
  assert.equal(scopeState('?scope=north', true).kind, 'unknown');
  assert.equal(scopeState('?scope=hq', false).kind, 'own');
  assert.equal(scopeState('', false).kind, 'own');
});

test('INS3: ?group= opens a profile, with its count from the glance and the doors', () => {
  assert.equal(groupFromSearch('?group=founders'), 'founder');
  assert.equal(groupFromSearch('?group=Operating%20Partners'), 'partner');
  assert.equal(groupFromSearch('?group=nobody'), null);
  const g = buildGroup('advisor', glanceOk);
  assert.equal(g.count, 96);
  assert.equal(g.label, 'Advisors');
  assert.equal(g.accountsHref, '/admin/held/accounts?profile=advisor');
  assert.equal(buildGroup('advisor', failed).state, 'unreadable');
});

test('INS5: the CSV holds counts only, and a block that is not ready is written with its state', () => {
  const kpis = buildKpis({ glance: glanceOk, overview: { last: failed, before: failed }, hq: null, superAdmin: false });
  const blocks = buildBlocks({ glance: glanceOk, cohorts: cohortsOk, hq: null, superAdmin: false });
  const csv = figuresCsv({ kpis, blocks, asOf: '24 Oct 2026, 09:40 UTC' });
  assert.match(csv, /^block,item,value\n/);
  assert.match(csv, /tiles,Active last week,could not be read/);
  assert.match(csv, /Plan,,not recorded/);
  assert.match(csv, /Who your accounts are,Founders,500/);
  assert.match(csv, /"24 Oct 2026, 09:40 UTC"/);
  assert.doesNotMatch(csv, /@/, 'an email in the export');
});

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

const page = (url) => renderedText(renderToStaticMarkup(h(MemoryRouter, { initialEntries: [url] }, h(AdminInsights))));

test('the page draws its title, scope, the waiting filters and reading tiles before any read answers (INS8)', () => {
  const t = page('/admin/insights');
  assert.match(t, /Insights/);
  assert.match(t, /The accounts you manage, in figures and charts\./);
  assert.match(t, /HQ-held accounts · axal\.vc/);
  assert.ok(t.includes(FILTER_WAITS));
  assert.match(t, /Reading…/);
  assert.doesNotMatch(t, /Admin Console/);
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
  const blocks = byKey(buildBlocks({ glance: glanceOk, cohorts: cohortsOk, hq: null, superAdmin: false }));
  const draw = (b) => renderedText(renderToStaticMarkup(h(MemoryRouter, null, h(Block, { b, onRetry() {}, onCount() {}, onSelect() {}, onPick() {} }))));
  const who = draw(blocks.who);
  assert.match(who, /Founders are the largest group/);
  assert.match(who, /How is this counted\?/);
  assert.match(who, /View as table/);
  const plan = draw(blocks.plan);
  assert.match(plan, /Not recorded/);
  assert.ok(plan.includes(WAITS_FOR_READ.plan));
  const ret = draw(buildBlocks({ glance: glanceOk, cohorts: failed, hq: null, superAdmin: false }).find((b) => b.key === 'retention'));
  assert.match(ret, /Could not be read/);
  assert.match(ret, /Try again/);
  const tile = (k) => renderedText(renderToStaticMarkup(h(Tile, { k, onRetry() {} })));
  assert.match(tile(buildKpis({ glance: failed, overview: overviewOk, hq: null, superAdmin: false })[0]), /Could not be read\..*Try again/);
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

test('the page reads only mounted routes, and the HQ read only for a Super Admin', () => {
  const src = read('frontend/src/pages/admin/insights/AdminInsights.jsx');
  for (const call of ['api.adminStudioGlance()', "api.analyticsCohorts('retention', 'week')", 'api.analyticsOverview(', "api.hqAnalytics('8w')"]) {
    assert.ok(src.includes(call), `the page no longer calls ${call}`);
  }
  assert.match(src, /if \(superAdmin && \(!key \|\| key === 'hq'\)\)/, 'HQ analytics is read for a plain Admin, who would get a 403');
  assert.doesNotMatch(src, /analyticsUsers|analyticsExport/, 'a read that carries emails reached the page');
});

test('the canvas is committed in integrated/, and both READMEs count the folder', () => {
  for (const f of ['Admin Insights Page.dc.html', 'Admin Insights · Boards.dc.html']) {
    const html = read(`design/canvases/integrated/${f}`);
    assert.equal(/<script src="([^"]*)"/.exec(html)?.[1], './support.js', `${f}: the first script is the shared runtime`);
    for (const banned of ['@font-face', '__claude_design_branding']) assert.ok(!html.includes(banned), `${f} holds ${banned}`);
  }
  assert.match(read('design/canvases/integrated/Admin Insights · Boards.dc.html'), /dc-import name="Admin Insights Page"/);
  assert.match(read('documentation/architecture/decisions/D893.md'), /^## D893 — /);
});
