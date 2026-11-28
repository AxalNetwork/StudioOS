/**
 * D4866 (#4866, Grow v2 GR-02, GR-10, GR-16): Reporting as a utility on every Grow surface, and the overview's
 * "For this job" links picked by the founder's current task in place of the static "Also in Grow" list.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/grow_related_4866.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import ReportReadiness from '../src/pages/cycles/reporting/ReportReadiness.jsx';
import { readinessRows } from '../src/pages/cycles/reporting/readinessModel.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, matchRoutes } from 'react-router-dom';
import { GrowOverviewView } from '../src/pages/cycles/GrowOverview.jsx';
import { CycleHeader } from '../src/pages/cycles/CycleOverview.jsx';
import PhoneModulePage from '../src/pages/cycles/PhoneModulePage.jsx';
import DistributionTabs from '../src/pages/cycles/distribution/DistributionTabs.jsx';
import { RELATED, RELATED_BY_TASK, growRelated, growTask, taskOfItem } from '../src/pages/cycles/growRelatedModel.js';
import { alsoInFor } from '../src/lib/adminPlacement.js';
import { readRoutesSource } from './_routesSource.mjs';
import { codeOnly } from './_codeOnly.mjs';

const Q = '?project_id=7';
const missing = { state: 'not_recorded', value: null };
const recorded = (value) => ({ state: 'recorded', value });
const item = (key, area, path) => ({ key, label: key, why: `why ${key}`, href: `${path}${Q}`, area });
const base = { state: 'ready', writable: true, period: '2026-11', focus: recorded({ metric_key: 'mrr', target_value: 100, direction: 'up' }), measurement: recorded({ value: 10, as_of: '2026-11-12', source: 'manual' }), primary: null, items: [], signals: {} };
const ssr = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const overview = (attention, props = {}) => ssr(h(GrowOverviewView, { raw: { attention }, data: { figures: [], cards: [] }, status: 'ready', search: Q, action: { href: `/grow/update${Q}` }, onRetry() {}, now: Date.parse('2026-11-20T00:00:00Z'), ...props }));
const related = (html) => html.match(/<nav[^>]*data-testid="grow-related"[\s\S]*?<\/nav>/)?.[0] || '';
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

test('the task is the first ranked attention item\'s area; with none, Focus while no focus is recorded, else the general set', () => {
  assert.equal(growTask({ ...base, items: [item('stalled_customers', 'Customers', '/grow/customers'), item('offers', 'Talent', '/grow/talent')] }), 'customers');
  assert.equal(growTask({ ...base, items: [item('report_due', 'Reporting', '/grow/reporting')] }), 'reporting');
  assert.equal(growTask({ ...base, items: [item('partner_renewal', 'Partnerships', '/grow/partner-network/p1')] }), 'partnerships');
  // An unknown area falls back to the item's own route, aliases included; an item with neither is skipped.
  assert.equal(taskOfItem({ href: '/grow/team-expansion?project_id=7' }), 'talent');
  assert.equal(taskOfItem({ href: '/grow/reporting/duties' }), 'reporting');
  assert.equal(taskOfItem({ area: 'Somewhere', href: '/elsewhere' }), null);
  assert.equal(growTask({ ...base, items: [{ key: 'x', area: 'Somewhere', href: '/elsewhere' }, item('add_channel', 'Distribution', '/grow/distribution')] }), 'distribution');
  assert.equal(growTask({ ...base, focus: missing, items: [] }), 'focus');
  assert.equal(growTask(base), 'overview');
  // An unreadable or absent read never guesses a task.
  assert.equal(growTask({ ...base, state: 'unreadable', focus: missing, items: [item('set_focus', 'Focus', '/grow/focus')] }), 'overview');
  assert.equal(growTask(null), 'overview');
});

test('each task names its own destinations, at most three plus Perks, which always closes the list with no detail', () => {
  const byTask = {};
  for (const task of Object.keys(RELATED_BY_TASK)) {
    assert.ok(RELATED_BY_TASK[task].length <= 4 && !RELATED_BY_TASK[task].includes('perks'), task);
  }
  for (const [area, path] of [['Customers', '/grow/customers'], ['Talent', '/grow/talent'], ['Partnerships', '/grow/partnerships'], ['Distribution', '/grow/distribution']]) {
    const out = growRelated({ ...base, items: [item('k', area, path)] }, Q);
    byTask[out.task] = out.links.map((l) => l.key);
    const perks = out.links.at(-1);
    assert.deepEqual([perks.key, perks.href, perks.why], ['perks', '/perks', null]);
    assert.equal(out.links.filter((l) => l.key === 'perks').length, 1);
  }
  assert.deepEqual(byTask.customers, ['inbox', 'email', 'research', 'perks']);
  assert.deepEqual(byTask.talent, ['network', 'calendar', 'perks']);
  assert.notDeepEqual(byTask.customers, byTask.talent, 'the list follows the task, not a fixed menu');
  // The static Also in list no longer names anything for Grow.
  assert.deepEqual(alsoInFor('founder', 'Grow'), []);
});

test('a due report lends Reporting its own words; links keep the venture where the route reads it', () => {
  const due = { key: 'report_due', label: 'Investor update · November', why: 'Due 2026-12-03', href: `/grow/reporting${Q}`, area: 'Reporting' };
  const out = growRelated({ ...base, items: [due] }, `${Q}&tab=old`);
  const reporting = out.links.find((l) => l.key === 'reporting');
  assert.deepEqual([reporting.href, reporting.why], [`/grow/reporting${Q}`, 'Due 2026-12-03']);
  const generic = growRelated(base, Q).links;
  assert.equal(generic.find((l) => l.key === 'reporting').why, RELATED.reporting.why);
  assert.equal(generic.find((l) => l.key === 'inbox').href, `/grow/distribution/inbox${Q}`);
  assert.equal(growRelated(base, '?project_id=bad').links.find((l) => l.key === 'inbox').href, '/grow/distribution/inbox');
});

test('every related destination is a route the app registers, so no link is a dead end', () => {
  const routes = Array.from(codeOnly(readRoutesSource()).matchAll(/<Route\s+path="([^"]+)"/g), ([, path]) => ({ path }));
  for (const [key, r] of Object.entries(RELATED)) {
    const path = r.href(Q).split('?')[0];
    const hit = matchRoutes(routes, path)?.at(-1)?.route.path;
    assert.ok(hit && hit !== '*', `${key} → ${path} is not registered`);
    if (path.startsWith('/grow/')) assert.equal(hit, path, `${key} lands on its own route, not a catch-all`);
  }
});

test('the overview draws "For this job" as a labelled navigation landmark after the areas, for the current task', () => {
  const html = overview({ ...base, items: [item('stalled_customers', 'Customers', '/grow/customers')] });
  const nav = related(html);
  assert.ok(nav, 'no For this job list');
  assert.match(nav, /aria-labelledby="grow-related-title"/);
  assert.match(nav, /<h2 id="grow-related-title"[^>]*>For this job<span[^>]*> · Customers<\/span><\/h2>/);
  assert.match(nav, /data-task="customers"/);
  assert.deepEqual(hrefs(nav), [`/grow/distribution/inbox${Q}`, '/email', '/research', '/perks']);
  assert.ok(html.indexOf('data-testid="grow-domains"') < html.indexOf('data-testid="grow-related"'), 'it follows What is happening');
  // Perks is a plain link: no detail line, and nothing on the page promotes it.
  assert.match(nav, /data-testid="grow-related-perks"[^>]*><span>Perks<\/span><\/a>/);
  assert.equal((html.match(/href="\/perks"/g) || []).length, 1);
});

test('a phone reads the list top to bottom: one 44px link per row below 640px, wrapping chips from 640px', () => {
  const nav = related(overview({ ...base, focus: missing, items: [] }));
  assert.match(nav, /data-task="focus"/);
  assert.match(nav, /<ul class="[^"]*\bflex-col\b[^"]*\bsm:flex-row\b[^"]*\bsm:flex-wrap\b/);
  const links = [...nav.matchAll(/<a [^>]*class="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(links.length >= 2);
  for (const c of links) {
    assert.match(c, /\bmin-h-\[44px\]/);
    assert.match(c, /\bw-full\b/);
    assert.match(c, /\bsm:w-auto\b/);
    assert.match(c, /\bfocus-visible:outline\b/);
  }
  assert.doesNotMatch(nav, /overflow-x|whitespace-nowrap/);
});

test('a kept stale read names no task, and loading, refused and failed overviews draw no related list', () => {
  const kept = overview(null, { status: 'unreadable', prior: { read: { raw: { attention: { ...base, items: [item('offers', 'Talent', '/grow/talent')] } }, data: { figures: [], cards: [] }, at: Date.parse('2026-11-19T00:00:00Z') }, figures: {} } });
  assert.match(kept, /data-testid="grow-refresh-failed"/);
  assert.match(related(kept), /data-task="overview"/);
  for (const status of ['loading', 'refused', 'unreadable']) assert.doesNotMatch(overview(base, { status }), /grow-related/, status);
});

test('read-only viewers keep the navigation, which is not an operating action', () => {
  const html = overview(base, { readOnly: true });
  assert.match(html, /Read only/);
  assert.deepEqual(hrefs(related(html)), [`/grow/reporting${Q}`, '/calendar', `/grow/distribution/inbox${Q}`, '/research', '/perks']);
});

test('Reporting is a utility on every Grow header, a record\'s included, and never on another cycle\'s', () => {
  const header = (props) => ssr(h(CycleHeader, { cycle: 'grow', cards: [], search: Q, ...props }));
  const utility = (html) => html.match(/<a [^>]*aria-label="Reporting utility"[^>]*>/)?.[0] || '';
  for (const active of [null, 'customers', 'durable-company-building']) {
    const u = utility(header({ active }));
    assert.match(u, /href="\/grow\/reporting\?project_id=7"/, String(active));
    assert.doesNotMatch(u, /aria-current/);
  }
  assert.match(utility(header({ active: 'reporting' })), /aria-current="page"/);
  const record = utility(header({ active: 'customers', record: true, moduleName: 'Customers', title: 'Acme' }));
  assert.match(record, /href="\/grow\/reporting\?project_id=7"/);
  assert.doesNotMatch(record, /aria-current/);
  // It is outside the area tabs' navigation.
  const html = header({ active: 'customers' });
  const tabs = html.match(/<nav aria-label="Grow modules"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.ok(tabs && !/Reporting/.test(tabs), 'Reporting is not an operating area');
  assert.equal(utility(ssr(h(CycleHeader, { cycle: 'validate', cards: [], search: Q }))), '');
});

test('Distribution\'s own header and Grow\'s phone module pages carry Reporting with the venture', () => {
  const dist = ssr(h(DistributionTabs, { tab: 'channels', search: Q }, h('p', null, 'body')));
  assert.match(dist, /<div class="ds-header-actions flex-wrap">[\s\S]*aria-label="Reporting utility"[^>]*href="\/grow\/reporting\?project_id=7"|<div class="ds-header-actions flex-wrap">[\s\S]*href="\/grow\/reporting\?project_id=7"[^>]*aria-label="Reporting utility"/);
  const phone = (cycle, slug) => ssr(h(PhoneModulePage, { cycle, slug, data: { card: { name: 'M' }, records: { cols: [], rows: [] } }, search: Q }));
  assert.match(phone('grow', 'market-expansion'), /data-testid="grow-reporting-utility"[^>]*>Reporting<\/a>|aria-label="Reporting utility"/);
  assert.match(phone('grow', 'market-expansion'), /href="\/grow\/reporting\?project_id=7"/);
  assert.doesNotMatch(phone('validate', 'problem-discovery'), /Reporting utility/);
});

// ── GR-10: readiness for the next update, from the overview's own figures ──────────────────────────────

const NOW = Date.parse('2026-11-20T12:00:00Z');
const fig = (o) => ({ key: 'mrr', label: 'MRR', unit: 'usd', value: null, delta_30d: null, spark: [], state: 'not_recorded', source: null, as_of: null, reason: null, reason_code: null, freshness: null, ...o });
const READ = {
  figures: [
    fig({ value: 18400, state: 'ok', source: 'stripe', as_of: '2026-11-14', freshness: 'current' }),
    fig({ key: 'nrr', label: 'Net revenue retention', unit: 'pct', value: 104, state: 'ok', source: 'stripe', as_of: '2026-09-30', freshness: 'stale' }),
    fig({ key: 'customers', label: 'Customers', unit: 'count', value: 0, state: 'ok', source: 'manual', as_of: '2026-11-02', freshness: 'current' }),
    fig({ key: 'headcount', label: 'Headcount', unit: 'count', reason_code: 'no_record', reason: 'Not recorded: no roster records headcount' }),
  ],
  changes: { state: 'ready', items: [{ key: 'a' }, { key: 'b' }, { key: 'c' }] },
};

test('readiness says each figure as the overview does: current, stale with its age, a measured zero, not recorded with its reason', () => {
  const view = readinessRows(READ, { now: NOW });
  assert.equal(view.state, 'ready');
  assert.deepEqual(view.rows.map((r) => [r.key, r.kind]), [['mrr', 'current'], ['nrr', 'stale'], ['customers', 'current'], ['headcount', 'not_recorded'], ['highlights', 'current']]);
  assert.deepEqual([view.ready, view.total], [2, 4], 'only a current value counts as ready; highlights are not a figure');
  const by = Object.fromEntries(view.rows.map((r) => [r.key, r]));
  assert.equal(by.mrr.detail, 'Source: Stripe · as of 2026-11-14');
  assert.equal(by.customers.value, '0', 'a measured zero is a value, not missing');
  assert.ok(by.nrr.age, 'a stale figure carries its age');
  assert.equal(by.headcount.value, null);
  assert.equal(by.headcount.detail, 'No roster records headcount.');
  assert.equal(by.highlights.value, '3 from What changed');
  // A failed change feed is Unavailable, never None; an empty one is None.
  assert.equal(readinessRows({ ...READ, changes: { state: 'unreadable' } }).rows.at(-1).kind, 'unavailable');
  assert.equal(readinessRows({ ...READ, changes: { state: 'ready', items: [] } }).rows.at(-1).kind, 'none');
  assert.equal(readinessRows(null).state, 'unavailable');
  assert.equal(readinessRows({ figures: 'x' }).state, 'unavailable');
});

async function mountReadiness(read) {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  const text = (n) => (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { for (let j = 0; j < 4; j += 1) await Promise.resolve(); }); };
  await act(async () => root.render(h(MemoryRouter, null, h(ReportReadiness, { projectId: 7, search: Q, read, now: NOW }))));
  await settle();
  return { byId, text, props, walk, settle, close: async () => { await act(async () => root.unmount()); restore(); } };
}

test('the desk card reads the venture\'s overview once and draws each row with its state chip, and Focus with the venture', async () => {
  const calls = [];
  const t = await mountReadiness(async (id) => { calls.push(id); return READ; });
  try {
    assert.deepEqual(calls, [7]);
    const card = t.byId('reporting-readiness');
    assert.ok(card, 'the card is drawn');
    assert.equal(t.props(card)['aria-labelledby'], 'reporting-readiness-title');
    assert.equal(t.text(t.byId('reporting-readiness-count')), '2 of 4 figures current');
    assert.match(t.text(t.byId('reporting-readiness-nrr')), /Stale/);
    assert.match(t.text(t.byId('reporting-readiness-headcount')), /Not recorded/);
    assert.doesNotMatch(t.text(t.byId('reporting-readiness-mrr')), /Stale|Not recorded|Unavailable/);
    const focus = t.walk(card).find((n) => n.tagName === 'A' && t.text(n) === 'Focus');
    assert.ok(focus, 'Focus is linked');
    assert.equal(t.props(focus).href, `/grow/focus${Q}`);
  } finally { await t.close(); }
});

test('a failed read is Unavailable with Retry, a refused one Refused; neither claims the figures are missing', async () => {
  let n = 0;
  const t = await mountReadiness(async () => { n += 1; if (n === 1) throw new Error('down'); return READ; });
  try {
    const box = t.byId('reporting-readiness-unavailable');
    assert.ok(box);
    assert.doesNotMatch(t.text(box), /Not recorded|0 of/);
    const retry = t.walk(box).find((x) => x.tagName === 'BUTTON');
    await act(async () => t.props(retry).onClick());
    await t.settle();
    assert.ok(t.byId('reporting-readiness'), 'Retry reads again');
  } finally { await t.close(); }
  const r = await mountReadiness(async () => { const e = new Error('no'); e.status = 403; throw e; });
  try {
    assert.ok(r.byId('reporting-readiness-refused'));
    assert.match(r.text(r.byId('reporting-readiness-refused')), /Refused/);
  } finally { await r.close(); }
});
