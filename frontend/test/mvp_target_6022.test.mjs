/**
 * #6022 (D6022) — set, change and clear the MVP target date.
 *
 *   1. the client method: `build.mvpTarget` sends `PATCH /cycles/build/project/target?project=N`
 *      with `{ mvp_target_date }`, a date or `null`;
 *   2. mounted: a writer with a date gets Change (prefilled) and Clear; each saves, then re-reads;
 *      the Worker's refusal sentence shows as written and keeps the form; a reader gets no control;
 *   3. a link ending `#mvp-target-date` opens the form for a writer, never for a reader;
 *   4. the overview's Days to the MVP figure, when Not recorded, links a writer to the control.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mvp_target_6022.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { h, mountForm, propsOf } from './_form_d695.mjs';
import { makeCycleWrites } from '../src/lib/api/cycleWrites.js';
import MvpSummary from '../src/pages/cycles/MvpSummary.jsx';
import CycleOverview, { FigureTile } from '../src/pages/cycles/CycleOverview.jsx';
import { mvpTargetHref } from '../src/pages/cycles/mvpTable.js';

const WRITER = { done: 1, total: 3, blocked: 0, target_date: '2026-12-15', can_set_target: true };
const dateInput = (m) => m.nodes().find((n) => n.tagName === 'INPUT' && propsOf(n).type === 'date');

test('1. the client method sends the date, or null to clear, to the mounted route', async () => {
  // Mutation checked: the body key renamed → the Worker's "mvp_target_date required"; null coerced to '' → a refused clear.
  const calls = [];
  const writes = makeCycleWrites(async (path, opts) => { calls.push([path, opts.method, JSON.parse(opts.body)]); return {}; });
  await writes.build.mvpTarget(7, '2026-12-15');
  await writes.build.mvpTarget(7, null);
  assert.deepEqual(calls, [
    ['/cycles/build/project/target?project=7', 'PATCH', { mvp_target_date: '2026-12-15' }],
    ['/cycles/build/project/target?project=7', 'PATCH', { mvp_target_date: null }],
  ]);
});

test('2. Change and Clear for a writer; the refusal shows as written; a reader gets no control', async () => {
  // Mutation checked: Change offered only without a date → no Change here; the form not prefilled → '' in the input;
  // Clear sending '' → saved [..., '']; the error replaced by a fixed sentence → the Worker's sentence missing.
  const saved = []; let reread = 0; let refuse = 'Use a valid YYYY-MM-DD date';
  const m = await mountForm(h(MvpSummary, { facts: WRITER, hash: '',
    save: async (date) => { saved.push(date); if (refuse) throw new Error(refuse); }, onSaved: () => { reread += 1; } }));
  try {
    assert.match(m.text(), /target 15 Dec 2026/);
    assert.equal(m.by('mvp-summary-set'), undefined, 'a recorded date is changed, not set');
    assert.equal(m.by('mvp-summary-form'), undefined);
    await m.click('Change');
    assert.equal(propsOf(dateInput(m)).value, '2026-12-15', 'Change opens on the recorded date');
    await m.submit(); await m.flush();
    assert.deepEqual([saved, reread], [['2026-12-15'], 0]);
    assert.equal(m.nodes().find((n) => propsOf(n).role === 'alert')?.textContent, 'Use a valid YYYY-MM-DD date', 'the Worker\'s sentence, as written');
    assert.ok(m.by('mvp-summary-form'), 'a refusal keeps the form');
    refuse = 'Forbidden';
    await m.click('Clear date'); await m.flush();
    assert.deepEqual(saved, ['2026-12-15', null]);
    assert.match(m.text(), /Forbidden/);
    refuse = null;
    await m.click('Clear date'); await m.flush();
    assert.deepEqual([saved.at(-1), reread], [null, 1]);
    assert.equal(m.by('mvp-summary-form'), undefined, 'the form closes once cleared');
  } finally { await m.unmount(); }

  const unset = await mountForm(h(MvpSummary, { facts: { ...WRITER, target_date: null }, hash: '', save: async () => {} }));
  try {
    await unset.click('Set');
    assert.equal(unset.by('mvp-summary-clear'), undefined, 'nothing to clear without a date');
  } finally { await unset.unmount(); }

  const reader = await mountForm(h(MvpSummary, { facts: { ...WRITER, can_set_target: false }, hash: '', save: async () => {} }));
  try {
    assert.match(reader.text(), /target 15 Dec 2026/);
    assert.deepEqual([reader.by('mvp-summary-change'), reader.by('mvp-summary-set'), reader.by('mvp-summary-form')], [undefined, undefined, undefined]);
  } finally { await reader.unmount(); }
});

test('3. #mvp-target-date opens the form for a writer only', async () => {
  // Mutation checked: the hash ignored → no form; canSet not checked → a reader is handed the form;
  // the opened form not prefilled → '' for a recorded date.
  const writer = await mountForm(h(MvpSummary, { facts: { ...WRITER, target_date: null }, hash: '#mvp-target-date', save: async () => {} }));
  try {
    assert.ok(writer.by('mvp-summary-form'));
    assert.equal(propsOf(dateInput(writer)).id, 'mvp-target-date');
  } finally { await writer.unmount(); }
  const dated = await mountForm(h(MvpSummary, { facts: WRITER, hash: '#mvp-target-date', save: async () => {} }));
  try { assert.equal(propsOf(dateInput(dated)).value, '2026-12-15', 'Change from a link opens on the recorded date'); } finally { await dated.unmount(); }
  const reader = await mountForm(h(MvpSummary, { facts: { ...WRITER, target_date: null, can_set_target: false }, hash: '#mvp-target-date', save: async () => {} }));
  try { assert.equal(reader.by('mvp-summary-form'), undefined); } finally { await reader.unmount(); }
});

test('4. the overview\'s Days to the MVP figure links a writer to the control when Not recorded', () => {
  // Mutation checked: the link kept for a recorded figure → found beside "12"; kept for an unreadable one → found;
  // read_only ignored → a reader gets it.
  const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
  const fig = (value, state) => ({ key: 'days_to_mvp', label: 'Days to the MVP date', value, unit: 'days', state, source: 'projects.mvp_target_date' });
  const link = 'href="/build/prototype-mvp?project=7#mvp-target-date"';
  assert.equal(mvpTargetHref('?project=7'), '/build/prototype-mvp?project=7#mvp-target-date');
  assert.equal(mvpTargetHref('not a query'), '/build/prototype-mvp#mvp-target-date');
  const setLink = { href: mvpTargetHref('?project=7'), text: 'Set the MVP target date' };
  assert.ok(html(h(FigureTile, { fig: fig(null, 'not_recorded'), setLink })).includes(link));
  assert.ok(!html(h(FigureTile, { fig: fig(12, 'ok'), setLink })).includes('mvp-target-date'));
  assert.ok(!html(h(FigureTile, { fig: fig(null, 'unreadable'), setLink })).includes('mvp-target-date'));
  const overview = (extra) => html(h(CycleOverview, { cycle: 'build', search: '?project=7', status: 'ready',
    data: { cards: [], figures: [fig(null, 'not_recorded')], ...extra } }));
  assert.ok(overview({}).includes(link), 'a writer\'s overview links the figure');
  assert.match(overview({}), /Set the MVP target date ›/);
  assert.ok(!overview({ read_only: true }).includes('mvp-target-date'), 'a reader is not sent to a control they do not have');
});
