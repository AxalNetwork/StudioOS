/**
 * D377 — who hosts Spin-Out Lab office hours (migration 313, routes/lab_hosts.ts).
 *
 * The owner's rule: only people who applied to the Spin-Out Lab as an Investor,
 * Advisor or Partner and whom an admin approved appear on Office Hours. On
 * node:sqlite over the baseline's own `users`, `partners` and `advisors`:
 *
 *   1. THE MIGRATION stands alone; its CHECKs hold capacity and kind, and at
 *      most one live application exists per profile.
 *   2. APPLYING is from the caller's OWN profile only — a partner profile
 *      (Investor, Advisor or Partner) or an advisor profile (Advisor) — and a
 *      caller with neither is refused. A second live application is refused.
 *   3. THE DIRECTORY lists approved hosts only: not pending, rejected,
 *      withdrawn or revoked ones, and not an approved host whose own profile
 *      is inactive. It carries no email and nothing from the application.
 *      Only Lab founders (and active Lab members) and admins read it.
 *   4. DECIDING is admin-only, moves only the allowed transition, and is
 *      recorded against the applicant.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/lab_hosts_d377.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { labHosts, adminLabHosts, HOST_CAPACITIES } from '../src/routes/lab_hosts.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION = read('cloudflare-worker/sql/migrations/313_lab_host_applications.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

// Accounts.
const ADA = 1;   // admin
const PIA = 2;   // partner with a partner profile (id 20)
const VIC = 3;   // advisor with an advisor profile (id 30)
const IAN = 4;   // investor with a partner profile (id 21)
const FAY = 5;   // founder — the directory's reader
const NED = 6;   // partner with no profile at all
const EVE = 7;   // exploring, active in the Lab
const EXO = 8;   // exploring, not in the Lab
const ROLE: Record<number, string> = {
  [ADA]: 'admin', [PIA]: 'partner', [VIC]: 'advisor', [IAN]: 'investor', [FAY]: 'founder', [NED]: 'partner',
  [EVE]: 'exploring', [EXO]: 'exploring',
};

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
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
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of ['users', 'partners', 'advisors', 'activity_logs']) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  db.exec(MIGRATION);
  const u = db.prepare('INSERT INTO users (id, email, role, name, partner_id, spinout_lab_active) VALUES (?,?,?,?,?,?)');
  u.run(ADA, 'ada@axal.example', 'admin', 'Ada Admin', null, 0);
  u.run(PIA, 'pia@agency.example', 'partner', 'Pia Partner', 20, 0);
  u.run(VIC, 'vic@advisor.example', 'advisor', 'Vic Advisor', null, 0);
  u.run(IAN, 'ian@fund.example', 'investor', 'Ian Investor', 21, 0);
  u.run(FAY, 'fay@axal.example', 'founder', 'Fay Founder', null, 0);
  u.run(NED, 'ned@agency.example', 'partner', 'Ned Noprofile', null, 0);
  u.run(EVE, 'eve@axal.example', 'exploring', 'Eve Explorer', null, 1);
  u.run(EXO, 'exo@axal.example', 'exploring', 'Exo Outsider', null, 0);
  const p = db.prepare(`INSERT INTO partners (id, name, company, email, specialization, status, oh_when_to_book) VALUES (?,?,?,?,?,?,?)`);
  p.run(20, 'Loud Agency', 'Loud Agency Ltd', 'hello@loud.example', 'GTM and growth', 'active', 'Before your first launch.');
  p.run(21, 'Seed Fund', 'Seed Fund LP', 'deals@seed.example', 'Pre-seed investing', 'active', null);
  p.run(22, 'Never Applied', null, 'never@example.test', 'Legal counsel', 'active', null);
  db.prepare(`INSERT INTO advisors (id, uid, user_id, display_name, email, headline, is_active) VALUES (30, 'adv-30', ?, 'Vic Advisor', 'vic@advisor.example', 'Fintech operator', 1)`).run(VIC);
  return db;
}

async function call(db: InstanceType<typeof DatabaseSync>, as: number, method: string, path: string, payload?: unknown) {
  const app = new Hono<any>();
  app.route('/api/spinout-lab/hosts', labHosts);
  app.route('/api/admin/lab-hosts', adminLabHosts);
  app.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const token = await new SignJWT({ user_id: as, role: ROLE[as] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }, { DB: makeD1(db), JWT_SECRET } as any);
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body, text };
}
const apply = (db: any, as: number, payload: unknown) => call(db, as, 'POST', '/api/spinout-lab/hosts/apply', payload);
const decide = (db: any, as: number, uid: string, decision: string, note?: string) =>
  call(db, as, 'POST', `/api/admin/lab-hosts/${uid}/decision`, { decision, note });
const directory = (db: any, as = FAY) => call(db, as, 'GET', '/api/spinout-lab/hosts/directory');

/* ------------------------------------------------------------------ *
 * 1 · the migration                                                   *
 * ------------------------------------------------------------------ */

