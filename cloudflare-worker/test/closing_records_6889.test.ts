/**
 * D6889 (#6889) — three records the closing workspace (#6866, D6158) reads:
 *
 *   · each closing event carries its actor's name, under the events' own rule:
 *     an admin and the founder read them, an investor reads no events at all;
 *   · `deal_transfers.phone_verified_by` (migration 202611161150) names the
 *     Admin who confirmed the wire instructions by phone, apart from the
 *     recorder: accepted only with `phone_verified`, only an Admin's id, and
 *     returned with the name by every transfer read;
 *   · each closing line says whether a Portfolio position records it, by the
 *     position's own `closing_line_uid` (612) and nothing else: an admin reads
 *     the position's uid, the founder whether one exists, an investor neither.
 *
 * Every name, email and figure here is invented; `fetch` throws and is counted.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/closing_records_6889.test.ts
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import closings from '../src/routes/closings.ts';
import positions from '../src/routes/positions.ts';
import deals from '../src/routes/deals.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIG = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);
const VERIFIER_MIGRATION = '202611161150_6889_deal_transfer_phone_verifier.sql';
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const app = new Hono<any>();
app.route('/api/closings', closings);
app.route('/api/positions', positions);
app.route('/api/deals', deals);
app.onError((err: any, c) => {
  if (err instanceof Response) return err;
  const status = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return c.json({ detail: err?.message }, status ?? 500);
});

let fetches = 0;
const realFetch = globalThis.fetch;
beforeEach(() => { fetches = 0; globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in D6889'); }) as any; });
afterEach(() => { globalThis.fetch = realFetch; assert.equal(fetches, 0, 'fetch was called'); });

const ADMIN = 1, OTHER_ADMIN = 2, FOUNDER = 3, PARTNER = 5, INV_A = 6, INV_B = 7;
const ROLE: Record<number, string> = { 1: 'admin', 2: 'admin', 3: 'founder', 5: 'partner', 6: 'investor', 7: 'investor' };
const DEAL = 41, PROJECT = 7;

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of ['312_fund_call_ledger.sql', '334_ic_conditions_and_minutes.sql', '335_deal_transfers_and_closing_checklists.sql', '340_deal_transfer_company.sql',
    '410_safe_issuances.sql', '599_deal_currency.sql']) db.exec(MIG(f));
  db.exec('ALTER TABLE raise_prospects ADD COLUMN amount_cents INTEGER');
  db.exec(`
    INSERT INTO founders (id, name, email) VALUES (31, 'Fay Founder', 'fay@example.test');
    INSERT INTO users (id, role, name, email, founder_id) VALUES
      (1, 'admin', 'Ada Admin', 'ada@example.test', NULL), (2, 'admin', 'Vic Verifier', 'vic@example.test', NULL),
      (3, 'founder', 'Fay Founder', 'fay@example.test', 31), (5, 'partner', 'Pia Partner', 'pia@example.test', NULL),
      (6, 'investor', 'Ivy Alpha', 'ivy@example.test', NULL), (7, 'investor', 'Ben Beta', 'ben@example.test', NULL);
    INSERT INTO projects (id, name, founder_id) VALUES (7, 'Fixture Venture', 31);
    INSERT INTO deals (id, uid, project_id, status, instrument) VALUES (41, 'd-41', 7, 'active', 'safe');
    INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (41, 6);
    INSERT INTO commitments (id, uid, deal_id, investor_user_id, amount, status) VALUES
      (101, 'cm-a', 41, 6, 250000, 'confirmed'), (102, 'cm-b', 41, 7, 125000, 'pending');
    -- A transfer recorded before the verifier column existed.
    INSERT INTO deal_transfers (uid, deal_id, amount_cents, phone_verified, recorded_by, recorded_at) VALUES ('tr-old', 41, 500, 1, 1, '2026-10-01T00:00:00Z');
  `);
  // The current closing read also returns D6195's recorded route preference.
  db.exec(MIG('202611161505_6195_commitment_route_preference.sql'));
  db.exec(MIG('612_closings.sql'));
  db.exec(MIG('202611151545_6198_closing_sender_declarations.sql'));
  db.exec(MIG(VERIFIER_MIGRATION));
  return db;
}

async function token(user: number) {
  return new SignJWT({ user_id: user, role: ROLE[user] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

async function call(db: DatabaseSync, method: string, path: string, as: number, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { Authorization: `Bearer ${await token(as)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

const all = (db: DatabaseSync, sql: string) => JSON.parse(JSON.stringify(db.prepare(sql).all()));

async function opened(db = freshDb()) {
  const r = await call(db, 'POST', '/api/closings', ADMIN, { deal_id: DEAL, round_label: 'Seed' });
  assert.equal(r.status, 201, r.text);
  const lines = Object.fromEntries(r.body.lines.map((l: any) => [l.investor_user_id, l.uid]));
  return { db, uid: r.body.uid as string, lines };
}

// ---------------------------------------------------------------- the actor's name

test('closing events carry the actor\'s name for an admin and the founder; an investor still reads no events', async () => {
  const { db, uid, lines } = await opened();
  // Another Admin acts, and an investor declares: each event names its own actor.
  assert.equal((await call(db, 'PUT', `/api/closings/${uid}/lines/${lines[INV_A]}/route`, OTHER_ADMIN, { route: 'direct' })).status, 200);
  const decl = await call(db, 'POST', `/api/closings/${uid}/lines/${lines[INV_A]}/declaration`, INV_A, { sent_on: '2026-01-02', amount_cents: 25000000 });
  assert.equal(decl.status, 201, decl.text);
  // An actor whose account is gone reads null, never another name.
  db.exec("INSERT INTO closing_events (closing_id, line_id, actor_user_id, event, source_ref, created_at) VALUES (1, NULL, 999, 'route_set', NULL, '2026-11-16T00:00:00Z')");

  for (const who of [ADMIN, FOUNDER]) {
    const r = await call(db, 'GET', `/api/closings/${uid}`, who);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.events.map((e: any) => [e.event, e.actor_user_id, e.actor_name]), [
      ['opened', ADMIN, 'Ada Admin'],
      ['route_set', OTHER_ADMIN, 'Vic Verifier'],
      ['evidence_added', INV_A, 'Ivy Alpha'],
      ['route_set', 999, null],
    ], `reader ${who}`);
  }
  const inv = await call(db, 'GET', `/api/closings/${uid}`, INV_B);
  assert.equal(inv.status, 200);
  assert.equal(inv.body.events, null, 'an investor reads no events, so no actor names');
  assert.doesNotMatch(inv.text, /Ada Admin|Vic Verifier|Ivy Alpha/);
});

// ---------------------------------------------------------------- the phone verifier

test(`${VERIFIER_MIGRATION} adds a nullable phone_verified_by and backfills nothing`, () => {
  const db = freshDb();
  const col = all(db, 'PRAGMA table_info(deal_transfers)').find((c: any) => c.name === 'phone_verified_by');
  assert.deepEqual([col?.type, col?.notnull, col?.dflt_value], ['INTEGER', 0, null]);
  const fk = all(db, 'PRAGMA foreign_key_list(deal_transfers)').find((f: any) => f.from === 'phone_verified_by');
  assert.deepEqual([fk?.table, fk?.to], ['users', 'id']);
  assert.equal(all(db, "SELECT phone_verified_by FROM deal_transfers WHERE uid = 'tr-old'")[0].phone_verified_by, null,
    'never guessed from recorded_by');
});

test('a transfer records the Admin who verified it by phone, apart from the recorder, and every transfer read returns the name', async () => {
  const db = freshDb();
  const r = await call(db, 'POST', `/api/deals/${DEAL}/transfers`, ADMIN,
    { amount_cents: 25000000, reference: 'WT-1', phone_verified: true, phone_verified_by: OTHER_ADMIN });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual([r.body.item.recorded_by, r.body.item.recorded_by_name, r.body.item.phone_verified, r.body.item.phone_verified_by, r.body.item.phone_verified_by_name],
    [ADMIN, 'Ada Admin', 1, OTHER_ADMIN, 'Vic Verifier']);

  const byDeal = await call(db, 'GET', `/api/deals/${DEAL}/transfers`, ADMIN);
  assert.equal(byDeal.status, 200, byDeal.text);
  const pick = (items: any[]) => items.map((t: any) => [t.uid === 'tr-old' ? 'old' : 'new', t.phone_verified_by, t.phone_verified_by_name])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  assert.deepEqual(pick(byDeal.body.items), [['new', OTHER_ADMIN, 'Vic Verifier'], ['old', null, null]]);
  for (const who of [ADMIN, INV_A]) {
    const list = await call(db, 'GET', '/api/deals/transfers', who);
    assert.equal(list.status, 200, list.text);
    assert.deepEqual(pick(list.body.items), [['new', OTHER_ADMIN, 'Vic Verifier'], ['old', null, null]], `reader ${who}`);
  }

  // Phone-verified with no verifier named: recorded, and the verifier reads Not recorded.
  const bare = await call(db, 'POST', `/api/deals/${DEAL}/transfers`, ADMIN, { amount_cents: 100, phone_verified: true });
  assert.equal(bare.status, 201, bare.text);
  assert.deepEqual([bare.body.item.phone_verified_by, bare.body.item.phone_verified_by_name], [null, null]);
});

test('the phone verifier is refused without phone verification, and when it is not an Admin\'s id; nothing is recorded', async () => {
  const db = freshDb();
  const before = all(db, 'SELECT COUNT(*) AS n FROM deal_transfers')[0].n;
  const without = await call(db, 'POST', `/api/deals/${DEAL}/transfers`, ADMIN, { amount_cents: 100, phone_verified: false, phone_verified_by: OTHER_ADMIN });
  assert.deepEqual([without.status, without.body?.error], [400, 'phone_verifier_without_verification']);
  assert.match(String(without.body?.message), /Nothing was recorded/);
  const unticked = await call(db, 'POST', `/api/deals/${DEAL}/transfers`, ADMIN, { amount_cents: 100, phone_verified_by: OTHER_ADMIN });
  assert.deepEqual([unticked.status, unticked.body?.error], [400, 'phone_verifier_without_verification']);
  for (const bad of [PARTNER, INV_A, 999, String(OTHER_ADMIN), 1.5, -1, true]) {
    const r = await call(db, 'POST', `/api/deals/${DEAL}/transfers`, ADMIN, { amount_cents: 100, phone_verified: true, phone_verified_by: bad });
    assert.deepEqual([r.status, r.body?.error], [400, 'phone_verifier_invalid'], `phone_verified_by=${JSON.stringify(bad)}`);
  }
  assert.equal(all(db, 'SELECT COUNT(*) AS n FROM deal_transfers')[0].n, before, 'a refused verifier writes no transfer');
});

// ---------------------------------------------------------------- the Portfolio link

test('a closing line reads In Portfolio only through a position that names it; the admin reads its uid, the founder whether, an investor neither', async () => {
  const { db, uid, lines } = await opened();
  const none = await call(db, 'GET', `/api/closings/${uid}`, ADMIN);
  assert.deepEqual(none.body.lines.map((l: any) => [l.investor_user_id, l.in_portfolio, l.portfolio_position_uid]),
    [[INV_A, false, null], [INV_B, false, null]], 'no position yet: false, never guessed');

  // D6889 part 2: only a received line can be recorded as a position.
  db.prepare("UPDATE closing_lines SET status = 'received' WHERE uid = ?").run(lines[INV_A]);
  const pos = await call(db, 'POST', '/api/positions', ADMIN, { project_id: PROJECT, round_name: 'Seed', invested_amount: 250000, closing_line_uid: lines[INV_A] });
  assert.equal(pos.status, 201, pos.text);
  // A position of the same venture and round that names no line links nothing.
  assert.equal((await call(db, 'POST', '/api/positions', ADMIN, { project_id: PROJECT, round_name: 'Seed', invested_amount: 125000 })).status, 201);

  const admin = await call(db, 'GET', `/api/closings/${uid}`, ADMIN);
  assert.deepEqual(admin.body.lines.map((l: any) => [l.investor_user_id, l.in_portfolio, l.portfolio_position_uid]),
    [[INV_A, true, pos.body.uid], [INV_B, false, null]]);

  const founder = await call(db, 'GET', `/api/closings/${uid}`, FOUNDER);
  assert.deepEqual(founder.body.lines.map((l: any) => [l.investor_user_id, l.in_portfolio, 'portfolio_position_uid' in l]),
    [[INV_A, true, false], [INV_B, false, false]], 'the founder reads whether, not which position');

  const inv = await call(db, 'GET', `/api/closings/${uid}`, INV_A);
  assert.equal(inv.body.lines.length, 1);
  assert.ok(!('in_portfolio' in inv.body.lines[0]) && !('portfolio_position_uid' in inv.body.lines[0]), 'an investor reads neither');
  assert.ok(!inv.text.includes(pos.body.uid));
});
