#!/usr/bin/env node
/**
 * Fails the build when the worker's own runtime DDL can create a schema object
 * the repo's fresh build does not have — or take one away.
 *
 * THE RULE (D235). A runtime `CREATE … IF NOT EXISTS` is a safety net for a
 * database that is missing a DECLARED object. It is never the only
 * declaration. When it is, the first request that reaches it in production
 * creates an object `schema_baseline.sql` plus the post-cutoff migrations does
 * not build, and deploy step 9 (`check-baseline-drift.mjs`, which compares
 * object NAMES in both directions) fails on every deploy after that.
 *
 * IT HAPPENED. D190 left `admin_publications` to its D95 bootstrap on purpose,
 * because the bootstrap heals a missing table. It does. It first ran in
 * production on 2026-09-24 between 12:44:48Z (run 36000909495, step 9 green)
 * and 12:50:17Z (run 36001483496, step 9 red), and every deploy after it —
 * #757, #759, #760, #755, #761, #762 — failed at step 9 with the same three
 * names. Nothing before the merge could see it: step 9 runs AFTER a deploy, it
 * needs a Cloudflare token, and it reads production, which only disagrees once
 * somebody has used the feature. This check asks the same question of the
 * code, before the merge, with no token.
 *
 * WHAT IT DOES. It builds the fresh database exactly as step 9 does (the same
 * `buildFresh`, the same file list from `postCutoffMigrations`), then executes
 * the worker's own DDL against that build to a FIXED POINT — every statement,
 * repeatedly, until a whole pass succeeds at nothing new — and compares the
 * names before and after. Executing rather than parsing is the point: whether
 * `CREATE INDEX … ON capital_calls(deal_id)` can run depends on a column the
 * baseline may or may not have, which no regex knows and SQLite does.
 *
 *   ONLY STATEMENTS THAT ADD. CREATE of a table, index, trigger or view;
 *   `ADD COLUMN`; and the two renames. Never a DROP and never DML: a drop can
 *   only remove names, and running one would turn "what can this code create"
 *   into "what can this code create after destroying the database". Drops get
 *   their own rule below.
 *
 *   A PERMISSIVE ENGINE, DELIBERATELY. The build under test enables
 *   double-quoted string literals, which D1 does not need to share: SQLite with
 *   them ON accepts a superset of what it accepts with them OFF, so a statement
 *   refused here is refused everywhere. That is what lets a refusal be CLAIMED
 *   rather than hoped — the ledger below records five, and each is re-proved on
 *   every run.
 *
 *   WHY A FIXED POINT IS AN ANSWER, NOT A SAMPLE. CREATE and ADD COLUMN only
 *   ever add, so running everything until nothing new succeeds reaches the
 *   largest schema any ordering of this code can produce: a statement that
 *   fails at the end fails in every reachable state. The two renames are the
 *   exception — they remove a name as well as add one — so a rename that FIRES
 *   against the fresh build fails this check outright. A rename here exists to
 *   carry a legacy database forward; on the schema the repo builds it must find
 *   nothing to rename, and every one of the six does today.
 *
 *   LOOPS ARE EXPANDED, NOT SKIPPED. Eighteen statements build their SQL inside
 *   `for (const [col, type] of …)` — fifteen `ADD COLUMN` loops, a loop over two
 *   table names, and `index.ts`'s mentor→advisor rename table. A statement is
 *   expanded when every `${…}` in it is a bare name the nearest enclosing
 *   `for (… of …)` binds and the array it walks is literal strings, inline or a
 *   `const` one scope up; one concrete statement per entry. The binding check
 *   is what makes that honest: `check-schema-pair-drift`'s loop reader matches
 *   the nearest `for (` and trusts it, which is right for its question and not
 *   enough for this one, where a mis-read column list would let an index look
 *   refused that production can build.
 *
 * WHAT IT CANNOT SEE, SAID PLAINLY. DDL assembled other than as a string
 * literal — `ddl.replace(…)`, a statement read out of `sqlite_master`, an array
 * of strings joined at runtime — never reaches this check as SQL. A statement
 * whose `${…}` is not a loop binding cannot be executed; if it names its object
 * literally and the fresh build already has that name, it is a no-op and
 * passes, and otherwise it is OPAQUE. Opaque statements are counted per file
 * in the ledger with a reason, so a new one is a failure until somebody reads
 * it. There is one such file today.
 *
 * DROPS. A runtime DROP of a name the fresh build has is step 9's OTHER
 * direction — production losing a name the repo builds. Every one must either
 * name something the fresh build lacks (a legacy clean-up, a no-op here) or be
 * followed, in the same file, by a literal CREATE of the same kind and name —
 * the drop-and-recreate idiom `routes/partnernet.ts` uses for its view.
 * Anything else is opaque.
 *
 * THE LEDGER, `scripts/runtime-schema-declared-baseline.json`, holds two kinds
 * and never a third:
 *   refused — a runtime CREATE naming an object no migration declares that
 *             SQLite refuses on the fresh build. Nothing is created today, but
 *             the day the refusal stops it becomes a CREATABLE, so each entry
 *             carries the refusal SQLite gives and the check re-proves it.
 *   opaque  — per file, how many statements this check could not model, and
 *             why that is safe.
 * CREATABLE IS NEVER LEDGERABLE. There is no entry that makes a runtime-only
 * object acceptable; declare it in a migration, copied from the runtime
 * statement, which is what migration 287 did for the thirteen this check found
 * the first time it ran. Stale entries fail in both directions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitStatements } from '../cloudflare-worker/test/_baseline.mjs';
import { balanced, maskCode, sqlExpressions } from './check-schema-pair-drift.mjs';
import { buildFresh, objectNames, postCutoffMigrations } from './check-baseline-drift.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'cloudflare-worker', 'src');
const BASELINE_SQL = path.join(ROOT, 'cloudflare-worker', 'sql', 'schema_baseline.sql');
export const LEDGER = path.join(ROOT, 'scripts', 'runtime-schema-declared-baseline.json');

/** A `${…}` that reached the SQL text — the marker `sqlExpressions` writes. */
const INTERP = '\u0000';
/** The worker is TypeScript today; the other two cost nothing to keep watching. */
const EXTS = ['.ts', '.js', '.mjs'];

