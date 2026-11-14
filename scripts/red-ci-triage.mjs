#!/usr/bin/env node
/**
 * #6326: the `red-ci-triage` skill's reader. Given a PR, it prints the CI
 * failure digest's verdict, the open `[alert]` issues, and every failing test,
 * type error, lint error or guard in the failed jobs' logs, each with the local
 * command that reproduces it. The rules are `lib/redCiTriage.mjs`.
 *
 *   node scripts/red-ci-triage.mjs <pr> [--run <ci run id>] [--logs DIR] [--no-main] [--json]
 *
 *   --run      a CI run other than the newest ci.yml run on the PR's head
 *   --logs     where the raw job logs are saved (default: a new temp folder, printed)
 *   --no-main  skip reading main's failed logs (tests are then not marked against main)
 *   --json     print the result as JSON instead of text
 *
 * Read only: GET requests through curl (`gh()` from `coordinator.mjs`, with
 * GH_TOKEN or GITHUB_TOKEN when set, else the session proxy's credentials).
 * It never comments, re-runs, merges, approves, pushes or dispatches.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gh } from './coordinator.mjs';
import { classify, infraFingerprint } from './lib/ciClassify.mjs';
import {
  parseDigest, openAlerts, newestRun, failedLeafJobs, leafJobs, mainRunBefore, ruling, suitePart, parseLog, findings, markShared, nextStep,
} from './lib/redCiTriage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.COORDINATOR_REPO || 'AxalNetwork/StudioOS';
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (name) => process.argv.includes(`--${name}`);

function pages(path, key) {
  const all = [];
  for (let p = 1; p <= 10; p++) {
    const data = gh('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${p}`);
    const rows = key ? data?.[key] : data;
    if (!Array.isArray(rows)) throw new Error(`${path}: unexpected response`);
    all.push(...rows);
    if (rows.length < 100) return all;
  }
  return all;
}

// The logs endpoint answers with a redirect to a signed URL, so this follows it
// (curl drops the Authorization header when the host changes).
let authFile = null;
function fetchLog(jobId, dir) {
  const out = join(dir, `${jobId}.log`);
  if (existsSync(out)) return readFileSync(out, 'utf8');
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const args = ['-sSL', '--fail', '-o', out, '-H', 'Accept: application/vnd.github+json'];
  if (token) {
    if (!authFile) {
      const d = mkdtempSync(join(tmpdir(), 'triage-'));
      authFile = join(d, 'auth.conf');
      writeFileSync(authFile, `header = "Authorization: Bearer ${token.replace(/["\\\n]/g, '')}"\n`, { mode: 0o600 });
      process.on('exit', () => rmSync(d, { recursive: true, force: true }));
    }
    args.push('-K', authFile);
  }
  args.push(`https://api.github.com/repos/${REPO}/actions/jobs/${jobId}/logs`);
  try { execFileSync('curl', args, { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) {
    rmSync(out, { force: true });
    throw new Error(`job ${jobId} log: ${String(e.stderr || '').trim().slice(0, 200) || 'curl failed'}`);
  }
  return readFileSync(out, 'utf8');
}

const latestJobs = (runId) => pages(`/actions/runs/${runId}/jobs?filter=latest`, 'jobs');

function triage(pr, { runId, logs, withMain }) {
  const pull = gh('GET', `/pulls/${pr}`);
  const head = pull.head.sha;
  const digest = parseDigest(pages(`/issues/${pr}/comments`));
  let alerts = [];
  let alertsError = null;
  try {
    const q = encodeURIComponent(`repo:${REPO} is:issue is:open in:title "[alert]"`);
    alerts = openAlerts(gh('GET', `https://api.github.com/search/issues?q=${q}&per_page=50`).items);
  } catch (e) { alertsError = e.message; }

  const run = runId
    ? gh('GET', `/actions/runs/${runId}`)
    : newestRun(gh('GET', `/actions/workflows/ci.yml/runs?head_sha=${head}&event=pull_request&per_page=20`).workflow_runs);
  if (!run) return { pr: Number(pr), head, state: pull.state, digest, alerts, alertsError, run: null, rows: [], note: 'No ci.yml run on this head yet.' };
  const jobs = latestJobs(run.id);

  // Main as the PR's run saw it (D5398 compares with main's latest completed run at the time the gate ran), and
  // main now, which only says whether the repair has landed.
  let main = null; let mainRun = null; let mainNow = null;
  try {
    const base = '/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed';
    mainNow = newestRun(gh('GET', `${base}&per_page=1`).workflow_runs);
    const started = run.run_started_at || run.created_at;
    const before = started ? gh('GET', `${base}&created=${encodeURIComponent(`<${started}`)}&per_page=20`).workflow_runs : [];
    mainRun = mainRunBefore(before, run);
    if (mainRun) main = { conclusion: mainRun.conclusion, jobs: latestJobs(mainRun.id) };
  } catch { main = null; }
  const mainRedAlert = alerts.find((a) => a.title === '[alert] main is red');
  const leaves = leafJobs(jobs);
  const infra = infraFingerprint(leaves);
  const live = infra ? { verdict: 'infra_failure', own: [], shared: [] }
    : classify({ pr: leaves, main: main && { ...main, jobs: leafJobs(main.jobs) }, incident: mainRedAlert?.url || null });
  const rule = ruling({ digest, head, run, live: live.verdict });

  mkdirSync(logs, { recursive: true });
  const failed = failedLeafJobs(jobs);
  let rows = [];
  for (const job of failed) {
    let parsed;
    try { parsed = parseLog(fetchLog(job.id, logs)); } catch (e) { rows.push({ kind: 'step', job: job.name, what: job.step, why: e.message, reproduce: null }); continue; }
    rows.push(...findings(job, parsed, readScripts(), exists).map((r) => ({ ...r, part: suitePart(job.name), log: join(logs, `${job.id}.log`) })));
  }
  // Every failed main log, not only the same-named part: a test can sit in another part on main.
  let mainSeen = null;
  if (main && failed.length) {
    const mainFailed = failedLeafJobs(main.jobs);
    mainSeen = { failedJobs: mainFailed.map((m) => m.name), rows: {}, unread: [] };
    for (const m of mainFailed) {
      if (!withMain) { mainSeen.unread.push(m.name); continue; }
      try { mainSeen.rows[m.name] = findings(m, parseLog(fetchLog(m.id, logs)), readScripts(), exists); } catch { mainSeen.unread.push(m.name); }
    }
  }
  rows = markShared(rows, mainSeen);
  return {
    pr: Number(pr), head, state: pull.state, draft: pull.draft,
    digest: digest && { ...digest, current: digest.headSha === head },
    alerts, alertsError,
    run: { id: run.id, url: run.html_url, status: run.status, conclusion: run.conclusion, headSha: run.head_sha },
    mainRun: mainRun && { id: mainRun.id, url: mainRun.html_url, conclusion: mainRun.conclusion, headSha: mainRun.head_sha },
    mainNow: mainNow && { id: mainNow.id, url: mainNow.html_url, conclusion: mainNow.conclusion, headSha: mainNow.head_sha },
    verdict: failed.length ? rule.verdict : 'no_failure', verdictSource: rule.source,
    scriptVerdict: failed.length ? live.verdict : 'no_failure', own: live.own, shared: live.shared,
    failedJobs: failed, rows, logs,
    next: failed.length ? nextStep({ verdict: rule.verdict, rows, alerts, mainNow: mainNow?.conclusion || null })
      : run.status === 'completed' ? `No failed job on this run (${run.conclusion}).` : 'No job has failed yet; the run is still going.',
  };
}

let scriptsCache = null;
const readScripts = () => (scriptsCache ||= JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts);
const exists = (p) => existsSync(join(ROOT, p));

function print(r) {
  const L = [];
  L.push(`PR #${r.pr}  head ${r.head.slice(0, 10)}  ${r.state}${r.draft ? ' (draft)' : ''}`);
  if (r.digest) L.push(`digest: ${r.digest.verdict || '(no verdict)'} at ${String(r.digest.headSha || '').slice(0, 10)}${r.digest.current ? '' : '  STALE: not the current head'}  ${r.digest.url || ''}`);
  else L.push('digest: none on this PR');
  if (!r.run) { L.push(r.note); return L.join('\n'); }
  L.push(`CI run: ${r.run.url}  ${r.run.status}${r.run.conclusion ? `/${r.run.conclusion}` : ''}${r.run.headSha !== r.head ? '  (not the current head)' : ''}`);
  L.push(`verdict: ${r.verdict} (${r.verdictSource === 'digest' ? 'the current digest' : 'this script'})`);
  L.push(`script's reading: ${r.scriptVerdict}${r.own.length ? `  own: ${r.own.join(', ')}` : ''}${r.shared.length ? `  red on main too: ${r.shared.join(', ')}` : ''}${r.verdictSource === 'digest' && r.scriptVerdict !== r.verdict ? '  (differs from the digest: the digest governs)' : ''}`);
  if (r.mainRun) L.push(`main when the run started: ${r.mainRun.conclusion} at ${r.mainRun.headSha.slice(0, 10)}  ${r.mainRun.url}`);
  else L.push('main when the run started: not found');
  if (r.mainNow && r.mainNow.id !== r.mainRun?.id) L.push(`main now: ${r.mainNow.conclusion} at ${r.mainNow.headSha.slice(0, 10)}  ${r.mainNow.url}`);
  L.push('', 'alerts:');
  if (r.alertsError) L.push(`  could not be read (${r.alertsError}); check open issues titled "[alert] …" by hand`);
  else if (!r.alerts.length) L.push('  none open');
  for (const a of r.alerts) L.push(`  #${a.number} ${a.title}${a.rule ? `\n      ${a.rule}` : ''}`);
  L.push('', `failing (${r.rows.length}):`);
  if (!r.failedJobs.length) L.push('  no failed job on this run');
  for (const x of r.rows) {
    const where = x.file ? `${x.file}${x.line ? `:${x.line}` : ''}` : '';
    const main = x.onMain === true ? '  [also red on main]' : x.onMain === false ? "  [not in main's log]" : '';
    L.push(`  [${x.kind}] ${x.job}${where ? `  ${where}` : ''}${main}`);
    L.push(`      ${x.what}`);
    if (x.why) L.push(`      why: ${x.why}`);
    L.push(`      reproduce: ${x.reproduce || '(no local command found; read the log)'}`);
  }
  L.push('', `logs: ${r.logs}`, '', `next: ${r.next}`);
  return L.join('\n');
}

function main() {
  const pr = process.argv[2];
  if (!/^[1-9]\d*$/.test(String(pr))) {
    console.error('usage: node scripts/red-ci-triage.mjs <pr> [--run <id>] [--logs DIR] [--no-main] [--json]');
    process.exit(2);
  }
  const runId = arg('run');
  if (runId !== undefined && !/^[1-9]\d*$/.test(runId)) { console.error('--run takes a run id'); process.exit(2); }
  const logs = resolve(arg('logs') || mkdtempSync(join(tmpdir(), `red-ci-${pr}-`)));
  const r = triage(pr, { runId, logs, withMain: !flag('no-main') });
  console.log(flag('json') ? JSON.stringify(r, null, 2) : print(r));
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
