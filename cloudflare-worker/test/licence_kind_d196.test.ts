/**
 * D196 — a licence says which KIND it is.
 *
 * WHAT THIS FILE IS FOR. `AdminLicences.jsx` has shipped a Kind control, a
 * Kind pill and a white-label refusal since the licence console was built, and
 * every one of them reads `d.kind` off a table that had no such column. So
 * `d.kind` was `undefined` on every row ever rendered: the pill fell through
 * to its subsidiary branch for all of them, and the create path refused
 * white-label outright because — in its own words — "the ledger has no kind
 * column". Migration 279 gives it one.
 *
 * WHY THE FRESH BUILD IS THE TEST AND A SOURCE SCAN IS NOT. A regex can see
 * that 279 contains the word `kind`; it cannot see whether SQLite ACCEPTS
 * `ALTER TABLE ... ADD COLUMN ... CHECK (...)`, which is the one construct
 * this migration rests on and the one easiest to assume wrongly. So the column
 * is asserted against a database built the way `migrate-d1 --bootstrap` builds
 * one, and the CHECK is asserted by trying to violate it.
 *
 * PAIRED, so the migration is shown to be what changed: `freshDb([M279])`
 * reproduces the before-half, where the column is absent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { splitStatements } from './_baseline.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = resolve(HERE, '../sql');
const MIGRATIONS = resolve(SQL_DIR, 'migrations');
const M279 = '279_licence_kind.sql';

const migrationNames = () =>
  readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort(compareMigrations);

/** A freshly provisioned database: the baseline, then every migration above
 *  the cutoff. `skip` drops one by filename, which is how the before-half of
 *  each pair below is built. */
function freshDb(skip: string[] = []) {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(SQL_DIR, 'schema_baseline.sql'), 'utf8'));
  for (const name of migrationNames()) {
    if (migrationNumber(name) <= BASELINE_CUTOFF || skip.includes(name)) continue;
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, name), 'utf8'))) {
      try { db.exec(stmt); } catch { /* error-tolerant, as the runner is */ }
    }
  }
  return db;
}

const kindCol = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare("SELECT * FROM pragma_table_info('territory_licences') WHERE name = 'kind'")
    .get() as { name?: string; dflt_value?: string; notnull?: number } | undefined;

test('the column exists on a fresh build, and did not before 279', () => {
  assert.ok(kindCol(freshDb()), 'territory_licences.kind is missing from a fresh build');
  assert.equal(kindCol(freshDb([M279])), undefined,
    'kind exists without 279, so this test is not measuring the migration');
});

test('its default is subsidiary, which backfills a fact rather than inventing one', () => {
  // Every licence issued before 279 went through a create path that REFUSED
  // white-label, so every existing row IS a subsidiary. The default is the
  // truth about those rows, not a convenience.
  const col = kindCol(freshDb())!;
  assert.match(String(col.dflt_value), /subsidiary/, 'the default is not subsidiary');
  assert.equal(col.notnull, 1, 'kind is nullable, so a row can decline to say which kind it is');
});