const NAME = String.raw`[\x60"[]?([A-Za-z_]\w*)[\x60"\]]?`;
const CREATE_TABLE = new RegExp(String.raw`^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?(?:VIRTUAL\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?${NAME}\s*(?:\(|AS\b|USING\b)`, 'i');
const CREATE_INDEX = new RegExp(String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?${NAME}\s+ON\s+${NAME}`, 'i');
const CREATE_VIEW = new RegExp(String.raw`^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?VIEW\s+(IF\s+NOT\s+EXISTS\s+)?${NAME}[\s(][\s\S]*\bAS\b`, 'i');
const CREATE_TRIGGER = new RegExp(String.raw`^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\s+(IF\s+NOT\s+EXISTS\s+)?${NAME}\s[\s\S]*\bON\s+${NAME}`, 'i');
const ALTER_ADD = new RegExp(String.raw`^ALTER\s+TABLE\s+${NAME}\s+ADD\s`, 'i');
const ALTER_RENAME_TABLE = new RegExp(String.raw`^ALTER\s+TABLE\s+${NAME}\s+RENAME\s+TO\s+${NAME}\s*$`, 'i');
const ALTER_RENAME_COLUMN = new RegExp(String.raw`^ALTER\s+TABLE\s+${NAME}\s+RENAME\s+(?:COLUMN\s+)?${NAME}\s+TO\s+${NAME}\s*$`, 'i');
const DROP = new RegExp(String.raw`^DROP\s+(TABLE|INDEX|VIEW|TRIGGER)\s+(?:IF\s+EXISTS\s+)?${NAME}\s*$`, 'i');
/** Anything shaped like DDL at all — what is left over is prose or DML. */
const DDL_HEAD = /^(?:CREATE\s+(?:UNIQUE\s+|TEMP\s+|TEMPORARY\s+|VIRTUAL\s+)*(?:TABLE|INDEX|VIEW|TRIGGER)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER))\s/i;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (EXTS.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

/**
 * `splitStatements` cuts on every `;`, which is right for everything except a
 * trigger, whose body carries its own. Re-join a CREATE TRIGGER through the
 * fragment that ends in END, or a runtime trigger would be read as a broken
 * statement and reported as refused.
 */
export function statementsOf(text) {
  const out = [];
  const parts = splitStatements(text);
  for (let i = 0; i < parts.length; i += 1) {
    let s = parts[i];
    if (/^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(s)) {
      while (!/\bEND\s*$/i.test(s) && i + 1 < parts.length) { i += 1; s = `${s}; ${parts[i]}`; }
    }
    out.push(s);
  }
  return out;
}

/**
 * The source text of each `${…}` in the string expression that opens at
 * `start`, in order — `sqlExpressions` keeps only a marker, and resolving a
 * loop needs to know WHICH name each marker was.
 */
export function interpolationsAt(src, start) {
  const out = [];
  let i = start;
  for (;;) {
    const q = src[i];
    if (q !== '`' && q !== "'" && q !== '"') break;
    let j = i + 1;
    while (j < src.length) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === q) { j += 1; break; }
      if (q === '`' && c === '$' && src[j + 1] === '{') {
        let depth = 0;
        let k = j + 1;
        for (; k < src.length; k += 1) {
          if (src[k] === '{') depth += 1;
          else if (src[k] === '}') { depth -= 1; if (depth === 0) break; }
        }
        out.push(src.slice(j + 2, k).trim());
        j = k + 1;
        continue;
      }
      j += 1;
    }
    // A `'a' + 'b'` chain is one expression to sqlExpressions; follow it here too.
    let k = j;
    while (k < src.length && /\s/.test(src[k])) k += 1;
    if (src[k] !== '+') break;
    k += 1;
    while (k < src.length && /\s/.test(src[k])) k += 1;
    i = k;
  }
  return out;
}

