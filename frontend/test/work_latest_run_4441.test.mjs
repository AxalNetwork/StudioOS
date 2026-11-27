// S1's #4441 follow-up: the current item run and all terminal chip labels.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { mountContracts } from './_contracts_dom.mjs';
import { ItemSheet } from '../src/pages/work/WorkPage.jsx';
import { workAdapter } from '../src/pages/work/workAdapter.js';
import { runChip } from '../src/pages/work/workModel.js';

const h = React.createElement;

test('the item sheet displays task.run and opens its latest run', async () => {
  const original = workAdapter.item;
  const opened = [];
  workAdapter.item = async () => ({ available: true, data: {
    uid: 'latest-task', title: 'Synthetic task', column: 'done',
    run: { uid: 'latest-run', status: 'completed', charged_microusd: 40000 },
  } });
  let mounted;
  try {
    mounted = await mountContracts(h(ItemSheet, { uid: 'latest-task', onClose() {}, onRun: (uid) => opened.push(uid) }));
    assert.match(mounted.text(), /Completed · charged \$0\.04/);
    await mounted.click('Completed · charged $0.04');
    assert.deepEqual(opened, ['latest-run']);
  } finally {
    if (mounted) await mounted.unmount();
    workAdapter.item = original;
  }
});

test('runChip names skipped runs without inventing a charge', () => {
  assert.deepEqual(runChip({ status: 'skipped', charged_microusd: null }), { words: 'Skipped', tone: 'skipped', cost: null });
});

test('runChip names cancelled runs and keeps their recorded charge', () => {
  assert.deepEqual(runChip({ status: 'cancelled', charged_microusd: 40000 }), { words: 'Cancelled', tone: 'cancelled', cost: '$0.04' });
});
