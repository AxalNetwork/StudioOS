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
    tables: 0, cyclic_tables: 0, split_tables: 0,
    largest_statement_bytes: 0, over_limit: 0, chunks: 0,
  };
  if (error) return { chunks: [], counts, error };

  const schema = [];
  const post = [];
  const deps = new Map();
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
  const { order, cyclic } = parentsFirst(dataTables, deps);
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
  pack('data', [...order.map((t) => rows.get(t)), ...(seq.length ? [seq] : [])], DEFER_FK);
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
