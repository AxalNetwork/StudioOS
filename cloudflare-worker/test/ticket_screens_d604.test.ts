/**
 * D604 (#1280 step 4) — what the Help Center's ticket screens read.
 *
 *   - Every row carries a feature request's review. No decision is
 *     "awaiting", a declined one carries its reason, and a review that could
 *     not be read says so: it is never drawn as awaiting.
 *   - An admin's rows carry the SLA from HQ's stored hours. The clock stops at
 *     resolved or closed, and a store that cannot be read bands nothing. A
 *     member's rows carry no SLA at all.
 *   - The thread is by side. A reply signed by the Worker is the member's or
 *     the team's. A comment from anyone else on the public repository is
 *     `outside`, with its login, and never reads as the Axal team.
 *   - An admin can retry one ticket's mirror, and only that ticket's.
 *
 * Run with:
 *   npm run test:worker
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import tickets from '../src/routes/tickets.ts';
import { mirrorReplyBody, REPLY_SIGNATURE } from '../src/services/githubSync.ts';
import { reviewFrom, slaForTicket, threadEntry } from '../src/services/ticketScreens.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const HOURS = { P1: 24, P2: 48, P3: 96 };
const NOW = Date.parse('2026-10-06T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

// ---------------------------------------------------------------------------
// The pure parts
// ---------------------------------------------------------------------------

test('a review is awaiting until decided, and a declined one carries its reason', () => {
  assert.deepEqual(reviewFrom(null), { state: 'awaiting' });
  assert.deepEqual(reviewFrom({ ticket_id: 1, status: 'approved', decided_at: '2026-10-01', decline_reason: null }),
    { state: 'approved', decided_at: '2026-10-01' });
  assert.deepEqual(reviewFrom({ ticket_id: 1, status: 'declined', decided_at: '2026-10-02', decline_reason: 'Out of scope for this year.' }),
    { state: 'declined', reason: 'Out of scope for this year.', decided_at: '2026-10-02' });
});

test("the SLA bands an open ticket from HQ's hours, stops at resolved, and bands nothing without the hours", () => {
  const open = (priority: string, h: number) => slaForTicket({ priority, status: 'open', created_at: hoursAgo(h) }, HOURS, NOW);
  assert.deepEqual(open('urgent', 1), { tier: 'P1', hours: 24, band: 'ok', clock: 'running' });
  // A 24-hour limit is due soon for its last 12 hours (slaWindow.ts).
  assert.equal(open('urgent', 13).band, 'due_soon');
  assert.equal(open('urgent', 25).band, 'past');
  assert.equal(open('high', 30).band, 'due_soon');
  assert.deepEqual(open('low', 30), { tier: 'P3', hours: 96, band: 'ok', clock: 'running' });
  assert.equal(slaForTicket({ priority: 'medium', status: 'in_progress', created_at: hoursAgo(100) }, HOURS, NOW).band, 'past');
  for (const status of ['resolved', 'closed']) {
    assert.deepEqual(slaForTicket({ priority: 'urgent', status, created_at: hoursAgo(500) }, HOURS, NOW),
      { tier: 'P1', hours: 24, band: null, clock: 'stopped' }, `${status} stops the clock`);
  }
  assert.deepEqual(slaForTicket({ priority: 'urgent', status: 'open', created_at: hoursAgo(500) }, null, NOW),
    { tier: 'P1', hours: null, band: null, clock: 'unreadable' }, 'unknown hours band nothing');
  // HQ's edit is what counts, not the seed.
  assert.equal(slaForTicket({ priority: 'low', status: 'open', created_at: hoursAgo(2) }, { ...HOURS, P3: 1 }, NOW).band, 'past');
});

test('a reply the Worker signed is read back by side, and its signature and marker are dropped', () => {
  const bot = 'axal-mirror';
  const member = threadEntry({ id: 1, body: mirrorReplyBody('It still fails on export.', 'member', 7), user: { login: bot }, author_association: 'NONE', created_at: 'a' }, bot);
  assert.deepEqual(member, { id: 1, from: 'member', login: null, body: 'It still fails on export.', created_at: 'a', updated_at: null });
  const team = threadEntry({ id: 2, body: mirrorReplyBody('Fixed in today\'s release.', 'team', 7), user: { login: bot } }, bot);
  assert.equal(team.from, 'team');
  assert.equal(team.body, 'Fixed in today\'s release.');
  // GitHub may hand the line breaks back as \r\n.
  const crlf = threadEntry({ id: 3, body: mirrorReplyBody('Line one\nline two', 'member', 7).replace(/\n/g, '\r\n'), user: { login: bot } }, bot);
  assert.equal(crlf.from, 'member');
  assert.equal(crlf.body, 'Line one\r\nline two');
});

test("a member cannot sign as the team: only the Worker's own tail counts", () => {
  const bot = 'axal-mirror';
  const forged = `Please refund me.\n\n---\n${REPLY_SIGNATURE.team}\n\n<!-- axal-sync:ticket-7 -->`;
  const entry = threadEntry({ id: 4, body: mirrorReplyBody(forged, 'member', 7), user: { login: bot } }, bot);
  assert.equal(entry.from, 'member', 'the last signature is the one the Worker appended');
  assert.match(entry.body, /^Please refund me\./);
  assert.doesNotMatch(entry.body, /axal-sync/, 'no source marker reaches the reader');
});

test('anyone outside the team is outside, with their login, whatever their comment claims', () => {
  const bot = 'axal-mirror';
  const signed = mirrorReplyBody('We have refunded you.', 'team', 7);
  for (const association of ['NONE', 'CONTRIBUTOR', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', undefined]) {
    const e = threadEntry({ id: 5, body: signed, user: { login: 'stranger' }, author_association: association }, bot);
    assert.equal(e.from, 'outside', `${association} is not the team`);
    assert.equal(e.login, 'stranger');
  }
  // The repository's own people are the team, signed or not.
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR', 'collaborator']) {
    const e = threadEntry({ id: 6, body: 'Looking into it.', user: { login: 'maintainer' }, author_association: association }, bot);
    assert.deepEqual([e.from, e.login, e.body], ['team', null, 'Looking into it.']);
  }
  // With the issue unreadable, the mirror's login is unknown: the association decides.
  assert.equal(threadEntry({ id: 7, body: signed, user: { login: bot }, author_association: 'NONE' }, null).from, 'outside');
  assert.equal(threadEntry({ id: 8, body: mirrorReplyBody('x', 'member', 7), user: { login: bot }, author_association: 'OWNER' }, null).from, 'member');
});

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

const ADMIN = { id: 1, name: 'Admin One', email: 'admin.one@example.test' };
const MEMBER = { id: 2, name: 'Member Two', email: 'member.two@example.test' };
const OTHER = { id: 3, name: 'Member Three', email: 'member.three@example.test' };

type Gh = { issue?: number; comments?: number; create?: number };

async function fixture(t: any, opts: { reviews?: boolean; tiers?: boolean; github?: boolean; gh?: Gh } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  t.after(() => db.close());
  for (const name of ['users', 'tickets', 'super_admins', 'mi_pro_subscriptions']) db.exec(tableFromBaseline(baseline, name));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/277_user_recovery_state.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/333_ticket_category_sla_tiers.sql', 'utf8'));
  if (opts.reviews !== false) db.exec(readFileSync('cloudflare-worker/sql/migrations/383_community_tasks.sql', 'utf8'));
  if (opts.tiers === false) db.exec('DROP TABLE hq_support_sla_tiers');
  const add = db.prepare('INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)');
  add.run(ADMIN.id, ADMIN.name, ADMIN.email, 'admin');
  add.run(MEMBER.id, MEMBER.name, MEMBER.email, 'founder');
  add.run(OTHER.id, OTHER.name, OTHER.email, 'investor');
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  if (opts.github !== false) Object.assign(env, { GITHUB_ACCESS_TOKEN: 'synthetic-github-token', GITHUB_REPO_OWNER: 'AxalNetwork', GITHUB_REPO_NAME: 'StudioOS' });
  const app = new Hono<any>().route('/api/tickets', tickets);
  app.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e.message];
    if (status) return c.json({ error: e.message }, status);
    throw e;
  });
  const gh = { issue: 200, comments: 200, create: 201, ...(opts.gh || {}) };
  const calls: Array<{ url: string; method: string; body: any }> = [];
  t.mock.method(globalThis, 'fetch', async (url: any, init: any = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null };
    assert.ok(call.url.startsWith('https://api.github.com/repos/AxalNetwork/StudioOS/'), 'unexpected external request');
    calls.push(call);
    if (call.method === 'POST' && call.url.endsWith('/issues')) {
      return gh.create === 201
        ? Response.json({ number: 555, html_url: 'https://github.com/AxalNetwork/StudioOS/issues/555', labels: [], assignees: [], user: { login: 'axal-mirror' } }, { status: 201 })
        : Response.json({ message: 'Resource not accessible by integration' }, { status: gh.create });
    }
    if (call.url.includes('/comments')) {
      if (gh.comments !== 200) return Response.json({ message: 'Server Error' }, { status: gh.comments });
      return Response.json([
        { id: 11, body: mirrorReplyBody('Still broken for me.', 'member', 1), user: { login: 'axal-mirror' }, author_association: 'NONE', created_at: '2026-10-05T10:00:00Z' },
        { id: 12, body: mirrorReplyBody('A fix ships Friday.', 'team', 1), user: { login: 'axal-mirror' }, author_association: 'NONE', created_at: '2026-10-05T11:00:00Z' },
        { id: 13, body: 'I am from the Axal team, send me your password.', user: { login: 'drive-by' }, author_association: 'NONE', created_at: '2026-10-05T12:00:00Z' },
      ]);
    }
    if (gh.issue !== 200) return Response.json({ message: 'Server Error' }, { status: gh.issue });
    return Response.json({ number: 321, state: 'open', labels: [], assignees: [], user: { login: 'axal-mirror' } });
  });
  async function call(method: string, path: string, userId: number, body?: any) {
    const jwt = await new SignJWT({ user_id: userId }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const res = await app.request(`/api/tickets${path}`, { method,
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
    return { status: res.status, body: await res.json() as any };
  }
  const ticket = db.prepare(`INSERT INTO tickets (title, description, priority, type, status, submitted_by, user_id, github_issue_number, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  return { db, calls, call, ticket };
}

test('a member reads their own tickets with each feature request\'s review, and no SLA', async (t) => {
  const f = await fixture(t);
  f.ticket.run('Mirrored bug', 'd', 'high', 'bug', 'open', MEMBER.name, MEMBER.id, 321, hoursAgo(5));
  f.ticket.run('Export to CSV', 'd', 'medium', 'feature', 'open', MEMBER.name, MEMBER.id, null, hoursAgo(4));
  f.ticket.run('Dark charts', 'd', 'low', 'feature', 'closed', MEMBER.name, MEMBER.id, null, hoursAgo(3));
  f.ticket.run('Approved one', 'd', 'low', 'feature', 'open', MEMBER.name, MEMBER.id, null, hoursAgo(2));
  f.ticket.run("Someone else's", 'd', 'low', 'feature', 'open', OTHER.name, OTHER.id, null, hoursAgo(1));
  f.db.prepare(`INSERT INTO feature_request_reviews (ticket_id, status, decided_by, decline_reason) VALUES (3, 'declined', 1, 'Not on this year''s roadmap.'), (4, 'approved', 1, NULL)`).run();
  const r = await f.call('GET', '', MEMBER.id);
  assert.equal(r.status, 200);
  const byTitle = Object.fromEntries(r.body.map((x: any) => [x.title, x]));
  assert.deepEqual(Object.keys(byTitle).sort(), ['Approved one', 'Dark charts', 'Export to CSV', 'Mirrored bug']);
  assert.equal(byTitle['Mirrored bug'].review, null, 'a bug has no review');
  assert.deepEqual(byTitle['Export to CSV'].review, { state: 'awaiting' });
  assert.equal(byTitle['Dark charts'].review.state, 'declined');
  assert.equal(byTitle['Dark charts'].review.reason, "Not on this year's roadmap.");
  assert.equal(byTitle['Approved one'].review.state, 'approved');
  for (const row of r.body) assert.ok(!('sla' in row), 'a member is never sent an SLA');
  assert.ok(r.body.every((x: any) => 'bounty' in x), 'the bounty state is still on every row');
});

test("an admin's queue carries the SLA from HQ's stored hours", async (t) => {
  const f = await fixture(t);
  f.ticket.run('Urgent and late', 'd', 'urgent', 'bug', 'open', MEMBER.name, MEMBER.id, null, hoursAgo(30));
  f.ticket.run('Low and fresh', 'd', 'low', 'task', 'in_progress', OTHER.name, OTHER.id, null, hoursAgo(2));
  f.ticket.run('Resolved', 'd', 'high', 'bug', 'resolved', OTHER.name, OTHER.id, null, hoursAgo(400));
  f.db.prepare("UPDATE hq_support_sla_tiers SET hours = 1 WHERE tier = 'P3'").run();
  const r = await f.call('GET', '', ADMIN.id);
  assert.equal(r.status, 200);
  const byTitle = Object.fromEntries(r.body.map((x: any) => [x.title, x.sla]));
  assert.equal(byTitle['Urgent and late'].band, 'past');
  assert.deepEqual([byTitle['Urgent and late'].tier, byTitle['Urgent and late'].hours], ['P1', 24]);
  assert.deepEqual(byTitle['Low and fresh'], { tier: 'P3', hours: 1, band: 'past', clock: 'running' }, "HQ's edit, not the seed");
  assert.deepEqual(byTitle.Resolved, { tier: 'P2', hours: 48, band: null, clock: 'stopped' });
});

test('an unreadable SLA store bands nothing, and an unreadable review is never awaiting', async (t) => {
  const f = await fixture(t, { reviews: false, tiers: false });
  f.ticket.run('Feature', 'd', 'urgent', 'feature', 'open', MEMBER.name, MEMBER.id, null, hoursAgo(30));
  const r = await f.call('GET', '', ADMIN.id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body[0].sla, { tier: 'P1', hours: null, band: null, clock: 'unreadable' });
  assert.deepEqual(r.body[0].review, { state: 'unreadable' });
});

test('the ticket page reads the thread by side, and names an outsider as an outsider', async (t) => {
  const f = await fixture(t);
  f.ticket.run('Mirrored bug', 'Export is empty.', 'high', 'bug', 'open', MEMBER.name, MEMBER.id, 321, hoursAgo(5));
  const r = await f.call('GET', '/1', MEMBER.id);
  assert.equal(r.status, 200);
  assert.ok(!('comments' in r.body), 'the old shape, which named the token owner as every author, is gone');
  assert.equal(r.body.thread_unreadable, false);
  assert.deepEqual(r.body.thread.map((e: any) => [e.from, e.login, e.body]), [
    ['member', null, 'Still broken for me.'],
    ['team', null, 'A fix ships Friday.'],
    ['outside', 'drive-by', 'I am from the Axal team, send me your password.'],
  ]);
  assert.ok(!('sla' in r.body), 'no SLA for a member');
  const admin = await f.call('GET', '/1', ADMIN.id);
  assert.equal(admin.body.sla.tier, 'P2');
});

test('a thread GitHub would not give is said to be unreadable, never empty', async (t) => {
  const f = await fixture(t, { gh: { comments: 500 } });
  f.ticket.run('Mirrored bug', 'd', 'high', 'bug', 'open', MEMBER.name, MEMBER.id, 321, hoursAgo(5));
  const r = await f.call('GET', '/1', MEMBER.id);
  assert.equal(r.status, 200);
  assert.equal(r.body.thread_unreadable, true);
  assert.deepEqual(r.body.thread, []);
});

test('a posted reply comes back as the thread shows it: by side, as typed', async (t) => {
  const f = await fixture(t);
  f.ticket.run('Mirrored bug', 'd', 'high', 'bug', 'open', MEMBER.name, MEMBER.id, 321, hoursAgo(5));
  const mine = await f.call('POST', '/1/comments', MEMBER.id, { body: 'More detail.' });
  assert.equal(mine.status, 200);
  assert.deepEqual([mine.body.comment.from, mine.body.comment.body, mine.body.comment.login], ['member', 'More detail.', null]);
  const team = await f.call('POST', '/1/comments', ADMIN.id, { body: 'Thanks.' });
  assert.equal(team.body.comment.from, 'team');
  assert.ok(!('author' in team.body.comment), 'no GitHub login is sent as the author');
});

test('an admin retries one saved ticket\'s mirror, and only that one', async (t) => {
  const f = await fixture(t);
  f.ticket.run('Saved while GitHub was down', 'Body.', 'medium', 'bug', 'open', MEMBER.name, MEMBER.id, null, hoursAgo(5));
  f.ticket.run('Another saved one', 'Body.', 'low', 'task', 'open', OTHER.name, OTHER.id, null, hoursAgo(4));
  assert.equal((await f.call('POST', '/1/mirror', MEMBER.id)).status, 403, 'a member cannot');
  const r = await f.call('POST', '/1/mirror', ADMIN.id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.github_sync_status, r.body.github_issue_number], ['synced', 555]);
  const creates = f.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/issues'));
  assert.equal(creates.length, 1, 'one issue, for the one ticket');
  assert.doesNotMatch(JSON.stringify(creates[0].body), /Member Two|member\.two@/, 'the mirror names nobody (D600)');
  const rows = f.db.prepare('SELECT id, github_issue_number, github_sync_status FROM tickets ORDER BY id').all() as any[];
  assert.deepEqual(rows.map((x) => [x.id, x.github_issue_number, x.github_sync_status]), [[1, 555, 'synced'], [2, null, null]]);
  const again = await f.call('POST', '/1/mirror', ADMIN.id);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_mirrored');
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 1, 'a mirrored ticket is never opened twice');
  assert.equal((await f.call('POST', '/99/mirror', ADMIN.id)).status, 404);
});

test("a retry that fails says GitHub's reason and keeps the ticket recoverable", async (t) => {
  const f = await fixture(t, { gh: { create: 403 } });
  f.ticket.run('Saved', 'Body.', 'medium', 'bug', 'open', MEMBER.name, MEMBER.id, null, hoursAgo(5));
  const r = await f.call('POST', '/1/mirror', ADMIN.id);
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'github_create_failed');
  assert.match(r.body.message, /Resource not accessible/);
  const row = f.db.prepare('SELECT github_issue_number, github_sync_status, github_sync_error FROM tickets').get() as any;
  assert.deepEqual([row.github_issue_number, row.github_sync_status], [null, 'failed']);
  assert.match(row.github_sync_error, /Resource not accessible/);
});

test('a retry does not race another one, and says so when GitHub is not configured', async (t) => {
  const f = await fixture(t);
  f.ticket.run('Saved', 'Body.', 'medium', 'bug', 'open', MEMBER.name, MEMBER.id, null, hoursAgo(5));
  await f.call('GET', '', ADMIN.id); // the route's schema check adds the sync columns
  f.db.prepare("UPDATE tickets SET github_sync_status = 'syncing', github_sync_attempted_at = datetime('now') WHERE id = 1").run();
  const r = await f.call('POST', '/1/mirror', ADMIN.id);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'mirror_in_progress');
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0, 'nothing was sent while another request holds the lease');

  const bare = await fixture(t, { github: false });
  bare.ticket.run('Saved', 'Body.', 'medium', 'bug', 'open', MEMBER.name, MEMBER.id, null, hoursAgo(5));
  const nc = await bare.call('POST', '/1/mirror', ADMIN.id);
  assert.equal(nc.status, 409);
  assert.equal(nc.body.error, 'github_not_configured');
  assert.equal(bare.calls.length, 0);
});

test('the sync route sends the same rows as the list, so a page that takes them keeps the chips', async (t) => {
  const f = await fixture(t);
  f.ticket.run('Export to CSV', 'd', 'medium', 'feature', 'open', MEMBER.name, MEMBER.id, null, hoursAgo(4));
  const r = await f.call('POST', '/sync', ADMIN.id, {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.tickets[0].review, { state: 'awaiting' });
  assert.ok('bounty' in r.body.tickets[0]);
  assert.equal(r.body.tickets[0].sla.tier, 'P3');
  const member = await f.call('POST', '/sync', MEMBER.id, {});
  assert.ok(!('sla' in member.body.tickets[0]));
});