/** Where `const <name> = [` opens, nearest before `before`; -1 if nowhere. */
function constArrayOpen(src, name, before) {
  let best = -1;
  for (let i = src.indexOf('const', 0); i >= 0 && i < before; i = src.indexOf('const', i + 1)) {
    if (i > 0 && /[\w$]/.test(src[i - 1])) continue;
    let j = i + 5;
    if (!/\s/.test(src[j] || '')) continue;
    while (/\s/.test(src[j] || '')) j += 1;
    if (!src.startsWith(name, j) || /[\w$]/.test(src[j + name.length] || '')) continue;
    const eq = src.indexOf('=', j + name.length);
    if (eq < 0 || src.slice(j + name.length, eq).includes(';')) continue;
    let k = eq + 1;
    while (/\s/.test(src[k] || '')) k += 1;
    if (src[k] === '[') best = k;
  }
  return best;
}

/**
 * The entries of an array literal of strings, or of arrays of strings, as raw
 * values — `null` the moment anything else appears, because a loop over a
 * computed value is not something this check can expand.
 */
/**
 * The text with every `//` and `/* *\/` comment blanked to spaces, string
 * literals left intact, so offsets are unchanged. `maskCode` cannot do this
 * job here: it blanks strings too, so a quote inside a comment (`D1's`) and a
 * quote that opens an entry look the same in its output.
 */
function blankComments(text) {
  let out = '';
  let q = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) {
      out += c;
      if (c === '\\') { out += text[i + 1] ?? ''; i += 1; } else if (c === q) q = null;
    } else if (c === "'" || c === '"' || c === '`') { q = c; out += c; }
    else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i += 1; }
      if (i < text.length) out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (; i < stop; i += 1) out += text[i] === '\n' ? '\n' : ' ';
      i -= 1;
    } else out += c;
  }
  return out;
}

