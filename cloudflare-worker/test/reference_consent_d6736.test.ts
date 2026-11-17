import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { DEFAULT_REFERENCE_CONSENT } from '../../frontend/src/lib/referenceConsent.js';
import references from '../src/routes/references.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { SCHEMA_OPTIONS, loadSchema } from './_schema_once.mjs';

test('D6736: the stored default matches the shared copy; recordings stay unavailable and notes summaries require notes', async (t) => {
  const db = new DatabaseSync(':memory:', SCHEMA_OPTIONS);
  t.after(() => db.close());
  loadSchema(db);
  db.exec(`
    INSERT INTO users (id, role, name, email, is_active) VALUES (10001, 'admin', 'Fixture Admin', 'references@example.test', 1);
    INSERT INTO projects (id, name) VALUES (10001, 'Fixture company');
    INSERT INTO deals (id, project_id) VALUES (10001, 10001);
  `);
  const secret = 'fixture-reference-consent-jwt-secret-6736';
  const token = await new SignJWT({ user_id: 10001, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
  const env = { JWT_SECRET: secret, ENVIRONMENT: 'development', DB: d1Over(db) };
  const call = (path: string, method: string, body?: object) => references.request(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  }, env as any);

  const create = await call('/', 'POST', { deal_id: 10001, reference_name: 'Fixture reference', consent_given: true });
  assert.equal(create.status, 200);
  const row = await create.json() as { id: number; consent_text: string };
  assert.equal(row.consent_text, DEFAULT_REFERENCE_CONSENT);
  const customText = 'Consent supplied by the caller.';
  const custom = await call(`/${row.id}/consent`, 'POST', { consent_given: true, consent_text: customText });
  assert.equal(custom.status, 200);
  assert.equal((await custom.json() as { consent_text: string }).consent_text, customText);
  const capture = await call(`/${row.id}/consent`, 'POST', { consent_given: true });
  assert.equal(capture.status, 200);
  assert.equal((await capture.json() as { consent_text: string }).consent_text, DEFAULT_REFERENCE_CONSENT);
  assert.equal(db.prepare('SELECT consent_text FROM reference_checks WHERE id = ?').get(row.id)?.consent_text, DEFAULT_REFERENCE_CONSENT);

  for (const [path, method] of [
    ['recording', 'POST'], ['recording-url', 'GET'], ['transcribe', 'POST'],
  ]) {
    assert.equal((await call(`/${row.id}/${path}`, method)).status, 404, 'Recording and transcription routes must stay absent until their consent is reviewed');
  }
  const summary = await call(`/${row.id}/summarize`, 'POST');
  assert.equal(summary.status, 409, 'Typed-note summarisation requires notes and does not enable call recording');
  assert.equal((await summary.json() as { code: string }).code, 'notes_required');
  assert.doesNotMatch(DEFAULT_REFERENCE_CONSENT, /record|transcri|summari/i);
});
