#!/usr/bin/env node
/**
 * Fails the build when two definitions of one table stop declaring the same
 * columns.
 *
 * WHY THIS EXISTS. A table in this repo is often created twice: once by a
 * migration or the baseline, and once by a runtime `CREATE TABLE IF NOT
 * EXISTS` in a route or service so a database that missed the migration heals
 * itself. D1 holds ONE table per name and `IF NOT EXISTS` cannot add a column
 * to a table that already exists — so whichever runs first wins, in an order
 * nothing in the repository determines, and every column only the loser
 * declares is a column that will never exist. The loser's readers then name it
 * and throw `no such column`.
 *
 * IT HAS SHIPPED THREE TIMES:
 *
 *   #183 / #202  `metrics_snapshots`. Two shapes; the runtime one won, and the
 *                `traction_review` queue job was dead against the other.
 *   D187         `partner_profiles`. Three shapes; `routes/profiling.ts`'s won,
 *                so migration 028's eighteen columns were a no-op and 042's
 *                four went with them. Twenty-six partner accounts were told in
 *                chat to accept an invitation that did not exist.
 *
 * NEITHER SIBLING GUARD CAN SEE IT, and that is structural rather than
 * accidental. `check-sqlite-columns` UNIONS every definition, deliberately,
 * because it cannot know which is live — so a column present in one definition
 * looks present everywhere and nothing ever reads as missing.
 * `check-sqlite-table-collisions` fires only on the MUTUALLY FATAL subset
 * (each side demanding a NOT NULL the other has no place for) and says in its
 * own header that definitions which merely differ are "common and usually
 * fine". Between the union and the fatality test sits every ordinary
 * divergence, which is where all three of the shipped defects lived.
 *
 * WHAT IT COMPARES, and each half of this was measured rather than chosen.
 *
 *   BOTH SIDES GET THEIR OWN `ALTER … ADD COLUMN`s FIRST. A comparison that
 *   read only `CREATE TABLE` reports `partner_profiles` as divergent — a case
 *   D187 closed — because `routes/profiling.ts` reaches migration 275's shape
 *   through a 24-entry ADD COLUMN loop. Twenty-one of the twenty-six findings
 *   in the first sweep of this were that same false positive. Resolving the
 *   loop is therefore not a refinement; without it the guard starts wrong.
 *
 *   COLUMN NAMES ONLY, NOT TYPES OR CONSTRAINTS. Measured across all 267
 *   pairs: five tables differ in a declared type and every one of them is
 *   `TIMESTAMP` against `TEXT` on a date column. Under SQLite's affinity rules
 *   TIMESTAMP is NUMERIC, which converts a TEXT value only when it is a
 *   well-formed numeral — an ISO stamp is not, so both store the same bytes.
 *   Fourteen differ in NOT NULL, DEFAULT or PRIMARY KEY on a shared column;
 *   that is the fatality question and `check-sqlite-table-collisions` owns it.
 *   What is left, and what nothing else watches, is a column one definition
 *   has and another does not — which is exactly the sentence "the loser's
 *   readers name a column the live table does not have".
 *
 * THE SQL SIDE IS ONE ORDERED SOURCE, NOT ONE ENTRY PER FILE. The baseline
 * then every migration by number is the order a database actually applies, so
 * a later `CREATE TABLE IF NOT EXISTS` for a table the baseline already has is
 * the no-op it is at runtime. Treating each SQL file as a rival definition
 * would re-report pairs that ordering already settles, which is the collision
 * guard's question and not this one's.
 *
 * `sql/historical/` is excluded, on the precedent of `check-sqlite-columns`,
 * `check-sqlite-tables` and `check-sqlite-table-collisions`, each of which
 * records the false finding its omission caused.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { splitStatements } from '../cloudflare-worker/test/_baseline.mjs';
import { compareMigrations } from './lib/migrationPlan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'cloudflare-worker', 'src');
const SQL_DIR = path.join(ROOT, 'cloudflare-worker', 'sql');
const MIGRATIONS_DIR = path.join(SQL_DIR, 'migrations');
const BASELINE_SQL = path.join(SQL_DIR, 'schema_baseline.sql');
const BASELINE = path.join(ROOT, 'scripts', 'schema-pair-drift-baseline.json');

/** A `${…}` that reached the SQL text. Marked, never dropped. */
const INTERP = '\u0000';

function walk(dir, exts) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

/** Balanced slice starting at the bracket at `from`; null if unbalanced. */
export function balanced(src, from, open = '(', close = ')') {
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === open) depth += 1;
    else if (src[i] === close) { depth -= 1; if (depth === 0) return src.slice(from, i + 1); }
  }
  return null;
}

