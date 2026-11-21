/**
 * D6908 (#6908, Worker part): an investor's own pro rata offer in a held
 * company's live round (`routes/portfolio_pro_rata.ts`), and the founder's
 * round manager recording it (`routes/contacts.ts`, offer_amount/respond_by).
 *
 * Real schema (`loadSchema`, so migration 202611161255_6908 is applied), real
 * routes, synthetic fixtures:
 *   ADMIN     platform admin
 *   HOLDER    investor holding ventures 7, 8 and 9 (confirmed)
 *   OTHER     investor holding venture 7 too, with their own offer
 *   OUTSIDER  investor holding nothing
 *
 *   7  live round, a deal on Axal, an offer recorded for HOLDER and OTHER
 *   8  live round, no deal on Axal, HOLDER's row with no offer amount
 *   9  no live round (its only round is closed)
 *
 * Mutation-checked (each fails a named assertion below):
 *   · the email match dropped from the row query → "only the caller's own offer"
 *   · an offer computed from the prior stake when none is recorded → "never computed from the stake"
 *   · the held check dropped → "not held: 403"
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_pro_rata_6908.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import proRata, { OFFER_NOT_RECORDED, ROUND_NOT_ON_AXAL } from '../src/routes/portfolio_pro_rata.ts';
import contacts from '../src/routes/contacts.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d6908-pro-rata-offer-0123456789';
const ADMIN = 1, HOLDER = 2, OTHER = 3, OUTSIDER = 4;

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status)
    VALUES (?, ?, ?, ?, ?, 1, ?, 'active')`);
  u.run(ADMIN, 'admin', null, 'Ada', 'ada@axal.example', 'free');
  u.run(HOLDER, 'investor', null, 'Hal', 'Hal@Angel.example', 'professional');
  u.run(OTHER, 'investor', null, 'Oli', 'oli@angel.example', 'professional');
  u.run(OUTSIDER, 'investor', null, 'Ola', 'ola@angel.example', 'professional');
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture Seven', 70), (8, 'p8', 'Venture Eight', 80), (9, 'p9', 'Venture Nine', 90);
    INSERT INTO deals (id, project_id, status) VALUES (70, 7, 'active'), (71, 7, 'funded'), (80, 8, 'funded'), (90, 9, 'funded');
    INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (${HOLDER}, 71), (${HOLDER}, 80), (${HOLDER}, 90), (${OTHER}, 71);
    INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES
      (1, 71, ${HOLDER}, 1000, 'confirmed'), (2, 80, ${HOLDER}, 1000, 'confirmed'), (3, 90, ${HOLDER}, 1000, 'confirmed'), (4, 71, ${OTHER}, 1000, 'confirmed');
    INSERT INTO raise_rounds (id, uid, project_id, name, target_amount, close_date, status) VALUES
      (1, 'r7', 7, 'Series A', 5000000, '2026-12-15', 'active'),
      (2, 'r8', 8, 'Seed extension', 1000000, NULL, 'active'),
      (3, 'r9', 9, 'Seed', 800000, '2025-06-30', 'closed');
    INSERT INTO raise_pro_rata (uid, project_id, round_id, holder_name, holder_email, prior_stake_pct, state, offer_cents, respond_by) VALUES
      ('h7', 7, 1, 'Hal', 'hal@angel.example', 6.2, 'offered', 31000000, '2026-11-30'),
      ('o7', 7, 1, 'Oli', 'oli@angel.example', 9.9, 'offered', 99900000, '2026-11-20'),
      ('h8', 8, 2, 'Hal', 'hal@angel.example', 4.0, 'offered', NULL, NULL);
  `);
  return db;
}

const app = new Hono<any>();
app.route('/api/portfolio-pro-rata', proRata);

async function call(db: DatabaseSync, userId: number, path: string) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api/portfolio-pro-rata${path}`, { headers: { Authorization: `Bearer ${token}` } }),
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  } catch (e) { if (e instanceof Response) res = e; else throw e; }
  const text = await res.text();
  let body: any = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

test('a live round with an offer: the amount, the day to respond by and the round link, for the caller only', async () => {
  const db = fixture();
  const res = await call(db, HOLDER, '/p7');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.live_round, { uid: 'r7', name: 'Series A', close_date: '2026-12-15', href: '/deals/70', href_not_recorded: null });
  assert.equal(res.body.offer.amount_cents, 31000000, 'up to $310,000');
  assert.equal(res.body.offer.respond_by, '2026-11-30');
  assert.equal(res.body.offer.currency, 'USD');
  assert.equal(res.body.offer.state, 'offered');
  assert.equal(res.body.offer_not_recorded, null);
  // mutation: email match dropped → the first row of the round (could be OTHER's).
  const other = await call(db, OTHER, '/p7');
  assert.equal(other.body.offer.amount_cents, 99900000, 'only the caller\'s own offer');
  assert.doesNotMatch(JSON.stringify(res.body), /oli@|Oli|99900000|9\.9/, 'another holder is never in the answer');
  assert.doesNotMatch(JSON.stringify(res.body), /prior_stake|6\.2/, 'the stake is not handed out');
});

test('a live round with no offer recorded reads "Offer not recorded", never one computed from the stake, and still links the round', async () => {
  const db = fixture();
  const res = await call(db, HOLDER, '/p8');
  assert.equal(res.status, 200);
  assert.equal(res.body.offer, null, 'never computed from the stake');
  assert.equal(res.body.offer_not_recorded, OFFER_NOT_RECORDED);
  assert.equal(res.body.live_round.uid, 'r8');
  assert.equal(res.body.live_round.href, null, 'no active deal on Axal: no guessed page');
  assert.equal(res.body.live_round.href_not_recorded, ROUND_NOT_ON_AXAL);
  // A live round where the caller has no row at all reads the same.
  db.exec(`DELETE FROM raise_pro_rata WHERE uid = 'h8'`);
  const none = await call(db, HOLDER, '/p8');
  assert.equal(none.body.offer, null); assert.equal(none.body.offer_not_recorded, OFFER_NOT_RECORDED);
});

test('a held company with no live round reads no round and no offer', async () => {
  const db = fixture();
  const res = await call(db, HOLDER, '/p9');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { project_uid: 'p9', live_round: null, offer: null });
});

test('not held, unknown, an admin and an account without the licence are refused', async () => {
  const db = fixture();
  // mutation: held check dropped → 200 here.
  assert.equal((await call(db, OUTSIDER, '/p7')).status, 403, 'not held: 403');
  assert.equal((await call(db, OUTSIDER, '/p7')).body.code, 'not_held');
  assert.equal((await call(db, OTHER, '/p8')).status, 403, 'holding one company does not open another');
  assert.equal((await call(db, HOLDER, '/nope')).body.code, 'not_held', 'unknown answers like not held');
  assert.equal((await call(db, ADMIN, '/p7')).body.code, 'investor_only');
});

test('the store refuses a zero or negative offer and a respond-by that is not a day', () => {
  const db = fixture();
  assert.throws(() => db.exec(`UPDATE raise_pro_rata SET offer_cents = 0 WHERE uid = 'h7'`), /CHECK/);
  assert.throws(() => db.exec(`UPDATE raise_pro_rata SET offer_cents = -5 WHERE uid = 'h7'`), /CHECK/);
  assert.throws(() => db.exec(`UPDATE raise_pro_rata SET respond_by = 'next week' WHERE uid = 'h7'`), /CHECK/);
  db.exec(`UPDATE raise_pro_rata SET offer_cents = NULL, respond_by = NULL WHERE uid = 'h7'`);
});

// ── The founder records the offer on the round manager (routes/contacts.ts) ──
const FOUNDER = 5;
async function founderCall(db: DatabaseSync, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: FOUNDER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await contacts.request(path, {
    method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

test('the founder records an offer and a respond-by day; the investor then reads them', async () => {
  const db = fixture();
  db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active) VALUES (?, 'founder', 80, 'Fay', 'fay@co.example', 1)`).run(FOUNDER);
  const id = (db.prepare(`SELECT id FROM raise_pro_rata WHERE uid = 'h8'`).get() as any).id;
  const bad = await founderCall(db, 'PUT', `/raise-pro-rata/${id}`, { offer_amount: -1 });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
  assert.equal((await founderCall(db, 'PUT', `/raise-pro-rata/${id}`, { respond_by: 'soon' })).status, 400);
  const put = await founderCall(db, 'PUT', `/raise-pro-rata/${id}`, { offer_amount: 120000, respond_by: '2026-12-01' });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(put.body.offer_cents, 12000000);
  assert.equal(put.body.respond_by, '2026-12-01');
  const read = await call(db, HOLDER, '/p8');
  assert.equal(read.body.offer.amount_cents, 12000000);
  assert.equal(read.body.offer.respond_by, '2026-12-01');
  // A later edit that does not name the offer keeps it; '' clears it.
  assert.equal((await founderCall(db, 'PUT', `/raise-pro-rata/${id}`, { notes: 'called' })).body.offer_cents, 12000000);
  assert.equal((await founderCall(db, 'PUT', `/raise-pro-rata/${id}`, { offer_amount: '' })).body.offer_cents, null);
  assert.equal((await call(db, HOLDER, '/p8')).body.offer_not_recorded, OFFER_NOT_RECORDED);
});

test('a withdrawn listing is never offered as the round to open (D5454)', async () => {
  const db = fixture();
  db.exec(`INSERT INTO deal_preparations (id, uid, scope_code, company_id, project_id, deal_id, origin, preparation_state, publication_state, created_by_user_id, released_revision_id, released_at)
    VALUES (1, 'dp70', 'hq', 70, 7, 70, 'preparation', 'approved', 'withdrawn', ${ADMIN}, 1, '2026-10-01 00:00:00')`);
  const res = await call(db, HOLDER, '/p7');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.live_round.href, null, 'a withdrawn listing is not linked');
  assert.equal(res.body.live_round.href_not_recorded, ROUND_NOT_ON_AXAL);
  assert.equal(res.body.offer.amount_cents, 31000000, 'the offer still reads');
});
