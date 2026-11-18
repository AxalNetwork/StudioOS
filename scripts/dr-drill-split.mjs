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
 * STREAMED (D7142). The export is never one string: Node refuses a string
 * past 536,870,888 characters and the export grows about 4 MiB a day. The
 * command line decodes the file as a stream (planFile), plans each statement
 * as it is read, spools each table's rows to a temporary directory, and
 * writes each chunk when the next one opens. The chunk files, their order and
 * manifest.tsv are what planRestore (the same planner, held in memory) gives.
 *
 * Usage: node scripts/dr-drill-split.mjs <export.sql> <out-dir> [chunk-bytes]
 * Writes <out-dir>/NNN-<phase>.sql and <out-dir>/manifest.tsv, one line per
 * chunk: file, phase, statements, bytes, statements over D1's 100 KB limit.
 */
import {
  appendFileSync, closeSync, createReadStream, mkdirSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_CHUNK_BYTES = 1_000_000;
// D1's documented maximum SQL statement length. Counted, never enforced here:
// it says which chunk to look at if one fails.
export const D1_STATEMENT_LIMIT = 100_000;
export const DEFER_FK = 'PRAGMA defer_foreign_keys=TRUE;';

// A word character: [A-Za-z0-9_$].
const isWordCode = (k) => (k >= 97 && k <= 122) || (k >= 65 && k <= 90) || (k >= 48 && k <= 57) || k === 95 || k === 36;
const NORMAL = 0;
const QUOTE = 1;
const LINE_COMMENT = 2;
const BLOCK_COMMENT = 3;

/**
 * D7142 — the statement splitter, fed in pieces. Knows single-quoted strings
 * ('' escapes), "", `` and [] identifiers, -- and block comments (dropped),
 * and trigger bodies, whose BEGIN … END holds semicolons (CASE … END nests
 * inside). `push(text)` takes the next piece of the export, in any size; each
 * statement is handed to `onStatement` as soon as its end is read, so the
 * whole export is never one string. A piece may end anywhere: inside a quote,
 * between the two characters of `--`, `/*`, `*\/` or a doubled quote, or in
 * the middle of a word; the one character that needs the next piece to decide
 * is held back until it arrives. `end()` finishes and returns
 * { statements: count, error }, error null or { offset, reason }, offset in
 * UTF-16 code units from the start (as a string index into the whole export
 * would be), `errorByteOffset` the same position in UTF-8 bytes.
 * `splitStatements(sql)` is this with one piece, so the string and the stream
 * share every rule.
 */
export class StatementSplitter {
  constructor(onStatement) {
    this.onStatement = onStatement;
    this.count = 0;
    this.held = '';      // the tail of the last piece, held for one character of lookahead
    this.base = 0;       // offset of held[0] in the export, in code units
    this.baseBytes = 0;  // and in UTF-8 bytes
    this.cur = '';
    this.state = NORMAL;
    this.close = '';
    this.mark = null;    // where the open quote or comment began: { offset, piece, at, baseBytes }
    this.reason = '';
    this.inWord = false;
    this.word = '';
    this.collect = false;
    this.first = [];     // the statement's first three words, upper-cased; a quoted identifier is '\u0000'
    this.nwords = 0;
    this.depth = 0;
    this.sawBegin = false;
    this.error = null;
    this.errorByteOffset = null;
    this.done = false;
  }

  isTrigger() {
    const w = this.first;
    return w[0] === 'CREATE' && (w[1] === 'TRIGGER' || ((w[1] === 'TEMP' || w[1] === 'TEMPORARY') && w[2] === 'TRIGGER'));
  }

  pushWord(u) {
    if (this.nwords < 3) this.first.push(u);
    this.nwords += 1;
  }

  flush() {
    const s = this.cur.trim();
    if (s) { this.count += 1; this.onStatement(s.endsWith(';') ? s : `${s};`); }
    this.cur = ''; this.first = []; this.nwords = 0; this.word = ''; this.inWord = false; this.depth = 0; this.sawBegin = false;
  }

  push(text) {
    if (this.done || this.error) return this;
    this.run(this.held + text, false);
    return this;
  }

  end() {
    if (!this.done && !this.error) {
      this.run(this.held, true);
      this.done = true;
      if (this.state === QUOTE || this.state === BLOCK_COMMENT) {
        const m = this.mark;
        this.error = { offset: m.offset, reason: this.reason };
        this.errorByteOffset = m.baseBytes + Buffer.byteLength(m.piece.slice(0, m.at));
      } else {
        this.flush();
      }
    }
    return { statements: this.count, error: this.error };
  }

  run(buf, final) {
    const n = buf.length;
    let i = 0;
    let seg = 0;         // the first character of buf not yet copied into cur
    let wstart = 0;      // where the current word began in buf
    let stop = n;        // where processing stopped; buf.slice(stop) is held
    const endWord = (at) => {
      if (!this.inWord) return;
      this.inWord = false;
      if (!this.collect) { this.nwords += 1; return; }
      const u = (this.word + buf.slice(wstart, at)).toUpperCase();
      this.word = '';
      this.pushWord(u);
      if (this.isTrigger()) {
        if (u === 'BEGIN') { this.depth += 1; this.sawBegin = true; }
        else if (u === 'CASE') this.depth += 1;
        else if (u === 'END' && this.depth > 0) this.depth -= 1;
      }
    };
    const markHere = (at, reason) => {
      this.mark = { offset: this.base + at, piece: buf, at, baseBytes: this.baseBytes };
      this.reason = reason;
    };

    scan: while (i < n) {
      switch (this.state) {
        case QUOTE: {
          const j = buf.indexOf(this.close, i);
          if (j === -1) { i = n; break; }
          if (this.close !== ']') {
            if (j + 1 >= n && !final) { stop = j; break scan; }
            if (buf[j + 1] === this.close) { i = j + 2; break; }
          }
          i = j + 1;
          this.state = NORMAL;
          break;
        }
        case LINE_COMMENT: {
          const j = buf.indexOf('\n', i);
          if (j === -1) { i = n; break; }
          i = j; seg = j;
          this.state = NORMAL;
          break;
        }
        case BLOCK_COMMENT: {
          const j = buf.indexOf('*/', i);
          if (j === -1) {
            if (!final && n - 1 >= i && buf[n - 1] === '*') { stop = n - 1; break scan; }
            i = n; break;
          }
          i = j + 2; seg = i;
          this.state = NORMAL;
          break;
        }
        default: {
          const k = buf.charCodeAt(i);
          if (isWordCode(k)) {
            if (!this.inWord) {
              this.inWord = true;
              wstart = i;
              this.word = '';
              this.collect = this.nwords < 3 || this.isTrigger();
            }
            i += 1;
            while (i < n && isWordCode(buf.charCodeAt(i))) i += 1;
            break;
          }
          if (k === 39 || k === 34 || k === 96 || k === 91) { // ' " ` [
            endWord(i);
            markHere(i, 'unterminated quote');
            this.close = k === 91 ? ']' : buf[i];
            this.state = QUOTE;
            // A quoted identifier counts as a word for statement classification.
            this.pushWord('\u0000');
            i += 1;
            break;
          }
          if (k === 45 || k === 47) { // - /
            if (i + 1 >= n && !final) { stop = i; break scan; }
            const next = buf[i + 1];
            if (k === 45 && next === '-') {
              endWord(i);
              this.cur += `${buf.slice(seg, i)} `;
              this.state = LINE_COMMENT;
              i += 2;
              break;
            }
            if (k === 47 && next === '*') {
              endWord(i);
              this.cur += `${buf.slice(seg, i)} `;
              markHere(i, 'unterminated comment');
              this.state = BLOCK_COMMENT;
              i += 2;
              break;
            }
            endWord(i);
            i += 1;
            break;
          }
          if (k === 59) { // ;
            endWord(i);
            i += 1;
            if (this.isTrigger() && (!this.sawBegin || this.depth > 0)) break;
            this.cur += buf.slice(seg, i);
            seg = i;
            this.flush();
            break;
          }
          endWord(i);
          i += 1;
        }
      }
    }
    // A piece cut between the two halves of a surrogate pair holds the first
    // half back, so byte offsets count the pair as one character. It is never
    // a word, quote or comment character, so reading it again changes nothing.
    if (!final && stop === n && n > 0) {
      const k = buf.charCodeAt(n - 1);
      if (k >= 0xd800 && k <= 0xdbff) stop = n - 1;
    }
    if (this.inWord && this.collect) { this.word += buf.slice(wstart, stop); }
    if (this.state === NORMAL || this.state === QUOTE) {
      if (seg < stop) this.cur += buf.slice(seg, stop);
    }
    this.held = stop < n ? buf.slice(stop) : '';
    this.base += stop;
    this.baseBytes += Buffer.byteLength(stop < n ? buf.slice(0, stop) : buf);
  }
}

/**
 * Split SQL text into statements: the StatementSplitter fed the whole text.
 * Returns { statements, error } where error is null or { offset, reason }.
 */
export function splitStatements(sql) {
  const statements = [];
  const { error } = new StatementSplitter((s) => statements.push(s)).push(sql).end();
  return { statements, error };
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

const newCounts = (statements = 0) => ({
  statements, schema: 0, data: 0, post: 0,
  dropped_pragma: 0, dropped_txn: 0, dropped_internal: 0,
  tables: 0, cyclic_tables: 0, cycle_edges_broken: 0, cycle_rows_updated: 0,
  cycle_rows_unparsed: 0, split_tables: 0,
  largest_statement_bytes: 0, over_limit: 0, chunks: 0,
});

// Store keys for the two groups that are not a table's rows. A table name
// read by unquote() never holds a NUL.
const UPDATES = '\u0000updates';
const SEQUENCE = '\u0000sqlite_sequence';

/** The data rows, grouped by table, held in memory (planRestore on a string). */
export function memoryStore() {
  const rows = new Map();
  return {
    append(key, s) { if (!rows.has(key)) rows.set(key, []); rows.get(key).push(s); },
    has: (key) => rows.has(key),
    bytes: (key) => (rows.get(key) || []).reduce((a, s) => a + Buffer.byteLength(s) + 1, 0),
    items: (key) => rows.get(key) || [],
    rewrite(key, fn) { rows.set(key, rows.get(key).map(fn)); },
    close() {},
  };
}

/**
 * D7142 — the data rows, grouped by table, spooled to files under `dir`, so a
 * planned restore holds one table's write buffer per table and one chunk at
 * a time, never the export. Each record is a 4-byte length and the
 * statement's UTF-8 bytes.
 */
export function spoolStore(dir, { flushBytes = 1 << 16 } = {}) {
  const groups = new Map();
  let files = 0;
  const flush = (g) => {
    if (!g.parts.length) return;
    appendFileSync(g.file, Buffer.concat(g.parts, g.pending));
    g.parts = []; g.pending = 0;
  };
  const create = (key) => {
    const g = { file: join(dir, `${String(files += 1).padStart(6, '0')}.spool`), parts: [], pending: 0, bytes: 0, count: 0 };
    writeFileSync(g.file, '');
    groups.set(key, g);
    return g;
  };
  const write = (g, s) => {
    const b = Buffer.from(s, 'utf8');
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32LE(b.length, 0);
    g.parts.push(len, b);
    g.pending += 4 + b.length;
    g.bytes += b.length + 1;
    g.count += 1;
    if (g.pending >= flushBytes) flush(g);
  };
  function* read(g) {
    flush(g);
    const fd = openSync(g.file, 'r');
    try {
      let buf = Buffer.allocUnsafe(1 << 20);
      let have = 0;
      let at = 0;
      for (;;) {
        if (have - at >= 4) {
          const len = buf.readUInt32LE(at);
          if (have - at >= 4 + len) {
            yield buf.toString('utf8', at + 4, at + 4 + len);
            at += 4 + len;
            continue;
          }
          if (4 + len > buf.length) {
            const bigger = Buffer.allocUnsafe(4 + len);
            buf.copy(bigger, 0, at, have);
            buf = bigger; have -= at; at = 0;
          }
        }
        if (at > 0) { buf.copy(buf, 0, at, have); have -= at; at = 0; }
        const got = readSync(fd, buf, have, buf.length - have, null);
        if (got === 0) {
          if (have !== 0) throw new Error('a spool file ends inside a record');
          return;
        }
        have += got;
      }
    } finally {
      closeSync(fd);
    }
  }
  return {
    append(key, s) { write(groups.get(key) || create(key), s); },
    has: (key) => groups.has(key),
    bytes: (key) => groups.get(key)?.bytes ?? 0,
    items: (key) => (groups.has(key) ? read(groups.get(key)) : []),
    rewrite(key, fn) {
      const old = groups.get(key);
      groups.delete(key);
      const g = create(key);
      for (const s of read(old)) write(g, fn(s));
      flush(g);
      rmSync(old.file, { force: true });
    },
    close() { rmSync(dir, { recursive: true, force: true }); },
  };
}

/**
 * The restore plan, fed one statement at a time. `add(s)` classifies a
 * statement as planRestore always has; `finish({ chunkBytes, onChunk })`
 * orders the data parents-first and packs each phase into chunks of at most
 * chunkBytes (a single statement bigger than that gets a chunk of its own),
 * calling onChunk(chunk) as each chunk opens. A chunk is
 * { phase, header, statements, bytes, overLimit }; it is complete when the
 * next one opens, or when finish returns. The rows wait in `store`.
 */
export function createRestorePlanner({ store = memoryStore() } = {}) {
  const counts = newCounts();
  const schema = [];
  const post = [];
  const deps = new Map();
  const info = new Map();
  const tableOrder = [];
  const seen = new Set();
  const order = (t) => { if (!seen.has(t)) { seen.add(t); tableOrder.push(t); } };

  const add = (s) => {
    counts.statements += 1;
    const bytes = Buffer.byteLength(s);
    if (bytes > counts.largest_statement_bytes) counts.largest_statement_bytes = bytes;
    if (bytes > D1_STATEMENT_LIMIT) counts.over_limit += 1;
    let m;
    if (/^PRAGMA\b/i.test(s)) { counts.dropped_pragma += 1; return; }
    if (RE_TXN.test(s)) { counts.dropped_txn += 1; return; }
    if ((m = RE_CREATE_TABLE.exec(s))) {
      const t = unquote(m[1]);
      // SQLite creates its own sqlite_* tables and refuses a CREATE of one.
      if (INTERNAL(t) || t.startsWith('sqlite_')) { counts.dropped_internal += 1; return; }
      schema.push(s); counts.schema += 1;
      order(t);
      const refs = new Set();
      for (const r of s.matchAll(RE_REFS)) refs.add(unquote(r[1]));
      deps.set(t, refs);
      const parsed = parseCreateTable(s);
      if (parsed) info.set(t, parsed);
      return;
    }
    if ((m = RE_INSERT.exec(s) || RE_DELETE.exec(s))) {
      const t = unquote(m[1]);
      if (INTERNAL(t)) { counts.dropped_internal += 1; return; }
      counts.data += 1;
      if (t === 'sqlite_sequence') store.append(SEQUENCE, s);
      else { order(t); store.append(t, s); }
      return;
    }
    // Indexes, views, triggers and anything unrecognised run after the data,
    // in the export's order.
    post.push(s); counts.post += 1;
  };

  const finish = ({ chunkBytes = DEFAULT_CHUNK_BYTES, onChunk = () => {} } = {}) => {
    const dataTables = tableOrder.filter((t) => store.has(t));
    counts.tables = dataTables.length;
    // Break every cycle between tables at a nullable back-edge, then order the
    // rest parents-first: cycle members, and the tables under them, included.
    const { broken, edges } = breakCycles(dataTables, deps, info);
    for (const [child, parents] of broken) {
      counts.cycle_edges_broken += parents.size;
      const cols = [...new Set([...parents.values()].flat())];
      store.rewrite(child, (stmt) => {
        if (!RE_INSERT.test(stmt)) return stmt;
        const r = deferRow(stmt, info.get(child), cols);
        if (!r) { counts.cycle_rows_unparsed += 1; return stmt; }
        if (r.update) { store.append(UPDATES, r.update); counts.cycle_rows_updated += 1; }
        return r.insert;
      });
    }
    const { order: dataOrder, cyclic } = parentsFirst(dataTables, edges);
    counts.cyclic_tables = cyclic;

    const one = (s) => ({ bytes: Buffer.byteLength(s) + 1, items: [s] });
    const stored = (key) => ({ bytes: store.bytes(key), items: store.items(key) });
    const pack = (phase, groups, header = null) => {
      const headerBytes = header ? Buffer.byteLength(header) + 1 : 0;
      let chunk = null;
      const open = () => {
        chunk = { phase, header, statements: [], bytes: headerBytes, overLimit: 0 };
        counts.chunks += 1;
        onChunk(chunk);
      };
      for (const group of groups) {
        // A table that fits a fresh chunk never straddles two.
        if (chunk && chunk.statements.length && chunk.bytes + group.bytes > chunkBytes && headerBytes + group.bytes <= chunkBytes) open();
        let split = false;
        let k = 0;
        for (const s of group.items) {
          const b = Buffer.byteLength(s) + 1;
          if (!chunk || (chunk.statements.length && chunk.bytes + b > chunkBytes)) {
            if (chunk && k > 0) split = true;
            open();
          }
          chunk.statements.push(s);
          chunk.bytes += b;
          if (b - 1 > D1_STATEMENT_LIMIT) chunk.overLimit += 1;
          k += 1;
        }
        if (split) counts.split_tables += 1;
      }
    };
    pack('schema', schema.map(one));
    // The back-edge UPDATEs run after every INSERT, when both ends exist.
    pack('data', [
      ...dataOrder.map(stored),
      ...(store.has(UPDATES) ? [stored(UPDATES)] : []),
      ...(store.has(SEQUENCE) ? [stored(SEQUENCE)] : []),
    ], DEFER_FK);
    pack('post', post.map(one));
    return counts;
  };

  return { add, finish, counts };
}

/**
 * Plan the restore of an export held as one string: classify every
 * statement, order the data parents-first and pack each phase into chunks of
 * at most chunkBytes (a single statement bigger than that gets a chunk of its
 * own). Returns { chunks, counts, error }; a chunk is
 * { phase, header, statements, bytes, overLimit }. The command line streams
 * the same plan (planFile).
 */
export function planRestore(sql, { chunkBytes = DEFAULT_CHUNK_BYTES } = {}) {
  const { statements, error } = splitStatements(sql);
  if (error) return { chunks: [], counts: newCounts(statements.length), error };
  const planner = createRestorePlanner();
  for (const s of statements) planner.add(s);
  const chunks = [];
  const counts = planner.finish({ chunkBytes, onChunk: (c) => chunks.push(c) });
  return { chunks, counts, error: null };
}

export function chunkText(chunk) {
  return (chunk.header ? `${chunk.header}\n` : '') + chunk.statements.join('\n') + '\n';
}

/**
 * D7142 — split the export at `input` into chunk files in `outDir` without
 * ever reading it into one string: the file is decoded as a stream, each
 * statement planned as it is read, the rows spooled to a temporary directory,
 * and each chunk written when the next one opens. The files, their order and
 * manifest.tsv are planRestore's. Resolves to { counts, error, errorByteOffset }.
 */
export async function planFile(input, outDir, { chunkBytes = DEFAULT_CHUNK_BYTES, readBytes = 1 << 16, spoolDir = null } = {}) {
  const tmp = spoolDir ?? mkdtempSync(join(tmpdir(), 'dr-drill-split-'));
  const store = spoolStore(tmp);
  try {
    const planner = createRestorePlanner({ store });
    const splitter = new StatementSplitter(planner.add);
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
    for await (const piece of createReadStream(input, { highWaterMark: readBytes })) {
      splitter.push(decoder.decode(piece, { stream: true }));
    }
    splitter.push(decoder.decode());
    const { error } = splitter.end();
    if (error) return { counts: planner.counts, error, errorByteOffset: splitter.errorByteOffset };
    if (planner.counts.schema === 0) return { counts: planner.counts, error: null, errorByteOffset: null };
    mkdirSync(outDir, { recursive: true });
    const manifest = [];
    let open = null;
    const write = () => {
      if (!open) return;
      const file = join(outDir, `${String(manifest.length + 1).padStart(3, '0')}-${open.phase}.sql`);
      writeFileSync(file, chunkText(open));
      manifest.push([file, open.phase, open.statements.length, open.bytes, open.overLimit].join('\t'));
      open = null;
    };
    const counts = planner.finish({ chunkBytes, onChunk: (c) => { write(); open = c; } });
    write();
    writeFileSync(join(outDir, 'manifest.tsv'), manifest.join('\n') + '\n');
    return { counts, error: null, errorByteOffset: null };
  } finally {
    store.close();
  }
}

async function main(argv) {
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
  const { counts, error, errorByteOffset } = await planFile(input, outDir, { chunkBytes });
  if (error) {
    console.error(`dr-drill-split: ${error.reason} at byte offset ${errorByteOffset}`);
    return 1;
  }
  if (counts.schema === 0) {
    console.error('dr-drill-split: the export holds no CREATE TABLE');
    return 1;
  }
  console.log(Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
