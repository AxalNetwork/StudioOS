/**
 * D622 (#1343) — publish applies only the pending revision the Super Admin
 * reviewed. The route takes the `draft_updated_at` they read; a newer save is
 * a 409 and nothing changes, including a save that lands between the
 * publish's read and its write. With nothing pending it publishes as before.
 * The audit records the values that went live, and the hub names who saved
 * the pending revision.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/contract_doc_type_publish_d622.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import registry from '../src/routes/admin_contract_doc_registry.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { d1Over } from './_d1_sqlite.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SUPER = 1;
const REASON = 'Publish the revised party roles';
const ADMIN = 2;

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');

function ddl(name: string): string {
  const at = `\n${BASELINE}`.indexOf(`\nCREATE TABLE ${name} (`);
  assert.ok(at >= 0, `${name} is no longer defined in schema_baseline.sql`);
  return BASELINE.slice(at, BASELINE.indexOf(');', at) + 2);
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  for (const t of ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'documents', 'deals', 'projects', 'founders', 'esign_envelopes', 'esign_recipients']) {
    db.exec(ddl(t));
  }
  db.exec(read('cloudflare-worker/sql/migrations/332_contract_doc_type_registry.sql'));
  db.exec(read('cloudflare-worker/sql/migrations/416_contract_doc_type_pending_draft.sql'));
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(SUPER, 'admin', 'Sam Super', 'super@axal.test');
  db.prepare('INSERT INTO super_admins (user_id) VALUES (?)').run(SUPER);
  db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(ADMIN, 'admin', 'Ada Admin', 'admin@axal.test');
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_seen_at, last_step_up_at)
     VALUES ('jti-admin', ?, 'totp', datetime('now'), datetime('now'), datetime('now'))`,
  ).run(ADMIN);
  db.prepare(
    `INSERT INTO user_sessions (jti, user_id, factor, created_at, last_seen_at, last_step_up_at)
     VALUES ('jti-super', ?, 'totp', datetime('now'), datetime('now'), datetime('now'))`,
  ).run(SUPER);
  return db;
}

const app = (() => {
  const a = new Hono();
  a.route('/api/admin/contracts/registry', registry as any);
  a.onError((err: any, c) => {
    const msg = String(err?.message ?? '');
    if (msg === 'step_up_required') return c.json({ detail: msg }, 403);
    const mapped = (AUTH_ERROR_STATUSES as Record<string, number>)[msg];
    if (mapped) return c.json({ detail: msg }, mapped as any);
    return c.json({ detail: 'Internal server error', msg }, 500);
  });
  return a;
})();

async function call(db: DatabaseSync, method: string, path: string, body?: unknown, who = SUPER, dbBinding?: any) {
  const tok = await new SignJWT({ user_id: who, role: 'admin', jti: who === SUPER ? 'jti-super' : 'jti-admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { Authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.fetch(new Request(`http://x${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { JWT_SECRET, ENVIRONMENT: 'development', DB: dbBinding || d1Over(db) } as any);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: json, text };
}

const rowOf = (db: DatabaseSync, docType: string) =>
  db.prepare('SELECT title, layer, party_roles_json, required_fields_json, status, draft_title, draft_layer, draft_party_roles_json, draft_required_fields_json FROM contract_doc_type_registry WHERE doc_type = ?').get(docType) as any;

const itemOf = (body: any, docType: string) => {
  const row = (body.items || []).find((i: any) => i.doc_type === docType);
  assert.ok(row, `missing ${docType} in ${JSON.stringify(body).slice(0, 240)}`);
  return row;
};

const publishes = (db: DatabaseSync) =>
  db.prepare("SELECT action, details, user_id FROM activity_logs WHERE action = 'registry.type.publish' ORDER BY id").all() as any[];


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const draft = (db: DatabaseSync, title: string, layer = 'portfolio', who = SUPER) => call(db, 'POST', '/api/admin/contracts/registry/draft', {
  doc_type: 'side_letter_axal', title, layer, party_roles: ['founder'], required_fields: ['closing'],
}, who);
const publish = (db: DatabaseSync, body: Record<string, unknown>, dbBinding?: any) =>
  call(db, 'POST', '/api/admin/contracts/registry/side_letter_axal/publish', { reason: REASON, ...body }, SUPER, dbBinding);
const hubItem = async (db: DatabaseSync) => itemOf((await call(db, 'GET', '/api/admin/contracts/registry')).body, 'side_letter_axal');

/** A published type with one pending revision saved by SUPER; returns its stamp. */
async function publishedWithPending(db: DatabaseSync): Promise<string> {
  assert.equal((await draft(db, 'Side letter', 'gp')).status, 201);
  assert.equal((await publish(db, {})).status, 200, 'nothing pending: publishes as before');
  await sleep(5);
  assert.equal((await draft(db, 'Side letter next', 'portfolio', SUPER)).status, 201);
  const stamp = (await hubItem(db)).pending_draft?.updated_at;
  assert.ok(stamp, 'the pending revision carries its stamp');
  return stamp;
}

