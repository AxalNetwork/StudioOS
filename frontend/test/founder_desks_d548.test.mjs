import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { TASK_STATUS, TaskRow } from '../src/pages/founder/FounderBuildBoard.jsx';
const { FocusChoice } = await import('../src/pages/founder/FounderGrowFocus.jsx');

const html = (element, state) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [{ pathname: '/build', state }] }, element));

// The Build desk's review count and the Grow desk's focus headline went with
// the desks (D661, #1474); the board card and the focus panel they summarised
// are the live pages, and keep their checks.
test('D548: a review card keeps the board card anatomy', () => {
  const row = { id: 1, title: 'Synthetic review', status: 'review', assigned_to: null, created_at: '2026-10-01' };
  assert.deepEqual(TASK_STATUS.find(([value]) => value === 'review'), ['review', 'Review']);
  const board = html(h('table', null, h('tbody', null, h(TaskRow, { task: row }))));
  assert.match(board, /Synthetic review[\s\S]*status-review[\s\S]*Review[\s\S]*Unassigned/);
});

test('D548: the existing focus panel distinguishes unset, selected and unreadable with real controls', () => {
  const props = { project: { id: 1 }, onSaved() {}, onChooseTarget() {} };
  const empty = html(h(FocusChoice, { ...props, targets: [] }));
  assert.match(empty, /No focus metric chosen[\s\S]*Choose a target/);
  const unset = html(h(FocusChoice, { ...props, targets: [{ metric_key: 'mrr', is_focus: null }] }));
  assert.match(unset, /aria-label="Focus metric"[\s\S]*Set focus/);
  const selected = html(h(FocusChoice, { ...props, targets: [{ metric_key: 'active_users', actual: 14, target_value: 25, is_focus: true }] }));
  assert.match(selected, /14 of 25 · Active users[\s\S]*Clear focus/);
  assert.doesNotMatch(selected, /No focus metric chosen/);
  assert.match(html(h(FocusChoice, { ...props, targets: null })), /Unreadable[\s\S]*Retry/);
});
