/**
 * D493 (U8) — a relationship about someone else is a request they accept or
 * decline (migration 368, routes/partnernet.ts).
 *
 * The real partnernet router on node:sqlite, starting from the baseline's
 * pre-368 `partner_relationships` so the upgrade path is the one exercised:
 *
 *   1. THE MIGRATION stands alone on the baseline table, and every existing row
 *      comes out 'accepted' (the owner's "treat as accepted, notify").
 *   2. A NEW ROW IS PENDING: it is in neither book, counts towards neither
 *      network score, and its subject sees who asked and the type — nothing
 *      the author wrote.
 *   3. ONLY THE SUBJECT ANSWERS. Accepting puts it in both books and scores and
 *      tells the requester; declining is not announced, and the declined
 *      requester cannot ask again (the decliner can).
 *   4. WITHDRAW is the author's, while pending; REMOVE is either party's, on an
 *      accepted row, and takes it out of both books and scores.
 *   5. EDITS, EVENTS, INTERACTIONS AND REMINDERS need an accepted row.
 *   6. THE RATE LIMIT counts requests the caller sent, not rows naming them.
 *   7. THE LEGACY NOTICE tells each pre-368 row's subject once.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/relationship_requests_d493.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

import partnernet, { noticeLegacyRelationships } from '../src/routes/partnernet.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION = read('cloudflare-worker/sql/migrations/368_relationship_requests.sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const ADMIN = 1;
const IDA = 10;  // requester
const PAM = 20;  // subject
const OLI = 30;  // outsider
const LEO = 40;  // party to a pre-368 row Ida created
const NED = 50;  // party to a pre-368 row with no recorded creator

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function sqliteCall(sql: string, binds: any[]) {
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

function freshDb({ legacy = false }: { legacy?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'partner_relationships', 'notifications_inbox', 'user_settings']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  const u = db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(ADMIN, 'admin@example.test', 'Ada Admin', 'admin');
  u.run(IDA, 'ida@example.test', 'Ida Investor', 'investor');
  u.run(PAM, 'pam@example.test', 'Pam Partner', 'partner');
  u.run(OLI, 'oli@example.test', 'Oli Outsider', 'investor');
  u.run(LEO, 'leo@example.test', 'Leo Lender', 'investor');
  u.run(NED, 'ned@example.test', 'Ned Neighbour', 'partner');
  if (legacy) {
    // Pre-368 rows: written straight in, as the old POST did.
    const r = db.prepare(`INSERT INTO partner_relationships (partner_a_id, partner_b_id, relationship_type, strength_score, metadata)
                          VALUES (?, ?, 'co_investor', 70, ?)`);
    r.run(IDA, LEO, JSON.stringify({ created_by: IDA }));
    r.run(IDA, NED, '{}');
  }
  return db;
}

const env = (db: InstanceType<typeof DatabaseSync>) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) } as any);

async function call(db: InstanceType<typeof DatabaseSync>, userId: number, role: string, path: string, init: { method?: string; body?: any } = {}) {
  const tok = await new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await partnernet.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env(db));
  return { status: res.status, body: await res.json().catch(() => null) };
}
const ida = (db: any, p: string, i?: any) => call(db, IDA, 'investor', p, i);
const pam = (db: any, p: string, i?: any) => call(db, PAM, 'partner', p, i);
const oli = (db: any, p: string, i?: any) => call(db, OLI, 'investor', p, i);

const inbox = (db: InstanceType<typeof DatabaseSync>, userId: number) =>
  db.prepare("SELECT title, body, payload FROM notifications_inbox WHERE user_id = ? AND type = 'relationship_request' ORDER BY id").all(userId) as any[];
const activeCount = (db: InstanceType<typeof DatabaseSync>, userId: number) =>
  (db.prepare('SELECT active_relationships AS n FROM partner_summary WHERE id = ?').get(userId) as any).n;

async function request(db: InstanceType<typeof DatabaseSync>) {
  const res = await ida(db, '/relationships', {
    method: 'POST',
    body: { partner_id: PAM, relationship_type: 'co_investor', strength_score: 90, metadata: { note: 'met at demo day', private_notes: { [PAM]: 'x' } } },
  });
  assert.equal(res.status, 201);
  return res.body.id as number;
}

test('the migration stands alone on the baseline table and keeps every existing row accepted', () => {
  const db = freshDb({ legacy: true });
  db.exec(MIGRATION.replace(/^\s*--[^\n]*$/gm, ''));
  const rows = db.prepare('SELECT status, requested_by, legacy_noticed_at FROM partner_relationships').all() as any[];
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.status, 'accepted');
    assert.equal(r.requested_by, null);
    assert.equal(r.legacy_noticed_at, null);
  }
});

test('a new relationship is a pending request: in neither book or score, and its subject sees only who and what', async () => {
  const db = freshDb();
  const id = await request(db);
  const row = db.prepare('SELECT status, requested_by, metadata FROM partner_relationships WHERE id = ?').get(id) as any;
  assert.equal(row.status, 'pending');
  assert.equal(row.requested_by, IDA);
  assert.equal(JSON.parse(row.metadata).private_notes, undefined, 'a request cannot carry the other side’s private note');

  assert.deepEqual((await pam(db, '/relationships')).body, [], 'not in the subject’s book');
  assert.deepEqual((await ida(db, '/relationships')).body, [], 'nor in the author’s, until accepted');
  assert.equal(activeCount(db, PAM), 0, 'it counts towards no network score');
  assert.equal(activeCount(db, IDA), 0);

  const req = await pam(db, '/relationships/requests');
  assert.equal(req.status, 200);
  assert.deepEqual(req.body.incoming, [{
    id, relationship_type: 'co_investor', requested_at: req.body.incoming[0].requested_at,
    requester: { id: IDA, name: 'Ida Investor', role: 'investor' },
  }], 'who and what type — no score, no metadata');
  assert.deepEqual(req.body.outgoing, []);
  const out = await ida(db, '/relationships/requests');
  assert.deepEqual(out.body.incoming, [], 'the author is not asked to answer their own request');
  assert.equal(out.body.outgoing[0].status, 'pending');
  assert.equal(out.body.outgoing[0].other.id, PAM);
  assert.deepEqual((await oli(db, '/relationships/requests')).body, { incoming: [], outgoing: [] });

  const told = inbox(db, PAM);
  assert.equal(told.length, 1);
  assert.match(told[0].title, /Ida Investor wants to record a relationship with you/);
  assert.equal((await ida(db, '/relationships', { method: 'POST', body: { partner_id: PAM, relationship_type: 'co_investor' } })).status, 409,
    'one open request per pair');
});

test('only the subject answers; accepting puts it in both books and scores and tells the requester', async () => {
  const db = freshDb();
  const id = await request(db);
  assert.equal((await ida(db, `/relationships/${id}/respond`, { method: 'POST', body: { decision: 'accept' } })).status, 403,
    'the author cannot accept their own request');
  assert.equal((await oli(db, `/relationships/${id}/respond`, { method: 'POST', body: { decision: 'accept' } })).status, 404);
  assert.equal((await pam(db, `/relationships/${id}/respond`, { method: 'POST', body: { decision: 'maybe' } })).status, 400);

  const ok = await pam(db, `/relationships/${id}/respond`, { method: 'POST', body: { decision: 'accept' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'accepted');
  assert.equal((await pam(db, '/relationships')).body.length, 1);
  assert.equal((await ida(db, '/relationships')).body[0].other.id, PAM);
  assert.equal(activeCount(db, PAM), 1);
  assert.equal(activeCount(db, IDA), 1);
  assert.match(inbox(db, IDA)[0].title, /Pam Partner accepted/);
  const score = (uid: number) => (db.prepare('SELECT network_score FROM users WHERE id = ?').get(uid) as any).network_score;
  assert.ok(score(PAM) > 0 && score(IDA) > 0, 'both network scores are recomputed on acceptance');
  assert.equal((await pam(db, `/relationships/${id}/respond`, { method: 'POST', body: { decision: 'decline' } })).status, 409,
    'an answered request is not answered twice');
});

test('a decline is not announced, and the declined requester cannot ask again — the decliner can', async () => {
  const db = freshDb();
  const id = await request(db);
  const no = await pam(db, `/relationships/${id}/respond`, { method: 'POST', body: { decision: 'decline' } });
  assert.equal(no.body.status, 'declined');
  assert.deepEqual(inbox(db, IDA), [], 'no notice of the decline');
  assert.equal((await ida(db, '/relationships/requests')).body.outgoing[0].status, 'declined', 'the author sees it on their own list');
  assert.equal((await pam(db, '/relationships/requests')).body.incoming.length, 0);

  assert.equal((await ida(db, '/relationships', { method: 'POST', body: { partner_id: PAM, relationship_type: 'strategic_alliance' } })).status, 409);
  const reopened = await pam(db, '/relationships', { method: 'POST', body: { partner_id: IDA, relationship_type: 'strategic_alliance' } });
  assert.equal(reopened.status, 201, 'the decliner may reopen it');
  assert.equal(reopened.body.id, id, 'the one row per pair is reused');
  assert.equal((await ida(db, '/relationships/requests')).body.incoming[0].requester.id, PAM);
});

test('withdraw is the author’s while pending; remove is either party’s once accepted', async () => {
  const db = freshDb();
  const id = await request(db);
  assert.equal((await pam(db, `/relationships/${id}/withdraw`, { method: 'POST' })).status, 404, 'the subject cannot withdraw it');
  assert.equal((await pam(db, `/relationships/${id}/remove`, { method: 'POST' })).status, 409, 'a pending request is not removable');
  const w = await ida(db, `/relationships/${id}/withdraw`, { method: 'POST' });
  assert.equal(w.body.status, 'withdrawn');
  assert.equal((await pam(db, '/relationships/requests')).body.incoming.length, 0);
  assert.equal((await ida(db, `/relationships/${id}/withdraw`, { method: 'POST' })).status, 409);

  // Asked again after a withdrawal, accepted, then removed by the subject.
  assert.equal((await ida(db, '/relationships', { method: 'POST', body: { partner_id: PAM, relationship_type: 'co_investor' } })).status, 201);
  await pam(db, `/relationships/${id}/respond`, { method: 'POST', body: { decision: 'accept' } });
  assert.equal(activeCount(db, IDA), 1);
  assert.equal((await oli(db, `/relationships/${id}/remove`, { method: 'POST' })).status, 404);
  const r = await pam(db, `/relationships/${id}/remove`, { method: 'POST' });
  assert.equal(r.body.status, 'removed');
  assert.deepEqual((await ida(db, '/relationships')).body, []);
  assert.equal(activeCount(db, IDA), 0);
  assert.equal(activeCount(db, PAM), 0);
});

test('edits, events, interactions and reminders need an accepted relationship', async () => {
  const db = freshDb();
  const id = await request(db);
  assert.equal((await ida(db, `/relationships/${id}`, { method: 'PATCH', body: { strength_score: 99 } })).status, 409);
  assert.equal((await pam(db, `/relationships/${id}/events`)).status, 409, 'the subject cannot read a pending row’s history');
  assert.equal((await ida(db, `/relationships/${id}/interactions`, { method: 'POST', body: { note: 'x' } })).status, 409);
  assert.equal((await pam(db, `/relationships/${id}/interactions`)).status, 409);
  assert.equal((await ida(db, `/relationships/${id}/reminders`, { method: 'POST', body: { remind_at: '2026-12-01' } })).status, 409);

  await pam(db, `/relationships/${id}/respond`, { method: 'POST', body: { decision: 'accept' } });
  assert.equal((await ida(db, `/relationships/${id}`, { method: 'PATCH', body: { strength_score: 80 } })).status, 200);
  assert.equal((await pam(db, `/relationships/${id}/events`)).status, 200);
  assert.equal((await ida(db, `/relationships/${id}/interactions`, { method: 'POST', body: { note: 'Call' } })).status, 201);
  const rem = await ida(db, `/relationships/${id}/reminders`, { method: 'POST', body: { remind_at: '2026-12-01', note: 'follow up' } });
  assert.ok(rem.status === 200 || rem.status === 201, `reminder set (${rem.status})`);
  assert.equal((await ida(db, '/reminders?all=1')).body.items.length, 1);

  // Removing the relationship takes its reminder off the desk.
  await pam(db, `/relationships/${id}/remove`, { method: 'POST' });
  assert.equal((await ida(db, '/reminders?all=1')).body.items.length, 0);
  assert.equal((await ida(db, `/relationships/${id}/interactions`)).status, 409);
});

test('the rate limit counts requests the caller sent, not rows that name them', async () => {
  const db = freshDb();
  db.exec(MIGRATION.replace(/^\s*--[^\n]*$/gm, ''));
  const now = new Date().toISOString();
  const ins = db.prepare(`INSERT INTO partner_relationships (partner_a_id, partner_b_id, relationship_type, status, requested_by, requested_at)
                          VALUES (?, ?, 'co_investor', 'pending', ?, ?)`);
  // Twenty-five strangers ask Pam within the hour.
  for (let i = 0; i < 25; i += 1) {
    const uid = 1000 + i;
    db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)').run(uid, `s${i}@example.test`, `S${i}`, 'investor');
    ins.run(PAM, uid, uid, now);
  }
  const mine = await pam(db, '/relationships', { method: 'POST', body: { partner_id: OLI, relationship_type: 'co_investor' } });
  assert.equal(mine.status, 201, 'other people’s requests do not throttle the person they name');
  // Pam's own requests do.
  for (let i = 0; i < 19; i += 1) {
    const uid = 2000 + i;
    db.prepare('INSERT INTO users (id, email, name, role, is_active) VALUES (?, ?, ?, ?, 1)').run(uid, `t${i}@example.test`, `T${i}`, 'investor');
    ins.run(PAM, uid, PAM, now);
  }
  assert.equal((await pam(db, '/relationships', { method: 'POST', body: { partner_id: IDA, relationship_type: 'co_investor' } })).status, 429);
});

test('pre-368 relationships stay accepted and each subject is told once', async () => {
  const db = freshDb({ legacy: true });
  // The first request runs the runtime bootstrap, which adds the 368 columns.
  assert.equal((await call(db, LEO, 'investor', '/relationships')).body.length, 1, 'kept in the book');
  const r = await noticeLegacyRelationships(env(db));
  assert.deepEqual(r, { rows: 2, notices: 3 });
  // Ida created the Leo row: Leo is its subject. The Ned row has no creator,
  // so both of its parties are told.
  assert.equal(inbox(db, LEO).length, 1);
  assert.match(inbox(db, LEO)[0].body, /Ida Investor/);
  assert.equal(inbox(db, NED).length, 1);
  assert.equal(inbox(db, IDA).length, 1, 'Ida is told about the Ned row only');
  assert.match(inbox(db, IDA)[0].body, /Ned Neighbour/);
  assert.doesNotMatch(inbox(db, IDA)[0].body, /Leo/, 'not about the row she created');
  assert.deepEqual(await noticeLegacyRelationships(env(db)), { rows: 0, notices: 0 }, 'once');
  // A post-368 accepted row is never a legacy row.
  const id = await request(db);
  await pam(db, `/relationships/${id}/respond`, { method: 'POST', body: { decision: 'accept' } });
  assert.deepEqual(await noticeLegacyRelationships(env(db)), { rows: 0, notices: 0 });
});
