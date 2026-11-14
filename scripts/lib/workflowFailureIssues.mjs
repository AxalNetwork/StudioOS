// D6387: route verified GitHub Actions failures to repair issues, with one occurrence per run attempt.
import { createHash } from 'node:crypto';
import { ALERT_KINDS, mainState } from './githubAlerts.mjs';

const REPOSITORY = 'AxalNetwork/StudioOS';
const FAILURES = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
const GITHUB_OWNERS = new Set(['github-actions[bot]', 'guillaumelauzier']);
const TOPICS = {
  'backup-d1': 'Database backup', 'dr-drill': 'Disaster recovery drill',
  'cloudflare-worker-deploy': 'Production release', 'd1-migrate': 'Database migration',
};
// Existing incidents are reused only with the caller's independently verified failing-step evidence.
const EXISTING_INCIDENTS = {
  1008: ['.github/workflows/magic-link-probe.yml', '.github/workflows/magic-link-insert-probe.yml'],
  5530: ['.github/workflows/claude-code.yml'],
  5675: ['.github/workflows/meeting-bot-deploy.yml'],
};
const numberId = value => Number.isSafeInteger(value) && value > 0;
const hexSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hash = values => createHash('sha256').update(JSON.stringify(values)).digest('hex');
const groupMarker = key => '<!-- studioos-workflow-failure:v1 ' + key + ' -->';
const occurrenceMarker = key => '<!-- studioos-workflow-attempt:v1 ' + key + ' -->';
const trusted = issue => numberId(issue?.number) && !issue.pull_request && GITHUB_OWNERS.has(issue.user?.login);
const safeWorkflowPath = path => typeof path === 'string' && path.length <= 180 &&
  /^(?:\.github\/workflows\/[a-zA-Z0-9_-][\w.-]*\.ya?ml|dynamic\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)$/.test(path);

function failedJobs(jobs, run) {
  if (!Array.isArray(jobs)) throw new Error('workflow_jobs_unreadable');
  return jobs.filter(job => FAILURES.has(job?.conclusion)).map(job => {
    if (!numberId(job.id) || job.run_id !== run.id ||
        (job.run_attempt != null && job.run_attempt !== run.run_attempt) ||
        (job.head_sha != null && job.head_sha !== run.head_sha)) throw new Error('workflow_job_identity_mismatch');
    const steps = (job.steps || []).filter(step => FAILURES.has(step?.conclusion));
    // The names help correlate repeated failures. PR code controls these strings, so publish only their digest.
    const signature = hash([job.name || null, steps.map(step => [step.name || null, step.number || null])]);
    return { id: job.id, signature, steps: steps.map(step => step.number).filter(numberId) };
  });
}