export function literalArrayEntries(raw) {
  const body = blankComments(raw);
  const masked = maskCode(body);
  const out = [];
  let i = 1;                                      // past the opening `[`
  const readString = (at) => {
    const q = body[at];
    let s = '';
    let j = at + 1;
    for (; j < body.length; j += 1) {
      const c = body[j];
      if (c === '\\') { s += body[j + 1] ?? ''; j += 1; continue; }
      if (q === '`' && c === '$' && body[j + 1] === '{') return null;
      if (c === q) break;
      s += c;
    }
    return { s, end: j + 1 };
  };
  const skip = (at) => {
    let j = at;
    while (j < body.length && (/[\s,]/.test(masked[j]) || (masked[j] === ' ' && body[j] !== '[' && body[j] !== ']'))) {
      // a blanked comment is spaces in the mask; only real content stops us
      if (body[j] === "'" || body[j] === '"' || body[j] === '`') break;
      j += 1;
    }
    return j;
  };
  for (;;) {
    i = skip(i);
    if (i >= body.length) return null;
    const c = body[i];
    if (c === ']') return out;
    if (c === "'" || c === '"' || c === '`') {
      const r = readString(i);
      if (!r) return null;
      out.push([r.s]);
      i = r.end;
      continue;
    }
    if (c === '[') {
      const inner = balanced(masked, i, '[', ']');
      if (!inner) return null;
      const vals = [];
      let k = i + 1;
      const end = i + inner.length - 1;
      while (k < end) {
        const ch = body[k];
        if (ch === "'" || ch === '"' || ch === '`') {
          const r = readString(k);
          if (!r) return null;
          vals.push(r.s);
          k = r.end;
          continue;
        }
        if (/[\s,]/.test(ch)) { k += 1; continue; }
        return null;                              // a non-string inside the tuple
      }
      out.push(vals);
      i = end + 1;
      continue;
    }
    return null;                                  // a spread, a call, a name
  }
}

/**
 * The binding and entries of the `for (… of …)` loop that encloses `at`, or
 * null. Only `const|let|var <name>` or `[<a>, <b>, …]` over a literal array,
 * inline or a `const` declared earlier in the file.
 */
export function enclosingLoop(src, at) {
  const masked = maskCode(src);
  for (let f = masked.lastIndexOf('for (', at); f >= 0; f = masked.lastIndexOf('for (', f - 1)) {
    const head = balanced(masked, f + 4);
    if (!head) continue;
    // The loop body must CONTAIN the statement. A one-line loop that closed
    // before it — `contacts.ts` has one three lines above the real loop — is
    // not its loop.
    let b = f + 4 + head.length;
    while (/\s/.test(masked[b] || '')) b += 1;
    const body = masked[b] === '{' ? balanced(masked, b, '{', '}') : null;
    const end = body ? b + body.length : masked.indexOf(';', b);
    if (end < at) continue;
    const rawHead = src.slice(f + 4, f + 4 + head.length);
    const m = /^\(\s*(?:const|let|var)\s+(?:\[([\s\w$,]+)\]|([A-Za-z_$][\w$]*))\s+of\s+([\s\S]*)\)$/.exec(rawHead);
    if (!m) return null;
    const names = m[2] ? [m[2]] : m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const iterable = m[3].replace(/\s+as\s+const\s*$/, '').trim();
    let arrayText;
    if (iterable.startsWith('[')) {
      arrayText = balanced(maskCode(iterable), 0, '[', ']') && iterable.slice(0, balanced(maskCode(iterable), 0, '[', ']').length);
    } else {
      const ident = /^([A-Za-z_$][\w$]*)$/.exec(iterable);
      if (!ident) return null;
      const open = constArrayOpen(src, ident[1], f);
      if (open < 0) return null;
      const len = balanced(masked, open, '[', ']');
      arrayText = len && src.slice(open, open + len.length);
    }
    if (!arrayText) return null;
    const entries = literalArrayEntries(arrayText);
    if (!entries || !entries.length) return null;
    return { names, entries };
  }
  return null;
}

/**
 * One concrete statement per loop entry, or null when the statement cannot be
 * expanded honestly: every `${…}` must be exactly a name the loop binds.
 */
