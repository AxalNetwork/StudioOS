/**
 * D4682 (#4682) — Delivery transitions and invoicing hold under concurrent
 * requests, retries and partial failure.
 *
 * Every race is simulated the same way: `after(re, fn)` runs `fn` right after
 * the request's next read that matches `re`, standing in for another request
 * that completed between this request's read and its write. The batch shim is
 * transactional, as D1's is, so a failure inside a batch rolls it back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import partnerDelivery from '../src/routes/partner_delivery.ts';
import { engagementsRouter } from '../src/routes/needs.ts';
import { issueInvoice, nextInvoiceNumber } from '../src/services/engagementInvoices.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const OURS_USER = 60;
const OUR_STAFF = 61;
const THEIRS_USER = 62;
const THEIR_STAFF = 63;
const FOUNDER_USER = 64;
const ADMIN_USER = 65;
const OUR_ENGAGEMENT = 901;
const THEIR_ENGAGEMENT = 902;

let hook: { re: RegExp; fn: () => void } | null = null;
/** Run `fn` once, right after the next read whose SQL matches `re`. */
function after(re: RegExp, fn: () => void) { hook = { re, fn }; }
let failBatchAt: number | null = null;
let queue: Promise<unknown> = Promise.resolve();

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const fire = (sql: string) => {
    if (hook && hook.re.test(sql)) { const h = hook; hook = null; h.fn(); }
  };
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        sql,
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { const r = db.prepare(sql).get(...b) ?? null; fire(sql); return r; },
        async all() { const r = db.prepare(sql).all(...b); fire(sql); return { results: r }; },
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
        _bound: () => b,
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // D1's batch is one transaction: all of it, or none of it.
    // D1 runs one write transaction at a time, so batches queue.
    async batch(x: any[]) {
      const turn = queue.then(async () => {
        db.exec('BEGIN');
        try {
          const out = [];
          let i = 0;
          for (const st of x || []) {
            if (failBatchAt === i) { failBatchAt = null; throw new Error('simulated D1 failure'); }
            i++;
            out.push(await st.run());
          }
          db.exec('COMMIT');
          return out;
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      });
      queue = turn.then(() => undefined, () => undefined);
      return turn;
    },
  };
}

