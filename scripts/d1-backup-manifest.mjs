#!/usr/bin/env node
/**
 * D4558 (#4558) — the integrity manifest of a D1 backup, and its checks.
 *
 * `backup-d1.yml` writes one manifest beside each export
 * (`d1/<db>/backup-YYYY-MM-DD.manifest.json`), never inside it. The restore
 * drill (`scripts/dr-drill.sh`) refuses a backup its manifest does not vouch
 * for. Everything here is a hash, a size, a time, a count or a schema name:
 * no row content is read into the manifest or printed.
 *
 *   build   <sql> <out.json> --key K --db D --exported-at T [--bookmark B]
 *           sha256, size, statements, every table with its row count (one
 *           INSERT per row, as `wrangler d1 export` writes them), each
 *           table's REFERENCES parents, and the last migration the ledger
 *           (`schema_migrations`, `scripts/migrate-d1.mjs`) recorded.
 *           The export is read once, as a stream, for the hash and the
 *           counts (D7142): it is never one string, so it may outgrow
 *           Node's 512 MiB string limit.
 *   verify  <sql> <manifest.json> --key K --migrations DIR [--max-age-hours H] [--now T]
 *           fails closed, exit 1 with one `reason=<code>` line, on:
 *             manifest_invalid   not a v1 manifest of this shape
 *             key_mismatch       the manifest names another backup
 *             size_mismatch      a truncated or extended download
 *             sha256_mismatch    a tampered or corrupted one
 *             stale              exported more than H hours (default 36) before now
 *             migration_unknown  the backup's last migration is not in this
 *                                checkout, so the restore tooling may not know its schema
 *   compare <manifest.json> <counts.json>
 *           the restored tables' row counts (`[{ t, n }]`, from the drill's
 *           COUNT(*) queries) against the manifest. Exit 1 with the names of
 *           each table that differs or is missing; counts only.
 *   chunk-tables <chunk.sql> [<manifest.json>]
 *           the tables a failed import chunk writes, and each one's parents
 *           (from the manifest): names only, for the drill's failure line.
 *   describe <sql>
 *           D8531: the tables the export CREATEs (plain and virtual), as JSON
 *           names. Schema only: no row is read into it.
 *   tables  <manifest.json> <sql> <restored.json> [--out FILE]
 *           D8531: the three table sets, compared BEFORE any row is counted:
 *           the manifest's tables, the tables the export creates, and the
 *           restored database's sqlite_master (`restored.json` is wrangler's
 *           --json answer to RESTORED_TABLES_SQL). Exit 1, reason
 *           table_set_differs, when a table is missing from the restore or the
 *           restore holds one the manifest does not list; each is named with
 *           its kind. Engine-owned tables (sqlite_*, _cf_*) are never missing
 *           or extra: sqlite_sequence is counted wherever the manifest lists
 *           it, and statistics (sqlite_stat*) are never restored or counted.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StatementSplitter, splitStatements } from './dr-drill-split.mjs';

export const MANIFEST_VERSION = 1;
export const DEFAULT_MAX_AGE_HOURS = 36;
const LEDGER = 'schema_migrations';

const IDENT = String.raw`(?:"(?:[^"]|"")+"|\x60(?:[^\x60]|\x60\x60)+\x60|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)`;
const QNAME = String.raw`(?:${IDENT}\s*\.\s*)?(${IDENT})`;
const RE_CREATE_TABLE = new RegExp(String.raw`^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${QNAME}`, 'i');
const RE_INSERT = new RegExp(String.raw`^(?:INSERT(?:\s+OR\s+[A-Z]+)?|REPLACE)\s+INTO\s+${QNAME}`, 'i');
const RE_REFS = new RegExp(String.raw`\bREFERENCES\s+${QNAME}`, 'gi');
const MIGRATION_FILE = /^(\d+)_[A-Za-z0-9_.-]+\.sql$/;
const unquote = (s) => {
  const q = s[0];
  if (q === '"') return s.slice(1, -1).replace(/""/g, '"');
  if (q === '`') return s.slice(1, -1).replace(/``/g, '`');
  if (q === '[') return s.slice(1, -1);
  return s;
};
const internal = (t) => t.startsWith('_cf_');
const RE_CREATE_VIRTUAL = new RegExp(String.raw`^CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${QNAME}`, 'i');

/**
 * D8531 — tables SQLite or D1 own, never the application's. `sqlite_sequence`
 * (AUTOINCREMENT's counters), `sqlite_stat1`..`sqlite_stat4` (ANALYZE and
 * `PRAGMA optimize` statistics) and D1's `_cf_*`. An export never CREATEs one:
 * `wrangler d1 export` writes `DELETE FROM sqlite_sequence;` or
 * `ANALYZE sqlite_schema;` and then their rows, so the manifest (which lists
 * every table that has a CREATE or an INSERT) lists them as tables.
 */
