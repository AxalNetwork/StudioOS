/** D4494: mounted Inbox routes on real SQLite; mail is read-only and private to the caller. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import inbox from '../src/routes/grow_inbox.ts';
import { inboxMailboxReader } from '../src/services/growInbox.ts';
import { outlookAdapter, gmailAdapter } from '../src/services/mail/adapters/oauth.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { openCreds } from '../src/services/mail/accounts.ts';
import { d1Over } from './_d1_sqlite.mjs';

const SECRET = 'synthetic-inbox-test-jwt-secret-only-'.repeat(2);
let database: DatabaseSync | undefined;
function fixture() {
  if (!database) {
    database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON');
    database.exec(readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8'));
    const dir = new URL('../sql/migrations/', import.meta.url);
    const segmentSchema = readFileSync(new URL('440_validate_cycle_stores.sql', dir), 'utf8').match(/CREATE TABLE IF NOT EXISTS customer_segments \([\s\S]*?\);/);
    if (!segmentSchema) throw new Error('Missing canonical segment schema');
    database.exec(segmentSchema[0]);
    const channelSchema = readFileSync(new URL('443_grow_stores.sql', dir), 'utf8').match(/CREATE TABLE IF NOT EXISTS growth_channels \([\s\S]*?\);/);
    if (!channelSchema) throw new Error('Missing canonical channel schema');
    database.exec(channelSchema[0]);
    // Canonical baseline and this feature's actual dependencies; unrelated research seeds are not an Inbox fixture.
    for (const file of ['277_user_recovery_state.sql', '386_contact_strength_organization.sql', '647_mail_accounts.sql', '202611041613_grow_campaigns.sql', '202611042009_distribution_inbox_reads.sql']) database.exec(readFileSync(new URL(file, dir), 'utf8'));
    database.exec('SAVEPOINT inbox_fixture');
  } else database.exec('ROLLBACK TO inbox_fixture');
  const db = database;
  db.exec("INSERT INTO founders(id,name,email) VALUES (10,'Synthetic owner','owner@example.test'),(20,'Other owner','other@example.test'); INSERT INTO users(id,email,name,role,founder_id) VALUES (1,'owner@example.test','Owner','founder',10),(2,'member@example.test','Member','founder',NULL),(3,'other@example.test','Other','founder',20),(4,'advisor@example.test','Reader','founder',NULL); INSERT INTO projects(id,name,founder_id) VALUES(7,'Synthetic venture',10),(8,'Other venture',20); INSERT INTO project_members(project_id,user_id,role,status) VALUES(7,2,'cofounder','accepted'),(7,4,'advisor','accepted');");
  db.exec("INSERT INTO contacts(id,uid,project_id,audience,name,organization,email,status,utm_json) VALUES (11,'prospect-a',7,'customer','Ari','Synthetic Co','ari@example.test','replied','{\"campaign_uid\":\"campaign-a\"}'),(12,'prospect-b',7,'customer','Bea','Synthetic Co','bea@example.test','new',NULL),(13,'foreign-contact',8,'customer','Other','Other Co','foreign@example.test','replied',NULL); INSERT INTO grow_campaigns(uid,project_id,name,goal,status) VALUES('campaign-a',7,'Synthetic campaign','demos','draft');");
  db.exec("INSERT INTO contact_replies(id,contact_id,direction,body,created_at) VALUES(21,11,'inbound','A real contact reply','2026-11-02 10:00:00'),(22,11,'outbound','A logged answer','2026-11-02 11:00:00'),(23,13,'inbound','Foreign reply','2026-11-03 10:00:00');");
  db.exec("INSERT INTO mail_accounts(id,uid,user_id,provider,address,status,can_read) VALUES(31,'own-readable',1,'outlook','owner@example.test','active',1),(32,'own-send-only',1,'gmail','owner2@example.test','active',0),(33,'other-mailbox',3,'outlook','other@example.test','active',1); INSERT INTO mail_sent(uid,user_id,account_id,recipient,recipient_hash,subject,provider_message_id,sent_at) VALUES('own-sent',1,31,'ari@example.test','synthetic-hash','Own email','sent-a','2026-11-01T10:00:00Z'),('send-only',1,32,'bea@example.test','synthetic-hash-b','Send-only email','sent-b','2026-11-01T11:00:00Z'),('foreign-sent',3,33,'ari@example.test','synthetic-hash-c','Other member private subject','sent-foreign','2026-11-01T12:00:00Z');");
  return { db, env: { DB: d1Over(db), JWT_SECRET: SECRET, ENVIRONMENT: 'development' } as any };
}
const app = new Hono<any>().route('/api/grow/inbox', inbox);
async function call(f: any, method: string, path = '', body?: unknown, who = 1, extra: Record<string, unknown> = {}) {
  const token = await new SignJWT({ user_id: who, role: 'founder', ...extra }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  const response = await app.fetch(new Request('http://unit/api/grow/inbox' + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), f.env);
  return { status: response.status, body: await response.json() as any };
}
const syntheticMessage = { id: 'reply-a', from: 'ari@example.test', received_at: '2026-11-03T10:00:00Z', subject: 'Own email', preview: 'A readable mailbox reply' };
async function withReader(go: (calls: any[]) => Promise<void>) {
  const saved = inboxMailboxReader.read, calls: any[] = [];
  inboxMailboxReader.read = async (_env, account, sentId) => { calls.push({ user: account.user_id, canRead: account.can_read, sentId }); return [syntheticMessage, { ...syntheticMessage, id: 'unrelated', from: 'unrelated@example.test', preview: 'Unrelated private reply' }]; };
  try { await go(calls); } finally { inboxMailboxReader.read = saved; }
}

test('threads merge the contact log, own sent mail and readable replies per prospect, with real campaign tags', async () => {
  const f = fixture();
  await withReader(async (calls) => {
    const list = await call(f, 'GET', '?project=7');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.threads.map((t: any) => t.contact.uid).sort(), ['prospect-a', 'prospect-b']);
    assert.equal(list.body.unread_count, 1);
    assert.deepEqual(list.body.threads.find((t: any) => t.contact.uid === 'prospect-a').campaign, { uid: 'campaign-a', name: 'Synthetic campaign' });
    assert.deepEqual(calls, [{ user: 1, canRead: 1, sentId: 'sent-a' }]);
    const detail = await call(f, 'GET', '/prospect-a?project=7');
    assert.deepEqual(detail.body.thread.messages.map((m: any) => m.source).sort(), ['contact_replies', 'contact_replies', 'mail_sent', 'mailbox']);
    assert.equal(detail.body.thread.messages.find((m: any) => m.source === 'mail_sent').body, null);
    assert.doesNotMatch(JSON.stringify(list.body), /owner@example|ari@example|foreign-contact|Other member private subject|Unrelated private reply/);
    assert.equal(detail.body.recipient, 'ari@example.test');
  });
});

test('venture/contact boundaries, support sessions and another member mailbox stay closed', async () => {
  const f = fixture();
  await withReader(async () => {
    assert.equal((await call(f, 'GET', '/foreign-contact?project=7')).status, 404);
    assert.equal((await call(f, 'GET', '?project=8')).status, 404);
    assert.equal((await call(f, 'GET', '?project=7', undefined, 3)).status, 404);
    assert.equal((await call(f, 'GET', '?project=7', undefined, 1, { impersonated_by: 3 })).status, 403);
    const member = await call(f, 'GET', '/prospect-a?project=7', undefined, 2);
    assert.deepEqual(member.body.accounts, []);
    assert.doesNotMatch(JSON.stringify(member.body), /readable mailbox reply|Own email|Other member private/);
  });
});

test('unread receipts are per member, snapshot based, and a new inbound arrival stays unread', async () => {
  const f = fixture();
  await withReader(async () => {
    const read = await call(f, 'GET', '/prospect-a?project=7');
    const keys = read.body.thread.messages.filter((m: any) => m.direction === 'inbound').map((m: any) => m.key);
    f.db.prepare("INSERT INTO contact_replies(contact_id,direction,body,created_at) VALUES(11,'inbound','Arrived during reading','2026-11-04 10:00:00')").run();
    assert.equal((await call(f, 'POST', '/prospect-a/read', { project: 7, message_keys: keys })).status, 200);
    assert.equal((await call(f, 'GET', '/unread-count?project=7')).body.count, 1);
    const latest = await call(f, 'GET', '/prospect-a?project=7');
    const all = latest.body.thread.messages.filter((m: any) => m.direction === 'inbound').map((m: any) => m.key);
    await call(f, 'POST', '/prospect-a/read', { project: 7, message_keys: all });
    assert.equal((await call(f, 'GET', '/unread-count?project=7')).body.count, 0);
    const reader = inboxMailboxReader.read;
    inboxMailboxReader.read = async () => [{ ...syntheticMessage, preview: 'Different preview, same message' }];
    assert.equal((await call(f, 'GET', '/unread-count?project=7')).body.count, 0, 'a preview change does not invent a new message');
    inboxMailboxReader.read = reader;
    assert.equal((await call(f, 'GET', '/unread-count?project=7', undefined, 2)).body.count, 1);
    assert.equal((await call(f, 'POST', '/prospect-a/read', { project: 7, message_keys: ['contact:23'] })).status, 409);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM activity_logs WHERE action='distribution_inbox_read' AND user_id=1").get()!.n, 2);
  });
});

test('a failed mailbox or database source yields unknown unread count and never exposes provider text', async () => {
  const f = fixture(), saved = inboxMailboxReader.read;
  inboxMailboxReader.read = async () => { throw new Error('Synthetic provider private payload'); };
  try {
    const count = await call(f, 'GET', '/unread-count?project=7');
    assert.equal(count.body.count, null);
    const list = await call(f, 'GET', '?project=7');
    assert.equal(list.body.state, 'unreadable');
    assert.equal(list.body.threads[0].unread, null);
    assert.doesNotMatch(JSON.stringify(list.body), /Synthetic provider/);
    const base = f.env.DB;
    f.env.DB = { ...base, prepare(sql: string) { if (sql.includes('FROM contact_replies')) throw new Error('Synthetic database fault'); return base.prepare(sql); } };
    assert.equal((await call(f, 'GET', '/unread-count?project=7')).body.count, null);
  } finally { inboxMailboxReader.read = saved; }
});

test('all Inbox endpoints are read-only for mail; even read receipts do not send', async () => {
  const f = fixture(), saved = outlookAdapter.send; let sends = 0;
  outlookAdapter.send = async () => { sends++; return { messageId: 'must-not-send' }; };
  try {
    await withReader(async () => {
      await call(f, 'GET', '?project=7');
      await call(f, 'GET', '/unread-count?project=7');
      const detail = await call(f, 'GET', '/prospect-a?project=7');
      await call(f, 'POST', '/prospect-a/read', { project: 7, message_keys: detail.body.thread.messages.filter((m: any) => m.direction === 'inbound').map((m: any) => m.key) });
      assert.equal(sends, 0);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_sent').get()!.n, 3);
    });
  } finally { outlookAdapter.send = saved; }
});

test('Outlook resolves the saved sent id, retains read scope and pages only the same conversation', async () => {
  const saved = globalThis.fetch, calls: { url: URL; options: RequestInit }[] = [];
  const env = { MAIL_MICROSOFT_CLIENT_ID: 'synthetic-client', MAIL_MICROSOFT_CLIENT_SECRET: 'synthetic-secret' } as any;
  globalThis.fetch = async (url: any, options: any = {}) => {
    const at = new URL(String(url)); calls.push({ url: at, options });
    if (at.hostname === 'login.microsoftonline.com') return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-rotated' });
    if (at.searchParams.get('$filter')?.startsWith('internetMessageId')) return Response.json({ value: [{ id: 'message-a', conversationId: 'conversation-a' }] });
    const message = { id: at.searchParams.has('$skip') ? 'reply-2' : 'reply-1', from: { emailAddress: { address: 'ari@example.test' } }, receivedDateTime: '2026-11-03T10:00:00Z', subject: 'A demo', bodyPreview: 'Synthetic message' };
    const next = new URL(at); next.searchParams.set('$skip', '137');
    return Response.json({ value: [message], ...(at.searchParams.has('$skip') ? {} : { '@odata.nextLink': next.href }) });
  };
  try {
    const read = await outlookAdapter.listThread!(env, { kind: 'oauth', refresh_token: 'synthetic-refresh' }, '<saved@example.test>');
    assert.deepEqual(read.messages.map((m) => m.id), ['reply-1', 'reply-2']);
    assert.equal(read.creds?.kind === 'oauth' && read.creds.refresh_token, 'synthetic-rotated');
    assert.match(String(calls[0].options.body), /Mail.Read/);
    assert.equal(calls[1].url.searchParams.get('$filter'), "internetMessageId eq '<saved@example.test>'");
    assert.deepEqual(calls.slice(2).map((c) => c.url.searchParams.get('$filter')), ["conversationId eq 'conversation-a'", "conversationId eq 'conversation-a'"]);
    assert.equal(calls.at(-1)!.url.searchParams.get('$skip'), '137');
    assert.equal(calls.some((c) => c.url.pathname.endsWith('/send') || c.url.pathname.endsWith('/sendMail')), false);
  } finally { globalThis.fetch = saved; }
});

test('Outlook refuses malformed pages and off-host pagination instead of reporting an empty thread', async () => {
  const saved = globalThis.fetch;
  const env = { MAIL_MICROSOFT_CLIENT_ID: 'synthetic-client', MAIL_MICROSOFT_CLIENT_SECRET: 'synthetic-secret' } as any;
  try {
    for (const response of [{}, { value: [], '@odata.nextLink': 'https://outside.example.test/?$skiptoken=x' }, { value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$filter=another-conversation&$skip=100' }]) {
      const hosts: string[] = [];
      globalThis.fetch = async (url: any) => {
        const at = new URL(String(url)); hosts.push(at.hostname);
        if (at.hostname === 'login.microsoftonline.com') return Response.json({ access_token: 'synthetic-access' });
        if (at.pathname.endsWith('/message-a')) return Response.json({ conversationId: 'conversation-a' });
        return Response.json(response);
      };
      await assert.rejects(() => outlookAdapter.listThread!(env, { kind: 'oauth', refresh_token: 'synthetic-refresh' }, 'message-a'), /Outlook could not be reached/);
      assert.equal(hosts.includes('outside.example.test'), false);
    }
  } finally { globalThis.fetch = saved; }
});

test('the default mailbox reader opens only the caller credentials, seals rotation and sends nothing', async () => {
  const f = fixture(), savedFetch = globalThis.fetch, adapters = [outlookAdapter, gmailAdapter], sends = adapters.map((a) => a.send);
  f.env.MAIL_MICROSOFT_CLIENT_ID = 'synthetic-client'; f.env.MAIL_MICROSOFT_CLIENT_SECRET = 'synthetic-secret';
  const sealed = await encryptColumn(f.env, 'mail_accounts', 'credentials', 'own-readable', JSON.stringify({ kind: 'oauth', refresh_token: 'synthetic-refresh-original' }));
  f.db.prepare('UPDATE mail_accounts SET credentials = ? WHERE id = 31').run(sealed);
  let sent = 0;
  for (const adapter of adapters) adapter.send = async () => { sent++; throw new Error('Inbox cannot send'); };
  globalThis.fetch = async (url: any) => {
    const at = new URL(String(url));
    if (at.hostname === 'login.microsoftonline.com') return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh-rotated' });
    if (at.hostname !== 'graph.microsoft.com') throw new Error('Unexpected provider');
    if (at.pathname.endsWith('/sent-a')) return Response.json({ conversationId: 'conversation-a' });
    return Response.json({ value: [{ id: 'readable-message', internetMessageId: '<stable@example.test>', from: { emailAddress: { address: 'ari@example.test' } }, receivedDateTime: '2026-11-03T10:00:00Z', subject: 'A demo', bodyPreview: 'A provider reply' }] });
  };
  try {
    const detail = await call(f, 'GET', '/prospect-a?project=7');
    assert.equal(detail.status, 200);
    assert.equal(detail.body.thread.messages.filter((m: any) => m.source === 'mailbox').length, 1);
    const keys = detail.body.thread.messages.filter((m: any) => m.direction === 'inbound').map((m: any) => m.key);
    await call(f, 'POST', '/prospect-a/read', { project: 7, message_keys: keys });
    assert.equal((await call(f, 'GET', '/unread-count?project=7')).body.count, 0);
    const row = f.db.prepare('SELECT * FROM mail_accounts WHERE id=31').get() as any;
    const creds = await openCreds(f.env, row);
    assert.equal(creds?.kind === 'oauth' && creds.refresh_token, 'synthetic-refresh-rotated');
    assert.doesNotMatch(JSON.stringify(detail.body), /synthetic-refresh|credentials|synthetic-access/);
    assert.equal(sent, 0);
  } finally { globalThis.fetch = savedFetch; adapters.forEach((a, i) => { a.send = sends[i]; }); }
});

test('a long read snapshot and its audit roll back together on a failed write', async () => {
  const f = fixture();
  const insert = f.db.prepare("INSERT INTO contact_replies(contact_id,direction,body) VALUES(11,'inbound',?)");
  for (let i = 0; i < 150; i++) insert.run('Synthetic reply ' + i);
  // In-memory fault injection only: force the second statement in the D1 batch to fail.
  f.db.exec("CREATE TRIGGER synthetic_inbox_audit_failure BEFORE INSERT ON activity_logs WHEN NEW.action='distribution_inbox_read' BEGIN SELECT RAISE(ABORT,'Synthetic audit failure'); END");
  await withReader(async () => {
    const detail = await call(f, 'GET', '/prospect-a?project=7');
    const keys = detail.body.thread.messages.filter((m: any) => m.direction === 'inbound').map((m: any) => m.key);
    const result = await call(f, 'POST', '/prospect-a/read', { project: 7, message_keys: keys });
    assert.equal(result.status, 503);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grow_inbox_reads').get()!.n, 0);
    assert.doesNotMatch(JSON.stringify(result.body), /Synthetic audit failure/);
  });
});

// Remaining #4494 handoff: the drafting context comes from the authenticated Inbox read.
import { distributionRequest, distributionContext } from '../src/services/distributionDrafts.ts';
test('reply drafting reads only the selected venture/contact and caller mailbox context', async () => {
  const f = fixture(), original = inboxMailboxReader.read;
  inboxMailboxReader.read = async () => [];
  try {
    const input = distributionRequest({ project:7,contact_uid:'prospect-a',target:'form',kinds:['reply'],sources:['distribution'] });
    const owner = await distributionContext(f.env,input,{id:1} as any);
    assert.match(JSON.stringify(owner.material),/A real contact reply/);
    assert.match(JSON.stringify(owner.material),/Own email/);
    assert.doesNotMatch(JSON.stringify(owner.material),/Foreign reply|Other member private subject|ari@example.test/);
    const member = await distributionContext(f.env,input,{id:2} as any);
    assert.doesNotMatch(JSON.stringify(member.material),/Own email/);
    await assert.rejects(distributionContext(f.env,{...input,contact_uid:'foreign-contact'},{id:1} as any),{code:'not_found'});
    assert.match(owner.sources.find(s=>s.key==='distribution')!.label,/selected reply thread/);
  } finally { inboxMailboxReader.read = original; }
});
test('thread drafting refuses a failed source, missing caller and spoofed browser context', async () => {
  const f = fixture(), original = inboxMailboxReader.read;
  const input = distributionRequest({project:7,contact_uid:'prospect-a',kinds:['reply'],sources:['distribution']});
  try {
    inboxMailboxReader.read = async () => { throw Error('private provider detail'); };
    await assert.rejects(distributionContext(f.env,input,{id:1} as any),{code:'thread_unreadable',sentence:'This thread could not be read. Refresh it before drafting.'});
    await assert.rejects(distributionContext(f.env,input),{code:'thread_required'});
    assert.throws(()=>distributionRequest({project:7,contact_uid:'prospect-a',kinds:[{kind:'reply',context:'browser supplied private thread'}],sources:['distribution']}),{code:'invalid_contact'});
    assert.throws(()=>distributionRequest({project:7,contact_uid:'prospect-a',kinds:['post'],sources:['distribution']}),{code:'invalid_contact'});
  } finally { inboxMailboxReader.read = original; }
});
