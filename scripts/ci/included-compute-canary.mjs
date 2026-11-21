#!/usr/bin/env node
/**
 * D7907 (#7907): the bounded included-compute canary. One real Worker shard of one pinned main commit runs
 * once on github-8 (group 6) and once on standard hosted, against one equal-weights plan. It changes no
 * routing, no required check and no variable; it only measures. Modes:
 *   pin     verify SOURCE_SHA is on main (compare API), write the plan's digest to GITHUB_OUTPUT
 *   run     run the fixed driver for PART from the pinned checkout and write this lane's evidence JSON
 *   report  read the lanes' evidence and the run's jobs, write the comparison to the job summary
 * A value nobody measured is "Not recorded", never 0. Included-compute overage is not readable with the
 * job token, so the report says so and the operator records it from the billing page.
 */
import { appendFileSync, readFileSync, writeFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { availableParallelism, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'AxalNetwork/StudioOS';
export const LANES = Object.freeze(['github-8', 'hosted']);
export const PARTS = Object.freeze(Array.from({ length: 6 }, (_, i) => `worker-${i + 1}-of-6`));
export const JOB_NAMES = Object.freeze({ 'github-8': 'canary (github-8)', hosted: 'canary (hosted)' });
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const NOT_RECORDED = 'Not recorded';
const need = (ok, reason) => { if (!ok) throw new Error(reason); };

/** The dispatched commit must already be on main, so the canary never runs unreviewed code. */
export function verifySource(sourceSha, compare) {
  need(SHA.test(sourceSha ?? ''), 'source_sha_invalid');
  need(['identical', 'ahead'].includes(compare?.status) && compare.base_commit?.sha === sourceSha
    && compare.merge_base_commit?.sha === sourceSha, 'source_not_on_main');
  return sourceSha;
}

export const planDigest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** One lane's evidence. Every field is measured here or is explicitly absent. */
export function laneEvidence({ lane, part, sourceSha, digest, env, startedAt, finishedAt, exitCode, cpus, memoryBytes }) {
  need(LANES.includes(lane) && PARTS.includes(part) && SHA.test(sourceSha ?? '') && DIGEST.test(digest ?? ''), 'evidence_identity_invalid');
  const timed = Number.isSafeInteger(startedAt) && Number.isSafeInteger(finishedAt) && finishedAt >= startedAt;
  return {
    version: 1, lane, part, sourceSha, planDigest: digest,
    runId: env.GITHUB_RUN_ID ?? null, runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    runner: env.RUNNER_NAME ?? null, os: env.RUNNER_OS ?? null, arch: env.RUNNER_ARCH ?? null,
    cpus: Number.isSafeInteger(cpus) ? cpus : null, memoryBytes: Number.isSafeInteger(memoryBytes) ? memoryBytes : null,
    testStartedAt: timed ? new Date(startedAt).toISOString() : null,
    testSeconds: timed ? Math.round((finishedAt - startedAt) / 1000) : null,
    exitCode: Number.isSafeInteger(exitCode) ? exitCode : null,
  };
}

const seconds = (job) => {
  const a = Date.parse(job?.started_at), b = Date.parse(job?.completed_at);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 1000) : null;
};
const queued = (job) => {
  const a = Date.parse(job?.created_at), b = Date.parse(job?.started_at);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 1000) : null;
};
const show = (v, unit = '') => (v === null || v === undefined ? NOT_RECORDED : `${v}${unit}`);

