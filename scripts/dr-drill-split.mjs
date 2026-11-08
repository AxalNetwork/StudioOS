#!/usr/bin/env node
/**
 * scripts/dr-drill-split.mjs — D523.
 *
 * Splits a `wrangler d1 export` file into ordered chunk files that
 * scripts/dr-drill.sh imports one `wrangler d1 execute --file` at a time.
 *
 * WHY. The 2026-10-01 drill (run 36862064332) uploaded the whole export in one
 * remote import and D1 answered `{"D1_RESET_DO":true}` 1.4 s later: the
 * Durable Object behind the database was reset before the import finished.
 * wrangler prints that whenever D1's import poll reports the reset; the
 * public reports of it (workers-sdk #7554, #9503) are all single-file
 * imports of a whole dump, and #7554 names the cause D1 logged: "Durable
 * Object's isolate exceeded its memory limit and was reset". The same SQL
 * runs locally, so the statements themselves are importable. Smaller imports
 * keep each one inside the object's limits, and if one still fails, the
 * chunk that failed says where.
 *
 * WHAT IT WRITES, in three phases:
 *   schema  every CREATE TABLE, in the export's own order.
 *   data    every INSERT, grouped by table, PARENT TABLES FIRST (ordered by
 *           the REFERENCES clauses in the CREATE TABLEs), then the
 *           sqlite_sequence rows. Each data chunk opens with
 *           `PRAGMA defer_foreign_keys=TRUE;`, the export's own first line,
 *           because a deferral lasts one import and each chunk is one import.
 *           Chunk boundaries fall between tables whenever the next table fits
 *           a fresh chunk, so a self-referencing table is split only when it
 *           is bigger than a chunk on its own (counted as `split_tables`).
 *           A FOREIGN KEY CYCLE between tables (legal_documents.fund_id →
 *           vc_funds, vc_funds.lpa_doc_id → legal_documents) has no parent to
 *           put first, and the deferral does not hold across the statements of
 *           a remote `wrangler d1 execute --file` import: the 2026-11-01 drill
 *           (run 41307767798) failed chunk 275 with SQLITE_CONSTRAINT_FOREIGNKEY
 *           there. So each cycle is broken at one nullable back-edge: that
 *           table's rows are inserted with the back-edge column(s) NULL, and
 *           an `UPDATE … SET col=<original> WHERE <pk>=…` per row runs after
 *           every INSERT (`cycle_edges_broken`, `cycle_rows_updated`). Every
 *           statement is then valid on its own under immediate FK checks. A
 *           cycle with no breakable edge (every back-edge NOT NULL, or no
 *           primary key) is counted as `cyclic_tables` and keeps the old
 *           export-order fallback.
 *   post    indexes, views and triggers, after the data, so restoring a row
 *           never fires a trigger: the backup already holds what the
 *           triggers wrote.
 * The export's PRAGMAs, any transaction control (D1 refuses it) and any
 * statement on D1's internal `_cf_*` tables are dropped and counted.
 *
 * NEVER PRINTS BACKUP CONTENT. It prints counts, byte sizes and phase names
 * only. Table names are schema and appear in no output either. A parse error
 * reports a byte offset, never the text there.
 *
 * Usage: node scripts/dr-drill-split.mjs <export.sql> <out-dir> [chunk-bytes]
 * Writes <out-dir>/NNN-<phase>.sql and <out-dir>/manifest.tsv, one line per
 * chunk: file, phase, statements, bytes, statements over D1's 100 KB limit.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_CHUNK_BYTES = 1_000_000;
// D1's documented maximum SQL statement length. Counted, never enforced here:
// it says which chunk to look at if one fails.
export const D1_STATEMENT_LIMIT = 100_000;
export const DEFER_FK = 'PRAGMA defer_foreign_keys=TRUE;';

const WORD = /[A-Za-z0-9_$]/;

/**
 * Split SQL text into statements. Knows single-quoted strings ('' escapes),
 * "", `` and [] identifiers, -- and block comments (dropped), and trigger
 * bodies, whose BEGIN … END holds semicolons (CASE … END nests inside).
 * Returns { statements, error } where error is null or { offset, reason }.
 */
