// D8532 (#8532): rehearse the window between the release's two writes.
//
// The production release (`cloudflare-worker-deploy.yml`) applies the D1
// migrations and then publishes the Worker. If the publish fails, the OLD
// Worker keeps serving on the NEW schema until a retry or a forward fix lands.
// The rollback classifier (`rollbackClass.mjs`, D7151) reasons about that
// window; this module runs it, locally, over synthetic data:
//
//   1. the base commit's schema (its `schema_baseline.sql` plus its migrations
//      above the cutoff, every file in the `schema_migrations` ledger, as a
//      production that ran the base release holds it), seeded by the BASE
//      Worker: an account with an entitlement, an access grant, a project, a
//      TOTP sign-in, and a hashed asset in the ASSETS stub;
//   2. the candidate's pending migrations, applied the way `migrate-d1.mjs`
//      applies them: the same plan (`planActions`/`applyPlan`), each file as one
//      transaction (D1 rolls a `--file` back on its first error, DEPLOY.md §4c),
//      and a ledger row after each;
//   3. publication stops: the BASE Worker answers the fixed probes on the
//      migrated database, and each answer must equal its answer before the
//      migration. A difference makes the release need manual recovery;
//   4. the retry: the ledger-driven re-run must plan nothing; each pending file
//      is replayed once as if its ledger row had been lost (a run killed
//      between the execute and the ledger write, `record-after-apply`), and
//      must either refuse and roll back or change nothing; forward fixes run;
//      then the CANDIDATE Worker on that database must answer exactly as the
//      candidate Worker does on a clean build of the candidate schema, and both
//      ledgers must hold the same files and checksums;
//   5. a migration the classifier calls `manual`, or any release whose step 3
//      diverged, must name a forward fix (`-- forward-fix: <repo path>.sql` in
//      the migration) that step 4 ran;
//   6. the report names the base SHA, the candidate SHA and every pending file
//      with its checksum, so the release evidence can cite it.
//
// Durable Object migrations cannot run in this harness (node:sqlite and the
// Worker's fetch handler, no workerd): a new tag is reported "not rehearsed",
// with the reason, and does not fail the run.
//
// Why node:sqlite and the Worker tests' D1 adapter rather than `wrangler dev`:
// it is the database build every Worker test already trusts (D4133,
// `_d1_sqlite.mjs`), SQLite is D1's engine, it needs no Cloudflare account or
// network, and a probe costs seconds instead of a workerd boot per Worker and
// phase. What it does not model is recorded in D8532.md.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_CUTOFF, LEDGER_DDL, LEDGER_TABLE, applyPlan, checksum, compareMigrations,
  listMigrationFiles, migrationNumber, planActions,
} from './migrationPlan.mjs';
import { classifyMigrations, productionConfig } from './rollbackClass.mjs';

