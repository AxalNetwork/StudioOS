/** #4862: one Grow taxonomy and state-driven actions without turning unreadable sources into empty setup. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import GrowOverview from '../src/pages/cycles/GrowOverview.jsx';
import { growTabs, growPrimary, reportingHref, focusValue } from '../src/pages/cycles/growOverviewModel.js';

const missing = { state: 'not_recorded', value: null };
const unreadable = { state: 'unreadable', value: null };
const recorded = (value) => ({ state: 'recorded', value });
const action = { key: 'set_focus', label: 'Set focus metric', why: 'No focus recorded.', href: '/grow/focus?project_id=7', area: 'Focus' };
const sparse = { state: 'ready', writable: true, period: '2026-11', focus: missing, measurement: missing, primary: action, items: [action], signals: { targets: recorded(0), kpis: recorded(0), channels: recorded(0), customers: recorded(0) } };
const active = { ...sparse, focus: recorded({ metric_key: 'mrr', target_value: 100, direction: 'up', updated_at: '2026-11-01' }), measurement: recorded({ value: 0, as_of: '2026-11-12', source: 'manual' }), primary: { ...action, key: 'review_growth', label: 'Review growth' }, items: [] };
const render = (attention = sparse, options = {}) => renderToStaticMarkup(h(MemoryRouter, {}, h(GrowOverview, {
  raw: { attention }, data: { figures: [], cards: [] }, status: 'ready', search: '?project_id=7', action: { href: '/grow/update?project_id=7' }, onRetry() {}, ...options,
})));

test('GR-04 labels use existing routes and preserve both canonical and legacy venture context', () => {
  const expected = ['Overview', 'Focus', 'Customers', 'Distribution', 'Talent', 'Partnerships', 'Markets', 'Company'];
  for (const search of ['?project_id=7', '?project=7']) {
    const tabs = growTabs(search, 'revenue-and-traction');
    assert.deepEqual(tabs.map((t) => t.name), expected);
    assert.equal(tabs.find((t) => t.active).name, 'Focus');
    assert.ok(tabs.every((t) => t.href.endsWith('?project_id=7')));
    assert.equal(tabs.find((t) => t.name === 'Company').href, '/grow/durable-company-building?project_id=7');
    assert.equal(reportingHref(search), '/grow/reporting?project_id=7');
    assert.equal(tabs.some((t) => t.name === 'Reporting'), false);
  }
  assert.ok(growTabs('?project_id=invalid').every((t) => !t.href.includes('?')));
});

test('primary action follows the current read and is suppressed while loading, refused, unreadable or read-only', () => {
  assert.equal(growPrimary(sparse, 'ready').key, 'set_focus');
  assert.equal(growPrimary(active, 'ready').key, 'review_growth');
  for (const status of ['loading', 'refused', 'unreadable']) assert.equal(growPrimary(sparse, status), null);
  assert.equal(growPrimary(sparse, 'ready', true), null);
  assert.equal(growPrimary({ ...sparse, writable: false }, 'ready'), null);
  assert.equal(growPrimary({ ...sparse, primary: { href: 'https://untrusted.example' } }, 'ready'), null);
});

test('sparse overview leads with focus and attention, keeps Share available and places Reporting in utilities', () => {
  const html = render();
  assert.match(html, /No primary growth metric selected/);
  assert.match(html, /Needs your attention/);
  assert.match(html, /Growth setup/);
  assert.match(html, /Share an update/);
  assert.match(html, /aria-label="Reporting utility"/);
  assert.match(html, /data-testid="cycle-action"[^>]*href="\/grow\/focus\?project_id=7"/);
  assert.doesNotMatch(html, /data-testid="cycle-action"[^>]*>Share an update/);
});

test('a recorded zero is shown as evidence; target comparisons do not invent on-track pacing', () => {
  const html = render(active);
  assert.match(html, /\$0/);
  assert.match(html, /Below target/);
  assert.match(html, /Source: manual/);
  assert.match(html, /2026-11-12/);
  assert.match(html, />Review growth<\/a>/);
  assert.doesNotMatch(html, /No primary growth metric selected|On track/);
  assert.equal(focusValue(0, 'paying_accounts'), '0');
  assert.equal(focusValue(0, 'mrr'), '$0');
});

test('unknown focus and failed overview never pretend that setup is empty', () => {
  const partial = render({ ...sparse, state: 'unreadable', focus: unreadable, primary: null, items: [], signals: {} });
  assert.match(partial, /Focus could not be read/);
  assert.match(partial, /Setup could not be read/);
  assert.doesNotMatch(partial, /No primary growth metric selected|0 recorded/);
  for (const status of ['loading', 'unreadable', 'refused']) {
    const html = render(sparse, { status });
    assert.doesNotMatch(html, /No primary growth metric selected|data-testid="grow-attention-set_focus"|data-testid="cycle-action"/);
  }
});

test('read-only viewers can inspect evidence and navigation without operating or sharing actions', () => {
  const html = render(active, { readOnly: true });
  assert.match(html, /Read only/);
  assert.match(html, /\$0/);
  assert.doesNotMatch(html, /Share an update|data-testid="cycle-action"|data-testid="grow-attention-set_focus"/);
});
