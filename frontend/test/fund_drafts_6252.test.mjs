// #6252 (D6252): the fund brief and letter-opening bands. Nothing runs on mount; Accept is the only write, and the
// letter's Accept only fills the unsaved editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import FundPage from '../src/pages/FundPage.jsx';
import { PeriodEditor } from '../src/pages/FundReportPeriodPage.jsx';
import FundDraftBand from '../src/pages/FundDraftBand.jsx';
import { fundDraftsApi } from '../src/lib/api/fundDrafts.js';
import { api } from '../src/lib/api.js';
import { mountForm } from './_form_d695.mjs';
import { installDocument } from './_contracts_dom.mjs';
// The D631 fixtures' shape (fund_reports_d631.test.mjs), copied so importing them does not run that file's tests.
const page = { currency: 'USD', can_manage: true, periods: [], fund: { id: 10, name: 'Recorded Fund', status: 'investing', vintage_year: 2026, size_cents: 1000000, lp_count: 2,
  gp: { name: 'Recorded GP', title: null, entity: 'GP entity', email: 'gp@example.test' }, providers: { fund_admin: 'Recorded administrator', auditor: null, legal_counsel: null, custodian: null, valuation_policy: null } },
  totals: { committed_cents: 200000, invested_cents: 22222, invested_reason: null }, lpa: { status: 'signed', version: 3, updated_at: '2026-07-01' } };
const period = { id: 1, period: 'Q2 2026', period_start: '2026-04-01', period_end: '2026-06-30', status: 'draft', revision: 'receipt', corrects_period_id: null,
  narrative: { letter: ['Recorded letter.'], developments: [{ date: '2026-05-12', title: 'Milestone', body: 'Recorded development.' }], outlook: ['Next quarter.'], subsequent: [{ d: '2026-07-08', e: 'Recorded event.' }] } };

const ready = (data) => ({ loading: false, error: null, data, reload() {} });
const render = (data) => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/funds/10'] }, React.createElement(FundPage, { reading: ready(data) })));
const draft = { draft: { kind: 'fund_brief', body: 'Recorded Fund is investing [1].', stored: false, sources: [{ n: 1, kind: 'fund', ref: 'fund:10:status', label: 'Status: investing', date: null }, { n: 2, kind: 'lpa', ref: 'fund:10:lpa', label: 'Limited partnership agreement: signed', date: '2026-07-01' }] } };

test('D6252 the fund brief band is the GP\'s alone, in the canvas\'s words, and runs nothing on render', () => {
  const original = fundDraftsApi.brief;
  let calls = 0;
  fundDraftsApi.brief = async () => { calls++; return draft; };
  try {
    const gp = render(page);
    for (const words of ['Fund brief', 'Draft a one-paragraph description of this fund from its recorded facts.', 'Accept writes a note. It changes no fund record.', 'Draft the brief']) assert.ok(gp.includes(words), words);
    const lp = render({ ...page, can_manage: false });
    assert.doesNotMatch(lp, /Fund brief|Draft the brief/);
    assert.equal(calls, 0);
  } finally { fundDraftsApi.brief = original; }
});

test('D6252 a pressed draft shows its body and every record it cites; with no store, Accept is a sentence, not a button', async () => {
  let runs = 0;
  const view = await mountForm(React.createElement(FundDraftBand, { title: 'Fund brief', body: 'b', writes: 'w', run: 'Draft the brief', onRun: async () => { runs++; return draft; }, acceptBlocked: 'Keeping the brief as a note is not built yet.' }));
  try {
    assert.equal(runs, 0, 'nothing on mount');
    await view.click('Draft the brief');
    assert.equal(runs, 1);
    const text = view.text();
    assert.match(text, /Recorded Fund is investing \[1\]\./);
    assert.match(text, /Status: investing/);
    assert.match(text, /Limited partnership agreement: signed · 2026-07-01/);
    assert.match(text, /Keeping the brief as a note is not built yet\./);
    assert.equal(view.nodes().some((n) => n.tagName === 'BUTTON' && /^Accept$/.test(view.text(n))), false);
    await view.click('Discard');
    assert.doesNotMatch(view.text(), /Recorded Fund is investing/);
  } finally { await view.unmount(); }
});

