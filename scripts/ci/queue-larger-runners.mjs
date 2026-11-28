#!/usr/bin/env node
/**
 * D8962 (#8962): the merge-queue Worker shards on the "StudioOS Included Compute" larger runners. ci.yml is
 * the owner's to change (T2), so this file holds what can land before that change and stays true after it:
 *   - SUITE_RUNS_ON: the exact `runs-on` the decision proposes for ci.yml's `suite` job, built from the
 *     github-8 catalog target in the form included-compute-canary.yml already uses. A worker-* part goes to
 *     the larger group only in the merge queue, only while vars.CI_QUEUE_LARGE_RUNNERS is 'true', and never
 *     when #7909's capacity-route accepted the candidate or the Mac (D7881) may take that part.
 *   - evaluate(): a small reader for those workflow expressions, so a test can run the real ci.yml text
 *     over every case and show the routes never claim the same shard.
 *   - collect()/summarise()/report(): GET-only shard timings from completed merge_group runs of ci.yml,
 *     per part and per runner kind (hosted or larger), median and p90, for the before and after numbers.
 *
 *   node scripts/ci/queue-larger-runners.mjs [--runs N] [--json]
 *
 * It changes no workflow, variable or run. A value nobody measured is null ("Not recorded"), never 0.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { percentile } from '../lib/actionsConcurrency.mjs';
import { executionTarget } from './runner-admission.mjs';
import { resolveCatalogProfile } from './runners/catalog.mjs';

export const REPOSITORY = 'AxalNetwork/StudioOS';
export const VARIABLE = 'CI_QUEUE_LARGE_RUNNERS';
export const FALLBACK = 'ubuntu-latest';
/** `{ group: 'StudioOS Included Compute', labels: ['studioos-bench-linux-8'] }`, from the reviewed catalog. */
export const TARGET = Object.freeze(executionTarget(resolveCatalogProfile('github-8')));
/** The one Worker part the Mac controller may take (scripts/ci/macbook-worker.mjs PART). */
export const MAC_PART = 'worker-1-of-6';
export const CONDITION = [
  "github.event_name == 'merge_group'",
  "startsWith(matrix.part, 'worker-')",
  `vars.${VARIABLE} == 'true'`,
  "needs.capacity-route.outputs.accepted != 'true'",
  `!(matrix.part == '${MAC_PART}' && vars.MACBOOK_WORKER_ENABLED == 'true')`,
].join(' && ');
/** The proposed value of `jobs.suite.runs-on` in ci.yml, verbatim. */
export const SUITE_RUNS_ON = `\${{ fromJSON(${CONDITION} && '${JSON.stringify(TARGET)}' || '"${FALLBACK}"') }}`;

const CODE = /^[\s\w.()!=&|,-]*$/;
const ROOTS = new Set(['github', 'needs', 'matrix', 'vars', 'steps', 'startsWith', 'fromJSON', 'true', 'false', 'null']);
const FORBIDDEN = new Set(['constructor', '__proto__', 'prototype']);
/**
 * Evaluate one GitHub Actions expression against `context` (`github`, `needs`, `matrix`, `vars`, `steps`).
 * Only what these routing expressions use is read: single-quoted strings, property paths (a hyphenated
 * name such as `capacity-route` included), `== != && || !`, parentheses, `startsWith` and `fromJSON`.
 * Anything else is refused rather than guessed. String comparison is exact, so callers use lower-case
 * values; GitHub's own `==` ignores case.
 */
