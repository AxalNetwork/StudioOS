/**
 * D4811 (#4811) part 6 — the high-risk governance moves (boards CT-12, CT-16):
 * executing or archiving a record needs a reason, the typed word and a recent
 * step-up, all on the server; executing needs the evidence chosen explicitly
 * (the signed copy as a version, or the completed envelope), and the audit
 * row keeps the reason and the evidence. A form mistake never asks for a
 * step-up. Real migrated schema, in memory; everything is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/governance_high_risk_4811.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import governance, { mount } from '../src/routes/admin_governance.ts';
import { confirmationOf, evidenceOf } from '../src/services/governanceHighRisk.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const JWT_SECRET = 'synthetic-4811-high-risk-only-not-a-real-credential'.repeat(2);
const ADMIN = 2;
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF');
const REASON = 'Board approved on 2026-11-09; synthetic test only.';

function fixture({ stepUp = true } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', 'Alex Made-up', 'alex@example.test', 1)").run(ADMIN);
  // A TOTP sign-in counts as a step-up for its first window; an old one does not.
  db.prepare("INSERT INTO user_sessions (user_id, jti, factor, created_at) VALUES (?, 'sess', 'totp', ?)").run(ADMIN, stepUp ? new Date().toISOString().replace('T', ' ').slice(0, 19) : '2020-01-01 00:00:00');
  db.prepare("INSERT INTO esign_envelopes (id, envelope_uuid, document_type, document_title, document_body, body_sha256, created_by, status) VALUES (40, 'env-40', 'other', 'OA', 'x', ?, 2, 'completed'), (41, 'env-41', 'other', 'Consent', 'x', ?, 2, 'sent')").run('a'.repeat(64), 'b'.repeat(64));
  const files = new Map<string, Uint8Array>();
  const FILES = { async put(k: string, b: Uint8Array) { files.set(k, b); }, async get() { return null; }, async head() { return null; }, async delete(k: string) { files.delete(k); } };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', FILES };
  const app = new Hono<any>().route(mount.path, governance);
  app.onError((err, c) => c.json({ detail: err.message, code: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, app, env };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, method: string, path: string, body?: unknown, form?: FormData) {
  const jwt = await new SignJWT({ user_id: ADMIN, jti: 'sess' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request(`/api/admin/governance${path}`, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) }, f.env);
  return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() as any : null };
}
const upload = (signed: boolean) => { const fd = new FormData(); fd.append('file', new File([PDF_BYTES], 'x.pdf')); if (signed) fd.append('signed', 'true'); return fd; };
async function approved(f: F, o: { envelope?: number } = {}) {
  const made = await call(f, 'POST', '/documents', { entity_key: 'gp', category: 'resolution', title: 'GP resolution', ...(o.envelope ? { envelope_id: o.envelope } : {}) });
  const uid = made.body.document.uid;
  for (const s of ['review', 'approved']) assert.equal((await call(f, 'PATCH', `/documents/${uid}`, { status: s })).status, 200, s);
  return uid;
}
const audits = (f: F) => (f.db.prepare("SELECT details FROM activity_logs WHERE action = 'governance_document_status' ORDER BY id").all() as any[]).map((r) => JSON.parse(r.details));

test('the rules: a reason of 10 to 500 characters and the exact word; evidence named, never guessed', () => {
  assert.equal(confirmationOf('executed', { reason: 'too short', confirm: 'EXECUTED' }).ok, false);
  assert.equal((confirmationOf('executed', { reason: REASON, confirm: 'executed' }) as any).refusal.code, 'confirmation_required', 'the word is exact');
  assert.equal((confirmationOf('archived', { reason: REASON, confirm: 'EXECUTED' }) as any).refusal.code, 'confirmation_required', 'each move has its own word');
  assert.deepEqual(confirmationOf('archived', { reason: `  ${REASON}  `, confirm: 'ARCHIVE' }), { ok: true, reason: REASON });
  assert.equal((confirmationOf('executed', { reason: 'x'.repeat(501), confirm: 'EXECUTED' }) as any).refusal.code, 'reason_required');
  const versions = [{ version: 1, signed: 0 }, { version: 2, signed: 1 }];
  assert.equal((evidenceOf(undefined, versions, null, false) as any).refusal.code, 'evidence_required');
  assert.equal((evidenceOf({ kind: 'version', version: 1 }, versions, null, false) as any).refusal.code, 'evidence_not_signed');
  assert.equal((evidenceOf({ kind: 'version', version: 9 }, versions, null, false) as any).refusal.code, 'evidence_invalid');
  assert.deepEqual((evidenceOf({ kind: 'version', version: 2 }, versions, null, false) as any).evidence, { version: 2, envelope: null });
  assert.equal((evidenceOf({ kind: 'envelope' }, versions, 41, false) as any).refusal.code, 'evidence_not_signed');
  assert.equal((evidenceOf({ kind: 'envelope' }, versions, null, false) as any).refusal.code, 'evidence_invalid');
  assert.deepEqual((evidenceOf({ kind: 'envelope' }, versions, 40, true) as any).evidence, { version: null, envelope: 40 });
});

test('execute with the signed copy chosen: refused without a reason or the word, then executed, with the reason and evidence in the audit', async () => {
  const f = fixture();
  const uid = await approved(f);
  await call(f, 'POST', `/documents/${uid}/versions`, undefined, upload(false));
  await call(f, 'POST', `/documents/${uid}/versions`, undefined, upload(true));
  const noReason = await call(f, 'PATCH', `/documents/${uid}`, { status: 'executed', confirm: 'EXECUTED', evidence: { kind: 'version', version: 2 } });
  assert.deepEqual([noReason.status, noReason.body.error], [422, 'reason_required']);
  const noWord = await call(f, 'PATCH', `/documents/${uid}`, { status: 'executed', reason: REASON, evidence: { kind: 'version', version: 2 } });
  assert.deepEqual([noWord.status, noWord.body.error], [422, 'confirmation_required']);
  const noEvidence = await call(f, 'PATCH', `/documents/${uid}`, { status: 'executed', reason: REASON, confirm: 'EXECUTED' });
  assert.deepEqual([noEvidence.status, noEvidence.body.error], [422, 'evidence_required'], 'the server no longer picks the evidence');
  const draftCopy = await call(f, 'PATCH', `/documents/${uid}`, { status: 'executed', reason: REASON, confirm: 'EXECUTED', evidence: { kind: 'version', version: 1 } });
  assert.deepEqual([draftCopy.status, draftCopy.body.error], [409, 'evidence_not_signed'], 'a version not uploaded as the signed copy is refused by name');
  assert.match(draftCopy.body.message, /v1 was not uploaded as the signed copy/);
  assert.equal((f.db.prepare('SELECT status FROM governance_documents WHERE uid = ?').get(uid) as any).status, 'approved', 'nothing was written by any refusal');
  const done = await call(f, 'PATCH', `/documents/${uid}`, { status: 'executed', reason: REASON, confirm: 'EXECUTED', evidence: { kind: 'version', version: 2 } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual([done.body.document.status, done.body.document.executed_version], ['executed', 2]);
  const last = audits(f).at(-1);
  assert.deepEqual([last.status, last.reason, last.evidence], ['executed', REASON, 'v2']);
  assert.deepEqual(last.fields, ['status'], 'the confirmation fields are not listed as changed fields');
});

test('execute from the completed envelope; archive needs its own word; a stale session is asked to step up, and only after the form checks pass', async () => {
  const f = fixture();
  const uid = await approved(f, { envelope: 40 });
  const viaEnvelope = await call(f, 'PATCH', `/documents/${uid}`, { status: 'executed', reason: REASON, confirm: 'EXECUTED', evidence: { kind: 'envelope' } });
  assert.deepEqual([viaEnvelope.status, viaEnvelope.body.document.envelope_id, viaEnvelope.body.document.executed_version], [200, 40, null]);
  assert.equal(audits(f).at(-1).evidence, 'envelope #40');
  const wrongWord = await call(f, 'PATCH', `/documents/${uid}`, { status: 'archived', reason: REASON, confirm: 'EXECUTED' });
  assert.deepEqual([wrongWord.status, wrongWord.body.error], [422, 'confirmation_required']);
  assert.equal((await call(f, 'PATCH', `/documents/${uid}`, { status: 'archived', reason: REASON, confirm: 'ARCHIVE' })).status, 200);

  const stale = fixture({ stepUp: false });
  const u2 = await approved(stale, { envelope: 40 });
  const form = await call(stale, 'PATCH', `/documents/${u2}`, { status: 'executed', reason: 'short', confirm: 'EXECUTED', evidence: { kind: 'envelope' } });
  assert.deepEqual([form.status, form.body.error], [422, 'reason_required'], 'a form mistake is answered before any step-up is asked');
  const asked = await call(stale, 'PATCH', `/documents/${u2}`, { status: 'executed', reason: REASON, confirm: 'EXECUTED', evidence: { kind: 'envelope' } });
  assert.equal(asked.status, 403);
  assert.equal(asked.body.code, 'step_up_required');
  assert.equal((stale.db.prepare('SELECT status FROM governance_documents WHERE uid = ?').get(u2) as any).status, 'approved', 'nothing changes without the step-up');
  assert.equal((await call(stale, 'PATCH', `/documents/${u2}`, { status: 'review' })).status, 200, 'a move that is not high-risk needs no step-up');
});