test('D6252 AI off, no budget or nothing recorded: the Worker\'s own sentence, and no draft', async () => {
  for (const [status, message] of [[403, 'Eadwyn is turned off on this page.'], [402, 'Your AI budget for this month is used up.'], [409, 'This period has no recorded capital calls or paid distributions, so there is nothing to draft from.']]) {
    const view = await mountForm(React.createElement(FundDraftBand, { title: 't', body: 'b', writes: 'w', run: 'Draft', onRun: async () => { throw Object.assign(new Error(message), { status }); } }));
    try {
      await view.click('Draft');
      assert.match(view.text(), new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(view.text(), /Accept|Drawn from/);
    } finally { await view.unmount(); }
  }
  const odd = await mountForm(React.createElement(FundDraftBand, { title: 't', body: 'b', writes: 'w', run: 'Draft', onRun: async () => { throw new Error('SQLITE internals'); } }));
  try { await odd.click('Draft'); assert.doesNotMatch(odd.text(), /SQLITE/); assert.match(odd.text(), /Nothing was written/); } finally { await odd.unmount(); }
});

test('D6252 the letter: Accept puts the opening first in the unsaved letter and saves nothing, issues nothing', async () => {
  const data = { ...page, period: structuredClone(period) };
  const originals = { letter: fundDraftsApi.letter, save: api.fundsSaveReportPeriod };
  const asked = [];
  let saves = 0;
  fundDraftsApi.letter = async (fundId, periodId) => { asked.push([fundId, periodId]); return { draft: { kind: 'letter_opening', body: 'This quarter we called $250,000.00 [1].', sources: [{ n: 1, kind: 'capital_call', ref: 'capital_call:1', label: 'Capital call 1', date: '2026-05-02' }] } }; };
  api.fundsSaveReportPeriod = async () => { saves++; return { period: { id: 1 } }; };
  const view = await mountForm(React.createElement(PeriodEditor, { data, onSaved() {}, onDeleted() {} }), { modal: true });
  try {
    assert.match(view.text(), /Letter draft/);
    assert.match(view.text(), /Accept writes into the draft\. Issuing stays a human click\./);
    await view.click('Draft the opening');
    assert.deepEqual(asked, [[10, 1]]);
    await view.click('Accept');
    const letters = view.nodes().filter((n) => /^letter paragraph \d+$/.test(view.props(n)['aria-label'] || '')).map((n) => view.props(n).value);
    assert.deepEqual(letters, ['This quarter we called $250,000.00 [1].', 'Recorded letter.']);
    assert.equal(saves, 0, 'Accept saves nothing');
    assert.doesNotMatch(view.text(), /Issue this period\?/, 'and opens no issue dialog');
  } finally {
    await view.unmount();
    fundDraftsApi.letter = originals.letter; api.fundsSaveReportPeriod = originals.save;
  }
});

test('D6252 the letter band: an unsaved period says to save first; an issued period or a reader has no band', () => {
  const html = (data) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(PeriodEditor, { data, onSaved() {}, onDeleted() {} })));
  const unsaved = html({ ...page, period: { ...structuredClone(period), id: undefined } });
  assert.match(unsaved, /Save the draft first: the opening is drafted from the saved period’s dates\./);
  assert.doesNotMatch(unsaved, /Draft the opening/);
  assert.doesNotMatch(html({ ...page, period: { ...structuredClone(period), status: 'issued', issued_at: '2026-07-15', issued_by: 2 } }), /Letter draft/);
  assert.doesNotMatch(html({ ...page, can_manage: false, period: { ...structuredClone(period), status: 'issued' } }), /Letter draft/);
});

test('D6252 a full letter refuses the opening rather than dropping a paragraph', async () => {
  const full = { ...page, period: { ...structuredClone(period), narrative: { ...period.narrative, letter: Array.from({ length: 50 }, (_, i) => `P${i}`) } } };
  const original = fundDraftsApi.letter;
  fundDraftsApi.letter = async () => ({ draft: { body: 'Opening.', sources: [{ n: 1, label: 'Capital call 1', date: null }] } });
  const view = await mountForm(React.createElement(PeriodEditor, { data: full, onSaved() {}, onDeleted() {} }), { modal: true });
  try {
    await view.click('Draft the opening');
    await view.click('Accept');
    assert.match(view.text(), /The letter already has 50 paragraphs/);
  } finally { await view.unmount(); fundDraftsApi.letter = original; }
});

test('D6252 the client posts to the mounted routes with the rail option and the page, and checks ids first', async () => {
  const restore = installDocument();
  const previous = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (u, o = {}) => { sent.push({ url: String(u).replace(/^.*\/api/, ''), o }); return new Response(JSON.stringify(draft), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    await fundDraftsApi.brief(10);
    await fundDraftsApi.letter(10, 4);
    assert.deepEqual(sent.map((s) => [s.url, s.o.method]), [['/funds/10/drafts/brief', 'POST'], ['/funds/10/report-periods/4/drafts/letter', 'POST']]);
    const header = (s, k) => (s.o.headers instanceof Headers ? s.o.headers.get(k) : s.o.headers?.[k]);
    assert.equal(decodeURIComponent(header(sent[0], 'X-Rail-Option')), 'draft:fund-brief');
    assert.equal(decodeURIComponent(header(sent[1], 'X-Rail-Option')), 'draft:letter-opening');
    assert.throws(() => fundDraftsApi.brief('1x'));
    assert.throws(() => fundDraftsApi.letter(10, 0));
  } finally { globalThis.fetch = previous; restore(); }
});
