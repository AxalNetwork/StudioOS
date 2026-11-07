/**
 * D1340 (#3548, part 1 of #3547): the member's own mailboxes and the send.
 * Synthetic data on the real migrated schema; `cloudflare:sockets` is a
 * scripted SMTP/IMAP server, `fetch` a scripted Microsoft and Google.
 *
 *   · credentials are never in a reply or a log;
 *   · an expired token turns the mailbox `expired`, with a sentence;
 *   · disconnecting deletes the credentials and keeps the sent rows;
 *   · port 25 is refused before any socket opens;
 *   · a send without the composer's one-use nonce is refused;
 *   · one member cannot use another's account uid (404).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import mailAccounts, { SENDS_PER_HOUR } from '../src/routes/mail_accounts.ts';
import { checkSettings, socketDeps, type Connect, type Socket } from '../src/services/mail/adapters/imap.ts';
import { buildMime, headerSafe } from '../src/services/mail/adapters/mime.ts';
import { openCreds, saveAccount } from '../src/services/mail/accounts.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { migratedDatabase, removeMigratedDatabases } from './_storage_schema.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { __setPublicResolverForTest } from '../src/services/webFetch.ts';
// #4572 follow-up: a member-given URL's host is resolved before any fetch or socket; these tests answer DNS
// with a public address (the private cases are refused by name, before DNS, as before).
__setPublicResolverForTest(async () => ['93.184.216.34']);

after(removeMigratedDatabases);
const JWT_SECRET = 'synthetic-d1340-only-not-a-real-credential'.repeat(2);
const PASSWORD = 'synthetic-app-password-d1340';
const REFRESH = 'synthetic-refresh-token-d1340';
const ROTATED = 'synthetic-rotated-refresh-token-d1340';
const SECRETS = [PASSWORD, REFRESH, ROTATED, btoa(`\0member@example.invalid\0${PASSWORD}`)];

// ─────────────────────────────────────────────────────────── a scripted mail server

type Server = { connects: Array<{ port: number; secure: string }>; data: string[]; password: string; smtpRejects?: boolean; imapRejects?: boolean; quitFails?: boolean; dropAfterData?: boolean; refuseData?: boolean };

function fakeConnect(server: Server): Connect {
  return (addr, opts) => {
    server.connects.push({ port: addr.port, secure: opts.secureTransport });
    const imap = addr.port === 993 || addr.port === 143;
    let inData = false;
    let data = '';
    const make = (): Socket => {
      let ctrl!: ReadableStreamDefaultController<Uint8Array>;
      const readable = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
      const say = (s: string) => ctrl.enqueue(new TextEncoder().encode(`${s}\r\n`));
      const hear = (line: string) => {
        if (inData) {
          if (line === '.') {
            inData = false; server.data.push(data);
            if (server.dropAfterData) { try { ctrl.close(); } catch { /* closed */ } } // the answer is lost with the connection
            else say(server.refuseData ? '554 refused' : '250 queued');
          } else data += `${line}\n`;
          return;
        }
        if (imap) {
          const [tag, cmd] = line.split(' ');
          if (cmd === 'STARTTLS') say(`${tag} OK begin`);
          else if (cmd === 'LOGIN') say(!server.imapRejects && line.includes(`"${server.password}"`) ? `${tag} OK in` : `${tag} NO refused`);
          else if (cmd === 'LOGOUT') { say('* BYE'); say(`${tag} OK`); }
          return;
        }
        if (line.startsWith('EHLO')) { say('250-hello'); say('250 AUTH PLAIN'); }
        else if (line === 'STARTTLS') say('220 go ahead');
        else if (line.startsWith('AUTH PLAIN ')) say(!server.smtpRejects && atob(line.slice(11)).endsWith(`\0${server.password}`) ? '235 ok' : '535 no');
        else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) say('250 ok');
        else if (line === 'DATA') { inData = true; data = ''; say('354 go'); }
        else if (line === 'QUIT') say('221 bye');
      };
      const writable = new WritableStream<Uint8Array>({
        write(chunk) {
          for (const l of new TextDecoder().decode(chunk).split('\r\n').slice(0, -1)) {
            if (l === 'QUIT' && server.quitFails) throw new Error('synthetic: the connection broke after DATA was accepted');
            hear(l);
          }
        },
      });
      const socket: Socket = { readable, writable, startTls: () => make(), close: async () => { try { ctrl.close(); } catch { /* closed */ } } };
      return socket;
    };
    // The server speaks first; after STARTTLS it waits for the client.
    return withGreeting(make(), imap ? '* OK ready' : '220 ready');
  };
}

function withGreeting(s: Socket, greeting: string): Socket {
  const enc = new TextEncoder();
  const reader = s.readable.getReader();
  let sent = false;
  const readable = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (!sent) { sent = true; ctrl.enqueue(enc.encode(`${greeting}\r\n`)); return; }
      const r = await reader.read();
      if (r.done) ctrl.close(); else ctrl.enqueue(r.value);
    },
  });
  return { readable, writable: s.writable, startTls: () => s.startTls(), close: () => s.close() };
}

