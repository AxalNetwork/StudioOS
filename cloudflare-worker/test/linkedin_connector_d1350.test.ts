/**
 * D1350 (#3565, part 1 of #3564): LinkedIn's connector infrastructure.
 * Synthetic data, the mounted route, the real migrated schema in memory, KV a
 * map, and LinkedIn's token and userinfo endpoints stubbed.
 *
 *   · the OAuth state is single-use: a replayed callback is refused;
 *   · no token appears in any reply, log line or stored row;
 *   · the connection records the scopes LinkedIn granted, and status reports
 *     them with the last import job;
 *   · disconnect revokes and audits; with `delete_imported` it deletes only the
 *     contacts LinkedIn alone gave, and provenance survives for the rest;
 *   · another member's job reads as 404;
 *   · migration 651 copies the identity already on `users`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import linkedin from '../src/routes/linkedin.ts';
import { finishImportJob, recordSource, startImportJob } from '../src/services/linkedinConnections.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

const root = new URL('../sql/', import.meta.url);
const baseline = readFileSync(new URL('schema_baseline.sql', root), 'utf8');
const names = readdirSync(new URL('migrations/', root)).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort();
const read = (n: string) => readFileSync(new URL('migrations/' + n, root), 'utf8');
const JWT_SECRET = 'synthetic-d1350-only-not-a-real-credential'.repeat(2);
const TOKEN = 'SYNTHETIC-LINKEDIN-ACCESS-TOKEN-d1350';

/** The schema up to (not including) 651, so a test can seed `users.linkedin_*` before the copy runs. */
function schema(upTo651 = true) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  db.exec(baseline);
  for (const n of names) if (!upTo651 || migrationNumber(n) < 651) db.exec(read(n));
  return db;
}
// 651 alone: a later migration (652's ALTER TABLE, D1351) is not written to be applied twice.
const apply651 = (db: DatabaseSync) => { for (const n of names) if (migrationNumber(n) === 651) db.exec(read(n)); };

