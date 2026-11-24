/**
 * D7828 (#7828): the research_company_facts migration on the canonical migrated schema — the
 * closed lists are table constraints equal to the Worker's lists, a found fact needs a value and a
 * passage or field, an absence carries no value, a contact path is a page link, value, passage and
 * source are never edited, and the schema migration writes no rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/research_company_facts_schema_7828.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { loadSchema, SCHEMA_OPTIONS } from './_schema_once.mjs';
import { COMPANY_FACT_ATTRIBUTES, FACT_PASSAGE_MAX, FACT_VALUE_MAX } from '../src/services/researchCompanyFacts.ts';
import { EVIDENCE_STATES, STATEMENT_TYPES } from '../src/services/researchEvidenceVocabulary.ts';

const MIGRATION = readFileSync(
  new URL('../sql/migrations/202611232026_7828_research_company_facts.sql', import.meta.url),
  'utf8',
);

function db() {
  const d = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  loadSchema(d);
  return d;
}
let n = 0;
const base = () => ({
  company_uid: 'synthetic-7828-schema',
  fact_key: `k${++n}`,
  attribute: 'product',
  value: 'Synthetic product',
  statement_type: 'company_statement',
  source_url: 'https://schema.example/page',
  publisher: 'Synthetic publisher',
  passage: 'A short synthetic passage.',
  source_field: null as string | null,
  market_country: null as string | null,
  published_at: null as string | null,
  retrieved_at: '2026-11-02',
  reviewed_at: '2026-11-20',
  reviewed_by: 'Synthetic reviewer',
  state: 'found',
  manifest_name: 'schema-7828',
});
function insert(d: DatabaseSync, over: Record<string, unknown> = {}) {
  const row = { ...base(), ...over };
  const cols = Object.keys(row);
  d.prepare(`INSERT INTO research_company_facts (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(
    ...(Object.values(row) as any[]),
  );
  return row.fact_key as string;
}

test('the table, its columns, unique key, index and trigger exist, and the migration writes no rows', () => {
  const d = db();
  try {
    const cols = (d.prepare('PRAGMA table_info(research_company_facts)').all() as any[]).map((c) => c.name);
    for (const c of ['company_uid', 'fact_key', 'attribute', 'value', 'statement_type', 'source_url', 'publisher', 'passage',
      'source_field', 'market_country', 'published_at', 'retrieved_at', 'reviewed_at', 'reviewed_by', 'state',
      'conflicts_with_key', 'replaces_key', 'replaced_by_key', 'manifest_name'])
      assert.ok(cols.includes(c), c);
    assert.equal((d.prepare('SELECT COUNT(*) AS n FROM research_company_facts').get() as any).n, 0);
    assert.doesNotMatch(MIGRATION.replace(/^\s*--.*$/gm, ''), /\bINSERT\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\b/i);
    const names = (d.prepare(`SELECT name FROM sqlite_master WHERE tbl_name='research_company_facts'`).all() as any[]).map((r) => r.name);
    assert.ok(names.includes('idx_research_company_facts_company'));
    assert.ok(names.includes('research_company_facts_kept'));
    insert(d, { fact_key: 'dup' });
    assert.throws(() => insert(d, { fact_key: 'dup' }), /UNIQUE/);
    insert(d, { fact_key: 'dup', company_uid: 'synthetic-7828-other' });
  } finally {
    d.close();
  }
});

test("the closed lists are table constraints equal to the Worker's lists", () => {
  const d = db();
  try {
    for (const attribute of COMPANY_FACT_ATTRIBUTES)
      insert(d, { attribute, value: attribute === 'contact_path' ? 'https://schema.example/apply' : 'Synthetic value' });
    for (const statement_type of STATEMENT_TYPES) insert(d, { statement_type });
    for (const state of EVIDENCE_STATES)
      insert(d, ['not_found', 'not_offered', 'source_unavailable'].includes(state)
        ? { state, value: null, passage: null }
        : { state });
    assert.throws(() => insert(d, { attribute: 'price' }), /CHECK/);
    assert.throws(() => insert(d, { attribute: 'sector' }), /CHECK/);
    assert.throws(() => insert(d, { statement_type: 'observation' }), /CHECK/);
    assert.throws(() => insert(d, { state: 'not_recorded', value: null, passage: null }), /CHECK/);
    assert.throws(() => insert(d, { value: 'x'.repeat(FACT_VALUE_MAX + 1) }), /CHECK/);
    insert(d, { value: 'x'.repeat(FACT_VALUE_MAX) });
    assert.throws(() => insert(d, { passage: 'x'.repeat(FACT_PASSAGE_MAX + 1) }), /CHECK/);
    insert(d, { passage: 'x'.repeat(FACT_PASSAGE_MAX) });
  } finally {
    d.close();
  }
});

test('a found fact needs a value and a passage or field; an absence carries none; links and codes are shaped', () => {
  const d = db();
  try {
    assert.throws(() => insert(d, { value: null }), /CHECK/);
    assert.throws(() => insert(d, { passage: null }), /CHECK/);
    insert(d, { passage: null, source_field: 'registered_activity' });
    for (const state of ['not_found', 'not_offered', 'source_unavailable']) {
      assert.throws(() => insert(d, { state, passage: null }), /CHECK/, `${state} with a value`);
      assert.throws(() => insert(d, { state, value: null }), /CHECK/, `${state} with a passage`);
      insert(d, { state, value: null, passage: null });
    }
    assert.throws(() => insert(d, { source_url: 'http://schema.example/' }), /CHECK/);
    assert.throws(() => insert(d, { source_url: null }), /NOT NULL/);
    assert.throws(() => insert(d, { attribute: 'contact_path', value: 'Synthetic Person' }), /CHECK/);
    insert(d, { attribute: 'contact_path', value: 'https://schema.example/apply' });
    assert.throws(() => insert(d, { market_country: 'PT' }), /CHECK/);
    assert.throws(() => insert(d, { attribute: 'markets_served', market_country: 'pt' }), /CHECK/);
    insert(d, { attribute: 'markets_served', value: 'Portugal', market_country: 'PT' });
    assert.throws(() => insert(d, { retrieved_at: 'last week' }), /CHECK/);
    assert.throws(() => insert(d, { replaced_by_key: 'k-new' }), /CHECK/);
  } finally {
    d.close();
  }
});

test('value, passage and source are never edited; a fact is marked outdated and linked to its replacement once', () => {
  const d = db();
  try {
    const key = insert(d);
    for (const set of ["value='Edited'", "passage='Edited'", "source_url='https://edited.example/'", "publisher='Edited'",
      "reviewed_by='Someone else'", "retrieved_at='2026-01-01'", "state='not_found'", "conflicts_with_key='other'"])
      assert.throws(() => d.exec(`UPDATE research_company_facts SET ${set} WHERE fact_key='${key}'`), /never edited/, set);
    d.exec(`UPDATE research_company_facts SET state='outdated', replaced_by_key='k-new' WHERE fact_key='${key}'`);
    const row = d.prepare('SELECT state, replaced_by_key FROM research_company_facts WHERE fact_key=?').get(key) as any;
    assert.deepEqual([row.state, row.replaced_by_key], ['outdated', 'k-new']);
    assert.throws(() => d.exec(`UPDATE research_company_facts SET replaced_by_key='k-other' WHERE fact_key='${key}'`), /never edited/);
    assert.throws(() => d.exec(`UPDATE research_company_facts SET state='found' WHERE fact_key='${key}'`), /never edited/);
  } finally {
    d.close();
  }
});
