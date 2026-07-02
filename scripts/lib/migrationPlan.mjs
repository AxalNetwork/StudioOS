// Task #9 — Pure planning logic for the D1 migration runner.
//
// Kept free of any I/O (no wrangler, no fs side effects beyond reading the
// migration directory) so it can be unit-tested against a real SQLite engine
// (node:sqlite) without needing wrangler/network — the same "extract the pure
// core, drive it from a test" pattern the rest of the worker test-suite uses.
//
// The CLI (scripts/migrate-d1.mjs) injects an `exec`/`record` pair so the very
// same apply loop that ships is the one the test exercises.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Ledger table. filename is the natural primary key; checksum lets us detect a
// migration file that was edited AFTER it was applied (forward-only runners
// must never silently re-run, but they should shout when history changed).
export const LEDGER_TABLE = 'schema_migrations';
export const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
  filename   TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

// Sort key: numeric prefix first (so 9 < 10 < 100), then the full filename as a
// deterministic tiebreak. Tiebreak matters — this repo has duplicate prefixes
// (011_, 068_, 118_ each appear twice); without it their order would be
// undefined and a deploy could apply them in a different order than the last.
export function migrationSortKey(name) {
  const m = /^(\d+)/.exec(name);
  const num = m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  return [num, name];
}

export function compareMigrations(a, b) {
  const [an, as] = migrationSortKey(a);
  const [bn, bs] = migrationSortKey(b);
  if (an !== bn) return an - bn;
  return as < bs ? -1 : as > bs ? 1 : 0;
}