export function splitStatements(sql) {
  const statements = [];
  let cur = '';
  let words = [];
  let word = '';
  let depth = 0;
  let sawBegin = false;
  let i = 0;
  const n = sql.length;

  const isTrigger = () => {
    const w = words.slice(0, 3);
    return w[0] === 'CREATE' && (w[1] === 'TRIGGER' || ((w[1] === 'TEMP' || w[1] === 'TEMPORARY') && w[2] === 'TRIGGER'));
  };
  const endWord = () => {
    if (!word) return;
    const u = word.toUpperCase();
    words.push(u);
    if (isTrigger()) {
      if (u === 'BEGIN') { depth += 1; sawBegin = true; }
      else if (u === 'CASE') depth += 1;
      else if (u === 'END' && depth > 0) depth -= 1;
    }
    word = '';
  };
  const flush = () => {
    const s = cur.trim();
    if (s) statements.push(s.endsWith(';') ? s : `${s};`);
    cur = ''; words = []; word = ''; depth = 0; sawBegin = false;
  };
  const quoted = (close, reason) => {
    const start = i;
    cur += sql[i++];
    for (;;) {
      if (i >= n) return { offset: start, reason };
      const c = sql[i];
      cur += c; i += 1;
      if (c === close) {
        if (close !== ']' && sql[i] === close) { cur += sql[i]; i += 1; continue; }
        return null;
      }
    }
  };

  while (i < n) {
    const c = sql[i];
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      endWord();
      const err = quoted(c === '[' ? ']' : c, 'unterminated quote');
      if (err) return { statements, error: err };
      // A quoted identifier counts as a word for statement classification.
      words.push('\u0000');
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      endWord();
      while (i < n && sql[i] !== '\n') i += 1;
      cur += ' ';
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      endWord();
      const start = i;
      const close = sql.indexOf('*/', i + 2);
      if (close === -1) return { statements, error: { offset: start, reason: 'unterminated comment' } };
      i = close + 2;
      cur += ' ';
      continue;
    }
    if (c === ';') {
      endWord();
      cur += c; i += 1;
      if (isTrigger() && (!sawBegin || depth > 0)) continue;
      flush();
      continue;
    }
    if (WORD.test(c)) word += c; else endWord();
    cur += c; i += 1;
  }
  endWord();
  flush();
  return { statements, error: null };
}

// One identifier, optionally schema-qualified: "a", `a`, [a] or a bare word.
const IDENT = String.raw`(?:"(?:[^"]|"")+"|\x60(?:[^\x60]|\x60\x60)+\x60|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)`;
const QNAME = String.raw`(?:${IDENT}\s*\.\s*)?(${IDENT})`;
const unquote = (s) => {
  if (/^".*"$/s.test(s)) return s.slice(1, -1).replace(/""/g, '"').toLowerCase();
  if (/^`.*`$/s.test(s)) return s.slice(1, -1).replace(/``/g, '`').toLowerCase();
  if (/^\[.*\]$/s.test(s)) return s.slice(1, -1).toLowerCase();
  return s.toLowerCase();
};

const RE_CREATE_TABLE = new RegExp(String.raw`^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${QNAME}`, 'i');
const RE_INSERT = new RegExp(String.raw`^(?:INSERT(?:\s+OR\s+[A-Z]+)?|REPLACE)\s+INTO\s+${QNAME}`, 'i');
const RE_DELETE = new RegExp(String.raw`^DELETE\s+FROM\s+${QNAME}`, 'i');
const RE_TXN = /^(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
const RE_REFS = new RegExp(String.raw`\bREFERENCES\s+${QNAME}`, 'gi');
const INTERNAL = (t) => t.startsWith('_cf_');

/** Index of the bracket closing the one at `open`, skipping quoted text; -1 if none. */
function closeParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === close) { if (close !== ']' && text[i + 1] === close) { i += 1; continue; } break; }
      }
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Split on commas at bracket depth 0, outside quotes. Items are trimmed. */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === close) { if (close !== ']' && text[i + 1] === close) { i += 1; continue; } break; }
      }
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  out.push(text.slice(start).trim());
  return out;
}

