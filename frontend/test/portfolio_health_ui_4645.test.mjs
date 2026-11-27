import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import PortfolioHealthPage from '../src/pages/PortfolioHealthPage.jsx';
import { mountContracts } from './_contracts_dom.mjs';

test('health distinguishes a zero score, a stale snapshot, an unmeasured company and a failed read', async () => {
  const originalFetch = globalThis.fetch;
  let fail = false;
  globalThis.fetch = async url => {
    if (!String(url).includes('/portfolio/health')) return Response.json({});
    if (String(url).includes('/recompute')) return Response.json({});
    if (fail) return Response.json({ detail: 'internal fixture detail' }, { status: 404 });
    return Response.json({
      items: [{ uid: 'snapshot', score: 0, badge: 'red', stale: true, age_days: 9, snapshot_date: '2026-11-01',
        project: { uid: 'old', name: 'Old snapshot company' } }],
      not_measured: [{ uid: 'new', name: 'Unmeasured company', reason: 'Not recorded — no snapshot yet' }],
      population: { projects_visible: 2, filtered: false },
      totals: { green: 0, yellow: 0, red: 1, intervention: 1 },
    });
  };
  let m;
  try {
    m = await mountContracts(React.createElement(PortfolioHealthPage, { embedded: true }), '/portfolio/health');
    assert.match(m.text(), /2 visible companies/);
    assert.match(m.text(), /Not enough evidence \(1\).*Unmeasured company.*Not recorded/);
    assert.match(m.text(), /Old snapshot company.*2026-11-01 · 9 days old · Stale.*0/);
    fail = true;
    await m.click('Recompute all');
    assert.match(m.text(), /Unreadable\. Portfolio health could not be read/);
    assert.doesNotMatch(m.text(), /No health snapshots recorded|internal fixture detail|Old snapshot company/);
  } finally {
    await m?.unmount();
    globalThis.fetch = originalFetch;
  }
});