/** The comparison table. Lanes must agree on source, part and plan, or the comparison is refused. */
export function canaryReport({ sourceSha, part, digest, evidence, jobs }) {
  const rows = LANES.map((lane) => {
    const own = evidence.filter((e) => e?.lane === lane);
    const e = own.length === 1 ? own[0] : null;
    const matching = (jobs ?? []).filter((j) => j?.name === JOB_NAMES[lane]);
    const job = matching.length === 1 ? matching[0] : null;
    return { lane, e, job };
  });
  const mismatch = rows.some(({ e }) => e && (e.sourceSha !== sourceSha || e.part !== part || e.planDigest !== digest));
  const lines = [
    '## Included compute canary (D7907)', '',
    `Source \`${sourceSha}\` · part \`${part}\` · plan \`${digest}\``, '',
  ];
  if (mismatch) return { ok: false, markdown: [...lines, 'Refused: the lanes ran a different source, part or plan, so they are not compared.'].join('\n') };
  lines.push('| Lane | Runner | CPUs | Queued | Job | Test | Test exit | Job conclusion |', '|---|---|---|---|---|---|---|---|');
  for (const { lane, e, job } of rows) {
    lines.push(`| ${lane} | ${show(e?.runner)} | ${show(e?.cpus)} | ${show(queued(job), ' s')} | ${show(seconds(job), ' s')} | ${show(e?.testSeconds, ' s')} | ${show(e?.exitCode)} | ${show(job?.conclusion)} |`);
  }
  const [inc, std] = rows.map(({ e }) => e?.testSeconds ?? null);
  lines.push('', `Test time, github-8 against hosted: ${inc !== null && std !== null && std > 0 ? `${(inc / std).toFixed(2)}×` : NOT_RECORDED}.`);
  lines.push('Included-compute overage: Not recorded. The job token cannot read organization billing; the operator records it from the billing page.');
  const ok = rows.every(({ e, job }) => e?.exitCode === 0 && job?.conclusion === 'success');
  return { ok, markdown: lines.join('\n') };
}

function output(env, values) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''));
}

export async function main(mode, env = process.env, deps = {}) {
  const fetchJson = deps.fetchJson ?? (async (path) => {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, {
      redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GH_TOKEN}`, 'X-GitHub-Api-Version': '2026-03-10' },
    });
    need(response.ok, 'github_read_failed');
    return response.json();
  });
  need(env.GITHUB_REPOSITORY === REPOSITORY, 'wrong_repository');
  need(PARTS.includes(env.PART ?? ''), 'part_invalid');
  if (mode === 'pin') {
    const sha = verifySource(env.SOURCE_SHA, await fetchJson(`/compare/${env.SOURCE_SHA}...main?per_page=1`));
    output(env, { source_sha: sha });
    return 0;
  }
  if (mode === 'digest') {
    const digest = planDigest(readFileSync(env.PLAN_FILE));
    need(!env.EXPECTED_DIGEST || env.EXPECTED_DIGEST === digest, 'plan_digest_mismatch');
    output(env, { plan_digest: digest });
    return 0;
  }
  if (mode === 'run') {
    need(LANES.includes(env.LANE ?? ''), 'lane_invalid');
    const source = realpathSync(env.SOURCE_DIR);
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).stdout.trim();
    need(SHA.test(env.SOURCE_SHA ?? '') && head === env.SOURCE_SHA, 'checkout_sha_mismatch');
    const digest = planDigest(readFileSync(env.PLAN_FILE));
    need(digest === env.PLAN_DIGEST, 'plan_digest_mismatch');
    const startedAt = Date.now();
    const result = (deps.spawn ?? spawnSync)(process.execPath, [join(source, 'scripts', 'test-drift-parts.mjs'), env.PART, '--plan-file', resolve(env.PLAN_FILE)],
      { cwd: source, stdio: 'inherit', shell: false, timeout: Number(env.TEST_TIMEOUT_MS) || 40 * 60_000 });
    const finishedAt = Date.now();
    const evidence = laneEvidence({ lane: env.LANE, part: env.PART, sourceSha: env.SOURCE_SHA, digest, env, startedAt, finishedAt,
      exitCode: result.status ?? null, cpus: availableParallelism(), memoryBytes: totalmem() });
    writeFileSync(env.EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);
    return result.status === 0 ? 0 : 1;
  }
  if (mode === 'report') {
    const dir = env.EVIDENCE_DIR;
    const evidence = existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.json'))
      .map((f) => { try { return JSON.parse(readFileSync(join(dir, String(f)), 'utf8')); } catch { return null; } }) : [];
    let jobs = [];
    try { jobs = (await fetchJson(`/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}/jobs?per_page=100`)).jobs ?? []; } catch { jobs = []; }
    const { ok, markdown } = canaryReport({ sourceSha: env.SOURCE_SHA, part: env.PART, digest: env.PLAN_DIGEST, evidence, jobs });
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
    console.log(markdown);
    return ok ? 0 : 1;
  }
  throw new Error('mode_invalid');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await main(process.argv[2]); } catch (e) { console.error(`::error::${e.message}`); process.exitCode = 1; }
}