export function normalizeWorkflowFailure({ run, jobs = [], superseded = false }, catalog, repository = REPOSITORY) {
  if (repository !== REPOSITORY || catalog?.repository !== repository || !Array.isArray(catalog.workflows) ||
      run?.repository?.full_name !== repository || !numberId(run?.id) || !numberId(run.workflow_id) ||
      !numberId(run.run_attempt)) throw new Error('workflow_run_identity_invalid');
  if (run.status !== 'completed' || !FAILURES.has(run.conclusion)) return null;
  const path = catalog.workflows.find(entry => entry.id === run.workflow_id)?.path;
  const workflow = safeWorkflowPath(path) ? path : null;
  const productionRelease = workflow === '.github/workflows/cloudflare-worker-deploy.yml';
  // Supersession is an explicit trusted result from the admission gate, never inferred from a later commit.
  if (productionRelease && run.conclusion === 'failure' && superseded === true) return null;
  const failed = failedJobs(jobs, run);
  const prs = (run.pull_requests || []).map(pr => pr?.number).filter(numberId);
  const pr = prs.length === 1 ? prs[0] : null;
  const sameRepo = run.head_repository?.full_name === repository;
  const isMain = sameRepo && run.head_branch === 'main' && ['push', 'workflow_dispatch', 'schedule'].includes(run.event);
  // GitHub gives each candidate a temporary ref. Aggregate the same failed stage on the same target queue.
  const queue = sameRepo && run.event === 'merge_group' &&
    /^gh-readonly-queue\/(.+)\/pr-[1-9]\d*-[0-9a-f]{7,64}$/.exec(run.head_branch || '');
  let context;
  if (queue) context = ['merge-queue', queue[1]];
  else if (pr) context = ['pr', pr];
  else if (run.event === 'pull_request' || !run.head_branch || !run.head_repository?.full_name) context = ['run', run.id];
  else context = [run.head_repository.full_name, run.event, run.head_branch];
  const contextKey = hash([repository, run.workflow_id, context]);
  const fingerprint = hash([contextKey, run.conclusion, [...new Set(failed.map(job => job.signature))].sort()]);
  const root = 'https://github.com/' + repository;
  const attemptKey = [run.workflow_id, run.id, run.run_attempt].join(':');
  const url = root + '/actions/runs/' + run.id + '/attempts/' + run.run_attempt;
  const slug = workflow?.split('/').at(-1)?.replace(/\.ya?ml$/, '');
  const title = '[Actions] ' + (Object.hasOwn(TOPICS, slug) ? TOPICS[slug] : workflow || 'Workflow ' + run.workflow_id) +
    ' ' + run.conclusion + (pr ? ' on PR #' + pr : isMain ? ' on main' : '');
  const evidence = ['**Workflow attempt** [' + run.id + ', attempt ' + run.run_attempt + '](' + url + ') · `' + run.conclusion + '`',
    'Workflow ID `' + run.workflow_id + '`' + (workflow ? ' · `' + workflow + '`' : ' · pending catalog registration') +
      (hexSha(run.head_sha) ? ' · [commit ' + run.head_sha.slice(0, 12) + '](' + root + '/commit/' + run.head_sha + ')' : '') +
      (pr ? ' · [PR #' + pr + '](' + root + '/pull/' + pr + ')' : '')];
  if (failed.length) {
    const shown = failed.slice(0, 10).map(job => '[Job ' + job.id + '](' + root + '/actions/runs/' + run.id + '/job/' + job.id + ')' +
      (job.steps.length ? ' (failed step ' + job.steps.slice(0, 10).join(', ') + ')' : ''));
    evidence.push('Failed jobs: ' + shown.join(' · ') + (failed.length > shown.length ? ' · see the attempt for all ' + failed.length + ' jobs' : ''));
  }
  const recommendation = productionRelease
    ? 'Check release admission and deployment evidence to distinguish a superseded candidate from a failed production change; confirm the intended candidate is healthy.'
    : 'Inspect the failed attempt, assign the repair to the workflow or PR owner, and link a passing run or other verified resolution before closing.';
  const labels = ['bug', 'ci', 'workflow-failure', 'slot:S01', 'state:ready', isMain || run.conclusion === 'startup_failure' ? 'priority:high' : 'priority:medium'];
  // GitHub's own creation date is a lower bound on any issue/comment that could already record this run.
  const started = Date.parse(run.created_at);
  const since = Number.isFinite(started) ? new Date(started - 1000).toISOString().slice(0, 10) + 'T00:00:00Z' : null;
  const date = Date.parse(run.updated_at ?? run.created_at);
  const receiptDay = Number.isFinite(date) ? new Date(date).toISOString().slice(0, 10) : 'unknown';
  const compact = '[' + run.id + ', attempt ' + run.run_attempt + '](' + url + ') · `' + run.conclusion + '`' +
    (hexSha(run.head_sha) ? ' · [`' + run.head_sha.slice(0, 12) + '`](' + root + '/commit/' + run.head_sha + ')' : '') +
    (prs.length ? ' · ' + prs.slice(0, 10).map(n => '[PR #' + n + '](' + root + '/pull/' + n + ')').join(', ') : '');
  return { contextKey, fingerprint, attemptKey, since, receiptDay, compact, title, evidence: evidence.join('\n\n'), recommendation, labels, workflow, isMain };
}