export function checksum(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

// Escape a value for a single-quoted SQL string literal (double any quote).
// wrangler's `--command` takes a raw SQL string with no bind-parameter support,
// so ledger writes must build the literal safely; migration filenames are
// repo-controlled but this keeps a quote-containing name from breaking (or
// injecting) the INSERT.
export function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Should the runner refuse to auto-apply and demand a one-time baseline?
//
// True when this is a normal (non-baseline) run, the ledger is EMPTY, and the
// database already holds application tables — i.e. it was migrated by hand and
// auto-replaying historical (possibly non-idempotent) deltas would be unsafe.
// Keyed on ledger EMPTINESS, not on whether the ledger table pre-existed, so a
// previously-aborted run that left an empty ledger behind still trips the guard.
export function needsBaseline({ mode, appliedCount, appTableCount }) {
  return mode !== 'baseline' && appliedCount === 0 && appTableCount > 0;
}

// Read every *.sql in `dir`, sorted into apply order, with content + checksum.
export function listMigrationFiles(dir) {
  const names = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.sql'))
    .sort(compareMigrations);
  return names.map((name) => {
    const full = path.join(dir, name);
    const sql = fs.readFileSync(full, 'utf8');
    return { name, path: full, sql, checksum: checksum(sql) };
  });
}

// Strip -- line comments and /* */ block comments so the idempotency scan does
// not trip over example DDL written inside a migration's header comment.
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

// Classify a migration as "safely re-runnable" or not. A migration is safe to
// replay only if every statement is guarded (IF NOT EXISTS / INSERT OR
// IGNORE|REPLACE). Anything that errors on a second run — most importantly
// `ALTER TABLE ... ADD COLUMN` (SQLite has no IF NOT EXISTS for columns) —
// makes the file NON-idempotent, which means it must NOT be blindly replayed
// against an existing/baselined database.
export function classifyIdempotency(sql) {
  const body = stripComments(sql);
  const reasons = [];

  if (/\bALTER\s+TABLE\b/i.test(body)) {
    reasons.push('ALTER TABLE (SQLite ADD COLUMN is not re-runnable)');
  }
  if (/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i.test(body)) {
    reasons.push('CREATE TABLE without IF NOT EXISTS');
  }
  if (/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i.test(body)) {
    reasons.push('CREATE INDEX without IF NOT EXISTS');
  }
  if (/\bCREATE\s+(?:TRIGGER|VIEW)\s+(?!IF\s+NOT\s+EXISTS)/i.test(body)) {
    reasons.push('CREATE TRIGGER/VIEW without IF NOT EXISTS');
  }
  if (/\bDROP\s+(?:TABLE|INDEX|TRIGGER|VIEW)\s+(?!IF\s+EXISTS)/i.test(body)) {
    reasons.push('DROP without IF EXISTS');
  }
  if (/\bINSERT\s+(?!OR\s+(?:IGNORE|REPLACE)\b)INTO\b/i.test(body)) {
    reasons.push('INSERT without OR IGNORE/OR REPLACE (may duplicate rows)');
  }

  return { idempotent: reasons.length === 0, reasons };
}

// Produce an audit report over the full set: which files are safe to replay and
// which are not, with the reason(s) for each unsafe one.
export function auditMigrations(files) {
  const report = files.map((f) => ({
    name: f.name,
    ...classifyIdempotency(f.sql),
  }));
  const unsafe = report.filter((r) => !r.idempotent);
  return { report, unsafe, total: files.length, safe: files.length - unsafe.length };
}

// Decide what to do with each file given what the ledger already knows.
//
// mode 'apply'  — normal deploy path: every pending file is executed once, in
//                 order. (A new migration with an ALTER is fine here: it is
//                 being applied for the FIRST time.)
// mode 'baseline' — one-time adoption of an existing, hand-migrated DB: pending
//                 idempotent files are executed (real apply for the genuinely
//                 -pending ones, harmless no-op for the rest), while pending
//                 NON-idempotent files are RECORDED WITHOUT EXECUTING (their
//                 effect is assumed already present from the hand-applies /
//                 schema.sql) and surfaced loudly so the operator can verify.
export function planActions(files, appliedSet, { mode } = { mode: 'apply' }) {
  const actions = [];
  for (const f of files) {
    if (appliedSet.has(f.name)) {
      const wasChecksum = appliedSet.get?.(f.name);
      actions.push({
        file: f,
        action: 'skip',
        changed: wasChecksum != null && wasChecksum !== f.checksum,
      });
      continue;
    }
    if (mode === 'baseline') {
      const { idempotent } = classifyIdempotency(f.sql);
      actions.push({ file: f, action: idempotent ? 'apply' : 'mark' });
    } else {
      actions.push({ file: f, action: 'apply' });
    }
  }
  return actions;
}

// Run a plan. `exec(file)` applies the migration SQL (throws on failure) and
// `record(file)` writes the ledger row (throws on failure). Both are injected
// so the CLI binds them to wrangler and the test binds them to node:sqlite —
// the loop, including the fail-loud-and-abort behaviour, is identical in both.
//
// Errors from exec are NOT swallowed: the first failure aborts and is returned
// in `failure` with the offending file named, so the caller can exit non-zero.
export function applyPlan(actions, { exec, record }) {
  const applied = [];
  const marked = [];
  const skipped = [];
  for (const a of actions) {
    if (a.action === 'skip') {
      skipped.push(a);
      continue;
    }
    if (a.action === 'mark') {
      try {
        record(a.file);
      } catch (err) {
        return { applied, marked, skipped, failure: { file: a.file, error: err, phase: 'record' } };
      }
      marked.push(a);
      continue;
    }
    // action === 'apply'
    try {
      exec(a.file);
    } catch (err) {
      return { applied, marked, skipped, failure: { file: a.file, error: err, phase: 'exec' } };
    }
    // The SQL ran; if recording it fails we must stop and surface it loudly —
    // an applied-but-unrecorded migration would be re-run next time (a no-op for
    // idempotent files, but a duplicate-error for non-idempotent ones). The
    // operator inserts the ledger row by hand, then re-runs.
    try {
      record(a.file);
    } catch (err) {
      return { applied, marked, skipped, failure: { file: a.file, error: err, phase: 'record-after-apply' } };
    }
    applied.push(a);
  }
  return { applied, marked, skipped, failure: null };
}
