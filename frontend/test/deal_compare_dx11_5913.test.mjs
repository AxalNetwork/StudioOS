import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { CompareView } from '../src/pages/investor/dealflow/Compare.jsx';
import { compareTraction } from '../src/pages/investor/dealflow/compareModel.js';

const history = {
  masked: false,
  history: { state: 'recorded', data: [
    { month: '2026-10', state: 'reported', figures: [{ key: 'mrr', value: 2000, unit: 'usd' }] },
    { month: '2026-11', state: 'reported', figures: [{ key: 'customers', value: 0, unit: 'count' }] },
  ] },
};

test('Compare shows the six sections and preserves reporting gaps and access', () => {
  const h = React.createElement;
  const venture = { name: 'One', id: '1', scores: { state: 'locked' }, traction: history };
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(CompareView, {
    ventures: [venture, { ...venture, id: '2', name: 'Two', traction: { masked: true, history: history.history } }],
  })));
  assert.match(html, /Investment case.*Scorecard.*Fit to thesis.*Traction.*Risk.*Decision notes/s);
  assert.match(html, /<thead class="sticky top-0/);
  assert.match(html, /Nov 2026/);
  assert.match(html, /Not reported/);
  assert.match(html, /Material risks.*Not recorded/);
  assert.doesNotMatch(html, /\$2,000/);
  assert.match(html, /compare-summary/);
  assert.deepEqual(compareTraction({ ...history, masked: true }).figures, {});
  assert.deepEqual(compareTraction('failed'), { state: 'unreadable', figures: {} });
  assert.equal(compareTraction(history).figures.customers, '0');
});
