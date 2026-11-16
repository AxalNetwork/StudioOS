// D5984: every GitHub call is faked through a mocked fetch. No test reaches a real repository.
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import type { Env } from '../src/types';
import { makeD1 } from './_d1_sqlite.mjs';
import { enqueueSectionIncident } from '../src/services/sectionIncidentOutbox';
import {
  linkSectionIncidentIssue, reconcileSectionIncidentIssue, restrictedClassifications, sectionOwners,
  syncSectionIncidentIssues, validOwner,
} from '../src/services/sectionIncidentIssue';

const section = 'axalvc-all-learning';
const channel = 'CPRIVATE0001';
const threadTs = '1794000000.000777';
const fingerprint = 'fingerprint-private-1';
const time = (minutes: number) => new Date(Date.UTC(2026, 10, 16) + minutes * 60_000);
const migration = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const ask = { caseId: 'learning-discovery', classification: 'ordinary-ui-regression' };

type Call = { method: string; path: string; body: any; raw: string };

function fixture(t: TestContext, extra: Record<string, unknown> = {}) {
  const { DB, db } = makeD1(migration('202611141540_5979_section_incident_outbox.sql')
    + migration('202611160958_5984_section_incident_issue.sql'));
  t.after(() => db.close());
  const env = { DB, GITHUB_ACCESS_TOKEN: 'fixture-token', GITHUB_REPO_OWNER: 'fixture-owner', GITHUB_REPO_NAME: 'fixture-repo',
    AXAL_SECTION_INCIDENT_GITHUB: 'enabled', ...extra } as unknown as Env;
  const calls: Call[] = [];
  const replies: Array<Response | Error> = [];
  const comments: Array<{ body: string }> = [];
  const intents: unknown[] = [];
  let created: Record<string, unknown> | null = null;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url);
    assert.equal(parsed.host, 'api.github.com');
    const path = parsed.pathname.replace('/repos/fixture-owner/fixture-repo', '');
    const raw = typeof init.body === 'string' ? init.body : '';
    const call = { method: init.method ?? 'GET', path, body: raw ? JSON.parse(raw) : null, raw: url + raw };
    calls.push(call);
    if (call.method === 'POST' && path === '/issues') {
      intents.push(db.prepare('SELECT github_state FROM section_incident_outbox WHERE episode_id = ?').get('episode-1')?.github_state);
      const reply = replies.shift();
      created = { number: 17, ...call.body };
      if (reply instanceof Error) throw reply;
      return reply ?? Response.json(created, { status: 201 });
    }
    if (call.method === 'POST' && path === '/issues/17/comments') {
      comments.push({ body: call.body.body });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return reply ?? Response.json({ id: comments.length }, { status: 201 });
    }
    if (call.method === 'GET' && path === '/issues/17/comments') return Response.json(comments);
    if (call.method === 'GET' && /^\/issues\/\d+$/.test(path)) {
      const number = Number(path.slice(8));
      return number === 17 && created ? Response.json(created) : Response.json({ number, body: 'other' });
    }
    throw new Error(`unexpected GitHub call ${call.method} ${path}`);
  });
  const occur = async (eventId: string, episodeId = 'episode-1') => {
    const tasks: Promise<unknown>[] = [];
    enqueueSectionIncident(env, { waitUntil: task => tasks.push(task) },
      { episodeId, eventId, fingerprint, section, kind: 'occurrence' });
    await Promise.all(tasks);
  };
  const row = (episodeId = 'episode-1') => db.prepare('SELECT * FROM section_incident_outbox WHERE episode_id = ?').get(episodeId) as any;
  const keepThread = () => db.prepare('UPDATE section_incident_outbox SET channel_id = ?, message_ts = ?').run(channel, threadTs);
  const creates = () => calls.filter(c => c.method === 'POST' && c.path === '/issues');
  return { env, calls, replies, comments, intents, occur, row, keepThread, creates };
}

