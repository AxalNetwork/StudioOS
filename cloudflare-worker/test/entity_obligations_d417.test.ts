/**
 * D417 — F2's obligation store (migration 374), the routes that write it
 * (routes/legal_entities.ts) and the line it feeds (HQ · Funds), on node:sqlite.
 *
 *   1. THE MIGRATION. One new table and its index, no transaction; its CHECKs
 *      refuse an unknown kind, a blank title, and a resolved row with no date.
 *   2. THE RULES. `nextDue` clamps to the month's end; `packObligations` takes
 *      the US packs from compliance.ts and skips a formation-dated rule when no
 *      formation date is recorded, rather than dating it from today.
 *   3. THE ROUTES. Staff read, admin write. Entering validates and refuses a
 *      duplicate; seeding is idempotent; filing a recurring obligation opens the
 *      next one and links it; waiving needs a reason; nothing resolves twice.
 *   4. THE LINE IT FEEDS. The registry carries each fund's earliest open
 *      deadline across its GP and vehicle entities — kind and date only — and
 *      reports the store unreadable as unknown, never as none.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/entity_obligations_d417.test.ts
 */
import test, { beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import legalEntities from '../src/routes/legal_entities.ts';
import { readFundsRegistry } from '../src/rpc/branchOps.ts';
import { nextDue, packObligations, isoDate, daysUntil } from '../src/services/entityObligations.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION = read('cloudflare-worker/sql/migrations/374_entity_obligations.sql');

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const ADMIN = 1;
const PARTNER = 2;
const FOUNDER = 3;
const ROLE: Record<number, string> = { [ADMIN]: 'admin', [PARTNER]: 'partner', [FOUNDER]: 'founder' };

// ONE CLOCK PER TEST, HELD STILL (#1342). The routes read `new Date()` on every
// request, so "today" here must come from that same clock at the moment it is
// used, never from a constant fixed when the file loaded: a run that crossed
// midnight UTC between loading and a later test was off by one day (`days_left`
// 19 for 20). Each test freezes the JS clock at the real instant it starts, so
// the fixture's dates and the route's `today()` agree even if midnight passes
// mid-test. Only `Date` is mocked; timers and SQLite's own clock are untouched.
beforeEach(() => mock.timers.enable({ apis: ['Date'], now: Date.now() }));
afterEach(() => mock.timers.reset());
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.parse(`${today()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

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
  for (const t of ['users', 'entities', 'vc_funds', 'fund_report_periods', 'limited_partners', 'capital_calls',
    'fund_distributions', 'activity_logs']) {
    db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  }
  db.exec(read('cloudflare-worker/sql/migrations/312_fund_call_ledger.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/314_fabric_entities.sql'));
  db.exec(MIGRATION);
  const u = db.prepare('INSERT INTO users (id, email, role, name) VALUES (?,?,?,?)');
  u.run(ADMIN, 'ada@axal.example', 'admin', 'Ada Admin');
  u.run(PARTNER, 'pia@axal.example', 'partner', 'Pia Partner');
  u.run(FOUNDER, 'fay@axal.example', 'founder', 'Fay Founder');
  db.prepare(`INSERT INTO vc_funds (id, name, status, gp_entity, fund_size_cents) VALUES (?,?,?,?,?)`)
    .run(10, 'Harbor Fund I', 'investing', 'Harbor GP LLC', 500_000_000);
  db.prepare(`INSERT INTO entities (id, name, entity_type, jurisdiction, fabric_role) VALUES (?,?,?,?,?)`)
    .run(2, 'Harbor GP LLC', 'subsidiary', 'US-DE', 'gp_entity');
  db.prepare(`INSERT INTO entities (id, name, entity_type, jurisdiction, fabric_role) VALUES (?,?,?,?,?)`)
    .run(3, 'Harbor Fund I LP', 'vc_fund', 'US-DE', 'fund_vehicle');
  return db;
}

async function jwt(userId: number, role: string) {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
async function call(db: InstanceType<typeof DatabaseSync>, as: number, method: string, path: string, payload?: unknown, d1: any = makeD1(db)) {
  const app = new Hono<any>();
  app.route('/api/legal', legalEntities);
  app.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const res = await app.request(`/api/legal${path}`, {
    method,
    headers: { Authorization: `Bearer ${await jwt(as, ROLE[as])}`, 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  }, { DB: d1, JWT_SECRET } as any);
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* the status says it */ }
  return { status: res.status, body, text };
}
const audits = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare(`SELECT action, details, user_id FROM activity_logs WHERE action LIKE 'legal.entity.obligation%' ORDER BY id`).all() as any[];
const count = (db: InstanceType<typeof DatabaseSync>, where = '1') =>
  (db.prepare(`SELECT COUNT(*) AS n FROM entity_obligations WHERE ${where}`).get() as any).n;

/* ------------------------------------------------------------------ *
 * 1 · the migration                                                   *
 * ------------------------------------------------------------------ */

test('D417: migration 374 stands alone — one new table and its index, no ALTER, no transaction, no tenant', () => {
  const sql = MIGRATION.replace(/^\s*--.*$/gm, '');
  assert.ok(!/\bBEGIN\b|\bCOMMIT\b|DROP |\bRENAME\b|ALTER TABLE/i.test(sql));
  assert.deepEqual([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]), ['entity_obligations']);
  assert.deepEqual([...sql.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)/g)].map((m) => m[1]), ['idx_entity_obligations_due']);
  assert.deepEqual([...sql.matchAll(/CREATE UNIQUE INDEX IF NOT EXISTS (\w+)/g)].map((m) => m[1]), ['idx_entity_obligations_undated_open']);
  assert.ok(!/\btenant\b/i.test(sql));
});

test('D417: the CHECKs refuse an unknown kind, a blank title, a bad date, and a resolution with no date', () => {
  const db = freshDb();
  const ins = (uid: string, kind: string, title: string, due: string | null, status = 'open', resolvedOn: string | null = null) =>
    db.prepare(`INSERT INTO entity_obligations (uid, entity_id, kind, title, cadence, due_date, status, resolved_on)
                VALUES (?, 2, ?, ?, 'annual', ?, ?, ?)`).run(uid, kind, title, due, status, resolvedOn);
  ins('ok', 'franchise_tax', 'Delaware LLC annual tax', '2027-06-01');
  assert.throws(() => ins('a', 'state_tax', 'X', '2027-06-01'), /CHECK/);
  assert.throws(() => ins('b', 'other', '   ', '2027-06-01'), /CHECK/);
  assert.throws(() => ins('c', 'other', 'X', '1 June 2027'), /CHECK/);
  assert.throws(() => ins('d', 'other', 'X', '2027-06-01', 'filed', null), /CHECK/);
  assert.throws(() => ins('e', 'other', 'X', '2027-06-01', 'open', '2027-05-01'), /CHECK/);
  assert.throws(() => ins('f', 'franchise_tax', 'Delaware LLC annual tax', '2027-06-01'), /UNIQUE/);
});

/* ------------------------------------------------------------------ *
 * 2 · the rules                                                       *
 * ------------------------------------------------------------------ */

test('D417: nextDue steps by the cadence and clamps to the month\'s end; a one-off has no next', () => {
  assert.equal(nextDue('2027-06-01', 'annual'), '2028-06-01');
  assert.equal(nextDue('2027-01-31', 'monthly'), '2027-02-28');
  assert.equal(nextDue('2028-01-31', 'monthly'), '2028-02-29');
  assert.equal(nextDue('2027-11-30', 'quarterly'), '2028-02-29');
  assert.equal(nextDue('2028-02-29', 'annual'), '2029-02-28');
  assert.equal(nextDue('2027-06-01', 'one_time'), null);
  assert.equal(nextDue('2027-06-01', 'event'), null);
  assert.equal(isoDate('2027-02-30'), null);
  assert.equal(daysUntil('2027-06-01', '2027-06-04'), -3);
});

test('D417: a US pack is compliance.ts\'s ruleset; a formation-dated rule is skipped without a formation date', () => {
  const none = packObligations('us_de_llc', '2027-07-01', null);
  assert.deepEqual(none.rows.map((r) => [r.kind, r.due_date, r.cadence]), [['franchise_tax', '2028-06-01', 'annual']],
    'a fixed date already past this year takes next year\'s');
  assert.deepEqual(none.skipped.map((s) => s.title), ['Registered agent renewal']);
  assert.match(none.skipped[0].reason, /formation date, which is not recorded/);

  const dated = packObligations('us_de_llc', '2027-05-01', '2024-03-10');
  assert.deepEqual(dated.rows.map((r) => [r.kind, r.due_date]),
    [['franchise_tax', '2027-06-01'], ['registered_agent', '2028-03-10']]);
  assert.equal(dated.skipped.length, 0);
  assert.ok(dated.rows.every((r) => r.pack_key.startsWith('us_de_llc:')));
  assert.equal(packObligations('us_de_ccorp', '2027-05-01', null).rows.length, 2);
});

/* ------------------------------------------------------------------ *
 * 3 · the routes                                                      *
 * ------------------------------------------------------------------ */

test('D417: staff read the calendar; every write is admin-only, and a partner moves nothing', async () => {
  const db = freshDb();
  for (const [path, payload] of [
    ['/entities/2/obligations', { kind: 'franchise_tax', title: 'Delaware LLC annual tax', cadence: 'annual', due_date: plusDays(30) }],
    ['/entities/2/obligations/pack', { pack: 'us_de_llc' }],
  ] as const) {
    const r = await call(db, PARTNER, 'POST', path, payload);
    assert.equal(r.status, 403, r.text);
    assert.equal(r.body.error, 'admin_only');
  }
  assert.equal(count(db), 0);
  assert.equal((await call(db, PARTNER, 'GET', '/entities/2/obligations')).status, 200);
  assert.equal((await call(db, FOUNDER, 'GET', '/entities/2/obligations')).status, 403);
  assert.equal((await call(db, ADMIN, 'GET', '/entities/99/obligations')).body.error, 'entity_not_found');
});

test('D417: entering one validates, refuses a duplicate, and is recorded', async () => {
  const db = freshDb();
  const bad = [
    [{ kind: 'state_tax', title: 'X', cadence: 'annual', due_date: plusDays(5) }, 'kind_invalid'],
    [{ kind: 'other', title: '  ', cadence: 'annual', due_date: plusDays(5) }, 'title_required'],
    [{ kind: 'other', title: 'X', cadence: 'yearly', due_date: plusDays(5) }, 'cadence_invalid'],
    [{ kind: 'other', title: 'X', cadence: 'annual', due_date: '2027-02-30' }, 'date_invalid'],
    [{ kind: 'other', title: 'X', cadence: 'annual' }, 'due_date_required'],
  ] as const;
  for (const [payload, code] of bad) {
    const r = await call(db, ADMIN, 'POST', '/entities/2/obligations', payload);
    assert.equal(r.status, 400, r.text);
    assert.equal(r.body.error, code);
  }
  assert.equal(count(db), 0);
  const ev = await call(db, ADMIN, 'POST', '/entities/2/obligations', { kind: 'regulatory_filing', title: 'Form D amendment', cadence: 'event' });
  assert.equal(ev.status, 201, 'an event-driven obligation may have no date');
  assert.equal(ev.body.obligation.days_left, null);

  const due = plusDays(12);
  const ok = await call(db, ADMIN, 'POST', '/entities/2/obligations', { kind: 'franchise_tax', title: ' Delaware LLC annual tax ', cadence: 'annual', due_date: due });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.body.obligation.title, 'Delaware LLC annual tax');
  assert.equal(ok.body.obligation.days_left, 12);
  assert.equal(ok.body.obligation.source, 'manual');
  const dup = await call(db, ADMIN, 'POST', '/entities/2/obligations', { kind: 'franchise_tax', title: 'Delaware LLC annual tax', cadence: 'annual', due_date: due });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'already_recorded');
  assert.deepEqual(audits(db).map((a) => [a.action, a.user_id]),
    [['legal.entity.obligation_added', ADMIN], ['legal.entity.obligation_added', ADMIN]]);
  assert.equal(JSON.parse(audits(db)[1].details).obligation_uid, ok.body.obligation.uid);
});

test('D417: an undated obligation is open once; once filed, the same event can be entered again', async () => {
  const db = freshDb();
  const ev = { kind: 'regulatory_filing', title: 'Form D amendment', cadence: 'event' };
  const first = await call(db, ADMIN, 'POST', '/entities/2/obligations', ev);
  assert.equal(first.status, 201, first.text);
  const dup = await call(db, ADMIN, 'POST', '/entities/2/obligations', ev);
  assert.equal(dup.status, 409, 'SQLite counts each NULL due_date as distinct');
  assert.equal(dup.body.error, 'already_recorded');
  assert.equal(count(db), 1);
  const filed = await call(db, ADMIN, 'POST', `/entities/2/obligations/${first.body.obligation.uid}/file`, {});
  assert.equal(filed.body.next, null, 'an event has no next date to open');
  const again = await call(db, ADMIN, 'POST', '/entities/2/obligations', ev);
  assert.equal(again.status, 201, again.text);
  assert.equal(count(db), 2);
});

test('D417: seeding a pack refuses an unknown one, skips what needs a formation date, and is idempotent', async () => {
  const db = freshDb();
  const unknown = await call(db, ADMIN, 'POST', '/entities/2/obligations/pack', { pack: 'uk_ltd' });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'pack_unknown', 'a non-US pack is F9\'s, not a second ruleset here');

  const first = await call(db, ADMIN, 'POST', '/entities/2/obligations/pack', { pack: 'us_de_llc' });
  assert.equal(first.status, 200, first.text);
  assert.deepEqual([first.body.added, first.body.already_on_calendar], [1, 0]);
  assert.deepEqual(first.body.skipped.map((s: any) => s.title), ['Registered agent renewal']);

  db.prepare(`UPDATE entities SET incorporation_date = '2024-03-10 00:00:00' WHERE id = 2`).run();
  const again = await call(db, ADMIN, 'POST', '/entities/2/obligations/pack', { pack: 'us_de_llc' });
  assert.deepEqual([again.body.added, again.body.already_on_calendar, again.body.skipped.length], [1, 1, 0]);
  assert.equal(count(db, `source = 'pack'`), 2);
  assert.equal(count(db, `kind = 'registered_agent' AND due_date >= '${today()}'`), 1, 'a renewal dated before today');
});

test('D417: filing a recurring obligation opens the next and links it; a one-off opens none; nothing files twice', async () => {
  const db = freshDb();
  const due = plusDays(-3);
  const made = await call(db, ADMIN, 'POST', '/entities/2/obligations', { kind: 'franchise_tax', title: 'Delaware LLC annual tax', cadence: 'annual', due_date: due });
  const uid = made.body.obligation.uid;
  assert.equal(made.body.obligation.days_left, -3);

  const bad = await call(db, ADMIN, 'POST', `/entities/2/obligations/${uid}/file`, { on: 'yesterday' });
  assert.equal(bad.body.error, 'date_invalid');
  const filed = await call(db, ADMIN, 'POST', `/entities/2/obligations/${uid}/file`, { note: 'Paid online' });
  assert.equal(filed.status, 200, filed.text);
  assert.equal(filed.body.obligation.status, 'filed');
  assert.equal(filed.body.obligation.resolved_on, today());
  assert.equal(filed.body.next.due_date, nextDue(due, 'annual'));
  assert.equal(filed.body.next.status, 'open');
  assert.equal(filed.body.obligation.next_uid, filed.body.next.uid);
  assert.equal(count(db), 2);

  const twice = await call(db, ADMIN, 'POST', `/entities/2/obligations/${uid}/file`, {});
  assert.equal(twice.status, 409);
  assert.equal(twice.body.error, 'already_resolved');
  assert.equal(count(db), 2);
  assert.equal((await call(db, ADMIN, 'POST', `/entities/3/obligations/${uid}/file`, {})).body.error, 'obligation_not_found',
    'an obligation is resolved through its own entity only');

  const once = await call(db, ADMIN, 'POST', '/entities/2/obligations', { kind: 'other', title: 'Initial filing', cadence: 'one_time', due_date: plusDays(1) });
  const f2 = await call(db, ADMIN, 'POST', `/entities/2/obligations/${once.body.obligation.uid}/file`, { on: plusDays(-1) });
  assert.equal(f2.body.next, null);
  assert.equal(f2.body.obligation.resolved_on, plusDays(-1));
  assert.equal(count(db), 3);
  const filedAudit = audits(db).find((a) => a.action === 'legal.entity.obligation_filed');
  assert.equal(JSON.parse(filedAudit.details).next_uid, filed.body.next.uid);
});

test('D417: filing when the next occurrence is already on the calendar links to that one, not to nothing', async () => {
  const db = freshDb();
  const due = plusDays(10);
  const a = await call(db, ADMIN, 'POST', '/entities/2/obligations', { kind: 'franchise_tax', title: 'Delaware LLC annual tax', cadence: 'annual', due_date: due });
  const b = await call(db, ADMIN, 'POST', '/entities/2/obligations', { kind: 'franchise_tax', title: 'Delaware LLC annual tax', cadence: 'annual', due_date: nextDue(due, 'annual') });
  const filed = await call(db, ADMIN, 'POST', `/entities/2/obligations/${a.body.obligation.uid}/file`, {});
  assert.equal(filed.status, 200, filed.text);
  assert.equal(count(db), 2, 'a second copy of next year was opened');
  assert.equal(filed.body.next.uid, b.body.obligation.uid);
  const stored = db.prepare('SELECT next_uid FROM entity_obligations WHERE uid = ?').get(a.body.obligation.uid) as any;
  assert.equal(stored.next_uid, b.body.obligation.uid);
  const filedAudit = audits(db).find((x) => x.action === 'legal.entity.obligation_filed');
  assert.equal(JSON.parse(filedAudit.details).next_uid, b.body.obligation.uid, 'the log names a uid no row has');
});

test('D417: a filing that loses a race to another is refused and opens no next occurrence', async () => {
  const db = freshDb();
  const made = await call(db, ADMIN, 'POST', '/entities/2/obligations', { kind: 'franchise_tax', title: 'Delaware LLC annual tax', cadence: 'annual', due_date: plusDays(10) });
  const uid = made.body.obligation.uid;
  // Another admin waives it between this request's read and its write.
  const racing = makeD1(db);
  const batch = racing.batch;
  racing.batch = async (x: any[]) => {
    db.prepare(`UPDATE entity_obligations SET status = 'waived', resolved_on = ?, resolution_note = 'Waived by the other admin' WHERE uid = ?`)
      .run(today(), uid);
    return batch(x);
  };
  const r = await call(db, ADMIN, 'POST', `/entities/2/obligations/${uid}/file`, {}, racing);
  assert.equal(r.status, 409, r.text);
  assert.equal(r.body.error, 'already_resolved');
  assert.equal(count(db), 1, 'the losing request opened next year');
  const row = db.prepare('SELECT status, next_uid FROM entity_obligations WHERE uid = ?').get(uid) as any;
  assert.deepEqual({ ...row }, { status: 'waived', next_uid: null });
  assert.equal(audits(db).filter((a) => a.action === 'legal.entity.obligation_filed').length, 0);
});

test('D417: waiving needs a reason, keeps it, and opens no next occurrence', async () => {
  const db = freshDb();
  const made = await call(db, ADMIN, 'POST', '/entities/2/obligations', { kind: 'board_meeting', title: 'Quarterly board meeting', cadence: 'quarterly', due_date: plusDays(4) });
  const uid = made.body.obligation.uid;
  const short = await call(db, ADMIN, 'POST', `/entities/2/obligations/${uid}/waive`, { note: 'n/a' });
  assert.equal(short.status, 400);
  assert.equal(short.body.error, 'reason_required');
  const w = await call(db, ADMIN, 'POST', `/entities/2/obligations/${uid}/waive`, { note: 'Entity dissolved this quarter' });
  assert.equal(w.status, 200, w.text);
  assert.equal(w.body.obligation.status, 'waived');
  assert.equal(w.body.obligation.resolution_note, 'Entity dissolved this quarter');
  assert.equal(w.body.next, null);
  assert.equal(count(db), 1);
  assert.equal(audits(db).at(-1).action, 'legal.entity.obligation_waived');

  const list = await call(db, PARTNER, 'GET', '/entities/2/obligations');
  assert.equal(list.body.as_of, today());
  assert.equal(list.body.obligations[0].days_left, null, 'a resolved row has no days left');
});

test('D417: the calendar lists open ones soonest first, then the resolved history', async () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO entity_obligations (uid, entity_id, kind, title, cadence, due_date, status, resolved_on)
                          VALUES (?, 2, 'other', ?, 'annual', ?, ?, ?)`);
  ins.run('late', 'Later', plusDays(40), 'open', null);
  ins.run('done', 'Done', plusDays(-20), 'filed', plusDays(-21));
  ins.run('soon', 'Sooner', plusDays(2), 'open', null);
  ins.run('undated', 'Undated', null, 'open', null);
  const r = await call(db, PARTNER, 'GET', '/entities/2/obligations');
  assert.deepEqual(r.body.obligations.map((o: any) => o.uid), ['soon', 'late', 'undated', 'done']);
  assert.deepEqual(r.body.obligations.map((o: any) => o.days_left), [2, 40, null, null]);
});

