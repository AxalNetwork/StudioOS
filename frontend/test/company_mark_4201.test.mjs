// #4201 (#4152 G1) — the company mark draws the company's logo: the uploaded
// logo's served path, an outside http(s) URL a member pasted earlier, or the
// initials when there is neither (or the URL is not one an <img> may load).
// The client module names the served path and the two writes.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/company_mark_4201.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompanyMark, logoSrcOf } from '../src/pages/account/companies/portfolioUi.jsx';
import { portfolioCard } from '../src/pages/account/companies/companiesModel.js';
import { companyLogoApi, servedLogoPath } from '../src/lib/api/companyLogo.js';

const h = React.createElement;
// React 19 prepends a preload <link> for an <img>; the mark is what follows it.
const mark = (props) => renderToStaticMarkup(h(CompanyMark, props)).replace(/^<link [^>]*\/>/, '');
const STORED = `/api/company/co-north/logo?v=${'0123456789abcdef'.repeat(2)}.svg`;

test('a stored logo draws its served path, marked stored', () => {
  const html = mark({ name: 'Northwind Labs', logoUrl: STORED, size: 40 });
  assert.match(html, /^<img /);
  assert.ok(html.includes(`src="${STORED}"`));
  assert.match(html, /data-logo="stored"/);
  assert.match(html, /data-mark="company"/);
  assert.match(html, /width="40"/);
  assert.doesNotMatch(html, />NL</, 'no initials beside a logo');
});

test('an outside-host logo_url still renders, marked outside', () => {
  const url = 'https://cdn.example.test/northwind.png';
  const html = mark({ name: 'Northwind Labs', logoUrl: url });
  assert.ok(html.includes(`src="${url}"`));
  assert.match(html, /data-logo="outside"/);
});

test('no logo, or one an <img> may not load, draws the initials', () => {
  for (const logoUrl of [null, undefined, '', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>', '/elsewhere/logo.png', '/api/company/co-north/logo?v=../x']) {
    const html = mark({ name: 'Northwind Labs', logoUrl });
    assert.match(html, /^<span /, `initials for ${String(logoUrl)}`);
    assert.match(html, />NL<\/span>$/);
    assert.doesNotMatch(html, /<img/);
  }
  assert.equal(logoSrcOf('  https://x.example.test/a.png '), 'https://x.example.test/a.png');
});

test('the Portfolio card carries logo_url to the mark', () => {
  assert.equal(portfolioCard({ uid: 'co-north', company_name: 'Northwind', logo_url: STORED }).logoUrl, STORED);
  assert.equal(portfolioCard({ uid: 'co-north', company_name: 'Northwind' }).logoUrl, null);
});

test('the client: upload and remove hit /company/:uid/logo; the served path is the stored logo\'s prefix', async () => {
  assert.equal(servedLogoPath('co north'), '/api/company/co%20north/logo');
  assert.equal(companyLogoApi.isStored('co-north', STORED), true);
  assert.equal(companyLogoApi.isStored('co-north', 'https://cdn.example.test/n.png'), false);
  assert.equal(companyLogoApi.isStored('co-south', STORED), false);
  const store = new Map();
  globalThis.localStorage ??= { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body });
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ logo_url: null }), text: async () => '{"logo_url":null}' };
  };
  try {
    await companyLogoApi.upload('co-north', new Blob([new Uint8Array([1])], { type: 'image/png' }));
    await companyLogoApi.remove('co-north');
  } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(calls.map((c) => [c.method, c.url.replace(/^.*?\/api/, '/api')]), [['POST', '/api/company/co-north/logo'], ['DELETE', '/api/company/co-north/logo']]);
  assert.ok(calls[0].body instanceof FormData);
  assert.ok(calls[0].body.get('file'));
});
