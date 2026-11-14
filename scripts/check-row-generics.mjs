#!/usr/bin/env node
/**
 * Fails the build when a D1 row generic declares a field the SELECT never
 * returns.
 *
 *     await env.DB.prepare('SELECT id, name FROM projects WHERE id = ?')
 *       .bind(id).first<{ id: number; name: string; founder_id: number }>();
 *
 * `founder_id` is not in the select list, so it is `undefined` at runtime — and
 * TypeScript will not say a word, because the generic is an assertion about a
 * value the type system never sees. It is the same class as every other check
 * here: a field that reads as empty rather than as an error.
 *
 * The generic is the easiest source of truth in the codebase to check against.
 * It sits inches from the SQL, it is a literal, and it is written by the same
 * hand in the same breath. 147 of them are checked; none is currently wrong,
 * which is the point — this is the cheap gate that keeps it that way.
 *
 * WHAT IT DECLINES, and why the declining matters more than the checking:
 *   - A select list containing `*`. The shape is the table's, not the query's.
 *   - An expression with no alias — `COALESCE(a, b)` without `AS`. SQLite names
 *     that column after the expression text; nobody reads it that way, so the
 *     query is skipped rather than guessed at.
 *   - A named interface rather than an inline object literal. Resolving it
 *     means following an import, and a check that follows imports badly is
 *     worse than one that stops.
 *   - Any interpolated SQL, since the select list may not be literal.
 *
 * ONE PARSER FAULT, and it is the instructive kind. The first version matched
 * the SQL with a lazy `([\s\S]*?)\1`, which can run PAST its own closing quote
 * to a later one — so a bind-less `.first()` at one statement was paired with
 * the generic of a different statement further down, and the probe reported
 * three defects that do not exist. Constraining the body to
 * `((?:\\.|(?!\1)[\s\S])*)` fixed it, and the telling part is that the pair
 * count went UP: 173 to 207, 97 checked to 147. A correct fix here found MORE
 * real work, not less. That is the difference between fixing a parser and
 * silencing it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'cloudflare-worker/src');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * The keys a SELECT list produces: `x AS y` → y, `t.c` → c, `c` → c.
 * Returns null when any part cannot be named — `*`, or an unaliased expression.
 */
export function selectKeys(sql) {
  const m = /^\s*SELECT\s+(?:DISTINCT\s+)?([\s\S]*?)\s+FROM\s/i.exec(sql);
  if (!m) return null;
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of m[1]) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  const keys = [];
  for (const raw of parts) {
    const p = raw.replace(/--.*$/gm, '').trim();
    if (!p) continue;
    // An alias names the result whatever the expression is, so `COUNT(*) AS n`
    // is attributable. Testing the whole list for `*` up front declined those
    // queries wholesale and cost about a third of the coverage.
    const as = /\bAS\s+[`"[]?(\w+)[`"\]]?\s*$/i.exec(p);
    if (as) { keys.push(as[1].toLowerCase()); continue; }
    if (p.includes('*')) return null;  // a bare star — the shape is the table's
    const bare = /^[`"[]?(\w+)[`"\]]?(?:\.[`"[]?(\w+)[`"\]]?)?$/.exec(p);
    if (bare) { keys.push((bare[2] || bare[1]).toLowerCase()); continue; }
    return null;                       // an expression with no alias
  }
  return keys.length ? keys : null;
}

/** The balanced `<…>` beginning at `i`, or null. */
export function balancedAngle(src, i) {
  if (src[i] !== '<') return null;
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    if (src[j] === '<') depth += 1;
    else if (src[j] === '>') { depth -= 1; if (depth === 0) return src.slice(i + 1, j); }
  }
  return null;
}

/**
 * Top-level field names of an inline object type.
 *
 * The outer braces are stripped first. Leaving them on makes every field sit
 * at depth 1, the depth test skips all of them, and the check reports a clean
 * pass over a type it never read — which is exactly what it did until an
 * injected phantom field failed to trip it.
 */
export function typeFields(objectType) {
  const t = objectType.trim();
  const body = t.startsWith('{') && t.endsWith('}') ? t.slice(1, -1) : t;
  const out = [];
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    // Only real brackets. `<` and `>` are ambiguous in TypeScript — the `>` in
    // an arrow type `(v: string) => number` drove the depth negative and every
    // field after it was skipped.
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    if (depth !== 0) continue;
    const m = /^([a-z_]\w*)\s*\??\s*:/i.exec(body.slice(i));
    if (!m) continue;
    const before = body.slice(0, i).replace(/\s+$/, '');
    if (before === '' || /[{;,]$/.test(before)) out.push(m[1].toLowerCase());
  }
  return out;
}

/**
 * The SQL body must not run past its own closing quote — see the parser-fault
 * note above. The gap to `.all<`/`.first<` may hold only an optional `.bind(…)`.
 */
const PREPARE_GENERIC =
  /\.prepare\(\s*(`|'|")((?:\\.|(?!\1)[\s\S])*)\1\s*\)(\s*\.bind\([^()]*(?:\([^()]*\)[^()]*)*\))?\s*\.(?:all|first)</g;

/** Generic fields no SELECT in the same call can produce. */
export function phantomFields() {
  const bad = [];
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    for (const m of src.matchAll(PREPARE_GENERIC)) {
      const sql = m[2];
      if (sql.includes('${')) continue;
      const g = balancedAngle(src, m.index + m[0].length - 1);
      if (!g || !/^\s*\{/.test(g)) continue;        // named interface — declined
      const keys = selectKeys(sql);
      if (!keys) continue;
      const missing = typeFields(g).filter((f) => !keys.includes(f));
      if (missing.length) {
        bad.push({
          rel, line: src.slice(0, m.index).split('\n').length,
          missing, keys,
        });
      }
    }
  }
  return bad;
}

/** How many prepare/generic pairs were found, and how many were checkable. */
export function coverage() {
  let pairs = 0, checked = 0;
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(PREPARE_GENERIC)) {
      if (m[2].includes('${')) continue;
      const g = balancedAngle(src, m.index + m[0].length - 1);
      if (!g || !/^\s*\{/.test(g)) continue;
      pairs += 1;
      if (selectKeys(m[2])) checked += 1;
    }
  }
  return { pairs, checked };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bad = phantomFields();
  if (bad.length) {
    console.error('✖ check-row-generics: a row type declares a field the SELECT does not return:\n');
    for (const b of bad) {
      console.error(`  ${b.rel}:${b.line}`);
      console.error(`      declared: ${b.missing.join(', ')}`);
      console.error(`      SELECT gives: ${b.keys.join(', ')}`);
    }
    console.error('\nThe field is undefined at runtime and tsc cannot see it — the generic is');
    console.error('an assertion about a value the type system never checks.');
    console.error('\nAdd the column to the select list, or drop it from the type.');
    process.exit(1);
  }
  const { pairs, checked } = coverage();
  console.log(
    `✓ check-row-generics: ${checked} of ${pairs} inline row types match their select list `
    + `(${pairs - checked} declined — a star, or an expression with no alias).`,
  );
}
