#!/usr/bin/env node
/**
 * Fails the build when a migration reads a column that only SOME definitions of
 * a multiply-defined table have.
 *
 * WHAT THIS CATCHES, and it is not hypothetical. Migration 196 shipped naming
 * `quotes.partner_id` and `service_offerings.owner_user_id`. Both tables carry
 * three `CREATE TABLE IF NOT EXISTS` definitions, and those two columns come
 * from OPPOSITE lineages: `partner_id` exists only in the `t13_t14_t15.sql`
 * shape of `quotes`, `owner_user_id` only in the `schema.sql` / migration-034
 * shape of `service_offerings`. D1 holds one table per name and every
 * definition is IF NOT EXISTS, so the first to run wins — and no ordering of
 * those files produces a database where both columns exist. The migration was
 * therefore unapplicable against any real database, which is exactly how it
 * behaved: it failed on the production run and D1 rolled the whole file back.
 *
 * `check-sqlite-table-collisions` cannot see this. It reports only MUTUALLY
 * fatal pairs — each definition requiring a NOT NULL column the other has no
 * place for — because two definitions that merely differ are ordinarily fine.
 * `quotes` is one-directional (the t13 shape requires `partner_id`; the
 * schema.sql shape requires nothing the t13 shape lacks), so it is correctly
 * absent from that baseline and still fatal to a migration that reads it.
 * `check-sqlite-columns` cannot see it either: it UNIONS every definition, by
 * design, so every column looks present.
 *
 * THE RULE. For a table with two or more definitions, a migration may name a
 * column only if it is either
 *
 *   (a) present in EVERY definition of that table — true whichever won; or
 *   (b) added by an `ALTER TABLE … ADD COLUMN` somewhere under sql/ — true
 *       whichever won, because the ALTER ran against the live table.
 *
 * Anything else is a coin flip on a database nobody can inspect from here.
 *
 * WHAT IT READS, deliberately narrowly. Two forms, both unambiguous and both
 * the ones 196 got wrong:
 *
 *   CREATE INDEX … ON <table>(<col>, …)
 *   <table>.<column>
 *
 * A bare column inside `UPDATE t SET … WHERE …` belongs to `t` too, but
 * attributing unqualified names needs a parser, and a checker that guesses is
 * worse than one with a stated blind spot. Migrations that reach a collided
 * table's columns unqualified are not covered, and neither is a column reached
 * through a table ALIAS (`FROM service_offerings o … o.partner_id`); say so
 * rather than imply coverage.
 *
 * A migration that CREATES a table, or REBUILDS one by renaming a table it
 * created into that name, is exempt for that table — it has just declared the
 * shape it then reads, so the repo's disagreeing definitions no longer describe
 * what is there.
 *
 * Pre-existing offenders live in `scripts/migration-column-shapes-baseline.json`
 * so this fails on NEW ones only. A baseline entry is a debt with a name, not
 * an exemption: each records the migration, the table, the column, and which
 * definition it came from.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { definitions } from './check-sqlite-table-collisions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'cloudflare-worker/sql/migrations');
const SQL_DIR = path.join(ROOT, 'cloudflare-worker/sql');
const BASELINE = path.join(ROOT, 'scripts/migration-column-shapes-baseline.json');

const stripComments = (sql) => sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

function sqlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sqlFiles(p));
    else if (p.endsWith('.sql')) out.push(p);
  }
  return out;
}

/**
 * Columns any `ALTER TABLE … ADD COLUMN` has added, by table. These are safe to
 * reference no matter which definition won: the ALTER ran against whatever the
 * live table turned out to be.
 */
export function alteredColumns() {
  const added = new Map();
  for (const f of sqlFiles(SQL_DIR)) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    const re = /ALTER\s+TABLE\s+[`"[]?(\w+)[`"\]]?\s+ADD\s+(?:COLUMN\s+)?[`"[]?(\w+)/gi;
    for (const m of src.matchAll(re)) {
      const t = m[1].toLowerCase();
      if (!added.has(t)) added.set(t, new Set());
      added.get(t).add(m[2].toLowerCase());
    }
  }
  return added;
}

