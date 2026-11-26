#!/usr/bin/env node
// D7152 (#7152): the production release's automatic-rollback step, off unless
// RELEASE_ROLLBACK_MODE is `report` or `act`. `decide` retries a failed smoke
// once and records the decision (in `act`, rolls back and verifies), `gate`
// refuses to republish a rolled-back commit, `ledger` rewrites the retention
// ledger after a rollback. Rules in `lib/releaseRollback.mjs`.
//
// Usage:
//   node scripts/release-rollback.mjs decide <evidence-dir>
//   node scripts/release-rollback.mjs gate
//   node scripts/release-rollback.mjs ledger <ledger.json> <spa-smoke-previous.json>
//
// `decide` runs in the `rollback` job of cloudflare-worker-deploy.yml, after
// `spa-smoke`, under the `studioos-production-release` lock. It reads from the
// deploy's evidence directory rollback-class.json (D7151: the class and the
// recorded previous version) and outcome.md (the version this release
// published), and from the environment:
//
//   RELEASE_ROLLBACK_MODE  off (unset) | report | act
//   FIRST_SMOKE            the spa-smoke job's result
//   SMOKE_HOSTS, SMOKE_CURRENT_BUILD, SMOKE_PREVIOUS_BUILD   as spa-smoke passes them
//   GITHUB_SHA, GITHUB_REPOSITORY, GH_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
//
// It writes rollback-decision.json and rollback-decision.md into the evidence
// directory, appends the summary to $GITHUB_STEP_SUMMARY, sets `action` and
// `rolled_back` in $GITHUB_OUTPUT, and exits 1 only on a page.

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { previousVersion } from './lib/rollbackClass.mjs';
import {
  ledgerAfterRollback,
  markerName,
  publishedVersion,
  republishGate,
  renderDecision,
  rollbackMode,
  runRollbackDecision,
  smokeRows,
} from './lib/releaseRollback.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = path.join(ROOT, 'cloudflare-worker');
const note = (msg) => console.log(`[rollback] ${msg}`);
const read = (file) => { try { return readFileSync(file, 'utf8'); } catch { return null; } };
const json = (text) => {
  const t = String(text ?? '');
  const at = t.search(/[[{]/);
  try { return at < 0 ? null : JSON.parse(t.slice(at)); } catch { return null; }
};
const SHA = /^[0-9a-f]{40}$/;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000, ...opts });
  return { ok: !r.error && r.status === 0, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

function wrangler(args) {
  return run('node', ['node_modules/wrangler/bin/wrangler.js', ...args, '--config', '../wrangler.toml', '--env', 'production'], { cwd: WORKER });
}

/** Whether a rolled-back marker exists for this commit; null when the API did not answer. */
function priorRollback(sha) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !SHA.test(String(sha))) return null;
  const r = run('gh', ['api', `repos/${repo}/actions/artifacts?name=${markerName(sha)}&per_page=10`]);
  const body = r.ok ? json(r.out) : null;
  if (!Array.isArray(body?.artifacts)) { note('could not read the rolled-back markers'); return null; }
  return body.artifacts.some((a) => a && a.expired !== true);
}

function smoke(kind, record) {
  const env = { ...process.env, SKIP_LIVE_SMOKE: '0' };
  if (kind === 'verify') {
    // The previous build is now the current one; there is no older build to check.
    env.SMOKE_CURRENT_BUILD = process.env.SMOKE_PREVIOUS_BUILD ?? '';
    delete env.SMOKE_PREVIOUS_BUILD;
    if (SHA.test(String(record?.deployedCommit ?? ''))) env.SMOKE_EXPECT_SHA = record.deployedCommit;
    else delete env.SMOKE_EXPECT_SHA;
  }
  note(`running the post-deploy smoke (${kind})`);
  const r = run(process.execPath, [path.join(ROOT, 'scripts', 'check-spa-live.mjs')], { env, timeout: 8 * 60_000 });
  process.stdout.write(r.out);
  return { ok: r.ok, rows: smokeRows(r.out) };
}

async function decide(evidence) {
  const mode = rollbackMode(process.env.RELEASE_ROLLBACK_MODE);
  const commit = process.env.GITHUB_SHA ?? null;
  const record = json(read(path.join(evidence, 'rollback-class.json')));
  const decision = await runRollbackDecision({
    mode,
    record,
    commit,
    firstSmoke: process.env.FIRST_SMOKE || null,
    published: publishedVersion(read(path.join(evidence, 'outcome.md'))),
    smoke: async (kind) => smoke(kind, record),
    priorRollback: async () => priorRollback(commit),
    liveVersion: async () => {
      const r = wrangler(['deployments', 'list', '--json']);
      return r.ok ? previousVersion(json(r.out)).id : null;
    },
    rollback: async (target) => {
      const r = wrangler(['rollback', target, '--message', `D7152 automatic rollback of ${String(commit).slice(0, 12)}`, '--yes']);
      process.stdout.write(r.out);
      return r.ok;
    },
  });
  const md = renderDecision(decision);
  try {
    writeFileSync(path.join(evidence, 'rollback-decision.json'), JSON.stringify(decision, null, 2) + '\n');
    writeFileSync(path.join(evidence, 'rollback-decision.md'), md);
  } catch { note('could not write the decision into the evidence directory'); }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${md}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `action=${decision.action}\nrolled_back=${decision.rolledBack === true}\n`);
  process.stdout.write(md);
  const line = md.split('\n')[0].replace(/^### /, '');
  if (decision.page) console.log(`::error::${line}`);
  else if (decision.action === 'alert') console.log(`::error::${line}`);
  else if (decision.action !== 'none') console.log(`::notice::${line}`);
  return decision.page ? 1 : 0;
}

function gate() {
  const mode = rollbackMode(process.env.RELEASE_ROLLBACK_MODE);
  const prior = mode === 'act' ? priorRollback(process.env.GITHUB_SHA) : false;
  // An unreadable marker list never blocks a release; the rollback job refuses a second rollback instead.
  if (prior == null) console.log('::warning::could not read whether this commit was rolled back automatically; publishing');
  const g = republishGate({ mode, priorRollback: prior === true, explicit: process.env.REPUBLISH_ROLLED_BACK });
  note(g.why);
  if (!g.allow) console.log(`::error::${g.why}`);
  return g.allow ? 0 : 1;
}

function ledger(file, manifest) {
  const restored = json(read(manifest));
  const r = ledgerAfterRollback(JSON.parse(readFileSync(file, 'utf8')), {
    previousEntries: Array.isArray(restored?.entries) ? restored.entries : [],
    restoredAt: new Date().toISOString(),
  });
  if (r.changed) writeFileSync(file, `${JSON.stringify(r.ledger, null, 2)}\n`);
  note(`retention ledger: ${r.why}`);
  return 0;
}

const [cmd, a, b] = process.argv.slice(2);
let code = 0;
try {
  if (cmd === 'decide' && a) code = await decide(a);
  else if (cmd === 'gate') code = gate();
  else if (cmd === 'ledger' && a && b) code = ledger(a, b);
  else { console.log('usage: release-rollback.mjs decide <evidence-dir> | gate | ledger <ledger.json> <previous-manifest.json>'); code = 2; }
} catch (e) {
  console.log(`::error::[rollback] ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`);
  code = 1;
}
process.exitCode = code;
