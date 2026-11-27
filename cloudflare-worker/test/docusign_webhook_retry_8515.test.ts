/**
 * D8515 (#8515) — a DocuSign Connect delivery is marked as seen only once its
 * work is durable, and a delivery that could not be reconciled is answered
 * with a retryable status, so DocuSign's redelivery reconciles instead of
 * being rejected as a replay.
 *
 * The shared receiver (`POST /api/integrations/webhook/docusign/:uid`), the
 * real DocuSign provider, the column cipher and the full schema run against
 * SQLite; KV is the in-memory stand-in, R2 a stub whose `put` can fail, and
 * `fetch` a stub that answers only DocuSign's envelope and document URLs.
 * No request leaves the process.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import integrations from '../src/routes/integrations.ts';
import { ensureIntegrationsSchema, getProviderImpl } from '../src/integrations/registry.ts';
import { encryptCredentials, encryptWebhookSecret } from '../src/integrations/secrets.ts';
import { syncAllDocusignIntegrations } from '../src/integrations/providers/docusign.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { memKV } from './_mem_kv.mjs';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'd'.repeat(64); // synthetic fixture key
const SIGNING_KEY = 'docusign-fixture-connect-key';
const BASE = 'https://demo.docusign.example';
const ACCOUNT = 'acct-fixture';
const DS_ENV = '11111111-2222-3333-4444-555555555555';
const ENVELOPE_URL = `${BASE}/restapi/v2.1/accounts/${ACCOUNT}/envelopes/${DS_ENV}`;
const PDF_URL = `${ENVELOPE_URL}/documents/combined`;
const UID = 'docusign8515'.padEnd(32, '0');

const app = new Hono<any>();
app.route('/api/integrations', integrations);

type Answer = { status: number; json?: unknown; bytes?: Uint8Array };

async function fixture() {
  const db = loadSchema(new DatabaseSync(':memory:', { enableForeignKeyConstraints: false }));
  const files = { fail: 0, puts: 0, async put(_key: string) { if (files.fail > 0) { files.fail--; throw new Error('r2_unavailable'); } files.puts++; return { key: _key }; } };
  const env = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS: memKV(), FILES: files } as any;
  await ensureIntegrationsSchema(env);
  db.exec("INSERT OR IGNORE INTO users (id, email, name, role) VALUES (1, 'owner@example.test', 'Owner', 'admin')");
  const creds = await encryptCredentials(env, UID, { access_token: 'ds-fixture-access', token_type: 'Bearer' } as any);
  const secret = await encryptWebhookSecret(env, UID, SIGNING_KEY);
  db.prepare(`INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type, credentials_enc, webhook_secret_enc, config_json, external_account_id)
    VALUES (7, ?, 1, 'docusign', 'active', 'oauth2', ?, ?, ?, ?)`)
    .run(UID, creds, secret, JSON.stringify({ base_uri: BASE, account_id: ACCOUNT }), ACCOUNT);
  db.prepare(`INSERT INTO esign_envelopes (id, envelope_uuid, document_type, document_title, document_body, body_sha256, created_by, status, provider, docusign_envelope_id, docusign_account_id)
    VALUES (40, 'env-uuid-8515', 'nda', 'Fixture NDA', 'body', 'sha', 1, 'sent', 'docusign', ?, ?)`).run(DS_ENV, ACCOUNT);
  return { db, env, files };
}

/** `fetch` answered per URL from `answers`, each a queue (the last entry repeats); `hold` delays the envelope read. */
function stubFetch(answers: Record<string, Answer[]>, hold?: Promise<void>) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);
    const q = answers[url];
    if (!q) throw new Error(`unstubbed fetch: ${url}`);
    if (hold && url === ENVELOPE_URL) await hold;
    const a = q.length > 1 ? q.shift()! : q[0];
    if (a.bytes) return new Response(a.bytes, { status: a.status });
    return new Response(JSON.stringify(a.json ?? {}), { status: a.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, reads: () => calls.filter((u) => u === ENVELOPE_URL).length, restore: () => { globalThis.fetch = original; } };
}

