/**
 * D6219 — Exit Waterfall through the real frontend API client with HTTP fixtures.
 * D6221 (#6221) rebuilt the page in the Portfolio frame; these keep D6219's
 * picker, confirmation and retry rules in the new page's words.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import WaterfallPage from '../src/pages/WaterfallPage.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const json = (body, status = 200) => Response.json(body, { status });
const fund = { id: 42, name: 'Cedar Fund', can_manage: true, relationship: 'gp', carried_interest: 0.2 };
const simulation = { exit_value: 100_000_000, totals: { to_lps: 80_000_000, to_gp: 20_000_000, total_invested: 10_000_000 }, tranches: [] };
const scenarios = [{ uid: 'base', name: 'Base case', inputs: { exit_value: 100_000_000 }, result: simulation }];

async function withView(fetchFixture, exercise) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url);
    const method = options.method || 'GET';
    calls.push([method, path]);
    if (!path.startsWith('/api/funds') && !path.startsWith('/api/fund-sim/')) return Response.json({});
    return fetchFixture(path, method);
  };
  let view;
  try {
    view = await mountContracts(React.createElement(WaterfallPage), '/portfolio/waterfall');
    await exercise(view, calls);
  } finally {
    await view?.unmount();
    globalThis.fetch = originalFetch;
  }
}

test('fund list selects the existing ID, computes, and confirms before deleting a scenario', async () => {
  let deleted = false;
  await withView(async (path, method) => {
    if (path === '/api/funds') return json({ items: [fund] });
    if (path === '/api/fund-sim/funds/42/waterfall/simulate') return json(simulation);
    if (path === '/api/fund-sim/funds/42/scenarios?kind=waterfall') return json({ items: deleted ? [] : scenarios });
    if (path === '/api/fund-sim/scenarios/base' && method === 'DELETE') { deleted = true; return new Response(null, { status: 204 }); }
    assert.fail(path);
  }, async (view, calls) => {
    assert.match(view.text(), /Cedar Fund.*Base case/);
    assert.match(view.text(), /Save scenario/);
    const deleteButton = view.nodes().find((node) => view.props(node)?.['aria-label'] === 'Delete Base case');
    await act(async () => view.props(deleteButton).onClick());
    assert.match(view.text(), /Delete saved scenario\?/);
    assert.ok(!calls.some(([method]) => method === 'DELETE'));
    await view.click('Cancel');
    assert.ok(!calls.some(([method]) => method === 'DELETE'));
    await act(async () => view.props(deleteButton).onClick());
    await view.click('Delete scenario');
    assert.deepEqual(calls.filter(([method]) => method === 'DELETE'), [['DELETE', '/api/fund-sim/scenarios/base']]);
    assert.match(view.text(), /No scenarios saved for this fund/);
  });
});

test('a successful empty list says no fund is visible', async () => {
  await withView(async () => json({ items: [] }), (view, calls) => {
    assert.match(view.text(), /No fund is visible to you yet/);
    assert.deepEqual(calls.filter(([, path]) => path.startsWith('/api/fund')), [['GET', '/api/funds']]);
  });
});

test('failed fund and scenario reads can be retried, and a non-manager cannot save', async () => {
  let fundReads = 0;
  let scenarioReads = 0;
  await withView(async (path) => {
    if (path === '/api/funds') return ++fundReads === 1
      ? json({ detail: 'database detail' }, 503) : json({ items: [{ ...fund, can_manage: false }] });
    if (path.endsWith('/waterfall/simulate')) return json(simulation);
    if (path.endsWith('/scenarios?kind=waterfall')) return ++scenarioReads === 1
      ? json({ detail: 'database detail' }, 503) : json({ items: [] });
    assert.fail(path);
  }, async (view) => {
    assert.match(view.text(), /Your funds could not be read/);
    assert.doesNotMatch(view.text(), /No fund is visible|database detail/);
    await view.click('Retry');
    assert.match(view.text(), /Modelled split/);
    assert.match(view.text(), /Scenarios could not be read/);
    assert.match(view.text(), /only the fund’s GP of record or an admin can save scenarios/);
    assert.doesNotMatch(view.text(), /Save scenario|No scenarios saved|database detail/);
    await view.click('Retry');
    assert.match(view.text(), /No scenarios saved for this fund/);
  });
});
