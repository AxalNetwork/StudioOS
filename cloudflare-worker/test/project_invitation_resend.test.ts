// #3841 (part 4 of #3727) — the people gaps on a team.
//
//   · Project invitation resend: a new token and a new 14-day expiry, the old
//     token fails at accept; a non-manager is 403 not_manager; a revoked or
//     accepted invitation is 409 not_pending.
//   · Invite an existing account by name (`mode: 'account'`): reachable
//     accounts only (403 not_reachable), and the inviter's answer holds no email.
//   · The account search: only people who share a company or an accepted
//     connection; no result carries an email or a numeric id; 1 letter is 400.
//   · The members reads: another member's row has no `email`; your own has it.
//
// Real SQLite over the baseline's tables; the routes are the shipped ones.
//
//   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
//     --test cloudflare-worker/test/project_invitation_resend.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { Hono } from 'hono';
import { makeD1 } from './_d1_sqlite.mjs';
import { addColumnsFrom, splitStatements, stripForeignKeys, tableFromBaseline } from './_baseline.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import projects from '../src/routes/projects.ts';
import company from '../src/routes/company.ts';
import accountCompanies from '../src/routes/account_companies.ts';
import { PEOPLE_SEARCH, PROJECT_INVITE_RESEND } from '../src/middleware/rateLimit.ts';
import { hashInviteToken } from '../src/services/projectAccess.ts';
import { likeContains } from '../src/services/peopleReach.ts';

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), 'utf8');
const BASELINE = sql('schema_baseline.sql');
// OWNER owns project 7 (founder 70) and sits in Acme with COLLEAGUE; PARTNER is a
// co-founder match of OWNER's (active); PENDING_MATCH's match never got signed;
// STRANGER shares nothing; OUTSIDER manages nothing.
const OWNER = 10, COLLEAGUE = 11, PARTNER = 12, PENDING_MATCH = 13, STRANGER = 14, OUTSIDER = 15;
const PROJECT = 7;

function world() {
  const { DB, db } = makeD1(
    ['users', 'company_profiles', 'user_company_links', 'projects', 'cofounder_connections']
      .map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n'),
  );
  addColumnsFrom(db, sql('migrations/597_company_archive_and_events.sql'), 'company_profiles');
  for (const st of splitStatements(sql('migrations/597_company_archive_and_events.sql'))) if (/^CREATE/i.test(st)) db.exec(st);
  const user = db.prepare('INSERT INTO users (id, uid, email, name, role, founder_id) VALUES (?, ?, ?, ?, ?, ?)');
  user.run(OWNER, 'a0000000000000000000000000000010', 'owner@example.test', 'Olive Owner', 'founder', 70);
  user.run(COLLEAGUE, 'a0000000000000000000000000000011', 'colleague@example.test', 'Colin Colleague', 'founder', 71);
  user.run(PARTNER, 'a0000000000000000000000000000012', 'partner@example.test', 'Colette Partner', 'founder', 72);
  user.run(PENDING_MATCH, 'a0000000000000000000000000000013', 'pending@example.test', 'Cole Pending', 'founder', 73);
  user.run(STRANGER, 'a0000000000000000000000000000014', 'stranger@example.test', 'Coleman Stranger', 'founder', 74);
  user.run(OUTSIDER, 'a0000000000000000000000000000015', 'outsider@example.test', 'Otto Outsider', 'founder', 75);
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (1, 'co-acme', 'Acme')").run();
  db.prepare("INSERT INTO company_profiles (id, uid, company_name) VALUES (2, 'co-other', 'Other')").run();
  const link = db.prepare('INSERT INTO user_company_links (uid, user_id, company_id, role_in_company, is_primary_admin) VALUES (?, ?, ?, ?, ?)');
  link.run('l1', OWNER, 1, 'Founder', 1); link.run('l2', COLLEAGUE, 1, 'Member', 0); link.run('l3', STRANGER, 2, 'Founder', 1);
  db.prepare("INSERT INTO projects (id, uid, name, founder_id) VALUES (?, 'p7', 'Rocket', 70)").run(PROJECT);
  db.prepare("INSERT INTO cofounder_connections (user_a_id, user_b_id, status) VALUES (?, ?, 'active')").run(OWNER, PARTNER);
  db.prepare("INSERT INTO cofounder_connections (user_a_id, user_b_id, status) VALUES (?, ?, 'pending_nda')").run(OWNER, PENDING_MATCH);
  const env: any = { DB, JWT_SECRET: 'p3841-fixture-only-secret', ENVIRONMENT: 'development', PUBLIC_BASE_URL: 'https://axal.test' };
  return { db, env };
}
type W = ReturnType<typeof world>;

function app() {
  const a = new Hono();
  a.onError((e: any, c) => {
    const status = AUTH_ERROR_STATUSES[e?.message];
    return status ? c.json({ detail: e.message }, status) : c.json({ detail: 'Internal server error', m: String(e?.message) }, 500);
  });
  a.route('/api/projects', projects);
  a.route('/api', accountCompanies);
  a.route('/api', company);
  return a;
}
async function call(w: W, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(w.env.JWT_SECRET));
  const r = await app().request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) }, w.env);
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
}
const noEmail = (text: string, why: string) => {
  assert.ok(!/"email"\s*:/.test(text), `${why}: an email key`);
  assert.ok(!/@example\.test/.test(text), `${why}: an address`);
};