const migration = (name: string) => readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT
    );
    CREATE TABLE partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL, company TEXT, email TEXT UNIQUE NOT NULL,
      specialization TEXT, status TEXT NOT NULL DEFAULT 'active'
    );
    -- #4673: an engagement's founder_id is a FOUNDER PROFILE (founders.id), and the client's name is
    -- read from it. These fixtures keep the founder's id equal to the user's (FOUNDER_USER) on purpose;
    -- partner_delivery_report_access_4673.test.ts proves the two apart.
    CREATE TABLE founders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, name TEXT NOT NULL, email TEXT
    );
    CREATE TABLE founder_needs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      project_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      budget_min REAL, budget_max REAL, timeline TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, rfp_id INTEGER, partner_id INTEGER NOT NULL,
      price REAL NOT NULL, timeline_weeks INTEGER, deliverables TEXT NOT NULL,
      notes TEXT, status TEXT NOT NULL DEFAULT 'submitted', decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (need_id, partner_id)
    );
    CREATE TABLE engagements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
      need_id INTEGER NOT NULL, quote_id INTEGER NOT NULL UNIQUE,
      partner_id INTEGER NOT NULL, founder_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL, price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'accepted',
      delivered_at TEXT, delivery_notes TEXT, cancelled_at TEXT, cancel_reason TEXT,
      invoice_id TEXT, invoiced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, company_id INTEGER);`);
  db.exec(`ALTER TABLE partners ADD COLUMN company_id INTEGER;`);
  db.exec(migration('188_engagement_invoices'));
  db.exec(migration('208_partner_delivery_stores'));
  db.exec(migration('202611072115_delivery_revisions'));
  // APPLIED, NOT MIRRORED. The two capacity stores are read by `/capacity` and
  // written by its two `PUT`s, so the harness runs their migration files for
  // the same reason it runs 208's: a hand-copied DDL that drifts from the file
  // makes every assertion below true of a schema production does not have.
  db.exec(`CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, user_id INTEGER,
    action TEXT NOT NULL, details TEXT, actor TEXT)`);

  const u = db.prepare('INSERT INTO users (id, role, partner_id, name, email) VALUES (?,?,?,?,?)');
  u.run(OURS_USER, 'partner', 1, 'Ours', 'ours@example.com');
  u.run(OUR_STAFF, 'partner', 1, 'Sam', 'sam@example.com');
  u.run(THEIRS_USER, 'partner', 2, 'Theirs', 'theirs@example.com');
  u.run(THEIR_STAFF, 'partner', 2, 'Robin', 'robin@example.com');
  u.run(FOUNDER_USER, 'founder', null, 'Fran', 'fran@example.com');
  u.run(ADMIN_USER, 'admin', null, 'Root', 'root@example.com');
  db.prepare('INSERT INTO founders (id, name, email) VALUES (?, ?, ?)').run(FOUNDER_USER, 'Fran', 'fran@example.com');

  const p = db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (?,?,?,?)');
  p.run(1, 'p-1', 'Ours', 'ours@example.com');
  p.run(2, 'p-2', 'Theirs', 'theirs@example.com');

  const n = db.prepare(
    'INSERT INTO founder_needs (id, uid, project_id, founder_id, category, title, description) VALUES (?,?,?,?,?,?,?)');
  n.run(501, 'need-1', 9, FOUNDER_USER, 'engineering', 'Payments migration', 'x');
  n.run(502, 'need-2', 9, FOUNDER_USER, 'design', 'Brand refresh', 'y');

  const e = db.prepare(
    `INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
     VALUES (?,?,?,?,?,?,?,?)`);
  e.run(OUR_ENGAGEMENT, 'e-ours', 501, 601, 1, FOUNDER_USER, 9, 42000);
  e.run(THEIR_ENGAGEMENT, 'e-theirs', 502, 602, 2, FOUNDER_USER, 9, 15000);

  return db;
}

function env(db: InstanceType<typeof DatabaseSync>) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function callOn(
  router: any, e: any, method: string, path: string, who: { user: number; role: string }, body?: any,
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  const res = await router.request(path, init, e, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const call = (e: any, m: string, p: string, w: any, b?: any) => callOn(partnerDelivery, e, m, p, w, b);
const callEng = (e: any, m: string, p: string, w: any, b?: any) => callOn(engagementsRouter, e, m, p, w, b);

const ours = { user: OURS_USER, role: 'partner' };
const staff = { user: OUR_STAFF, role: 'partner' };
const admin = { user: ADMIN_USER, role: 'admin' };

function nowPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const row = (db: any, table: string, id: number) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as any;
const logs = (db: any) => db.prepare('SELECT user_id, action, details FROM activity_logs ORDER BY id').all() as any[];

// ── Milestones, blockers, deliverables ─────────────────────────────────────

test('a stale milestone edit cannot reopen a completed milestone', async () => {
  const db = freshDb(); const e = env(db);
  const m = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, { title: 'Launch' })).body;
  after(/FROM engagement_milestones m/, () =>
    db.prepare("UPDATE engagement_milestones SET completed_at = '2026-11-01T00:00:00Z', revision = revision + 1 WHERE id = ?").run(m.id));
  const r = await call(e, 'PATCH', `/milestones/${m.id}`, ours, { completed_at: null });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'delivery_changed');
  assert.equal(row(db, 'engagement_milestones', m.id).completed_at, '2026-11-01T00:00:00Z');
});

test('a stale edit to ANOTHER field keeps the field it never sent, from the current row', async () => {
  const db = freshDb(); const e = env(db);
  const m = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, { title: 'Launch', due_at: '2026-12-01' })).body;
  after(/FROM engagement_milestones m/, () =>
    db.prepare("UPDATE engagement_milestones SET completed_at = '2026-11-01T00:00:00Z', revision = revision + 1 WHERE id = ?").run(m.id));
  const r = await call(e, 'PATCH', `/milestones/${m.id}`, ours, { title: 'Launch v2' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after_ = row(db, 'engagement_milestones', m.id);
  assert.equal(after_.title, 'Launch v2');
  assert.equal(after_.completed_at, '2026-11-01T00:00:00Z', 'the completion that landed first survives');
  assert.equal(after_.due_at, '2026-12-01');
});

test('expected_revision: a stale one is refused, a current one is applied and bumps the revision', async () => {
  const db = freshDb(); const e = env(db);
  const m = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, { title: 'A' })).body;
  assert.equal(m.revision, 0);
  const ok = await call(e, 'PATCH', `/milestones/${m.id}`, ours, { title: 'B', expected_revision: 0 });
  assert.equal(ok.status, 200); assert.equal(ok.body.revision, 1);
  const stale = await call(e, 'PATCH', `/milestones/${m.id}`, ours, { title: 'C', expected_revision: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, 1, 'the conflict says what the current revision is');
  assert.equal(row(db, 'engagement_milestones', m.id).title, 'B');
});

test('a milestone delete that read an older revision deletes nothing', async () => {
  const db = freshDb(); const e = env(db);
  const m = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, { title: 'A' })).body;
  after(/FROM engagement_milestones m/, () =>
    db.prepare('UPDATE engagement_milestones SET revision = revision + 1 WHERE id = ?').run(m.id));
  const r = await call(e, 'DELETE', `/milestones/${m.id}`, ours);
  assert.equal(r.status, 409);
  assert.ok(row(db, 'engagement_milestones', m.id));
});

test('a stale blocker edit cannot reopen a cleared blocker', async () => {
  const db = freshDb(); const e = env(db);
  const b = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/blockers`, ours, { summary: 'Keys', side: 'client' })).body;
  after(/FROM engagement_blockers b/, () =>
    db.prepare("UPDATE engagement_blockers SET cleared_at = '2026-11-02T00:00:00Z', revision = revision + 1 WHERE id = ?").run(b.id));
  const r = await call(e, 'PATCH', `/blockers/${b.id}`, ours, { cleared_at: null });
  assert.equal(r.status, 409);
  assert.equal(row(db, 'engagement_blockers', b.id).cleared_at, '2026-11-02T00:00:00Z');
});

