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
 * A qualified `alias.column` in a JOIN query is attributable on exactly the
 * same terms, once the alias is bound to one table by the FROM/JOIN clauses —
 * the join makes the QUERY ambiguous, not the reference. That pass found
 * eleven more across 1694 references, including a second copy of a broken
 * partner_deals query whose first copy had already been corrected.
 *
 * And all of the above now also read the `sql\`…\`` tagged template from
 * src/db.ts, which every pass had skipped for containing `${…}`. That tag
 * appends a literal `?` per interpolation and binds the value, so those
 * queries' structure is entirely literal — 833 of them, a fifth of all the SQL
 * in the worker, carrying ten more defects. `.prepare(` and `.exec(`
 * templates splice raw text that may be an identifier, so those stay skipped.
 *
 * Finally the WHERE / GROUP BY / ORDER BY / HAVING predicates of a
 * single-table statement. That is the largest surface of the four — 1914
 * statements, 3007 references — and the last one a column error could hide
 * in, which is exactly where two had: `dd_external_sources.source_kind` and
 * `documents.signer_email`, both filters, both silently matching no row.
 *
 * ONE THING THIS CHECK CANNOT SEE, by construction. When a table is defined
 * more than once — and 249 of them are — the definitions are UNIONED, because
 * nothing here can know which one D1 actually holds. The union satisfies every
 * query, so no column ever looks missing: `capital_calls` reads as nineteen
 * columns wide when no single version of it has ever had more than thirteen.
 * A union is the right default for a check that must not over-report; it just
 * means irreconcilable definitions are invisible here. `check-sqlite-table-
 * collisions.mjs` is the complement that looks for exactly those.
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
 *   4. A subquery names a second table. Counting `SELECT` catches
 *      `SELECT … (SELECT …)`, but an `UPDATE users … WHERE id IN (SELECT id
 *      FROM users …)` contains exactly one, so the count test passed and the
 *      inner `FROM users` was read as a column of the outer table.
 *   5. `COUNT(*) AS n … GROUP BY n` names a result, not a column. Twenty-one
 *      of the first twenty-nine predicate findings were aliases like this.
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

// Declared once, with the flag it needs: rebuilding it inside the loop below
// allocated a fresh pattern on every pass, up to 200 per file. `replace`
// resets lastIndex on each call, so a shared global regex is safe here.
const JOIN_ADJACENT_STRINGS = /(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\+\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g;

/**
 * Join adjacent JS string literals spliced with `+` into one literal, so DDL
 * assembled across source lines reads as the single statement it becomes.
 */
export function collapseStringConcat(src) {
  let out = src;
  for (let i = 0; i < 200; i += 1) {
    const next = out.replace(JOIN_ADJACENT_STRINGS, (_m, _q1, a, _q3, b) => `'${a}${b}'`);
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

/**
 * Balanced read of the `[ … ]` starting at `open`, in JavaScript source.
 *
 * Comments are skipped before quotes: an apostrophe in `// at D1's 100-column
 * limit` otherwise opens a string scan that eats the rest of the file, which
 * is exactly how `SETTINGS_USER_COLUMNS` came back unresolved on the first
 * attempt. Same fault the SQL scanners carried, one language over.
 */
function jsBracket(s, open) {
  let depth = 0, i = open;
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { const n = s.indexOf('\n', i); if (n < 0) return null; i = n + 1; continue; }
    if (c === '/' && s[i + 1] === '*') { const n = s.indexOf('*/', i); if (n < 0) return null; i = n + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i += 1;
      while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === q) break; i += 1; }
      i += 1; continue;
    }
    if (c === '[') depth += 1;
    else if (c === ']') { depth -= 1; if (!depth) return s.slice(open, i + 1); }
    i += 1;
  }
  return null;
}

/**
 * Columns added by `for (… of <literal array>) ALTER TABLE t ADD COLUMN ${…}`.
 *
 * Every such loop in the worker is one of two shapes, and both carry the
 * column names as literal data:
 *
 *   flat    for (const col of ['notes TEXT', …])   → the name is the first word
 *   tuple   for (const [col, type] of [['bio','TEXT'], …])  → the first element
 *
 * Which one is in play is read off the loop's own destructuring, not guessed.
 * Returns `{ table, cols }` per loop, with `cols` null when the array could not
 * be resolved — the caller then marks the table incomplete rather than
 * pretending to know it.
 */
