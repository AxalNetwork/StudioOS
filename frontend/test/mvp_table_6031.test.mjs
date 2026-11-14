/**
 * #6031 (D6031, BD8) — Prototype / MVP's summary line and phone rows.
 *
 *   1. the summary reads "N of M must-haves complete · target <date> · N blocked"
 *      from the read's facts, "Not recorded" when the date is missing, and no
 *      line at all when the read sent no counts;
 *   2. mounted: Set appears only for a writer and only without a date; it saves
 *      through `save(date)` and re-reads; a failure says so and keeps the form;
 *   3. a phone row carries the same facts as the desktop row (Due, Test, Built, Tested, State);
 *   4. the route mounts the summary and the phone rows on Prototype / MVP only, and
 *      the writer goes to the mounted `PATCH /cycles/build/project/target`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mvp_table_6031.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h, mountForm, propsOf } from './_form_d695.mjs';
import { mvpPhoneRow, mvpSummary, targetDay } from '../src/pages/cycles/mvpTable.js';
import MvpSummary from '../src/pages/cycles/MvpSummary.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('1. the summary line reads stored facts, and says Not recorded for a missing date', () => {
  // Mutation checked: the blocked figure dropped from the null check → a line of "undefined blocked";
  // the month index off by one → "18 Dec 2026"; the plural ignored → "1 of 1 must-haves".
  const s = mvpSummary({ done: 3, total: 7, blocked: 1, target_date: '2026-11-18', can_set_target: true });
  assert.deepEqual([s.complete, s.targetText, s.blockedText, s.percent], ['3 of 7 must-haves complete', 'target 18 Nov 2026', '1 blocked', 43]);
  assert.equal(mvpSummary({ done: 1, total: 1, blocked: 0, target_date: null }).complete, '1 of 1 must-have complete');
  const missing = mvpSummary({ done: 0, total: 2, blocked: 0, target_date: null, can_set_target: true });
  assert.deepEqual([missing.targetText, missing.canSet, missing.percent], ['target Not recorded', true, 0]);
  assert.equal(mvpSummary({ done: 0, total: 0, blocked: 0, target_date: 'soon' }).targetText, 'target Not recorded', 'a malformed date is not a date');
  assert.equal(mvpSummary(undefined), null, 'an unreadable module sends no facts: no line, never zeros');
  assert.equal(mvpSummary({ done: 1, total: 2 }), null, 'a read without the blocked count draws no line');
  assert.equal(targetDay('2026-13-01'), null);
});

test('2. mounted: Set for a writer without a date, saving then re-reading; a failure keeps the form', async () => {
  // Mutation checked: Set shown when a date exists → it is found on the dated line; onSaved not called → no re-read;
  // the error swallowed → no alert.
  const dated = await mountForm(h(MvpSummary, { facts: { done: 3, total: 7, blocked: 1, target_date: '2026-11-18', can_set_target: true }, save: async () => {} }));
  try {
    assert.match(dated.text(), /3 of 7 must-haves complete\s*·\s*target 18 Nov 2026\s*·\s*1 blocked/);
    assert.equal(dated.by('mvp-summary-set'), undefined, 'a recorded date offers no Set');
    const bar = dated.nodes().find((n) => propsOf(n).role === 'progressbar');
    assert.deepEqual([propsOf(bar)['aria-valuenow'], propsOf(bar)['aria-valuemax']], [3, 7]);
  } finally { await dated.unmount(); }

  const reader = await mountForm(h(MvpSummary, { facts: { done: 0, total: 2, blocked: 0, target_date: null, can_set_target: false }, save: async () => {} }));
  try {
    assert.match(reader.text(), /target Not recorded/);
    assert.equal(reader.by('mvp-summary-set'), undefined, 'a reader who may not write is not offered Set');
  } finally { await reader.unmount(); }

  const saved = []; let reread = 0; let fail = true;
  const s = await mountForm(h(MvpSummary, { facts: { done: 0, total: 2, blocked: 0, target_date: null, can_set_target: true },
    save: async (date) => { saved.push(date); if (fail) throw new Error('Synthetic save refused'); }, onSaved: () => { reread += 1; } }));
  try {
    await s.click('Set');
    const input = s.nodes().find((n) => n.tagName === 'INPUT' && propsOf(n).type === 'date');
    await s.submit();
    assert.match(s.text(), /Choose a date\./, 'an empty date is not sent');
    assert.deepEqual(saved, []);
    propsOf(input).onChange({ target: { value: '2026-12-15' } });
    await s.flush();
    await s.submit();
    await s.flush();
    assert.deepEqual(saved, ['2026-12-15']);
    assert.equal(reread, 0);
    assert.match(s.text(), /Synthetic save refused/);
    assert.ok(s.by('mvp-summary-form'), 'the form stays open after a failure');
    fail = false;
    await s.submit();
    await s.flush();
    assert.deepEqual([saved.length, reread], [2, 1]);
    assert.equal(s.by('mvp-summary-form'), undefined, 'the form closes once saved');
  } finally { await s.unmount(); }
});

test('3. a phone row carries the desktop row\'s facts', () => {
  // Mutation checked: Built left out → the card loses it; the pill on Test → "Concierge round" as the pill.
  const cols = ['must_have', 'test', 'state', 'owner', 'due', 'built', 'tested'].map((key) => ({ key, label: key }));
  const row = { id: 1, cells: { must_have: 'Synthetic setup', test: 'Synthetic concierge round', state: 'Blocked', owner: null, due: '2026-11-12',
    built: { text: 'Unavailable', tone: 'warn' }, tested: { text: 'Tested', tone: 'ok' } } };
  assert.deepEqual(mvpPhoneRow(cols, row), {
    title: 'Synthetic setup',
    description: 'Due 2026-11-12 · Test: Synthetic concierge round · Built: Unavailable · Tested: Tested',
    pill: { label: 'Blocked', tone: 'danger' },
  });
  const bare = mvpPhoneRow(cols.filter((c) => c.key !== 'built'), { id: 2, cells: { must_have: 'Synthetic other', state: 'Done', test: null, tested: null } });
  assert.deepEqual(bare, { title: 'Synthetic other', description: 'Test: Not recorded · Tested: Not recorded', pill: { label: 'Done', tone: 'ok' } });
});

test('4. the route mounts both on Prototype / MVP only, from Build\'s def; the writer is the mounted target route', async () => {
  // Mutation checked: the def's key misspelt → no summary on the module; the route ignoring `def.phoneRows` → the default row.
  const route = read('frontend/src/pages/cycles/CycleRoute.jsx');
  assert.match(route, /const above = moduleStatus === 'ready' && projectId && !narrativeAdmin \? fnOf\(def\.aboveRecords, slug\) : null;/);
  assert.match(route, /: above \? above\(module, \{ projectId, reload: \(\) => setReload\(\(n\) => n \+ 1\) \}\) : null\}/);
  assert.match(route, /const phoneRowOf = phone \? fnOf\(def\.phoneRows, slug\) : null;/);
  assert.match(route, /\.\.\.\(phoneRowOf \? \{ phoneRow: phoneRowOf \} : \{\}\)/);
  assert.doesNotMatch(route, /MvpSummary|mvpTable/, 'CycleRoute.jsx is a frozen hub (D5615): the imports live in defs/build.jsx');
  assert.match(read('frontend/src/pages/cycles/PhoneModulePage.jsx'), /const base = rowOf\(cols, r\);/);
  const { default: build } = await import('../src/pages/cycles/defs/build.jsx');
  const { fnOf } = await import('../src/pages/cycles/adapters/index.js');
  assert.equal(fnOf(build.phoneRows, 'prototype-mvp'), mvpPhoneRow);
  const el = fnOf(build.aboveRecords, 'prototype-mvp')({ facts: { done: 1, total: 2, blocked: 0, target_date: null } }, { projectId: 7, reload() {} });
  assert.equal(el.type, MvpSummary);
  assert.deepEqual(el.props.facts, { done: 1, total: 2, blocked: 0, target_date: null });
  for (const slug of ['solution-design', 'product-roadmap', 'founding-team', 'company-creation', 'operating-systems']) {
    assert.equal(fnOf(build.aboveRecords, slug), null, slug);
    assert.equal(fnOf(build.phoneRows, slug), null, slug);
  }
  assert.match(read('frontend/src/lib/api/cycleWrites.js'), /mvpTarget: \(projectId, date\) => request\(`\/cycles\/build\/project\/target\?\$\{q\(projectId\)\}`, \{ method: 'PATCH', body: JSON\.stringify\(\{ mvp_target_date: date \}\) \}\)/);
  assert.match(read('cloudflare-worker/src/routes/cycle_build.ts'), /app\.patch\('\/project\/target'/);
});
