/**
 * D1002 (#2817) — Persona segments part 5: the members read, why a member has
 * no segment, bulk move, "ask to finish their profile" (migration 571) and
 * the Activity read, on routes/persona_members.ts at /api/personas/admin.
 *
 * Real Hono routes and services on `node:sqlite`, with the baseline's tables
 * and migrations 559, 571 and 576. Every person is made up:
 *
 *   id  role       active  segment (source, confidence)               other
 *    1  admin      1       founder_new (router, .9)                   ← an admin: on no list
 *    2  founder    1       founder_new (router, .95)                  active yesterday
 *    3  founder    1       founder_new (self_select, .5)              second segment operator_advisor; never active
 *    4  investor   1       lp_individual (router, .6)                 LP approved, tester active
 *    5  exploring  1       lp_individual (admin_retag, 1)             profile differs
 *    6  founder    1       —                                          started the chat (answered)
 *    7  investor   1       —                                          did not start
 *    8  advisor    1       —                                          advisors' only segment is Draft: not offered
 *    9  founder    0       —                                          ← deactivated: on no list
 *   10  partner    1       —                                          did not start
 *   20  admin      1       —                                          a second admin (the asker)
 *
 * "Now" is Saturday 2026-10-24 12:00 UTC.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import personas from '../src/routes/personas.ts';
import personaMembers from '../src/routes/persona_members.ts';
import {
  ASK_EVERY_DAYS, BULK_MAX, MEMBERS_PAGE, SUGGESTIONS_REASON, askToFinish, parseMembersQuery, readActivity, readMembers,
} from '../src/services/personaMembers.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-d1002-0123456789-abcdef';
const app = new Hono<any>();
app.route('/api/personas/admin', personaMembers);
app.route('/api/personas', personas);
app.onError((err, c) => c.json({ detail: err.message }, AUTH_ERROR_STATUSES[err.message] ?? 500));
const NOW = Date.parse('2026-10-24T12:00:00Z');
const DAY = 86_400_000;

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const migration = (f: string) => readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations', f), 'utf8');
function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}
type Db = InstanceType<typeof DatabaseSync>;
function makeD1(db: Db) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = x; return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

function fixture(): Db {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'user_personas', 'activity_logs', 'lp_applications', 'admin_audit_log']) db.exec(ddl(t));
  db.exec(`CREATE TABLE IF NOT EXISTS super_admins (user_id INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS user_profile_extras (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, persona_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT,
      source TEXT NOT NULL DEFAULT 'onboarding', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, persona_id, key));`);
  for (const f of ['559_segment_profiles.sql', '571_persona_finish_asks.sql', '576_product_testers.sql']) db.exec(migration(f));
  db.exec("UPDATE segment_profiles SET status = 'draft' WHERE key = 'operator_advisor'");
  const user = (id: number, role: string, active = 1, last: string | null = null, joined = '2026-01-01 00:00:00') =>
    db.prepare('INSERT INTO users (id, role, name, email, is_active, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, role, `Member ${id}`, `m${id}@example.test`, active, last, joined);
  const tag = (id: number, userId: number, persona: string, source: string, confidence: number, primary = 1, at = '2026-10-10 09:00:00') =>
    db.prepare('INSERT INTO user_personas (id, user_id, persona_id, source, confidence, is_primary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, userId, persona, source, confidence, primary, at, at);
  user(1, 'admin'); user(2, 'founder', 1, '2026-10-23 10:00:00', '2026-02-01 00:00:00'); user(3, 'founder', 1, null, '2026-03-01 00:00:00');
  user(4, 'investor', 1, '2026-09-01 10:00:00', '2026-04-01 00:00:00'); user(5, 'exploring', 1, '2026-10-20 10:00:00', '2026-05-01 00:00:00');
  user(6, 'founder', 1, '2026-10-22 10:00:00', '2026-06-01 00:00:00'); user(7, 'investor', 1, null, '2026-07-01 00:00:00');
  user(8, 'advisor', 1, null, '2026-08-01 00:00:00'); user(9, 'founder', 0); user(10, 'partner', 1, null, '2026-09-01 00:00:00'); user(20, 'admin');
  tag(1, 1, 'founder_new', 'router', 0.9); tag(2, 2, 'founder_new', 'router', 0.95, 1, '2026-10-20 09:00:00'); tag(3, 3, 'founder_new', 'self_select', 0.5, 1, '2026-10-12 09:00:00');
  tag(4, 3, 'operator_advisor', 'self_select', 0.5, 0, '2026-10-12 09:00:00'); tag(5, 4, 'lp_individual', 'router', 0.6, 1, '2026-10-14 09:00:00');
  tag(6, 5, 'lp_individual', 'admin_retag', 1, 1, '2026-10-15 09:00:00');
  db.exec(`INSERT INTO user_profile_extras (user_id, persona_id, key, value) VALUES (6, 'founder_new', 'stage', 'SECRET ANSWER'), (2, 'founder_new', 'stage', 'SECRET ANSWER');
    INSERT INTO lp_applications (user_id, investor_type, status) VALUES (4, 'individual', 'approved'), (7, 'individual', 'pending');
    INSERT INTO product_testers (user_id, status, decided_at) VALUES (4, 'active', '2026-10-01 00:00:00'), (2, 'declined', '2026-10-01 00:00:00');`);
  return db;
}
const env = (db: Db) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) }) as any;
const ADMIN = { id: 20, name: 'Ada Admin', email: 'ada@example.test' };
const q = (params: Record<string, string> = {}) => {
  const out = parseMembersQuery((k) => params[k]);
  assert.ok(!('error' in out), JSON.stringify(out));
  return out as any;
};
const ids = (r: any) => r.rows.map((m: any) => m.user_id);

test('1. a segment\'s members: admins and deactivated accounts on no list; each row\'s segment, second segment, how set, last active and sub-accounts', async () => {
  // Mutation checked: the admin clause dropped → 1 is listed; the second-segment subquery reading the primary → 3's second is founder_new.
  const db = fixture();
  const r = await readMembers(env(db), q({ segment: 'founder_new' }), NOW);
  assert.deepEqual(ids(r), [3, 2], 'newest joined first, no admin');
  assert.equal(r.total, 2);
  const three = r.rows.find((m: any) => m.user_id === 3);
  assert.equal(three.second_segment.key, 'operator_advisor');
  assert.equal(typeof three.second_segment.name, 'string');
  assert.deepEqual([three.how_set, three.confidence, three.last_active], ['self_select', 0.5, null], 'a last active nothing recorded is null, never 0');
  const four = (await readMembers(env(db), q({ segment: 'lp_individual' }), NOW)).rows.find((m: any) => m.user_id === 4);
  assert.deepEqual(four.sub_accounts, { lp: true, tester: true });
  const all = await readMembers(env(db), q(), NOW);
  assert.ok(!ids(all).includes(1) && !ids(all).includes(20) && !ids(all).includes(9));
  assert.equal(all.total, 8);
  assert.doesNotMatch(JSON.stringify(all), /SECRET ANSWER/, 'what a member answered left the Worker');
});

test('2. the filters, sort and pages are the server\'s, with the read\'s own total', async () => {
  // Mutation checked: band without the router clause → 5 (admin_retag, 1.0) is in 90_up; differs on an unknown segment → true; the "never" window inverted.
  const db = fixture();
  const e = env(db);
  assert.deepEqual(ids(await readMembers(e, q({ profile: 'investor' }), NOW)), [7, 4]);
  assert.deepEqual(ids(await readMembers(e, q({ how_set: 'admin_retag' }), NOW)), [5]);
  assert.deepEqual(ids(await readMembers(e, q({ band: '90_up' }), NOW)), [2], 'only a sign-up suggestion has a band');
  assert.deepEqual(ids(await readMembers(e, q({ sub: 'lp' }), NOW)), [4]);
  assert.deepEqual(ids(await readMembers(e, q({ sub: 'tester' }), NOW)), [4], 'a declined tester is no tester');
  assert.ok(!ids(await readMembers(e, q({ sub: 'none' }), NOW)).includes(4));
  assert.deepEqual(ids(await readMembers(e, q({ answered: 'yes' }), NOW)).sort(), [2, 6]);
  assert.deepEqual(ids(await readMembers(e, q({ active: '7d' }), NOW)).sort(), [2, 5, 6]);
  assert.deepEqual(ids(await readMembers(e, q({ active: 'never' }), NOW)).sort(), [10, 3, 7, 8].sort());
  assert.deepEqual(ids(await readMembers(e, q({ differs: 'yes' }), NOW)), [5], 'lp_individual is an investor segment on an Explorer account');
  assert.deepEqual(ids(await readMembers(e, q({ q: 'm4@' }), NOW)), [4]);
  assert.deepEqual(ids(await readMembers(e, q({ q: 'm' }), NOW)).length, 8, 'one character is no search');
  assert.deepEqual(ids(await readMembers(e, q({ sort: 'name', segment: 'founder_new' }), NOW)), [2, 3]);
  assert.deepEqual(ids(await readMembers(e, q({ sort: 'last_active', segment: 'founder_new' }), NOW)), [2, 3], 'an unknown last active sorts last');
  for (const bad of [{ band: 'x' }, { sub: 'x' }, { sort: 'x' }, { segment: 'BAD KEY' }, { why: 'started' }]) assert.ok('error' in parseMembersQuery((k) => (bad as any)[k]), JSON.stringify(bad));
  // Pages of 25 and the total.
  for (let i = 0; i < 30; i++) db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'exploring', ?, ?, 1)").run(100 + i, `Extra ${i}`, `x${i}@example.test`);
  const p1 = await readMembers(e, q({ segment: 'none' }), NOW);
  const p2 = await readMembers(e, q({ segment: 'none', page: '2' }), NOW);
  assert.deepEqual([p1.total, p1.rows.length, p2.rows.length, p1.page_size], [34, MEMBERS_PAGE, 9, 25]);
  assert.equal(new Set([...ids(p1), ...ids(p2)]).size, 34, 'a member is on two pages');
});

test('3. members with no segment, and why: skipped the chat, started and did not finish, or their profile has no segment yet', async () => {
  // Mutation checked: started read as not started → 6 is not_started; a Draft segment counted as offered → 8 is not_started.
  const db = fixture();
  const r = await readMembers(env(db), q({ segment: 'none' }), NOW);
  assert.deepEqual(Object.fromEntries(r.rows.map((m: any) => [m.user_id, m.why])), { 6: 'started', 7: 'not_started', 8: 'not_offered', 10: 'not_started' });
  assert.deepEqual(r.why_counts, { not_started: 2, started: 1, not_offered: 1, not_recorded: 0 });
  assert.deepEqual(ids(await readMembers(env(db), q({ segment: 'none', why: 'not_offered' }), NOW)), [8]);
  // A member's segment row carries no why.
  assert.equal((await readMembers(env(db), q({ segment: 'founder_new' }), NOW)).rows[0].why, null);
  // Without the answers store, why is not recorded, never "skipped".
  db.exec('DROP TABLE user_profile_extras');
  const blind = await readMembers(env(db), q({ segment: 'none' }), NOW);
  assert.deepEqual(blind.rows.find((m: any) => m.user_id === 7).why, null);
  assert.equal(blind.rows.find((m: any) => m.user_id === 8).why, 'not_offered', 'not offered is known without the answers');
  assert.ok(blind.unreadable.includes('why'));
});

// ----------------------------------------------------------------- HTTP

const token = (userId: number, role: string) => new SignJWT({ user_id: userId, role })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
async function call(db: Db, who: number | null, method: string, path: string, body?: unknown) {
  const role = who === 1 || who === 20 ? 'admin' : 'founder';
  const res = await app.fetch(new Request(`http://x${path}`, {
    method, headers: { ...(who ? { Authorization: `Bearer ${await token(who, role)}` } : {}), 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env(db));
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body: json };
}
const audit = (db: Db, action: string) => Number((db.prepare('SELECT COUNT(*) n FROM admin_audit_log WHERE action = ?').get(action) as any).n);
// The subject-naming row (D255); `logAdminAction` writes its own, without a subject, as the single retag always has.
const moves = (db: Db) => Number((db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action = 'persona_retagged' AND entity_type = 'user'").get() as any).n);

test('4. bulk move: at most 50, the single move\'s rules for each member, one activity and one audit row each', async () => {
  // Mutation checked: the 50 cap removed → 51 accepted; the admin check skipped → member 1 moved by an Admin; one audit row for the batch → 2.
  const db = fixture();
  const path = '/api/personas/admin/members/move';
  assert.equal((await call(db, 20, 'POST', path, { user_ids: Array.from({ length: BULK_MAX + 1 }, (_, i) => i + 1), persona_id: 'founder_new' })).body.code, 'too_many');
  assert.equal((await call(db, 20, 'POST', path, { user_ids: [], persona_id: 'founder_new' })).status, 400);
  assert.equal((await call(db, 20, 'POST', path, { user_ids: [6], persona_id: 'nope' })).body.code, 'invalid_persona_id');
  db.exec("UPDATE segment_profiles SET status = 'retired' WHERE key = 'academic'");
  const retired = await call(db, 20, 'POST', path, { user_ids: [6, 7], persona_id: 'academic' });
  assert.deepEqual([retired.status, retired.body.code], [409, 'segment_retired']);
  assert.equal(moves(db), 0, 'a retired segment moved someone');
  const r = await call(db, 20, 'POST', path, { user_ids: [6, 7, 2, 1, 999, 7], persona_id: 'founder_new' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results.map((x: any) => [x.user_id, x.outcome]), [[6, 'moved'], [7, 'moved'], [2, 'unchanged'], [1, 'super_admin_required'], [999, 'user_not_found']]);
  assert.equal(r.body.moved, 2);
  assert.deepEqual([moves(db), audit(db, 'persona_retagged')], [2, 2]);
  const row: any = db.prepare("SELECT persona_id, source, manual_override FROM user_personas WHERE user_id = 7 AND is_primary = 1").get();
  assert.deepEqual({ ...row }, { persona_id: 'founder_new', source: 'admin_retag', manual_override: 1 });
  // A Super Admin may move an admin's account, as on the single move.
  db.exec('INSERT INTO super_admins (user_id) VALUES (20)');
  assert.equal((await call(db, 20, 'POST', path, { user_ids: [1], persona_id: 'founder_existing' })).body.results[0].outcome, 'moved');
  // The single retag still answers as before, through the same rules.
  assert.deepEqual((await call(db, 20, 'POST', '/api/personas/admin/6/retag', { persona_id: 'founder_new' })).body, { ok: true, unchanged: true });
  assert.equal((await call(db, 20, 'POST', '/api/personas/admin/6/retag', { persona_id: 'academic' })).status, 409);
});

test('5. ask to finish: one notice, at most once per member in 30 days, logged; never to a member with a segment or an admin', async () => {
  // Mutation checked: the 30-day guard removed → a second notice; has_segment skipped → member 2 asked; the window as 3 days → the day-29 ask lands.
  const db = fixture();
  const first = await askToFinish(env(db), ADMIN, [6, 7, 2, 1, 9, 999], NOW);
  assert.deepEqual(first.results.map((x: any) => [x.user_id, x.outcome]), [[6, 'asked'], [7, 'asked'], [2, 'has_segment'], [1, 'not_a_member'], [9, 'not_a_member'], [999, 'user_not_found']]);
  const notices = () => db.prepare("SELECT user_id, link FROM notifications_inbox WHERE type = 'persona_finish_profile' ORDER BY id").all().map((r: any) => [r.user_id, r.link]);
  assert.deepEqual(notices(), [[6, '/onboarding/persona'], [7, '/onboarding/persona']]);
  assert.equal(audit(db, 'persona_finish_asked'), 2);
  const again = await askToFinish(env(db), { ...ADMIN, id: 1 }, [6], NOW + 29 * DAY);
  assert.equal(again.results[0].outcome, 'asked_recently', 'whoever asks, once in 30 days');
  assert.equal(notices().length, 2);
  const later = await askToFinish(env(db), ADMIN, [6], NOW + (ASK_EVERY_DAYS + 1) * DAY);
  assert.equal(later.results[0].outcome, 'asked');
  assert.equal(notices().length, 3);
  // The members read shows when they were last asked.
  const row = (await readMembers(env(db), q({ segment: 'none' }), NOW)).rows.find((m: any) => m.user_id === 7);
  assert.equal(row.asked_at, '2026-10-24 12:00:00');
  // Over HTTP: an admin's, and the 50 cap.
  assert.equal((await call(db, 6, 'POST', '/api/personas/admin/members/ask-to-finish', { user_ids: [7] })).status, 403);
  assert.equal((await call(db, 20, 'POST', '/api/personas/admin/members/ask-to-finish', { user_ids: Array.from({ length: 51 }, (_, i) => i + 1) })).body.code, 'too_many');
});

test('6. the Activity read: moves, sign-up choices, segment edits and asks, newest first, filtered and paged; suggestions not recorded yet', async () => {
  // Mutation checked: the kind filter ignored → all kinds; a missing source failing the whole read → 503.
  const db = fixture();
  await call(db, 20, 'POST', '/api/personas/admin/members/move', { user_ids: [7], persona_id: 'lp_institutional' });
  await askToFinish(env(db), ADMIN, [6], NOW);
  db.exec(`INSERT INTO segment_profile_history (segment_key, version, action, fields_json, reason, actor_user_id, created_at)
    VALUES ('founder_new', 2, 'edited', '["who"]', 'Clearer words', 20, '2026-10-23 10:00:00')`);
  const a = await readActivity(env(db), { kind: null, q: '', page: 1 });
  assert.equal(a.sources.suggestion.recorded, false);
  assert.equal(a.sources.suggestion.reason, SUGGESTIONS_REASON);
  for (const k of ['move', 'signup', 'segment_edit', 'ask']) assert.equal(a.sources[k].available, true, k);
  const kinds = a.rows.map((r: any) => r.kind);
  assert.deepEqual([...new Set(kinds)].sort(), ['ask', 'move', 'segment_edit', 'signup']);
  assert.ok(a.rows.every((r: any, i: number) => i === 0 || String(a.rows[i - 1].at) >= String(r.at)), 'not newest first');
  // Sign-up choices are members' own: the admin's is not one, and nothing they answered is listed.
  const signups = a.rows.filter((r: any) => r.kind === 'signup');
  assert.deepEqual(signups.map((r: any) => r.member.user_id).sort(), [2, 3, 3, 4]);
  assert.doesNotMatch(JSON.stringify(a), /SECRET ANSWER/);
  const edit = a.rows.find((r: any) => r.kind === 'segment_edit');
  assert.deepEqual([edit.to.key, edit.detail.reason, edit.actor.user_id], ['founder_new', 'Clearer words', 20]);
  const move = a.rows.find((r: any) => r.kind === 'move');
  assert.deepEqual([move.member.user_id, move.from, move.to.key], [7, null, 'lp_institutional']);
  assert.deepEqual((await readActivity(env(db), { kind: 'ask', q: '', page: 1 })).rows.map((r: any) => r.member.user_id), [6]);
  assert.equal((await readActivity(env(db), { kind: null, q: 'member 4', page: 1 })).rows.every((r: any) => r.member?.user_id === 4 || r.actor?.user_id === 4), true);
  assert.equal(a.total, a.rows.length);
  // A source that cannot be read is named, and the others still answer.
  db.exec('DROP TABLE segment_profile_history');
  const less = await readActivity(env(db), { kind: null, q: '', page: 1 });
  assert.equal(less.sources.segment_edit.unreadable, true);
  assert.ok(less.rows.length > 0 && less.rows.every((r: any) => r.kind !== 'segment_edit'));
  assert.equal((await call(db, 20, 'GET', '/api/personas/admin/activity?kind=nope')).status, 400);
});

test('7. HTTP: an admin reads; a member and no session are refused; a store the read needs failing is a 503, never an empty list', async () => {
  // Mutation checked: the read's failure answered as [] → 200.
  const db = fixture();
  assert.equal((await call(db, null, 'GET', '/api/personas/admin/members')).status, 401);
  assert.equal((await call(db, 6, 'GET', '/api/personas/admin/members')).status, 403);
  assert.equal((await call(db, 6, 'GET', '/api/personas/admin/activity')).status, 403);
  assert.equal((await call(db, 6, 'POST', '/api/personas/admin/members/move', { user_ids: [7], persona_id: 'founder_new' })).status, 403);
  const ok = await call(db, 20, 'GET', '/api/personas/admin/members?segment=none&why=started');
  assert.deepEqual([ok.status, ok.body.rows.map((m: any) => m.user_id)], [200, [6]]);
  assert.equal((await call(db, 20, 'GET', '/api/personas/admin/members?band=nope')).status, 400);
  // The older routes still answer behind the new mount.
  assert.equal((await call(db, 20, 'GET', '/api/personas/admin/list')).status, 200);
  db.exec('DROP TABLE user_personas');
  const failed = await call(db, 20, 'GET', '/api/personas/admin/members');
  assert.deepEqual([failed.status, failed.body.code], [503, 'members_unreadable']);
});

test('8. D1005 (#2820): one segment\'s Activity: the moves into or out of it, its sign-ups and its edits; an ask to finish names no segment', async () => {
  // Mutations checked: the segment filter ignored → other segments' rows; only seg_to matched → the move out lost;
  // a malformed key read as no filter → 200.
  const db = fixture();
  await call(db, 20, 'POST', '/api/personas/admin/members/move', { user_ids: [2], persona_id: 'lp_institutional' });
  await askToFinish(env(db), ADMIN, [6], NOW);
  db.exec(`INSERT INTO segment_profile_history (segment_key, version, action, fields_json, reason, actor_user_id, created_at)
    VALUES ('founder_new', 2, 'edited', '["who"]', 'Clearer words', 20, '2026-10-23 10:00:00'),
           ('lp_individual', 2, 'edited', '["who"]', 'Other segment', 20, '2026-10-23 11:00:00')`);
  const touches = (r: any, key: string) => r.from?.key === key || r.to?.key === key;
  const own = await readActivity(env(db), { kind: null, segment: 'founder_new', q: '', page: 1 });
  assert.ok(own.rows.length > 0 && own.rows.every((r: any) => touches(r, 'founder_new')), 'a row from another segment');
  assert.ok(own.rows.some((r: any) => r.kind === 'move' && r.member.user_id === 2 && r.from?.key === 'founder_new'), 'the move out is missing');
  assert.ok(own.rows.some((r: any) => r.kind === 'segment_edit' && r.detail.reason === 'Clearer words'));
  assert.ok(!own.rows.some((r: any) => r.kind === 'ask'), 'an ask names no segment');
  assert.equal(own.total, own.rows.length);
  const other = await readActivity(env(db), { kind: null, segment: 'lp_institutional', q: '', page: 1 });
  assert.deepEqual(other.rows.map((r: any) => [r.kind, r.member?.user_id, r.to?.key]), [['move', 2, 'lp_institutional']]);
  const all = await readActivity(env(db), { kind: null, q: '', page: 1 });
  assert.ok(all.rows.some((r: any) => r.kind === 'ask'), 'no segment means every row, as before');
  const http = await call(db, 20, 'GET', '/api/personas/admin/activity?segment=founder_new&kind=segment_edit');
  assert.deepEqual([http.status, http.body.rows.map((r: any) => r.detail.reason)], [200, ['Clearer words']]);
  const bad = await call(db, 20, 'GET', '/api/personas/admin/activity?segment=Bad-Key');
  assert.deepEqual([bad.status, bad.body.code], [400, 'invalid_segment']);
});
