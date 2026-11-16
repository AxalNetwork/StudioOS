import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS } from '../src/pages/cycles/adapters/validate.js';

const demandSignals = CARDS['demand-signals'];

test('demand summary shows observed counts even when there is too little data to chart', () => {
  const specs = demandSignals({
    chart_ready: false,
    signups: [{ week_start: '2026-11-02', total: 1 }],
    signals: { loi: 1, would_pay: 2 },
  });
  assert.equal(specs.some(spec => spec.kind === 'line'), false);
  assert.deepEqual(specs.filter(spec => spec.showWhenSparse), [{
    kind: 'rows',
    showWhenSparse: true,
    items: [
      { label: 'Letter of intent', value: '1' },
      { label: 'Pre-sale', value: '0' },
      { label: 'Waitlist', value: '0' },
      { label: 'Need-to-have', value: '0' },
      { label: 'Would pay', value: '2' },
    ],
  }]);
  assert.deepEqual(demandSignals(null), []);
});

test('demand summary retains committed currency and period on each row', () => {
  const specs = demandSignals({
    committed: [
      { currency: 'EUR', period: 'month', amount_cents: 12500 },
      { currency: 'USD', period: 'once', amount_cents: 25000 },
    ],
  });
  assert.deepEqual(specs[0].items.map(item => item.label), ['Committed · EUR', 'Committed · USD']);
  assert.match(specs[0].items[0].value, /125.*(?:month|mo\b)/i);
  assert.match(specs[0].items[1].value, /250.*once/i);
});
