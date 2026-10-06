import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import FounderBuildDesk from '../src/pages/founder/FounderBuildDesk.jsx';
import { TASK_STATUS, TaskRow } from '../src/pages/founder/FounderBuildBoard.jsx';
import { focusHeadline } from '../src/pages/founder/FounderGrowDesk.jsx';
const { FocusChoice } = await import('../src/pages/founder/FounderGrowFocus.jsx');

const html = (element, state) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [{ pathname: '/build', state }] }, element));

test('D548: review cards count in the desk and retain the board card anatomy', () => {
  const row = { id: 1, title: 'Synthetic review', status: 'review', assigned_to: null, created_at: '2026-10-01' };
  const seed = { projects: [{ id: 1, name: 'Synthetic startup' }], projectId: 1, cards: [row], deals: [{ id: 1, task_counts: { review: 1 } }], cadence: null };
  const desk = html(h(FounderBuildDesk), { founderBuildSeed: seed });
  assert.match(desk, /<span>Review<\/span><strong>1<\/strong>/);
  assert.doesNotMatch(desk, /No review state is recorded/);
  assert.deepEqual(TASK_STATUS.find(([value]) => value === 'review'), ['review', 'Review']);
  const board = html(h('table', null, h('tbody', null, h(TaskRow, { task: row }))));
  assert.match(board, /Synthetic review[\s\S]*status-review[\s\S]*Review[\s\S]*Unassigned/);
});

test('D548: the headline uses the explicit focus rather than the first target', () => {
  const targets = [{ metric_key: 'mrr', target_value: 100, actual: 10, is_focus: null }, { metric_key: 'active_users', target_value: 25, actual: 14, is_focus: true }];
  assert.equal(focusHeadline(targets, {}), '14 of 25 · Active users');
  assert.equal(focusHeadline([targets[0]], {}), 'No focus metric chosen');
  assert.match(focusHeadline(null, {}), /^Unreadable/);
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