test('D377: migration 313 stands alone, and its CHECKs hold capacity, kind and one live application per profile', () => {
  const sql = MIGRATION.replace(/^\s*--.*$/gm, '');
  assert.ok(!/\bBEGIN\b|\bCOMMIT\b|DROP |ALTER /i.test(sql));
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO lab_host_applications (uid, user_id, host_kind, host_id, capacity, status) VALUES (?,?,?,?,?,?)`);
  assert.throws(() => ins.run('x1', PIA, 'partner', 20, 'lawyer', 'pending'), /CHECK/);
  assert.throws(() => ins.run('x2', VIC, 'advisor', 30, 'investor', 'pending'), /CHECK/, 'an advisor profile applied as an investor');
  assert.throws(() => ins.run('x3', PIA, 'mentor', 20, 'partner', 'pending'), /CHECK/);
  ins.run('ok1', PIA, 'partner', 20, 'partner', 'pending');
  assert.throws(() => ins.run('ok2', PIA, 'partner', 20, 'investor', 'approved'), /UNIQUE/, 'two live applications on one profile');
  ins.run('ok3', PIA, 'partner', 20, 'investor', 'rejected');
  assert.deepEqual([...HOST_CAPACITIES], ['investor', 'advisor', 'partner']);
});

/* ------------------------------------------------------------------ *
 * 2 · applying                                                        *
 * ------------------------------------------------------------------ */

test('D377: a host applies from their own profile, as a capacity that profile allows', async () => {
  const db = freshDb();
  const me = await call(db, PIA, 'GET', '/api/spinout-lab/hosts/me');
  assert.deepEqual(me.body.profiles, [{ kind: 'partner', id: 20, name: 'Loud Agency', capacities: ['investor', 'advisor', 'partner'] }]);
  const r = await apply(db, PIA, { host_kind: 'partner', capacity: 'partner', statement: '  GTM office hours for Lab founders.  ' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.application.status, 'pending');
  assert.equal(r.body.application.statement, 'GTM office hours for Lab founders.');
  const row: any = db.prepare('SELECT user_id, host_kind, host_id, capacity FROM lab_host_applications').get();
  assert.deepEqual({ ...row }, { user_id: PIA, host_kind: 'partner', host_id: 20, capacity: 'partner' },
    'the profile applied with is not the caller\'s own');

  // An investor applies from their partner profile, as an Investor.
  assert.equal((await apply(db, IAN, { host_kind: 'partner', capacity: 'investor' })).status, 201);
  // An advisor applies from their advisor profile — and only as an Advisor.
  const bad = await apply(db, VIC, { host_kind: 'advisor', capacity: 'investor' });
  assert.equal(bad.body.error, 'capacity_invalid');
  assert.equal((await apply(db, VIC, { host_kind: 'advisor', capacity: 'advisor' })).status, 201);
});

test('D377: nobody applies without a bookable profile, or on a profile that is not theirs', async () => {
  const db = freshDb();
  const none = await apply(db, NED, { host_kind: 'partner', capacity: 'partner' });
  assert.equal(none.status, 409);
  assert.equal(none.body.error, 'no_host_profile');
  const wrongKind = await apply(db, PIA, { host_kind: 'advisor', capacity: 'advisor' });
  assert.equal(wrongKind.body.error, 'no_host_profile', 'a partner applied through an advisor profile they do not have');
  // A host_id in the body is ignored: the profile is the caller's own.
  assert.equal((await apply(db, NED, { host_kind: 'partner', capacity: 'partner', host_id: 22 })).body.error, 'no_host_profile');
  assert.equal((await apply(db, PIA, { host_kind: 'lawyer', capacity: 'partner' })).body.error, 'host_kind_invalid');
  assert.equal((await apply(db, PIA, { host_kind: 'partner', capacity: 'partner', statement: 'x'.repeat(1001) })).body.error, 'statement_too_long');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM lab_host_applications').get() as any).n, 0);
});

test('D377: a second live application is refused; a withdrawn one frees the profile to apply again', async () => {
  const db = freshDb();
  const first = await apply(db, PIA, { host_kind: 'partner', capacity: 'partner' });
  const again = await apply(db, PIA, { host_kind: 'partner', capacity: 'investor' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_applied');
  const uid = first.body.application.uid;
  assert.equal((await call(db, IAN, 'POST', `/api/spinout-lab/hosts/me/${uid}/withdraw`)).status, 404, 'someone else withdrew it');
  assert.equal((await call(db, PIA, 'POST', `/api/spinout-lab/hosts/me/${uid}/withdraw`)).status, 200);
  assert.equal((await call(db, PIA, 'POST', `/api/spinout-lab/hosts/me/${uid}/withdraw`)).body.error, 'not_pending');
  assert.equal((await apply(db, PIA, { host_kind: 'partner', capacity: 'investor' })).status, 201);
});

/* ------------------------------------------------------------------ *
 * 3 · the directory                                                   *
 * ------------------------------------------------------------------ */

test('D377: the directory is empty until an admin approves — every partner profile is not a host', async () => {
  const db = freshDb();
  const r = await directory(db);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.items, [], 'a partner profile appeared without an approved application');
  await apply(db, PIA, { host_kind: 'partner', capacity: 'partner' });
  await apply(db, VIC, { host_kind: 'advisor', capacity: 'advisor' });
  assert.deepEqual((await directory(db)).body.items, [], 'a pending application is listed');
});

test('D377: approved hosts appear — partners and advisors, with capacity — and nothing else does', async () => {
  const db = freshDb();
  const pia = (await apply(db, PIA, { host_kind: 'partner', capacity: 'partner', statement: 'private pitch' })).body.application.uid;
  const ian = (await apply(db, IAN, { host_kind: 'partner', capacity: 'investor' })).body.application.uid;
  const vic = (await apply(db, VIC, { host_kind: 'advisor', capacity: 'advisor' })).body.application.uid;
  await decide(db, ADA, pia, 'approve', 'internal note');
  await decide(db, ADA, vic, 'approve');
  await decide(db, ADA, ian, 'reject');
  const r = await directory(db);
  assert.deepEqual(r.body.items.map((x: any) => [x.kind, x.name, x.capacity, x.uid]),
    [['partner', 'Loud Agency', 'partner', r.body.items[0].uid], ['advisor', 'Vic Advisor', 'advisor', 'adv-30']]);
  assert.equal(r.body.items[0].oh_when_to_book, 'Before your first launch.', 'the partner\'s own booking guidance did not ride along');
  assert.equal(r.body.items[0].host_id, 20);
  const text = JSON.stringify(r.body);
  for (const leak of ['@', 'private pitch', 'internal note', 'Seed Fund', 'Never Applied']) {
    assert.ok(!text.includes(leak), `the directory carries ${leak}`);
  }
});

test('D377: a revoked host, or an approved one whose own profile is inactive, is not listed', async () => {
  const db = freshDb();
  const pia = (await apply(db, PIA, { host_kind: 'partner', capacity: 'partner' })).body.application.uid;
  const vic = (await apply(db, VIC, { host_kind: 'advisor', capacity: 'advisor' })).body.application.uid;
  await decide(db, ADA, pia, 'approve');
  await decide(db, ADA, vic, 'approve');
  assert.equal((await directory(db)).body.count, 2);
  db.prepare(`UPDATE advisors SET is_active = 0 WHERE id = 30`).run();
  db.prepare(`UPDATE partners SET status = 'inactive' WHERE id = 20`).run();
  assert.equal((await directory(db)).body.count, 0, 'an inactive profile is still bookable');
  db.prepare(`UPDATE advisors SET is_active = 1 WHERE id = 30`).run();
  await decide(db, ADA, vic, 'revoke');
  assert.equal((await directory(db)).body.count, 0, 'a revoked host is still listed');
});

test('D377: only Lab founders, active Lab members and admins read the directory', async () => {
  const db = freshDb();
  for (const who of [FAY, ADA, EVE]) assert.equal((await directory(db, who)).status, 200, `${ROLE[who]} was refused`);
  for (const who of [PIA, IAN, EXO]) {
    const r = await directory(db, who);
    assert.equal(r.status, 403, `${ROLE[who]} (${who}) read the Lab directory`);
    assert.equal(r.body.error, 'lab_only');
  }
});

/* ------------------------------------------------------------------ *
 * 4 · deciding                                                        *
 * ------------------------------------------------------------------ */

test('D377: only an admin decides, and only the allowed transition moves', async () => {
  const db = freshDb();
  const uid = (await apply(db, PIA, { host_kind: 'partner', capacity: 'partner' })).body.application.uid;
  for (const who of [PIA, FAY]) {
    assert.equal((await decide(db, who, uid, 'approve')).status, 403, `${ROLE[who]} approved an application`);
  }
  assert.equal((await call(db, FAY, 'GET', '/api/admin/lab-hosts')).status, 403);
  assert.equal((await decide(db, ADA, uid, 'publish')).body.error, 'decision_invalid');
  assert.equal((await decide(db, ADA, uid, 'revoke')).body.error, 'not_decidable', 'a pending application was revoked');
  assert.equal((await decide(db, ADA, 'nope', 'approve')).status, 404);
  const ok = await decide(db, ADA, uid, 'approve', ' fits the Lab ');
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.application.status, 'approved');
  assert.equal(ok.body.application.review_note, 'fits the Lab');
  assert.ok(!('user_id' in ok.body.application));
  assert.equal((await decide(db, ADA, uid, 'reject')).body.error, 'not_decidable', 'an approved application was rejected');
  const row: any = db.prepare('SELECT reviewed_by, reviewed_at FROM lab_host_applications WHERE uid = ?').get(uid);
  assert.equal(row.reviewed_by, ADA);
  assert.ok(row.reviewed_at);
});

test('D377: each decision is recorded against the applicant; the queue filters by status and counts', async () => {
  const db = freshDb();
  const a = (await apply(db, PIA, { host_kind: 'partner', capacity: 'partner' })).body.application.uid;
  const b = (await apply(db, VIC, { host_kind: 'advisor', capacity: 'advisor' })).body.application.uid;
  await decide(db, ADA, a, 'approve');
  await decide(db, ADA, b, 'reject');
  const logs = db.prepare(`SELECT action, user_id, details FROM activity_logs WHERE action LIKE 'lab_host.%' ORDER BY id`).all() as any[];
  assert.deepEqual(logs.map((l) => [l.action, l.user_id, JSON.parse(l.details).target_user_id]),
    [['lab_host.approve', ADA, PIA], ['lab_host.reject', ADA, VIC]]);
  const q = await call(db, ADA, 'GET', '/api/admin/lab-hosts?status=approved');
  assert.deepEqual(q.body.items.map((x: any) => [x.uid, x.applicant_email, x.profile_name]), [[a, 'pia@agency.example', 'Loud Agency']]);
  assert.deepEqual(q.body.counts, { pending: 0, approved: 1, rejected: 1, withdrawn: 0, revoked: 0 });
  assert.equal((await call(db, ADA, 'GET', '/api/admin/lab-hosts?status=all')).body.items.length, 2);
  assert.equal((await call(db, ADA, 'GET', '/api/admin/lab-hosts?status=bogus')).body.status, 'pending');
});

test('D377: both routers are mounted at the paths the pages call', () => {
  const index = read('cloudflare-worker/src/index.ts');
  assert.match(index, /app\.route\('\/api\/spinout-lab\/hosts', labHosts\);/);
  assert.match(index, /app\.route\('\/api\/admin\/lab-hosts', adminLabHosts\);/);
});
