/**
 * #4654 (Email audit 2/6) — one authoritative state per mailbox.
 *
 * Synthetic data on the real migrated schema; provider adapters are replaced by gated fakes so each test chooses
 * the order in which a provider operation completes relative to the member's own disconnect and reconnect.
 *
 *   · a verify, send or thread read that completes after a disconnect or a reconnect changes no credentials and
 *     no status, whether it succeeded or failed, and never reactivates a disconnected mailbox;
 *   · a connection started before a newer one, or before the member's disconnect, is refused and changes nothing;
 *     an explicitly started later connection reactivates;
 *   · a disconnect that began before a newer connection was saved does not undo it;
 *   · one row per member, provider and normalized address, however the connects overlap;
 *   · the migration merges existing duplicates, keeping sent history and the live connection.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import mailAccounts from '../src/routes/mail_accounts.ts';
import { ConnectionSuperseded, accountOf, forget, issueNonce, markExpired, markUsed, openCreds, saveAccount, spendOauthState } from '../src/services/mail/accounts.ts';
import { inboxMailboxReader } from '../src/services/growInbox.ts';
import { outlookAdapter } from '../src/services/mail/adapters/oauth.ts';
import { AdapterError } from '../src/services/mail/adapters/types.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-4654-only-not-a-real-credential'.repeat(2);
const OLD = 'synthetic-refresh-old-4654';
const NEW = 'synthetic-refresh-new-4654';
const ROTATED = 'synthetic-refresh-rotated-4654';
const ADDRESS = 'Member@Example.invalid';
const creds = (t: string) => ({ kind: 'oauth' as const, refresh_token: t });
const user = (id: number) => ({ id, role: 'founder' } as any);
const iso = (ms: number) => new Date(Date.UTC(2026, 10, 7, 12, 0, 0) + ms).toISOString();

function fixture() {
  const db = migratedDatabase();
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, fid] of [[2, 100], [3, 300]] as const) insert.run(id, 'founder', fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  const env: any = { DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'synthetic-kek-4654-'.repeat(3), MAIL_MICROSOFT_CLIENT_ID: 'c', MAIL_MICROSOFT_CLIENT_SECRET: 's' };
  const app = new Hono<any>().route('/api/mail', mailAccounts);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const row = (uid: string) => db.prepare('SELECT * FROM mail_accounts WHERE uid = ?').get(uid) as any;
  const connect = (token = OLD, startedAt?: string) => saveAccount(env, user(2), { provider: 'outlook', address: ADDRESS, display_name: null, scopes: 'Mail.Send', can_read: false, creds: creds(token) }, startedAt);
  return { db, env, app, row, connect, close: () => db.close() };
}
type F = ReturnType<typeof fixture>;

async function call(f: F, who: number, method: string, path: string, json?: unknown) {
  const jwt = await new SignJWT({ user_id: who }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text, location: res.headers.get('location') };
}

/** A promise a test settles by hand: the provider's answer, arriving when the test says. */
const gate = <T>() => { let go!: (v: T) => void; let fail!: (e: unknown) => void; const p = new Promise<T>((a, b) => { go = a; fail = b; }); return { p, go, fail }; };
function withAdapter<T>(over: Partial<typeof outlookAdapter>, fn: () => Promise<T>): Promise<T> {
  const saved = { ...outlookAdapter };
  Object.assign(outlookAdapter, over);
  return fn().finally(() => { Object.assign(outlookAdapter, saved); });
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('a verify that completes after a disconnect changes nothing: success or failure, the mailbox stays disconnected', async () => {
  for (const outcome of ['success', 'expired'] as const) {
    const f = fixture();
    try {
      const acct = await f.connect();
      const answer = gate<{ creds?: any }>();
      await withAdapter({ verify: () => answer.p as any, revoke: async () => {} }, async () => {
        const pending = call(f, 2, 'POST', `/api/mail/accounts/${acct.uid}/verify`);
        await settle();
        assert.equal((await call(f, 2, 'DELETE', `/api/mail/accounts/${acct.uid}`)).status, 200);
        if (outcome === 'success') answer.go({ creds: creds(ROTATED) }); else answer.fail(new AdapterError('expired', 'Outlook asked for the mailbox to be connected again.'));
        const r = await pending;
        // Mutation checked: markUsed/markExpired without the revision guard → the mailbox is `active` (or `expired`) again, with credentials.
        const after = f.row(acct.uid);
        assert.deepEqual([after.status, after.credentials, after.last_error], ['revoked', null, null], outcome);
        assert.equal(r.body.account.status, 'revoked', `the reply is the persisted state (${outcome})`);
      });
    } finally { f.close(); }
  }
});

test('a verify or send that completes after a RECONNECT leaves the newer connection\'s credentials and status alone', async () => {
  const f = fixture();
  try {
    const acct = await f.connect(OLD, iso(0));
    const stale = (await accountOf(f.env, user(2), acct.uid))!;
    await f.connect(NEW, iso(1000)); // the member reconnects while the old verify is in flight
    assert.equal(await markUsed(f.env, stale, creds(ROTATED)), false, 'the old success is not applied');
    assert.equal(await markExpired(f.env, stale, 'Outlook asked for the mailbox to be connected again.'), false, 'nor the old failure');
    const row = f.row(acct.uid);
    assert.deepEqual([row.status, row.last_error], ['active', null]);
    assert.equal(((await openCreds(f.env, row)) as any).refresh_token, NEW);
  } finally { f.close(); }
});

test('a send that completes after a disconnect is logged as sent but reactivates nothing', async () => {
  const f = fixture();
  try {
    const acct = await f.connect();
    const answer = gate<{ messageId: string; creds?: any }>();
    await withAdapter({ send: () => answer.p as any, revoke: async () => {} }, async () => {
      const nonce = (await call(f, 2, 'POST', '/api/mail/send/confirm', { account_uid: acct.uid })).body.nonce;
      const pending = call(f, 2, 'POST', '/api/mail/send', { account_uid: acct.uid, to: 'x@example.invalid', subject: 'S', body: 'B', nonce });
      await settle();
      assert.equal((await call(f, 2, 'DELETE', `/api/mail/accounts/${acct.uid}`)).status, 200);
      answer.go({ messageId: '<m@example.invalid>', creds: creds(ROTATED) });
      const r = await pending;
      assert.equal(r.status, 201, 'the email did go, and the reply says so');
      const after = f.row(acct.uid);
      assert.deepEqual([after.status, after.credentials], ['revoked', null], 'but the mailbox stays disconnected');
      const sent = f.db.prepare('SELECT sent_at, error FROM mail_sent').all() as any[];
      assert.equal(sent.length, 1);
      assert.ok(sent[0].sent_at && !sent[0].error);
    });
  } finally { f.close(); }
});

test('a thread read that completes after a disconnect does not write credentials back', async () => {
  const f = fixture();
  try {
    f.db.prepare("UPDATE users SET id = id").run();
    const acct = await f.connect();
    f.db.prepare('UPDATE mail_accounts SET can_read = 1 WHERE uid = ?').run(acct.uid);
    const answer = gate<{ messages: any[]; creds?: any }>();
    const listThread = gate<null>();
    await withAdapter({ listThread: () => { listThread.go(null); return answer.p as any; }, revoke: async () => {} }, async () => {
      const read = inboxMailboxReader.read(f.env, f.row(acct.uid), 'sent-1');
      await listThread.p;
      assert.equal((await call(f, 2, 'DELETE', `/api/mail/accounts/${acct.uid}`)).status, 200);
      answer.go({ messages: [], creds: creds(ROTATED) });
      await read;
      const after = f.row(acct.uid);
      assert.deepEqual([after.status, after.credentials], ['revoked', null]);
    });
  } finally { f.close(); }
});

test('connections: the one started later is authoritative, whichever finishes first; a connect started before a disconnect is refused', async () => {
  const f = fixture();
  try {
    const first = await f.connect(NEW, iso(2000)); // started second, finishes first
    await assert.rejects(f.connect(OLD, iso(1000)), (e: any) => e instanceof ConnectionSuperseded && e.reason === 'newer');
    assert.equal(((await openCreds(f.env, f.row(first.uid))) as any).refresh_token, NEW, 'the older connection did not replace the newer');
    // The reverse order is the same result.
    await f.connect(OLD, iso(3000));
    assert.equal(((await openCreds(f.env, f.row(first.uid))) as any).refresh_token, OLD, 'a later start replaces an earlier one');

    // The member disconnects at some moment; a connect STARTED before it never reactivates the mailbox.
    const row = (await accountOf(f.env, user(2), first.uid))!;
    assert.equal(await forget(f.env, row), true);
    const disconnectedAt = f.row(first.uid).disconnected_at as string;
    await assert.rejects(f.connect(NEW, new Date(Date.parse(disconnectedAt) - 1).toISOString()), (e: any) => e instanceof ConnectionSuperseded && e.reason === 'disconnected');
    assert.deepEqual([f.row(first.uid).status, f.row(first.uid).credentials], ['revoked', null], 'still disconnected');
    // A connect started after it is an explicit new connection, and reactivates.
    const again = await f.connect(NEW, new Date(Date.parse(disconnectedAt) + 1000).toISOString());
    assert.equal(again.status, 'active');
    assert.equal(((await openCreds(f.env, f.row(first.uid))) as any).refresh_token, NEW);
  } finally { f.close(); }
});

test('a disconnect that began before a newer connection was saved does not undo that connection', async () => {
  const f = fixture();
  try {
    const acct = await f.connect(OLD, iso(0));
    const stale = (await accountOf(f.env, user(2), acct.uid))!;
    await f.connect(NEW, iso(1000));
    assert.equal(await forget(f.env, stale), false);
    assert.equal(f.row(acct.uid).status, 'active');
    // Through the route: the answer says what is true.
    const row = f.row(acct.uid);
    assert.equal(((await openCreds(f.env, row)) as any).refresh_token, NEW);
    const del = await call(f, 2, 'DELETE', `/api/mail/accounts/${acct.uid}`);
    assert.deepEqual([del.status, del.body.ok, del.body.account.status], [200, true, 'revoked'], 'a disconnect that is current disconnects, and says so from persisted state');
  } finally { f.close(); }
});

test('one mailbox identity per member, provider and normalized address, however connects overlap', async () => {
  const f = fixture();
  try {
    const connects = await Promise.allSettled([f.connect(OLD, iso(0)), f.connect(NEW, iso(1)), f.connect('synthetic-third-4654', iso(2))]);
    assert.ok(connects.every((c) => c.status === 'fulfilled' || (c as any).reason instanceof ConnectionSuperseded));
    const rows = f.db.prepare("SELECT * FROM mail_accounts WHERE user_id = 2 AND provider = 'outlook'").all() as any[];
    assert.equal(rows.length, 1, 'one row');
    // Case and spacing of the address do not make another identity; another member or provider does.
    await saveAccount(f.env, user(2), { provider: 'outlook', address: ADDRESS.toLowerCase(), display_name: null, scopes: '', can_read: false, creds: creds(NEW) }, iso(5000));
    assert.equal((f.db.prepare("SELECT COUNT(*) AS n FROM mail_accounts WHERE user_id = 2 AND provider = 'outlook'").get() as any).n, 1);
    await saveAccount(f.env, user(3), { provider: 'outlook', address: ADDRESS, display_name: null, scopes: '', can_read: false, creds: creds(NEW) });
    await saveAccount(f.env, user(2), { provider: 'gmail', address: ADDRESS, display_name: null, scopes: '', can_read: false, creds: creds(NEW) });
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM mail_accounts').get() as any).n, 3);
    // The database itself refuses a second row for an identity.
    assert.throws(() => f.db.prepare("INSERT INTO mail_accounts (uid, user_id, provider, address) VALUES ('dup', 2, 'outlook', 'MEMBER@example.invalid')").run(), /UNIQUE/);
  } finally { f.close(); }
});

test('an OAuth state carries the time the connect started; the callback of an older one is superseded, not failed', async () => {
  const f = fixture();
  try {
    const older = await issueNonce(f.env, user(2), 'oauth', 'outlook');
    await settle();
    const newer = await issueNonce(f.env, user(2), 'oauth', 'outlook');
    const a = (await spendOauthState(f.env, older.nonce))!;
    const b = (await spendOauthState(f.env, newer.nonce))!;
    assert.ok(a.issued_at && b.issued_at && a.issued_at < b.issued_at, 'each state remembers when it was issued');
    await f.connect(NEW, b.issued_at!); // the newer connect completes first
    await assert.rejects(f.connect(OLD, a.issued_at!), ConnectionSuperseded);
    assert.equal(((await openCreds(f.env, f.db.prepare('SELECT * FROM mail_accounts').get() as any)) as any).refresh_token, NEW);
  } finally { f.close(); }
});

test('the migration merges existing duplicates: the live connection survives, sent history moves with it, and the index holds', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY);");
  db.exec(readFileSync('cloudflare-worker/sql/migrations/647_mail_accounts.sql', 'utf8'));
  db.prepare('INSERT INTO users(id) VALUES (2), (3)').run();
  const add = db.prepare('INSERT INTO mail_accounts (id, uid, user_id, provider, address, status, credentials) VALUES (?, ?, ?, ?, ?, ?, ?)');
  add.run(1, 'revoked-old', 2, 'outlook', 'member@example.invalid', 'revoked', null);
  add.run(2, 'live', 2, 'outlook', 'Member@Example.invalid', 'active', 'sealed-live');
  add.run(3, 'expired-new', 2, 'outlook', 'MEMBER@example.invalid', 'expired', 'sealed-expired');
  add.run(4, 'other-provider', 2, 'gmail', 'member@example.invalid', 'active', 'sealed-g');
  add.run(5, 'other-member', 3, 'outlook', 'member@example.invalid', 'active', 'sealed-o');
  add.run(6, 'solo-revoked-a', 3, 'imap', 'a@example.invalid', 'revoked', null);
  add.run(7, 'solo-revoked-b', 3, 'imap', 'A@example.invalid', 'revoked', null);
  const sent = db.prepare("INSERT INTO mail_sent (uid, user_id, account_id, recipient, recipient_hash, subject) VALUES (?, ?, ?, 'x@example.invalid', 'h', 'S')");
  for (const [u, uid, acc] of [['s1', 2, 1], ['s2', 2, 2], ['s3', 2, 3], ['s4', 3, 7]] as const) sent.run(u, uid, acc);
  db.exec(readFileSync('cloudflare-worker/sql/migrations/202611071555_mail_account_lifecycle.sql', 'utf8'));
  const accounts = db.prepare('SELECT id, uid, status FROM mail_accounts ORDER BY id').all() as any[];
  assert.deepEqual(accounts.map((a) => a.uid), ['live', 'other-provider', 'other-member', 'solo-revoked-b'], 'one row per identity: the active one with credentials, else the newest');
  const owners = Object.fromEntries((db.prepare('SELECT uid, account_id FROM mail_sent').all() as any[]).map((r) => [r.uid, r.account_id]));
  assert.deepEqual(owners, { s1: 2, s2: 2, s3: 2, s4: 7 }, 'every sent row names a surviving mailbox: history kept');
  assert.throws(() => add.run(9, 'again', 2, 'outlook', 'member@EXAMPLE.invalid', 'active', 'x'), /UNIQUE/);
  assert.deepEqual({ ...(db.prepare('SELECT lifecycle_rev, connect_started_at, disconnected_at FROM mail_accounts WHERE id = 2').get() as object) }, { lifecycle_rev: 0, connect_started_at: null, disconnected_at: null });
  db.close();
});
