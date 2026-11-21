#!/usr/bin/env node
/**
 * #6326: the `land-pr` skill's reader. Given a PR, it reads every fact that
 * AGENTS.md § Task protocol step 5 needs before an agent may queue a T0/T1 PR,
 * and prints each gate with its verdict and, only when all hold, the two
 * commands to run. The rules are `lib/landPr.mjs`.
 *
 *   node scripts/land-pr.mjs <pr> [--summary FILE] [--no-classify] [--json]
 *
 *   --summary      the `landing policy` run summary, copied from the run page
 *                  (rendered text or raw markdown) into a file; it is then the
 *                  tier's source
 *   --no-classify  without --summary, do not recompute the tier (the gate then fails)
 *   --json         print the facts' verdict as JSON instead of text
 *
 * The REST API does not return a step summary, so without --summary the tier
 * is recomputed the way the workflow computes it: the SHAs and LANDING_AUTO
 * come from the job log, `git fetch` brings the base and the PR head, and the
 * base's own `scripts/merge-policy.mjs` classifies the diff.
 *
 * Read only: GET requests through curl (`gh()` from `coordinator.mjs`, with
 * GH_TOKEN or GITHUB_TOKEN when set, else the session proxy's credentials),
 * plus a local `git fetch`. It never marks a PR ready, enables auto-merge,
 * merges, approves, pushes or dispatches.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gh } from './coordinator.mjs';
import {
  ADMISSION_ISSUE, POLICY_CHECK, beforePush, decide, parseClassifierOutput, parseLandingLog, parseLandingSummary,
} from './lib/landPr.mjs';

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
  // A partial list could hide landing-policy.yml or a check run: fail closed, under `unread:`.
  throw new Error('pagination cap reached');
}

const tmp = mkdtempSync(join(tmpdir(), 'land-pr-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

// The logs endpoint redirects to a signed URL; curl drops Authorization when the host changes.
function jobLog(jobId) {
  const out = join(tmp, `${jobId}.log`);
  const args = ['-sSL', '--fail', '-o', out, '-H', 'Accept: application/vnd.github+json'];
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    const conf = join(tmp, 'auth.conf');
    writeFileSync(conf, `header = "Authorization: Bearer ${token.replace(/["\\\n]/g, '')}"\n`, { mode: 0o600 });
    args.push('-K', conf);
  }
  args.push(`https://api.github.com/repos/${REPO}/actions/jobs/${jobId}/logs`);
  try { execFileSync('curl', args, { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) {
    throw new Error(`job ${jobId} log: ${String(e.stderr || '').trim().slice(0, 200) || 'curl failed'}`);
  }
  return readFileSync(out, 'utf8');
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] });

// Same steps as the workflow: the classifier at the base, on the merge-base diff to the exact head.
function recompute(log, pr) {
  if (log.checkout !== 'success' || !log.fetchedHead) return { tier: 'T2', reasons: ['The workflow could not check out the base or fetch the head, so it reported T2.'] };
  git('fetch', '--no-tags', '--quiet', 'origin', log.baseSha, `refs/pull/${pr}/head`);
  git('cat-file', '-e', `${log.headSha}^{commit}`);
  const script = join(tmp, 'merge-policy.mjs');
  writeFileSync(script, git('show', `${log.baseSha}:scripts/merge-policy.mjs`));
  return parseClassifierOutput(execFileSync('node', [script, '--base', log.baseSha, '--head', log.headSha], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }));
}

function read(pr, { summaryFile, classify }) {
  const notes = [];
  const soft = (what, fn) => { try { return fn(); } catch (e) { notes.push(`${what}: ${e.message}`); return null; } };
  const pull = gh('GET', `/pulls/${pr}`);
  const head = pull.head.sha;
  const repo = soft('repository settings', () => gh('GET', ''));
  const rules = soft('main rules', () => gh('GET', '/rules/branches/main'));
  const admissionIssue = soft(`#${ADMISSION_ISSUE}`, () => gh('GET', `/issues/${ADMISSION_ISSUE}`));
  const files = soft('PR files', () => pages(`/pulls/${pr}/files`));
  const checkRuns = soft('check runs', () => pages(`/commits/${head}/check-runs?filter=latest`, 'check_runs'));
  const alerts = soft('alerts', () => gh('GET', `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${REPO} is:issue is:open in:title "[alert]"`)}&per_page=50`).items);
  const checkRun = (checkRuns || []).filter((c) => c.name === POLICY_CHECK && c.head_sha === head)
    .sort((a, b) => Date.parse(b.started_at || 0) - Date.parse(a.started_at || 0))[0] || null;

  let report = null;
  if (summaryFile) {
    report = { ...parseLandingSummary(readFileSync(summaryFile, 'utf8')), source: 'summary' };
  } else if (checkRun?.status === 'completed') {
    const log = soft('landing policy log', () => parseLandingLog(jobLog(checkRun.id)));
    if (log) {
      report = { baseSha: log.baseSha, headSha: log.headSha, landingAuto: log.landingAuto, tier: null, reasons: [], source: 'job log' };
      if (classify && log.baseSha && log.headSha) {
        const result = soft('tier recompute', () => recompute(log, pr));
        if (result) Object.assign(report, result, { source: 'job log; tier recomputed with the base\'s merge-policy.mjs' });
      }
    }
  }
  const pr0 = { number: pull.number, state: pull.state, merged: pull.merged, draft: pull.draft, base_ref: pull.base.ref, head_sha: head, auto_merge: pull.auto_merge };
  const facts = { repo, rules, admissionIssue, pr: pr0, files, checkRuns, landing: { checkRun, report }, alerts };
  return { pr: pr0, url: pull.html_url, landingRun: checkRun?.html_url ?? null, report, notes, ...decide(facts), beforePush: beforePush(pr0) };
}

function print(r) {
  const L = [`PR #${r.pr.number} ${r.url}`, `head ${r.pr.head_sha}  draft=${r.pr.draft}  auto-merge=${r.pr.auto_merge ? 'on' : 'off'}`, ''];
  for (const g of r.gates) L.push(`${g.ok ? 'ok  ' : 'FAIL'}  ${g.name}: ${g.detail}`);
  if (r.report?.reasons?.length) L.push('', `tier reasons (${r.report.source}):`, ...r.report.reasons.map((x) => `  ${x}`));
  if (r.landingRun) L.push('', `landing policy run (summary on this page): ${r.landingRun}`);
  if (r.notes.length) L.push('', 'unread:', ...r.notes.map((n) => `  ${n}`));
  L.push('', `verdict: ${r.verdict}`);
  if (r.commands.length) L.push('run, in order:', ...r.commands.map((c) => `  ${c}`));
  if (r.beforePush.length) L.push('before any push to this PR:', ...r.beforePush.map((c) => `  ${c}`));
  if (r.commands.some((c) => c.startsWith('gh ')) || r.beforePush.length) {
    L.push('', 'note: `gh pr ready` and `gh pr merge` run on GraphQL, which a Claude Code session refuses (HTTP 403).',
      'There, the owner lands; to turn auto-merge off use the CCR route in the land-pr skill, step 4.');
  }
  console.log(L.join('\n'));
}

function main() {
  const pr = process.argv[2];
  if (!/^\d+$/.test(pr || '')) { console.error('usage: node scripts/land-pr.mjs <pr> [--summary FILE] [--no-classify] [--json]'); process.exit(2); }
  const r = read(pr, { summaryFile: arg('summary'), classify: !flag('no-classify') });
  if (flag('json')) console.log(JSON.stringify(r, null, 2)); else print(r);
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) {
  try { main(); } catch (e) { console.error(`land-pr: ${e.message}`); process.exit(1); }
}
