/**
 * D4817 part 9 (#5311, addendum PFA03–PFA05, PFA10) — the investor's Ask and
 * Waive on `/api/reporting`, as the company workspace's Reports draws them:
 *
 *   · the reads say who may act: `can_act` is true for the holder's own
 *     session and false, with the write's refusal sentence, for a support
 *     session (whose write is still refused 403);
 *   · each period carries the caller's own ask (`asked_at`, from the audit
 *     row) and who waived it (`waived_by_you`: true, or null when the row
 *     records no author), never another investor's ask;
 *   · the ask answers with the record it stored, read back: the event's
 *     time, the period and the in-app notices stored for the founder team;
 *     the waive answers with the period's stored `waived_at` and author.
 *
 * Every mail and bank call stays stubbed: `fetch` throws and is counted.
 * Every name and figure is invented.
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - the ask's `asked_at` taken from the request's clock, not the stored
 *     row → the ask test;
 *   - every founder counted as told, stored notice or not → the ask test and
 *     the not-stored test;
 *   - a waiver with no recorded author read as "by you" → the waive test;
 *   - `can_act` true for a support session → the who-may-act test.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/reporting_ask_receipt_d4817.test.ts
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import reporting from '../src/routes/reporting.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { addDays, createReportingDuties, openPeriods } from '../src/services/reportingDuties.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const MIG = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const app = new Hono<any>();
app.route('/api/reporting', reporting);
app.onError((err: any, c) => {
  if (err instanceof Response) return err;
  const status = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return c.json({ detail: err?.message }, status ?? 500);
});

let fetches = 0;
const realFetch = globalThis.fetch;
beforeEach(() => { fetches = 0; globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in D4817 part 9'); }) as any; });
afterEach(() => { globalThis.fetch = realFetch; assert.equal(fetches, 0, 'fetch was called'); });

const INV_A = 6, INV_B = 7;
const ROLE: Record<number, string> = { 1: 'admin', 3: 'founder', 6: 'investor', 7: 'investor', 9: 'founder' };
// The Worker opens periods against its own today, so the fixture's closing is placed relative to it.
const TODAY = new Date().toISOString().slice(0, 10); // clock-ok: relative
const CLOSED = addDays(TODAY, -100);

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
  for (const f of ['312_fund_call_ledger.sql', '335_deal_transfers_and_closing_checklists.sql', '340_deal_transfer_company.sql',
    '410_safe_issuances.sql', '599_deal_currency.sql', '337_portfolio_update_chases.sql']) db.exec(MIG(f));
  db.exec('ALTER TABLE raise_prospects ADD COLUMN amount_cents INTEGER');
  db.exec(MIG('612_closings.sql'));
  db.exec(MIG('579_reporting_duties.sql'));
  db.exec(`
    INSERT INTO founders (id, name, email) VALUES (31, 'Fay Founder', 'fay@example.test');
    INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES
      (1, 'admin', 'Ada Admin', 'ada@example.test', NULL, 1), (3, 'founder', 'Fay Founder', 'fay@example.test', 31, 1),
      (6, 'investor', 'Ivy Alpha', 'ivy@example.test', NULL, 1), (7, 'investor', 'Ben Beta', 'ben@example.test', NULL, 1),
      (9, 'founder', 'Cora Cofounder', 'cora@example.test', NULL, 1);
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'proj-seven', 'Fixture Venture', 31);
    INSERT INTO project_members (project_id, user_id, role, status) VALUES (7, 9, 'cofounder', 'accepted');
    INSERT INTO deals (id, uid, project_id, status, instrument) VALUES (41, 'd-41', 7, 'active', 'spa');
    INSERT INTO commitments (id, uid, deal_id, investor_user_id, amount, status) VALUES
      (101, 'cm-a', 41, 6, 250000, 'confirmed'), (102, 'cm-b', 41, 7, 125000, 'confirmed');
    INSERT INTO esign_envelopes (id, envelope_uuid, user_id, deal_id, document_type, document_title, document_body, body_sha256, status, created_by) VALUES
      (501, 'env-a', 6, 41, 'voting_rights', 'Investors Rights Agreement', 'signed body', 'sha-a', 'completed', 1);
    INSERT INTO closings (id, uid, deal_id, project_id, template_slug, status, closed_at, created_by) VALUES
      (1, 'cl-one', 41, 7, 'term_sheet_v1', 'closed', '${CLOSED} 10:00:00', 1);
    INSERT INTO closing_lines (id, uid, closing_id, commitment_id, investor_user_id, amount_cents, envelope_id, status, created_by) VALUES
      (11, 'ln-a', 1, 101, 6, 25000000, 501, 'received', 1),
      (12, 'ln-b', 1, 102, 7, 12500000, NULL, 'received', 1);
  `);
  return db;
}

const env = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
async function token(user: number, support = false) {
  return new SignJWT({ user_id: user, role: ROLE[user], ...(support ? { impersonated_by: 1 } : {}) }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}
async function call(db: DatabaseSync, method: string, path: string, as: number, support = false) {
  const res = await app.request(path, { method, headers: { Authorization: `Bearer ${await token(as, support)}`, 'Content-Type': 'application/json' } }, env(db));
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
const one = (db: DatabaseSync, sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).get()));

async function ready() {
  const db = freshDb();
  await createReportingDuties(env(db), 1);
  await openPeriods(env(db), TODAY);
  return db;
}
const lateOf = (co: any) => co.periods.find((p: any) => p.state === 'late' || p.state === 'missing');

test('who may act: the holder\'s own session may; a support session reads can_act false with the refusal, and its write is still refused', async () => {
  const db = await ready();
  const own = await call(db, 'GET', '/api/reporting/companies/proj-seven', INV_A);
  assert.equal(own.status, 200, own.text);
  assert.deepEqual([own.body.can_act, own.body.act_refusal], [true, null]);
  const support = await call(db, 'GET', '/api/reporting/companies/proj-seven', INV_A, true);
  assert.deepEqual([support.body.can_act, support.body.act_refusal], [false, 'A support session cannot ask for a report or waive a period.']);
  const book = await call(db, 'GET', '/api/reporting/portfolio', INV_A, true);
  assert.equal(book.body.can_act, false);
  assert.equal((await call(db, 'GET', '/api/reporting/portfolio', INV_A)).body.can_act, true);
  const late = lateOf(own.body.company);
  assert.equal((await call(db, 'POST', `/api/reporting/periods/${late.uid}/ask`, INV_A, true)).status, 403);
  assert.equal((await call(db, 'POST', `/api/reporting/periods/${late.uid}/waive`, INV_A, true)).status, 403);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM reporting_events WHERE event IN ('asked', 'waived')").n, 0, 'nothing was written');
});

test('ask: the receipt is the stored audit row read back, with the period and the in-app notices stored; the read then carries asked_at', async () => {
  const db = await ready();
  const before = (await call(db, 'GET', '/api/reporting/companies/proj-seven', INV_A)).body.company;
  const late = lateOf(before);
  assert.deepEqual([late.asked, late.asked_at, late.waived_by_you], [false, null, null]);
  // The audit table is append-only, so the stored time is fixed through the column default, not rewritten:
  // the receipt is shown to come from the row and not from the request's clock.
  db.exec(`ALTER TABLE reporting_events RENAME COLUMN created_at TO created_at_was`);
  db.exec(`ALTER TABLE reporting_events ADD COLUMN created_at TEXT NOT NULL DEFAULT '2026-11-02 09:15:00'`);
  const asked = await call(db, 'POST', `/api/reporting/periods/${late.uid}/ask`, INV_A);
  assert.equal(asked.status, 200, asked.text);
  assert.equal(asked.body.asked_at, '2026-11-02 09:15:00');
  assert.equal(one(db, "SELECT created_at FROM reporting_events WHERE event = 'asked'").created_at, '2026-11-02 09:15:00');
  assert.deepEqual(asked.body.period, { uid: late.uid, label: late.label });
  assert.equal(asked.body.by_you, true);
  assert.equal(one(db, "SELECT COUNT(*) AS n FROM notifications_inbox WHERE type = 'reporting_asked'").n, 2);
  assert.deepEqual(asked.body.told, { team: 2, in_app: 2 }, 'both of the founder team got an in-app notice, and the receipt counts the stored ones');
  assert.match(asked.body.chase_uid, /^[0-9a-f]{32}$/);
  const after = (await call(db, 'GET', '/api/reporting/companies/proj-seven', INV_A)).body.company.periods.find((p: any) => p.uid === late.uid);
  assert.deepEqual([after.asked, after.asked_at], [true, '2026-11-02 09:15:00']);
  // Another investor never sees A's ask on their own copy of the period.
  const b = (await call(db, 'GET', '/api/reporting/companies/proj-seven', INV_B)).body.company;
  assert.ok(b.periods.every((p: any) => p.asked === false && p.asked_at === null), 'B sees no ask of A\'s');
  assert.ok(!/Ivy Alpha|Fay Founder|Cora/.test(JSON.stringify(asked.body)), 'the receipt names nobody');
  const twice = await call(db, 'POST', `/api/reporting/periods/${late.uid}/ask`, INV_A);
  assert.deepEqual([twice.status, twice.body?.error], [409, 'already_asked']);
});

test('ask: an in-app notice that is not stored is not counted', async () => {
  const db = await ready();
  const late = lateOf((await call(db, 'GET', '/api/reporting/companies/proj-seven', INV_A)).body.company);
  // The co-founder turned the event off in every channel: notify stores nothing for them.
  db.exec(`UPDATE users SET notification_prefs = '{"reporting_asked":{"in_app":false,"email":false}}' WHERE id = 9`);
  const asked = await call(db, 'POST', `/api/reporting/periods/${late.uid}/ask`, INV_A);
  assert.equal(asked.status, 200, asked.text);
  assert.deepEqual(asked.body.told, { team: 2, in_app: 1 });
});

test('waive: the receipt is the period as stored, waived by you; the read then carries waived_by_you, and null where no author was recorded', async () => {
  const db = await ready();
  const co = (await call(db, 'GET', '/api/reporting/companies/proj-seven', INV_A)).body.company;
  const open = co.periods.filter((p: any) => p.state !== 'sent' && p.state !== 'waived');
  assert.ok(open.length >= 2, 'the fixture has two open periods');
  const [first, second] = open;
  db.exec(`CREATE TRIGGER fix_waive_time AFTER UPDATE OF waived_at ON reporting_periods WHEN NEW.waived_at IS NOT NULL AND NEW.waived_at <> '2026-11-03 14:40:00'
    BEGIN UPDATE reporting_periods SET waived_at = '2026-11-03 14:40:00' WHERE id = NEW.id; END`);
  const waived = await call(db, 'POST', `/api/reporting/periods/${first.uid}/waive`, INV_A);
  assert.equal(waived.status, 200, waived.text);
  assert.deepEqual([waived.body.waived_at, waived.body.waived_by_you, waived.body.period], ['2026-11-03 14:40:00', true, { uid: first.uid, label: first.label }]);
  // A waiver written with no author reads null, never "you".
  db.exec('DROP TRIGGER fix_waive_time');
  db.exec(`UPDATE reporting_periods SET waived_at = '2026-11-04 08:00:00', waived_by = NULL WHERE uid = '${second.uid}'`);
  const after = (await call(db, 'GET', '/api/reporting/companies/proj-seven', INV_A)).body.company.periods;
  const a = after.find((p: any) => p.uid === first.uid);
  const b = after.find((p: any) => p.uid === second.uid);
  assert.deepEqual([a.state, a.waived_at, a.waived_by_you], ['waived', '2026-11-03 14:40:00', true]);
  assert.deepEqual([b.state, b.waived_at, b.waived_by_you], ['waived', '2026-11-04 08:00:00', null]);
  const twice = await call(db, 'POST', `/api/reporting/periods/${first.uid}/waive`, INV_A);
  assert.deepEqual([twice.status, twice.body?.error], [409, 'already_waived']);
});
