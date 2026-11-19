/** #6478: the serial refresh, on fixture runs: selection, rate, stops, skips, conflicts, and the workflow text. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { allowance, inherited, recheckOne, refreshSerially, reservationName } from '../../scripts/landing-bot/refresh-rules.mjs';
import { assertWorkflow, parseJobs } from '../../scripts/landing-bot/workflowGuard.mjs';
import { outputLine } from '../../scripts/landing-bot/refresh.mjs';

const ROOT = new URL('../../', import.meta.url);
const WORKFLOW = readFileSync(new URL('.github/workflows/landing-bot-refresh.yml', ROOT), 'utf8');
const NOW = Date.parse('2026-11-16T12:00:00Z');
const REPO = 'AxalNetwork/StudioOS';
const redMain = { conclusion: 'failure', jobs: [{ name: 'test (worker)', conclusion: 'failure' }, { name: 'build', conclusion: 'success' }] };
const pr = (n, over = {}) => ({
  number: n, state: 'open', draft: false, labels: [], body: '', head: { sha: `${n}`.padStart(40, 'a'), ref: `agent/x/${n}`, repo: { full_name: REPO } }, base: { repo: { full_name: REPO } },
  latestRun: { head_sha: `${n}`.padStart(40, 'a'), conclusion: 'failure', jobs: [{ name: 'test (worker)', conclusion: 'failure' }, { name: 'build', conclusion: 'success' }] },
  ...over,
});
const env = { LANDING_BOT_ENABLED: 'true', LANDING_BOT_REFRESH_PER_WINDOW: '5', LANDING_BOT_REFRESH_WINDOW_MIN: '30' };
const shut = { open: false, reasons: [] };

test('#6478: only inherited failures are selected; own failures, drafts, green and stale runs are not', () => {
  const own = pr(2, { latestRun: { head_sha: pr(2).head.sha, conclusion: 'failure', jobs: [{ name: 'test (frontend)', conclusion: 'failure' }] } });
  const draft = pr(3, { draft: true });
  const greenRun = pr(4, { latestRun: { head_sha: pr(4).head.sha, conclusion: 'success', jobs: [] } });
  const stale = pr(5, { latestRun: { head_sha: 'f'.repeat(40), conclusion: 'failure', jobs: [] } });
  const r = inherited([pr(1), own, draft, greenRun, stale], redMain);
  assert.deepEqual(r.picked.map((p) => p.number), [1]);
  const why = Object.fromEntries(r.skipped.map((s) => [s.number, s.reasons.join()]));
  assert.match(why[2], /verdict pr_failure/);
  assert.match(why[3], /draft/);
  assert.match(why[4], /success/);
  assert.match(why[5], /no CI run on its current head/);
});

test('#6478: the rate is honoured over 30 PRs, across runs in the same window', async () => {
  const thirty = Array.from({ length: 30 }, (_, i) => pr(i + 1));
  assert.deepEqual(allowance([], env, NOW), { n: 5, used: 0, per: 5, windowMin: 30 });
  const earlier = [{ name: reservationName({ day: '2026-11-16', runId: 9, attempt: 1, n: 3 }), created_at: '2026-11-16T11:45:00Z' }];
  assert.equal(allowance(earlier, env, NOW).n, 2, 'three already used in this 30-minute window');
  const old = [{ name: reservationName({ day: '2026-11-16', runId: 8, attempt: 1, n: 5 }), created_at: '2026-11-16T11:00:00Z' }];
  assert.equal(allowance(old, env, NOW).n, 5, 'outside the window');
  assert.equal(allowance(null, env, NOW).n, 0, 'an unreadable count allows nothing');
  assert.equal(allowance([], { LANDING_BOT_ENABLED: 'true' }, NOW).n, 0, 'unset rate allows nothing');
  const updated = [];
  const r = await refreshSerially(thirty, 5, { recheck: async () => ({}), update: async (p) => { updated.push(p.number); return { ok: true }; }, label: async () => {} });
  assert.deepEqual(updated, [1, 2, 3, 4, 5], 'one at a time, in order');
  assert.equal(r.log.filter((l) => l.result === 'left for the next window').length, 25);
});

test('#6478: it stops at once when main turns red or queued runs pass the limit mid-list', async () => {
  for (const reason of ['main is red: its newest completed CI run is failure', '40 queued CI runs, above LANDING_BOT_MAX_QUEUED_RUNS (20)']) {
    const updated = [];
    let i = 0;
    const r = await refreshSerially([pr(1), pr(2), pr(3), pr(4)], 4, {
      recheck: async () => (++i === 3 ? recheckOne(pr(3), pr(3), { env, repo: REPO, files: [], breakers: { open: true, reasons: [reason] } }) : {}),
      update: async (p) => { updated.push(p.number); return { ok: true }; }, label: async () => {},
    });
    assert.deepEqual(updated, [1, 2], reason);
    assert.match(r.log.at(-1).result, /^stopped: /);
    assert.equal(r.log.length, 3, 'nothing after the stop');
  }
});

test('#6478: bot:off, changed heads, a PR turned draft and mode off are skipped', () => {
  const c = { env, event: 'schedule', repo: REPO, files: [{ path: 'frontend/src/pages/A.jsx' }], breakers: shut };
  assert.deepEqual(recheckOne(pr(1), pr(1), c), {});
  assert.match(recheckOne(pr(1), pr(1, { labels: ['bot:off'] }), c).skip, /bot:off/);
  assert.match(recheckOne(pr(1), pr(1, { head: { ...pr(1).head, sha: 'e'.repeat(40) } }), c).skip, /head changed/);
  assert.match(recheckOne(pr(1), pr(1, { draft: true }), c).skip, /draft/);
  assert.match(recheckOne(pr(1), pr(1), { ...c, env: {} }).skip, /mode off/);
});

test('#6478: a conflict is labelled for the branch keeper and not retried', async () => {
  const calls = [];
  const labels = [];
  const r = await refreshSerially([pr(1), pr(2)], 2, {
    recheck: async () => ({}),
    update: async (p) => { calls.push(p.number); return p.number === 1 ? { conflict: true } : { ok: true }; },
    label: async (p, name) => { labels.push([p.number, name]); },
  });
  assert.deepEqual(calls, [1, 2], 'each PR is tried once');
  assert.deepEqual(labels, [[1, 'conflict']]);
  assert.match(r.log[0].result, /conflict: labelled/);
});

test('#6478: the workflow: gated to main of this repository, no PR or workflow_run trigger, guard passes', () => {
  assert.doesNotMatch(WORKFLOW, /^\s*(?:pull_request|pull_request_target|workflow_run|issue_comment|push):/m);
  assert.match(WORKFLOW, /github\.repository == 'AxalNetwork\/StudioOS' && github\.ref == 'refs\/heads\/main'/);
  assert.match(WORKFLOW, /concurrency:\n {2}group: studioos-landing-bot-refresh\n {2}cancel-in-progress: false/);
  const { jobs } = parseJobs(WORKFLOW);
  for (const step of jobs.flatMap((j) => j.steps).filter((s) => /\brun:/.test(s))) assert.doesNotMatch(step.slice(step.indexOf('run:')), /\$\{\{/);
  const src = readFileSync(new URL('scripts/landing-bot/refresh.mjs', ROOT), 'utf8');
  assert.match(src, /update-branch`, \{ expected_head_sha: pr\.head\.sha \}/);
  assert.doesNotMatch(WORKFLOW + src, /--force|force-with-lease|enqueuePullRequest|gh pr merge|HEAD:refs\/heads\/main\b/);
  assertWorkflow(new URL('.github/workflows/landing-bot-refresh.yml', ROOT).pathname);
});

test('#6478: a step output is one line; a line break or a bad name is refused', () => {
  assert.equal(outputLine('count', 3), 'count=3\n');
  assert.equal(outputLine('reservation', 'refresh-2026-11-19-1-1-3'), 'reservation=refresh-2026-11-19-1-1-3\n');
  assert.throws(() => outputLine('count', '3\nreservation=x'), /line break/);
  assert.throws(() => outputLine('count', '3\r'), /line break/);
  assert.throws(() => outputLine('a=b', 1), /bad output name/);
});
