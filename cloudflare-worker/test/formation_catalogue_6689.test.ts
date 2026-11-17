/**
 * D6689 (#6689) — the formation catalogue store and its read service, on the
 * full migrated schema (baseline plus every migration, this one included).
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/formation_catalogue_6689.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { catalogueForm, currentVersion, versionByNumber } from '../src/services/formationCatalogue.ts';

// D6690: the seed migration writes and publishes version 1 in every database. These cases build
// their own versions, so they load the schema as it stood before the seed.
const SEED = 202611161600;
function db() {
  const d = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(d, { below: SEED });
  return d;
}
const run = (d: DatabaseSync, sql: string, ...p: unknown[]) => d.prepare(sql).run(...(p as any[]));
const one = (d: DatabaseSync, sql: string, ...p: unknown[]) => d.prepare(sql).get(...(p as any[])) as any;

/** A draft version 1 with GB, one form, a source; returns ids. */
function draft(d: DatabaseSync, version = 1) {
  const v = Number(run(d, 'INSERT INTO formation_catalogue_versions (version) VALUES (?)', version).lastInsertRowid);
  const s = Number(run(d, "INSERT INTO formation_sources (kind, title, url) VALUES ('registry', 'Companies House: set up a limited company', 'https://www.gov.uk/limited-company-formation')").lastInsertRowid);
  const j = Number(run(d, "INSERT INTO formation_jurisdictions (version_id, country, registry_name, vocabulary_json) VALUES (?, 'GB', 'Companies House', '{\"company\":\"company\"}')", v).lastInsertRowid);
  const f = Number(run(d, "INSERT INTO formation_entity_forms (version_id, jurisdiction_id, form_key, label, offer_mode, legacy_gate) VALUES (?, ?, 'uk_ltd', 'UK Private Limited (Ltd)', 'guided', 'uk_ltd')", v, j).lastInsertRowid);
  return { v, s, j, f };
}
const publish = (d: DatabaseSync, v: number) =>
  run(d, "UPDATE formation_catalogue_versions SET status = 'published', is_current = 1, published_by = 1, published_at = '2026-11-15T00:00:00Z' WHERE id = ?", v);

test('every table, the current-version index and the triggers exist on a fresh build', () => {
  const d = db();
  const names = (type: string) => new Set((d.prepare(`SELECT name FROM sqlite_master WHERE type = ?`).all(type) as any[]).map((r) => r.name));
  const tables = names('table');
  for (const t of ['formation_catalogue_versions', 'formation_sources', 'formation_source_checks', 'formation_jurisdictions', 'formation_entity_forms',
    'formation_form_facts', 'formation_fee_lines', 'formation_pack_items', 'formation_fact_schema', 'formation_scenarios', 'formation_rules',
    'formation_restricted_jurisdictions']) assert.ok(tables.has(t), t);
  assert.ok(names('index').has('ux_formation_catalogue_versions_current'));
  assert.ok(names('trigger').has('formation_catalogue_versions_published_immutable'));
  assert.equal(one(d, "SELECT dflt_value AS v FROM pragma_table_info('formation_pack_items') WHERE name = 'counsel_required'").v, '1');
  assert.equal(one(d, "SELECT dflt_value AS v FROM pragma_table_info('formation_entity_forms') WHERE name = 'offer_mode'").v, "'off'");
});

test('a fact is recorded only with a source and checked_on', () => {
  const d = db();
  const { v, s, f } = draft(d);
  const ins = (status: string, src: number | null, on: string | null, value: string | null = 'x') =>
    run(d, 'INSERT INTO formation_form_facts (version_id, form_id, fact_key, value, status, source_id, checked_on) VALUES (?, ?, ?, ?, ?, ?, ?)', v, f, `k${Math.random()}`, value, status, src, on);
  assert.throws(() => ins('recorded', null, '2026-11-15'), /CHECK/);
  assert.throws(() => ins('recorded', s, null), /CHECK/);
  assert.throws(() => ins('recorded', s, '15/11/2026'), /CHECK/, 'a day, YYYY-MM-DD');
  ins('recorded', s, '2026-11-15');
  ins('provisional', null, null);
  ins('not_recorded', null, null, null);
  assert.throws(() => ins('guessed', null, null), /CHECK/);
});

