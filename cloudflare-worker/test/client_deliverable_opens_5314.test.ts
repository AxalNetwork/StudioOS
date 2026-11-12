/**
 * #5314 part 1 (D4822) — the client's first open of a shared deliverable.
 *
 * `opened_at` is the client's to set (migration 208:160). The client route
 * records it once, when the engagement's client founder opens the shared link;
 * the firm's Deliverables log then reads "Never opened" only where an open
 * could have been recorded, and "Not recorded" — never 0 — everywhere else.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import clientDeliverables from '../src/routes/client_deliverables.ts';
import partnerDelivery from '../src/routes/partner_delivery.ts';
import { openObservable, readStateFor, readTrackingFor } from '../src/routes/_partner_workspace_helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const migration = (name: string) => readFileSync(`${SQL}/migrations/${name}.sql`, 'utf8');

const PARTNER_USER = 60;
const CLIENT_USER = 64;
const OTHER_FOUNDER_USER = 66;
// A founder PROFILE id deliberately different from the user id (#4673).
const CLIENT_FOUNDER = 7001;
const OTHER_FOUNDER = 7002;
const ENG = 901;

function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const coerce = (a: any[]) => a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
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
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}

function freshDb({ instrumented = true }: { instrumented?: boolean } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, partner_id INTEGER, founder_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, name TEXT, email TEXT);
    CREATE TABLE partners (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, company TEXT, email TEXT, specialization TEXT,
      status TEXT NOT NULL DEFAULT 'active', company_id INTEGER);
    CREATE TABLE founders (id INTEGER PRIMARY KEY, uid TEXT, name TEXT NOT NULL, email TEXT);
    CREATE TABLE founder_needs (id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, founder_id INTEGER, category TEXT,
      title TEXT, description TEXT, status TEXT);
    CREATE TABLE engagements (id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, need_id INTEGER, quote_id INTEGER,
      partner_id INTEGER NOT NULL, founder_id INTEGER NOT NULL, project_id INTEGER, price REAL,
      status TEXT NOT NULL DEFAULT 'accepted', delivered_at TEXT, cancelled_at TEXT, company_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, user_id INTEGER,
      action TEXT NOT NULL, details TEXT, actor TEXT);
  `);
  db.exec(migration('208_partner_delivery_stores'));
  db.exec(migration('202611072115_delivery_revisions'));
  if (instrumented) db.exec(migration('202611110731_5314_deliverable_client_opens'));

  const u = db.prepare('INSERT INTO users (id, role, partner_id, founder_id, name, email) VALUES (?,?,?,?,?,?)');
  u.run(PARTNER_USER, 'partner', 1, null, 'Ours', 'ours@example.com');
  u.run(CLIENT_USER, 'founder', null, CLIENT_FOUNDER, 'Fran', 'fran@example.com');
  u.run(OTHER_FOUNDER_USER, 'founder', null, OTHER_FOUNDER, 'Olu', 'olu@example.com');
  db.prepare('INSERT INTO partners (id, uid, name, email) VALUES (1, ?, ?, ?)').run('p-1', 'Ours', 'ours@example.com');
  db.prepare('INSERT INTO founders (id, name) VALUES (?, ?)').run(CLIENT_FOUNDER, 'Fran');
  db.prepare('INSERT INTO founders (id, name) VALUES (?, ?)').run(OTHER_FOUNDER, 'Olu');
  db.prepare(`INSERT INTO engagements (id, uid, need_id, quote_id, partner_id, founder_id, project_id, price)
    VALUES (?, 'e-1', 501, 601, 1, ?, 9, 1000)`).run(ENG, CLIENT_FOUNDER);
  return db;
}

function env(db: InstanceType<typeof DatabaseSync>) {
  return { JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) };
}

async function call(router: any, e: any, method: string, path: string, user: number, role: string, body?: any) {
  const token = await new SignJWT({ user_id: user, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; (init as any).body = JSON.stringify(body); }
  const res = await router.request(path, init, e, { waitUntil() {}, passThroughOnException() {} } as any);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const sentNow = () => new Date().toISOString();
function addDeliverable(db: any, uid: string, opts: { sent_at?: string | null; link_url?: string | null; version?: string } = {}) {
  const r = db.prepare(`INSERT INTO engagement_deliverables (uid, engagement_id, title, version, link_url, sent_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(uid, ENG, `Item ${uid}`, opts.version ?? '1',
    opts.link_url === undefined ? 'https://example.com/doc' : opts.link_url,
    opts.sent_at === undefined ? sentNow() : opts.sent_at);
  return Number(r.lastInsertRowid);
}
const row = (db: any, id: number) => db.prepare('SELECT * FROM engagement_deliverables WHERE id = ?').get(id) as any;

test('the client\'s first open is recorded once, against the version it was shown', async () => {
  const db = freshDb(); const e = env(db);
  const id = addDeliverable(db, 'd-1', { version: '2' });
  const first = await call(clientDeliverables, e, 'POST', '/d-1/open', CLIENT_USER, 'founder');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.first_open, true);
  assert.equal(first.body.link_url, 'https://example.com/doc');
  const opened = row(db, id);
  assert.ok(opened.opened_at, 'the first open was not recorded');
  assert.equal(opened.opened_by, CLIENT_USER);
  assert.equal(opened.opened_version, '2');
  assert.equal(opened.opened_revision, 0);

  // The firm edits it after the open; the client opens again.
  db.prepare("UPDATE engagement_deliverables SET version = '3', revision = revision + 1 WHERE id = ?").run(id);
  const second = await call(clientDeliverables, e, 'POST', '/d-1/open', CLIENT_USER, 'founder');
  assert.equal(second.status, 200);
  assert.equal(second.body.first_open, false, 'a second open was counted as the first');
  const kept = row(db, id);
  assert.equal(kept.opened_at, opened.opened_at, 'a later open rewrote the first');
  assert.equal(kept.opened_version, '2');
  assert.equal(second.body.changed_since_open, true);
  const acts = db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'delivery_deliverable_opened'").get() as any;
  assert.equal(acts.n, 1, 'the open was logged more than once');
});

test('the migration\'s trigger refuses a rewrite of a recorded open, whatever code runs', () => {
  const db = freshDb();
  const id = addDeliverable(db, 'd-t');
  db.prepare("UPDATE engagement_deliverables SET opened_at = '2026-11-11T00:00:00Z' WHERE id = ?").run(id);
  assert.throws(() => db.prepare("UPDATE engagement_deliverables SET opened_at = '2026-12-01T00:00:00Z' WHERE id = ?").run(id),
    /deliverable_open_recorded/);
});

test('only the engagement\'s client can open it, and nobody else learns it exists', async () => {
  const db = freshDb(); const e = env(db);
  const id = addDeliverable(db, 'd-2');
  const draft = addDeliverable(db, 'd-draft', { sent_at: null });
  for (const [user, role] of [[OTHER_FOUNDER_USER, 'founder'], [PARTNER_USER, 'partner']] as const) {
    const r = await call(clientDeliverables, e, 'POST', '/d-2/open', user, role);
    assert.equal(r.status, 404, `${role} ${user} reached the client's open`);
  }
  // A draft is the firm's work in progress: not listed, not openable.
  const d = await call(clientDeliverables, e, 'POST', '/d-draft/open', CLIENT_USER, 'founder');
  assert.equal(d.status, 404);
  assert.equal(row(db, id).opened_at, null);
  assert.equal(row(db, draft).opened_at, null);
  const list = await call(clientDeliverables, e, 'GET', `/engagements/${ENG}`, CLIENT_USER, 'founder');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items.map((x: any) => x.uid), ['d-2']);
  const other = await call(clientDeliverables, e, 'GET', `/engagements/${ENG}`, OTHER_FOUNDER_USER, 'founder');
  assert.equal(other.status, 404);
});

test('a deliverable with no link records no open', async () => {
  const db = freshDb(); const e = env(db);
  const id = addDeliverable(db, 'd-3', { link_url: null });
  const r = await call(clientDeliverables, e, 'POST', '/d-3/open', CLIENT_USER, 'founder');
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'no_link');
  assert.equal(row(db, id).opened_at, null);
});

test('the firm\'s log: Never opened only where an open could be recorded, Not recorded elsewhere', async () => {
  const db = freshDb(); const e = env(db);
  addDeliverable(db, 'd-new');                                         // sent after opens began, with a link
  addDeliverable(db, 'd-old', { sent_at: '2026-01-05T00:00:00Z' });    // sent before opens were recorded
  addDeliverable(db, 'd-nolink', { link_url: null });                  // nothing for the client to open
  addDeliverable(db, 'd-opened');
  await call(clientDeliverables, e, 'POST', '/d-opened/open', CLIENT_USER, 'founder');

  const r = await call(partnerDelivery, e, 'GET', '/deliverables', PARTNER_USER, 'partner');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.items.map((x: any) => [x.uid, x]));
  assert.equal(by['d-new'].read_state, 'unopened');
  assert.equal(by['d-new'].is_unopened, true);
  assert.equal(by['d-old'].read_state, 'not_recorded');
  assert.equal(by['d-old'].is_unopened, null, 'a deliverable sent before opens were recorded is called unopened');
  assert.equal(by['d-nolink'].read_state, 'not_recorded');
  assert.equal(by['d-opened'].read_state, 'opened');
  assert.equal(by['d-opened'].opened_current, true);
  assert.equal(r.body.unopened_count, 1);
  assert.equal(r.body.not_recorded_count, 2);
  assert.equal(r.body.median_days_to_open, null, 'a median was taken from one open');
  assert.match(r.body.median_days_to_open_note, /^Not recorded yet: 1 client open recorded/);
});

test('without the instrument the figure stays Not recorded, never 0', async () => {
  const db = freshDb({ instrumented: false }); const e = env(db);
  addDeliverable(db, 'd-x');
  const r = await call(partnerDelivery, e, 'GET', '/deliverables', PARTNER_USER, 'partner');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.unopened_count, null);
  assert.equal(r.body.read_tracking.available, false);
  assert.equal(r.body.items[0].read_state, 'not_recorded');
});

test('openObservable: a sent row with a link from the moment opens began', () => {
  const t = readTrackingFor([], undefined, '2026-11-11T07:31:00.000Z');
  assert.equal(openObservable({ sent_at: '2026-11-12', link_url: 'https://x' }, t), true);
  assert.equal(openObservable({ sent_at: '2026-11-10', link_url: 'https://x' }, t), false);
  assert.equal(openObservable({ sent_at: '2026-11-12', link_url: null }, t), false);
  assert.equal(readStateFor({ sent_at: '2026-11-12', link_url: null }, t), 'not_recorded');
  // Inferred availability (no `since`) keeps the #4690 rule.
  assert.equal(readStateFor({ sent_at: '2026-11-12' }, readTrackingFor([{ opened_at: '2026-11-01' }])), 'unopened');
});
