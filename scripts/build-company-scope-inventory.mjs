#!/usr/bin/env node
/**
 * D8526 (#8526) — the company-scope inventory: every mounted Worker route that reads the browser's selected
 * company (`X-Company-Id`), directly or through a helper it calls, and for each whether the selection is a
 * FILTER or the route acts on a TARGET, with the checks that authorize the target.
 *
 *   node scripts/build-company-scope-inventory.mjs           writes documentation/architecture/COMPANY_SCOPE_INVENTORY.json
 *                                                            (build output, never committed: .gitignore, D5612)
 *   node scripts/build-company-scope-inventory.mjs --check   the guard (in `npm run test:guards`)
 *   node scripts/build-company-scope-inventory.mjs --seed    adds each route the ledger lacks, with its derived kind
 *
 * READS THE SELECTION. The route's handler, with the helpers it reaches (`scripts/lib/authInventory.mjs`'s
 * `routeTable`, the auth inventory's own reading), calls `resolveActiveCompany` or `activeCompanyFor`, or names
 * `ACTIVE_COMPANY_HEADER` or the header itself.
 *
 * KIND, from the route. A TARGET names a record in its path (`:id`, `:uid`, `:projectId`…) or writes (any method
 * but GET); the selection there may only narrow what its own check allows. A FILTER is a GET with no record in its
 * path: a list the selection narrows.
 *
 * CHECKS. The ownership and membership evidence the auth inventory reads (`classify`), plus the cap table's own
 * read and write gates, `canReadProject` and `canWriteProject`: they rest on `computeProjectPermissions` →
 * `canAccessProject`, one call deeper than the auth inventory reaches. `resolveActiveCompany` is never a check: it
 * verifies the header against `user_company_links`, which proves the caller may SELECT a company, not that they
 * may act on a record.
 *
 * THE LEDGER, scripts/baselines/company-scope/: every route that reads the selection, keyed `METHOD path`, with
 * its kind. A new reader is a change a person looks at, so it is added there in the same PR.
 *
 * --check fails on:
 *   - a route that reads the selection and has no ledger entry;
 *   - a ledger entry for a route that no longer reads it, or whose kind is no longer what the route is;
 *   - a TARGET with no check: its authorization would be the active company alone.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeTable, classify, stripComments, familyOf } from './lib/authInventory.mjs';
import { readSplit, writeSplit, entryFile } from './lib/splitLedger.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LEDGER = join(ROOT, 'scripts/baselines/company-scope');
const OUT = join(ROOT, 'documentation', 'architecture', 'COMPANY_SCOPE_INVENTORY.json');
export const ledgerFile = (key) => entryFile(familyOf(key.slice(key.indexOf(' ') + 1)));

/** What reading the selection looks like in a route's reached text. */
export const READS_SELECTION = /\bresolveActiveCompany\s*\(|\bactiveCompanyFor\s*\(|\bACTIVE_COMPANY_HEADER\b|['"`]X-Company-Id['"`]/i;
/** Checks the auth inventory's reading does not reach (see the header). */
export const EXTRA_CHECKS = ['canReadProject', 'canWriteProject'];
const EXTRA_RE = new RegExp(`\\b(${EXTRA_CHECKS.join('|')})\\s*\\(`, 'g');
export const KINDS = ['filter', 'target'];

export const kindOf = (method, path) => (method !== 'GET' || /:[A-Za-z_]/.test(path) ? 'target' : 'filter');

/** Every route that reads the selection: `{ key, method, path, file, line, kind, checks }`, sorted by key. */
export function companyScopeInventory(root = ROOT) {
  const rows = [];
  const seen = new Set();
  for (const r of routeTable(root)) {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = stripComments(r.text);
    if (!READS_SELECTION.test(text)) continue;
    const { evidence } = classify(r);
    const checks = [...new Set([...evidence, ...[...text.matchAll(EXTRA_RE)].map((m) => m[1])])].sort();
    rows.push({ key, method: r.method, path: r.path, file: r.file.replace(`${root}/`, ''), line: r.line, kind: kindOf(r.method, r.path), checks });
  }
  return rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The guard's findings, one sentence each. */
export function findings(rows, ledger) {
  const out = [];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const r of rows) {
    const entry = ledger[r.key];
    if (!entry) out.push(`${r.key} (${r.file}:${r.line}) reads the selected company and is not in scripts/baselines/company-scope/. Add it with --seed after checking that the selection only narrows what its own check allows.`);
    else if (entry.kind !== r.kind) out.push(`${r.key}: the ledger says ${entry.kind}, the route is now a ${r.kind}. Look at it again and update the entry.`);
    if (r.kind === 'target' && !r.checks.length) out.push(`${r.key} (${r.file}:${r.line}) acts on a named record and no ownership or membership check reaches it: its authorization would be the active company alone. Authorize the record itself (canAccessProject, a membership role, an owner-bound query).`);
  }
  for (const [key, entry] of Object.entries(ledger)) {
    if (!byKey.has(key)) out.push(`${key} is in scripts/baselines/company-scope/ but no longer reads the selected company. Remove the entry.`);
    if (!entry || !KINDS.includes(entry.kind)) out.push(`${key}: kind must be one of ${KINDS.join(', ')}.`);
  }
  return out;
}

const args = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = companyScopeInventory();
  const ledger = existsSync(LEDGER) ? readSplit(LEDGER, ledgerFile) : {};
  if (args.includes('--seed')) {
    const next = { ...ledger };
    for (const r of rows) next[r.key] ??= { kind: r.kind };
    const changed = writeSplit(LEDGER, next, ledgerFile);
    console.log(`company-scope ledger: ${Object.keys(next).length} routes, ${changed.length} files written.`);
    process.exit(0);
  }
  const found = findings(rows, ledger);
  const targets = rows.filter((r) => r.kind === 'target').length;
  const summary = `${rows.length} routes read the selected company: ${targets} targets, each with a check of its own, and ${rows.length - targets} filters`;
  if (args.includes('--check')) {
    for (const f of found) console.error(`✖ ${f}`);
    if (found.length) { console.error(`✖ company-scope inventory: ${found.length} findings.`); process.exit(1); }
    console.log(`✓ company-scope inventory: ${summary}.`);
    process.exit(0);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({ generated_by: 'scripts/build-company-scope-inventory.mjs', routes: rows }, null, 2)}\n`);
  console.log(`wrote ${OUT.replace(`${ROOT}/`, '')}: ${summary}${found.length ? `; ${found.length} findings (run --check)` : ''}.`);
}