function fixture() {
  const db = schema();
  const insert = db.prepare('INSERT INTO users(id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  insert.run(2, 'founder', 'Synthetic founder', 'synthetic-2@example.invalid');
  insert.run(3, 'founder', 'Synthetic other', 'synthetic-3@example.invalid');
  apply651(db);
  const kv = new Map<string, string>();
  const RATE_LIMITS = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); }, delete: async (k: string) => { kv.delete(k); } };
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', RATE_LIMITS, LINKEDIN_CLIENT_ID: 'synthetic-client', LINKEDIN_CLIENT_SECRET: 'synthetic-secret', APP_URL: 'https://axal.vc' };
  const app = new Hono<any>().route('/api/linkedin', linkedin);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const printed: string[] = [];
  const quiet = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) (console as any)[k] = (...a: unknown[]) => printed.push(a.map(String).join(' '));
  const real = globalThis.fetch;
  let tokenCalls = 0;
  globalThis.fetch = (async (input: any) => {
    const url = String(typeof input === 'string' ? input : input.url);
    if (url.startsWith('https://www.linkedin.com/oauth/v2/accessToken')) { tokenCalls += 1; return Response.json({ access_token: TOKEN, scope: 'email,openid,profile', expires_in: 3600 }); }
    if (url.startsWith('https://api.linkedin.com/v2/userinfo')) return Response.json({ sub: 'synthetic-sub-2', email: 'founder@example.invalid', name: 'Synthetic founder' });
    throw new Error(`no network in this test: ${url}`);
  }) as any;
  const close = () => { globalThis.fetch = real; Object.assign(console, quiet); db.close(); };
  return { db, env, app, kv, printed, tokenCalls: () => tokenCalls, close };
}
type F = ReturnType<typeof fixture>;
const bearer = async (who: number) => `Bearer ${await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
async function call(f: F, who: number | null, path: string, init: { method?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = who ? { Authorization: await bearer(who) } : {};
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  const res = await f.app.request('https://axal.vc' + path, { method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'), headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text, location: res.headers.get('location') || '' };
}
async function signIn(f: F, who = 2) {
  const start = await call(f, who, '/api/linkedin/oauth/start', { json: {} });
  const state = new URL(start.body.authorize_url).searchParams.get('state')!;
  const back = await call(f, null, `/api/linkedin/oauth/callback?code=synthetic-code&state=${encodeURIComponent(state)}`);
  return { state, back, start };
}

test('the OAuth state is single-use: a replayed callback is refused and LinkedIn is not asked again', async () => {
  const f = fixture();
  try {
    const { state, back, start } = await signIn(f);
    assert.equal(new URL(start.body.authorize_url).searchParams.get('scope'), 'openid profile email');
    assert.match(back.location, /\/refer\?linkedin=connected$/);
    const replay = await call(f, null, `/api/linkedin/oauth/callback?code=synthetic-code&state=${encodeURIComponent(state)}`);
    assert.match(replay.location, /linkedin=error&linkedin_error=state_invalid/);
    assert.equal(f.tokenCalls(), 1, 'the replay never reached the token exchange');
    const forged = await call(f, null, `/api/linkedin/oauth/callback?code=x&state=${encodeURIComponent(state.split('.')[0] + '.forged')}`);
    assert.match(forged.location, /state_invalid/);
  } finally { f.close(); }
});

test('the connection keeps the granted scopes and no token, anywhere: replies, logs or rows', async () => {
  const f = fixture();
  try {
    const { back } = await signIn(f);
    const conn = f.db.prepare('SELECT * FROM linkedin_connections WHERE user_id = 2').get() as any;
    assert.equal(conn.linkedin_sub, 'synthetic-sub-2');
    assert.equal(conn.scopes, 'email openid profile');
    assert.equal(conn.status, 'active'); assert.equal(conn.token_enc, null);
    const status = await call(f, 2, '/api/linkedin/status');
    assert.equal(status.body.connected, true); assert.equal(status.body.status, 'active');
    assert.deepEqual(status.body.scopes, ['email', 'openid', 'profile']);
    assert.equal(status.body.last_import, null);
    const audit = f.db.prepare('SELECT event, owner_user_id, subject FROM integration_audit_log ORDER BY id').all() as any[];
    assert.deepEqual(audit.map((a) => a.event), ['connect']);
    const everything = [back.location, status.text, f.printed.join('\n'), JSON.stringify(f.db.prepare('SELECT * FROM linkedin_connections').all()),
      JSON.stringify(f.db.prepare('SELECT * FROM integration_audit_log').all()), JSON.stringify(f.db.prepare('SELECT * FROM activity_logs').all())].join('\n');
    assert.doesNotMatch(everything, new RegExp(TOKEN), 'the access token is thrown away');
    assert.doesNotMatch(JSON.stringify(audit), /founder@example\.invalid/, 'no email in the audit log');
  } finally { f.close(); }
});

/** A book with three rows: one only LinkedIn gave, one typed and later matched by LinkedIn, one from LinkedIn and a spreadsheet. */
async function seedBook(f: F) {
  const add = (name: string) => Number((f.db.prepare("INSERT INTO network_connections (user_id, name, email, source) VALUES (2, ?, ?, 'import') RETURNING id").get(name, `${name.replace(/ /g, '.')}@example.invalid`) as any).id);
  const only = add('Only LinkedIn'), typed = add('Typed first'), both = add('Two sources');
  const job = await startImportJob(f.env, 2, 'linkedin_csv', 3);
  await recordSource(f.env, 2, { contactId: only, source: 'linkedin_csv', jobId: job.id, ref: 'row 2', created: true });
  await recordSource(f.env, 2, { contactId: typed, source: 'linkedin_csv', jobId: job.id, ref: 'row 3', created: false });
  await recordSource(f.env, 2, { contactId: both, source: 'linkedin_csv', jobId: job.id, ref: 'row 4', created: true });
  await recordSource(f.env, 2, { contactId: both, source: 'csv', created: false });
  await finishImportJob(f.env, 2, job, { created: 2, matched: 1, skipped: 0, errors: 0 });
  return { only, typed, both, job };
}

test('disconnect without deleting keeps the book; with delete_imported it deletes only what LinkedIn alone gave', async () => {
  const f = fixture();
  try {
    await signIn(f);
    const book = await seedBook(f);
    const status = await call(f, 2, '/api/linkedin/status');
    assert.equal(status.body.last_import.uid, book.job.uid);
    assert.deepEqual([status.body.last_import.rows_created, status.body.last_import.rows_matched, status.body.last_import.status], [2, 1, 'done']);
    // D1352 (#3567): the page says, before Disconnect, what "Also delete" deletes and keeps.
    assert.deepEqual(status.body.imported, { linkedin_only: 1, kept: 2 });
    const keep = await call(f, 2, '/api/linkedin/disconnect', { json: {} });
    assert.deepEqual(keep.body, { ok: true, deleted_imported: 0, kept_imported: null });
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM network_connections WHERE user_id = 2').get() as any).n, 3);
    const conn = f.db.prepare('SELECT status, disconnected_at, token_enc FROM linkedin_connections WHERE user_id = 2').get() as any;
    assert.equal(conn.status, 'revoked'); assert.ok(conn.disconnected_at); assert.equal(conn.token_enc, null);
    assert.equal((await call(f, 2, '/api/linkedin/status')).body.status, 'revoked');
    // Sign in again and disconnect, deleting.
    await signIn(f);
    const del = await call(f, 2, '/api/linkedin/disconnect', { json: { delete_imported: true } });
    assert.deepEqual(del.body, { ok: true, deleted_imported: 1, kept_imported: 2 });
    const left = (f.db.prepare('SELECT id FROM network_connections WHERE user_id = 2 ORDER BY id').all() as any[]).map((r) => r.id);
    assert.deepEqual(left, [book.typed, book.both], 'the typed row and the two-source row stay');
    const prov = (f.db.prepare('SELECT contact_id, source FROM contact_sources ORDER BY id').all() as any[]).map((r) => `${r.contact_id}:${r.source}`);
    assert.deepEqual(prov, [`${book.typed}:linkedin_csv`, `${book.both}:linkedin_csv`, `${book.both}:csv`], 'their provenance survives');
    const events = (f.db.prepare('SELECT event, subject FROM integration_audit_log ORDER BY id').all() as any[]);
    assert.deepEqual(events.map((e) => e.event), ['connect', 'import', 'disconnect', 'connect', 'disconnect', 'delete']);
    assert.equal(events.at(-1).subject, '1 imported contact');
    assert.doesNotMatch(JSON.stringify(events), /@example\.invalid/, 'counts and uids only, never an email');
  } finally { f.close(); }
});

test('another member\'s import job reads as 404, and their book is never touched', async () => {
  const f = fixture();
  try {
    const book = await seedBook(f);
    assert.equal((await call(f, 2, `/api/linkedin/imports/${book.job.uid}`)).status, 200);
    assert.equal((await call(f, 3, `/api/linkedin/imports/${book.job.uid}`)).status, 404);
    assert.deepEqual((await call(f, 3, '/api/linkedin/imports')).body, { jobs: [] });
    assert.equal((await call(f, 3, '/api/linkedin/status')).body.last_import, null);
    assert.equal((await call(f, null, '/api/linkedin/imports')).status, 401);
    // Member 3 deleting their own LinkedIn contacts deletes none of member 2's.
    assert.equal((await call(f, 3, '/api/linkedin/disconnect', { json: { delete_imported: true } })).body.deleted_imported, 0);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM network_connections WHERE user_id = 2').get() as any).n, 3);
    // A source can only be recorded on the owner's own row.
    await recordSource(f.env, 3, { contactId: book.only, source: 'linkedin_csv', created: true });
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM contact_sources WHERE owner_user_id = 3').get() as any).n, 0);
  } finally { f.close(); }
});

test('migration 651 copies the identity already on users, once, and only where there is one', () => {
  const db = schema();
  const insert = db.prepare('INSERT INTO users(id, role, name, email, is_active, linkedin_sub, linkedin_connected_at) VALUES (?, ?, ?, ?, 1, ?, ?)');
  insert.run(2, 'founder', 'Synthetic founder', 'synthetic-2@example.invalid', 'synthetic-sub-2', '2026-09-01T10:00:00Z');
  insert.run(3, 'founder', 'Synthetic other', 'synthetic-3@example.invalid', null, null);
  insert.run(4, 'founder', 'Synthetic blank', 'synthetic-4@example.invalid', '  ', null);
  apply651(db);
  apply651(db); // idempotent: applying again copies nothing twice
  const rows = db.prepare('SELECT user_id, linkedin_sub, scopes, status, connected_at, token_enc FROM linkedin_connections').all() as any[];
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ user_id: 2, linkedin_sub: 'synthetic-sub-2', scopes: 'openid profile email', status: 'active', connected_at: '2026-09-01T10:00:00Z', token_enc: null }]);
  assert.equal((db.prepare('SELECT linkedin_sub FROM users WHERE id = 2').get() as any).linkedin_sub, 'synthetic-sub-2', 'the badge columns stay');
  assert.throws(() => db.prepare("INSERT INTO linkedin_connections (user_id, linkedin_sub, status) VALUES (3, 's', 'paused')").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO integration_audit_log (owner_user_id, provider, event) VALUES (2, 'linkedin', 'read_token')").run(), /CHECK/);
  db.close();
});
