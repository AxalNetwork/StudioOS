/**
 * D6223 (#6223) — the investor opens the signed document behind each duty.
 *
 * `/api/reporting/portfolio` and `/companies/:uid` give each duty
 * `source.signed_copy = { state, envelope_id }`. The envelope id is the one
 * `GET /api/legal/esign/:id/document` already takes, and it is handed over
 * only when the caller signed that envelope and the read's own scope
 * (`esignEnvelopeScope`) admits them:
 *
 *   · the signer who holds the duty gets `available` with the id;
 *   · another holder whose duty cites the same envelope, but who did not sign
 *     it, reads `not_available` and never the id;
 *   · a template duty reads `not_signed`;
 *   · a non-holder gets no duty at all (the company read is the same 404);
 *   · a failed lookup reads `unreadable`, never `not_available`, and the rest
 *     of the read still answers.
 *
 * Every name and figure is invented; `fetch` throws and is counted.
 *
 * Mutation checked, each both ways (fails with the mutation, passes without):
 *   - the signer clause dropped (any holder of the duty gets the id) → the
 *     other-holder and not-yet-signed tests;
 *   - the recipient's `status = 'signed'` dropped (a declined or pending
 *     recipient gets the id) → the same two tests;
 *   - the completed-and-stored check dropped → the not-stored test;
 *   - the lookup's failure read as `not_available` → the unreadable test;
 *   - a template duty read as `not_available` → the signer test.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/reporting_signed_copy_6223.test.ts
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
beforeEach(() => { fetches = 0; globalThis.fetch = (async () => { fetches += 1; throw new Error('no network in D6223'); }) as any; });
afterEach(() => { globalThis.fetch = realFetch; assert.equal(fetches, 0, 'fetch was called'); });

const ROLE: Record<number, string> = { 1: 'admin', 3: 'founder', 6: 'investor', 7: 'investor', 8: 'investor', 9: 'investor' };
// The Worker opens periods against its own today, so the fixture's closing is placed relative to it.
const TODAY = new Date().toISOString().slice(0, 10); // clock-ok: relative
const CLOSED = addDays(TODAY, -100);

/**
 * Ivy (6) signed envelope 501 and holds line A on it. Ben (7) holds line B,
 * which cites the same envelope 501; Ben was asked to sign it and declined,
 * so the read's scope admits him but he is not its signer. Dee (9) holds
 * line C, with no envelope, so her duties come from the closing's template.
 * Cy (8) is an investor with no line here. `recipientStatus` and `key` vary the envelope.
 */
function freshDb({ recipientStatus = 'signed', key = 'esign/signed/env-a.pdf' }: { recipientStatus?: string; key?: string | null } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
  for (const f of ['312_fund_call_ledger.sql', '335_deal_transfers_and_closing_checklists.sql', '340_deal_transfer_company.sql',
    '410_safe_issuances.sql', '599_deal_currency.sql', '337_portfolio_update_chases.sql']) db.exec(MIG(f));
  db.exec('ALTER TABLE raise_prospects ADD COLUMN amount_cents INTEGER');
  db.exec(MIG('612_closings.sql'));
  db.exec(MIG('202611151545_6198_closing_sender_declarations.sql'));
  db.exec(MIG('579_reporting_duties.sql'));
  db.exec(`
    INSERT INTO founders (id, name, email) VALUES (31, 'Fay Founder', 'fay@example.test');
    INSERT INTO users (id, role, name, email, founder_id, is_active) VALUES
      (1, 'admin', 'Ada Admin', 'ada@example.test', NULL, 1), (3, 'founder', 'Fay Founder', 'fay@example.test', 31, 1),
      (6, 'investor', 'Ivy Alpha', 'ivy@example.test', NULL, 1), (7, 'investor', 'Ben Beta', 'ben@example.test', NULL, 1),
      (8, 'investor', 'Cy Gamma', 'cy@example.test', NULL, 1), (9, 'investor', 'Dee Delta', 'dee@example.test', NULL, 1);
    INSERT INTO projects (id, uid, name, founder_id) VALUES (7, 'proj-seven', 'Fixture Venture', 31);
    INSERT INTO deals (id, uid, project_id, status, instrument) VALUES (41, 'd-41', 7, 'active', 'spa');
    INSERT INTO commitments (id, uid, deal_id, investor_user_id, amount, status) VALUES
      (101, 'cm-a', 41, 6, 250000, 'confirmed'), (102, 'cm-b', 41, 7, 125000, 'confirmed'), (103, 'cm-c', 41, 9, 50000, 'confirmed');
    INSERT INTO esign_envelopes (id, envelope_uuid, user_id, deal_id, document_type, document_title, document_body, body_sha256, status, signed_r2_key, created_by) VALUES
      (501, 'env-a', NULL, 41, 'voting_rights', 'Investors Rights Agreement', 'signed body', 'sha-a', 'completed', ${key == null ? 'NULL' : `'${key}'`}, 1);
    INSERT INTO esign_recipients (envelope_id, user_id, recipient_email, recipient_name, signing_token, token_expires_at, status) VALUES
      (501, 6, 'ivy@example.test', 'Ivy Alpha', 'tok-ivy', '2099-01-01', '${recipientStatus}'),
      (501, 7, 'ben@example.test', 'Ben Beta', 'tok-ben', '2099-01-01', 'rejected');
    INSERT INTO closings (id, uid, deal_id, project_id, template_slug, status, closed_at, created_by) VALUES
      (1, 'cl-one', 41, 7, 'term_sheet_v1', 'closed', '${CLOSED} 10:00:00', 1);
    INSERT INTO closing_lines (id, uid, closing_id, commitment_id, investor_user_id, amount_cents, envelope_id, status, created_by) VALUES
      (11, 'ln-a', 1, 101, 6, 25000000, 501, 'received', 1),
      (12, 'ln-b', 1, 102, 7, 12500000, 501, 'received', 1),
      (13, 'ln-c', 1, 103, 9, 5000000, NULL, 'received', 1);
  `);
  return db;
}

