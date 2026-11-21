/**
 * #6463: the Actions-queue alert leaves out queued runs created before `QUEUE_ALERT_IGNORE_BEFORE`.
 *
 * About 207 runs from 2026-11-11 are stuck as queued and GitHub will neither start nor cancel them, so
 * `[alert] the Actions queue is backed up` (#5719) could never clear: it counted them and measured its
 * oldest age from them. With the cutoff set, those runs are left out of both figures and the alert issue
 * says how many were ignored and from when. Unset is today's behaviour; an invalid date ignores nothing.
 *
 * Mutation-checked (each fails this file, then passes again once restored):
 *   - `queueAfterCutoff` ignoring runs at or after the cutoff (`<` changed to `<=`): the boundary test fails;
 *   - the unread-run guard removed (`unread ? oldestOf(seen) :` dropped): the 1,000-run window test fails;
 *   - the CLI reading only the last page with a cutoff set: the CLI test sees 0 ignored and stays open;
 *   - `parseQueueCutoff` accepting any string: the invalid-date test fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  ALERT_KINDS, message, parseQueueCutoff, queueAfterCutoff, queueCutoffLine, queueState, withQueueCutoffLine,
} from '../../scripts/lib/githubAlerts.mjs';
import { safeHealthFacts } from '../../scripts/health-alert-episodes.mjs';

const now = Date.parse('2026-11-14T18:00:00Z');
const thresholds = { queued: 40, oldestMinutes: 45 };
const cutoff = parseQueueCutoff('2026-11-12');
const old = n => Array.from({ length: n }, (_, i) => ({ id: 1000 + i, created_at: `2026-11-11T${String(8 + (i % 10)).padStart(2, '0')}:00:00Z` }));
const fresh = (n, at = now) => Array.from({ length: n }, (_, i) => ({ id: 9000 + i, created_at: new Date(at - (i + 1) * 60_000).toISOString() }));
const state = (read, issueOpen = true) => queueState({ queued: read.queued, oldestCreatedAt: read.oldestCreatedAt, now, thresholds, issueOpen });

test('207 old queued runs and 10 fresh ones: the alert closes', () => {
  const runs = [...fresh(10), ...old(207)];
  const read = queueAfterCutoff({ total: runs.length, runs, cutoff });
  assert.equal(read.ignored, 207);
  assert.equal(read.queued, 10);
  assert.equal(read.cutoff, '2026-11-12T00:00:00.000Z');
  const q = state(read);
  assert.equal(q.active, false, 'under half of both thresholds, so an open alert clears');
  assert.equal(q.waitedMin, 10, 'the oldest age is the oldest fresh run, not three days');
});

test('207 old queued runs and 60 fresh ones: the alert stays open', () => {
  const runs = [...fresh(60), ...old(207)];
  const read = queueAfterCutoff({ total: runs.length, runs, cutoff });
  assert.equal(read.queued, 60);
  assert.equal(state(read, false).active, true);
  assert.equal(state(read, true).active, true);
});

test('the oldest age ignores old runs, and a run at or after the cutoff is never ignored', () => {
  const boundary = { id: 1, created_at: '2026-11-12T00:00:00Z' };
  const runs = [{ id: 2, created_at: '2026-11-14T17:58:00Z' }, boundary, ...old(3)];
  const read = queueAfterCutoff({ total: runs.length, runs, cutoff });
  assert.equal(read.ignored, 3);
  assert.equal(read.queued, 2);
  assert.equal(read.oldestCreatedAt, boundary.created_at, 'the run created exactly at the cutoff counts');
  const unreadable = queueAfterCutoff({ total: 2, runs: [{ id: 3, created_at: 'not a date' }, ...old(1)], cutoff });
  assert.equal(unreadable.ignored, 1, 'a run with an unreadable date is counted, never ignored');
});

test('runs past the API window are counted, and the age stays the oldest run read', () => {
  // The API shows 1,000 queued runs at most; anything beyond is older than every run read and may be fresh.
  const runs = [...fresh(800), ...old(200)];
  const read = queueAfterCutoff({ total: 1_250, runs, cutoff });
  assert.equal(read.ignored, 200, 'only runs actually read are ignored');
  assert.equal(read.queued, 1_050);
  assert.equal(read.oldestCreatedAt, '2026-11-11T08:00:00Z', 'with runs unread, the age is the oldest run read, old or not');
});

test('an unset cutoff behaves as before', () => {
  for (const raw of [undefined, null, '', '   ']) assert.equal(parseQueueCutoff(raw), null, String(raw));
  const runs = [...fresh(10), ...old(207)];
  const read = queueAfterCutoff({ total: runs.length, runs: runs.slice(-1), cutoff: null });
  assert.deepEqual(read, { queued: 217, oldestCreatedAt: runs.at(-1).created_at, ignored: 0, cutoff: null });
  assert.deepEqual(state(read, true), queueState({ queued: 217, oldestCreatedAt: runs.at(-1).created_at, now, thresholds, issueOpen: true }));
  assert.equal(message('queue', 'open', { queued: 217, waitedMin: 60 }).includes('ignored'), false);
});

test('an invalid date fails loudly and ignores nothing', () => {
  for (const raw of ['yesterday', '2026-13-01', '2026-11-31', '11/12/2026', '2026-11-12T25:00Z', '1731369600000']) {
    assert.throws(() => parseQueueCutoff(raw), { message: 'queue_cutoff_invalid' }, raw);
  }
  assert.equal(parseQueueCutoff('2026-11-12T06:30:00Z').iso, '2026-11-12T06:30:00.000Z');
  assert.equal(parseQueueCutoff('2026-11-12T08:00:00+02:00').iso, '2026-11-12T06:00:00.000Z');
});

test('the exclusion is visible: the Slack line and the issue line name the count and the cutoff', () => {
  const facts = { queued: 60, waitedMin: 50, ignored: 207, cutoff: '2026-11-12T00:00:00.000Z' };
  assert.deepEqual(safeHealthFacts(facts), facts, 'the health monitor keeps both facts');
  assert.deepEqual(safeHealthFacts({ ignored: -1, cutoff: '2026-11-12' }), {}, 'and drops a malformed one');
  assert.match(message('queue', 'open', facts), /60 runs queued, the oldest waiting 50 min \(207 queued before 2026-11-12T00:00:00\.000Z ignored\)/);
  const marker = '<!-- studioos-health:v1 {"schema":1} -->';
  const body = withQueueCutoffLine(`Opened.\n\n${marker}`, facts);
  assert.equal(body, `Opened.\n\n${queueCutoffLine(facts)}\n\n${marker}`);
  assert.match(body, /^Ignored: 207 queued run\(s\) created before 2026-11-12T00:00:00\.000Z/m);
  const again = withQueueCutoffLine(body, { ...facts, ignored: 205 });
  assert.equal((again.match(/^Ignored: /gm) || []).length, 1, 'the line is replaced, not repeated');
  assert.match(again, /Ignored: 205 /);
  assert.ok(again.endsWith(marker), 'the health marker stays last, where the monitor reads it');
});

test('the CLI reads every page with the cutoff set and writes the ignored count into the open alert issue', () => {
  // The child's clock is frozen at `now` (below), so the fresh runs are minutes old by its clock too.
  const runs = [...fresh(10), ...old(207)];
  const issue = { number: 5719, title: ALERT_KINDS.queue.title, state: 'open', body: 'The queue is backed up.', labels: [{ name: 'ci' }, { name: 'observability' }], user: { login: 'github-actions[bot]' } };
  const code = `
    const { issue, runs, at } = JSON.parse(process.env.Q6463_FIXTURE);
    Date.now = () => at;
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      if (init.method === 'PATCH' || init.method === 'POST') {
        const body = JSON.parse(init.body);
        if (typeof body.body === 'string') { issue.body = body.body; console.log('ISSUE_BODY ' + JSON.stringify(body.body)); }
        if (body.state) { issue.state = body.state; console.log('ISSUE_STATE ' + body.state); }
        return Response.json(issue);
      }
      if (u.pathname.endsWith('/actions/runs')) {
        const page = Number(u.searchParams.get('page') || 1);
        return Response.json({ total_count: runs.length, workflow_runs: runs.slice((page - 1) * 100, page * 100) });
      }
      if (u.pathname.endsWith('/issues')) return Response.json(Number(u.searchParams.get('page') || 1) > 1 ? [] : [issue].filter(i => u.searchParams.get('state') === 'all' || i.state === 'open'));
      return Response.json({});
    };`;
  const run = extra => spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(code), 'scripts/github-alerts.mjs', 'queue'], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: 'AxalNetwork/StudioOS', GITHUB_TOKEN: 'fixture', SLACK_GITHUB_WEBHOOK_URL: '', Q6463_FIXTURE: JSON.stringify({ issue, runs, at: now }), ...extra },
  });
  const withCutoff = run({ QUEUE_ALERT_IGNORE_BEFORE: '2026-11-12' });
  assert.match(withCutoff.stdout, /ISSUE_BODY "[^"]*Ignored: 207 queued run\(s\) created before 2026-11-12T00:00:00\.000Z/);
  assert.match(withCutoff.stdout, /ISSUE_STATE closed/, '10 fresh runs: the alert recovers');

  const unset = run({ QUEUE_ALERT_IGNORE_BEFORE: '' });
  assert.doesNotMatch(unset.stdout, /Ignored: /);
  assert.doesNotMatch(unset.stdout, /ISSUE_STATE closed/, 'unset: the three-day-old runs still hold it open, as before');

  const invalid = run({ QUEUE_ALERT_IGNORE_BEFORE: 'last tuesday' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /QUEUE_ALERT_IGNORE_BEFORE is not an ISO date; no queued run is ignored/);
  assert.doesNotMatch(invalid.stdout, /Ignored: |ISSUE_STATE closed/);
});