const endsExpression = (ch) => ch !== undefined && /[\w$)\]]/.test(ch);

function skipTrivia(src, i) {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i += 1;
    if (src[i] === '/' && src[i + 1] === '/') { const n = src.indexOf('\n', i); i = n < 0 ? src.length : n + 1; continue; }
    if (src[i] === '/' && src[i + 1] === '*') { const n = src.indexOf('*/', i); i = n < 0 ? src.length : n + 2; continue; }
    return i;
  }
}

/** Consume one string literal opening at `i`. A `${…}` becomes one INTERP. */
function readLiteral(src, i) {
  const q = src[i];
  let j = i + 1;
  let body = '';
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { body += src[j + 1] ?? ''; j += 2; continue; }
    if (c === q) { j += 1; break; }
    if (q === '`' && c === '$' && src[j + 1] === '{') {
      let depth = 0;
      let k = j + 1;
      for (; k < src.length; k += 1) {
        if (src[k] === '{') depth += 1;
        else if (src[k] === '}') { depth -= 1; if (depth === 0) break; }
      }
      body += INTERP;
      j = k + 1;
      continue;
    }
    body += c;
    j += 1;
  }
  return { body, end: j };
}

/**
 * Every string EXPRESSION in a file, with `'a' + 'b'` chains joined.
 *
 * Joining is not a nicety. Nine runtime bootstraps build their CREATE TABLE by
 * concatenating one quoted line per column, so a per-literal pass — which is
 * what `check-sqlite-dialect`'s `sqlStrings` gives, correctly, for its own
 * question — sees nine fragments and no statement. The first sweep of this
 * guard read the raw source between the two parentheses instead and reported
 * fifteen tables as unbuildable, every one of them a quote-and-plus artifact.
 *
 * Regex literals are the hazard and they are silent: a lone quote inside one
 * desynchronises every string after it, which cost `check-sqlite-dialect` 139
 * statements in one file. A `/` is treated as a regex unless the previous
 * meaningful character could end an expression.
 */
export function sqlExpressions(src) {
  const out = [];
  let i = 0;
  let prev;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const n = src.indexOf('\n', i); i = n < 0 ? src.length : n + 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const n = src.indexOf('*/', i); i = n < 0 ? src.length : n + 2; continue; }
    if (c === '/' && !endsExpression(prev)) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;                       // unterminated — it was division
        if (inClass) { if (d === ']') inClass = false; }
        else if (d === '[') inClass = true;
        else if (d === '/') break;
        j += 1;
      }
      if (src[j] === '/') { i = j + 1; prev = '/'; continue; }
    }
    if (c === '`' || c === "'" || c === '"') {
      const start = i;
      let text = '';
      for (;;) {
        const r = readLiteral(src, i);
        text += r.body;
        i = r.end;
        const j = skipTrivia(src, i);
        if (src[j] !== '+') break;
        const k = skipTrivia(src, j + 1);
        if (src[k] !== '`' && src[k] !== "'" && src[k] !== '"') break;
        i = k;
      }
      out.push({ text, start, line: src.slice(0, start).split('\n').length });
      prev = '"';
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return out;
}

/**
 * `[['col','TYPE'], …]` or `['col TYPE', …]` — the two shapes the loops use.
 *
 * WALKED, NOT REGEXED, AND THE DIFFERENCE IS A FINDING THIS GATE OTHERWISE
 * INVENTS. The first version matched a pair with `['"]([^'"]*)['"]` for the
 * type, so an entry whose TYPE carries its own quotes was silently dropped —
 * `['raw_chat_json', "TEXT NOT NULL DEFAULT '{}'"]` is one, and losing it made
 * `routes/profiling.ts` read as 23 of its 24 ADD COLUMNs and `partner_profiles`
 * report as a one-column superset of a case D187 had fully converged. A quote
 * inside a differently-quoted literal is content, so the reader has to know
 * which quote opened the string; a character class cannot.
 */
