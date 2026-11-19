/**
 * #6157 (D6157) — `GET /api/deals/closing-overview`: the Closing zone's per-deal rows in one read.
 *
 *   · an investor receives only the funded deals they may read, and only their own closing line;
 *   · an admin receives every funded deal, with every executed envelope and every open condition;
 *   · a caller with no deals receives an empty list, not a refusal;
 *   · a part that cannot be read is `unreadable` for that part, never 0, and the others still answer;
 *   · another firm's open condition holds the deal without a number (as `transfer-gate` says).
 *
 * The real router over the baseline schema and the migrations it reads, in in-memory SQLite.
 * Every name and figure here is invented.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deal_closing_overview_6157.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { d1Over } from './_d1_sqlite.mjs';
import overview, { OVERVIEW_REASONS, checklistPart, envelopesPart } from '../src/routes/deal_closing_overview.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIG = (f: string) => read(`cloudflare-worker/sql/migrations/${f}`);
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const app = new Hono<any>();
app.route('/api/deals', overview);
app.onError((err: any, c) => {
  if (err instanceof Response) return err;
  const status = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return c.json({ detail: err?.message }, status ?? 500);
});

const ADMIN = 1, FOUNDER = 3, INV_A = 6, INV_B = 7, INV_NONE = 8;
const ROLE: Record<number, string> = { 1: 'admin', 3: 'founder', 6: 'investor', 7: 'investor', 8: 'investor' };
// 41 and 42 are funded (at closing); 43 is active (not at closing); 44 is funded on a deleted venture.
const DEAL = 41, OTHER_DEAL = 42, ACTIVE_DEAL = 43, DELETED_DEAL = 44;

function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of ['312_fund_call_ledger.sql', '410_safe_issuances.sql', '334_ic_conditions_and_minutes.sql', '335_deal_transfers_and_closing_checklists.sql', '340_deal_transfer_company.sql',
    '599_deal_currency.sql', '202611140938_6156_deals_v2_owner_due_history.sql', '202611161505_6195_commitment_route_preference.sql']) db.exec(MIG(f));
  db.exec('ALTER TABLE raise_prospects ADD COLUMN amount_cents INTEGER');
  db.exec(`
    INSERT INTO founders (id, name, email) VALUES (31, 'Fay Founder', 'fay@example.test'), (32, 'Otis Other', 'otis@example.test');
    INSERT INTO users (id, role, name, email, founder_id) VALUES
      (1, 'admin', 'Ada Admin', 'ada@example.test', NULL), (3, 'founder', 'Fay Founder', 'fay@example.test', 31),
      (6, 'investor', 'Ivy Alpha', 'ivy@example.test', NULL), (7, 'investor', 'Ben Beta', 'ben@example.test', NULL),
      (8, 'investor', 'Cal Gamma', 'cal@example.test', NULL);
    INSERT INTO projects (id, name, founder_id, deleted_at) VALUES
      (7, 'Fixture Venture', 31, NULL), (8, 'Other Venture', 32, NULL), (9, 'Third Venture', 32, NULL), (10, 'Gone Venture', 32, '2026-11-01');
    INSERT INTO deals (id, uid, project_id, status, currency) VALUES
      (41, 'd-41', 7, 'funded', 'USD'), (42, 'd-42', 8, 'funded', 'EUR'), (43, 'd-43', 9, 'active', 'USD'), (44, 'd-44', 10, 'funded', 'USD');
    INSERT INTO commitments (id, uid, deal_id, investor_user_id, amount, status) VALUES
      (101, 'cm-a', 41, 6, 250000, 'confirmed'), (102, 'cm-b', 41, 7, 125000, 'pending'),
      (103, 'cm-c', 43, 6, 10000, 'confirmed'), (104, 'cm-d', 44, 6, 10000, 'confirmed');
    INSERT INTO deal_invitations (deal_id, investor_user_id) VALUES (42, 7);
  `);
  db.exec(MIG('612_closings.sql'));
  db.exec(MIG('202611151545_6198_closing_sender_declarations.sql'));
  db.exec(`
    -- The checklist on 41: two counted items, one done; the skipped one counts neither way.
    INSERT INTO deal_closing_checklists (id, uid, deal_id, template_slug, applied_by) VALUES (1, 'cl-1', 41, 'safe', 1);
    INSERT INTO deal_closing_checklist_items (uid, checklist_id, label, state, sort) VALUES
      ('i-1', 1, 'Board consent', 'done', 1), ('i-2', 1, 'Wire instructions', 'pending', 2), ('i-3', 1, 'Side letter', 'skipped', 3);
    -- Paper on 41: one executed envelope Ben signed; one out for signature, Ivy still to sign of two.
    INSERT INTO esign_envelopes (id, envelope_uuid, user_id, deal_id, document_type, document_title, document_body, body_sha256, status, created_by) VALUES
      (501, 'env-501', NULL, 41, 'safe', 'SAFE — Ben', 'body', 'sha', 'completed', 1),
      (502, 'env-502', NULL, 41, 'safe', 'SAFE — Ivy', 'body', 'sha', 'sent', 1),
      (503, 'env-503', NULL, 42, 'spa', 'SPA — Other', 'body', 'sha', 'sent', 1);
    INSERT INTO esign_recipients (envelope_id, user_id, recipient_email, signing_token, token_expires_at, status) VALUES
      (501, 7, 'ben@example.test', 't-501', '2027-01-01', 'signed'),
      (502, 6, 'ivy@example.test', 't-502a', '2027-01-01', 'pending'),
      (502, 1, 'ada@example.test', 't-502b', '2027-01-01', 'signed');
    -- An IC decision on 41 by the admin's firm (900), with one open condition and one met.
    INSERT INTO ic_decisions (id, uid, project_id, deal_id, title, status, created_by, company_id) VALUES
      (61, 'dec-61', 7, 41, 'Seed', 'approved', 1, 900);
    INSERT INTO ic_conditions (uid, ic_decision_id, body, status, created_by) VALUES
      ('c-1', 61, 'Board seat letter signed', 'open', 1), ('c-2', 61, 'Cap table reconciled', 'met', 1);
    INSERT INTO deal_transfers (uid, deal_id, amount_cents, recorded_by) VALUES ('t-1', 41, 25000000, 1);
    -- The closing on 41 with a line for Ivy and one for Ben.
    INSERT INTO closings (id, uid, deal_id, project_id, created_by) VALUES (1, 'closing-41', 41, 7, 1);
    INSERT INTO closing_lines (uid, closing_id, commitment_id, investor_user_id, amount_cents, status, created_by) VALUES
      ('line-ivy', 1, 101, 6, 25000000, 'sent', 1), ('line-ben', 1, 102, 7, 12500000, 'open', 1);
  `);
  return db;
}

async function token(user: number) {
  return new SignJWT({ user_id: user, role: ROLE[user] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}

async function overviewAs(db: DatabaseSync, as: number) {
  const res = await app.request('/api/deals/closing-overview', { headers: { Authorization: `Bearer ${await token(as)}` } },
    { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}
const byId = (body: any) => Object.fromEntries((body?.deals || []).map((d: any) => [d.id, d]));

test('an investor receives only the funded deals they may read, and only their own closing line', async () => {
  const db = freshDb();
  const r = await overviewAs(db, INV_A);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.deals.map((d: any) => d.id), [DEAL], 'not the active deal, the deleted venture or a deal with no relationship');
  const row = r.body.deals[0];
  assert.deepEqual([row.name, row.currency, row.capital_committed], ['Fixture Venture', 'USD', 250000]);
  assert.deepEqual(row.checklist, { state: 'recorded', done: 1, total: 2 });
  assert.deepEqual(row.envelopes, { state: 'recorded', executed: 0, total: 1, signatures_outstanding: 1, uncounted: 0 },
    'only the envelope Ivy is asked to sign; Ben’s executed paper is not hers');
  assert.deepEqual(row.conditions, { state: 'recorded', open: 0, held: true }, 'another firm’s condition holds the deal without a number');
  assert.deepEqual(row.transfer, { state: 'recorded', recorded: true, count: 1 });
  assert.deepEqual(row.closing, { state: 'recorded', uid: 'closing-41', status: 'open', reach: 'own', own_lines: [{ uid: 'line-ivy', status: 'sent' }] });
  assert.doesNotMatch(r.text, /line-ben|Ben Beta|12500000/, 'no other investor’s line, name or amount');
});

test('another investor reads their own deals and their own line, not the first investor’s', async () => {
  const db = freshDb();
  const r = await overviewAs(db, INV_B);
  assert.equal(r.status, 200, r.text);
  const rows = byId(r.body);
  assert.deepEqual(Object.keys(rows).map(Number).sort(), [DEAL, OTHER_DEAL], 'committed on 41, invited to 42');
  assert.deepEqual(rows[DEAL].closing.own_lines, [{ uid: 'line-ben', status: 'open' }]);
  assert.deepEqual(rows[DEAL].envelopes, { state: 'recorded', executed: 1, total: 1, signatures_outstanding: 0, uncounted: 0 });
  assert.deepEqual(rows[OTHER_DEAL].closing, { state: 'unrecorded', reason: OVERVIEW_REASONS.noClosing });
  assert.deepEqual(rows[OTHER_DEAL].checklist, { state: 'unrecorded', reason: OVERVIEW_REASONS.noChecklist });
  assert.deepEqual(rows[OTHER_DEAL].envelopes, { state: 'unrecorded', reason: OVERVIEW_REASONS.noEnvelopes }, 'paper Ben cannot read is not counted as his');
  assert.deepEqual(rows[OTHER_DEAL].transfer, { state: 'recorded', recorded: false, count: 0 });
  assert.doesNotMatch(r.text, /line-ivy/);
});

test('an admin receives every funded deal, every envelope and every open condition, and reads the closing whole', async () => {
  const db = freshDb();
  const r = await overviewAs(db, ADMIN);
  assert.equal(r.status, 200, r.text);
  const rows = byId(r.body);
  assert.deepEqual(Object.keys(rows).map(Number).sort(), [DEAL, OTHER_DEAL], 'never the active deal or the deleted venture');
  assert.deepEqual(rows[DEAL].envelopes, { state: 'recorded', executed: 1, total: 2, signatures_outstanding: 1, uncounted: 0 });
  assert.deepEqual(rows[DEAL].conditions, { state: 'recorded', open: 1, held: true });
  assert.deepEqual([rows[DEAL].closing.reach, rows[DEAL].closing.own_lines], ['all', []], 'an admin holds no line of their own');
  assert.deepEqual(rows[OTHER_DEAL].conditions, { state: 'recorded', open: 0, held: false });
  assert.deepEqual(rows[OTHER_DEAL].envelopes.signatures_outstanding, 0, 'a sent envelope with no recipient is not counted');
  assert.deepEqual(rows[OTHER_DEAL].envelopes.uncounted, 1);
});

test('the venture’s founder reads their own funded deal; a caller with no deals receives an empty list', async () => {
  const db = freshDb();
  const founder = await overviewAs(db, FOUNDER);
  assert.equal(founder.status, 200, founder.text);
  assert.deepEqual(founder.body.deals.map((d: any) => d.id), [DEAL]);
  const none = await overviewAs(db, INV_NONE);
  assert.deepEqual([none.status, none.body], [200, { deals: [] }]);
});

test('a part that cannot be read is unreadable for that part, never 0, and the other parts still answer', async () => {
  const db = freshDb();
  db.exec('DROP TABLE deal_transfers');
  db.exec('DROP TABLE deal_closing_checklist_items');
  const r = await overviewAs(db, INV_A);
  assert.equal(r.status, 200, r.text);
  const row = r.body.deals[0];
  assert.deepEqual(row.transfer, { state: 'unreadable', reason: OVERVIEW_REASONS.transferUnreadable });
  assert.deepEqual(row.checklist, { state: 'unreadable', reason: OVERVIEW_REASONS.checklistUnreadable });
  assert.equal(row.envelopes.state, 'recorded');
  assert.equal(row.conditions.state, 'recorded');
  assert.equal(row.closing.state, 'recorded');

  const ic = freshDb();
  ic.exec('DROP TABLE ic_conditions');
  ic.exec('DROP TABLE esign_recipients');
  ic.exec('DROP TABLE closing_lines');
  const r2 = byId((await overviewAs(ic, ADMIN)).body)[DEAL];
  assert.deepEqual(r2.conditions, { state: 'unreadable', reason: OVERVIEW_REASONS.conditionsUnreadable });
  assert.deepEqual(r2.envelopes, { state: 'unreadable', reason: OVERVIEW_REASONS.envelopesUnreadable });
  assert.deepEqual(r2.closing, { state: 'unreadable', reason: OVERVIEW_REASONS.closingsUnreadable });
  assert.deepEqual(r2.transfer, { state: 'recorded', recorded: true, count: 1 });
});

test('a deal its preparation hides is never listed, even to an admin (D5454)', async () => {
  const db = freshDb();
  // The four columns `hiddenDealIds('transactional')` reads; a preparation never released owns 42 here.
  db.exec(`CREATE TABLE deal_preparations (deal_id INTEGER, released_revision_id INTEGER, publication_state TEXT, origin TEXT);
    INSERT INTO deal_preparations VALUES (42, NULL, 'unreleased', 'draft');`);
  const r = await overviewAs(db, ADMIN);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.deals.map((d: any) => d.id), [DEAL]);
});

test('without the deal record there are no rows, so the read is refused rather than empty', async () => {
  const db = freshDb();
  db.exec('DROP TABLE deals');
  const r = await overviewAs(db, ADMIN);
  assert.deepEqual([r.status, r.body?.error], [503, 'closing_overview_unreadable']);
});

test('the part rules: a skipped item counts neither way; only completed is executed; only sent paper has signatures outstanding', () => {
  assert.deepEqual(checklistPart(null), { state: 'unrecorded', reason: OVERVIEW_REASONS.noChecklist });
  assert.deepEqual(checklistPart({ items: [{ state: 'skipped' }] }), { state: 'unrecorded', reason: OVERVIEW_REASONS.checklistEmpty });
  assert.deepEqual(checklistPart({ items: [{ state: 'done' }, { state: 'blocked' }, { state: 'skipped' }] }), { state: 'recorded', done: 1, total: 2 });
  assert.deepEqual(envelopesPart([]), { state: 'unrecorded', reason: OVERVIEW_REASONS.noEnvelopes });
  assert.deepEqual(envelopesPart([
    { status: 'completed', recipient_count: 2, signed_count: 2 },
    { status: 'draft', recipient_count: 3, signed_count: 0 },
    { status: 'sent', recipient_count: 3, signed_count: 1 },
    { status: 'sent', recipient_count: 0, signed_count: 0 },
  ]), { state: 'recorded', executed: 1, total: 4, signatures_outstanding: 2, uncounted: 1 });
  assert.deepEqual(envelopesPart([{ status: 'sent', recipient_count: undefined as any, signed_count: 0 }]),
    { state: 'recorded', executed: 0, total: 1, signatures_outstanding: 0, uncounted: 1 }, 'a recipient count that is not a number is reported apart, never added');
});
