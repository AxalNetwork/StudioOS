/** #6102: a Focus cell keeps its own link while the row still opens its recorded KPI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mountContracts } from './_contracts_dom.mjs';
import { Cell, RecordsTable } from '../src/pages/cycles/CycleModulePage.jsx';
import { phoneRow } from '../src/pages/cycles/PhoneModulePage.jsx';
import { kpiTargetCells } from '../src/pages/cycles/kpiTargetCells.js';

test('a marked target link remains separate from the row overlay; ordinary secondary links stay suppressed', async () => {
  const target = kpiTargetCells({ target_state: 'not_set', target_href: '/grow/focus?project_id=7' }).target;
  const view = await mountContracts(React.createElement(RecordsTable, { title: 'KPIs', records: { total: 1, rows: [{ id: 'mrr', cells: { kpi: 'MRR', target, ordinary: { text: 'Ordinary cell', href: '/not-a-second-door' } } }],
    cols: [{ key: 'kpi', label: 'KPI' }, { key: 'target', label: 'Target' }, { key: 'ordinary', label: 'Other' }] }, rowHref: () => '/grow/revenue-and-traction/mrr?project_id=7' }));
  try {
    const hrefs = view.nodes().map((node) => view.props(node)?.href).filter(Boolean);
    assert.ok(hrefs.includes('/grow/focus?project_id=7'));
    assert.ok(hrefs.includes('/grow/revenue-and-traction/mrr?project_id=7'));
    assert.equal(hrefs.includes('/not-a-second-door'), false);
  } finally { await view.unmount(); }
});

test('a missing target or actual is visibly blank in Vs target while other missing cells stay Not recorded', () => {
  const missing = kpiTargetCells({ target_state: 'not_set' }).vs_target;
  assert.equal(renderToStaticMarkup(React.createElement(Cell, { cell: missing })), '');
  assert.match(renderToStaticMarkup(React.createElement(Cell, { cell: null })), /Not recorded/);
});


test('phone KPI rows show actual, target and comparison together without inventing missing comparisons', () => {
  const cols = [{ key: 'kpi' }, { key: 'value' }];
  const row = (value, text, vs_target) => phoneRow(cols, { cells: { kpi: 'MRR', value, target: { text, separateLink: true }, vs_target } });
  assert.equal(row('$80.00', '$100.00', 'Below target').description, '$80.00 · Target: $100.00 · Below target');
  assert.equal(row(0, '0', 'Target met').description, '0 · Target: 0 · Target met');
  assert.equal(row(null, '$200.00', { blank: true }).description, 'Not recorded · Target: $200.00');
  assert.equal(phoneRow(cols, { cells: { kpi: 'Other', value: 12 } }).description, '12');
});
