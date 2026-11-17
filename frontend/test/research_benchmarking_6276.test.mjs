import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { api } from '../src/lib/api.js';
import BenchmarkingZone from '../src/pages/research/BenchmarkingZone.jsx';
import { benchmarkingExportView } from '../src/workspaces/ResearchWorkspace.jsx';
import { zoneActionsFor } from '../src/workspaces/zoneActionsByRole.js';
import { zoneFiltersFor } from '../src/workspaces/zoneFiltersByRole.js';
import { mountContracts } from './_contracts_dom.mjs';

const role = 'investor';
async function mount(load) {
  const previous = api.research.benchmarks;
  api.research.benchmarks = load;
  const ui = await mountContracts(React.createElement(BenchmarkingZone, {
    role,
    zoneActions: (rows, handlers) => zoneActionsFor(role, 'research/benchmarking', { handlers, view: benchmarkingExportView(rows) }),
    zoneFilters: (opts) => zoneFiltersFor(role, 'research/benchmarking', opts),
  }), '/research/benchmarking');
  await ui.flush();
  return { ...ui, close: async () => { await ui.unmount(); api.research.benchmarks = previous; } };
}

test('D6276: New benchmark focuses the metric and Export writes the sorted, narrowed rows', async () => {
  const items = [
    { uid: 'x', metric: 'TVPI', our_value: '1.2x', peer_value: '1.0x', peer_source: 'Published survey', peer_sample_size: 8, peer_as_of: '2026 Q2', is_comparison: true, reading: null },
    { uid: 'y', metric: 'Leverage', reading: 'Already recorded' },
    { uid: 'z', metric: 'DPI', our_value: '=A1', reading: '' },
  ];
  const ui = await mount(async () => ({ items, metric_count: 3, comparison_count: 1, unread_count: 2, smallest_sample_size: 8 }));
  const previousUrl = URL.createObjectURL;
  const previousCreate = document.createElement;
  let blob;
  let filename;
  try {
    const input = ui.nodes().find((node) => node.tagName === 'INPUT' && ui.props(node)?.maxLength === 200);
    const form = ui.nodes().find((node) => ui.props(node)?.['data-testid'] === 'benchmark-add-form');
    assert.equal(ui.props(form).hidden, true);
    input.focus = () => { document.activeElement = input; };
    await ui.click('New benchmark');
    assert.equal(ui.props(form).hidden, false);
    assert.equal(document.activeElement, input);
    assert.match(ui.text(), /Metrics3With a peer set1No read yet2Smallest sample8/);
    await ui.click('No read yet');
    await ui.fill('Sort by', 'metric');
    assert.doesNotMatch(ui.text(), /Already recorded/);
    assert.ok(ui.text().indexOf('DPI') < ui.text().indexOf('TVPI'));
    URL.createObjectURL = (value) => { blob = value; return previousUrl.call(URL, value); };
    document.createElement = function (tag) {
      const node = previousCreate.call(this, tag);
      if (tag === 'a') {
        node.click = () => { filename = node.download; };
        node.remove = () => node.parentNode.removeChild(node);
      }
      return node;
    };
    await ui.click('Export · this view');
    assert.match(filename, /^benchmarking-2-rows-/);
    assert.equal(await blob.text(), "Metric,Ours,Peer,Peer source,Sample size,As of,Read\r\nDPI,'=A1,,,,,\r\nTVPI,1.2x,1.0x,Published survey,8,2026 Q2,");
  } finally {
    URL.createObjectURL = previousUrl;
    document.createElement = previousCreate;
    await ui.close();
  }
});

test('D6276: tiles distinguish missing and failed reads from recorded zero', async () => {
  const zero = await mount(async () => ({ items: [], metric_count: 0, comparison_count: null, unread_count: 0 }));
  try { assert.match(zero.text(), /Metrics0With a peer setNot recordedNo read yet0Smallest sampleNot recorded/); }
  finally { await zero.close(); }
  const failed = await mount(async () => { throw new Error('Read failed'); });
  try { assert.match(failed.text(), /MetricsNot recordedWith a peer setNot recordedNo read yetNot recordedSmallest sampleNot recorded/); }
  finally { await failed.close(); }
});
