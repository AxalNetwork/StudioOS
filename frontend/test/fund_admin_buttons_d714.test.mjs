// D714 (#1779) — the fund controls follow the Worker's act table.
//
// A plain Admin reads one sentence where Capital call, Distribute and the call
// composer's Issue were; the Super Admin keeps the buttons; a GP of record who
// is not an admin, and an admin on a branch, keep them and make no read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import { FundActControl, fundActRefusal, readsFundActs, useFundActsFor } from '../src/lib/fundActs.js';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

const ACTS = (superAdmin) => ({
  super_admin: superAdmin,
  acts: [
    { act: 'capital_call.preview', tier: 'admin', sentence: null, allowed: true },
    { act: 'capital_call.issue', tier: 'super_admin', sentence: 'A Super Admin issues capital calls.', allowed: superAdmin },
    { act: 'distribution.execute', tier: 'super_admin', sentence: 'A Super Admin executes distributions.', allowed: superAdmin },
  ],
});
const PLAIN = ACTS(false);
const SUPER = ACTS(true);

const control = (access, act, label) => renderToStaticMarkup(
  React.createElement(FundActControl, { access, act, testId: `text-${act}`, className: 'note' },
    React.createElement('button', { type: 'button' }, label)),
);

test('a plain Admin reads the sentence in place of Capital call, Distribute and Issue; the Super Admin keeps the buttons', () => {
  for (const [act, label, sentence] of [
    ['capital_call.issue', 'Capital call', 'A Super Admin issues capital calls.'],
    ['distribution.execute', 'Distribute', 'A Super Admin executes distributions.'],
    ['capital_call.issue', 'Issue call 3 to 2 LPs', 'A Super Admin issues capital calls.'],
  ]) {
    const plain = control(PLAIN, act, label);
    assert.ok(plain.includes(sentence), plain);
    assert.ok(!plain.includes('<button'), `${label}: a plain Admin still sees a button`);
    assert.ok(!/disabled/.test(plain), 'never a disabled button that looks broken');
    const sup = control(SUPER, act, label);
    assert.ok(sup.includes(`>${label}</button>`), sup);
    assert.ok(!sup.includes(sentence));
  }
  // An Admin act stays a button for the plain Admin.
  assert.ok(control(PLAIN, 'capital_call.preview', 'Preview split').includes('<button'));
});

test('no read, or a failed one, keeps every button: the Worker still decides', () => {
  for (const access of [null, undefined, {}, { acts: 'garbled' }]) {
    assert.equal(fundActRefusal(access, 'capital_call.issue'), null);
    assert.ok(control(access, 'capital_call.issue', 'Capital call').includes('<button'));
  }
});

test('only an admin on HQ reads the table: not a GP of record, not a branch admin', () => {
  assert.equal(readsFundActs({ role: 'admin', branch: null }), true);
  assert.equal(readsFundActs({ role: 'admin', is_super_admin: 1 }), true);
  assert.equal(readsFundActs({ role: 'investor', investor_tier: 'institutional' }), false);
  assert.equal(readsFundActs({ role: 'admin', branch: { code: 'fr', name: 'Axal France' } }), false);
  assert.equal(readsFundActs(null), false);
});

async function mountHook(user, answer) {
  const restore = installDocument();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (answer instanceof Error) return new Response(JSON.stringify({ detail: 'down' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  let seen = 'unset';
  function Probe() { seen = useFundActsFor(user); return null; }
  const node = document.createElement('div');
  const root = createRoot(node);
  try {
    await act(async () => { root.render(React.createElement(Probe)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await act(async () => { root.unmount(); });
  } finally {
    globalThis.fetch = realFetch;
    restore();
  }
  return { calls: calls.filter((u) => u.includes('/fund-admin/access')), seen };
}

test('a GP of record and a branch admin make no access read; an HQ admin makes one; a failed read leaves null', async () => {
  const gp = await mountHook({ role: 'investor', investor_tier: 'institutional' }, PLAIN);
  assert.deepEqual(gp.calls, []);
  assert.equal(gp.seen, null);
  const branch = await mountHook({ role: 'admin', branch: { code: 'fr' } }, PLAIN);
  assert.deepEqual(branch.calls, []);
  const hq = await mountHook({ role: 'admin' }, PLAIN);
  assert.equal(hq.calls.length, 1);
  assert.deepEqual(hq.seen, PLAIN);
  const failed = await mountHook({ role: 'admin' }, new Error('down'));
  assert.equal(failed.calls.length, 1);
  assert.equal(failed.seen, null);
});

test('the pages draw Capital call, Distribute and Issue through FundActControl with their acts', () => {
  const fundsPage = src('pages/FundsPage.jsx');
  assert.match(fundsPage, /<FundActControl access=\{acts\} act="capital_call\.issue"[^>]*>\s*<button onClick=\{\(\) => setShowCC\(active\)\}/);
  assert.match(fundsPage, /<FundActControl access=\{acts\} act="distribution\.execute"[^>]*>\s*<button onClick=\{\(\) => setShowDist\(active\)\}/);
  assert.equal(fundsPage.split('setShowCC(active)').length, 2, 'a second, ungated Capital call button');
  const calls = src('pages/investor/InvestorFundCalls.jsx');
  assert.match(calls, /<FundActControl access=\{acts\} act="capital_call\.issue"[^>]*>\s*<button type="button" className="if2-issue" data-testid="button-issue-call"/);
  assert.equal(calls.split('data-testid="button-issue-call"').length, 2);
  // Save draft and Preview stay.
  assert.ok(calls.includes('data-testid="button-preview-call"'));
});

test('fundAdminApi and fundFeesApi are re-exported by one line each, in the block\'s order (D527)', () => {
  const api = src('lib/api.js');
  assert.ok(api.includes("export * from './api/eadwyn.js';\nexport * from './api/fundAdmin.js';\nexport * from './api/fundFees.js';\nexport * from './api/fundLedger.js';"));
  assert.ok(src('lib/api/fundAdmin.js').includes("request('/fund-admin/access')"));
  assert.ok(src('lib/api/fundAdmin.js').includes('request(`/funds/${fundId}/distributions/preview`'));
  assert.ok(src('lib/api/fundFees.js').includes("export const fundFeesApi = {"));
});
