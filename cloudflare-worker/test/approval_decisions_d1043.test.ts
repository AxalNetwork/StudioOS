/** D1043: real mounted routes, baseline + full migration chain, synthetic data. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import comarketing from '../src/routes/comarketing.ts';
import wellbeing from '../src/routes/wellbeing.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { expertDecision } from '../src/services/wellbeing/expertReview.ts';
import { APPROVAL_SOURCES } from '../src/services/approvalSources.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';

// A broken refusal under mutation must still never contact a real provider.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('External transport must be captured by this fixture'); };
after(() => { globalThis.fetch = originalFetch; });

const scratch = mkdtempSync(join(tmpdir(), 'approvals-d1043-'));
const seed = join(scratch, 'chain.sqlite');
const read = (p: string) => readFileSync(p, 'utf8');
{
  // Apply every migration in memory, then persist one snapshot. This keeps
  // the same full-chain fixture without thousands of filesystem syncs.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(read('cloudflare-worker/sql/schema_baseline.sql'));
  const dir = 'cloudflare-worker/sql/migrations';
  for (const name of readdirSync(dir).filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF).sort()) {
    if (migrationNumber(name) === 577) db.exec("INSERT INTO experts(uid,name,verified) VALUES('legacy-verified','Synthetic legacy expert',1)");
    db.exec(read(`${dir}/${name}`));
  }
  db.prepare('VACUUM INTO ?').run(seed);
  db.close();
}
after(() => rmSync(scratch, { recursive: true, force: true }));
const SECRET = 'x'.repeat(48);
let serial = 0;
function fixture() {
  const file = join(scratch, `${++serial}.sqlite`); copyFileSync(seed, file);
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false });
  const legacy = db.prepare("SELECT decision_state, decided_by, decided_at FROM experts WHERE uid='legacy-verified'").get();
  db.exec(`DELETE FROM experts;
    INSERT INTO users(id,role,name,email,is_active,partner_id) VALUES
    (1,'admin','Synthetic admin','admin@example.invalid',1,NULL),
    (2,'admin','Frozen admin','frozen@example.invalid',1,NULL),
    (3,'partner','Synthetic expert','expert@example.invalid',1,7),
    (4,'founder','Other member','other@example.invalid',1,NULL),
    (6,'admin','Other admin','other-admin@example.invalid',1,NULL),
    (7,'admin','Super admin','super@example.invalid',1,NULL);
    INSERT INTO super_admins(user_id) VALUES(7);
    INSERT INTO partners(id,name,company,email) VALUES(7,'Synthetic partner','Synthetic agency','partner@example.invalid');
    INSERT INTO experts(uid,user_id,name,created_at) VALUES('expert-a',3,'Synthetic expert','2026-10-01 00:00:00');
    INSERT INTO admin_notices(uid,user_id,kind,subject,body,respond_by,status)
    VALUES('overdue-notice',2,'fees','Synthetic notice','Synthetic body','2026-01-01','overdue');`);
  const objects = new Map<string, Uint8Array>();
  const env: any = { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development',
    GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'x', GMAIL_REFRESH_TOKEN: 'x',
    FILES: { async put(key: string, value: Uint8Array) { objects.set(key, value.slice()); },
      async get(key: string) { const value = objects.get(key); return value ? { body: new Response(value).body } : null; },
      async delete(key: string) { objects.delete(key); } },
  };
  const app = new Hono<any>(); app.route('/api/comarketing', comarketing); app.route('/api/wellbeing', wellbeing);
  app.onError((e, c) => c.json({ detail: e.message }, AUTH_ERROR_STATUSES[e.message] ?? 500));
  return { db, env, app, objects, legacy };
}
type F = ReturnType<typeof fixture>;
async function call(f: F, who: number | null, method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  const token = who === null ? null : await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const raw = body instanceof Uint8Array;
  const res = await f.app.request(path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }) }, f.env);
  const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, body: data, headers: res.headers };
}
const wb = '/api/wellbeing'; const cm = '/api/comarketing';
const one = (f: F, sql: string, ...args: any[]) => f.db.prepare(sql).get(...args) as any;
const expert = (f: F) => one(f, "SELECT * FROM experts WHERE uid='expert-a'");
function pitch(f: F, id: number, status = 'proposed') {
  f.db.prepare(`INSERT INTO comarketing_pitches(id,uid,partner_id,submitter_user_id,title,summary,asset_type,status,created_at,updated_at)
    VALUES(?,?,7,3,?,'Synthetic summary','webinar',?,'2026-10-01 00:00:00','2026-10-01 00:00:00')`).run(id, `pitch-${id}`, `Synthetic pitch ${id}`, status);
}
async function captureMail(fn: (sent: string[]) => Promise<void>) {
  const original = globalThis.fetch; const sent: string[] = [];
  globalThis.fetch = async (url: any, init: any) => {
    if (new URL(String(url)).hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'fake' });
    if (new URL(String(url)).hostname === 'gmail.googleapis.com') {
      sent.push(Buffer.from(JSON.parse(init.body).raw, 'base64url').toString('utf8'));
      return Response.json({ id: 'fake-message' });
    }
    throw new Error('Unexpected external request in fixture');
  };
  try { await fn(sent); } finally { globalThis.fetch = original; }
}

test('migration preserves real legacy verification without inventing an actor or time', () => {
  assert.deepEqual({ ...fixture().legacy }, { decision_state: 'verified', decided_by: null, decided_at: null });
});

test('co-marketing: stable oldest-first pages, full total, per-pitch and full filtered-queue 30-day attribution', async () => {
  const f = fixture(); pitch(f, 1); pitch(f, 2); pitch(f, 3); pitch(f, 4, 'rejected');
  f.db.exec("UPDATE comarketing_pitches SET created_at='2026-10-03 00:00:00' WHERE id=3");
  f.db.exec(`INSERT INTO comarketing_attributions(uid,pitch_id,partner_id,event_kind,created_at) VALUES
    ('recent-1',1,7,'visit',datetime('now','-2 days')), ('recent-2',2,7,'lead',datetime('now','-1 day')),
    ('old',2,7,'lead',datetime('now','-31 days')), ('future',2,7,'visit',datetime('now','+2 days')),
    ('other-status',4,7,'signup',datetime('now','-1 day'));`);
  const r = await call(f, 1, 'GET', `${cm}/admin/queue?limit=1&offset=1`);
  assert.equal(r.status, 200); assert.equal(r.body.total, 3);
  assert.deepEqual(r.body.items.map((x: any) => x.uid), ['pitch-2']);
  assert.deepEqual(r.body.items[0].attribution_30d, { visit: 0, signup: 0, lead: 1, conversion: 0, total: 1 });
  assert.deepEqual(r.body.items[0].attribution, { visit: 1, signup: 0, lead: 2, conversion: 0, total: 3 });
  assert.equal(r.body.items[0].partner_name, 'Synthetic partner');
  assert.deepEqual(r.body.attribution_30d, { visit: 1, signup: 0, lead: 1, conversion: 0, total: 2 });
  assert.equal((await call(f, 1, 'GET', `${cm}/admin/queue?status=all`)).body.total, 4);
  for (const query of ['limit=0', 'limit=201', 'offset=-1', 'status=unknown']) assert.equal((await call(f, 1, 'GET', `${cm}/admin/queue?${query}`)).status, 400);
});

test('co-marketing decisions send inbox + email, preserve the decline reason, and reject repeat transitions', async () => captureMail(async (sent) => {
  const f = fixture(); pitch(f, 1); pitch(f, 2);
  assert.equal((await call(f, 1, 'POST', `${cm}/admin/pitches/pitch-1/approve`, {})).status, 200);
  for (const published_url of ['', 'http://example.test', 'javascript:alert(1)', 'https://user:password@example.test', `https://example.test/${'a'.repeat(501)}`]) {
    const r = await call(f, 1, 'POST', `${cm}/admin/pitches/pitch-1/publish`, { published_url });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'https_url_required');
  }
  assert.equal(sent.length, 1);
  assert.equal((await call(f, 1, 'POST', `${cm}/admin/pitches/pitch-1/publish`, { published_url: 'https://example.test/post' })).status, 200);
  assert.equal((await call(f, 1, 'POST', `${cm}/admin/pitches/pitch-2/reject`, { notes: '  Not a fit for this quarter.  ' })).status, 200);
  const rows = f.db.prepare('SELECT user_id,type,body FROM notifications_inbox ORDER BY id').all() as any[];
  assert.deepEqual(rows.map((r) => [r.user_id, r.type]), [[3, 'comarketing_approved'], [3, 'comarketing_published'], [3, 'comarketing_rejected']]);
  assert.match(rows[2].body, /Reason: Not a fit for this quarter\./);
  assert.match(rows[1].body, /https:\/\/example.test\/post/);
  assert.equal(sent.length, 3); assert.ok(sent.every((mime) => mime.includes('expert@example.invalid')));
  assert.equal((await call(f, 1, 'POST', `${cm}/admin/pitches/pitch-2/reject`, { notes: 'Another long reason.' })).status, 409);
  assert.equal(sent.length, 3);
  assert.equal(one(f, "SELECT COUNT(*) AS n FROM activity_logs WHERE action LIKE 'comarketing_%'").n, 3);
}));

test('expert verification requires the explicit credentials check and current version; it records actor/time and tells the expert', async () => captureMail(async (sent) => {
  const f = fixture(); const path = `${wb}/admin/experts/expert-a/verify`;
  for (const credentials_checked of [undefined, false, 'true']) {
    assert.equal((await call(f, 1, 'POST', path, { verified: true, credentials_checked, expected_version: 0 })).status, 400);
  }
  assert.equal((await call(f, 1, 'POST', path, { verified: true, credentials_checked: true })).body.error, 'version_required');
  assert.equal((await call(f, 1, 'POST', path, { verified: true, credentials_checked: true, expected_version: 9 })).status, 409);
  const startedAt = Date.now();
  const r = await call(f, 1, 'POST', path, { verified: true, credentials_checked: true, expected_version: 0 });
  assert.equal(r.status, 200); assert.equal(r.body.verified, true); assert.equal(r.body.decided_by, 1); assert.ok(r.body.decided_at);
  assert.equal(expert(f).decision_state, 'verified'); assert.equal(expert(f).decided_by, 1);
  const h = one(f, 'SELECT * FROM expert_review_decisions');
  assert.ok(Date.parse(h.decided_at) >= startedAt && Date.parse(h.decided_at) <= Date.now());
  assert.equal(h.credentials_checked, 1); assert.equal(h.decision, 'verified'); assert.equal(h.review_version, 1);
  assert.equal(one(f, 'SELECT user_id FROM notifications_inbox').user_id, 3);
  assert.equal(one(f, 'SELECT type FROM notifications_inbox').type, 'wellbeing_expert_verified'); assert.equal(sent.length, 1);
  assert.equal((await call(f, 1, 'POST', path, { verified: true, credentials_checked: true, expected_version: 1 })).status, 409);
  assert.equal(sent.length, 1);
}));

test('decline reason is mandatory, stored on the expert and trail, and visible in the expert’s notice and own read', async () => captureMail(async (sent) => {
  const f = fixture(); const path = `${wb}/admin/experts/expert-a/decline`;
  f.db.exec("UPDATE experts SET profile_completion_pct=80 WHERE uid='expert-a'");
  const source = APPROVAL_SOURCES.find((s) => s.key === 'wellbeing_experts')!;
  assert.equal(one(f, source.countSql).n, 1);
  assert.equal((await call(f, 1, 'POST', path, { reason: 'short' })).status, 400);
  const r = await call(f, 1, 'POST', path, { reason: '  Please supply the issuing board.  ' });
  assert.equal(r.status, 200); assert.equal(expert(f).decision_state, 'declined'); assert.equal(expert(f).verified, 0);
  assert.equal(expert(f).decline_reason, 'Please supply the issuing board.');
  assert.equal(one(f, 'SELECT reason FROM expert_review_decisions').reason, expert(f).decline_reason);
  assert.match(one(f, 'SELECT body FROM notifications_inbox').body, /Please supply the issuing board/);
  const mine = await call(f, 3, 'GET', `${wb}/experts/me/credentials`);
  assert.equal(mine.body.decline_reason, expert(f).decline_reason); assert.equal(sent.length, 1);
  assert.equal(Object.hasOwn(mine.body, 'decided_by'), false);
  const admin = await call(f, 1, 'GET', `${wb}/admin/experts/expert-a/review`);
  assert.equal(admin.body.expert.decided_by, 1); assert.equal(admin.body.history[0].decided_by, 1);
  const queue = await call(f, 1, 'GET', `${wb}/admin/experts?state=declined`);
  assert.equal(queue.body.items[0].decided_by, 1);
  assert.equal(one(f, source.countSql).n, 0);
  assert.equal(f.db.prepare(source.rowsSql).all(100).length, 0);
}));

test('credential edits invalidate verification, preserve history, reject invalid expiry, and cannot be saved for another expert', async () => captureMail(async () => {
  const f = fixture();
  await call(f, 1, 'POST', `${wb}/admin/experts/expert-a/verify`, { verified: true, credentials_checked: true, expected_version: 0 });
  const path = `${wb}/experts/me/credentials`;
  assert.equal((await call(f, 3, 'PATCH', path, { expires_on: '2026-02-30' })).status, 400);
  const saved = await call(f, 3, 'PATCH', path, { licence_number: 'SYNTHETIC-123', issuer: 'Synthetic board', expires_on: '2099-12-31' });
  assert.equal(saved.status, 200); assert.equal(saved.body.verified, false); assert.equal(saved.body.decision_state, 'pending');
  assert.equal(saved.body.credentials.licence_number, 'SYNTHETIC-123'); assert.equal(saved.body.review_version, 2);
  assert.equal(Object.hasOwn(saved.body, 'decided_by'), false); assert.equal(expert(f).decided_by, null); assert.equal(saved.body.decided_at, null); assert.equal(saved.body.decline_reason, null);
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM expert_review_decisions').n, 1);
  assert.equal((await call(f, 4, 'PATCH', path, { licence_number: 'OTHER' })).status, 404);
  assert.equal((await call(f, 1, 'POST', `${wb}/admin/experts/expert-a/verify`, { verified: true, credentials_checked: true, expected_version: 1 })).status, 409);
  await call(f, 3, 'PATCH', path, { expires_on: '2000-01-01' });
  assert.equal((await call(f, 1, 'POST', `${wb}/admin/experts/expert-a/verify`, { verified: true, credentials_checked: true, expected_version: 3 })).body.error, 'credentials_expired');
}));

const pdf = new TextEncoder().encode('%PDF-1.4\nSynthetic credential');
const upload = (f: F, user = 3, bytes = pdf, extra: Record<string, string> = {}) => call(f, user, 'PUT', `${wb}/experts/me/credentials/files`, bytes,
  { 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.byteLength), 'X-File-Name': 'Synthetic credential.pdf', ...extra });
test('credential files stay private: scoped downloads, attachment headers, owner-only removal and verification invalidation', async () => {
  const f = fixture(); const put = await upload(f);
  f.db.exec("INSERT INTO experts(uid,user_id,name) VALUES('other-expert',4,'Other synthetic expert')");
  assert.equal(put.status, 201); assert.equal(put.body.files.length, 1); assert.equal(f.objects.size, 1);
  const file = put.body.files[0]; assert.ok(!('file_key' in file));
  assert.equal((await call(f, null, 'GET', file.url)).status, 401);
  assert.equal((await call(f, null, 'DELETE', `${wb}/experts/me/credentials/files/${file.uid}`)).status, 401);
  assert.equal((await call(f, 4, 'GET', file.url)).status, 404);
  const own = await call(f, 3, 'GET', file.url); assert.equal(own.status, 200); assert.equal(own.body, new TextDecoder().decode(pdf));
  assert.equal(own.headers.get('cache-control'), 'private, no-store'); assert.match(own.headers.get('content-disposition') || '', /^attachment/);
  assert.equal(own.headers.get('x-content-type-options'), 'nosniff'); assert.match(own.headers.get('content-security-policy') || '', /^sandbox/);
  assert.equal((await call(f, 1, 'GET', file.url)).status, 200);
  assert.equal((await call(f, 4, 'DELETE', `${wb}/experts/me/credentials/files/${file.uid}`)).status, 404);
  assert.equal((await call(f, 3, 'DELETE', `${wb}/experts/me/credentials/files/${file.uid}`)).status, 200);
  assert.equal((await call(f, 3, 'GET', file.url)).status, 404); assert.equal(f.objects.size, 0); assert.equal(expert(f).verified, 0);
});

test('concurrent co-marketing decisions change one row and notify only the winning decision', async () => captureMail(async (sent) => {
  const f = fixture(); pitch(f, 1);
  // Both requests observe proposed before either may update it. Merely
  // starting two promises can let the second observe an already decided row.
  const prepare = f.env.DB.prepare.bind(f.env.DB);
  let release!: () => void; let observed = 0;
  const bothObserved = new Promise<void>((resolve) => { release = resolve; });
  f.env.DB.prepare = (sql: string) => {
    const statement = prepare(sql);
    if (sql === 'SELECT * FROM comarketing_pitches WHERE uid = ?') {
      const first = statement.first.bind(statement);
      statement.first = async () => { const row = await first(); if (++observed === 2) release(); await bothObserved; return row; };
    }
    return statement;
  };
  const results = await Promise.all([
    call(f, 1, 'POST', `${cm}/admin/pitches/pitch-1/approve`, {}),
    call(f, 1, 'POST', `${cm}/admin/pitches/pitch-1/reject`, { notes: 'Synthetic decline reason.' }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM notifications_inbox').n, 1); assert.equal(sent.length, 1);
}));

test('credential uploads enforce the ten-file ceiling and roll back R2 when the database batch fails', async () => {
  const f = fixture();
  const id = expert(f).id;
  for (let n = 0; n < 10; n++) f.db.prepare(`INSERT INTO expert_credential_files(uid,expert_id,file_key,file_name,file_type,file_size,uploaded_by)
    VALUES(?,?,?,'Synthetic.pdf','application/pdf',1,3)`).run(`existing-${n}`, id, `synthetic/${n}`);
  assert.equal((await upload(f)).status, 409); assert.equal(f.objects.size, 0);
  f.db.exec('DELETE FROM expert_credential_files');
  f.env.DB.batch = async () => { throw new Error('Synthetic batch failure'); };
  assert.equal((await upload(f)).status, 503); assert.equal(f.objects.size, 0);
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM expert_credential_files').n, 0);
});

test('a stale expert decision cannot overwrite the winning version or add a second history row or notice', async () => captureMail(async (sent) => {
  const f = fixture(); const observed = expert(f); const actor = { id: 1, role: 'admin' as const };
  await expertDecision(f.env, observed, actor, 'verified', { credentials_checked: true, expected_version: 0 });
  await assert.rejects(expertDecision(f.env, observed, actor, 'declined', { reason: 'Synthetic decline reason.', expected_version: 0 }),
    (e: any) => e.code === 'review_changed');
  assert.equal(expert(f).decision_state, 'verified'); assert.equal(one(f, 'SELECT COUNT(*) AS n FROM expert_review_decisions').n, 1);
  assert.equal(sent.length, 1); assert.equal(one(f, 'SELECT COUNT(*) AS n FROM notifications_inbox').n, 1);
}));

test('concurrent uploads cannot pass the file ceiling or invalidate a record when their insert is refused', async () => {
  const f = fixture(); const id = expert(f).id; const original = f.env.DB.batch.bind(f.env.DB);
  f.env.DB.batch = async (stmts: any[]) => {
    for (let n = 0; n < 10; n++) f.db.prepare(`INSERT INTO expert_credential_files(uid,expert_id,file_key,file_name,file_type,file_size,uploaded_by)
      VALUES(?,?,?,'Synthetic.pdf','application/pdf',1,3)`).run(`raced-${n}`, id, `raced/${n}`);
    return original(stmts);
  };
  assert.equal((await upload(f)).status, 409); assert.equal(f.objects.size, 0);
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM expert_credential_files').n, 10);
  assert.equal(expert(f).review_version, 0);
});

test('PDF, PNG and JPEG signatures are accepted and the exact 10 MB boundary is allowed', async () => {
  const f = fixture();
  for (const [type, bytes] of [['image/png', new Uint8Array([137,80,78,71,13,10,26,10])], ['image/jpeg', new Uint8Array([255,216,255])]] as const) {
    assert.equal((await upload(f, 3, bytes, { 'Content-Type': type })).status, 201);
  }
  const bytes = new Uint8Array(10 * 1024 * 1024); bytes.set(pdf);
  assert.equal((await upload(f, 3, bytes)).status, 201);
});

test('upload and remove both invalidate a verified credential version; evidence is private from other admins', async () => captureMail(async () => {
  const f = fixture();
  await call(f, 1, 'POST', `${wb}/admin/experts/expert-a/verify`, { verified: true, credentials_checked: true, expected_version: 0 });
  const put = await upload(f); assert.equal(put.status, 201); assert.equal(expert(f).verified, 0); assert.equal(expert(f).review_version, 2);
  await call(f, 1, 'POST', `${wb}/admin/experts/expert-a/verify`, { verified: true, credentials_checked: true, expected_version: 2 });
  const uid = put.body.files[0].uid;
  assert.equal((await call(f, 3, 'DELETE', `${wb}/experts/me/credentials/files/${uid}`)).status, 200);
  assert.equal(expert(f).verified, 0); assert.equal(expert(f).review_version, 4);
  f.db.exec("UPDATE experts SET user_id=6 WHERE uid='expert-a'");
  const adminFile = await upload(f, 6); const url = adminFile.body.files[0].url;
  assert.equal((await call(f, 1, 'GET', url)).status, 403);
  assert.equal((await call(f, 7, 'GET', url)).status, 200);
}));

test('malformed decisions are coded refusals and a failed D1 result cannot look like an empty queue', async () => {
  const f = fixture(); pitch(f, 1);
  for (const body of [null, [], 'invalid']) assert.equal((await call(f, 1, 'POST', `${cm}/admin/pitches/pitch-1/approve`, body)).status, 400);
  assert.equal((await call(f, 1, 'POST', `${wb}/admin/experts/expert-a/verify`, { verified: 'false' })).status, 400);
  assert.equal((await call(f, 1, 'POST', `${wb}/admin/experts/expert-a/hide`, {})).status, 400);
  const original = f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare = (sql: string) => {
    const statement = original(sql);
    if (sql.includes('ORDER BY datetime(p.created_at) ASC')) statement.all = async () => ({ success: false, results: [] });
    return statement;
  };
  const failed = await call(f, 1, 'GET', `${cm}/admin/queue`);
  assert.equal(failed.status, 503); assert.equal(failed.body.error, 'queue_unreadable'); assert.ok(!('items' in failed.body));
  f.env.DB.prepare = (sql: string) => {
    const statement = original(sql);
    if (sql.includes('FROM expert_credential_files')) statement.all = async () => ({ success: false, results: [] });
    return statement;
  };
  assert.equal((await call(f, 1, 'GET', `${wb}/admin/experts`)).status, 503);
});

test('file validation and unavailable storage never create a credential record', async () => {
  const f = fixture();
  assert.equal((await upload(f, 3, new TextEncoder().encode('not a PDF'))).status, 415);
  assert.equal((await upload(f, 3, pdf, { 'Content-Type': 'text/html' })).status, 415);
  assert.equal((await upload(f, 3, new Uint8Array([255,216,255]), { 'Content-Type': 'text/html' })).status, 415);
  assert.equal((await upload(f, 3, pdf, { 'Content-Length': '0' })).status, 411);
  assert.equal((await upload(f, 3, pdf, { 'Content-Length': String(11 * 1024 * 1024) })).status, 413);
  assert.equal((await upload(f, 3, pdf, { 'Content-Length': '1' })).status, 413);
  assert.equal((await upload(f, 3, pdf, { 'Content-Length': String(pdf.byteLength + 1) })).status, 400);
  f.env.FILES = undefined; assert.equal((await upload(f)).status, 503);
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM expert_credential_files').n, 0);
});

test('unavailable storage cannot report that a credential file was removed', async () => {
  const f = fixture(); const put = await upload(f); const uid = put.body.files[0].uid;
  f.env.FILES = undefined;
  const removed = await call(f, 3, 'DELETE', `${wb}/experts/me/credentials/files/${uid}`);
  assert.equal(removed.status, 503); assert.equal(removed.body.error, 'storage_unavailable');
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM expert_credential_files').n, 1);
  assert.equal(expert(f).review_version, 1);
});

test('failed R2 deletion keeps the credential key and review version available for a successful retry', async () => {
  const f = fixture(); const put = await upload(f); const uid = put.body.files[0].uid;
  const remove = f.env.FILES.delete; let attempts = 0;
  f.env.FILES.delete = async (key: string) => { if (++attempts === 1) throw new Error('Synthetic storage outage'); await remove(key); };
  assert.equal((await call(f, 3, 'DELETE', `${wb}/experts/me/credentials/files/${uid}`)).status, 503);
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM expert_credential_files').n, 1);
  assert.equal(expert(f).review_version, 1); assert.equal(f.objects.size, 1);
  assert.equal((await call(f, 3, 'DELETE', `${wb}/experts/me/credentials/files/${uid}`)).status, 200);
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM expert_credential_files').n, 0); assert.equal(f.objects.size, 0);
});

test('a failed metadata deletion can retry the already removed R2 object without losing its key', async () => {
  const f = fixture(); const put = await upload(f); const uid = put.body.files[0].uid;
  const batch = f.env.DB.batch.bind(f.env.DB); let attempts = 0;
  f.env.DB.batch = async (stmts: any[]) => { if (++attempts === 1) throw new Error('Synthetic database outage'); return batch(stmts); };
  assert.equal((await call(f, 3, 'DELETE', `${wb}/experts/me/credentials/files/${uid}`)).status, 503);
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM expert_credential_files').n, 1); assert.equal(f.objects.size, 0);
  assert.equal((await call(f, 3, 'DELETE', `${wb}/experts/me/credentials/files/${uid}`)).status, 200);
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM expert_credential_files').n, 0);
});

test('an ordinary admin can read but cannot verify, decline or restore their own expert profile', async () => captureMail(async (sent) => {
  const f = fixture(); f.db.exec("UPDATE experts SET user_id=6, hidden_by_admin=1 WHERE uid='expert-a'");
  assert.equal((await call(f, 6, 'GET', `${wb}/admin/experts/expert-a/review`)).status, 200);
  for (const [suffix, body] of [
    ['verify', { verified: true, credentials_checked: true, expected_version: 0 }],
    ['decline', { reason: 'Synthetic decline reason.' }], ['hide', { hidden: false }],
  ] as const) assert.equal((await call(f, 6, 'POST', `${wb}/admin/experts/expert-a/${suffix}`, body)).status, 403);
  assert.equal(sent.length, 0); assert.equal(one(f, 'SELECT COUNT(*) AS n FROM expert_review_decisions').n, 0);
  assert.equal((await call(f, 7, 'POST', `${wb}/admin/experts/expert-a/verify`, { verified: true, credentials_checked: true, expected_version: 0 })).status, 200);
  assert.equal(expert(f).decided_by, 7); assert.equal(sent.length, 1);
}));

function limitedBusinessReads(f: F) {
  const prepare = f.env.DB.prepare.bind(f.env.DB); let reads = 0;
  f.env.DB.prepare = (sql: string) => {
    const statement = prepare(sql);
    if (/comarketing_|FROM partners|FROM experts|expert_credential_files/.test(sql)) {
      for (const method of ['all', 'first']) {
        const execute = statement[method].bind(statement);
        statement[method] = async (...args: any[]) => { if (++reads > 8) throw new Error('Page exceeded bounded business-read budget'); return execute(...args); };
      }
    }
    return statement;
  };
  return () => reads;
}

test('legacy co-marketing callers keep all rows, and explicit pages use bounded bulk reads', async () => {
  const f = fixture(); for (let n = 1; n <= 70; n++) pitch(f, n);
  const reads = limitedBusinessReads(f);
  const legacy = await call(f, 1, 'GET', `${cm}/admin/queue`);
  assert.equal(legacy.status, 200); assert.equal(legacy.body.items.length, 70); assert.equal(legacy.body.total, 70);
  assert.equal(legacy.body.limit, null); assert.ok(reads() <= 8);
  const other = fixture(); for (let n = 1; n <= 70; n++) pitch(other, n);
  const pageReads = limitedBusinessReads(other);
  const page = await call(other, 1, 'GET', `${cm}/admin/queue?limit=25&offset=25`);
  assert.equal(page.status, 200); assert.equal(page.body.items.length, 25); assert.equal(page.body.items[0].uid, 'pitch-26');
  assert.equal(page.body.total, 70); assert.ok(pageReads() <= 8);
});

test('large expert pages batch their private credential metadata within a bounded read budget', async () => {
  const f = fixture();
  for (let n = 0; n < 100; n++) f.db.prepare("INSERT INTO experts(uid,name) VALUES(?, 'Synthetic expert')").run(`batch-${n}`);
  const file = await upload(f); assert.equal(file.status, 201);
  const reads = limitedBusinessReads(f);
  const response = await call(f, 1, 'GET', `${wb}/admin/experts?limit=200`);
  assert.equal(response.status, 200); assert.equal(response.body.total, 101); assert.equal(response.body.items.length, 101);
  assert.equal(response.body.items.find((r: any) => r.uid === 'expert-a').credentials.files[0].uid, file.body.files[0].uid);
  assert.ok(reads() <= 8);
});

test('admin review reads have complete totals, allow more than fifty and keep other admins’ credentials for Super Admin', async () => {
  const f = fixture();
  for (let n = 0; n < 60; n++) f.db.prepare("INSERT INTO experts(uid,name,created_at) VALUES(?,?,'2026-10-02')").run(`extra-${n}`, `Synthetic ${n}`);
  f.db.exec("INSERT INTO experts(uid,user_id,name) VALUES('admin-expert',6,'Synthetic admin expert')");
  f.db.exec("INSERT INTO experts(uid,name) VALUES('seed_demo','Synthetic sample expert')");
  const r = await call(f, 1, 'GET', `${wb}/admin/experts?limit=100`);
  assert.equal(r.status, 200); assert.equal(r.body.total, 61); assert.equal(r.body.items.length, 61);
  assert.ok(r.body.items.every((x: any) => x.created_at));
  assert.equal((await call(f, 1, 'GET', `${wb}/admin/experts/admin-expert/review`)).status, 403);
  assert.equal((await call(f, 7, 'GET', `${wb}/admin/experts/admin-expert/review`)).status, 200);
  assert.equal((await call(f, 7, 'GET', `${wb}/admin/experts?limit=100`)).body.total, 62);
  const publicRead = await call(f, 4, 'GET', `${wb}/experts/expert-a`);
  assert.equal(publicRead.status, 200);
  assert.ok(!JSON.stringify(publicRead.body).includes('licence_number'));
  const legacyAdminRead = await call(f, 1, 'GET', `${wb}/experts?limit=1`);
  assert.equal(legacyAdminRead.status, 200);
  assert.equal(legacyAdminRead.body.matches.length, 1);
  assert.ok(legacyAdminRead.body.matches.every((x: any) => x.created_at));
});

test('every admin guard refuses a member and anonymous caller, and HQ freeze blocks writes', async () => {
  const f = fixture(); pitch(f, 1);
  for (const [method, path, body] of [
    ['GET', `${cm}/admin/queue`, undefined], ['POST', `${cm}/admin/pitches/pitch-1/approve`, {}],
    ['GET', `${wb}/admin/experts`, undefined], ['GET', `${wb}/admin/experts/expert-a/review`, undefined],
    ['POST', `${wb}/admin/experts/expert-a/verify`, { verified: true, credentials_checked: true, expected_version: 0 }],
    ['POST', `${wb}/admin/experts/expert-a/hide`, { hidden: true }],
    ['POST', `${wb}/admin/experts/expert-a/decline`, { reason: 'Synthetic decline reason.' }],
  ] as const) {
    assert.equal((await call(f, 4, method, path, body)).status, 403, path);
    assert.equal((await call(f, null, method, path, body)).status, 401, path);
    if (method === 'POST') assert.equal((await call(f, 2, method, path, body)).status, 423, path);
  }
});

test('each credential endpoint requires authentication and missing or unlinked expert decisions are honest refusals', async () => {
  const f = fixture();
  for (const [method, path, body] of [
    ['GET', `${wb}/experts/me/credentials`, undefined],
    ['PATCH', `${wb}/experts/me/credentials`, { issuer: 'Synthetic' }],
    ['PUT', `${wb}/experts/me/credentials/files`, pdf],
    ['DELETE', `${wb}/experts/me/credentials/files/unknown`, undefined],
    ['GET', `${wb}/experts/credentials/files/unknown`, undefined],
  ] as const) assert.equal((await call(f, null, method, path, body, body instanceof Uint8Array ? { 'Content-Type': 'application/pdf', 'Content-Length': String(body.byteLength) } : {})).status, 401, path);
  assert.equal((await call(f, 1, 'POST', `${wb}/admin/experts/unknown/verify`, { verified: true, credentials_checked: true, expected_version: 0 })).status, 404);
  f.db.exec("INSERT INTO experts(uid,name) VALUES('unlinked','Synthetic unlinked expert')");
  assert.equal((await call(f, 1, 'POST', `${wb}/admin/experts/unlinked/verify`, { verified: true, credentials_checked: true, expected_version: 0 })).body.error, 'expert_account_required');
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM notifications_inbox').n, 0);
});

test('branch suspension still blocks verify/restore but permits taking verification or visibility away', async () => captureMail(async () => {
  const f = fixture(); f.env.BRANCH_CODE = 'synthetic';
  f.db.exec("INSERT INTO branch_licence(id,licence_uid,status,pushed_at) VALUES(1,'synthetic-licence','suspended',datetime('now'))");
  assert.equal((await call(f, 1, 'POST', `${wb}/admin/experts/expert-a/verify`, { verified: true, credentials_checked: true, expected_version: 0 })).status, 423);
  f.db.exec("UPDATE experts SET verified=1,decision_state='verified' WHERE uid='expert-a'");
  assert.equal((await call(f, 1, 'POST', `${wb}/admin/experts/expert-a/verify`, { verified: false })).status, 200);
  assert.equal(expert(f).verified, 0);
  assert.equal((await call(f, 1, 'POST', `${wb}/admin/experts/expert-a/hide`, { hidden: true })).status, 200);
  assert.equal(expert(f).hidden_by_admin, 1);
  assert.equal((await call(f, 1, 'POST', `${wb}/admin/experts/expert-a/hide`, { hidden: false })).status, 423);
}));

test('removing an uploader does not make the new credential-file foreign key block account deletion', async () => {
  const f = fixture(); assert.equal((await upload(f)).status, 201);
  f.db.exec('PRAGMA foreign_keys = ON');
  f.db.prepare('DELETE FROM users WHERE id = ?').run(3);
  assert.equal(one(f, 'SELECT uploaded_by FROM expert_credential_files').uploaded_by, null);
});

test('failed decision history rolls back the expert update and sends no notice; failed reads are 5xx', async () => {
  const f = fixture(); const original = f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare = (sql: string) => original(sql.includes('INSERT INTO expert_review_decisions') ? sql.replace('credentials_checked', 'absent_column') : sql);
  const r = await call(f, 1, 'POST', `${wb}/admin/experts/expert-a/verify`, { verified: true, credentials_checked: true, expected_version: 0 });
  assert.equal(r.status, 503); assert.equal(expert(f).verified, 0); assert.equal(expert(f).decided_by, null);
  assert.equal(one(f, 'SELECT COUNT(*) AS n FROM notifications_inbox').n, 0);
  f.env.DB.prepare = original; f.db.exec('DROP TABLE expert_credential_files');
  assert.equal((await call(f, 1, 'GET', `${wb}/admin/experts`)).status, 503);
  f.db.exec('DROP TABLE comarketing_attributions');
  assert.ok((await call(f, 1, 'GET', `${cm}/admin/queue`)).status >= 500);
});