export const DB_OPTIONS = Object.freeze({ enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
const PROBE_SCRIPT = fileURLToPath(new URL('../release-window-probe.mjs', import.meta.url));

/** What the base Worker must answer on its own schema before anything else is worth comparing. */
export const HEALTHY = Object.freeze({
  'sign-in': (a) => a.status === 200,
  'sign-in:me': (a) => a.status === 200 && a.id != null,
  'entitlement:paid': (a) => a.status === 200 && a.passed_gate === true,
  'entitlement:free': (a) => a.status === 402,
  'grant:member': (a) => a.status === 200 && a.name != null,
  'grant:outsider': (a) => a.status === 403 || a.status === 404,
  'asset:hashed': (a) => a.status === 200,
  'asset:missing': (a) => a.status === 404,
});

const open = (file) => new DatabaseSync(file, DB_OPTIONS);

/** Run one migration file the way D1 runs `--file`: all of it or none of it. */
export function execAsOneTransaction(db, sql) {
  db.exec('SAVEPOINT release_window_file');
  try {
    db.exec(sql);
    db.exec('RELEASE release_window_file');
  } catch (error) {
    db.exec('ROLLBACK TO release_window_file');
    db.exec('RELEASE release_window_file');
    throw error;
  }
}

function recordLedger(db, file) {
  db.prepare(`INSERT OR REPLACE INTO ${LEDGER_TABLE} (filename, checksum, applied_at) VALUES (?, ?, datetime('now'))`)
    .run(file.name, file.checksum);
}

export function readLedger(db) {
  return new Map(db.prepare(`SELECT filename, checksum FROM ${LEDGER_TABLE}`).all().map((r) => [r.filename, r.checksum]));
}

/**
 * The base commit's database as production holds it after the base release:
 * the baseline, every migration above the cutoff, and a ledger naming every
 * file (the ones at or below the cutoff as a bootstrap marks them).
 */
export function buildBaseDatabase(file, sqlDir) {
  const files = listMigrationFiles(join(sqlDir, 'migrations'));
  // Built in memory and written out once: a file-backed build commits (and
  // syncs) after every statement, which is minutes instead of seconds.
  const db = new DatabaseSync(':memory:', DB_OPTIONS);
  try {
    db.exec(readFileSync(join(sqlDir, 'schema_baseline.sql'), 'utf8'));
    db.exec(LEDGER_DDL);
    for (const f of files) {
      if (migrationNumber(f.name) > BASELINE_CUTOFF) db.exec(f.sql);
      recordLedger(db, f);
    }
    db.prepare('VACUUM INTO ?').run(file);
  } finally { db.close(); }
  return files;
}

/** Step 2 (and the ledger-driven half of step 4): plan against the ledger, apply, record. */
export function applyPending(file, candidateFiles) {
  const db = open(file);
  try {
    db.exec(LEDGER_DDL);
    const ledger = readLedger(db);
    const actions = planActions(candidateFiles, ledger, { mode: 'apply' });
    const drift = actions.filter((a) => a.changed).map((a) => a.file.name);
    const result = applyPlan(actions, {
      exec: (f) => execAsOneTransaction(db, f.sql),
      record: (f) => recordLedger(db, f),
    });
    return {
      planned: actions.filter((a) => a.action === 'apply').map((a) => a.file.name),
      applied: result.applied.map((a) => a.file.name),
      drift,
      failure: result.failure ? { file: result.failure.file.name, phase: result.failure.phase, error: String(result.failure.error?.message ?? result.failure.error) } : null,
    };
  } finally { db.close(); }
}

/** Every object's SQL and every table's rows, hashed per object. */
export function fingerprint(db) {
  const out = new Map();
  const objects = db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  for (const o of objects) {
    const h = createHash('sha256').update(String(o.sql ?? ''));
    if (o.type === 'table') {
      let rows;
      try { rows = db.prepare(`SELECT * FROM "${String(o.name).replace(/"/g, '""')}"`).all(); } catch { rows = null; }
      const lines = rows == null ? ['<unreadable>'] : rows.map((r) => JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).sort();
      for (const line of lines) h.update('\0').update(line);
    }
    out.set(`${o.type} ${o.name}`, h.digest('hex'));
  }
  return out;
}

export function fingerprintDiff(a, b) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].filter((k) => a.get(k) !== b.get(k)).sort();
}

/**
 * Step 4, the lost ledger row: replay each pending file once more, on a copy.
 * `refused` (it failed and rolled back: the runner stops and names the file,
 * DEPLOY.md §4) and `no-op` (nothing changed) converge; `changed` does not —
 * a retry would silently apply it twice.
 */
export function replayPending(file, pendingFiles) {
  const db = open(file);
  try {
    return pendingFiles.map((f) => {
      const before = fingerprint(db);
      try {
        execAsOneTransaction(db, f.sql);
      } catch (error) {
        return { file: f.name, outcome: 'refused', error: String(error?.message ?? error) };
      }
      const changed = fingerprintDiff(before, fingerprint(db));
      return changed.length ? { file: f.name, outcome: 'changed', changed } : { file: f.name, outcome: 'no-op' };
    });
  } finally { db.close(); }
}