test('a fee line with an amount needs a source and a day; no amount is "not recorded", never 0', () => {
  const d = db();
  const { v, s, f } = draft(d);
  const ins = (key: string, amount: number | null, src: number | null, on: string | null) =>
    run(d, "INSERT INTO formation_fee_lines (version_id, form_id, line_key, label, payee, collected_by, currency, amount_cents, timing, source_id, checked_on) VALUES (?, ?, ?, 'Registration', 'Companies House', 'payee', 'GBP', ?, 'at_formation', ?, ?)", v, f, key, amount, src, on);
  assert.throws(() => ins('a', 5000, null, null), /CHECK/);
  assert.throws(() => ins('b', 5000, s, null), /CHECK/);
  assert.throws(() => ins('c', 5000, null, '2026-11-15'), /CHECK/);
  assert.throws(() => ins('d', 50.5 as any, s, '2026-11-15'), /CHECK/, 'integer minor units');
  ins('e', 5000, s, '2026-11-15');
  ins('f', null, null, null);
});

test('exactly one version is current, only a published one; a published version refuses an UPDATE and its rows are frozen', () => {
  const d = db();
  const one1 = draft(d, 1);
  assert.throws(() => run(d, 'UPDATE formation_catalogue_versions SET is_current = 1 WHERE id = ?', one1.v), /CHECK/, 'a draft is never current');
  assert.throws(() => run(d, "UPDATE formation_catalogue_versions SET status = 'published' WHERE id = ?", one1.v), /CHECK/, 'published names who and when');
  publish(d, one1.v);
  const v2 = Number(run(d, 'INSERT INTO formation_catalogue_versions (version) VALUES (2)').lastInsertRowid);
  run(d, "UPDATE formation_catalogue_versions SET status = 'published', published_by = 1, published_at = '2026-11-16T00:00:00Z' WHERE id = ?", v2);
  assert.throws(() => run(d, 'UPDATE formation_catalogue_versions SET is_current = 1 WHERE id = ?', v2), /UNIQUE/, 'two current versions');
  // The published version refuses an edit; retiring it and handing "current" over are allowed.
  assert.throws(() => run(d, "UPDATE formation_catalogue_versions SET notes = 'edited' WHERE id = ?", one1.v), /immutable/);
  assert.throws(() => run(d, "UPDATE formation_catalogue_versions SET status = 'draft', is_current = 0 WHERE id = ?", one1.v), /immutable/);
  assert.throws(() => run(d, 'DELETE FROM formation_catalogue_versions WHERE id = ?', one1.v), /never deleted/);
  run(d, 'UPDATE formation_catalogue_versions SET is_current = 0 WHERE id = ?', one1.v);
  run(d, 'UPDATE formation_catalogue_versions SET is_current = 1 WHERE id = ?', v2);
  run(d, "UPDATE formation_catalogue_versions SET status = 'retired', retired_at = '2026-11-16T00:00:00Z' WHERE id = ?", one1.v);
  assert.throws(() => run(d, "UPDATE formation_catalogue_versions SET status = 'published' WHERE id = ?", one1.v), /immutable/, 'retired stays retired');
  // Its rows: no insert, update or delete.
  assert.throws(() => run(d, "UPDATE formation_entity_forms SET label = 'x' WHERE id = ?", one1.f), /immutable/);
  assert.throws(() => run(d, 'DELETE FROM formation_entity_forms WHERE id = ?', one1.f), /immutable/);
  assert.throws(() => run(d, "INSERT INTO formation_rules (version_id, rule_key, kind, rule_json) VALUES (?, 'r', 'warn', '{}')", one1.v), /immutable/);
  assert.throws(() => run(d, "INSERT INTO formation_pack_items (version_id, form_id, item_key, phase, kind, acting_party, title) VALUES (?, ?, 'p', 'filing', 'filing', 'axal', 'File')", one1.v, one1.f), /immutable/);
  assert.throws(() => run(d, "INSERT INTO formation_rules (version_id, rule_key, kind, rule_json) VALUES (999, 'r', 'warn', '{}')"), /immutable/, 'no version, no row');
});

