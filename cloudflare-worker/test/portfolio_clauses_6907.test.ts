/**
 * D6907 (#6907, Worker part): the clauses of an investor's own signed documents
 * for one company, by right type (`services/signedClauses.ts`,
 * `routes/portfolio_clauses.ts`).
 *
 * Real schema (`loadSchema`), real route, synthetic fixtures and synthetic
 * agreement text:
 *   ADMIN     platform admin
 *   HOLDER    investor holding venture 7, with two signed envelopes and one sent (unsigned)
 *   OTHER     investor holding venture 7 too, with their own signed envelope
 *   OUTSIDER  investor holding nothing
 *
 * Mutation-checked (each fails a named assertion below):
 *   · the hash check dropped → "a body that does not match is not read"
 *   · the investor filter dropped from the envelope query → "only the caller's own documents"
 *   · the `completed` filter dropped → "an unsigned envelope is not read"
 *   · the held check dropped → "not held: 403"
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolio_clauses_6907.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import clauses from '../src/routes/portfolio_clauses.ts';
import { splitClauses, matchRights, UNREADABLE_HASH, UNREADABLE_NO_BODY, CLAUSE_TEXT_MAX } from '../src/services/signedClauses.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-d6907-signed-clauses-0123456789';
const ADMIN = 1, HOLDER = 2, OTHER = 3, OUTSIDER = 4;

const IRA = [
  '# Investors’ Rights Agreement (synthetic)',
  '',
  '1. Definitions',
  'Terms used here have the meanings given in the purchase agreement.',
  '',
  '2.1 Delivery of Financial Statements',
  'The Company shall deliver to each Major Investor unaudited financial statements within 30 days after each month.',
  '',
  '\f3.3 Board Observer',
  'The Company shall invite one representative of the Investor to attend all meetings of its Board of Directors in a nonvoting observer capacity.',
  '',
  '4.1 Right of First Offer',
  'Each Major Investor has a pro rata right to purchase its share of New Securities the Company may propose to sell.',
].join('\n');
const SIDE = 'Side Letter (synthetic)\n\nThe Investor may designate one person to serve as a director of the Company.';
const OTHERS = 'Section 7 Anti-dilution\nThe conversion price is adjusted on a broad-based weighted average basis.';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare(`INSERT INTO users (id, role, founder_id, name, email, is_active, investor_tier, investor_subscription_status)
    VALUES (?, ?, ?, ?, ?, 1, ?, 'active')`);
  u.run(ADMIN, 'admin', null, 'Ada', 'ada@axal.example', 'free');
  u.run(HOLDER, 'investor', null, 'Hal', 'hal@angel.example', 'professional');
  u.run(OTHER, 'investor', null, 'Oli', 'oli@angel.example', 'professional');
  u.run(OUTSIDER, 'investor', null, 'Ola', 'ola@angel.example', 'professional');
  db.exec(`
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'p7', 'Venture Seven', 70);
    INSERT INTO deals (id, project_id, status) VALUES (70, 7, 'funded');
    INSERT INTO investor_dealroom_members (investor_user_id, deal_id) VALUES (${HOLDER}, 70), (${OTHER}, 70);
    INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (1, 70, ${HOLDER}, 1000, 'confirmed'), (2, 70, ${OTHER}, 1000, 'confirmed');
    INSERT INTO closings (id, deal_id, project_id, status, created_by) VALUES (1, 70, 7, 'closed', 1), (2, 70, 7, 'closed', 1), (3, 70, 7, 'open', 1);
  `);
  const env = db.prepare(`INSERT INTO esign_envelopes (id, envelope_uuid, user_id, deal_id, document_type, document_title, document_body, body_sha256, status, created_by, completed_at)
    VALUES (?, ?, ?, 70, ?, ?, ?, ?, ?, 1, ?)`);
  env.run(11, 'env-ira', HOLDER, 'voting_rights', 'Investors’ Rights Agreement', IRA, sha(IRA), 'completed', '2026-06-01 10:00:00');
  env.run(12, 'env-side', HOLDER, 'side_letter', 'Side Letter', SIDE, sha(SIDE), 'completed', '2026-06-02 10:00:00');
  env.run(13, 'env-draft', HOLDER, 'term_sheet', 'Term Sheet', 'Section 9 Liquidation preference\nA liquidation preference of 1x applies.', sha('Section 9 Liquidation preference\nA liquidation preference of 1x applies.'), 'sent', null);
  env.run(14, 'env-other', OTHER, 'voting_rights', 'Their Agreement', OTHERS, sha(OTHERS), 'completed', '2026-06-03 10:00:00');
  const line = db.prepare(`INSERT INTO closing_lines (id, closing_id, commitment_id, investor_user_id, amount_cents, envelope_id, status, created_by) VALUES (?, ?, ?, ?, 100000, ?, ?, 1)`);
  line.run(1, 1, 1, HOLDER, 11, 'received');
  line.run(2, 2, 1, HOLDER, 12, 'received');
  line.run(3, 3, 1, HOLDER, 13, 'received');
  line.run(4, 1, 2, OTHER, 14, 'received');
  return db;
}

const app = new Hono<any>();
app.route('/api/portfolio-clauses', clauses);
async function call(db: DatabaseSync, userId: number, path: string) {
  const role = (db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as any)?.role ?? 'founder';
  const token = await new SignJWT({ user_id: userId, role }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  let res: Response;
  try {
    res = await app.fetch(new Request(`http://t/api/portfolio-clauses${path}`, { headers: { Authorization: `Bearer ${token}` } }),
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  } catch (e) { if (e instanceof Response) res = e; else throw e; }
  const text = await res.text();
  let body: any = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

test('splitClauses: numbered and headed clauses, their lines and pages where the body marks them', () => {
  const cs = splitClauses(IRA);
  assert.deepEqual(cs.map((c) => c.number), [null, '1', '2.1', '3.3', '4.1']);
  const obs = cs.find((c) => c.number === '3.3')!;
  assert.equal(obs.heading, 'Board Observer');
  assert.equal(obs.line, 9);
  assert.equal(obs.page, 2, 'the form feed before 3.3 starts page 2');
  assert.equal(cs.find((c) => c.number === '2.1')!.page, 1);
  assert.equal(splitClauses(SIDE)[0].page, null, 'no page marks: the page is null, never guessed');
  assert.equal(splitClauses('§ 5 Term\nx')[0].number, '5');
  assert.equal(splitClauses(`1. Long\n${'x'.repeat(5000)}`)[0].text.length, CLAUSE_TEXT_MAX);
});

test('matchRights: each clause is matched to the rights it writes, and only those', () => {
  const m = matchRights(splitClauses(IRA));
  assert.deepEqual(m.map((x) => `${x.number}:${x.right_type}`), ['2.1:information_rights', '3.3:observer_seat', '4.1:pro_rata']);
  assert.deepEqual(matchRights(splitClauses(SIDE)).map((x) => x.right_type), ['board_seat']);
  assert.deepEqual(matchRights(splitClauses(OTHERS)).map((x) => x.right_type), ['anti_dilution']);
  assert.deepEqual(matchRights(splitClauses(IRA), ['observer_seat']).map((x) => x.number), ['3.3']);
});

test('GET: the holder reads their own signed documents, newest first, with clause text and location only', async () => {
  const db = fixture();
  const res = await call(db, HOLDER, '/p7');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  // mutation: investor filter dropped → env-other appears.
  assert.deepEqual(res.body.documents.map((d: any) => d.envelope_uuid), ['env-side', 'env-ira'], "only the caller's own documents");
  // mutation: completed filter dropped → env-draft appears.
  assert.equal(JSON.stringify(res.body).includes('env-draft'), false, 'an unsigned envelope is not read');
  const ira = res.body.documents[1];
  assert.equal(ira.readable, true);
  const obs = ira.clauses.find((x: any) => x.right_type === 'observer_seat');
  assert.deepEqual({ number: obs.number, heading: obs.heading, page: obs.page, line: obs.line }, { number: '3.3', heading: 'Board Observer', page: 2, line: 9 });
  assert.match(obs.text, /nonvoting observer capacity/);
  assert.equal(JSON.stringify(res.body).includes('Terms used here'), false, 'a clause with no right is never returned');
  assert.equal('document_body' in ira, false, 'the body is never handed out');
  assert.deepEqual(res.body.summary, { documents: 2, unreadable: 0, clauses_by_type: {
    pro_rata: 1, information_rights: 1, board_seat: 1, observer_seat: 1, liquidation_preference: 0, anti_dilution: 0 } });
});

test('a body that does not match its signed hash, or is missing, is "cannot be read", never "none found"', async () => {
  const db = fixture();
  db.exec(`UPDATE esign_envelopes SET document_body = document_body || ' (edited)' WHERE id = 11`);
  db.exec(`UPDATE esign_envelopes SET document_body = '' WHERE id = 12`);
  const res = await call(db, HOLDER, '/p7');
  const [side, ira] = res.body.documents;
  // mutation: hash check dropped → readable with clauses.
  assert.equal(ira.readable, false, 'a body that does not match is not read');
  assert.equal(ira.unreadable_reason, UNREADABLE_HASH);
  assert.deepEqual(ira.clauses, []);
  assert.equal(side.readable, false); assert.equal(side.unreadable_reason, UNREADABLE_NO_BODY);
  assert.equal(res.body.summary.unreadable, 2);
});

test('?type narrows the rights; an unknown type is 400', async () => {
  const db = fixture();
  const res = await call(db, HOLDER, '/p7?type=observer_seat,pro_rata');
  assert.deepEqual(res.body.types, ['observer_seat', 'pro_rata']);
  assert.deepEqual(res.body.documents.flatMap((d: any) => d.clauses.map((x: any) => x.right_type)).sort(), ['observer_seat', 'pro_rata']);
  assert.deepEqual(res.body.summary.clauses_by_type, { observer_seat: 1, pro_rata: 1 });
  assert.equal((await call(db, HOLDER, '/p7?type=voting_power')).body.code, 'bad_type');
});

test('not held, unknown, an admin are refused', async () => {
  const db = fixture();
  // mutation: held check dropped → 200 here.
  assert.equal((await call(db, OUTSIDER, '/p7')).status, 403, 'not held: 403');
  assert.equal((await call(db, OUTSIDER, '/p7')).body.code, 'not_held');
  assert.equal((await call(db, HOLDER, '/nope')).body.code, 'not_held');
  assert.equal((await call(db, ADMIN, '/p7')).body.code, 'investor_only');
});