/** `-- forward-fix: <repo path>` lines in a migration's text. */
export function forwardFixesOf(sql) {
  return [...String(sql).matchAll(/^\s*--\s*forward-fix:\s*(\S+)\s*$/gim)].map((m) => m[1]);
}

/** Durable Object migration tags the candidate adds over the base: not rehearsed here. */
export function durableObjectTags(baseToml, candidateToml) {
  const base = new Set(baseToml ? productionConfig(baseToml).migrationTags : []);
  const cand = candidateToml ? productionConfig(candidateToml).migrationTags : [];
  return cand.filter((t) => !base.has(t)).map((tag) => ({
    tag,
    status: 'not rehearsed',
    reason: 'a Durable Object migration runs only in workerd with Durable Objects bound; this harness runs the Worker\'s fetch handler on node:sqlite, and Cloudflare refuses a rollback across the tag (rollbackClass do-migration)',
  }));
}

/** Probe answers that differ, `[{ probe, before, after }]`. */
export function compareAnswers(before, after) {
  const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...names].sort().filter((n) => JSON.stringify(before?.[n] ?? null) !== JSON.stringify(after?.[n] ?? null))
    .map((n) => ({ probe: n, before: before?.[n] ?? null, after: after?.[n] ?? null }));
}

/**
 * Run the probe script against one Worker tree and one database file. The
 * Worker is loaded with its own tree's TypeScript loader when it has one.
 */
