/**
 * D6690 (#6690) — version 1 of the formation catalogue, "legacy parity", generated from the code arrays. On the full
 * migrated schema (the seed applied as every database applies it), each code array is rebuilt from version 1's rows and
 * compared with the array: equal. No seeded fact is recorded, no fee line has an amount, and the generator gives the
 * committed file byte for byte.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/formation_seed_6690.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { NON_US_COUNSEL, OPERATES_NOT_RECORDED, readArrays, seedFile, seedSql } from '../../scripts/build-formation-seed.mjs';
import { catalogueForm, currentVersion } from '../src/services/formationCatalogue.ts';

const arrays = await readArrays();
const d = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
loadSchema(d);
const all = (sql: string, ...p: unknown[]) => (d.prepare(sql).all(...(p as any[])) as any[]).map((r) => ({ ...r }));
const V1 = (all('SELECT id FROM formation_catalogue_versions WHERE version = 1')[0] as any).id;
const forms = all(`SELECT f.*, j.country, j.subdivision FROM formation_entity_forms f JOIN formation_jurisdictions j ON j.id = f.jurisdiction_id
  WHERE f.version_id = ? ORDER BY f.id`, V1);
const items = (formId: number, kind: string) => all('SELECT * FROM formation_pack_items WHERE form_id = ? AND kind = ? ORDER BY position', formId, kind);
const facts = (formId: number) => all('SELECT * FROM formation_form_facts WHERE form_id = ? ORDER BY id', formId);

// Mutation checked (in the generator): a form dropped or reordered; a display field dropped; a template out of order; a
// template title changed; Wyoming's charter not counsel-required, or another US template made so; a fee's source or
// currency wrong; a jurisdiction code split wrongly; an event dropped or reordered; a certificate title dropped; a next
// step dropped. Each fails the comparison of its array.
test('each code array, rebuilt from version 1, equals the array', () => {
  const JURISDICTIONS = forms.map((f) => ({ id: f.form_key, label: f.label, ...JSON.parse(f.legacy_display_json), templates: items(f.id, 'document').map((i) => i.template_key) }));
  assert.deepEqual(JURISDICTIONS, arrays.JURISDICTIONS);

  const templates: Record<string, { title: string }> = {};
  for (const f of forms) for (const i of items(f.id, 'document')) templates[i.template_key] = { title: i.title };
  assert.deepEqual(templates, arrays.JURISDICTION_TEMPLATES);

  const us = forms.filter((f) => f.country === 'US');
  assert.deepEqual(new Set(us.flatMap((f) => items(f.id, 'document').filter((i) => i.counsel_required === 1).map((i) => i.template_key))), arrays.COUNSEL_REQUIRED_TEMPLATES);

  const fees = Object.fromEntries(forms.map((f) => {
    const line = all(`SELECT l.*, s.title, s.url FROM formation_fee_lines l JOIN formation_sources s ON s.id = l.source_id WHERE l.form_id = ?`, f.id)[0];
    return [f.form_key, { amount_cents: line.amount_cents, currency: line.currency.toLowerCase(), source: line.title, source_url: line.url, checked_on: line.checked_on }];
  }));
  assert.deepEqual(fees, arrays.STATE_FILING_FEES);

  assert.deepEqual(Object.fromEntries(forms.map((f) => [f.form_key, { jurisdiction: f.subdivision ? `${f.country}-${f.subdivision}` : f.country, legal_form: f.legal_form_family }])), arrays.JURISDICTION_MAP);

  const events = Object.fromEntries(forms.map((f) => [f.form_key, facts(f.id).filter((x) => /^compliance_event_\d+$/.test(x.fact_key))
    .sort((a, b) => Number(a.fact_key.split('_').pop()) - Number(b.fact_key.split('_').pop())).map((x) => JSON.parse(x.value))]).filter(([, e]) => e.length));
  assert.deepEqual(events, arrays.STANDARD_EVENTS);

  assert.deepEqual(Object.fromEntries(forms.flatMap((f) => facts(f.id).filter((x) => x.fact_key === 'certificate_title').map((x) => [f.form_key, x.value]))), arrays.JURISDICTION_CERT_TITLES);

  assert.deepEqual(Object.fromEntries(forms.map((f) => [f.form_key, items(f.id, 'step').map((i) => i.title)]).filter(([, s]) => s.length)), arrays.HANDOFF_NEXT_STEPS);
});

// Mutation checked: a fact seeded `recorded` (fails); a fee amount seeded (fails); a non-US item not counsel-required (fails);
// the operates fact missing or given a value (fails); legacy_gate not '1' (fails).
test('nothing is recorded: no fact is recorded, no fee has an amount; the six forms carry the legacy gate', () => {
  assert.deepEqual(all('SELECT DISTINCT status FROM formation_form_facts WHERE version_id = ? ORDER BY status', V1).map((r) => r.status), ['not_recorded', 'provisional']);
  assert.equal(all('SELECT COUNT(*) AS n FROM formation_fee_lines WHERE version_id = ? AND amount_cents IS NOT NULL', V1)[0].n, 0);
  assert.equal(all('SELECT COUNT(*) AS n FROM formation_fee_lines WHERE version_id = ? AND checked_on IS NOT NULL', V1)[0].n, 0);
  assert.deepEqual(forms.map((f) => [f.form_key, f.legacy_gate]), arrays.JURISDICTIONS.map((j: any) => [j.id, '1']));
  for (const key of NON_US_COUNSEL) {
    const f = forms.find((x) => x.form_key === key);
    assert.ok(all('SELECT counsel_required FROM formation_pack_items WHERE form_id = ?', f.id).every((i) => i.counsel_required === 1), key);
  }
  const operates = all(`SELECT f.form_key, x.status, x.value FROM formation_form_facts x JOIN formation_entity_forms f ON f.id = x.form_id
    WHERE x.version_id = ? AND x.fact_key = 'registration_where_operates' ORDER BY f.form_key`, V1);
  assert.deepEqual(operates, [...OPERATES_NOT_RECORDED].sort().map((k) => ({ form_key: k, status: 'not_recorded', value: null })));
});

// Mutation checked: version 1 left a draft (fails); not current (fails).
test('version 1 is published and current, and the read service serves it', async () => {
  const env: any = { DB: d1Over(d) };
  const v = await currentVersion(env);
  assert.deepEqual({ version: v?.version, status: v?.status }, { version: 1, status: 'published' });
  const wy = await catalogueForm(env, 'us_wy_ccorp');
  assert.ok(wy, 'a form of the current version');
  assert.equal(wy!.form.form_key ?? wy!.form.key, 'us_wy_ccorp');
});

// Mutation checked: a clock in the output (fails); the committed file edited by hand (fails).
test('the generator gives the committed file byte for byte, and again on unchanged arrays', () => {
  const file = seedFile();
  assert.ok(file, 'the seed file exists');
  const once = seedSql(arrays);
  assert.equal(readFileSync(file!, 'utf8'), once);
  assert.equal(seedSql(arrays), once, 'the same arrays, the same bytes');
});
