/**
 * D4873 (#4873, part 2) — the Programs operating console (`design/incoming/Programs v2 Page.dc.html`, PG01,
 * PG05, PG06, PG07).
 *
 * The model: the four headline cards reconcile with the queues beside them; a queue that was not read makes
 * the headline "N+" and Incomplete; a figure that leaves a program out is Incomplete with its coverage; a zero
 * says it was measured; member access is the registry's own field; Needs attention puts queues first; Eadwyn's
 * next steps are its first three, a calm line, or "not available".
 *
 * Mounted against a stubbed Worker: the rows are a table grouped by category with the five states as columns;
 * Rows / Cards, the category and Activity's one Chart / Table are radio groups; the rail draws the next steps
 * in place of its model list.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/programs_overview_4873.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { catalogueBody, labAppsBody, unreadable } from './_programs_catalogue_fixture.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import ProgramsCatalogue from '../src/pages/admin/programs/ProgramsCatalogue.jsx';
import { catalogueCards, waitingChart } from '../src/pages/admin/programs/catalogueModel.js';
import {
  ACCESS_WORDS, STEPS_EMPTY, STEPS_FOOT, STEPS_UNAVAILABLE, attentionState, groupedCards, headlineCards, memberAccessOf, nextSteps,
} from '../src/pages/admin/programs/overviewModel.js';
import { proposalSummary } from '../src/pages/admin/programs/genericProgramModel.js';
import RailSteps from '../src/ui/RailSteps.jsx';

const h = React.createElement;
const ready = (data) => ({ status: 'ready', data, error: null, at: Date.now() });
const loading = () => ({ status: 'loading', data: null, error: null, at: null });

/** The fixture's rows, with member access on each, as the Worker now sends it. */
function withAccess(body, access = {}) {
  const rows = body.programs.rows.map((r) => ({ ...r, member_access: access[r.key] ?? null, modules: [] }));
  return { ...body, programs: { ...body.programs, rows } };
}
/** The model's inputs from one catalogue read. */
function inputs(body, { superAdmin = false, weeks = 12 } = {}) {
  const read = ready(body);
  const { cards } = catalogueCards(read);
  const waiting = waitingChart(read);
  return { read, cards, waiting, weeks, superAdmin };
}
const card = (cards, key) => cards.find((c) => c.key === key);

/* ------------------------------------------------------------------ *
 * The headline cards
 * ------------------------------------------------------------------ */

test('Actions requiring HQ is the waiting tile, broken down by the queues beside it, and the parts add up to it', () => {
  const cards = headlineCards(inputs(catalogueBody()));
  const actions = card(cards, 'waiting');
  assert.equal(actions.label, 'Actions requiring HQ');
  assert.equal(actions.value, '8');
  assert.deepEqual(actions.parts, ['2 Cohort applications', '3 Refer & Earn reviews', '1 Strategic referral access', '1 Perk listings', '1 Office-hours hosts']);
  const sum = actions.parts.reduce((t, p) => t + Number(p.split(' ')[0]), 0);
  assert.equal(String(sum), actions.value, 'the headline reconciles with its queues');
  assert.equal(actions.overdue, true, 'the oldest has waited 80 hours');
  assert.equal(actions.incomplete, undefined);
});

test('a queue that was not read makes the headline "N+", Incomplete, naming the queue: never a complete-looking number', () => {
  const actions = card(headlineCards(inputs(catalogueBody({ waiting: { perks: unreadable('Perk listings') } }))), 'waiting');
  assert.equal(actions.state, 'ready');
  assert.equal(actions.value, '7+', 'cohort 2 + referrals 3 + strategic 1 + hosts 1, and perks unread');
  assert.equal(actions.incomplete, true);
  assert.ok(actions.parts.includes('Perk listings not read'));
  // Every queue unread: no figure at all.
  const all = { cohort: unreadable(), referrals: unreadable(), strategic: unreadable(), perks: unreadable(), hosts: unreadable() };
  assert.equal(card(headlineCards(inputs(catalogueBody({ waiting: all }))), 'waiting').state, 'unreadable');
});

