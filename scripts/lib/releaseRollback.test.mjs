// D7152 (#7152): the automatic-rollback decision, run end to end against a
// faked deploy (the live version, `wrangler rollback`) and a faked smoke, in
// every mode; the re-run gate; the retention ledger after a rollback; and the
// workflow wiring, which is a no-op while RELEASE_ROLLBACK_MODE is unset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  FIX_FORWARD,
  NEXT_RELEASE,
  afterRollback,
  decideRollback,
  ledgerAfterRollback,
  markerName,
  publishedVersion,
  renderDecision,
  republishGate,
  rollbackMode,
  runRollbackDecision,
  smokeRows,
} from './releaseRollback.mjs';
import { planAssetRetention } from './assetRetention.mjs';
import { entriesFromLedger } from './spaChunks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHA = 'a'.repeat(40);
const PREV = '0b1c2d3e-0000-4000-8000-000000000001';
const BAD = '0b1c2d3e-0000-4000-8000-000000000002';
const NEWER = '0b1c2d3e-0000-4000-8000-000000000003';
const ROWS = ['https://axal.vc/assets/index-abc.js — HTTP 404 (expected 200)', 'https://app.axal.vc/hq — not the SPA shell'];

const record = (cls, extra = {}) => ({
  candidate: SHA, class: cls, reportOnly: true, previousVersionId: PREV, reasons: [], deployedCommit: 'b'.repeat(40), ...extra,
});
const MANUAL = record('manual', { reasons: [{ rule: 'drop', file: '202611180000_7151_x.sql', line: 3, text: 'a drop: the previous Worker still reads what this removes' }] });

/**
 * A faked release: `smoke` answers each kind in turn from `smokes`, the live
 * version is `live`, and `wrangler rollback` succeeds unless `rollbackFails`.
 * Every effect call is logged so a test can assert what did NOT happen.
 */
function fake({ smokes = {}, live = BAD, prior = false, rollbackFails = false } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      smoke: async (kind) => { calls.push(`smoke:${kind}`); const r = smokes[kind]; if (!r) throw new Error(`unexpected smoke ${kind}`); return r; },
      priorRollback: async () => { calls.push('prior'); return prior; },
      liveVersion: async () => { calls.push('live'); return live; },
      rollback: async (target) => { calls.push(`rollback:${target}`); return !rollbackFails; },
    },
  };
}
const FAIL = { ok: false, rows: ROWS };
const PASS = { ok: true, rows: [] };
const run = (mode, rec, f, firstSmoke = 'failure') => runRollbackDecision({ mode, record: rec, commit: SHA, firstSmoke, published: BAD, ...f.deps });

// ── the mode ───────────────────────────────────────────────────────────────

test('the mode is off unless the variable is exactly report or act', () => {
  for (const v of [undefined, null, '', 'off', 'Report', 'ACT', 'true', '1', 'acts', 'report act']) assert.equal(rollbackMode(v), 'off', String(v));
  assert.equal(rollbackMode('report'), 'report');
  assert.equal(rollbackMode(' act\n'), 'act');
});

test('mode off: nothing runs at all, not even the retry, on a failed smoke of a safe release', async () => {
  const f = fake();
  const d = await run('off', record('auto'), f);
  assert.equal(d.action, 'none');
  assert.match(d.why, /off/);
  assert.deepEqual(f.calls, []);
});

test('a passing smoke decides nothing and calls nothing, in either mode', async () => {
  for (const mode of ['report', 'act']) {
    const f = fake();
    const d = await run(mode, record('auto'), f, 'success');
    assert.equal(d.action, 'none');
    assert.equal(d.smoke, 'passed');
    assert.deepEqual(f.calls, []);
  }
});

test('a smoke that did not run (cancelled, skipped) is never a trigger', async () => {
  for (const first of ['cancelled', 'skipped', null]) {
    const f = fake();
    const d = await run('act', record('auto'), f, first);
    assert.equal(d.action, 'none');
    assert.match(d.why, /did not finish/);
    assert.deepEqual(f.calls, []);
  }
});

// ── safe class, smoke fails twice ────────────────────────────────────────────

