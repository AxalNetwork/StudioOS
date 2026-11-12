// D5663: trusted reporter loads bounded producer artifacts and checks same-attempt Actions execution.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { partsOf } from './test-drift-parts.mjs';
import { assessFutureClock } from './lib/futureClockEvidence.mjs';

export async function futureClockReport({ env, api }) {
  if (!/^[1-9]\d*$/.test(env.GITHUB_RUN_ID || '') || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT || '') || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) throw new Error('report_identity_invalid');
  const root = `/repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const run = await api(root);
  if (run.head_sha !== env.GITHUB_SHA || Number(run.run_attempt) !== Number(env.GITHUB_RUN_ATTEMPT)) throw new Error('report_provenance_invalid');
  const expected = partsOf(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).scripts).filter(p => p.name !== 'rest').map(p => p.name);
  const jobs = [];
  for (let page = 1; ; page++) {
    if (page > 100) throw new Error('report_jobs_incomplete');
    const response = await api(`${root}/attempts/${env.GITHUB_RUN_ATTEMPT}/jobs?per_page=100&page=${page}`);
    if (!Array.isArray(response.jobs)) throw new Error('report_jobs_invalid');
    jobs.push(...response.jobs);
    if (response.jobs.length < 100) break;
  }
  const blobs = [];
  let dirs = [];
  try { dirs = readdirSync(env.FUTURE_CLOCK_DIR); } catch { /* unavailable artifacts remain unknown */ }
  for (const dir of dirs) {
    const part = dir.replace(/^future-clock-/, '');
    try {
      const base = join(env.FUTURE_CLOCK_DIR, dir);
      if (dir !== `future-clock-${part}` || !expected.includes(part)) { blobs.push({ part: 'unexpected' }); continue; }
      if (statSync(join(base, 'manifest.json')).size > 4096 || statSync(join(base, 'future-clock.tap')).size > 100_000_000) { blobs.push({ part }); continue; }
      blobs.push({ part, manifest: JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')), tap: readFileSync(join(base, 'future-clock.tap'), 'utf8') });
    } catch { blobs.push({ part }); }
  }
  return assessFutureClock({ expected, blobs, jobs, runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT, sha: env.GITHUB_SHA });
}