/** `table -> Set(column)` for every column this migration names explicitly. */
export function referencedColumns(sql) {
  const src = stripComments(sql);
  const refs = new Map();
  const add = (t, c) => {
    const table = t.toLowerCase();
    if (!refs.has(table)) refs.set(table, new Set());
    refs.get(table).add(c.toLowerCase());
  };

  // CREATE INDEX … ON t(a, b)
  for (const m of src.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[\w`"[\]]+\s+ON\s+[`"[]?(\w+)[`"\]]?\s*\(([^)]*)\)/gi)) {
    for (const raw of m[2].split(',')) {
      const c = /^\s*[`"[]?([a-z_]\w*)/i.exec(raw);
      if (c) add(m[1], c[1]);
    }
  }

  // t.column — the qualified form, anywhere in the file.
  for (const m of src.matchAll(/\b([a-z_]\w*)\.([a-z_]\w*)\b/gi)) add(m[1], m[2]);

  return refs;
}

export function violations() {
  // `.sql` definitions only. A `CREATE TABLE IF NOT EXISTS` inside a `.ts`
  // ensureSchema is a runtime top-up that runs against whatever D1 already
  // holds — usually a narrower mirror of the real shape — so counting it as a
  // competing lineage reports a disagreement that no database can have.
  const defs = new Map(
    [...definitions()].map(([t, list]) => [t, list.filter((d) => d.rel.endsWith('.sql'))]),
  );
  const altered = alteredColumns();
  const out = [];

  for (const file of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
    // A migration that CREATES the table settles its own shape: the columns it
    // declares are the ones it may index and read, whatever else exists.
    //
    // A table REBUILD settles it too, and that is not the same statement. The
    // SQLite rebuild idiom creates the new shape under a temporary name, copies
    // rows into it, drops the original and renames the temporary into the freed
    // name — so by the time the file indexes `service_offerings`, that name
    // holds the table this migration just declared, not the one the repo's
    // CREATE TABLEs disagree about. Reading the rename is what tells the two
    // apart; without it migration 200 reports a false positive on the very
    // column it exists to introduce.
    const body = stripComments(sql);
    const selfDefined = new Set(
      [...body.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)/gi)]
        .map((m) => m[1].toLowerCase()),
    );
    for (const m of body.matchAll(/ALTER\s+TABLE\s+[`"[]?(\w+)[`"\]]?\s+RENAME\s+TO\s+[`"[]?(\w+)/gi)) {
      if (selfDefined.has(m[1].toLowerCase())) selfDefined.add(m[2].toLowerCase());
    }
    for (const [table, cols] of referencedColumns(sql)) {
      if (selfDefined.has(table)) continue;
      const list = defs.get(table);
      if (!list || list.length < 2) continue;            // one shape — nothing to disagree about
      for (const col of cols) {
        if (altered.get(table)?.has(col)) continue;      // added by an ALTER — present either way
        const missing = list.filter((d) => !d.cols.has(col));
        if (!missing.length) continue;                   // in every definition
        const present = list.filter((d) => d.cols.has(col));
        if (!present.length) continue;                   // in none — an alias or a false positive
        out.push({
          key: `${file}:${table}.${col}`,
          file,
          table,
          column: col,
          onlyIn: present.map((d) => `${d.rel}:${d.line}`),
          missingFrom: missing.map((d) => `${d.rel}:${d.line}`),
        });
      }
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = violations();
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).references ?? {};
  const added = found.filter((v) => !(v.key in baseline));
  const resolved = Object.keys(baseline).filter((k) => !found.some((v) => v.key === k)).sort();

  if (added.length) {
    console.error('✖ check-migration-column-shapes: migration(s) read a column that only\n');
    console.error('  SOME definitions of a multiply-defined table have. D1 keeps one table per');
    console.error('  name and every definition is IF NOT EXISTS, so whichever ran first won —');
    console.error('  and this migration cannot apply unless it was the right one.\n');
    for (const v of added) {
      console.error(`  ${v.file}  reads  ${v.table}.${v.column}`);
      console.error(`      only in:      ${v.onlyIn.join(', ')}`);
      console.error(`      missing from: ${v.missingFrom.join(', ')}\n`);
    }
    console.error('  Fix the migration to use a column every definition has, or drop the');
    console.error('  reference. Settle which shape is live with:');
    console.error('    npx wrangler d1 execute studioos-db --remote --command="PRAGMA table_info(\'<table>\')"');
    console.error('  Record a deliberate exception in scripts/migration-column-shapes-baseline.json.');
    process.exit(1);
  }

  if (resolved.length) {
    console.error('✖ check-migration-column-shapes: baseline entries that no longer apply:\n');
    for (const k of resolved) console.error(`  ${k}`);
    console.error('\nDelete them from scripts/migration-column-shapes-baseline.json — a ledger');
    console.error('that outlives what it records stops being read.');
    process.exit(1);
  }

  const n = Object.keys(baseline).length;
  console.log(`✓ check-migration-column-shapes: no new shape-dependent column reads (${n} baselined).`);
}
