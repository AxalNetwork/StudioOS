#!/usr/bin/env node
/**
 * #4591 — the hosted schema rehearsal: provision a throwaway D1 from the
 * committed files, seed synthetic fixtures, export it, restore it into a
 * second throwaway D1, and compare. Both databases are deleted when it ends,
 * pass or fail. Run by `.github/workflows/schema-rehearsal.yml` (dispatch only).
 *
 *   node scripts/schema-rehearsal.mjs --run <id> [--summary out.json]
 *   node scripts/schema-rehearsal.mjs --run <id> --local [--summary out.json]
 *
 * `--local` runs every step against wrangler's local D1 (no account, nothing
 * created or deleted remotely), to prove the script before a hosted run. Its
 * result is a LOCAL rehearsal and is never reported as a hosted one.
 *
 * WHAT IT REUSES rather than re-implements, so it rehearses the real paths:
 *   provisioning  `migrate-d1.mjs --rehearsal <id> --bootstrap`, then a plain
 *                 run and `--dry-run` (as `branch-provision.yml` does a branch)
 *   parity        `check-baseline-drift.mjs`'s own fresh build and comparisons
 *   fixtures      #4566's `seedStatements` / `toSqlFile` (synthetic.invalid only)
 *   restore       D4558's drill import: `dr-drill-split.mjs`, one chunk per execute
 *
 * NEVER PRODUCTION. Every database name it touches is built by
 * `rehearsalNames()` (prefix `studioos-rehearsal-`), and every wrangler call
 * names the generated config that declares that one database and nothing else.
 * The log, the step summary and the artifact hold names, counts and verdicts
 * only; wrangler output that could quote SQL is withheld.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  rehearsalNames, createdDatabaseId, rehearsalConfig, schemaMap, rowCountQueries, countMap,
  compareRestore, FIXTURE_TABLES,
} from './lib/schemaRehearsal.mjs';
import { rehearsalConfigPath } from './lib/migrationTargets.mjs';
import {
  postCutoffMigrations, buildFresh, objectNames, columnsOf, columnsFromDdl, compareObjects, compareColumns,
} from './check-baseline-drift.mjs';
import { seedStatements, toSqlFile } from './lib/agentSyntheticFixtures.mjs';

const ROOT = process.cwd();
const BASELINE = 'cloudflare-worker/sql/schema_baseline.sql';
const WORKER = resolve(ROOT, 'cloudflare-worker');
const args = process.argv.slice(2);
const value = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const LOCAL = args.includes('--local');
const SUMMARY = value('--summary');
const CHUNK_BYTES = Number(process.env.REHEARSAL_CHUNK_BYTES || 1_000_000);

const log = (m) => console.log(`[schema-rehearsal] ${m}`);
const names = rehearsalNames(value('--run'));
const TMP = mkdtempSync(join(tmpdir(), `rehearsal-${names.run}-`));
const created = [];
const summary = {
  issue: 4591, run: names.run, mode: LOCAL ? 'local' : 'hosted', commit: process.env.GITHUB_SHA || null,
  started_at: new Date().toISOString(), steps: {}, verdict: 'fail', reason: null,
};

/** One wrangler call against one rehearsal database; output is returned, never printed. */
function wrangler(side, rest, { json = false } = {}) {
  const a = ['--no-install', 'wrangler', 'd1', ...rest.slice(0, 1), side.dbName, ...rest.slice(1),
    '--config', rehearsalConfigPath(side.id), LOCAL ? '--local' : '--remote'];
  if (json) a.push('--json');
  const r = spawnSync('npx', a, { cwd: WORKER, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) {
    // A D1 error can quote the statement it failed on; print its codes only.
    const codes = [...new Set(`${r.stdout}\n${r.stderr}`.match(/D1_[A-Z_]+|SQLITE_[A-Z_]+|Authentication error|not found/g) || [])].join(' ');
    throw new Error(`wrangler d1 ${rest[0]} on ${side.dbName} failed (${codes || 'no recognised code; output withheld'})`);
  }
  if (!json) return r.stdout;
  const parsed = JSON.parse(r.stdout);
  return (Array.isArray(parsed) ? parsed[0] : parsed)?.results ?? [];
}
const query = (side, sql) => wrangler(side, ['execute', '--command', sql], { json: true });
const countAll = (side, tables) => countMap(rowCountQueries(tables).flatMap((q) => query(side, q)));

/** Create one side: remotely an EU database; locally only its config (a fixed local id). */
function create(side) {
  let databaseId;
  if (LOCAL) {
    // A fresh id per run, so a local run never lands on an earlier one's state
    // (wrangler keeps local D1 under its gitignored .wrangler/ directory).
    databaseId = randomUUID();
  } else {
    const r = spawnSync('npx', ['--no-install', 'wrangler', 'd1', 'create', side.dbName, '--jurisdiction', 'eu'],
      { cwd: WORKER, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`could not create ${side.dbName}`);
    created.push(side);
    databaseId = createdDatabaseId(r.stdout);
  }
  writeFileSync(resolve(ROOT, `wrangler.rehearsal.${side.id}.toml`), rehearsalConfig({ dbName: side.dbName, databaseId }));
  log(`created ${side.dbName}${LOCAL ? ' (local)' : ' (EU)'}`);
}

function migrate(side, ...flags) {
  const r = spawnSync('node', ['scripts/migrate-d1.mjs', '--rehearsal', side.id, ...(LOCAL ? ['--local'] : []), ...flags],
    { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`migrate-d1 ${flags.join(' ') || '(apply)'} failed on ${side.dbName}`);
  return r.stdout;
}

/** A side as compared: its objects and every table's row count. */
function snapshot(side) {
  const rows = query(side, "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index','view','trigger')");
  const schema = schemaMap(rows);
  const tables = rows.filter((r) => r.type === 'table' && !/^(_cf_|sqlite_)/.test(r.name)).map((r) => r.name);
  return { rows, schema, counts: countAll(side, tables) };
}

function step(name, fn) {
  const t0 = Date.now();
  try {
    const result = fn();
    summary.steps[name] = { ok: true, ms: Date.now() - t0, ...(result || {}) };
    log(`✓ ${name}`);
  } catch (e) {
    summary.steps[name] = { ok: false, ms: Date.now() - t0 };
    summary.reason = `${name}: ${e.message}`;
    throw e;
  }
}

function cleanup() {
  for (const side of [names.src, names.dst]) {
    const cfg = resolve(ROOT, `wrangler.rehearsal.${side.id}.toml`);
    if (!LOCAL && created.includes(side)) {
      const r = spawnSync('npx', ['--no-install', 'wrangler', 'd1', 'delete', side.dbName, '--skip-confirmation'],
        { cwd: WORKER, encoding: 'utf8' });
      summary.deleted = [...(summary.deleted || []), { db: side.dbName, ok: r.status === 0 }];
      log(r.status === 0 ? `deleted ${side.dbName}` : `WARN: could not delete ${side.dbName}; delete it by hand`);
    }
    if (existsSync(cfg)) rmSync(cfg);
  }
  rmSync(TMP, { recursive: true, force: true });
}

try {
  step('create_source', () => create(names.src));

  step('provision_source', () => {
    migrate(names.src, '--bootstrap');
    migrate(names.src);
    const plan = migrate(names.src, '--dry-run');
    const pending = Number((plan.match(/(\d+) pending/) || [])[1]);
    if (pending !== 0) throw new Error(`the dry run after provisioning reports ${Number.isNaN(pending) ? 'no count' : pending} pending`);
    return { pending_after: 0 };
  });

  step('parity_with_committed_files', () => {
    const fresh = buildFresh(readFileSync(resolve(ROOT, BASELINE), 'utf8'), postCutoffMigrations(ROOT).map((m) => m.sql));
    const live = query(names.src, "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table','index','trigger','view')")
      .filter((r) => !/^(_cf_[A-Z]|sqlite_)/.test(r.name));
    const objects = compareObjects(objectNames(fresh), new Set(live.map((r) => `${r.type}:${r.name}`)));
    const { columns, unreadable } = columnsFromDdl(live);
    const cols = compareColumns(columnsOf(fresh), columns);
    const counts = { objects: live.length, missing: objects.missing.length, extra: objects.extra.length,
      column_differences: cols.missing.length + cols.extra.length + cols.retyped.length, unreadable: unreadable.length };
    if (!objects.ok || !cols.ok || unreadable.length) {
      throw new Error(`hosted provisioning differs from the committed files: ${JSON.stringify({ ...counts,
        missing_names: objects.missing.slice(0, 20), extra_names: objects.extra.slice(0, 20) })}`);
    }
    return counts;
  });

  step('seed_synthetic_fixtures', () => {
    const file = join(TMP, 'seed.sql');
    writeFileSync(file, toSqlFile(seedStatements({ run: names.run, tenants: 2, agentsPerTenant: 2, tasksPerAgent: 2 })));
    wrangler(names.src, ['execute', '--file', file]);
    const counts = countAll(names.src, FIXTURE_TABLES);
    for (const t of FIXTURE_TABLES) if (!(counts.get(t) > 0)) throw new Error(`fixtures wrote no rows to ${t}`);
    const fk = query(names.src, 'PRAGMA foreign_key_check');
    if (fk.length) throw new Error(`${fk.length} foreign-key violation(s) after seeding`);
    return { rows: Object.fromEntries(counts) };
  });

  let source;
  step('export_source', () => {
    source = snapshot(names.src);
    wrangler(names.src, ['export', '--output', join(TMP, 'export.sql')]);
    return { objects: source.schema.size, tables: source.counts.size, rows: [...source.counts.values()].reduce((a, b) => a + b, 0) };
  });

  step('create_target', () => create(names.dst));

  step('restore_through_drill_import', () => {
    const chunks = join(TMP, 'chunks');
    const split = spawnSync('node', ['scripts/dr-drill-split.mjs', join(TMP, 'export.sql'), chunks, String(CHUNK_BYTES)],
      { cwd: ROOT, encoding: 'utf8' });
    if (split.status !== 0) throw new Error('could not split the export into import chunks');
    const manifest = readFileSync(join(chunks, 'manifest.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
    manifest.forEach(([file, phase], k) => {
      try { wrangler(names.dst, ['execute', '--file', file]); } catch (e) {
        throw new Error(`chunk ${k + 1}/${manifest.length} (${phase}): ${e.message}`);
      }
    });
    return { chunks: manifest.length, split: split.stdout.trim() };
  });

  step('compare_restore', () => {
    const restored = snapshot(names.dst);
    const cmp = compareRestore(source, restored);
    const fk = query(names.dst, 'PRAGMA foreign_key_check');
    if (!cmp.ok || fk.length) {
      throw new Error(`restored database differs: ${JSON.stringify({ missing: cmp.missing.slice(0, 20), extra: cmp.extra.slice(0, 20),
        sql_differs: cmp.sqlDiffers.slice(0, 20), count_differs: cmp.countDiffers.slice(0, 20), fk_violations: fk.length })}`);
    }
    return { objects: restored.schema.size, tables: restored.counts.size, fk_violations: 0 };
  });

  summary.verdict = 'pass';
} catch (e) {
  summary.reason ||= e.message;
  log(`FAIL: ${summary.reason}`);
} finally {
  try { cleanup(); } catch (e) { log(`WARN: cleanup: ${e.message}`); }
  summary.finished_at = new Date().toISOString();
  if (SUMMARY) writeFileSync(SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
  log(`verdict: ${summary.verdict} (${summary.mode})`);
  if (!LOCAL && summary.deleted?.some((d) => !d.ok)) process.exitCode = 1;
  if (summary.verdict !== 'pass') process.exitCode = 1;
}
