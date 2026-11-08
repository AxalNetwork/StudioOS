/**
 * D4675 (#4675) — HQ's two durable acts on /admin/security, through their
 * routes: the data-subject close and the trust-center Publish.
 *
 * Each act targets exactly what was reviewed and refuses a stale review;
 * the decision and its audit rows land in one batch or not at all; a retry
 * with the same key is answered with the record already made; and every
 * answer says what is on record, never a false success or failure.
 *
 * The database is the full test schema (baseline plus every migration), so
 * the SQL runs against production's columns. Everyone in it is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/admin_ops_d4675.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import adminTrustCenter from '../src/routes/admin_trust_center.ts';
import adminSecurity from '../src/routes/admin_security.ts';
import { publish } from '../src/services/trustContent.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';
import { loadSchema } from './_schema_once.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const SUPER = 1, SUPER_TWO = 2, SUBJECT = 3;
const TC = '/api/admin/security/trust-center';
const NOTE = 'Security: passkeys added to sign-in.';
const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(SUPER, 'admin', 'Sue Super', 'sue@example.test');
  u.run(SUPER_TWO, 'admin', 'Sid Second', 'sid@example.test');
  u.run(SUBJECT, 'founder', 'Mo Member', 'mo@example.test');
  for (const id of [SUPER, SUPER_TWO]) db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(id);
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor, assurance_level, created_at) VALUES (?, ?, 'totp', 'totp', ?)");
  for (const id of [SUPER, SUPER_TWO, SUBJECT]) s.run(id, `s-${id}`, sqlNow());
  return db;
}

const app = new Hono<any>();
app.route(TC, adminTrustCenter);
app.route('/api/admin/security', adminSecurity);

function harness(db = fixture()) {
  const env: Record<string, unknown> = { JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://axal.example.test', DB: d1Over(db) };
  async function call(who: number, method: string, path: string, body?: unknown) {
    const token = await new SignJWT({ user_id: who, jti: `s-${who}` }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    const saved = [console.warn, console.error, console.info]; console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try {
      const res = await withThrownResponses(() => app.request(path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }, env));
      const text = await res.text();
      let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, body: json };
    } finally { [console.warn, console.error, console.info] = saved; }
  }
  return { db, env, call };
}

let seq = 0;
const key = () => `k4675-route-${String(++seq).padStart(10, '0')}`;
const count = (db: DatabaseSync, sql: string, ...b: any[]) => Number((db.prepare(sql).get(...b) as any).n);
const lines = (text: string) => ({ intro: null, groups: [{ title: 'Signing in', lines: [{ text, recorded: true, checked_at: null }] }] });
const draft = (h: ReturnType<typeof harness>, who: number, text: string) =>
  h.call(who, 'PUT', `${TC}/blocks/security`, { body: lines(text), checked_at: null });
const tokenNow = async (h: ReturnType<typeof harness>) => (await h.call(SUPER, 'GET', TC)).body.pending_token as string;
const publishedText = (db: DatabaseSync) => {
  const r = db.prepare("SELECT body_json FROM trust_content_blocks WHERE key = 'security' AND state = 'published'").get() as any;
  return r ? JSON.parse(r.body_json).groups[0].lines[0].text : null;
};

// ------------------------------------------------------------------ Publish

test('Publish needs what was reviewed: no token or key is refused before anything is read', async () => {
  const h = harness();
  await draft(h, SUPER, 'Passkeys are offered.');
  for (const body of [{ note: NOTE }, { note: NOTE, pending_token: await tokenNow(h) }, { note: NOTE, publish_key: key() },
    { note: NOTE, pending_token: 'not-a-token', publish_key: key() }]) {
    const r = await h.call(SUPER, 'POST', `${TC}/publish`, body);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'review_required');
  }
  assert.equal(count(h.db, 'SELECT COUNT(*) AS n FROM trust_content_changes'), 0);
});

test('a draft saved after the dialog opened is NOT published on the strength of the older review', async () => {
  const h = harness();
  await draft(h, SUPER, 'Reviewed words.');
  const token = await tokenNow(h);
  await draft(h, SUPER_TWO, 'Words nobody reviewed.');
  const r = await h.call(SUPER, 'POST', `${TC}/publish`, { note: NOTE, pending_token: token, publish_key: key() });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'changed_since_review');
  assert.equal(publishedText(h.db), null, 'an unreviewed draft went live');
  assert.equal(count(h.db, 'SELECT COUNT(*) AS n FROM trust_content_changes'), 0);
  assert.equal(count(h.db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'trust_center.published'"), 0);
});

test('a save that lands INSIDE the window between the check and the batch publishes nothing, not half', async () => {
  const h = harness();
  await draft(h, SUPER, 'Reviewed words.');
  await h.call(SUPER, 'POST', `${TC}/subprocessors`, { name: 'Vendor R', purpose: 'Hosting', data: 'Logs', location: 'Ireland' });
  const token = await tokenNow(h);
  const base = h.env.DB as any;
  // Another admin's save commits just before this batch runs.
  const racing = { ...base, batch: async (stmts: any[]) => {
    h.db.prepare("UPDATE trust_content_blocks SET body_json = ?, updated_at = datetime('now', '+1 second') WHERE key = 'security' AND state = 'draft'")
      .run(JSON.stringify(lines('Words saved mid-publish.')));
    return base.batch(stmts);
  } };
  const out = await publish({ DB: racing } as any, SUPER, NOTE, Date.now(), { token, key: key(), actorEmail: 'sue@example.test' });
  assert.deepEqual(out, { ok: false, code: 'changed_since_review' });
  assert.equal(publishedText(h.db), null, 'the batch published content nobody reviewed');
  assert.equal(count(h.db, "SELECT COUNT(*) AS n FROM trust_subprocessors WHERE state = 'published'"), 0,
    'half the publish landed: the subprocessor went live without the block');
  assert.equal(count(h.db, 'SELECT COUNT(*) AS n FROM trust_content_changes'), 0, 'the change log names a publish that did not happen');
});

test('a retry of a Publish with the same key is answered with the change it made, once', async () => {
  const h = harness();
  await draft(h, SUPER, 'Passkeys are offered.');
  const body = { note: NOTE, pending_token: await tokenNow(h), publish_key: key() };
  const first = await h.call(SUPER, 'POST', `${TC}/publish`, body);
  const again = await h.call(SUPER, 'POST', `${TC}/publish`, body);
  assert.equal(first.status, 200);
  assert.equal(first.body.replayed, false);
  assert.equal(again.status, 200, 'a retry of a Publish that landed read as "nothing to publish"');
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.uid, first.body.uid);
  assert.deepEqual(again.body.blocks, ['security']);
  assert.equal(count(h.db, 'SELECT COUNT(*) AS n FROM trust_content_changes'), 1);
  assert.equal(count(h.db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'trust_center.published'"), 1);
  // Another operator's key is not theirs to replay.
  const theirs = await h.call(SUPER_TWO, 'POST', `${TC}/publish`, { ...body, pending_token: await tokenNow(h) });
  assert.equal(theirs.status, 409);
  assert.equal(theirs.body.code, 'key_conflict');
});

test('the Publish and its audit row are one unit: when the audit row cannot land, nothing is published', async () => {
  const h = harness();
  await draft(h, SUPER, 'Passkeys are offered.');
  const body = { note: NOTE, pending_token: await tokenNow(h), publish_key: key() };
  h.db.exec("CREATE TRIGGER t4675_audit_down BEFORE INSERT ON admin_audit_log WHEN NEW.action = 'trust_center.published' BEGIN SELECT RAISE(ABORT, 'audit store down'); END");
  const r = await h.call(SUPER, 'POST', `${TC}/publish`, body);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'not_confirmed');
  assert.match(r.body.message, /at most once/);
  assert.equal(publishedText(h.db), null, 'the content went live without its audit row');
  assert.equal(count(h.db, 'SELECT COUNT(*) AS n FROM trust_content_changes'), 0);
  h.db.exec('DROP TRIGGER t4675_audit_down');
  const retry = await h.call(SUPER, 'POST', `${TC}/publish`, body);
  assert.equal(retry.status, 200, 'the retry after the failure did not publish');
  assert.equal(publishedText(h.db), 'Passkeys are offered.');
});

test('a Publish that adds a subprocessor says its notices are queued, never that they were sent', async () => {
  const h = harness();
  await h.call(SUPER, 'POST', `${TC}/subprocessors`, { name: 'Vendor Q', purpose: 'Hosting', data: 'Logs', location: 'Ireland' });
  const r = await h.call(SUPER, 'POST', `${TC}/publish`, { note: 'Subprocessors: Vendor Q added.', pending_token: await tokenNow(h), publish_key: key() });
  assert.equal(r.status, 200);
  assert.equal(r.body.notices, 'queued');
});

// ------------------------------------------------------------------ the DSR close

async function rowFor(h: ReturnType<typeof harness>) {
  const ov = await h.call(SUPER, 'GET', '/api/admin/security/overview');
  assert.equal(ov.status, 200, JSON.stringify(ov.body));
  return (ov.body.dsr.rows as any[]).find((r) => r.id === SUBJECT);
}
const asks = (db: DatabaseSync, at: string) => {
  db.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?').run(at, SUBJECT);
  db.prepare('INSERT OR IGNORE INTO dsr_requests (user_id, requested_at) VALUES (?, ?)').run(SUBJECT, at);
};
const closeBody = (row: any, outcome = 'denied', closeKey = key()) =>
  ({ outcome, reason: 'retained under an open legal hold', requested_at: row.requested_at, request_id: row.request_id, close_key: closeKey });
const CLOSE = `/api/admin/security/dsr/${SUBJECT}/close`;

test('the list names the exact request and its deadline in UTC', async () => {
  const h = harness();
  asks(h.db, '2026-01-31 10:00:00');
  const row = await rowFor(h);
  assert.equal(row.requested_at, '2026-01-31 10:00:00');
  assert.ok(Number.isInteger(row.request_id) && row.request_id > 0, 'the row does not name its ledger request');
  assert.equal(row.deadline_at, '2026-03-02T10:00:00.000Z');
});

test('a close without the reviewed request or a key is refused, and nothing moves', async () => {
  const h = harness();
  asks(h.db, '2026-10-01 09:00:00');
  const row = await rowFor(h);
  for (const omit of ['requested_at', 'close_key']) {
    const body: any = closeBody(row); delete body[omit];
    const r = await h.call(SUPER, 'POST', CLOSE, body);
    assert.equal(r.status, 400, omit);
    assert.equal(r.body.code, 'review_required', omit);
  }
  assert.equal(count(h.db, 'SELECT COUNT(*) AS n FROM dsr_requests WHERE outcome IS NULL'), 1);
});

test('close, retry, stale and already-closed each answer with what is on record', async () => {
  const h = harness();
  asks(h.db, '2026-10-01 09:00:00');
  const row = await rowFor(h);
  const body = closeBody(row);
  const done = await h.call(SUPER, 'POST', CLOSE, body);
  assert.equal(done.status, 200);
  assert.equal(done.body.replayed, false);
  assert.equal(done.body.request_id, row.request_id);
  const again = await h.call(SUPER, 'POST', CLOSE, body);
  assert.equal(again.status, 200, 'a retry of a recorded close read as a refusal');
  assert.equal(again.body.replayed, true);
  assert.match(again.body.message, /Already on record/);

  const late = await h.call(SUPER_TWO, 'POST', CLOSE, closeBody(row, 'fulfilled'));
  assert.equal(late.status, 409);
  assert.equal(late.body.code, 'no_open_request');
  assert.equal(late.body.last_outcome, 'denied', 'the second operator is not told what was recorded');

  asks(h.db, '2026-10-09 09:00:00');
  const stale = await h.call(SUPER, 'POST', CLOSE, closeBody(row, 'fulfilled'));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'stale_request');
  assert.equal(stale.body.current_requested_at, '2026-10-09 09:00:00');

  assert.equal(count(h.db, "SELECT COUNT(*) AS n FROM admin_audit_log WHERE action = 'dsr_request_closed'"), 1);
  assert.equal(count(h.db, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'account_deletion_request_closed'"), 1);
});

test('the close and its audit row are one unit: when the audit row cannot land, the request stays open', async () => {
  const h = harness();
  asks(h.db, '2026-10-01 09:00:00');
  const row = await rowFor(h);
  h.db.exec("CREATE TRIGGER t4675_dsr_audit_down BEFORE INSERT ON admin_audit_log WHEN NEW.action = 'dsr_request_closed' BEGIN SELECT RAISE(ABORT, 'audit store down'); END");
  const r = await h.call(SUPER, 'POST', CLOSE, closeBody(row));
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'ledger_unavailable');
  assert.match(r.body.error, /at most once/);
  assert.equal(count(h.db, 'SELECT COUNT(*) AS n FROM dsr_requests WHERE outcome IS NULL'), 1, 'the decision landed without its audit row');
  assert.ok((h.db.prepare('SELECT deletion_requested_at AS t FROM users WHERE id = ?').get(SUBJECT) as any).t);
  assert.equal(count(h.db, "SELECT COUNT(*) AS n FROM activity_logs WHERE action = 'account_deletion_request_closed'"), 0);
});
