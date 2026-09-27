/**
 * D462 — the Closing stage's money and paper (migration 335).
 *
 *   TRANSFERS. `deal_transfers` records a transfer OUT to a company — integer
 *   cents, a reference, a phone-verified flag, who recorded it. An OPEN IC
 *   condition on the deal (migration 334) refuses the write with
 *   `open_conditions_block_transfer`; resolving the condition is what lets it
 *   through. Investors read the transfers on deals they were invited to or
 *   committed to; partners and admins read what was recorded.
 *
 *   THE CLOSING CHECKLIST. One per deal, applied from a closing template
 *   (safe | spa | subscription, validated against `legal_templates`). No
 *   default item set is seeded — that is the owner's call — so an applied
 *   checklist starts empty and items are added by hand.
 *
 * Harness matches ic_company_scope.test.ts: the real router against in-memory
 * SQLite with a signed JWT.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import deals from '../src/routes/deals.ts';

// The auth helpers refuse by THROWING, and the production mapping to 401/403
// lives in the app's onError (index.ts), not in the router. Mount the same
// mapping here so a refusal is asserted as the status production returns.
const app = new Hono();
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  if (msg === 'Forbidden') return c.json({ detail: msg }, 403);
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  return c.json({ detail: 'Internal server error' }, 500);
});
app.route('/api/deals', deals);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const PARTNER = 20;
const INVESTOR = 42;
const OTHER_INVESTOR = 43;
const PROJ = 7;
const DEAL = 71;
const DEAL_B = 72;
const DEC = 'dec-alpha';

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
    async batch(x: any[]) { return x; },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT, email TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      investor_tier TEXT, partner_id INTEGER, founder_id INTEGER
    );
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, name TEXT, sector TEXT, founder_id INTEGER,
      company_id INTEGER, deleted_at TEXT
    );
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY, uid TEXT, project_id INTEGER, partner_id INTEGER,
      status TEXT NOT NULL DEFAULT 'applied', notes TEXT, amount REAL,
      target_raise REAL, capital_committed REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE deal_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL,
      investor_user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'invited',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE commitments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER NOT NULL,
      investor_user_id INTEGER NOT NULL, amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ic_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      project_id INTEGER, deal_id INTEGER, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ic_conditions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      ic_decision_id INTEGER NOT NULL, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT, resolved_by INTEGER
    );
    CREATE TABLE deal_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      deal_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL,
      reference TEXT, phone_verified INTEGER NOT NULL DEFAULT 0, note TEXT,
      recorded_by INTEGER NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE deal_closing_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      deal_id INTEGER NOT NULL UNIQUE, template_slug TEXT,
      applied_by INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE deal_closing_checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      checklist_id INTEGER NOT NULL, label TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending', note TEXT, sort INTEGER NOT NULL DEFAULT 0,
      done_by INTEGER, done_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE legal_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE mi_pro_subscriptions (
      user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT, plan TEXT,
      period_end TEXT, stripe_customer_id TEXT
    );
  `);
  const u = db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)');
  u.run(PARTNER, 'partner', 'Pat Partner');
  u.run(INVESTOR, 'investor', 'Ingrid Investor');
  u.run(OTHER_INVESTOR, 'investor', 'Otto Outsider');
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(PROJ, 'Alpha');
  db.prepare(`INSERT INTO deals (id, uid, project_id, status) VALUES (?, 'd-alpha', ?, 'funded')`).run(DEAL, PROJ);
  db.prepare(`INSERT INTO deals (id, uid, project_id, status) VALUES (?, 'd-beta', ?, 'funded')`).run(DEAL_B, PROJ);
  db.prepare('INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (?, ?)').run(DEAL, INVESTOR);
  db.prepare(`INSERT INTO legal_templates (slug, title) VALUES ('safe', 'SAFE Agreement'), ('spa', 'Stock Purchase Agreement'), ('subscription', 'Subscription Agreement')`).run();
  return db;
}

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

type Who = { user: number; role: string };
const partner = { user: PARTNER, role: 'partner' };
const investor = { user: INVESTOR, role: 'investor' };
const outsider = { user: OTHER_INVESTOR, role: 'investor' };

async function call(
  who: Who,
  path: string,
  init: { method?: string; body?: any } = {},
  db: InstanceType<typeof DatabaseSync> = freshDb(),
): Promise<{ status: number; body: any; db: InstanceType<typeof DatabaseSync> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await token(who.user, who.role)}`,
    'Content-Type': 'application/json',
  };
  const res = await app.request(`/api/deals${path}`, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  }, env(db));
  const body = await res.json().catch(() => null);
  return { status: res.status, body, db };
}

function addCondition(db: InstanceType<typeof DatabaseSync>, dealId: number, status = 'open') {
  db.prepare(`INSERT INTO ic_decisions (uid, deal_id, title, created_by) VALUES (?, ?, 'IC review', ?)`)
    .run(DEC, dealId, PARTNER);
  db.prepare(`INSERT INTO ic_conditions (uid, ic_decision_id, body, status, created_by)
              VALUES ('cond-1', (SELECT id FROM ic_decisions WHERE uid = ?), 'IP chain of title', ?, ?)`)
    .run(DEC, status, PARTNER);
}

// ── Transfers ──────────────────────────────────────────────────────────────

test('a transfer is recorded in integer cents with who and when', async () => {
  const r = await call(partner, `/${DEAL}/transfers`, {
    method: 'POST',
    body: { amount_cents: 25000000, reference: 'WT-8831', phone_verified: true, note: 'first tranche' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.item.amount_cents, 25000000, 'money is integer cents, never a float');
  assert.equal(r.body.item.phone_verified, 1);
  assert.equal(r.body.item.recorded_by_name, 'Pat Partner');

  const list = await call(partner, `/${DEAL}/transfers`, {}, r.db);
  assert.equal(list.body.items.length, 1);
});

test('a float or a zero is refused — money is integer cents', async () => {
  for (const bad of [250.5, 0, -100, '25000']) {
    const r = await call(partner, `/${DEAL}/transfers`, { method: 'POST', body: { amount_cents: bad } });
    assert.equal(r.status, 400, `amount_cents=${bad}`);
    assert.equal(r.body?.error, 'transfer_amount_invalid');
  }
});

test('an open IC condition refuses the transfer; resolving it lets the wire through', async () => {
  const db = freshDb();
  addCondition(db, DEAL);
  const refused = await call(partner, `/${DEAL}/transfers`, {
    method: 'POST', body: { amount_cents: 100000 },
  }, db);
  assert.equal(refused.status, 409);
  assert.equal(refused.body?.error, 'open_conditions_block_transfer');
  assert.equal(refused.body?.open_conditions, 1);
  assert.match(String(refused.body?.message), /commit room/);
  // Nothing was written.
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM deal_transfers').get() as any).n, 0);

  // Resolve the condition — the commit room's act — and the write lands.
  db.prepare(`UPDATE ic_conditions SET status = 'met'`).run();
  const allowed = await call(partner, `/${DEAL}/transfers`, {
    method: 'POST', body: { amount_cents: 100000 },
  }, db);
  assert.equal(allowed.status, 201);
});

test('an investor reads transfers on their deals only; a partner reads the record', async () => {
  const db = freshDb();
  await call(partner, `/${DEAL}/transfers`, { method: 'POST', body: { amount_cents: 100000 } }, db);
  await call(partner, `/${DEAL_B}/transfers`, { method: 'POST', body: { amount_cents: 200000 } }, db);

  const mine = await call(investor, '/transfers', {}, db);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.items.map((t: any) => t.deal_id), [DEAL],
    'the investor was invited to DEAL only, and DEAL_B’s transfer must not leak');

  const all = await call(partner, '/transfers', {}, db);
  assert.equal(all.body.items.length, 2);

  const none = await call(outsider, '/transfers', {}, db);
  assert.equal(none.body.items.length, 0, 'an investor with no relationship sees none');
});

test('an investor may not record a transfer', async () => {
  const r = await call(investor, `/${DEAL}/transfers`, { method: 'POST', body: { amount_cents: 100000 } });
  assert.equal(r.status, 403);
});

// ── The closing checklist ──────────────────────────────────────────────────

test('a template applies once, from the closing set, and starts empty', async () => {
  const db = freshDb();
  const applied = await call(partner, `/${DEAL}/closing-checklist/apply`, { method: 'POST', body: { template_slug: 'safe' } }, db);
  assert.equal(applied.status, 201);
  assert.equal(applied.body.checklist.template_slug, 'safe');
  assert.deepEqual(applied.body.checklist.items, [], 'no default items — that set is the owner’s call');

  const again = await call(partner, `/${DEAL}/closing-checklist/apply`, { method: 'POST', body: { template_slug: 'spa' } }, db);
  assert.equal(again.status, 409);
  assert.equal(again.body?.error, 'closing_checklist_exists');

  const unknown = await call(partner, `/${DEAL_B}/closing-checklist/apply`, { method: 'POST', body: { template_slug: 'nda' } }, db);
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body?.error, 'closing_template_unknown');
});

test('items are added by hand and moved through their states', async () => {
  const db = freshDb();
  await call(partner, `/${DEAL}/closing-checklist/apply`, { method: 'POST', body: { template_slug: 'spa' } }, db);

  // An item needs the checklist first — proved on the other deal.
  const noList = await call(partner, `/${DEAL_B}/closing-checklist/items`, { method: 'POST', body: { label: 'x' } }, db);
  assert.equal(noList.status, 400);
  assert.equal(noList.body?.error, 'closing_checklist_missing');

  const added = await call(partner, `/${DEAL}/closing-checklist/items`, { method: 'POST', body: { label: 'Executed SPA' } }, db);
  assert.equal(added.status, 201);
  const item = added.body.checklist.items[0];
  assert.equal(item.state, 'pending');

  const done = await call(partner, `/${DEAL}/closing-checklist/items/${item.uid}`, { method: 'PATCH', body: { state: 'done' } }, db);
  assert.equal(done.status, 200);
  assert.equal(done.body.checklist.items[0].state, 'done');
  assert.equal(done.body.checklist.items[0].done_by_name, 'Pat Partner');
  assert.ok(done.body.checklist.items[0].done_at, 'the completion is stamped');

  const bad = await call(partner, `/${DEAL}/closing-checklist/items/${item.uid}`, { method: 'PATCH', body: { state: 'finished' } }, db);
  assert.equal(bad.status, 400);
  assert.equal(bad.body?.error, 'checklist_item_state_invalid');
});

test('an investor reads the checklist but may not write it', async () => {
  const db = freshDb();
  await call(partner, `/${DEAL}/closing-checklist/apply`, { method: 'POST', body: { template_slug: 'safe' } }, db);
  const read = await call(investor, `/${DEAL}/closing-checklist`, {}, db);
  assert.equal(read.status, 200);
  assert.equal(read.body.checklist.template_slug, 'safe');

  const write = await call(investor, `/${DEAL}/closing-checklist/items`, { method: 'POST', body: { label: 'x' } }, db);
  assert.equal(write.status, 403);
});
