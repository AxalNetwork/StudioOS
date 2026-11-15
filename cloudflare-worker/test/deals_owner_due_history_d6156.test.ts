/**
 * D6156 (#6156) — Deals v2 owner, due date and history.
 *
 * Migration 202611140938_6156 adds `owner_user_id`, `owner_label` and
 * `due_date` to `deal_closing_checklist_items`, `owner_user_id` and
 * `owner_label` to `ic_conditions`, and the append-only
 * `deal_closing_checklist_events`. This file proves the issue's acceptance:
 *
 *   · rows written before the migration read owner and due as null, never a
 *     default (the screen shows Not recorded);
 *   · only role partner plus canMoveRound (D4631) sets owner, due date or
 *     state, and a refused write records nothing;
 *   · each write adds exactly one event, in the same batch as the write, and
 *     the event carries the owner and due date as they stand after it
 *     (owner decision, 2026-11-14);
 *   · reverting an item keeps the earlier event, and events refuse UPDATE and
 *     DELETE;
 *   · the events read refuses anyone who cannot read the deal;
 *   · an IC condition's create and reads carry its owner.
 *
 * The schema is the real one: migrations 334 and 335 and this one are applied
 * from their files over a minimal base, with rows seeded between 335 and this
 * migration so "existing rows" are rows the new columns never saw. The D1
 * stub's batch runs its statements in one SQLite transaction, as D1 does.
 * Every value below is invented.
 *
 * Mutation checked (each broke a test here, then was restored):
 *   1. dropping the event INSERT from the PATCH batch — "each write adds exactly one event" fails;
 *   2. dropping owner_user_id/owner_label/due_date from the checklist read — "existing rows read null" and the add-item test fail;
 *   3. removing the canMoveRound check from PATCH — "only whoever may move the round" fails;
 *   4. replacing loadDealForRead with requireAuth in the events read — "the events read refuses" fails;
 *   5. adding DEFAULT 'Founder' to owner_label in the migration — "existing rows read null" fails;
 *   6. writing the item and its event as two separate statements instead of one batch — "same batch" fails;
 *   7. removing the BEFORE UPDATE trigger from the migration — "reverting keeps the earlier event" fails;
 *   8. ignoring owner_user_id/owner_label in the IC condition create — "an IC condition carries its owner" fails;
 *   9. dropping owner_user_id/owner_label from the PATCH event insert (stored NULL) — "an owner-only edit … records the new owner" fails;
 *  10. dropping due_date from the PATCH event insert (stored NULL) — "a due-only edit … records the new due date" fails;
 *  11. dropping the owner/due columns from the add-item event insert — the add-item test fails;
 *  12. dropping owner_name from the events read — the owner-only edit test fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import deals from '../src/routes/deals.ts';
import ic from '../src/routes/ic.ts';

const app = new Hono();
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  if (msg === 'Forbidden') return c.json({ detail: msg }, 403);
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  return c.json({ detail: 'Internal server error' }, 500);
});
app.route('/api/deals', deals);
app.route('/api/ic', ic);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIG = (f: string) => readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations', f), 'utf8');
const THIS_MIGRATION = '202611140938_6156_deals_v2_owner_due_history.sql';

const PARTNER = 20;
const ADMIN = 19;
const INVESTOR = 42;
const OUTSIDER = 43;
const OWNER = 44;
const PROJ = 7;
const DEAL = 71;   // led by PARTNER
const DEAL_B = 72; // no lead: only an admin moves it
const DEC = 'dec-fixture';

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
        runSync() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
        async run() { return api.runSync(); },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // As D1: the statements run in order inside one transaction, all or none.
    async batch(stmts: any[]) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/** The base tables, 334 and 335, rows that predate this migration, then this migration. */