// 1 ───────────────────────────────────────────────────────────────────────────
test('resend: a new token and expiry; the old token fails; non-manager 403; revoked 409', async () => {
  // Mutations checked: the UPDATE keeping the old token_hash → the old-token assert fails (it still accepts);
  // the manager check dropped → the 403 assert fails; the status guard dropped → the 409 assert fails.
  const w = world();
  const made = await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations`, { mode: 'link', role: 'advisor' });
  assert.equal(made.status, 200, made.text);
  const oldToken = made.body.token;
  w.db.prepare("UPDATE project_member_invitations SET expires_at = datetime('now', '+1 day') WHERE id = ?").run(made.body.invitation.id);

  const re = await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations/${made.body.invitation.id}/resend`);
  assert.equal(re.status, 200, re.text);
  assert.deepEqual(Object.keys(re.body.invitation).sort(), ['email_sent', 'expires_at', 'id', 'source', 'status']);
  assert.deepEqual([re.body.invitation.status, re.body.invitation.source, re.body.invitation.email_sent], ['pending', 'link', null]);
  const days = (Date.parse(`${re.body.invitation.expires_at.replace(' ', 'T')}Z`) - Date.now()) / 86_400_000;
  assert.ok(days > 13.9 && days <= 14, `a fresh 14-day expiry, got ${days}`);
  assert.notEqual(re.body.token, oldToken);
  const stored = (w.db.prepare('SELECT token_hash FROM project_member_invitations WHERE id = ?').get(made.body.invitation.id) as any).token_hash;
  assert.equal(stored, await hashInviteToken(re.body.token));

  const stale = await call(w, OUTSIDER, 'POST', '/api/projects/invitations/accept', { token: oldToken });
  assert.equal(stale.status, 404, 'the old token no longer opens the invitation');
  const fresh = await call(w, OUTSIDER, 'POST', '/api/projects/invitations/accept', { token: re.body.token });
  assert.equal(fresh.status, 200, fresh.text);

  const again = await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations/${made.body.invitation.id}/resend`);
  assert.deepEqual([again.status, again.body.error], [409, 'not_pending'], 'an accepted invitation');

  const second = await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations`, { mode: 'link', role: 'advisor' });
  assert.deepEqual([(await call(w, OUTSIDER, 'POST', `/api/projects/${PROJECT}/invitations/${second.body.invitation.id}/resend`)).body.error], ['not_manager']);
  await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations/${second.body.invitation.id}/revoke`);
  const revoked = await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations/${second.body.invitation.id}/resend`);
  assert.deepEqual([revoked.status, revoked.body.error], [409, 'not_pending']);
  assert.equal((await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations/99999/resend`)).status, 404);
});

test('resend an email invitation sends it again (email_sent reports the mailer)', async () => {
  const w = world();
  const made = await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations`, { mode: 'email', email: 'new@elsewhere.test', role: 'cofounder' });
  const re = await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations/${made.body.invitation.id}/resend`);
  assert.equal(re.status, 200, re.text);
  assert.equal(re.body.invitation.email_sent, false, 'no mailer is configured here, and the answer says so');
  assert.equal(re.body.token, undefined, 'an email invitation’s token is mailed, never returned');
});

// 2 ───────────────────────────────────────────────────────────────────────────
test('mode account: a reachable account is invited without its email; others are refused', async () => {
  // Mutations checked: reachableAccount skipped → the stranger's 403 assert fails; the invitee's email added to the answer → noEmail fails.
  const w = world();
  const a = await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations`, { mode: 'account', user_uid: 'a0000000000000000000000000000011', role: 'cofounder' });
  assert.equal(a.status, 200, a.text);
  noEmail(a.text, 'the inviter’s answer');
  assert.deepEqual([a.body.invitation.source, a.body.invitation.status, a.body.invitation.invitee], ['account', 'pending',
    { uid: 'a0000000000000000000000000000011', name: 'Colin Colleague', avatar_url: null, shared: [{ kind: 'company', name: 'Acme' }] }]);
  assert.equal((await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations`, { mode: 'account', user_uid: 'a0000000000000000000000000000011' })).body.error, 'already_pending');
  assert.equal((await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations`, { mode: 'account', user_uid: 'a0000000000000000000000000000012' })).status, 200, 'a co-founder match');
  const stranger = await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations`, { mode: 'account', user_uid: 'a0000000000000000000000000000014' });
  assert.deepEqual([stranger.status, stranger.body.error], [403, 'not_reachable']);
  assert.equal((await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations`, { mode: 'account', user_uid: 'a0000000000000000000000000000013' })).body.error, 'not_reachable', 'an unsigned match is not a connection');
  assert.equal((await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations`, { mode: 'account', user_uid: 'ffffffffffffffffffffffffffffffff' })).body.error, 'account_not_found');
  assert.equal((await call(w, OUTSIDER, 'POST', `/api/projects/${PROJECT}/invitations`, { mode: 'account', user_uid: 'a0000000000000000000000000000011' })).status, 403);

  // The invitee sees it in Account › Invitations, and accepts it by id.
  const mine = await call(w, COLLEAGUE, 'GET', '/api/account/invitations');
  assert.deepEqual(mine.body.project.value.map((i: any) => i.project_id), [PROJECT]);
  assert.equal((await call(w, COLLEAGUE, 'POST', `/api/projects/invitations/${a.body.invitation.id}/accept`)).status, 200);
  assert.equal((await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations`, { mode: 'account', user_uid: 'a0000000000000000000000000000011' })).body.error, 'already_member');
});

