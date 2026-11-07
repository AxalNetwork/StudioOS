/**
 * #4568 R2-04 — the inventory of runtime `ALTER TABLE … ADD COLUMN` in the
 * Worker: which file issues which, whether that file asks the table first
 * (`runSchemaBootstrap` / `tableColumns`, `util/schemaBootstrap.ts`) or ALTERs
 * blind and swallows the error, and whether the migrated schema already
 * declares the column.
 *
 * WHY IT MATTERS. A blind ALTER for a column a migration already declared
 * cannot succeed against an up-to-date database: it fails with `duplicate
 * column name`, on every fresh isolate, before its readiness cache is set.
 * That is the recurring error #4568's audit observed (R2-04, the cohort
 * applications bootstrap). Asking first costs one `pragma_table_info` read per
 * table per binding and issues no ALTER at all when the column is there.
 *
 * Pure apart from reading files; `inventory({ root, db })` takes the repo root
 * and a database holding the migrated schema.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ALTER = /ALTER\s+TABLE\s+["'`]?(\w+)["'`]?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi;
/** A file asks first when it routes its statements through the bootstrap that reads the table's columns. */
const ASKS = /\b(runSchemaBootstrap|tableColumns)\s*\(/;

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Every runtime ADD COLUMN in `cloudflare-worker/src`, with its file's policy and the schema's answer. */
export function inventory({ root, db }) {
  const src = join(root, 'cloudflare-worker', 'src');
  const has = new Map();
  const columnsOf = (table) => {
    if (!has.has(table)) {
      let cols = new Set();
      try { cols = new Set(db.prepare('SELECT name FROM pragma_table_info(?)').all(table).map((r) => String(r.name))); } catch { /* unknown */ }
      has.set(table, cols);
    }
    return has.get(table);
  };
  const files = [];
  for (const path of filesUnder(src).sort()) {
    const text = readFileSync(path, 'utf8');
    const file = relative(root, path);
    // util/schemaBootstrap.ts documents the ALTER shape; it issues none of its own.
    if (file.endsWith('util/schemaBootstrap.ts')) continue;
    const alters = [];
    for (const m of text.matchAll(ALTER)) {
      const table = m[1], column = m[2];
      if (/^\$|^\{/.test(table)) continue;
      alters.push({ table, column, line: lineOf(text, m.index), declared: columnsOf(table).has(column) });
    }
    if (!alters.length) continue;
    const asks = ASKS.test(text);
    files.push({ file, policy: asks ? 'asks_first' : 'blind', alters: alters.length,
      declared: alters.filter((a) => a.declared).length, undeclared: alters.filter((a) => !a.declared).length,
      tables: [...new Set(alters.map((a) => a.table))].sort(), statements: alters });
  }
  const blind = files.filter((f) => f.policy === 'blind');
  return {
    issue: 4568,
    files,
    totals: {
      files: files.length, alters: files.reduce((s, f) => s + f.alters, 0),
      blind_files: blind.length, blind_alters: blind.reduce((s, f) => s + f.alters, 0),
      // A blind ALTER of a declared column fails on every fresh isolate against an up-to-date database.
      blind_declared: blind.reduce((s, f) => s + f.declared, 0),
      asks_first_files: files.length - blind.length,
    },
  };
}

/**
 * The ratchet: no file may ALTER blind more than the baseline records, and no
 * new file may ALTER blind at all. A file that improved must lower its entry,
 * so the baseline only shrinks.
 */
export function ratchet(inv, baseline) {
  const now = Object.fromEntries(inv.files.filter((f) => f.policy === 'blind').map((f) => [f.file, f.alters]));
  const grown = Object.entries(now).filter(([f, n]) => n > (baseline[f] ?? 0)).map(([f, n]) => ({ file: f, now: n, baseline: baseline[f] ?? 0 }));
  const shrunk = Object.entries(baseline).filter(([f, n]) => (now[f] ?? 0) < n).map(([f, n]) => ({ file: f, now: now[f] ?? 0, baseline: n }));
  return { grown, shrunk, now };
}
