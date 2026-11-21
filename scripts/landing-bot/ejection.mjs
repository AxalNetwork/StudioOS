#!/usr/bin/env node
// #6476: the queue ejection handler: classify each ejection, label it, and restore only an entry a person made.
/**
 *   node ejection.mjs   reads with GH_TOKEN; writes with EJECTION_APP_TOKEN (labels, one comment, enqueue);
 *                       writes the outputs `keeper` and `repair` (PR numbers for the separate dispatch job)
 *
 * One sweep reads the 100 most recently updated PRs (open and closed) in one GraphQL call, so a bot re-queue of a
 * PR that has since merged still counts against the daily caps.
 */
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eligible, LABELS, renderSticky, stickyComment, verdictFor } from './rules.mjs';
import { classify, consent, decide, evidenceState, groupRunFor, keeperMergedSince, KIND, RETRY_CUTOVER, STRANDED_DAYS } from './ejection-rules.mjs';
import { client, readBreakers } from './keeper.mjs';
import { createGitHubReader } from './feeder-github.mjs';

const Q = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(first:100,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{
  id number state isDraft body isInMergeQueue mergeable headRefName headRefOid
  headRepository{nameWithOwner} baseRepository{nameWithOwner} labels(first:50){nodes{name}}
  autoMergeRequest{enabledAt enabledBy{login __typename}}
  timelineItems(last:40,itemTypes:[ADDED_TO_MERGE_QUEUE_EVENT,REMOVED_FROM_MERGE_QUEUE_EVENT,LABELED_EVENT]){nodes{
    __typename
    ... on AddedToMergeQueueEvent{createdAt actor{login __typename}}
    ... on RemovedFromMergeQueueEvent{createdAt actor{login __typename} reason beforeCommit{oid}}
    ... on LabeledEvent{createdAt actor{login __typename} label{name}}}}}}}}`;

const actor = (a) => (a ? { login: a.login, type: a.__typename } : null);

/** Normalise the GraphQL nodes. */
export function normalise(nodes) {
  return nodes.map((n) => {
    const items = n.timelineItems?.nodes || [];
    return {
      id: n.id, number: n.number, state: String(n.state).toLowerCase(), draft: n.isDraft, body: n.body,
      inMergeQueue: n.isInMergeQueue, mergeable: n.mergeable,
      labels: (n.labels?.nodes || []).map((l) => l.name),
      head: { ref: n.headRefName, sha: n.headRefOid, repo: { full_name: n.headRepository?.nameWithOwner ?? null } },
      base: { repo: { full_name: n.baseRepository?.nameWithOwner ?? null } },
      autoMerge: n.autoMergeRequest ? { enabledAt: n.autoMergeRequest.enabledAt, enabledBy: actor(n.autoMergeRequest.enabledBy) } : null,
      added: items.filter((i) => i.__typename === 'AddedToMergeQueueEvent').map((i) => ({ at: i.createdAt, actor: actor(i.actor) })),
      removed: items.filter((i) => i.__typename === 'RemovedFromMergeQueueEvent').map((i) => ({ at: i.createdAt, actor: actor(i.actor), reason: i.reason, before: i.beforeCommit?.oid ?? null })),
      ejectedLabelAt: items.filter((i) => i.__typename === 'LabeledEvent' && i.label?.name === LABELS.ejected).map((i) => i.createdAt).sort().pop() ?? null,
      ejectedLabels: items.filter((i) => i.__typename === 'LabeledEvent' && i.label?.name === LABELS.ejected).map((i) => ({ at: i.createdAt, actor: actor(i.actor) }))
        .sort((a, b) => (a.at < b.at ? -1 : 1)),
    };
  });
}

/**
 * Open PRs whose newest queue event is a removal not yet handed back. An \`ejected\` label at or after the removal is
 * a hand-back, with one exception (#6476 S1): a label the App itself wrote before RETRY_CUTOVER, when it labelled
 * even the retryable cases, on a removal under STRANDED_DAYS old, is \`stranded\` and gets a fresh, bounded look. A
 * label a person added is never second-guessed, and neither is an \`ejected\` label on a PR's other removals.
 */
export function candidates(prs, { botLogin, now = Date.now() } = {}) {
  return prs.flatMap((p) => {
    if (p.state !== 'open' || p.inMergeQueue !== false) return [];
    const lastRemoved = p.removed.map((e) => e.at).sort().pop();
    const lastAdded = p.added.map((e) => e.at).sort().pop();
    if (!lastRemoved || (lastAdded && lastAdded > lastRemoved)) return [];
    const after = (p.ejectedLabels || (p.ejectedLabelAt ? [{ at: p.ejectedLabelAt, actor: null }] : [])).filter((l) => l.at >= lastRemoved);
    if (!after.length) return [{ ...p, stranded: false }];
    const newest = after[after.length - 1];
    const byApp = Boolean(botLogin) && newest.actor?.login === botLogin;
    const old = Date.parse(newest.at) < Date.parse(RETRY_CUTOVER);
    const fresh = now - Date.parse(lastRemoved) < STRANDED_DAYS * 24 * 60 * 60 * 1000;
    const stillLabelled = (p.labels || []).includes(LABELS.ejected);
    return byApp && old && fresh && stillLabelled ? [{ ...p, stranded: true }] : [];
  });
}

/** The bot's own re-queues: queue entries its App made, from the PRs read. */
export function botRequeues(prs, botLogin) {
  return prs.flatMap((p) => p.added.filter((e) => e.actor?.login === botLogin).map((e) => ({ pr: p.number, at: e.at })));
}

// Values come from the API. A line break in one would start a second `key=value` line in GITHUB_OUTPUT (an output
// another step trusts), so each is written on one line, with only safe characters in the key.
export const oneLine = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ');
const out = (k, v) => {
  if (!/^[a-z_]+$/.test(k)) throw new Error(`bad output name ${k}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${oneLine(v)}\n`);
};
const say = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${oneLine(s)}\n`); };