const env = (db: DatabaseSync) => ({ JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any);
async function token(user: number) {
  return new SignJWT({ user_id: user, role: ROLE[user] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
}
async function get(db: DatabaseSync, path: string, as: number) {
  const res = await app.request(path, { headers: { Authorization: `Bearer ${await token(as)}` } }, env(db));
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}
async function ready(opts?: Parameters<typeof freshDb>[0]) {
  const db = freshDb(opts);
  await createReportingDuties(env(db), 1);
  await openPeriods(env(db), TODAY);
  return db;
}
const copies = (company: any) => company.duties.map((d: any) => [d.source.kind, d.source.signed_copy]);

test('the signer who holds the duty gets the envelope id the existing document read takes; a template duty says no signed copy', async () => {
  const db = await ready();
  const res = await get(db, '/api/reporting/companies/proj-seven', 6);
  assert.equal(res.status, 200, res.text);
  const signed = res.body.company.duties.filter((d: any) => d.source.kind === 'signed_envelope');
  assert.ok(signed.length > 0, 'the fixture writes a duty from the signed envelope');
  for (const d of signed) assert.deepEqual(d.source.signed_copy, { state: 'available', envelope_id: 501 });
  const dee = await get(db, '/api/reporting/companies/proj-seven', 9);
  const template = dee.body.company.duties;
  assert.ok(template.length > 0 && template.every((x: any) => x.source.kind === 'closing_template'), 'Dee’s duties come from the closing template');
  for (const d of template) {
    assert.deepEqual(d.source.signed_copy, { state: 'not_signed', envelope_id: null });
  }
  const all = await get(db, '/api/reporting/portfolio', 6);
  assert.deepEqual(copies(all.body.companies[0]), copies(res.body.company), 'both investor reads say the same');
});

test('another holder whose duty cites the same envelope, but who did not sign it, never gets its id', async () => {
  const db = await ready();
  const res = await get(db, '/api/reporting/companies/proj-seven', 7);
  assert.equal(res.status, 200, res.text);
  const signed = res.body.company.duties.filter((d: any) => d.source.kind === 'signed_envelope');
  assert.ok(signed.length > 0, 'Ben holds a duty sourced from envelope 501');
  for (const d of signed) assert.deepEqual(d.source.signed_copy, { state: 'not_available', envelope_id: null });
  assert.doesNotMatch(JSON.stringify(res.body), /"envelope_id":501/);
});

test('a non-holder gets no duty and no reference: the company read is the same 404 as none', async () => {
  const db = await ready();
  for (const as of [8, 3]) {
    const one = await get(db, '/api/reporting/companies/proj-seven', as);
    assert.equal(one.status, 404, `user ${as}`);
    const all = await get(db, '/api/reporting/portfolio', as);
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.companies, [], `user ${as} holds nothing`);
    assert.doesNotMatch(all.text + one.text, /501/);
  }
});

test('a recipient who has not signed yet, or an envelope with no stored signed file, reads not available', async () => {
  for (const opts of [{ recipientStatus: 'pending' }, { key: null }, { key: 'elsewhere/env-a.pdf' }]) {
    const db = await ready(opts);
    const res = await get(db, '/api/reporting/companies/proj-seven', 6);
    assert.equal(res.status, 200, res.text);
    for (const d of res.body.company.duties.filter((x: any) => x.source.kind === 'signed_envelope')) {
      assert.deepEqual(d.source.signed_copy, { state: 'not_available', envelope_id: null }, JSON.stringify(opts));
    }
  }
});

test('a failed lookup is unreadable, never not available, and the rest of the read still answers', async () => {
  const db = await ready();
  db.exec('DROP TABLE esign_recipients');
  const res = await get(db, '/api/reporting/companies/proj-seven', 6);
  assert.equal(res.status, 200, res.text);
  assert.ok(res.body.company.periods.length > 0, 'the periods still answer');
  for (const d of res.body.company.duties) {
    assert.deepEqual(d.source.signed_copy, d.source.kind === 'signed_envelope'
      ? { state: 'unreadable', envelope_id: null } : { state: 'not_signed', envelope_id: null });
  }
});
