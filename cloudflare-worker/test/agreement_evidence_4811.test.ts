/**
 * D4811 (#4811) part 18 — attaching execution evidence to a legacy agreement
 * marked signed with none (CT-02, CT-12 B): a PDF, the signature date (not
 * after today), the signatory and the attestation; written once; an envelope
 * or an agreement not marked signed is refused; once attached the agreement
 * leaves the repair queue. Real baseline schema plus the migration; made-up rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/agreement_evidence_4811.test.ts
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

const SECRET = 'unit-test-secret-4811-agreement-evidence-01';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF');
function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const name of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'documents', 'projects', 'founders', 'deals',
    'esign_envelopes', 'esign_recipients', 'esign_audit_events', 'pairwise_ndas', 'partner_deals']) db.exec(tableFromBaseline(baseline, name));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/202611092335_agreement_evidence.sql', 'utf8'));
  db.prepare("INSERT INTO users(id,role,name,email,is_active) VALUES(2,'admin','Plain admin','admin@example.test',1)").run();
  db.exec("INSERT INTO projects(id,name) VALUES(10,'Novacraft')");
  db.prepare("INSERT INTO documents(uid,title,doc_type,status,template_name,project_id,created_at) VALUES('doc-bare','Co-founder Agreement','safe','signed','safe',10,'2026-10-01T10:00:00Z')").run();
  db.prepare("INSERT INTO documents(uid,title,doc_type,status,template_name,project_id,created_at) VALUES('doc-sent','Sent one','safe','sent','safe',10,'2026-10-01T10:00:00Z')").run();
  db.prepare("INSERT INTO esign_envelopes(id,envelope_uuid,document_type,document_title,document_body,body_sha256,created_by,status,created_at,provider) VALUES(7,'env-1','other','Env','b','h',2,'completed','2026-10-01T10:00:00Z','native')").run();
  const put: string[] = [];
  const FILES = { async put(k: string) { put.push(k); }, async get() { return null; }, async head() { return null; }, async delete() {} };
  return { db, FILES, put };
}
const app = new Hono<any>();
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function call(f: ReturnType<typeof fixture>, method: string, path: string, form?: FormData) {
  const jwt = await new SignJWT({ user_id: 2, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request(`/contracts${path}`, { method, headers: { Authorization: `Bearer ${jwt}` }, ...(form ? { body: form } : {}) },
    { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(f.db), FILES: f.FILES });
  const text = await res.text(); let body: any; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, body };
}
const upload = (o: Record<string, string> = {}, bytes = PDF) => {
  const fd = new FormData(); fd.append('file', new File([bytes], 'signed.pdf'));
  for (const [k, v] of Object.entries({ signed_on: '2026-10-02', signatory: 'A. Founder, CEO', attest: 'true', ...o })) if (v !== '') fd.append(k, v);
  return fd;
};
const repairs = async (f: ReturnType<typeof fixture>) => (await call(f, 'GET', '?recorded=true&attention=repair_evidence&limit=50')).body.items.map((x: any) => x.uid);

test('attach: refused without each field, as a non-PDF, on an envelope or an unsigned agreement; then attached once, and the contradiction clears', async () => {
  const f = fixture();
  assert.deepEqual(await repairs(f), ['doc-bare'], 'marked signed with no evidence: a repair');
  for (const [o, code] of [[{ signed_on: '' }, 'signed_on_required'], [{ signatory: '' }, 'signatory_required'], [{ attest: '' }, 'attestation_required']] as const) {
    const r = await call(f, 'POST', '/doc-bare/evidence', upload(o));
    assert.equal(r.status, 422, JSON.stringify(r.body)); assert.equal(r.body.error, code);
  }
  assert.equal((await call(f, 'POST', '/doc-bare/evidence', upload({}, new TextEncoder().encode('not a pdf')))).body.error, 'pdf_required');
  assert.equal((await call(f, 'POST', '/env-1/evidence', upload())).body.error, 'evidence_not_supported');
  assert.equal((await call(f, 'POST', '/doc-sent/evidence', upload())).body.error, 'not_marked_signed');
  assert.equal(f.put.length, 0, 'a refusal stores no file');
  const ok = await call(f, 'POST', '/doc-bare/evidence', upload());
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.evidence.signatory, 'A. Founder, CEO');
  assert.equal(ok.body.evidence.file_sha256.length, 64);
  assert.deepEqual(f.put, ['contracts/evidence/doc-bare.pdf']);
  assert.deepEqual(await repairs(f), [], 'the contradiction clears');
  assert.equal((await call(f, 'GET', '/doc-bare/evidence')).body.evidence.signed_on, '2026-10-02');
  assert.equal((await call(f, 'POST', '/doc-bare/evidence', upload())).body.error, 'already_evidenced');
  assert.throws(() => f.db.prepare("UPDATE agreement_evidence SET signatory = 'someone else'").run(), /written once/);
  const log = JSON.parse((f.db.prepare("SELECT details FROM activity_logs WHERE action = 'contract_evidence_attached'").get() as any).details);
  assert.equal(log.uid, 'doc-bare');
});