test('People participating that leaves a program out is Incomplete, says how much it covers and what it excludes', () => {
  const people = card(headlineCards(inputs(catalogueBody())), 'people');
  assert.equal(people.label, 'People participating');
  assert.equal(people.value, '312');
  assert.equal(people.incomplete, true);
  assert.deepEqual(people.parts, ['active participants', '4 of 5 programs counted']);
  assert.equal(people.note, 'Excludes Spin-Out Lab');
  const whole = card(headlineCards(inputs(catalogueBody({ people: { available: true, count: 1, previous: 0, covers: ['learning'], left_out: [] } }))), 'people');
  assert.equal(whole.incomplete, false);
  assert.deepEqual(whole.parts, ['active participant']);
});

test('Programs: what is operational, what studios cannot be offered (HQ only, from the grant field), and what is proposed', () => {
  const body = catalogueBody({ superAdmin: true });
  body.programs.rows = body.programs.rows.map((r) => ({ ...r, grant: r.key === 'perks' || r.key === 'learning' ? { state: 'granted_to', granted_count: 2 } : { state: 'hq_only', granted_count: null } }));
  const programs = card(headlineCards(inputs(body, { superAdmin: true })), 'running');
  assert.equal(programs.value, '6 operational');
  assert.deepEqual(programs.parts, ['7 unavailable to studios', '1 proposed']);
  // A grant field that was not read leaves the clause out rather than counting it.
  const partial = catalogueBody({ superAdmin: true });
  partial.programs.rows = partial.programs.rows.map((r, i) => ({ ...r, grant: i ? { state: 'hq_only' } : { available: false, unreadable: true } }));
  assert.deepEqual(card(headlineCards(inputs(partial, { superAdmin: true })), 'running').parts, ['1 proposed']);
  // An Admin reads no offering policy.
  assert.deepEqual(card(headlineCards(inputs(catalogueBody())), 'running').parts, ['1 proposed']);
});

test('Credits: granted and spent in the period, a measured zero says so, and an Admin reads "Not read here yet"', () => {
  const hq = card(headlineCards(inputs(catalogueBody({ superAdmin: true }), { superAdmin: true, weeks: 4 })), 'credits');
  assert.deepEqual([hq.label, hq.value, hq.parts, hq.note], ['Credits · 4 weeks', '3,050 granted', ['2,600 spent'], null]);
  const zero = card(headlineCards(inputs(catalogueBody({ superAdmin: true, creditsTile: { available: true, granted: 0, spent: 0 } }), { superAdmin: true })), 'credits');
  assert.equal(zero.value, '0 granted');
  assert.equal(zero.note, 'Measured zero: nothing granted or spent');
  const admin = card(headlineCards(inputs(catalogueBody())), 'credits');
  assert.equal(admin.state, 'placeholder');
});

test('while the read is loading, every headline is loading; a failed read is Could not be read, never 0', () => {
  for (const c of headlineCards({ read: loading(), cards: [], waiting: { rows: [] }, weeks: 12 })) assert.equal(c.state, 'loading', c.key);
  const failed = headlineCards({ read: { status: 'error', data: null, error: { status: 503 } }, cards: [], waiting: { rows: [] }, weeks: 12 });
  for (const c of failed) { assert.equal(c.state, 'unreadable', c.key); assert.equal(c.value, undefined); }
});

/* ------------------------------------------------------------------ *
 * Member access
 * ------------------------------------------------------------------ */

