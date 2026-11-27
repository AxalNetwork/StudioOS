/**
 * D4811 (#4811) part 13 — publishing one template is a high-risk action
 * (board CT-16 "Activate template"): `POST /published-templates/:slug/publish`
 * needs a reason (10 to 500 characters), the typed word PUBLISH and a recent
 * step-up, all on the server. A form mistake never asks for a step-up, a
 * refusal publishes nothing, and the reason is kept in the audit row.
 * Real baseline schema; made-up rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/template_high_risk_4811.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import contracts from '../src/routes/admin_contracts.ts';
import { confirmationFor } from '../src/services/governanceHighRisk.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { tableFromBaseline } from './_baseline.mjs';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'unit-test-secret-4811-template-high-risk-01';
const baseline = readFileSync('cloudflare-worker/sql/schema_baseline.sql', 'utf8');
const REASON = 'Counsel approved v3 on 2026-11-09; synthetic test only.';

function fixture({ stepUp = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'legal_templates', 'legal_template_versions', 'esign_envelopes', 'esign_recipients', 'esign_audit_events', 'deals']) {
    db.exec(tableFromBaseline(baseline, t));
  }
  db.exec(readFileSync('cloudflare-worker/sql/migrations/434_contract_template_publications.sql', 'utf8'));
  db.exec(readFileSync('cloudflare-worker/sql/migrations/479_template_kind_party.sql', 'utf8'));
  db.prepare("INSERT INTO users(id,role,name,email,is_active) VALUES(1,'admin','HQ owner','hq@example.test',1)").run();
  db.exec('INSERT INTO super_admins (user_id) VALUES (1)'); // D4811 part 15: publishing is the Super Admin's.
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (1, 'sess', 'totp', ?)")
    .run(stepUp ? new Date().toISOString().replace('T', ' ').slice(0, 19) : '2020-01-01 00:00:00');
  db.exec("INSERT INTO legal_templates(slug,title,category,body_md,version,doc_kind,axal_party) VALUES ('hr_alpha','Alpha Agreement','gp','Alpha body',3,'agreement','holdings')");
  return db;
}
const app = new Hono<any>();
app.route('/contracts', contracts);
app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
async function publish(db: DatabaseSync, body: Record<string, unknown>) {
  const jwt = await new SignJWT({ user_id: 1, role: 'admin', jti: 'sess' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const res = await app.request('/contracts/published-templates/hr_alpha/publish', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) },
    { JWT_SECRET: SECRET, ENVIRONMENT: 'development', DB: d1Over(db) });
  return { status: res.status, body: await res.json() as any };
}
const published = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM legal_template_publications').get() as any).n;

test('the rule: a reason of 10 to 500 characters and the exact word PUBLISH', () => {
  assert.deepEqual(confirmationFor('PUBLISH', { reason: `  ${REASON}  `, confirm: 'PUBLISH' }), { ok: true, reason: REASON });
  assert.equal((confirmationFor('PUBLISH', { reason: 'too short', confirm: 'PUBLISH' }) as any).refusal.code, 'reason_required');
  assert.equal((confirmationFor('PUBLISH', { reason: REASON, confirm: 'publish' }) as any).refusal.code, 'confirmation_required', 'the word is exact');
  assert.equal((confirmationFor('PUBLISH', { reason: REASON, confirm: 'EXECUTED' }) as any).refusal.code, 'confirmation_required');
});

test('refused without a reason or the word, and nothing is published; then published with the reason in the audit row', async () => {
  const db = fixture();
  const noReason = await publish(db, { version: 3, confirm: 'PUBLISH' });
  assert.equal(noReason.status, 422); assert.equal(noReason.body.error, 'reason_required');
  assert.match(noReason.body.message, /Nothing was published\./);
  const noWord = await publish(db, { version: 3, reason: REASON, confirm: 'publish' });
  assert.equal(noWord.status, 422); assert.equal(noWord.body.error, 'confirmation_required');
  assert.match(noWord.body.message, /Type PUBLISH to confirm\. Nothing was published\./);
  assert.equal(published(db), 0);
  const ok = await publish(db, { version: 3, reason: REASON, confirm: 'PUBLISH' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(published(db), 1);
  const log = JSON.parse((db.prepare("SELECT details FROM activity_logs WHERE action = 'contract_template_published'").get() as any).details);
  assert.equal(log.reason, REASON);
  assert.equal(log.version, 3);
});

test('a session with no recent step-up is asked for one, after the form checks, and nothing is published', async () => {
  const db = fixture({ stepUp: false });
  const mistyped = await publish(db, { version: 3, reason: REASON, confirm: 'PUBLISHED' });
  assert.equal(mistyped.status, 422, 'a mistyped word never asks for a code');
  const r = await publish(db, { version: 3, reason: REASON, confirm: 'PUBLISH' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'step_up_required');
  assert.equal(published(db), 0);
});

test('D4811 part 15: an admin who is not the Super Admin is refused before anything is checked or published', async () => {
  const db = fixture();
  db.exec('DELETE FROM super_admins');
  const r = await publish(db, { version: 3, reason: REASON, confirm: 'PUBLISH' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'super_admin_only');
  assert.match(r.body.message, /Only the Super Admin publishes a template\. Nothing was published\./);
  assert.equal(published(db), 0);
});