/** The sticky comment's second line: restored, waiting (and until when), or handed back. */
export function stickyLine(d) {
  if (d.action === 'requeue') return 'Restored to the merge queue on the same head.';
  if (d.action === 'keeper') return 'Waiting: the branch keeper is asked to merge main; this handler looks again.';
  if (d.action === 'wait') return `Waiting, not labelled: ${d.reasons.join('; ')}. Looked at again each sweep until ${d.retryUntil}; then handed back.`;
  return `Not restored: ${d.reasons.join('; ') || d.action}.`;
}

async function ciRuns(gh, query) {
  return (await gh.get(`actions/workflows/ci.yml/runs?${query}&per_page=50`)).workflow_runs || [];
}
async function withJobs(gh, run) {
  if (!run) return null;
  const jobs = (await gh.get(`actions/runs/${run.id}/jobs?per_page=100`)).jobs || [];
  return { conclusion: run.conclusion, jobs: jobs.map((j) => ({ name: j.name, conclusion: j.conclusion, steps: j.steps })) };
}

export async function sweep(env, {
  gh = client({ repo: env.GITHUB_REPOSITORY, token: env.GH_TOKEN }),
  app = env.EJECTION_APP_TOKEN ? client({ repo: env.GITHUB_REPOSITORY, token: env.EJECTION_APP_TOKEN }) : null,
  now = Date.now(),
  // The same trusted current-head evidence first admission reads (feeder-github.mjs).
  evidence = (number, sha) => createGitHubReader({ repo: env.GITHUB_REPOSITORY, token: env.GH_TOKEN }).readHeadEvidence(number, sha),
} = {}) {
  const botLogin = env.LANDING_BOT_LOGIN;
  const prs = normalise((await gh.graph(Q, {})).pullRequests.nodes);
  const dispatchPr = env.EJECTION_PR ? Number(env.EJECTION_PR) : null;
  let todo = candidates(prs, { botLogin, now });
  if (dispatchPr) todo = todo.filter((p) => p.number === dispatchPr);
  const brk = await readBreakers(gh, env);
  let openAlertTitles = null;
  try { openAlertTitles = (await gh.get('issues?state=open&per_page=100')).filter((i) => !i.pull_request).map((i) => i.title); } catch { /* null */ }
  const requeues = botRequeues(prs, botLogin);
  const queueRuns = (await ciRuns(gh, 'event=merge_group&status=completed')).slice(0, 20);
  const mainRun = (await ciRuns(gh, 'branch=main&event=push&status=completed'))[0] ?? null;
  const main = await withJobs(gh, mainRun);
  const keeper = [];
  const repair = [];
  for (const pr of todo) {
    const removal = [...pr.removed].sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    const queueRun = groupRunFor(await ciRuns(gh, 'event=merge_group'), pr, removal);
    const headRun = (await ciRuns(gh, `event=pull_request&head_sha=${pr.head.sha}`))[0] ?? null;
    const q = await withJobs(gh, queueRun);
    const k = classify({
      reason: removal.reason, actor: removal.actor, queueRun: q, headRun: headRun ? { conclusion: headRun.conclusion } : null,
      main, failedTests: [], flaky: [], infra: q ? verdictFor({ jobs: q.jobs, main }) === 'infra_failure' : false,
      mainRed: main?.conclusion !== 'success', record: null,
    });
    let files = null;
    try { files = (await gh.get(`pulls/${pr.number}/files?per_page=100`)).map((f) => ({ path: f.filename, previousPath: f.previous_filename })); } catch { /* eligible() waits on an unread diff */ }
    const commits = await gh.get(`pulls/${pr.number}/commits?per_page=100`);
    let ev;
    try { ev = await evidence(pr.number, pr.head.sha); } catch (e) { ev = { ok: false, headSha: null, required: null, detail: `evidence unreadable: ${String(e?.message ?? e).slice(0, 120)}` }; }
    const fresh = await gh.get(`pulls/${pr.number}`);
    const d = decide({
      klass: k.class, stillConflicting: fresh.mergeable === false, keeperMerged: keeperMergedSince(commits, removal.at, botLogin),
      removedAt: removal.at, consent: consent({ ...pr, commits }, { botLogin }),
      checks: evidenceState(ev, pr.head.sha), checksDetail: ev.detail,
      headUnchangedSinceChecks: fresh.head?.sha === pr.head.sha && ev.headSha === pr.head.sha,
      eligible: eligible(pr, { env, event: env.GITHUB_EVENT_NAME, dispatchPr, repo: env.GITHUB_REPOSITORY, files, kind: KIND, breakers: brk }),
      breakers: brk, openAlertTitles, requeues, pr: pr.number, now, env, queueRuns,
    });
    const minutes = Math.round((now - Date.parse(removal.at)) / 60_000);
    const line = `#${pr.number}: ${k.class} (${k.why}); ${d.action}${pr.stranded ? ' (stranded label, second look)' : ''}${d.reasons.length ? ` — ${d.reasons.join('; ')}` : ''}; ${minutes} min after the ejection; auto-merge ${pr.autoMerge ? 'still set' : 'not set'}`;
    say(`- ${line}`);
    if (!app) continue;
    if (d.action === 'requeue') {
      await app.graph('mutation($id:ID!,$oid:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$id,expectedHeadOid:$oid}){clientMutationId}}', { id: pr.id, oid: pr.head.sha })
        .catch(() => { throw new Error(`enqueue of #${pr.number} failed`); });
      // Only the App's own stranded label comes off, and only after the entry is back.
      if (pr.stranded) await app.del(`issues/${pr.number}/labels/${encodeURIComponent(LABELS.ejected)}`).catch(() => {});
    } else if (d.action === 'keeper') keeper.push(pr.number);
    else if (d.action !== 'wait') {
      if (!pr.labels.includes(LABELS.ejected)) await app.post(`issues/${pr.number}/labels`, { labels: [LABELS.ejected] });
      if (d.action === 'repair') repair.push(pr.number);
    }
    const comments = await gh.get(`issues/${pr.number}/comments?per_page=100`);
    const mine = stickyComment(comments, botLogin);
    const body = renderSticky([`Queue ejection: **${k.class}**. ${k.why}.`, stickyLine(d)]);
    // A repeated sweep with the same outcome writes nothing.
    if (mine && mine.body === body) continue;
    if (mine) await app.patch(`issues/comments/${mine.id}`, { body });
    else await app.post(`issues/${pr.number}/comments`, { body });
  }
  out('keeper', JSON.stringify(keeper));
  out('repair', JSON.stringify(repair));
  return { keeper, repair };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  sweep(process.env).catch((e) => { console.error(`ejection handler: ${String(e?.message || e).slice(0, 200)}`); process.exitCode = 1; });
}
