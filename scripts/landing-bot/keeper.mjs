#!/usr/bin/env node
// #6474: the branch keeper: merge main into conflicted PR branches on a runner, push a normal merge commit, no model.
/**
 *   node keeper.mjs plan    reads with GH_TOKEN (read-only), writes $RUNNER_TEMP/keeper-plan.json and the outputs
 *                           `reservation` and `count`
 *   node keeper.mjs apply   re-reads each planned PR, merges (keeper-merge.mjs) and pushes with KEEPER_APP_TOKEN;
 *                           writes the output `dispatch` (PR numbers for the conflict resolver)
 *
 * The App token is used only to push to the PR's own branch and to label and comment. It never dispatches a
 * workflow (an App token would start it); the workflow's separate job does that with GITHUB_TOKEN.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { breakers, giveUp, LABELS, mode, pathGuard, renderSticky, stickyComment } from './rules.mjs';
import { KIND, plan, pushesReserved, reservationName, RESERVATION_PREFIX } from './keeper-plan.mjs';
import { gitIn, mergeMain } from './keeper-merge.mjs';

const REPO = /^[\w-]+\/[\w.-]+$/;

export function client({ repo, token, fetchImpl = fetch }) {
  if (!REPO.test(repo ?? '') || !token) throw new Error('a repository and a token are required');
  let calls = 0;
  async function call(method, path, body) {
    if (++calls > 1500) throw new Error('request limit reached');
    const url = new URL(path, 'https://api.github.com/');
    if (url.origin !== 'https://api.github.com') throw new Error('bad endpoint');
    const res = await fetchImpl(url.href, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw Object.assign(new Error(`GitHub ${method} failed (HTTP ${res.status})`), { status: res.status });
    return res.status === 204 ? null : res.json();
  }
  const r = (p) => `repos/${repo}/${p}`;
  return {
    get: (p) => call('GET', r(p)),
    post: (p, b) => call('POST', r(p), b),
    patch: (p, b) => call('PATCH', r(p), b),
    put: (p, b) => call('PUT', r(p), b),
    del: (p) => call('DELETE', r(p)),
    graph: async (query, variables) => {
      const [owner, name] = repo.split('/');
      const d = await call('POST', 'graphql', { query, variables: { owner, name, ...variables } });
      if (d?.errors?.length || !d?.data?.repository) throw new Error('incomplete GraphQL result');
      return d.data.repository;
    },
  };
}

const PRS = `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){pullRequests(states:OPEN,first:100,after:$after){
  pageInfo{hasNextPage endCursor}
  nodes{number isDraft body mergeable isInMergeQueue updatedAt headRefName headRefOid
    headRepository{nameWithOwner} baseRepository{nameWithOwner} labels(first:50){nodes{name}}
    commits(last:1){nodes{commit{committedDate}}}
    timelineItems(last:30,itemTypes:[LABELED_EVENT]){nodes{... on LabeledEvent{createdAt label{name}}}}}}}}`;

/** One GraphQL call per 100 open PRs, normalised to the shape rules.mjs reads. */
export async function openPrs(gh) {
  const out = [];
  let after = null;
  for (let page = 0; page < 5; page++) {
    const repo = await gh.graph(PRS, { after });
    const conn = repo.pullRequests;
    for (const n of conn.nodes) {
      // D6476-p5: only the keeper's own hand-back and a session hand-back count; the visible `conflict` label does not.
      const handBacks = (n.timelineItems?.nodes || []).filter((e) => [LABELS.keeperTried, LABELS.needsSession].includes(e?.label?.name)).map((e) => e.createdAt).sort();
      const committed = n.commits?.nodes?.[0]?.commit?.committedDate ?? null;
      // The later of the head commit's date and the PR's last update: a conservative "head changed" time.
      const changed = [committed, n.updatedAt].filter(Boolean).sort().pop() ?? null;
      out.push({
        number: n.number, state: 'open', draft: n.isDraft, body: n.body, mergeable: n.mergeable, inMergeQueue: n.isInMergeQueue,
        headChangedAt: changed, handedBackAt: handBacks.pop() ?? null,
        labels: (n.labels?.nodes || []).map((l) => l.name),
        head: { ref: n.headRefName, sha: n.headRefOid, repo: { full_name: n.headRepository?.nameWithOwner ?? null } },
        base: { repo: { full_name: n.baseRepository?.nameWithOwner ?? null } },
      });
    }
    if (!conn.pageInfo.hasNextPage) return out;
    after = conn.pageInfo.endCursor;
  }
  throw new Error('more open PRs than one sweep reads');
}

