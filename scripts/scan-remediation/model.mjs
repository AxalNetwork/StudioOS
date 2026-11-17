#!/usr/bin/env node
// D6935-p2: the Claude/Codex fallback for alerts no Autofix can fix: plan a task, apply a checked patch, dispatch.
/**
 *   node model.mjs plan      (scan-remediation-model.yml, read-only token) read alert SCAN_ALERT and write the outputs
 *                            `decision` (resolve | skip) and `task` (the model runner's task, one line of JSON)
 *   node model.mjs apply     (same workflow, after the model runner) check the patch with main's code, commit it to
 *                            `alert-fix-<n>` and open a draft PR into main, or record a compare link
 *   node model.mjs dispatch  (scan-remediation.yml) start one model run per alert in MODEL_ALERTS, within the daily cap
 *
 * The model runner is the landing bot's (#6473): primary Claude, Claude 2, Claude 3, then Codex, with the keys in
 * the `repair` environment and none of them in this module. A model-made PR is a draft labelled `security-scan` and
 * `model-edited`; the owner reviews it and submits it to the merge queue.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubApi } from './github.mjs';
import { loadTrackers } from './trackers.mjs';

/** The files the fallback edits: JavaScript and TypeScript, JSX included (syntax.mjs parses them). */
export const CHECKABLE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
export const BRANCH = (n) => `alert-fix-${n}`;
export const MARKER = (n) => `<!-- studioos-scan-pr:${n} -->`;
const SHA = /^[0-9a-f]{40}$/;
const positive = (v) => Number.isSafeInteger(v) && v > 0;
export const MAX_PER_DAY = 10;