test('report: a safe release whose smoke fails twice logs "would roll back to <version>" and rolls nothing back', async () => {
  for (const cls of ['auto', 'auto-additive']) {
    const f = fake({ smokes: { retry: FAIL } });
    const d = await run('report', record(cls), f);
    assert.equal(d.action, 'would-roll-back', cls);
    assert.equal(d.target, PREV);
    assert.equal(d.why, `would roll back to ${PREV}`);
    assert.deepEqual(d.failedRows, ROWS);
    assert.deepEqual(f.calls, ['smoke:retry', 'prior', 'live']);
    assert.equal(d.ledger, 'keep', 'nothing shipped again, so the ledger is untouched');
    const md = renderDecision(d);
    assert.match(md, new RegExp(`^### Automatic rollback \\(report, D7152\\): would roll back to ${PREV}`));
    assert.match(md, new RegExp(`Commit: \`${SHA}\``));
    assert.match(md, new RegExp(`Rollback class \\(D7151\\): \`${cls}\``));
    for (const r of ROWS) assert.ok(md.includes(`- ${r}`), r);
    assert.ok(md.includes(NEXT_RELEASE));
    assert.doesNotMatch(md, /Version restored/);
  }
});

test('act: a safe release whose smoke fails twice rolls back to the recorded version and verifies it', async () => {
  const f = fake({ smokes: { retry: FAIL, verify: PASS } });
  const d = await run('act', record('auto-additive'), f);
  assert.equal(d.action, 'rolled-back');
  assert.equal(d.rolledBack, true);
  assert.equal(d.page, false);
  assert.equal(d.ledger, 'demote');
  assert.deepEqual(f.calls, ['smoke:retry', 'prior', 'live', `rollback:${PREV}`, 'smoke:verify']);
  assert.match(renderDecision(d), new RegExp(`Version restored: \`${PREV}\``));
});

// ── manual class ─────────────────────────────────────────────────────────────

test('manual: never rolled back, even in act; the alert carries the reasons and the §3 fix-forward', async () => {
  for (const mode of ['report', 'act']) {
    const f = fake({ smokes: { retry: FAIL } });
    const d = await run(mode, MANUAL, f);
    assert.equal(d.action, 'alert');
    assert.deepEqual(f.calls, ['smoke:retry'], 'no live read, no rollback');
    assert.equal(d.reasons[0].rule, 'drop');
    const md = renderDecision(d);
    assert.ok(md.includes(FIX_FORWARD));
    assert.match(md, /DEPLOY\.md §3/);
    assert.match(md, /\| `drop` \| 202611180000_7151_x\.sql:3 \| a drop/);
    for (const r of ROWS) assert.ok(md.includes(r));
  }
});

test('an unreadable class record is manual', async () => {
  const f = fake({ smokes: { retry: FAIL } });
  const d = await run('act', null, f);
  assert.equal(d.action, 'alert');
  assert.equal(d.reasons[0].rule, 'class-unreadable');
  assert.deepEqual(f.calls, ['smoke:retry']);
});

// ── a single flaky failure ─────────────────────────────────────────────────────

test('a single failure that passes on its retry is flaky: no rollback, in either mode', async () => {
  for (const mode of ['report', 'act']) {
    const f = fake({ smokes: { retry: PASS } });
    const d = await run(mode, record('auto'), f);
    assert.equal(d.action, 'none');
    assert.equal(d.smoke, 'flaky');
    assert.deepEqual(f.calls, ['smoke:retry']);
  }
  assert.equal(decideRollback({ mode: 'act', record: record('auto'), firstSmoke: 'failure', retry: null, published: BAD, live: BAD }).action, 'none',
    'a first failure with no retry never rolls back');
});

// ── a failed verification or rollback ──────────────────────────────────────────

test('the smoke fails on the restored version too: stop and page, nothing further', async () => {
  const f = fake({ smokes: { retry: FAIL, verify: { ok: false, rows: ['https://axal.vc/api/health — HTTP 500'] } } });
  const d = await run('act', record('auto'), f);
  assert.equal(d.action, 'page');
  assert.equal(d.page, true);
  assert.equal(d.rolledBack, true);
  assert.equal(d.ledger, 'demote', 'the restored build is what serves now, even though it fails');
  assert.match(d.why, /fault is not the release/);
  assert.deepEqual(f.calls.filter((c) => c.startsWith('rollback')), [`rollback:${PREV}`], 'exactly one rollback');
  const md = renderDecision(d);
  assert.match(md, /PAGE/);
  assert.match(md, /failed on the restored version:[\s\S]*api\/health — HTTP 500/);
});

test('a failed wrangler rollback pages and skips the verification', async () => {
  const f = fake({ smokes: { retry: FAIL }, rollbackFails: true });
  const d = await run('act', record('auto'), f);
  assert.equal(d.action, 'page');
  assert.notEqual(d.rolledBack, true);
  assert.equal(d.ledger, 'keep');
  assert.ok(!f.calls.includes('smoke:verify'));
});