export const engineOwned = (t) => /^sqlite_/i.test(t) || /^_cf_/i.test(t);
/** Statistics: derived from the data, never restored (dr-drill-split.mjs drops them) and never counted. */
export const statisticsTable = (t) => /^sqlite_stat\d/i.test(t);
/** The manifest's tables whose rows a restore carries, and so whose rows the drill counts. */
export function countedTables(manifest) {
  return (manifest?.tables ?? []).filter((t) => !statisticsTable(t.name) && !internal(t.name));
}

/**
 * The restored database's tables and views, schema only: a name, its type and
 * whether it is a virtual table. Never `sql` itself, never a row.
 */
export const RESTORED_TABLES_SQL = "SELECT type, name, CASE WHEN sql LIKE 'CREATE VIRTUAL TABLE%' THEN 1 ELSE 0 END AS virtual FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;";

/** D8531 — the tables one export CREATEs, fed one statement at a time: { tables, virtual }. */
export function createCreatedTables() {
  const tables = new Set();
  const virtual = new Set();
  const add = (s) => {
    const c = RE_CREATE_TABLE.exec(s);
    if (c) { tables.add(unquote(c[1])); return; }
    const v = RE_CREATE_VIRTUAL.exec(s);
    if (v) virtual.add(unquote(v[1]));
  };
  return { add, result: () => ({ tables: [...tables].sort(), virtual: [...virtual].sort() }) };
}

/** The tables the export at `path` CREATEs, read as a stream. Resolves to { tables, virtual } or { error }. */
export async function createdTablesFile(path, { readBytes = 1 << 16 } = {}) {
  const c = createCreatedTables();
  const splitter = new StatementSplitter(c.add);
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  for await (const piece of createReadStream(path, { highWaterMark: readBytes })) splitter.push(decoder.decode(piece, { stream: true }));
  splitter.push(decoder.decode());
  const { error } = splitter.end();
  return error ? { error } : c.result();
}

/** The tables one export held as a string CREATEs. */
export function createdTables(sql) {
  const c = createCreatedTables();
  const { error } = new StatementSplitter(c.add).push(sql).end();
  return error ? { error } : c.result();
}

// The shadow tables SQLite creates for a virtual table, by module: FTS5, FTS3/4, R*Tree.
const SHADOW = /_(?:data|idx|content|docsize|config|segments|segdir|stat|node|rowid|parent)$/i;

/**
 * D8531 — the three table sets, before any count. `created` is
 * createdTables()'s answer for the export, `restored` the rows of
 * RESTORED_TABLES_SQL. Names (schema) and kinds only. SQLite compares names
 * without case, so the sets do too.
 *
 *   missing  a table the manifest lists that the restore does not hold as a
 *            table, with its kind: `table` (the export creates it), `virtual
 *            table`, `rows only` (the export inserts rows but never creates
 *            it), or `restored as a view`.
 *   extra    a table the restore holds that the manifest does not list, other
 *            than an engine-owned one or a virtual table's shadow table.
 *   engine   each engine-owned name the manifest lists, and what the drill does
 *            with it: `counted` (sqlite_sequence) or `not restored (statistics)`.
 *   not_created  manifest tables the export never creates (informational: a
 *            name here fails only when it is also missing).
 */
