/** D4662 (#4662): durable sent identity, immutable quotes and stable pages on the migrated schema; no email leaves this test. */
import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import mailAccounts from '../src/routes/mail_accounts.ts';
import mailDrafts from '../src/routes/mail_drafts.ts';
import { ADAPTERS } from '../src/services/mail/adapters/index.ts';
import { AdapterError } from '../src/services/mail/adapters/types.ts';
import { saveAccount } from '../src/services/mail/accounts.ts';
import { ensureProjectMembershipSchema } from '../src/services/projectAccess.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-conversation-history-4662'.repeat(3);
const DRAFT = 'a'.repeat(32);
function seed(db: DatabaseSync) {
  db.exec(`INSERT INTO users(id,role,founder_id,name,email,is_active,subscription_tier) VALUES
    (2,'founder',100,'Synthetic founder','two@example.invalid',1,'studio'),
    (3,'founder',300,'Other founder','three@example.invalid',1,'studio');
    INSERT INTO projects(id,name,founder_id) VALUES (1,'Synthetic venture',100),(3,'Other venture',300);
    INSERT INTO discovery_interviews(id,project_id,interviewee_name,stage,pains_json) VALUES
    (11,1,'Synthetic Ada','done','[]'),(12,1,'Synthetic Ben','done','[]'),(31,3,'Private person','done','[]');
    INSERT INTO mail_drafts(uid,user_id,person_ref,intent,tone,length,refs_json,blocks_json,subject,body)
    VALUES ('${DRAFT}',2,'interviewee:11','thank_follow_up','warm','short','[{"ref":"interviewee:11"},{"ref":"kpis:1"}]','[]','AI subject','AI body');`);
}
async function fixture() {
  const db = migratedDatabase(); seed(db);
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'synthetic-history-kek-4662'.repeat(3) };
  await ensureProjectMembershipSchema(env);
  const account = await saveAccount(env, { id: 2, role: 'founder' } as any, { provider: 'outlook', address: 'sender@example.invalid', display_name: null, scopes: 'Mail.Send', can_read: false, creds: { kind: 'oauth', refresh_token: 'synthetic-refresh-only' } });
  const deliveries: any[] = [];
  let uncertain = false;
  const send = mock.method(ADAPTERS.outlook!, 'send', async (_env, _creds, outgoing) => {
    deliveries.push(outgoing);
    if (uncertain) throw new AdapterError('uncertain', 'The mail server did not confirm delivery.');
    return { messageId: `fake-${deliveries.length}` };
  });
  const network = mock.method(globalThis, 'fetch', async () => { throw new Error('No network is permitted in this test'); });
  const app = new Hono<any>().route('/api/mail', mailAccounts).route('/api/mail', mailDrafts);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  return { db, env, app, account, deliveries, uncertain: () => { uncertain = true; }, close: () => { send.mock.restore(); network.mock.restore(); db.close(); } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function call(f: Fixture, who: number, method: string, path: string, data?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(`/api/mail${path}`, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) }, f.env);
  return { status: res.status, body: await res.json() as any };
}
async function send(f: Fixture, extra: Record<string, unknown> = {}) {
  const nonce = (await call(f, 2, 'POST', '/send/confirm', { account_uid: f.account.uid })).body.nonce;
  return call(f, 2, 'POST', '/send', { account_uid: f.account.uid, to: 'recipient@example.invalid', subject: 'Manual subject', body: 'Hand-written message', person: 'interviewee:11', nonce, ...extra });
}
const history = (f: Fixture, person = 'interviewee:11', page = 1, who = 2) => call(f, who, 'GET', `/sent?person=${encodeURIComponent(person)}&page=${page}`);

