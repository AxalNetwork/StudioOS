// Read the trusted base implementation and GitHub-owned facts for #6481.
// This adapter has no GitHub mutation. The write credential belongs to the enqueue step.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { owningSlot, prIssue } from './rules.mjs';

const exec = promisify(execFile);
const classifier = fileURLToPath(new URL('../merge-policy.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const SHA = /^[0-9a-f]{40}$/;
const CI_PATH = '.github/workflows/ci.yml';
const FULL_SUITE = 'test:drift (full suite)';
const ACTIONS_APP_ID = 15368;
const positive = n => Number.isSafeInteger(n) && n > 0;
const queueQuery = `query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    mergeQueue(branch: "main") { configuration { maximumEntriesToBuild } entries(first: 1) { totalCount } }
  }
}`;
// #8076: the queue's entries with what admission needs: labels and the body that names the PR's issue.
const entriesQuery = `query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    mergeQueue(branch: "main") { entries(first: 100) { totalCount nodes { pullRequest { number body labels(first: 50) { totalCount nodes { name } } } } } }
  }
}`;
const historyQuery = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id headRefOid isInMergeQueue
      timelineItems(first: 1, itemTypes: [ADDED_TO_MERGE_QUEUE_EVENT, REMOVED_FROM_MERGE_QUEUE_EVENT]) { totalCount }
    }
  }
}`;

// #6467 binds repair kinds to commits from the landing App. A label can be removed;
// refusing incomplete attribution and all unclassified bot commits preserves the owner lane.
// An original agent session acting under a user identity is distinct from an automated repair.
export function repairStatus(commits, {botLogin} = {}) {
  if (!Array.isArray(commits) || !commits.length) return null;
  let unknown = false;
  for (const c of commits) {
    if (!SHA.test(c?.sha ?? '') || typeof c.commit?.message !== 'string') return null;
    const kind = /^Landing-Bot-Kind:[ \t]*([^\r\n]+)$/im.exec(c.commit.message);
    if (kind && ['red-pr', 'conflict', 'main-repair', 'scan-fix'].includes(kind[1].trim().toLowerCase())) return true;
    // Owner, 2026-11-17 (audit P1): the branch keeper's merge of main is no-model. It counts as such only when it is
    // a two-parent merge made by the landing App itself (LANDING_BOT_LOGIN); unset, it stays uncertain and is refused.
    if (kind && kind[1].trim().toLowerCase() === 'keeper' && botLogin && c.parents?.length === 2 &&
        [c.author, c.committer].some(actor => actor?.login === botLogin && actor?.type === 'Bot')) continue;
    if (kind || [c.author, c.committer].some(actor => !positive(actor?.id) || actor.type !== 'User')) unknown = true;
  }
  return unknown ? null : false;
}

// Both object IDs are verified against GitHub's PR/workflow identity. Fetch Git
// objects only. Execute only the classifier from the trusted workflow checkout.
async function classifyDiff(repo, base, head) {
  if (![base, head].every(sha => SHA.test(sha))) throw new Error('Invalid classification commits');
  const options = {
    cwd: root, env: {PATH: process.env.PATH, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', HOME: '/dev/null'},
    maxBuffer: 8 * 1024 * 1024, timeout: 120_000,
  };
  await exec('git', ['-c', 'credential.helper=', 'fetch', '--no-tags', '--no-recurse-submodules',
    `https://github.com/${repo}.git`, base, head], options);
  const {stdout} = await exec(process.execPath, [classifier, '--base', base, '--head', head], options);
  return JSON.parse(stdout);
}

async function loadList() {
  // Dynamic so the default-off workflow can land independently of #6469.
  const list = await import('../landing-list.mjs');
  if (typeof list.collect !== 'function') throw new Error('Missing #6469 landing list collector');
  return list.collect;
}

