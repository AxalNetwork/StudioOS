// #9198 — ordinary page loads by a signed-in person make no failed request:
//   1. the pageview goes as a cookie-less keepalive fetch, never navigator.sendBeacon
//      (which always sends cookies and so met the CSRF middleware's 403);
//   2. My tasks with the agent engine off reads as the honest off block from the
//      route's 200 `{ available: false }`, and an older Worker's 404 still does;
//   3. /trust/me reads /api/kyc/status only for a role with a KYC step.
// Every fixture is synthetic.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/signed_in_console_errors_9198.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { h, mountForm } from './_form_d695.mjs';
import { installDocument } from './_contracts_dom.mjs';
import { fireAnalytics } from '../src/lib/seo.js';
import { workAdapter, WORK_OFF } from '../src/pages/work/workAdapter.js';
import TrustCenterPage from '../src/pages/TrustCenterPage.jsx';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function withGlobals(values, fn) {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, v] of Object.entries(values)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  const restore = () => { for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; } };
  return Promise.resolve().then(fn).finally(restore);
}

test('#9198 the pageview is a cookie-less keepalive fetch, and sendBeacon is never called', async () => {
  const fetches = []; let beacons = 0;
  await withGlobals({
    window: {},
    document: { referrer: 'https://ref.example.test/' },
    navigator: { sendBeacon: () => { beacons += 1; return true; } },
    fetch: async (url, init) => { fetches.push([url, init]); return new Response(null, { status: 204 }); },
  }, () => fireAnalytics('/pricing'));
  assert.equal(beacons, 0, 'sendBeacon always sends cookies, so the CSRF middleware refuses it for a signed-in visitor');
  assert.equal(fetches.length, 1);
  const [url, init] = fetches[0];
  assert.equal(url, '/api/public/analytics/pageview');
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.keepalive, true);
  assert.equal(JSON.parse(init.body).path, '/pricing');
});

async function myTasksAgainst(answer) {
  const calls = []; const restore = installDocument();
  try {
    const result = await withGlobals({ fetch: async (url) => { calls.push(String(url)); return answer(); } }, () => workAdapter.myTasks({ state: 'open' }));
    return { calls, result };
  } finally { restore(); }
}

test('#9198 my tasks with the engine off: the 200 available:false is the off block, and the old 404 still is', async () => {
  const off = await myTasksAgainst(() => response({ available: false, projects: [], compliance: [], has_more: false }));
  assert.equal(off.calls.length, 1);
  assert.deepEqual(off.result, { available: false, reason: WORK_OFF }, 'an engine that is off is the honest block, never an empty list');
  const old = await myTasksAgainst(() => response({ error: 'agent_engine_off' }, 404));
  assert.deepEqual(old.result, { available: false, reason: WORK_OFF });
  const on = await myTasksAgainst(() => response({ projects: [], compliance: [], has_more: false }));
  assert.deepEqual(on.result, { available: true, data: { projects: [], compliance: [], has_more: false } });
});

async function trustLoad(role) {
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url) => {
    const p = new URL(url, 'https://fixture.example.test').pathname; calls.push(p);
    if (p === '/api/trust/me') return response({ role, obligations: [{ obligation_key: 'tos_v1', status: 'satisfied', required: 1, source: 'Synthetic evidence source' }], acceptances: [] });
    if (p === '/api/trust/nda/required') return response({ items: [] });
    if (p === '/api/kyc/status') return response({ kyc_status: 'approved', kyc_data: { legal_first_name: 'Synthetic' } });
    return response({});
  };
  try {
    const v = await mountForm(h(TrustCenterPage, {}), { modal: true });
    await v.flush(); await v.unmount();
    return calls;
  } finally { globalThis.fetch = original; }
}

test('#9198 a founder opening /trust/me sends no KYC status request; an investor does', async () => {
  const founder = await trustLoad('founder');
  assert.ok(founder.includes('/api/trust/me'));
  assert.ok(!founder.includes('/api/kyc/status'), '/api/kyc is a Studio paywall prefix: a founder without the tier gets a 402');
  const investor = await trustLoad('investor');
  assert.ok(investor.includes('/api/kyc/status'), 'a role with a KYC step still reads its identity report');
});
