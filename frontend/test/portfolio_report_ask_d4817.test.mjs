/**
 * D4817 part 9 (#5311, addendum PFA03–PFA05, PFA10): "Ask for this report"
 * and "Waive this period" on the company workspace's Reports. The real page
 * (`PortfolioCompanyPage` at `/portfolio/companies/:uid/reports`) is mounted
 * against a stubbed `fetch` that answers as `routes/reporting.ts` does, and
 * each step is walked: the obligation card (Prepare), the Review, the confirm
 * naming the act, the Receipt from the Worker's stored record, a failed send
 * that keeps the draft and shows the Worker's error, and the period's state
 * afterwards, read again from the record. A session the Worker says may not
 * act sees no action. Desktop (1280) and phone (390).
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/portfolio_report_ask_d4817.test.mjs
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - the obligation's Ask posting before the Review → tests 2, 4–8;
 *   - the Review's confirm posting to `/waive` for an Ask → tests 2–5, 8;
 *   - the Receipt drawing the browser's time in place of `asked_at` → tests 3, 8;
 *   - `receiptOf` reading the founder team's size as the in-app notices
 *     stored → tests 3, 9;
 *   - the Review closing on a refusal (the draft lost) → test 4;
 *   - the refusal drawn without the Worker's code → test 4;
 *   - the page not reading the company again after an act → tests 5, 6;
 *   - the period drawn as asked from the press, not the re-read → test 5;
 *   - `recordOf` reading a waiver with no recorded author as "by you" → tests 6, 9;
 *   - `accessOf` ignoring `can_act: false` → tests 7, 9;
 *   - the timeline drawing Ask and Waive when `canAct` is false → test 7;
 *   - `openPeriodsOf` putting a due period before a late one → tests 1–6, 8, 9;
 *   - (owner answer 2026-11-14) the card's Waive ignoring `can_waive`, the
 *     timeline's Waive ignoring it, and the Worker's reason not drawn → test 11.
 * (Reverted, all pass.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import PortfolioCompanyPage from '../src/pages/investor/PortfolioCompanyPage.jsx';
import {
  ASK, WAIVE, accessOf, actionsOf, confirmLabel, obligationOf, openPeriodsOf, receiptOf, recordOf, refusalOf, stampOf, waiveRefusalOf,
} from '../src/pages/portfolio/reportAsk.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob(['x']) });

/* ------------------------------------------------------------------ fixtures (invented) */

const period = (uid, duty, label, due, state, extra = {}) => ({
  uid, duty_uid: duty, label, start: null, end: null, due_on: due, expected_on: null, expected_note: null, waived_at: null, sent_at: null,
  days_late: null, days_left: null, asked: false, asked_at: null, waived_by_you: null, report_uid: null, state, ...extra,
});
const DUTIES = [
  { uid: 'd-kpi', kind: 'quarterly_kpi', title: 'Quarterly KPI report', cadence: 'quarterly', due_rule: 'after_end', due_days: 45, required_figures: ['mrr', 'net_burn'], required_documents: [], source: { document: 'voting_rights', clause: '§1.1(b)', signed: true }, defaulted: [], holding: { route: 'syndicate' } },
  { uid: 'd-mon', kind: 'monthly_financials', title: 'Monthly financial statements', cadence: 'monthly', due_rule: 'after_end', due_days: 30, required_figures: ['cash', 'revenue', 'net_burn'], required_documents: ['statements'], source: { document: 'voting_rights', clause: '§7.2', signed: true }, defaulted: [], holding: { route: 'syndicate' } },
];
// The due period is listed before the late one, so the card's choice is the model's, not the order.
const PERIODS = [
  period('pq2', 'd-kpi', '2026-Q2', '2026-08-14', 'sent', { sent_at: '2026-08-12 10:00:00', report_uid: 'r2' }),
  period('pq3', 'd-kpi', '2026-Q3', '2026-11-14', 'due', { days_left: 9 }),
  period('pm9', 'd-mon', '2026-09', '2026-10-30', 'late', { start: '2026-09-01', end: '2026-09-30', days_late: 6 }),
];
const company = (periods = PERIODS) => ({ uid: 'p-abc', name: 'Northwind Labs', duties: DUTIES, periods });
const owed = (periods, extra = {}) => ({ ok: true, today: '2026-11-05', can_act: true, act_refusal: null, company: company(periods), ...extra });
const ASK_ANSWER = {
  ok: true, asked: true, chase_uid: 'c0ffee00c0ffee00c0ffee00c0ffee00', period: { uid: 'pm9', label: '2026-09' },
  asked_at: '2026-11-05 09:15:00', by_you: true, told: { team: 2, in_app: 1 },
};
const WAIVE_ANSWER = { ok: true, waived: true, period: { uid: 'pm9', label: '2026-09' }, waived_at: '2026-11-05 14:40:00', waived_by_you: true };
const withPm9 = (extra) => PERIODS.map((p) => (p.uid === 'pm9' ? { ...p, ...extra } : p));