test('a stale deliverable edit does not unsend a deliverable that was sent meanwhile', async () => {
  const db = freshDb(); const e = env(db);
  const d = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: 'Spec' })).body;
  after(/FROM engagement_deliverables d/, () =>
    db.prepare("UPDATE engagement_deliverables SET sent_at = '2026-11-03T00:00:00Z', sent_by = 60, revision = revision + 1 WHERE id = ?").run(d.id));
  const r = await call(e, 'PATCH', `/deliverables/${d.id}`, ours, { title: 'Spec v2' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const out = row(db, 'engagement_deliverables', d.id);
  assert.equal(out.title, 'Spec v2');
  assert.equal(out.sent_at, '2026-11-03T00:00:00Z');
  assert.equal(out.sent_by, 60);
});

// ── Seats ──────────────────────────────────────────────────────────────────

test('a stale seat edit cannot rewrite a seat revoked meanwhile', async () => {
  const db = freshDb(); const e = env(db);
  const s = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, { holder_user_id: OUR_STAFF, scope: 'read' })).body;
  after(/FROM engagement_seats s/, () =>
    db.prepare("UPDATE engagement_seats SET revoked_at = '2026-11-04T00:00:00Z', revision = revision + 1 WHERE id = ?").run(s.id));
  const r = await call(e, 'PATCH', `/seats/${s.id}`, ours, { scope: 'write' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  const out = row(db, 'engagement_seats', s.id);
  assert.equal(out.scope, 'read');
  assert.equal(out.revoked_at, '2026-11-04T00:00:00Z');
});

test('a second revoke does not move revoked_at, and the database refuses to edit a revoked seat', async () => {
  const db = freshDb(); const e = env(db);
  const s = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, { holder_user_id: OUR_STAFF, scope: 'read' })).body;
  const first = await call(e, 'POST', `/seats/${s.id}/revoke`, ours);
  assert.equal(first.status, 200);
  const at = row(db, 'engagement_seats', s.id).revoked_at;
  assert.equal((await call(e, 'POST', `/seats/${s.id}/revoke`, ours)).status, 400);
  assert.equal(row(db, 'engagement_seats', s.id).revoked_at, at);
  assert.throws(() => db.prepare("UPDATE engagement_seats SET scope = 'x' WHERE id = ?").run(s.id), /seat_revoked/);
  assert.throws(() => db.prepare('UPDATE engagement_seats SET revoked_at = NULL WHERE id = ?').run(s.id), /seat_revoked/);
});

