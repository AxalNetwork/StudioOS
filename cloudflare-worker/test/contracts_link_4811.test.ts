/**
 * D4811 (#4811) part 11 — the "Link recipient" repair on
 * `POST /api/admin/contracts/:uid/link { deal_id }` (boards CT-01, CT-02): an
 * unlinked envelope takes the deal, an unlinked legacy document takes the
 * deal's company, and the row leaves the repair queue. A linked row is never
 * relinked; a pairwise NDA has no company link to make; a bad deal is refused;
 * every link is audited. Real baseline schema; made-up rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/contracts_link_4811.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contracts from '../src/routes/admin_contracts.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'unit-test-secret-4811-link-0123456789abc';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const name of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'documents',
    'projects', 'founders', 'deals', 'esign_envelopes', 'esign_recipients', 'esign_audit_events', 'pairwise_ndas', 'partner_deals', 'partner_referral_redemptions', 'legal_templates', 'legal_template_versions']) {
    db.exec(tableFromBaseline(baseline, name));
  }
  db.prepare("INSERT INTO users(id,role,name,email,is_active) VALUES(2,'admin','Plain admin','admin@example.test',1)").run();
  db.exec("INSERT INTO projects(id,name) VALUES(10,'Beta'),(11,'Gamma'); INSERT INTO deals(id,uid,project_id) VALUES(90,'deal-beta',10),(91,'deal-gamma',11)");
  const env = db.prepare("INSERT INTO esign_envelopes(id,envelope_uuid,deal_id,document_type,document_title,document_body,body_sha256,created_by,status,created_at,provider) VALUES(?,?,?,'investor_nda_axal',?,'body','hash',2,'sent',?,'native')");
  env.run(5, 'env-unlinked', null, 'Unlinked one', ago(20));
  env.run(6, 'env-linked', 90, 'Linked one', ago(20));
  db.prepare("INSERT INTO documents(uid,title,doc_type,status,template_name,project_id,created_at) VALUES('doc-unlinked','Loose SAFE','safe','sent','safe',NULL,?)").run(ago(30));
  db.exec("INSERT INTO pairwise_ndas(id,party_a_user_id,party_b_user_id,status) VALUES(1,2,2,'pending')");
  return db;
}
const app = new Hono<any>();
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(db: DatabaseSync, path: string, init: { method?: string; body?: unknown } = {}) {
  const jwt = await new SignJWT({ user_id: 2, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/contracts${path}`, {
    method: init.method || 'GET',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  }, { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, body };
}
const link = (db: DatabaseSync, uid: string, deal_id: unknown) => call(db, `/${uid}/link`, { method: 'POST', body: { deal_id } });
const repairs = async (db: DatabaseSync) => (await call(db, '?recorded=true&attention=repair_unlinked&limit=50')).body.items.map((x: any) => x.uid).sort();

test('an unlinked envelope takes the deal; it leaves the repair queue; the link is audited', async () => {
  const db = fixture();
  assert.deepEqual(await repairs(db), ['doc-unlinked', 'env-unlinked']);
  const r = await link(db, 'env-unlinked', 91);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.project_name, 'Gamma');
  assert.equal((db.prepare('SELECT deal_id FROM esign_envelopes WHERE id = 5').get() as any).deal_id, 91);
  assert.deepEqual(await repairs(db), ['doc-unlinked']);
  const log = db.prepare("SELECT details FROM activity_logs WHERE action = 'contract_linked'").all() as any[];
  assert.equal(log.length, 1);
  assert.deepEqual(JSON.parse(log[0].details), { uid: 'env-unlinked', source: 'esign', deal_id: 91, project_id: 11 });
});

test('a legacy document takes the deal\'s company', async () => {
  const db = fixture();
  const r = await link(db, 'doc-unlinked', 90);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((db.prepare("SELECT project_id FROM documents WHERE uid = 'doc-unlinked'").get() as any).project_id, 10);
  assert.deepEqual(await repairs(db), ['env-unlinked']);
});

test('refusals: no deal, an unknown deal, an already linked row, a store with no company link, an unknown agreement', async () => {
  const db = fixture();
  const none = await link(db, 'env-unlinked', 'x');
  assert.equal(none.status, 422); assert.equal(none.body.error, 'deal_required');
  const unknown = await link(db, 'env-unlinked', 999);
  assert.equal(unknown.status, 404); assert.equal(unknown.body.error, 'deal_not_found');
  const already = await link(db, 'env-linked', 91);
  assert.equal(already.status, 409); assert.equal(already.body.error, 'already_linked');
  assert.equal((db.prepare('SELECT deal_id FROM esign_envelopes WHERE id = 6').get() as any).deal_id, 90, 'a linked row is never relinked');
  const missing = await link(db, 'no-such-uid', 90);
  assert.equal(missing.status, 404); assert.equal(missing.body.error, 'contract_not_found');
  const nda = await link(db, 'pairwise:1', 90);
  assert.equal(nda.status, 409); assert.equal(nda.body.error, 'link_not_supported');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'contract_linked'").get() as any).n, 0, 'a refusal writes nothing');
});
