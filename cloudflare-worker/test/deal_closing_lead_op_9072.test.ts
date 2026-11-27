/**
 * D9072 (#9072, D6158 Q1 = A) — the closing workspace opens to the round's
 * lead Operating Partner, and to no other partner.
 *
 * The workspace's own read is the checklist history behind its Audit tab,
 * `GET /api/deals/:id/closing-checklist/events`. Before this change every
 * holder of the partner licence read it on every deal (`dealAudience` puts
 * them all in `staff`). Now:
 *
 *   · the round's lead reads it, and an Admin does;
 *   · a partner who leads no round, and the lead of a different round, are
 *     refused 403 `not_your_closing`, and nothing is read;
 *   · a support session acting as the lead is refused 403 `support_session_refused`;
 *   · a partner who is also an invited investor on the deal reads it through
 *     that relationship, as before;
 *   · an investor on this deal keeps the deal's read rule, and an investor on
 *     another deal is refused as before (`loadDealForRead`).
 *
 * The reads the workspace shares with the deal page's closing room (the
 * checklist and the transfers, D1213: every Operating Partner) keep that
 * room's rule, and the last test pins it so the narrowing is not widened to
 * them by accident.
 *
 * The schema is the real one for the closing tables (migrations 334, 335 and
 * 202611140938_6156) over a minimal base. Every value below is invented.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import deals from '../src/routes/deals.ts';
import { closingWorkspaceRefusal, NOT_YOUR_CLOSING, CLOSING_SUPPORT_REFUSED } from '../src/services/dealClosingAccess.ts';

const app = new Hono();
app.onError((err: any, c: any) => {
  const msg = String(err?.message || '');
  if (msg === 'Forbidden') return c.json({ detail: msg }, 403);
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  return c.json({ detail: 'Internal server error' }, 500);
});
app.route('/api/deals', deals);

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const MIG = (f: string) => readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations', f), 'utf8');

const ADMIN = 1;
const LEAD = 2;        // partner, leads DEAL
const OTHER_LEAD = 3;  // partner, leads DEAL_B only
const PLAIN_OP = 4;    // partner, leads nothing
const DUAL_OP = 5;     // partner, also holds the investor licence and is invited to DEAL
const INVESTOR = 6;    // invited to DEAL
const INVESTOR_B = 7;  // invited to DEAL_B only
const SUPPORT_OPERATOR = 9;
const PROJ = 70;
const DEAL = 71;
const DEAL_B = 72;

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
    async batch(stmts: any[]) {
      db.exec('BEGIN');
      try { const out = stmts.map((s) => s.runSync()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, name TEXT, email TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER, founder_id INTEGER,
      investor_seat_primary_user_id INTEGER, investor_tier TEXT,
      investor_subscription_status TEXT, subscription_tier TEXT, partner_id INTEGER
    );
    CREATE TABLE account_licences (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
      licence TEXT NOT NULL, revoked_at TEXT);
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
    CREATE TABLE ic_meetings (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL, agenda TEXT, start_at TEXT NOT NULL, deal_id INTEGER,
      organizer_user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled');
    CREATE TABLE company_profiles (id INTEGER PRIMARY KEY, company_name TEXT);
    CREATE TABLE mi_pro_subscriptions (user_id INTEGER PRIMARY KEY, status TEXT, subscription_id TEXT,
      plan TEXT, period_end TEXT, stripe_customer_id TEXT);
  `);
  db.exec(MIG('334_ic_conditions_and_minutes.sql'));
  db.exec(MIG('335_deal_transfers_and_closing_checklists.sql'));
  db.exec(MIG('202611140938_6156_deals_v2_owner_due_history.sql'));
  // The transfer columns later migrations add (the firm, D4633; the phone verifier, D6889), as the read selects them.
  db.exec('ALTER TABLE deal_transfers ADD COLUMN company_id INTEGER; ALTER TABLE deal_transfers ADD COLUMN phone_verified_by INTEGER;');
  const u = db.prepare('INSERT INTO users (id, role, name) VALUES (?, ?, ?)');
  u.run(ADMIN, 'admin', 'Admin Fixture');
  u.run(LEAD, 'partner', 'Lead Fixture');
  u.run(OTHER_LEAD, 'partner', 'Other Lead Fixture');
  u.run(PLAIN_OP, 'partner', 'Plain Partner Fixture');
  u.run(DUAL_OP, 'partner', 'Dual Partner Fixture');
  u.run(INVESTOR, 'investor', 'Investor Fixture');
  u.run(INVESTOR_B, 'investor', 'Investor B Fixture');
  u.run(SUPPORT_OPERATOR, 'admin', 'Support Fixture');
  db.prepare(`INSERT INTO account_licences (user_id, licence) VALUES (?, 'investor')`).run(DUAL_OP);
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(PROJ, 'Fixture Venture');
  db.prepare(`INSERT INTO deals (id, uid, project_id, status, lead_partner_id) VALUES (?, 'd-one', ?, 'funded', ?)`).run(DEAL, PROJ, LEAD);
  db.prepare(`INSERT INTO deals (id, uid, project_id, status, lead_partner_id) VALUES (?, 'd-two', ?, 'funded', ?)`).run(DEAL_B, PROJ, OTHER_LEAD);
  const inv = db.prepare('INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (?, ?)');
  inv.run(DEAL, INVESTOR);
  inv.run(DEAL, DUAL_OP);
  inv.run(DEAL_B, INVESTOR_B);
  // One checklist with one item and one recorded event on DEAL.
  db.prepare(`INSERT INTO deal_closing_checklists (uid, deal_id, template_slug, applied_by) VALUES ('cl-one', ?, 'safe', ?)`).run(DEAL, ADMIN);
  db.prepare(`INSERT INTO deal_closing_checklist_items (uid, checklist_id, label, sort)
              VALUES ('it-one', (SELECT id FROM deal_closing_checklists WHERE deal_id = ?), 'Fixture consent', 1)`).run(DEAL);
  db.prepare(`INSERT INTO deal_closing_checklist_events (uid, item_id, actor_user_id, from_state, to_state, at)
              VALUES ('ev-one', (SELECT id FROM deal_closing_checklist_items WHERE uid = 'it-one'), ?, NULL, 'pending', '2026-11-20 10:00:00')`).run(LEAD);
  return db;
}

async function token(userId: number, role: string, support = false): Promise<string> {
  return new SignJWT({ user_id: userId, role, ...(support ? { impersonated_by: SUPPORT_OPERATOR } : {}) })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}
const env = (db: any): any => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: makeD1(db) });

async function get(who: { user: number; role: string; support?: boolean }, path: string, db: InstanceType<typeof DatabaseSync>) {
  const res = await app.request(path, {
    headers: { Authorization: `Bearer ${await token(who.user, who.role, who.support)}` },
  }, env(db));
  return { status: res.status, body: await res.json().catch(() => null) as any };
}
const events = (dealId: number) => `/api/deals/${dealId}/closing-checklist/events`;

test('the round’s lead Operating Partner reads the workspace’s Audit history, and an Admin does', async () => {
  const db = freshDb();
  const lead = await get({ user: LEAD, role: 'partner' }, events(DEAL), db);
  assert.equal(lead.status, 200);
  assert.deepEqual(lead.body.events.map((e: any) => e.uid), ['ev-one']);
  const admin = await get({ user: ADMIN, role: 'admin' }, events(DEAL), db);
  assert.equal(admin.status, 200);
  assert.equal(admin.body.events.length, 1);
});

test('a partner who leads no round, and the lead of a different round, are refused and read nothing', async () => {
  const db = freshDb();
  for (const [who, why] of [[PLAIN_OP, 'a partner who leads no round'], [OTHER_LEAD, 'the lead of another round']] as const) {
    const r = await get({ user: who, role: 'partner' }, events(DEAL), db);
    assert.equal(r.status, 403, `${why} is refused`);
    assert.equal(r.body.error, 'not_your_closing', `${why} reads the closing refusal`);
    assert.equal(r.body.message, NOT_YOUR_CLOSING.message);
    assert.equal(r.body.events, undefined, `${why} is sent no event`);
  }
  // The lead of DEAL is refused on DEAL_B, which another partner leads.
  const cross = await get({ user: LEAD, role: 'partner' }, events(DEAL_B), db);
  assert.equal(cross.status, 403);
  assert.equal(cross.body.error, 'not_your_closing');
  // And the other round's lead reads their own.
  assert.equal((await get({ user: OTHER_LEAD, role: 'partner' }, events(DEAL_B), db)).status, 200);
});

test('a support session acting as the round’s lead is refused', async () => {
  const db = freshDb();
  const r = await get({ user: LEAD, role: 'partner', support: true }, events(DEAL), db);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'support_session_refused');
  assert.equal(r.body.message, CLOSING_SUPPORT_REFUSED.message);
  assert.equal(r.body.events, undefined);
});

test('investors keep the deal’s read rule: their own deal reads, another deal is refused', async () => {
  const db = freshDb();
  const own = await get({ user: INVESTOR, role: 'investor' }, events(DEAL), db);
  assert.equal(own.status, 200, 'an investor invited to the deal reads it as before');
  const other = await get({ user: INVESTOR_B, role: 'investor' }, events(DEAL), db);
  assert.equal(other.status, 403, 'an investor of another deal is refused');
  assert.equal(other.body.events, undefined);
  assert.notEqual(other.body.error, 'not_your_closing', 'the investor is refused by the deal read rule, not the closing one');
});

test('a partner who is also an invited investor on the deal reads it through that relationship', async () => {
  const db = freshDb();
  const r = await get({ user: DUAL_OP, role: 'partner' }, events(DEAL), db);
  assert.equal(r.status, 200);
  // The same partner has no relationship with DEAL_B, and is refused there.
  const b = await get({ user: DUAL_OP, role: 'partner' }, events(DEAL_B), db);
  assert.equal(b.status, 403);
  assert.equal(b.body.error, 'not_your_closing');
});

test('the rule itself: only staff by the partner licence are narrowed, and a deal with no lead admits no partner', async () => {
  const db = freshDb();
  const e = env(db);
  const partner = (id: number, extra: any = {}) => ({ id, role: 'partner', licences: ['partner'], ...extra }) as any;
  assert.equal(await closingWorkspaceRefusal(e, partner(LEAD), { id: DEAL, lead_partner_id: LEAD }, 'staff'), null);
  assert.equal(await closingWorkspaceRefusal(e, partner(LEAD), { id: DEAL, lead_partner_id: null }, 'staff'), NOT_YOUR_CLOSING);
  assert.equal(await closingWorkspaceRefusal(e, partner(LEAD, { support_session: true }), { id: DEAL, lead_partner_id: LEAD }, 'staff'), CLOSING_SUPPORT_REFUSED);
  assert.equal(await closingWorkspaceRefusal(e, { id: ADMIN, role: 'admin', licences: [] } as any, { id: DEAL, lead_partner_id: LEAD }, 'staff'), null);
  // An owner or investor audience is not this rule's to narrow.
  assert.equal(await closingWorkspaceRefusal(e, partner(PLAIN_OP), { id: DEAL, lead_partner_id: LEAD }, 'owner'), null);
  assert.equal(await closingWorkspaceRefusal(e, partner(PLAIN_OP), { id: DEAL, lead_partner_id: LEAD, project_founder_id: 555 }, 'staff'), NOT_YOUR_CLOSING);
});

test('the reads the closing room shares keep its rule: every Operating Partner reads the checklist and transfers', async () => {
  const db = freshDb();
  for (const who of [PLAIN_OP, OTHER_LEAD]) {
    assert.equal((await get({ user: who, role: 'partner' }, `/api/deals/${DEAL}/closing-checklist`, db)).status, 200);
    assert.equal((await get({ user: who, role: 'partner' }, `/api/deals/${DEAL}/transfers`, db)).status, 200);
  }
});
