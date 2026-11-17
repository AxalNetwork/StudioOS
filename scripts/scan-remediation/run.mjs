/** D6935: reconcile trusted default-branch alert state with issues and reviewable changes. */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { prepareFix } from './fix.mjs';
import { githubApi } from './github.mjs';
import { loadTrackers } from './trackers.mjs';

const OPEN_PER_RUN = 5;
const CLOSURES_PER_RUN = 20;
const positive = value => Number.isSafeInteger(value) && value > 0;

// Sort by stable alert number. Repeated scans also advance past long-running and manually owned alerts.
function windowOf(numbers, limit, runNumber) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length <= limit) return sorted;
  const start = ((runNumber - 1) % Math.ceil(sorted.length / limit)) * limit;
  return sorted.slice(start, start + limit);
}

function sameRepoAlertPRs(pulls, options) {
  const fullName = `${options.owner}/${options.repo}`.toLowerCase();
  const result = new Map();
  for (const pull of pulls) {
    if (pull.head?.repo?.full_name?.toLowerCase() !== fullName || pull.base?.ref !== options.defaultBranch) continue;
    const urls = (pull.body ?? '').matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/security\/code-scanning\/([1-9]\d*)(?=$|[\s)>\]#?.,])/gi);
    for (const [, repo, alert] of urls) {
      if (repo.toLowerCase() === fullName) result.set(Number(alert), pull);
    }
  }
  return result;
}

/** The time of the newest default-branch analysis by one tool, or undefined when it cannot be read. */
async function latestScan(api, ref, tool) {
  try {
    const rows = await api.request('GET', `/code-scanning/analyses?ref=${encodeURIComponent(ref)}&tool_name=${encodeURIComponent(tool)}&per_page=1`);
    const at = Array.isArray(rows) ? rows[0]?.created_at : undefined;
    return Number.isFinite(Date.parse(at ?? '')) ? at : undefined;
  } catch (error) {
    if (error.limited || [401, 429].includes(error.status)) throw error;
    return undefined;
  }
}

/**
 * Reconcile one window. S21 (2026-11-17 audit): an alert no Autofix can fix (every Semgrep alert, and a CodeQL alert
 * without a usable suggestion) is also offered to the model fallback when `options.modelCandidates` is an array:
 * up to `options.modelLimit` alert numbers per sweep, each with an actionable, unclaimed tracker and no fix PR.
 */