/** The task for one alert, or why there is none. Pure: the alert as the REST API returns it. */
export function buildTask(alert, { guard } = {}) {
  const loc = alert?.most_recent_instance?.location ?? {};
  const path = typeof loc.path === 'string' ? loc.path : '';
  if (!positive(alert?.number) || alert.state !== 'open' || alert.most_recent_instance?.ref !== 'refs/heads/main') return { skip: 'the alert is not open on main' };
  if (!path || !CHECKABLE.test(path)) return { skip: 'the finding is not in a JavaScript or TypeScript file' };
  if (guard) {
    const g = guard([{ path }]);
    if (!g.ok) return { skip: `the file is protected: ${g.refused.map((r) => r.reason).join('; ')}` };
  }
  // The finding's text is untrusted: it goes to the model as data, never as instructions.
  const finding = {
    alert: alert.number, tool: alert.tool?.name ?? null, rule: alert.rule?.id ?? null, severity: alert.rule?.security_severity_level ?? alert.rule?.severity ?? null,
    rule_description: alert.rule?.description ?? null, message: alert.most_recent_instance?.message?.text ?? null,
    path, start_line: loc.start_line ?? null, end_line: loc.end_line ?? null,
  };
  return {
    task: {
      version: 1,
      instructions: [
        `Fix the code scanning finding described in the data file finding.json, in ${path}.`,
        'Change only what the finding needs, keep behaviour the same for every other input, and do not suppress or',
        'silence the finding with a comment. If the finding is a false positive that cannot be fixed in code, make no change.',
      ].join(' '),
      allowed_files: [path],
      verify: [['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], ['node', 'scripts/scan-remediation/syntax.mjs', path]],
      data: { 'finding.json': JSON.stringify(finding, null, 2) },
      max_rounds: 2,
    },
  };
}

/** Plan: the alert is open on main, its tracker is actionable, and no branch or PR holds work for it. */
export async function plan(api, { number, guard }) {
  if (!positive(number)) return { decision: 'skip', reason: 'no alert number' };
  const alert = await api.request('GET', `/code-scanning/alerts/${number}`);
  if (alert.number !== number) throw new Error('Mismatched alert identity');
  const built = buildTask(alert, { guard });
  if (built.skip) return { decision: 'skip', reason: built.skip };
  for (const branch of [BRANCH(number), `alert-autofix-${number}`]) {
    try {
      await api.request('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
      return { decision: 'skip', reason: `${branch} already exists: its work is finished there` };
    } catch (error) { if (error.status !== 404) throw error; }
  }
  return { decision: 'resolve', task: built.task };
}

/** Apply: re-check the patch with main's code, then one commit on a new branch and a draft PR into main. */
export async function apply(api, { number, patch, manifest, allowedFiles, checkPatch, trackers, botLogin }) {
  if (!positive(number) || !SHA.test(manifest?.base_sha ?? '')) throw new Error('Invalid alert or manifest');
  const base = manifest.base_sha;
  const before = new Map();
  for (const f of patch?.files ?? []) {
    try {
      const c = await api.request('GET', `/contents/${f.path.split('/').map(encodeURIComponent).join('/')}?ref=${base}`);
      before.set(f.path, c?.encoding === 'base64' ? Buffer.from(c.content, 'base64').toString('utf8') : null);
    } catch (error) { if (error.status === 404) before.set(f.path, null); else throw error; }
  }
  const problems = checkPatch(patch, manifest, allowedFiles, (p) => (before.has(p) ? before.get(p) : null));
  if (problems.length) return { status: 'refused', problems };
  const { issue, actionable } = await trackers.ensure(number);
  if (!actionable) return { status: 'not_actionable' };
  const branch = BRANCH(number);
  const commit = await api.request('GET', `/git/commits/${base}`);
  const tree = await api.request('POST', '/git/trees', {
    base_tree: commit.tree.sha,
    tree: patch.files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
  });
  const account = String(manifest.provider ?? 'unknown').replace(/[^a-z0-9-]/gi, '');
  const made = await api.request('POST', '/git/commits', {
    tree: tree.sha, parents: [base],
    message: `Fix code scanning alert #${number} (model fallback)\n\nTracking issue #${issue.number}.\n\nLanding-Bot-Kind: scan-fix\nModel-Provider: ${account}\n`,
  });
  try {
    await api.request('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: made.sha });
  } catch (error) {
    // A branch made since the plan holds someone's work: never overwritten.
    if (error.status === 422) return { status: 'existing_work' };
    throw error;
  }
  const alertUrl = `https://github.com/AxalNetwork/StudioOS/security/code-scanning/${number}`;
  const body = [
    MARKER(number), '## Objective', `Review a model-made fix for [code scanning alert ${number}](${alertUrl}).`,
    `Tracking issue #${issue.number}. The next default-branch scan confirms the fix, and only then is the tracker marked done.`,
    '## Implementation', `The landing bot's model runner (account \`${account}\`) edited only the file the finding names; main's code re-checked the patch before this commit.`,
    '## Files changed', patch.files.map((f) => `- \`${f.path}\``).join('\n'),
    '## Testing', 'The runner parsed the changed file. This PR\'s CI and the code scanners decide the rest.',
    '## Risks', 'A model wrote this change. Review it as you would a contributor\'s, including behaviour the finding does not mention.',
    '## Dependencies', 'None.',
    '## Agent', 'StudioOS Code Scanning remediation, model fallback (D6935-p2).',
    '## Help impact', 'None expected; assess while reviewing.',
    '## Review requested', 'The owner: a model-edited change is submitted to the merge queue by the owner.',
  ].join('\n\n');
  let pr;
  try {
    pr = await api.request('POST', '/pulls', { base: 'main', head: branch, draft: true, title: `Review model fix for code scanning alert #${number}`, body });
  } catch (error) {
    if (error.status === 403 && error.prCreationDisabled === true) {
      await trackers.linkPrepared(issue, branch);
      return { status: 'pr_permission', branch };
    }
    throw error;
  }
  await api.request('POST', `/issues/${pr.number}/labels`, { labels: ['security-scan', 'model-edited'] });
  await trackers.linkPull(issue, pr.number);
  return { status: 'pull_request', prNumber: pr.number, branch, account, botLogin };
}

/** How many more model runs today may start: the daily cap less today's runs of the model workflow. */
export function remainingToday(runs, cap, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const today = (runs ?? []).filter((r) => String(r.created_at ?? '').slice(0, 10) === day).length;
  return Math.max(0, cap - today);
}

/** The daily cap: SCAN_REMEDIATION_MODEL_PER_DAY, else 2, never above MAX_PER_DAY. */
export function dailyCap(value) {
  return /^[1-9]\d*$/.test(String(value ?? '')) ? Math.min(MAX_PER_DAY, Number(value)) : 2;
}

async function main(env, stage) {
  if (env.GITHUB_REPOSITORY !== 'AxalNetwork/StudioOS' || env.GITHUB_REF !== 'refs/heads/main') throw new Error('Untrusted workflow context');
  const api = githubApi('AxalNetwork', 'StudioOS', env.GH_TOKEN);
  const out = (k, v) => { if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${k}=${String(v).replace(/[\r\n]+/g, ' ')}\n`); };
  const number = /^[1-9]\d*$/.test(env.SCAN_ALERT ?? '') ? Number(env.SCAN_ALERT) : null;
  if (stage === 'plan') {
    const { pathGuard } = await import('../landing-bot/rules.mjs');
    const r = await plan(api, { number, guard: pathGuard });
    out('decision', r.decision);
    if (r.task) out('task', JSON.stringify(r.task));
    console.log(r.decision === 'resolve' ? `Alert ${number}: asking the model runner.` : `Alert ${number}: skipped (${r.reason}).`);
    return;
  }
  if (stage === 'apply') {
    // The model runner's own checker, from main; its absence (the runner not landed) stops here.
    const { checkPatch } = await import('../landing-bot/model/patch.mjs');
    const dir = env.PATCH_DIR;
    const patch = JSON.parse(readFileSync(join(dir, 'patch.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const task = JSON.parse(env.MODEL_TASK ?? 'null');
    const trackers = await loadTrackers(api, { owner: 'AxalNetwork', repo: 'StudioOS', defaultBranch: 'main', botLogin: env.SCAN_REMEDIATION_BOT_LOGIN || 'github-actions[bot]' });
    const r = await apply(api, { number, patch, manifest, allowedFiles: task?.allowed_files ?? [], checkPatch, trackers });
    console.log(`Alert ${number}: ${r.status}${r.prNumber ? ` (#${r.prNumber}, account ${r.account})` : ''}${r.problems ? ` — ${r.problems.join('; ')}` : ''}`);
    if (r.status === 'refused') process.exitCode = 1;
    return;
  }
  if (stage === 'dispatch') {
    const alerts = JSON.parse(env.MODEL_ALERTS || '[]');
    if (!Array.isArray(alerts) || !alerts.every(positive) || alerts.length > 5) throw new Error('Invalid alert list');
    const runs = (await api.request('GET', `/actions/workflows/scan-remediation-model.yml/runs?created=>=${new Date().toISOString().slice(0, 10)}&per_page=100`)).workflow_runs;
    const left = remainingToday(runs, dailyCap(env.SCAN_REMEDIATION_MODEL_PER_DAY));
    for (const n of alerts.slice(0, left)) {
      await api.request('POST', '/actions/workflows/scan-remediation-model.yml/dispatches', { ref: 'main', inputs: { alert: String(n) } });
      console.log(`Started the model fallback for alert ${n}.`);
    }
    if (alerts.length > left) console.log(`::notice::${alerts.length - left} alert(s) wait for tomorrow's model budget.`);
    return;
  }
  throw new Error('Usage: model.mjs plan|apply|dispatch');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.env, process.argv[2]).catch((error) => {
    console.error(`Scan remediation model step failed${Number.isInteger(error.status) ? ` (GitHub HTTP ${error.status})` : ''}.`);
    process.exitCode = 1;
  });
}
