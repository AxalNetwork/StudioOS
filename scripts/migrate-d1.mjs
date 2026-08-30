#!/usr/bin/env node
// Task #9 — Auto-apply D1 migrations on deploy.
//
// A forward-only migration runner with a ledger, driven through
// `wrangler d1 execute`. It enumerates cloudflare-worker/sql/migrations/*.sql in
// numeric order, consults a `schema_migrations` ledger table for what has
// already been applied, applies only the pending files, and records each on
// success. A failure aborts loudly (non-zero exit) naming the offending file —
// the project's "explicit error handling over silent fallbacks" rule.
//
// Wired into `npm run deploy` via the `predeploy` hook so the new Worker never
// starts against an old schema.
//
// Usage:
//   node scripts/migrate-d1.mjs --local            # local dev D1 (miniflare)
//   node scripts/migrate-d1.mjs --remote           # prod D1 (studioos-db)
//   node scripts/migrate-d1.mjs --preview          # preview env D1
//   node scripts/migrate-d1.mjs --remote --baseline  # one-time adoption (see below)
//   node scripts/migrate-d1.mjs --audit            # idempotency audit only (no DB)
//   node scripts/migrate-d1.mjs --remote --dry-run # show the plan, touch nothing
//
// Baseline (one-time, for the existing hand-migrated prod DB):
//   Because prod already has ~124 migrations applied by hand with no ledger,
//   the first automated run must NOT blindly replay everything — the historical
//   `ALTER TABLE ... ADD COLUMN` deltas would fail with "duplicate column"
//   against the already-current schema. `--baseline` applies the idempotent
//   pending files (real apply for the genuinely-pending ones, harmless no-op for
//   the rest) and RECORDS the non-idempotent ones without executing them, while
//   printing exactly which were marked so they can be verified by hand. Run it
//   ONCE per environment; afterwards plain (non-baseline) runs apply only new
//   migrations.
//
// Wrangler needs Node 22+ (same as the manual `wrangler d1 execute` commands).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEDGER_TABLE,
  LEDGER_DDL,
  listMigrationFiles,
  auditMigrations,
  classifyIdempotency,
  planActions,
  applyPlan,
  needsBaseline,
  sqlQuote,
} from './lib/migrationPlan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = path.join(ROOT, 'cloudflare-worker');
const MIGRATIONS_DIR = path.join(WORKER_DIR, 'sql', 'migrations');

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

const MODE_AUDIT = has('--audit');
const MODE_DRY_RUN = has('--dry-run');
const MODE_BASELINE = has('--baseline');

// Target selection. local = miniflare D1; remote = prod; preview = preview env.
function resolveTarget() {
  if (has('--local')) {
    return { label: 'local', dbName: 'studioos-db', flags: ['--local'] };
  }
  if (has('--preview')) {
    return {
      label: 'preview',
      dbName: 'studioos-db-preview',
      flags: ['--env', 'preview', '--remote'],
    };
  }
  if (has('--remote')) {
    return { label: 'remote (prod)', dbName: 'studioos-db', flags: ['--remote'] };
  }
  return null;
}

function fail(msg) {
  console.error(`\u2716 [migrate-d1] ${msg}`);
  process.exit(1);
}

