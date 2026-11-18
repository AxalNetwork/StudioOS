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
import { classify, consent, decide, groupRunFor, KIND } from './ejection-rules.mjs';
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
    ... on LabeledEvent{createdAt label{name}}}}}}}}`;

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
    };
  });
}

/** Open PRs whose newest queue event is a removal this handler has not labelled yet. */
export function candidates(prs) {
  return prs.filter((p) => {
    if (p.state !== 'open' || p.inMergeQueue !== false) return false;
    const lastRemoved = p.removed.map((e) => e.at).sort().pop();
    const lastAdded = p.added.map((e) => e.at).sort().pop();
    if (!lastRemoved || (lastAdded && lastAdded > lastRemoved)) return false;
    return !(p.ejectedLabelAt && p.ejectedLabelAt >= lastRemoved);
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
  let todo = candidates(prs);
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
    const files = (await gh.get(`pulls/${pr.number}/files?per_page=100`)).map((f) => ({ path: f.filename, previousPath: f.previous_filename }));
    const commits = await gh.get(`pulls/${pr.number}/commits?per_page=100`);
    let ev;
    try { ev = await evidence(pr.number, pr.head.sha); } catch (e) { ev = { ok: false, headSha: null, detail: `evidence unreadable: ${String(e?.message ?? e).slice(0, 120)}` }; }
    const fresh = await gh.get(`pulls/${pr.number}`);
    const d = decide({
      klass: k.class, stillConflicting: fresh.mergeable === false, consent: consent({ ...pr, commits }, { botLogin }),
      checksGreenOnHead: ev.ok === true, checksDetail: ev.detail,
      headUnchangedSinceChecks: fresh.head?.sha === pr.head.sha && ev.headSha === pr.head.sha,
      eligible: eligible(pr, { env, event: env.GITHUB_EVENT_NAME, dispatchPr, repo: env.GITHUB_REPOSITORY, files, kind: KIND, breakers: brk }),
      breakers: brk, openAlertTitles, requeues, pr: pr.number, now, env, queueRuns,
    });
    const minutes = Math.round((now - Date.parse(removal.at)) / 60_000);
    const line = `#${pr.number}: ${k.class} (${k.why}); ${d.action}${d.reasons.length ? ` — ${d.reasons.join('; ')}` : ''}; ${minutes} min after the ejection; auto-merge ${pr.autoMerge ? 'still set' : 'not set'}`;
    say(`- ${line}`);
    if (!app) continue;
    if (d.action === 'requeue') {
      await app.graph('mutation($id:ID!,$oid:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$id,expectedHeadOid:$oid}){clientMutationId}}', { id: pr.id, oid: pr.head.sha })
        .catch(() => { throw new Error(`enqueue of #${pr.number} failed`); });
    } else if (d.action === 'keeper') keeper.push(pr.number);
    else {
      await app.post(`issues/${pr.number}/labels`, { labels: [LABELS.ejected] });
      if (d.action === 'repair') repair.push(pr.number);
    }
    const comments = await gh.get(`issues/${pr.number}/comments?per_page=100`);
    const mine = stickyComment(comments, botLogin);
    const body = renderSticky([`Queue ejection: **${k.class}**. ${k.why}.`, d.action === 'requeue' ? 'Restored to the merge queue on the same head.' : `Not restored: ${d.reasons.join('; ') || d.action}.`]);
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
