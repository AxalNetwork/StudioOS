/**
 * D6261 (#6261) — an investor's intro ask can be answered (the owner's choice
 * A): the founder is told, accepts or declines, and the investor may withdraw
 * an unanswered ask, which returns a slot spent this quarter. Each transition
 * is the caller's own click, on the caller's own row; another member's ask is
 * not found.
 *
 * Built on node:sqlite from the whole baseline plus every migration after its
 * cutoff, as introductions_ask_targets_6260.test.ts does. Every name is made up.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/introductions_ask_decisions_6261.test.ts
 */
import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import introductions from '../src/routes/introductions.ts';
import { ASK_STATUSES } from '../src/services/introAskDecisions.ts';
import { currentQuarterKey } from '../src/middleware/requireInvestorTier.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { splitStatements } from './_baseline.mjs';
import { compareMigrations } from '../../scripts/lib/migrationPlan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIGRATION = 'cloudflare-worker/sql/migrations/202611220356_6261_intro_ask_decisions.sql';

const IAN = 1;  // investor
const IVY = 2;  // another investor
const FAY = 3;  // founder, record 10, owns the venture SEEN
const GUS = 4;  // another founder
const DUO = 5;  // an investor account that is also a founder (record 20)
const ROLE: Record<number, string> = { [IAN]: 'investor', [IVY]: 'investor', [FAY]: 'founder', [GUS]: 'founder', [DUO]: 'investor' };
const SEEN = 100;
const Q = currentQuarterKey();

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

let db: InstanceType<typeof DatabaseSync>;
before(() => {
  db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const s of splitStatements(read('cloudflare-worker/sql/schema_baseline.sql'))) {
    try { db.exec(s); } catch { /* the baseline's two lp_investors triggers do not split; unrelated */ }
  }
  const dir = resolve(ROOT, 'cloudflare-worker/sql/migrations');
  for (const f of readdirSync(dir).filter((x) => /^\d+_.*\.sql$/.test(x) && Number(x.split('_')[0]) > 219).sort(compareMigrations)) {
    db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  const u = db.prepare(`INSERT INTO users (id, uid, email, role, name, display_name, founder_id, is_active) VALUES (?,?,?,?,?,?,?,?)`);
  u.run(IAN, 'ian', 'ian@example.test', 'investor', 'Ian Investor', null, null, 1);
  u.run(IVY, 'ivy', 'ivy@example.test', 'investor', 'Ivy Investor', null, null, 1);
  u.run(FAY, 'fay', 'fay@example.test', 'founder', 'Fay Legal', 'Fay Founder', 10, 1);
  u.run(GUS, 'gus', 'gus@example.test', 'founder', 'Gus Founder', null, 11, 1);
  u.run(DUO, 'duo', 'duo@example.test', 'investor', 'Duo Both', null, 20, 1);
  db.prepare(`INSERT INTO founders (id, name, email) VALUES (10, 'Fay', 'fay@example.test'), (11, 'Gus', 'gus@example.test'), (20, 'Duo', 'duo@example.test')`).run();
  db.prepare(`INSERT INTO projects (id, uid, name, founder_id, status, investor_findable, deleted_at) VALUES (?,?,?,?,?,?,?)`)
    .run(SEEN, 'seen', 'Seenventure', 10, 'active', null, null);
});
beforeEach(() => {
  db.exec(`DELETE FROM investor_introductions; DELETE FROM notifications_inbox;`);
  db.prepare(`UPDATE users SET investor_quota_intros_quarter = ?, investor_quota_intros_used = 0`).run(Q);
});