export function createWorkflowFailureReporter({ api, catalog, repository = REPOSITORY, ensureMainRedIssue }) {
  const root = '/repos/' + repository + '/issues';
  const contexts = new Map(), attempts = new Map(), indexed = new Set(), comments = new Map();
  const externalReceipts = [];
  let openLoaded = false, closedSince, routingLabelVerified = false;
  async function pages(path) {
    const rows = [];
    for (let page = 1; page <= 100; page++) {
      const items = await api(path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
      if (!Array.isArray(items)) throw new Error('workflow_issue_inventory_unreadable');
      rows.push(...items);
      if (items.length < 100) return rows;
    }
    throw new Error('workflow_issue_inventory_incomplete');
  }
  function index(issue) {
    if (!trusted(issue) || indexed.has(issue.number)) return;
    indexed.add(issue.number);
    const body = String(issue.body || '');
    const marker = /<!-- studioos-workflow-attempt:v1 ([0-9]+:[0-9]+:[0-9]+) -->/.exec(body);
    if (marker) attempts.set(marker[1], issue.number);
    const context = /<!-- studioos-workflow-context:v1 ([a-f0-9]{64}) -->/.exec(body);
    if (context) {
      if (!contexts.has(context[1])) contexts.set(context[1], []);
      contexts.get(context[1]).push(issue);
    } else {
      // Adopted incidents keep their original bodies. Their verified comments hold our receipts.
      externalReceipts.push(issue);
    }
  }
  async function inventory(record) {
    const query = '&labels=workflow-failure&sort=created&direction=desc';
    if (!openLoaded) {
      (await pages(root + '?state=open' + query)).forEach(index);
      openLoaded = true;
    }
    if (closedSince === undefined || (closedSince !== null && (!record.since || record.since < closedSince))) {
      const since = record.since ? '&since=' + encodeURIComponent(record.since) : '';
      (await pages(root + '?state=closed' + query + since)).forEach(index);
      closedSince = record.since;
    }
  }
  async function loadComments(issue, since) {
    const previous = comments.get(issue.number);
    if (previous && (previous.since === null || (since && previous.since <= since))) return previous;
    const query = since ? '?since=' + encodeURIComponent(since) : '';
    const entries = await pages(root + '/' + issue.number + '/comments' + query);
    const result = { since, chunks: new Map() };
    for (const row of entries) {
      if (!GITHUB_OWNERS.has(row.user?.login)) continue;
      const body = String(row.body || '');
      for (const match of body.matchAll(/<!-- studioos-workflow-attempt:v1 ([0-9]+:[0-9]+:[0-9]+) -->/g)) attempts.set(match[1], issue.number);
      const batch = /^<!-- studioos-workflow-recurrences:v1 ([0-9-]+|unknown) -->/.exec(body);
      if (batch && row.user.login === 'github-actions[bot]' && numberId(row.id)) result.chunks.set(batch[1], row);
    }
    comments.set(issue.number, result);
    return result;
  }
  async function append(issue, record, occurrence) {
    const history = await loadComments(issue, record.since);
    if (attempts.has(record.attemptKey)) return { action: 'duplicate', issueNumber: attempts.get(record.attemptKey) };
    // One editable bot comment per day/chunk. Keep exact links, without notifying every subscriber per repeat.
    const day = record.receiptDay;
    const header = '<!-- studioos-workflow-recurrences:v1 ' + day + ' -->\n**Recorded failing attempts**';
    const line = '\n\n- ' + record.compact + ' ' + occurrence;
    const previous = history.chunks.get(day);
    let updated;
    if (previous && previous.body.length + line.length <= 48_000) {
      updated = await api(root + '/comments/' + previous.id, { method: 'PATCH', body: JSON.stringify({ body: previous.body + line }) });
    } else {
      // The first entry in a batch supplies the exact failed jobs; every subsequent one links the attempt.
      updated = await api(root + '/' + issue.number + '/comments', { method: 'POST', body: JSON.stringify({ body: header + '\n\n' + record.evidence + line }) });
    }
    if (!numberId(updated?.id) || !String(updated.body).includes(occurrence)) throw new Error('workflow_issue_comment_unconfirmed');
    attempts.set(record.attemptKey, issue.number);
    history.chunks.set(day, updated);
    return { action: 'updated', issueNumber: issue.number };
  }
  async function report(input) {
    const record = normalizeWorkflowFailure(input, catalog, repository);
    if (!record) return { action: 'ignored', reason: 'non_actionable' };
    const occurrence = occurrenceMarker(record.attemptKey), group = groupMarker(record.fingerprint);
    await inventory(record);
    const related = contexts.get(record.contextKey) || [];
    if (!attempts.has(record.attemptKey)) {
      // A reused canonical issue can close, be renamed, or lose its attribution hint before webhook redelivery.
      for (const issue of [...related, ...externalReceipts]) {
        // An issue last touched before this run cannot already contain its attempt marker.
        if (record.since && Date.parse(issue.updated_at) < Date.parse(record.since)) continue;
        await loadComments(issue, record.since);
        if (attempts.has(record.attemptKey)) break;
      }
    }
    if (attempts.has(record.attemptKey)) return { action: 'duplicate', issueNumber: attempts.get(record.attemptKey) };
    const ciWorkflow = record.workflow === '.github/workflows/ci.yml';
    let mainNumber = ciWorkflow && numberId(input.inheritedIssueNumber) ? input.inheritedIssueNumber : null;
    if (mainNumber === null && ensureMainRedIssue && ciWorkflow && record.isMain && input.run.event === 'push' &&
        input.currentMainRed === true && mainState(input.run.conclusion) === true) {
      // Both sources share D5663's health episode and its serialized job. A failed write must be retried.
      mainNumber = await ensureMainRedIssue(input.run, record.labels);
    }
    const inherited = numberId(mainNumber);
    const known = numberId(input.existingIssueNumber) && EXISTING_INCIDENTS[input.existingIssueNumber]?.includes(record.workflow);
    if (inherited || known) {
      const number = inherited ? mainNumber : input.existingIssueNumber;
      const existing = await api(root + '/' + number);
      const mainTitle = ALERT_KINDS['main-red'].title;
      const mainIncident = existing?.title === mainTitle ||
        (existing?.user?.login === 'guillaumelauzier' && existing.title?.startsWith(mainTitle + ': '));
      if (trusted(existing) && existing.number === number && (!inherited || mainIncident)) {
        await loadComments(existing, record.since);
        if (attempts.has(record.attemptKey)) return { action: 'duplicate', issueNumber: attempts.get(record.attemptKey) };
        if (existing.state === 'open') {
          if (!(existing.labels || []).some(label => (label?.name ?? label) === 'workflow-failure')) {
            // Mark the existing target before appending so a fresh sweep can discover even an ambiguous receipt.
            const labels = await api(root + '/' + number + '/labels', {
              method: 'POST', body: JSON.stringify({ labels: ['workflow-failure'] }),
            });
            if (!Array.isArray(labels) || !labels.some(label => label?.name === 'workflow-failure')) {
              throw new Error('workflow_issue_receipt_index_unconfirmed');
            }
          }
          index(existing);
          return append(existing, record, occurrence);
        }
      }
    }
    const open = related.find(issue => issue.state === 'open' && String(issue.body || '').includes(group));
    if (open) return append(open, record, occurrence);
    // Backfill and replay discover our issues through this label. Wait until label sync has provisioned it.
    if (!routingLabelVerified) {
      const label = await api('/repos/' + repository + '/labels/workflow-failure');
      if (label?.name !== 'workflow-failure') throw new Error('workflow_failure_label_unavailable');
      routingLabelVerified = true;
    }
    const body = [record.evidence, '**Repair** ' + record.recommendation, '<!-- studioos-workflow-context:v1 ' + record.contextKey + ' -->', group, occurrence].join('\n\n');
    const issue = await api(root, { method: 'POST', body: JSON.stringify({ title: record.title, body, labels: record.labels }) });
    if (!numberId(issue?.number)) throw new Error('workflow_issue_creation_unconfirmed');
    index({ ...issue, body, state: 'open' });
    return { action: 'created', issueNumber: issue.number };
  }
  // Callers serialize GitHub jobs/Worker invocations across processes. Also serialize parallel calls within a sweep.
  let previous = Promise.resolve();
  return { report(input) {
    const current = previous.then(() => report(input));
    previous = current.catch(() => {
      openLoaded = false; closedSince = undefined;
      contexts.clear(); attempts.clear(); indexed.clear(); comments.clear(); externalReceipts.length = 0;
    });
    return current;
  } };
}