export function parseArrayEntries(body) {
  const out = [];
  let i = body.indexOf('[');
  if (i < 0) return out;
  i += 1;
  let depth = 1;
  while (i < body.length && depth > 0) {
    const c = body[i];
    if (c === '/' && body[i + 1] === '/') { const n = body.indexOf('\n', i); i = n < 0 ? body.length : n + 1; continue; }
    if (c === '/' && body[i + 1] === '*') { const n = body.indexOf('*/', i); i = n < 0 ? body.length : n + 2; continue; }
    if (c === ']') { depth -= 1; i += 1; continue; }
    if (c === '[') {
      const inner = balanced(body, i, '[', ']');
      if (!inner) break;
      const lits = [];
      for (let k = 0; k < inner.length; k += 1) {
        if (inner[k] === "'" || inner[k] === '"' || inner[k] === '`') {
          const r = readLiteral(inner, k);
          lits.push(r.body);
          k = r.end - 1;
        }
      }
      if (lits.length) out.push([lits[0], (lits[1] ?? '').trim() || 'TEXT']);
      i += inner.length;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const r = readLiteral(body, i);
      const m = /^\s*([A-Za-z_]\w*)([\s\S]*)$/.exec(r.body);
      if (m) out.push([m[1], (m[2] || '').trim() || 'TEXT']);
      i = r.end;
      continue;
    }
    i += 1;
  }
  return out.filter(([n]) => /^[A-Za-z_]\w*$/.test(n));
}

/**
 * The columns an `ADD COLUMN ${col}` loop adds, read off the array it iterates.
 *
 * Fifteen sites in the worker build their ALTER this way, over an inline array
 * or a named `const` one scope up. Declining to resolve them is what makes a
 * comparison ALTER-blind, and `partner_profiles` — twenty-four columns behind
 * one loop — is the case that proves it.
 */
export function resolveLoopColumns(src, atIndex) {
  const forIdx = src.lastIndexOf('for (', atIndex);
  if (forIdx < 0) return null;
  const head = balanced(src, forIdx + 4);
  if (!head) return null;
  const ofIdx = head.search(/\bof\b/);
  if (ofIdx < 0) return null;
  const iterable = head.slice(ofIdx + 2).replace(/\)\s*$/, '').trim();
  if (iterable.startsWith('[')) {
    const body = balanced(iterable, 0, '[', ']');
    return body ? parseArrayEntries(body) : null;
  }
  const ident = /^([A-Za-z_]\w*)/.exec(iterable);
  if (!ident) return null;
  const open = findConstArrayDecl(src, ident[1], forIdx);
  if (open < 0) return null;
  const body = balanced(src, open, '[', ']');
  return body ? parseArrayEntries(body) : null;
}

/**
 * Where `const <name> = [` opens, found by literal scan rather than by a regex
 * built from the name.
 *
 * Semgrep's detect-non-literal-regexp flagged the assembled form, and it is the
 * FIFTH time in this programme that rule has fired on my own code. ReDoS was
 * never reachable — the name is already narrowed to `[A-Za-z_]\w*`, so it
 * carries no metacharacter — but a regex built from data is the shape the rule
 * exists to refuse, and the literal walk is also the STRONGER read, twice over:
 * it takes the declaration NEAREST BEFORE the loop instead of the first one in
 * the file, so a second `const` of the same name can no longer stand in for the
 * one in scope; and it refuses a `;` between the name and its `=`, so a bare
 * `const x: T;` followed later by an unrelated `= [` no longer matches.
 *
 * @returns the index of the opening `[`, or -1.
 */
function findConstArrayDecl(src, name, before) {
  const hits = [];
  for (let i = src.indexOf('const'); i >= 0; i = src.indexOf('const', i + 1)) {
    if (i > 0 && /\w/.test(src[i - 1])) continue;          // part of a longer word
    let j = i + 5;
    if (!/\s/.test(src[j] || '')) continue;                // `const` must be its own token
    while (j < src.length && /\s/.test(src[j])) j += 1;
    if (!src.startsWith(name, j)) continue;
    const after = j + name.length;
    if (/\w/.test(src[after] || '')) continue;             // a longer identifier
    const eq = src.indexOf('=', after);
    if (eq < 0 || src.slice(after, eq).includes(';')) continue;
    let k = eq + 1;
    while (k < src.length && /\s/.test(src[k])) k += 1;
    if (src[k] !== '[') continue;
    hits.push({ at: i, open: k });
  }
  if (!hits.length) return -1;
  const preceding = hits.filter((h) => h.at <= before);
  return (preceding.length ? preceding[preceding.length - 1] : hits[0]).open;
}

const CREATE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)[`"\]]?\s*\(/i;
const ALTER_RE = /ALTER\s+TABLE\s+[`"[]?(\w+)[`"\]]?\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]*)$/i;