test('member access is the registry\'s field: its word, Not recorded for null, Could not be read, Not read here yet with no field', () => {
  assert.equal(memberAccessOf({ member_access: 'not_open' }).value, 'Not open to members yet');
  assert.equal(memberAccessOf({ member_access: 'open' }).value, ACCESS_WORDS.open);
  assert.equal(memberAccessOf({ member_access: null }).value, 'Not recorded');
  assert.equal(memberAccessOf({ extras: { available: false, reason: 'down' } }).value, 'Could not be read');
  assert.equal(memberAccessOf({ key: 'perks' }).value, 'Not read here yet', 'an older read with no field is not Not recorded');
  assert.equal(memberAccessOf({ member_access: 'everyone' }).value, 'Could not be read', 'a word the page does not know is not shown as one');
});

/* ------------------------------------------------------------------ *
 * Needs attention and the next steps
 * ------------------------------------------------------------------ */

test('Needs attention: queues first, overdue before waiting, then what is incomplete, then build blockers; each with its state in words', () => {
  const att = attentionState(inputs(catalogueBody()));
  assert.equal(att.state, 'ready');
  const keys = att.items.map((i) => i.key);
  assert.equal(keys[0], 'queue-referrals', 'the only overdue queue (80 hours) leads');
  assert.ok(keys.indexOf('coverage-spinout-lab') > keys.indexOf('queue-hosts'), 'coverage after every queue');
  assert.ok(keys.indexOf('build-referral-partners') > keys.indexOf('coverage-spinout-lab'), 'build blockers last');
  assert.deepEqual(att.items.find((i) => i.key === 'queue-referrals').word, 'Overdue');
  assert.deepEqual(att.items.find((i) => i.key === 'queue-perks').word, 'Waiting');
  assert.equal(att.items.find((i) => i.key === 'coverage-spinout-lab').word, 'Incomplete');
  assert.equal(att.items.find((i) => i.key === 'queue-perks').to, '/admin/programs/perks/queue');
  for (const i of att.items) assert.doesNotMatch(`${i.title} ${i.sub}`, /\bO-FND\b|\bOD-[A-Z0-9]+\b|\bD\d{3,5}\b|#\d{3,5}\b/, 'no internal identifier');
  const unread = attentionState(inputs(catalogueBody({ waiting: { perks: unreadable('Perk listings') } })));
  assert.equal(unread.items.find((i) => i.key === 'unread-perks').word, 'Unavailable');
});

test('Eadwyn\'s next steps: the first three items as links, a calm line when there are none, "not available" when the read failed', () => {
  const steps = nextSteps(attentionState(inputs(catalogueBody())), () => {});
  assert.equal(steps.state, 'ready');
  assert.equal(steps.items.length, 3);
  assert.equal(steps.items[0].text, 'Refer & Earn reviews: 3 overdue. Review the oldest first; it has waited 3 days.');
  assert.equal(steps.items[0].to, '/admin/programs/refer-and-earn/queue');
  assert.equal(steps.items[0].action, 'Open refer & earn reviews');
  assert.equal(steps.foot, STEPS_FOOT);
  const calm = catalogueBody({
    waiting: { cohort: { available: true, count: 0, oldest_hours: null }, referrals: { available: true, count: 0, oldest_hours: null }, strategic: { available: true, count: 0 }, perks: { available: true, count: 0, oldest_hours: null }, hosts: { available: true, count: 0, oldest_hours: null } },
    people: { available: true, count: 3, previous: 0, covers: ['learning'], left_out: [] },
  });
  calm.programs.rows = calm.programs.rows.filter((r) => r.status !== 'partly_built');
  assert.deepEqual(nextSteps(attentionState(inputs(calm))), { title: 'For Programs', state: 'empty', text: STEPS_EMPTY });
  const failed = nextSteps(attentionState({ read: { status: 'error', data: null }, cards: [], waiting: { rows: [] } }), () => 'retry');
  assert.equal(failed.state, 'unavailable');
  assert.equal(failed.text, STEPS_UNAVAILABLE);
  // Eadwyn's own copy never says recommendation or advice (house voice).
  for (const t of [STEPS_EMPTY, STEPS_UNAVAILABLE, STEPS_FOOT, ...steps.items.map((i) => i.text)]) assert.doesNotMatch(t, /recommend|advi[cs]e|fiduciar/i, t);
});

test('the rail\'s steps: a numbered list of links, the empty line, and "not available" with Try again; no model list', () => {
  const steps = nextSteps(attentionState(inputs(catalogueBody())), () => {});
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(RailSteps, { steps, title: steps.title })));
  assert.match(html, /For Programs · 3/);
  assert.match(html, /href="\/admin\/programs\/refer-and-earn\/queue"/);
  assert.match(html, /Needs action: /, 'the glyph has a word for a screen reader');
  assert.match(html, /These are suggestions\. Nothing changes until you act\./);
  const empty = renderToStaticMarkup(h(RailSteps, { steps: { title: 'For Programs', state: 'empty', text: STEPS_EMPTY }, title: 'For Programs' }));
  assert.match(empty, /Nothing needs HQ on Programs right now/);
  const down = renderToStaticMarkup(h(RailSteps, { steps: { state: 'unavailable', text: STEPS_UNAVAILABLE, onRetry: () => {} }, title: 'For Programs' }));
  assert.match(down, /Try again/);
  for (const x of [html, empty, down]) assert.doesNotMatch(x.replace(/<[^>]+>/g, ' '), /model|price|\$/i, 'what a reader sees names no model or price');
});

