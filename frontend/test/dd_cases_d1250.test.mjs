/**
 * D1250 (#3265, part 6 of #2385) — Due diligence's list tabs as the canvas
 * draws them (DDL1, DDL2, DDL13, DDL16, DDL17, DDL19):
 *
 *   · the pure rules (`ddListModel.js`): the four tiles, the two charts and
 *     their tables, the stage strip, the filters and their chips, each row's
 *     cells, Open a case's payload and footer line, and the template editor;
 *   · mounted, with the `dd` clients as recorders: the desk, the strip and the
 *     paging reading the server, the overview and the list each failing alone,
 *     the empty desk and the filters that match nobody, the row menu for the
 *     lead and for anyone else, Archive with its reason and the recovery
 *     pause, Open a case by name with its context, the investor's and the
 *     advisor's desks, Templates for a Super Admin and read only for an
 *     Admin, a founder sent to their requests, and a member never given an
 *     `/admin/` link;
 *   · the wiring.
 *
 * Every name, figure and id is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/dd_cases_d1250.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import { dd, ddDeskApi, ddLifecycleApi } from '../src/lib/api.js';
import AdminDueDiligencePage, { DdListPage } from '../src/pages/AdminDueDiligencePage.jsx';
import {
  PAUSED, TEMPLATES_NOTE, ageChart, canChangeCase, canOpenCase, chequeCents, decisionsChart, filterChips, listQuery,
  noMatchText, openCaseLine, openCasePayload, overviewTiles, rangeText, refusalText, rowCells, stageStrip, targetCell,
  templateBody, templateDraftState, weightShares,
} from '../src/pages/duediligence/ddListModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const NOW = Date.parse('2026-11-05T10:00:00Z');
const ADMIN = { id: 2, role: 'admin', name: 'Ada Example' };
const LEAD = { id: 3, role: 'partner', name: 'Ben Sample' };

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const OVERVIEW = {
  stages: { available: true, not_started: 5, in_review: 6, ready: 3, decided_90_days: 12, decided: 30, archived: 21, open: 14 },
  severe_flags: { available: true, open: 7, cases: 4 },
  requests: { available: true, waiting: 11, past_due: 4, past_due_reason: null },
  ages: { available: true, note: 'A case is past its target IC date when that day has gone and it is still open.', buckets: [
    { label: '0-7', before_target: 1, past_target: 0, no_target: 2 }, { label: '8-14', before_target: 2, past_target: 0, no_target: 1 },
    { label: '15-30', before_target: 1, past_target: 2, no_target: 1 }, { label: '31-60', before_target: 3, past_target: 0, no_target: 0 },
    { label: '60+', before_target: 0, past_target: 1, no_target: 0 },
  ] },
  decisions: { available: true, recorded_from: '2026-03', months: [
    ...['2025-12', '2026-01', '2026-02'].map((month) => ({ month, recorded: false })),
    ...['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((month) => ({
      month, recorded: true, proceed: 2, proceed_with_conditions: 1, do_not_proceed: 1, withdrawn: 0, archived_without_decision: 0,
    })),
    { month: '2026-11', recorded: true, proceed: 1, proceed_with_conditions: 1, do_not_proceed: 0, withdrawn: 0, archived_without_decision: 0 },
  ] },
};
const ROW = (o) => ({
  uid: 'synthetic-case-0000', subject_type: 'project', subject_label: 'Company Alpha', status: 'in_review', stage: 'in_review', risk_band: 'yellow',
  lead_user_id: LEAD.id, lead_name: 'Ben Sample', template_depth: 'standard', target_ic_date: '2026-11-14', decision: null, decided_at: null,
  created_at: '2026-10-02 09:00:00', checklist_total: 52, checklist_worked: 38, open_flags: 3, worst_severity: 'high', requests_waiting: 2, ...o,
});
const ROWS = [
  ROW({ uid: 'synthetic-alpha-7f3a21c9', lead_user_id: LEAD.id }),
  ROW({ uid: 'synthetic-delta-2b9107de', subject_label: 'Company Delta', lead_user_id: 99, lead_name: 'Eva Demo', risk_band: null, target_ic_date: '2026-11-01', open_flags: 0, worst_severity: null }),
];
const SECTIONS = [
  { key: 'corporate_legal', title: 'Corporate & Legal Structure', weight: 1.5, blocking: true, items: 8, by_depth: { lite: 3, standard: 5, deep: 3 } },
  { key: 'market_traction', title: 'Market & Traction', weight: 1, blocking: false, items: 7, by_depth: { lite: 2, standard: 5, deep: 2 } },
];
const TEMPLATES = (canEdit) => ({
  can_edit: canEdit,
  templates: ['lite', 'standard', 'deep'].map((depth, i) => ({
    depth,
    current: { depth, version: depth === 'deep' ? 0 : 3, built_in: depth === 'deep', sections: SECTIONS, item_count: [14, 52, 73][i],
      body: { sections: [{ key: 'corporate_legal', weight: 1.5, blocking: true, items: ['corporate_legal.cap_table_current'] }, { key: 'market_traction', weight: 1, blocking: false, items: ['market_traction.x'] }] } },
    versions: depth === 'deep' ? [{ version: 0, built_in: true }] : [{ version: 3, created_by_name: 'Sam Super' }, { version: 0, built_in: true }],
  })),
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the tiles: measured figures, Unreadable for a block not read, and never 0 past due when nothing is dated', () => {
  const t = overviewTiles(OVERVIEW);
  assert.deepEqual(t.map((x) => [x.value, x.sub]), [
    [14, '9 in review · 5 not started'], [3, 'Every section has a verdict'], [7, 'Across 4 cases'], [11, '4 past due'],
  ]);
  // Mutation checked: read past_due as 0 → "0 past due".
  const undated = overviewTiles({ ...OVERVIEW, requests: { available: true, waiting: 3, past_due: null, past_due_reason: 'No waiting request has a due date.' } });
  assert.equal(undated[3].sub, 'No waiting request has a due date.');
  const zero = overviewTiles({ stages: { available: true }, severe_flags: { available: true, open: 0, cases: 0 }, requests: { available: true, waiting: 0, past_due: null } });
  assert.deepEqual(zero.map((x) => [x.value, x.sub]), [[0, 'None yet'], [0, 'Every section has a verdict'], [0, 'None raised'], [0, 'None waiting']], 'an empty desk is measured zeros');
  // Mutation checked: a failed read drawn as 0.
  for (const x of overviewTiles({ failed: true })) assert.deepEqual([x.value, x.sub, x.state], [null, 'Unreadable', 'failed']);
  assert.equal(overviewTiles({ ...OVERVIEW, severe_flags: { available: false } })[2].sub, 'Unreadable', 'one block failing is that block alone');
  for (const x of overviewTiles(null)) assert.equal(x.sub, 'Reading…');
});

test('the charts: ages stacked with no target as its own part; decisions with Not recorded months and a table', () => {
  const a = ageChart(OVERVIEW.ages);
  assert.equal(a.sentence, '14 open cases. 3 are past their target IC date; 4 have no target date recorded.');
  assert.deepEqual(a.rows.map((r) => r.label), ['0–7 days', '8–14', '15–30', '31–60', 'Over 60']);
  assert.deepEqual(a.rows[0].parts.map((p) => [p.key, p.value, p.tone]), [['before', 1, 'violet'], ['past', 0, 'amber'], ['none', 2, 'dash']]);
  assert.deepEqual(a.table.rows[2], ['15–30', '1', '2', '1']);
  assert.equal(ageChart({ available: false }), null);
  const d = decisionsChart(OVERVIEW.decisions);
  // Mutation checked: draw a month before the first decision as recorded zeros.
  assert.deepEqual(d.rows.slice(0, 4).map((r) => [r.label, r.recorded, r.total]), [['Dec', false, null], ['Jan', false, null], ['Feb', false, null], ['Mar', true, 4]]);
  assert.equal(d.sentence, 'Proceed is the most common decision. Decisions were not recorded before Mar 2026. Nov so far: 2.');
  assert.ok(d.rows[11].toDate && !d.rows[10].toDate, 'only this month is to date');
  assert.deepEqual(d.table.rows[0], ['Dec 2025', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded']);
  assert.deepEqual(d.table.rows[11], ['Nov 2026 (so far)', '1', '1', '0', '0', '0']);
  assert.ok(d.legend.some((l) => l.label === 'Not recorded before Mar 2026' && l.tone === 'dash'));
  const none = decisionsChart({ available: true, recorded_from: null, months: [{ month: '2026-11', recorded: false }] });
  assert.equal(none.sentence, 'No decision is recorded yet.');
});

test('the rows: Not scored yet never Green, the target day and how far, the stage and decision, the checklist', () => {
  const c = rowCells(ROWS[0], NOW);
  assert.deepEqual([c.name, c.short, c.type, c.template, c.stageWord, c.lead, c.checklist, c.flags, c.severity, c.requests, c.band, c.opened],
    ['Company Alpha', 'synt…21c9', 'Startup', 'Standard', 'In review', 'Ben Sample', '38 of 52', 3, 'High', 2, 'Yellow', '2 Oct 2026']);
  assert.deepEqual(c.target, { day: '14 Nov 2026', sub: 'In 9 days', tone: '' });
  assert.equal(rowCells(ROWS[1], NOW).band, 'Not scored yet');
  assert.deepEqual(targetCell({ stage: 'in_review', target_ic_date: '2026-11-01' }, NOW), { day: '1 Nov 2026', sub: '4 days past', tone: 'bad' });
  assert.deepEqual(targetCell({ stage: 'in_review', target_ic_date: null }, NOW), { day: 'Not recorded', sub: null, tone: 'muted' });
  assert.deepEqual(targetCell({ stage: 'decided', target_ic_date: '2026-10-30', decided_at: '2026-10-29 12:00:00' }, NOW), { day: '30 Oct 2026', sub: 'Decided 29 Oct', tone: '' });
  const decided = rowCells(ROW({ stage: 'decided', status: 'completed', decision: 'proceed_with_conditions' }), NOW);
  assert.equal(decided.decision, 'Proceed with conditions');
  assert.equal(rowCells(ROW({ checklist_total: 0, checklist_worked: 0 }), NOW).checklist, 'No items');
  assert.equal(rowCells(ROW({ open_flags: 0, worst_severity: 'high' }), NOW).severity, null, 'no severity without an open flag');
});

test('the strip, the filters and the paging: one stage at a time, only what is set, and the words of no match', () => {
  const s = stageStrip(OVERVIEW);
  assert.deepEqual(s.map((x) => [x.key, x.n]), [['not_started', 5], ['in_review', 6], ['ready', 3], ['decided', 30], ['archived', 21]]);
  assert.equal(s[3].sub, '12 in the last 90 days', 'the decided filter lists every decided case, so its count is all of them');
  assert.ok(stageStrip({ failed: true }).every((x) => x.n === null), 'a failed overview never draws 0 on the strip');
  assert.deepEqual(listQuery({ filters: { subject_type: 'project', risk_band: '', past_target: '1' }, stage: 'ready', q: '  alp ', sort: 'target', page: 2, pageSize: 25 }),
    { sort: 'target', page: 2, page_size: 25, subject_type: 'project', past_target: 1, stage: 'ready', q: 'alp' });
  assert.deepEqual(filterChips({ lead: '3', past_target: '1', risk_band: 'none', decision: 'none' }, LEAD).map((c) => c.label),
    ['Risk band: Not scored yet', 'Decision: Not recorded', 'Led by me', 'Past target IC date']);
  assert.equal(noMatchText({ filters: { lead: '3', past_target: '1' }, stage: '', q: '' }, LEAD), 'No case matches led by me, past target ic date.');
  assert.equal(rangeText(1, 10, 10, 26), '1–10 of 26');
  assert.equal(rangeText(3, 10, 6, 26), '21–26 of 26');
  assert.equal(rangeText(1, 10, 0, 26), '0 of 26');
});

test('Open a case: a subject from the search, the context sent only when filled, the cheque in cents', () => {
  const base = { subject_type: 'project', subject: null, label: '', template_depth: 'standard', lead: { id: ADMIN.id, name: 'Ada', isMe: true } };
  assert.equal(openCasePayload(base, ADMIN).error, 'Choose the subject from the search.');
  const subject = { id: 10, name: 'Company Alpha', deals: [{ id: 100 }] };
  assert.equal(openCasePayload({ ...base, subject, label: '  ' }, ADMIN).error, 'Give the case a label.');
  assert.deepEqual(openCasePayload({ ...base, subject, label: 'Company Alpha' }, ADMIN).payload,
    { subject_type: 'project', subject_id: 10, subject_label: 'Company Alpha', template_depth: 'standard' }, 'no empty field is sent');
  const full = openCasePayload({
    ...base, subject, label: 'Company Alpha', round_label: 'Series A', cheque: '2,000,000', cheque_currency: 'EUR', target_ic_date: '2026-11-14',
    lead: { id: LEAD.id, name: 'Ben Sample', isMe: false }, deal_id: '100', subject_email: 'synthetic@example.test', notes: ' n ',
  }, ADMIN).payload;
  assert.deepEqual(full, {
    subject_type: 'project', subject_id: 10, subject_label: 'Company Alpha', template_depth: 'standard', round_label: 'Series A',
    cheque_cents: 200000000, cheque_currency: 'EUR', target_ic_date: '2026-11-14', lead_user_id: LEAD.id, deal_id: 100, subject_email: 'synthetic@example.test', notes: 'n',
  });
  // Mutation checked: send the opener as lead_user_id → a lead "change" on every case.
  assert.equal(openCasePayload({ ...base, subject, label: 'x', lead: { id: ADMIN.id, isMe: true } }, ADMIN).payload.lead_user_id, undefined);
  assert.equal(openCasePayload({ ...base, subject_type: 'founder', subject, label: 'x', deal_id: '100' }, ADMIN).payload.deal_id, undefined, 'only a startup links a deal');
  assert.match(openCasePayload({ ...base, subject, label: 'x', cheque: '2m' }, ADMIN).error, /as an amount/);
  assert.deepEqual(['', '1,000', '12.5', '12.345', 'x'].map(chequeCents), [null, 100000, 1250, NaN, NaN]);
  assert.equal(openCaseLine({ subject_type: 'project', template_depth: 'standard', lead: { isMe: true } }, TEMPLATES(false).templates),
    'This seeds the Standard template, version v3, for a startup. Nobody is told until you assign a reviewer or send a request.');
  assert.match(openCaseLine({ subject_type: 'founder', template_depth: 'deep', lead: { name: 'Ben Sample', isMe: false } }, TEMPLATES(false).templates),
    /^This seeds the Deep template, the built-in version, for a founder\. Ben Sample is told they lead it\./);
});

test('templates: shares of the total, a draft that changed, and the body keeping each section’s items', () => {
  assert.deepEqual(weightShares([{ weight: 1.5 }, { weight: 1 }, { weight: 2.5 }]), [30, 20, 50]);
  assert.deepEqual(weightShares([{ weight: 'x' }, { weight: 1 }]), [null, 100]);
  const cur = TEMPLATES(true).templates[1].current;
  const same = cur.sections.map((s) => ({ ...s, weight: String(s.weight) }));
  assert.match(templateDraftState(cur, same).error, /Change a weight/);
  const edited = same.map((s, i) => (i ? { ...s, blocking: true } : { ...s, weight: '2' }));
  assert.deepEqual(templateDraftState(cur, edited).changed, ['Corporate & Legal Structure: weight 1.5 → 2', 'Market & Traction: now blocks']);
  assert.match(templateDraftState(cur, [{ ...same[0], weight: '6' }, same[1]]).error, /at most 5/);
  assert.deepEqual(templateBody('standard', cur, edited).sections, [
    { key: 'corporate_legal', weight: 2, blocking: true, items: ['corporate_legal.cap_table_current'] },
    { key: 'market_traction', weight: 1, blocking: true, items: ['market_traction.x'] },
  ]);
});

test('who may do what, and the pause in words', () => {
  assert.deepEqual(['admin', 'partner', 'investor', 'advisor', 'founder'].map(canOpenCase), [true, true, true, false, false]);
  assert.equal(canChangeCase(LEAD, ROWS[0]), true);
  assert.equal(canChangeCase(LEAD, ROWS[1]), false);
  assert.equal(canChangeCase(ADMIN, ROWS[1]), true);
  assert.equal(canChangeCase(ADMIN, ROW({ status: 'archived' })), false, 'an archived case takes no change');
  assert.equal(refusalText({ status: 423, message: 'Locked' }), PAUSED);
  assert.equal(refusalText({ status: 400, data: { error: 'SENTINEL-WORKER' } }), 'SENTINEL-WORKER');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const ORIG = { desk: { ...ddDeskApi }, dd: { openCase: dd.openCase }, life: { ...ddLifecycleApi } };
const restore = () => { Object.assign(ddDeskApi, ORIG.desk); Object.assign(dd, ORIG.dd); Object.assign(ddLifecycleApi, ORIG.life); };
function stub(over = {}) {
  const calls = [];
  const rec = (k, fn) => async (...a) => { calls.push([k, ...a]); return fn(...a); };
  const api = {
    cases: async () => ({ items: ROWS, total: 26 }), overview: async () => OVERVIEW, templates: async () => TEMPLATES(false),
    subjects: async () => ({ items: [{ id: 10, name: 'Company Alpha', type: 'project', stage: 'mvp', deals: [{ id: 100, status: 'active', instrument: 'SAFE', created_at: '2026-10-09 09:00:00' }] }] }),
    people: async () => ({ items: [{ id: LEAD.id, name: 'Ben Sample', role: 'partner' }, { id: 7, name: 'Avi Advisor', role: 'advisor' }], total: 2 }),
    saveTemplate: async () => ({ ok: true, template: { version: 4 } }),
    openCase: async () => ({ uid: 'synthetic-new-case' }), update: async () => ({ ok: true }), archive: async () => ({ ok: true }),
    ...over,
  };
  for (const k of ['cases', 'overview', 'templates', 'subjects', 'people', 'saveTemplate']) ddDeskApi[k] = rec(k, api[k]);
  dd.openCase = rec('openCase', api.openCase);
  ddLifecycleApi.update = rec('update', api.update);
  ddLifecycleApi.archive = rec('archive', api.archive);
  return calls;
}
const textOf = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || '' : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '');
const byId = (v, id) => v.nodes().filter((n) => v.props(n)?.['data-testid'] === id);
const one = (v, id) => byId(v, id)[0];
const press = async (v, node) => { await act(async () => { v.props(node).onClick({ stopPropagation() {}, preventDefault() {} }); }); };
const settle = async (v, ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); await v.flush(); };

async function desk({ me = ADMIN, url = '/admin/due-diligence', over = {} } = {}) {
  const calls = stub(over);
  const v = await mountContracts(React.createElement(DdListPage, { me }), url);
  await settle(v);
  await settle(v);
  return { v, calls };
}

test('the desk: tiles, charts with View as table, the canvas’s columns, and the strip and paging reading the server', async () => {
  const { v, calls } = await desk();
  try {
    assert.match(textOf(one(v, 'dd-tile-requests')), /Requests waiting on subjects114 past due/);
    assert.equal(textOf(one(v, 'dd-chart-age-sentence')), '14 open cases. 3 are past their target IC date; 4 have no target date recorded.');
    assert.equal(byId(v, 'dd-chart-decisions-svg-not-recorded-0').length, 1, 'a month before the first decision is drawn as Not recorded');
    await press(v, one(v, 'dd-chart-decisions-toggle'));
    assert.match(textOf(one(v, 'dd-chart-decisions-table')), /Dec 2025Not recorded/);
    const alpha = textOf(one(v, 'dd-row-synthetic-alpha-7f3a21c9'));
    assert.match(alpha, /^Company Alphasynt…21c9StartupStandardIn reviewBen Sample38 of 523High2Yellow14 Nov 2026/);
    assert.match(textOf(one(v, 'dd-row-synthetic-delta-2b9107de')), /Not scored yet1 Nov 2026(In \d+ days?|\d+ days? past|Today)/);
    assert.equal(textOf(one(v, 'dd-range')), '1–2 of 26');
    await press(v, one(v, 'dd-stage-ready'));
    await settle(v);
    // Mutation checked: drop the stage from the query → the list never narrows.
    assert.equal(calls.filter(([k]) => k === 'cases').at(-1)[1].stage, 'ready');
    assert.equal(v.props(one(v, 'dd-stage-ready'))['aria-pressed'], true);
    await press(v, one(v, 'dd-next'));
    await settle(v);
    assert.equal(calls.filter(([k]) => k === 'cases').at(-1)[1].page, 2);
    // Mutation checked: reset the page on an unchanged search → back to page 1 once the pause passes.
    await settle(v, 300);
    assert.equal(textOf(one(v, 'dd-page')), '2', 'an unchanged search moved the page');
    await act(async () => { v.props(one(v, 'dd-search')).onChange({ target: { value: 'alpha' } }); });
    await settle(v, 300);
    const last = calls.filter(([k]) => k === 'cases').at(-1)[1];
    assert.deepEqual([last.q, last.page], ['alpha', 1], 'a search reads the server from page 1');
  } finally { await v.unmount(); restore(); }
});

test('one failed block never blanks the page: the overview and the list fail alone', async () => {
  const a = await desk({ over: { overview: async () => { throw Object.assign(new Error('down'), { status: 503 }); } } });
  try {
    assert.ok(one(a.v, 'dd-overview-failed'));
    assert.match(textOf(one(a.v, 'dd-tile-open')), /Unreadable/);
    assert.ok(!/OPEN CASES0|Open cases0/i.test(textOf(one(a.v, 'dd-tiles'))), 'a failed figure drew 0');
    assert.ok(one(a.v, 'dd-chart-age-unreadable'));
    assert.ok(one(a.v, 'dd-row-synthetic-alpha-7f3a21c9'), 'the rows stay');
  } finally { await a.v.unmount(); restore(); }
  const b = await desk({ over: { cases: async () => { throw Object.assign(new Error('down'), { status: 500 }); } } });
  try {
    assert.match(textOf(one(b.v, 'dd-list-failed')), /We could not load the cases\.The rest of Approvals still works\. This is not an empty list\.Try again/);
    assert.equal(byId(b.v, 'dd-empty').length, 0, 'a failed list said there were no cases');
    assert.match(textOf(one(b.v, 'dd-tile-open')), /14/);
  } finally { await b.v.unmount(); restore(); }
});

test('the empty desk and the filters that match nobody say different things', async () => {
  const empty = { stages: { available: true, open: 0 }, severe_flags: { available: true, open: 0, cases: 0 }, requests: { available: true, waiting: 0, past_due: null }, ages: { available: true, buckets: [] }, decisions: { available: true, recorded_from: null, months: [] } };
  const a = await desk({ over: { cases: async () => ({ items: [], total: 0 }), overview: async () => empty } });
  try {
    assert.match(textOf(one(a.v, 'dd-empty')), /^No diligence cases yet\.Open one when a deal, a founder or a partner needs checking\.Open a case$/);
    assert.match(textOf(one(a.v, 'dd-tile-open')), /0None yet/);
  } finally { await a.v.unmount(); restore(); }
  const b = await desk({ over: { cases: async (q) => (q.past_target ? { items: [], total: 0 } : { items: ROWS, total: 26 }) } });
  try {
    await press(b.v, one(b.v, 'dd-filters-toggle'));
    const box = b.v.nodes().find((n) => n.tagName === 'INPUT' && b.v.props(n)?.type === 'checkbox' && textOf(n.parentNode).includes('Past target IC date'));
    await act(async () => { b.v.props(box).onChange({ target: { checked: true } }); });
    await settle(b.v);
    assert.match(textOf(one(b.v, 'dd-no-match')), /^No cases match these filters\.No case matches past target ic date\.Clear filters$/);
    assert.equal(byId(b.v, 'dd-empty').length, 0);
    assert.match(textOf(one(b.v, 'dd-chips')), /Past target IC date/);
    await b.v.click('Clear filters');
    await settle(b.v);
    assert.ok(one(b.v, 'dd-row-synthetic-alpha-7f3a21c9'));
  } finally { await b.v.unmount(); restore(); }
});

test('the row menu: the lead changes their case, anyone else is told why; Archive needs its reason and says the pause', async () => {
  const { v, calls } = await desk({ me: LEAD, over: { archive: async () => { throw Object.assign(new Error('Locked'), { status: 423 }); } } });
  try {
    await press(v, one(v, 'dd-row-menu-synthetic-delta-2b9107de'));
    // Mutation checked: show the changes to everyone → a disabled-in-all-but-name control.
    assert.equal(textOf(one(v, 'dd-row-not-yours-synthetic-delta-2b9107de')), 'Only the case lead or an Admin can change this case.');
    assert.ok(!textOf(one(v, 'dd-row-actions-synthetic-delta-2b9107de')).includes('Archive…'));
    await press(v, one(v, 'dd-row-menu-synthetic-alpha-7f3a21c9'));
    assert.match(textOf(one(v, 'dd-row-actions-synthetic-alpha-7f3a21c9')), /^OpenChange lead…Set target IC date…Archive…$/);
    await v.click('Archive…');
    await v.click('Archive case');
    assert.match(v.text(), /Say why the case is archived\./);
    assert.equal(calls.filter(([k]) => k === 'archive').length, 0, 'an archive went out with no reason');
    await v.fill('Reason', 'The round did not happen.');
    await v.click('Archive case');
    await v.flush();
    assert.deepEqual(calls.filter(([k]) => k === 'archive')[0], ['archive', 'synthetic-alpha-7f3a21c9', 'The round did not happen.']);
    assert.equal(textOf(one(v, 'dd-archive-error')), PAUSED);
  } finally { await v.unmount(); restore(); }
});

test('Set target IC date sends the day through D1246’s PATCH', async () => {
  const { v, calls } = await desk({ me: LEAD });
  try {
    await press(v, one(v, 'dd-row-menu-synthetic-alpha-7f3a21c9'));
    await v.click('Set target IC date…');
    await v.fill('Target IC date', '2026-12-01');
    await v.click('Set date');
    await v.flush();
    assert.deepEqual(calls.find(([k]) => k === 'update'), ['update', 'synthetic-alpha-7f3a21c9', { target_ic_date: '2026-12-01' }]);
  } finally { await v.unmount(); restore(); }
});

test('Open a case: the subject by name, the label prefilled, the context and the deal sent in one write', async () => {
  const { v, calls } = await desk();
  try {
    await press(v, one(v, 'dd-open-case'));
    await settle(v, 250);
    assert.ok(calls.some(([k, type]) => k === 'subjects' && type === 'project'), 'the search reads startups by name');
    assert.ok(!v.nodes().some((n) => v.props(n)?.placeholder === 'e.g. 42'), 'no typed subject id');
    await press(v, one(v, 'dd-open-pick-10'));
    assert.match(textOf(one(v, 'dd-open-subject')), /^Company AlphaStartup · mvpChange$/);
    await v.fill('Round', 'Series A');
    await v.fill('Target IC date', '2026-11-14');
    await act(async () => { v.props(v.nodes().find((n) => v.props(n)?.id === 'dd-open-cheque')).onChange({ target: { value: '2,000,000' } }); });
    await act(async () => { v.props(one(v, 'dd-open-deal')).onChange({ target: { value: '100' } }); });
    assert.match(textOf(one(v, 'dd-open-line')), /^This seeds the Standard template, version v3, for a startup\. Nobody is told/);
    await v.click('Open case');
    await v.flush();
    const sent = calls.find(([k]) => k === 'openCase')[1];
    assert.deepEqual(sent, { subject_type: 'project', subject_id: 10, subject_label: 'Company Alpha', template_depth: 'standard', round_label: 'Series A', cheque_cents: 200000000, cheque_currency: 'EUR', target_ic_date: '2026-11-14', deal_id: 100 });
  } finally { await v.unmount(); restore(); }
});

test('an investor opens on their startups only and leads it; an advisor is told what they do instead', async () => {
  const inv = await desk({ me: { id: 6, role: 'investor', name: 'Ivy' }, url: '/due-diligence' });
  try {
    await press(inv.v, one(inv.v, 'dd-open-case'));
    await settle(inv.v, 250);
    assert.equal(textOf(one(inv.v, 'dd-open-investor-note')), 'Investors open cases on startups only.');
    assert.equal(textOf(one(inv.v, 'dd-open-lead-self')), 'You lead the cases you open.');
    assert.equal(inv.calls.filter(([k]) => k === 'people').length, 0, 'an investor never reads the people search');
  } finally { await inv.v.unmount(); restore(); }
  const adv = await desk({ me: { id: 7, role: 'advisor', name: 'Avi' }, url: '/due-diligence' });
  try {
    assert.equal(textOf(one(adv.v, 'dd-advisor-note')), 'Advisors review the sections they are invited to.');
    assert.equal(byId(adv.v, 'dd-open-case').length, 0);
  } finally { await adv.v.unmount(); restore(); }
});

test('a member never gets an /admin/ link; the case links stay on their base', async () => {
  const { v } = await desk({ me: LEAD, url: '/due-diligence' });
  try {
    await press(v, one(v, 'dd-row-menu-synthetic-alpha-7f3a21c9'));
    const hrefs = v.nodes().filter((n) => n.tagName === 'A').map((n) => v.props(n)?.href).filter(Boolean);
    assert.ok(hrefs.length >= 3);
    assert.ok(hrefs.every((h) => !h.startsWith('/admin')), hrefs.join(' '));
    assert.ok(hrefs.includes('/due-diligence/synthetic-alpha-7f3a21c9'));
  } finally { await v.unmount(); restore(); }
});

test('Templates: a Super Admin saves the next version through a dialog; an Admin reads the same table', async () => {
  const sa = await desk({ url: '/admin/due-diligence/templates', over: { templates: async () => TEMPLATES(true) } });
  try {
    assert.ok(one(sa.v, 'dd-templates-hq'));
    assert.match(textOf(one(sa.v, 'dd-template-card-standard')), /^Standardv32 sections · 52 itemsDefault for startups · includes Lite$/);
    assert.match(textOf(one(sa.v, 'dd-template-card-deep')), /Built-in/);
    await sa.v.click('Save as new version');
    assert.match(textOf(one(sa.v, 'dd-template-problem')), /Change a weight or a blocking section/);
    const weight = sa.v.nodes().find((n) => sa.v.props(n)?.['aria-label'] === 'Weight of Corporate & Legal Structure');
    await act(async () => { sa.v.props(weight).onChange({ target: { value: '2' } }); });
    assert.match(textOf(one(sa.v, 'dd-template-row-corporate_legal')), /67%/);
    await press(sa.v, one(sa.v, 'dd-template-save-open'));
    assert.equal(textOf(one(sa.v, 'dd-template-changes')), 'Corporate & Legal Structure: weight 1.5 → 2');
    await press(sa.v, one(sa.v, 'dd-template-save-submit'));
    await sa.v.flush();
    // Mutation checked: send the draft without the items → every section seeds nothing.
    assert.deepEqual(sa.calls.find(([k]) => k === 'saveTemplate').slice(1), ['standard', [
      { key: 'corporate_legal', weight: 2, blocking: true, items: ['corporate_legal.cap_table_current'] },
      { key: 'market_traction', weight: 1, blocking: false, items: ['market_traction.x'] },
    ]]);
    await settle(sa.v);
    assert.match(textOf(one(sa.v, 'dd-template-saved')), /Standard version v4 is saved\./);
  } finally { await sa.v.unmount(); restore(); }
  const ad = await desk({ url: '/admin/due-diligence/templates' });
  try {
    assert.equal(textOf(one(ad.v, 'dd-templates-readonly')), TEMPLATES_NOTE);
    assert.ok(!ad.v.nodes().some((n) => n.tagName === 'INPUT'), 'an Admin is given no editor, disabled or not');
    assert.ok(!ad.v.text().includes('Save as new version'));
    assert.match(textOf(one(ad.v, 'dd-template-row-corporate_legal')), /Corporate & Legal Structure1\.560%Blocking353/);
  } finally { await ad.v.unmount(); restore(); }
  const bad = await desk({ url: '/admin/due-diligence/templates', over: { templates: async () => { throw new Error('down'); } } });
  try {
    assert.match(textOf(one(bad.v, 'dd-templates-failed')), /could not be read\.This is not an empty store/);
  } finally { await bad.v.unmount(); restore(); }
});

test('a founder on /due-diligence is sent to their requests, never shown the desk', async () => {
  const calls = stub();
  const v = await mountContracts(React.createElement(AuthProvider, null, React.createElement(AdminDueDiligencePage)), '/due-diligence', { id: 8, role: 'founder', name: 'Fay' });
  try {
    await v.flush();
    // Mutation checked: drop the redirect → the desk reads the cases.
    assert.ok(!v.text().includes('Due diligence'), v.text());
    assert.equal(calls.filter(([k]) => k === 'cases' || k === 'overview').length, 0);
  } finally { await v.unmount(); restore(); }
});

/* ------------------------------------------------------------------ *
 * The wiring
 * ------------------------------------------------------------------ */

test('the wiring: the route lets a founder reach the redirect, the Worker takes the context, the docs', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.includes(`<Route path="/due-diligence" element={guard(['admin', 'partner', 'investor', 'advisor', 'founder'], <AdminDueDiligencePage />)} />`));
  assert.ok(app.includes(`<Route path="/admin/due-diligence" element={guard(['admin', 'partner', 'investor', 'advisor'], <AdminDueDiligencePage />)} />`), 'the admin base takes no founder');
  const page = read('frontend/src/pages/AdminDueDiligencePage.jsx');
  assert.ok(page.includes(`if (me?.role === 'founder') return <Navigate to="/due-diligence/requests" replace />;`));
  assert.ok(!page.includes('Subject ID'), 'no typed subject id');
  const worker = read('cloudflare-worker/src/routes/dd.ts');
  assert.ok(worker.includes('const ctx = await caseContextFrom(c.env, body, {\n      lead_user_id: user.id,'), 'POST /cases checks its context before writing');
  assert.ok(read('documentation/architecture/decisions/D1250.md').includes('D1250'));
});