test('off by default: no flag, another flag value or a branch Worker makes no GitHub call', async t => {
  for (const extra of [{ AXAL_SECTION_INCIDENT_GITHUB: undefined }, { AXAL_SECTION_INCIDENT_GITHUB: '1' },
    { BRANCH_CODE: 'acme' }, { GITHUB_ACCESS_TOKEN: undefined }]) {
    const f = fixture(t, extra);
    await f.occur('a');
    assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(0)), { state: 'unconfigured' });
    assert.equal(await syncSectionIncidentIssues(f.env, time(0)), 'unconfigured');
    assert.equal(await reconcileSectionIncidentIssue(f.env, 'episode-1', 17), 'unconfigured');
    assert.equal(f.calls.length, 0);
    t.mock.restoreAll();
  }
});

test('one bug per episode: intent first, the same number on retry and after the episode reopens', async t => {
  const f = fixture(t);
  await f.occur('a');
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(0)), { state: 'filed', issue: 17 });
  assert.deepEqual(f.intents, ['filing']);
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(1)), { state: 'linked', issue: 17 });
  const tasks: Promise<unknown>[] = [];
  enqueueSectionIncident(f.env, { waitUntil: task => tasks.push(task) },
    { episodeId: 'episode-1', eventId: 'recovered', fingerprint, section, kind: 'recovery' });
  await Promise.all(tasks);
  await f.occur('reopened');
  assert.equal(await syncSectionIncidentIssues(f.env, time(2)), 'checked');
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(3)), { state: 'linked', issue: 17 });
  assert.equal(f.creates().length, 1);
  assert.equal(f.row().github_issue, 17);
  assert.equal(f.row().github_state, 'linked');
  const body = f.creates()[0].body;
  assert.equal(body.title, 'UI regression: Learning discovery list rendering');
  assert.deepEqual(body.labels, ['bug', 'frontend', 'observability']);
  assert.match(body.body, /Cumulative observations at filing: 1\./);
  assert.match(body.body, /<!-- axal-section-incident:v1:[0-9a-f]{64} -->/);
});

test('the Slack thread, episode and customer data stay on the row and never reach GitHub', async t => {
  const f = fixture(t);
  await f.occur('a');
  f.keepThread();
  await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(0));
  await f.occur('b');
  await syncSectionIncidentIssues(f.env, time(1));
  assert.deepEqual([f.row().channel_id, f.row().message_ts], [channel, threadTs]);
  assert.equal(f.calls.length, 2);
  const sent = f.calls.map(c => c.raw).join('\n');
  for (const secret of [channel, threadTs, fingerprint, 'episode-1', section, 'slack.com', 'archives']) {
    assert.ok(!sent.includes(secret), `GitHub request carried ${secret}`);
  }
  assert.ok(!/\bp\d{16}\b|@|https:\/\/(?!github\.com\/)/.test(f.creates()[0].body.body));
});

test('recurrence comments at powers of two on the same issue and never opens a second', async t => {
  const f = fixture(t);
  await f.occur('a');
  await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(0));
  const states = [];
  for (const [i, event] of ['b', 'c', 'd', 'e', 'f', 'g', 'h'].entries()) {
    await f.occur(event);
    states.push((await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(i + 1))).state);
  }
  assert.deepEqual(states, ['count_posted', 'linked', 'count_posted', 'linked', 'linked', 'linked', 'count_posted']);
  assert.deepEqual(f.comments.map(c => c.body.split('\n')[0]), [
    'Cumulative observations reached at least 2.', 'Cumulative observations reached at least 4.',
    'Cumulative observations reached at least 8.']);
  assert.equal(f.creates().length, 1);
  assert.equal(f.row().github_milestone, 8);
});

test('the scheduled pass files and publishes milestones for classified episodes only', async t => {
  const f = fixture(t);
  await f.occur('a');
  await f.occur('x', 'episode-unclassified');
  assert.equal(await syncSectionIncidentIssues(f.env, time(0)), 'checked');
  assert.equal(f.calls.length, 0);
  await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(0));
  for (const event of ['b', 'c', 'd']) await f.occur(event);
  await syncSectionIncidentIssues(f.env, time(1));
  await syncSectionIncidentIssues(f.env, time(2));
  assert.deepEqual(f.comments.map(c => c.body.split('\n')[0]), ['Cumulative observations reached at least 4.']);
  assert.equal(f.creates().length, 1);
});

