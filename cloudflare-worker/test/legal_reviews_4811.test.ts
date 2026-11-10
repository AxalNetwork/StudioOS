/**
 * D4811 (#4811) part 16 — the legal-review record (board CT-08) and the
 * counsel role (question C, owner 2026-11-09): any HQ admin requests a
 * review of the current version, naming a counsel; only that counsel records
 * the decision, once, against the version it is bound to, after a step-up; a
 * newer version needs a new review; only the Super Admin grants counsel; the
 * table refuses rewrites. Real migrated schema, in memory; made-up rows.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/legal_reviews_4811.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import reviews, { mount } from '../src/routes/admin_legal_reviews.ts';
import { decisionOf, requestOf, reviewState } from '../src/services/legalReview.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'synthetic-4811-legal-review-only-not-a-real-credential'.repeat(2);
const SUPER = 1, ADMIN = 2, COUNSEL = 3, OTHER_COUNSEL = 4;
const SHA_A = 'a'.repeat(64), SHA_B = 'b'.repeat(64);

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', ?, ?, 1)");
  u.run(SUPER, 'Sam Super', 'super@example.test'); u.run(ADMIN, 'Alex Admin', 'alex@example.test');
  u.run(COUNSEL, 'R. Okafor', 'counsel@example.test'); u.run(OTHER_COUNSEL, 'P. Other', 'other@example.test');
  db.exec(`INSERT INTO super_admins (user_id) VALUES (${SUPER})`);
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, ?, 'totp', ?)");
  for (const id of [SUPER, ADMIN, COUNSEL, OTHER_COUNSEL]) s.run(id, `sess-${id}`, stamp);
  db.exec("INSERT INTO legal_templates (slug, title, category, body_md, version, is_active) VALUES ('lr_lpa', 'Initial LPA', 'gp', 'The LPA text, v3.', 3, 1)");
  db.exec("INSERT INTO governance_documents (uid, entity_key, category, title, status, confidential) VALUES ('00000000-0000-4000-8000-0000000000aa', 'gp', 'operating_agreement', 'GP OA', 'review', 0)");
  db.exec(`INSERT INTO governance_document_versions (document_uid, version, signed, r2_key, file_sha256, file_bytes, content_type) VALUES ('00000000-0000-4000-8000-0000000000aa', 1, 0, 'k1', '${SHA_A}', 10, 'application/pdf')`);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development' };
  const app = new Hono<any>().route(mount.path, reviews);
  app.onError((err, c) => c.json({ error: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, app, env };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, who: number, method: string, path: string, body?: unknown) {
  const jwt = await new SignJWT({ user_id: who, jti: `sess-${who}` }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(`/api/admin/legal-reviews${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, f.env);
  return { status: res.status, body: await res.json() as any };
}
const REQ = { kind: 'governance', ref: '00000000-0000-4000-8000-0000000000aa', reviewer_id: COUNSEL, review_type: 'amendment', jurisdiction: 'Delaware, United States', due_on: '2026-11-12' };
async function grant(f: F, ...ids: number[]) { for (const id of ids) assert.equal((await call(f, SUPER, 'POST', '/counsel', { user_id: id, firm: 'Example LLP' })).status, 201); }

test('the rules: a request names counsel, type and jurisdiction; a decision is the assigned counsel\'s, once, on the current version', () => {
  assert.equal((requestOf({ ...REQ }, false) as any).refusal.code, 'reviewer_not_counsel');
  assert.equal((requestOf({ ...REQ, jurisdiction: ' ' }, true) as any).refusal.code, 'jurisdiction_required', 'never assumed');
  assert.equal((requestOf({ ...REQ, review_type: 'casual' }, true) as any).refusal.code, 'review_type_required');
  assert.equal((requestOf({ ...REQ, due_on: '2026-02-30' }, true) as any).refusal.code, 'due_on_invalid');
  assert.deepEqual((requestOf({ ...REQ, due_on: '' }, true) as any).value, { review_type: 'amendment', jurisdiction: 'Delaware, United States', reviewer_id: COUNSEL, due_on: null });
  const open = { decision: null, reviewer_id: COUNSEL, version_sha256: SHA_A };
  assert.equal((decisionOf({ decision: 'approved' }, open, OTHER_COUNSEL, SHA_A) as any).refusal.code, 'not_assigned_counsel');
  assert.equal((decisionOf({ decision: 'approved' }, open, COUNSEL, SHA_B) as any).refusal.code, 'review_stale');
  assert.equal((decisionOf({ decision: 'approved' }, { ...open, decision: 'approved' }, COUNSEL, SHA_A) as any).refusal.code, 'already_decided');
  assert.equal((decisionOf({ decision: 'approved_with_conditions' }, open, COUNSEL, SHA_A) as any).refusal.code, 'required_changes_required');
  assert.equal((decisionOf({ decision: 'not_approved' }, open, COUNSEL, SHA_A) as any).refusal.code, 'findings_required');
  assert.equal((decisionOf({ decision: 'maybe' }, open, COUNSEL, SHA_A) as any).refusal.code, 'decision_required');
  assert.equal((decisionOf({ decision: 'approved' }, open, COUNSEL, SHA_A) as any).value.decision, 'approved');
  assert.equal(reviewState({ decision: null, version_sha256: SHA_A }, SHA_A), 'pending');
  assert.equal(reviewState({ decision: 'approved', version_sha256: SHA_A }, SHA_B), 'approved_superseded', 'an approval is of its version only');
});

test('only the Super Admin grants or removes counsel', async () => {
  const f = fixture();
  const refused = await call(f, ADMIN, 'POST', '/counsel', { user_id: COUNSEL });
  assert.equal(refused.status, 403); assert.equal(refused.body.error, 'super_admin_only');
  await grant(f, COUNSEL);
  assert.equal((await call(f, SUPER, 'POST', '/counsel', { user_id: COUNSEL })).body.error, 'already_counsel');
  assert.deepEqual((await call(f, ADMIN, 'GET', '/counsel')).body.counsel.map((x: any) => [x.user_id, x.firm]), [[COUNSEL, 'Example LLP']]);
  assert.equal((await call(f, ADMIN, 'DELETE', `/counsel/${COUNSEL}`)).status, 403);
  assert.equal((await call(f, SUPER, 'DELETE', `/counsel/${COUNSEL}`)).status, 200);
});

test('request → decision: bound to the version hash; only the assigned counsel decides, once; a newer version supersedes it', async () => {
  const f = fixture();
  await grant(f, COUNSEL, OTHER_COUNSEL);
  assert.equal((await call(f, ADMIN, 'POST', '', { ...REQ, reviewer_id: ADMIN })).body.error, 'reviewer_not_counsel');
  const made = await call(f, ADMIN, 'POST', '', REQ);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.deepEqual([made.body.review.version, made.body.review.version_sha256, made.body.review.state, made.body.review.reviewer.name], [1, SHA_A, 'pending', 'R. Okafor']);
  const id = made.body.review.id;
  assert.equal((await call(f, ADMIN, 'POST', `/${id}/decision`, { decision: 'approved' })).body.error, 'counsel_only');
  assert.equal((await call(f, OTHER_COUNSEL, 'POST', `/${id}/decision`, { decision: 'approved' })).body.error, 'not_assigned_counsel');
  const ok = await call(f, COUNSEL, 'POST', `/${id}/decision`, { decision: 'approved_with_conditions', required_changes: '§7.3 must name signatories by office.', sources: 'Del. Code tit. 6 § 18-402', next_review_on: '2027-08-22' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.review.state, 'approved_with_conditions');
  assert.equal(ok.body.review.decided_by, COUNSEL);
  assert.equal((await call(f, COUNSEL, 'POST', `/${id}/decision`, { decision: 'not_approved', findings: 'x' })).body.error, 'already_decided');
  assert.throws(() => f.db.prepare('UPDATE legal_reviews SET decision = ? WHERE id = ?').run('not_approved', id), /recorded once/);
  assert.throws(() => f.db.prepare('DELETE FROM legal_reviews WHERE id = ?').run(id), /append-only/);
  // A newer upload: the approval stands for v1 only, and a pending review of v1 cannot be decided.
  const second = await call(f, ADMIN, 'POST', '', REQ);
  f.db.exec(`INSERT INTO governance_document_versions (document_uid, version, signed, r2_key, file_sha256, file_bytes, content_type) VALUES ('00000000-0000-4000-8000-0000000000aa', 2, 0, 'k2', '${SHA_B}', 10, 'application/pdf')`);
  const list = await call(f, ADMIN, 'GET', `?kind=governance&ref=${REQ.ref}`);
  assert.deepEqual(list.body.reviews.map((r: any) => r.state), ['superseded', 'approved_with_conditions_superseded']);
  assert.equal(list.body.object.version, 2);
  assert.equal((await call(f, COUNSEL, 'POST', `/${second.body.review.id}/decision`, { decision: 'approved' })).body.error, 'review_stale');
  const audits = (f.db.prepare("SELECT action FROM activity_logs WHERE action LIKE 'legal_review_%' OR action LIKE 'counsel_%' ORDER BY id").all() as any[]).map((r) => r.action);
  assert.deepEqual(audits, ['counsel_granted', 'counsel_granted', 'legal_review_requested', 'legal_review_decided', 'legal_review_requested']);
});

test('a template review binds the current text\'s hash; a stub has nothing to review; a confidential record is the Super Admin\'s', async () => {
  const f = fixture();
  await grant(f, COUNSEL);
  const t = await call(f, ADMIN, 'POST', '', { ...REQ, kind: 'template', ref: 'lr_lpa' });
  assert.equal(t.status, 201);
  assert.equal(t.body.review.version, 3);
  assert.equal(t.body.review.version_sha256.length, 64);
  f.db.exec("INSERT INTO legal_templates (slug, title, category, body_md, version, is_active) VALUES ('lr_stub', 'Stub', 'gp', '', 1, 1)");
  assert.equal((await call(f, ADMIN, 'POST', '', { ...REQ, kind: 'template', ref: 'lr_stub' })).body.error, 'nothing_to_review');
  f.db.exec("UPDATE governance_documents SET confidential = 1");
  assert.equal((await call(f, ADMIN, 'GET', `?kind=governance&ref=${REQ.ref}`)).status, 404);
  assert.equal((await call(f, SUPER, 'GET', `?kind=governance&ref=${REQ.ref}`)).status, 200);
});
