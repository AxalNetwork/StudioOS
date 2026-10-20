// D716 (#1781) — the admin preview's mirror of legalDocFormat lists the same
// notice and booklet slugs, and the same D716 party sets, as the worker, and
// classifies and routes them the same way.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  axalEntityKeyForDoc,
  buildAddresseeBlock,
  buildExecutionBlock,
  classifyDocument,
  SUBSCRIPTION_BOOKLET_PARTS,
} from '../src/lib/legalDocFormat.js';

// The members of `const NAME = new Set([...]);` in a source file, found by
// text so no pattern is built from a name.
function setMembers(src, name) {
  const head = `const ${name} = new Set([`;
  const at = src.indexOf(head);
  assert.ok(at >= 0, `${name} not found`);
  const end = src.indexOf(']);', at);
  return [...src.slice(at + head.length, end).matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}

const SETS = ['NOTICE_SLUGS', 'BOOKLET_SLUGS', 'FUND_PARTY_SLUGS_D716', 'GP_PARTY_SLUGS_D716', 'HOLDINGS_PARTY_SLUGS_D716',
  'RESOLUTION_SLUGS', 'GP_PARTY_SLUGS_D706', 'POLICY_SLUGS'];

test('D716 the worker and the mirror list the same slugs in the notice, booklet and party sets', () => {
  const ts = readFileSync('cloudflare-worker/src/services/legalDocFormat.ts', 'utf8');
  const js = readFileSync('frontend/src/lib/legalDocFormat.js', 'utf8');
  for (const name of SETS) assert.deepEqual(setMembers(js, name), setMembers(ts, name), name);
  assert.deepEqual(setMembers(js, 'NOTICE_SLUGS'), [
    'capital_call_notice', 'default_notice', 'distribution_notice', 'management_fee_invoice',
    'management_fee_statement', 'payment_instructions_letter', 'platform_licence_fee_invoice', 'territory_licence_fee_invoice',
  ]);
  for (const moved of ['capital_call_notice', 'distribution_notice', 'default_notice']) {
    assert.equal(setMembers(js, 'RESOLUTION_SLUGS').includes(moved), false, `${moved} left RESOLUTION_SLUGS`);
    assert.equal(setMembers(js, 'GP_PARTY_SLUGS_D706').includes(moved), false, `${moved} left GP_PARTY_SLUGS_D706`);
  }
});

test('D716 the mirror classifies the notices, the booklet and the legend, and routes each to its party', () => {
  for (const [slug, party] of [
    ['capital_call_notice', 'fund'], ['distribution_notice', 'fund'], ['default_notice', 'fund'],
    ['management_fee_statement', 'fund'], ['management_fee_invoice', 'gp'], ['platform_licence_fee_invoice', 'holdings'],
    ['territory_licence_fee_invoice', 'holdings'],
  ]) {
    assert.equal(classifyDocument(slug), 'notice', slug);
    assert.equal(axalEntityKeyForDoc(slug), party, slug);
  }
  assert.equal(classifyDocument('subscription_booklet'), 'booklet');
  assert.equal(classifyDocument('securities_legend'), 'policy');
  const block = buildExecutionBlock({ kind: 'notice', axalEntityKey: 'fund' });
  assert.deepEqual([block.recital, block.parties.length, block.parties[0].by, block.parties[0].isSigner], ['', 1, '', false]);
  assert.deepEqual(buildExecutionBlock({ kind: 'booklet' }).parties, []);
  assert.deepEqual(buildAddresseeBlock({ to: 'Ada Quill', lpNumber: 7 }), ['To: Ada Quill', 'Limited partner no. L7']);
  assert.equal(SUBSCRIPTION_BOOKLET_PARTS.length, 9);
  assert.equal(SUBSCRIPTION_BOOKLET_PARTS[8].block.axalEntityKey, 'fund');
});
