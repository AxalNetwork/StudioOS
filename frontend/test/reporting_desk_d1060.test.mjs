/**
 * D1060 (#2930, part 4 of #2427) — the Reporting desk, Duties and the report
 * builder complete: RPT1–RPT8, RPT14, RPT15 and RPT17–RPT19, over part 2's
 * `GET /api/reporting/desk` (D1058) and part 3's report routes (D1059).
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/reporting_desk_d1060.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import {
  FIGURE_LABELS, KPI_RULES_REQUIRED, STATE_TONE, calendarMonths, calendarRows, dueNext, dueRuleWords, dutyRows, expectedError, moveCell,
  needsYou, offsetWords, prepareLabel, readOnlyLine, recordStrip, requiredFigures, selectedPanel, stateWord,
} from '../src/pages/cycles/reporting/deskModel.js';
import {
  acceptable, figureGroups, proposals, readiness, readinessLine, reportHref, revisionStrip, sendLines, sendRefusal, sourceChip, valueText,
} from '../src/pages/cycles/reporting/builderModel.js';
import ReportingDesk from '../src/pages/cycles/ReportingDesk.jsx';
import { reportingApi } from '../src/lib/api/reporting.js';
import { shareUpdateApi } from '../src/lib/api/shareUpdate.js';
import { cyclesApi } from '../src/lib/api/cycles.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;
const UID = 'a'.repeat(32);
const NEXT = 'b'.repeat(32);
const SHA = 'f'.repeat(64);

// ---------------------------------------------------------------- fixtures

const duty = (o) => ({
  uid: 'd1', kind: 'monthly_financials', title: 'Monthly financial statements', cadence: 'monthly', due_rule: 'after_end', due_days: 30,
  required_figures: [], required_documents: ['unaudited_statements'], defaulted: [], starts_on: '2026-03-12', status: 'active',
  source: { document: 'voting_rights', clause: 'Investors’ Rights Agreement §1.1(a)', kind: 'signed_envelope', signed: true, body_sha256: 'ab' },
  holder: { name: 'Northwind Capital' }, record: { sent: 2, late: 1, missing: 0, waived: 1 }, ...o,
});
const period = (o) => ({ uid: 'p', duty_uid: 'd1', label: 'x', start: '2026-09-01', end: '2026-09-30', due_on: '2026-10-30', expected_on: null, expected_note: null, waived_at: null, sent_at: null, days_late: null, days_left: null, ...o });
const DESK = () => ({
  ok: true, today: '2026-11-05', project: { id: 7, uid: 'p-acme', name: 'Acme Robotics' }, can_write: true,
  duties: [
    duty({}),
    duty({ uid: 'd2', kind: 'quarterly_kpi', title: 'Quarterly KPI report', cadence: 'quarterly', due_days: 45, required_figures: ['mrr', 'paying_accounts'], required_documents: [],
      defaulted: ['due_days'], source: { document: 'deal_pack_term_sheet', clause: 'Term Sheet (deal pack) Information rights', kind: 'closing_template', signed: false, body_sha256: null },
      holder: { name: 'Bluefern Angels' }, record: { sent: 1, late: 0, missing: 0, waived: 0 } }),
  ],
  periods: [
    period({ uid: 'p1', label: 'Sep 2026', state: 'late', days_late: 6, expected_on: '2026-11-14', expected_note: 'Waiting on our accountant' }),
    period({ uid: 'p2', label: 'Aug 2026', start: '2026-08-01', end: '2026-08-31', due_on: '2026-09-30', state: 'sent', sent_at: '2026-09-29 10:00:00' }),
    period({ uid: 'p3', duty_uid: 'd2', label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30', due_on: '2026-11-14', state: 'due', days_left: 9 }),
    period({ uid: 'p4', label: 'Oct 2026', start: '2026-10-01', end: '2026-10-31', due_on: '2026-11-30', state: 'upcoming', days_left: 25 }),
  ],
  asks: [{ period_uid: 'p1', asked_at: '2026-11-03 10:00:00' }],
  reminders: { offsets: [14, 3, 0, -7], channels: ['in_app', 'email'], recipient_user_ids: [5], saved: false, team: [{ id: 5, name: 'Ada' }, { id: 6, name: 'Bo' }] },
});

const fig = (o) => ({ module: 'revenue-and-traction', unit: 'usd', source: null, as_of: null, reason: null, team_only: false, included: false, shared: false, typed: false, left_out_reason: null, required: false, value: null, ...o });
const DRAFT = () => ({
  ok: true, view: 'team', uid: UID, kind: 'report', status: 'draft', period: { label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30' },
  title: 'Q3 2026 report', body: null, highlights: [], lowlights: [], include_team: true,
  figures: [
    fig({ key: 'mrr', label: 'MRR', value: 48200, source: { word: 'Connector', provider: 'stripe', computed: false }, as_of: '2026-10-31', included: true, required: true }),
    fig({ key: 'gross_margin', label: 'Gross margin', unit: 'pct', reason: 'Not recorded: no Grow store records gross margin yet', required: true }),
    fig({ key: 'net_burn', label: 'Net burn', value: 61000, source: { word: 'Connector', provider: 'mercury', computed: false }, as_of: '2026-10-31', team_only: true }),
    fig({ key: 'headcount', label: 'Headcount', module: 'team-expansion', unit: 'count', value: 0, source: { word: 'Typed', provider: 'manual', computed: false }, as_of: '2026-11-03', included: true }),
  ],
  figures_sha256: SHA,
  meets: [{ period_uid: 'p3', label: 'Q3 2026', due_on: '2026-11-14', duty_uid: 'd2', kind: 'quarterly_kpi', title: 'Quarterly KPI report', holder: { name: 'Bluefern Angels' }, without: [{ key: 'gross_margin', label: 'Gross margin', reason: null }] }],
  revision: 1, correction_reason: null, corrected_by: null, documents: [], sent_at: null, recipients: [],
});
const SENT = () => ({
  ...DRAFT(), status: 'sent', sent_at: '2026-08-12T10:00:00Z', revision: 2, correction_reason: 'Stripe refund',
  recipients: [
    { audience: 'investor', name: 'Bluefern Angels', delivered: true, not_delivered_reason: null, opened_at: '2026-08-13T09:00:00Z' },
    { audience: 'investor', name: 'Cora', delivered: false, not_delivered_reason: 'Not delivered: their notification settings or the inbox refused it', opened_at: null },
  ],
  documents: [{ uid: 'c'.repeat(32), filename: 'q2.pdf', label: 'Q2 2026 unaudited statements', size_bytes: 421888, added_at: '2026-08-11' }],
});

// ---------------------------------------------------------------- the model

test('state words, and lateness is amber, never red', () => {
  assert.equal(stateWord({ state: 'due', days_left: 9 }), 'Due in 9 days');
  assert.equal(stateWord({ state: 'due', days_left: 0 }), 'Due today');
  assert.equal(stateWord({ state: 'due', days_left: 1 }), 'Due in 1 day');
  assert.equal(stateWord({ state: 'late', days_late: 6 }), '◷ Late · 6 days');
  assert.equal(stateWord({ state: 'missing', days_late: 40 }), 'Missing');
  assert.equal(stateWord({ state: 'sent' }), '✓ Sent');
  assert.equal(stateWord({ state: 'waived' }), '– Waived');
  assert.equal(stateWord({}), 'Not recorded', 'a state the read lacks is never guessed');
  for (const [k, v] of Object.entries(STATE_TONE)) assert.doesNotMatch(v, /red|rose/, k);
  assert.match(STATE_TONE.late, /amber/);
  assert.match(STATE_TONE.missing, /amber/);
});

test('Due next is the earliest open window not yet late, with every period of it; Needs you holds the late and the asks', () => {
  const desk = DESK();
  const next = dueNext(desk);
  assert.equal(next.label, 'Q3 2026');
  assert.equal(next.due, '14 Nov');
  assert.equal(next.word, 'Due in 9 days');
  assert.deepEqual(next.groups.map((g) => [g.title, g.holders]), [['Quarterly KPI report', 'Bluefern Angels']]);
  assert.equal(next.investors, 1);
  assert.equal(prepareLabel(next), 'Prepare Q3 2026 report');
  assert.equal(prepareLabel(null), 'Prepare a report');
  // Two holders owed the same window: one report meets both.
  const two = DESK();
  two.duties.push(duty({ uid: 'd3', kind: 'quarterly_kpi', title: 'Quarterly KPI report', holder: { name: 'Axal VC Fund I' } }));
  two.periods.push(period({ uid: 'p5', duty_uid: 'd3', label: 'Q3 2026', start: '2026-07-01', end: '2026-09-30', due_on: '2026-11-14', state: 'due', days_left: 9 }));
  assert.deepEqual(dueNext(two).groups.map((g) => g.holders), ['Bluefern Angels and Axal VC Fund I']);
  assert.equal(dueNext(two).investors, 2);
  // Only a late period open: it is next.
  const late = DESK(); late.periods = late.periods.filter((p) => p.uid === 'p1' || p.uid === 'p2');
  assert.equal(dueNext(late).label, 'Sep 2026');
  late.periods = late.periods.filter((p) => p.uid === 'p2');
  assert.equal(dueNext(late), null, 'nothing open is no Due next, never a zero');
  const needs = needsYou(desk);
  assert.deepEqual(needs.map((n) => n.kind), ['late', 'ask']);
  assert.equal(needs[0].line, 'Sep 2026 monthly financial statements to Northwind Capital is 6 days late.');
  assert.equal(needs[0].expected, 'Expected 14 Nov 2026 · Waiting on our accountant');
  assert.equal(needs[1].line, 'Northwind Capital asked for the Sep 2026 monthly financial statements on 3 Nov.');
  // A period whose duty the read lacks is dropped, never drawn half.
  const orphan = DESK(); orphan.periods.push(period({ uid: 'px', duty_uid: 'gone', state: 'late', days_late: 2 }));
  assert.equal(needsYou(orphan).filter((n) => n.kind === 'late').length, 1);
});

test('the calendar: twelve months around today, cells by due month, arrow keys held inside the grid, and the selected panel', () => {
  const months = calendarMonths('2026-11-05');
  assert.deepEqual(months.map((m) => m.label), ['JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'JAN', 'FEB', 'MAR', 'APR', 'MAY']);
  assert.equal(months.findIndex((m) => m.today), 5);
  assert.equal(months[7].key, '2027-01');
  assert.deepEqual(calendarMonths('nope'), []);
  const { rows } = calendarRows(DESK());
  assert.deepEqual(rows.map((r) => [r.holder, r.title]), [['Northwind Capital', 'Monthly financial statements'], ['Bluefern Angels', 'Quarterly KPI report']]);
  assert.deepEqual(Object.entries(rows[0].cells).filter(([, v]) => v.length).map(([k, v]) => [k, v.map((p) => p.uid)]), [['2026-09', ['p2']], ['2026-10', ['p1']], ['2026-11', ['p4']]]);
  assert.deepEqual(moveCell([0, 5], 'ArrowRight', 2, 12), [0, 6]);
  assert.deepEqual(moveCell([0, 0], 'ArrowLeft', 2, 12), [0, 0]);
  assert.deepEqual(moveCell([1, 11], 'ArrowDown', 2, 12), [1, 11]);
  assert.deepEqual(moveCell([1, 3], 'ArrowUp', 2, 12), [0, 3]);
  assert.deepEqual(moveCell([1, 3], 'End', 2, 12), [1, 11]);
  assert.equal(moveCell([1, 3], 'a', 2, 12), null);
  const p1 = DESK().periods[0]; p1.duty = DESK().duties[0];
  const panel = selectedPanel(p1, true);
  assert.equal(panel.title, 'Sep 2026 monthly financial statements to Northwind Capital');
  assert.deepEqual(panel.lines, ['Due 30 Oct 2026 · 6 days late', 'You gave 14 Nov 2026: Waiting on our accountant. Northwind Capital sees this date.']);
  assert.equal(panel.prepare && panel.expect, true);
  assert.equal(selectedPanel(p1, false).prepare, false, 'a reader is offered nothing');
});

test('Duties: the due rule, the figures a duty requires (held to the Worker\'s rules), grouping, filters and the record strip', () => {
  const desk = DESK();
  assert.equal(dueRuleWords(desk.duties[0]), '30 days after month end');
  assert.equal(dueRuleWords({ cadence: 'annual', due_rule: 'before_start', due_days: 30 }), '30 days before the year starts');
  assert.equal(dueRuleWords({ cadence: 'monthly' }), 'Not recorded');
  assert.deepEqual(requiredFigures(desk.duties[0]), { labels: ['Cash', 'Net burn', 'Runway', 'Revenue'], from: 'kpi_rules' });
  assert.deepEqual(requiredFigures(desk.duties[1]), { labels: ['MRR', 'Customers'], from: 'document' }, 'an alias is the same figure');
  assert.deepEqual(requiredFigures({ kind: 'quarterly_update' }), { labels: [], from: 'none' });
  assert.deepEqual(requiredFigures({ kind: 'quarterly_kpi', required_figures: [] }), { labels: ['Cash', 'Net burn', 'Runway', 'Revenue', 'ARR', 'Headcount'], from: 'kpi_rules' }, 'a quarterly KPI duty takes the monthly rules and the quarterly ones');
  // The Worker's own rules and registry, read from its source.
  const src = read('cloudflare-worker/src/services/reportFigures.ts');
  const rules = /KPI_RULES_REQUIRED[^=]*=\s*Object\.freeze\(\{\s*monthly:\s*\[([^\]]*)\],\s*quarterly:\s*\[([^\]]*)\]/.exec(src);
  const keys = (s) => s.match(/'([a-z_]+)'/g).map((k) => k.slice(1, -1));
  assert.deepEqual([...KPI_RULES_REQUIRED.monthly], keys(rules[1]));
  assert.deepEqual([...KPI_RULES_REQUIRED.quarterly], keys(rules[2]));
  for (const m of src.matchAll(/\{ key: '([a-z_]+)', label: '([^']+)'[^}]*aliases: \[([^\]]*)\]/g)) {
    assert.equal(FIGURE_LABELS[m[1]], m[2], m[1]);
    for (const a of (m[3].match(/'([a-z_]+)'/g) || []).map((k) => k.slice(1, -1))) assert.equal(FIGURE_LABELS[a], m[2], a);
  }
  assert.deepEqual(dutyRows(desk).map((g) => [g.label, g.items.length]), [['Bluefern Angels', 1], ['Northwind Capital', 1]]);
  assert.deepEqual(dutyRows(desk, { group: 'kind' }).map((g) => g.label), ['Monthly financial statements', 'Quarterly KPI report']);
  assert.deepEqual(dutyRows(desk, { q: 'blue' }).map((g) => g.label), ['Bluefern Angels']);
  assert.deepEqual(dutyRows(desk, { cadence: 'quarterly' }).map((g) => g.label), ['Bluefern Angels']);
  assert.deepEqual(dutyRows(desk, { state: 'late' }).map((g) => g.label), ['Northwind Capital']);
  assert.deepEqual(dutyRows(desk, { state: 'clear' }).map((g) => g.label), ['Bluefern Angels']);
  assert.deepEqual(dutyRows(desk, { state: 'due' }).map((g) => g.label), ['Bluefern Angels']);
  assert.deepEqual(recordStrip(desk, 'd1').map((r) => `${r.label} · ${r.word}`), ['Aug 2026 · ✓ Sent', 'Sep 2026 · ◷ Late · 6 days', 'Oct 2026 · Upcoming']);
  assert.equal(offsetWords(14), '14 days before');
  assert.equal(offsetWords(0), 'On the day');
  assert.equal(offsetWords(-7), '7 days late');
  assert.equal(expectedError('2026-11-04', '', '2026-11-05'), 'Give a date from today on.');
  assert.equal(expectedError('2026-11-05', 'x'.repeat(281), '2026-11-05'), 'Keep the note to 280 characters.');
  assert.equal(expectedError('2026-11-05', '', '2026-11-05'), null);
  assert.match(readOnlyLine('admin'), /admins never prepare or send/);
  assert.match(readOnlyLine('advisor'), /The founders prepare and send reports/);
});

test('the builder\'s rules: values never 0 for missing, source chips, groups, readiness, the Accept rule, Send\'s lines and refusals', () => {
  const d = DRAFT();
  assert.equal(valueText(d.figures[0]), '$48,200');
  assert.equal(valueText(d.figures[1]), null, 'no value is no number');
  assert.equal(valueText(d.figures[3]), '0', 'a measured zero is kept');
  assert.equal(valueText({ value: 14, unit: 'months' }), '14 months');
  assert.equal(valueText({ value: 21, unit: 'pct' }), '21%');
  assert.equal(sourceChip(d.figures[0]), 'Connector · Stripe · 31 Oct');
  assert.equal(sourceChip(d.figures[1]), 'Not recorded');
  assert.equal(sourceChip(d.figures[2]), '◐ Team only · from your Mercury');
  assert.equal(sourceChip({ ...d.figures[2], shared: true }), 'Connector · Mercury · 31 Oct');
  assert.equal(sourceChip({ value: 14, source: { word: 'Connector', provider: 'mercury', computed: true }, as_of: '2026-10-31' }), 'Connector · Mercury · computed · 31 Oct');
  assert.equal(sourceChip({ typed: true, value: 5, as_of: '2026-10-31' }, 'Acme Robotics'), 'Typed · entered by Acme Robotics · 31 Oct');
  assert.deepEqual(figureGroups([...d.figures, fig({ key: 'typed-1', label: 'Pilot sites', typed: true, value: 5 })]).map((g) => g.title), ['Revenue and traction', 'Team expansion', 'Typed by your team']);
  const r = readiness(d.figures);
  assert.deepEqual(r, { required: 2, included: 1, withReason: [], withoutReason: ['Gross margin'] });
  assert.equal(readinessLine(r, ['team-expansion']), '1 of 2 required figures included · 1 left out with no reason yet · Team expansion could not be read');
  assert.equal(acceptable({ text: 'MRR grew 21%', source: { label: 'Stripe' } }), true);
  assert.equal(acceptable({ text: 'Every pilot will convert', source: null }), false, 'a line with no source cannot be accepted');
  assert.equal(acceptable({ text: '  ', source: { label: 'Stripe' } }), false);
  assert.deepEqual(proposals({ status: 'drafted', highlights: [{ text: 'a', source: { label: 's' } }], lowlights: [{ text: 'b', source: { label: 't' } }] }).map((p) => p.field), ['highlights', 'lowlights']);
  assert.deepEqual(proposals({ status: 'nothing', highlights: [], lowlights: [] }), []);
  const lines = sendLines(d);
  assert.equal(lines[0], 'Figures freeze now. A later change is sent as a correction, and investors see both.');
  assert.equal(lines[1], 'This meets: Quarterly KPI report · Q3 2026 for Bluefern Angels.');
  assert.match(lines[2], /^Sent without Gross margin for Bluefern Angels \(no reason yet: Send refuses until you give one\)/);
  const given = DRAFT(); given.meets[0].without[0].reason = 'Shared at the board meeting instead';
  assert.equal(sendLines(given)[2], 'Sent without Gross margin for Bluefern Angels (‘Shared at the board meeting instead’). They see your reasons.');
  assert.match(sendLines({ ...d, revision: 2, correction_reason: 'Stripe refund' })[0], /revision 2.*Everyone the last revision reached.*‘Stripe refund’/);
  const pii = sendRefusal({ code: 'pii_found', message: 'This report holds an email.', data: { findings: [{ kind: 'email', in: 'highlight_1' }] } });
  assert.equal(pii, 'This report holds an email. Found: email in highlight 1.');
  assert.equal(revisionStrip(SENT()), 'Revision 2 · reason ‘Stripe refund’. Investors see both versions.');
  assert.equal(revisionStrip({ revision: 1, corrected_by: { revision: 2, corrected_on: '2026-08-18', reason: 'Stripe refund' } }), 'Corrected by revision 2 on 18 Aug 2026 · ‘Stripe refund’.');
  assert.equal(reportHref(UID, { draft: true, search: '?project_id=7' }), `/grow/reporting/${UID}/edit?project_id=7`);
  assert.equal(reportHref('../x'), null);
});

// ---------------------------------------------------------------- mounted

function harness() {
  const restore = installDocument();
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n ? (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '') : '');
  const props = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const all = (id) => walk(container).filter((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const ev = { preventDefault() {}, stopPropagation() {} };
  const click = async (id) => { const n = typeof id === 'string' ? byId(id) : id; assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick?.(ev); }); await settle(); };
  const change = async (id, value, key = 'value') => { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onChange({ target: { [key]: value } }); }); await settle(); };
  const blur = async (id) => { await act(async () => { props(byId(id)).onBlur?.(); }); await settle(); };
  const close = async () => { await act(async () => root.unmount()); restore(); };
  return { root, byId, all, text, props, walk, settle, click, change, blur, close, container };
}

function Probe() { const l = useLocation(); return h('span', { 'data-testid': 'probe' }, `${l.pathname}${l.search}`); }
const page = (url, props) => h(MemoryRouter, { key: url + JSON.stringify(props.tab), initialEntries: [url] },
  h(Routes, null, h(Route, { path: '*', element: h(React.Fragment, null, h(ReportingDesk, { projectId: 7, search: '?project_id=7', cards: [], ...props }), h(Probe)) })));

function stubs(over = {}) {
  const was = { ...reportingApi };
  const wasModule = cyclesApi.module;
  const wasDraft = shareUpdateApi.draftLines;
  const calls = [];
  const rec = (name, out) => async (...a) => { calls.push([name, ...a]); return typeof out === 'function' ? out(...a) : out; };
  Object.assign(reportingApi, {
    desk: rec('desk', DESK()), setExpected: rec('setExpected', { ok: true }), setReminders: rec('setReminders', { ok: true }),
    draftReport: rec('draftReport', { uid: UID }), report: rec('report', DRAFT()), saveReport: rec('saveReport', (uid, body) => ({ ...DRAFT(), ...(body.include_team != null ? { include_team: body.include_team } : {}), unreadable: [] })),
    previewReport: rec('previewReport', { ...DRAFT(), as: 'investor', figures_sha256: SHA, stale: false, stale_reason: null,
      figures: [{ key: 'mrr', label: 'MRR', module: 'revenue-and-traction', unit: 'usd', value: 48200, source: { word: 'Connector', provider: 'stripe', computed: false }, as_of: '2026-10-31', left_out: false, left_out_reason: null, typed: false },
        { key: 'gross_margin', label: 'Gross margin', module: 'revenue-and-traction', unit: 'pct', value: null, source: null, as_of: null, left_out: true, left_out_reason: 'Shared at the board meeting instead', typed: false }] }),
    sendReport: rec('sendReport', { ok: true, uid: UID }), correctReport: rec('correctReport', { uid: NEXT }),
    ...over,
  });
  cyclesApi.module = rec('module', { parts: { updates: [] } });
  shareUpdateApi.draftLines = rec('draftLines', { status: 'drafted', highlights: [{ text: 'MRR grew 21%', source: { label: 'Stripe', ref: null, as_of: '2026-10-31' } }], lowlights: [{ text: 'Every pilot will convert', source: { label: '' } }] });
  return { calls, restore: () => { Object.assign(reportingApi, was); cyclesApi.module = wasModule; shareUpdateApi.draftLines = wasDraft; } };
}

test('mounted desk (RPT1, RPT7): Due next, Needs you, the calendar with keys and a selected cell, Prepare, the More menu and both dialogs', async () => {
  const t = harness();
  const s = stubs();
  try {
    await act(async () => t.root.render(page('/grow/reporting?project_id=7', { tab: 'desk', action: { label: 'Share an update', href: '/grow/update?project_id=7' } })));
    await t.settle();
    assert.deepEqual(s.calls.filter((c) => c[0] === 'desk'), [['desk', 7]]);
    assert.match(t.text(t.byId('reporting-due-next')), /Q3 2026 · due 14 Nov.*Due in 9 days.*1 investor.*Quarterly KPI report · Bluefern Angels/s);
    assert.match(t.text(t.byId('reporting-readiness')), /Readiness is read when the report is prepared/);
    assert.equal(t.text(t.byId('cycle-action')), 'Prepare Q3 2026 report');
    assert.match(t.text(t.byId('reporting-needs-you')), /Needs you2.*6 days late.*Expected 14 Nov 2026.*asked for the Sep 2026/s);
    assert.equal(t.text(t.byId('reporting-tab-duties')), 'Duties2');
    // The calendar: Sep's period sits under SEP, today's column is lit, keys move the one tab stop.
    assert.match(t.text(t.byId('reporting-cell-0-3')), /✓ Sent/);
    assert.match(t.text(t.byId('reporting-cell-0-4')), /◷ Late · 6 days.*Exp\. 14 Nov/s);
    assert.equal(t.props(t.byId('reporting-cell-0-5')).tabIndex, 0);
    await act(async () => { t.props(t.byId('reporting-calendar-grid')).onKeyDown({ key: 'ArrowDown', preventDefault() {} }); });
    assert.equal(t.props(t.byId('reporting-cell-1-5')).tabIndex, 0, 'ArrowDown moves the tab stop');
    assert.equal(t.props(t.byId('reporting-cell-0-5')).tabIndex, -1);
    await t.click('reporting-cell-0-4');
    assert.match(t.text(t.byId('reporting-selected')), /Sep 2026 monthly financial statements to Northwind Capital.*Due 30 Oct 2026 · 6 days late/s);
    await t.click('reporting-calendar-toggle');
    assert.match(t.text(t.byId('reporting-calendar-table')), /Northwind Capital.*Sep 2026.*30 Oct 2026.*◷ Late · 6 days/s);
    // Give an expected date from Needs you: the date is posted with the note.
    await t.click('reporting-needs-expect');
    assert.match(t.text(t.byId('reporting-expected-audience')), /Northwind Capital sees this date and note/);
    await t.change('reporting-expected-day', '2026-11-20');
    await t.change('reporting-expected-note', 'Accountant closes on 18 Nov');
    await t.click('reporting-expected-go');
    assert.deepEqual(s.calls.find((c) => c[0] === 'setExpected'), ['setExpected', 'p1', '2026-11-20', 'Accountant closes on 18 Nov']);
    assert.equal(s.calls.filter((c) => c[0] === 'desk').length, 2, 'the desk is read again');
    // The More menu: Share an update and Reminder settings; the reminders save the team's choice.
    await t.click('reporting-more');
    assert.equal(t.props(t.byId('reporting-more-share')).href, '/grow/update?project_id=7');
    await t.click('reporting-more-reminders');
    await t.change('reporting-reminder-offset-3', false, 'checked');
    await t.change('reporting-reminder-person-6', true, 'checked');
    await t.click('reporting-reminders-go');
    assert.deepEqual(s.calls.find((c) => c[0] === 'setReminders')[1], { project: 7, offsets: [14, 0, -7], channels: ['in_app', 'email'], recipient_user_ids: [5, 6] });
    // Prepare opens the period's draft and goes to its builder.
    await t.click('cycle-action');
    assert.deepEqual(s.calls.find((c) => c[0] === 'draftReport'), ['draftReport', 'p3']);
    assert.equal(t.text(t.byId('probe')), `/grow/reporting/${UID}/edit?project_id=7`);
  } finally { s.restore(); await t.close(); }
});

test('mounted desk refusals: a failed Prepare and a refused expected date stay on the page, in words', async () => {
  const t = harness();
  const s = stubs({
    draftReport: async () => { const e = new Error('The founders prepare and send reports. Admins never act for a company.'); e.status = 403; throw e; },
    setExpected: async () => { const e = new Error('This period was sent or waived, so it needs no expected date.'); e.status = 409; throw e; },
  });
  try {
    await act(async () => t.root.render(page('/grow/reporting?project_id=7', { tab: 'desk' })));
    await t.settle();
    await t.click('reporting-due-next-prepare');
    assert.match(t.text(t.byId('reporting-prepare-refused')), /Admins never act for a company/);
    assert.equal(t.text(t.byId('probe')), '/grow/reporting?project_id=7');
    await t.click('reporting-needs-expect');
    await t.change('reporting-expected-day', '2026-11-20');
    await t.click('reporting-expected-go');
    assert.match(t.text(t.byId('reporting-expected-refused')), /needs no expected date/);
    assert.ok(t.byId('reporting-expected'), 'the dialog stays open');
  } finally { s.restore(); await t.close(); }
});

test('mounted read-only desk (RPT14, RPT15): an advisor or an admin reads the calendar, with no Prepare, Needs you, expected date or reminders', async () => {
  for (const role of ['advisor', 'admin']) {
    const t = harness();
    const s = stubs({ desk: async () => ({ ...DESK(), can_write: false }) });
    try {
      await act(async () => t.root.render(page('/grow/reporting?project_id=7', { tab: 'desk', role, action: { label: 'Share an update', href: '/grow/update' } })));
      await t.settle();
      assert.match(t.text(t.byId('reporting-readonly-header')), /Reporting · Acme Robotics◉ Read only/);
      assert.equal(t.text(t.byId('reporting-readonly-line')), readOnlyLine(role));
      for (const id of ['cycle-action', 'reporting-more', 'reporting-needs-you', 'reporting-due-next']) assert.equal(t.byId(id), undefined, `${role}: no ${id}`);
      assert.ok(t.byId('reporting-calendar'));
      await t.click('reporting-cell-0-4');
      assert.ok(t.byId('reporting-selected'));
      assert.equal(t.byId('reporting-selected-prepare'), undefined);
      assert.equal(t.byId('reporting-selected-expect'), undefined);
    } finally { s.restore(); await t.close(); }
  }
});

test('mounted states (RPT17–RPT19): loading, unreadable with the History still read, not shared, and no duty yet', async () => {
  const t = harness();
  let answer = () => new Promise(() => {});
  const s = stubs({ desk: async () => answer() });
  try {
    await act(async () => t.root.render(page('/grow/reporting?project_id=7', { tab: 'desk' })));
    await t.settle();
    assert.match(t.text(t.byId('reporting-desk-loading')), /Due next.*Reading….*Calendar.*Reading…/s);
    answer = async () => { throw Object.assign(new Error('down'), { status: 503 }); };
    await act(async () => t.root.render(page('/grow/reporting?project_id=7&x', { tab: 'desk' })));
    await t.settle();
    assert.match(t.text(t.container), /not a claim that nothing is owed/);
    assert.ok(t.byId('reporting-history'), 'the History answers alone');
    assert.ok(!/\b0 (due|late|duties)\b/.test(t.text(t.container)), 'no zero is claimed');
    answer = async () => { throw Object.assign(new Error('No such venture.'), { status: 404 }); };
    await act(async () => t.root.render(page('/grow/reporting?project_id=7&y', { tab: 'desk' })));
    await t.settle();
    assert.match(t.text(t.byId('reporting-not-shared')), /not shared with you/);
    answer = async () => ({ ...DESK(), duties: [], periods: [], asks: [] });
    await act(async () => t.root.render(page('/grow/reporting?project_id=7&z', { tab: 'desk', action: { label: 'Share an update', href: '/grow/update?project_id=7' } })));
    await t.settle();
    assert.match(t.text(t.byId('reporting-empty')), /No reporting duties yet\..*appear when an investor signs.*Share an update.*Go to Raise/s);
    assert.equal(t.props(t.byId('reporting-empty-raise')).href, '/raise?project_id=7');
  } finally { s.restore(); await t.close(); }
});

test('mounted Duties (RPT2, RPT8): rows from the desk, search and grouping, and the drawer with the clause, the default and the record', async () => {
  const t = harness();
  const s = stubs();
  try {
    await act(async () => t.root.render(page('/grow/reporting/duties?project_id=7', { tab: 'duties' })));
    await t.settle();
    assert.match(t.text(t.byId('reporting-duties-line')), /amend the document in Raise/);
    const rows = t.all('reporting-duty-row');
    assert.equal(rows.length, 2);
    assert.match(t.text(rows[1]), /Northwind Capital.*Monthly financial statements.*Monthly.*30 days after month end.*Cash · Net burn · Runway · Revenue \(the studio’s KPI rules; the document names none\).*Unaudited statements.*Signed · Investors’ Rights Agreement §1\.1\(a\).*2 sent · 1 late · 0 missing · 1 waived/s);
    await t.change('reporting-duties-search', 'blue');
    assert.equal(t.all('reporting-duty-row').length, 1);
    await t.change('reporting-duties-search', 'nobody');
    assert.match(t.text(t.byId('reporting-duties-nomatch')), /No duty matches/);
    await t.change('reporting-duties-search', '');
    await t.click('reporting-duties-group-kind');
    assert.match(t.text(t.byId('reporting-duties-table')), /MONTHLY FINANCIAL STATEMENTS|Monthly financial statements.*Quarterly KPI report/s);
    await t.click(t.all('reporting-duty-row')[1]);
    const drawer = t.byId('reporting-duty-drawer');
    assert.ok(drawer);
    assert.equal(t.props(drawer).role, 'dialog', 'D1317: the drawer is the shared Sheet');
    assert.ok(t.props(drawer)['aria-labelledby']);
    assert.equal(t.props(drawer)['data-width'], 640);
    assert.ok(t.byId('reporting-duty-drawer-scrim'), 'the Sheet’s scrim, not a centred backdrop');
    assert.match(t.text(drawer), /Quarterly KPI report to Bluefern Angels/);
    assert.equal(t.text(t.byId('reporting-duty-source')), 'From the closing’s template');
    assert.equal(t.text(t.byId('reporting-duty-clause')), 'Term Sheet (deal pack) Information rights');
    assert.match(t.text(t.byId('reporting-duty-defaulted')), /names no deadline, so 45 days after quarter end is the template’s default/);
    assert.equal(t.text(t.byId('reporting-duty-figures')), 'MRR · Customers');
    assert.match(t.text(t.byId('reporting-duty-strip')), /Q3 2026 · Due in 9 days/);
    assert.equal(t.props(t.byId('reporting-duty-raise')).href, '/raise?project_id=7');
  } finally { s.restore(); await t.close(); }
});

test('mounted builder (RPT3–RPT5, RPT19a): opening re-reads the figures, choices are sent (never values), Eadwyn\'s lines by the Accept rule, recipients, preview and Send', async () => {
  const t = harness();
  const s = stubs({ saveReport: async (uid, body) => { s.calls.push(['saveReport', uid, body]); return { ...DRAFT(), unreadable: Object.keys(body).length ? [] : ['team-expansion'] }; } });
  try {
    await act(async () => t.root.render(page(`/grow/reporting/${UID}/edit?project_id=7`, { tab: 'edit', reportUid: UID })));
    await t.settle();
    assert.deepEqual(s.calls.filter((c) => c[0] === 'report'), [['report', UID]]);
    assert.deepEqual(s.calls.find((c) => c[0] === 'saveReport'), ['saveReport', UID, {}], 'opening saves with no change, which re-reads every store');
    assert.match(t.text(t.byId('reporting-unreadable')), /Unreadable: Team expansion could not be read\. The rest is ready/);
    assert.equal(t.text(t.byId('reporting-figure-mrr-value')), '$48,200');
    assert.equal(t.text(t.byId('reporting-figure-mrr-source')), 'Connector · Stripe · 31 Oct');
    assert.match(t.text(t.byId('reporting-figure-gross_margin-value')), /^— Not recorded: no Grow store records gross margin yet$/);
    assert.equal(t.text(t.byId('reporting-figure-headcount-value')), '0', 'a measured zero is drawn as measured');
    assert.equal(t.text(t.byId('reporting-figure-net_burn-source')), '◐ Team only · from your Mercury');
    assert.equal(t.props(t.byId('reporting-figure-gross_margin-include')).disabled, true, 'a figure with no value cannot go in');
    assert.match(t.text(t.byId('reporting-readiness-line')), /1 of 2 required figures included · 1 left out with no reason yet · Team expansion could not be read/);
    // A choice is sent as a choice: the key, in or out, the reason, the share. Never a value.
    await t.change('reporting-figure-net_burn-share', true, 'checked');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'saveReport').at(-1)[2], { figures: [{ key: 'net_burn', include: true, share: true }] });
    await t.change('reporting-figure-gross_margin-reason', 'Shared at the board meeting instead');
    await t.blur('reporting-figure-gross_margin-reason');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'saveReport').at(-1)[2], { figures: [{ key: 'gross_margin', include: false, reason: 'Shared at the board meeting instead' }] });
    for (const c of s.calls.filter((x) => x[0] === 'saveReport')) assert.ok(!JSON.stringify(c[2]).includes('"value"'), 'no figure value is ever sent');
    // A typed figure: the founders' own number, labelled.
    await t.change('reporting-typed-label', 'Pilot sites live');
    await t.change('reporting-typed-value', '5');
    await t.change('reporting-typed-date', '2026-10-31');
    await t.click('reporting-typed-go');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'saveReport').at(-1)[2], { typed: [{ label: 'Pilot sites live', value: 5, unit: 'count', as_of: '2026-10-31' }] });
    // Narrative: Eadwyn proposes; a sourced line is accepted with its source; a line with none cannot be.
    await t.click('reporting-next');
    await t.click('reporting-eadwyn-draft');
    assert.deepEqual(s.calls.find((c) => c[0] === 'draftLines'), ['draftLines', 7, '2026-07-01', '2026-09-30']);
    const props = t.all('reporting-proposal');
    assert.equal(props.length, 2);
    const accepts = t.all('reporting-proposal-accept');
    assert.equal(t.props(accepts[1]).disabled, true, 'a line with no source cannot be accepted');
    assert.match(t.text(props[1]), /No source in your stored data/);
    await t.click(accepts[0]);
    assert.deepEqual(s.calls.filter((c) => c[0] === 'saveReport').at(-1)[2], { highlights: [{ text: 'MRR grew 21%', source: { label: 'Stripe', ref: null, as_of: '2026-10-31' } }] });
    assert.equal(t.all('reporting-proposal').length, 1);
    await t.change('reporting-own-line', 'Two pilots slipped');
    await t.click('reporting-own-line-go');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'saveReport').at(-1)[2].highlights.at(-1), { text: 'Two pilots slipped', source: { label: 'Written by the founders', ref: null, as_of: null } });
    // Recipients: the holders owed, the team as a choice, never the network.
    await t.click('reporting-next');
    assert.match(t.text(t.byId('reporting-step-recipients')), /Bluefern Angels · Quarterly KPI report · Q3 2026.*no Network option/s);
    await t.change('reporting-include-team', false, 'checked');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'saveReport').at(-1)[2], { include_team: false });
    // Preview as an investor, then Send with the preview's digest.
    await t.click('reporting-next');
    assert.deepEqual(s.calls.find((c) => c[0] === 'previewReport'), ['previewReport', UID, 'investor']);
    assert.match(t.text(t.byId('reporting-frozen-gross_margin')), /Not included: ‘Shared at the board meeting instead’—/);
    await t.click('reporting-preview-team');
    assert.deepEqual(s.calls.filter((c) => c[0] === 'previewReport').at(-1), ['previewReport', UID, 'team']);
    await t.click('reporting-send-open');
    assert.match(t.text(t.byId('reporting-send-lines')), /Figures freeze now.*This meets: Quarterly KPI report · Q3 2026 for Bluefern Angels.*Sent without Gross margin/s);
    await t.click('reporting-send-go');
    assert.deepEqual(s.calls.find((c) => c[0] === 'sendReport'), ['sendReport', UID, SHA]);
    assert.equal(t.text(t.byId('probe')), `/grow/reporting/${UID}?project_id=7`);
  } finally { s.restore(); await t.close(); }
});

test('mounted builder refusals: a stale preview holds Send, a privacy finding stays in the dialog without the words it caught', async () => {
  const t = harness();
  const s = stubs({
    previewReport: async () => ({ ...DRAFT(), figures: [], figures_sha256: SHA, stale: true, stale_reason: 'A figure in the Grow modules changed since this draft was saved. Save the draft again before you send.' }),
  });
  try {
    await act(async () => t.root.render(page(`/grow/reporting/${UID}/edit?project_id=7`, { tab: 'edit', reportUid: UID })));
    await t.settle();
    await t.click('reporting-step-preview-tab');
    assert.match(t.text(t.byId('reporting-preview-stale')), /Save the draft again/);
    assert.equal(t.props(t.byId('reporting-send-open')).disabled, true);
    reportingApi.previewReport = async () => ({ ...DRAFT(), figures: [], figures_sha256: SHA, stale: false });
    reportingApi.sendReport = async () => { const e = new Error('This report holds an email, a phone number, a person’s name or another private detail, so it was not sent.'); e.code = 'pii_found'; e.data = { findings: [{ kind: 'email', in: 'body' }] }; throw e; };
    await t.click('reporting-preview-team');
    await t.click('reporting-send-open');
    await t.click('reporting-send-go');
    assert.equal(t.text(t.byId('reporting-send-refused')), 'This report holds an email, a phone number, a person’s name or another private detail, so it was not sent. Found: email in body.');
    assert.equal(t.text(t.byId('probe')), `/grow/reporting/${UID}/edit?project_id=7`, 'nothing was sent, the builder stays');
  } finally { s.restore(); await t.close(); }
});

test('mounted sent report (RPT6): recipients with delivered and opened, the revision strip, Correct opens the next revision; a reader reads it only', async () => {
  const t = harness();
  const s = stubs({ report: async () => DRAFT() });
  try {
    // A draft at the sent report's address moves to its builder.
    await act(async () => t.root.render(page(`/grow/reporting/${UID}?project_id=7&d`, { tab: 'report', reportUid: UID })));
    await t.settle();
    assert.equal(t.text(t.byId('probe')), `/grow/reporting/${UID}/edit?project_id=7`);
    reportingApi.report = async () => SENT();
    s.calls.length = 0;
    await act(async () => t.root.render(page(`/grow/reporting/${UID}?project_id=7`, { tab: 'report', reportUid: UID })));
    await t.settle();
    assert.equal(s.calls.filter((c) => c[0] === 'saveReport').length, 0, 'a sent report is never saved');
    assert.match(t.text(t.byId('reporting-sent-line')), /Sent 12 Aug 2026 · revision 2/);
    assert.equal(t.text(t.byId('reporting-revision-strip')), 'Revision 2 · reason ‘Stripe refund’. Investors see both versions.');
    assert.match(t.text(t.byId('reporting-recipients-sent')), /Bluefern Angels.*Delivered.*13 Aug.*Cora.*Not delivered: their notification settings.*—/s);
    assert.match(t.text(t.byId('reporting-documents')), /Q2 2026 unaudited statements.*412 KB/s);
    assert.equal(t.byId('reporting-document-attach'), undefined, 'no statement is added after the send');
    await t.click('reporting-correct-open');
    assert.equal(t.props(t.byId('reporting-correct-go')).disabled, true, 'a reason is required');
    await t.change('reporting-correct-reason', 'Customers changed after a Stripe refund');
    await t.click('reporting-correct-go');
    assert.deepEqual(s.calls.find((c) => c[0] === 'correctReport'), ['correctReport', UID, 'Customers changed after a Stripe refund']);
    assert.equal(t.text(t.byId('probe')), `/grow/reporting/${NEXT}/edit?project_id=7`);
    // A reader (an admin, an advisor or a partner of the venture) reads the frozen report, with no Correct.
    reportingApi.report = async () => ({ ...SENT(), view: 'reader', read_only: true, recipients: undefined,
      figures: [{ key: 'mrr', label: 'MRR', module: 'revenue-and-traction', unit: 'usd', value: 39900, source: { word: 'Connector', provider: 'stripe', computed: false }, as_of: '2026-06-30', left_out: false, shared_from_mercury: false, typed: false }] });
    await act(async () => t.root.render(page(`/grow/reporting/${UID}?project_id=7&r`, { tab: 'report', reportUid: UID })));
    await t.settle();
    assert.equal(t.text(t.byId('reporting-sent-readonly')), '◉ Read only');
    assert.equal(t.byId('reporting-correct-open'), undefined);
    assert.equal(t.byId('reporting-recipients-sent'), undefined, 'a reader sees no other recipient');
    assert.match(t.text(t.byId('reporting-frozen-mrr')), /\$39,900/);
    // A draft not shared with the reader is the Worker's 404.
    reportingApi.report = async () => { throw Object.assign(new Error('No such report.'), { status: 404 }); };
    await act(async () => t.root.render(page(`/grow/reporting/${UID}?project_id=7&m`, { tab: 'report', reportUid: UID })));
    await t.settle();
    assert.match(t.text(t.byId('reporting-report-missing')), /A draft is the founders’ own/);
  } finally { s.restore(); await t.close(); }
});

// ---------------------------------------------------------------- the wiring

test('wiring: the report routes sit ahead of /grow/:slug, the guard widens only as the Worker reads, and no pop-up, red lateness or unpaired hover', () => {
  const app = read('frontend/src/App.jsx');
  const slug = app.indexOf('<Route path="/grow/:slug"');
  const reads = "guard(['admin', 'founder', 'advisor', 'partner'],";
  for (const [path, el, guard] of [
    ['/grow/reporting', 'reporting="desk"', reads], ['/grow/reporting/duties', 'reporting="duties"', reads],
    ['/grow/reporting/:id', 'reporting="report"', reads], ['/grow/reporting/:id/edit', 'reporting="edit"', "guard(['admin', 'founder'],"],
  ]) {
    const at = app.indexOf(`<Route path="${path}" element={`);
    assert.ok(at > 0 && at < slug, path);
    const line = app.slice(at, app.indexOf('\n', at));
    assert.ok(line.includes(`${guard} <CycleRoute cycle="grow" ${el} />)`), path);
  }
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /reportUid=\{recordId \?\? null\} role=\{user\?\.role \?\? null\}/);
  const files = ['ReportingDesk.jsx', 'reporting/deskModel.js', 'reporting/builderModel.js', 'reporting/DeskBlocks.jsx', 'reporting/ReportingDialogs.jsx', 'reporting/ReportPage.jsx']
    .map((f) => `frontend/src/pages/cycles/${f}`);
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /window\.(alert|confirm|open)|\balert\(|\bconfirm\(/, f);
    assert.doesNotMatch(src, /dangerouslySetInnerHTML/, f);
    // Every light hover has its dark pair, in the same class string.
    for (const m of src.matchAll(/['`"]((?:[^'`"]*\s)?hover:(?:bg|text|border)-[^'`"]*)['`"]/g)) assert.match(m[1], /dark:hover:/, `${f}: ${m[1].slice(0, 90)}`);
  }
  // Lateness is never red: red is a refusal's colour only.
  const blocks = read('frontend/src/pages/cycles/reporting/DeskBlocks.jsx');
  assert.doesNotMatch(blocks, /red-/, 'no red on the desk\'s blocks');
  // The builder sends choices: no figure value leaves the page except a typed one.
  const pageSrc = read('frontend/src/pages/cycles/reporting/ReportPage.jsx');
  assert.match(pageSrc, /onChoose\(choiceFor\(f, \{ include: e\.target\.checked \}\)\)/);
  assert.ok(read('frontend/src/pages/cycles/README.md').includes('`reporting/`'));
});