function freshDb(opts: { beforeMigration?: (db: InstanceType<typeof DatabaseSync>) => void } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT, email TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, founder_id INTEGER,
      investor_seat_primary_user_id INTEGER, investor_tier TEXT,
      investor_subscription_status TEXT, subscription_tier TEXT, partner_id INTEGER
    );
    CREATE TABLE projects (id INTEGER PRIMARY KEY, uid TEXT, name TEXT, sector TEXT, stage TEXT,
      status TEXT, founder_id INTEGER, company_id INTEGER, deleted_at TEXT);
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, partner_id INTEGER,
      status TEXT NOT NULL DEFAULT 'applied', notes TEXT, amount REAL,
      target_raise REAL, capital_committed REAL DEFAULT 0, lead_partner_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE deal_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL,
      investor_user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'invited',
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE commitments (id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL,
      investor_user_id INTEGER NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE ic_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      project_id INTEGER, deal_id INTEGER, title TEXT NOT NULL, memo TEXT,
      terms_json TEXT, status TEXT NOT NULL DEFAULT 'draft', decision TEXT,
      outcome TEXT, created_by INTEGER, decided_at TEXT, dd_case_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      company_id INTEGER
    );
    CREATE TABLE ic_votes (id INTEGER PRIMARY KEY AUTOINCREMENT, ic_decision_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, vote TEXT NOT NULL, rationale TEXT, created_at TEXT);
    CREATE TABLE ic_meetings (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, agenda TEXT, start_at TEXT NOT NULL, deal_id INTEGER,
      organizer_user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled');
    CREATE TABLE user_company_links (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL, is_primary_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT);
    CREATE TABLE company_profiles (id INTEGER PRIMARY KEY, company_name TEXT);
    CREATE TABLE legal_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT,
      plan TEXT, period_end TEXT, stripe_customer_id TEXT);
  `);
  db.exec(MIG('334_ic_conditions_and_minutes.sql'));
  db.exec(MIG('335_deal_transfers_and_closing_checklists.sql'));
  const u = db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)');
  u.run(PARTNER, 'partner', 'Pat Fixture');
  u.run(ADMIN, 'admin', 'Ada Fixture');
  u.run(INVESTOR, 'investor', 'Ivo Fixture');
  u.run(OUTSIDER, 'investor', 'Oda Fixture');
  u.run(OWNER, 'partner', 'Ola Fixture');
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(PROJ, 'Fixture Venture');
  db.prepare(`INSERT INTO deals (id, uid, project_id, status, lead_partner_id) VALUES (?, 'd-one', ?, 'funded', ?)`).run(DEAL, PROJ, PARTNER);
  db.prepare(`INSERT INTO deals (id, uid, project_id, status) VALUES (?, 'd-two', ?, 'funded')`).run(DEAL_B, PROJ);
  db.prepare('INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (?, ?)').run(DEAL, INVESTOR);
  db.prepare(`INSERT INTO legal_templates (slug, title) VALUES ('safe', 'SAFE'), ('spa', 'SPA'), ('subscription', 'Subscription')`).run();
  db.prepare(`INSERT INTO ic_decisions (uid, project_id, deal_id, title, status, created_by) VALUES (?, ?, ?, 'Fixture review', 'voting', ?)`)
    .run(DEC, PROJ, DEAL, ADMIN);
  opts.beforeMigration?.(db);
  db.exec(MIG(THIS_MIGRATION));
  return db;
}

/** A checklist on `dealId` with one pending item, written before the migration. */
function seedOldChecklist(db: InstanceType<typeof DatabaseSync>, dealId = DEAL) {
  db.prepare(`INSERT INTO deal_closing_checklists (uid, deal_id, template_slug, applied_by) VALUES (?, ?, 'safe', ?)`)
    .run(`cl-${dealId}`, dealId, ADMIN);
  db.prepare(`INSERT INTO deal_closing_checklist_items (uid, checklist_id, label, sort)
              VALUES (?, (SELECT id FROM deal_closing_checklists WHERE deal_id = ?), 'Fixture consent', 1)`)
    .run(`it-${dealId}`, dealId);
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

type Who = { user: number; role: string };
const partner = { user: PARTNER, role: 'partner' };
const admin = { user: ADMIN, role: 'admin' };
const investor = { user: INVESTOR, role: 'investor' };
const outsider = { user: OUTSIDER, role: 'investor' };

async function call(who: Who, path: string, db: InstanceType<typeof DatabaseSync>, init: { method?: string; body?: any } = {}) {
  const res = await app.request(path, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${await token(who.user, who.role)}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env(db));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const n = (db: InstanceType<typeof DatabaseSync>, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n as number;
const patch = (who: Who, dealId: number, itemUid: string, db: any, body: any) =>
  call(who, `/api/deals/${dealId}/closing-checklist/items/${itemUid}`, db, { method: 'PATCH', body });

test('existing rows read owner and due as null, never a default', async () => {
  const db = freshDb({
    beforeMigration: (d) => {
      seedOldChecklist(d);
      d.prepare(`INSERT INTO ic_conditions (uid, ic_decision_id, body, created_by)
                 VALUES ('cond-old', (SELECT id FROM ic_decisions WHERE uid = ?), 'Fixture condition', ?)`).run(DEC, ADMIN);
    },
  });
  const list = await call(partner, `/api/deals/${DEAL}/closing-checklist`, db);
  assert.equal(list.status, 200);
  const item = list.body.checklist.items[0];
  for (const k of ['owner_user_id', 'owner_name', 'owner_label', 'due_date']) {
    assert.ok(k in item, `the read returns ${k}`);
    assert.equal(item[k], null, `${k} reads null on a row that predates the migration`);
  }
  const events = await call(partner, `/api/deals/${DEAL}/closing-checklist/events`, db);
  assert.deepEqual(events.body.events, [], 'history before the migration was never recorded, and none is invented');

  const conds = await call(admin, '/api/ic/conditions', db);
  assert.equal(conds.status, 200);
  assert.equal(conds.body.items[0].owner_user_id, null);
  assert.equal(conds.body.items[0].owner_label, null);
  const detail = await call(admin, `/api/ic/${DEC}`, db);
  assert.equal(detail.body.conditions[0].owner_user_id, null);
  assert.equal(detail.body.conditions[0].owner_label, null);
});

test('an item is added with owner, due date and note, and its creation is the first event', async () => {
  const db = freshDb({ beforeMigration: (d) => seedOldChecklist(d) });
  const r = await call(partner, `/api/deals/${DEAL}/closing-checklist/items`, db, {
    method: 'POST', body: { label: 'Fixture certificate', owner_user_id: OWNER, owner_label: 'Founder', due_date: '2026-12-01', note: 'from counsel' },
  });
  assert.equal(r.status, 201);
  const item = r.body.checklist.items.find((i: any) => i.label === 'Fixture certificate');
  assert.equal(item.owner_user_id, OWNER);
  assert.equal(item.owner_name, 'Ola Fixture');
  assert.equal(item.owner_label, 'Founder');
  assert.equal(item.due_date, '2026-12-01');
  assert.equal(item.note, 'from counsel');
  const ev = await call(partner, `/api/deals/${DEAL}/closing-checklist/events`, db);
  assert.equal(ev.body.events.length, 1);
  const e0 = ev.body.events[0];
  assert.deepEqual(
    { from: e0.from_state, to: e0.to_state, actor: e0.actor_user_id, note: e0.note, item: e0.item_uid,
      owner: e0.owner_user_id, owner_name: e0.owner_name, label: e0.owner_label, due: e0.due_date },
    { from: null, to: 'pending', actor: PARTNER, note: 'from counsel', item: item.uid,
      owner: OWNER, owner_name: 'Ola Fixture', label: 'Founder', due: '2026-12-01' },
  );
});

test('the item and its event are written in the same batch: no event, no item', async () => {
  const db = freshDb({ beforeMigration: (d) => seedOldChecklist(d) });
  // Make the event INSERT fail inside the batch.
  db.exec(`CREATE TRIGGER fixture_fail_event BEFORE INSERT ON deal_closing_checklist_events
           BEGIN SELECT RAISE(ABORT, 'fixture_event_failure'); END;`);
  const before = n(db, 'deal_closing_checklist_items');
  const r = await call(partner, `/api/deals/${DEAL}/closing-checklist/items`, db, { method: 'POST', body: { label: 'Fixture item' } });
  assert.equal(r.status, 500);
  assert.equal(n(db, 'deal_closing_checklist_items'), before, 'the item was rolled back with its event');
  const p = await patch(partner, DEAL, `it-${DEAL}`, db, { state: 'done' });
  assert.equal(p.status, 500);
  assert.equal((db.prepare('SELECT state FROM deal_closing_checklist_items WHERE uid = ?').get(`it-${DEAL}`) as any).state, 'pending',
    'the state change was rolled back with its event');
});

test('only whoever may move the round (role partner plus canMoveRound) sets owner, due date or state', async () => {
  const db = freshDb({ beforeMigration: (d) => { seedOldChecklist(d, DEAL); seedOldChecklist(d, DEAL_B); } });
  const writes = [{ owner_user_id: OWNER }, { owner_label: 'Founder' }, { due_date: '2026-12-01' }, { state: 'done' }];
  // The partner does not lead DEAL_B; the investor is not a partner at all.
  for (const [who, dealId] of [[partner, DEAL_B], [investor, DEAL], [outsider, DEAL]] as Array<[Who, number]>) {
    for (const body of writes) {
      const r = await patch(who, dealId, `it-${dealId}`, db, body);
      assert.equal(r.status, 403, `${who.user} on ${dealId}: ${JSON.stringify(body)}`);
    }
    const add = await call(who, `/api/deals/${dealId}/closing-checklist/items`, db, { method: 'POST', body: { label: 'x', owner_label: 'Founder' } });
    assert.equal(add.status, 403);
  }
  assert.equal(n(db, 'deal_closing_checklist_events'), 0, 'a refused write records no event');
  const rows = db.prepare('SELECT state, owner_user_id, owner_label, due_date FROM deal_closing_checklist_items').all() as any[];
  assert.equal(rows.length, 2, 'no item was added');
  for (const row of rows) assert.deepEqual({ ...row }, { state: 'pending', owner_user_id: null, owner_label: null, due_date: null });

  // The lead partner on their own deal, and an admin on any, may.
  assert.equal((await patch(partner, DEAL, `it-${DEAL}`, db, { owner_user_id: OWNER, due_date: '2026-12-01', state: 'blocked' })).status, 200);
  assert.equal((await patch(admin, DEAL_B, `it-${DEAL_B}`, db, { owner_label: 'Founder' })).status, 200);
});

test('each write adds exactly one event, an owner-only edit included', async () => {
  const db = freshDb({ beforeMigration: (d) => seedOldChecklist(d) });
  const uid = `it-${DEAL}`;
  const steps: Array<[any, string, string]> = [
    [{ state: 'done' }, 'pending', 'done'],
    [{ state: 'blocked', note: 'awaiting signature' }, 'done', 'blocked'],
    [{ owner_label: 'Founder' }, 'blocked', 'blocked'],
    [{ state: 'skipped' }, 'blocked', 'skipped'],
  ];
  for (const [i, [body, from, to]] of steps.entries()) {
    const r = await patch(partner, DEAL, uid, db, body);
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(n(db, 'deal_closing_checklist_events'), i + 1, `exactly one event after write ${i + 1}`);
    const last = db.prepare('SELECT from_state, to_state FROM deal_closing_checklist_events ORDER BY id DESC LIMIT 1').get() as any;
    assert.deepEqual({ ...last }, { from_state: from, to_state: to });
  }
  const ev = await call(partner, `/api/deals/${DEAL}/closing-checklist/events`, db);
  assert.equal(ev.body.events[1].note, 'awaiting signature', 'the note given with a write rides its event');
});

test('reverting an item keeps the earlier event; events refuse UPDATE and DELETE', async () => {
  const db = freshDb({ beforeMigration: (d) => seedOldChecklist(d) });
  const uid = `it-${DEAL}`;
  await patch(partner, DEAL, uid, db, { state: 'done' });
  const reverted = await patch(admin, DEAL, uid, db, { state: 'pending' });
  assert.equal(reverted.status, 200);
  assert.equal(reverted.body.checklist.items[0].done_by, null, 'the item itself no longer says who did it');
  const ev = await call(partner, `/api/deals/${DEAL}/closing-checklist/events`, db);
  assert.deepEqual(ev.body.events.map((e: any) => [e.from_state, e.to_state, e.actor_user_id, e.actor_name]), [
    ['pending', 'done', PARTNER, 'Pat Fixture'],
    ['done', 'pending', ADMIN, 'Ada Fixture'],
  ], 'the history still says who did it');
  assert.throws(() => db.prepare(`UPDATE deal_closing_checklist_events SET to_state = 'skipped'`).run(), /append_only/);
  assert.throws(() => db.prepare('DELETE FROM deal_closing_checklist_events').run(), /append_only/);
  assert.equal(n(db, 'deal_closing_checklist_events'), 2);
});

test('the events read refuses anyone who cannot read the deal', async () => {
  const db = freshDb({ beforeMigration: (d) => seedOldChecklist(d) });
  await patch(partner, DEAL, `it-${DEAL}`, db, { state: 'done' });
  const refused = await call(outsider, `/api/deals/${DEAL}/closing-checklist/events`, db);
  assert.equal(refused.status, 403);
  assert.equal(refused.body?.events, undefined, 'no history leaks with the refusal');
  assert.equal((await call(outsider, `/api/deals/${DEAL}/closing-checklist`, db)).status, 403, 'the same rule as the checklist read');
  const invited = await call(investor, `/api/deals/${DEAL}/closing-checklist/events`, db);
  assert.equal(invited.status, 200, 'an investor invited to the deal reads it, as they read the checklist');
  assert.equal(invited.body.events.length, 1);
  assert.equal((await call(partner, '/api/deals/999/closing-checklist/events', db)).status, 404);
});

test('a bad owner, a bad due date or an empty change is refused and records nothing', async () => {
  const db = freshDb({ beforeMigration: (d) => seedOldChecklist(d) });
  const uid = `it-${DEAL}`;
  const cases: Array<[any, string]> = [
    [{ owner_user_id: 9999 }, 'checklist_owner_unknown'],
    [{ due_date: '2026-02-30' }, 'checklist_due_date_invalid'],
    [{ due_date: '01/12/2026' }, 'checklist_due_date_invalid'],
    [{}, 'checklist_item_change_required'],
    [{ state: 'finished' }, 'checklist_item_state_invalid'],
  ];
  for (const [body, code] of cases) {
    const r = await patch(partner, DEAL, uid, db, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body?.error, code);
  }
  const add = await call(partner, `/api/deals/${DEAL}/closing-checklist/items`, db, { method: 'POST', body: { label: 'x', due_date: 'soon' } });
  assert.equal(add.body?.error, 'checklist_due_date_invalid');
  assert.equal(n(db, 'deal_closing_checklist_events'), 0);
  // A sent null clears a field; an absent one leaves it.
  await patch(partner, DEAL, uid, db, { owner_label: 'Founder', due_date: '2026-12-01' });
  const cleared = await patch(partner, DEAL, uid, db, { due_date: null });
  assert.equal(cleared.body.checklist.items[0].due_date, null);
  assert.equal(cleared.body.checklist.items[0].owner_label, 'Founder');
});

test('an IC condition carries its owner on create and on every read', async () => {
  const db = freshDb();
  const made = await call(admin, `/api/ic/${DEC}/conditions`, db, {
    method: 'POST', body: { body: 'Fixture diligence item', owner_user_id: OWNER, owner_label: 'Founder' },
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.item.owner_user_id, OWNER);
  assert.equal(made.body.item.owner_name, 'Ola Fixture');
  assert.equal(made.body.item.owner_label, 'Founder');
  const labelOnly = await call(admin, `/api/ic/${DEC}/conditions`, db, { method: 'POST', body: { body: 'Fixture second', owner_label: 'Founder' } });
  assert.equal(labelOnly.body.item.owner_user_id, null);
  assert.equal(labelOnly.body.item.owner_label, 'Founder');

  const list = await call(admin, '/api/ic/conditions', db);
  const row = list.body.items.find((c: any) => c.uid === made.body.item.uid);
  assert.deepEqual([row.owner_user_id, row.owner_name, row.owner_label], [OWNER, 'Ola Fixture', 'Founder']);
  const detail = await call(admin, `/api/ic/${DEC}`, db);
  const d = detail.body.conditions.find((c: any) => c.uid === made.body.item.uid);
  assert.deepEqual([d.owner_user_id, d.owner_name, d.owner_label], [OWNER, 'Ola Fixture', 'Founder']);
  const resolved = await call(admin, `/api/ic/conditions/${made.body.item.uid}`, db, { method: 'PATCH', body: { status: 'met' } });
  assert.equal(resolved.body.item.owner_label, 'Founder', 'resolving keeps the owner');

  const unknown = await call(admin, `/api/ic/${DEC}/conditions`, db, { method: 'POST', body: { body: 'x', owner_user_id: 9999 } });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body?.error, 'condition_owner_unknown');
  assert.equal(n(db, 'ic_conditions'), 2);
});

test('an owner-only edit records the new owner in its event, and keeps the due date as it stands', async () => {
  const db = freshDb({ beforeMigration: (d) => seedOldChecklist(d) });
  const uid = `it-${DEAL}`;
  await patch(partner, DEAL, uid, db, { due_date: '2026-12-01' });
  const r = await patch(partner, DEAL, uid, db, { owner_user_id: OWNER, owner_label: 'Founder' });
  assert.equal(r.status, 200);
  const ev = await call(partner, `/api/deals/${DEAL}/closing-checklist/events`, db);
  assert.equal(ev.body.events.length, 2);
  const last = ev.body.events[1];
  assert.deepEqual(
    [last.from_state, last.to_state, last.owner_user_id, last.owner_name, last.owner_label, last.due_date],
    ['pending', 'pending', OWNER, 'Ola Fixture', 'Founder', '2026-12-01'],
    'the event says who owns the item after the write, and the unchanged due date',
  );
  assert.deepEqual([ev.body.events[0].owner_user_id, ev.body.events[0].owner_label], [null, null],
    'the earlier event keeps the owner it recorded');
  // Clearing the owner is recorded as a cleared owner.
  await patch(partner, DEAL, uid, db, { owner_user_id: null });
  const after = await call(partner, `/api/deals/${DEAL}/closing-checklist/events`, db);
  assert.deepEqual([after.body.events[2].owner_user_id, after.body.events[2].owner_name, after.body.events[2].owner_label],
    [null, null, 'Founder']);
});

test('a due-only edit records the new due date in its event, and keeps the owner as it stands', async () => {
  const db = freshDb({ beforeMigration: (d) => seedOldChecklist(d) });
  const uid = `it-${DEAL}`;
  await patch(partner, DEAL, uid, db, { owner_label: 'Founder' });
  const r = await patch(partner, DEAL, uid, db, { due_date: '2027-01-15' });
  assert.equal(r.status, 200);
  const ev = await call(partner, `/api/deals/${DEAL}/closing-checklist/events`, db);
  const last = ev.body.events[1];
  assert.deepEqual([last.due_date, last.owner_label, last.owner_user_id], ['2027-01-15', 'Founder', null]);
  assert.equal(ev.body.events[0].due_date, null, 'the earlier event keeps the due date it recorded');
  // A state change carries both forward unchanged.
  await patch(partner, DEAL, uid, db, { state: 'done' });
  const done = (await call(partner, `/api/deals/${DEAL}/closing-checklist/events`, db)).body.events[2];
  assert.deepEqual([done.to_state, done.due_date, done.owner_label], ['done', '2027-01-15', 'Founder']);
});