export function expandLoop(stmt, exprs, loop) {
  if (!loop || exprs.length !== (stmt.match(/\u0000/g) || []).length) return null;
  const slot = exprs.map((e) => loop.names.indexOf(e));
  if (slot.some((s) => s < 0)) return null;
  const out = [];
  for (const entry of loop.entries) {
    if (loop.names.length > 1 && entry.length !== loop.names.length) return null;
    let n = 0;
    out.push(stmt.replace(/\u0000/g, () => entry[slot[n++]] ?? ''));
  }
  return out;
}

/**
 * Every DDL statement the worker can run, classified.
 *
 * Pure over a `Map<absolutePath, source>` so the tests can drive every rule
 * with a fixture rather than only with whatever the tree holds today.
 */
export function harvestRuntimeDdl(files, root = ROOT) {
  const creates = [];   // {type, name, sql|null, where, file, at, onTable?}
  const columns = [];   // {table, sql, where}
  const renames = [];   // {from, to, sql, where, column}
  const drops = [];     // {type, name, where, file, at}
  /** @type {Map<string, Array<{where:string, sql:string, why:string}>>} */
  const opaque = new Map();
  const addOpaque = (file, where, sql, why) => {
    if (!opaque.has(file)) opaque.set(file, []);
    opaque.get(file).push({ where, sql: sql.replace(/\u0000/g, '${…}').replace(/\s+/g, ' ').slice(0, 160), why });
  };

  for (const [abs, src] of files) {
    const file = path.relative(root, abs).split(path.sep).join('/');
    for (const e of sqlExpressions(src)) {
      if (!/\b(?:CREATE|ALTER|DROP)\b/i.test(e.text)) continue;
      const exprs = e.text.includes(INTERP) ? interpolationsAt(src, e.start) : [];
      let used = 0;
      let loop;
      for (const raw of statementsOf(e.text)) {
        const s = raw.trim();
        const marks = (s.match(/\u0000/g) || []).length;
        const mine = exprs.slice(used, used + marks);
        used += marks;
        if (!DDL_HEAD.test(s)) continue;
        const where = `${file}:${e.line}`;

        // Expand a loop-built statement into the concrete ones it runs.
        let concrete = [s];
        let fromLoop = false;
        if (marks) {
          if (loop === undefined) loop = enclosingLoop(src, e.start);
          const expanded = expandLoop(s, mine, loop);
          if (expanded) { concrete = expanded; fromLoop = true; }
        }

        for (const stmt of concrete) {
          const tag = fromLoop ? `${where} (loop)` : where;
          const interp = stmt.includes(INTERP);
          let m;
          if ((m = CREATE_TABLE.exec(stmt))) {
            creates.push({ type: 'table', name: m[2], sql: interp ? null : stmt, where: tag, file, at: e.start });
          } else if ((m = CREATE_INDEX.exec(stmt))) {
            creates.push({ type: 'index', name: m[2], onTable: m[3], sql: interp ? null : stmt, where: tag, file, at: e.start });
          } else if ((m = CREATE_VIEW.exec(stmt))) {
            creates.push({ type: 'view', name: m[2], sql: interp ? null : stmt, where: tag, file, at: e.start });
          } else if ((m = CREATE_TRIGGER.exec(stmt))) {
            creates.push({ type: 'trigger', name: m[2], onTable: m[3], sql: interp ? null : stmt, where: tag, file, at: e.start });
          } else if ((m = ALTER_RENAME_TABLE.exec(stmt)) && !interp) {
            renames.push({ from: m[1], to: m[2], sql: stmt, where: tag, column: false });
          } else if ((m = ALTER_RENAME_COLUMN.exec(stmt)) && !interp) {
            renames.push({ from: `${m[1]}.${m[2]}`, to: `${m[1]}.${m[3]}`, sql: stmt, where: tag, column: true });
          } else if ((m = ALTER_ADD.exec(stmt)) && !interp) {
            columns.push({ table: m[1], sql: stmt, where: tag });
          } else if ((m = DROP.exec(stmt)) && !interp) {
            drops.push({ type: m[1].toLowerCase(), name: m[2], where: tag, file, at: e.start });
          } else {
            addOpaque(file, tag, stmt, interp
              ? 'a ${…} this check cannot expand, so neither the statement nor its object is known'
              : 'DDL of a shape this check does not model');
          }
        }
      }
    }
  }
  return { creates, columns, renames, drops, opaque };
}

