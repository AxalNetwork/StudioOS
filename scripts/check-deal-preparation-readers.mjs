#!/usr/bin/env node
/**
 * D5454 (#5454) — every Worker file that reads or writes the `deals` table is classified in the reader/writer
 * inventory of `documentation/architecture/decisions/D5454.md`, and every file classified `guarded` actually calls
 * the preparation guard (`services/dealPreparation.ts`).
 *
 * Why: a never-released preparation owns no `deals` row (migration CHECK `dp_private_owns_no_deal`), but a
 * withdrawn or archived release does, and ADP-02/ADP-04 enable draft creation and withdrawal only once every
 * reader is classified. A new `deals` reader that nobody classified is the leak this check exists to stop: it fails
 * the build until the inventory names it.
 *
 * Rules:
 *   1. every `.ts` file under cloudflare-worker/src whose SQL names `deals` (FROM/JOIN/INTO/UPDATE) has a row;
 *   2. every row names a file that exists and still matches (no stale rows);
 *   3. the class is one of guarded | structural | writer | service;
 *   4. a `guarded` file imports from `dealPreparation`.
 *
 *   node scripts/check-deal-preparation-readers.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';

const ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const DOC = 'documentation/architecture/decisions/D5454.md';
const SRC = 'cloudflare-worker/src';
const CLASSES = new Set(['guarded', 'structural', 'writer', 'service']);
const DEALS_SQL = /\b(FROM|JOIN|INTO|UPDATE)\s+deals\b/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

export function inventoryRows(doc) {
  const begin = doc.indexOf('<!-- d5454-inventory:begin -->');
  const end = doc.indexOf('<!-- d5454-inventory:end -->');
  if (begin < 0 || end < begin) return null;
  const rows = new Map();
  for (const line of doc.slice(begin, end).split('\n')) {
    const m = /^\|\s*`([^`]+)`\s*\|\s*([a-z]+)\s*\|/.exec(line);
    if (m) rows.set(m[1], m[2]);
  }
  return rows;
}

export function check(root = ROOT) {
  const problems = [];
  const docPath = resolve(root, DOC);
  if (!existsSync(docPath)) return [`${DOC} is missing`];
  const rows = inventoryRows(readFileSync(docPath, 'utf8'));
  if (!rows) return [`${DOC} has no <!-- d5454-inventory:begin --> … end block`];
  const readers = walk(resolve(root, SRC))
    .filter((p) => DEALS_SQL.test(readFileSync(p, 'utf8')))
    .map((p) => relative(root, p).split('\\').join('/'));
  for (const f of readers) if (!rows.has(f)) problems.push(`${f} reads or writes deals and is not in the D5454 inventory`);
  for (const [f, cls] of rows) {
    if (!CLASSES.has(cls)) problems.push(`${f}: unknown class '${cls}'`);
    const p = resolve(root, f);
    if (!existsSync(p)) { problems.push(`${f}: listed in the inventory but does not exist`); continue; }
    const src = readFileSync(p, 'utf8');
    if (!DEALS_SQL.test(src)) problems.push(`${f}: listed in the inventory but no longer names deals in SQL`);
    if (cls === 'guarded' && !/from '\.{1,2}\/(services\/)?dealPreparation'/.test(src)) problems.push(`${f}: classed guarded but does not import dealPreparation`);
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = check();
  if (problems.length) {
    console.error(`✗ check-deal-preparation-readers: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('✓ check-deal-preparation-readers: every deals reader and writer is in the D5454 inventory, and every guarded one calls the guard.');
}
