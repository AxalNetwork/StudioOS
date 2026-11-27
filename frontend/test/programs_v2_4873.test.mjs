/**
 * D4873 (#4873), part 1 — Programs V2's frontend-only corrections.
 *
 *   1. A single choice reads as one. The period (4, 12 or 52 weeks) and each
 *      chart's Chart or Table are a `radiogroup` of `radio`s with
 *      `aria-checked`, one tab stop on the selected option, and the arrow
 *      keys move the choice. They were toggle buttons (`aria-pressed`), which
 *      a screen reader announces as independent switches.
 *   2. No internal identifier in copy a member reads: the People tile's
 *      left-out reason named a decision code and an issue number.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/programs_v2_4873.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { ChartBlock, ChartCard, PeriodControl } from '../src/pages/admin/programs/parts.jsx';
import { PERIODS } from '../src/pages/admin/programs/catalogueModel.js';

const h = React.createElement;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');

async function mount(element) {
  const restore = installDocument('', { focus: true });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const by = (id) => nodes().find((n) => props(n)?.['data-testid'] === id);
  return {
    nodes, props, by,
    radios: () => nodes().filter((n) => props(n)?.role === 'radio'),
    groups: () => nodes().filter((n) => props(n)?.role === 'radiogroup'),
    async click(id) { await act(async () => { props(by(id)).onClick({}); }); },
    async key(id, key) { await act(async () => { props(by(id)).onKeyDown({ key, preventDefault() {} }); }); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

function Period() {
  const [weeks, setWeeks] = React.useState(12);
  return h(PeriodControl, { periods: PERIODS, weeks, onPick: setWeeks });
}

const chart = { type: 'bars', rows: [{ label: 'Lab', value: 3 }] };
const block = { key: 'waiting', state: 'ready', title: 'Waiting by program', chart, alt: 'Three waiting.' };

test('the period is a radio group: the selected period is checked, one tab stop, and the arrows move it', async () => {
  const v = await mount(h(Period));
  try {
    const [group] = v.groups();
    assert.ok(group, 'a radiogroup');
    assert.equal(v.props(group)['aria-label'], 'Period');
    assert.equal(v.props(group)['data-testid'], 'programs-period');
    const state = () => v.radios().map((n) => [textOf(n), v.props(n)['aria-checked'], v.props(n).tabIndex]);
    assert.deepEqual(state(), [[PERIODS[0].label, false, -1], [PERIODS[1].label, true, 0], [PERIODS[2].label, false, -1]]);
    assert.ok(v.radios().every((n) => !('aria-pressed' in v.props(n))), 'not toggle buttons');
    await v.click('programs-period-52');
    assert.deepEqual(v.radios().map((n) => v.props(n)['aria-checked']), [false, false, true]);
    await v.key('programs-period-52', 'ArrowRight');
    assert.deepEqual(v.radios().map((n) => v.props(n)['aria-checked']), [true, false, false], 'the arrow wraps to the first');
    assert.equal(document.activeElement, v.by('programs-period-4'), 'focus follows the choice');
    await v.key('programs-period-4', 'ArrowLeft');
    assert.deepEqual(v.radios().map((n) => v.props(n)['aria-checked']), [false, false, true]);
    await v.key('programs-period-52', 'Tab');
    assert.deepEqual(v.radios().map((n) => v.props(n)['aria-checked']), [false, false, true], 'other keys change nothing');
  } finally { await v.close(); }
});

test('a picked period is not picked again: a click on the checked option sends nothing', async () => {
  const picks = [];
  const v = await mount(h(PeriodControl, { periods: PERIODS, weeks: 12, onPick: (w) => picks.push(w) }));
  try {
    await v.click('programs-period-12');
    assert.deepEqual(picks, []);
    await v.click('programs-period-4');
    assert.deepEqual(picks, [4]);
  } finally { await v.close(); }
});

for (const [name, element, prefix, tableId] of [
  ['the catalogue chart block', h(ChartBlock, { b: block }), 'programs-chart-waiting-as-', 'programs-chart-waiting-table'],
  ['a program page chart card', h(ChartCard, { title: 'Joins', b: { state: 'ready', chart, alt: 'Joins.' }, testId: 'joins' }), 'joins-', 'joins-as-table'],
]) {
  test(`${name}: Chart or Table is a radio group and the table follows the choice`, async () => {
    const v = await mount(element);
    try {
      const [group] = v.groups();
      assert.match(v.props(group)['aria-label'], /show as$/i);
      assert.deepEqual(v.radios().map((n) => [textOf(n), v.props(n)['aria-checked']]), [['Chart', true], ['Table', false]]);
      assert.ok(!v.by(tableId), 'the chart first');
      await v.key(`${prefix}chart`, 'ArrowRight');
      assert.deepEqual(v.radios().map((n) => v.props(n)['aria-checked']), [false, true]);
      assert.ok(v.by(tableId), 'the table follows the choice');
      await v.click(`${prefix}chart`);
      assert.deepEqual(v.radios().map((n) => v.props(n)['aria-checked']), [true, false]);
      assert.ok(!v.by(tableId), 'and back to the chart');
    } finally { await v.close(); }
  });
}

test('no internal identifier in the Lab\'s left-out reason the People tile shows', () => {
  const src = readFileSync(new URL('../../cloudflare-worker/src/services/programCatalogue.ts', import.meta.url), 'utf8');
  const reason = src.match(/LAB_PEOPLE_REASON =\s*'((?:[^'\\]|\\.)*)'/)[1];
  assert.equal(reason, "The Lab is left out until a cohort\\'s founders are defined.");
  assert.doesNotMatch(reason, /#\d|\bD\d{2,}|O-FND/);
});