test('manual and AI sends keep their validated person and quote snapshot after draft edits and supported deletion', async () => {
  const f = await fixture();
  try {
    const manual = await send(f);
    assert.equal(manual.status, 201, JSON.stringify(manual.body));
    assert.equal(manual.body.sent.person, 'interviewee:11');
    const ai = await send(f, { draft_uid: DRAFT, operation_key: 'durable-history-operation-4662' });
    assert.equal(ai.status, 201, JSON.stringify(ai.body));
    assert.equal(f.deliveries.length, 2);
    assert.equal((await history(f)).body.total, 2);
    assert.equal((await call(f, 2, 'GET', '/sent')).body.total, 2);
    assert.equal((await call(f, 2, 'PATCH', `/drafts/${DRAFT}`, { to: 'other@example.invalid', subject: 'Changed', body: 'Later edit', expected_revision: 0 })).status, 200);
    f.db.prepare('UPDATE mail_drafts SET refs_json = ? WHERE uid = ?').run('[{"ref":"changed:1"}]', DRAFT);
    assert.equal((await call(f, 2, 'DELETE', `/drafts/${DRAFT}`)).status, 200);
    const rows = (await history(f)).body.items;
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.find((r: any) => r.uid === ai.body.sent.uid).quoted, ['interviewee:11', 'kpis:1']);
    assert.deepEqual(rows.find((r: any) => r.uid === manual.body.sent.uid).quoted, []);
    assert.ok(rows.every((r: any) => r.person === 'interviewee:11' && r.status === 'sent'));
    assert.equal((await history(f, 'interviewee:11', 1, 3)).body.total, 0);
  } finally { f.close(); }
});

test('invalid, inaccessible and mismatched person contexts are refused before provider I/O; operation identity includes person', async () => {
  const f = await fixture();
  try {
    for (const person of ['interviewee:31', 'interviewee:999', 'invalid', { ref: 'interviewee:11' }]) {
      assert.equal((await send(f, { person })).status, 404);
    }
    const mismatch = await send(f, { person: 'interviewee:12', draft_uid: DRAFT });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.error, 'draft_person_mismatch');
    assert.equal(f.deliveries.length, 0);
    const key = 'person-bound-operation-4662';
    assert.equal((await send(f, { operation_key: key })).status, 201);
    assert.equal((await send(f, { operation_key: key })).status, 200);
    assert.equal((await send(f, { operation_key: key, person: 'interviewee:12' })).status, 409);
    assert.equal(f.deliveries.length, 1, 'a replay never delivers again or moves the message');
    assert.equal((await history(f)).body.total, 1);
    assert.equal((await history(f, 'interviewee:12')).body.total, 0);
  } finally { f.close(); }
});

test('every tied-timestamp page is stable, filtered and complete; an unknown provider outcome is not failed', async () => {
  const f = await fixture();
  try {
    const insert = f.db.prepare(`INSERT INTO mail_sent(uid,user_id,account_id,recipient,recipient_hash,subject,refs_json,person_ref,sent_at,created_at)
      VALUES (?,2,?,'recipient@example.invalid','synthetic-hash',?,'[]',?,'2026-11-01 10:00:00','2026-11-01 10:00:00')`);
    for (let i = 0; i < 45; i++) insert.run(`s${i}`, (f.db.prepare('SELECT id FROM mail_accounts WHERE uid = ?').get(f.account.uid) as any).id, `Subject ${i}`, 'interviewee:11');
    insert.run('other-person', (f.db.prepare('SELECT id FROM mail_accounts WHERE uid = ?').get(f.account.uid) as any).id, 'Different person', 'interviewee:12');
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const r = (await history(f, 'interviewee:11', page)).body;
      assert.equal(r.page, page); assert.equal(r.total, 45); assert.equal(r.per_page, 20);
      seen.push(...r.items.map((r: any) => r.uid));
    }
    assert.deepEqual(seen, Array.from({ length: 45 }, (_, i) => `s${44 - i}`));
    assert.equal((await history(f, 'interviewee:11', 4)).body.items.length, 0);
    assert.equal((await history(f, 'interviewee:11', 501)).body.page, 501, 'history is not silently clamped to page 500');
    f.uncertain();
    const unknown = await send(f);
    assert.equal(unknown.body.operation.state, 'uncertain', JSON.stringify(unknown.body));
    assert.equal((await history(f)).body.items[0].status, 'uncertain');
  } finally { f.close(); }
});

