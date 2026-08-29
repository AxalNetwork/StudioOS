#!/usr/bin/env node
/**
 * Fails the build when the worker INSERTs into a column nothing creates.
 *
 * The sibling of `check-sqlite-tables.mjs`, one level finer. A missing table
 * and a missing column fail identically at runtime — "no such table" and "no
 * such column" are both thrown by D1, both invisible to `tsc`, and both caught
 * by the same swallowing `catch` blocks — so both produce the same symptom: a
 * feature that quietly does nothing.
 *
 * INSERT column lists and UPDATE ... SET clauses are checked. They are the two
 * places a column is named unambiguously — no aliasing, no joins, no
 * expressions — so a mismatch is a fact rather than an inference. SELECT lists
 * are much richer and much harder to attribute to a table correctly, and a
 * check that has to guess is a check nobody will trust.
 *
 * UPDATE was added after INSERT and found two more: `projects.pipeline_stage`,
 * which exists on no table anywhere, and `users.organization`, which the
 * advisor writes and then reads back to decide whether it already asked.
 *
 * HARVESTING IS THE HARD PART, and getting it wrong over-reports. Three
 * distinct parser faults were found and fixed while building this, each of
 * which invented columns that exist perfectly well:
 *
 *   1. `-- …` comments were not stripped, so a commented column definition
 *      never registered.
 *   2. Comments were then stripped AFTER the top-level comma split, but a
 *      comment like `-- {summary, terms{...}}` contains commas: it corrupted
 *      the split itself and swallowed every column defined below it.
 *   3. DDL built by string concatenation —
 *      `'CREATE TABLE x (' + 'col TEXT, ' + …` — was read only as far as its
 *      first fragment. That is how `oauth_state_tokens` is defined in
 *      `integrations/oauth.ts`, and it made `pkce_verifier` look absent.
 *
 * Those three took the reported count from 106 to 20. The lesson is the one
 * this repo keeps relearning: a check is only worth its output if it reads
 * the material rather than a convenient shape of it. So over-harvest
 * deliberately — a table whose DDL cannot be parsed is skipped entirely
 * rather than reported, because a false "missing column" costs more trust
 * than a missed one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqlStrings } from './check-sqlite-dialect.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'cloudflare-worker', 'src');
const SQL_DIR = path.join(ROOT, 'cloudflare-worker', 'sql');
const BASELINE = path.join(ROOT, 'scripts', 'sqlite-columns-baseline.json');

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
 * Join adjacent JS string literals spliced with `+` into one literal, so DDL
 * assembled across source lines reads as the single statement it becomes.
 */
