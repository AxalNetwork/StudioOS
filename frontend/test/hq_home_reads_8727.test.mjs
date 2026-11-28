/**
 * D8727 (#8727) — HQ home tells an escalation load apart from a failure and
 * leads with what needs HQ.
 *
 * The walkthrough of 26 Nov 2026 saw "Escalations could not be read. The
 * overview has not loaded yet." during the first read, which then settled to
 * "Nothing is waiting on HQ": one branch drew a pending read and an unavailable
 * source alike. HQ home now reads the escalation board on its own, beside the
 * overview, and each source has its own Reading, value, All clear and
 * Unavailable state with its own Try again (`HqAttention.jsx`,
 * `hqHomeModel.js`, boards SHQ01 to SHQ06D and SHQ20 of
 * `design/incoming/Studio Home HQ Super Admin Page.dc.html`).
 *
 * The page is mounted over a stubbed `api` and read as rendered. Each rule is
 * also run against its source with the guard removed (mutationCheck), so a
 * mutation that brings the bug class back must fail a test here.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_home_reads_8727.test.mjs
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { mountForm, mutationCheck, propsOf, sourceModule, textOf } from './_form_d695.mjs';
import { api } from '../src/lib/api.js';
import { workApi } from '../src/lib/api/work.js';
import * as model from '../src/pages/hq/hqHomeModel.js';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
const HOME = 'pages/hq/HqHomePage.jsx';
const ATTN = 'pages/hq/HqAttention.jsx';
const MODEL = 'pages/hq/hqHomeModel.js';
const TASKS = 'pages/work/MyTasks.jsx';

/* ------------------------------------------------------------- fixtures */

const NOW = Date.UTC(2026, 10, 26, 9, 14);
const LICENCES = [
  { uid: 'l-fr', brand_name: '[Axal France]', licence_ref: '[AXL-FR-001]', status: 'active', kind: 'subsidiary', territories: ['FR'], seats_licensed: 300, renews_on: '2027-06-30' },
  { uid: 'l-ng', brand_name: '[Northgate Ventures]', licence_ref: '[NGV-IE-006]', status: 'active', kind: 'white_label', territories: ['IE'], seats_licensed: 150, renews_on: '2027-08-01' },
];
const OVERVIEW = {
  accounts: { total: 64 }, seats_licensed: 450, countries_held: ['FR', 'IE'], licences: LICENCES,
  renewals_soon: [], renewals_within_days: 60, suspended: [], events: [],
  queue: { available: true, open: 9, by_status: {} },
  // The overview's own copy of the board is no longer what the card reads.
  escalations_available: false, escalations_reason: 'The hq_escalations table could not be read on this database (migration 259).',
  branches: [
    { code: 'fr', status: 'ok', licence_uid: 'l-fr', as_of: '2026-11-26T09:10:00Z', data: { accounts: { total: 312 }, seats_used: 268, backlog: { count: 3 } } },
    { code: 'ng', status: 'ok', licence_uid: 'l-ng', as_of: '2026-11-26T09:10:00Z', data: { accounts: { total: 88 }, seats_used: 251, backlog: { count: 2 } } },
  ],
  branches_coverage: { total: 2, answered: 2, complete: true, unreadable: [] }, registry_available: true, usage_coverage: null,
};
const ROWS = [
  { uid: 'e-1', branch_code: 'fr', kind: 'moderation', subject: 'Flagged post in the [Paris founders] community', raised_by_name: '[Camille Durand]', created_at: '2026-11-24 10:12:00', due_at: '2026-11-25 18:00:00', sla: 'past' },
  { uid: 'e-2', branch_code: 'de', kind: 'seat_increase', subject: '+40 Founder seats for the [spring cohort]', raised_by_name: '[Tom Becker]', created_at: '2026-11-25 15:02:00', due_at: '2026-11-26 15:00:00', sla: 'due_soon' },
];
const board = (items) => ({ available: true, items, complete: true });
const SERVER_REASON = 'The hq_escalations table could not be read on this database (migration 259).';

