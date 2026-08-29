#!/usr/bin/env node
/**
 * Fails the build when the worker queries a table nothing creates.
 *
 * Nine such tables were in production when this was written. Three of them —
 * `workflows`, `workflow_tasks`, `shared_services_log` — were a whole feature
 * with no schema: four route files read and wrote them, and no CREATE TABLE
 * existed anywhere in the repository. The consequences ranged from a 500 on
 * the only path by which a founder requests an introduction, to an AI rate
 * limiter that answered "under the limit" to every call because its own
 * ledger was unreadable, to a five-item spin-out checklist that was never
 * once written. Three more were simply named wrong (`scoring_runs` for
 * `score_snapshots`, `market_intel_personas` for `market_intel_indexes`,
 * `partner_deal_redemptions` for `partner_referral_redemptions`).
 *
 * None of it was visible. `tsc` does not read SQL. A D1 stub that matches on
 * SQL text answers whatever it was taught, so it cannot notice that a table
 * is absent. And nearly every call site sat inside a swallowing `catch`,
 * which is precisely why the gap could persist: the failure mode of a missing
 * table is not an error, it is a feature that quietly returns nothing.
 *
 * MATCHES ON THE MATERIAL, NOT THE NAME. Table references are read out of the
 * contents of SQL strings only, and SQL string literals inside them are
 * blanked first — otherwise the prose in
 *   'Pending intro requests from the operator marketplace.'
 * contributes a table called `the`. Table keywords (`SET` after `DO UPDATE
 * SET`, `OR` after `UPDATE OR IGNORE`) and CTE names defined by the query
 * itself are excluded for the same reason.
 *
 * Wired into `npm run test:drift` via `test:guards`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqlStrings } from './check-sqlite-dialect.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'cloudflare-worker', 'src');
const SQL_DIR = path.join(ROOT, 'cloudflare-worker', 'sql');
const BASELINE = path.join(ROOT, 'scripts', 'sqlite-tables-baseline.json');

function walk(dir, ext) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

const norm = (t) => t.replace(/[`"[\]]/g, '').toLowerCase();

/**
 * SQL keywords that can follow one of the reference verbs and be mistaken for
 * a table: `INSERT … ON CONFLICT DO UPDATE SET`, `UPDATE OR IGNORE`, and the
 * ordinary words that appear after FROM inside prose we failed to strip.
 */
const NOT_A_TABLE = new Set([
  'set', 'or', 'select', 'values', 'into', 'from', 'join', 'where', 'on', 'and',
  'not', 'null', 'if', 'exists', 'all', 'distinct', 'case', 'when', 'then',
  'else', 'end', 'order', 'group', 'by', 'limit', 'offset', 'as', 'union',
  'with', 'recursive', 'using', 'left', 'right', 'inner', 'outer', 'cross',
  'natural', 'replace', 'ignore', 'abort', 'fail', 'rollback', 'the', 'a', 'an',
]);

/**
 * Every table or view this repo creates, from migrations, schema.sql and the
 * runtime `ensureSchema` DDL the routes carry. Read out of the raw source
 * rather than out of recognised SQL strings on purpose: over-harvesting here
 * can only shrink the reported set, never invent an entry in it.
 */
export function knownTables() {
  const known = new Set();
  const DDL = /\bCREATE\s+(?:TEMP\s+|TEMPORARY\s+)?(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[]?[\w.]+[`"\]]?)/gi;
  for (const f of [...walk(SQL_DIR, '.sql'), ...walk(SRC, '.ts')]) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(DDL)) known.add(norm(m[1]));
  }
  return known;
}

/**
 * Blank the contents of SQL string literals AND `-- …` comments, so prose
 * cannot look like SQL.
 *
 * Comments matter as much as literals: a note reading "the join threw and the
 * filter never ran" contributed a table called `threw`, because `JOIN\s+(\w+)`
 * does not care that it is inside a comment. Written while documenting a fix,
 * which is exactly when such prose gets added.
 */
export function stripSqlLiterals(sql) {
  let out = '', i = 0;
  while (i < sql.length) {
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const n = sql.indexOf('\n', i);
      const end = n < 0 ? sql.length : n;
      out += ' '.repeat(end - i);
      i = end;
      continue;
    }
    if (sql[i] !== "'") { out += sql[i]; i += 1; continue; }
    out += "''";
    i += 1;
    while (i < sql.length) {
      if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
      if (sql[i] === "'") break;
      i += 1;
    }
    i += 1;
  }
  return out;
}

const REF = /\b(?:FROM|JOIN|INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+([`"[]?[A-Za-z_]\w*[`"\]]?)/gi;

/** Table references the worker makes that nothing in the repo creates. */
export function unknownReferences() {
  const known = knownTables();
  const hits = new Map();
  for (const file of walk(SRC, '.ts')) {
    const rel = path.relative(ROOT, file);
    for (const { body, line } of sqlStrings(fs.readFileSync(file, 'utf8'))) {
      const clean = stripSqlLiterals(body);
      const ctes = new Set(
        [...clean.matchAll(/\b(?:WITH|,)\s+(\w+)\s+AS\s*\(/gi)].map((m) => norm(m[1])),
      );
      for (const m of clean.matchAll(REF)) {
        const t = norm(m[1]);
        // sqlite_master / sqlite_sequence are the engine's own tables.
        if (known.has(t) || ctes.has(t) || NOT_A_TABLE.has(t) || t.startsWith('sqlite_')) continue;
        if (!hits.has(t)) hits.set(t, []);
        hits.get(t).push(`${rel}:${line}`);
      }
    }
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = unknownReferences();
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).tables ?? {};

  const added = [...found.keys()].filter((t) => !(t in baseline)).sort();
  const resolved = Object.keys(baseline).filter((t) => !found.has(t)).sort();

  if (added.length) {
    console.error('✖ check-sqlite-tables: SQL referencing a table nothing creates:\n');
    for (const t of added) {
      console.error(`  ${t}`);
      for (const w of [...new Set(found.get(t))]) console.error(`      ${w}`);
    }
    console.error('\nD1 answers "no such table" at runtime. Most of these call sites');
    console.error('sit inside a catch, so the symptom is a feature that silently');
    console.error('returns nothing — not an error anyone sees.');
    console.error('\nEither add the table (a migration in cloudflare-worker/sql/migrations/,');
    console.error('mirrored in an ensureSchema for the unapplied-migration case), point the');
    console.error('query at the table that does exist, or — if the feature genuinely has no');
    console.error('store yet — record it in scripts/sqlite-tables-baseline.json with a');
    console.error('reason describing what the query returns today.');
    process.exit(1);
  }

  if (resolved.length) {
    console.error('✖ check-sqlite-tables: baseline entries no longer missing:\n');
    for (const t of resolved) console.error(`  ${t}`);
    console.error('\nThese tables now exist. Delete them from');
    console.error('scripts/sqlite-tables-baseline.json — a ledger of known gaps is only');
    console.error('worth reading if every line in it is still true.');
    process.exit(1);
  }

  const n = Object.keys(baseline).length;
  console.log(`✓ check-sqlite-tables: every table the worker queries is created somewhere (${n} known gap${n === 1 ? '' : 's'} on record).`);
}
