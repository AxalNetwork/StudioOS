#!/usr/bin/env node
// D5611: read one benchmark run and its paginated jobs; print provenance and lane measurements only.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { summarise } from './lib/runnerBenchmark.mjs';
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
        const match = /^benchmark\/(free|github8|ephemeral)\/([\w-]+)$/.exec(j.name || '');
        return match ? [{ ...j, lane: match[1], part: match[2] }] : [];
      });
      const expected = partsOf(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).scripts).map(p => p.name).sort();
      const lanes = summarise(measurements).map(lane => {
        const coverageComplete = JSON.stringify(measurements.filter(j => j.lane === lane.lane).map(j => j.part).sort()) === JSON.stringify(expected);
        return { ...lane, coverageComplete, comparable: lane.success && coverageComplete };
      });
      return { run: `https://github.com/${repo}/actions/runs/${runId}`, sha: run.head_sha, attempt: run.run_attempt, lanes,
        note: 'Per-lane wall includes runner wait. Cost rounds each measured suite job up to whole minutes. The free planning job is excluded. Part coverage uses the current checkout; run this report from the tested candidate. Empty lanes are not measured; no speedup is assumed.' };
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
