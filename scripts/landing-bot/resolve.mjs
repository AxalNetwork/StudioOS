#!/usr/bin/env node
// #6475: the conflict resolver: a model resolves only the conflicted files, both sides' lines must survive, a separate job pushes.
/**
 *   node resolve.mjs plan    read-only (GH_TOKEN): checks every rule before any model call, stages the merge, writes
 *                            $RUNNER_TEMP/resolver/plan.json and the outputs `decision`, `ref`, `task`, `reservation`
 *   node resolve.mjs apply   App token, no model key, no PR code: re-checks the patch and the resolution with main's
 *                            code, commits a normal merge commit and pushes it, never forced; or hands the PR back
 *
 * Between the two, the workflow calls the model runner (#6473) in merge mode. The plan job holds no write token and
 * the model's job holds no GitHub write at all; only `apply` can push, and it pushes only what it re-checked.
 */
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { giveUp, LABELS, mode, pathGuard, prIssue } from './rules.mjs';
import { client, pages, push, readBreakers, upsertSticky } from './keeper.mjs';
import { gitIn } from './keeper-merge.mjs';
import { oneLine } from './ejection.mjs';
import { sameFiles, sidesOf, stageMerge } from './model/stage.mjs';
import { checkPatch } from './model/patch.mjs';
import { parseTask } from './model/task.mjs';
import {
  KIND, afterStage, checkResolution, conflictLines, gate, instructions, reservationName, reservedToday, testsFor, verifyCommands,
} from './resolve-rules.mjs';

const DATA_BUDGET = 180_000;
const DIFF_MAX = 50_000;