test('D622: the hub names who saved the pending revision, and when', async () => {
  const db = freshDb();
  await publishedWithPending(db);
  const item = await hubItem(db);
  assert.equal(item.pending_draft.updated_by, SUPER);
  assert.equal(item.pending_draft.updated_by_name, 'Sam Super');
  assert.match(item.pending_draft.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/, 'millisecond resolution');
});

test('D622: a publish with the reviewed stamp applies that revision and audits the applied values', async () => {
  const db = freshDb();
  const reviewed = await publishedWithPending(db);
  const res = await publish(db, { reviewed_draft_at: reviewed });
  assert.equal(res.status, 200, res.text);
  const applied = { title: 'Side letter next', layer: 'portfolio', party_roles: ['founder'], required_fields: ['closing'] };
  assert.deepEqual(res.body.applied, applied);
  const live = rowOf(db, 'side_letter_axal');
  assert.equal(live.title, 'Side letter next');
  assert.equal(live.draft_title, null);
  const audit = publishes(db);
  assert.equal(audit.length, 2);
  const details = JSON.parse(audit[1].details);
  assert.deepEqual(details.applied, applied);
  assert.equal(details.reviewed_draft_at, reviewed);
  assert.equal(details.reason, REASON);
});

test('D622: a publish after a newer save is a 409 with a sentence, and nothing changes', async () => {
  const db = freshDb();
  const reviewed = await publishedWithPending(db);
  await sleep(5);
  assert.equal((await draft(db, 'Side letter unreviewed', 'fund', SUPER)).status, 201);
  const res = await publish(db, { reviewed_draft_at: reviewed });
  assert.equal(res.status, 409, res.text);
  assert.equal(res.body.code, 'draft_changed');
  assert.match(res.body.error, /saved again after you reviewed it\. Nothing was published/);
  const row = rowOf(db, 'side_letter_axal');
  assert.equal(row.title, 'Side letter', 'the live title is untouched');
  assert.equal(row.draft_title, 'Side letter unreviewed', 'the newer save is still pending');
  assert.equal(publishes(db).length, 1, 'no publish was audited');
});

test('D622: a save that lands between the publish\'s read and its write is refused too', async () => {
  const db = freshDb();
  const reviewed = await publishedWithPending(db);
  const base = d1Over(db);
  // Before the UPDATE runs, another admin's save rewrites the pending revision.
  const racing = {
    ...base,
    prepare(sql: string) {
      if (/^\s*UPDATE contract_doc_type_registry/.test(sql)) {
        db.prepare("UPDATE contract_doc_type_registry SET draft_title = 'Raced in', draft_updated_at = '2999-01-01 00:00:00.000' WHERE doc_type = 'side_letter_axal'").run();
      }
      return base.prepare(sql);
    },
  };
  const res = await publish(db, { reviewed_draft_at: reviewed }, racing);
  assert.equal(res.status, 409, res.text);
  assert.equal(res.body.code, 'draft_changed');
  const row = rowOf(db, 'side_letter_axal');
  assert.equal(row.title, 'Side letter');
  assert.equal(row.draft_title, 'Raced in');
  assert.equal(publishes(db).length, 1);
});

test('D622: with a revision pending, a publish that names none is refused', async () => {
  const db = freshDb();
  await publishedWithPending(db);
  for (const body of [{}, { reviewed_draft_at: '' }, { reviewed_draft_at: null }]) {
    const res = await publish(db, body);
    assert.equal(res.status, 400, res.text);
    assert.equal(res.body.code, 'reviewed_draft_required');
    assert.match(res.body.error, /pending revision/);
  }
  assert.equal(rowOf(db, 'side_letter_axal').title, 'Side letter');
});

test('D622: an unknown type is still a 404, and a short reason is still refused first', async () => {
  const db = freshDb();
  const missing = await call(db, 'POST', '/api/admin/contracts/registry/no_such_type/publish', { reason: REASON });
  assert.equal(missing.status, 404, missing.text);
  assert.equal(missing.body.code, 'not_found');
  const reviewed = await publishedWithPending(db);
  const short = await publish(db, { reason: 'short', reviewed_draft_at: reviewed });
  assert.equal(short.status, 400);
  assert.equal(short.body.code, 'reason_required');
});
