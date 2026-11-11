/**
 * D4811 (#4811) part 9 — Eadwyn on the Contracts pages (board CT-07
 * "Eadwyn", CT-90): the rail starts collapsed, shows what needs a person
 * (from the counts the page read) in place of model cards and prices, and
 * leaves models, usage and top-up to Account › AI tokens. Unknown counts are
 * never a step and never 0. Made-up counts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/contracts_rail_4811.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { installAppDom, select } from './_appDom.mjs';
import { RAIL_STEPS_EMPTY, RAIL_STEPS_FOOT, RAIL_STEPS_UNREADABLE, cellHref, contractRailSteps } from '../src/pages/admin/contracts/contractRailSteps.js';

const attention = (o = {}) => ({
  awaiting: 7, executed: { total: 2, this_year: 2, this_month: 0, undated: 0 }, stalled: { count: 3, days: 30, unknown: 0 },
  legal_review: { templates: 1, governance: 1, governance_scope: 'hq' }, restricted: { templates: 0, governance: 0, governance_scope: 'hq' },
  repair: { count: 1, evidence: 1, unlinked: 0 }, ...o,
});
const ok = (a) => ({ loading: false, error: false, data: { attention: a }, retry: () => {} });

test('the steps: what needs a person, in order, each a link to its records; nothing at zero', () => {
  const s = contractRailSteps(ok(attention()));
  assert.equal(s.state, 'ready');
  assert.equal(s.title, 'For Contracts');
  assert.deepEqual(s.items.map((i) => i.key), ['stalled', 'repair', 'legal_review', 'awaiting'], 'restricted at 0 is not a step');
  assert.deepEqual(s.items.map((i) => i.tone), ['act', 'act', 'act', 'info']);
  assert.equal(s.items[0].text, '3 agreements sent over 30 days ago, not yet executed.');
  assert.equal(s.items[0].to, '/admin/contracts?tab=agreements&attention=stalled');
  assert.equal(s.items[1].text, '1 agreement needs data repair.');
  assert.equal(s.items[2].text, '2 records need legal review.', 'templates and governance records together, as the strip counts them');
  assert.equal(s.items[2].to, '/admin/contracts?tab=templates');
  assert.equal(s.items[3].to, '/admin/contracts?tab=agreements&status=awaiting_signature');
  assert.equal(s.foot, RAIL_STEPS_FOOT);
  assert.match(RAIL_STEPS_FOOT, /People approve and execute/);
  for (const i of s.items) assert.doesNotMatch(`${i.text} ${i.action}`, /\$|token|model|advi[cs]e|recommend/i, 'no price, model or advice in a step');
});

test('unknown is not zero: an unread count is not a step; all unread, or a failed read, says so; all zero is calm', () => {
  const partial = contractRailSteps(ok(attention({ stalled: null, repair: null })));
  assert.deepEqual(partial.items.map((i) => i.key), ['legal_review', 'awaiting'], 'an unknown count is left out, never drawn as 0');
  const none = contractRailSteps(ok({ awaiting: null, executed: null, stalled: null, repair: null, legal_review: null, restricted: null }));
  assert.deepEqual([none.state, none.text], ['unavailable', RAIL_STEPS_UNREADABLE]);
  const retry = () => {};
  const failed = contractRailSteps({ loading: false, error: true, data: { attention: attention() }, retry });
  assert.deepEqual([failed.state, failed.onRetry], ['unavailable', retry]);
  assert.equal(contractRailSteps({ loading: false, error: false, data: {}, retry }).state, 'unavailable', 'no attention block: unknown, not empty');
  assert.equal(contractRailSteps({ loading: true }).state, 'loading');
  assert.equal(contractRailSteps(null).state, 'loading');
  const zero = contractRailSteps(ok(attention({ awaiting: 0, stalled: { count: 0, days: 30, unknown: 0 }, repair: { count: 0, evidence: 0, unlinked: 0 },
    legal_review: { templates: 0, governance: 0, governance_scope: 'hq' } })));
  assert.deepEqual([zero.state, zero.text], ['empty', RAIL_STEPS_EMPTY]);
  assert.equal(cellHref(null), null);
  assert.equal(cellHref({ kind: 'filter', filters: { status: 'signed', signed_recent: true } }), '/admin/contracts?tab=agreements&status=signed&signed_recent=true');
});

test('the desk hands its rail the steps, a collapsed start and the usage link', () => {
  const desk = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/admin/contracts/ContractsDesk.jsx'), 'utf8'));
  assert.match(desk, /steps: contractRailSteps\(stats\), operations: true, usageAt: '\/account\/ai-tokens'/);
  assert.match(desk, /<WorkerRail \{\.\.\.railProps\} workspace="Contracts" role="super_admin"/);
  assert.match(desk, /<WorkerRail \{\.\.\.railProps\} workspace="Contracts" role="admin"/);
});

// The rate card answers with the guard's price, so a priced guard line would show it.
const RATES = { billing: 'cost', models: [{ id: '@cf/meta/llama-guard-3-8b', in_per_1m_usd: 0.48, out_per_1m_usd: 0.03 }] };
async function mountRail(props) {
  const answer = (url) => (String(url).includes('/ai/rates') ? RATES : {});
  const dom = installAppDom({ fetch: async (url) => new Response(JSON.stringify(answer(url)), { status: 200, headers: { 'content-type': 'application/json' } }), url: 'http://localhost/admin/contracts' });
  localStorage.setItem('user', JSON.stringify({ id: 9107, role: 'admin', is_super_admin: 1, name: 'HQ' }));
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { WorkerRail } = await import('../src/ui/index.js');
  const host = dom.document.createElement('div');
  dom.document.body.appendChild(host);
  const root = createRoot(host);
  const { error, warn } = console;
  console.error = () => {}; console.warn = () => {};
  try {
    await act(async () => {
      root.render(React.createElement(MemoryRouter, { initialEntries: ['/admin/contracts'] },
        React.createElement(WorkerRail, { workspace: 'Contracts', role: 'super_admin', 'data-testid': 'rail', ...props })));
    });
    for (let i = 0; i < 10; i += 1) await act(() => new Promise((r) => setImmediate(r)));
  } finally { console.error = error; console.warn = warn; }
  const one = (id) => select(host, `[data-testid="${id}"]`)[0] || null;
  // Every element whose test id starts with a prefix, walked by hand.
  const withPrefix = (prefix) => { const out = []; const walk = (n) => { if (n?.getAttribute?.('data-testid')?.startsWith(prefix)) out.push(n); (n?.childNodes || []).forEach(walk); }; walk(host); return out; };
  return { one, withPrefix, text: () => host.textContent, async close() { await act(async () => root.unmount()); dom.timers.clear(); dom.restore(); } };
}

test('the real rail: usage elsewhere draws one link, no balance, no Add tokens, no priced guard; steps replace the model cards', async () => {
  const r = await mountRail({ usageAt: '/account/ai-tokens', steps: contractRailSteps(ok(attention())) });
  try {
    const line = r.one('text-worker-rail-usage-elsewhere');
    assert.ok(line, 'the usage line');
    assert.equal(r.one('link-worker-rail-usage-elsewhere').getAttribute('href'), '/account/ai-tokens');
    assert.equal(r.one('text-worker-rail-usage-balance'), null);
    assert.equal(r.one('link-worker-rail-add-tokens'), null);
    assert.equal(r.one('button-worker-rail-add-tokens'), null);
    assert.equal(r.one('text-worker-rail-usage-unreadable'), null, 'no allowance is read into the page');
    assert.ok(r.one('worker-rail-steps'), 'the steps');
    assert.ok(r.one('worker-rail-step-stalled'));
    assert.equal(r.withPrefix('card-worker-rail-model-').length, 0, 'no model card');
    assert.doesNotMatch(r.one('text-worker-rail-safety')?.textContent || '', /\$|per 1M tokens/, 'the guard is named without its price');
  } finally { await r.close(); }
});

test('every other rail keeps its usage block', async () => {
  const r = await mountRail({});
  try {
    assert.match(r.one('text-worker-rail-safety')?.textContent || '', /per 1M tokens/, 'elsewhere the guard keeps its price (the fixture is read)');
    assert.equal(r.one('text-worker-rail-usage-elsewhere'), null);
    assert.ok(r.one('text-worker-rail-usage-unreadable') || r.one('text-worker-rail-usage-balance'), 'the allowance block is drawn as before');
    assert.ok(r.withPrefix('card-worker-rail-model-').length > 0 || r.one('text-worker-rail-model-none') || r.one('worker-rail-model-unreadable'), 'and its model block');
  } finally { await r.close(); }
});
