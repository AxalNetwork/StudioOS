#!/usr/bin/env node
/**
 * #4568 — the usage tables' dependency matrix, read from the code and planned on
 * the migrated schema (rules: `scripts/lib/usageTablesMatrix.mjs`).
 *
 *   node scripts/usage-tables-matrix.mjs                       # the matrix, as JSON, to stdout
 *   node scripts/usage-tables-matrix.mjs --out matrix.json     # to a file
 *   node scripts/usage-tables-matrix.mjs --candidates          # the plan diff with D4568's candidate indexes
 *
 * Reads files and an in-memory copy of the schema only: no database, network or credential.
 * Statement shapes mask every literal.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_OPTIONS, loadSchema } from '../cloudflare-worker/test/_schema_once.mjs';
import { buildMatrix, planDiff } from './lib/usageTablesMatrix.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
loadSchema(db);
const result = args.includes('--candidates') ? planDiff({ root: ROOT, db }) : buildMatrix({ root: ROOT, db });
const text = `${JSON.stringify(result, null, 1)}\n`;
if (out) { writeFileSync(out, text); console.log(`✓ usage-tables-matrix: wrote ${out}`); } else process.stdout.write(text);