// 3 ───────────────────────────────────────────────────────────────────────────
test('the search: shared company or accepted connection only; no email, no numeric id; 1 letter is 400', async () => {
  // Mutations checked: the shared-company join dropped (every user by name) → the stranger assert fails;
  // `u.email` added to the person → noEmail fails; SEARCH_MIN lowered to 1 → the 400 assert fails.
  const w = world();
  const r = await call(w, OWNER, 'GET', '/api/account/people/search?q=Col');
  assert.equal(r.status, 200, r.text);
  noEmail(r.text, 'the search');
  assert.ok(!/"(id|user_id)"\s*:/.test(r.text), 'a numeric id');
  assert.deepEqual(r.body.people, [
    { uid: 'a0000000000000000000000000000011', name: 'Colin Colleague', avatar_url: null, shared: [{ kind: 'company', name: 'Acme' }] },
    { uid: 'a0000000000000000000000000000012', name: 'Colette Partner', avatar_url: null, shared: [{ kind: 'connection', name: 'Co-founder match' }] },
  ].sort((a, b) => a.name.localeCompare(b.name)));
  assert.deepEqual([(await call(w, OWNER, 'GET', '/api/account/people/search?q=C')).body.error], ['query_too_short']);
  assert.deepEqual((await call(w, OWNER, 'GET', '/api/account/people/search?q=%25')).status, 400);
  assert.deepEqual((await call(w, OWNER, 'GET', '/api/account/people/search?q=%25%25')).body.people, [], 'a % is a letter, not a pattern');
  assert.deepEqual((await call(w, OWNER, 'GET', '/api/account/people/search?q=Olive')).body.people, [], 'never yourself');
  assert.deepEqual((await call(w, STRANGER, 'GET', '/api/account/people/search?q=Col')).body.people, [], 'a stranger finds nobody');
  // A team being built leaves out its members, and only its members may build it.
  assert.deepEqual((await call(w, OWNER, 'GET', '/api/account/people/search?q=Col&company=co-acme')).body.people.map((p: any) => p.name), ['Colette Partner']);
  assert.equal((await call(w, OWNER, 'GET', '/api/account/people/search?q=Col&company=co-other')).body.error, 'not_member');
  assert.equal((await call(w, OUTSIDER, 'GET', `/api/account/people/search?q=Col&project=${PROJECT}`)).status, 403);
  assert.equal(likeContains('5%_\\'), '%5\\%\\_\\\\%');
  // The two buckets match their routes and nothing else.
  assert.ok(PEOPLE_SEARCH.test('/api/account/people/search') && !PEOPLE_SEARCH.test('/api/account/people/searchx'));
  assert.ok(PROJECT_INVITE_RESEND.test('/api/projects/7/invitations/3/resend') && !PROJECT_INVITE_RESEND.test('/api/projects/7/invitations/3/revoke'));
});

// 4 ───────────────────────────────────────────────────────────────────────────
test('the members reads: your own row has your email; another member’s has none', async () => {
  // Mutations checked: the project roster keeping every email → the colleague assert fails;
  // company detailDto sending every email → the company assert fails.
  const w = world();
  const inv = await call(w, OWNER, 'POST', `/api/projects/${PROJECT}/invitations`, { mode: 'account', user_uid: 'a0000000000000000000000000000011' });
  await call(w, COLLEAGUE, 'POST', `/api/projects/invitations/${inv.body.invitation.id}/accept`);
  const seenByColleague = (await call(w, COLLEAGUE, 'GET', `/api/projects/${PROJECT}/members`)).body.members;
  const row = (id: number) => seenByColleague.find((m: any) => Number(m.user_id) === id);
  assert.equal(row(COLLEAGUE).email, 'colleague@example.test');
  assert.equal('email' in row(OWNER), false, 'the owner’s address reached a co-founder');

  const co = (await call(w, COLLEAGUE, 'GET', '/api/company/co-acme')).body.members;
  const member = (id: number) => co.find((m: any) => Number(m.user_id) === id);
  assert.equal(member(COLLEAGUE).email, 'colleague@example.test');
  assert.equal('email' in member(OWNER), false, 'another member’s address in GET /company/:uid');
});