test('the rows group by category in the canvas\'s order; a custom group sorts last; the filter keeps one category', () => {
  const { cards } = catalogueCards(ready(catalogueBody()));
  const groups = groupedCards([...cards, { key: 'climate-circle', group: 'Climate', name: 'Climate circle' }]);
  assert.deepEqual(groups.map((g) => g.group), ['Ventures', 'Access', 'Network and referrals', 'Rewards', 'Learning', 'Product', 'Climate']);
  assert.deepEqual(groupedCards(cards, 'Access').map((g) => g.cards.map((c) => c.key)), [['mentor-cohorts', 'investor-cohorts']]);
});

test('the proposals summary: awaiting review, the oldest one\'s age and the latest studio, only when every waiting row was read', () => {
  const now = Date.parse('2026-11-07T14:30:00Z');
  const rows = [{ sent_at: '2026-11-04T10:12:00Z', studio: 'Studio North' }, { sent_at: '2026-11-06T09:00:00Z', studio: 'Studio South' }];
  const s = proposalSummary({ state: 'ready', count: 2, rows }, now);
  assert.deepEqual([s.count, s.oldest, s.latestStudio], [2, '3 days', 'Studio South']);
  assert.equal(proposalSummary({ state: 'ready', count: 30, rows }, now).latestStudio, null, 'a later page may hold the latest');
});