/** One definition per (worker source file, table) that carries a CREATE. */
export function runtimeDefinitions() {
  /** @type {Map<string, Array<{where:string, create:string, alters:Array<[string,string]>, interp:boolean}>>} */
  const defs = new Map();
  for (const f of walk(SRC_DIR, ['.ts'])) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(ROOT, f);
    const here = new Map();
    for (const e of sqlExpressions(src)) {
      const c = CREATE_RE.exec(e.text);
      if (c) {
        const body = balanced(e.text, e.text.indexOf('(', c.index));
        if (!body) continue;
        const t = c[1].toLowerCase();
        if (here.has(t)) continue;               // first CREATE in a file wins, as at runtime
        here.set(t, {
          where: `${rel}:${e.line}`,
          create: `CREATE TABLE ${c[1]} ${body}`,
          alters: [],
          interp: body.includes(INTERP),
        });
        continue;
      }
      const a = ALTER_RE.exec(e.text);
      if (!a) continue;
      const t = a[1].toLowerCase();
      if (!here.has(t)) continue;                // an ALTER whose CREATE is elsewhere
      const rest = a[2].trim();
      if (rest.startsWith(INTERP)) {
        const cols = resolveLoopColumns(src, e.start);
        if (cols && cols.length) here.get(t).alters.push(...cols);
        else here.get(t).interp = true;
      } else {
        const lit = /^[`"[]?([A-Za-z_]\w*)[`"\]]?\s*([\s\S]*)$/.exec(rest);
        if (lit) here.get(t).alters.push([lit[1], lit[2].split(INTERP)[0].trim()]);
      }
    }
    for (const [t, d] of here) {
      if (!defs.has(t)) defs.set(t, []);
      defs.get(t).push(d);
    }
  }
  return defs;
}