test('the CHECK is ENFORCED, not merely written — a third kind is refused', () => {
  // The whole migration rests on SQLite accepting a CHECK inside ADD COLUMN.
  // Accepting it and enforcing it are different claims; this asserts the second.
  const db = freshDb();
  const insert = (kind: string) => db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name, kind)
     VALUES (?,?,?,?,?)`,
  ).run(`u-${kind}`, `REF-${kind}`, 'Entity', 'Brand', kind);

  insert('subsidiary');
  insert('white_label');
  assert.throws(() => insert('franchise'), /CHECK constraint failed/,
    'a third kind was stored, so the CHECK is decoration');
});

test('a row written with no kind reads as subsidiary', () => {
  const db = freshDb();
  db.prepare(
    `INSERT INTO territory_licences (uid, licence_ref, legal_entity_name, brand_name)
     VALUES (?,?,?,?)`,
  ).run('u-default', 'REF-DEFAULT', 'Entity', 'Brand');
  const row = db.prepare("SELECT kind FROM territory_licences WHERE uid = 'u-default'")
    .get() as { kind: string };
  assert.equal(row.kind, 'subsidiary');
});

test('the create handler refuses a kind the CHECK would refuse, and says which two exist', () => {
  // WHY THE HANDLER CHECKS TOO, when the column already does: the column's
  // refusal is a 500 carrying SQLite's own wording. An operator who mistypes a
  // kind should be told what the two are.
  const src = codeOnly(readFileSync(resolve(HERE, '../src/routes/admin_licences.ts'), 'utf8'));
  assert.match(src, /LICENCE_KINDS\s*=\s*\['subsidiary',\s*'white_label'\]/,
    'the handler no longer names the two kinds');
  // ANCHORED ON THE `if`, NOT THE CALL. A bare match on the expression is
  // satisfied by `if (false && !LICENCE_KINDS.includes(kind))` — a guard that
  // reads as live and refuses nothing. Measured: that mutation escaped the
  // first version of this line.
  assert.match(src, /if \(!LICENCE_KINDS\.includes\(kind\)\) \{/,
    'the create handler stopped validating kind against that list');
  // Stored, not merely validated — and bound, never interpolated.
  assert.match(src, /signatory_title,\s*kind,\s*status/,
    'the INSERT no longer names the kind column');
});

test('the kind reaches the audit row, because it is not recoverable from the others', () => {
  const src = codeOnly(readFileSync(resolve(HERE, '../src/routes/admin_licences.ts'), 'utf8'));
  assert.match(src, /'created',\s*admin\.id,\s*\{\s*licence_ref:\s*ref,\s*kind\s*\}/,
    'licence_events no longer records which kind the licence was issued as');
});

test('279 widens a table with exactly ONE definition, so it cannot collide', () => {
  // The #183 / #202 class: a table declared twice drifts, and which shape a
  // database gets depends on which ran first. This asserts the precondition
  // that made 279 safe, so it fails the day somebody adds a runtime twin.
  const src = resolve(HERE, '../src');
  const walk = (dir: string): string[] => {
    let out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) out = out.concat(walk(p));
      else if (e.name.endsWith('.ts')) out.push(p);
    }
    return out;
  };
  const twins = walk(src).filter((f) =>
    /CREATE TABLE IF NOT EXISTS\s+territory_licences/i.test(readFileSync(f, 'utf8')));
  assert.deepEqual(twins, [],
    'a runtime CREATE TABLE for territory_licences appeared — 279 can now be shadowed');
});

test('the territory exclusivity index is UNTOUCHED, and that is deliberate', () => {
  // H26 says exclusivity against other white-labels is off for such a licence.
  // That is true of the DESIGN and is not stored anywhere, so relaxing the
  // live index on the strength of a one-migration-old column would trade a
  // real constraint for an unbuilt one. It stays exactly as it is.
  //
  // THE SCAN READS EXECUTABLE DDL, NOT THE FILE. 279's own header names the
  // index in the sentence saying it is not touched, so a raw scan matches the
  // RULE and reports it as the violation — the class this repo has recorded
  // before as "a lexical scan cannot tell a rule from its violation". So the
  // comments come off first, and the pair below proves the stripper did work:
  // the raw file must still carry the name (the reasoning is on the record)
  // while the DDL must not.
  const raw = readFileSync(resolve(MIGRATIONS, M279), 'utf8');
  const ddl = raw.replace(/--[^\n]*/g, '');
  assert.match(ddl, /ALTER TABLE territory_licences/,
    'the comment stripper ate the DDL, so the assertion below could not fail');
  assert.match(raw, /idx_licence_territory_exclusive/,
    '279 stopped recording WHY it leaves the exclusivity index alone');
  assert.doesNotMatch(ddl, /idx_licence_territory_exclusive/,
    '279 touches the exclusivity index; white-label exclusivity is a separate, unstored flag');
});
