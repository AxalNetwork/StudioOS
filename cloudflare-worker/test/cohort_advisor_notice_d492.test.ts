/**
 * D492 (U6) — a cohort's founders are told when an advisor can read them, and
 * can hide themselves from that advisor (migration 367,
 * services/cohortAdvisorAccess.ts, routes/advisors.ts).
 *
 * The real advisors router on node:sqlite over the baseline's own tables:
 *
 *   1. THE MIGRATION stands alone and its ledger key holds.
 *   2. EXISTING ASSIGNMENTS: the first sweep tells every founder already in an
 *      assigned cohort; access is kept (the owner's "keep access, notify now").
 *   3. A NEW ASSIGNMENT tells every founder at once, through the admin route.
 *   4. A LATER ENTRANT is told on the next sweep, and only they are.
 *   5. ENDED ACCESS tells exactly the founders who were told it started; a
 *      re-assignment is a new episode, told again.
 *   6. IDEMPOTENT: a second sweep sends nothing.
 *   7. OPT-OUT: a hidden founder leaves founders, weeks and guidance, gets no
 *      start notice while hidden, and is owed one on un-hiding.
 *   8. THE FOUNDER ROUTES read and write the caller only, and refuse an advisor
 *      who has no assignment on the caller's cohorts.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/cohort_advisor_notice_d492.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import advisors from '../src/routes/advisors.ts';
import { syncCohortAdvisorNotices, COHORT_ACCESS_NOTICE_TYPE } from '../src/services/cohortAdvisorAccess.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION = read('cloudflare-worker/sql/migrations/367_cohort_advisor_founder_notice.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN = 1;
const AVA = 10;   // advisor, assigned to cycle 1 at rollout
const ALF = 11;   // advisor, not assigned anywhere until a test does it
const DEMOTED = 12; // was an advisor; role is now founder
const FAY = 20; const FIN = 21; const FLO = 22; // founders in cycle 1
const GUS = 30;   // founder in cycle 2 only
const CYCLE = 1; const OTHER_CYCLE = 2;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function sqliteCall(sql: string, binds: any[]) {
  // D1 treats `?1` as one parameter however often it appears; node:sqlite does
  // not, so each occurrence becomes its own `?` carrying the same value.
  const values: any[] = [];
  const rewritten = sql.replace(/\?(\d+)/g, (_m, n) => { values.push(binds[Number(n) - 1]); return '?'; });
  return { sql: values.length ? rewritten : sql, values: values.length ? values : binds };
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { const q = sqliteCall(sql, b); return db.prepare(q.sql).get(...q.values) ?? null; },
        async all() { const q = sqliteCall(sql, b); return { results: db.prepare(q.sql).all(...q.values) }; },
        async run() {
          const q = sqliteCall(sql, b);
          const r = db.prepare(q.sql).run(...q.values);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(stmts: any[]) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'cohort_cycles', 'company_week_status', 'advisor_cohort_assignments', 'notifications_inbox', 'user_settings', 'week_windows']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  db.exec(MIGRATION.replace(/^\s*--[^\n]*$/gm, ''));
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin@example.test', 'Ada Admin', 'admin');
  u.run(AVA, 'ava@example.test', 'Ava Advisor', 'advisor');
  u.run(ALF, 'alf@example.test', 'Alf Advisor', 'advisor');
  u.run(DEMOTED, 'dee@example.test', 'Dee Demoted', 'founder');
  u.run(FAY, 'fay@example.test', 'Fay Founder', 'founder');
  u.run(FIN, 'fin@example.test', 'Fin Founder', 'founder');
  u.run(FLO, 'flo@example.test', 'Flo Founder', 'founder');
  u.run(GUS, 'gus@example.test', 'Gus Founder', 'founder');
  const c = db.prepare('INSERT INTO cohort_cycles (id, year, month, start_at, end_at) VALUES (?, ?, ?, ?, ?)');
  c.run(CYCLE, 2026, 9, '2026-09-01', '2026-11-30');
  c.run(OTHER_CYCLE, 2026, 10, '2026-10-01', '2026-12-31');
  const w = db.prepare('INSERT INTO company_week_status (user_id, cohort_cycle_id, week_number, status) VALUES (?, ?, ?, ?)');
  for (const f of [FAY, FIN]) { w.run(f, CYCLE, 1, 'done'); w.run(f, CYCLE, 2, 'pending'); }
  w.run(GUS, OTHER_CYCLE, 1, 'pending');
  const a = db.prepare(`INSERT INTO advisor_cohort_assignments (uid, advisor_user_id, cohort_cycle_id, assigned_at, is_active)
                        VALUES (?, ?, ?, ?, 1)`);
  a.run('asg-ava-1', AVA, CYCLE, '2026-09-02T09:00:00.000Z');
  // A stale row: still active, but its holder is no longer an advisor. Nobody
  // can read through it (the role gate), so nobody is told it started.
  a.run('asg-dee-1', DEMOTED, CYCLE, '2026-09-02T09:00:00.000Z');
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);

async function call(db: InstanceType<typeof DatabaseSync>, userId: number, role: string, path: string, init: { method?: string; body?: any } = {}) {
  const tok = await new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await advisors.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env(db));
  return { status: res.status, body: await res.json().catch(() => null) };
}

const notices = (db: InstanceType<typeof DatabaseSync>, userId?: number) =>
  db.prepare(`SELECT user_id, title, payload, category FROM notifications_inbox WHERE type = ?
              ${userId ? 'AND user_id = ?' : ''} ORDER BY id`)
    .all(...(userId ? [COHORT_ACCESS_NOTICE_TYPE, userId] : [COHORT_ACCESS_NOTICE_TYPE])) as any[];
const kinds = (rows: any[]) => rows.map((r) => `${r.user_id}:${JSON.parse(r.payload).kind}`);

test('the migration stands alone and its ledger key refuses a second notice for one episode', () => {
  const db = freshDb();
  assert.doesNotThrow(() => db.exec(MIGRATION.replace(/^\s*--[^\n]*$/gm, '')), 'IF NOT EXISTS throughout');
  db.prepare(`INSERT INTO cohort_advisor_notices (assignment_id, founder_user_id, kind, episode_at) VALUES (1, ?, 'started', 'e1')`).run(FAY);
  assert.throws(() => db.prepare(`INSERT INTO cohort_advisor_notices (assignment_id, founder_user_id, kind, episode_at) VALUES (1, ?, 'started', 'e1')`).run(FAY));
  assert.throws(() => db.prepare(`INSERT INTO cohort_advisor_notices (assignment_id, founder_user_id, kind, episode_at) VALUES (1, ?, 'peeked', 'e1')`).run(FAY),
    'kind is started or ended');
  assert.doesNotThrow(() => db.prepare(`INSERT INTO cohort_advisor_notices (assignment_id, founder_user_id, kind, episode_at) VALUES (1, ?, 'started', 'e2')`).run(FAY),
    'a new episode is a new notice');
});

test('existing assignments: the first sweep tells each founder in the cohort once, and access is kept', async () => {
  const db = freshDb();
  const r = await syncCohortAdvisorNotices(env(db));
  assert.deepEqual(r, { started: 2, ended: 0 });
  assert.deepEqual(kinds(notices(db)), [`${FAY}:started`, `${FIN}:started`],
    'Fay and Fin, from Ava; nothing for the demoted holder, nothing to Gus in another cohort');
  const fay = notices(db, FAY)[0];
  assert.match(fay.title, /Ava Advisor can see you/);
  assert.equal(fay.category, 'privacy');
  // Access was not suspended pending an answer.
  const list = await call(db, AVA, 'advisor', `/me/cohort/${CYCLE}/founders`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items.map((i: any) => i.user_id).sort(), [FAY, FIN]);
  // Idempotent.
  assert.deepEqual(await syncCohortAdvisorNotices(env(db)), { started: 0, ended: 0 });
  assert.equal(notices(db).length, 2);
});

test('the advisor’s first read tells the founders before it returns them', async () => {
  const db = freshDb();
  assert.equal(notices(db).length, 0);
  await call(db, AVA, 'advisor', `/me/cohort/${CYCLE}/weeks`);
  assert.deepEqual(kinds(notices(db)), [`${FAY}:started`, `${FIN}:started`]);
});

test('a new assignment tells every founder in that cohort at once', async () => {
  const db = freshDb();
  const res = await call(db, ADMIN, 'admin', '/admin/cohort-assignments', {
    method: 'POST', body: { advisor_user_id: ALF, cohort_cycle_id: OTHER_CYCLE },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.founders_notified, 1);
  assert.deepEqual(kinds(notices(db)), [`${GUS}:started`], 'the assign sweep is scoped to its own assignment');
  assert.match(notices(db, GUS)[0].title, /Alf Advisor/);
});

test('a later cohort entrant is told on the next sweep, and nobody else is told twice', async () => {
  const db = freshDb();
  await syncCohortAdvisorNotices(env(db));
  db.prepare("INSERT INTO company_week_status (user_id, cohort_cycle_id, week_number, status) VALUES (?, ?, 1, 'pending')").run(FLO, CYCLE);
  await call(db, AVA, 'advisor', `/me/cohort/${CYCLE}/founders`);
  assert.deepEqual(kinds(notices(db)), [`${FAY}:started`, `${FIN}:started`, `${FLO}:started`]);
});

test('ending access tells exactly the founders who were told it started; re-assigning starts a new episode', async () => {
  const db = freshDb();
  await syncCohortAdvisorNotices(env(db));
  const asg = db.prepare('SELECT id FROM advisor_cohort_assignments WHERE uid = ?').get('asg-ava-1') as any;
  const ended = await call(db, ADMIN, 'admin', `/admin/cohort-assignments/${asg.id}`, { method: 'DELETE' });
  assert.equal(ended.status, 200);
  assert.equal(ended.body.founders_notified, 2);
  assert.deepEqual(kinds(notices(db)).slice(2), [`${FAY}:ended`, `${FIN}:ended`]);
  assert.match(notices(db, FAY)[1].title, /can no longer see you/);
  assert.deepEqual(await syncCohortAdvisorNotices(env(db)), { started: 0, ended: 0 }, 'an end is told once');

  // The admin route reactivates the same row with a new assigned_at.
  const again = await call(db, ADMIN, 'admin', '/admin/cohort-assignments', {
    method: 'POST', body: { advisor_user_id: AVA, cohort_cycle_id: CYCLE },
  });
  assert.equal(again.body.founders_notified, 2, 'a new episode is told again');
  assert.deepEqual(kinds(notices(db)).slice(4), [`${FAY}:started`, `${FIN}:started`]);
});

test('two sweeps racing send each notice once — the ledger insert is the gate', async () => {
  const db = freshDb();
  const [a, b] = await Promise.all([syncCohortAdvisorNotices(env(db)), syncCohortAdvisorNotices(env(db))]);
  assert.equal(a.started + b.started, 2);
  assert.equal(notices(db).length, 2);
});

test('re-assigning without an explicit end still tells the founders the old episode ended', async () => {
  const db = freshDb();
  await syncCohortAdvisorNotices(env(db));
  db.prepare("UPDATE advisor_cohort_assignments SET assigned_at = '2026-09-20T09:00:00.000Z' WHERE uid = 'asg-ava-1'").run();
  const r = await syncCohortAdvisorNotices(env(db));
  assert.deepEqual(r, { started: 2, ended: 2 });
});

test('a hidden founder leaves founders, weeks and guidance; un-hiding makes a start notice owed', async () => {
  const db = freshDb();
  // Fay hides before anything is sent: she is never told it started.
  const hide = await call(db, FAY, 'founder', `/me/cohort-access/${AVA}`, { method: 'PUT', body: { visible: false } });
  assert.equal(hide.status, 200);
  const mine = hide.body.items.find((i: any) => i.advisor_user_id === AVA);
  assert.equal(mine.can_see, false);
  assert.ok(mine.hidden_at);

  const founders = await call(db, AVA, 'advisor', `/me/cohort/${CYCLE}/founders`);
  assert.deepEqual(founders.body.items.map((i: any) => i.user_id), [FIN]);
  const weeks = await call(db, AVA, 'advisor', `/me/cohort/${CYCLE}/weeks`);
  assert.equal(weeks.status, 200);
  assert.deepEqual(weeks.body.founders.map((f: any) => f.user_id), [FIN]);

  // Guidance: an acknowledgement by Fay is not shown to Ava.
  await call(db, AVA, 'advisor', `/me/cohort/${CYCLE}/guidance`); // creates the 212 tables
  db.prepare(`INSERT INTO cohort_guidance (uid, advisor_user_id, cohort_cycle_id, body, posted_at)
              VALUES ('g1', ?, ?, 'Talk to five customers', '2026-09-03T09:00:00Z')`).run(AVA, CYCLE);
  const gid = (db.prepare("SELECT id FROM cohort_guidance WHERE uid = 'g1'").get() as any).id;
  const ack = db.prepare('INSERT INTO cohort_guidance_acks (guidance_id, founder_user_id, acted_at) VALUES (?, ?, ?)');
  ack.run(gid, FAY, '2026-09-04T09:00:00Z');
  ack.run(gid, FIN, '2026-09-04T10:00:00Z');
  const guidance = await call(db, AVA, 'advisor', `/me/cohort/${CYCLE}/guidance`);
  assert.equal(guidance.status, 200);
  assert.deepEqual(guidance.body.items[0].acted_by.map((a: any) => a.user_id), [FIN]);

  assert.deepEqual(kinds(notices(db)), [`${FIN}:started`], 'no start notice while hidden');

  // Hiding is per advisor: Alf, once assigned, still sees Fay.
  await call(db, ADMIN, 'admin', '/admin/cohort-assignments', { method: 'POST', body: { advisor_user_id: ALF, cohort_cycle_id: CYCLE } });
  const alf = await call(db, ALF, 'advisor', `/me/cohort/${CYCLE}/founders`);
  assert.deepEqual(alf.body.items.map((i: any) => i.user_id).sort(), [FAY, FIN]);

  const show = await call(db, FAY, 'founder', `/me/cohort-access/${AVA}`, { method: 'PUT', body: { visible: true } });
  assert.equal(show.status, 200);
  assert.equal(show.body.items.find((i: any) => i.advisor_user_id === AVA).can_see, true);
  const fromAva = notices(db, FAY).map((r) => JSON.parse(r.payload)).filter((p) => p.advisor_user_id === AVA);
  assert.deepEqual(fromAva.map((p) => p.kind), ['started'], 'un-hiding sends the start notice now owed, from Ava');
  const back = await call(db, AVA, 'advisor', `/me/cohort/${CYCLE}/founders`);
  assert.deepEqual(back.body.items.map((i: any) => i.user_id).sort(), [FAY, FIN]);
  const row = db.prepare('SELECT withdrawn_at FROM cohort_advisor_optouts WHERE founder_user_id = ? AND advisor_user_id = ?').get(FAY, AVA) as any;
  assert.ok(row.withdrawn_at, 'the opt-out is kept, marked withdrawn');
});

test('the founder routes are the caller’s own, and refuse an advisor unrelated to the caller', async () => {
  const db = freshDb();
  const fay = await call(db, FAY, 'founder', '/me/cohort-access');
  assert.equal(fay.status, 200);
  assert.deepEqual(fay.body.items.map((i: any) => i.advisor_user_id).sort(), [AVA, DEMOTED]);
  const dee = fay.body.items.find((i: any) => i.advisor_user_id === DEMOTED);
  assert.equal(dee.can_see, false, 'a holder who is no longer an advisor cannot see her');
  assert.deepEqual(kinds(notices(db)), [`${FAY}:started`], 'opening the list sends only the caller’s own owed notice');

  const gus = await call(db, GUS, 'founder', '/me/cohort-access');
  assert.deepEqual(gus.body.items, [], 'Gus is in no assigned cohort');
  const unrelated = await call(db, GUS, 'founder', `/me/cohort-access/${AVA}`, { method: 'PUT', body: { visible: false } });
  assert.equal(unrelated.status, 404, 'an opt-out names a real grant, not any user id');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM cohort_advisor_optouts').get() as any).n, 0);

  assert.equal((await call(db, FAY, 'founder', '/me/cohort-access/abc', { method: 'PUT', body: { visible: false } })).status, 400);
  assert.equal((await call(db, FAY, 'founder', `/me/cohort-access/${AVA}`, { method: 'PUT', body: { visible: 'no' } })).status, 400);
});
