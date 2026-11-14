/**
 * D711 (#1776) — the admin contract routes over the canonical schema plus
 * migration 475, for the legal paper's tests. Not a test file (the leading
 * underscore keeps it out of the glob).
 *
 * Users: 1 is a Super Admin, 2 an admin who sends, 6 another admin, 3 a
 * founder. Envelope 1 (`env-1`) is admin 2's, with three recipients.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contracts from '../src/routes/admin_contracts.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

export const SECRET = 'unit-test-secret-d711-012345678901234567';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
export const M475 = readFileSync('cloudflare-worker/sql/migrations/475_legal_document_files.sql', 'utf8');

export const TEMPLATE_BODY = '## Article 1 Terms\n1.1 The **Company** (the "Company") agrees with {{company.legal_name}}.\n> Warning: not an offer.';

export function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const name of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'documents',
    'projects', 'founders', 'deals', 'esign_envelopes', 'esign_recipients', 'esign_audit_events', 'pairwise_ndas',
    'partner_deals', 'partner_referral_redemptions', 'legal_templates', 'legal_template_versions']) {
    db.exec(tableFromBaseline(baseline, name));
  }
  db.exec(readFileSync('cloudflare-worker/sql/migrations/434_contract_template_publications.sql', 'utf8'));
  db.exec(M475);
  const user = db.prepare('INSERT INTO users(id,role,name,email,is_active) VALUES(?,?,?,?,?)');
  user.run(1, 'admin', 'HQ owner', 'hq@example.test', 1);
  user.run(2, 'admin', 'Sender admin', 'sender@example.test', 1);
  user.run(3, 'founder', 'Founder', 'founder@example.test', 1);
  user.run(6, 'admin', 'Other admin', 'other@example.test', 1);
  db.exec('INSERT INTO super_admins(user_id) VALUES(1)');
  db.prepare(`INSERT INTO esign_envelopes(id,envelope_uuid,document_type,document_title,document_body,body_sha256,created_by,status)
    VALUES(1,'env-1','nda_3way_v1','3-Way NDA','body','${'a'.repeat(64)}',2,'partially_signed')`).run();
  const rec = db.prepare('INSERT INTO esign_recipients(id,envelope_id,recipient_name,recipient_email,signing_token,token_expires_at,status) VALUES(?,?,?,?,?,?,?)');
  rec.run(11, 1, 'Ada Founder', 'ada@example.test', 'tok-11-'.padEnd(40, 'x'), '2999-01-01', 'signed');
  rec.run(12, 1, 'Ivan Investor', 'ivan@example.test', 'tok-12-'.padEnd(40, 'x'), '2999-01-01', 'signed');
  rec.run(13, 1, 'Axal Legal', 'legal@axal.vc', 'tok-13-'.padEnd(40, 'x'), '2999-01-01', 'pending');
  db.prepare(`INSERT INTO legal_templates(slug,title,category,body_md,merge_fields,version,is_active,is_stub)
    VALUES('mutual_nda','Mutual NDA','portfolio',?,'[]',3,1,0)`).run(TEMPLATE_BODY);
  db.prepare(`INSERT INTO legal_templates(slug,title,category,body_md,merge_fields,version,is_active,is_stub)
    VALUES('subscription booklet & lpa','Subscription Booklet & LPA','fund',?,'[]',2,1,0)`).run(TEMPLATE_BODY);
  db.prepare(`INSERT INTO legal_templates(slug,title,category,body_md,merge_fields,version,is_active,is_stub)
    VALUES('ppm','Private Placement Memorandum','fund',?,'[]',1,1,0)`).run(TEMPLATE_BODY + '\n## Article 2 Risks\nRisky.');
  return db;
}

export const app = new Hono<any>();
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));

export async function bearer(who: number) {
  return `Bearer ${await new SignJWT({ user_id: who, role: who === 3 ? 'founder' : 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
}

export async function raw(db: DatabaseSync, path: string, who: number | null = 2, method = 'GET', body?: unknown, extraEnv: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = await bearer(who);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.request(`/contracts${path}`, { method, headers, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) },
    { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db), ...extraEnv });
}

export async function call(db: DatabaseSync, path: string, who: number | null = 2, method = 'GET', body?: unknown, extraEnv: Record<string, unknown> = {}) {
  const res = await raw(db, path, who, method, body, extraEnv);
  const text = await res.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* binary or text */ }
  return { status: res.status, body: parsed, headers: res.headers };
}
