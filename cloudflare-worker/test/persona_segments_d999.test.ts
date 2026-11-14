/**
 * D999 (#2814) — Persona segments part 2: `GET /api/personas/admin/segments`.
 *
 * Driven against the real Hono route (`routes/personas.ts`) and the real read
 * (`services/personaSegments.ts`) on `node:sqlite`, with the tables from
 * `schema_baseline.sql`. The fixture is small enough to count by hand:
 *
 *   id  role        active  segment (source, confidence, given)            LP
 *    1  admin       1       founder_new (router, .9, 10-20)                approved   ← an admin: never counted
 *    2  founder     1       founder_new (router, .95, 10-20)
 *    3  founder     1       founder_new (self_select, .5, 09-01)
 *    4  investor    1       lp_individual (router, .6, 10-13)              approved
 *    5  exploring   1       lp_individual (admin_retag, 1, 10-14)          pending
 *    6  founder     1       operator_advisor (router, .3, 10-06)
 *    7  investor    1       —                                              approved
 *    8  advisor     1       —
 *    9  founder     0       founder_new (router, .8, 10-10)                           ← deactivated
 *   10  partner     1       old_persona (legacy, .8, 10-01)                           ← not in the taxonomy
 *   11  partner     1       —
 *   12  investor    1       two primaries: lp_individual (09-02), then gp_external (router, 'x', 10-21)
 *
 * "Now" is Saturday 2026-10-24 12:00 UTC; this week's Monday is 2026-10-19.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import personas from '../src/routes/personas.ts';
import { mondayOf, readPersonaSegments, SEGMENT_WEEKS } from '../src/services/personaSegments.ts';
import { PRODUCT_TESTERS_REASON } from '../src/services/adminInsights.ts';
import { PERSONAS } from '../src/personas.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
// Mounted as index.ts mounts it, with the app's own map from an auth error to its status.
const app = new Hono<any>(); app.route('/api/personas', personas);
app.onError((err, c) => c.json({ detail: err.message }, AUTH_ERROR_STATUSES[err.message] ?? 500));
const NOW = Date.parse('2026-10-24T12:00:00Z');

const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
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
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

function emptyDb(): Db {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'user_personas', 'activity_logs', 'lp_applications']) db.exec(ddl(t));
  db.exec(`CREATE TABLE IF NOT EXISTS super_admins (user_id INTEGER PRIMARY KEY)`);
  return db;
}

const user = (db: Db, id: number, role: string | null, active = 1) =>
  db.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, ?)`).run(id, role, `Member ${id}`, `m${id}@example.test`, active);
const tag = (db: Db, id: number, userId: number, persona: string, source: string, confidence: unknown, at: string, primary = 1) =>
  db.prepare(`INSERT INTO user_personas (id, user_id, persona_id, source, confidence, is_primary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, persona, source, confidence as any, primary, at);
const lp = (db: Db, userId: number, status: string) =>
  db.prepare(`INSERT INTO lp_applications (user_id, investor_type, status) VALUES (?, 'individual', ?)`).run(userId, status);
const log = (db: Db, action: string, target: number, at: string) =>
  db.prepare(`INSERT INTO activity_logs (action, entity_type, entity_id, created_at) VALUES (?, 'user', ?, ?)`).run(action, String(target), at);

function fixture(): Db {
  const db = emptyDb();
  user(db, 1, 'admin'); tag(db, 1, 1, 'founder_new', 'router', 0.9, '2026-10-20 10:00:00'); lp(db, 1, 'approved');
  user(db, 2, 'founder'); tag(db, 2, 2, 'founder_new', 'router', 0.95, '2026-10-20 09:00:00');
  user(db, 3, 'founder'); tag(db, 3, 3, 'founder_new', 'self_select', 0.5, '2026-09-01 09:00:00');
  user(db, 4, 'investor'); tag(db, 4, 4, 'lp_individual', 'router', 0.6, '2026-10-13 09:00:00'); lp(db, 4, 'approved'); lp(db, 4, 'approved');
  user(db, 5, 'exploring'); tag(db, 5, 5, 'lp_individual', 'admin_retag', 1, '2026-10-14 09:00:00'); lp(db, 5, 'pending');
  user(db, 6, 'founder'); tag(db, 6, 6, 'operator_advisor', 'router', 0.3, '2026-10-06 09:00:00');
  user(db, 7, 'investor'); lp(db, 7, 'approved');
  user(db, 8, 'advisor');
  user(db, 9, 'founder', 0); tag(db, 9, 9, 'founder_new', 'router', 0.8, '2026-10-10 09:00:00');
  user(db, 10, 'partner'); tag(db, 10, 10, 'old_persona', 'legacy', 0.8, '2026-10-01 09:00:00');
  user(db, 11, 'partner');
  user(db, 12, 'investor');
  tag(db, 12, 12, 'lp_individual', 'router', 0.7, '2026-09-02 09:00:00');
  tag(db, 13, 12, 'gp_external', 'router', 'x', '2026-10-21 09:00:00');
  log(db, 'persona_retagged', 5, '2026-10-19 09:00:00');
  log(db, 'persona_retagged', 1, '2026-10-19 09:00:00');
  log(db, 'persona_retagged', 4, '2026-09-01 09:00:00');
  log(db, 'role_changed', 6, '2026-10-19 09:00:00');
  return db;
}

const read = (db: Db, now = NOW) => readPersonaSegments({ DB: makeD1(db) } as any, now);
const seg = (r: any, id: string) => r.segments.rows.find((x: any) => x.id === id);

test('members: every account but admins, deactivated apart, in a segment and not, new in 30 days, profile differs', async () => {
  const r: any = await read(fixture());
  assert.deepEqual(r.members, {
    available: true, total: 10, in_segment: 7, no_segment: 3, new_30d: 6, deactivated: 1, profile_differs: 2, not_in_taxonomy: 1,
  });
  assert.match(r.counted, /^Every account but admins\./);
});

test('per segment: members, new in 30 days, still Explorers, profile differs; one primary per account', async () => {
  const r: any = await read(fixture());
  assert.equal(r.segments.available, true);
  assert.deepEqual(seg(r, 'founder_new'), { id: 'founder_new', in_taxonomy: true, profile: 'founder', members: 2, new_30d: 1, still_explorers: 0, profile_differs: 0 });
  assert.deepEqual(seg(r, 'lp_individual'), { id: 'lp_individual', in_taxonomy: true, profile: 'investor', members: 2, new_30d: 2, still_explorers: 1, profile_differs: 1 },
    'member 12\'s older primary is not counted');
  assert.deepEqual(seg(r, 'gp_external'), { id: 'gp_external', in_taxonomy: true, profile: 'investor', members: 1, new_30d: 1, still_explorers: 0, profile_differs: 0 });
  assert.equal(seg(r, 'operator_advisor').profile_differs, 1, 'a founder in an Advisor segment');
  assert.deepEqual(seg(r, 'old_persona'), { id: 'old_persona', in_taxonomy: false, profile: null, members: 1, new_30d: 1, still_explorers: 0, profile_differs: null },
    'a stored id the taxonomy does not know has no profile to differ from');
  assert.deepEqual(r.segments.rows.slice(0, PERSONAS.length).map((x: any) => x.id), PERSONAS.map((p) => p.id), 'every segment, in the taxonomy\'s order, then the unknown ones');
  assert.equal(seg(r, 'academic').members, 0, 'an empty segment is a real 0: the read succeeded');
});

test('sub-accounts: LPs from approved applications, not added to the total; Product tester is not recorded', async () => {
  const r: any = await read(fixture());
  assert.equal(r.sub_accounts.available, true);
  assert.equal(r.sub_accounts.lp.total, 2, 'members 4 and 7; the admin and the pending one are not LPs');
  assert.deepEqual(r.sub_accounts.lp.by_segment, { lp_individual: 1 });
  assert.equal(r.sub_accounts.lp.no_segment, 1);
  assert.deepEqual(r.sub_accounts.product_tester, { recorded: false, reason: PRODUCT_TESTERS_REASON });
});

test('by profile: each profile\'s segments and its no-segment count; Other is empty while users.role is CHECKed', async () => {
  const r: any = await read(fixture());
  const p = (k: string) => r.by_profile.profiles.find((x: any) => x.profile === k);
  assert.deepEqual(r.by_profile.profiles.map((x: any) => x.profile), ['founder', 'investor', 'advisor', 'partner', 'exploring']);
  assert.deepEqual(p('founder'), { profile: 'founder', members: 3, no_segment: 0, segments: [{ id: 'founder_new', count: 2 }, { id: 'operator_advisor', count: 1 }] });
  assert.deepEqual(p('investor'), { profile: 'investor', members: 3, no_segment: 1, segments: [{ id: 'gp_external', count: 1 }, { id: 'lp_individual', count: 1 }] });
  assert.deepEqual(p('advisor'), { profile: 'advisor', members: 1, no_segment: 1, segments: [] });
  assert.deepEqual(p('exploring').segments, [{ id: 'lp_individual', count: 1 }]);
  assert.deepEqual(p('partner'), { profile: 'partner', members: 2, no_segment: 1, segments: [{ id: 'old_persona', count: 1 }] });
  assert.deepEqual(r.by_profile.other, { members: 0, no_segment: 0, segments: [] }, 'users.role is CHECKed to the six roles, admins left out');
});

test('how set and the confidence bands: a source not one of the three, and a confidence not stored, are counted apart', async () => {
  const r: any = await read(fixture());
  assert.deepEqual(r.how_set, { available: true, counts: { router: 4, self_select: 1, admin_retag: 1, not_recorded: 1 } });
  assert.equal(r.confidence.over, 4, 'over members whose segment was suggested at sign-up');
  assert.deepEqual(r.confidence.bands.map((b: any) => [b.key, b.count]), [['under_50', 1], ['50_69', 1], ['70_89', 0], ['90_up', 1]]);
  assert.equal(r.confidence.not_recorded, 1, 'a confidence that is not a number is not 0%');
});

test('confidence: each band edge belongs to the band above it, as D997 draws them', async () => {
  const db = emptyDb();
  [0.49, 0.5, 0.69, 0.7, 0.89, 0.9].forEach((c, i) => { user(db, i + 1, 'founder'); tag(db, i + 1, i + 1, 'founder_new', 'router', c, '2026-10-20 09:00:00'); });
  const r: any = await read(db);
  assert.deepEqual(r.confidence.bands.map((b: any) => [b.key, b.count]), [['under_50', 1], ['50_69', 2], ['70_89', 2], ['90_up', 1]]);
});

test('weekly: eight Mondays (UTC), this week to date; a week before any dated segment is null, a quiet week is 0', async () => {
  assert.equal(mondayOf(NOW), '2026-10-19');
  assert.equal(mondayOf(Date.parse('2026-10-19T00:00:00Z')), '2026-10-19');
  assert.equal(mondayOf(Date.parse('2026-10-18T23:59:59Z')), '2026-10-12', 'Sunday belongs to the week before');
  const r: any = await read(fixture());
  assert.equal(r.weekly.available, true);
  assert.equal(r.weekly.weeks.length, SEGMENT_WEEKS);
  assert.deepEqual(r.weekly.weeks.map((w: any) => [w.week_start, w.count]), [
    ['2026-08-31', 1], ['2026-09-07', 0], ['2026-09-14', 0], ['2026-09-21', 0],
    ['2026-09-28', 1], ['2026-10-05', 1], ['2026-10-12', 2], ['2026-10-19', 2],
  ]);
  assert.equal(r.weekly.weeks.at(-1).to_date, true);
  assert.equal(r.weekly.weeks.filter((w: any) => w.to_date).length, 1);

  const late = emptyDb();
  user(late, 1, 'founder'); tag(late, 1, 1, 'founder_new', 'router', 0.9, '2026-10-13 09:00:00');
  const w: any = await read(late);
  assert.deepEqual(w.weekly.weeks.map((x: any) => x.count), [null, null, null, null, null, null, 1, 0],
    'nothing was dated before 12 October, so those weeks are a break, not 0');
});

test('moves in 30 days: admin re-tags of members only, within the window', async () => {
  const r: any = await read(fixture());
  assert.deepEqual(r.moves_30d, { available: true, count: 1 });
});

test('each block fails alone: no LP store, no activity log, then no accounts at all', async () => {
  const noLp = fixture(); noLp.exec('DROP TABLE lp_applications');
  const a: any = await read(noLp);
  assert.equal(a.sub_accounts.available, false);
  assert.equal(a.sub_accounts.unreadable, true);
  assert.match(a.sub_accounts.reason, /^The LP applications could not be read on this database\. That is not the same as none\.$/);
  for (const k of ['members', 'segments', 'by_profile', 'how_set', 'confidence', 'weekly', 'moves_30d']) assert.equal(a[k].available, true, k);

  const noLog = fixture(); noLog.exec('DROP TABLE activity_logs');
  const b: any = await read(noLog);
  assert.equal(b.moves_30d.available, false);
  assert.equal(b.members.available, true);
  assert.equal(b.sub_accounts.available, true);

  const nothing = fixture(); nothing.exec('DROP TABLE user_personas');
  const c: any = await read(nothing);
  for (const k of ['members', 'segments', 'sub_accounts', 'by_profile', 'how_set', 'confidence', 'weekly']) {
    assert.equal(c[k].available, false, k);
    assert.ok(!('total' in c[k]) && !('rows' in c[k]), `${k} carries no zeros when it failed`);
  }
});

/* ------------------------------------------------------------------ *
 * The route
 * ------------------------------------------------------------------ */

const token = (userId: number, role: string) => new SignJWT({ user_id: userId, role })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));

async function get(db: Db, auth: string | null) {
  const res = await app.fetch(
    new Request('http://x/api/personas/admin/segments', { headers: auth ? { Authorization: `Bearer ${auth}` } : {} }),
    { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any,
  );
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body, text };
}

test('route: an admin reads the counts; no name, email or account id leaves the Worker', async () => {
  const db = fixture();
  const { status, body, text } = await get(db, await token(1, 'admin'));
  assert.equal(status, 200);
  assert.equal(body.members.available, true);
  assert.equal(body.members.total, 10, 'the route counts with the real clock too: the totals do not depend on it');
  assert.doesNotMatch(text, /@example\.test|Member \d|"user_id"|"email"|"name"/);
});

test('route: refused without a session, and for a member who is not an admin', async () => {
  const db = fixture();
  assert.equal((await get(db, null)).status, 401);
  const founder = await get(db, await token(2, 'founder'));
  assert.equal(founder.status, 403);
  assert.equal(founder.body.members, undefined);
});