test('a revoke racing a revoke leaves the first one’s time', async () => {
  const db = freshDb(); const e = env(db);
  const s = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/seats`, ours, { holder_user_id: OUR_STAFF })).body;
  after(/FROM engagement_seats s/, () =>
    db.prepare("UPDATE engagement_seats SET revoked_at = '2026-11-05T00:00:00Z', revision = revision + 1 WHERE id = ?").run(s.id));
  const r = await call(e, 'POST', `/seats/${s.id}/revoke`, ours);
  assert.equal(r.status, 400);
  assert.equal(row(db, 'engagement_seats', s.id).revoked_at, '2026-11-05T00:00:00Z');
});

// ── Status reports ─────────────────────────────────────────────────────────

async function draftReport(e: any, shipped = 'Spec v2 went out.') {
  const p = nowPeriod();
  const saved = await call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours,
    { engagement_id: OUR_ENGAGEMENT, period: p, shipped });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return { p, id: saved.body.id as number };
}
const put = (e: any, p: string, shipped: string) =>
  call(e, 'PUT', `/engagements/${OUR_ENGAGEMENT}/status-reports/${p}`, ours,
    { engagement_id: OUR_ENGAGEMENT, period: p, shipped });

test('a stale edit cannot change a report another request finalized', async () => {
  const db = freshDb(); const e = env(db);
  const { p, id } = await draftReport(e);
  after(/SELECT \* FROM engagement_status_reports WHERE engagement_id = \? AND period = \?/, () =>
    db.prepare("UPDATE engagement_status_reports SET state = 'sent', sent_at = '2026-11-06T00:00:00Z', sent_by = 60, sent_revision = revision + 1, revision = revision + 1 WHERE id = ?").run(id));
  const r = await put(e, p, 'Rewritten after it was sent');
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'report_sent');
  assert.equal(row(db, 'engagement_status_reports', id).shipped, 'Spec v2 went out.');
});

test('a stale edit cannot delete a report another request finalized', async () => {
  const db = freshDb(); const e = env(db);
  const { id } = await draftReport(e);
  after(/FROM engagement_status_reports r/, () =>
    db.prepare("UPDATE engagement_status_reports SET state = 'sent', sent_at = 'x', sent_by = 60, sent_revision = revision + 1, revision = revision + 1 WHERE id = ?").run(id));
  const r = await call(e, 'DELETE', `/status-reports/${id}`, ours);
  assert.equal(r.status, 409);
  assert.ok(row(db, 'engagement_status_reports', id), 'the sent report is still there');
});

test('the database refuses to rewrite or delete a sent report whatever code asks', async () => {
  const db = freshDb(); const e = env(db);
  const { id } = await draftReport(e);
  assert.equal((await call(e, 'POST', `/status-reports/${id}/send`, ours)).status, 200);
  assert.throws(() => db.prepare("UPDATE engagement_status_reports SET shipped = 'x' WHERE id = ?").run(id), /status_report_sent/);
  assert.throws(() => db.prepare('UPDATE engagement_status_reports SET sent_by = 99 WHERE id = ?').run(id), /status_report_sent/);
  assert.throws(() => db.prepare('DELETE FROM engagement_status_reports WHERE id = ?').run(id), /status_report_sent/);
});

test('an edit that lands between the send’s read and its write stops the send', async () => {
  const db = freshDb(); const e = env(db);
  const { id } = await draftReport(e);
  after(/FROM engagement_status_reports r/, () =>
    db.prepare("UPDATE engagement_status_reports SET shipped = 'Edited after the check', revision = revision + 1 WHERE id = ?").run(id));
  const r = await call(e, 'POST', `/status-reports/${id}/send`, ours);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(row(db, 'engagement_status_reports', id).state, 'draft', 'nothing was sent');
});

test('the revision that is sent is recorded, and is the one the client received', async () => {
  const db = freshDb(); const e = env(db);
  const { p, id } = await draftReport(e);
  await put(e, p, 'Second draft');
  const before = row(db, 'engagement_status_reports', id);
  const sent = await call(e, 'POST', `/status-reports/${id}/send`, ours, { expected_revision: before.revision });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const out = row(db, 'engagement_status_reports', id);
  assert.equal(out.sent_revision, out.revision);
  assert.equal(out.sent_revision, before.revision + 1);
  assert.equal(out.shipped, 'Second draft');
});

test('a send naming a stale revision is refused', async () => {
  const db = freshDb(); const e = env(db);
  const { p, id } = await draftReport(e);
  await put(e, p, 'Edited');
  const r = await call(e, 'POST', `/status-reports/${id}/send`, ours, { expected_revision: 0 });
  assert.equal(r.status, 409);
  assert.equal(row(db, 'engagement_status_reports', id).state, 'draft');
});

test('a duplicate send has one outcome: the same person gets the record, another is refused; the sender never changes', async () => {
  const db = freshDb(); const e = env(db);
  const { id } = await draftReport(e);
  const first = await call(e, 'POST', `/status-reports/${id}/send`, ours);
  assert.equal(first.status, 200);
  const sentAt = first.body.sent_at;
  const again = await call(e, 'POST', `/status-reports/${id}/send`, ours);
  assert.equal(again.status, 200); assert.equal(again.body.already_sent, true);
  assert.equal(again.body.sent_at, sentAt);
  const other = await call(e, 'POST', `/status-reports/${id}/send`, staff);
  assert.equal(other.status, 409); assert.equal(other.body.code, 'already_sent');
  const out = row(db, 'engagement_status_reports', id);
  assert.equal(out.sent_by, OURS_USER); assert.equal(out.sent_at, sentAt);
});

test('two sends racing: the one that lost does not replace the sender', async () => {
  const db = freshDb(); const e = env(db);
  const { id } = await draftReport(e);
  after(/FROM engagement_status_reports r/, () =>
    db.prepare("UPDATE engagement_status_reports SET state = 'sent', sent_at = '2026-11-06T09:00:00Z', sent_by = ?, sent_revision = revision + 1, revision = revision + 1 WHERE id = ?").run(OUR_STAFF, id));
  const r = await call(e, 'POST', `/status-reports/${id}/send`, ours);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  const out = row(db, 'engagement_status_reports', id);
  assert.equal(out.sent_by, OUR_STAFF); assert.equal(out.sent_at, '2026-11-06T09:00:00Z');
});

// ── Invoice numbers and issuing ────────────────────────────────────────────

const issueFor = (e: any, engagementId: number, uid: string) => issueInvoice(e, {
  engagementId, partnerUserId: OURS_USER, founderUserId: FOUNDER_USER,
  billFromName: 'Ours', billToName: 'Fran', priceDollars: 100, deliverables: 'Work',
}, uid, '2026-11-07T10:00:00.000Z');
const markDelivered = (db: any, id: number) =>
  db.prepare("UPDATE engagements SET status = 'delivered' WHERE id = ?").run(id);
const seq = (db: any) => (db.prepare("SELECT last_value FROM invoice_number_seq WHERE year = '2026'").get() as any)?.last_value ?? 0;

test('concurrent invoices for different engagements never share a number', async () => {
  const db = freshDb(); const e = env(db);
  markDelivered(db, OUR_ENGAGEMENT); markDelivered(db, THEIR_ENGAGEMENT);
  const [a, b] = await Promise.all([issueFor(e, OUR_ENGAGEMENT, 'i-a'), issueFor(e, THEIR_ENGAGEMENT, 'i-b')]);
  assert.notEqual(a.invoice.invoice_number, b.invoice.invoice_number);
  assert.deepEqual([a.invoice.invoice_number, b.invoice.invoice_number].sort(), ['AX-2026-0001', 'AX-2026-0002']);
});

test('nextInvoiceNumber hands every concurrent caller its own number', async () => {
  const db = freshDb(); const e = env(db);
  const nums = await Promise.all(Array.from({ length: 12 }, () => nextInvoiceNumber(e as any, new Date('2026-11-07'))));
  assert.equal(new Set(nums).size, 12);
});

test('the same engagement issued twice (a retry, a double click) is one invoice and one number', async () => {
  const db = freshDb(); const e = env(db);
  markDelivered(db, OUR_ENGAGEMENT);
  const [a, b] = await Promise.all([issueFor(e, OUR_ENGAGEMENT, 'i-1'), issueFor(e, OUR_ENGAGEMENT, 'i-2')]);
  assert.equal(a.invoice.invoice_number, b.invoice.invoice_number);
  assert.equal([a.created, b.created].filter(Boolean).length, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM engagement_invoices').get() as any).n, 1);
  assert.equal(seq(db), 1, 'the loser reserved no number');
});

test('a request that loses the race for one engagement burns no number for the next', async () => {
  const db = freshDb(); const e = env(db);
  markDelivered(db, OUR_ENGAGEMENT); markDelivered(db, THEIR_ENGAGEMENT);
  await issueFor(e, OUR_ENGAGEMENT, 'i-1');
  await issueFor(e, OUR_ENGAGEMENT, 'i-2');
  const next = await issueFor(e, THEIR_ENGAGEMENT, 'i-3');
  assert.equal(next.invoice.invoice_number, 'AX-2026-0002', 'no gap');
});

test('an engagement that is not invoiceable gets no invoice and reserves no number', async () => {
  const db = freshDb(); const e = env(db);
  const r = await issueFor(e, OUR_ENGAGEMENT, 'i-1');   // still 'accepted'
  assert.equal(r.invoice, null);
  assert.equal(seq(db), 0);
});

test('a failure inside the batch leaves no invoice, no number used and an engagement that does not claim one; the retry issues exactly one', async () => {
  const db = freshDb(); const e = env(db);
  markDelivered(db, OUR_ENGAGEMENT);
  failBatchAt = 2;   // after the number and the invoice, before the engagement is marked
  await assert.rejects(() => issueFor(e, OUR_ENGAGEMENT, 'i-1'), /simulated D1 failure/);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM engagement_invoices').get() as any).n, 0);
  assert.equal(seq(db), 0, 'the number rolled back with the rest');
  const eng = row(db, 'engagements', OUR_ENGAGEMENT);
  assert.equal(eng.status, 'delivered'); assert.equal(eng.invoice_id, null);
  const retry = await issueFor(e, OUR_ENGAGEMENT, 'i-2');
  assert.equal(retry.created, true);
  assert.equal(retry.invoice.invoice_number, 'AX-2026-0001');
  assert.equal(row(db, 'engagements', OUR_ENGAGEMENT).invoice_id, 'AX-2026-0001');
});

test('POST /invoice marks the engagement invoiced with the real number, and a retry is a 200 that issues nothing', async () => {
  const db = freshDb(); const e = env(db);
  markDelivered(db, OUR_ENGAGEMENT);
  const one = await callEng(e, 'POST', `/${OUR_ENGAGEMENT}/invoice`, ours);
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(one.body.status, 'invoiced');
  assert.equal(one.body.invoice_id, 'AX-2026-0001');
  const two = await callEng(e, 'POST', `/${OUR_ENGAGEMENT}/invoice`, ours);
  assert.equal(two.status, 200, JSON.stringify(two.body));
  assert.equal(two.body.already_invoiced, true);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM engagement_invoices').get() as any).n, 1);
  assert.equal(seq(db), 1);
});

test('two POST /invoice at once for the same engagement: one invoice', async () => {
  const db = freshDb(); const e = env(db);
  markDelivered(db, OUR_ENGAGEMENT);
  const rs = await Promise.all([
    callEng(e, 'POST', `/${OUR_ENGAGEMENT}/invoice`, ours),
    callEng(e, 'POST', `/${OUR_ENGAGEMENT}/invoice`, ours),
  ]);
  assert.deepEqual(rs.map((r) => r.status), [200, 200], JSON.stringify(rs.map((r) => r.body)));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM engagement_invoices').get() as any).n, 1);
  assert.equal(row(db, 'engagements', OUR_ENGAGEMENT).invoice_id, 'AX-2026-0001');
});

test('an engagement left delivered by an older partial failure, with its invoice already written, is reconciled with no second document', async () => {
  const db = freshDb(); const e = env(db);
  markDelivered(db, OUR_ENGAGEMENT);
  await issueFor(e, OUR_ENGAGEMENT, 'i-1');
  // Undo only the engagement half, as the old two-step write could leave it.
  db.prepare("UPDATE engagements SET status = 'delivered', invoice_id = NULL, invoiced_at = NULL WHERE id = ?").run(OUR_ENGAGEMENT);
  const r = await callEng(e, 'POST', `/${OUR_ENGAGEMENT}/invoice`, ours);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'invoiced'); assert.equal(r.body.invoice_id, 'AX-2026-0001');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM engagement_invoices').get() as any).n, 1);
  assert.equal(seq(db), 1);
});

// ── Engagement lifecycle ───────────────────────────────────────────────────

test('a cancel racing a deliver: the transition that completed first stands, and the other says so', async () => {
  const db = freshDb(); const e = env(db);
  after(/SELECT \* FROM engagements WHERE id = \?/, () =>
    db.prepare("UPDATE engagements SET status = 'cancelled', cancelled_at = 'x' WHERE id = ?").run(OUR_ENGAGEMENT));
  const r = await callEng(e, 'POST', `/${OUR_ENGAGEMENT}/deliver`, ours);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'engagement_changed');
  assert.equal(row(db, 'engagements', OUR_ENGAGEMENT).status, 'cancelled');
  assert.equal(row(db, 'engagements', OUR_ENGAGEMENT).delivered_at, null);
});

test('an invoice request for an engagement cancelled meanwhile issues nothing', async () => {
  const db = freshDb(); const e = env(db);
  markDelivered(db, OUR_ENGAGEMENT);
  after(/SELECT price, deliverables FROM quotes/, () =>
    db.prepare("UPDATE engagements SET status = 'cancelled' WHERE id = ?").run(OUR_ENGAGEMENT));
  const r = await callEng(e, 'POST', `/${OUR_ENGAGEMENT}/invoice`, ours);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM engagement_invoices').get() as any).n, 0);
  assert.equal(seq(db), 0);
});

// ── Actor and audit ────────────────────────────────────────────────────────

test('a write on another party’s record records the actor: an admin’s transition says so', async () => {
  const db = freshDb(); const e = env(db);
  const r = await callEng(e, 'POST', `/${OUR_ENGAGEMENT}/start`, admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const l = logs(db).find((x) => x.action === 'engagement_start')!;
  assert.equal(l.user_id, ADMIN_USER);
  assert.equal(JSON.parse(l.details).acting_as_admin, true);
  const own = await callEng(e, 'POST', `/${OUR_ENGAGEMENT}/deliver`, ours);
  assert.equal(own.status, 200);
  const l2 = logs(db).find((x) => x.action === 'engagement_deliver')!;
  assert.equal(JSON.parse(l2.details).acting_as_admin, false);
});

test('milestone, deliverable and report writes record their actor', async () => {
  const db = freshDb(); const e = env(db);
  const m = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/milestones`, ours, { title: 'A' })).body;
  await call(e, 'PATCH', `/milestones/${m.id}`, ours, { title: 'B' });
  await call(e, 'DELETE', `/milestones/${m.id}`, ours);
  const d = (await call(e, 'POST', `/engagements/${OUR_ENGAGEMENT}/deliverables`, ours, { title: 'D' })).body;
  await call(e, 'PATCH', `/deliverables/${d.id}`, ours, { title: 'D2' });
  await call(e, 'DELETE', `/deliverables/${d.id}`, ours);
  const { id } = await draftReport(e);
  await call(e, 'POST', `/status-reports/${id}/send`, ours);
  const actions = logs(db).map((x) => x.action);
  for (const a of ['delivery_milestone_added', 'delivery_milestone_edited', 'delivery_milestone_deleted',
    'delivery_deliverable_edited', 'delivery_deliverable_deleted', 'delivery_report_saved', 'delivery_report_sent']) {
    assert.ok(actions.includes(a), `no log line for ${a}`);
  }
  for (const x of logs(db)) assert.equal(x.user_id, OURS_USER);
});