/** A promise the test settles by hand. */
function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * Stub the reads. Each of `overview` and `escalations` is a value, an Error to
 * throw, or a function returning a promise (a pending or hand-settled read).
 */
function stub({ overview = OVERVIEW, escalations = board([]), work = 'off' } = {}) {
  const calls = { overview: 0, escalations: 0 };
  const was = { hqOverview: api.hqOverview, escalations: api.escalations, myTasks: workApi.myTasks };
  const answer = (v) => (typeof v === 'function' ? v() : v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  api.hqOverview = () => { calls.overview += 1; return answer(typeof overview === 'object' && Array.isArray(overview) ? overview.shift() : overview); };
  api.escalations = (filter) => {
    calls.escalations += 1;
    assert.deepEqual(filter, { status: 'open' }, 'the card reads the open board');
    return answer(Array.isArray(escalations) ? escalations.shift() : escalations);
  };
  workApi.myTasks = () => (work === 'off'
    ? Promise.reject(Object.assign(new Error('off'), { status: 404, code: 'agent_engine_off' }))
    : Promise.resolve({ tasks: [], compliance: [], more: false }));
  return { calls, restore: () => { api.hqOverview = was.hqOverview; api.escalations = was.escalations; workApi.myTasks = was.myTasks; } };
}

const settle = () => act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); });
async function mountHome(Home, reads) {
  const s = stub(reads);
  const page = await mountForm(h(Home, {}));
  await settle();
  return { page, ...s, async done() { s.restore(); await page.unmount(); } };
}