export function evaluate(expression, context) {
  const body = String(expression).trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1');
  const pieces = body.split(/('[^']*')/);
  const js = pieces.map((piece, i) => {
    if (i % 2) return piece;
    const refuse = () => { throw new Error(`unsupported expression text: ${body.trim()}`); };
    // Two strings with nothing between them are GitHub's '' escape inside one string.
    if (piece === '' && i > 0 && i < pieces.length - 1) refuse();
    if (!CODE.test(piece) || /=/.test(piece.replace(/[=!]=/g, ''))) refuse();
    for (const m of piece.matchAll(/(\.?)\s*([A-Za-z_][\w-]*)/g)) {
      if (m[1] ? FORBIDDEN.has(m[2]) : !ROOTS.has(m[2])) refuse();
    }
    return piece.replace(/\.([A-Za-z_]\w*(?:-\w+)+)/g, "['$1']");
  }).join('');
  const startsWith = (a, b) => String(a ?? '').toLowerCase().startsWith(String(b ?? '').toLowerCase());
  return runInNewContext(js, { ...context, startsWith, fromJSON: JSON.parse }, { timeout: 100 });
}

/** The runner a job asked for, from its `runs-on` value after evaluation. */
export function runnerKind(value) {
  if (value === FALLBACK) return 'hosted';
  if (value && typeof value === 'object' && value.group === TARGET.group && JSON.stringify(value.labels) === JSON.stringify(TARGET.labels)) return 'larger';
  return 'other';
}

// ---------------------------------------------------------------- measuring merge_group shards

export const LIMITS = Object.freeze({ runs: 50, runPages: 3, jobPages: 3 });
const PREFIX = `repos/${REPOSITORY}`;
const runsPath = page => `${PREFIX}/actions/workflows/ci.yml/runs?event=merge_group&status=success&per_page=100&page=${page}`;
const jobsPath = (id, attempt, page) => `${PREFIX}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100&page=${page}`;
const ALLOWED = [
  /^repos\/AxalNetwork\/StudioOS\/actions\/workflows\/ci\.yml\/runs\?event=merge_group&status=success&per_page=100&page=[1-3]$/,
  /^repos\/AxalNetwork\/StudioOS\/actions\/runs\/[1-9]\d*\/attempts\/[1-9]\d*\/jobs\?per_page=100&page=[1-3]$/,
];
const seconds = (from, to) => {
  const a = Date.parse(from ?? ''); const b = Date.parse(to ?? '');
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 1000) : null;
};
const SUITE = /^suite \(([\w-]+)\)$/;

/** One shard row from one job: its part, the runner it got, and wait / job / test-step seconds. */
export function shardRow(run, job) {
  const part = SUITE.exec(job?.name ?? '')?.[1];
  if (!part || job.status !== 'completed' || job.conclusion !== 'success') return null;
  const labels = Array.isArray(job.labels) ? job.labels.map(String) : [];
  const larger = job.runner_group_name === TARGET.group && TARGET.labels.every(l => labels.includes(l));
  const step = (job.steps || []).find(s => typeof s.name === 'string' && s.name.startsWith(`Run node scripts/test-drift-parts.mjs ${part} `));
  return {
    run: run.id, part, runner: larger ? 'larger' : 'hosted',
    wait: seconds(job.created_at, job.started_at),
    job: seconds(job.started_at, job.completed_at),
    tests: step && step.conclusion === 'success' ? seconds(step.started_at, step.completed_at) : null,
  };
}