export async function pages(gh, path, max = 3) {
  const out = [];
  for (let p = 1; p <= max; p++) {
    const rows = await gh.get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${p}`);
    if (!Array.isArray(rows)) throw new Error('unreadable list');
    out.push(...rows);
    if (rows.length < 100) return out;
  }
  throw new Error('list longer than the bounded read');
}

export async function readBreakers(gh, env) {
  let mainRuns = null;
  let openAlertTitles = null;
  try { mainRuns = (await gh.get('actions/workflows/ci.yml/runs?branch=main&event=push&per_page=20')).workflow_runs; } catch { /* stays null: open */ }
  try { openAlertTitles = (await pages(gh, 'issues?state=open', 5)).filter((i) => !i.pull_request).map((i) => i.title).filter((t) => t.startsWith('[alert]')); } catch { /* null */ }
  return breakers(KIND, { env, mainRuns, openAlertTitles });
}

async function reservedToday(gh, day) {
  const range = `${day}T00:00:00Z..${day}T23:59:59Z`;
  const runs = (await gh.get(`actions/workflows/landing-bot-keeper.yml/runs?branch=main&per_page=100&created=${encodeURIComponent(range)}`)).workflow_runs;
  if (!Array.isArray(runs) || runs.length >= 100) throw new Error('keeper runs could not be counted');
  const byRun = new Map();
  for (const run of runs) byRun.set(run.id, (await gh.get(`actions/runs/${run.id}/artifacts?per_page=100`)).artifacts);
  return pushesReserved(byRun, day);
}

const output = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${s}\n`); };