/**
 * Run every statement that ADDS until a whole pass adds nothing. Returns, per
 * statement, whether it ever succeeded and the last refusal SQLite gave.
 */
export function simulate(db, statements) {
  const ok = new Array(statements.length).fill(false);
  const refusal = new Array(statements.length).fill(null);
  let passes = 0;
  for (let progress = true; progress;) {
    progress = false;
    passes += 1;
    for (let i = 0; i < statements.length; i += 1) {
      if (ok[i]) continue;
      try {
        db.exec(statements[i]);
        ok[i] = true;
        refusal[i] = null;
        progress = true;
      } catch (err) {
        refusal[i] = String(err?.message || err);
      }
    }
  }
  return { ok, refusal, passes };
}

const key = (type, name) => `${type}:${name.toLowerCase()}`;

/**
 * The whole analysis, pure: the fresh build's names, a permissive copy of it
 * to execute against, and a harvest.
 */
export function analyse({ truth, db, harvest }) {
  const lower = new Set([...truth].map((n) => n.toLowerCase()));
  const has = (type, name) => lower.has(key(type, name));

  const execCreates = harvest.creates.filter((c) => c.sql);
  const statements = [
    ...execCreates.map((c) => c.sql),
    ...harvest.columns.map((c) => c.sql),
    ...harvest.renames.map((r) => r.sql),
  ];
  const run = simulate(db, statements);
  const after = new Set([...objectNames(db)].map((n) => n.toLowerCase()));

  const sites = new Map();
  for (const c of harvest.creates) {
    const k = key(c.type, c.name);
    if (!sites.has(k)) sites.set(k, []);
    sites.get(k).push(c);
  }
  const whereOf = (k) => [...new Set((sites.get(k) || []).map((c) => c.where))];

  const creatable = [...after].filter((n) => !lower.has(n)).sort()
    .map((k) => ({ key: k, where: whereOf(k) }));
  const removed = [...lower].filter((n) => !after.has(n)).sort();

  const renameBase = execCreates.length + harvest.columns.length;
  const fired = harvest.renames.filter((_, i) => run.ok[renameBase + i]);

  // A refusal is a literal CREATE of a name the fresh build lacks that never
  // ran — kept with the message SQLite gave on the last pass.
  const refusedMap = new Map();
  execCreates.forEach((c, i) => {
    const k = key(c.type, c.name);
    if (has(c.type, c.name) || after.has(k) || run.ok[i]) return;
    if (!refusedMap.has(k)) refusedMap.set(k, { key: k, where: [], refusals: [], onTable: c.type === 'table' ? c.name : c.onTable });
    const r = refusedMap.get(k);
    r.where.push(c.where);
    r.refusals.push(run.refusal[i]);
  });

  // A CREATE whose body carried a ${…} cannot run; its NAME still settles it
  // when the fresh build already has the object — IF NOT EXISTS is a no-op.
  const opaque = new Map([...harvest.opaque].map(([f, list]) => [f, [...list]]));
  for (const c of harvest.creates.filter((x) => !x.sql)) {
    if (has(c.type, c.name)) continue;
    if (!opaque.has(c.file)) opaque.set(c.file, []);
    opaque.get(c.file).push({ where: c.where, sql: `CREATE ${c.type.toUpperCase()} ${c.name} …`, why: 'a ${…} in the body, and the fresh build lacks the name, so whether it can be created is unknown' });
  }
  // A DROP of a name the fresh build has must be a drop-and-recreate.
  for (const d of harvest.drops) {
    if (!has(d.type, d.name)) continue;
    const recreated = harvest.creates.some((c) => c.file === d.file && c.type === d.type
      && c.name.toLowerCase() === d.name.toLowerCase() && c.at >= d.at);
    if (recreated) continue;
    if (!opaque.has(d.file)) opaque.set(d.file, []);
    opaque.get(d.file).push({ where: d.where, sql: `DROP ${d.type.toUpperCase()} ${d.name}`, why: 'drops a name the fresh build has, and no literal CREATE after it in the file puts it back' });
  }

  // Tables whose shape this check could not fully model: an opaque ALTER that
  // names them, or one whose table is itself a ${…}.
  const unmodelled = new Set();
  let anyTable = false;
  for (const list of opaque.values()) {
    for (const o of list) {
      const t = /^ALTER\s+TABLE\s+([A-Za-z_]\w*)/i.exec(o.sql);
      if (t) unmodelled.add(t[1].toLowerCase());
      else if (/^ALTER\s+TABLE\s+\$\{/i.test(o.sql)) anyTable = true;
    }
  }

  return {
    truthSize: lower.size,
    statements: statements.length,
    passes: run.passes,
    counts: {
      creates: harvest.creates.length,
      columns: harvest.columns.length,
      renames: harvest.renames.length,
      drops: harvest.drops.length,
      files: new Set([...harvest.creates, ...harvest.drops].map((c) => c.file)).size,
    },
    creatable,
    removed,
    fired,
    refused: [...refusedMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
    opaque,
    unmodelled,
    anyTable,
  };
}

/** The verdict against the ledger, as the list of things that are wrong. */
export function judge(verdict, ledger) {
  const problems = [];
  const refusedLedger = ledger.refused ?? {};
  const opaqueLedger = ledger.opaque ?? {};

  for (const c of verdict.creatable) {
    problems.push({
      kind: 'creatable',
      text: `${c.key} — the fresh build lacks it and ${c.where.join(', ') || 'a rename'} can create it`,
    });
  }
  for (const n of verdict.removed) {
    problems.push({ kind: 'removed', text: `${n} — the fresh build has it and a runtime statement takes it away` });
  }
  for (const r of verdict.fired) {
    problems.push({ kind: 'renamed', text: `${r.from} → ${r.to} — ${r.where} fires against the fresh build` });
  }

  const found = new Map(verdict.refused.map((r) => [r.key, r]));
  for (const r of verdict.refused) {
    const entry = refusedLedger[r.key];
    if (!entry) {
      problems.push({ kind: 'refused', text: `${r.key} — ${r.where.join(', ')}; SQLite: ${r.refusals[0]}` });
      continue;
    }
    if (!r.refusals.every((m) => typeof m === 'string' && m.includes(entry.refusal))) {
      problems.push({ kind: 'refusal-changed', text: `${r.key} — the ledger says "${entry.refusal}", SQLite now says "${r.refusals.join('" / "')}"` });
    }
    if (verdict.anyTable || verdict.unmodelled.has(String(r.onTable || '').toLowerCase())) {
      problems.push({ kind: 'unverifiable', text: `${r.key} — an ALTER this check cannot model can reach ${r.onTable}, so the refusal cannot be re-proved` });
    }
  }
  for (const k of Object.keys(refusedLedger)) {
    if (!found.has(k)) problems.push({ kind: 'stale-refused', text: k });
  }

  for (const [file, list] of verdict.opaque) {
    const entry = opaqueLedger[file];
    if (!entry || entry.statements !== list.length) {
      problems.push({
        kind: 'opaque',
        text: `${file} — ${list.length} statement(s) this check cannot model, ledger says ${entry ? entry.statements : 'none'}:\n`
          + list.map((o) => `        ${o.where}  ${o.sql}\n          (${o.why})`).join('\n'),
      });
    }
  }
  for (const file of Object.keys(opaqueLedger)) {
    if (!verdict.opaque.has(file)) problems.push({ kind: 'stale-opaque', text: file });
  }
  return problems;
}

/** The tree, read and analysed. */
export function findings(root = ROOT) {
  const later = postCutoffMigrations(root).map((m) => m.sql);
  const baseline = fs.readFileSync(root === ROOT ? BASELINE_SQL : path.join(root, 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
  const truth = objectNames(buildFresh(baseline, later));
  const db = buildFresh(baseline, later, { dqs: true });
  const permissive = objectNames(db);
  if (permissive.size !== truth.size || [...truth].some((n) => !permissive.has(n))) {
    throw new Error('the permissive build is not the same database as the strict one — every claim below would be about the wrong schema');
  }
  const files = new Map();
  for (const f of walk(root === ROOT ? SRC_DIR : path.join(root, 'cloudflare-worker/src'))) files.set(f, fs.readFileSync(f, 'utf8'));
  return analyse({ truth, db, harvest: harvestRuntimeDdl(files, root) });
}

const HEADINGS = {
  creatable: 'A runtime statement can CREATE an object the fresh build does not have',
  removed: 'A runtime statement can REMOVE an object the fresh build has',
  renamed: 'A runtime rename FIRES against the fresh build',
  refused: 'A runtime CREATE names an object no migration declares, and SQLite refuses it today',
  'refusal-changed': 'A recorded refusal now fails for a different reason',
  unverifiable: 'A recorded refusal can no longer be re-proved',
  'stale-refused': 'Ledger refusals that no longer hold — the object is declared, or its statement is gone',
  opaque: 'Runtime DDL this check cannot model, and the ledger does not account for it',
  'stale-opaque': 'Ledger opaque entries for files that no longer carry any',
};

const ADVICE = {
  creatable: 'The first request that reaches it creates it in production, and deploy step 9\n'
    + '(check-baseline-drift) fails on every deploy after that — what admin_publications\n'
    + 'did to six deploys on 2026-09-24. Declare it in a NEW migration under\n'
    + 'cloudflare-worker/sql/migrations/, copied from the runtime statement so the object a\n'
    + 'reader expects is the object it gets; 287 is the precedent. A bootstrap is a safety\n'
    + 'net for a declared object, never the only declaration. This cannot be ledgered.',
  removed: 'Step 9 fails in the other direction the first time it runs. A rename or drop at\n'
    + 'runtime exists to carry a legacy database forward; on the schema the repo builds it\n'
    + 'must find nothing to act on.',
  renamed: 'Declare the renamed shape in a migration so the fresh build already has it; the\n'
    + 'runtime rename then finds nothing to rename, which is its job.',
  refused: 'Nothing is created today, but the day the refusal stops — a column added, a quote\n'
    + 'fixed — it creates an undeclared object. Declare it, delete the statement, or record in\n'
    + 'scripts/runtime-schema-declared-baseline.json the refusal SQLite gives and why.',
  'refusal-changed': 'Re-read the statement and update the entry, or declare the object.',
  unverifiable: 'Make the ALTER expandable (a loop over literal strings) or record why the refusal\n'
    + 'still holds some other way.',
  'stale-refused': 'Delete them — a ledger of known gaps is only worth reading if every line is true.',
  opaque: 'Read each statement. If it can create or remove a name the fresh build does not\n'
    + 'match, declare the object; if it cannot, record the count and why in the ledger.',
  'stale-opaque': 'Delete them.',
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const verdict = findings();
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const problems = judge(verdict, ledger);

  if (problems.length) {
    for (const kind of Object.keys(HEADINGS)) {
      const mine = problems.filter((p) => p.kind === kind);
      if (!mine.length) continue;
      console.error(`✖ check-runtime-schema-declared: ${HEADINGS[kind]}:\n`);
      for (const p of mine) console.error(`    ${p.text}`);
      console.error(`\n  ${ADVICE[kind].split('\n').join('\n  ')}\n`);
    }
    process.exit(1);
  }

  const opaqueStatements = [...verdict.opaque.values()].reduce((n, l) => n + l.length, 0);
  console.log(
    `✓ check-runtime-schema-declared: ${verdict.statements} runtime DDL statements `
    + `(${verdict.counts.creates} create, ${verdict.counts.columns} add-column, ${verdict.counts.renames} rename) `
    + `run to a fixed point in ${verdict.passes} passes over the fresh build's ${verdict.truthSize} objects — `
    + 'none can create or remove a name it lacks or has '
    + `(${verdict.refused.length} refused and ${opaqueStatements} opaque on record).`,
  );
}
