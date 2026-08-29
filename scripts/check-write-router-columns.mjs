#!/usr/bin/env node
/**
 * Fails the build when the advisor writeRouter routes an answer into a column
 * that does not exist on the table it writes to.
 *
 * `check-write-router-coverage.mjs` already asserts that every bank question is
 * ROUTED somewhere. It does not check that the destination is real, and those
 * destinations are invisible to `check-sqlite-columns` for a structural reason:
 * the writes are `UPDATE <table> SET ${col} = ?`, where `col` comes out of a
 * literal map at runtime. The SQL text carries no column name at all, so the
 * column guard skips it as raw-interpolated — correctly, since it cannot know
 * what will be spliced in. The map beside it does know.
 *
 * The damage is quiet in a specific way. Each of these writes has a fallback:
 * on error the answer is merged into a `*_extras_json` sidecar instead. So the
 * answer is not lost, the caller is told `status: 'saved'`, and the typed
 * column the product reads is simply never populated. Meanwhile the
 * answered-check reads the same name back off a `SELECT *` row, gets
 * `undefined`, and the question is asked again next session. Forever.
 *
 * That is how three advisor questions came to be re-asked indefinitely:
 * migration 042 added `topics_willing_json`, `topics_unwilling_json` and
 * `weekly_hours_band` to `mentors` — a table nothing in this repo has ever
 * created — while the router writes them to `advisors`.
 *
 * RESOLUTION IS THE HARD PART, and getting it wrong over-reports. A first
 * attempt bound each map to the NEAREST PRECEDING map declaration, which
 * attributed `partnerMap`'s six columns to `explorer_needs` and invented six
 * defects that do not exist. Maps are therefore resolved BY NAME, through the
 * variable the UPDATE interpolates, and an UPDATE whose map cannot be resolved
 * is reported as unresolved rather than guessed at.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { knownColumns, incompleteTables } from './check-sqlite-columns.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'cloudflare-worker/src/services/advisor/writeRouter.ts');

/**
 * The `= {` that opens an object literal, at or after `from`.
 *
 * Not simply the next `=`: these maps are declared with type annotations that
 * contain arrow types — `Record<string, { col: string; coerce?: (v: string) =>
 * number }>` — and an `=>` inside one is not the assignment. Skipping that
 * distinction made the first version of this guard resolve two maps out of
 * six and report success on the other four, which is the failure it exists to
 * prevent, committed by the check itself.
 */
export function assignmentBrace(src, from) {
  for (let i = from; i < src.length; i += 1) {
    if (src[i] !== '=' || src[i + 1] === '>' || src[i + 1] === '=') continue;
    let j = i + 1;
    while (j < src.length && /\s/.test(src[j])) j += 1;
    if (src[j] === '{') return j;
    return -1;                       // an assignment, but not to an object
  }
  return -1;
}

