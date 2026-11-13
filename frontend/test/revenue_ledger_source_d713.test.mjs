import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ledgerSourceLabel, ledgerVerificationNote } from '../src/lib/revenueLedger.js';
test('every ledger source has its own label and unknown sources cannot impersonate manual',()=>{
  for(const [source,label] of Object.entries({manual:'Manual',csv:'CSV import',stripe:'Stripe',mercury:'Mercury',other:'Unknown source',toString:'Unknown source'})) assert.equal(ledgerSourceLabel(source),label);
  assert.equal(ledgerSourceLabel(null),'Unknown source');
});
test('Mercury evidence explains a bank credit unless a proof document is attached',()=>{
  assert.equal(ledgerVerificationNote({source:'mercury',verification:'supported',proof_document_id:null}),'Matched to a credit in your Mercury account');
  assert.equal(ledgerVerificationNote({source:'mercury',verification:'supported',proof_document_id:4}),'Proof document attached');
  assert.equal(ledgerVerificationNote({source:'stripe',verification:'verified'}),'Synced from a Stripe charge');
  assert.equal(ledgerVerificationNote({source:'manual',verification:'supported',proof_document_id:4}),'Proof document attached');
  const component=readFileSync('frontend/src/components/spinout/RevenueLedger.jsx','utf8');
  assert.match(component,/ledgerSourceLabel\(e.source\)/); assert.match(component,/title=\{ledgerVerificationNote\(e\)\}/);
});
