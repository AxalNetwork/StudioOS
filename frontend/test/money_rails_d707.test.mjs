/**
 * D707 (#1772) — the frontend mirror routes the two Platform IP Licences to
 * Holdings and the operating-partner agreements to Management, exactly as the
 * Worker does, and the checkout sends no raw amount.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/money_rails_d707.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { axalEntityKeyForDoc } from '../src/lib/legalDocFormat.js';

const read = (p) => readFileSync(p, 'utf8');

function setMembers(src, name) {
  // Found by string search, so no pattern is built from the set's name.
  const head = `const ${name} = new Set([`;
  const at = src.indexOf(head);
  assert.ok(at >= 0, `${name} not found`);
  const body = src.slice(at + head.length, src.indexOf(']);', at));
  return [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}

test('D707 the worker and the mirror list the same slugs in both D707 sets', () => {
  const ts = read('cloudflare-worker/src/services/legalDocFormat.ts');
  const js = read('frontend/src/lib/legalDocFormat.js');
  assert.deepEqual(setMembers(js, 'HOLDINGS_PARTY_SLUGS_D707'), ['platform_ip_licence_fund_admin', 'platform_ip_licence_management_admin']);
  assert.deepEqual(setMembers(js, 'MANAGEMENT_PARTY_SLUGS_D707'),
    ['partner_custom', 'partner_equity', 'partner_msa_v1', 'partner_nda_nonsolicit', 'partner_revshare', 'partner_services']);
  for (const name of ['HOLDINGS_PARTY_SLUGS_D707', 'MANAGEMENT_PARTY_SLUGS_D707']) {
    assert.deepEqual(setMembers(js, name), setMembers(ts, name), name);
  }
});

test('D707 the mirror routes alike', () => {
  for (const slug of ['platform_ip_licence_management_admin', 'platform_ip_licence_fund_admin']) {
    assert.equal(axalEntityKeyForDoc(slug), 'holdings', slug);
    assert.equal(axalEntityKeyForDoc(slug, 'gp'), 'holdings', slug);
  }
  for (const slug of ['partner_msa_v1', 'partner_services', 'partner_equity', 'partner_revshare', 'partner_custom', 'partner_nda_nonsolicit']) {
    assert.equal(axalEntityKeyForDoc(slug), 'management', slug);
  }
});

test('D707 AxalCheckout sends no raw amount, and takes no amount or currency prop', () => {
  const src = read('frontend/src/components/AxalCheckout.jsx');
  assert.doesNotMatch(src, /body\.amount\b|body\.currency\b/);
  assert.doesNotMatch(src.match(/const \{[^}]*\} = props;/)?.[0] ?? '', /\bamount\b|\bcurrency\b/);
  assert.match(src, /body\.price_id = priceId;/);
  const pages = read('frontend/src/lib/api.js');
  assert.doesNotMatch(pages, /\{ amount, currency\?, quantity\?/, 'the raw shape is gone from the comment');
});
