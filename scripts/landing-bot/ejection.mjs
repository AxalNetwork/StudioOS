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
import { classify, consent, decide, evidenceState, gateRequeue, groupRunFor, keeperMergedSince, KIND, requeuePolicy, RETRY_CUTOVER, STRANDED_DAYS } from './ejection-rules.mjs';
import { client, pages, readBreakers } from './keeper.mjs';
import { keeperAttempts } from './keeper-plan.mjs';
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
      keeperTriedEvents: items.filter((i) => i.__typename === 'LabeledEvent' && i.label?.name === LABELS.keeperTried).map((i) => ({ at: i.createdAt, actor: actor(i.actor) })),
      handedBackLabels: items.filter((i) => i.__typename === 'LabeledEvent' && i.label?.name === LABELS.handedBack).map((i) => ({ at: i.createdAt, actor: actor(i.actor) })),
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
    // Review on #8054 (P2, second round): the hand-back of a stranded removal is an add-only App label event, so it
    // is durable without rewriting \`ejected\`, survives an interrupted run (the next sweep adds it again) and never
    // touches a label a person changed.
    const handedBack = (p.handedBackLabels || []).some((l) => l.at >= lastRemoved && Boolean(botLogin) && l.actor?.login === botLogin);
    return byApp && old && fresh && stillLabelled && !handedBack ? [{ ...p, stranded: true }] : [];
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

/** Whether the newest \`ejected\` label event, read fresh, is still the App's own from before RETRY_CUTOVER. */
export async function stillAppsStrandedLabel(gh, number, botLogin) {
  let events;
  try { events = await gh.get(`issues/${number}/events?per_page=100`); } catch { return false; }
  if (!Array.isArray(events)) return false;
  const newest = events.filter((e) => e?.event === 'labeled' && e?.label?.name === LABELS.ejected).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).pop();
  return Boolean(newest) && Boolean(botLogin) && newest.actor?.login === botLogin && Date.parse(newest.created_at) < Date.parse(RETRY_CUTOVER);
}

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
  // The feeder's read-only GitHub reader (feeder-github.mjs), made on first use.
  reader = null,
  // The same trusted current-head evidence first admission reads (feeder-github.mjs).
  evidence = null,
  // D6476-p7: the same landing decision first admission reads (readLandingDecision(): landPr.decide() on this head).
  landing = null,
} = {}) {
  let shared = reader;
  const readerNow = () => (shared ??= createGitHubReader({ repo: env.GITHUB_REPOSITORY, token: env.GH_TOKEN, botLogin: env.LANDING_BOT_LOGIN || undefined }));
  const readEvidence = evidence ?? ((number, sha) => readerNow().readHeadEvidence(number, sha));
  const readLanding = landing ?? ((number) => readerNow().readLandingDecision(number));
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
    try { ev = await readEvidence(pr.number, pr.head.sha); } catch (e) { ev = { ok: false, headSha: null, required: null, detail: `evidence unreadable: ${String(e?.message ?? e).slice(0, 120)}` }; }
    const fresh = await gh.get(`pulls/${pr.number}`);
    // D6476-p6: the keeper's attempts so far; an unread sticky comment leaves it unknown (null), which changes nothing.
    let stickyBody = null;
    try { stickyBody = stickyComment(await pages(gh, `issues/${pr.number}/comments`, 5), botLogin)?.body ?? ''; } catch { /* null */ }
    let d = decide({
      keeperAttempts: keeperAttempts({ keeperTriedEvents: pr.keeperTriedEvents, commits, stickyBody }, botLogin).used,
      klass: k.class, mergeable: typeof fresh.mergeable === 'boolean' ? fresh.mergeable : null, keeperMerged: keeperMergedSince(commits, removal.at, botLogin),
      removedAt: removal.at, consent: consent({ ...pr, commits }, { botLogin }),
      checks: evidenceState(ev, pr.head.sha), checksDetail: ev.detail,
      headUnchangedSinceChecks: fresh.head?.sha === pr.head.sha && ev.headSha === pr.head.sha,
      eligible: eligible(pr, { env, event: env.GITHUB_EVENT_NAME, dispatchPr, repo: env.GITHUB_REPOSITORY, files, kind: KIND, breakers: brk }),
      breakers: brk, openAlertTitles, requeues, pr: pr.number, now, env, queueRuns,
    });
    // D6476-p7: before anything is re-queued, the landing policy is read fresh for the head the enqueue names
    // (landPr.decide() through the feeder's reader), with LANDING_AUTO, #5500, the merge-queue rule and the stalled
    // alert. A refusal or an unread decision waits or hands back with its reason; it never re-queues.
    if (d.action === 'requeue') {
      let decision = null;
      let error = null;
      try { decision = await readLanding(pr.number); } catch (e) { error = String(e?.message ?? e).slice(0, 120); }
      d = gateRequeue(d, requeuePolicy({ landing: decision, error, number: pr.number, headSha: pr.head.sha, env }), { removedAt: removal.at, now });
    }    const minutes = Math.round((now - Date.parse(removal.at)) / 60_000);
    const line = `#${pr.number}: ${k.class} (${k.why}); ${d.action}${pr.stranded ? ' (stranded label, second look)' : ''}${d.reasons.length ? ` — ${d.reasons.join('; ')}` : ''}; ${minutes} min after the ejection; auto-merge ${pr.autoMerge ? 'still set' : 'not set'}`;
    say(`- ${line}`);
    if (!app) continue;
    if (d.action === 'requeue') {
      await app.graph('mutation($id:ID!,$oid:GitObjectID!){enqueuePullRequest(input:{pullRequestId:$id,expectedHeadOid:$oid}){clientMutationId}}', { id: pr.id, oid: pr.head.sha })
        .catch(() => { throw new Error(`enqueue of #${pr.number} failed`); });
      // Only the App's own stranded label comes off, after the entry is back, and only if a fresh read still shows the
      // newest \`ejected\` event as the App's pre-cutover one: a person's newer label is left alone.
      if (pr.stranded && await stillAppsStrandedLabel(gh, pr.number, botLogin)) {
        await app.del(`issues/${pr.number}/labels/${encodeURIComponent(LABELS.ejected)}`).catch(() => {});
      }
    } else if (d.action === 'keeper') keeper.push(pr.number);
    else if (d.action !== 'wait') {
      // Review on #8054 (P2): a stranded PR already carries the App's pre-cutover \`ejected\`, so adding it again writes
      // no event. Its hand-back is recorded with the add-only \`bot:handed-back\` label instead: nothing is deleted.
      const add = [...(pr.labels.includes(LABELS.ejected) ? [] : [LABELS.ejected]), ...(pr.stranded ? [LABELS.handedBack] : [])];
      if (add.length) await app.post(`issues/${pr.number}/labels`, { labels: add });
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