/** The SQL tree as ONE ordered source: baseline, then migrations by number. */
export function sqlDefinitions() {
  const files = [BASELINE_SQL];
  for (const n of fs.readdirSync(MIGRATIONS_DIR).filter((x) => /^\d+_.*\.sql$/.test(x)).sort(compareMigrations)) {
    files.push(path.join(MIGRATIONS_DIR, n));
  }
  /** @type {Map<string, {where:string, create:string, alters:Array<[string,string]>, interp:boolean}>} */
  const defs = new Map();
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    for (const stmt of splitStatements(fs.readFileSync(f, 'utf8'))) {
      const c = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)[`"\]]?\s*\(/i.exec(stmt);
      if (c) {
        const t = c[1].toLowerCase();
        if (!defs.has(t)) defs.set(t, { where: rel, create: stmt, alters: [], interp: false });
        continue;
      }
      const d = /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"[]?(\w+)/i.exec(stmt);
      if (d) { defs.delete(d[1].toLowerCase()); continue; }
      const r = /^\s*ALTER\s+TABLE\s+[`"[]?(\w+)[`"\]]?\s+RENAME\s+TO\s+[`"[]?(\w+)/i.exec(stmt);
      if (r) {
        const from = r[1].toLowerCase();
        const to = r[2].toLowerCase();
        if (defs.has(from)) {
          const def = defs.get(from);
          // THE CREATE HAS TO BE RENAMED WITH IT, and this is not cosmetic: the
          // rebuild idiom (`CREATE t_new … DROP t … RENAME t_new TO t`) is how
          // five migrations widen a table, and a def still saying `CREATE TABLE
          // landing_pages_new` builds that name, so `pragma_table_info` for
          // `landing_pages` comes back EMPTY — a zero-column shape that reads as
          // "every other definition is a superset" rather than as a parse bug.
          // Spliced by index off a LITERAL header match rather than a regex
          // assembled from `from` (Semgrep's detect-non-literal-regexp, same
          // rule as `findConstArrayDecl` above). Stronger too: it VERIFIES the
          // header names `from` before rewriting, where the assembled form
          // would rewrite whatever its pattern happened to reach.
          const hdr = /^(\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?)(\w+)([`"\]]?\s*\()/i.exec(def.create);
          if (hdr && hdr[2].toLowerCase() === from) {
            def.create = hdr[1] + to + hdr[3] + def.create.slice(hdr[0].length);
          }
          defs.set(to, def);
          defs.delete(from);
        }
        continue;
      }
      const a = /^\s*ALTER\s+TABLE\s+[`"[]?(\w+)[`"\]]?\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([A-Za-z_]\w*)[`"\]]?\s*([\s\S]*)$/i.exec(stmt);
      if (a) {
        const t = a[1].toLowerCase();
        if (defs.has(t)) defs.get(t).alters.push([a[2], (a[3] || '').trim()]);
      }
    }
  }
  return defs;
}

/**
 * Build one definition in real SQLite and read its columns back.
 *
 * `enableDoubleQuotedStringLiterals` matches what the baseline and
 * `110_assessment_tracks.sql` need, and is the same setting every other
 * fresh-build reader in this repo uses. A failing ALTER is swallowed — a
 * duplicate column is the steady state for a self-healing bootstrap — but a
 * failing CREATE is a finding, because a definition real SQLite refuses is a
 * bootstrap that can never have run.
 */
export function shapeOf(def, table) {
  if (def.interp) return { error: 'interpolated' };
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  try { db.exec(def.create); } catch (e) { return { error: 'refused', detail: e.message }; }
  for (const [col, type] of def.alters) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch { /* duplicate — the steady state */ }
  }
  try {
    return { cols: db.prepare('SELECT name FROM pragma_table_info(?)').all(table).map((r) => r.name.toLowerCase()) };
  } catch (e) { return { error: 'refused', detail: e.message }; }
}

/**
 * Every table defined on BOTH sides whose definitions do not agree.
 *
 *   divergent:<t>     two definitions each carry a column the other lacks
 *   superset:<t>      one is strictly wider — benign only if the wider side
 *                     wins, and which side wins is not provable from the repo
 *   refused:<t>       real SQLite refuses a definition, so that bootstrap has
 *                     never run and its `catch` has been swallowing the proof
 *   interpolated:<t>  a `${…}` reached the SQL text, so no shape can be built
 */
export function findings() {
  const runtime = runtimeDefinitions();
  const sql = sqlDefinitions();
  /** @type {Map<string, {table: string, lines: string[]}>} */
  const out = new Map();

  for (const [table, list] of [...runtime].sort(([a], [b]) => a.localeCompare(b))) {
    if (!sql.has(table)) continue;
    const shapes = [...list, sql.get(table)].map((d) => ({ d, s: shapeOf(d, table) }));

    const broken = shapes.filter((x) => x.s.error);
    if (broken.length) {
      const kind = broken.some((x) => x.s.error === 'refused') ? 'refused' : 'interpolated';
      out.set(`${kind}:${table}`, {
        table,
        lines: broken.map((b) => `${b.d.where} — ${b.s.error}${b.s.detail ? `: ${b.s.detail}` : ''}`),
      });
      continue;
    }

    const lines = [];
    let divergent = false;
    for (let i = 0; i < shapes.length; i += 1) {
      for (let j = i + 1; j < shapes.length; j += 1) {
        const A = new Set(shapes[i].s.cols);
        const B = new Set(shapes[j].s.cols);
        const aOnly = [...A].filter((c) => !B.has(c)).sort();
        const bOnly = [...B].filter((c) => !A.has(c)).sort();
        if (!aOnly.length && !bOnly.length) continue;
        if (aOnly.length && bOnly.length) divergent = true;
        if (aOnly.length) lines.push(`${shapes[i].d.where} alone declares ${aOnly.join(', ')}`);
        if (bOnly.length) lines.push(`${shapes[j].d.where} alone declares ${bOnly.join(', ')}`);
      }
    }
    if (lines.length) out.set(`${divergent ? 'divergent' : 'superset'}:${table}`, { table, lines: [...new Set(lines)] });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = findings();
  const ledger = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).pairs ?? {};

  const added = [...found.keys()].filter((k) => !(k in ledger)).sort();
  const resolved = Object.keys(ledger).filter((k) => !found.has(k)).sort();

  if (added.length) {
    console.error('✖ check-schema-pair-drift: two definitions of one table no longer agree:\n');
    for (const k of added) {
      console.error(`  ${k}`);
      for (const line of found.get(k).lines) console.error(`      ${line}`);
    }
    console.error('\nD1 holds one table per name and every runtime definition is IF NOT EXISTS,');
    console.error('so the first to run wins and a column only the loser declares never exists.');
    console.error('Which one wins is not decided anywhere in this repository.');
    console.error('\nConverge the two definitions — the ALTER list beside a runtime CREATE is');
    console.error('usually where a migration\'s columns belong — or record the pair in');
    console.error('scripts/schema-pair-drift-baseline.json with a reason saying which shape a');
    console.error('database ends up with and what the other side\'s readers do about it.');
    process.exit(1);
  }

  if (resolved.length) {
    console.error('✖ check-schema-pair-drift: ledger entries whose definitions now agree:\n');
    for (const k of resolved) console.error(`  ${k}`);
    console.error('\nDelete them from scripts/schema-pair-drift-baseline.json — a ledger of known');
    console.error('divergences is only worth reading if every line in it is still true.');
    process.exit(1);
  }

  const runtime = runtimeDefinitions();
  const sql = sqlDefinitions();
  const pairs = [...runtime.keys()].filter((t) => sql.has(t)).length;
  const n = Object.keys(ledger).length;
  console.log(
    `✓ check-schema-pair-drift: ${pairs} tables are defined both at runtime and in SQL, `
    + `${pairs - n} of them agree column for column (${n} known divergence${n === 1 ? '' : 's'} on record).`,
  );
}
