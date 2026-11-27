/** D7899: reconcile trusted default-branch alerts with S21 trackers without GitHub AI or code writes. */
import { pathToFileURL } from 'node:url';
import { githubApi } from './github.mjs';
import { loadTrackers, matchingPulls } from './trackers.mjs';
import { batchedTrackers, loadBatches, reconcileBatches } from './batches.mjs';
import { ALERT_SOURCES } from './sources.mjs';
import { breachPass, digestText, isDigestRun, openSecurityTasks } from './sla.mjs';
import { webhookDelivery } from '../health-alert-transport.mjs';

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

export async function reconcile(api, options, dependencies = {}) {
  const { defaultBranch, runNumber, alertNumber } = options;
  if (!positive(runNumber) || (alertNumber !== undefined && !positive(alertNumber))) throw new Error('Invalid run or alert number');
  const ref = `refs/heads/${defaultBranch}`;
  const trackers = await (dependencies.loadTrackers ?? loadTrackers)(api, options);
  // D7259: an open batch owns its members' queue state; S21 claims the batch, not each member.
  const batches = await (dependencies.loadBatches ?? loadBatches)(api, options);
  const batched = batchedTrackers(batches);
  let candidates, open;
  if (alertNumber !== undefined) {
    candidates = [alertNumber];
  } else {
    open = await api.pages(`/code-scanning/alerts?state=open&ref=${encodeURIComponent(ref)}`);
    if (!open.every(a => positive(a.number) && a.state === 'open' && a.most_recent_instance?.ref === ref)) {
      throw new Error('Unreadable default-branch alert inventory');
    }
    const openNumbers = new Set(open.map(a => a.number));
    const checkFixed = trackers.trackedNumbers().filter(n => !openNumbers.has(n));
    candidates = [...windowOf(openNumbers, OPEN_PER_RUN, runNumber), ...windowOf(checkFixed, CLOSURES_PER_RUN, runNumber)];
  }
  // GitHub's canonical alert URL also identifies an existing same-repo PR with a custom branch name.
  const pulls = candidates.length || open
    ? await api.pages(`/pulls?state=open&base=${encodeURIComponent(defaultBranch)}`) : [];
  let failed = 0;
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
      const { issue, actionable } = await trackers.ensure(number);
      if (!actionable) continue;
      const existing = matchingPulls(pulls, options, issue.number, number);
      if (existing.size) {
        // Keep existing human and legacy bot work linked; never regenerate its patch.
        // Several PRs can be partial work: link all of them without choosing one arbitrarily.
        if (existing.size === 1) await trackers.linkPull(issue, existing.values().next().value.number);
        else await trackers.linkPulls(issue, [...existing.keys()]);
        continue;
      }
      if (alert.assignees?.length || batched.has(issue.number)) continue;
      // CodeQL and third-party findings share the same non-AI handoff to S21.
      await trackers.markReady(issue);
    } catch (error) {
      // The private alert body and API error payload stay out of public logs.
      console.error(`Alert ${number}: reconciliation failed${Number.isInteger(error.status) ? ` (HTTP ${error.status})` : ''}.`);
      if (error.limited || [401, 403, 429].includes(error.status)) throw error;
      failed++;
    }
  }
  if (open) {
    // Grouping needs the whole open inventory, so a single-alert dispatch leaves batches to the next sweep.
    try {
      await (dependencies.reconcileBatches ?? reconcileBatches)(api, options, { alerts: open, trackers, pulls, batches });
    } catch (error) {
      if (error.limited || [401, 403, 429].includes(error.status)) throw error;
      failed++;
    }
  }
  if (failed) throw new Error(`${failed} alert operations need retry`);
  return candidates.length;
}

/**
 * D8074: Dependabot and secret-scanning alerts follow the Code Scanning loop: one tracker per alert, routed to
 * S21, closed only when GitHub reports the alert resolved. Returns null when this credential cannot read the source.
 */
export async function reconcileSource(api, source, options, dependencies = {}) {
  const { runNumber } = options;
  if (!positive(runNumber)) throw new Error('Invalid run number');
  let open;
  try {
    open = await api.pages(source.list);
  } catch (error) {
    // The workflow token has no Dependabot or secret-scanning read; only the App credential does.
    if ([403, 404].includes(error.status) && !error.limited) {
      console.log(`${source.name}: not readable with this credential (HTTP ${error.status}); skipped.`);
      return null;
    }
    throw error;
  }
  if (!open.every(a => positive(a.number) && source.open(a))) throw new Error(`Unreadable ${source.name} inventory`);
  const trackers = await (dependencies.loadTrackers ?? loadTrackers)(api, { ...options, source });
  const openNumbers = new Set(open.map(a => a.number));
  const checkResolved = trackers.trackedNumbers().filter(n => !openNumbers.has(n));
  const candidates = [...windowOf(openNumbers, OPEN_PER_RUN, runNumber), ...windowOf(checkResolved, CLOSURES_PER_RUN, runNumber)];
  let failed = 0;
  for (const number of candidates) {
    try {
      const alert = await api.request('GET', source.get(number));
      if (alert.number !== number) throw new Error('Mismatched alert identity');
      if (source.resolved(alert, options.defaultBranch)) {
        await trackers.closeFixed(alert);
        continue;
      }
      if (!source.open(alert)) continue;
      const { issue, actionable } = await trackers.ensure(number, alert);
      if (!actionable || alert.assignees?.length) continue;
      await trackers.markReady(issue);
    } catch (error) {
      // Neither the alert nor the response body is logged: this repository's Actions logs are public.
      console.error(`${source.name} alert ${number}: reconciliation failed${Number.isInteger(error.status) ? ` (HTTP ${error.status})` : ''}.`);
      if (error.limited || [401, 429].includes(error.status)) throw error;
      failed++;
    }
  }
  if (failed) throw new Error(`${failed} ${source.name} alert operations need retry`);
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
  const options = {
    owner, repo, defaultBranch: 'main', botLogin: env.SCAN_REMEDIATION_BOT_LOGIN || 'github-actions[bot]',
    runNumber: Number(env.GITHUB_RUN_NUMBER),
    // D7259: optional; without it each new batch id is keyed at random. It is never logged.
    batchKey: env.SCAN_BATCH_KEY || undefined,
  };
  const now = new Date();
  if (isDigestRun(env)) {
    // The weekly digest carries counts only; it reads trackers, never alerts.
    const text = digestText(await openSecurityTasks(api, options), now);
    const sent = await webhookDelivery({ url: env.SLACK_GITHUB_WEBHOOK_URL })({ text });
    console.log(`Weekly security digest: ${sent.state}${sent.code ? ` (${sent.code})` : ''}.`);
    if (!['acknowledged', 'retry'].includes(sent.state) || (sent.state === 'retry' && sent.code !== 'not_configured')) {
      throw new Error('Digest delivery was not acknowledged');
    }
    return;
  }
  const n = await reconcile(api, { ...options, alertNumber: raw ? Number(raw) : undefined });
  console.log(`Reconciled a window of ${n} Code Scanning alerts.`);
  if (raw) return;
  for (const source of ALERT_SOURCES) {
    const m = await reconcileSource(api, source, options);
    if (m !== null) console.log(`Reconciled a window of ${m} ${source.name} alerts.`);
  }
  const breached = await breachPass(api, { ...options, now });
  console.log(`SLA pass: ${breached} task(s) newly past seven days.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.env).catch(error => {
    console.error(`Scan remediation did not complete${Number.isInteger(error.status) ? ` (GitHub HTTP ${error.status})` : ''}. Check workflow configuration and retry.`);
    process.exitCode = 1;
  });
}