export async function planStage(env, { gh = client({ repo: env.GITHUB_REPOSITORY, token: env.GH_TOKEN }), now = Date.now() } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  const dispatchPr = env.KEEPER_PR ? Number(env.KEEPER_PR) : null;
  const ctx = { env, event: env.GITHUB_EVENT_NAME, dispatchPr, repo: env.GITHUB_REPOSITORY, botLogin: env.LANDING_BOT_LOGIN, now };
  ctx.breakers = await readBreakers(gh, env);
  let prs = await openPrs(gh);
  if (mode(env) === 'dispatch') prs = prs.filter((p) => p.number === dispatchPr);
  for (const pr of prs.filter((p) => p.mergeable === 'CONFLICTING' && p.inMergeQueue === false)) {
    try { pr.files = (await pages(gh, `pulls/${pr.number}/files`, 30)).map((f) => ({ path: f.filename, previousPath: f.previous_filename })); } catch { pr.files = null; }
    try { pr.commits = await pages(gh, `pulls/${pr.number}/commits`, 3); } catch { pr.commits = null; }
  }
  try { ctx.pushesToday = await reservedToday(gh, day); } catch { ctx.pushesToday = null; }
  const result = plan(prs, ctx);
  const runId = Number(env.GITHUB_RUN_ID);
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  // A rerun reserves nothing and pushes nothing: its first attempt's reservation is already counted.
  const act = attempt === 1 ? result.act : [];
  writeFileSync(join(env.RUNNER_TEMP, 'keeper-plan.json'), JSON.stringify({ day, act: act.map((p) => ({ number: p.number, sha: p.head.sha, ref: p.head.ref })) }));
  output('reservation', reservationName({ day, runId, attempt, n: act.length }));
  output('count', act.length);
  summary(`### Branch keeper plan\n\n${act.length} PR(s) to merge main into: ${act.map((p) => `#${p.number}`).join(', ') || 'none'}.`);
  for (const s of result.skipped.filter((x) => x.number)) summary(`- #${s.number}: ${s.reasons.join('; ')}`);
  if (ctx.breakers.open) summary(`\nBreakers open: ${ctx.breakers.reasons.join('; ')}`);
  return { act, skipped: result.skipped };
}

export async function upsertSticky(gh, number, botLogin, lines) {
  const comments = await pages(gh, `issues/${number}/comments`, 5);
  const mine = stickyComment(comments, botLogin);
  const body = renderSticky(lines);
  if (mine) await gh.patch(`issues/comments/${mine.id}`, { body });
  else await gh.post(`issues/${number}/comments`, { body });
}

/** Push HEAD to the PR's branch: a normal push, never forced. The token goes in a header, never in a URL or log. */
export function push(dir, repo, token, ref) {
  const git = gitIn(dir);
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  const r = git(['-c', `http.https://github.com/.extraheader=${header}`, 'push', '--no-verify', `https://github.com/${repo}.git`, `HEAD:refs/heads/${ref}`], { allowFail: true });
  return r.ok;
}

export async function applyStage(env, { gh = client({ repo: env.GITHUB_REPOSITORY, token: env.GH_TOKEN }), app = client({ repo: env.GITHUB_REPOSITORY, token: env.KEEPER_APP_TOKEN }) } = {}) {
  const repo = env.GITHUB_REPOSITORY;
  const { act } = JSON.parse(readFileSync(join(env.RUNNER_TEMP, 'keeper-plan.json'), 'utf8'));
  const dispatch = [];
  let workflowRefusals = 0;
  for (const planned of act) {
    // Re-read: mode, bot:off, breakers and the head may have changed since the plan.
    const pr = await gh.get(`pulls/${planned.number}`);
    const labels = (pr.labels || []).map((l) => l.name);
    const brk = await readBreakers(gh, env);
    if (mode(env) === 'off' || labels.includes(LABELS.off) || brk.open || pr.head?.sha !== planned.sha || pr.state !== 'open') {
      summary(`- #${planned.number}: skipped on re-read`);
      continue;
    }
    const dir = mkdtempSync(join(env.RUNNER_TEMP, 'keeper-'));
    try {
      const git = gitIn(dir);
      git(['init', '--quiet']);
      git(['remote', 'add', 'origin', `https://github.com/${repo}.git`]);
      // Full history without blobs: the merge base is always there, and blobs arrive only as the merge needs them.
      git(['fetch', '--quiet', '--no-tags', '--filter=blob:none', 'origin', `+${planned.sha}:refs/keeper/head`, '+refs/heads/main:refs/remotes/origin/main']);
      git(['checkout', '--quiet', '--detach', 'refs/keeper/head']);
      const m = mergeMain(dir);
      if (m.outcome === 'merged') {
        if (push(dir, repo, env.KEEPER_APP_TOKEN, planned.ref)) {
          await upsertSticky(app, planned.number, env.LANDING_BOT_LOGIN, [`Merged main into this branch (${m.commit.slice(0, 10)}).${m.unioned.length ? ` README rows kept from both sides: ${m.unioned.join(', ')}.` : ''} Pull before you push.`]);
          summary(`- #${planned.number}: merged main and pushed`);
          continue;
        }
        // A moved head is the intended refusal: the session pushed, so leave the PR alone.
        const now = await gh.get(`pulls/${planned.number}`);
        if (now.head?.sha !== planned.sha) { summary(`- #${planned.number}: push refused because the head moved; left alone`); continue; }
        // GitHub refuses an App push that carries main's workflow-file changes; the update-branch API can do it.
        workflowRefusals += 1;
        try {
          await app.put(`pulls/${planned.number}/update-branch`, { expected_head_sha: planned.sha });
          summary(`- #${planned.number}: push refused; updated through the update-branch API`);
        } catch {
          const g = giveUp(pr, 'GitHub refused both the push and the update-branch API', { files: [] });
          await app.post(`issues/${planned.number}/labels`, { labels: [g.label] });
          await upsertSticky(app, planned.number, env.LANDING_BOT_LOGIN, [g.body]);
          summary(`- #${planned.number}: push and update-branch refused; handed back`);
        }
        continue;
      }
      if (m.outcome === 'up_to_date') { summary(`- #${planned.number}: already contains main`); continue; }
      const files = m.files || [];
      const guard = pathGuard(files.map((path) => ({ path })));
      if (m.outcome === 'refused' || !guard.ok) {
        const g = giveUp(pr, m.reason || 'the conflict touches a file no bot may write', { files, reproduce: 'git merge origin/main' });
        await app.post(`issues/${planned.number}/labels`, { labels: [g.label] });
        await upsertSticky(app, planned.number, env.LANDING_BOT_LOGIN, [g.body]);
        summary(`- #${planned.number}: handed back (${m.reason || 'protected files'})`);
        continue;
      }
      // The indicator and the keeper's own record that its merge on this head left conflicts.
      await app.post(`issues/${planned.number}/labels`, { labels: [LABELS.conflict, LABELS.keeperTried] });
      await upsertSticky(app, planned.number, env.LANDING_BOT_LOGIN, ['Merging main into this branch leaves conflicts in:', ...files.map((f) => `- \`${f}\``), '', 'The conflict resolver is asked to try; if it cannot, the owning session resolves them.']);
      dispatch.push(planned.number);
      summary(`- #${planned.number}: conflicts in ${files.length} file(s); labelled ${LABELS.conflict}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  output('dispatch', JSON.stringify(dispatch));
  summary(`\nPushes GitHub refused for workflow files this run: ${workflowRefusals}`);
  return { dispatch, workflowRefusals };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stage = process.argv[2];
  const run = stage === 'plan' ? planStage : stage === 'apply' ? applyStage : null;
  if (!run) { console.error('usage: keeper.mjs plan|apply'); process.exitCode = 2; }
  else run(process.env).catch((e) => { console.error(`branch keeper: ${stage} failed (${String(e?.message || e).slice(0, 200)})`); process.exitCode = 1; });
}

export { RESERVATION_PREFIX };