test('older callers inherit only an established draft context; no-context sends remain explicitly unassociated', async () => {
  const f = await fixture();
  try {
    const manual = await send(f, { person: undefined });
    assert.equal(manual.status, 201);
    assert.equal(manual.body.sent.person, null);
    assert.equal((await history(f)).body.total, 0);
    assert.equal((await call(f, 2, 'GET', '/sent')).body.items[0].person, null);
    const ai = await send(f, { person: undefined, draft_uid: DRAFT });
    assert.equal(ai.status, 201);
    assert.equal(ai.body.sent.person, 'interviewee:11');
    assert.equal((await history(f)).body.total, 1);
  } finally { f.close(); }
});

test('both history views preserve accepted, pending, interrupted and refused operation outcomes', async () => {
  const f = await fixture();
  try {
    const accountId = (f.db.prepare('SELECT id FROM mail_accounts WHERE uid = ?').get(f.account.uid) as any).id;
    const insert = f.db.prepare("INSERT INTO mail_sent(uid,user_id,account_id,recipient,recipient_hash,subject,person_ref,error) VALUES (?,2,?,'x@example.invalid','hash',?,'interviewee:11','Synthetic error')");
    const operation = f.db.prepare('INSERT INTO mail_send_ops(uid,user_id,account_id,op_key,fingerprint,state,updated_at) VALUES (?,2,?,?,?, ?,?)');
    for (const [uid, state, updated] of [['accepted', 'accepted', '2099-01-01 00:00:00'], ['pending', 'pending', '2099-01-01 00:00:00'], ['interrupted', 'pending', '2000-01-01 00:00:00'], ['refused', 'refused', '2099-01-01 00:00:00']]) {
      insert.run(uid, accountId, uid); operation.run(uid, accountId, uid, 'synthetic-fingerprint', state, updated);
    }
    for (const path of ['/sent', '/sent?person=interviewee:11']) {
      const items = (await call(f, 2, 'GET', path)).body.items;
      assert.deepEqual(items.map((r: any) => [r.uid, r.status]).sort(), [['accepted', 'sent'], ['interrupted', 'uncertain'], ['pending', 'pending'], ['refused', 'failed']]);
      assert.equal(items.find((r: any) => r.uid === 'accepted').error, null);
    }
  } finally { f.close(); }
});

test('migration backfills only an established same-member draft association and leaves unknown history unassociated', () => {
  const name = readdirSync(new URL('../sql/migrations/', import.meta.url)).find((n) => n.includes('_4662_mail_conversation.sql'))!;
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  try {
    loadSchema(db, { below: Number(name.split('_')[0]) }); seed(db);
    db.exec("INSERT INTO mail_accounts(id,uid,user_id,provider,address) VALUES (1,'old-account',2,'outlook','me@example.invalid')");
    const insert = db.prepare("INSERT INTO mail_sent(uid,user_id,account_id,recipient,recipient_hash,subject,draft_uid,refs_json) VALUES (?, ?,1,'x@example.invalid','hash','Old',?,'[\"snapshot:1\"]')");
    insert.run('known', 2, DRAFT); insert.run('foreign-draft', 3, DRAFT); insert.run('manual', 2, null); insert.run('deleted-draft', 2, 'missing');
    db.exec(readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8'));
    assert.deepEqual(db.prepare('SELECT uid,person_ref,refs_json FROM mail_sent ORDER BY id').all().map((r: any) => [r.uid, r.person_ref, r.refs_json]), [
      ['known', 'interviewee:11', '["snapshot:1"]'], ['foreign-draft', null, '["snapshot:1"]'], ['manual', null, '["snapshot:1"]'], ['deleted-draft', null, '["snapshot:1"]'],
    ]);
    db.prepare('DELETE FROM mail_drafts WHERE uid = ?').run(DRAFT);
    assert.equal((db.prepare("SELECT person_ref FROM mail_sent WHERE uid = 'known'").get() as any).person_ref, 'interviewee:11');
  } finally { db.close(); }
});