// Values come from the API (a branch name, file paths, reasons). A line break in one would start a second
// `key=value` line in GITHUB_OUTPUT, an output the next job trusts, so each is written on one line under a
// key of safe characters only, as the ejection handler writes its own (code scanning alerts 7283, 7284).
export const output = (k, v) => {
  if (!/^[a-z_]+$/.test(k)) throw new Error(`bad output name ${k}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${oneLine(v)}\n`);
};
const summary = (s) => { if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${s}\n`); };
const prNumber = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

/** A partial clone of the PR head and main in a temp folder; nothing from either is run. */
export function cloneFor(repoUrl, headSha, root) {
  const dir = mkdtempSync(join(root, 'resolver-'));
  const git = gitIn(dir);
  git(['init', '--quiet']);
  git(['remote', 'add', 'origin', repoUrl]);
  git(['fetch', '--quiet', '--no-tags', '--filter=blob:none', 'origin', `+${headSha}:refs/resolver/head`, '+refs/heads/main:refs/remotes/origin/main']);
  git(['checkout', '--quiet', '--detach', 'refs/resolver/head']);
  return { dir, git, main: git(['rev-parse', 'origin/main^{commit}']).out.trim() };
}

/** Completed resolver runs on this PR, from the run name `Conflict resolver for #<n>`. */
export function runsOf(workflowRuns, exceptId) {
  return (workflowRuns || [])
    .filter((r) => r && r.id !== exceptId)
    .map((r) => ({ kind: KIND, pr: prNumber(/#(\d+)\b/.exec(String(r.display_title ?? ''))?.[1]), status: r.status, created_at: r.created_at }))
    .filter((r) => r.pr);
}

function testSources(dir) {
  const out = {};
  for (const folder of ['frontend/test', 'cloudflare-worker/test']) {
    let names = [];
    try { names = readdirSync(join(dir, folder)); } catch { continue; }
    for (const n of names) if (/\.test\.(?:mjs|ts)$/.test(n)) {
      try { out[`${folder}/${n}`] = readFileSync(join(dir, folder, n), 'utf8'); } catch { /* unreadable: not selected */ }
    }
  }
  return out;
}

/** The descriptions of main's changes to the conflicted files: the PRs their commit subjects name, at most five. */
async function mainDescriptions(gh, git, base, mainSha, files) {
  const log = git(['log', '--format=%s', `${base}..${mainSha}`, '--', ...files], { allowFail: true });
  const nums = [...new Set((log.ok ? log.out : '').split('\n').map((s) => /\(#(\d+)\)\s*$/.exec(s)?.[1]).filter(Boolean))].slice(0, 5);
  const parts = [];
  for (const n of nums) {
    try { const p = await gh.get(`pulls/${n}`); parts.push(`#${n} ${p.title}\n\n${String(p.body ?? '').slice(0, 4000)}`); } catch { /* skipped */ }
  }
  return parts.join('\n\n---\n\n') || 'Not recorded';
}

export async function planStage(env, { gh = client({ repo: env.GITHUB_REPOSITORY, token: env.GH_TOKEN }), now = Date.now(), clone = cloneFor } = {}) {
  const outDir = join(env.RUNNER_TEMP, 'resolver');
  mkdirSync(outDir, { recursive: true });
  const n = prNumber(env.RESOLVE_PR);
  const finish = (plan) => {
    writeFileSync(join(outDir, 'plan.json'), JSON.stringify(plan));
    output('decision', plan.decision);
    output('ref', plan.ref ?? '');
    output('task', plan.task ? JSON.stringify(plan.task) : '');
    output('reservation', plan.decision === 'resolve' ? reservationName({ day: plan.day, runId: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT) }) : '');
    summary(`### Conflict resolver plan for #${n ?? '?'}\n\n${plan.decision}${plan.reasons?.length ? `: ${plan.reasons.join('; ')}` : ''}${plan.files?.length ? `\n\nFiles: ${plan.files.map((f) => `\`${f}\``).join(', ')}` : ''}`);
    return plan;
  };
  const day = new Date(now).toISOString().slice(0, 10);
  if (!n) return finish({ decision: 'skip', reasons: ['no pull request number'], day });
  // A rerun asks the model nothing: its first attempt already reserved and ran.
  if (Number(env.GITHUB_RUN_ATTEMPT) !== 1) return finish({ pr: n, decision: 'skip', reasons: ['a rerun does not call the model again'], day });

  const pr = await gh.get(`pulls/${n}`);
  try { pr.files = (await pages(gh, `pulls/${n}/files`, 30)).map((f) => ({ path: f.filename, previousPath: f.previous_filename })); } catch { pr.files = null; }
  try { pr.commits = await pages(gh, `pulls/${n}/commits`, 3); } catch { pr.commits = null; }
  const breakers = await readBreakers(gh, env);
  let runs = null;
  let reserved = null;
  try {
    const all = (await gh.get('actions/workflows/landing-bot-conflict.yml/runs?branch=main&per_page=100')).workflow_runs;
    runs = runsOf(all, Number(env.GITHUB_RUN_ID));
    const today = all.filter((r) => String(r.created_at).startsWith(day) && r.id !== Number(env.GITHUB_RUN_ID));
    const byRun = new Map();
    for (const r of today) byRun.set(r.id, (await gh.get(`actions/runs/${r.id}/artifacts?per_page=100`)).artifacts);
    reserved = reservedToday(byRun, day);
  } catch { /* stays null: attempts and budget refuse */ }

  const base = { pr: n, head: pr.head?.sha, ref: pr.head?.ref, day };
  // Rules that need no clone first: a PR the bot may not touch is not cloned.
  const ctx = { env, event: env.GITHUB_EVENT_NAME, dispatchPr: n, repo: env.GITHUB_REPOSITORY, breakers, botLogin: env.LANDING_BOT_LOGIN, now, runs, reserved };
  const pre = gate(pr, ctx);
  if (pre.decision !== 'resolve') return finish({ ...base, ...pre });

  const c = clone(`https://github.com/${env.GITHUB_REPOSITORY}.git`, pr.head.sha, env.RUNNER_TEMP);
  try {
    const stage = stageMerge(c.dir, { mainSha: c.main, headSha: pr.head.sha, git: c.git });
    const sizes = {};
    for (const p of stage.ok ? stage.conflicted : []) { try { sizes[p] = conflictLines(readFileSync(join(c.dir, p), 'utf8')); } catch { sizes[p] = Infinity; } }
    const d = afterStage({ ...ctx, stage, sizes });
    const plan = { ...base, main: c.main, ...d };
    if (d.decision !== 'resolve') return finish(plan);

    // The data the model reads: each version of each file, and both changes' descriptions, within one budget.
    const files = d.files;
    const data = { 'files.txt': files.map((p, i) => `${i + 1}\t${p}`).join('\n') };
    let used = 0;
    const add = (name, text) => { if (text == null) return; const b = Buffer.byteLength(text); if (used + b <= DATA_BUDGET) { data[name] = text; used += b; } };
    add('pr-description.txt', `#${n} ${pr.title}\n\n${String(pr.body ?? '').slice(0, 6000)}`);
    add('main-descriptions.txt', await mainDescriptions(gh, c.git, stage.base, c.main, files));
    files.forEach((p, i) => add(`conflict-${i + 1}-base.txt`, sidesOf(c.dir, p, { git: c.git }).base));
    files.forEach((p, i) => { const s = sidesOf(c.dir, p, { git: c.git }); add(`conflict-${i + 1}-pr.txt`, s.ours); add(`conflict-${i + 1}-main.txt`, s.theirs); });
    const task = {
      version: 1, instructions: instructions(files), allowed_files: files,
      verify: verifyCommands(files, testsFor(files, testSources(c.dir))),
      data, merge_sha: c.main, head_sha: pr.head.sha, max_rounds: 3,
    };
    const parsed = parseTask(task);
    if (!parsed.task) return finish({ ...plan, decision: 'handback', reasons: parsed.errors });
    return finish({ ...plan, task });
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
}

async function handBack(env, app, gh, pr, cause, files) {
  let issue = null;
  const i = prIssue(pr?.body);
  if (i) { try { issue = await gh.get(`issues/${i}`); } catch { /* the slot is then Not recorded */ } }
  const g = giveUp(pr, cause, { files, reproduce: 'git fetch origin main && git merge origin/main', issue });
  await app.post(`issues/${pr.number}/labels`, { labels: [g.label] });
  await upsertSticky(app, pr.number, env.LANDING_BOT_LOGIN, [g.body]);
  summary(`- #${pr.number}: handed back (${cause})`);
  return { outcome: 'handed_back', cause };
}

export async function applyStage(env, {
  gh = client({ repo: env.GITHUB_REPOSITORY, token: env.GH_TOKEN }),
  app = client({ repo: env.GITHUB_REPOSITORY, token: env.RESOLVER_APP_TOKEN }),
  clone = cloneFor, pushImpl = push,
} = {}) {
  const plan = JSON.parse(readFileSync(join(env.PLAN_DIR, 'plan.json'), 'utf8'));
  const pr = await gh.get(`pulls/${plan.pr}`);
  if (plan.decision === 'handback') return handBack(env, app, gh, pr, plan.reasons.join('; ') || 'the resolver refused this conflict', plan.files ?? []);
  if (plan.decision !== 'resolve') return { outcome: 'skipped' };
  if (env.MODEL_OUTCOME !== 'passed') {
    return handBack(env, app, gh, pr, 'the model could not resolve the conflicts so that both sides survive and the checks pass', plan.files);
  }

  // Re-read: the session may have pushed, someone may have labelled bot:off, a breaker may have opened.
  const quiet = async (why) => { summary(`- #${plan.pr}: not pushed, ${why}`); return { outcome: 'skipped', why }; };
  const fresh = async () => {
    const now = await gh.get(`pulls/${plan.pr}`);
    if (now.state !== 'open') return 'the pull request is closed';
    if (now.head?.sha !== plan.head) return 'its head moved';
    if (mode(env) === 'off') return 'the landing bot is off';
    if ((now.labels || []).some((l) => l.name === LABELS.off)) return `it is labelled ${LABELS.off}`;
    if ((await readBreakers(gh, env)).open) return 'a breaker is open';
    return null;
  };
  const before = await fresh();
  if (before) return quiet(before);

  const c = clone(`https://github.com/${env.GITHUB_REPOSITORY}.git`, plan.head, env.RUNNER_TEMP);
  try {
    const stage = stageMerge(c.dir, { mainSha: plan.main, headSha: plan.head, git: c.git, fetch: true });
    if (!stage.ok || !sameFiles(stage.conflicted, plan.files)) return handBack(env, app, gh, pr, `the merge is not the one the model resolved (${stage.reason || 'different files'})`, plan.files);
    const patch = JSON.parse(readFileSync(join(env.PATCH_DIR, 'patch.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(env.PATCH_DIR, 'manifest.json'), 'utf8'));
    const problems = [];
    if (manifest?.base_sha !== plan.head) problems.push('the patch was made from another head');
    const readBefore = (p) => (existsSync(join(c.dir, p)) ? readFileSync(join(c.dir, p), 'utf8') : null);
    problems.push(...checkPatch(patch, manifest, plan.files, readBefore, { resolving: true }));
    const guard = pathGuard(plan.files.map((path) => ({ path })));
    if (!guard.ok) problems.push(...guard.refused.map((r) => `${r.path}: ${r.reason}`));
    if (!problems.length) {
      const resolved = patch.files.map((f) => ({ path: f.path, ...sidesOf(c.dir, f.path, { git: c.git }), result: f.content }));
      problems.push(...checkResolution(resolved, plan.files));
    }
    if (problems.length) return handBack(env, app, gh, pr, `the resolution was refused: ${problems.slice(0, 5).join('; ')}`, plan.files);

    for (const f of patch.files) writeFileSync(join(c.dir, f.path), f.content);
    c.git(['add', '--', ...plan.files]);
    if (c.git(['ls-files', '--unmerged']).out.trim()) return handBack(env, app, gh, pr, 'a conflict is still unmerged after the resolution', plan.files);
    const provider = String(manifest.provider ?? 'unknown').replace(/[^\w.-]/g, '').slice(0, 40) || 'unknown';
    const model = String(manifest.model ?? '').replace(/[^\w.:/-]/g, '').slice(0, 80);
    c.git(['commit', '--quiet', '--no-verify', '-m', [
      'Merge main into this branch, resolving conflicts (landing bot)',
      '',
      `Resolved by ${provider}${model ? ` (${model})` : ''} in round ${Number(manifest.round) || '?'}, in: ${plan.files.join(', ')}.`,
      'Every line either side added is kept, no test is dropped and no skip is added (scripts/landing-bot/resolve-rules.mjs).',
      'The owner lands a model-resolved pull request.',
      '',
      `Landing-Bot-Kind: ${KIND}`,
      `Landing-Bot-Provider: ${provider}`,
    ].join('\n')]);
    const commit = c.git(['rev-parse', 'HEAD']).out.trim();
    const parents = c.git(['rev-list', '--parents', '-n', '1', commit]).out.trim().split(' ').slice(1);
    if (parents[0] !== plan.head || parents[1] !== plan.main) return handBack(env, app, gh, pr, 'the commit is not a merge of the planned head and main', plan.files);

    const last = await fresh();
    if (last) return quiet(last);
    if (!pushImpl(c.dir, env.GITHUB_REPOSITORY, env.RESOLVER_APP_TOKEN, plan.ref)) {
      const moved = await fresh();
      return moved ? quiet(moved) : handBack(env, app, gh, pr, 'GitHub refused the push', plan.files);
    }
    try { await app.del(`issues/${plan.pr}/labels/${encodeURIComponent(LABELS.conflict)}`); } catch { /* not labelled */ }
    await app.post(`issues/${plan.pr}/labels`, { labels: [LABELS.resolved] });
    // `--no-ext-diff`: SAFE_CONFIG empties `diff.external`, and git 2.43 then tries to run an empty
    // program for a content diff ("cannot run : No such file"). The flag never runs one, on any git.
    const diff = c.git(['diff', '--no-color', '--no-ext-diff', plan.head, commit, '--', ...plan.files]).out;
    const shown = diff.length > DIFF_MAX ? `${diff.slice(0, DIFF_MAX)}\n… (cut at ${DIFF_MAX} characters)` : diff;
    await upsertSticky(app, plan.pr, env.LANDING_BOT_LOGIN, [
      `Merged main into this branch (${commit.slice(0, 10)}) and resolved the conflicts in ${plan.files.map((f) => `\`${f}\``).join(', ')} with ${provider}.`,
      'Every line either side added is kept. **The owner lands a model-resolved pull request.** Pull before you push.',
      '',
      '<details><summary>The resolution, against this branch before the merge</summary>',
      '',
      '```diff',
      shown.replace(/```/g, '`​``'),
      '```',
      '</details>',
    ]);
    summary(`- #${plan.pr}: resolved by ${provider}, pushed ${commit.slice(0, 10)}`);
    return { outcome: 'pushed', commit };
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stage = process.argv[2];
  const run = stage === 'plan' ? planStage : stage === 'apply' ? applyStage : null;
  if (!run) { console.error('usage: resolve.mjs plan|apply'); process.exitCode = 2; }
  else run(process.env).catch((e) => { console.error(`conflict resolver: ${stage} failed (${String(e?.message || e).slice(0, 200)})`); process.exitCode = 1; });
}
