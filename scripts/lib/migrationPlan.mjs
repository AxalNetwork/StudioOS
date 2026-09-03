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

// Where a foreign-shaped ledger goes when the operator adopts it. Renamed, not
// dropped: its rows are the only record of whatever wrote them.
export const LEGACY_LEDGER_TABLE = 'schema_migrations_legacy';

/**
 * Does an existing `schema_migrations` table have the shape this runner reads?
 *
 * Production was found (2026-09-03) holding a `schema_migrations` with columns
 * `name, applied_at` and four rows nothing in this repository wrote. Against
 * that table `CREATE TABLE IF NOT EXISTS` is a silent no-op and the very next
 * statement, `SELECT filename, checksum`, fails with "no such column" — so a
 * plain run, a dry run and a baseline all died before touching anything, and
 * every migration after the last hand-apply stayed unapplied while looking
 * merely "pending". A runner that cannot read its ledger must say exactly that
 * rather than report a generic SQL error.
 *
 * @param {string[]} columns the names from `PRAGMA table_info(schema_migrations)`;
 *   an empty list means the table does not exist, which is not a problem.
 * @returns {string|null} a message naming the shape found, or null when fine
 */
export function ledgerShapeProblem(columns) {
  const names = (columns || []).map((c) => String(c).toLowerCase());
  if (names.length === 0) return null;
  if (names.includes('filename') && names.includes('checksum')) return null;
  return (
    `${LEDGER_TABLE} exists but is not this runner's ledger: it has columns ` +
    `(${names.join(', ')}) and no \`filename\`/\`checksum\`. Nothing in this ` +
    'repository creates that shape. The runner will not read or write it.'
  );
}

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

/**
 * What a migration file leaves behind that can be CHECKED: the tables it
 * creates and the columns it adds. Statements are read in order so the rebuild
 * idiom resolves correctly — `CREATE t_new … DROP t … ALTER t_new RENAME TO t`
 * leaves `t`, not `t_new` — and a temporary table the file itself drops leaves
 * nothing. INSERT-only files have no checkable effect and are reported as such.
 *
 * @returns {{ tables: string[], columns: Array<[string, string]> }}
 */
export function expectedEffects(sql) {
  const body = stripComments(sql);
  const tables = new Set();
  const columns = [];
  const re =
    /\b(?:CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)|ALTER\s+TABLE\s+[`"[]?(\w+)[`"\]]?\s+RENAME\s+TO\s+[`"[]?(\w+)|DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"[]?(\w+)|ALTER\s+TABLE\s+[`"[]?(\w+)[`"\]]?\s+ADD\s+(?:COLUMN\s+)?[`"[]?(\w+))/gi;
  for (const m of body.matchAll(re)) {
    const [, created, renameFrom, renameTo, dropped, alterTable, alterColumn] = m;
    if (created) {
      tables.add(created.toLowerCase());
    } else if (renameFrom) {
      const from = renameFrom.toLowerCase();
      const to = renameTo.toLowerCase();
      if (tables.has(from)) { tables.delete(from); tables.add(to); }
      for (const pair of columns) if (pair[0] === from) pair[0] = to;
    } else if (dropped) {
      tables.delete(dropped.toLowerCase());
    } else if (alterTable) {
      columns.push([alterTable.toLowerCase(), alterColumn.toLowerCase()]);
    }
  }
  return { tables: [...tables], columns };
}

/**
 * Check every ledgered file against the live schema.
 *
 * A baseline RECORDS non-idempotent files without executing them, on the
 * assumption their effect is already present from the hand-applies. When it is
 * not — the 2026-07-08 baseline marked 139–145 whose effects were absent — the
 * ledger claims a column that does not exist, the code reads it, and the page
 * 500s. `documentation/architecture/GOTCHAS.md` §Migrations prescribes the fix:
 * check each marked file's indicator, delete the ledger row for the truly
 * missing ones, re-run. This is that check, injectable so it runs against a
 * real SQLite in the test and against wrangler in the CLI.
 *
 * Files whose effects are all present are `verified`; files with a missing
 * table or column are `missing` (with the gaps named); files with nothing
 * checkable are `unverifiable` and left alone — a guess would be worse.
 *
 * @param {Array<{name:string, sql:string}>} files
 * @param {Map<string, string>} appliedSet ledger filename -> checksum
 * @param {{ tableExists:(t:string)=>boolean, tableColumns:(t:string)=>Set<string> }} probes
 */
export function verifyMarked(files, appliedSet, probes) {
  const verified = [];
  const missing = [];
  const unverifiable = [];
  for (const f of files) {
    if (!appliedSet.has(f.name)) continue;
    const { tables, columns } = expectedEffects(f.sql);
    if (tables.length === 0 && columns.length === 0) {
      unverifiable.push({ file: f, reason: 'no CREATE TABLE or ADD COLUMN to check' });
      continue;
    }
    const gaps = [];
    for (const t of tables) {
      if (!probes.tableExists(t)) gaps.push(`table ${t} is missing`);
    }
    for (const [t, c] of columns) {
      if (!probes.tableExists(t)) { gaps.push(`table ${t} is missing (would hold ${c})`); continue; }
      if (!probes.tableColumns(t).has(c)) gaps.push(`column ${t}.${c} is missing`);
    }
    if (gaps.length) missing.push({ file: f, gaps });
    else verified.push(f);
  }
  return { verified, missing, unverifiable };
}