test('afterRollback leaves a decision that was not a rollback alone', () => {
  const d = decideRollback({ mode: 'report', record: record('auto'), firstSmoke: 'failure', retry: FAIL, published: BAD, live: BAD });
  assert.equal(afterRollback(d, { rolledBack: true, verify: PASS }), d);
});

// ── a re-run, and a release overtaken ──────────────────────────────────────────

test('a re-run of a commit already rolled back: no second automatic rollback, page', async () => {
  const f = fake({ smokes: { retry: FAIL }, prior: true });
  const d = await run('act', record('auto'), f);
  assert.equal(d.action, 'page');
  assert.ok(!f.calls.some((c) => c.startsWith('rollback')));
});

test('an unreadable rolled-back marker list: no rollback, alert', async () => {
  const f = fake({ smokes: { retry: FAIL }, prior: null });
  const d = await run('act', record('auto'), f);
  assert.equal(d.action, 'alert');
  assert.ok(!f.calls.some((c) => c.startsWith('rollback')));
});

test('the live version is no longer this release\'s, or unreadable: nothing to undo, no rollback', async () => {
  for (const live of [NEWER, null]) {
    const f = fake({ smokes: { retry: FAIL }, live });
    const d = await run('act', record('auto'), f);
    assert.equal(d.action, 'alert', String(live));
    assert.match(d.why, live ? /not the one this release published/ : /could not be read/);
    assert.ok(!f.calls.some((c) => c.startsWith('rollback')));
  }
  const f = fake({ smokes: { retry: FAIL }, live: PREV });
  assert.equal((await runRollbackDecision({ mode: 'act', record: record('auto'), commit: SHA, firstSmoke: 'failure', published: PREV, ...f.deps })).action, 'none',
    'already on the recorded version');
});

test('a safe class with no usable recorded version alerts', () => {
  for (const id of [null, 'not-a-uuid']) {
    const d = decideRollback({ mode: 'act', record: record('auto', { previousVersionId: id }), firstSmoke: 'failure', retry: FAIL, published: BAD, live: BAD });
    assert.equal(d.action, 'alert');
  }
});

test('the re-run gate: only act refuses, and only a rolled-back commit without the explicit input', () => {
  for (const mode of ['off', 'report']) assert.equal(republishGate({ mode, priorRollback: true, explicit: '' }).allow, true, mode);
  assert.equal(republishGate({ mode: 'act', priorRollback: false, explicit: '' }).allow, true);
  for (const explicit of ['', 'false', false, undefined, 'yes']) assert.equal(republishGate({ mode: 'act', priorRollback: true, explicit }).allow, false, String(explicit));
  for (const explicit of ['true', true]) assert.equal(republishGate({ mode: 'act', priorRollback: true, explicit }).allow, true, String(explicit));
  assert.equal(markerName(SHA), `release-rolled-back-${SHA}`);
});

// ── parsing ──────────────────────────────────────────────────────────────

test('smoke rows and the published version are read from the logs', () => {
  const out = `[spa-live] PASS  https://axal.vc/\n[spa-live] FAIL  ${ROWS[0]}\n  [spa-live] FAIL  ${ROWS[1]}\n[spa-live] FAIL  ${ROWS[0]}\n  - summary line`;
  assert.deepEqual(smokeRows(out), ROWS);
  assert.equal(smokeRows(Array.from({ length: 30 }, (_, i) => `[spa-live] FAIL  row ${i}`).join('\n')).length, 20);
  assert.equal(publishedVersion(`Candidate x\n| a | b |\nCurrent Version ID: ${BAD}\n`), BAD);
  assert.equal(publishedVersion('no version here'), null);
  assert.equal(publishedVersion(null), null);
});

// ── the retention ledger (DEPLOY.md §2.1) ─────────────────────────────────────

const LEDGER = {
  version: 2,
  builds: [
    { ts: '2026-11-25T10:00:00.000Z', deployedAt: '2026-11-25T10:05:00.000Z', files: ['index-bad.js', 'chunk-bad.js', 'shared.css'] },
    { ts: '2026-11-24T10:00:00.000Z', deployedAt: '2026-11-24T10:05:00.000Z', files: ['index-good.js', 'chunk-good.js', 'shared.css'] },
    { ts: '2026-11-23T10:00:00.000Z', deployedAt: '2026-11-23T10:05:00.000Z', files: ['index-old.js', 'shared.css'] },
  ],
};
const RESTORED_AT = '2026-11-25T10:20:00.000Z';

