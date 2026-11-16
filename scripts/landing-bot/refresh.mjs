#!/usr/bin/env node
// #6478: the serial refresh: once main is green again, update inherited-red PR branches one at a time, at a set rate.
/**
 *   node refresh.mjs plan    reads with GH_TOKEN; writes $RUNNER_TEMP/refresh-plan.json and outputs `reservation`, `count`
 *   node refresh.mjs apply   per PR: re-reads, then update-branch with REFRESH_APP_TOKEN, else the runner merge
 *
 * Polls instead of `workflow_run` (the #4571 guard forbids it): a run does anything only when main's newest
 * completed push run of CI is green and an older one was red.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { breakers, mode } from './rules.mjs';
import { allowance, inherited, KIND, recheckOne, refreshSerially, reservationName } from './refresh-rules.mjs';
import { client } from './keeper.mjs';
import { gitIn, mergeMain } from './keeper-merge.mjs';

/**
 * The fallback when update-branch refuses an App token: the branch keeper's runner merge (hooks, filters and LFS
 * off, main's merge rules only), pushed normally. Returns { ok } | { conflict } | { refused }.
 */
export function runnerMerge(env, pr) {
  const repo = env.GITHUB_REPOSITORY;
  const dir = mkdtempSync(join(env.RUNNER_TEMP, 'refresh-'));
  try {
    const git = gitIn(dir);
    git(['init', '--quiet']);
    git(['remote', 'add', 'origin', `https://github.com/${repo}.git`]);
    git(['fetch', '--quiet', '--no-tags', '--filter=blob:none', 'origin', `+${pr.head.sha}:refs/refresh/head`, '+refs/heads/main:refs/remotes/origin/main']);
    git(['checkout', '--quiet', '--detach', 'refs/refresh/head']);
    const m = mergeMain(dir, { message: 'Merge main into this branch (landing bot refresh)\n\nLanding-Bot-Kind: refresh' });
    if (m.outcome === 'conflict') return { conflict: true };
    if (m.outcome !== 'merged') return { refused: m.outcome };
    const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${env.REFRESH_APP_TOKEN}`).toString('base64')}`;
    const r = git(['-c', `http.https://github.com/.extraheader=${header}`, 'push', '--no-verify', `https://github.com/${repo}.git`, `HEAD:refs/heads/${pr.head.ref}`], { allowFail: true });
    return r.ok ? { ok: true } : { refused: 'push' };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const out = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
const say = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${s}\n`); };

async function jobsOf(gh, run) {
  return run ? { head_sha: run.head_sha, conclusion: run.conclusion, jobs: ((await gh.get(`actions/runs/${run.id}/jobs?per_page=100`)).jobs || []).map((j) => ({ name: j.name, conclusion: j.conclusion, steps: j.steps })) } : null;
}

export async function refreshBreakers(gh, env) {
  const read = async (fn) => { try { return await fn(); } catch { return null; } };
  return breakers(KIND, {
    env,
    mainRuns: await read(async () => (await gh.get('actions/workflows/ci.yml/runs?branch=main&event=push&per_page=20')).workflow_runs),
    openAlertTitles: await read(async () => (await gh.get('issues?state=open&per_page=100')).filter((i) => !i.pull_request).map((i) => i.title)),
    queuedRuns: await read(async () => (await gh.get('actions/runs?status=queued&per_page=100')).workflow_runs),
  });
}

export async function planStage(env, { gh = client({ repo: env.GITHUB_REPOSITORY, token: env.GH_TOKEN }), now = Date.now() } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  const runId = Number(env.GITHUB_RUN_ID);
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  const finish = (act, why) => {
    writeFileSync(join(env.RUNNER_TEMP, 'refresh-plan.json'), JSON.stringify({ act }));
    out('reservation', reservationName({ day, runId, attempt, n: act.length }));
    out('count', act.length);
    say(`### Serial refresh plan\n\n${why}`);
    return act;
  };
  const runs = ((await gh.get('actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=20')).workflow_runs || []);
  if (runs[0]?.conclusion !== 'success') return finish([], 'main is not green yet: nothing to refresh.');
  const red = runs.find((r) => r.conclusion === 'failure');
  if (!red) return finish([], 'no red main run in the last 20: nothing was inherited.');
  const main = await jobsOf(gh, red);
  const dispatchPr = env.REFRESH_PR ? Number(env.REFRESH_PR) : null;
  let prs = [];
  for (let p = 1; p <= 3; p++) {
    const page = await gh.get(`pulls?state=open&per_page=100&page=${p}`);
    prs.push(...page);
    if (page.length < 100) break;
  }
  if (mode(env) === 'dispatch') prs = prs.filter((p) => p.number === dispatchPr);
  for (const pr of prs.filter((p) => !p.draft)) {
    const run = (await gh.get(`actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=1`)).workflow_runs?.[0];
    pr.latestRun = run?.conclusion === 'failure' ? await jobsOf(gh, run) : run ? { head_sha: run.head_sha, conclusion: run.conclusion, jobs: [] } : null;
  }
  const { picked, skipped } = inherited(prs, main);
  let recent = null;
  try {
    const since = new Date(now - 24 * 3600_000).toISOString();
    const rr = (await gh.get(`actions/workflows/landing-bot-refresh.yml/runs?branch=main&per_page=100&created=${encodeURIComponent(`>=${since}`)}`)).workflow_runs || [];
    recent = [];
    for (const r of rr) recent.push(...((await gh.get(`actions/runs/${r.id}/artifacts?per_page=100`)).artifacts || []));
  } catch { recent = null; }
  const a = allowance(recent, env, now);
  const act = attempt === 1 ? picked.slice(0, a.n).map((p) => ({ number: p.number, sha: p.head.sha })) : [];
  for (const s of skipped) say(`- #${s.number}: ${s.reasons.join('; ')}`);
  return finish(act, `${picked.length} PR(s) went red only because main was. This window allows ${a.n}${a.reason ? ` (${a.reason})` : ''}: ${act.map((p) => `#${p.number}`).join(', ') || 'none'}.`);
}

export async function applyStage(env, {
  gh = client({ repo: env.GITHUB_REPOSITORY, token: env.GH_TOKEN }),
  app = client({ repo: env.GITHUB_REPOSITORY, token: env.REFRESH_APP_TOKEN }),
  now = () => Date.now(),
} = {}) {
  const { act } = JSON.parse(readFileSync(join(env.RUNNER_TEMP, 'refresh-plan.json'), 'utf8'));
  let fallbacks = 0;
  const dispatchPr = env.REFRESH_PR ? Number(env.REFRESH_PR) : null;
  const statuses = [];
  const res = await refreshSerially(act.map((p) => ({ number: p.number, head: { sha: p.sha } })), act.length, {
    recheck: async (pr) => {
      const fresh = await gh.get(`pulls/${pr.number}`);
      const files = (await gh.get(`pulls/${pr.number}/files?per_page=100`)).map((f) => ({ path: f.filename, previousPath: f.previous_filename }));
      return recheckOne(pr, fresh, { env, event: env.GITHUB_EVENT_NAME, dispatchPr, repo: env.GITHUB_REPOSITORY, files, breakers: await refreshBreakers(gh, env) });
    },
    update: async (pr) => {
      try { await app.put(`pulls/${pr.number}/update-branch`, { expected_head_sha: pr.head.sha }); statuses.push(202); return { ok: true }; } catch (e) {
        statuses.push(e.status ?? 0);
        const fresh = await gh.get(`pulls/${pr.number}`).catch(() => null);
        if (e.status === 422 && fresh?.mergeable_state === 'dirty') return { conflict: true };
        // GitHub's documentation is unclear on App tokens here; a 403 falls back to the runner merge.
        if (e.status === 403 && fresh?.head?.sha === pr.head.sha) {
          fallbacks += 1;
          return runnerMerge(env, { head: { sha: pr.head.sha, ref: fresh.head.ref } });
        }
        return { refused: e.status ?? 0 };
      }
    },
    label: (pr, name) => app.post(`issues/${pr.number}/labels`, { labels: [name] }),
  });
  for (const l of res.log) say(`- #${l.number}: ${l.result}`);
  say(`\nupdate-branch with the App token answered: ${statuses.join(', ') || 'no call'} (202 accepted, 403 refused for an App token); runner-merge fallbacks: ${fallbacks}; finished ${new Date(now()).toISOString()}.`);
  return { ...res, fallbacks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stage = process.argv[2];
  const run = stage === 'plan' ? planStage : stage === 'apply' ? applyStage : null;
  if (!run) { console.error('usage: refresh.mjs plan|apply'); process.exitCode = 2; }
  else run(process.env).catch((e) => { console.error(`serial refresh: ${stage} failed (${String(e?.message || e).slice(0, 200)})`); process.exitCode = 1; });
}