export function compareTableSets(manifest, created, restored) {
  const key = (n) => String(n).toLowerCase();
  const made = new Set([...(created?.tables ?? [])].map(key));
  const madeVirtual = new Set([...(created?.virtual ?? [])].map(key));
  const rows = Array.isArray(restored) ? restored : [];
  const tables = new Map();
  const views = new Set();
  const virtualRestored = [];
  for (const r of rows) {
    const name = String(r?.name ?? '');
    if (!name) continue;
    if (r.type === 'view') { views.add(key(name)); continue; }
    if (r.type !== 'table') continue;
    tables.set(key(name), name);
    if (Number(r.virtual) === 1) virtualRestored.push(key(name));
  }
  const listed = new Map();
  const engine = [];
  for (const t of manifest?.tables ?? []) {
    if (engineOwned(t.name)) {
      engine.push({ name: t.name, handled: statisticsTable(t.name) ? 'not restored (statistics)' : internal(t.name) ? 'not restored (D1 internal)' : 'counted' });
      continue;
    }
    listed.set(key(t.name), t.name);
  }
  const kindOf = (k) => {
    if (views.has(k)) return 'restored as a view';
    if (madeVirtual.has(k)) return 'virtual table';
    if (made.has(k)) return 'table';
    return 'rows only';
  };
  const missing = [...listed].filter(([k]) => !tables.has(k)).map(([k, name]) => ({ name, kind: kindOf(k) }));
  const shadow = (k) => virtualRestored.some((v) => k !== v && k.startsWith(`${v}_`) && SHADOW.test(k.slice(v.length)));
  const extra = [...tables].filter(([k, name]) => !listed.has(k) && !engineOwned(name) && !shadow(k))
    .map(([k, name]) => ({ name, kind: made.has(k) || madeVirtual.has(k) ? 'created by the export, not in the manifest' : 'in neither the manifest nor the export' }));
  const notCreated = [...listed].filter(([k]) => !made.has(k) && !madeVirtual.has(k)).map(([, name]) => name);
  return { missing, extra, engine, not_created: notCreated, differs: missing.length > 0 || extra.length > 0 };
}

/** Streamed, so a 270 MB export is never hashed from one string. verify uses it; build hashes in describeFile's pass. */
export function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolveHash(h.digest('hex')));
  });
}

/** Migration file names by applied order: numbered files, then UTC-stamped ones (D4106). */
export function migrationOrder(a, b) {
  const na = BigInt(MIGRATION_FILE.exec(a)?.[1] ?? '0');
  const nb = BigInt(MIGRATION_FILE.exec(b)?.[1] ?? '0');
  return na === nb ? (a < b ? -1 : a > b ? 1 : 0) : (na < nb ? -1 : 1);
}

/** The single-quoted literals of one INSERT's VALUES, for the ledger row only. */
function literals(stmt) {
  const out = [];
  const re = /'((?:[^']|'')*)'/g;
  let m;
  while ((m = re.exec(stmt))) out.push(m[1].replace(/''/g, "'"));
  return out;
}

/**
 * The schema and counts of one export, fed one statement at a time (D7142).
 * `add(s)` reads a statement; `result()` is what describe() returns. Names
 * and numbers only.
 */
export function createDescriber() {
  let statements = 0;
  const rows = new Map();
  const refs = new Map();
  const migrations = [];
  const add = (s) => {
    statements += 1;
    const c = RE_CREATE_TABLE.exec(s);
    if (c) {
      const t = unquote(c[1]);
      if (internal(t)) return;
      if (!rows.has(t)) rows.set(t, 0);
      const parents = new Set();
      for (const r of s.matchAll(RE_REFS)) { const p = unquote(r[1]); if (p !== t) parents.add(p); }
      refs.set(t, [...parents].sort());
      return;
    }
    const i = RE_INSERT.exec(s);
    if (i) {
      const t = unquote(i[1]);
      if (internal(t)) return;
      rows.set(t, (rows.get(t) ?? 0) + 1);
      if (t === LEDGER) { const f = literals(s).find((v) => MIGRATION_FILE.test(v)); if (f) migrations.push(f); }
    }
  };
  const result = () => {
    const applied = [...migrations].sort(migrationOrder);
    const tables = [...rows.keys()].sort();
    return {
      statements,
      tables: tables.map((name) => ({ name, rows: rows.get(name), references: refs.get(name) ?? [] })),
      migrations: { ledger: LEDGER, count: applied.length, last: applied.at(-1) ?? null },
    };
  };
  return { add, result };
}

