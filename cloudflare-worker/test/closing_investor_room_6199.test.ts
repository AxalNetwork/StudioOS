/**
 * D6199 (#6199) — the investor's own part of a closing read (`for_investor`):
 *
 *   · open: the steps that wait on this investor (sign their stage, send the
 *     payment once the paper is signed), and of the rest a count only;
 *   · closed: their amount, signed and received days, their own signed copy,
 *     and the reporting duties on their own line;
 *   · refused: another investor's line, paper or duty never reaches them; a
 *     founder and an Admin get `for_investor: null`; an investor with no line
 *     and an Operating Partner get the 404 of a closing that does not exist.
 *
 * No network: `fetch` throws and is counted. Every name and figure is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/closing_investor_room_6199.test.ts
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
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIG = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const app = new Hono<any>();
app.route('/api/closings', closings);
app.onError((err: any, c) => {
  if (err instanceof Response) return err;
  const status = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return c.json({ detail: err?.message }, status ?? 500);
});

let fetches = 0;
const realFetch = globalThis.fetch;
beforeEach(() => { fetches = 0; globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in D6199'); }) as any; });
afterEach(() => { globalThis.fetch = realFetch; assert.equal(fetches, 0, 'fetch was called'); });

const ADMIN = 1, FOUNDER = 3, PARTNER = 5, INV_A = 6, INV_B = 7, INV_C = 8;
const ROLE: Record<number, string> = { 1: 'admin', 3: 'founder', 5: 'partner', 6: 'investor', 7: 'investor', 8: 'investor' };

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of ['312_fund_call_ledger.sql', '335_deal_transfers_and_closing_checklists.sql', '340_deal_transfer_company.sql',
    '410_safe_issuances.sql', '599_deal_currency.sql']) db.exec(MIG(f));
  db.exec('ALTER TABLE raise_prospects ADD COLUMN amount_cents INTEGER');
  db.exec(`
    INSERT INTO founders (id, name, email) VALUES (31, 'Fay Founder', 'fay@example.test');
    INSERT INTO users (id, role, name, email, founder_id) VALUES
      (1, 'admin', 'Ada Admin', 'ada@example.test', NULL), (3, 'founder', 'Fay Founder', 'fay@example.test', 31),
      (5, 'partner', 'Pia Partner', 'pia@example.test', NULL), (6, 'investor', 'Ivy Alpha', 'ivy@example.test', NULL),
      (7, 'investor', 'Ben Beta', 'ben@example.test', NULL), (8, 'investor', 'Cal Gamma', 'cal@example.test', NULL);
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'proj-fixture-7', 'Fixture Venture', 31);
    INSERT INTO deals (id, uid, project_id, status, instrument, closing_deadline) VALUES (41, 'd-41', 7, 'active', 'safe', '2026-12-01');
    INSERT INTO commitments (id, uid, deal_id, investor_user_id, amount, status) VALUES
      (101, 'cm-a', 41, 6, 250000.5, 'confirmed'), (102, 'cm-b', 41, 7, 125000, 'pending'), (103, 'cm-c', 41, 8, 50000, 'withdrawn');
  `);
  db.exec(MIG('612_closings.sql'));
  db.exec(MIG('579_reporting_duties.sql'));
  db.exec(MIG('633_staged_signing.sql'));
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

/** A staged envelope on one commitment: each stage [role, user, signed_at | null, esign status | null]. */
function paper(db: DatabaseSync, commitment: number, stages: Array<[string, number | null, string | null, string | null]>) {
  const staged = Number(db.prepare(
    "INSERT INTO esign_staged_envelopes (deal_id, commitment_id, document_type, title, body, digest, created_by) VALUES (41, ?, 'safe', 'SAFE', 'text', ?, 1)",
  ).run(commitment, 'a'.repeat(64)).lastInsertRowid);
  stages.forEach(([role, user, signedAt, status], i) => {
    let uuid: string | null = null;
    if (status) {
      uuid = `env-${commitment}-${staged}-${i + 1}`;
      db.prepare(
        `INSERT INTO esign_envelopes (envelope_uuid, user_id, deal_id, document_type, document_title, document_body, body_sha256, status, signed_r2_key, created_by)
         VALUES (?, ?, 41, 'safe', 'SAFE', 'text', 'x', ?, ?, 1)`,
      ).run(uuid, user, status, status === 'completed' ? `esign/signed/${uuid}.pdf` : null);
    }
    db.prepare('INSERT INTO esign_staged_signers (staged_id, position, role, user_id, envelope_uuid, sent_at, signed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(staged, i + 1, role, user, uuid, uuid ? '2026-10-10 09:00:00' : null, signedAt);
  });
}

const esignId = (db: DatabaseSync, uuidLike: string) => Number((db.prepare('SELECT id FROM esign_envelopes WHERE envelope_uuid LIKE ?').get(uuidLike) as any).id);

async function opened() {
  const db = freshDb();
  const r = await call(db, 'POST', '/api/closings', ADMIN, { deal_id: 41, round_label: 'Seed', deadline: '2026-12-01' });
  assert.equal(r.status, 201, r.text);
  const lines = Object.fromEntries(r.body.lines.map((l: any) => [l.investor_user_id, l.uid])) as Record<number, string>;
  db.exec("UPDATE closing_lines SET route = 'direct'");
  return { db, uid: r.body.uid as string, lines };
}

test('open: the deadline, the step that waits on this investor, and a count of the rest, never another line', async () => {
  const { db, uid, lines } = await opened();
  // A: the company signed, the investor's stage is sent to A. B: the investor's stage is sent to B.
  paper(db, 101, [['company', FOUNDER, '2026-10-09 10:00:00', 'completed'], ['investor', INV_A, null, 'sent']]);
  paper(db, 102, [['company', FOUNDER, '2026-10-09 10:00:00', 'completed'], ['investor', INV_B, null, 'sent']]);

  const a = await call(db, 'GET', `/api/closings/${uid}`, INV_A);
  assert.equal(a.status, 200, a.text);
  assert.equal(a.body.deadline, '2026-12-01', 'the investor’s read carries the deadline');
  const fi = a.body.for_investor;
  assert.equal(fi.project_uid, 'proj-fixture-7');
  assert.deepEqual(fi.conditions.waiting_on_you, [{ line_uid: lines[INV_A], step: 'sign' }]);
  // A's own line: the payment (after signing) and the receipt; B's line, not received; the round: Mark Closed.
  assert.deepEqual(fi.conditions.rest, { your_lines: 2, other_lines: 1, round: 1 });
  assert.equal(fi.conditions.rest_count, 4);
  assert.deepEqual(fi.summary.map((s: any) => [s.line_uid, s.amount_cents, s.signed_at, s.received_at, s.signed_copy]),
    [[lines[INV_A], 25000050, null, null, null]]);
  assert.deepEqual(fi.reporting, { state: 'not_closed', duties: [] });
  assert.ok(!a.text.includes(lines[INV_B]), 'B’s line uid never reaches A');
  assert.doesNotMatch(a.text, /Ben Beta|12500000|env-102-/);

  // Once A has signed, sending the payment waits on A.
  db.exec(`UPDATE esign_staged_signers SET signed_at = '2026-10-11 12:00:00' WHERE role = 'investor' AND user_id = ${INV_A}`);
  db.exec(`UPDATE esign_envelopes SET status = 'completed', signed_r2_key = 'esign/signed/a.pdf' WHERE user_id = ${INV_A}`);
  const a2 = (await call(db, 'GET', `/api/closings/${uid}`, INV_A)).body.for_investor;
  assert.deepEqual(a2.conditions.waiting_on_you, [{ line_uid: lines[INV_A], step: 'send_payment' }]);
  assert.deepEqual(a2.conditions.rest, { your_lines: 1, other_lines: 1, round: 1 });

  // B sees only B's step.
  const b = await call(db, 'GET', `/api/closings/${uid}`, INV_B);
  assert.deepEqual(b.body.for_investor.conditions.waiting_on_you, [{ line_uid: lines[INV_B], step: 'sign' }]);
  assert.ok(!b.text.includes(lines[INV_A]), 'A’s line uid never reaches B');
  assert.doesNotMatch(b.text, /Ivy Alpha|25000050|env-101-/);
});

test('open: a stage sent to someone else, or a void one, is not the investor’s turn', async () => {
  const { db, uid } = await opened();
  paper(db, 101, [['company', FOUNDER, null, 'sent'], ['investor', INV_A, null, null]]);
  const a = (await call(db, 'GET', `/api/closings/${uid}`, INV_A)).body.for_investor;
  assert.deepEqual(a.conditions.waiting_on_you, [], 'the company signs first');
  db.exec("DELETE FROM esign_staged_signers; DELETE FROM esign_staged_envelopes; DELETE FROM esign_envelopes;");
  paper(db, 101, [['company', FOUNDER, '2026-10-09', 'completed'], ['investor', INV_A, null, 'void']]);
  const v = (await call(db, 'GET', `/api/closings/${uid}`, INV_A)).body.for_investor;
  assert.deepEqual(v.conditions.waiting_on_you, [], 'a void stage is never a turn to sign');
  db.exec("DELETE FROM esign_staged_signers; DELETE FROM esign_staged_envelopes; DELETE FROM esign_envelopes;");
  paper(db, 101, [['company', FOUNDER, '2026-10-09', 'completed'], ['investor', INV_C, null, 'sent']]);
  const o = (await call(db, 'GET', `/api/closings/${uid}`, INV_A)).body.for_investor;
  assert.deepEqual(o.conditions.waiting_on_you, [], 'an investor stage addressed to someone else is not this investor’s turn');
});

test('closed: amount, signed and received days, the investor’s own signed copy, and the duties on their own line only', async () => {
  const { db, uid, lines } = await opened();
  paper(db, 101, [['company', FOUNDER, '2026-10-09 10:00:00', 'completed'], ['investor', INV_A, '2026-10-11 12:00:00', 'completed']]);
  paper(db, 102, [['company', FOUNDER, '2026-10-09 10:00:00', 'completed'], ['investor', INV_B, '2026-10-12 12:00:00', 'completed']]);
  const lineId = (u: number) => Number((db.prepare('SELECT id FROM closing_lines WHERE investor_user_id = ?').get(u) as any).id);
  db.prepare("INSERT INTO closing_evidence (line_id, kind, side, source_ref, recorded_by, created_at) VALUES (?, 'investor_mercury', 'sending', 'mercury:s1', 1, '2026-10-13 09:00:00')").run(lineId(INV_A));
  db.prepare("INSERT INTO closing_evidence (line_id, kind, side, source_ref, recorded_by, created_at) VALUES (?, 'company_mercury', 'receiving', 'mercury:r1', 1, '2026-10-15 14:02:00')").run(lineId(INV_A));
  db.prepare("INSERT INTO closing_evidence (line_id, kind, side, source_ref, recorded_by, created_at) VALUES (?, 'company_mercury', 'receiving', 'mercury:r2', 1, '2026-10-16 10:00:00')").run(lineId(INV_B));
  db.exec("UPDATE closing_lines SET status = 'received'");
  db.exec("UPDATE closings SET status = 'closed', closed_at = '2026-11-02 10:00:00', captable_state = 'accepted'");
  const duty = (u: number, kind: string, cadence: string, clause: string, defaulted = '[]') => db.prepare(
    `INSERT INTO reporting_duties (uid, closing_id, closing_line_id, closing_line_uid, project_id, holder_user_id, kind, cadence, due_days, source_document, source_clause, source_kind, defaulted_json, starts_on)
     VALUES (?, 1, ?, ?, 7, ?, ?, ?, 45, 'voting_rights', ?, 'signed_envelope', ?, '2026-11-02')`,
  ).run(`duty-${u}-${kind}`, lineId(u), lines[u], u, kind, cadence, clause, defaulted);
  duty(INV_A, 'quarterly_update', 'quarterly', 'Investors’ Rights Agreement §1.1(c)');
  duty(INV_A, 'annual_budget', 'annual', 'Investors’ Rights Agreement §1.1(d)', '["due_days"]');
  duty(INV_B, 'monthly_financials', 'monthly', 'Investors’ Rights Agreement §1.1(a)');

  const a = await call(db, 'GET', `/api/closings/${uid}`, INV_A);
  const fi = a.body.for_investor;
  assert.deepEqual(fi.summary, [{
    line_uid: lines[INV_A], amount_cents: 25000050, currency: 'USD', signed_at: '2026-10-11 12:00:00', received_at: '2026-10-15 14:02:00',
    signed_copy: { envelope_id: esignId(db, 'env-101-%-2') },
  }]);
  assert.equal(fi.reporting.state, 'ok');
  assert.deepEqual(fi.reporting.duties.map((d: any) => [d.uid, d.line_uid, d.title, d.cadence, d.source.clause, d.defaulted]), [
    [`duty-${INV_A}-quarterly_update`, lines[INV_A], 'Quarterly investor update', 'quarterly', 'Investors’ Rights Agreement §1.1(c)', []],
    [`duty-${INV_A}-annual_budget`, lines[INV_A], 'Annual budget', 'annual', 'Investors’ Rights Agreement §1.1(d)', ['due_days']],
  ]);
  assert.deepEqual(fi.conditions, { waiting_on_you: [], rest: { your_lines: 0, other_lines: 0, round: 0 }, rest_count: 0 });
  assert.doesNotMatch(a.text, new RegExp(`duty-${INV_B}|§1\\.1\\(a\\)|env-102-|Ben Beta|12500000`), 'nothing of B’s line, paper or duty');

  const b = (await call(db, 'GET', `/api/closings/${uid}`, INV_B)).body.for_investor;
  assert.deepEqual(b.reporting.duties.map((d: any) => d.uid), [`duty-${INV_B}-monthly_financials`]);
  assert.deepEqual(b.summary[0].signed_copy, { envelope_id: esignId(db, 'env-102-%-2') });

  // A duty held by someone else on A's own line is not A's either.
  db.prepare(
    `INSERT INTO reporting_duties (uid, closing_id, closing_line_id, closing_line_uid, project_id, holder_user_id, kind, cadence, due_days, source_document, source_clause, source_kind, starts_on)
     VALUES ('duty-stray', 1, ?, ?, 7, ?, 'quarterly_kpi', 'quarterly', 45, 'voting_rights', 'x', 'signed_envelope', '2026-11-02')`,
  ).run(lineId(INV_A), lines[INV_A], INV_C);
  assert.ok(!(await call(db, 'GET', `/api/closings/${uid}`, INV_A)).text.includes('duty-stray'));
  // Nor is a duty naming A as holder on B's line.
  db.prepare(
    `INSERT INTO reporting_duties (uid, closing_id, closing_line_id, closing_line_uid, project_id, holder_user_id, kind, cadence, due_days, source_document, source_clause, source_kind, starts_on)
     VALUES ('duty-crossed', 1, ?, ?, 7, ?, 'quarterly_kpi', 'quarterly', 45, 'voting_rights', 'x', 'signed_envelope', '2026-11-02')`,
  ).run(lineId(INV_B), lines[INV_B], INV_A);
  const crossed = await call(db, 'GET', `/api/closings/${uid}`, INV_A);
  assert.ok(!crossed.text.includes('duty-crossed') && !crossed.text.includes(lines[INV_B]));
});

test('closed: a duties read that fails says unreadable, and the rest of the read still answers', async () => {
  const { db, uid } = await opened();
  db.exec("UPDATE closing_lines SET status = 'received'; UPDATE closings SET status = 'closed', closed_at = '2026-11-02 10:00:00', captable_state = 'accepted'");
  db.exec('DROP TABLE reporting_duties');
  const a = await call(db, 'GET', `/api/closings/${uid}`, INV_A);
  assert.equal(a.status, 200, a.text);
  assert.deepEqual(a.body.for_investor.reporting, { state: 'unreadable', duties: [] });
  assert.equal(a.body.for_investor.summary.length, 1);
});

test('refused: the founder and an Admin get no investor part; an investor with no line and an Operating Partner get nothing', async () => {
  const { db, uid } = await opened();
  for (const who of [FOUNDER, ADMIN]) {
    const r = await call(db, 'GET', `/api/closings/${uid}`, who);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.reach, 'all');
    assert.equal(r.body.for_investor, null);
  }
  for (const who of [INV_C, PARTNER]) {
    const r = await call(db, 'GET', `/api/closings/${uid}`, who);
    assert.equal(r.status, 404, `${who}: the 404 of a closing that does not exist`);
    assert.doesNotMatch(r.text, /for_investor|waiting_on_you|proj-fixture-7|Fixture Venture/);
  }
});

test('the source: every query is bound, and neither the checklist nor IC conditions is read for an investor', () => {
  const src = read('cloudflare-worker/src/services/closingInvestorRoom.ts');
  assert.doesNotMatch(src, /prepare\(`[^`]*\$\{/, 'no value spliced into SQL');
  assert.doesNotMatch(src, /FROM\s+(deal_closing_checklist_items|deal_closing_checklists|ic_conditions)\b/);
  assert.match(read('cloudflare-worker/src/services/closings.ts'), /if \(reach === 'own'\) \{\s*try \{\s*forInvestor = await \(await import\('\.\/closingInvestorRoom'\)\)\.investorRoom/);
});

test('open: a paper read that fails makes only the investor part Unreadable; the line and the total still answer', async () => {
  const { db, uid } = await opened();
  db.exec('DROP TABLE esign_staged_signers');
  const a = await call(db, 'GET', `/api/closings/${uid}`, INV_A);
  assert.equal(a.status, 200, a.text);
  assert.deepEqual(a.body.for_investor, { unreadable: true });
  assert.equal(a.body.lines.length, 1);
  assert.equal(a.body.total_cents, 37500050);
});