/* ------------------------------------------------------------------ harness */

function screen(width) {
  const was = globalThis.matchMedia;
  globalThis.matchMedia = (query) => {
    const m = /max-width:\s*(\d+)/.exec(query);
    return { matches: m ? width <= Number(m[1]) : false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  };
  return () => { globalThis.matchMedia = was; };
}

/**
 * Mount the company Reports. `reporting` answers the company read, and may be
 * a function of how many times it was read, so a re-read can see the record change.
 */
async function reportsAt({ reporting = () => owed(PERIODS), post = {}, width = 1280 } = {}) {
  const restore = installDocument();
  const back = screen(width);
  const prev = { fetch: globalThis.fetch };
  const calls = [];
  let reads = 0;
  const routes = {
    '/positions': { items: [{ project_id: 4, project: { uid: 'p-abc', name: 'Northwind Labs', stage: 'Seed' }, total_invested: 250000, latest_ownership_pct: 6.2 }] },
    '/reporting/companies/p-abc/figures': { ok: true, reports: [] },
    '/portfolio/health/p-abc': { latest: null, history: [] },
    '/portfolio-support': { entries: [], companies: [], page: { next_offset: null }, page_state: 'recorded', totals: { promised: 0, delivered: 0, withdrawn: 0 } },
    '/portfolio-updates?project_id=4': { items: [] },
  };
  globalThis.fetch = async (u, opts = {}) => {
    const path = String(u).replace(/^.*\/api/, '');
    const method = opts.method || 'GET';
    calls.push({ path, method });
    if (path.includes('client-error')) return response({});
    if (method === 'GET' && path === '/reporting/companies/p-abc') { reads += 1; return response(reporting(reads)); }
    if (method === 'POST') {
      const hit = post[path];
      const out = typeof hit === 'function' ? hit(calls.filter((c) => c.method === 'POST' && c.path === path).length) : hit;
      if (!out) return response({ error: 'not_stubbed', message: 'Not stubbed.' }, 500);
      return out.__status ? response(out.body, out.__status) : response(out);
    }
    return response(routes[path] ?? {});
  };
  localStorage.setItem('user', JSON.stringify({ id: 6, role: 'investor', name: 'Ivy' }));
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const flush = async () => { for (let i = 0; i < 16; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/portfolio/companies/p-abc/reports'] }, h(Routes, null,
    h(Route, { path: '/portfolio/companies/:uid/reports', element: h(PortfolioCompanyPage) })))));
  await flush();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(document.body).find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : (n.childNodes || []).map(txt).join(' ') || n.textContent || '');
  return {
    has: (id) => !!by(id), props: (id) => pr(by(id)),
    text: (id) => txt(id ? by(id) : document.body).replace(/\s+/g, ' ').trim(),
    within: (id, tag) => walk(by(id) || { childNodes: [] }).filter((n) => n.tagName === tag),
    posts: () => calls.filter((c) => c.method === 'POST').map((c) => c.path),
    reads: () => reads,
    click: async (id) => { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { pr(n).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prev.fetch; localStorage.removeItem('user'); back(); restore(); },
  };
}

/* ------------------------------------------------------------------ the steps */