const BODY = JSON.stringify({ event: 'envelope-completed', data: { envelopeId: DS_ENV } });
async function deliver(env: any, body = BODY) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)));
  const sig = btoa(String.fromCharCode(...mac));
  const res = await app.request(`/api/integrations/webhook/docusign/${UID}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DocuSign-Signature-1': sig }, body,
  }, env);
  return { status: res.status, body: await res.json() as any };
}

const PDF = new TextEncoder().encode('%PDF-1.7 fixture signed copy');
const completed = (): Record<string, Answer[]> => ({
  [ENVELOPE_URL]: [{ status: 200, json: { status: 'completed' } }],
  [PDF_URL]: [{ status: 200, bytes: PDF }],
});
const envelope = (db: DatabaseSync) => db.prepare('SELECT status, signed_r2_key FROM esign_envelopes WHERE id = 40').get() as any;
const fileRows = (db: DatabaseSync) => Number((db.prepare("SELECT COUNT(*) AS n FROM legal_document_files WHERE kind = 'docusign_signed' AND envelope_id = 40").get() as any).n);
const logs = (db: DatabaseSync) => db.prepare("SELECT status, response_summary FROM integration_logs WHERE provider_key = 'docusign' AND event_type = 'webhook' ORDER BY id").all() as any[];

test('a transient provider failure is answered 500 and logged as error; the identical redelivery reconciles', async () => {
  const { db, env } = await fixture();
  const answers = completed();
  answers[ENVELOPE_URL] = [{ status: 503, json: { errorCode: 'UNAVAILABLE', message: 'recipient pii@example.test' } }, { status: 200, json: { status: 'completed' } }];
  const f = stubFetch(answers);
  try {
    const first = await deliver(env);
    assert.equal(first.status, 500);
    assert.equal(envelope(db).status, 'sent');
    assert.deepEqual(logs(db).map((l) => l.status), ['error']);
    assert.match(logs(db)[0].response_summary, /^reconcile failed: docusign_envelope_read_failed$/);
    assert.doesNotMatch(logs(db)[0].response_summary, /pii@/);

    const second = await deliver(env);
    assert.equal(second.status, 200);
    assert.equal(envelope(db).status, 'completed');
    assert.equal(fileRows(db), 1);
    assert.deepEqual(logs(db).map((l) => l.status), ['error', 'ok']);
    assert.match(logs(db)[1].response_summary, /updated=true/);
  } finally { f.restore(); }
});

test('a storage failure after the provider read is answered 500; the identical redelivery reconciles', async () => {
  const { db, env, files } = await fixture();
  files.fail = 1;
  const f = stubFetch(completed());
  try {
    const first = await deliver(env);
    assert.equal(first.status, 500);
    assert.equal(envelope(db).status, 'sent');
    assert.equal(envelope(db).signed_r2_key, null);
    assert.equal(logs(db)[0].status, 'error');

    const second = await deliver(env);
    assert.equal(second.status, 200);
    assert.equal(envelope(db).status, 'completed');
    assert.equal(envelope(db).signed_r2_key, 'esign/signed/env-uuid-8515.pdf.enc');
    assert.equal(files.puts, 1);
    assert.equal(fileRows(db), 1);
  } finally { f.restore(); }
});

test('a signed PDF the provider will not return is a failure, not "no change"', async () => {
  const { db, env } = await fixture();
  const answers = completed();
  answers[PDF_URL] = [{ status: 502 }, { status: 200, bytes: PDF }];
  const f = stubFetch(answers);
  try {
    assert.equal((await deliver(env)).status, 500);
    assert.equal(envelope(db).status, 'sent');
    assert.match(logs(db)[0].response_summary, /docusign_pdf_pull_failed/);
    assert.equal((await deliver(env)).status, 200);
    assert.equal(envelope(db).status, 'completed');
  } finally { f.restore(); }
});

test('two identical deliveries at once: one reconciliation, one registry row; the other is told to retry', async () => {
  const { db, env } = await fixture();
  let release!: () => void;
  const hold = new Promise<void>((r) => { release = r; });
  const f = stubFetch(completed(), hold);
  try {
    const a = deliver(env);
    // Let the first delivery write its pending marker and reach the held read.
    while (f.reads() === 0) await new Promise((r) => setImmediate(r));
    const b = await deliver(env);
    assert.equal(b.status, 500);
    assert.match(logs(db)[0].response_summary, /docusign_delivery_in_progress/);
    release();
    assert.equal((await a).status, 200);
    assert.equal(f.reads(), 1);
    assert.equal(fileRows(db), 1);
    assert.equal(envelope(db).status, 'completed');

    // DocuSign's retry of the second delivery now arrives after the first finished: a replay.
    const retry = await deliver(env);
    assert.equal(retry.status, 200);
    assert.equal(f.reads(), 1);
    assert.match(logs(db).at(-1).response_summary, /^replay rejected/);
  } finally { f.restore(); }
});

test('a delivery racing the poller: one registry row, and the final status written once', async () => {
  const { db, env } = await fixture();
  let release!: () => void;
  const hold = new Promise<void>((r) => { release = r; });
  const f = stubFetch(completed(), hold);
  try {
    // Both paths read the envelope as `sent` before either writes.
    const hook = deliver(env);
    const sweep = syncAllDocusignIntegrations(env);
    while (f.reads() < 2) await new Promise((r) => setImmediate(r));
    release();
    assert.equal((await hook).status, 200);
    assert.equal((await sweep).ok, 1);
    assert.equal(envelope(db).status, 'completed');
    assert.equal(fileRows(db), 1);
    const audit = Number((db.prepare("SELECT COUNT(*) AS n FROM esign_audit_events WHERE envelope_id = 40 AND action = 'docusign_completed'").get() as any).n);
    assert.equal(audit, 1, 'the transition is recorded once');
    const updated = logs(db).filter((l) => /updated=true/.test(l.response_summary)).length;
    // The webhook either won (updated=true, and the sweep changed nothing) or lost (updated=false).
    assert.ok(updated <= 1);
  } finally { f.restore(); }
});

test('a true replay after success is still rejected, with no provider read', async () => {
  const { db, env } = await fixture();
  const f = stubFetch(completed());
  try {
    assert.equal((await deliver(env)).status, 200);
    assert.equal(f.reads(), 1);
    const again = await deliver(env);
    assert.equal(again.status, 200);
    assert.equal(f.reads(), 1);
    assert.deepEqual(logs(db).map((l) => l.status), ['ok', 'ok']);
    assert.match(logs(db)[1].response_summary, /^replay rejected \(docusign_envelope=/);
  } finally { f.restore(); }
});

test('the poller counts a provider read that is not OK as an error, never as "no change"', async () => {
  const { db, env } = await fixture();
  const f = stubFetch({ [ENVELOPE_URL]: [{ status: 500 }] });
  try {
    const row = db.prepare('SELECT * FROM integrations WHERE id = 7').get() as any;
    const out = await getProviderImpl('docusign')!.sync!({ env } as any, {} as any, row);
    assert.equal(out.summary, 'polled=1 updated=0 errors=1');
    assert.equal(envelope(db).status, 'sent');
  } finally { f.restore(); }
});