/** The schema and counts of one export held as a string. Names and numbers only. */
export function describe(sql) {
  const d = createDescriber();
  const { error } = new StatementSplitter(d.add).push(sql).end();
  if (error) return { error };
  return d.result();
}

/**
 * D7142 — describe the export at `path`, and hash it, in one streamed pass:
 * the file is never one string, so an export past Node's 512 MiB string limit
 * is read like any other. Resolves to { ...describe(), sha256 } or { error }.
 */
export async function describeFile(path, { readBytes = 1 << 16 } = {}) {
  const d = createDescriber();
  const splitter = new StatementSplitter(d.add);
  const hash = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  for await (const piece of createReadStream(path, { highWaterMark: readBytes })) {
    hash.update(piece);
    splitter.push(decoder.decode(piece, { stream: true }));
  }
  splitter.push(decoder.decode());
  const { error } = splitter.end();
  if (error) return { error };
  return { ...d.result(), sha256: hash.digest('hex') };
}

export async function buildManifest(sqlPath, { key, db, exportedAt, bookmark = null, readBytes } = {}) {
  const d = await describeFile(sqlPath, { readBytes });
  if (d.error) throw new Error(`the export could not be read as SQL: ${d.error}`);
  return {
    version: MANIFEST_VERSION,
    key, database: db,
    exported_at: exportedAt,
    time_travel_bookmark: bookmark || null,
    size_bytes: statSync(sqlPath).size,
    sha256: d.sha256,
    statements: d.statements,
    tables: d.tables,
    migrations: d.migrations,
  };
}

const SHA = /^[0-9a-f]{64}$/;
export function manifestShapeOk(m) {
  return !!m && m.version === MANIFEST_VERSION && typeof m.key === 'string' && SHA.test(m.sha256 ?? '')
    && Number.isSafeInteger(m.size_bytes) && m.size_bytes >= 0 && !Number.isNaN(Date.parse(m.exported_at ?? ''))
    && Array.isArray(m.tables) && m.tables.every((t) => t && typeof t.name === 'string' && Number.isSafeInteger(t.rows))
    && m.migrations && (m.migrations.last === null || typeof m.migrations.last === 'string');
}

/** The first reason the backup at `sqlPath` is not the one `manifest` vouches for; null when it is. */
export async function verifyBackup(sqlPath, manifest, { key, migrationsDir, maxAgeHours = DEFAULT_MAX_AGE_HOURS, now = new Date() }) {
  if (!manifestShapeOk(manifest)) return 'manifest_invalid';
  if (manifest.key !== key) return 'key_mismatch';
  if (statSync(sqlPath).size !== manifest.size_bytes) return 'size_mismatch';
  if (await sha256File(sqlPath) !== manifest.sha256) return 'sha256_mismatch';
  if (now.getTime() - Date.parse(manifest.exported_at) > maxAgeHours * 3_600_000) return 'stale';
  const last = manifest.migrations.last;
  if (last !== null && !(MIGRATION_FILE.test(last) && existsSync(join(migrationsDir, last)))) return 'migration_unknown';
  return null;
}

/** The tables whose restored count differs from the manifest's, or that were not counted at all. */
export function compareCounts(manifest, counts) {
  const got = new Map((Array.isArray(counts) ? counts : []).map((c) => [String(c?.t), Number(c?.n)]));
  return countedTables(manifest).filter((t) => got.get(t.name) !== t.rows).map((t) => t.name);
}

/** The tables one import chunk writes. */
export function chunkTables(sql) {
  const { statements } = splitStatements(sql);
  const out = new Set();
  for (const s of statements ?? []) { const i = RE_INSERT.exec(s); if (i && !internal(unquote(i[1]))) out.add(unquote(i[1])); }
  return [...out].sort();
}

