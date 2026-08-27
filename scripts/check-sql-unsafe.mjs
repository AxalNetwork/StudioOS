#!/usr/bin/env node
/**
 * M3 — SQL-injection tripwire for `sql.unsafe(`...`)`.
 *
 * `db.ts` exposes a postgres.js-style `sql.unsafe(query, params)` escape hatch
 * that runs a raw string with NO automatic parameterization of the string
 * itself. That is fine when the only dynamic parts are bound `?` params, but a
 * `${...}` interpolated straight into the query text is a classic injection
 * vector. This guard fails the build when a `sql.unsafe(`...`)` template
 * contains a `${...}` whose expression is not on the reviewed ALLOWLIST below,
 * or when `sql.unsafe()` is handed a non-literal argument (e.g. a pre-built
 * string variable that could smuggle user input past this check).
 *
 * It is a tripwire, not a proof: an allow-listed name rebuilt unsafely would
 * still pass. Keep the allowlist SHRINKING and each entry justified.
 *
 * Wired into `npm run test:drift`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'cloudflare-worker', 'src');

// Approved `${...}` expressions inside sql.unsafe(`...`). Each must be provably
// built from a hardcoded source (literal union, column allow-list, or a string
// of bound `?` placeholders) — NEVER from raw request input.
const ALLOWLIST = new Set([
  // calendar.ts — literal-union provider table names ('google_oauth_tokens' | …).
  'table',
  'tokenTable',
  // analyticsReports.ts — date-format / grouping fragments chosen from a
  // hardcoded ternary on `granularity`, never from the request.
  'fmt',
  'fmtU',
  // analyticsReports / monitoring_analytics / dd — WHERE built ONLY from
  // hardcoded clause strings ("col = ?") with values bound separately in params.
  'where',
  // projects.ts — "col = ?" pairs joined from the baseFields/privilegedFields
  // column allow-list; values are bound separately.
  "updates.join(', ')",
  // network / admin_contracts / matches — strings of bound `?` placeholders only.
  'placeholders',
  'ph',
  "Array.from(CONTRACT_DOC_TYPES).map(() => '?').join(',')",
  // admin_contracts — literal 'uid' | 'envelope_uuid' union.
  'matchKey',
  // tenancyScope.ts fragments (capital.ts). `scope.sql` is composed inside
  // services/tenancyScope.ts from string literals plus the `alias` argument;
  // every VALUE is a bound `?` in `scope.binds`, never interpolated. Two
  // assertions in cloudflare-worker/test/tenancy_scope.test.mjs hold that up:
  // the module interpolates nothing but `alias`, and every call site passes
  // either no alias or a string literal. Neither can be satisfied by request
  // input, which is what makes this entry safe rather than merely convenient.
  'scope.sql',
  // Same provenance as the allow-listed `where` above, one step later: an
  // array of hardcoded clause strings (`scope.sql`, `'cc.status = ?'`) joined
  // with AND. Values are bound separately.
  "where.join(' AND ')",
]);

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;

  for (const m of src.matchAll(/\.unsafe\(\s*/g)) {
    const start = m.index + m[0].length;
    const ch = src[start];
    if (ch === '`') {
      const end = src.indexOf('`', start + 1);
      const body = end === -1 ? src.slice(start + 1) : src.slice(start + 1, end);
      for (const im of body.matchAll(/\$\{([^}]+)\}/g)) {
        const expr = im[1].trim();
        if (!ALLOWLIST.has(expr)) {
          violations.push({ rel, line: lineOf(m.index), expr: `\${${expr}}` });
        }
      }
    } else if (ch === "'" || ch === '"') {
      // Plain string literal — no interpolation possible. Safe.
    } else {
      // Variable / call result passed to sql.unsafe(): could carry user input.
      violations.push({ rel, line: lineOf(m.index), expr: '<non-literal argument>' });
    }
  }
}

if (violations.length) {
  console.error('\u2716 check-sql-unsafe: disallowed input to sql.unsafe(`...`):');
  for (const v of violations) console.error(`  ${v.rel}:${v.line}  ->  ${v.expr}`);
  console.error('\nInterpolating into sql.unsafe() (or passing it a pre-built');
  console.error('string) risks SQL injection. Use bound `?` parameters. If the');
  console.error('value is provably safe (literal union / column allow-list /');
  console.error('"?"-placeholder string), add it to ALLOWLIST in');
  console.error('scripts/check-sql-unsafe.mjs with a justifying comment.');
  process.exit(1);
}
console.log('\u2713 check-sql-unsafe: no disallowed sql.unsafe() interpolations.');
