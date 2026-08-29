#!/usr/bin/env node
/**
 * D1 is SQLite. This fails the build on SQL that isn't.
 *
 * Two production bugs of this exact shape have now shipped and been found by
 * accident rather than by a check:
 *
 *   capital.ts        `NOW()` in five places. `POST /api/capital/investors`
 *                     and `POST /api/capital/calls/:id/pay` both threw — one
 *                     of them the only path by which an LP pays a capital
 *                     call. Found only because a route test's D1 stub was
 *                     replaced with a real database.
 *
 *   projects.ts       `COUNT(*)::int` in the free-tier project cap. `::` is
 *                     Postgres cast syntax; SQLite answers `unrecognized
 *                     token: ":"`. Every free founder who already had a
 *                     `founders` row got a 500 from the core founder action
 *                     instead of a project or the clean 402 the cap raises.
 *
 * Both are invisible to `tsc` — the SQL is a string — and invisible to any
 * test whose D1 stub matches on text rather than executing. They surface as a
 * 500 in production, on the paths least likely to be exercised by an admin.
 *
 * SCANS SQL STRINGS, NOT FILES. A first pass grepped whole files and reported
 * 288 `NOW()` hits: `Date.now()`, `performance.now()`. `AGE(` matched
 * `MESSAGE(`; `TOP ` matched `TOPIC`; `SERIAL` matched `SERIALIZE`. Matching
 * on the name rather than the material is the failure this repo has corrected
 * repeatedly, so the scanner extracts the contents of `prepare(`…`)`,
 * ``sql`…` `` and `exec(…)` and searches only inside those.
 *
 * Wired into `npm run test:drift` via `test:guards`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'cloudflare-worker', 'src');

/** Constructs SQLite does not have, each with the dialect it came from. */
const FOREIGN = [
  ['NOW()',           /\bNOW\s*\(\s*\)/i,                    "MySQL/Postgres — use datetime('now')"],
  ['GETDATE()',       /\bGETDATE\s*\(/i,                     "SQL Server — use datetime('now')"],
  ['SYSDATE',         /\bSYSDATE\b/i,                        "Oracle — use datetime('now')"],
  ['CURDATE()',       /\bCURDATE\s*\(/i,                     "MySQL — use date('now')"],
  ['DATE_ADD()',      /\bDATE_ADD\s*\(/i,                    "MySQL — use datetime(x, '+N days')"],
  ['DATE_SUB()',      /\bDATE_SUB\s*\(/i,                    "MySQL — use datetime(x, '-N days')"],
  ['DATEDIFF()',      /\bDATEDIFF\s*\(/i,                    "MySQL — use julianday(a) - julianday(b)"],
  ["INTERVAL 'n'",    /\bINTERVAL\s+'?\d/i,                  "Postgres — use datetime(x, '+N days')"],
  ['ISNULL()',        /\bISNULL\s*\(/i,                      'SQL Server — use IFNULL() or COALESCE()'],
  ['NVL()',           /\bNVL\s*\(/i,                         'Oracle — use IFNULL() or COALESCE()'],
  ['SELECT TOP',      /\bSELECT\s+TOP\b/i,                   'SQL Server — use LIMIT'],
  ['ILIKE',           /\bILIKE\b/i,                          'Postgres — LIKE is already case-insensitive for ASCII'],
  ['SERIAL',          /\b(BIG)?SERIAL\b/i,                   'Postgres — use INTEGER PRIMARY KEY AUTOINCREMENT'],
  ['nextval()',       /\bNEXTVAL\s*\(/i,                     'Postgres sequences — SQLite has none'],
  ['generate_series', /\bGENERATE_SERIES\s*\(/i,             'Postgres — build the series in JS'],
  ['STRING_AGG()',    /\bSTRING_AGG\s*\(/i,                  'Postgres — use GROUP_CONCAT()'],
  ['ARRAY_AGG()',     /\bARRAY_AGG\s*\(/i,                   'Postgres — SQLite has no array type'],
  ['REGEXP_REPLACE',  /\bREGEXP_REPLACE\s*\(/i,              'Postgres — do it in JS'],
  ['TO_CHAR()',       /\bTO_CHAR\s*\(/i,                     'Postgres/Oracle — use strftime()'],
  ['EXTRACT(x FROM)', /\bEXTRACT\s*\(\s*\w+\s+FROM/i,        "Postgres — use strftime('%Y', …)"],
  ['::cast',          /::\s*(text|int|integer|numeric|real|boolean|timestamp|date)\b/i,
                                                             'Postgres cast — use CAST(x AS TYPE)'],
];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * The contents of every SQL-carrying string literal in a file.
 *
 * Only strings that actually contain a statement keyword are returned, so a
 * table name or an error message never reaches the dialect patterns.
 */
export function sqlStrings(src) {
  const out = [];
  for (const m of src.matchAll(/(?:\.prepare\(|\bsql|\.exec\()/g)) {
    // Skip whitespace AND comments before the opening quote. Only whitespace
    // was skipped originally, so a query introduced by an explanatory comment —
    //   await env.DB.prepare(
    //     // why this query is shaped this way
    //     `SELECT …`
    // — was invisible to every check built on this function. Six such strings
    // existed in the worker, and writing one more was how it came to light.
    let i = m.index + m[0].length;
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i += 1;
      if (src[i] === '/' && src[i + 1] === '/') { const n = src.indexOf('\n', i); if (n < 0) { i = src.length; break; } i = n + 1; continue; }
      if (src[i] === '/' && src[i + 1] === '*') { const n = src.indexOf('*/', i); if (n < 0) { i = src.length; break; } i = n + 2; continue; }
      break;
    }
    const q = src[i];
    if (q !== '`' && q !== "'" && q !== '"') continue;
    let j = i + 1;
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === q) break;
      j += 1;
    }
    const body = src.slice(i + 1, j);
    if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH)\b/i.test(body)) {
      // `kind` is the construct that introduced the string. It matters because
      // `sql\`…\`` is the tagged template from src/db.ts, where every `${…}`
      // becomes a bound `?` — so the SQL *structure* is fully literal even
      // when the string is not. A `.prepare(` template interpolates raw text
      // and can carry an identifier, which is a different thing entirely.
      out.push({ body, kind: m[0], line: src.slice(0, i).split('\n').length });
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = [];
  let scanned = 0;
  for (const file of walk(SRC)) {
    const rel = path.relative(ROOT, file);
    for (const { body, line } of sqlStrings(fs.readFileSync(file, 'utf8'))) {
      scanned += 1;
      for (const [name, re, hint] of FOREIGN) {
        if (re.test(body)) violations.push({ rel, line, name, hint });
      }
    }
  }

  if (violations.length) {
    console.error('✖ check-sqlite-dialect: SQL that D1 cannot run:');
    for (const v of violations) {
      console.error(`  ${v.rel}:${v.line}  ${v.name}  —  ${v.hint}`);
    }
    console.error('\nD1 is SQLite. These parse on another engine and throw here,');
    console.error('at runtime, on whichever path happens to reach them.');
    process.exit(1);
  }
  console.log(`✓ check-sqlite-dialect: ${scanned} SQL strings, no foreign dialect.`);
}
