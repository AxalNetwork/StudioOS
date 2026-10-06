/**
 * D600 (#1106, D540 Q1 B) — the public mirror names nobody.
 *
 * The owner answered #1102 that tickets stay in this public repository and
 * that the mirror strips the submitter's identity. Every request the ticket
 * routes send GitHub is captured here, and none may carry the member's name or
 * email address:
 *   - a new ticket's issue body;
 *   - an admin's backfill of a saved ticket, whose `submitted_by` column holds
 *     the name or, failing that, the email;
 *   - a reply, which is signed by side ("the member who filed this ticket" or
 *     "the Axal team"), never by name.
 *
 * The names below are distinctive on purpose, so a substring check cannot
 * pass by accident on a word like "Founder".
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
import { mirrorIssueBody, mirrorReplyBody, syncMarker } from '../src/services/githubSync.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const issue = { number: 321, html_url: 'https://github.com/AxalNetwork/StudioOS/issues/321', labels: [], assignees: [], state: 'open' };

const ADMIN = { id: 1, name: 'Ines Okonkwo-Varga', email: 'ines.ov@example.test' };
const MEMBER = { id: 2, name: 'Zelda Quartermaine', email: 'zelda.q@example.test' };
const NAMELESS = { id: 3, email: 'no.name.member@example.test' };
const IDENTITIES = [ADMIN.name, ADMIN.email, MEMBER.name, MEMBER.email, NAMELESS.email];

/** Every identity string a captured GitHub request carries, anywhere in it. */
const leaks = (calls: Array<{ body: any }>) =>
  IDENTITIES.filter((id) => calls.some((c) => JSON.stringify(c.body ?? '').includes(id)));

