/** D6095 — Reporting history filters the loaded rows by stored kind, year and title. */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import UpdatesHistory from '../src/pages/cycles/UpdatesHistory.jsx';
import { mountContracts } from './_contracts_dom.mjs';

test('the filters combine and distinguish no match from no history', async () => {
  const updates = [
    { uid: 'r1', kind: 'report', title: 'Quarterly revenue', sent_at: '2026-08-01' },
    { uid: 'u1', kind: 'update', title: 'Revenue note', submitted_at: '2025-08-01' },
    { uid: 'r2', kind: 'report', title: 'Quarterly accounts', sent_at: '2025-10-01' },
    ...Array.from({ length: 97 }, (_, i) => ({ uid: 'prior-' + i, kind: 'update', title: 'Prior update', sent_at: '2024-10-01' })),
  ];
  const view = await mountContracts(React.createElement(UpdatesHistory, { updates, filterable: true }));
  const select = (key, value) => {
    const node = view.nodes().find((node) => node.tagName === 'SELECT' && view.props(node).id.endsWith(`-${key}`));
    return act(async () => view.props(node).onChange({ target: { value } }));
  };
  try {
    assert.match(view.text(), /Showing 100 of 100 most recent entries/);
    await select('kind', 'report');
    assert.match(view.text(), /Showing 2 of 100/);
    await select('year', '2025');
    assert.match(view.text(), /Showing 1 of 100.*Quarterly accounts/);
    await view.fill('Search by title', ' REVENUE ');
    assert.match(view.text(), /Showing 0 of 100.*No reports or updates match these filters/);
    assert.doesNotMatch(view.text(), /shared yet/);
    await select('kind', 'update');
    assert.match(view.text(), /Showing 1 of 100.*Revenue note/);
  } finally {
    await view.unmount();
  }
});