/** The balanced `{ … }` body starting at the brace at or after `from`. */
function objectBody(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

/** `'question.id': { col: 'x' }` and `'question.id': 'x'` — the two shapes used. */
export function mapColumns(body) {
  const out = [];
  for (const m of body.matchAll(/'[\w.]+'\s*:\s*(?:\{\s*col:\s*'(\w+)'|'(\w+)')/g)) {
    out.push(m[1] || m[2]);
  }
  return out;
}

/**
 * The three declaration shapes, as LITERAL patterns that capture the declared
 * name so it can be compared in JS.
 *
 * Interpolating the name would work — it comes from the UPDATE's own
 * `${…}` and is a validated identifier that cannot carry a metacharacter — but
 * a literal pattern needs no such argument to be trusted, which is the same
 * conclusion reached for `check-sqlite-columns` (Semgrep 5931, 5932). Hoisted
 * because `matchAll` species-constructs its own copy, so a shared global regex
 * carries no `lastIndex` between calls.
 */
const TERNARY_DECL = /\b(?:const|let)\s+(\w+)\s*=[^;\n]*\?\s*'(\w+)'\s*:\s*'(\w+)'/g;
const MAP_LOOKUP_DECL = /\b(?:const|let)\s+(\w+)\s*=\s*([A-Za-z_]\w*)\s*\[/g;
const ANY_DECL = /\b(?:const|let)\s+(\w+)\b/g;

/**
 * Every `UPDATE <table> SET ${expr}` paired with the columns its map can
 * supply. `map` is null when the source could not be resolved by name.
 */
export function routedWrites(src) {
  const out = [];
  for (const u of src.matchAll(/UPDATE\s+(\w+)\s+SET\s+\$\{([\w.]+)\}/g)) {
    const table = u[1].toLowerCase();
    const expr = u[2];
    const base = expr.split('.')[0];
    const line = src.slice(0, u.index).split('\n').length;

    const head = src.slice(0, u.index);

    // `const <base> = <cond> ? 'a' : 'b'` — a two-column choice, not a map.
    // The brand write picks between `tagline` and `theme_color` this way.
    const ternary = [...head.matchAll(TERNARY_DECL)].filter((m) => m[1] === base).pop();
    if (ternary) {
      out.push({ table, expr, line, map: 'ternary', columns: [ternary[2], ternary[3]] });
      continue;
    }

    // `const <base> = <MAP>[...]` — the assignment that reads the map.
    const assign = [...head.matchAll(MAP_LOOKUP_DECL)].filter((m) => m[1] === base).pop();
    if (!assign) { out.push({ table, expr, line, map: null, columns: [] }); continue; }
    const mapName = assign[2];

    // The declaration must precede the UPDATE — several maps share the name
    // `map`, and taking the last one in the file would cross function bodies.
    const named = (hay) => [...hay.matchAll(ANY_DECL)].filter((m) => m[1] === mapName);
    const decl = named(head).pop() ?? named(src)[0];
    if (!decl) { out.push({ table, expr, line, map: mapName, columns: [] }); continue; }
    const brace = assignmentBrace(src, decl.index + decl[0].length);
    const body = brace < 0 ? null : objectBody(src, brace);
    out.push({ table, expr, line, map: mapName, columns: body ? mapColumns(body) : [] });
  }
  return out;
}

/** Routed columns that do not exist on the table the router writes them to. */
export function unroutableColumns() {
  const src = fs.readFileSync(FILE, 'utf8');
  const schema = knownColumns();
  const bad = [];
  for (const w of routedWrites(src)) {
    const cols = schema.get(w.table);
    if (!cols || incompleteTables.has(w.table)) continue;   // cannot speak for it
    for (const c of w.columns) {
      if (cols.has(c)) continue;
      bad.push({ table: w.table, column: c, map: w.map, line: w.line });
    }
  }
  return bad;
}

/** `saved_to: { table: 'x', column: 'y' }` — what the caller is TOLD happened. */
export function unroutableSavedTo() {
  const src = fs.readFileSync(FILE, 'utf8');
  const schema = knownColumns();
  const bad = [];
  for (const m of src.matchAll(/table:\s*'(\w+)'\s*,\s*column:\s*'(\w+)'/g)) {
    const table = m[1].toLowerCase();
    const cols = schema.get(table);
    if (!cols || incompleteTables.has(table)) continue;
    if (cols.has(m[2].toLowerCase())) continue;
    bad.push({ table, column: m[2], line: src.slice(0, m.index).split('\n').length });
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bad = unroutableColumns();
  const badSaved = unroutableSavedTo();
  if (bad.length || badSaved.length) {
    console.error('✖ check-write-router-columns: the router writes columns that do not exist:\n');
    for (const b of bad) {
      console.error(`  ${b.table}.${b.column}   (${b.map}) writeRouter.ts:${b.line}`);
    }
    for (const b of badSaved) {
      console.error(`  ${b.table}.${b.column}   reported as saved_to at writeRouter.ts:${b.line}`);
    }
    console.error('\nThe UPDATE throws, the answer falls back to a *_extras_json sidecar, and');
    console.error('the caller is still told the write succeeded. The answered-check then reads');
    console.error('the same name off a SELECT * row, gets undefined, and asks again next');
    console.error('session — indefinitely.');
    console.error('\nEither point the map at the real column, or add it in a migration under');
    console.error('cloudflare-worker/sql/migrations/.');
    process.exit(1);
  }
  const src = fs.readFileSync(FILE, 'utf8');
  const writes = routedWrites(src);
  const unresolved = writes.filter((w) => !w.columns.length);
  const n = writes.reduce((a, w) => a + w.columns.length, 0);
  console.log(
    `✓ check-write-router-columns: ${n} routed columns across ${writes.length - unresolved.length} maps `
    + `all exist (${unresolved.length} UPDATE${unresolved.length === 1 ? '' : 's'} whose map could not be resolved by name).`,
  );
}