// ─────────────────────────────────────────────────────────── fixture

type Call = { url: string; body: string };

async function fixture(opts: { gmail?: boolean; token?: (body: URLSearchParams) => { status: number; json: any }; scope?: string; sendMail?: () => Response } = {}) {
  const db = migratedDatabase();
  const insert = db.prepare('INSERT INTO users(id, role, founder_id, name, email, is_active, subscription_tier) VALUES (?, ?, ?, ?, ?, 1, ?)');
  for (const [id, role, fid] of [[2, 'founder', 100], [3, 'founder', 300]] as const) insert.run(id, role, fid, `Synthetic member ${id}`, `synthetic-${id}@example.invalid`, 'studio');
  const env: any = {
    DB: d1Over(db), JWT_SECRET, ENVIRONMENT: 'development', KEK_PII: 'synthetic-kek-d1340-'.repeat(3),
    MAIL_MICROSOFT_CLIENT_ID: 'ms-client', MAIL_MICROSOFT_CLIENT_SECRET: 'ms-secret',
    MAIL_GMAIL_CLIENT_ID: 'g-client', MAIL_GMAIL_CLIENT_SECRET: 'g-secret', MAIL_GMAIL_ENABLED: opts.gmail ? 'true' : 'false',
  };
  const server: Server = { connects: [], data: [], password: PASSWORD };
  socketDeps.connect = fakeConnect(server);
  socketDeps.timeoutMs = 2000;
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    const body = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : '';
    calls.push({ url, body });
    const json = (status: number, j: any) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/oauth2/v2.0/token') || url === 'https://oauth2.googleapis.com/token') {
      const t = opts.token ? opts.token(new URLSearchParams(body)) : { status: 200, json: { access_token: 'synthetic-access', refresh_token: ROTATED, scope: opts.scope ?? 'Mail.Send offline_access User.Read',
        id_token: `x.${btoa(JSON.stringify({ email: 'Member@Example.invalid' }))}.y` } };
      return json(t.status, t.json);
    }
    if (url.startsWith('https://graph.microsoft.com/v1.0/me?')) return json(200, { mail: 'Member@Example.invalid', displayName: 'Synthetic Member' });
    // Microsoft's documented permissions, enforced on the scopes the token was granted: Create message needs
    // Mail.ReadWrite, sendMail needs Mail.Send.
    const granted = (opts.scope ?? 'Mail.Send offline_access User.Read').split(' ');
    if (url === 'https://graph.microsoft.com/v1.0/me/messages') return granted.includes('Mail.ReadWrite') ? json(201, { id: 'graph-1', internetMessageId: '<graph-1@outlook.invalid>' }) : json(403, { error: { code: 'ErrorAccessDenied' } });
    if (url === 'https://graph.microsoft.com/v1.0/me/sendMail') return granted.includes('Mail.Send') ? (opts.sendMail ? opts.sendMail() : new Response(null, { status: 202 })) : json(403, { error: { code: 'ErrorAccessDenied' } });
    if (url.startsWith('https://gmail.googleapis.com/')) return json(200, { id: 'gmail-1' });
    if (url.endsWith('/send')) return new Response(null, { status: 202 });
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return new Response(null, { status: 200 });
    throw new Error('no network in this test');
  }) as any;
  const logs: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of ['log', 'warn', 'error', 'info'] as const) (console as any)[k] = (...a: unknown[]) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  const app = new Hono<any>().route('/api/mail', mailAccounts);
  app.onError((err, c) => c.json({ detail: err.message }, (AUTH_ERROR_STATUSES[err.message] || 500) as any));
  const close = () => { globalThis.fetch = real; Object.assign(console, saved); socketDeps.connect = null; db.close(); };
  const sentRows = () => db.prepare('SELECT user_id, account_id, recipient, recipient_hash, subject, provider_message_id, draft_uid, refs_json, sent_at, error FROM mail_sent ORDER BY id').all() as any[];
  const account = (uid: string) => db.prepare('SELECT * FROM mail_accounts WHERE uid = ?').get(uid) as any;
  return { db, env, app, server, calls, logs, close, sentRows, account };
}
type F = Awaited<ReturnType<typeof fixture>>;