export async function reconcile(api, options, dependencies = {}) {
  const { defaultBranch, runNumber, alertNumber } = options;
  const modelLimit = Number.isSafeInteger(options.modelLimit) && options.modelLimit > 0 ? options.modelLimit : 0;
  const offerModel = number => {
    if (Array.isArray(options.modelCandidates) && options.modelCandidates.length < modelLimit && !options.modelCandidates.includes(number)) {
      options.modelCandidates.push(number);
    }
  };
  const scanTimes = new Map();
  const scanTime = async tool => {
    if (!tool) return undefined;
    if (!scanTimes.has(tool)) scanTimes.set(tool, await (dependencies.scanTime ?? (t => latestScan(api, `refs/heads/${defaultBranch}`, t)))(tool));
    return scanTimes.get(tool);
  };
  if (!positive(runNumber) || (alertNumber !== undefined && !positive(alertNumber))) throw new Error('Invalid run or alert number');
  const ref = `refs/heads/${defaultBranch}`;
  const trackers = await (dependencies.loadTrackers ?? loadTrackers)(api, options);
  let candidates;
  if (alertNumber !== undefined) {
    candidates = [alertNumber];
  } else {
    const open = await api.pages(`/code-scanning/alerts?state=open&ref=${encodeURIComponent(ref)}`);
    if (!open.every(a => positive(a.number) && a.state === 'open' && a.most_recent_instance?.ref === ref)) {
      throw new Error('Unreadable default-branch alert inventory');
    }
    const openNumbers = new Set(open.map(a => a.number));
    const checkFixed = trackers.trackedNumbers().filter(n => !openNumbers.has(n));
    candidates = [...windowOf(openNumbers, OPEN_PER_RUN, runNumber), ...windowOf(checkFixed, CLOSURES_PER_RUN, runNumber)];
  }
  // GitHub's canonical alert URL also identifies an existing same-repo PR with a custom branch name.
  const pulls = candidates.length
    ? await api.pages(`/pulls?state=open&base=${encodeURIComponent(defaultBranch)}`) : [];
  const existingPulls = sameRepoAlertPRs(pulls, options);
  let failed = 0;
  let prepared = 0;
  for (const number of candidates) {
    try {
      const alert = await api.request('GET', `/code-scanning/alerts/${number}`);
      if (alert.number !== number) throw new Error('Mismatched alert identity');
      if (alert.most_recent_instance?.ref !== ref) continue;
      if (alert.state === 'fixed') {
        await trackers.closeFixed(alert);
        continue;
      }
      if (alert.state !== 'open' || alert.most_recent_instance.state !== 'open') continue;
      // The newest main scan by this alert's tool still reports it open: a tracker closed before it is reopened.
      const { issue, actionable } = await trackers.ensure(number, { scannedAt: await scanTime(alert.tool?.name) });
      if (!actionable) continue;
      const existing = existingPulls.get(number);
      if (existing) {
        // The publisher repairs the label on its own canonical PR after an interrupted run.
        const ownBranch = [`alert-fix-${number}`, `alert-autofix-${number}`].includes(existing.head.ref);
        if (!ownBranch || ![options.botLogin, 'github-actions[bot]'].includes(existing.user?.login)) {
          await trackers.linkPull(issue, existing.number);
          continue;
        }
      }
      if (alert.assignees?.length) continue;
      if (alert.tool?.name !== 'CodeQL') {
        await trackers.markReady(issue);
        offerModel(number);
        continue;
      }
      const result = await (dependencies.prepareFix ?? prepareFix)(api, { ...options, number, issueNumber: issue.number });
      if (result.prNumber && ['pull_request', 'existing_pr', 'merged_pr'].includes(result.status)) {
        await trackers.linkPull(issue, result.prNumber);
      } else if (result.status === 'pr_permission') {
        await trackers.linkPrepared(issue, result.branch);
        prepared++;
      } else if (['manual', 'prior_pr', 'existing_work'].includes(result.status)) {
        await trackers.markReady(issue);
        // No usable Autofix: the model fallback may try. Work already on a branch is a person's or a run's to finish.
        if (result.status === 'manual') offerModel(number);
      }
    } catch (error) {
      // The private alert body, Autofix description and API error payload stay out of public logs.
      console.error(`Alert ${number}: reconciliation failed${Number.isInteger(error.status) ? ` (HTTP ${error.status})` : ''}.`);
      if (error.limited || [401, 403, 429].includes(error.status)) throw error;
      failed++;
    }
  }
  if (prepared) console.log(`::warning::${prepared} fix branches are ready. GitHub Actions PR creation is disabled. See the tracking issues and D6935.`);
  if (failed) throw new Error(`${failed} alert operations need retry`);
  return candidates.length;
}

async function main(env) {
  if (env.GITHUB_REPOSITORY !== 'AxalNetwork/StudioOS' || env.GITHUB_REF !== 'refs/heads/main'
      || !['workflow_dispatch', 'schedule'].includes(env.GITHUB_EVENT_NAME)) throw new Error('Untrusted workflow context');
  const [owner, repo] = env.GITHUB_REPOSITORY.split('/');
  const api = githubApi(owner, repo, env.GH_TOKEN);
  const repository = await api.request('GET', '');
  if (repository.default_branch !== 'main') throw new Error('Default branch changed');
  const raw = env.SCAN_ALERT || '';
  if (raw && !/^[1-9]\d*$/.test(raw)) throw new Error('Invalid target');
  // The model fallback (S21): off unless SCAN_REMEDIATION_MODEL_PER_SWEEP is a positive whole number (at most 5).
  const perSweep = /^[1-9]\d*$/.test(env.SCAN_REMEDIATION_MODEL_PER_SWEEP ?? '') ? Math.min(5, Number(env.SCAN_REMEDIATION_MODEL_PER_SWEEP)) : 0;
  const modelCandidates = [];
  const n = await reconcile(api, {
    owner, repo, defaultBranch: 'main', botLogin: env.SCAN_REMEDIATION_BOT_LOGIN || 'github-actions[bot]',
    runNumber: Number(env.GITHUB_RUN_NUMBER), alertNumber: raw ? Number(raw) : undefined,
    modelCandidates, modelLimit: perSweep,
  });
  console.log(`Reconciled a window of ${n} alerts.`);
  // One line, numbers only: the dispatch job reads this output and starts one model run per alert.
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `model_alerts=${JSON.stringify(modelCandidates)}\n`);
  if (modelCandidates.length) console.log(`Offered ${modelCandidates.length} alert(s) to the model fallback.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.env).catch(error => {
    console.error(`Scan remediation did not complete${Number.isInteger(error.status) ? ` (GitHub HTTP ${error.status})` : ''}. Check workflow configuration and retry.`);
    process.exitCode = 1;
  });
}
