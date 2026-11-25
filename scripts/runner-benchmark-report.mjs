#!/usr/bin/env node
// D5611: read-only report for one branch-only runner benchmark, with rounded
// per-job cost and wait evidence.
//
// D5611: read one benchmark run and its paginated jobs; print provenance and lane measurements only.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { benchmarkStages, codebuildRunnerLabel, summarise } from './lib/runnerBenchmark.mjs';
import { partsOf } from './test-drift-parts.mjs';
import { readFileSync } from 'node:fs';

export function collect(read, repo, runId) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[1-9]\d*$/.test(String(runId))) throw new Error('expected repository and numeric run id');
  const run = read(`repos/${repo}/actions/runs/${runId}`);
  if (run.event !== 'push' || !/^bench\/runners-[\w.-]+$/.test(run.head_branch || '') || run.path !== '.github/workflows/runner-benchmark.yml') throw new Error('not a branch-only runner benchmark');
  const jobs = [];
  for (let page = 1; page <= 100; page++) {
    const result = read(`repos/${repo}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`);
    jobs.push(...result.jobs);
    if (result.jobs.length < 100) {
      const measurements = jobs.flatMap(j => {
        const match = /^benchmark\/(free|github8|ephemeral|codebuild)\/([\w-]+)$/.exec(j.name || '');
        return match ? [{ ...j, lane: match[1], part: match[2] }] : [];
      });
      const expected = partsOf(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).scripts).map(p => p.name).sort();
      const lanes = summarise(measurements).map(lane => {
        const shards = measurements.filter(job => job.lane === lane.lane);
        const coverageComplete = JSON.stringify(shards.map(job => job.part).sort()) === JSON.stringify(expected);
        const result = { ...lane, coverageComplete, comparable: lane.success && coverageComplete };
        if (lane.lane === 'codebuild') {
          const label = codebuildRunnerLabel(runId, run.run_attempt);
          result.githubRunnerAssignmentVerified = shards.every(job =>
            Number.isSafeInteger(job.runner_id) && job.runner_id > 0 && Array.isArray(job.labels) && job.labels.includes(label));
          result.comparable = result.comparable && result.githubRunnerAssignmentVerified;
          result.awsComputeType = null;
        }
        return result;
      });
      const stages = benchmarkStages(jobs);
      const candidateComparable = lanes.length === 1 && lanes[0].comparable && stages.plannerToGateMin !== null &&
        stages.planner.conclusion === 'success' && stages.gate.conclusion === 'success';
      return { run: `https://github.com/${repo}/actions/runs/${runId}`, sha: run.head_sha, attempt: run.run_attempt, lanes,
        stages, candidateComparable,
        note: 'Per-lane wall covers suite jobs. Planner-to-gate time includes GitHub-hosted coordination; it is shared when multiple lanes run together. Use isolated trials on the same tested checkout for end-to-end comparisons. CodeBuild comparisons require the expected requested label and a GitHub runner assignment on each shard. Confirm compute type and billing using AWS records. Other priced lanes use whole minutes per suite job. Coverage uses the current checkout.' };
    }
  }
  throw new Error('job pagination cap exceeded');
}
export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) throw new Error('usage: runner-benchmark-report.mjs <run id>');
  const read = path => JSON.parse(execFileSync('gh', ['api', path, '--method', 'GET'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  console.log(JSON.stringify(collect(read, process.env.GH_REPO || 'AxalNetwork/StudioOS', argv[0]), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { console.error('Runner benchmark report unavailable; check the run id, read permissions and benchmark metadata.'); process.exitCode = 1; }
}
