import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installAppDom } from './_appDom.mjs';
import { api } from '../src/lib/api.js';
import HqSupportPage from '../src/pages/hq/HqSupportPage.jsx';

// The synthetic DOM tracks focus and registered listeners. Native Tab order and
// radio keys are covered separately in tests/visual/hq_support_5035.spec.mjs.
const reactProps = node => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))[1];

function stubQueues(t) {
  const readAt = '2026-11-12T10:00:00Z';
  const open = ['First case', 'Last case'].map((subject, index) => ({
    subject, uid: `case-${index}`, branch_code: 'fr', kind: 'other', sla: 'ok', age_hours: 10 - index,
  }));
  const decisions = [];
  const empty = { count: 0, items: [] };
  const read = async () => ({
    read_at: readAt,
    escalations: { available: true, complete: true, count: open.length, bands: { ok: open.length, past: 0, due_soon: 0 }, items: [...open] },
    tickets: { available: true, complete: true, open: 0, buckets: { hq_held: empty, admin_product: empty } },
    branch_tickets: { lines: [] },
    recent_decisions: { available: true, items: [...decisions] },
  });
  t.mock.method(api, 'hqSupportLocal', read);
  t.mock.method(api, 'hqSupport', read);
  t.mock.method(api, 'escalationAnswer', async (uid, answer) => {
    const index = open.findIndex(item => item.uid === uid);
    assert.ok(index >= 0, 'only open escalations may be answered');
    const [item] = open.splice(index, 1);
    const row = { ...item, ...answer, answered_at: readAt, push_ok: 1, push_at: readAt };
    decisions.unshift(row);
    return { ...row, pushed: { ok: true, push_at: readAt } };
  });
}

test('the mounted Support sheet restores focus when its opener stays or disappears from the refreshed queue', async t => {
  const { document, restore } = installAppDom();
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  t.after(async () => { await act(async () => root.unmount()); restore(); });
  stubQueues(t);
  await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(HqSupportPage))));

  const find = id => document.querySelector(`[data-testid="hq-support-${id}"]`);
  const click = node => act(async () => reactProps(node).onClick({ currentTarget: node }));
  const focused = (node, message) => assert.ok(node && document.activeElement === node, message);
  const [first, next] = document.querySelectorAll('[data-testid="hq-support-review"]');
  first.focus();
  await click(first);
  focused(find('sheet-outcome-answered'), 'opening Review focuses the first radio');
  await act(async () => {
    for (const handleKey of document._listeners.get('keydown')) handleKey({ key: 'Escape', preventDefault() {} });
  });
  assert.equal(find('sheet'), null);
  focused(first, 'Escape returns to the row that opened the sheet');

  for (const [opener, destination] of [[first, next], [next, find('tab-queue')]]) {
    await click(opener);
    await act(async () => reactProps(find('sheet-text')).onChange({ target: { value: 'Approved.' } }));
    await act(async () => reactProps(find('sheet-form')).onSubmit({ preventDefault() {} }));
    assert.match(find('sheet-result').textContent, /Answered · Recorded at HQ/);
    assert.equal(opener.isConnected, false, 'the background re-read removed this opener');
    await click(find('sheet-done'));
    focused(destination, `expected focus on ${destination.getAttribute('aria-label') || destination.textContent}`);
  }
});
