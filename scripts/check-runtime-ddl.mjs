#!/usr/bin/env node
/**
 * #4568 R2-04 — runtime `ADD COLUMN` may not grow blind.
 *
 *   node scripts/check-runtime-ddl.mjs          # test:guards: the ratchet
 *   node scripts/check-runtime-ddl.mjs --json   # the inventory, machine-readable
 *
 * A blind ALTER (tried and its error swallowed) of a column a migration already
 * declares fails with `duplicate column name` on every fresh isolate against an
 * up-to-date database. New schema goes in a migration (CLAUDE.md); a bootstrap
 * a preview or local database still needs goes through `runSchemaBootstrap`
 * (`cloudflare-worker/src/util/schemaBootstrap.ts`), which asks the table
 * first and issues no ALTER when the column is there.
 *
 * `scripts/runtime-ddl-baseline.json` records, per file, the blind ALTERs on
 * record on 2026-11-07. A file may not exceed its entry, a file not in it may
 * not ALTER blind, and a file that improves must lower its entry. Reads files
 * and an in-memory copy of the migrated schema only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_OPTIONS, loadSchema } from '../cloudflare-worker/test/_schema_once.mjs';
import { inventory, ratchet } from './lib/runtimeDdl.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'runtime-ddl-baseline.json');
const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
loadSchema(db);
const inv = inventory({ root: ROOT, db });

if (process.argv.includes('--json')) { process.stdout.write(`${JSON.stringify(inv, null, 1)}\n`); process.exit(0); }
if (process.argv.includes('--write-baseline')) {
  const r = ratchet(inv, {});
  writeFileSync(BASELINE, `${JSON.stringify({ note: 'Blind runtime ADD COLUMN per file, on record (#4568 R2-04). Only ever lowered: move a file onto runSchemaBootstrap or a migration, then lower or remove its entry.', files: r.now }, null, 2)}\n`);
  console.log(`✓ check-runtime-ddl: wrote ${Object.keys(r.now).length} files to the baseline`);
  process.exit(0);
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).files ?? {};
const { grown, shrunk } = ratchet(inv, baseline);
const t = inv.totals;
if (grown.length) {
  console.error('✖ check-runtime-ddl: blind runtime ADD COLUMN grew:');
  for (const g of grown) console.error(`  - ${g.file}: ${g.now} (on record: ${g.baseline})`);
  console.error('\nDeclare the column in a migration (cloudflare-worker/sql/migrations/), and if a preview or local database\n'
    + 'still needs the bootstrap, run it through runSchemaBootstrap (util/schemaBootstrap.ts), which asks the table first.');
  process.exit(1);
}
if (shrunk.length) {
  console.error('✖ check-runtime-ddl: these files ALTER blind less than the baseline says; lower their entries in scripts/runtime-ddl-baseline.json:');
  for (const s of shrunk) console.error(`  - ${s.file}: ${s.now} (on record: ${s.baseline})`);
  process.exit(1);
}
console.log(`✓ check-runtime-ddl: ${t.alters} runtime ADD COLUMN in ${t.files} files; ${t.blind_alters} blind in ${t.blind_files} files on record and not growing `
  + `(${t.blind_declared} of them for a column a migration already declares); ${t.asks_first_files} files ask first.`);