test('after a rollback the restored build is the last good deploy and the rolled-back build stays retained', () => {
  const r = ledgerAfterRollback(LEDGER, { previousEntries: ['/assets/index-good.js'], restoredAt: RESTORED_AT });
  assert.equal(r.changed, true);
  assert.deepEqual(r.ledger.builds.map((b) => b.files[0]), ['index-good.js', 'index-bad.js', 'index-old.js']);
  assert.equal(r.ledger.builds[0].deployedAt, RESTORED_AT);
  assert.equal(r.ledger.builds[1].deployedAt, LEDGER.builds[0].deployedAt, 'the bad build keeps its own deploy time');
  assert.equal(LEDGER.builds[0].files[0], 'index-bad.js', 'the input is not mutated');

  // The next deploy captures generation 0 as "previous": the restored build, not the rolled-back one.
  const read = (file) => (file.startsWith('index-') ? 'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/x.js"])))=>i.map(i=>d[i]);' : '');
  assert.deepEqual(entriesFromLedger({ ledger: r.ledger, generation: 0, readAsset: read }).entries, ['/assets/index-good.js']);

  // And the next build keeps the rolled-back build's chunks for tabs opened while it served.
  const plan = planAssetRetention({
    prevFiles: [...new Set(LEDGER.builds.flatMap((b) => b.files))], newFiles: ['index-next.js', 'shared.css'],
    ledgerBuilds: r.ledger.builds, now: '2026-11-25T12:00:00.000Z', restoredFromDeploy: true,
  });
  for (const f of ['index-bad.js', 'chunk-bad.js', 'index-good.js', 'chunk-good.js']) assert.ok(plan.keep.includes(f), f);
  assert.deepEqual(plan.nextLedger.builds.map((b) => b.files[0]), ['index-next.js', 'index-good.js', 'index-bad.js', 'index-old.js']);
});

test('the ledger is left alone when the restored build is already first, absent, or not captured', () => {
  const same = ledgerAfterRollback(LEDGER, { previousEntries: ['assets/index-bad.js'], restoredAt: RESTORED_AT });
  assert.equal(same.changed, false);
  assert.equal(same.ledger, LEDGER);
  assert.equal(ledgerAfterRollback(LEDGER, { previousEntries: ['assets/index-gone.js'], restoredAt: RESTORED_AT }).changed, false);
  assert.equal(ledgerAfterRollback(LEDGER, { previousEntries: [], restoredAt: RESTORED_AT }).changed, false);
  assert.throws(() => ledgerAfterRollback({ builds: [] }, { previousEntries: ['a.js'], restoredAt: RESTORED_AT }), /unreadable/);
  assert.throws(() => ledgerAfterRollback(LEDGER, { previousEntries: ['a.js'], restoredAt: 'never' }), /restore time/);
});

// ── the command ─────────────────────────────────────────────────────────────

const cli = (args, env) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release-rollback.mjs'), ...args], {
  encoding: 'utf8', env: { PATH: process.env.PATH, ...env },
});