test('1 · Prepare: the obligation card names the company, the most pressing period, due, received, missing, your last ask, source and route', async () => {
  const v = await reportsAt();
  try {
    assert.ok(v.has('report-obligation'));
    const facts = v.text('report-obligation-facts');
    assert.match(v.text('report-obligation'), /^Sep 2026 reporting obligation Late · 6 days/, 'the late period, not the due one listed first');
    assert.match(facts, /Company Northwind Labs/);
    assert.match(facts, /Period Sep 2026 · 1 Sep 2026 – 30 Sep 2026/);
    assert.match(facts, /Report Monthly financial statements/);
    assert.match(facts, /Due 30 Oct 2026/);
    assert.match(facts, /Received Not received/);
    assert.match(facts, /Missing Monthly financial statements · 3 required figures · 1 required document/);
    assert.match(facts, /Your last ask You have not asked for this period/);
    assert.match(facts, /Source Investors’ Rights Agreement · §7\.2/);
    assert.match(facts, /Holding route Via a syndicate \(SPV\)/);
    assert.ok(v.has('report-obligation-ask') && v.has('report-obligation-waive'));
    assert.match(v.text('report-obligation-others'), /1 other open period is listed below/);
    assert.deepEqual(v.posts(), [], 'drawing the card sends nothing');
  } finally { await v.close(); }
});

test('2 · Review: who acts, what is recorded, who is told and the period, before anything is sent; the confirm names the act', async () => {
  const v = await reportsAt({ post: { '/reporting/periods/pm9/ask': ASK_ANSWER } });
  try {
    await v.click('report-obligation-ask');
    assert.ok(v.has('report-review-ask'));
    assert.deepEqual(v.posts(), [], 'opening the Review sends nothing');
    const review = v.text('report-review-facts');
    assert.match(review, /Who acts You, as the holder this period is owed to/);
    assert.match(review, /What is recorded One request for this missing period, with the time, on the reporting record/);
    assert.match(review, /Who is told The founder team of Northwind Labs, in the app and by email\. No other investor/);
    assert.match(review, /Company Northwind Labs.*Period Sep 2026 · Monthly financial statements · due 30 Oct 2026.*Holding route Via a syndicate \(SPV\).*Source Investors’ Rights Agreement · §7\.2/);
    assert.match(v.text('report-review-ask'), /Step 1 of 2 · Review\. Nothing is sent until you confirm\./);
    assert.match(v.text('report-review-ask'), /Email delivery is not confirmed here/);
    assert.equal(v.text('report-review-confirm'), 'Ask Northwind Labs · Sep 2026');
    await v.click('report-review-confirm');
    assert.deepEqual(v.posts(), ['/reporting/periods/pm9/ask']);
  } finally { await v.close(); }
  // Cancel sends nothing and re-reads nothing.
  const c = await reportsAt();
  try {
    await c.click('report-obligation-ask');
    const before = c.reads();
    await c.click('report-review-cancel');
    assert.ok(!c.has('report-review-ask'));
    assert.deepEqual([c.posts(), c.reads()], [[], before]);
  } finally { await c.close(); }
});

test('3 · Receipt: drawn from the Worker’s stored record — its time, author, period, notices stored and reference', async () => {
  const v = await reportsAt({ post: { '/reporting/periods/pm9/ask': ASK_ANSWER } });
  try {
    await v.click('report-obligation-ask');
    await v.click('report-review-confirm');
    assert.ok(v.has('report-receipt') && !v.has('report-review-ask'));
    assert.match(v.text('report-receipt-status'), /Your request is recorded\. This is what the platform stored\./);
    assert.equal(v.props('report-receipt-status').role, 'status');
    const r = v.text('report-receipt-facts');
    assert.match(r, /Recorded 5 Nov 2026, 09:15 UTC/);
    assert.match(r, /By You/);
    assert.match(r, /Company Northwind Labs/);
    assert.match(r, /Period Sep 2026/);
    assert.match(r, /Founder team told 1 of 2 in-app notices stored/);
    assert.match(r, /Email Delivery is not confirmed here/);
    assert.match(r, /Reference c0ffee00c0ffee00c0ffee00c0ffee00/);
  } finally { await v.close(); }
});

