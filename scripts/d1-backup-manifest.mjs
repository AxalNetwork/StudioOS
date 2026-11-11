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
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { splitStatements } from './dr-drill-split.mjs';

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

/** Streamed, so a 270 MB export is never hashed from one string. */
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

/** The schema and counts of one export. Names and numbers only. */
export function describe(sql) {
  const { statements, error } = splitStatements(sql);
  if (error) return { error };
  const rows = new Map();
  const refs = new Map();
  const migrations = [];
  for (const s of statements) {
    const c = RE_CREATE_TABLE.exec(s);
    if (c) {
      const t = unquote(c[1]);
      if (internal(t)) continue;
      if (!rows.has(t)) rows.set(t, 0);
      const parents = new Set();
      for (const r of s.matchAll(RE_REFS)) { const p = unquote(r[1]); if (p !== t) parents.add(p); }
      refs.set(t, [...parents].sort());
      continue;
    }
    const i = RE_INSERT.exec(s);
    if (i) {
      const t = unquote(i[1]);
      if (internal(t)) continue;
      rows.set(t, (rows.get(t) ?? 0) + 1);
      if (t === LEDGER) { const f = literals(s).find((v) => MIGRATION_FILE.test(v)); if (f) migrations.push(f); }
    }
  }
  migrations.sort(migrationOrder);
  const tables = [...rows.keys()].sort();
  return {
    statements: statements.length,
    tables: tables.map((name) => ({ name, rows: rows.get(name), references: refs.get(name) ?? [] })),
    migrations: { ledger: LEDGER, count: migrations.length, last: migrations.at(-1) ?? null },
  };
}

export async function buildManifest(sqlPath, { key, db, exportedAt, bookmark = null }) {
  const sql = readFileSync(sqlPath, 'utf8');
  const d = describe(sql);
  if (d.error) throw new Error(`the export could not be read as SQL: ${d.error}`);
  return {
    version: MANIFEST_VERSION,
    key, database: db,
    exported_at: exportedAt,
    time_travel_bookmark: bookmark || null,
    size_bytes: statSync(sqlPath).size,
    sha256: await sha256File(sqlPath),
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
  return manifest.tables.filter((t) => got.get(t.name) !== t.rows).map((t) => t.name);
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
      if (differ.length) { console.log(`row counts differ in ${differ.length} of ${manifest.tables.length} tables: ${differ.join(', ')}`); return 1; }
      console.log(`row counts match in all ${manifest.tables.length} tables`);
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
  console.error('usage: d1-backup-manifest.mjs build|verify|compare|chunk-tables …');
  return 64;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