async function fixture(t: any) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  t.after(() => db.close());
  for (const name of ['users', 'tickets', 'super_admins', 'mi_pro_subscriptions']) {
    db.exec(tableFromBaseline(baseline, name));
  }
  db.exec(readFileSync('cloudflare-worker/sql/migrations/277_user_recovery_state.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/333_ticket_category_sla_tiers.sql', 'utf8'));
  const add = db.prepare('INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)');
  add.run(ADMIN.id, ADMIN.name, ADMIN.email, 'admin');
  add.run(MEMBER.id, MEMBER.name, MEMBER.email, 'founder');
  add.run(NAMELESS.id, '', NAMELESS.email, 'investor'); // `name` is NOT NULL; an empty one falls back to the email
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development',
    GITHUB_ACCESS_TOKEN: 'synthetic-github-token', GITHUB_REPO_OWNER: 'AxalNetwork', GITHUB_REPO_NAME: 'StudioOS' };
  const app = new Hono<any>().route('/api/tickets', tickets);
  app.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e.message];
    if (status) return c.json({ error: e.message }, status);
    throw e;
  });
  const calls: Array<{ url: string; method: string; body: any }> = [];
  t.mock.method(globalThis, 'fetch', async (url: any, init: any = {}) => {
    const call = { url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null };
    assert.ok(call.url.startsWith('https://api.github.com/repos/AxalNetwork/StudioOS/'), 'unexpected external request');
    calls.push(call);
    return Response.json(call.url.endsWith('/comments')
      ? { id: 9, body: call.body?.body, user: { login: 'axal-bot' }, created_at: '2026-10-06T00:00:00Z' }
      : issue, { status: 201 });
  });
  async function post(path: string, body: any, userId: number) {
    const jwt = await new SignJWT({ user_id: userId }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const res = await app.request(`/api/tickets${path}`, { method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, body: await res.json() as any };
  }
  return { db, calls, post };
}

const TICKET = { title: 'The cap table export is empty', priority: 'high', type: 'bug', description: 'Export gives an empty file.' };

test('a new ticket reaches GitHub with no name and no email, and keeps what the team needs', async (t) => {
  const f = await fixture(t);
  for (const who of [MEMBER, NAMELESS]) {
    const r = await f.post('', TICKET, who.id);
    assert.equal(r.status, 200);
    assert.equal(r.body.github_sync_status, 'synced');
  }
  const creates = f.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/issues'));
  assert.equal(creates.length, 2);
  assert.deepEqual(leaks(f.calls), [], 'the public mirror names a member');
  for (const c of creates) {
    assert.doesNotMatch(c.body.body, /Submitted by/);
    assert.match(c.body.body, /Export gives an empty file\.[\s\S]*\*\*Priority:\*\* high\n\*\*Type:\*\* bug\n\*\*Source:\*\* StudioOS\n/);
    assert.match(c.body.body, /<!-- axal-sync:ticket-\d+ -->$/);
  }
  // The platform still knows who filed it; only the mirror forgets.
  const rows = f.db.prepare('SELECT submitted_by FROM tickets ORDER BY id').all() as any[];
  assert.deepEqual(rows.map((r) => r.submitted_by), [MEMBER.name, NAMELESS.email]);
});

test("an admin's backfill publishes no submitted_by, which holds the email when there is no name", async (t) => {
  const f = await fixture(t);
  // Saved while GitHub was down: no issue yet. (The sync columns arrive with the route's schema check.)
  f.db.prepare(`INSERT INTO tickets (id, title, description, priority, type, submitted_by, user_id)
                VALUES (7, 'Saved while GitHub was down', 'Body text.', 'medium', 'task', ?, ?)`)
    .run(NAMELESS.email, NAMELESS.id);
  const r = await f.post('/sync', { backfill: true }, ADMIN.id);
  assert.equal(r.status, 200);
  const creates = f.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/issues'));
  assert.equal(creates.length, 1, 'the saved ticket was backfilled');
  assert.deepEqual(leaks(f.calls), [], 'the backfill names a member');
  assert.equal(creates[0].body.body, mirrorIssueBody({ id: 7, description: 'Body text.', priority: 'medium', type: 'task' }, 'StudioOS (backfilled)'));
});

test('a reply is signed by side, never by name or email', async (t) => {
  const f = await fixture(t);
  for (const who of [MEMBER, NAMELESS, ADMIN]) {
    f.db.prepare(`INSERT INTO tickets (title, priority, type, submitted_by, user_id, github_issue_number)
                  VALUES ('Mirrored ticket', 'low', 'task', ?, ?, 321)`).run(who.email, who.id);
  }
  const replies = [
    { ticket: 1, user: MEMBER.id, from: 'member' },
    { ticket: 2, user: NAMELESS.id, from: 'member' },
    { ticket: 1, user: ADMIN.id, from: 'team' },
    // The side is whose ticket it is, not the replier's role: an admin who
    // filed a ticket answers on it as its member.
    { ticket: 3, user: ADMIN.id, from: 'member' },
  ] as const;
  for (const r of replies) {
    const res = await f.post(`/${r.ticket}/comments`, { body: `Reply ${r.from} on ${r.ticket}.` }, r.user);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  const posted = f.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/comments')).map((c) => c.body.body);
  assert.deepEqual(leaks(f.calls), [], 'a reply names its author');
  assert.deepEqual(posted, replies.map((r) => mirrorReplyBody(`Reply ${r.from} on ${r.ticket}.`, r.from, r.ticket)));
  assert.match(posted[0], /_Reply from the member who filed this ticket, via StudioOS_/);
  assert.match(posted[2], /_Reply from the Axal team, via StudioOS_/);
  // A member still cannot reply on someone else's ticket.
  const denied = await f.post('/2/comments', { body: 'Not mine.' }, MEMBER.id);
  assert.equal(denied.status, 403);
});

test('the two builders take no identity and end with the source marker', () => {
  assert.equal(mirrorIssueBody.length, 2);
  assert.equal(mirrorReplyBody.length, 3);
  const issueBody = mirrorIssueBody({ id: 5, description: null, priority: 'urgent', type: null }, 'StudioOS');
  assert.equal(issueBody, `\n\n---\n**Priority:** urgent\n**Type:** task\n**Source:** StudioOS\n\n${syncMarker(5)}`);
  assert.ok(mirrorReplyBody('x', 'team', 5).endsWith(syncMarker(5)));
  // The route module sends nothing else that could carry an identity.
  const route = readFileSync('cloudflare-worker/src/routes/tickets.ts', 'utf8');
  assert.doesNotMatch(route, /Submitted by:\*\*|Comment by|user\.email\}\*\*/, 'an identity line is back in the mirror text');
});
