/** D8013: synthetic GET observations, not live queue or cancellation evidence. */
import { PREFIX, REPOSITORY, SNAPSHOT_SCHEMA, LIMITS } from './queue-capacity-audit.mjs';

export const AT = '2026-11-21T13:00:00.000Z';
export const SHA = 'a'.repeat(40), MAIN = 'b'.repeat(40), NEW = 'c'.repeat(40), PR = 'd'.repeat(40);
export const branch = `gh-readonly-queue/main/pr-42-${MAIN}`;
export const refPath = value => `${PREFIX}/git/ref/heads/${encodeURIComponent(value)}`;
export const current = id => `${PREFIX}/actions/runs/${id}`;
export const observation = (data, status = 200, extra = {}) => ({ status, complete: true, observedAt: AT, data, ...extra });
export const run = (extra = {}) => ({ id: 11, run_attempt: 2, workflow_id: 5, name: 'CI', path: '.github/workflows/ci.yml', event: 'merge_group',
  head_sha: SHA, head_branch: branch, status: 'queued', conclusion: null, created_at: '2026-11-11T13:00:00.000Z',
  run_started_at: '2026-11-21T12:55:00.000Z', repository: { full_name: REPOSITORY }, ...extra });
const job = (extra = {}) => ({ id: 21, run_id: 11, run_attempt: 2, head_sha: SHA, name: 'aggregate', status: 'queued',
  created_at: '2026-11-21T12:59:00.000Z', started_at: null, completed_at: null, ...extra });
export const pr = (extra = {}) => ({ number: 42, state: 'open', merged: false, merged_at: null, head: { sha: PR }, base: { repo: { full_name: REPOSITORY } }, ...extra });

export function fixture(extra = {}) {
  const r = run(extra);
  const requests = {
    [PREFIX]: observation({ id: 10, full_name: REPOSITORY }),
    [refPath('main')]: observation({ ref: 'refs/heads/main', object: { type: 'commit', sha: MAIN } }),
    [`${PREFIX}/git/matching-refs/heads/gh-readonly-queue/main/`]: observation([]),
    [`${PREFIX}/pulls?state=open&per_page=100&page=1`]: observation([pr()]),
    [`${PREFIX}/pulls/42`]: observation(pr()),
    [current(r.id)]: observation(r),
    [`${current(r.id)}/attempts/${r.run_attempt}`]: observation(r),
    [`${current(r.id)}/attempts/${r.run_attempt}/jobs?per_page=100&page=1`]: observation({ total_count: 1, jobs: [job({ run_id: r.id, run_attempt: r.run_attempt, head_sha: r.head_sha })] }),
    [refPath(r.head_branch)]: observation(null, 404),
  };
  for (const status of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) {
    const workflow_runs = r.status === status ? [r] : [];
    requests[`${PREFIX}/actions/runs?status=${status}&per_page=100&page=1`] = observation({ total_count: workflow_runs.length, workflow_runs });
  }
  return { schema: SNAPSHOT_SCHEMA, repository: REPOSITORY, startedAt: AT, observedAt: AT, runIds: [r.id],
    limits: LIMITS, selection: 'synthetic_fixture', reportingContext: { cutoff: null, issueOpen: true }, requests };
}
