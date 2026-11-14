import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import AnalyticsZone from '../src/pages/partner/pipeline/AnalyticsZone.jsx';

test('PP07 keeps the selected period when an older response arrives', async () => {
  const restore = installDocument();
  const host = document.createElement('div');
  const root = createRoot(host);
  const original = api.quotesAnalytics;
  const pending = new Map();
  api.quotesAnalytics = (period) => new Promise((resolve) => pending.set(period, resolve));
  const words = (n) => n.nodeType === 3 ? n.textContent : n.childNodes.map(words).join(' ') || n.textContent;
  const walk = (n) => [n, ...n.childNodes.flatMap(walk)];
  const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const button = (title) => walk(host).find((n) => n.tagName === 'BUTTON' && words(n).trim() === title);
  const answer = (accepted, rejected, unstated) => ({
    rows_read: accepted + rejected,
    pipeline: { accepted, rejected, quote_count: accepted + rejected, win_rate_pct: 100 * accepted / (accepted + rejected), median_cycle_days: 8 },
    forecast: { by_stage: [] },
    by_quarter: [{ quarter: '2026-Q3', accepted, decided: accepted + rejected, win_rate_pct: 100 * accepted / (accepted + rejected) }],
    loss_reasons: [{ reason: 'other', count: rejected - unstated }],
    lost_count: rejected, on_price_losses: 0, losses_unstated: unstated,
  });
  try {
    await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(AnalyticsZone))));
    await act(async () => props(button('All time')).onClick());
    assert.equal(props(button('All time'))['aria-pressed'], true);
    await act(async () => pending.get('all')(answer(1, 3, 2)));
    await act(async () => pending.get('quarter')(answer(8, 2, 0)));
    assert.match(words(host), /1 of 4 decided/);
    assert.doesNotMatch(words(host), /8 of 10 decided/);
    assert.match(words(host), /Other\s+1\s+Not recorded\s+2/);
    assert.match(words(host), /View win rate table/);
    await act(async () => props(button('Cycle time')).onClick());
    assert.match(words(host), /Quarterly cycle times are unavailable/);
  } finally {
    await act(async () => root.unmount());
    api.quotesAnalytics = original;
    restore();
  }
});