async function call(as: number, method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) {
  const a = new Hono<any>();
  a.route('/api/introductions', introductions);
  a.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const token = await new SignJWT({ user_id: as, role: ROLE[as], ...extra })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await a.request(`/api/introductions${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }, { DB: makeD1(db), JWT_SECRET } as any);
  const text = await res.text(); let out: any = {}; try { out = JSON.parse(text); } catch { out = { raw: text }; }
  return { status: res.status, body: out };
}
const used = (id: number) => Number((db.prepare(`SELECT investor_quota_intros_used AS n FROM users WHERE id = ?`).get(id) as any).n);
const row = (uid: string) => db.prepare(`SELECT status, recipient_user_id, decided_at, decided_by FROM investor_introductions WHERE uid = ?`).get(uid) as any;
const notices = (id: number) => db.prepare(`SELECT type, link FROM notifications_inbox WHERE user_id = ? ORDER BY id`).all(id).map((r: any) => ({ ...r })) as any[];
async function askFay(message = 'We back lab tools.') {
  const r = await call(IAN, 'POST', '/request', { founder_user_id: FAY, message });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.uid as string;
}

test('an ask records the founder who may answer it and tells them in app, once, after the click', async () => {
  const r = await call(IAN, 'POST', '/request', { founder_user_id: FAY });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.answerable, true);
  assert.equal(r.body.founder_notified, true);
  assert.equal(row(r.body.uid).recipient_user_id, FAY);
  assert.equal(row(r.body.uid).status, 'pending');
  assert.deepEqual(notices(FAY), [{ type: 'intro_ask', link: `/network/introductions?intro=${r.body.uid}&kind=ask` }]);
  assert.deepEqual(notices(IAN), []);
  // An ask to a venture is answered by its founder record's lowest user id.
  const p = await call(IAN, 'POST', '/request', { project_id: SEEN });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(row(p.body.uid).recipient_user_id, FAY);
});

test('an ask to one\'s own founder account is refused before any slot is spent', async () => {
  const r = await call(DUO, 'POST', '/request', { founder_user_id: DUO });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(r.body.error, 'cannot_ask_self');
  assert.equal(used(DUO), 0);
  assert.equal(Number((db.prepare(`SELECT COUNT(*) AS n FROM investor_introductions`).get() as any).n), 0);
});

test('the founder reads only the asks addressed to them, with the investor named', async () => {
  const uid = await askFay();
  const fay = await call(FAY, 'GET', '/asks/received');
  assert.equal(fay.status, 200);
  assert.equal(fay.body.asks.length, 1);
  assert.equal(fay.body.asks[0].uid, uid);
  assert.equal(fay.body.asks[0].investor_name, 'Ian Investor');
  assert.equal(fay.body.asks[0].message, 'We back lab tools.');
  assert.equal(fay.body.asks[0].status, 'pending');
  for (const other of [GUS, IVY, IAN]) assert.deepEqual((await call(other, 'GET', '/asks/received')).body.asks, [], String(other));
});

test('the founder accepts: the status, the time and the actor are written, the investor is told, and the NDA step opens', async () => {
  const uid = await askFay();
  const r = await call(FAY, 'POST', `/asks/received/${uid}/accept`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'accepted');
  const after = row(uid);
  assert.equal(after.status, 'accepted');
  assert.equal(after.decided_by, FAY);
  assert.ok(after.decided_at);
  assert.deepEqual(notices(IAN), [{ type: 'intro_ask_answered', link: `/network/introductions?intro=${uid}&kind=ask` }]);
  const mine = (await call(IAN, 'GET', '')).body.introductions.find((a: any) => a.uid === uid);
  assert.equal(mine.status, 'accepted');
  assert.equal(mine.nda_founder_user_id, FAY);
  assert.equal(mine.answerable, true);
  assert.ok(mine.decided_at);
  assert.equal('recipient_user_id' in mine, false);
  // An answered ask does not move again, and cannot be withdrawn; its slot stays spent.
  assert.equal((await call(FAY, 'POST', `/asks/received/${uid}/decline`)).status, 409);
  const w = await call(IAN, 'POST', `/asks/${uid}/withdraw`);
  assert.equal(w.status, 409);
  assert.equal(w.body.error, 'ask_already_answered');
  assert.equal(used(IAN), 1);
  assert.equal(row(uid).status, 'accepted');
});

test('the founder declines: the status moves to declined and no NDA step is offered', async () => {
  const uid = await askFay();
  const r = await call(FAY, 'POST', `/asks/received/${uid}/decline`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(row(uid).status, 'declined');
  assert.equal(row(uid).decided_by, FAY);
  const mine = (await call(IAN, 'GET', '')).body.introductions.find((a: any) => a.uid === uid);
  assert.equal(mine.status, 'declined');
  assert.equal(mine.nda_founder_user_id, null);
  // A pending ask's founder account id is not returned either.
  const p = (await call(IAN, 'GET', '')).body;
  assert.equal(JSON.stringify(p).includes('recipient_user_id'), false);
  assert.equal(used(IAN), 1);
});

test('another member cannot answer or withdraw an ask that is not theirs', async () => {
  const uid = await askFay();
  for (const [as, path] of [
    [GUS, `/asks/received/${uid}/accept`],   // another founder
    [GUS, `/asks/received/${uid}/decline`],
    [IAN, `/asks/received/${uid}/accept`],   // the investor is not the founder
    [IVY, `/asks/${uid}/withdraw`],          // another investor
    [FAY, `/asks/${uid}/withdraw`],          // the founder cannot withdraw it
  ] as const) {
    const r = await call(as, 'POST', path);
    assert.equal(r.status, 404, `${as} ${path}`);
    assert.equal(r.body.error, 'ask_not_found', `${as} ${path}`);
  }
  assert.equal(row(uid).status, 'pending');
  assert.equal(row(uid).decided_at, null);
  assert.equal(used(IAN), 1);
  assert.equal(used(IVY), 0);
  assert.deepEqual(notices(IAN), []);
  assert.equal((await call(FAY, 'POST', '/asks/received/not a uid/accept')).status, 404);
});

test('a support session cannot withdraw or answer for the member', async () => {
  const uid = await askFay();
  assert.equal((await call(IAN, 'POST', `/asks/${uid}/withdraw`, undefined, { impersonated_by: 9 })).status, 403);
  assert.equal((await call(FAY, 'POST', `/asks/received/${uid}/accept`, undefined, { impersonated_by: 9 })).status, 403);
  assert.equal(row(uid).status, 'pending');
  assert.equal(used(IAN), 1);
});

test('the investor withdraws an unanswered ask: it reads Withdrawn, the slot comes back, and the founder can no longer answer', async () => {
  const uid = await askFay();
  assert.equal(used(IAN), 1);
  const r = await call(IAN, 'POST', `/asks/${uid}/withdraw`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'withdrawn');
  assert.equal(r.body.slot_returned, true);
  assert.equal(r.body.used, 0);
  assert.equal(r.body.remaining, r.body.cap);
  assert.equal(used(IAN), 0);
  assert.equal(row(uid).status, 'withdrawn');
  assert.equal(row(uid).decided_by, IAN);
  const mine = (await call(IAN, 'GET', '')).body.introductions.find((a: any) => a.uid === uid);
  assert.equal(mine.status, 'withdrawn');
  const late = await call(FAY, 'POST', `/asks/received/${uid}/accept`);
  assert.equal(late.status, 409);
  assert.equal(row(uid).status, 'withdrawn');
  // A second withdraw returns nothing more.
  assert.equal((await call(IAN, 'POST', `/asks/${uid}/withdraw`)).status, 409);
  assert.equal(used(IAN), 0);
});

test('withdrawing an ask spent in an earlier quarter returns no slot', async () => {
  db.prepare(`INSERT INTO investor_introductions (uid, investor_user_id, founder_user_id, status, quarter, recipient_user_id)
              VALUES ('old-q', ?, ?, 'pending', '2001Q1', ?)`).run(IAN, FAY, FAY);
  db.prepare(`UPDATE users SET investor_quota_intros_used = 2 WHERE id = ?`).run(IAN);
  const r = await call(IAN, 'POST', '/asks/old-q/withdraw');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.slot_returned, false);
  assert.equal(used(IAN), 2);
  assert.equal(row('old-q').status, 'withdrawn');
});

test('every status a row reaches is one the route names', async () => {
  const a = await askFay(); await call(FAY, 'POST', `/asks/received/${a}/accept`);
  const b = await call(IAN, 'POST', '/request', { project_id: SEEN }); await call(FAY, 'POST', `/asks/received/${b.body.uid}/decline`);
  db.prepare(`UPDATE users SET investor_quota_intros_used = 0 WHERE id = ?`).run(IAN);
  const c = await askFay(); await call(IAN, 'POST', `/asks/${c}/withdraw`);
  await askFay();
  const seen = (db.prepare(`SELECT DISTINCT status FROM investor_introductions`).all() as any[]).map((r) => r.status).sort();
  assert.deepEqual(seen, [...ASK_STATUSES].sort());
});

test('the migration gives asks already recorded the founder who may answer them', async () => {
  const ins = db.prepare(`INSERT INTO investor_introductions (uid, investor_user_id, founder_user_id, founder_id, project_id, status, quarter)
                          VALUES (?, ?, ?, ?, ?, 'pending', '2026Q3')`);
  ins.run('legacy-person', IAN, GUS, null, null);
  ins.run('legacy-project', IAN, null, 11, SEEN);   // a venture wins over a founder record, as the Asked view reads it
  ins.run('legacy-record', IAN, null, 11, null);
  ins.run('legacy-nobody', IAN, null, null, 999);
  const update = read(MIGRATION).slice(read(MIGRATION).indexOf('UPDATE investor_introductions'));
  db.exec(update);
  assert.equal(row('legacy-person').recipient_user_id, GUS);
  assert.equal(row('legacy-project').recipient_user_id, FAY);
  assert.equal(row('legacy-record').recipient_user_id, GUS);
  assert.equal(row('legacy-nobody').recipient_user_id, null);
  // They keep their status, and no notice is sent for them.
  assert.equal(row('legacy-person').status, 'pending');
  assert.deepEqual(notices(GUS), []);
  // A legacy ask can now be answered by its founder.
  assert.equal((await call(GUS, 'POST', '/asks/received/legacy-record/accept')).status, 200);
  const nobody = (await call(IAN, 'GET', '')).body.introductions.find((a: any) => a.uid === 'legacy-nobody');
  assert.equal(nobody.answerable, false);
});