test('4 · A failed send keeps the draft: the Review stays with the company and period, and shows the Worker’s sentence and code; a retry can succeed', async () => {
  const v = await reportsAt({
    post: {
      '/reporting/periods/pm9/ask': (n) => (n === 1
        ? { __status: 503, body: { error: 'reporting_unreadable', message: 'Unreadable: reporting could not be read or saved. Try again.' } }
        : ASK_ANSWER),
    },
  });
  try {
    await v.click('report-obligation-ask');
    await v.click('report-review-confirm');
    assert.ok(v.has('report-review-ask') && !v.has('report-receipt'), 'the Review stays');
    assert.equal(v.props('report-review-error').role, 'alert');
    assert.match(v.text('report-review-error'), /Not sent\. Unreadable: reporting could not be read or saved\. Try again\. · reporting_unreadable/);
    assert.match(v.text('report-review-error'), /Your choice of Northwind Labs and Sep 2026 is kept/);
    assert.match(v.text('report-review-facts'), /Company Northwind Labs.*Period Sep 2026/);
    assert.equal(v.text('report-review-confirm'), 'Ask Northwind Labs · Sep 2026');
    await v.click('report-review-confirm');
    assert.deepEqual(v.posts(), ['/reporting/periods/pm9/ask', '/reporting/periods/pm9/ask']);
    assert.ok(v.has('report-receipt'));
  } finally { await v.close(); }
  // A conflict: the Worker's own refusal, never a guess at why.
  const c = await reportsAt({ post: { '/reporting/periods/pm9/ask': { __status: 409, body: { error: 'already_asked', message: 'You already asked for this period’s report.' } } } });
  try {
    await c.click('report-obligation-ask');
    await c.click('report-review-confirm');
    assert.match(c.text('report-review-error'), /You already asked for this period’s report\. · already_asked/);
    assert.ok(!c.has('report-receipt'));
  } finally { await c.close(); }
});

test('5 · After an ask: the company is read again, and the period reads as asked — who and when — from that read, never from the press', async () => {
  const v = await reportsAt({
    reporting: (n) => owed(n === 1 ? PERIODS : withPm9({ asked: true, asked_at: '2026-11-05 09:15:00' })),
    post: { '/reporting/periods/pm9/ask': ASK_ANSWER },
  });
  try {
    await v.click('report-obligation-ask');
    await v.click('report-review-confirm');
    assert.equal(v.reads(), 1, 'nothing is re-read before the Receipt is closed');
    await v.click('report-receipt-done');
    assert.equal(v.reads(), 2, 'the company is read again');
    assert.match(v.text('report-obligation-record'), /^You asked on 5 Nov 2026, 09:15 UTC$/);
    assert.match(v.text('report-obligation-facts'), /Your last ask 5 Nov 2026, 09:15 UTC/);
    assert.ok(!v.has('report-obligation-ask') && v.has('report-obligation-waive'), 'asked once, so no second ask; it may still be waived');
    assert.match(v.text('company-period-record-pm9'), /You asked on 5 Nov 2026, 09:15 UTC/);
    assert.ok(!v.has('company-period-ask-pm9'));
  } finally { await v.close(); }
  // The same press, but the record does not show the ask: nothing reads as asked.
  const stale = await reportsAt({ post: { '/reporting/periods/pm9/ask': ASK_ANSWER } });
  try {
    await stale.click('report-obligation-ask');
    await stale.click('report-review-confirm');
    await stale.click('report-receipt-done');
    assert.ok(!stale.has('report-obligation-record') && !stale.has('company-period-record-pm9'), 'the press alone is not the record');
    assert.match(stale.text('report-obligation-facts'), /Your last ask You have not asked for this period/);
  } finally { await stale.close(); }
});