const RE_LEAD_IDENT = new RegExp(String.raw`^\s*(${IDENT})`);
const identList = (text) => splitTopLevel(text).map((x) => { const m = RE_LEAD_IDENT.exec(x); return m ? unquote(m[1]) : null; });
// Keywords tested with string literals blanked, so a DEFAULT 'not null' is not one.
const blankStrings = (t) => t.replace(/'(?:[^']|'')*'/g, "''");

/**
 * Read a CREATE TABLE's columns, primary key and foreign keys. Returns
 * { columns: [{ name, notNull }], pk: [names], fks: [{ cols, parent }] } or
 * null if the column list cannot be found.
 */
export function parseCreateTable(sql) {
  const m = RE_CREATE_TABLE.exec(sql);
  if (!m) return null;
  const open = sql.indexOf('(', m.index + m[0].length);
  const close = open === -1 ? -1 : closeParen(sql, open);
  if (close === -1) return null;
  const columns = [];
  const pk = [];
  const fks = [];
  for (const item of splitTopLevel(sql.slice(open + 1, close))) {
    if (!item) continue;
    const bare = blankStrings(item);
    const lead = /^\s*([A-Za-z_]+)/.exec(bare);
    const kw = lead ? lead[1].toUpperCase() : '';
    if (['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK'].includes(kw)) {
      let mm;
      if ((mm = /\bPRIMARY\s+KEY\s*\(/i.exec(bare))) {
        const o = mm.index + mm[0].length - 1;
        pk.push(...identList(item.slice(o + 1, closeParen(item, o))).filter(Boolean));
      } else if ((mm = /\bFOREIGN\s+KEY\s*\(/i.exec(bare))) {
        const o = mm.index + mm[0].length - 1;
        const c = closeParen(item, o);
        const ref = new RegExp(String.raw`\bREFERENCES\s+${QNAME}`, 'i').exec(item.slice(c));
        if (ref) fks.push({ cols: identList(item.slice(o + 1, c)).filter(Boolean), parent: unquote(ref[1]) });
      }
      continue;
    }
    const nm = RE_LEAD_IDENT.exec(item);
    if (!nm) continue;
    const name = unquote(nm[1]);
    const rest = blankStrings(item.slice(nm[0].length));
    columns.push({ name, notNull: /\bNOT\s+NULL\b/i.test(rest) });
    if (/\bPRIMARY\s+KEY\b/i.test(rest)) pk.push(name);
    const ref = new RegExp(String.raw`\bREFERENCES\s+${QNAME}`, 'i').exec(item.slice(nm[0].length));
    if (ref) fks.push({ cols: [name], parent: unquote(ref[1]) });
  }
  return { columns, pk, fks };
}

/**
 * Parse a one-row `INSERT INTO t [(cols)] VALUES(...)` into its parts, or
 * null for anything else (multi-row VALUES, INSERT … SELECT, a trailing clause).
 */
function parseInsert(stmt) {
  const m = RE_INSERT.exec(stmt);
  if (!m) return null;
  let i = m.index + m[0].length;
  while (/\s/.test(stmt[i] || '')) i += 1;
  let cols = null;
  if (stmt[i] === '(') {
    const c = closeParen(stmt, i);
    if (c === -1) return null;
    cols = identList(stmt.slice(i + 1, c));
    if (cols.some((x) => !x)) return null;
    i = c + 1;
  }
  const v = /^\s*VALUES\s*\(/i.exec(stmt.slice(i));
  if (!v) return null;
  const open = i + v[0].length - 1;
  const close = closeParen(stmt, open);
  if (close === -1 || stmt.slice(close + 1).trim() !== ';') return null;
  return { head: stmt.slice(0, open + 1), cols, values: splitTopLevel(stmt.slice(open + 1, close)) };
}

const quoteIdent = (name) => `"${name.replace(/"/g, '""')}"`;

/**
 * Strongly connected components of the graph (tables → parents), Tarjan's
 * algorithm, in a deterministic order. Self-edges are ignored: a
 * self-referencing table is not a cycle between tables.
 */
function components(tables, edges) {
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const out = [];
  const visit = (v) => {
    idx.set(v, index); low.set(v, index); index += 1;
    stack.push(v); onStack.add(v);
    for (const w of edges.get(v) || []) {
      if (w === v || !tables.includes(w)) continue;
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
      out.push(comp);
    }
  };
  for (const t of tables) if (!idx.has(t)) visit(t);
  return out;
}

/**
 * Choose back-edges whose removal leaves no cycle between tables. An edge
 * child → parent is breakable when the child has a primary key, and every FK
 * column of the child that points at the parent is nullable and not part of
 * that key. Returns { broken: Map(child → Map(parent → cols)), unresolved }.
 */
function breakCycles(tables, deps, info) {
  const edges = new Map(tables.map((t) => [t, new Set(deps.get(t) || [])]));
  const broken = new Map();
  const stuck = new Set();
  for (;;) {
    const cyc = components(tables, edges).filter((c) => c.length > 1 && !c.every((t) => stuck.has(t)));
    if (!cyc.length) break;
    let progressed = false;
    for (const comp of cyc) {
      const members = tables.filter((t) => comp.includes(t));
      let pick = null;
      for (const child of members) {
        const ti = info.get(child);
        if (!ti || !ti.pk.length) continue;
        for (const parent of members) {
          if (parent === child || !edges.get(child).has(parent)) continue;
          const cols = [...new Set(ti.fks.filter((f) => f.parent === parent).flatMap((f) => f.cols))];
          const nullable = cols.length && cols.every((c) => {
            const col = ti.columns.find((x) => x.name === c);
            return col && !col.notNull && !ti.pk.includes(c);
          });
          if (nullable) { pick = { child, parent, cols }; break; }
        }
        if (pick) break;
      }
      if (!pick) { comp.forEach((t) => stuck.add(t)); continue; }
      edges.get(pick.child).delete(pick.parent);
      if (!broken.has(pick.child)) broken.set(pick.child, new Map());
      broken.get(pick.child).set(pick.parent, pick.cols);
      progressed = true;
      break; // recompute the components after every removal
    }
    if (!progressed) break;
  }
  return { broken, edges };
}

/**
 * Insert a row with its back-edge columns NULL and return the UPDATE that
 * restores them, or null if the row cannot be rewritten (left as exported).
 * A row whose back-edge columns are already NULL needs no UPDATE: { insert }.
 */
function deferRow(stmt, ti, cols) {
  const p = parseInsert(stmt);
  if (!p) return null;
  const names = p.cols || ti.columns.map((c) => c.name);
  if (names.length !== p.values.length) return null;
  const at = (n) => names.indexOf(n);
  if (cols.some((c) => at(c) === -1) || ti.pk.some((c) => at(c) === -1)) return null;
  const isNull = (v) => /^NULL$/i.test(v);
  const set = cols.filter((c) => !isNull(p.values[at(c)]));
  if (!set.length) return { insert: stmt, update: null };
  const keys = ti.pk.map((c) => p.values[at(c)]);
  if (keys.some(isNull)) return null;
  const values = p.values.map((v, k) => (cols.includes(names[k]) ? 'NULL' : v));
  const table = unquote(RE_INSERT.exec(stmt)[1]);
  return {
    insert: `${p.head}${values.join(',')});`,
    update: `UPDATE ${quoteIdent(table)} SET ${set.map((c) => `${quoteIdent(c)}=${p.values[at(c)]}`).join(',')} WHERE ${ti.pk.map((c, k) => `${quoteIdent(c)}=${keys[k]}`).join(' AND ')};`,
  };
}

/** Sort tables parents-first. Ties and cycles keep the export's order. */
function parentsFirst(tables, deps) {
  const order = [];
  const done = new Set();
  const remaining = [...tables];
  let progressed = true;
  while (remaining.length && progressed) {
    progressed = false;
    for (let k = 0; k < remaining.length; k += 1) {
      const t = remaining[k];
      const need = [...(deps.get(t) || [])].filter((d) => d !== t && tables.includes(d) && !done.has(d));
      if (need.length === 0) {
        order.push(t); done.add(t); remaining.splice(k, 1);
        progressed = true;
        break;
      }
    }
  }
  return { order: order.concat(remaining), cyclic: remaining.length };
}

/**
 * Plan the restore: classify every statement, order the data parents-first
 * and pack each phase into chunks of at most chunkBytes (a single statement
 * bigger than that gets a chunk of its own). Returns { chunks, counts, error };
 * a chunk is { phase, statements, bytes, overLimit }.
 */
export function planRestore(sql, { chunkBytes = DEFAULT_CHUNK_BYTES } = {}) {
  const { statements, error } = splitStatements(sql);
  const counts = {
    statements: statements.length, schema: 0, data: 0, post: 0,
    dropped_pragma: 0, dropped_txn: 0, dropped_internal: 0,
    tables: 0, cyclic_tables: 0, cycle_edges_broken: 0, cycle_rows_updated: 0,
    cycle_rows_unparsed: 0, split_tables: 0,
    largest_statement_bytes: 0, over_limit: 0, chunks: 0,
  };
  if (error) return { chunks: [], counts, error };

  const schema = [];
  const post = [];
  const deps = new Map();
  const info = new Map();
  const tableOrder = [];
  const rows = new Map();
  const seq = [];
  const addRow = (t, s) => {
    if (!rows.has(t)) { rows.set(t, []); if (!tableOrder.includes(t)) tableOrder.push(t); }
    rows.get(t).push(s);
  };

  for (const s of statements) {
    const bytes = Buffer.byteLength(s);
    if (bytes > counts.largest_statement_bytes) counts.largest_statement_bytes = bytes;
    if (bytes > D1_STATEMENT_LIMIT) counts.over_limit += 1;
    let m;
    if (/^PRAGMA\b/i.test(s)) { counts.dropped_pragma += 1; continue; }
    if (RE_TXN.test(s)) { counts.dropped_txn += 1; continue; }
    if ((m = RE_CREATE_TABLE.exec(s))) {
      const t = unquote(m[1]);
      // SQLite creates its own sqlite_* tables and refuses a CREATE of one.
      if (INTERNAL(t) || t.startsWith('sqlite_')) { counts.dropped_internal += 1; continue; }
      schema.push(s); counts.schema += 1;
      if (!tableOrder.includes(t)) tableOrder.push(t);
      const refs = new Set();
      for (const r of s.matchAll(RE_REFS)) refs.add(unquote(r[1]));
      deps.set(t, refs);
      const parsed = parseCreateTable(s);
      if (parsed) info.set(t, parsed);
      continue;
    }
    if ((m = RE_INSERT.exec(s) || RE_DELETE.exec(s))) {
      const t = unquote(m[1]);
      if (INTERNAL(t)) { counts.dropped_internal += 1; continue; }
      counts.data += 1;
      if (t === 'sqlite_sequence') seq.push(s); else addRow(t, s);
      continue;
    }
    // Indexes, views, triggers and anything unrecognised run after the data,
    // in the export's order.
    post.push(s); counts.post += 1;
  }

  const dataTables = tableOrder.filter((t) => rows.has(t));
  counts.tables = dataTables.length;
  // Break every cycle between tables at a nullable back-edge, then order the
  // rest parents-first: cycle members, and the tables under them, included.
  const { broken, edges } = breakCycles(dataTables, deps, info);
  const updates = [];
  for (const [child, parents] of broken) {
    counts.cycle_edges_broken += parents.size;
    const cols = [...new Set([...parents.values()].flat())];
    rows.set(child, rows.get(child).map((stmt) => {
      if (!RE_INSERT.test(stmt)) return stmt;
      const r = deferRow(stmt, info.get(child), cols);
      if (!r) { counts.cycle_rows_unparsed += 1; return stmt; }
      if (r.update) { updates.push(r.update); counts.cycle_rows_updated += 1; }
      return r.insert;
    }));
  }
  const { order, cyclic } = parentsFirst(dataTables, edges);
  counts.cyclic_tables = cyclic;

  const chunks = [];
  const pack = (phase, groups, header = null) => {
    const headerBytes = header ? Buffer.byteLength(header) + 1 : 0;
    let chunk = null;
    const open = () => { chunk = { phase, header, statements: [], bytes: headerBytes, overLimit: 0 }; chunks.push(chunk); };
    for (const group of groups) {
      const groupBytes = group.reduce((a, s) => a + Buffer.byteLength(s) + 1, 0);
      // A table that fits a fresh chunk never straddles two.
      if (chunk && chunk.statements.length && chunk.bytes + groupBytes > chunkBytes && headerBytes + groupBytes <= chunkBytes) open();
      let split = false;
      for (let k = 0; k < group.length; k += 1) {
        const b = Buffer.byteLength(group[k]) + 1;
        if (!chunk || (chunk.statements.length && chunk.bytes + b > chunkBytes)) {
          if (chunk && k > 0) split = true;
          open();
        }
        chunk.statements.push(group[k]);
        chunk.bytes += b;
        if (b - 1 > D1_STATEMENT_LIMIT) chunk.overLimit += 1;
      }
      if (split) counts.split_tables += 1;
    }
  };
  pack('schema', schema.map((s) => [s]));
  // The back-edge UPDATEs run after every INSERT, when both ends exist.
  pack('data', [...order.map((t) => rows.get(t)), ...(updates.length ? [updates] : []), ...(seq.length ? [seq] : [])], DEFER_FK);
  pack('post', post.map((s) => [s]));
  counts.chunks = chunks.length;
  return { chunks, counts, error: null };
}

export function chunkText(chunk) {
  return (chunk.header ? `${chunk.header}\n` : '') + chunk.statements.join('\n') + '\n';
}

function main(argv) {
  const [input, outDir, size] = argv;
  if (!input || !outDir) {
    console.error('usage: dr-drill-split.mjs <export.sql> <out-dir> [chunk-bytes]');
    return 64;
  }
  const chunkBytes = size ? Number(size) : DEFAULT_CHUNK_BYTES;
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1024) {
    console.error('dr-drill-split: chunk-bytes must be an integer of at least 1024');
    return 64;
  }
  const sql = readFileSync(input, 'utf8');
  const { chunks, counts, error } = planRestore(sql, { chunkBytes });
  if (error) {
    console.error(`dr-drill-split: ${error.reason} at byte offset ${Buffer.byteLength(sql.slice(0, error.offset))}`);
    return 1;
  }
  if (counts.schema === 0) {
    console.error('dr-drill-split: the export holds no CREATE TABLE');
    return 1;
  }
  mkdirSync(outDir, { recursive: true });
  const manifest = [];
  chunks.forEach((c, k) => {
    const file = join(outDir, `${String(k + 1).padStart(3, '0')}-${c.phase}.sql`);
    writeFileSync(file, chunkText(c));
    manifest.push([file, c.phase, c.statements.length, c.bytes, c.overLimit].join('\t'));
  });
  writeFileSync(join(outDir, 'manifest.tsv'), manifest.join('\n') + '\n');
  console.log(Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exitCode = main(process.argv.slice(2));
}