const card = (page) => page.by('hq-escalations-card');
const live = (page) => textOf(page.by('hq-home-live'));
const subtree = (n) => [n, ...(n.childNodes || []).flatMap(subtree)];
// Alerts in the page's own content (the shared rail is outside it); the card harness has no such sections.
const alerts = (page) => {
  const roots = ['hq-attention', 'hq-platform'].map((id) => page.by(id)).filter(Boolean);
  return (roots.length ? roots.flatMap(subtree) : page.nodes()).filter((n) => propsOf(n).role === 'alert');
};
const buttons = (page, label) => page.nodes().filter((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
// The page's own content, without the shared Eadwyn rail (which has reads of its own).
const main = (page) => ['hq-scope-bar', 'hq-attention', 'hq-platform'].map((id) => textOf(page.by(id))).join(' | ');
const headings = (page) => page.nodes().filter((n) => /^H[1-3]$/.test(n.tagName)).map((n) => `${n.tagName} ${textOf(n).trim()}`);

/* --------------------------------------------------------------- pure */

function verifyModel(m) {
  // A failed read and an answer of `available: false` are failures; only a list after a good read is a value.
  assert.deepEqual(m.escalationOutcome({ available: false, reason: SERVER_REASON, items: [] }), { phase: 'failed' });
  assert.deepEqual(m.escalationOutcome(null), { phase: 'failed' });
  assert.deepEqual(m.escalationOutcome({ available: true }), { phase: 'failed' });
  assert.deepEqual(m.escalationOutcome(board([])), { phase: 'ok', items: [], complete: true });
  assert.equal(m.escalationCount(ROWS), '2 open · 1 past SLA');
  assert.equal(m.escalationCount([]), '0 open');
  assert.equal(m.escalationCount(ROWS, false), 'at least 2 open · 1 past SLA');
  assert.equal(m.attentionLine({ phase: 'ok', items: ROWS, complete: true }), '2 escalations, 1 past SLA');
  assert.equal(m.attentionLine({ phase: 'ok', items: [], complete: true }), 'Nothing is waiting on HQ');
  assert.equal(m.attentionLine({ phase: 'reading', items: [] }), '', 'a pending read claims nothing');
  assert.equal(m.attentionLine({ phase: 'failed', items: [] }), '', 'a failed read claims nothing');
  assert.equal(m.retrySucceeded(ROWS), 'Escalations read. 2 waiting on HQ, 1 past SLA.');
  assert.equal(m.retrySucceeded([]), 'Escalations read. Nothing is waiting on HQ.');
  // Names come from the overview, by branch code; a code with no licence behind it gets no name.
  const names = m.namesByCode(OVERVIEW);
  assert.equal(names.get('fr'), '[Axal France]');
  assert.equal(names.has('de'), false);
  assert.equal(m.namesByCode(null).size, 0);
  assert.equal(m.dueDistance('2026-11-25 18:00:00', NOW), '15 h past due');
  assert.equal(m.dueDistance('2026-11-26 15:00:00', NOW), 'due in 5 h 46 min');
  assert.equal(m.stampLabel('2026-11-24 10:12:00'), '24 Nov 10:12');
  assert.equal(m.clockUtc(NOW), '09:14 UTC');
  assert.equal(m.kindLabel('seat_increase'), 'Seat increase');
  assert.equal(m.ESCALATIONS_SLOW_MS, 8000);
  assert.equal(m.ESCALATIONS_DEADLINE_MS, 20000);
  // Client copy names no ticket, migration or table.
  for (const line of [...Object.values(m.ANNOUNCE), m.HQ_WORK_OFF]) assert.doesNotMatch(line, /#\d|migration|table/i, line);
}

test('the model: a failed or unavailable read is never the all-clear, and the words are the canvas\'s', async () => {
  await mutationCheck(read(MODEL), MODEL, verifyModel, [
    ["res.available === false || ", ''],
    ['|| !Array.isArray(res.items)', ''],
    ["if (name) out.set(b.code, name);", ''],
    ["if (!read || read.phase !== 'ok') return '';", ''],
    ["const open = complete === false ? `at least ${n} open` : `${n} open`;", 'const open = `${n} open`;'],
  ]);
});

/* -------------------------------------------------- the page, rendered */

async function verifyStates(mod) {
  const Home = mod.default;

  // SHQ01 — pending: Reading, never "could not be read"; the overview's cards are usable.
  {
    const t = await mountHome(Home, { escalations: () => new Promise(() => {}) });
    try {
      assert.equal(propsOf(card(t.page))['data-read'], 'reading');
      assert.equal(propsOf(card(t.page))['aria-busy'], 'true');
      assert.match(textOf(card(t.page)), /Reading the escalations…/);
      assert.doesNotMatch(main(t.page), /could not be read|Unavailable/, 'a pending read was drawn as a failure');
      assert.doesNotMatch(main(t.page), /Nothing is waiting on HQ|All clear/, 'a pending read was drawn as the all-clear');
      assert.equal(buttons(t.page, 'Try again').length, 0, 'a pending read offers a retry');
      assert.equal(propsOf(t.page.by('hq-other-signals'))['data-read'], 'ok');
      assert.ok(t.page.by('hq-tenant-switcher'), 'the switcher waits on the escalation read');
    } finally { await t.done(); }
  }

  // SHQ02 — a successful empty read is the all-clear, with a count of 0 only now.
  {
    const t = await mountHome(Home, { escalations: board([]) });
    try {
      assert.ok(t.page.by('hq-escalations-clear'));
      assert.match(textOf(card(t.page)), /All clear/);
      assert.match(textOf(card(t.page)), /Nothing is waiting on HQ\./);
      assert.equal(textOf(t.page.by('hq-escalations-count')), '0 open');
      assert.doesNotMatch(textOf(card(t.page)), /could not be read|Unavailable/);
    } finally { await t.done(); }
  }

  // SHQ03 — two escalations: each row one link to Support's Queue, named from the overview.
  {
    const t = await mountHome(Home, { escalations: board(ROWS) });
    try {
      const rows = t.page.nodes().filter((n) => propsOf(n)['data-testid'] === 'hq-escalation-row');
      assert.equal(rows.length, 2);
      for (const row of rows) {
        const links = subtree(row).filter((n) => n.tagName === 'A');
        assert.equal(links.length, 1, 'a row is one link');
        assert.equal(links[0].getAttribute?.('href') ?? propsOf(links[0]).href, '/admin/hq-support');
      }
      assert.match(textOf(rows[0]), /Past SLA/);
      assert.match(textOf(rows[0]), /\[Axal France\]fr/);
      assert.match(textOf(rows[1]), /BranchdeSeat increase/, 'a code with no licence behind it is shown as the code alone');
      assert.equal(textOf(t.page.by('hq-escalations-count')), '2 open · 1 past SLA');
      // Seats used are summed as numbers, not joined as formatted strings (268 + 251 = 519, never "268,251").
      assert.match(textOf(t.page.by('hq-platform')), /utilised: 519 · summed from branch reads/);
      assert.match(t.page.text(), /What needs my attention\?2 escalations, 1 past SLA/);
      assert.ok(t.page.by('hq-escalations-answer-link'));
      assert.ok(!t.page.text().includes(SERVER_REASON), 'the overview\'s stale escalation reason was printed');
    } finally { await t.done(); }
  }

  // SHQ04 → SHQ06 → SHQ06B: failed, announced once, Try again reads only this card.
  {
    const again = deferred();
    const t = await mountHome(Home, { escalations: [new Error('down'), () => again.promise] });
    try {
      assert.equal(propsOf(card(t.page))['data-read'], 'failed');
      assert.match(textOf(card(t.page)), /Escalations could not be read\.This is not a claim that none are waiting\./);
      assert.equal(alerts(t.page).length, 0, 'a first-load failure is polite, not an alert');
      assert.equal(live(t.page), model.ANNOUNCE.failed);
      assert.equal(t.page.by('hq-platform') && propsOf(t.page.by('hq-other-signals'))['data-read'], 'ok', 'the other cards stayed usable');
      const overviewReads = t.calls.overview;
      await act(async () => propsOf(t.page.by('hq-escalations-retry')).onClick());
      assert.equal(t.calls.escalations, 2);
      assert.equal(t.calls.overview, overviewReads, 'Try again on escalations re-read the overview');
      assert.match(textOf(card(t.page)), /Reading the escalations again…/);
      assert.match(textOf(card(t.page)), /Only this card is being read again\./);
      assert.equal(live(t.page), model.ANNOUNCE.retrying);
      assert.equal(propsOf(t.page.by('hq-other-signals'))['data-read'], 'ok', 'the other cards are usable while this one retries');
      await act(async () => { again.resolve(board(ROWS)); });
      await settle();
      assert.equal(propsOf(card(t.page))['data-read'], 'ok');
      assert.match(textOf(card(t.page)), /Read again at/);
      assert.equal(live(t.page), 'Escalations read. 2 waiting on HQ, 1 past SLA.');
    } finally { await t.done(); }
  }

  // SHQ06C — a retry that fails again is an alert, because the person pressed Try again.
  {
    const t = await mountHome(Home, { escalations: [new Error('down'), new Error('still down')] });
    try {
      await act(async () => propsOf(t.page.by('hq-escalations-retry')).onClick());
      await settle();
      const alert = alerts(t.page);
      assert.equal(alert.length, 1);
      assert.match(textOf(alert[0]), /^Escalations still could not be read\./);
      assert.equal(live(t.page), model.ANNOUNCE.retrying, 'the failed retry was announced twice, once politely');
    } finally { await t.done(); }
  }

  // An answer of `available: false` is a failure, and the server's reason (a table and a migration) is not printed.
  {
    const t = await mountHome(Home, { escalations: { available: false, reason: SERVER_REASON, items: [] } });
    try {
      assert.equal(propsOf(card(t.page))['data-read'], 'failed');
      assert.doesNotMatch(main(t.page), /All clear|Nothing is waiting/);
      assert.doesNotMatch(t.page.text(), /migration|hq_escalations/);
    } finally { await t.done(); }
  }

  // SHQ06D — the overview failed; escalations are current and shown by branch code.
  {
    const t = await mountHome(Home, { overview: [new Error('overview down'), OVERVIEW], escalations: board(ROWS) });
    try {
      assert.equal(propsOf(card(t.page))['data-read'], 'ok');
      assert.ok(t.page.by('hq-escalations-codes-only'));
      assert.match(textOf(t.page.nodes().find((n) => propsOf(n)['data-testid'] === 'hq-escalation-row')), /Branchfr/);
      const block = t.page.by('hq-home-overview-unavailable');
      assert.match(textOf(block), /The HQ overview could not be read\./);
      assert.match(textOf(block), /Escalations above come from their own read and are current\./);
      assert.equal(live(t.page), model.ANNOUNCE.overviewFailed);
      assert.equal(propsOf(t.page.by('hq-other-signals'))['data-read'], 'failed');
      assert.doesNotMatch(textOf(t.page.by('hq-other-signals')), /None on the ledger|\b0\b/, 'a failed overview drew a count');
      const escReads = t.calls.escalations;
      await t.page.click('Try again');
      await settle();
      assert.equal(t.calls.escalations, escReads, 'the overview\'s Try again re-read escalations');
      assert.equal(t.calls.overview, 2);
      assert.ok(!t.page.by('hq-escalations-codes-only'), 'names come back with the overview');
    } finally { await t.done(); }
  }

  // SHQ05 — cold load: both pending, the switcher is not drawn (never drawn disabled), no kind filter.
  {
    const t = await mountHome(Home, { overview: () => new Promise(() => {}), escalations: () => new Promise(() => {}) });
    try {
      assert.equal(live(t.page), model.ANNOUNCE.coldLoad);
      assert.ok(!t.page.by('hq-tenant-switcher'), 'a disabled switcher is drawn while the ledger loads');
      assert.ok(!t.page.by('hq-kind-filter'));
      assert.match(textOf(t.page.by('hq-scope-bar')), /Reading the licence ledger…/);
      assert.equal(propsOf(t.page.by('hq-other-signals'))['data-read'], 'reading');
      assert.doesNotMatch(main(t.page), /could not be read|Unavailable/);
    } finally { await t.done(); }
  }

  // The kind filter only when both kinds hold a licence.
  {
    const t = await mountHome(Home, { overview: { ...OVERVIEW, licences: [LICENCES[0]] } });
    try { assert.ok(!t.page.by('hq-kind-filter'), 'a filter that cannot change the cards was drawn'); } finally { await t.done(); }
  }
}

test('each source has its own Reading, value, All clear and Unavailable, and its own Try again', async () => {
  await mutationCheck(read(HOME), HOME, verifyStates, [
    // Retrying escalations re-reads the overview too.
    ['onRetry={retryEscalations}', 'onRetry={() => { retryEscalations(); load(); }}'],
    // The switcher is drawn (empty) while the ledger loads.
    ['{ready && licences.length > 0 ? (', '{true ? ('],
    // The kind filter is drawn whatever the ledger holds.
    ['const bothKinds = ready && kindCount.subsidiary > 0 && kindCount.white_label > 0;', 'const bothKinds = ready;'],
    // The overview's failure is not announced.
    ['announce(escFailed.current ? ANNOUNCE.overviewFailedToo : ANNOUNCE.overviewFailed);', ''],
    // Subsidiary names stop coming from the overview.
    ['const names = useMemo(() => namesByCode(ready ? data : null), [ready, data]);', 'const names = new Map();'],
    // Seats used summed as the display strings again.
    ['sum += Number(b.data.seats_used);', 'sum += num(b.data.seats_used);'],
  ]);
});

/* -------------------------------------- the card's own rules, mutated */

/** Mount the card over the hook from a (possibly mutated) HqAttention module. */
function harness(mod, opts = {}) {
  return function Harness() {
    const [said, setSaid] = React.useState([]);
    const { read: r, retry } = mod.useEscalationRead({ announce: (text) => setSaid((s) => [...s, text]), overviewReady: () => opts.overviewReady ?? true });
    return h('div', null,
      h(mod.EscalationsCard, { read: r, onRetry: retry, names: new Map(), overview: opts.overview || 'ok', now: NOW }),
      h('output', { 'data-testid': 'said' }, said.join('|')));
  };
}

async function verifyCard(mod) {
  // Pending is Reading; failed is Unavailable with Try again; a failed first load is said once and is no alert.
  {
    const s = stub({ escalations: () => new Promise(() => {}) });
    const page = await mountForm(h(harness(mod)));
    try {
      await settle();
      assert.equal(propsOf(page.by('hq-escalations-card'))['data-read'], 'reading');
      assert.doesNotMatch(page.text(), /could not be read|Try again/);
    } finally { s.restore(); await page.unmount(); }
  }
  {
    const s = stub({ escalations: [new Error('a'), new Error('b')] });
    const page = await mountForm(h(harness(mod)));
    try {
      await settle();
      assert.equal(propsOf(page.by('hq-escalations-card'))['data-read'], 'failed');
      assert.equal(alerts(page).length, 0, 'a first-load failure is an alert');
      assert.equal(textOf(page.by('said')), model.ANNOUNCE.failed);
      await act(async () => propsOf(page.by('hq-escalations-retry')).onClick());
      await settle();
      assert.equal(alerts(page).length, 1, 'a failed retry is not an alert');
      assert.equal(textOf(page.by('said')), [model.ANNOUNCE.failed, model.ANNOUNCE.retrying].join('|'), 'the failed retry was also said politely');
    } finally { s.restore(); await page.unmount(); }
  }
  {
    const s = stub({ escalations: board([]) });
    const page = await mountForm(h(harness(mod)));
    try {
      await settle();
      assert.ok(page.by('hq-escalations-clear'));
      assert.equal(buttons(page, 'Try again').length, 0);
    } finally { s.restore(); await page.unmount(); }
  }
}

test('the escalation card: pending is never a failure, a failure is said once, a failed retry is an alert', async () => {
  await mutationCheck(read(ATTN), ATTN, verifyCard, [
    // The defect of 26 Nov: one branch for "not loaded yet" and "could not be read".
    ["const failed = read.phase === 'failed';", "const failed = read.phase !== 'ok';"],
    ["role={read.retry ? 'alert' : undefined}", 'role="alert"'],
    ["role={read.retry ? 'alert' : undefined}", 'role={undefined}'],
    ["if (out.phase === 'failed' && !retry && !failAnnounced.current)", "if (out.phase === 'failed')"],
  ]);
});

/* ---------------------------------------------- slow at 8 s, failed at 20 s */

async function verifyClock(mod) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const late = deferred();
  const s = stub({ escalations: () => late.promise });
  const page = await mountForm(h(harness(mod)));
  try {
    await settle();
    await act(async () => { mock.timers.tick(model.ESCALATIONS_SLOW_MS - 1); });
    assert.ok(!page.by('hq-escalations-slow'), 'slow was shown before 8 s');
    await act(async () => { mock.timers.tick(1); });
    assert.ok(page.by('hq-escalations-slow'), 'no slow line at 8 s');
    assert.equal(textOf(page.by('said')), model.ANNOUNCE.slow);
    assert.equal(propsOf(page.by('hq-escalations-card'))['data-read'], 'reading', 'slow is still reading, not failed');
    await act(async () => { mock.timers.tick(model.ESCALATIONS_DEADLINE_MS - model.ESCALATIONS_SLOW_MS); });
    await settle();
    assert.equal(propsOf(page.by('hq-escalations-card'))['data-read'], 'failed', 'no answer at 20 s did not count as failed');
    assert.match(textOf(page.by('hq-escalations-card')), /Tried at 09:14 UTC/);
    // The answer that arrives after the deadline is ignored, not drawn over the failure.
    await act(async () => { late.resolve(board(ROWS)); });
    await settle();
    assert.equal(propsOf(page.by('hq-escalations-card'))['data-read'], 'failed', 'a late answer replaced the failure');
  } finally { s.restore(); await page.unmount(); mock.timers.reset(); }
}

test('escalations still reading at 8 s say so; no answer at 20 s is a failure, and a late answer is ignored', async () => {
  await mutationCheck(read(ATTN), ATTN, verifyClock, [
    ['timers.current.push(setTimeout(() => finish(null), ESCALATIONS_DEADLINE_MS));', ''],
    ['setRead((r) => ({ ...r, slow: true }));', ''],
    ['if (settled || seq.current !== id) return;\n      settled = true;', 'settled = true;'],
  ]);
});

/* ------------------------------------------- order, headings and Work while off */

async function verifyOrder(mod) {
  const Home = mod.default;
  const t = await mountHome(Home, { escalations: board(ROWS) });
  try {
    const hs = headings(t.page);
    assert.equal(hs[0], 'H1 HQ home', 'the first heading does not name HQ');
    const at = (label) => hs.indexOf(label);
    assert.ok(at('H2 What needs my attention?') > 0);
    assert.ok(at('H2 What needs my attention?') < at('H3 Escalations awaiting HQ'));
    assert.ok(at('H3 Escalations awaiting HQ') < at('H2 Platform'));
    assert.ok(at('H2 Platform') < at('H2 Subsidiary health'));
    assert.ok(at('H2 Subsidiary health') < at('H2 Licensing events'));
    assert.equal(hs.at(-1).startsWith('H2 My tasks'), true, 'My tasks is not last');
    // Work is off: one sentence, no Show or Due, no issue number anywhere a person reads.
    const tasks = t.page.by('hq-my-tasks');
    assert.match(textOf(tasks), new RegExp(model.HQ_WORK_OFF.replace(/[.]/g, '\\.')));
    assert.ok(!t.page.by('hq-my-tasks-state') && !t.page.by('hq-my-tasks-due'), 'Show and Due are drawn while Work is off');
    assert.doesNotMatch(t.page.text(), /#\d{3,}/, 'client copy cites a ticket');
  } finally { await t.done(); }
}

test('the first heading names HQ, escalations come before Platform, and My tasks is last with no filters while Work is off', async () => {
  await mutationCheck(read(HOME), HOME, verifyOrder, [
    ['>HQ home</h1>', '>Platform</h1>'],
    ['offReason={HQ_WORK_OFF} hideControlsWhenOff', ''],
  ]);
});

async function verifyTasks(mod) {
  const MyTasks = mod.default;
  for (const [work, drawn] of [['off', false], ['on', true]]) {
    const s = stub({ work });
    const page = await mountForm(h(MyTasks, { licence: 'admin', testId: 'mt', offReason: model.HQ_WORK_OFF, hideControlsWhenOff: true }));
    try {
      await settle();
      assert.equal(Boolean(page.by('mt-state')), drawn, `Show drawn: ${!drawn} with Work ${work}`);
      assert.equal(Boolean(page.by('mt-due')), drawn, `Due drawn: ${!drawn} with Work ${work}`);
      if (work === 'off') {
        assert.match(textOf(page.by('mt-off')), /Not switched on/);
        assert.doesNotMatch(page.text(), /#3969/);
        assert.notEqual(propsOf(page.by('mt-off')).role, 'status', 'a second live region');
      }
    } finally { s.restore(); await page.unmount(); }
  }
  // Without the props, every other workspace keeps today's behaviour.
  const s = stub({ work: 'off' });
  const page = await mountForm(h(MyTasks, { licence: 'founder', testId: 'mt' }));
  try {
    await settle();
    assert.ok(page.by('mt-state') && page.by('mt-due'));
    assert.match(textOf(page.by('mt-off')), /#3969/);
  } finally { s.restore(); await page.unmount(); }
}

test('My tasks draws Show and Due only when they can change the result, for the page that asks', async () => {
  await mutationCheck(read(TASKS), TASKS, verifyTasks, [
    ['const controls = !hideControlsWhenOff || engineOn;', 'const controls = true;'],
    ['const controls = !hideControlsWhenOff || engineOn;', 'const controls = !engineOn;'],
    ["reason: offReason || r.reason", 'reason: r.reason'],
  ]);
});

/* -------------------------------------------------------------- sources */

test('the card reads the board on its own route, and the page imports nothing it does not draw', async () => {
  const attn = read(ATTN);
  assert.match(attn, /api\.escalations\(\{ status: 'open' \}\)/);
  // Each row and Answer on Support use a literal Support address (the route-reachability walk reads literals).
  assert.ok((attn.match(/to="\/admin\/hq-support"/g) || []).length >= 3);
  // The module parses and exports what HqHomePage imports.
  const mod = await sourceModule(attn, ATTN);
  for (const name of ['EscalationsCard', 'OtherSignals', 'useEscalationRead']) assert.equal(typeof mod[name], 'function', name);
});
