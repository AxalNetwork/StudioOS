// #4697 — a bucket board's sources publish one by one: a slow Proof read no
// longer holds Profile and Services, one failure greys only its own section
// and retries on its own, and an answer from an earlier board never lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import useBucketSources, { SOURCE_UNREADABLE } from '../src/workspaces/useBucketSources.js';
import { installDocument } from './_contracts_dom.mjs';

const textOf = (n) => (!n ? '' : n.nodeType === 3 || !n.childNodes?.length ? n.textContent || '' : n.childNodes.map(textOf).join(''));
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];

function Probe({ sources }) {
  const byKey = useBucketSources(sources);
  return React.createElement('div', null, Object.entries(byKey).map(([k, v]) =>
    React.createElement('p', { key: k }, `${k}=${v.state}${v.data ? `:${v.data}` : ''}${v.error ? `:${v.error}` : ''};`,
      React.createElement('button', { type: 'button', onClick: v.retry }, `retry ${k}`))));
}
async function mount(sources) {
  const restore = installDocument();
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(React.createElement(Probe, { sources })); });
  return {
    text: () => textOf(el),
    rerender: (next) => act(async () => { root.render(React.createElement(Probe, { sources: next })); }),
    press: (label) => act(async () => { props(walk(el).find((n) => n.tagName === 'BUTTON' && textOf(n) === label)).onClick(); }),
    settle: () => act(async () => { await new Promise((r) => setTimeout(r, 0)); }),
    unmount: async () => { await act(async () => root.unmount()); restore(); },
  };
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

test('a slow source does not hold the others: Profile and Services draw while Proof is still reading', async () => {
  // Mutation checked: Promise.allSettled restored -> profile stays loading until proof answers.
  const proof = deferred();
  const v = await mount({ profile: async () => 'P', services: async () => 'S', proof: () => proof.promise });
  try {
    await v.settle();
    assert.match(v.text(), /profile=ready:P;/);
    assert.match(v.text(), /services=ready:S;/);
    assert.match(v.text(), /proof=loading;/);
    await act(async () => { proof.resolve('R'); });
    await v.settle();
    assert.match(v.text(), /proof=ready:R;/);
  } finally { await v.unmount(); }
});

test('one failed source greys only itself, says a fixed sentence, and retries on its own', async () => {
  let services = 0, proofCalls = 0;
  const v = await mount({
    services: async () => { services += 1; return 'S'; },
    proof: async () => { proofCalls += 1; if (proofCalls === 1) throw new Error('D1_ERROR: no such column secret_internal'); return 'R'; },
  });
  try {
    await v.settle();
    assert.match(v.text(), /services=ready:S;/, 'the other section is untouched');
    assert.match(v.text(), new RegExp(`proof=error:${SOURCE_UNREADABLE.replace('.', '\\.')};`));
    assert.doesNotMatch(v.text(), /D1_ERROR|secret_internal/, 'never the raw error text');
    await v.press('retry proof');
    await v.settle();
    assert.match(v.text(), /proof=ready:R;/);
    assert.equal(services, 1, 'a retry reads only its own source');
    assert.equal(proofCalls, 2);
  } finally { await v.unmount(); }
});

test('an answer from an earlier board, or a superseded retry, never lands', async () => {
  const old = deferred();
  const v = await mount({ proof: () => old.promise });
  try {
    // The reader moves to another bucket root before the old read answers.
    await v.rerender({ thinking: async () => 'T' });
    await v.settle();
    await act(async () => { old.resolve('OLD BOARD ROW'); });
    await v.settle();
    assert.match(v.text(), /thinking=ready:T;/);
    assert.doesNotMatch(v.text(), /OLD BOARD ROW|proof=/);
  } finally { await v.unmount(); }
  const first = deferred(), second = deferred();
  let n = 0;
  const w = await mount({ proof: () => (n++ === 0 ? first.promise : second.promise) });
  try {
    await w.press('retry proof');
    await act(async () => { second.resolve('NEW'); });
    await w.settle();
    await act(async () => { first.resolve('STALE'); });
    await w.settle();
    assert.match(w.text(), /proof=ready:NEW;/, 'the superseded first read does not overwrite the retry');
  } finally { await w.unmount(); }
});

test('timing: how long Profile waits behind a 150 ms Proof read', async () => {
  // A measurement recorded in D4697.md (before: the board waited on allSettled).
  const started = performance.now();
  let profileAt = null;
  const v = await mount({ profile: async () => 'P', proof: () => new Promise((r) => setTimeout(() => r('R'), 150)) });
  try {
    for (let i = 0; i < 40 && profileAt === null; i += 1) {
      await v.settle();
      if (/profile=ready/.test(v.text())) profileAt = performance.now() - started;
      else await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    }
    console.log(`[4697] profile drawn after ${profileAt?.toFixed(1)} ms with Proof taking 150 ms`);
    assert.ok(profileAt !== null && profileAt < 150, 'Profile draws before Proof answers');
  } finally { await act(async () => { await new Promise((r) => setTimeout(r, 160)); }); await v.unmount(); }
});
