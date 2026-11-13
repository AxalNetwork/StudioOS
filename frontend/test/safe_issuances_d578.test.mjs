/**
 * D578 (#1205) — the Lab Capital page's SAFE card. The Worker's half is
 * cloudflare-worker/test/safe_issuances_d578.test.ts.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/safe_issuances_d578.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import SafeIssuancesCard, { NOT_SENDABLE, NO_DISCOUNT, RECORD_ERRORS, SafeList, dollarsToCents, usd } from '../src/components/spinout/SafeIssuancesCard.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ROUTE = read('cloudflare-worker/src/routes/safe_issuances.ts');

const SAFE = (uid, label, extra = {}) => ({
  uid, investor_name: `Investor ${uid}`, amount_cents: 2500000, valuation_cap_cents: 1000000000, discount: null,
  status: { key: 'x', label }, ...extra,
});

test('each SAFE shows its investor, amount, cap, no discount, and the status the Worker read from its envelope', () => {
  const html = renderToStaticMarkup(h(SafeList, { data: { sendable: false, safes: [SAFE('a', 'Draft · not sent'), SAFE('b', 'Countersigned')] } }));
  assert.match(html, /Investor a<\/td><td[^>]*>\$25,000<\/td><td[^>]*>\$10,000,000<\/td><td[^>]*>None in this form<\/td><td[^>]*data-testid="safe-status-a">Draft · not sent</);
  assert.match(html, /data-testid="safe-status-b">Countersigned</);
  assert.equal(NO_DISCOUNT, 'None in this form');
  assert.ok(html.includes(NOT_SENDABLE), 'the card does not say why nothing can be sent');
});

test('the not-sendable note goes once a text is registered, and an empty round says so', () => {
  const html = renderToStaticMarkup(h(SafeList, { data: { sendable: true, safes: [] } }));
  assert.doesNotMatch(html, /safe-not-sendable/);
  assert.match(html, /No SAFE has been recorded for this round\./);
});

test('the card starts loading and offers no send button', () => {
  const html = renderToStaticMarkup(h(SafeIssuancesCard, { projectId: 1 }));
  assert.match(html, /Loading…/);
  const src = codeOnly(read('frontend/src/components/spinout/SafeIssuancesCard.jsx'));
  assert.doesNotMatch(src, /safeIssuancesApi\.send\(/, 'the card offers a send that the Worker refuses');
  assert.match(src, /setState\(\{ status: 'unreadable', data: null \}\)/);
});

test('amounts are whole dollars typed, sent as integer cents', () => {
  assert.equal(dollarsToCents('25,000'), 2500000);
  assert.equal(dollarsToCents('$10000000'), 1000000000);
  for (const bad of ['', '0', '12.5', '-5', 'abc', null]) assert.equal(dollarsToCents(bad), null, String(bad));
  assert.equal(usd(2500000), '$25,000');
  assert.equal(usd(null), null);
});

test('every refusal the Worker gives when recording has a sentence', () => {
  const codes = [...ROUTE.matchAll(/c\.json\(\{ error: '([a-z_]+)' \}, 400\)/g)].map((m) => m[1]);
  assert.ok(codes.length >= 5);
  for (const code of codes) assert.ok(RECORD_ERRORS[code], `no sentence for ${code}`);
});

test('the Capital page shows the card for its project, with the round\'s prospects', () => {
  const page = codeOnly(read('frontend/src/pages/SpinoutLabCapitalPage.jsx'));
  assert.match(page, /\{project\?\.id && <SafeIssuancesCard projectId=\{project\.id\} prospects=\{prospects\} \/>\}/);
});

test('the client calls the Worker\'s SAFE routes', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', String(url).replace(/^.*\/api/, ''), init.body ? JSON.parse(init.body) : null]);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const { safeIssuancesApi } = await import('../src/lib/api/safeIssuances.js');
    await safeIssuancesApi.list(1);
    await safeIssuancesApi.record(1, { investor_name: 'A', amount_cents: 100, valuation_cap_cents: 200 });
    await safeIssuancesApi.send('u1');
    assert.deepEqual(calls, [
      ['GET', '/safe-issuances/project/1', null],
      ['POST', '/safe-issuances/project/1', { investor_name: 'A', amount_cents: 100, valuation_cap_cents: 200 }],
      ['POST', '/safe-issuances/u1/send', null],
    ]);
  } finally { globalThis.fetch = original; }
  assert.match(read('cloudflare-worker/src/index.ts'), /app\.route\('\/api\/safe-issuances', safeIssuances\);/);
});
