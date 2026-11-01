/**
 * D1520 (#3772, deck v2 A21) — the record sources: market size, the financial
 * projection, the competition table, round terms, use of funds by section,
 * and the narrative's and positioning's words.
 *
 * Each source has a fixture; nothing recorded is `not_recorded`, never 0; a
 * projection is graded Projected and carries its label, whatever its adapter
 * reports. The database is the baseline plus every migration above the
 * cutoff, schema only, as deck_sources_d896.test.ts builds it. Every person,
 * venture and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_record_sources_d1520.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DECK_SOURCES, GRADES, readSources, sanitizeBinding, type SourceItem } from '../src/services/decks/sources.ts';
import {
  COMPETITOR_NAMES_MAX, NARRATIVE_SECTION_KEYS, POSITIONING_KIND_KEYS, PROJECTION_FOOTNOTE, PROJECTION_LABEL, RECORD_SOURCES, fundSlotKey, nestedMarket,
} from '../src/services/decks/recordSources.ts';
import { NARRATIVE_SECTIONS, POSITIONING_KINDS } from '../src/services/narrative/store.ts';
import { FUND_SECTIONS } from '../src/services/raiseCycle.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');
const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

const FOUNDER = 10, P = 1;
const TODAY = '2026-11-01';
const NEW_KEYS = RECORD_SOURCES.flatMap((a) => a.slots.map((s) => s.key));

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)').run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  db.exec(`INSERT INTO projects (id, name, founder_id, updated_at) VALUES (${P}, 'Kestrel Labs', 1001, '2026-10-20')`);
  return db;
}
async function read(db: DatabaseSync) {
  const saved = console.warn; console.warn = () => {};
  try {
    const { items } = await readSources({ env: { DB: d1Over(db) } as any, projectId: P, today: TODAY, mercury: null });
    return new Map(items.map((i) => [i.source_key, i]));
  } finally { console.warn = saved; }
}
const rec = (m: Map<string, SourceItem>, k: string) => {
  const it = m.get(k);
  assert.ok(it, `${k} has no item`);
  assert.equal(it!.state, 'recorded', `${k}: ${it!.state}`);
  return it!;
};

// 1 ───────────────────────────────────────────────────────────────────────────
test('nothing recorded: every new slot is Not recorded with the module that fills it, never 0', async () => {
  const m = await read(fixture());
  for (const k of NEW_KEYS) {
    const it = m.get(k)!;
    assert.ok(it, k);
    assert.deepEqual([it.state, it.value, it.grade], ['not_recorded', null, 'Not recorded'], k);
    assert.ok(it.module.includes(' › ') && /\?project=1$/.test(it.href), k);
  }
  // Every new key binds: sanitizeBinding keeps it.
  for (const k of NEW_KEYS) assert.equal(sanitizeBinding({ source_key: k })?.source_key, k, k);
  // The registry carries them, once each.
  const all = DECK_SOURCES.flatMap((a) => a.slots.map((s) => s.key));
  assert.equal(new Set(all).size, all.length, 'a slot key twice');
  for (const k of NEW_KEYS) assert.ok(all.includes(k), k);
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('market: TAM, SAM and SOM are Stated, Sourced with a market source, and must nest', async () => {
  // Mutations checked: the market_sources count ignored (always typed) → the Sourced assert fails;
  // nestedMarket returning its inputs → the SAM > TAM assert fails.
  const db = fixture();
  db.exec(`UPDATE projects SET tam = 4200000000, sam = 500000000, som = 20000000 WHERE id = ${P}`);
  let m = await read(db);
  assert.deepEqual(['validate.market_tam', 'validate.market_sam', 'validate.market_som'].map((k) => [rec(m, k).value, rec(m, k).grade, rec(m, k).source]),
    [[4200000000, 'Stated', 'Typed'], [500000000, 'Stated', 'Typed'], [20000000, 'Stated', 'Typed']]);
  assert.equal(rec(m, 'validate.market_tam').as_of, '2026-10-20');
  db.exec(`INSERT INTO market_sources (project_id, title, url) VALUES (${P}, 'Industry report', 'https://example.test/report')`);
  m = await read(db);
  assert.deepEqual([rec(m, 'validate.market_tam').grade, rec(m, 'validate.market_tam').source], ['Sourced', 'Document']);
  db.exec(`UPDATE projects SET sam = 9000000000 WHERE id = ${P}`);
  m = await read(db);
  assert.equal(rec(m, 'validate.market_tam').value, 4200000000);
  assert.deepEqual([m.get('validate.market_sam')!.state, m.get('validate.market_som')!.state], ['not_recorded', 'not_recorded'], 'a SAM above TAM is not a market');
  db.exec(`UPDATE projects SET sam = 500000000, som = 0 WHERE id = ${P}`);
  m = await read(db);
  assert.equal(m.get('validate.market_som')!.state, 'not_recorded', '0 is not a recorded market');
  assert.deepEqual(nestedMarket(10, 20, 5), { tam: 10, sam: null, som: null });
  assert.deepEqual(nestedMarket(10, 8, 9), { tam: 10, sam: 8, som: null });
  assert.deepEqual(nestedMarket(10, null, 12), { tam: 10, sam: null, som: null });
  assert.deepEqual(nestedMarket(null, 8, 9), { tam: null, sam: 8, som: null });
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('financials: every figure is Projected with its label and footnote; never Measured, whatever the adapter says', async () => {
  // Mutations checked: readSources taking the origin's grade for a projection → the Projected asserts fail;
  // the projection field dropped → the label assert fails; the missing table answered unreadable → the first assert fails.
  const db = fixture();
  db.exec('DROP TABLE financial_models');
  let m = await read(db);
  assert.equal(m.get('raise.projection_runway')!.state, 'not_recorded', 'no model yet is not recorded, not unreadable');
  db.exec('CREATE TABLE financial_models (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL UNIQUE, assumptions_json TEXT NOT NULL DEFAULT \'{}\', computed_json TEXT, sensitivity_json TEXT, capital_recompute_json TEXT, updated_by INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const months = Array.from({ length: 24 }, (_, i) => ({ month: i + 1, revenue: 1000 * (i + 1), cash: 100000 - i * 1000 }));
  db.prepare('INSERT INTO financial_models (project_id, computed_json, updated_at) VALUES (?, ?, ?)')
    .run(P, JSON.stringify({ months, runway_months: 18.5, breakeven_month: null, ending_cash: 76000 }), '2026-10-15 09:00:00');
  m = await read(db);
  const rev = rec(m, 'raise.projection_revenue_12m');
  assert.equal(rev.value, 78000, 'months 1 to 12');
  for (const k of ['raise.projection_revenue_12m', 'raise.projection_runway', 'raise.projection_ending_cash']) {
    const it = rec(m, k);
    assert.equal(it.grade, 'Projected', k);
    assert.notEqual(it.grade, 'Measured', k);
    assert.deepEqual(it.projection, { label: PROJECTION_LABEL, footnote: PROJECTION_FOOTNOTE }, k);
    assert.equal(it.as_of, '2026-10-15', k);
  }
  assert.equal(m.get('raise.projection_breakeven')!.state, 'not_recorded', 'no break-even month in the model is not recorded, never 0');
  assert.equal(m.get('validate.market_tam')!.projection, undefined, 'only a projection carries the label');
  // A projection adapter that reports a connector origin is still Projected.
  DECK_SOURCES.push({ id: 'probe', area: 'raise', module: 'Raise › Use of funds', href: () => '/raise/use-of-funds?project=1', projection: true,
    slots: [{ key: 'raise.probe', label: 'Probe', unit: 'usd' }], read: async () => ({ 'raise.probe': { value: 1, origin: 'connector' } }) });
  try {
    const probe = rec(await read(db), 'raise.probe');
    assert.deepEqual([probe.grade, probe.source, probe.projection?.label], ['Projected', 'Connector', PROJECTION_LABEL]);
  } finally { DECK_SOURCES.pop(); }
  // Projected is a grade a binding keeps, and the weakest.
  assert.equal(GRADES[GRADES.length - 1], 'Projected');
  assert.equal(sanitizeBinding({ source_key: 'raise.projection_runway', grade: 'Projected' })?.grade, 'Projected');
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('competition table: direct and adjacent counts and names; Sourced only when every one has a source', async () => {
  const db = fixture();
  db.exec(`INSERT INTO competitor_analyses (id, user_id, project_id) VALUES (1, ${FOUNDER}, ${P})`);
  db.exec(`INSERT INTO competitor_candidates (id, analysis_id, name, category, created_at) VALUES
    (11, 1, 'Rival A', 'direct', '2026-09-01'), (12, 1, 'Rival B', 'adjacent', '2026-09-02'), (13, 1, 'Rival C', 'direct', '2026-09-03')`);
  db.exec(`INSERT INTO competitor_signals (analysis_id, candidate_id, signal_type, observed_on, source_url) VALUES
    (1, 11, 'pricing', '2026-10-01', 'https://example.test/a'), (1, 12, 'launch', '2026-10-05', NULL), (1, 13, 'hire', '2026-10-02', 'https://example.test/c')`);
  let m = await read(db);
  assert.deepEqual([rec(m, 'validate.competitors_direct').value, rec(m, 'validate.competitors_adjacent').value], [2, 1]);
  assert.equal(rec(m, 'validate.competitors_names').value, 'Rival A · Rival C · Rival B');
  assert.equal(rec(m, 'validate.competitors_direct').grade, 'Stated', 'one without a source');
  assert.equal(rec(m, 'validate.competitors_direct').as_of, '2026-10-05');
  db.exec(`UPDATE competitor_signals SET source_url = 'https://example.test/b' WHERE candidate_id = 12`);
  m = await read(db);
  assert.equal(rec(m, 'validate.competitors_names').grade, 'Sourced');
  // A name the venture stopped tracking leaves the table.
  db.exec(`INSERT INTO competitor_tracking (uid, project_id, name_norm, stopped_at) VALUES ('t1', ${P}, 'rival c', '2026-10-10')`);
  m = await read(db);
  assert.deepEqual([rec(m, 'validate.competitors_direct').value, rec(m, 'validate.competitors_names').value], [1, 'Rival A · Rival B']);
  for (let i = 0; i < COMPETITOR_NAMES_MAX + 2; i++) db.prepare("INSERT INTO competitor_candidates (analysis_id, name, category) VALUES (1, ?, 'direct')").run(`Extra ${i}`);
  assert.match(String(rec(await read(db), 'validate.competitors_names').value), / · \+4 more$/);
});

// 5 ───────────────────────────────────────────────────────────────────────────
test('round terms: pre-money, post-money and dilution only when recorded; Reviewed under counsel', async () => {
  // Mutations checked: post-money written without a target → the "only pre" assert fails; the dilution maths inverted → the 20% assert fails.
  const db = fixture();
  let m = await read(db);
  assert.deepEqual(['raise.pre_money', 'raise.post_money', 'raise.dilution_pct'].map((k) => m.get(k)!.state), ['not_recorded', 'not_recorded', 'not_recorded']);
  db.exec(`INSERT INTO raise_rounds (id, uid, project_id, name, status, pre_money, updated_at) VALUES (1, 'r1', ${P}, 'Seed', 'active', 8000000, '2026-10-09')`);
  m = await read(db);
  assert.deepEqual([rec(m, 'raise.pre_money').value, rec(m, 'raise.pre_money').grade], [8000000, 'Stated']);
  assert.equal(m.get('raise.post_money')!.state, 'not_recorded', 'no target, no post-money');
  db.exec(`UPDATE raise_rounds SET target_amount = 2000000 WHERE id = 1`);
  m = await read(db);
  assert.deepEqual([rec(m, 'raise.post_money').value, rec(m, 'raise.dilution_pct').value], [10000000, 20]);
  db.exec(`INSERT INTO round_calls (uid, project_id, round_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, created_by, terms_hash, counsel_approved_hash, counsel_approved_by, counsel_approved_at, counsel_approval_reference, pre_money_cents, updated_at)
    VALUES ('rc1', ${P}, 1, 'Seed call', 200000000, 'equity', 'Priced round', 2500000, '2026-12-15', ${FOUNDER}, 'h1', 'h1', 77, '2026-10-11', 'ref-1', 1200000000, '2026-10-11')`);
  m = await read(db);
  assert.deepEqual([rec(m, 'raise.pre_money').value, rec(m, 'raise.pre_money').grade, rec(m, 'raise.pre_money').source], [12000000, 'Reviewed', 'Document']);
  assert.deepEqual([rec(m, 'raise.post_money').value, rec(m, 'raise.dilution_pct').value], [14000000, 14.3]);
  assert.equal(rec(m, 'raise.post_money').as_of, '2026-10-11');
});

// 6 ───────────────────────────────────────────────────────────────────────────
test('use of funds by section: one percent per section, a 0% section included, keys a binding keeps', async () => {
  const db = fixture();
  db.prepare('UPDATE projects SET use_of_funds = ? WHERE id = ?')
    .run(JSON.stringify([{ label: 'Product & engineering', pct: 60 }, { label: 'GTM: sales and marketing', pct: 40 }]), P);
  const m = await read(db);
  assert.deepEqual(FUND_SECTIONS.map((s) => rec(m, fundSlotKey(s.key)).value), [60, 40, 0, 0, 0]);
  assert.equal(fundSlotKey('go-to-market'), 'raise.use_of_funds.go_to_market');
  assert.equal(rec(m, 'raise.use_of_funds').state, 'recorded', 'the D896 text slot stays');
});

// 7 ───────────────────────────────────────────────────────────────────────────
test('narrative and positioning words: the latest saved version, else the live deck; the store’s own lists', async () => {
  // Mutation checked: reading the latest narrative_version_meta row instead of a deck version → the version 2 asserts fail.
  assert.deepEqual(NARRATIVE_SECTION_KEYS.map(([k, l]) => [k, l]), NARRATIVE_SECTIONS.map((s) => [s.key, s.label]));
  assert.deepEqual([...POSITIONING_KIND_KEYS], [...POSITIONING_KINDS]);
  const db = fixture();
  db.exec(`INSERT INTO spinout_deck_overrides (project_id, version, field_key, value) VALUES (${P}, 0, 'problem.framing', 'Live problem words')`);
  db.exec(`INSERT INTO narrative_positioning (project_id, version, kind, position, text, updated_at) VALUES
    (${P}, NULL, 'one_liner', 0, 'Core one-liner', '2026-10-01'), (${P}, NULL, 'line', 0, 'First line', '2026-10-01'), (${P}, NULL, 'line', 1, 'Second line', '2026-10-02')`);
  let m = await read(db);
  assert.equal(rec(m, 'raise.narrative.problem').value, 'Live problem words');
  assert.equal(rec(m, 'raise.narrative.problem').grade, 'Stated');
  assert.equal(rec(m, 'raise.positioning.one_liner').value, 'Core one-liner');
  assert.equal(rec(m, 'raise.positioning.line').value, 'First line\nSecond line');
  assert.equal(m.get('raise.narrative.solution')!.state, 'not_recorded');
  // A saved version (2) is read in preference to the live deck.
  db.exec(`INSERT INTO spinout_deck_overrides (project_id, version, field_key, value) VALUES (${P}, 2, '_version', ''), (${P}, 2, 'problem.framing', 'Version two problem')`);
  db.exec(`INSERT INTO narrative_sections (project_id, version, section, body, source_label, updated_at) VALUES (${P}, 2, 'solution', 'Our solution', 'document', '2026-10-12')`);
  db.exec(`INSERT INTO narrative_positioning (project_id, version, kind, position, text, updated_at) VALUES (${P}, 2, 'one_liner', 0, 'Version two one-liner', '2026-10-12')`);
  db.exec(`INSERT INTO narrative_version_meta (uid, project_id, version, updated_at) VALUES ('n9', ${P}, 9, '2026-10-30')`);
  m = await read(db);
  assert.equal(rec(m, 'raise.narrative.problem').value, 'Version two problem');
  assert.deepEqual([rec(m, 'raise.narrative.solution').value, rec(m, 'raise.narrative.solution').grade], ['Our solution', 'Sourced']);
  assert.equal(rec(m, 'raise.positioning.one_liner').value, 'Version two one-liner');
  assert.equal(rec(m, 'raise.positioning.line').value, 'First line\nSecond line', 'the core where the version has none');
  // The existing count slot stays as D896 wrote it.
  assert.equal(m.get('raise.narrative')!.unit, 'count');
});