function flag(argv, name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

async function main(argv) {
  const [cmd, a, b] = argv;
  try {
    if (cmd === 'build') {
      const m = await buildManifest(a, { key: flag(argv, '--key'), db: flag(argv, '--db'), exportedAt: flag(argv, '--exported-at'), bookmark: flag(argv, '--bookmark') });
      if (!manifestShapeOk(m)) { console.error('d1-backup-manifest: the manifest built is not well-formed'); return 1; }
      writeFileSync(b, `${JSON.stringify(m, null, 2)}\n`);
      const rows = m.tables.reduce((n, t) => n + t.rows, 0);
      console.log(`manifest: ${m.size_bytes} bytes, sha256 ${m.sha256}, ${m.tables.length} tables, ${rows} rows, last migration ${m.migrations.last ?? 'none recorded'}`);
      return 0;
    }
    if (cmd === 'verify') {
      let manifest = null;
      try { manifest = JSON.parse(readFileSync(b, 'utf8')); } catch { manifest = null; }
      const reason = await verifyBackup(a, manifest, {
        key: flag(argv, '--key'), migrationsDir: flag(argv, '--migrations'),
        maxAgeHours: Number(flag(argv, '--max-age-hours', DEFAULT_MAX_AGE_HOURS)), now: new Date(flag(argv, '--now') ?? Date.now()),
      });
      if (reason) { console.log(`reason=${reason}`); return 1; }
      const ageH = ((Date.now() - Date.parse(manifest.exported_at)) / 3_600_000).toFixed(1);
      console.log(`verified: sha256 and size match; exported ${manifest.exported_at} (${ageH} h ago); last migration ${manifest.migrations.last ?? 'none recorded'}`);
      return 0;
    }
    if (cmd === 'compare') {
      const manifest = JSON.parse(readFileSync(a, 'utf8'));
      const differ = compareCounts(manifest, JSON.parse(readFileSync(b, 'utf8')));
      const n = countedTables(manifest).length;
      const out = flag(argv, '--names-out');
      if (out) writeFileSync(out, `${JSON.stringify(differ)}\n`);
      if (differ.length) { console.log(`row counts differ in ${differ.length} of ${n} tables: ${differ.join(', ')}`); return 1; }
      console.log(`row counts match in all ${n} tables`);
      return 0;
    }
    if (cmd === 'describe') {
      const c = await createdTablesFile(a);
      if (c.error) { console.error(`d1-backup-manifest: the export could not be read as SQL at offset ${c.error.offset}`); return 1; }
      console.log(JSON.stringify(c));
      return 0;
    }
    if (cmd === 'tables') {
      const manifest = JSON.parse(readFileSync(a, 'utf8'));
      const created = await createdTablesFile(b);
      if (created.error) { console.log('reason=export_unreadable'); return 1; }
      const answer = JSON.parse(readFileSync(argv[3], 'utf8'));
      const restored = Array.isArray(answer) ? answer.flatMap((r) => r?.results ?? []) : [];
      const r = compareTableSets(manifest, created, restored);
      const out = flag(argv, '--out');
      if (out) writeFileSync(out, `${JSON.stringify(r)}\n`);
      const tableCount = restored.filter((x) => x?.type === 'table').length;
      console.log(`table sets: manifest ${manifest.tables.length} (${r.engine.length} engine-owned), export creates ${created.tables.length + created.virtual.length}, restore holds ${tableCount}`);
      for (const e of r.engine) console.log(`engine-owned: ${e.name} (${e.handled})`);
      if (r.not_created.length) console.log(`manifest tables the export never creates: ${r.not_created.join(', ')}`);
      for (const m of r.missing) console.log(`missing: ${m.name} (kind: ${m.kind})`);
      for (const x of r.extra) console.log(`extra: ${x.name} (kind: ${x.kind})`);
      if (r.differs) { console.log('reason=table_set_differs'); return 1; }
      console.log('table sets agree');
      return 0;
    }
    if (cmd === 'chunk-tables') {
      const tables = chunkTables(readFileSync(a, 'utf8'));
      let parents = [];
      if (b && existsSync(b)) {
        try {
          const m = JSON.parse(readFileSync(b, 'utf8'));
          const byName = new Map(m.tables.map((t) => [t.name, t.references ?? []]));
          parents = [...new Set(tables.flatMap((t) => byName.get(t) ?? []))].sort();
        } catch { parents = []; }
      }
      console.log(`tables: ${tables.join(', ') || 'none'}; their parents: ${parents.join(', ') || 'none'}`);
      return 0;
    }
  } catch (e) {
    console.error(`d1-backup-manifest: ${e?.message ?? e}`);
    return 1;
  }
  console.error('usage: d1-backup-manifest.mjs build|verify|compare|chunk-tables|describe|tables …');
  return 64;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
