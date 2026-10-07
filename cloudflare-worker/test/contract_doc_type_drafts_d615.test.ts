/**
 * D615 (#1313) — saving a draft for a published contract doc type leaves live
 * values and status unchanged, populating pending draft columns; publishing
 * applies the draft and clears it (migration 416).
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs --test \
 *     cloudflare-worker/test/contract_doc_type_drafts_d615.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import {
  listRegistryRows,
  upsertDraft,
  publishType,
} from '../src/services/contractDocTypeRegistryStore.ts';

const M332 = readFileSync('cloudflare-worker/sql/migrations/332_contract_doc_type_registry.sql', 'utf8');
const M416 = readFileSync('cloudflare-worker/sql/migrations/416_contract_doc_type_drafts.sql', 'utf8');
const registryRouteSrc = readFileSync('cloudflare-worker/src/routes/admin_contract_doc_registry.ts', 'utf8');

function createTestEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(M332);
  db.exec(M416);
  return { env: { DB: d1Over(db) } as any, db };
}

test('migration 416 adds all six draft_* columns to contract_doc_type_registry', () => {
  const { db } = createTestEnv();
  const cols = db.prepare('PRAGMA table_info(contract_doc_type_registry)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  for (const expected of [
    'draft_title',
    'draft_layer',
    'draft_party_roles_json',
    'draft_required_fields_json',
    'draft_updated_at',
    'draft_updated_by',
  ]) {
    assert.ok(names.has(expected), `missing column ${expected}`);
  }
});

test('a draft-only type saves and updates as today without creating pending draft copy', async () => {
  const { env, db } = createTestEnv();

  await upsertDraft(
    env,
    {
      doc_type: 'custom_advisory_note',
      title: 'Custom Advisory Note',
      layer: 'portfolio',
      party_roles: ['founder', 'advisor'],
      required_fields: ['effective_date'],
    },
    101,
  );

  const raw = db.prepare('SELECT * FROM contract_doc_type_registry WHERE doc_type = ?').get('custom_advisory_note') as any;
  assert.equal(raw.title, 'Custom Advisory Note');
  assert.equal(raw.layer, 'portfolio');
  assert.equal(raw.status, 'draft');
  assert.equal(raw.draft_title, null);
  assert.equal(raw.draft_layer, null);

  const rows = await listRegistryRows(env);
  const found = rows.find((r) => r.doc_type === 'custom_advisory_note');
  assert.ok(found);
  assert.equal(found.status, 'draft');
  assert.equal(found.title, 'Custom Advisory Note');
  assert.equal(found.draft, undefined);

  // Updating draft-only type updates live fields directly
  await upsertDraft(
    env,
    {
      doc_type: 'custom_advisory_note',
      title: 'Custom Advisory Note Updated',
      layer: 'gp',
      party_roles: ['founder', 'axal'],
      required_fields: ['effective_date', 'fee'],
    },
    102,
  );

  const updatedRaw = db.prepare('SELECT * FROM contract_doc_type_registry WHERE doc_type = ?').get('custom_advisory_note') as any;
  assert.equal(updatedRaw.title, 'Custom Advisory Note Updated');
  assert.equal(updatedRaw.layer, 'gp');
  assert.equal(updatedRaw.status, 'draft');
  assert.equal(updatedRaw.draft_title, null);
});

test('saving a draft on a published type leaves live values and status untouched, populating draft', async () => {
  const { env, db } = createTestEnv();

  // Create and publish type
  await upsertDraft(
    env,
    {
      doc_type: 'series_seed_term_sheet',
      title: 'Series Seed Term Sheet (Live)',
      layer: 'fund',
      party_roles: ['founder', 'investor'],
      required_fields: ['valuation', 'round_size'],
    },
    201,
  );

  const pub = await publishType(env, 'series_seed_term_sheet', 'Initial release of seed term sheet', 201);
  assert.equal(pub.ok, true);

  // Save a pending draft with modifications
  await upsertDraft(
    env,
    {
      doc_type: 'series_seed_term_sheet',
      title: 'Series Seed Term Sheet (Revised Draft)',
      layer: 'gp',
      party_roles: ['founder', 'investor', 'axal'],
      required_fields: ['valuation', 'round_size', 'closing_date'],
    },
    202,
  );

  // Direct DB check: live values must NOT have changed
  const raw = db.prepare('SELECT * FROM contract_doc_type_registry WHERE doc_type = ?').get('series_seed_term_sheet') as any;
  assert.equal(raw.status, 'published', 'status remains published');
  assert.equal(raw.title, 'Series Seed Term Sheet (Live)', 'live title unchanged');
  assert.equal(raw.layer, 'fund', 'live layer unchanged');
  assert.equal(raw.draft_title, 'Series Seed Term Sheet (Revised Draft)');
  assert.equal(raw.draft_layer, 'gp');
  assert.equal(raw.draft_updated_by, 202);
  assert.deepEqual(JSON.parse(raw.draft_party_roles_json), ['founder', 'investor', 'axal']);
  assert.deepEqual(JSON.parse(raw.draft_required_fields_json), ['valuation', 'round_size', 'closing_date']);

  // listRegistryRows returns both live values and the draft object
  const rows = await listRegistryRows(env);
  const item = rows.find((r) => r.doc_type === 'series_seed_term_sheet');
  assert.ok(item);
  assert.equal(item.status, 'published');
  assert.equal(item.title, 'Series Seed Term Sheet (Live)');
  assert.equal(item.layer, 'fund');
  assert.deepEqual(item.party_roles, ['founder', 'investor']);
  assert.deepEqual(item.draft, {
    title: 'Series Seed Term Sheet (Revised Draft)',
    layer: 'gp',
    party_roles: ['founder', 'investor', 'axal'],
    required_fields: ['valuation', 'round_size', 'closing_date'],
  });
});

test('publishing promotes the pending draft, clears draft_* columns and writes audit metadata', async () => {
  const { env, db } = createTestEnv();

  await upsertDraft(
    env,
    {
      doc_type: 'safenote_standard',
      title: 'SAFE Original Live',
      layer: 'portfolio',
      party_roles: ['founder', 'investor'],
      required_fields: ['cap'],
    },
    301,
  );
  await publishType(env, 'safenote_standard', 'First version publish reason here', 301);

  // Save pending draft
  await upsertDraft(
    env,
    {
      doc_type: 'safenote_standard',
      title: 'SAFE MFN Discount Live V2',
      layer: 'gp',
      party_roles: ['founder', 'investor', 'axal'],
      required_fields: ['cap', 'discount_rate'],
    },
    302,
  );

  // Publish pending draft
  const res = await publishType(env, 'safenote_standard', 'Super admin approval of MFN clause addition', 303);
  assert.equal(res.ok, true);

  // Direct DB check: live values promoted, draft_* columns cleared
  const raw = db.prepare('SELECT * FROM contract_doc_type_registry WHERE doc_type = ?').get('safenote_standard') as any;
  assert.equal(raw.status, 'published');
  assert.equal(raw.title, 'SAFE MFN Discount Live V2');
  assert.equal(raw.layer, 'gp');
  assert.deepEqual(JSON.parse(raw.party_roles_json), ['founder', 'investor', 'axal']);
  assert.deepEqual(JSON.parse(raw.required_fields_json), ['cap', 'discount_rate']);
  assert.equal(raw.draft_title, null);
  assert.equal(raw.draft_layer, null);
  assert.equal(raw.draft_party_roles_json, null);
  assert.equal(raw.draft_required_fields_json, null);
  assert.equal(raw.draft_updated_at, null);
  assert.equal(raw.draft_updated_by, null);
  assert.equal(raw.published_by, 303);
  assert.equal(raw.publish_reason, 'Super admin approval of MFN clause addition');

  // listRegistryRows shows promoted live values and no draft
  const rows = await listRegistryRows(env);
  const item = rows.find((r) => r.doc_type === 'safenote_standard');
  assert.ok(item);
  assert.equal(item.title, 'SAFE MFN Discount Live V2');
  assert.equal(item.layer, 'gp');
  assert.equal(item.status, 'published');
  assert.equal(item.draft, undefined);
});

test('registry route forwards draft on published items and enforces publish bar with audit', () => {
  // Routes pass draft through to client in merged hub payload
  assert.match(registryRouteSrc, /draft:\s*stored\.draft/);
  assert.match(registryRouteSrc, /draft:\s*s\.draft/);

  // Publish is behind Super Admin write bar, requires reason, and logs audit
  assert.match(registryRouteSrc, /requireSuperAdminWriteBar\(c\)/);
  assert.match(registryRouteSrc, /REGISTRY_PUBLISH_REASON_MIN/);
  assert.match(registryRouteSrc, /logAdminAction\(c\.env,\s*admin\.id,\s*admin\.email\s*\|\|\s*'',\s*'registry\.type\.publish'/);
});
