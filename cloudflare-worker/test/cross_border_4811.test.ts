/**
 * D4811 (#4811) part 17 — cross-border fields (board CT-15) and the entities'
 * formation jurisdiction (question A: all three are Delaware). An agreement
 * marked cross-border carries seven checks; governing law is what was
 * entered, never defaulted; a resolved or not-applicable review says how or
 * why; while any check is open, resend refuses and names them. Real baseline
 * schema plus the migration; made-up rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/cross_border_4811.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contracts from '../src/routes/admin_contracts.ts';
import { checksOf, entityJurisdiction, recordOf, sendRefusal } from '../src/services/crossBorder.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'unit-test-secret-4811-cross-border-012345';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const name of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'documents', 'projects', 'founders', 'deals',
    'esign_envelopes', 'esign_recipients', 'esign_audit_events', 'pairwise_ndas', 'partner_deals']) db.exec(tableFromBaseline(baseline, name));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/202611092305_agreement_cross_border.sql', 'utf8'));
  db.prepare("INSERT INTO users(id,role,name,email,is_active) VALUES(2,'admin','Plain admin','admin@example.test',1)").run();
  db.prepare("INSERT INTO esign_envelopes(id,envelope_uuid,document_type,document_title,document_body,body_sha256,created_by,status,created_at,provider) VALUES(7,'env-nl','other','Service Agreement — Studio Vireo B.V.','body','hash',2,'sent','2026-11-04T10:00:00Z','native')").run();
  return db;
}
const app = new Hono<any>();
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(db: DatabaseSync, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: 2, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/contracts${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
  const text = await res.text();
  let parsed: any; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { status: res.status, body: parsed };
}
const NL = { counterparty_jurisdiction: 'Netherlands', governing_law: 'Netherlands — clause 18', performance_countries: 'Netherlands, United States',
  tax_status: 'open', data_transfer_status: 'open', local_counsel_status: 'resolved', local_counsel_note: 'Example Advocaten · completed 3 Nov 2026',
  sanctions_status: 'resolved', sanctions_note: 'Cleared 2 Nov 2026 · SCR-2210' };

test('the rules: Delaware for the three entities; seven checks; governing law never defaulted; a closed review says how or why', () => {
  assert.equal(entityJurisdiction('gp'), 'Delaware, United States');
  assert.equal(entityJurisdiction('holdings'), 'Delaware, United States');
  assert.equal(entityJurisdiction('management'), 'Delaware, United States');
  assert.equal(entityJurisdiction('fund_i'), null, 'an entity not answered for is not guessed');
  assert.equal(checksOf(null), null, 'no record: not marked cross-border');
  const empty = recordOf({});
  assert.ok(empty.ok);
  assert.equal((empty as any).value.governing_law, null, 'governing law is never defaulted');
  assert.deepEqual(checksOf((empty as any).value)!.map((c) => c.state), ['open', 'open', 'open', 'open', 'open', 'open', 'open']);
  assert.equal((recordOf({ tax_status: 'resolved' }) as any).refusal.code, 'note_required');
  assert.equal((recordOf({ tax_status: 'done' }) as any).refusal.code, 'status_invalid');
  const nl = (recordOf(NL) as any).value;
  assert.deepEqual(checksOf(nl)!.map((c) => [c.label, c.state]), [
    ['Counterparty jurisdiction', 'resolved'], ['Governing law', 'resolved'], ['Countries of performance', 'resolved'],
    ['Tax review', 'open'], ['Data-transfer mechanism', 'open'], ['Local-counsel review', 'resolved'], ['Sanctions / trade review', 'resolved']]);
  assert.equal(sendRefusal(nl)!.message, 'Not sent: 2 cross-border checks are open (Tax review, Data-transfer mechanism). Resolve them on the agreement first.');
  assert.equal(sendRefusal({ ...nl, tax_status: 'not_applicable', tax_note: 'No payment crosses a border.', data_transfer_status: 'resolved', data_transfer_note: 'SCCs signed' }), null);
  assert.equal(sendRefusal(null), null, 'an agreement not marked cross-border is not held');
});

test('saved, read back and audited; open checks stop a resend and name themselves; resolving them lets it through to the send', async () => {
  const db = fixture();
  assert.deepEqual((await call(db, 'GET', '/env-nl/cross-border')).body, { uid: 'env-nl', record: null, checks: null, open: [] });
  const saved = await call(db, 'PUT', '/env-nl/cross-border', NL);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.open, ['Tax review', 'Data-transfer mechanism']);
  assert.equal(saved.body.record.governing_law, 'Netherlands — clause 18');
  assert.equal(JSON.parse((db.prepare("SELECT details FROM activity_logs WHERE action = 'contract_cross_border_saved'").get() as any).details).open, 2);
  const held = await call(db, 'POST', '/env-nl/resend', {});
  assert.equal(held.status, 409);
  assert.equal(held.body.error, 'cross_border_open');
  assert.deepEqual(held.body.open, ['Tax review', 'Data-transfer mechanism']);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM esign_audit_events WHERE action = 'email_resent'").get() as any).n, 0, 'nothing was sent');
  const bad = await call(db, 'PUT', '/env-nl/cross-border', { ...NL, tax_status: 'resolved' });
  assert.equal(bad.body.error, 'note_required');
  const done = await call(db, 'PUT', '/env-nl/cross-border', { ...NL, tax_status: 'not_applicable', tax_note: 'No payment crosses a border.', data_transfer_status: 'resolved', data_transfer_note: 'Standard contractual clauses signed' });
  assert.deepEqual(done.body.open, []);
  const through = await call(db, 'POST', '/env-nl/resend', {});
  assert.notEqual(through.body.error, 'cross_border_open', 'the cross-border hold is lifted (the resend itself may fail for other reasons in this fixture)');
  assert.equal((await call(db, 'PUT', '/no-such/cross-border', NL)).body.error, 'contract_not_found');
});