/* ------------------------------------------------------------------ *
 * Mounted against a stubbed Worker
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, statusText: '', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const never = () => new Promise(() => {});
const SUPER = { id: 901, role: 'admin', is_super_admin: 1, name: 'HQ', email: 'hq@example.com' };

async function mounted({ body, user = SUPER } = {}) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  globalThis.fetch = async (u) => {
    const [path] = String(u).split('?');
    if (path === '/api/auth/me') return response(user);
    if (path === '/api/admin/programs') return response(body);
    if (path === '/api/admin/spinout-applications') return response(labAppsBody());
    if (path === '/api/admin/insights/scopes') return response({ scopes: [{ code: 'hq', label: 'HQ-held accounts', kind: 'hq' }] });
    if (path === '/api/admin/programs/proposals/queue') return response({ rows: [], total: 0, counts: { sent: 0 } });
    return never();
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  localStorage.setItem('user', JSON.stringify(user));
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootEl = createRoot(container);
  await act(async () => rootEl.render(h(MemoryRouter, { initialEntries: ['/admin/programs'] }, h(AuthProvider, null, h(ProgramsCatalogue)))));
  const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const tag = (n) => String(n?.tagName || '').toUpperCase();
  return {
    byId, props, text, walk, tag,
    textOf: (id) => text(byId(id)),
    has: (id) => Boolean(byId(id)),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id} to click`); await act(async () => { await p.onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => rootEl.unmount()); globalThis.fetch = previous.fetch; globalThis.matchMedia = previous.matchMedia; restore(); },
  };
}

test('mounted: the catalogue is a table grouped by category, the five states are columns, and member access is the stored word', async () => {
  const body = withAccess(catalogueBody({ superAdmin: true }), { learning: 'not_open', perks: 'open' });
  const view = await mounted({ body });
  try {
    const table = view.walk(view.byId('programs-cards')).find((n) => view.tag(n) === 'TABLE');
    assert.ok(table, 'rows are a table');
    const heads = view.walk(table).filter((n) => view.tag(n) === 'TH' && view.props(n).scope === 'col').map((n) => view.text(n));
    assert.deepEqual(heads.slice(0, 6), ['Program', 'Build · state', 'Member access', 'Studio offering', 'Existing grants', 'Activity']);
    const groups = view.walk(table).filter((n) => view.props(n).scope === 'rowgroup').map((n) => view.text(n));
    assert.deepEqual(groups, ['Ventures', 'Access', 'Network and referrals', 'Rewards', 'Learning', 'Product']);
    assert.equal(view.textOf('programs-card-learning-dimensions-access'), 'Not open to members yet');
    assert.equal(view.textOf('programs-card-perks-dimensions-access'), 'Open to all');
    assert.equal(view.textOf('programs-card-mentor-cohorts-dimensions-access'), 'Not recorded');
    assert.equal(view.textOf('programs-card-learning-dimensions-operation'), 'Operational');
  } finally { await view.close(); }
});

test('mounted: Rows / Cards, the category and Activity\'s Chart / Table are radio groups, and one control switches all three charts', async () => {
  const view = await mounted({ body: withAccess(catalogueBody({ superAdmin: true })) });
  try {
    for (const id of ['programs-layout', 'programs-groups', 'programs-activity-view', 'programs-period']) {
      assert.equal(view.props(view.byId(id)).role, 'radiogroup', id);
    }
    assert.equal(view.props(view.byId('programs-layout-rows'))['aria-checked'], true);
    assert.equal(view.has('programs-chart-joins-as-table'), false, 'no per-chart control inside Activity');
    await view.click('programs-activity-as-table');
    assert.equal(view.props(view.byId('programs-activity-as-table'))['aria-checked'], true);
    for (const k of ['joins', 'waiting', 'credits']) assert.ok(view.has(`programs-chart-${k}-table`), `${k} follows the one control`);
    await view.click('programs-layout-cards');
    assert.ok(view.has('programs-card-perks-dimensions'), 'cards list the five as labelled rows');
    await view.click('programs-group-Rewards');
    assert.ok(view.has('programs-card-perks') && !view.has('programs-card-learning'));
  } finally { await view.close(); }
});

test('mounted: Needs attention and the reconciling line sit beside the queues; the rail draws next steps, not the model list', async () => {
  const view = await mounted({ body: withAccess(catalogueBody({ superAdmin: true })) });
  try {
    assert.equal(view.textOf('programs-attention-queue-referrals-word'), 'Overdue');
    assert.equal(view.textOf('programs-waiting-reconciles'), 'Totals 8: the same as Actions requiring HQ.');
    assert.ok(view.has('worker-rail-steps'), 'the rail draws the page\'s next steps');
    assert.ok(view.has('worker-rail-step-queue-referrals'));
    assert.ok(!view.has('text-worker-rail-model-none'), 'no "no row in the rail\'s model list"');
    assert.ok(!view.has('button-worker-rail-all-models'), 'no model list or prices in the normal workflow');
  } finally { await view.close(); }
});
