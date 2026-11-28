/**
 * #9178 — /verify/:token says "No matching credential" only for a 404. A 503,
 * any other error or a network failure says verification is unavailable and
 * offers a retry, because calling a genuine credential unknown during an
 * outage is the wrong answer to "is this real?".
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/public_verify_unavailable_9178.test.mjs
 *
 * Mounted on the contracts DOM with `fetch` answered per call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import PublicCertificateVerifyPage, { verifyFailureStatus } from '../src/pages/PublicCertificateVerifyPage.jsx';

const h = React.createElement;
const response = (body, status = 200) => ({
  ok: status < 400, status, statusText: status === 404 ? 'Not Found' : 'Service Unavailable',
  headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
});
const CREDENTIAL = {
  verified: true, status: 'active', credential_id: 'AXL-SOL-2026-0042', name: 'Rae Sample',
  company: 'Sample Robotics', cohort: 'November 2026', issued_on: '2026-11-20',
};

async function mounted(answers) {
  const restore = installDocument();
  const previous = { fetch: globalThis.fetch, matchMedia: globalThis.matchMedia };
  const calls = [];
  globalThis.fetch = async (u) => {
    calls.push(String(u));
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (next === 'network') throw new TypeError('Failed to fetch');
    return response(next.body, next.status);
  };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/verify/abc'] },
    h(Routes, null, h(Route, { path: '/verify/:token', element: h(PublicCertificateVerifyPage) })))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(document.body); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  return {
    calls,
    has: (id) => Boolean(byId(id)),
    textOf: (id) => text(byId(id)),
    async click(id) { const n = byId(id); assert.ok(n, `no ${id}`); await act(async () => { props(n).onClick({ preventDefault() {} }); }); await flush(); },
    async close() { await act(async () => root.unmount()); Object.assign(globalThis, previous); restore(); },
  };
}

test('only a 404 maps to not found; anything else, including no status, is unavailable', () => {
  assert.equal(verifyFailureStatus({ status: 404 }), 'notfound');
  for (const err of [{ status: 503 }, { status: 500 }, { status: 429 }, new TypeError('Failed to fetch'), undefined]) {
    assert.equal(verifyFailureStatus(err), 'unavailable', `${err?.status ?? err} read as not found`);
  }
});

test('a 404 shows "No matching credential"', async () => {
  const v = await mounted([{ status: 404, body: { error: 'not_found' } }]);
  try {
    assert.equal(v.calls.length, 1);
    assert.match(v.calls[0], /\/public\/verify\/abc$/);
    assert.ok(v.has('verify-notfound'), 'a 404 does not show not found');
    assert.match(v.textOf('verify-notfound'), /No matching credential/);
    assert.equal(v.has('verify-unavailable'), false);
  } finally { await v.close(); }
});

test('a 503 shows unavailable with a retry, never "No matching credential"', async () => {
  const v = await mounted([{ status: 503, body: { error: 'storage_error' } }]);
  try {
    assert.equal(v.has('verify-notfound'), false, 'a 503 reads as not found');
    assert.match(v.textOf('verify-unavailable'), /Verification is temporarily unavailable, try again/);
    assert.ok(v.has('verify-retry'));
  } finally { await v.close(); }
});

test('a network error shows unavailable', async () => {
  const v = await mounted(['network']);
  try {
    assert.equal(v.has('verify-notfound'), false, 'a network failure reads as not found');
    assert.ok(v.has('verify-unavailable'));
  } finally { await v.close(); }
});

test('retry calls the API again, and a 200 then shows the credential', async () => {
  const v = await mounted([{ status: 503, body: {} }, { status: 200, body: CREDENTIAL }]);
  try {
    assert.ok(v.has('verify-unavailable'));
    await v.click('verify-retry');
    assert.equal(v.calls.length, 2, 'retry did not call the API again');
    assert.equal(v.has('verify-unavailable'), false);
    assert.equal(v.textOf('verify-credential-id'), 'AXL-SOL-2026-0042');
  } finally { await v.close(); }
});