test('a row belongs to its parent\'s version', () => {
  const d = db();
  const a = draft(d, 1);
  const v2 = Number(run(d, 'INSERT INTO formation_catalogue_versions (version) VALUES (2)').lastInsertRowid);
  assert.throws(() => run(d, "INSERT INTO formation_form_facts (version_id, form_id, fact_key, status) VALUES (?, ?, 'k', 'not_recorded')", v2, a.f), /parent/);
  assert.throws(() => run(d, "INSERT INTO formation_entity_forms (version_id, jurisdiction_id, form_key, label) VALUES (?, ?, 'x', 'X')", v2, a.j), /parent/);
  assert.throws(() => run(d, "INSERT INTO formation_jurisdictions (version_id, country) VALUES (?, 'gb')", v2), /CHECK/, 'ISO-2, upper case');
  assert.throws(() => run(d, "INSERT INTO formation_jurisdictions (version_id, country) VALUES (?, 'GB')", a.v), /UNIQUE/, 'one GB per version');
});

test('restricted places are not versioned and carry a source and a day', () => {
  const d = db();
  const { s } = draft(d);
  assert.throws(() => run(d, "INSERT INTO formation_restricted_jurisdictions (place, kind, source_id, checked_by) VALUES ('KP', 'sanctioned', ?, 1)", s), /NOT NULL|CHECK/);
  run(d, "INSERT INTO formation_restricted_jurisdictions (place, kind, source_id, checked_on, checked_by) VALUES ('KP', 'sanctioned', ?, '2026-11-15', 1)", s);
});

test('the read service: nothing current reads null; the current version\'s form with facts, fees and pack', async () => {
  const d = db();
  const env: any = { DB: d1Over(d) };
  assert.equal(await currentVersion(env), null);
  const { v, s, f } = draft(d);
  run(d, "INSERT INTO formation_form_facts (version_id, form_id, fact_key, value, status, blocking, source_id, checked_on) VALUES (?, ?, 'min_directors', '1', 'recorded', 1, ?, '2026-11-15')", v, f, s);
  run(d, "INSERT INTO formation_form_facts (version_id, form_id, fact_key, status) VALUES (?, ?, 'psc_register', 'not_recorded')", v, f);
  run(d, "INSERT INTO formation_fee_lines (version_id, form_id, line_key, label, payee, collected_by, currency, timing) VALUES (?, ?, 'registration', 'Registration', 'Companies House', 'payee', 'GBP', 'at_formation')", v, f);
  run(d, "INSERT INTO formation_pack_items (version_id, form_id, item_key, phase, kind, acting_party, title, position) VALUES (?, ?, 'in01', 'filing', 'filing', 'axal', 'File IN01', 2)", v, f);
  run(d, "INSERT INTO formation_pack_items (version_id, form_id, item_key, phase, kind, acting_party, title, template_key, position) VALUES (?, ?, 'articles', 'before_filing', 'document', 'counsel', 'Articles', 'uk_articles_of_association', 1)", v, f);
  assert.equal(await catalogueForm(env, 'uk_ltd'), null, 'a draft is never read as current');
  assert.equal((await catalogueForm(env, 'uk_ltd', { version: await versionByNumber(env, 1) }))?.form.key, 'uk_ltd', 'a draft is read by its number');
  publish(d, v);
  const cur = await currentVersion(env);
  assert.deepEqual({ version: cur?.version, status: cur?.status }, { version: 1, status: 'published' });
  const r = await catalogueForm(env, 'uk_ltd');
  assert.ok(r);
  assert.deepEqual(r.jurisdiction, { country: 'GB', subdivision: null, registry_name: 'Companies House', vocabulary: { company: 'company' } });
  assert.deepEqual(r.form, { key: 'uk_ltd', label: 'UK Private Limited (Ltd)', offer_mode: 'guided', legal_form_family: null, legacy_gate: 'uk_ltd', legacy_display: null, allow_axal_collection: false });
  assert.deepEqual(r.facts.map((x) => [x.key, x.status, x.value, x.blocking, x.source?.title ?? null, x.checked_on]), [
    ['min_directors', 'recorded', '1', true, 'Companies House: set up a limited company', '2026-11-15'],
    ['psc_register', 'not_recorded', null, false, null, null],
  ]);
  assert.equal(r.fees[0].amount_cents, null, 'not recorded, never 0');
  assert.deepEqual(r.pack.map((x) => [x.key, x.counsel_required]), [['articles', true], ['in01', true]], 'in order; counsel required by default');
  assert.equal(await catalogueForm(env, 'nope'), null);
  assert.equal(await versionByNumber(env, 0), null);
});
