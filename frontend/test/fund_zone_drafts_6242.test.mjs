/**
 * D6242 (#6242): Eadwyn in the Fund zones — "Summarise this LP" on the LP record drawer and "Draft the letter" on a
 * draft reporting period, both ZoneDraft bands over the Worker's `funds/lps` and `funds/reporting` surfaces.
 *
 *   · every figure the LP summary's material carries is on the drawer, drawn from the same fixture: the Worker's
 *     builder (`services/fundZoneDrafts.ts`) is run here over the rows the drawer renders;
 *   · with nothing to read, or while the drawer's own reads are out or failed, the control says so and does not run;
 *   · a refused run reads "Refused · …" and a failed one "Unavailable · …" (D5129's words);
 *   · the letter's Accept fills the unsaved Letter section and nothing is saved until Save draft; an issued period
 *     offers no draft, and an unsaved period or unsaved developments say to save first.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/fund_zone_drafts_6242.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../src/lib/api.js';
import { STATE_WORDS } from '../src/ui/dataState.js';
import ZoneDraft, { RUN_REFUSED, RUN_UNAVAILABLE, RUN_UNFAITHFUL, runOutcome } from '../src/workspaces/ZoneDraft.jsx';
import { LpRecordView } from '../src/pages/investor/InvestorFundLpRecord.jsx';
import { LpSummaryBand } from '../src/pages/investor/InvestorFundLPs.jsx';
import {
  LP_SUMMARY_NOTHING, LP_SUMMARY_UNREAD, LP_SUMMARY_WAIT, lpFigures, lpSummaryBlocked,
} from '../src/pages/investor/fundLpRecordModel.js';
import { LETTER_FULL, LETTER_SAVE_FIRST, PeriodEditor, fillLetter } from '../src/pages/FundReportPeriodPage.jsx';
import { lpSummaryMaterial } from '../../cloudflare-worker/src/services/fundZoneDrafts.ts';
import { mountForm, textOf } from './_form_d695.mjs';

const h = React.createElement;
const ready = (data) => ({ status: 'ready', data, reload() {} });

// One LP's rows in the shapes the drawer reads: the register row, `/ledger?lp=` and `/comms?lp=`.
const FUND = { id: 10, name: 'Fund One' };
const LP = { id: 100, name: 'Account LP', email: 'lp@example.test', commitment_amount: 1000000, invested_amount: 250, status: 'committed', commitment_date: '2026-01-15', account_user_id: 7, kyc_status: 'approved' };
const LEDGER = { truncated: false, entries: [
  { kind: 'line', id: 900, call_number: 3, amount_cents: 100000, due_date: '2026-09-30', status: 'pending' },
  { kind: 'line', id: 901, call_number: 2, amount_cents: 45000, due_date: null, status: 'paid' },
  { kind: 'receipt', id: 1, capital_call_id: 900, amount_cents: 25000, received_on: '2026-09-20', reference: 'WIRE-A1', call_number: 3 },
  { kind: 'receipt', id: 2, capital_call_id: 777, amount_cents: 12345, received_on: '2026-08-01', reference: null, call_number: 1 },
] };
const COMMS = { truncated: false, items: [{ id: 5, lp_id: 100, kind: 'call_notice', subject: 'Call 3 notice', sent_at: '2026-09-01 09:00:00', logged_by_name: 'Gee Pee' }] };
const REPORT = { performance: [], distributions: [], capital_statements: [], capital_statements_recorded: true };

const decode = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

test('every figure the LP summary is drafted from is on the drawer, and the material reads that one LP only', () => {
  const figures = lpFigures(LP, 2000000);
  const screen = decode(renderToStaticMarkup(h(MemoryRouter, null, h(LpRecordView, {
    fund: FUND, lp: LP, figures, ledger: ready(LEDGER), comms: ready(COMMS), report: ready(REPORT), onClose() {},
  }))));
  const material = lpSummaryMaterial({ fund: FUND, lp: LP, ledger: LEDGER, comms: COMMS });
  assert.ok(material.length > 0);
  const amounts = material.join('\n').match(/\$[\d,]+(?:\.\d{2})?/g);
  assert.deepEqual([...new Set(amounts)].sort(), ['$0.00', '$1,000,000', '$1,000.00', '$1,450.00', '$123.45', '$250', '$250.00', '$450.00', '$750.00'].sort());
  for (const a of amounts) assert.ok(screen.includes(a), `${a} is in the summary's material but not on the drawer`);
  for (const d of ['2026-09-30', '2026-09-20', '2026-08-01', '2026-01-15', '2026-09-01', 'WIRE-A1', 'Call 3 notice']) {
    assert.ok(material.join('\n').includes(d), `the material lacks ${d}`);
    assert.ok(screen.includes(d), `${d} is in the material but not on the drawer`);
  }
  // Every number of any kind the material holds is on the drawer too, so a draft held to it can quote nothing else.
  for (const n of new Set(material.join('\n').match(/\d[\d,]*(?:\.\d+)?/g).map((x) => x.replace(/[.,]+$/, '')))) assert.ok(screen.includes(n), `${n} is not on the drawer`);
  // The share is a figure against the whole register: other LPs' commitments, so it is not in one LP's summary.
  assert.ok(screen.includes(figures.share));
  assert.ok(!material.join('\n').includes(figures.share), 'the summary read the register total');
  assert.ok(!material.join('\n').includes('lp@example.test'), 'the LP\'s email reached the model');
});

test('Summarise this LP waits for the drawer\'s reads, refuses over a failed one, and says when there is nothing', () => {
  const loading = { status: 'loading', data: null };
  const failed = { status: 'unreadable', data: null };
  assert.equal(lpSummaryBlocked(LP, loading, ready(COMMS)), LP_SUMMARY_WAIT);
  assert.equal(lpSummaryBlocked(LP, ready(LEDGER), failed), LP_SUMMARY_UNREAD);
  assert.equal(lpSummaryBlocked(LP, failed, ready(COMMS)), LP_SUMMARY_UNREAD);
  const bare = { ...LP, commitment_amount: 0 };
  const none = { entries: [], truncated: false };
  assert.equal(lpSummaryBlocked(bare, ready(none), ready({ items: [] })), LP_SUMMARY_NOTHING);
  assert.equal(lpSummaryBlocked(LP, ready(none), ready({ items: [] })), null, 'a commitment alone is something to read');
  assert.equal(lpSummaryBlocked(bare, ready(none), ready(COMMS)), null, 'a logged message alone is something to read');
  assert.equal(lpSummaryBlocked(LP, ready(LEDGER), ready(COMMS)), null);
});

test('the LP band is the funds/lps surface on this LP, and with nothing to read it says so and does not run', async () => {
  const saved = { ...api.research };
  const calls = [];
  api.research.zoneDrafts = async (...a) => { calls.push(['zoneDrafts', ...a]); return { items: [] }; };
  api.research.zoneDraftRun = async (...a) => { calls.push(['zoneDraftRun', ...a]); return { item: null }; };
  const none = ready({ entries: [], truncated: false });
  const view = await mountForm(h(LpSummaryBand, { fund: FUND, lp: { ...LP, commitment_amount: 0 }, ledger: none, comms: ready({ items: [] }) }));
  try {
    assert.match(view.text(), /Proposal · a summary of this LP/);
    assert.ok(view.text().includes(LP_SUMMARY_NOTHING));
    const button = view.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Summarise this LP');
    assert.equal(view.props(button).disabled, true, 'the control runs with nothing to read');
    await view.props(button).onClick();
    assert.deepEqual(calls.filter(([n]) => n === 'zoneDraftRun'), [], 'a blocked band ran');
    assert.deepEqual(calls[0], ['zoneDrafts', 'funds/lps', '10:100'], 'the band reads this LP\'s drafts only');
  } finally { await view.unmount(); Object.assign(api.research, saved); }

  const runs = [];
  api.research.zoneDrafts = async () => ({ items: [] });
  api.research.zoneDraftRun = async (...a) => { runs.push(a.slice(0, 2)); return { item: { uid: 'd1', body: 'Account LP owes $750.00.', accepted: false } }; };
  const live = await mountForm(h(LpSummaryBand, { fund: FUND, lp: LP, ledger: ready(LEDGER), comms: ready(COMMS) }));
  try {
    assert.deepEqual(runs, [], 'nothing runs on mount');
    await live.click('Summarise this LP');
    assert.deepEqual(runs, [['funds/lps', '10:100']]);
    assert.match(live.text(), /Account LP owes \$750\.00\./);
  } finally { await live.unmount(); Object.assign(api.research, saved); }
});

test('a refused run reads Refused and a failed one Unavailable, in the platform\'s words', async () => {
  assert.equal(runOutcome(Object.assign(new Error('Eadwyn is turned off on this page.'), { status: 403, code: 'assist_off' })), `${STATE_WORDS.refused} · Eadwyn is turned off on this page.`);
  assert.equal(runOutcome({ status: 404 }), `${STATE_WORDS.refused} · ${RUN_REFUSED}`);
  assert.equal(runOutcome({ status: 503, code: 'guard_blocked_output', message: 'The guard withheld this draft.' }), `${STATE_WORDS.refused} · The guard withheld this draft.`);
  assert.equal(runOutcome({ status: 503, code: 'draft_unavailable', message: 'draft_unavailable' }), `${STATE_WORDS.unavailable} · ${RUN_UNAVAILABLE}`);
  assert.equal(runOutcome({ status: 503, code: 'draft_unfaithful' }), `${STATE_WORDS.unavailable} · ${RUN_UNFAITHFUL}`);
  assert.equal(runOutcome(new Error('network down')), `${STATE_WORDS.unavailable} · ${RUN_UNAVAILABLE}`);

  const saved = { ...api.research };
  api.research.zoneDrafts = async () => ({ items: [] });
  try {
    for (const [error, words] of [
      [Object.assign(new Error('Eadwyn is turned off on this page.'), { status: 403, code: 'assist_off' }), 'Refused · Eadwyn is turned off on this page.'],
      [Object.assign(new Error('draft_unfaithful'), { status: 503, code: 'draft_unfaithful' }), `Unavailable · ${RUN_UNFAITHFUL}`],
    ]) {
      api.research.zoneDraftRun = async () => { throw error; };
      const on = await mountForm(h(ZoneDraft, { surface: 'funds/lps', label: 'L', run: 'Go', stateWords: true }));
      try {
        await on.click('Go');
        assert.ok(on.text().includes(words), `${words} not shown: ${on.text()}`);
      } finally { await on.unmount(); }
      const off = await mountForm(h(ZoneDraft, { surface: 'funds/lps', label: 'L', run: 'Go' }));
      try {
        await off.click('Go');
        assert.ok(!off.text().includes('Refused ·') && !off.text().includes('Unavailable ·'), 'a band without stateWords changed its words');
        assert.ok(off.text().includes('That draft could not be written right now.'), 'a band without stateWords lost its sentence');
      } finally { await off.unmount(); }
    }
    api.research.zoneDraftRun = async () => { throw Object.assign(new Error('nothing_to_draft'), { status: 409, code: 'nothing_to_draft' }); };
    const nothing = await mountForm(h(ZoneDraft, { surface: 'funds/reporting', label: 'L', run: 'Go', stateWords: true, nothingToDraft: 'Nothing to draft from.' }));
    try {
      await nothing.click('Go');
      assert.ok(nothing.text().includes('Nothing to draft from.'));
      assert.ok(!nothing.text().includes('Unavailable ·'), 'nothing to read is not a failure');
    } finally { await nothing.unmount(); }
  } finally { Object.assign(api.research, saved); }
});

// ------------------------------------------------------------------ the letter

const PAGE = { currency: 'USD', can_manage: true, periods: [], fund: { id: 10, name: 'Fund One' } };
const PERIOD = { id: 1, period: 'Q3 2026', period_start: '2026-07-01', period_end: '2026-09-30', status: 'draft', revision: 'r1', corrects_period_id: null,
  narrative: { letter: ['Existing paragraph.'], developments: [{ date: '2026-08-12', title: 'Acme closed', body: 'Series A.' }], outlook: [], subsequent: [] } };
const editorHtml = (data) => renderToStaticMarkup(h(MemoryRouter, null, h(PeriodEditor, { data, onSaved() {}, onDeleted() {} })));

test('fillLetter adds the draft\'s paragraphs after the letter, never past 50', () => {
  assert.deepEqual(fillLetter(['A'], 'One.\n\nTwo.\n \nThree.'), ['A', 'One.', 'Two.', 'Three.']);
  assert.deepEqual(fillLetter([], '  '), []);
  const near = Array.from({ length: 48 }, (_, i) => `P${i}`);
  assert.deepEqual(fillLetter(near, 'One.\n\nTwo.\n\nThree.').slice(48), ['One.', 'Two.\n\nThree.']);
  const full = Array.from({ length: 50 }, (_, i) => `P${i}`);
  assert.equal(fillLetter(full, 'More.'), full);
});

test('Draft the letter: Accept fills the unsaved Letter section, and only Save draft writes the period', async () => {
  const saved = { ...api.research };
  const originalSave = api.fundsSaveReportPeriod;
  const calls = [];
  const saves = [];
  api.research.zoneDrafts = async (...a) => { calls.push(['zoneDrafts', ...a]); return { items: [] }; };
  api.research.zoneDraftRun = async (...a) => { calls.push(['zoneDraftRun', ...a.slice(0, 2)]); return { item: { uid: 'L1', body: 'This quarter we called $1,500.00.\n\nAcme closed its Series A.', accepted: false } }; };
  api.research.zoneDraftAccept = async (uid, body) => { calls.push(['zoneDraftAccept', uid, body]); return { item: { uid, body: 'This quarter we called $1,500.00.\n\nAcme closed its Series A.', accepted: true } }; };
  api.fundsSaveReportPeriod = async (fundId, body) => { saves.push([fundId, body]); return { period: { id: 1 } }; };
  const view = await mountForm(h(PeriodEditor, { data: { ...PAGE, period: structuredClone(PERIOD) }, onSaved() {}, onDeleted() {} }), { modal: true });
  const letters = () => view.nodes().filter((n) => /^letter paragraph \d+$/.test(view.props(n)['aria-label'] || '')).map((n) => view.props(n).value);
  try {
    assert.match(view.text(), /Proposal · the quarterly letter/);
    assert.deepEqual(calls.filter(([n]) => n !== 'zoneDrafts'), [], 'the band ran on mount');
    await view.click('Draft the letter');
    assert.deepEqual(calls.filter(([n]) => n === 'zoneDraftRun'), [['zoneDraftRun', 'funds/reporting', '10:1']]);
    assert.deepEqual(letters(), ['Existing paragraph.'], 'the draft reached the letter before Accept');
    await view.click('Accept into the letter');
    assert.deepEqual(letters(), ['Existing paragraph.', 'This quarter we called $1,500.00.', 'Acme closed its Series A.']);
    assert.equal(saves.length, 0, 'Accept saved the period');
    await view.click('Save draft');
    assert.equal(saves.length, 1);
    assert.deepEqual(saves[0][1].narrative.letter, ['Existing paragraph.', 'This quarter we called $1,500.00.', 'Acme closed its Series A.']);
    assert.equal(saves[0][1].issue, false, 'Save draft issued the period');
  } finally {
    await view.unmount();
    Object.assign(api.research, saved); api.fundsSaveReportPeriod = originalSave;
  }
});

test('Draft the letter: an issued period offers no draft; an unsaved period or unsaved developments say to save first', () => {
  const issued = editorHtml({ ...PAGE, period: { ...structuredClone(PERIOD), status: 'issued', issued_at: '2026-10-01', issued_by: 2 } });
  assert.doesNotMatch(issued, /Draft the letter|zone-draft-funds-reporting/);
  assert.doesNotMatch(editorHtml({ ...PAGE, can_manage: false, period: structuredClone(PERIOD) }), /Draft the letter/);
  const unsaved = editorHtml({ ...PAGE, period: { ...structuredClone(PERIOD), id: undefined } });
  assert.ok(decode(unsaved).includes(LETTER_SAVE_FIRST));
  assert.match(editorHtml({ ...PAGE, period: structuredClone(PERIOD) }), /zone-draft-funds-reporting/);
  assert.ok(!decode(editorHtml({ ...PAGE, period: structuredClone(PERIOD) })).includes(LETTER_SAVE_FIRST), 'a saved period is told to save');
});

test('Draft the letter: changed developments wait for Save draft, and a full letter holds Accept', async () => {
  const saved = { ...api.research };
  api.research.zoneDrafts = async () => ({ items: [] });
  const view = await mountForm(h(PeriodEditor, { data: { ...PAGE, period: structuredClone(PERIOD) }, onSaved() {}, onDeleted() {} }), { modal: true });
  try {
    await view.flush();
    assert.ok(!view.text().includes(LETTER_SAVE_FIRST));
    const title = view.nodes().find((n) => view.props(n)['aria-label'] === 'Development title 1');
    await view.flush();
    view.props(title).onChange({ target: { value: 'Acme closed, edited' } });
    await view.flush();
    assert.ok(view.text().includes(LETTER_SAVE_FIRST), 'an unsaved development did not hold the run');
    const run = view.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Draft the letter');
    assert.equal(view.props(run).disabled, true);
  } finally { await view.unmount(); Object.assign(api.research, saved); }
  const fullData = { ...PAGE, period: { ...structuredClone(PERIOD), narrative: { ...PERIOD.narrative, letter: Array.from({ length: 50 }, (_, i) => `P${i}`) } } };
  api.research.zoneDrafts = async () => ({ items: [{ uid: 'L1', body: 'Drafted.', accepted: false }] });
  const full = await mountForm(h(PeriodEditor, { data: fullData, onSaved() {}, onDeleted() {} }), { modal: true });
  try {
    await full.flush();
    assert.ok(full.text().includes(LETTER_FULL), 'a full letter does not say why Accept waits');
  } finally { await full.unmount(); Object.assign(api.research, saved); }
});