test('6 · Waive: no reason field (none is stored); the confirm names it; the Receipt is the stored waiver; afterwards the period reads waived by you, from the record', async () => {
  const v = await reportsAt({
    reporting: (n) => owed(n === 1 ? PERIODS : withPm9({ state: 'waived', days_late: null, waived_at: '2026-11-05 14:40:00', waived_by_you: true })),
    post: { '/reporting/periods/pm9/waive': WAIVE_ANSWER },
  });
  try {
    await v.click('report-obligation-waive');
    assert.ok(v.has('report-review-waive'));
    assert.deepEqual([v.within('report-review-waive', 'TEXTAREA').length, v.within('report-review-waive', 'INPUT').length], [0, 0], 'no note: the waiver stores none');
    assert.match(v.text('report-review-waive'), /No reason is recorded: the waiver stores none, so none is asked for\./);
    assert.match(v.text('report-review-waive'), /It does not waive future periods or change the signed duty\..*cannot be undone here/);
    assert.match(v.text('report-review-facts'), /What is recorded This period is marked waived by you, with the time, on the reporting record/);
    assert.equal(v.text('report-review-confirm'), 'Waive Northwind Labs · Sep 2026');
    await v.click('report-review-confirm');
    assert.deepEqual(v.posts(), ['/reporting/periods/pm9/waive']);
    assert.match(v.text('report-receipt-facts'), /Waived 5 Nov 2026, 14:40 UTC.*By You.*Company Northwind Labs.*Period Sep 2026.*This period only/);
    await v.click('report-receipt-done');
    assert.match(v.text('company-period-record-pm9'), /^Waived by you on 5 Nov 2026, 14:40 UTC$/);
    assert.match(v.text('report-obligation'), /^Q3 2026 reporting obligation/, 'the next open period takes the card');
  } finally { await v.close(); }
  // A waiver whose author the record does not hold is never "by you".
  const u = await reportsAt({ reporting: () => owed(withPm9({ state: 'waived', waived_at: '2026-11-04 08:00:00', waived_by_you: null })) });
  try {
    assert.match(u.text('company-period-record-pm9'), /^Waived on 4 Nov 2026, 08:00 UTC · who waived it is not recorded$/);
  } finally { await u.close(); }
});

test('7 · A session the Worker says may not act sees no action anywhere, and the reason it was given', async () => {
  const v = await reportsAt({ reporting: () => owed(PERIODS, { can_act: false, act_refusal: 'A support session cannot ask for a report or waive a period.' }) });
  try {
    assert.ok(v.has('report-obligation'), 'the obligation is still drawn');
    assert.ok(!v.has('report-obligation-ask') && !v.has('report-obligation-waive'));
    assert.ok(!v.has('company-period-ask-pm9') && !v.has('company-period-waive-pm9') && !v.has('company-period-waive-pq3'));
    assert.equal(v.text('report-obligation-no-act'), 'A support session cannot ask for a report or waive a period.');
    assert.match(v.text('company-timeline'), /Asking and waiving are not available in this session\./);
    assert.ok(!v.has('report-obligation-others'), 'no pointer to actions it cannot take');
    assert.deepEqual(v.posts(), []);
  } finally { await v.close(); }
  // On a phone, the period's own sheet pins no action either.
  const p = await reportsAt({ width: 390, reporting: () => owed(PERIODS, { can_act: false, act_refusal: 'A support session cannot ask for a report or waive a period.' }) });
  try {
    await p.click('company-period-pm9');
    assert.ok(p.has('company-period-sheet') && !p.has('company-sheet-ask') && !p.has('company-sheet-waive'));
  } finally { await p.close(); }
});