export function createGitHubReader({repo, token, fetchImpl = fetch, classify = classifyDiff,
  loadOrderedList = loadList, botLogin} = {}) {
  if (!/^[\w-]+\/[\w.-]+$/.test(repo ?? '') || !token) throw new Error('A repository and read token are required');
  const [owner, name] = repo.split('/');
  let calls = 0;
  async function request(path, graphInput) {
    if (++calls > 1600) throw new Error('Feeder read request limit reached');
    const url = new URL(path, 'https://api.github.com/');
    if (url.origin !== 'https://api.github.com') throw new Error('Invalid GitHub endpoint');
    const response = await fetchImpl(url.href, {
      method: graphInput ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json'},
      ...(graphInput ? {body: JSON.stringify(graphInput)} : {}),
    });
    if (!response.ok) throw Object.assign(new Error(`GitHub read failed (HTTP ${response.status})`), {status: response.status});
    return response.json();
  }
  const get = path => {
    if (typeof path !== 'string' || path.startsWith('/') || path.split(/[/?]/).some(p => ['.', '..'].includes(p))) {
      throw new Error('Expected repository-relative API path');
    }
    return request(`repos/${repo}/${path}`);
  };
  const graph = async (query, variables = {}) => {
    const data = await request('graphql', {query, variables: {owner, repo: name, ...variables}});
    if (data.errors?.length || !data.data?.repository) throw new Error('Incomplete GitHub GraphQL result');
    return data.data.repository;
  };
  async function pages(path, key, maxPages) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const result = await get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const rows = key ? result[key] : result;
      if (!Array.isArray(rows)) throw new Error('Unreadable GitHub list');
      out.push(...rows);
      if (rows.length < 100 || (key && result.total_count === out.length)) return out;
    }
    throw new Error('GitHub list exceeded the bounded scan');
  }
  async function checkSource(number, sha, checkRuns, jobName, workflow) {
    const runs = checkRuns.filter(r => r.name === jobName && r.app?.id === ACTIONS_APP_ID);
    if (runs.length !== 1 || runs[0].head_sha !== sha || runs[0].conclusion !== 'success' ||
        runs[0].status !== 'completed' || !positive(runs[0].id)) return null;
    const job = await get(`actions/jobs/${runs[0].id}`);
    if (job.name !== jobName || job.head_sha !== sha || job.conclusion !== 'success' ||
        job.status !== 'completed' || job.id !== runs[0].id || !positive(job.run_id)) return null;
    const run = await get(`actions/runs/${job.run_id}`);
    const pr = run.pull_requests?.find(p => p.number === number && p.head?.sha === sha && p.base?.ref === 'main');
    if (run.id !== job.run_id || run.event !== 'pull_request' || run.path !== workflow ||
        run.head_sha !== sha || run.repository?.full_name !== repo || !pr) return null;
    return {check: runs[0], base: pr.base.sha};
  }
  async function jobLog(id) {
    const url = `https://api.github.com/repos/${repo}/actions/jobs/${id}/logs`;
    let response = await fetchImpl(url, {headers: {Authorization: `Bearer ${token}`}, redirect: 'manual',
      signal: AbortSignal.timeout(30_000)});
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const dest = new URL(response.headers.get('location'), url);
      if (dest.protocol !== 'https:' || dest.origin === 'https://api.github.com' || dest.username || dest.password) {
        throw new Error('Unexpected GitHub log redirect');
      }
      // GitHub returns a short-lived artifact host URL. Never send the API token to it.
      response = await fetchImpl(dest.href, {redirect: 'error', signal: AbortSignal.timeout(30_000)});
    }
    if (!response.ok || !response.body) throw new Error('Landing policy log unavailable');
    const parts = [];
    let bytes = 0;
    for await (const part of response.body) {
      bytes += part.length;
      if (bytes > 2 * 1024 * 1024) throw new Error('Landing policy log exceeded limit');
      parts.push(Buffer.from(part));
    }
    return Buffer.concat(parts).toString('utf8');
  }
  async function alertList() {
    const q = encodeURIComponent(`repo:${repo} is:open is:issue "[alert]" in:title`);
    const alerts = await request(`search/issues?q=${q}&per_page=100`);
    if (alerts.incomplete_results !== false || !Array.isArray(alerts.items) || alerts.items.length !== alerts.total_count) {
      throw new Error('Incomplete alert history');
    }
    return alerts.items;
  }
  const checkRunsFor = sha => pages(`commits/${sha}/check-runs?filter=latest`, 'check_runs', 3);
  // main's required contexts, each kept only from the app its rule names (source restrictions).
  const sourceMatched = (rules, checks) => {
    const contexts = rules.filter(r => r.type === 'required_status_checks').flatMap(r => r.parameters.required_status_checks);
    return checks.filter(c => contexts.filter(ctx => ctx.context === c.name)
      .every(ctx => !positive(ctx.integration_id) || ctx.integration_id === c.app?.id));
  };
  const slotCache = new Map();
  return {
    get,
    /**
     * Audit 2026-11-17 (P0): the evidence that a PR's current head may re-enter the queue. Every context main's rules
     * require, from the app the rule names, `success` on this exact head (skipped and neutral are not green), and a
     * full-suite job proven to be ci.yml's pull_request run for this PR and head. Check runs are read to the end of
     * their pages; one unrelated success can qualify nothing.
     */
    async readHeadEvidence(number, expectedSha) {
      if (!positive(number)) throw new Error('Invalid pull request number');
      const policy = await import('../lib/landPr.mjs');
      const pull = await get(`pulls/${number}`);
      const headSha = pull.head?.sha;
      if (pull.number !== number || !SHA.test(headSha ?? '')) throw new Error('Incomplete PR head for the evidence read');
      if (expectedSha && headSha !== expectedSha) return {headSha, ok: false, fullSuitePassed: false, required: null, detail: 'the head moved since it was read'};
      const [rules, checks] = await Promise.all([get('rules/branches/main'), checkRunsFor(headSha)]);
      if (!Array.isArray(rules)) throw new Error('Unreadable main rules');
      const {required} = policy.mainRules(rules);
      const req = policy.requiredChecks(required, sourceMatched(rules, checks), headSha);
      const fullSuitePassed = Boolean(await checkSource(number, headSha, checks, FULL_SUITE, CI_PATH));
      const ok = req.ok && fullSuitePassed;
      const detail = ok ? req.detail : [req.ok ? null : req.detail, fullSuitePassed ? null : 'no trusted full-suite run on this head'].filter(Boolean).join('; ');
      return {headSha, ok, fullSuitePassed, required: req, detail};
    },
    async readLandingDecision(number) {
      if (!positive(number)) throw new Error('Invalid pull request number');
      const policy = await import('../lib/landPr.mjs');
      const pull = await get(`pulls/${number}`);
      const head = pull.head?.sha;
      if (pull.number !== number || !SHA.test(head ?? '') || !positive(pull.changed_files) || pull.changed_files >= 3000) {
        throw new Error('Incomplete PR head for the landing decision');
      }
      const [settings, rules, admissionIssue, files, checks, activeAlerts] = await Promise.all([
        request(`repos/${repo}`), get('rules/branches/main'), get(`issues/${policy.ADMISSION_ISSUE}`),
        pages(`pulls/${number}/files`, null, 30), checkRunsFor(head), alertList(),
      ]);
      if (!Array.isArray(rules) || files.length !== pull.changed_files) throw new Error('Incomplete landing decision facts');
      // Source restrictions are part of required checks on StudioOS. Preserve those
      // when passing the matching runs into the shared name-based decision helper.
      const matchingChecks = sourceMatched(rules, checks);
      const source = await checkSource(number, head, checks, policy.POLICY_CHECK, policy.POLICY_WORKFLOW);
      const pr = {number, state: pull.state, merged: pull.merged, draft: pull.draft, base_ref: pull.base?.ref,
        head_sha: head, auto_merge: pull.auto_merge};
      let report = null;
      if (source && files.every(f => f.filename !== policy.POLICY_WORKFLOW && f.previous_filename !== policy.POLICY_WORKFLOW)) {
        const log = policy.parseLandingLog(await jobLog(source.check.id));
        if (log.prNumber === number && log.headSha === head && log.baseSha === source.base &&
            log.checkout === 'success' && log.fetchedHead && log.landingAuto === true) {
          const result = await classify(repo, source.base, head);
          report = {baseSha: source.base, headSha: head, landingAuto: true, tier: result.tier, source: 'trusted checkout'};
        }
      }
      const facts = {repo: settings, rules, admissionIssue, pr, files, checkRuns: matchingChecks,
        landing: {checkRun: source?.check, report}, alerts: activeAlerts};
      return {pr, report, ...policy.decide(facts)};
    },
    async readOrderedList() {
      const collect = await loadOrderedList();
      const result = await collect({api(method, path) {
        if (method !== 'GET') throw new Error('Read-only landing list');
        return get(path);
      }});
      if (result.partial !== false || !Array.isArray(result.entries)) throw new Error('Incomplete #6469 landing order');
      return result.entries;
    },
    async readMainHealth() {
      const [main, groups, alerts] = await Promise.all([
        get('actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=1'),
        get('actions/workflows/ci.yml/runs?event=merge_group&status=completed&per_page=20'),
        alertList(),
      ]);
      if (!Array.isArray(main.workflow_runs) || !Array.isArray(groups.workflow_runs)) {
        throw new Error('Incomplete CI or alert history');
      }
      const recentGroupRuns = groups.workflow_runs;
      if (recentGroupRuns.some(r => r.path !== CI_PATH || r.event !== 'merge_group' || r.status !== 'completed' || typeof r.conclusion !== 'string')) {
        throw new Error('Unverified queue run in the failure history');
      }
      return {mainRuns: main.workflow_runs, openAlertTitles: alerts.map(i => i.title), recentGroupRuns};
    },
    async readQueueState() {
      const {mergeQueue} = await graph(queueQuery);
      const queuedCount = mergeQueue?.entries?.totalCount;
      const buildLimit = mergeQueue?.configuration?.maximumEntriesToBuild;
      if (!positive(buildLimit) || !Number.isSafeInteger(queuedCount) || queuedCount < 0) throw new Error('Unreadable merge queue capacity');
      return {freeQueueSlots: Math.max(0, buildLimit - queuedCount), queuedCount, buildLimit};
    },
    /**
     * #8076 (D8076): every merge-queue entry as { number, labels, slot }. Incomplete pages throw, and the feeder then
     * holds every candidate. A slot comes from the issue the PR body names (`owningSlot`).
     */
    async readQueueEntries() {
      const {mergeQueue} = await graph(entriesQuery);
      const conn = mergeQueue?.entries;
      if (!Number.isSafeInteger(conn?.totalCount) || !Array.isArray(conn.nodes) || conn.nodes.length !== conn.totalCount) {
        throw new Error('Unreadable merge queue entries');
      }
      const out = [];
      for (const node of conn.nodes) {
        const pr = node?.pullRequest;
        if (!positive(pr?.number) || !Array.isArray(pr.labels?.nodes) || pr.labels.nodes.length !== pr.labels.totalCount) {
          throw new Error('Unreadable merge queue entry');
        }
        out.push({number: pr.number, labels: pr.labels.nodes.map(l => l.name), slot: await this.readOwningSlot(pr)});
      }
      return out;
    },
    /** #8076: the PR's slot: 'S07', '' when its body names no issue or the issue has no slot label. A read error throws. */
    async readOwningSlot(pull) {
      const n = prIssue(pull?.body);
      if (!n) return '';
      if (!slotCache.has(n)) slotCache.set(n, get(`issues/${n}`).then(issue => owningSlot(pull.body, issue) ?? ''));
      return slotCache.get(n);
    },
    /** #6481 (D6481-p2): the landing rules issue's state; scheduled sweeps wait until it is closed as completed. */
    async readRulesIssue() {
      const issue = await get('issues/6480');
      return {number: issue?.number, state: issue?.state, state_reason: issue?.state_reason ?? null};
    },
    async readCandidate(number) {
      if (!positive(number)) throw new Error('Invalid pull request number');
      const pull = await get(`pulls/${number}`);
      const headSha = pull.head?.sha;
      if (pull.number !== number || !SHA.test(headSha ?? '') || !positive(pull.commits) || pull.commits > 250 ||
          !positive(pull.changed_files) || pull.changed_files >= 3000) throw new Error('Incomplete PR or unsupported file/commit count');
      const [rawFiles, commits, state, fullSuitePassed] = await Promise.all([
        pages(`pulls/${number}/files`, null, 30), pages(`pulls/${number}/commits`, null, 3),
        graph(historyQuery, {number}), checkRunsFor(headSha).then(checks => checkSource(number, headSha, checks, FULL_SUITE, CI_PATH)).then(Boolean),
      ]);
      const history = state.pullRequest;
      if (history?.id !== pull.node_id || history?.headRefOid !== headSha || typeof history?.isInMergeQueue !== 'boolean' ||
          !Number.isSafeInteger(history.timelineItems?.totalCount) || history.timelineItems.totalCount < 0 ||
          rawFiles.length !== pull.changed_files || commits.length !== pull.commits || commits.at(-1)?.sha !== headSha) {
        throw new Error('Candidate head changed or GitHub returned incomplete evidence');
      }
      const files = rawFiles.map(f => {
        if (typeof f.filename !== 'string' || !f.filename) throw new Error('Unreadable PR file');
        return {path: f.filename, previousPath: f.previous_filename};
      });
      // #6481 (D6481-p2): a pull_request run executes the PR's own ci.yml, so its job names prove nothing when the PR
      // edits that file. Only a run of the unchanged workflow counts as full-suite proof.
      const ciEdited = files.some(f => f.path === CI_PATH || f.previousPath === CI_PATH);
      return {pull, files, commits, headSha, number, fullSuitePassed: fullSuitePassed && !ciEdited,
        modelRepaired: repairStatus(commits, {botLogin}),
        alreadyQueued: history.isInMergeQueue || Boolean(pull.auto_merge), priorQueueEntry: history.timelineItems.totalCount > 0};
    },
  };
}