test('the command with the mode unset records "off", runs no smoke and exits 0', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'release-rollback-'));
  try {
    writeFileSync(path.join(dir, 'rollback-class.json'), JSON.stringify(record('auto')));
    writeFileSync(path.join(dir, 'outcome.md'), `Current Version ID: ${BAD}\n`);
    const summary = path.join(dir, 'summary.md');
    const output = path.join(dir, 'output.txt');
    writeFileSync(summary, '');
    writeFileSync(output, '');
    const r = cli(['decide', dir], { FIRST_SMOKE: 'failure', GITHUB_SHA: SHA, GITHUB_STEP_SUMMARY: summary, GITHUB_OUTPUT: output });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /running the post-deploy smoke/);
    const d = JSON.parse(readFileSync(path.join(dir, 'rollback-decision.json'), 'utf8'));
    assert.equal(d.mode, 'off');
    assert.equal(d.action, 'none');
    assert.match(readFileSync(summary, 'utf8'), /Automatic rollback \(off, D7152\): no action/);
    assert.equal(readFileSync(output, 'utf8'), 'action=none\nrolled_back=false\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the gate command passes unless act; the ledger command rewrites the file', () => {
  for (const mode of ['', 'report']) {
    const r = cli(['gate'], { RELEASE_ROLLBACK_MODE: mode, GITHUB_SHA: SHA });
    assert.equal(r.status, 0, mode);
    assert.doesNotMatch(r.stdout, /::warning::/, 'outside act the gate reads no marker at all');
  }
  const act = cli(['gate'], { RELEASE_ROLLBACK_MODE: 'act', GITHUB_SHA: SHA });
  assert.equal(act.status, 0, 'an unreadable marker list never blocks a release');
  assert.match(act.stdout, /::warning::could not read whether this commit was rolled back/);
  const dir = mkdtempSync(path.join(tmpdir(), 'release-rollback-'));
  try {
    const file = path.join(dir, 'ledger.json');
    const manifest = path.join(dir, 'previous.json');
    writeFileSync(file, JSON.stringify(LEDGER));
    writeFileSync(manifest, JSON.stringify({ entries: ['/assets/index-good.js'], reason: null }));
    const r = cli(['ledger', file, manifest], {});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).builds[0].files[0], 'index-good.js');
    assert.equal(cli([], {}).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the workflow ─────────────────────────────────────────────────────────────

const WORKFLOW = readFileSync(path.join(ROOT, '.github', 'workflows', 'cloudflare-worker-deploy.yml'), 'utf8');
const job = (name, next) => WORKFLOW.split(`\n  ${name}:\n`)[1].split(`\n  ${next}:\n`)[0];
const steps = (body) => body.split(/^ {6}- (?:name: |uses: )/m).slice(1).map((s) => s.trim());
const ROLLBACK = job('rollback', 'schema-drift');
const RSTEPS = steps(ROLLBACK);
const step = (list, name) => list.find((s) => s.split('\n')[0] === name);

test('the rollback job is skipped unless the mode is report or act, and runs under the production release lock', () => {
  assert.ok(WORKFLOW.indexOf('\n  spa-smoke:\n') < WORKFLOW.indexOf('\n  rollback:\n'), 'after the smoke');
  assert.match(ROLLBACK, /\n {4}needs: \[deploy, spa-smoke\]\n/);
  assert.match(ROLLBACK, /\n {4}if: always\(\) && needs\.deploy\.result == 'success' && \(vars\.RELEASE_ROLLBACK_MODE == 'report' \|\| vars\.RELEASE_ROLLBACK_MODE == 'act'\)\n/);
  assert.match(ROLLBACK, /\n {4}environment: production\n/);
  assert.match(ROLLBACK, /\n {4}concurrency:\n {6}group: studioos-production-release\n {6}queue: max\n {6}cancel-in-progress: false\n/);
  const decide = step(RSTEPS, 'Decide, and in act mode roll back and verify');
  assert.ok(decide, 'no decide step');
  assert.match(decide, /\n {8}continue-on-error: \$\{\{ vars\.RELEASE_ROLLBACK_MODE != 'act' \}\}\n/, 'report never turns a release red');
  assert.match(decide, /FIRST_SMOKE: \$\{\{ needs\.spa-smoke\.result \}\}/);
  assert.match(decide, /run: node scripts\/release-rollback\.mjs decide "\$RUNNER_TEMP\/release-evidence"\n/);
  assert.doesNotMatch(WORKFLOW, /RELEASE_ROLLBACK_MODE: ['"]?(?:report|act)/, 'the workflow never sets the mode; the owner does');
});

test('only an actual rollback rewrites the retention ledger and marks the commit', () => {
  for (const name of ['Restore the assets this release saved', 'Make the restored build the last good deploy', 'Save the retention ledger after the rollback', 'Mark this commit rolled back']) {
    const s = RSTEPS.find((x) => x.includes(name) || x.startsWith(name));
    assert.ok(s, name);
    assert.match(s, /\n {8}if: always\(\) && steps\.decide\.outputs\.rolled_back == 'true'\n/, name);
  }
  assert.match(step(RSTEPS, 'Save the retention ledger after the rollback'), /key: spa-assets-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}-rolled-back/,
    'a newer spa-assets- entry, which the next deploy restores');
  assert.match(step(RSTEPS, 'Mark this commit rolled back'), /name: release-rolled-back-\$\{\{ github\.sha \}\}\n/);
});

test('the deploy job\'s re-run gate runs only in act, after the last admission check and before any write', () => {
  const DEPLOY = job('deploy', 'spa-smoke');
  const S = steps(DEPLOY);
  const names = S.map((s) => s.split('\n')[0]);
  const at = names.indexOf('Hold a commit automatic rollback took off production');
  assert.ok(at > 0, 'no gate step');
  assert.equal(names[at - 1], 'Confirm the candidate still owns the production release');
  assert.ok(at < names.indexOf('Apply pending D1 migrations') && at < names.indexOf('Deploy to Cloudflare Worker'));
  assert.match(S[at], /\n {8}if: vars\.RELEASE_ROLLBACK_MODE == 'act'\n/);
  assert.match(S[at], /REPUBLISH_ROLLED_BACK: \$\{\{ inputs\.republish_rolled_back \}\}/);
  assert.match(WORKFLOW, /\n {2}workflow_dispatch:\n {4}inputs:\n(?: {6}#.*\n)? {6}republish_rolled_back:\n[\s\S]*?type: boolean\n {8}default: false\n/);
});