/* ------------------------------------------------------------------ *
 * 4 · the line it feeds                                               *
 * ------------------------------------------------------------------ */

test('D417: the registry carries each fund\'s earliest open deadline across GP and vehicle — kind and date only', async () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO entity_obligations (uid, entity_id, kind, title, cadence, due_date, status, resolved_on, note)
                          VALUES (?, ?, ?, ?, 'annual', ?, ?, ?, ?)`);
  ins.run('gp1', 2, 'franchise_tax', 'Delaware LLC annual tax', plusDays(20), 'open', null, 'Synthetic note text');
  ins.run('v1', 3, 'regulatory_filing', 'Form ADV update', plusDays(8), 'open', null, null);
  ins.run('v0', 3, 'annual_report', 'Earlier but filed', plusDays(-5), 'filed', plusDays(-6), null);

  let r: any = await readFundsRegistry({ DB: makeD1(db) } as any);
  assert.equal(r.obligations_available, true);
  assert.equal(r.funds[0].next_obligation, null, 'an unlinked fund was given its entities\' deadline');

  db.prepare('UPDATE vc_funds SET gp_entity_id = 2 WHERE id = 10').run();
  r = await readFundsRegistry({ DB: makeD1(db) } as any);
  assert.deepEqual(r.funds[0].next_obligation, { kind: 'franchise_tax', due_date: plusDays(20), days_left: 20 });

  db.prepare('UPDATE vc_funds SET vehicle_entity_id = 3 WHERE id = 10').run();
  r = await readFundsRegistry({ DB: makeD1(db) } as any);
  assert.deepEqual(r.funds[0].next_obligation, { kind: 'regulatory_filing', due_date: plusDays(8), days_left: 8 },
    'the vehicle\'s sooner deadline, and not the filed one before it');

  const text = JSON.stringify(r);
  for (const leak of ['Delaware LLC annual tax', 'Form ADV update', 'Synthetic note', 'Harbor Fund I LP', 'v1', 'gp1']) {
    assert.ok(!text.includes(leak), `the registry carries ${leak}`);
  }
});

test('D417: the store unreadable leaves each deadline absent — unknown, not none — and the rest stands', async () => {
  const db = freshDb();
  db.exec('DROP TABLE entity_obligations');
  const r: any = await readFundsRegistry({ DB: makeD1(db) } as any);
  assert.equal(r.obligations_available, false);
  assert.match(r.obligations_reason, /unknown rather than none/);
  assert.ok(!('next_obligation' in r.funds[0]));
  assert.equal(r.entities_available, true, 'the entities read was taken down with it');
});