async function call(f: F, who: number, method: string, path: string, json?: unknown, claims: Record<string, unknown> = {}) {
  const jwt = await new SignJWT({ user_id: who, ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await f.app.request(path, { method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: json === undefined ? undefined : JSON.stringify(json) }, f.env);
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, text, location: res.headers.get('location') };
}

const IMAP = {
  address: 'Member@Example.invalid', display_name: 'Synthetic Member', username: 'member@example.invalid', password: PASSWORD,
  smtp_host: 'smtp.example.invalid', smtp_port: 587, smtp_tls: 'starttls', imap_host: 'imap.example.invalid', imap_port: 993, imap_tls: 'tls',
};
const user = (id: number) => ({ id, role: 'founder' } as any);
const noSecrets = (f: F, where: string, text: string) => { for (const s of SECRETS) assert.ok(!text.includes(s), `${where} carries a credential`); };

async function sendNonce(f: F, who: number, accountUid: string) {
  const r = await call(f, who, 'POST', '/api/mail/send/confirm', { account_uid: accountUid });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.nonce as string;
}

// ─────────────────────────────────────────────────────────── pure

test('settings: port 25, plaintext and a local host are refused in words; a header never carries a line break', () => {
  assert.throws(() => checkSettings({ ...IMAP, smtp_port: 25 } as any), /Port 25 is refused/);
  assert.throws(() => checkSettings({ ...IMAP, imap_port: 25 } as any), /Port 25 is refused/);
  assert.throws(() => checkSettings({ ...IMAP, smtp_tls: 'none' } as any), /never connected without encryption/);
  assert.throws(() => checkSettings({ ...IMAP, smtp_host: 'localhost' } as any), /host name/);
  assert.throws(() => checkSettings({ ...IMAP, imap_host: '10.0.0.1' } as any), /host name/);
  assert.throws(() => checkSettings({ ...IMAP, password: '' } as any), /app password/);
  assert.equal(checkSettings(IMAP as any).smtp_host, 'smtp.example.invalid');
  assert.equal(headerSafe('Hello'), true);
  assert.equal(headerSafe('Hi\r\nBcc: x@example.invalid'), false);
  const mime = buildMime({ from: 'a@example.invalid', fromName: 'Zoë', to: 'b@example.invalid', subject: 'Café', body: 'one\n.\ntwo' }, 'id@axal.vc', new Date('2026-10-28T00:00:00Z'));
  assert.match(mime, /^From: =\?UTF-8\?B\?/);
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  assert.match(mime, /Content-Transfer-Encoding: base64/);
  assert.ok(!/\r\n\.\r\n/.test(mime), 'no lone dot line in the body');
});

// ─────────────────────────────────────────────────────────── IMAP / SMTP

test('IMAP: port 25 is refused before any socket opens; a good mailbox is verified, sealed and never shown', async () => {
  const f = await fixture();
  try {
    const port25 = await call(f, 2, 'POST', '/api/mail/accounts/imap', { ...IMAP, smtp_port: 25 });
    assert.deepEqual([port25.status, port25.body.error], [400, 'mailbox_refused']);
    assert.match(port25.body.detail, /Port 25 is refused/);
    assert.deepEqual(f.server.connects, [], 'no socket opened');
    const r = await call(f, 2, 'POST', '/api/mail/accounts/imap', IMAP);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(f.server.connects, [{ port: 587, secure: 'starttls' }, { port: 993, secure: 'on' }], 'SMTP AUTH then IMAP LOGIN');
    assert.deepEqual(f.server.data, [], 'verify sends nothing');
    assert.deepEqual([r.body.account.provider, r.body.account.address, r.body.account.status, r.body.account.can_read], ['imap', 'member@example.invalid', 'active', false]);
    assert.ok(!('credentials' in r.body.account));
    noSecrets(f, 'the reply', r.text);
    const row = f.account(r.body.account.uid);
    assert.match(row.credentials, /^v1\./);
    noSecrets(f, 'the stored blob', row.credentials);
    assert.equal((await openCreds(f.env, row) as any).password, PASSWORD, 'it opens for its own row');
    assert.equal(await openCreds(f.env, { ...row, uid: 'f'.repeat(32) }), null, 'and for no other');
    const list = await call(f, 2, 'GET', '/api/mail/accounts');
    assert.deepEqual(list.body.providers, { outlook: true, gmail: false, imap: true, mcp: false });
    noSecrets(f, 'the list', list.text);
    const wrong = await call(f, 2, 'POST', '/api/mail/accounts/imap', { ...IMAP, address: 'other@example.invalid', password: 'not-the-password' });
    assert.deepEqual([wrong.status, wrong.body.error], [400, 'mailbox_auth_failed']);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_accounts').get()!.n, 1, 'a refused mailbox is not stored');
    for (const side of ['smtpRejects', 'imapRejects'] as const) {
      f.server[side] = true;
      f.server.connects.length = 0;
      const one = await call(f, 2, 'POST', '/api/mail/accounts/imap', { ...IMAP, address: `${side}@example.invalid` });
      assert.deepEqual([one.status, one.body.error], [400, 'mailbox_auth_failed'], side);
      assert.equal(f.server.connects.length, side === 'smtpRejects' ? 1 : 2, `${side}: refused where it was refused`);
      f.server[side] = false;
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM mail_accounts').get()!.n, 1);
    noSecrets(f, 'the logs', f.logs.join('\n'));
  } finally { f.close(); }
});

test('a send needs the composer\'s one-use nonce; it goes out once and is logged with the recipient hashed', async () => {
  const f = await fixture();
  try {
    const acct = (await call(f, 2, 'POST', '/api/mail/accounts/imap', IMAP)).body.account;
    const msg = { account_uid: acct.uid, to: 'Investor@Example.invalid', subject: 'Our October update', body: 'Hello.\n.\nThanks.' };
    for (const nonce of [undefined, '', 'x'.repeat(43)]) {
      const r = await call(f, 2, 'POST', '/api/mail/send', { ...msg, nonce });
      assert.deepEqual([r.status, r.body.error], [403, 'confirmation_required']);
    }
    assert.deepEqual([f.server.data, f.sentRows()], [[], []], 'nothing sent, nothing logged');
    const nonce = await sendNonce(f, 2, acct.uid);
    const sent = await call(f, 2, 'POST', '/api/mail/send', { ...msg, nonce });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(f.server.data.length, 1);
    assert.match(f.server.data[0], /Subject: Our October update/);
    assert.match(f.server.data[0], /To: <investor@example.invalid>/);
    const [row] = f.sentRows();
    assert.deepEqual([row.recipient, row.subject, row.error, row.draft_uid, row.refs_json], ['investor@example.invalid', 'Our October update', null, null, '[]']);
    assert.match(row.recipient_hash, /^[a-f0-9]{64}$/);
    assert.ok(row.sent_at && row.provider_message_id);
    const again = await call(f, 2, 'POST', '/api/mail/send', { ...msg, nonce });
    assert.deepEqual([again.status, again.body.error], [403, 'confirmation_required'], 'a nonce is spent once');
    assert.equal((await call(f, 2, 'POST', '/api/mail/send', { ...msg, to: 'a@example.invalid\r\nBcc: b@example.invalid', nonce: await sendNonce(f, 2, acct.uid) })).status, 400);
    assert.equal((await call(f, 2, 'POST', '/api/mail/send', { ...msg, subject: 'Hi\r\nBcc: b@example.invalid', nonce: await sendNonce(f, 2, acct.uid) })).status, 400);
    noSecrets(f, 'the logs', f.logs.join('\n'));
  } finally { f.close(); }
});

test('one member cannot use another\'s mailbox: every route answers 404 as for none', async () => {
  const f = await fixture();
  try {
    const acct = (await call(f, 2, 'POST', '/api/mail/accounts/imap', IMAP)).body.account;
    const nonce = await sendNonce(f, 2, acct.uid);
    for (const [method, path, json] of [
      ['POST', '/api/mail/send', { account_uid: acct.uid, to: 'x@example.invalid', subject: 'S', body: 'B', nonce }],
      ['POST', '/api/mail/send/confirm', { account_uid: acct.uid }],
      ['POST', `/api/mail/accounts/${acct.uid}/verify`],
      ['DELETE', `/api/mail/accounts/${acct.uid}`],
    ] as const) {
      const r = await call(f, 3, method, path, json);
      assert.deepEqual([r.status, r.body.detail], [404, 'Mailbox not found.'], path);
    }
    assert.equal((await call(f, 3, 'GET', '/api/mail/accounts')).body.accounts.length, 0);
    assert.equal(f.account(acct.uid).status, 'active');
    assert.deepEqual(f.sentRows(), []);
    const theirs = await call(f, 2, 'POST', '/api/mail/send', { account_uid: acct.uid, to: 'x@example.invalid', subject: 'S', body: 'B', nonce });
    assert.equal(theirs.status, 201, 'the nonce was still the owner\'s to spend');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── Outlook

test('Outlook: an expired refresh token turns the mailbox expired with a sentence; the send is logged as failed', async () => {
  const f = await fixture({ token: () => ({ status: 400, json: { error: 'invalid_grant', error_description: `AADSTS70008 ${REFRESH}` } }) });
  try {
    const acct = await saveAccount(f.env, user(2), { provider: 'outlook', address: 'member@example.invalid', display_name: null, scopes: 'Mail.Send offline_access User.Read', can_read: false, creds: { kind: 'oauth', refresh_token: REFRESH } });
    const r = await call(f, 2, 'POST', '/api/mail/send', { account_uid: acct.uid, to: 'x@example.invalid', subject: 'S', body: 'B', nonce: await sendNonce(f, 2, acct.uid) });
    assert.deepEqual([r.status, r.body.error], [409, 'mailbox_expired']);
    assert.equal(r.body.detail, 'Outlook asked for the mailbox to be connected again. Reconnect it to send.');
    const row = f.account(acct.uid);
    assert.deepEqual([row.status, row.last_error], ['expired', r.body.detail]);
    const [sent] = f.sentRows();
    assert.deepEqual([sent.sent_at, sent.error], [null, r.body.detail]);
    const tokenCalls = f.calls.length;
    const later = await call(f, 2, 'POST', '/api/mail/send', { account_uid: acct.uid, to: 'x@example.invalid', subject: 'S', body: 'B', nonce: await sendNonce(f, 2, acct.uid) });
    assert.deepEqual([later.status, later.body.detail], [409, r.body.detail], 'an expired mailbox sends nothing until reconnected');
    assert.equal(f.calls.length, tokenCalls, 'and asks the provider nothing');
    const v = await call(f, 2, 'POST', `/api/mail/accounts/${acct.uid}/verify`);
    assert.deepEqual([v.body.account.status, v.body.account.last_error], ['expired', r.body.detail]);
    noSecrets(f, 'the replies', r.text + later.text + v.text);
    noSecrets(f, 'the logs', f.logs.join('\n'));
  } finally { f.close(); }
});

test('Outlook: a send uses Graph, and the rotated refresh token is sealed in place of the old one', async () => {
  const f = await fixture();
  try {
    const acct = await saveAccount(f.env, user(2), { provider: 'outlook', address: 'member@example.invalid', display_name: null, scopes: 'Mail.Send', can_read: false, creds: { kind: 'oauth', refresh_token: REFRESH } });
    const r = await call(f, 2, 'POST', '/api/mail/send', { account_uid: acct.uid, to: 'x@example.invalid', subject: 'S', body: 'B', nonce: await sendNonce(f, 2, acct.uid) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.sent.provider_message_id, null, 'sendMail returns no message id, and none is invented');
    assert.deepEqual(f.calls.map((c) => c.url.replace(/\?.*/, '')), [
      'https://login.microsoftonline.com/common/oauth2/v2.0/token', 'https://graph.microsoft.com/v1.0/me/sendMail',
    ], 'the send-only consent sends with sendMail, and creates no draft');
    assert.equal((await openCreds(f.env, f.account(acct.uid)) as any).refresh_token, ROTATED);
    noSecrets(f, 'the reply', r.text);
  } finally { f.close(); }
});

test('connect: Gmail waits on its switch; Outlook\'s consent asks only Mail.Send, offline_access and User.Read, and its state is spent once', async () => {
  const f = await fixture();
  try {
    const g = await call(f, 2, 'POST', '/api/mail/accounts/start/gmail');
    assert.deepEqual([g.status, g.body.error], [409, 'gmail_not_offered']);
    assert.equal((await call(f, 2, 'POST', '/api/mail/accounts/start/yahoo')).status, 404);
    const s = await call(f, 2, 'POST', '/api/mail/accounts/start/outlook');
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const url = new URL(s.body.authorize_url);
    assert.equal(url.searchParams.get('scope'), 'Mail.Send offline_access User.Read');
    const state = url.searchParams.get('state')!;
    const cb = await f.app.request(`/api/mail/accounts/oauth/callback?code=c1&state=${encodeURIComponent(state)}`, {}, f.env);
    assert.equal(cb.headers.get('location'), '/email?mail=connected');
    const [acct] = (await call(f, 2, 'GET', '/api/mail/accounts')).body.accounts;
    assert.deepEqual([acct.provider, acct.address, acct.display_name, acct.can_read], ['outlook', 'member@example.invalid', 'Synthetic Member', false]);
    const again = await f.app.request(`/api/mail/accounts/oauth/callback?code=c1&state=${encodeURIComponent(state)}`, {}, f.env);
    assert.equal(again.headers.get('location'), '/email?mail=expired', 'a state is spent once');
    const forged = await f.app.request('/api/mail/accounts/oauth/callback?code=c1&state=' + 'a'.repeat(43), {}, f.env);
    assert.equal(forged.headers.get('location'), '/email?mail=expired');
    const read = new URL((await call(f, 2, 'POST', '/api/mail/accounts/start/outlook', { read: true })).body.authorize_url);
    assert.equal(read.searchParams.get('scope'), 'Mail.Send offline_access User.Read Mail.Read', 'Mail.Read only when asked');
    noSecrets(f, 'the logs', f.logs.join('\n'));
  } finally { f.close(); }
});

test('Gmail behind its switch: gmail.send with openid email, never the house token; revoked at Google on disconnect', async () => {
  const f = await fixture({ gmail: true });
  try {
    const s = await call(f, 2, 'POST', '/api/mail/accounts/start/gmail');
    const url = new URL(s.body.authorize_url);
    assert.equal(url.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/gmail.send');
    assert.equal(url.searchParams.get('client_id'), 'g-client');
    const cb = await f.app.request(`/api/mail/accounts/oauth/callback?code=c1&state=${encodeURIComponent(url.searchParams.get('state')!)}`, {}, f.env);
    assert.equal(cb.headers.get('location'), '/email?mail=connected');
    const [acct] = (await call(f, 2, 'GET', '/api/mail/accounts')).body.accounts;
    assert.deepEqual([acct.provider, acct.address], ['gmail', 'member@example.invalid']);
    const sent = await call(f, 2, 'POST', '/api/mail/send', { account_uid: acct.uid, to: 'x@example.invalid', subject: 'S', body: 'B', nonce: await sendNonce(f, 2, acct.uid) });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.sent.provider_message_id, 'gmail-1');
    const del = await call(f, 2, 'DELETE', `/api/mail/accounts/${acct.uid}`);
    assert.equal(del.status, 200);
    assert.ok(f.calls.some((c) => c.url.startsWith('https://oauth2.googleapis.com/revoke')), 'revoked at Google');
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── disconnect, drafts, limits

test('disconnect deletes the credentials and keeps the sent rows; the mailbox no longer lists or sends', async () => {
  const f = await fixture();
  try {
    const acct = (await call(f, 2, 'POST', '/api/mail/accounts/imap', IMAP)).body.account;
    await call(f, 2, 'POST', '/api/mail/send', { account_uid: acct.uid, to: 'x@example.invalid', subject: 'S', body: 'B', nonce: await sendNonce(f, 2, acct.uid) });
    const del = await call(f, 2, 'DELETE', `/api/mail/accounts/${acct.uid}`);
    assert.equal(del.status, 200);
    const row = f.account(acct.uid);
    assert.deepEqual([row.status, row.credentials], ['revoked', null]);
    assert.equal(f.sentRows().length, 1, 'the sent row stays');
    assert.equal((await call(f, 2, 'GET', '/api/mail/accounts')).body.accounts.length, 0);
    assert.equal((await call(f, 2, 'POST', '/api/mail/send/confirm', { account_uid: acct.uid })).status, 404);
    assert.equal((await call(f, 2, 'DELETE', `/api/mail/accounts/${acct.uid}`)).status, 404);
  } finally { f.close(); }
});

test('a draft\'s quoted refs ride the sent row; another member\'s draft is not found; the hourly limit holds; a support session is refused', async () => {
  const f = await fixture();
  try {
    const mine = 'a'.repeat(32), theirs = 'b'.repeat(32);
    f.db.prepare("INSERT INTO mail_drafts(uid,user_id,person_ref,intent,tone,length,refs_json,subject,body) VALUES (?,2,'interviewee:11','thank_follow_up','warm','short',?,'S','B')")
      .run(mine, JSON.stringify([{ ref: 'interviewee:11', label: 'L' }, { ref: 'kpis:1', label: 'K' }]));
    f.db.prepare("INSERT INTO mail_drafts(uid,user_id,person_ref,intent,tone,length,subject,body) VALUES (?,3,'prospect:1','send_update','warm','short','S','B')").run(theirs);
    const acct = (await call(f, 2, 'POST', '/api/mail/accounts/imap', IMAP)).body.account;
    const base = { account_uid: acct.uid, to: 'x@example.invalid', subject: 'S', body: 'B' };
    const ok = await call(f, 2, 'POST', '/api/mail/send', { ...base, draft_uid: mine, nonce: await sendNonce(f, 2, acct.uid) });
    assert.deepEqual(ok.body.sent.refs, ['interviewee:11', 'kpis:1']);
    assert.equal(f.sentRows()[0].refs_json, '["interviewee:11","kpis:1"]');
    const other = await call(f, 2, 'POST', '/api/mail/send', { ...base, draft_uid: theirs, nonce: await sendNonce(f, 2, acct.uid) });
    assert.deepEqual([other.status, other.body.detail], [404, 'Draft not found.']);
    const fill = f.db.prepare("INSERT INTO mail_send_ops(uid,user_id,account_id,op_key,fingerprint,state) VALUES (?,2,?,?,'f','accepted')");
    for (let i = 1; i < SENDS_PER_HOUR; i++) fill.run(`fill${i}`, f.account(acct.uid).id, `fillkey${String(i).padStart(16, '0')}`);
    const limited = await call(f, 2, 'POST', '/api/mail/send', { ...base, nonce: await sendNonce(f, 2, acct.uid) });
    assert.deepEqual([limited.status, limited.body.error], [429, 'send_rate_limited']);
    for (const [method, path] of [['GET', '/api/mail/accounts'], ['POST', '/api/mail/send'], ['POST', '/api/mail/accounts/imap']] as const) {
      const r = await call(f, 2, method, path, method === 'POST' ? base : undefined, { impersonated_by: 1 });
      assert.deepEqual([r.status, r.body.error], [403, 'support_session_refused'], path);
    }
  } finally { f.close(); }
});

// ─────────────────────────────────────────────────────────── D4665 (#4665): a send is an operation with a recorded outcome

const KEY = (n: number) => `op4665key${String(n).padStart(10, '0')}`;
const sendOf = (acct: string, extra: Record<string, unknown> = {}) => ({ account_uid: acct, to: 'x@example.invalid', subject: 'S', body: 'B', ...extra });
const ops = (f: F) => f.db.prepare('SELECT uid, op_key, state, error_code, provider_message_id, sent_uid FROM mail_send_ops ORDER BY id').all() as any[];

test('D4665: SMTP final DATA 250 followed by a QUIT failure is still an accepted send; a refusal before acceptance stays a failure', async () => {
  const f = await fixture();
  try {
    const acct = (await call(f, 2, 'POST', '/api/mail/accounts/imap', IMAP)).body.account;
    f.server.quitFails = true;
    const ok = await call(f, 2, 'POST', '/api/mail/send', sendOf(acct.uid, { operation_key: KEY(1), nonce: await sendNonce(f, 2, acct.uid) }));
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.body.operation.state, 'accepted');
    assert.equal(f.server.data.length, 1);
    assert.deepEqual(f.sentRows().map((r) => [r.error, !!r.sent_at]), [[null, true]]);
    f.server.quitFails = false;
    f.server.refuseData = true;
    const no = await call(f, 2, 'POST', '/api/mail/send', sendOf(acct.uid, { subject: 'Other', operation_key: KEY(2), nonce: await sendNonce(f, 2, acct.uid) }));
    assert.equal(no.status, 502, no.text);
    assert.deepEqual(ops(f).map((o) => o.state), ['accepted', 'refused']);
    assert.equal(f.sentRows()[1].error !== null, true, 'a failed row is kept, with a sentence');
  } finally { f.close(); }
});

test('D4665: provider acceptance survives a failed credential update and a failed sent-log write; a repeat with the same operation recovers it and never reaches the provider again', async () => {
  const f = await fixture();
  try {
    const acct = (await call(f, 2, 'POST', '/api/mail/accounts/imap', IMAP)).body.account;
    f.db.exec("CREATE TRIGGER t4665_used BEFORE UPDATE ON mail_accounts BEGIN SELECT RAISE(ABORT, 'synthetic bookkeeping failure'); END");
    f.db.exec("CREATE TRIGGER t4665_log BEFORE INSERT ON mail_sent BEGIN SELECT RAISE(ABORT, 'synthetic log failure'); END");
    const first = await call(f, 2, 'POST', '/api/mail/send', sendOf(acct.uid, { operation_key: KEY(3), nonce: await sendNonce(f, 2, acct.uid) }));
    assert.equal(first.status, 201, first.text);
    assert.equal(first.body.operation.state, 'accepted', 'the reply says the email went');
    assert.deepEqual(ops(f).map((o) => o.state), ['accepted']);
    assert.deepEqual(f.sentRows(), [], 'the log write failed alone');
    f.db.exec('DROP TRIGGER t4665_used; DROP TRIGGER t4665_log');
    const again = await call(f, 2, 'POST', '/api/mail/send', sendOf(acct.uid, { operation_key: KEY(3), nonce: await sendNonce(f, 2, acct.uid) }));
    assert.equal(again.status, 200, again.text);
    assert.equal(again.body.recovered, true);
    assert.equal(f.server.data.length, 1, 'the provider was reached once');
    assert.deepEqual(f.sentRows().map((r) => [r.error, !!r.sent_at]), [[null, true]], 'the log row is written on recovery');
    assert.equal(ops(f).length, 1, 'one operation, one place held');
    // The same key with a changed message is a different operation and is refused, not substituted.
    const changed = await call(f, 2, 'POST', '/api/mail/send', sendOf(acct.uid, { body: 'Different', operation_key: KEY(3), nonce: await sendNonce(f, 2, acct.uid) }));
    assert.deepEqual([changed.status, changed.body.error], [409, 'operation_changed']);
    assert.equal(f.server.data.length, 1);
  } finally { f.close(); }
});

test('D4665: a lost answer after the message was written is uncertain, is preserved on repeat, and needs the member\'s word before another send', async () => {
  const f = await fixture();
  try {
    const acct = (await call(f, 2, 'POST', '/api/mail/accounts/imap', IMAP)).body.account;
    f.server.dropAfterData = true;
    const lost = await call(f, 2, 'POST', '/api/mail/send', sendOf(acct.uid, { operation_key: KEY(4), nonce: await sendNonce(f, 2, acct.uid) }));
    assert.deepEqual([lost.status, lost.body.error.code, lost.body.operation.state], [202, 'send_uncertain', 'uncertain']);
    assert.doesNotMatch(lost.text, /Nothing was sent/);
    assert.equal(f.server.data.length, 1);
    f.server.dropAfterData = false;
    const repeat = await call(f, 2, 'POST', '/api/mail/send', sendOf(acct.uid, { operation_key: KEY(4), nonce: await sendNonce(f, 2, acct.uid) }));
    assert.deepEqual([repeat.status, repeat.body.operation.state], [202, 'uncertain']);
    assert.equal(f.server.data.length, 1, 'a repeat does not resend');
    const uid = lost.body.operation.uid;
    assert.equal((await call(f, 2, 'GET', `/api/mail/send/operations/${uid}`)).body.operation.state, 'uncertain');
    assert.equal((await call(f, 3, 'GET', `/api/mail/send/operations/${uid}`)).status, 404, 'another member cannot read it');
    assert.equal((await call(f, 2, 'POST', `/api/mail/send/operations/${uid}/resolve`, { outcome: 'maybe' })).status, 400);
    const done = await call(f, 2, 'POST', `/api/mail/send/operations/${uid}/resolve`, { outcome: 'not_arrived' });
    assert.equal(done.body.operation.state, 'refused', done.text);
    assert.equal((await call(f, 2, 'POST', `/api/mail/send/operations/${uid}/resolve`, { outcome: 'arrived' })).status, 409, 'settled once');
    const fresh = await call(f, 2, 'POST', '/api/mail/send', sendOf(acct.uid, { operation_key: KEY(5), nonce: await sendNonce(f, 2, acct.uid) }));
    assert.equal(fresh.status, 201, 'a new operation, chosen after reconciling');
  } finally { f.close(); }
});

test('D4665: a pending operation whose Worker died becomes uncertain, never refused', async () => {
  const f = await fixture();
  try {
    const acct = (await call(f, 2, 'POST', '/api/mail/accounts/imap', IMAP)).body.account;
    f.db.prepare("INSERT INTO mail_send_ops(uid,user_id,account_id,op_key,fingerprint,state,created_at,updated_at) VALUES (lower(hex(randomblob(16))),2,?,?,'f','pending',datetime('now','-10 minutes'),datetime('now','-10 minutes'))")
      .run(f.account(acct.uid).id, KEY(6));
    const op = f.db.prepare('SELECT uid FROM mail_send_ops').get() as any;
    assert.equal((await call(f, 2, 'GET', `/api/mail/send/operations/${op.uid}`)).body.operation.state, 'uncertain');
  } finally { f.close(); }
});

test('D4665: the 20-an-hour policy is one atomic admission; a replay takes no second place; a definite refusal releases its place', async () => {
  const f = await fixture();
  try {
    const acct = (await call(f, 2, 'POST', '/api/mail/accounts/imap', IMAP)).body.account;
    const accountId = f.account(acct.uid).id;
    const { admit } = await import('../src/services/mail/sendOps.ts');
    const results = await Promise.all(Array.from({ length: SENDS_PER_HOUR + 10 }, (_, i) => admit(f.env, user(2), accountId, KEY(100 + i), `fp${i}`)));
    assert.equal(results.filter((r) => r.kind === 'admitted').length, SENDS_PER_HOUR);
    assert.equal(results.filter((r) => r.kind === 'limited').length, 10);
    // The same key again is the same operation: it finds its row, and neither takes nor needs a place.
    const dup = await admit(f.env, user(2), accountId, KEY(100), 'fp0');
    assert.equal(dup.kind, 'existing');
    // Another member has their own twenty.
    assert.equal((await admit(f.env, user(3), accountId, KEY(100), 'fpx')).kind, 'admitted');
    // A refused place is released; a held one is not.
    f.db.prepare("UPDATE mail_send_ops SET state = 'refused' WHERE user_id = 2 AND op_key = ?").run(KEY(100));
    assert.equal((await admit(f.env, user(2), accountId, KEY(500), 'fpn')).kind, 'admitted');
    assert.equal((await admit(f.env, user(2), accountId, KEY(501), 'fpm')).kind, 'limited');
  } finally { f.close(); }
});

test('D4665: a wrong nonce frees the place it briefly held', async () => {
  const f = await fixture();
  try {
    const acct = (await call(f, 2, 'POST', '/api/mail/accounts/imap', IMAP)).body.account;
    const r = await call(f, 2, 'POST', '/api/mail/send', sendOf(acct.uid, { operation_key: KEY(7), nonce: 'n'.repeat(30) }));
    assert.deepEqual([r.status, r.body.error], [403, 'confirmation_required']);
    assert.deepEqual(ops(f), []);
    assert.equal(f.server.data.length, 0);
  } finally { f.close(); }
});

test('D4665: Outlook sends with exactly the consented Mail.Send; a grant without it asks for the mailbox to be reconnected, not "unreachable"', async () => {
  const f = await fixture({ scope: 'Mail.Send offline_access User.Read' });
  try {
    const acct = await saveAccount(f.env, user(2), { provider: 'outlook', address: 'member@example.invalid', display_name: null, scopes: 'Mail.Send', can_read: false, creds: { kind: 'oauth', refresh_token: REFRESH } });
    const ok = await call(f, 2, 'POST', '/api/mail/send', sendOf(acct.uid, { operation_key: KEY(8), nonce: await sendNonce(f, 2, acct.uid) }));
    assert.equal(ok.status, 201, ok.text);
    assert.ok(f.calls.every((c) => !c.url.endsWith('/me/messages')), 'no draft was created (that needs Mail.ReadWrite)');
  } finally { f.close(); }
  const g = await fixture({ scope: 'offline_access User.Read' });
  try {
    const acct = await saveAccount(g.env, user(2), { provider: 'outlook', address: 'member@example.invalid', display_name: null, scopes: 'Mail.Send', can_read: false, creds: { kind: 'oauth', refresh_token: REFRESH } });
    const r = await call(g, 2, 'POST', '/api/mail/send', sendOf(acct.uid, { operation_key: KEY(9), nonce: await sendNonce(g, 2, acct.uid) }));
    assert.deepEqual([r.status, r.body.error], [409, 'mailbox_consent'], r.text);
    assert.match(r.body.detail, /Reconnect the mailbox/);
    assert.equal(ops(g)[0].state, 'refused');
    assert.equal(g.account(acct.uid).status, 'expired');
    noSecrets(g, 'the reply', r.text);
  } finally { g.close(); }
  const h = await fixture({ sendMail: () => new Response(null, { status: 503 }) });
  try {
    const acct = await saveAccount(h.env, user(2), { provider: 'outlook', address: 'member@example.invalid', display_name: null, scopes: 'Mail.Send', can_read: false, creds: { kind: 'oauth', refresh_token: REFRESH } });
    const r = await call(h, 2, 'POST', '/api/mail/send', sendOf(acct.uid, { operation_key: KEY(10), nonce: await sendNonce(h, 2, acct.uid) }));
    assert.deepEqual([r.status, r.body.operation.state], [202, 'uncertain'], 'a 5xx from sendMail may have been accepted');
  } finally { h.close(); }
});