/** `ALTER TABLE <t> ADD COLUMN ${<var>}` — the identifier is captured, not built in. */
const ALTER_INTERPOLATED = /ALTER\s+TABLE\s+([`"[]?\w+[`"\]]?)\s+ADD\s+(?:COLUMN\s+)?\$\{\s*(\w+)\s*\}/i;

/** `const NAME … = [` — likewise captured and compared rather than interpolated. */
const ARRAY_DECL = /\b(?:const|let)\s+(\w+)\b[^=\n]*=\s*\[/g;

export function runtimeColumns(src) {
  const out = [];
  for (const m of src.matchAll(/for\s*\(\s*const\s+(\[[^\]]*\]|\w+)\s+of\s+([^)]+?)\)\s*\{/g)) {
    const binding = m[1];
    const expr = m[2].trim();
    const tuple = binding.startsWith('[');
    const loopVar = tuple ? binding.slice(1, -1).split(',')[0].trim() : binding;
    if (!/^\w+$/.test(loopVar)) continue;
    // The ALTER has to be inside this loop and interpolate THIS variable.
    // Both patterns below are literal and capture the identifier, which is
    // then compared in JS. Interpolating `loopVar` into a regex would work —
    // it is validated above and cannot carry a metacharacter — but a literal
    // pattern needs no such argument to be trusted, and Semgrep is right that
    // a built regex is the weaker form when a fixed one will do.
    const window = src.slice(m.index, m.index + 500);
    const alt = ALTER_INTERPOLATED.exec(window);
    if (!alt || alt[2] !== loopVar) continue;
    const table = norm(alt[1]);

    let arr = null;
    if (expr.startsWith('[')) arr = jsBracket(expr, 0);
    else if (/^[A-Za-z_]\w*$/.test(expr)) {
      for (const d of src.matchAll(ARRAY_DECL)) {
        if (d[1] !== expr) continue;
        arr = jsBracket(src, d.index + d[0].length - 1);
        break;
      }
    }
    if (!arr) { out.push({ table, cols: null }); continue; }

    const cols = tuple
      ? [...arr.matchAll(/\[\s*['"]([^'"]+)['"]/g)].map((x) => norm(x[1]))
      : [...arr.matchAll(/['"]([^'"]+)['"]/g)].map((x) => norm(x[1].trim().split(/\s+/)[0]));
    out.push({ table, cols });
  }
  return out;
}

/** table -> Set(column). A table mapped to null has DDL we could not parse. */
/** Column names added by DDL whose table name is interpolated. */
export const dynamicColumns = new Set();

/**
 * Tables extended at runtime by a loop this harvest could NOT read.
 *
 * Thirteen tables are extended by a loop over a literal list —
 * `for (const [col, type] of KYC_COLUMNS) ALTER TABLE users ADD COLUMN ${col}
 * ${type}` — and `runtimeColumns()` now reads those arrays, because they are
 * literal data sitting in the source rather than something to infer. Anything
 * it cannot resolve lands here and is skipped for every clause type, so the
 * soundness rule stays one rule. `npm run test:guards` prints the count: it is
 * the honest measure of what this check cannot speak for, and it should be
 * zero.
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
      const c = norm(m[2]);
      // `ADD COLUMN ${col}` — `${` is not \w, so the optional COLUMN group
      // backtracks and hands back the word COLUMN as the column name. That
      // invented a phantom `column` on fourteen tables. The real name comes
      // from runtimeColumns() instead.
      if (c === 'column') continue;
      // `ALTER TABLE ... ADD COLUMN` in prose is not a table called `...`.
      if (!/^[a-z_]\w*$/.test(t)) continue;
      if (!schema.get(t)) schema.set(t, new Set());
      schema.get(t).add(c);
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
    // Read the literal array the loop walks; only an unreadable one is a gap.
    for (const { table, cols } of runtimeColumns(text)) {
      if (!cols) { incompleteTables.add(table); continue; }
      if (!schema.get(table)) schema.set(table, new Set());
      for (const c of cols) schema.get(table).add(c);
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

/**
 * Words that can follow FROM/JOIN and be mistaken for an alias. `JOIN t ON …`
 * would otherwise bind an alias called `on` to table `t`.
 */
const NOT_AN_ALIAS = new Set([
  'on', 'and', 'or', 'where', 'join', 'left', 'right', 'inner', 'outer', 'cross',
  'group', 'order', 'having', 'limit', 'union', 'as', 'set', 'using', 'natural',
  'when', 'then', 'else', 'end', 'is', 'not', 'null', 'in', 'exists', 'case',
]);

/**
 * alias -> table, for a query's FROM/JOIN clauses.
 *
 * An alias bound to two different tables in one statement is mapped to null
 * and skipped: that is the ambiguity this check refuses to guess through.
 */
export function aliasMap(sql) {
  const m = new Map();
  // Comments are not SQL: "the join threw" would otherwise bind an alias.
  const clean = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  for (const x of clean.matchAll(/\b(?:FROM|JOIN)\s+([`"[]?\w+[`"\]]?)\s+(?:AS\s+)?([a-z]\w*)\b/gi)) {
    const alias = x[2].toLowerCase();
    if (NOT_AN_ALIAS.has(alias)) continue;
    const table = norm(x[1]);
    if (m.has(alias) && m.get(alias) !== table) { m.set(alias, null); continue; }
    m.set(alias, table);
  }
  return m;
}

/**
 * Comments and string literals blanked to spaces, so prose never reaches the
 * identifier scanner. Length is preserved because the caller slices this same
 * string at the offset it finds the WHERE in.
 *
 * Kept local rather than reusing `stripSqlLiterals` from check-sqlite-tables:
 * that one collapses literals instead of blanking them and leaves `"…"`
 * alone. Double quotes are ambiguous in SQLite — an identifier if one
 * resolves, a string otherwise — and blanking them under-reports, which is
 * the side this file errs on.
 */
export function blankLiterals(sql) {
  let out = '', i = 0;
  while (i < sql.length) {
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const n = sql.indexOf('\n', i);
      const end = n < 0 ? sql.length : n;
      out += ' '.repeat(end - i); i = end; continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const q = sql[i];
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === q && sql[j + 1] === q) { j += 2; continue; }
        if (sql[j] === q) break;
        j += 1;
      }
      const end = Math.min(j, sql.length);
      out += ' '.repeat(end - i + 1); i = j + 1; continue;
    }
    out += sql[i]; i += 1;
  }
  return out;
}

/**
 * `${…}` replaced by the `?` it actually becomes.
 *
 * The tagged template in src/db.ts appends a literal `?` per interpolation and
 * binds the value, so a `sql\`…\`` query's STRUCTURE is entirely literal even
 * though its text is not. Skipping those wholesale — as every pass did until
 * now — hid 833 queries, a fifth of all the SQL in the worker.
 *
 * Braces are matched rather than scanned to the first `}`, because an
 * interpolation can contain an object literal or a nested template.
 */
export function substituteBindings(sql) {
  let out = '', i = 0;
  while (i < sql.length) {
    if (sql[i] !== '$' || sql[i + 1] !== '{') { out += sql[i]; i += 1; continue; }
    let depth = 0, j = i + 1;
    for (; j < sql.length; j += 1) {
      if (sql[j] === '{') depth += 1;
      else if (sql[j] === '}') { depth -= 1; if (depth === 0) break; }
    }
    if (depth !== 0) return null;          // unbalanced — decline the string
    out += '?';
    i = j + 1;
  }
  return out;
}

/** Reserved words a predicate can contain that are not column names. */
const PREDICATE_KEYWORDS = new Set(`select from where and or not null is in like glob between exists case when then else end
order by group having limit offset asc desc collate nocase binary rtrim distinct as on join left right inner outer cross natural using
insert into values update set delete returning conflict do nothing union all intersect except with recursive
cast integer text real blob numeric boolean true false current_timestamp current_date current_time default primary key unique check references
escape isnull notnull match regexp filter over partition window rows range unbounded preceding following current row groups exclude ties others
if replace abort fail ignore rollback deferrable initially immediate deferred restrict cascade action foreign temp temporary table index view trigger`
  .split(/\s+/).filter(Boolean));

/**
 * The predicate region of a statement that reads exactly one table, plus the
 * SELECT-list aliases that are legal to name in it.
 *
 * Declines — returns null — on a join, a comma join, a set operation, a CTE,
 * or any subquery, because each of those puts a second table in scope and the
 * reference stops being attributable.
 */
export function singleTablePredicate(sql) {
  const s = blankLiterals(sql);
  if (/\bJOIN\b/i.test(s)) return null;
  if ((s.match(/\bSELECT\b/gi) || []).length > 1) return null;
  // An UPDATE or DELETE has no SELECT of its own, so counting is not enough:
  // its one SELECT is the subquery, and the subquery's table is not ours.
  if (/\(\s*SELECT\b/i.test(s)) return null;
  if (/\bWITH\b|\bUNION\b|\bINTERSECT\b|\bEXCEPT\b/i.test(s)) return null;

  let table = null, alias = null;
  let m = /\bFROM\s+([`"[]?\w+[`"\]]?)(?:\s+(?:AS\s+)?([a-z]\w*))?/i.exec(s);
  if (m) {
    table = norm(m[1]);
    if (m[2] && !NOT_AN_ALIAS.has(m[2].toLowerCase())) alias = m[2].toLowerCase();
  }
  if (!table) {
    m = /^\s*(?:UPDATE|DELETE\s+FROM)\s+([`"[]?\w+[`"\]]?)/i.exec(s);
    if (m) table = norm(m[1]);
  }
  if (!table) return null;
  if (/\bFROM\s+[`"[]?\w+[`"\]]?\s*(?:(?:AS\s+)?[a-z]\w*)?\s*,/i.test(s)) return null;   // comma join

  const w = /\b(WHERE|ORDER\s+BY|GROUP\s+BY|HAVING)\b/i.exec(s);
  if (!w) return null;

  // `COUNT(*) AS n … GROUP BY n` — an alias is a result name, not a column.
  const aliases = new Set();
  for (const a of s.slice(0, w.index).matchAll(/\bAS\s+([`"[]?[a-z_]\w*[`"\]]?)/gi)) aliases.add(norm(a[1]));

  return { table, alias, aliases, region: s.slice(w.index) };
}

/** Bare and self-qualified identifiers in a predicate, minus function names. */
export function predicateIdents(region) {
  const noFn = region.replace(/\b[a-z_]\w*\s*\(/gi, ' (');   // a call is not a column
  const out = [];
  for (const m of noFn.matchAll(/\b([a-z_]\w*)(\.([a-z_]\w*))?\b/gi)) {
    out.push(m[3] ? { qual: m[1].toLowerCase(), col: norm(m[3]) } : { qual: null, col: norm(m[1]) });
  }
  return out;
}

/** INSERT column lists, UPDATE SET clauses and single-table SELECT lists. */
/** How much of the worker's SQL the last run could actually speak for. */
export const coverage = { read: 0, skipped: 0 };

export function unknownColumns() {
  const schema = knownColumns();
  const hits = new Map();
  coverage.read = 0;
  coverage.skipped = 0;
  for (const file of walk(SRC, '.ts')) {
    const rel = path.relative(ROOT, file);
    for (const { body: raw, kind, line } of sqlStrings(fs.readFileSync(file, 'utf8'))) {
      let body = raw;
      if (body.includes('${')) {
        // Only the tagged template guarantees a binding. A `.prepare(` or
        // `.exec(` template splices raw text, which may be an identifier, so
        // those stay skipped.
        if (kind !== 'sql') { coverage.skipped += 1; continue; }
        body = substituteBindings(body);
        if (body === null) { coverage.skipped += 1; continue; }
      }
      coverage.read += 1;
      // alias.column in a JOIN query — the alias fixes the table, so the
      // reference is as attributable as a single-table one. Only aliases
      // bound to exactly one table are used.
      if (/\bJOIN\b/i.test(body)) {
        const aliases = aliasMap(body);
        for (const x of body.matchAll(/\b([a-z]\w*)\.([a-z_]\w*)\b/gi)) {
          const table = aliases.get(x[1].toLowerCase());
          if (!table || incompleteTables.has(table)) continue;
          const qcols = schema.get(table);
          if (!qcols) continue;
          const col = norm(x[2]);
          if (qcols.has(col) || dynamicColumns.has(col) || /^(rowid|oid|_rowid_)$/.test(col)) continue;
          const k = `${table}.${col}`;
          if (!hits.has(k)) hits.set(k, []);
          hits.get(k).push(`${rel}:${line}`);
        }
      }

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

      // WHERE / GROUP BY / ORDER BY / HAVING of a single-table statement.
      const pred = singleTablePredicate(body);
      if (pred && !incompleteTables.has(pred.table)) {
        const pcols = schema.get(pred.table);
        if (pcols) {
          for (const { qual, col } of predicateIdents(pred.region)) {
            if (qual && qual !== pred.alias && qual !== pred.table) continue;
            if (PREDICATE_KEYWORDS.has(col) || pred.aliases.has(col) || /^\d/.test(col)) continue;
            if (pcols.has(col) || dynamicColumns.has(col) || /^(rowid|oid|_rowid_)$/.test(col)) continue;
            const k = `${pred.table}.${col}`;
            if (!hits.has(k)) hits.set(k, []);
            hits.get(k).push(`${rel}:${line}`);
          }
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
  // The skipped counts are printed rather than hidden: they are the honest
  // measure of how much of the schema this check cannot speak for.
  console.log(
    `✓ check-sqlite-columns: every INSERT, UPDATE, SELECT list, qualified join reference and single-table predicate names columns that exist `
    + `(${coverage.read} SQL strings read, ${coverage.skipped} skipped as raw-interpolated; `
    + `${n} known gap${n === 1 ? '' : 's'} on record; ${incompleteTables.size} tables skipped as runtime-extended).`,
  );
}