export function runProbe({ worker, db, mode, loader = null, timeoutMs = 300_000 }) {
  const own = join(worker, 'test', '_ts-loader.mjs');
  const hook = loader ?? (existsSync(own) ? own : fileURLToPath(new URL('../../cloudflare-worker/test/_ts-loader.mjs', import.meta.url)));
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--import', hook, PROBE_SCRIPT,
    '--worker', worker, '--db', db, '--mode', mode], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
  const line = String(r.stdout ?? '').split('\n').find((l) => l.startsWith('@@probe '));
  if (r.status !== 0 || !line) {
    const said = `${r.error?.message ?? ''}\n${r.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n');
    return { ok: false, error: `probe ${mode} exited ${r.status}: ${said}` };
  }
  return { ok: true, result: JSON.parse(line.slice('@@probe '.length)) };
}

/**
 * Step 1 on its own: build the base database, let the base Worker seed it, and
 * record the base Worker's answers on it. Returns the unseeded and seeded
 * files (both kept unchanged) and the answers, or `{ ok: false, error }`. Tests
 * prepare it once and pass it to every `rehearse` as `preparedBase`.
 */
export function prepareBase({ workDir, baseSqlDir, baseWorker }) {
  const unseeded = join(workDir, 'base-unseeded.sqlite');
  const seeded = join(workDir, 'base-seeded.sqlite');
  const probeCopy = join(workDir, 'base-probed.sqlite');
  const files = buildBaseDatabase(unseeded, baseSqlDir);
  copyFileSync(unseeded, seeded);
  const seed = runProbe({ worker: baseWorker, db: seeded, mode: 'seed' });
  if (!seed.ok) return { ok: false, error: `the base Worker could not seed the base schema: ${seed.error}` };
  // The probes write (a sign-in records a session); they run on a copy so the seeded file stays as seeded.
  copyFileSync(seeded, probeCopy);
  const answers = runProbe({ worker: baseWorker, db: probeCopy, mode: 'probe' });
  rmSync(probeCopy, { force: true });
  if (!answers.ok) return { ok: false, error: answers.error };
  const unhealthy = Object.entries(HEALTHY).filter(([n, ok]) => !answers.result[n] || !ok(answers.result[n])).map(([n]) => n);
  if (unhealthy.length) {
    return { ok: false, answers: answers.result, error: `the base Worker on the base schema does not answer as expected (${unhealthy.join(', ')}), so nothing after it can be compared` };
  }
  return { ok: true, files, unseeded, seeded, answers: answers.result };
}

/**
 * The whole rehearsal. Every path is absolute. `workDir` is an empty
 * directory the caller removes. `preparedBase`, when given, is a
 * `prepareBase` result to start from instead of building one.
 *
 *   baseSqlDir, baseWorker, baseToml       the base commit's sql/, cloudflare-worker/, wrangler.toml text
 *   candidateFiles                         `listMigrationFiles` of the candidate's migrations
 *   candidateRoot, candidateWorker, candidateToml
 *   baseSha, candidateSha                  for the report
 */
export function rehearse(opts) {
  const { workDir, baseSqlDir, baseWorker, candidateWorker, candidateRoot, candidateFiles } = opts;
  const report = {
    issue: 8532, base_sha: opts.baseSha ?? null, candidate_sha: opts.candidateSha ?? null,
    migrations: [], classifier: null, steps: {}, durable_objects: durableObjectTags(opts.baseToml, opts.candidateToml),
    forward_fixes: [], verdict: 'fail', first_failure: null, notes: [],
  };
  const fail = (step, reason) => {
    report.steps[step] = { ...(report.steps[step] ?? {}), ok: false, reason };
    report.first_failure ??= { step, reason };
  };
  const pass = (step, extra = {}) => { report.steps[step] = { ...(report.steps[step] ?? {}), ...extra, ok: true }; };
  const db = (name) => join(workDir, `${name}.sqlite`);

  // Step 1: the base schema, its ledger, and the synthetic data.
  const base = opts.preparedBase ?? prepareBase({ workDir, baseSqlDir, baseWorker });
  if (!base.ok) { fail('1', base.error); if (base.answers) report.steps['1'].answers = base.answers; return finish(report); }
  // A base this call prepared is its own: its files are moved, not copied (a CI runner's disk is not large).
  const take = opts.preparedBase ? copyFileSync : renameSync;
  take(base.seeded, db('migrated'));
  take(base.unseeded, db('reference'));
  const before = { result: base.answers };
  const baseNames = new Set(base.files.map((f) => f.name));
  const pending = candidateFiles.filter((f) => !baseNames.has(f.name)).sort((a, b) => compareMigrations(a.name, b.name));
  report.migrations = pending.map((f) => ({ file: f.name, checksum: f.checksum }));
  const classified = classifyMigrations(pending.map((f) => ({ name: f.name, sql: f.sql })));
  report.classifier = { class: classified.reasons.length ? 'manual' : pending.length ? 'auto-additive' : 'auto', reasons: classified.reasons.map((r) => ({ rule: r.rule, file: r.file, line: r.line })) };
  pass('1', { base_files: base.files.length, answers: base.answers });

  // Step 2: the candidate's pending migrations, with the ledger.
  const applied = applyPending(db('migrated'), candidateFiles);
  if (applied.drift.length) report.notes.push(`checksum drift (edited after the base applied them; the runner will not re-run them): ${applied.drift.join(', ')}`);
  if (applied.failure) { fail('2', `migration ${applied.failure.file} failed (${applied.failure.phase}): ${applied.failure.error}`); return finish(report); }
  pass('2', { applied: applied.applied });

  // Step 3: publication stopped; the base Worker on the migrated schema.
  const window = runProbe({ worker: baseWorker, db: db('migrated'), mode: 'probe' });
  const diverged = window.ok ? compareAnswers(before.result, window.result) : [{ probe: '*', before: null, after: window.error }];
  if (diverged.length) fail('3', 'the base Worker answers differently on the migrated schema: the release needs manual recovery');
  else pass('3');
  report.steps['3'].differences = diverged;

  // Step 4: the retry.
  copyFileSync(db('migrated'), db('replay'));
  const retry = applyPending(db('migrated'), candidateFiles);
  const replay = replayPending(db('replay'), pending);
  rmSync(db('replay'), { force: true });
  report.steps['4'] = { ledger_retry_planned: retry.planned, replay };
  if (retry.planned.length || retry.failure) fail('4', `the ledger-driven retry was not a no-op: planned ${retry.planned.join(', ') || 'nothing'}${retry.failure ? `, failed on ${retry.failure.file}` : ''}`);
  const changed = replay.filter((r) => r.outcome === 'changed');
  if (changed.length) fail('4', `not idempotent: a retry that re-runs ${changed.map((r) => r.file).join(', ')} changes ${changed.flatMap((r) => r.changed).slice(0, 6).join(', ')}`);

  // Step 5: manual recovery needs a forward fix, which runs here.
  const manualFiles = new Set(classified.reasons.map((r) => r.file));
  if (diverged.length) for (const f of pending) manualFiles.add(f.name);
  const pendingNames = new Set(pending.map((f) => f.name));
  const fixes = [];
  // Forward fixes that ran on the migrated database also run on the clean
  // reference build, so step 4 compares like with like.
  const fixSql = [];
  for (const f of pending.filter((p) => manualFiles.has(p.name))) {
    const named = forwardFixesOf(f.sql);
    if (!named.length) { fixes.push({ migration: f.name, fix: null, status: 'missing' }); continue; }
    for (const fix of named) {
      const base = fix.split('/').pop();
      if (pendingNames.has(base)) { fixes.push({ migration: f.name, fix, status: 'applied in step 2 as a pending migration' }); continue; }
      const full = resolve(candidateRoot, fix);
      if (!full.startsWith(resolve(candidateRoot) + '/') || !full.endsWith('.sql') || !existsSync(full)) { fixes.push({ migration: f.name, fix, status: 'unusable: a forward fix is a .sql file in the candidate tree' }); continue; }
      const sql = readFileSync(full, 'utf8');
      const target = open(db('migrated'));
      try { execAsOneTransaction(target, sql); fixes.push({ migration: f.name, fix, checksum: checksum(sql), status: 'ran' }); fixSql.push(sql); }
      catch (e) { fixes.push({ migration: f.name, fix, status: `failed: ${e.message}` }); }
      finally { target.close(); }
    }
  }
  report.forward_fixes = fixes;
  const missing = fixes.filter((x) => x.status !== 'ran' && !x.status.startsWith('applied'));
  if (missing.length) fail('5', `manual-recovery migration without a rehearsed forward fix: ${missing.map((x) => `${x.migration} (${x.fix ?? 'none named'}: ${x.status})`).join('; ')}`);
  else pass('5', { manual: [...manualFiles] });

  // Step 4, continued: the candidate Worker converges with a clean build of the candidate.
  const ref = applyPending(db('reference'), candidateFiles);
  if (ref.failure) fail('4', `the clean candidate build failed on ${ref.failure.file}: ${ref.failure.error}`);
  else {
    if (fixSql.length) { const r = open(db('reference')); try { for (const sql of fixSql) execAsOneTransaction(r, sql); } finally { r.close(); } }
    const refSeed = runProbe({ worker: candidateWorker, db: db('reference'), mode: 'seed' });
    const refAnswers = refSeed.ok ? runProbe({ worker: candidateWorker, db: db('reference'), mode: 'probe' }) : refSeed;
    const after = runProbe({ worker: candidateWorker, db: db('migrated'), mode: 'probe' });
    const ledgers = [db('migrated'), db('reference')].map((p) => { const d = open(p); try { return JSON.stringify([...readLedger(d)].sort()); } finally { d.close(); } });
    report.steps['4'].ledger_converges = ledgers[0] === ledgers[1];
    if (!refAnswers.ok || !after.ok) fail('4', `the candidate Worker could not be probed: ${refAnswers.error ?? after.error}`);
    else {
      const apart = compareAnswers(refAnswers.result, after.result);
      report.steps['4'].differences = apart;
      report.steps['4'].answers = after.result;
      report.steps['4'].vs_base_before = compareAnswers(before.result, after.result);
      if (apart.length) fail('4', `the candidate Worker on the migrated database does not converge with a clean candidate build: ${apart.map((d) => d.probe).join(', ')}`);
    }
    if (!report.steps['4'].ledger_converges) fail('4', 'the migration ledger does not converge with a clean candidate build');
  }
  if (report.steps['4'].ok !== false) report.steps['4'].ok = true;
  return finish(report);

  function finish(r) {
    r.verdict = r.first_failure ? 'fail' : 'pass';
    return r;
  }
}
const cell = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** The report as the job summary shows it. */
export function renderReport(r) {
  const lines = [
    '## Release window rehearsal (D8532)', '',
    `**${r.verdict === 'pass' ? 'PASS' : 'FAIL'}**${r.first_failure ? ` at step ${r.first_failure.step}: ${cell(r.first_failure.reason)}` : ''}`, '',
    `| Base | Candidate | Classifier |`, '| --- | --- | --- |',
    `| \`${r.base_sha ?? 'unknown'}\` | \`${r.candidate_sha ?? 'unknown'}\` | ${r.classifier?.class ?? 'not reached'} |`, '',
    '### Pending migrations', '',
    ...(r.migrations.length ? r.migrations.map((m) => `- \`${m.file}\` sha256 \`${m.checksum.slice(0, 16)}\``) : ['None.']), '',
    '### Steps', '', '| Step | Result | Detail |', '| --- | --- | --- |',
  ];
  const names = { 1: 'base schema, seeded, base Worker answers', 2: 'apply pending migrations with the ledger', 3: 'publish stopped: base Worker on the migrated schema', 4: 'retry: ledger no-op, replay, candidate converges', 5: 'manual recovery has a rehearsed forward fix' };
  for (const k of ['1', '2', '3', '4', '5']) {
    const s = r.steps[k];
    lines.push(`| ${k}. ${names[k]} | ${s ? (s.ok ? 'pass' : 'FAIL') : 'not reached'} | ${cell(s?.reason ?? '')} |`);
  }
  const replay = r.steps['4']?.replay ?? [];
  if (replay.length) lines.push('', '### Replay (lost ledger row)', '', ...replay.map((x) => `- \`${x.file}\`: ${x.outcome}${x.error ? ` (${cell(x.error).slice(0, 160)})` : ''}${x.changed ? ` (${x.changed.slice(0, 6).join(', ')})` : ''}`));
  const diffs = r.steps['3']?.differences ?? [];
  if (diffs.length) lines.push('', '### Step 3 differences', '', ...diffs.map((d) => `- ${d.probe}: before \`${cell(JSON.stringify(d.before))}\`, after \`${cell(JSON.stringify(d.after))}\``));
  const reasons = r.classifier?.reasons ?? [];
  if (reasons.length) lines.push('', '### Rollback classifier: manual', '', ...reasons.map((x) => `- \`${x.file}\` line ${x.line ?? '?'}: ${x.rule}`));
  if (r.forward_fixes.length) lines.push('', '### Forward fixes', '', ...r.forward_fixes.map((f) => `- \`${f.migration}\`: ${f.fix ? `\`${f.fix}\`` : 'none named'} (${f.status})`));
  lines.push('', '### Durable Object migrations', '', ...(r.durable_objects.length ? r.durable_objects.map((d) => `- \`${d.tag}\`: ${d.status}: ${d.reason}`) : ['None in this release.']));
  if (r.notes.length) lines.push('', '### Notes', '', ...r.notes.map((n) => `- ${cell(n)}`));
  return `${lines.join('\n')}\n`;
}