test('8 · Phone (390, PFA10): the obligation card leads, its actions are full-width 48px presses, and the Review is a bottom sheet', async () => {
  const v = await reportsAt({ width: 390, post: { '/reporting/periods/pm9/ask': { ok: true, asked: true } } });
  try {
    assert.ok(v.has('report-obligation') && v.has('company-timeline-list'));
    assert.ok(!v.has('company-period-ask-pm9'), 'the timeline row is the press on a phone');
    await v.click('report-obligation-ask');
    assert.equal(v.props('report-review-ask-layer')['data-phone'], 'sheet');
    await v.click('report-review-confirm');
    // An answer that carries no stored record: every field says so, none is filled in.
    const r = v.text('report-receipt-facts');
    assert.match(r, /Recorded Not recorded · the answer carried no stored time/);
    assert.match(r, /By Not recorded · the answer carried no author/);
    assert.match(r, /Founder team told Not recorded · the founder team could not be read/);
    assert.match(r, /Reference Not recorded · the answer carried no reference/);
  } finally { await v.close(); }
  const css = read('frontend/src/pages/portfolio/reportAsk.css');
  assert.match(css, /@media\(max-width:600px\)\{[\s\S]*?\.pf-ask-actions\{flex-direction:column\}/);
  assert.match(css, /\.pf-ask-actions \.pf-btn,\.pf-ask-foot \.pf-btn\{[^}]*min-height:48px/);
});

/* ------------------------------------------------------------------ the model */

test('9 · the model: stamps, the record, who may act, the actions, the card’s period, the confirm and the receipt fallbacks', () => {
  assert.equal(stampOf('2026-11-05 09:15:00'), '5 Nov 2026, 09:15 UTC');
  assert.equal(stampOf('2026-11-05'), '5 Nov 2026');
  assert.equal(stampOf('soon'), null);
  assert.deepEqual(accessOf({ can_act: false, act_refusal: 'No.' }), { can: false, why: 'No.' });
  assert.deepEqual(accessOf({ can_act: false }).can, false);
  assert.deepEqual(accessOf({ can_act: true }), { can: true, why: null });
  const late = PERIODS[2]; const due = PERIODS[1]; const sent = PERIODS[0];
  assert.deepEqual(actionsOf(late, { can: true }), { ask: true, waive: true });
  assert.deepEqual(actionsOf({ ...late, asked: true }, { can: true }), { ask: false, waive: true });
  assert.deepEqual(actionsOf(due, { can: true }), { ask: false, waive: true });
  assert.deepEqual(actionsOf(sent, { can: true }), { ask: false, waive: false });
  assert.deepEqual(actionsOf(late, { can: false }), { ask: false, waive: false });
  assert.deepEqual(openPeriodsOf(company()).map((p) => p.uid), ['pm9', 'pq3']);
  assert.equal(recordOf(late), null, 'not asked, not waived: no record line');
  assert.equal(recordOf({ ...late, asked: true, asked_at: null }).text, 'You asked · when is not recorded');
  assert.equal(recordOf({ ...late, state: 'waived', waived_at: '2026-11-05 14:40:00', waived_by_you: true }).text, 'Waived by you on 5 Nov 2026, 14:40 UTC');
  assert.equal(recordOf({ ...late, state: 'waived', waived_at: '2026-11-05 14:40:00', waived_by_you: false }).text, 'Waived by another account on 5 Nov 2026, 14:40 UTC');
  assert.equal(recordOf({ ...late, state: 'waived', waived_at: null, waived_by_you: null }).text, 'Waived · when is not recorded · who waived it is not recorded');
  assert.equal(confirmLabel(ASK, company(), late), 'Ask Northwind Labs · Sep 2026');
  assert.equal(confirmLabel(WAIVE, company(), late), 'Waive Northwind Labs · Sep 2026');
  const o = obligationOf(company(), sent);
  assert.match(o.facts.find(([k]) => k === 'Received')[1], /12 Aug 2026/);
  assert.match(o.facts.find(([k]) => k === 'Missing')[1], /Nothing · the report was received/);
  const noRoute = obligationOf({ ...company(), duties: DUTIES.map((d) => ({ ...d, holding: { route: null }, source: {} })) }, late);
  assert.match(noRoute.facts.find(([k]) => k === 'Holding route')[1], /^Not recorded · the duty records no route$/);
  assert.match(noRoute.facts.find(([k]) => k === 'Source')[1], /^Not recorded · the duty carries no source document$/);
  assert.equal(receiptOf(ASK, { told: { team: 0, in_app: 0 } }, company(), late).facts.find(([k]) => k === 'Founder team told')[1], 'Nobody · the company has no founder team on record');
  assert.equal(receiptOf(ASK, { told: { team: 3, in_app: 0 } }, company(), late).facts.find(([k]) => k === 'Founder team told')[1], '0 of 3 in-app notices stored');
  assert.match(receiptOf(WAIVE, {}, company(), late).facts.find(([k]) => k === 'Waived')[1], /^Not recorded · the answer carried no stored time$/);
  assert.equal(receiptOf(WAIVE, { waived_by_you: null }, company(), late).facts.find(([k]) => k === 'By')[1], 'Not recorded · the answer carried no author');
  assert.deepEqual(refusalOf({ message: ' Nope. ', code: 'x', status: 409 }, ASK), { message: 'Nope.', code: 'x', status: 409 });
  assert.equal(refusalOf({}, WAIVE).message, 'The period could not be waived.');
});

test('10 · the wiring: no browser pop-up, no colour without a token, the client calls only mounted Worker routes', () => {
  const jsx = read('frontend/src/pages/portfolio/ReportAsk.jsx');
  assert.doesNotMatch(jsx, /\b(window\.)?(alert|confirm)\(/);
  assert.doesNotMatch(read('frontend/src/pages/portfolio/reportAsk.css').replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-f]{3,6}\b|rgba?\(/i, 'colours come from the frame’s tokens, which .dark redefines');
  const worker = read('cloudflare-worker/src/routes/reporting.ts');
  assert.match(worker, /r\.post\('\/periods\/:uid\/ask'/);
  assert.match(worker, /r\.post\('\/periods\/:uid\/waive'/);
  assert.match(read('frontend/src/lib/api/reporting.js'), /ask: \(periodUid\) => post\(`\$\{period\(periodUid\)\}\/ask`\)/);
});

/* ------------------------------------------------------------------ owner answer 2026-11-14: only the SPV's lead waives */

const LEAD_ONLY = 'You hold this through an SPV, and only the SPV’s lead can waive a period.';
const LEAD_NOT_RECORDED = 'You hold this through an SPV, and the SPV’s lead is not recorded, so no one can waive a period here.';
const spv = (canWaive, refusal) => PERIODS.map((p) => ({ ...p, can_waive: canWaive, waive_refusal: refusal }));

test('11 · Through an SPV, Waive follows the Worker’s can_waive: hidden for a non-lead and where no lead is recorded, with the Worker’s reason; Ask stays', async () => {
  for (const why of [LEAD_ONLY, LEAD_NOT_RECORDED]) {
    const v = await reportsAt({ reporting: () => owed(spv(false, why)) });
    try {
      assert.ok(!v.has('report-obligation-waive'), why);
      assert.ok(!v.has('company-period-waive-pm9') && !v.has('company-period-waive-pq3'), why);
      assert.equal(v.text('report-obligation-no-waive'), why);
      assert.ok(v.has('report-obligation-ask') && v.has('company-period-ask-pm9'), 'Ask is unchanged');
      assert.match(v.text('company-holding-note-syndicate'), /only the SPV’s lead can waive a period/, 'the RPT13 note agrees');
    } finally { await v.close(); }
  }
  // The lead: the Worker says they may, so Waive is drawn and no reason is.
  const lead = await reportsAt({ reporting: () => owed(spv(true, null)), post: { '/reporting/periods/pm9/waive': WAIVE_ANSWER } });
  try {
    assert.ok(lead.has('report-obligation-waive') && lead.has('company-period-waive-pm9') && !lead.has('report-obligation-no-waive'));
    await lead.click('report-obligation-waive');
    await lead.click('report-review-confirm');
    assert.deepEqual(lead.posts(), ['/reporting/periods/pm9/waive']);
  } finally { await lead.close(); }
  // On a phone, the period's own sheet pins Ask but not Waive.
  const p = await reportsAt({ width: 390, reporting: () => owed(spv(false, LEAD_ONLY)) });
  try {
    await p.click('company-period-pm9');
    assert.ok(p.has('company-sheet-ask') && !p.has('company-sheet-waive'));
  } finally { await p.close(); }
  // A refusal the read did not foresee is still the Worker's sentence and code, in the Review.
  const late = await reportsAt({ post: { '/reporting/periods/pm9/waive': { __status: 403, body: { error: 'spv_lead_only', message: LEAD_ONLY } } } });
  try {
    await late.click('report-obligation-waive');
    await late.click('report-review-confirm');
    assert.match(late.text('report-review-error'), /Not waived\. You hold this through an SPV, and only the SPV’s lead can waive a period\. · spv_lead_only/);
  } finally { await late.close(); }
  // The model: a sent period gives no reason; an open one with can_waive false gives the Worker's.
  assert.equal(waiveRefusalOf({ ...PERIODS[2], can_waive: false, waive_refusal: LEAD_ONLY }), LEAD_ONLY);
  assert.equal(waiveRefusalOf({ ...PERIODS[0], can_waive: false, waive_refusal: LEAD_ONLY }), null);
  assert.equal(waiveRefusalOf({ ...PERIODS[2], can_waive: true, waive_refusal: null }), null);
  assert.deepEqual(actionsOf({ ...PERIODS[2], can_waive: false }, { can: true }), { ask: true, waive: false });
});