// Run a wrangler d1 execute. `opts.command` runs inline SQL; `opts.file` runs a
// .sql file. Returns parsed JSON results when `opts.json` is set. Throws (with
// wrangler's stderr) on a non-zero exit so callers can surface, not swallow it.
function wrangler(target, opts) {
  const args = [
    'wrangler',
    'd1',
    'execute',
    target.dbName,
    '--config',
    '../wrangler.toml',
    ...target.flags,
  ];
  if (opts.json) args.push('--json');
  if (opts.command != null) args.push('--command', opts.command);
  if (opts.file != null) args.push('--file', opts.file);

  const res = spawnSync('npx', args, {
    cwd: WORKER_DIR,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    const err = new Error(
      `wrangler exited ${res.status}\n${(res.stderr || res.stdout || '').trim()}`,
    );
    err.stderr = res.stderr;
    throw err;
  }
  if (opts.json) {
    // wrangler prints `[{ results: [...], success, meta }]`.
    const parsed = JSON.parse(res.stdout);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return first?.results ?? [];
  }
  return res.stdout;
}

function printAudit(files) {
  const { report, unsafe, total, safe } = auditMigrations(files);
  console.log(`[migrate-d1] Idempotency audit of ${total} migration(s):`);
  console.log(`  safe to replay (idempotent): ${safe}`);
  console.log(`  NOT safe to replay:          ${unsafe.length}`);
  if (unsafe.length) {
    console.log(
      '\n  The following files are NOT safely re-runnable. On a baseline run\n' +
        '  they are RECORDED WITHOUT EXECUTING (their effect is assumed already\n' +
        '  present). Verify each is truly applied to the target DB:',
    );
    for (const r of unsafe) {
      console.log(`    - ${r.name}: ${r.reasons.join('; ')}`);
    }
  }
  return { report, unsafe };
}

function main() {
  const files = listMigrationFiles(MIGRATIONS_DIR);
  if (files.length === 0) fail(`no migrations found in ${MIGRATIONS_DIR}`);

  // --audit: report only, no DB access. Always exits 0 (it is a report, not a
  // gate); the unsafe list is informational for baseline planning.
  if (MODE_AUDIT) {
    printAudit(files);
    return;
  }

  const target = resolveTarget();
  if (!target) {
    fail(
      'no target selected. Pass one of --local | --remote | --preview ' +
        '(or --audit for an idempotency report).',
    );
  }

  if (MODE_DRY_RUN) {
    // READS the live ledger. This used to plan against `new Map()` and print
    // "assuming an empty ledger", which listed every migration ever written no
    // matter what the target had applied — useless as the pre-deploy gate the
    // runbook points operators at, and alarming enough that one correctly
    // refused to deploy on it.
    //
    // Read-only on purpose: the live run creates the ledger before reading it,
    // and a dry run must not write. So a missing ledger table is reported as an
    // empty ledger rather than created. Every OTHER wrangler failure is
    // rethrown — a connection or auth error must never be reported as
    // "nothing has been applied", which is the one lie that would send someone
    // into an unnecessary --baseline.
    console.log(`[migrate-d1] DRY RUN against ${target.label} — reads only, nothing written.`);
    printAudit(files);

    const dryTableRows = wrangler(target, {
      json: true,
      command:
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' " +
        `AND name NOT LIKE 'sqlite_%' AND name <> ${sqlQuote(LEDGER_TABLE)}`,
    });
    const dryTableCount = Number(dryTableRows[0]?.n ?? 0);

    let dryApplied = new Map();
    let ledgerMissing = false;
    try {
      const rows = wrangler(target, {
        json: true,
        command: `SELECT filename, checksum FROM ${LEDGER_TABLE}`,
      });
      dryApplied = new Map(rows.map((r) => [r.filename, r.checksum]));
    } catch (e) {
      if (/no such table/i.test(String(e?.message ?? ''))) ledgerMissing = true;
      else throw e;
    }

    const dryMode = MODE_BASELINE ? 'baseline' : 'apply';
    const dryActions = planActions(files, dryApplied, { mode: dryMode });
    const dryPending = dryActions.filter((a) => a.action !== 'skip');

    console.log(
      `\n[migrate-d1] ${target.label}: ${files.length} migration(s), ` +
        `${dryApplied.size} already applied, ${dryPending.length} pending ` +
        `(mode=${dryMode}).`,
    );
    if (ledgerMissing) {
      console.log(
        `  NOTE: ${LEDGER_TABLE} does not exist on this target yet. The live ` +
          'run creates it; a dry run will not.',
      );
    }
    if (needsBaseline({ mode: dryMode, appliedCount: dryApplied.size, appTableCount: dryTableCount })) {
      console.log(
        `\n\u26a0 ${target.label} has ${dryTableCount} table(s) but an empty ledger.\n` +
          '  A live run in apply mode would REFUSE rather than replay history.\n' +
          '  The one-time fix is a single --baseline run; see documentation/operations/DEPLOY.md.',
      );
    }

    console.log('\n[migrate-d1] Plan:');
    for (const a of dryActions) console.log(`  ${a.action.padEnd(5)} ${a.file.name}`);
    return;
  }

  // --- Live run: ensure ledger, read applied set, plan, execute. ---

  // Does the DB already hold application tables (i.e. it is NOT a fresh DB)?
  const appTableRows = wrangler(target, {
    json: true,
    command:
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' " +
      `AND name NOT LIKE 'sqlite_%' AND name <> ${sqlQuote(LEDGER_TABLE)}`,
  });
  const appTableCount = Number(appTableRows[0]?.n ?? 0);

  // Create the ledger (idempotent). Safe to do before the guard because the
  // guard keys on ledger EMPTINESS, not on whether it pre-existed — so an empty
  // ledger left behind by an earlier aborted run still trips the guard below.
  wrangler(target, { command: LEDGER_DDL });

  // Read the applied ledger into a name->checksum map.
  const applied = wrangler(target, {
    json: true,
    command: `SELECT filename, checksum FROM ${LEDGER_TABLE}`,
  });
  const appliedSet = new Map(applied.map((r) => [r.filename, r.checksum]));

  // Safety guard: an existing DB with an EMPTY ledger means migrations were
  // applied by hand and we must not auto-replay historical (non-idempotent)
  // deltas. Refuse in normal apply mode and point the operator at --baseline.
  if (needsBaseline({ mode: MODE_BASELINE ? 'baseline' : 'apply', appliedCount: appliedSet.size, appTableCount })) {
    fail(
      `target ${target.label} has ${appTableCount} existing table(s) but an ` +
        `empty migration ledger.\n` +
        '  This database was migrated by hand. Replaying historical migrations ' +
        'would fail\n' +
        '  on non-idempotent deltas (e.g. ALTER TABLE ADD COLUMN). Run the ' +
        'one-time baseline\n' +
        `  first:  node scripts/migrate-d1.mjs ${argv.filter((a) => a.startsWith('--')).join(' ')} --baseline\n` +
        '  (Baseline applies pending idempotent files and records the rest. See ' +
        'the header of this script.)',
    );
  }

  // Warn (do not auto-fix) if a previously-applied file changed on disk.
  for (const f of files) {
    const known = appliedSet.get(f.name);
    if (known != null && known !== f.checksum) {
      console.warn(
        `\u26a0 [migrate-d1] ${f.name} was modified after it was applied ` +
          '(checksum drift). Forward-only runner will NOT re-run it.',
      );
    }
  }

  const mode = MODE_BASELINE ? 'baseline' : 'apply';
  const actions = planActions(files, appliedSet, { mode });
  const pending = actions.filter((a) => a.action !== 'skip');

  console.log(
    `[migrate-d1] ${target.label}: ${files.length} migration(s), ` +
      `${appliedSet.size} already applied, ${pending.length} pending ` +
      `(mode=${mode}).`,
  );

  if (pending.length === 0) {
    console.log('[migrate-d1] \u2713 Nothing to do — schema is up to date.');
    return;
  }

  if (MODE_BASELINE) printAudit(files);

  const exec = (file) => {
    console.log(`[migrate-d1]   applying ${file.name} ...`);
    wrangler(target, { file: `sql/migrations/${file.name}` });
  };
  const record = (file) => {
    const action = MODE_BASELINE && !classifyIdempotency(file.sql).idempotent ? 'marked (not executed)' : 'applied';
    wrangler(target, {
      command:
        `INSERT OR REPLACE INTO ${LEDGER_TABLE} (filename, checksum, applied_at) ` +
        `VALUES (${sqlQuote(file.name)}, ${sqlQuote(file.checksum)}, datetime('now'))`,
    });
    console.log(`[migrate-d1]   ${action}: ${file.name}`);
  };

  const result = applyPlan(actions, { exec, record });

  if (result.failure) {
    const { file, error, phase } = result.failure;
    const what =
      phase === 'record-after-apply'
        ? `applied OK but FAILED to record in the ledger: ${file.name}`
        : phase === 'record'
          ? `failed to record (baseline mark): ${file.name}`
          : `migration FAILED: ${file.name}`;
    console.error(`\u2716 [migrate-d1] ${what}\n${(error && error.message) || error}`);
    if (phase === 'record-after-apply') {
      console.error(
        `[migrate-d1] The SQL ran but the ledger row was not written. Insert it ` +
          `by hand, then re-run:\n` +
          `  INSERT OR REPLACE INTO ${LEDGER_TABLE} (filename, checksum, applied_at) ` +
          `VALUES (${sqlQuote(file.name)}, ${sqlQuote(file.checksum)}, datetime('now'));`,
      );
    }
    console.error(
      `[migrate-d1] ${result.applied.length} migration(s) applied before the ` +
        'failure are recorded in the ledger and will not be retried. Fix the ' +
        'issue and re-run.',
    );
    process.exit(1);
  }

  console.log(
    `[migrate-d1] \u2713 Done. applied=${result.applied.length} ` +
      `marked=${result.marked.length} skipped=${result.skipped.length}.`,
  );
  if (result.marked.length) {
    console.log(
      '[migrate-d1] \u26a0 The following non-idempotent files were RECORDED ' +
        'WITHOUT EXECUTING (baseline). Verify each is truly applied:',
    );
    for (const a of result.marked) console.log(`    - ${a.file.name}`);
  }
}

main();