test('restricted classes are refused before any GitHub call, and a classification cannot change', async t => {
  const f = fixture(t);
  for (const [i, classification] of restrictedClassifications.entries()) {
    await f.occur('a', `episode-r${i}`);
    assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: `episode-r${i}`, caseId: 'learning-discovery', classification }, time(0)),
      { state: 'restricted' });
    assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: `episode-r${i}`, ...ask }, time(0)),
      { state: 'classification_conflict' });
    assert.equal(f.row(`episode-r${i}`).github_reason, 'restricted');
  }
  await syncSectionIncidentIssues(f.env, time(1));
  await f.occur('a');
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', caseId: 'learning-discovery', classification: 'unknown' }, time(0)),
    { state: 'ineligible' });
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', caseId: 'help-guide-placement', classification: 'ordinary-ui-regression' }, time(0)),
    { state: 'ineligible' });
  assert.equal(f.calls.length, 0);
});

test('with the owner map empty the bug is filed unassigned; only a valid mapping could assign', async t => {
  const f = fixture(t);
  await f.occur('a');
  await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(0));
  assert.deepEqual(Object.keys(sectionOwners), []);
  assert.equal('assignees' in f.creates()[0].body, false);
  assert.equal(validOwner({ login: 'fixture-maintainer', slot: 'S12' }), true);
  for (const bad of [null, { login: 'bad login', slot: 'S12' }, { login: 'ok', slot: 'S00' }, { login: '-x', slot: 'S12' }, { login: 'ok' }]) {
    assert.equal(validOwner(bad), false);
  }
});

test('a rate limit releases the intent and waits; a validation rejection releases it too', async t => {
  const f = fixture(t);
  await f.occur('a');
  f.replies.push(Response.json({ message: 'slow down' }, { status: 429 }));
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(0)), { state: 'rate_limited' });
  assert.equal(f.row().github_state, null);
  assert.equal(f.row().github_reason, 'rate_limited');
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(14)), { state: 'deferred' });
  assert.equal(f.creates().length, 1);
  f.replies.push(Response.json({ message: 'Validation Failed' }, { status: 422 }));
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(15)), { state: 'validation_rejected' });
  assert.equal(f.row().github_state, null);
  assert.equal(f.creates().length, 2);
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(15 + 6 * 60)), { state: 'filed', issue: 17 });
  assert.equal(f.creates().length, 3);
});

test('an ambiguous create keeps its intent, blocks every new filing, and is settled by reconciliation', async t => {
  const f = fixture(t);
  await f.occur('a');
  await f.occur('a', 'episode-2');
  f.replies.push(new Error('connection reset'));
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(0)), { state: 'filing_uncertain' });
  assert.equal(f.row().github_state, 'filing');
  assert.equal(f.row().github_reason, 'create_unconfirmed');
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(1)), { state: 'filing_uncertain' });
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-2', ...ask }, time(1)), { state: 'filing_blocked' });
  await syncSectionIncidentIssues(f.env, time(2));
  assert.equal(f.creates().length, 1);
  assert.equal(await reconcileSectionIncidentIssue(f.env, 'episode-1', 18), 'mismatch');
  assert.equal(f.row().github_state, 'filing');
  assert.equal(await reconcileSectionIncidentIssue(f.env, 'episode-1', 17), 'linked');
  assert.equal(f.row().github_issue, 17);
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-2', ...ask }, time(3)), { state: 'filed', issue: 17 });
  assert.equal(f.creates().length, 2);
});

test('an ambiguous count comment is checked against its receipt and never resent', async t => {
  const f = fixture(t);
  await f.occur('a');
  await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(0));
  await f.occur('b');
  f.replies.push(Response.json({ message: 'bad gateway' }, { status: 502 }));
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(1)), { state: 'count_delivery_uncertain', issue: 17 });
  assert.equal(f.row().github_milestone_pending, 2);
  f.comments.length = 0;
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(2)), { state: 'count_delivery_uncertain', issue: 17 });
  const posts = () => f.calls.filter(c => c.method === 'POST' && c.path === '/issues/17/comments').length;
  assert.equal(posts(), 1);
  f.comments.push({ body: f.calls.find(c => c.path === '/issues/17/comments')!.body.body });
  assert.deepEqual(await linkSectionIncidentIssue(f.env, { episodeId: 'episode-1', ...ask }, time(3)), { state: 'count_posted', issue: 17 });
  assert.equal(f.row().github_milestone, 2);
  assert.equal(f.row().github_milestone_pending, null);
  assert.equal(posts(), 1);
});