/** Read the newest `runs` successful merge_group runs of ci.yml and their suite shards; GET only. */
export function collect(read, { runs = 10 } = {}) {
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > LIMITS.runs) throw new Error(`runs must be 1..${LIMITS.runs}`);
  const get = path => {
    if (!ALLOWED.some(re => re.test(path))) throw new Error(`path refused: ${path}`);
    return read(path);
  };
  const picked = [];
  for (let page = 1; page <= LIMITS.runPages && picked.length < runs; page++) {
    const list = get(runsPath(page)).workflow_runs || [];
    for (const r of list) {
      if (r.event === 'merge_group' && r.path === '.github/workflows/ci.yml' && r.conclusion === 'success') picked.push(r);
      if (picked.length === runs) break;
    }
    if (list.length < 100) break;
  }
  const rows = [];
  const perRun = [];
  for (const run of picked) {
    const jobs = [];
    for (let page = 1; page <= LIMITS.jobPages; page++) {
      const result = get(jobsPath(run.id, run.run_attempt || 1, page));
      jobs.push(...(result.jobs || []));
      if ((result.jobs || []).length < 100) break;
    }
    const shards = jobs.map(job => shardRow(run, job)).filter(Boolean);
    rows.push(...shards);
    const workers = jobs.filter(j => /^suite \(worker-/.test(j.name ?? '') && j.conclusion === 'success');
    const first = Math.min(...workers.map(j => Date.parse(j.created_at)));
    const last = Math.max(...workers.map(j => Date.parse(j.completed_at)));
    perRun.push({ run: run.id, sha: run.head_sha, created: run.created_at,
      workerWall: workers.length && Number.isFinite(first) && Number.isFinite(last) ? Math.round((last - first) / 1000) : null });
  }
  return { repository: REPOSITORY, event: 'merge_group', workflow: 'ci.yml', runs: perRun, rows };
}

const stats = values => {
  const v = values.filter(Number.isFinite);
  return { n: v.length, median: percentile(v, 50), p90: percentile(v, 90) };
};

/** Median and p90 (nearest rank) per part and runner kind, plus every worker-* shard together. */
export function summarise(data) {
  const keys = [...new Set(data.rows.map(r => `${r.part}\u0000${r.runner}`))].sort();
  const group = (rows, part, runner) => ({ part, runner, wait: stats(rows.map(r => r.wait)), job: stats(rows.map(r => r.job)), tests: stats(rows.map(r => r.tests)) });
  const parts = keys.map(key => {
    const [part, runner] = key.split('\u0000');
    return group(data.rows.filter(r => r.part === part && r.runner === runner), part, runner);
  });
  const workers = [...new Set(data.rows.filter(r => r.part.startsWith('worker-')).map(r => r.runner))].sort()
    .map(runner => group(data.rows.filter(r => r.part.startsWith('worker-') && r.runner === runner), 'all worker-*', runner));
  return { runs: data.runs.length, parts, workers, workerWall: stats(data.runs.map(r => r.workerWall)) };
}

const minutes = s => (Number.isFinite(s) ? (s / 60).toFixed(1) : 'Not recorded');
const cell = s => `${minutes(s.median)} / ${minutes(s.p90)}`;

/** A Markdown table, minutes, "median / p90". */
export function report(data) {
  const sum = summarise(data);
  const lines = [
    `Merge-queue suite shards, ${sum.runs} successful merge_group runs of ci.yml (${data.runs.map(r => r.run).join(', ')}).`,
    'Minutes, median / p90 (nearest rank). Wait: created to started. Job: started to completed. Tests: the test-drift-parts step.',
    '',
    '| Part | Runner | n | Wait | Job | Tests |',
    '| --- | --- | --- | --- | --- | --- |',
    ...[...sum.parts, ...sum.workers].map(r => `| ${r.part} | ${r.runner} | ${r.job.n} | ${cell(r.wait)} | ${cell(r.job)} | ${cell(r.tests)} |`),
    '',
    `Worker wall per run (first worker shard created to last completed): ${cell(sum.workerWall)} (n ${sum.workerWall.n}).`,
  ];
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2), read = path => JSON.parse(execFileSync('gh', ['api', path, '--method', 'GET'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }))) {
  let runs = 10; let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--runs') runs = Number(argv[++i]);
    else if (argv[i] === '--json') json = true;
    else { console.error(`queue-larger-runners: unknown option ${argv[i]}`); return 2; }
  }
  const data = collect(read, { runs });
  console.log(json ? JSON.stringify({ ...data, summary: summarise(data) }, null, 2) : report(data));
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = main(); } catch (error) { console.error(`queue-larger-runners: ${error.message}`); process.exitCode = 1; }
}