export function collapseStringConcat(src) {
  const JOIN = /(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\+\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/;
  let out = src;
  for (let i = 0; i < 200; i += 1) {
    const next = out.replace(new RegExp(JOIN, 'g'), (_m, _q1, a, _q3, b) => `'${a}${b}'`);
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Read the balanced `(...)` group starting at `open`, honouring SQL strings. */
function group(s, open) {
  let depth = 0, i = open;
  while (i < s.length) {
    const ch = s[i];
    // Skip `-- …` before anything else: an apostrophe inside a comment
    // ("the scorer's own scale") would otherwise open a string scan that
    // consumes the rest of the statement. Stripping comments beforehand is
    // not an option here — the caller needs indices into the original text.
    if (ch === '-' && s[i + 1] === '-') { const n = s.indexOf('\n', i); if (n < 0) return null; i = n + 1; continue; }
    if (ch === "'" || ch === '"') {
      const q = ch; i += 1;
      while (i < s.length) { if (s[i] === q && s[i + 1] === q) { i += 2; continue; } if (s[i] === q) break; i += 1; }
      i += 1; continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') { depth -= 1; if (!depth) return { body: s.slice(open + 1, i), end: i }; }
    i += 1;
  }
  return null;
}

/** Split on top-level commas, ignoring those inside nesting or SQL strings. */
function topLevel(body) {
  const out = []; let depth = 0, start = 0, i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '-' && body[i + 1] === '-') { const n = body.indexOf('\n', i); i = n < 0 ? body.length : n + 1; continue; }
    if (ch === "'" || ch === '"') {
      const q = ch; i += 1;
      while (i < body.length) { if (body[i] === q && body[i + 1] === q) { i += 2; continue; } if (body[i] === q) break; i += 1; }
      i += 1; continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
    i += 1;
  }
  if (body.slice(start).trim()) out.push(body.slice(start));
  return out;
}

const stripComments = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
// SQLite's table constraints, and only those. A bare `KEY (...)` constraint is
// MySQL syntax that SQLite does not accept, so a definition starting with KEY
// is a column literally named `key` — which both cohort_settings and
// signal_sources have. Listing it here reported those two as missing.
const CONSTRAINT = /^\s*(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i;

/** table -> Set(column). A table mapped to null has DDL we could not parse. */
/** Column names added by DDL whose table name is interpolated. */
export const dynamicColumns = new Set();

/**
 * Tables whose column set cannot be known from the source.
 *
 * Thirteen tables are extended at runtime by a loop over a literal list —
 * `for (const [col, type] of KYC_COLUMNS) ALTER TABLE users ADD COLUMN
 * ${col} ${type}` — so the column name never appears in a position this
 * harvest can attribute. Binding the loop variable back to its array is real
 * static analysis, and guessing at it would put the check back in the business
 * of inventing findings: every `users.kyc_*` column reads as missing and is
 * not. Such tables are skipped entirely, for every clause type, so the rule
 * stays one rule. The cost is visible — `npm run test:guards` prints the count.
 */
export const incompleteTables = new Set();

export function knownColumns() {
  const schema = new Map();
  const sources = [
    ...walk(SQL_DIR, '.sql').map((f) => fs.readFileSync(f, 'utf8')),
    ...walk(SRC, '.ts').map((f) => collapseStringConcat(fs.readFileSync(f, 'utf8'))),
  ];
  for (const text of sources) {
    for (const m of text.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[]?[\w.]+[`"\]]?)\s*\(/gi)) {
      const t = norm(m[1]);
      const g = group(text, m.index + m[0].length - 1);
      if (!g) { schema.set(t, null); continue; }          // unparseable — never report
      if (!schema.get(t)) schema.set(t, new Set());
      for (const part of topLevel(stripComments(g.body))) {
        if (!part.trim() || CONSTRAINT.test(part)) continue;
        const c = /^\s*([`"[]?\w+[`"\]]?)/.exec(part.trim());
        if (c) schema.get(t).add(norm(c[1]));
      }
    }
    for (const m of text.matchAll(/\bALTER\s+TABLE\s+([`"[]?[\w.]+[`"\]]?)\s+ADD\s+(?:COLUMN\s+)?([`"[]?\w+[`"\]]?)/gi)) {
      const t = norm(m[1]);
      if (!schema.get(t)) schema.set(t, new Set());
      schema.get(t).add(norm(m[2]));
    }
    // A view's columns are whatever it selects; treat as unparseable.
    for (const m of text.matchAll(/\bCREATE\s+(?:\w+\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[]?[\w.]+[`"\]]?)/gi)) {
      if (!schema.has(norm(m[1]))) schema.set(norm(m[1]), null);
    }
    // `ALTER TABLE ${table} ADD COLUMN foo` — the table name comes from a
    // variable, so which tables gain the column cannot be read statically.
    // `ensureTaxonomyVersionColumns` adds `taxonomy_version` this way to every
    // table in a literal array. Suppressing the column name everywhere
    // over-harvests, which is the safe direction: it can hide a real finding
    // for that one name, never invent one.
    for (const m of text.matchAll(/\bALTER\s+TABLE\s+\$\{[^}]*\}\s+ADD\s+(?:COLUMN\s+)?([`"[]?\w+[`"\]]?)/gi)) {
      dynamicColumns.add(norm(m[1]));
    }
    // The mirror image: the table is literal, the column name is the variable.
    for (const m of text.matchAll(/\bALTER\s+TABLE\s+([`"[]?\w+[`"\]]?)\s+ADD\s+(?:COLUMN\s+)?\$\{/gi)) {
      incompleteTables.add(norm(m[1]));
    }
  }
  return schema;
}

/**
 * The SET clause of an UPDATE, from just after `SET` to the first top-level
 * WHERE / RETURNING / FROM. Comments and SQL strings are skipped so a
 * `WHERE` inside either cannot end the clause early.
 */
export function setClause(sql, from) {
  let depth = 0, i = from;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === '-' && sql[i + 1] === '-') { const n = sql.indexOf('\n', i); i = n < 0 ? sql.length : n + 1; continue; }
    if (ch === "'" || ch === '"') {
      const q = ch; i += 1;
      while (i < sql.length) { if (sql[i] === q && sql[i + 1] === q) { i += 2; continue; } if (sql[i] === q) break; i += 1; }
      i += 1; continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') { if (depth === 0) return sql.slice(from, i); depth -= 1; }
    else if (depth === 0 && /\s/.test(ch) && /^\s+(WHERE|RETURNING|FROM)\b/i.test(sql.slice(i))) {
      return sql.slice(from, i);
    }
    i += 1;
  }
  return sql.slice(from);
}

/**
 * A single-table SELECT's list, when every part of it is attributable: one
 * table, no join, no set operation, no subquery, no `*`. Returns null when any
 * of that fails — the check declines rather than guesses.
 */
export function singleTableSelect(sql) {
  if (!/^\s*SELECT\b/i.test(sql)) return null;
  if (/\bWITH\b|\bUNION\b|\bJOIN\b|\bSELECT\b[\s\S]*\bSELECT\b/i.test(sql)) return null;
  const m = /^\s*SELECT\s+(?:DISTINCT\s+)?([\s\S]*?)\sFROM\s+([`"[]?\w+[`"\]]?)(\s+(?:AS\s+)?([a-z]\w*))?\s*(?=$|WHERE|ORDER|GROUP|LIMIT|HAVING)/i.exec(sql);
  if (!m || m[1].includes('*')) return null;
  return { list: m[1], table: norm(m[2]), alias: m[4] ? m[4].toLowerCase() : null };
}

/** INSERT column lists, UPDATE SET clauses and single-table SELECT lists. */
export function unknownColumns() {
  const schema = knownColumns();
  const hits = new Map();
  for (const file of walk(SRC, '.ts')) {
    const rel = path.relative(ROOT, file);
    for (const { body, line } of sqlStrings(fs.readFileSync(file, 'utf8'))) {
      if (body.includes('${')) continue;                  // interpolated — column list is not literal
      // SELECT a, b FROM t — attributable only when there is exactly one table.
      const sel = singleTableSelect(body);
      if (sel) {
        const scols = schema.get(sel.table);
        if (scols && !incompleteTables.has(sel.table)) {
          for (const raw of topLevel(sel.list)) {
            const item = raw.trim();
            let col = null;
            // `SELECT 1 FROM t` is a literal, not a column: \w matches digits.
            const bare = /^([`"[]?[A-Za-z_]\w*[`"\]]?)$/.exec(item);
            if (bare) col = norm(bare[1]);
            else {
              const q = /^([a-z]\w*)\.([`"[]?[A-Za-z_]\w*[`"\]]?)$/i.exec(item);
              if (q && (q[1].toLowerCase() === sel.alias || norm(q[1]) === sel.table)) col = norm(q[2]);
            }
            // Anything else is an expression, a function or an alias — not
            // attributable, so not this check's to judge.
            if (!col || /^(rowid|oid|_rowid_)$/.test(col)) continue;
            if (scols.has(col) || dynamicColumns.has(col)) continue;
            const k = `${sel.table}.${col}`;
            if (!hits.has(k)) hits.set(k, []);
            hits.get(k).push(`${rel}:${line}`);
          }
        }
      }

      // UPDATE <table> SET a = ?, b = ? — the SET columns belong to <table>
      // with no ambiguity, the same property that makes an INSERT list checkable.
      for (const um of body.matchAll(/\bUPDATE\s+(?:OR\s+\w+\s+)?([`"[]?\w+[`"\]]?)\s+SET\s/gi)) {
        const ut = norm(um[1]);
        const ucols = schema.get(ut);
        if (!ucols || incompleteTables.has(ut)) continue;
        const clause = setClause(body, um.index + um[0].length);
        for (const part of topLevel(clause)) {
          const c = /^\s*([`"[]?\w+[`"\]]?)\s*=/.exec(part);
          if (!c) continue;
          const col = norm(c[1]);
          if (!col || ucols.has(col) || dynamicColumns.has(col)) continue;
          const k = `${ut}.${col}`;
          if (!hits.has(k)) hits.set(k, []);
          hits.get(k).push(`${rel}:${line}`);
        }
      }

      const m = /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+([`"[]?\w+[`"\]]?)\s*\(/i.exec(body);
      if (!m) continue;
      const t = norm(m[1]);
      const cols = schema.get(t);
      if (!cols || incompleteTables.has(t)) continue;     // unknown, unparseable, or runtime-extended
      const g = group(body, m.index + m[0].length - 1);
      if (!g) continue;
      if (!/^\s*(VALUES|SELECT)\b/i.test(body.slice(g.end + 1))) continue;   // not a column list
      for (const raw of topLevel(g.body)) {
        const c = norm(raw.trim());
        if (!c || cols.has(c) || dynamicColumns.has(c)) continue;
        const k = `${t}.${c}`;
        if (!hits.has(k)) hits.set(k, []);
        hits.get(k).push(`${rel}:${line}`);
      }
    }
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = unknownColumns();
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).columns ?? {};

  const added = [...found.keys()].filter((k) => !(k in baseline)).sort();
  const resolved = Object.keys(baseline).filter((k) => !found.has(k)).sort();

  if (added.length) {
    console.error('✖ check-sqlite-columns: SQL naming a column that does not exist:\n');
    for (const k of added) {
      console.error(`  ${k}`);
      for (const w of [...new Set(found.get(k))]) console.error(`      ${w}`);
    }
    console.error('\nD1 answers "no such column" at runtime, and these writes are');
    console.error('usually wrapped in a catch — so the row is simply never written.');
    console.error('\nEither correct the column name, add it in a migration under');
    console.error('cloudflare-worker/sql/migrations/, or record it in');
    console.error('scripts/sqlite-columns-baseline.json with what happens today.');
    process.exit(1);
  }

  if (resolved.length) {
    console.error('✖ check-sqlite-columns: baseline entries that now exist:\n');
    for (const k of resolved) console.error(`  ${k}`);
    console.error('\nDelete them from scripts/sqlite-columns-baseline.json — a ledger of');
    console.error('known gaps is only worth reading if every line in it is still true.');
    process.exit(1);
  }

  const n = Object.keys(baseline).length;
  // The skipped count is printed rather than hidden: it is the honest measure
  // of how much of the schema this check cannot speak for.
  console.log(
    `✓ check-sqlite-columns: every INSERT, UPDATE and single-table SELECT names columns that exist `
    + `(${n} known gap${n === 1 ? '' : 's'} on record; ${incompleteTables.size} tables skipped as runtime-extended).`,
  );
}
