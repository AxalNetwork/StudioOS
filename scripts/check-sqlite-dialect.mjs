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
 * THE ANCHORED PASS — a literal sitting immediately after `.prepare(`,
 * `.exec(` or the `sql` tag. Kept exactly as it was, because it is what
 * assigns `kind`, and `kind` is what `check-sqlite-columns.mjs` reads to
 * decide whether a `${…}` is a guaranteed bind or spliced raw text.
 *
 * It is no longer the whole harvest: see `sqlStrings` below for why.
 */
function anchoredStrings(src) {
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

/**
 * A statement, not a sentence — the verb AND the companion clause it cannot be
 * a statement without.
 *
 * The anchored pass above can be loose about this, because its anchor already
 * proved the string was handed to D1. A pass over EVERY literal cannot, and
 * this rule had to be tightened twice on real findings:
 *
 *   "contains a statement keyword"  accepted an `activity_logs` audit sentence,
 *                                   a Salesforce SOQL escaper and two
 *                                   `throw new Error` messages.
 *   "OPENS with a statement keyword" accepted **'Update failed'** — the toast in
 *                                   `routes/settings.ts:1190` and three more
 *                                   like it, which this guard duly reported as
 *                                   a query against a table called `failed`.
 *
 * So `UPDATE` must reach a `SET`, `INSERT` an `INTO`, `DELETE` a `FROM`, and so
 * on. An English sentence starting with one of these verbs does not.
 */
const STATEMENT_SHAPES = [
  /^\s*SELECT\b[\s\S]*?\bFROM\b/i,
  // `SELECT datetime('now')`, `SELECT 1` — real statements with no FROM. Bounded
  // to a function call or a literal so prose cannot reach it.
  /^\s*SELECT\s+(?:DISTINCT\s+)?(?:\d|[a-z_]+\s*\()/i,
  /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\b/i,
  /^\s*REPLACE\s+INTO\b/i,
  /^\s*UPDATE\s+(?:OR\s+\w+\s+)?[`"[]?\w+[`"\]]?\s+SET\b/i,
  /^\s*DELETE\s+FROM\b/i,
  /^\s*CREATE\s+(?:UNIQUE\s+|TEMP\s+|TEMPORARY\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\b/i,
  /^\s*ALTER\s+TABLE\b/i,
  /^\s*DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER)\b/i,
  /^\s*WITH\b[\s\S]*?\bAS\s*\(/i,
  /^\s*PRAGMA\s+\w/i,
];

const looksLikeStatement = (body) => STATEMENT_SHAPES.some((re) => re.test(body));

/**
 * SOQL is not SQLite, and it is shaped exactly like it.
 *
 * `integrations/providers/salesforce.ts:571` builds
 * `SELECT Id, StageName, LastModifiedDate FROM Opportunity …` and sends it to
 * Salesforce's REST API — it never reaches D1. Structurally nothing tells it
 * apart from a SQLite SELECT, so the tables guard duly reported a missing table
 * called `opportunity` the moment this pass could see it.
 *
 * The discriminator is the binding: the repo names these `soql`, which is what
 * the language is called. Narrow on purpose — a baseline entry would have
 * recorded it under "SQLite tables known to be missing", which is not what it
 * is.
 */
const SOQL_BINDING = /\b[a-z_]*soql\s*[:=]\s*$/i;

/** Can the character before a `/` end an expression? If not, the `/` opens a regex. */
function endsExpression(ch) {
  return ch !== undefined && /[\w$)\]]/.test(ch);
}

/**
 * Every string literal in a file, found by position rather than by caller.
 *
 * WHY A LEXER AND NOT A REGEX. The point of this pass is the literals the
 * anchored one cannot reach, and those are reached through a *variable*:
 * `num(env, \`SELECT …\`, userId)`, `env.DB.prepare(sql)`, `{ sql: \`…\` }`.
 * None of them puts a quote next to an anchor token, so only walking the file
 * finds them.
 *
 * REGEX LITERALS ARE THE HAZARD, and they are silent. `escapeSoql` in
 * `integrations/providers/salesforce.ts` is `.replace(/'/g, "\\'")`; read as a
 * string opener, that lone quote desynchronises everything after it and
 * **swallowed 139 statements in that one file**. So a `/` is treated as a regex
 * unless the previous meaningful character could end an expression — erring
 * toward regex on purpose, because the union below makes a wrong guess cost
 * only the widening, never existing coverage.
 */
function literalStrings(src) {
  const out = [];
  const lineAt = (at) => {
    let n = 1;
    for (let k = 0; k < at; k += 1) if (src[k] === '\n') n += 1;
    return n;
  };
  let i = 0;
  let prev;                                     // last meaningful character
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const n = src.indexOf('\n', i);
      i = n < 0 ? src.length : n + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const n = src.indexOf('*/', i);
      i = n < 0 ? src.length : n + 2;
      continue;
    }
    if (c === '/' && !endsExpression(prev)) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;                  // unterminated — it was division
        if (inClass) { if (d === ']') inClass = false; }
        else if (d === '[') inClass = true;
        else if (d === '/') break;
        j += 1;
      }
      if (src[j] === '/') { i = j + 1; prev = '/'; continue; }
      i += 1;
      prev = '/';
      continue;
    }
    if (c === '`' || c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j += 1;
      }
      const body = src.slice(i + 1, j);
      if (looksLikeStatement(body) && !SOQL_BINDING.test(src.slice(Math.max(0, i - 40), i))) {
        // `literal` is deliberately not `sql`: nothing here proves a `${…}`
        // becomes a bind, so `check-sqlite-columns.mjs` must keep treating an
        // interpolated one as raw text, exactly as it does a `.prepare(` one.
        out.push({ body, kind: 'literal', line: lineAt(i) });
      }
      i = j + 1;
      prev = c;
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return out;
}

/**
 * Every SQL-carrying string literal in a file — the UNION of the two passes.
 *
 * WHY A UNION AND NOT A REPLACEMENT. The anchored pass had a blind spot it
 * could not see out of: it harvests the literal next to `.prepare(`, `.exec(`
 * or `sql`, so a query handed to a helper — `num(env, \`SELECT …\`, userId)` —
 * was invisible to every check built on this function. Measured on
 * `services/onboardingChecklist.ts`: 9 of its 54 literals were harvested, and
 * the 44 that were not are the whole feature. Twenty-four of them name a table
 * or column that does not exist, each swallowed by a `catch { return 0 }`, so
 * the checklist item read "not done" for every operator, forever. That file's
 * own header had already described the failure — "a swallowed query is
 * indistinguishable from an honest zero" — after `op.service` paid for it once.
 *
 * The union is what makes widening safe: the lexer below can desynchronise on
 * a construct nobody anticipated, and if it does, the anchored pass still
 * returns everything it always did. A lexing miss costs the widening, never
 * the coverage that existed before it.
 */
export function sqlStrings(src) {
  const out = [];
  const seen = new Set();
  for (const s of [...anchoredStrings(src), ...literalStrings(src)]) {
    const key = `${s.line}\u0000${s.body}`;
    if (seen.has(key)) continue;                // the anchored pass wins: it carries the real `kind`
    seen.add(key);
    out.push(s);
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
