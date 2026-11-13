/**
 * D480 — template usage counts: no migrated double-count, alias spellings map to catalog keys.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import {
  catalogDocTypeForRaw,
  usageFromContractRows,
  usageRowsFor,
} from '../src/services/contractTemplateUsage.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const adminSrc = readFileSync(resolve(ROOT, 'src/routes/admin_contracts.ts'), 'utf8');

const CATALOG = new Set([
  'nda_3way_founder_investor_axal',
  'investor_nda_axal',
  'partner_services',
  'lpa',
]);

test('catalogDocTypeForRaw maps envelope aliases', () => {
  assert.equal(catalogDocTypeForRaw('nda_3way_v1', CATALOG), 'nda_3way_founder_investor_axal');
  assert.equal(catalogDocTypeForRaw('investor_nda_v1', CATALOG), 'investor_nda_axal');
  assert.equal(catalogDocTypeForRaw('partner_msa_v1', CATALOG), 'partner_services');
});

test('usageFromContractRows counts each unified row once', () => {
  const { usage } = usageFromContractRows(
    [
      { doc_type: 'nda_3way_v1', template_name: null, created_at: '2026-01-01T00:00:00Z' },
      { doc_type: 'investor_nda_v1', template_name: null, created_at: '2026-01-02T00:00:00Z' },
    ],
    CATALOG,
  );
  assert.equal(usage.get('nda_3way_founder_investor_axal'), 1);
  assert.equal(usage.get('investor_nda_axal'), 1);
});

test('loadTemplateUsage is fed from the four-source union, not raw documents SQL', () => {
  assert.match(adminSrc, /usageFromContractRows\(rows, catalogKeys\)/);
  assert.doesNotMatch(adminSrc, /SELECT template_name, doc_type, created_at FROM documents[\s\S]*loadTemplateUsage/s);
});

test('pairwise-ndas and partner-deals register before /:uid', () => {
  const pw = adminSrc.indexOf("adminContracts.get('/pairwise-ndas'");
  const pd = adminSrc.indexOf("adminContracts.get('/partner-deals'");
  const uid = adminSrc.indexOf("adminContracts.get('/:uid'");
  assert.ok(pw >= 0 && pd >= 0 && uid > pw && uid > pd);
});

test('migrated documents are excluded from the union loader', () => {
  assert.match(adminSrc, /migrated_to_esign_id IS NULL/);
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE documents (id INTEGER PRIMARY KEY, uid TEXT, doc_type TEXT, template_name TEXT, status TEXT, created_at TEXT, migrated_to_esign_id INTEGER);
    INSERT INTO documents (uid, doc_type, template_name, status, created_at, migrated_to_esign_id)
      VALUES ('a', 'lpa', 'lpa', 'sent', '2026-01-01', 99),
             ('b', 'lpa', 'lpa', 'sent', '2026-01-02', NULL);
  `);
  const rows = db.prepare('SELECT doc_type, template_name, created_at FROM documents WHERE migrated_to_esign_id IS NULL').all();
  const { usage } = usageFromContractRows(rows as any, new Set(['lpa']));
  assert.equal(usage.get('lpa'), 1);
});

// D758 (#1863) — one spelling-to-row rule, and one use per document.
const usageSrc = readFileSync(resolve(ROOT, 'src/services/contractTemplateUsage.ts'), 'utf8');

test('D758 a spaced slug matches its own row exactly, before any lowercase', () => {
  const keys = new Set(['Subscription Booklet & LPA', 'lpa']);
  assert.equal(catalogDocTypeForRaw('Subscription Booklet & LPA', keys), 'Subscription Booklet & LPA');
  assert.equal(catalogDocTypeForRaw('LPA', keys), 'lpa');
  assert.equal(catalogDocTypeForRaw('mentor_disclaimer_v1', new Set(['mentor_engagement_disclaimer'])), 'mentor_engagement_disclaimer');
  assert.equal(catalogDocTypeForRaw('founder_nda_axal', new Set(['founder_nda_v1'])), 'founder_nda_v1');
  assert.equal(catalogDocTypeForRaw('unknown_thing', keys), null);
});

test('D758 a relationship row whose envelope is in the union counts once, under the envelope', () => {
  const rows = [
    { source: 'esign', uid: 'env-1', doc_type: 'nda_3way_v1', created_at: '2026-01-01T00:00:00Z' },
    { source: 'pairwise_nda', uid: 'env-1', envelope_uuid: 'env-1', doc_type: 'nda_3way_founder_investor_axal', created_at: '2026-01-01T00:00:00Z' },
    { source: 'esign', uid: 'env-2', doc_type: 'partner_msa_v1', created_at: '2026-01-02T00:00:00Z' },
    { source: 'partner_deal', uid: 'partner_deal:1', envelope_uuid: 'env-2', doc_type: 'partner_services', created_at: '2026-01-02T00:00:00Z' },
    { source: 'partner_deal', uid: 'partner_deal:2', envelope_uuid: null, doc_type: 'partner_services', created_at: '2026-01-03T00:00:00Z' },
    { source: 'pairwise_nda', uid: 'pairwise:9', envelope_uuid: 'env-elsewhere', doc_type: 'nda_3way_founder_investor_axal', created_at: '2026-01-04T00:00:00Z' },
  ];
  const { usage } = usageFromContractRows(rows, CATALOG);
  assert.equal(usage.get('nda_3way_founder_investor_axal'), 2, 'the envelope, plus a pairwise row whose envelope is not in the union');
  assert.equal(usage.get('partner_services'), 2, 'the envelope, plus the deal with no envelope');
  assert.equal(usageRowsFor(rows, CATALOG, 'partner_services').length, 2, 'the drill-down equals the chip');
  assert.equal(usageRowsFor(rows, CATALOG, 'nda_3way_founder_investor_axal').length, 2);
});

test('D758 the usage fold keeps no alias table of its own', () => {
  assert.doesNotMatch(usageSrc, /RAW_TO_CATALOG/);
  assert.match(usageSrc, /librarySlugFor/);
});
