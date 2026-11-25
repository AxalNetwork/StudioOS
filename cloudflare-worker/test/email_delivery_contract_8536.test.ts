/**
 * D8536 (#8536) — one delivery contract for critical transactional email,
 * driven through the shipped routes over the migrated schema with Gmail
 * stubbed at fetch. No real email is sent.
 *
 * For each covered flow (sign-in: `/magic/start` + the queue consumer's
 * `deliverNow`; invitations: `POST /company/:uid/invitations` + resend + accept):
 *   - the link uses the host of the environment it was sent from;
 *   - an expired link is refused, and a replacement link makes the old one invalid;
 *   - the provider refuses, then times out after accepting: the retry carries
 *     the same reference and the flow ends with one email;
 *   - the recipient is the address the subject record names, never the caller's;
 *   - no usable link appears in a captured log line or a stored row.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/email_delivery_contract_8536.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { format } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import auth from '../src/routes/auth.ts';
import company from '../src/routes/company.ts';
import { deliverNow } from '../src/services/email/send.ts';
import { sendCompanyInvitationEmailBound } from '../src/services/email.ts';
import { refKey, deliverWithReference } from '../src/services/email/deliveryContract.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

// ---------- Gmail, stubbed at fetch ----------
type Step = 'accept' | 'refuse' | 'accept_then_timeout';
let plan: Step[] = [];
let mail: { to: string; text: string }[] = [];
let gmailCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  let host = '';
  try { host = new URL(String(input?.url ?? input)).hostname; } catch { /* not a URL */ }
  if (host === 'oauth2.googleapis.com') return new Response(JSON.stringify({ access_token: 'stub-access' }), { status: 200 });
  if (host === 'gmail.googleapis.com') {
    gmailCalls++;
    const step = plan.shift() ?? 'accept';
    if (step === 'refuse') return new Response('{"error":"unavailable"}', { status: 503 });
    const raw = Buffer.from(String(JSON.parse(String(init?.body ?? '{}')).raw).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const parts = [...raw.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/g)]
      .map((m) => Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8'));
    mail.push({ to: (/^To: (.*)$/m.exec(raw)?.[1] ?? '').trim(), text: parts.join('\n') });
    if (step === 'accept_then_timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    return new Response(JSON.stringify({ id: `gm-${mail.length}` }), { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

// ---------- every console line, captured ----------
let logs: string[] = [];
const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
const realConsole = Object.fromEntries(methods.map((m) => [m, console[m]]));
for (const m of methods) (console as any)[m] = (...a: unknown[]) => { logs.push(format(...a)); };
test.after(() => { for (const m of methods) (console as any)[m] = realConsole[m]; globalThis.fetch = realFetch; });
test.beforeEach(() => { plan = []; mail = []; logs = []; gmailCalls = 0; });

const GMAIL = { GMAIL_CLIENT_ID: 'test-client', GMAIL_CLIENT_SECRET: 'test-secret-not-real', GMAIL_REFRESH_TOKEN: 'test-refresh-not-real' };
const JWT_SECRET = 'unit-test-jwt-secret-8536-0123456789abcdef';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}
function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  return db;
}

/** Every string in every row of the tables a send writes, for the "no link stored" check. */
function storedText(db: DatabaseSync): string {
  const tables = ['email_send_log', 'email_send_refs', 'activity_logs', 'magic_link_tokens', 'company_invitations', 'notifications_inbox'];
  return tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all())).join('\n');
}
function assertNoLink(db: DatabaseSync, token: string) {
  assert.ok(token.length >= 20, 'no token to look for');
  const leaked = logs.filter((l) => l.includes(token));
  assert.deepEqual(leaked, [], 'a usable link reached a log line');
  assert.ok(!storedText(db).includes(token), 'a usable link was stored in a row');
}

// =====================================================================
// Sign-in: /magic/start → the queue → deliverNow (the consumer)
// =====================================================================
function signInEnv(db: DatabaseSync, appUrl = 'https://axal.vc') {
  const queue: any[] = [];
  const env: any = {
    USE_CF_QUEUE: 'true', APP_URL: appUrl, ENVIRONMENT: 'development', JWT_SECRET,
    JOB_QUEUE: { send: async (body: any) => { queue.push(body); } },
    DB: d1Over(db), RATE_LIMITS: kv(), ...GMAIL,
  };
  return { env, queue };
}
async function start(env: any, email: string, ip = '203.0.113.9') {
  const res = await auth.request('/magic/start', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ email }),
  }, env);
  return res.status;
}
async function verify(env: any, token: string) {
  const res = await auth.request(`/magic/verify?token=${encodeURIComponent(token)}`, { headers: { 'cf-connecting-ip': '203.0.113.50' } }, env);
  return String(res.headers.get('location') || '');
}
const magicUrlOf = (msg: any) => String(/https?:\/\/[^\s"<>]+\/api\/auth\/magic\/verify\?token=[A-Za-z0-9_-]+/.exec(msg.payload.text)?.[0] || '');
const tokenOf = (url: string) => new URL(url).searchParams.get('token') || '';

test('sign-in: the link carries the host of the environment it was sent from', async () => {
  // Mutation checked: publicBase() returning a fixed 'https://axal.vc' fails the preview host.
  for (const host of ['https://preview-8536.example.test', 'https://axal.vc']) {
    const db = freshDb(); const { env, queue } = signInEnv(db, host);
    assert.equal(await start(env, 'host.check@example.test'), 202);
    assert.equal(queue.length, 1);
    assert.equal(new URL(magicUrlOf(queue[0])).origin, host);
    assert.ok(await deliverNow(env, queue[0].payload));
    assert.equal(mail.length, 1);
    assert.ok(mail[0].text.includes(`${host}/api/auth/magic/verify?token=`), 'the delivered email carries another host');
    mail = [];
  }
});

test('sign-in: an expired link is refused, and a replacement link makes the old one invalid', async () => {
  // Mutation checked: dropping the retire-earlier-links UPDATE in /magic/start lets the first link through.
  const db = freshDb(); const { env, queue } = signInEnv(db);
  assert.equal(await start(env, 'pat@example.test', '203.0.113.1'), 202);
  assert.equal(await start(env, 'pat@example.test', '203.0.113.2'), 202);
  const [first, second] = queue.map((m) => tokenOf(magicUrlOf(m)));
  assert.notEqual(first, second);
  assert.match(await verify(env, first), /magic_error=expired/, 'the replaced link still signs in');
  assert.doesNotMatch(await verify(env, second), /magic_error/, 'the replacement link was refused');

  // An expired link, not replaced, is refused too.
  assert.equal(await start(env, 'old@example.test', '203.0.113.3'), 202);
  const stale = tokenOf(magicUrlOf(queue[2]));
  db.prepare("UPDATE magic_link_tokens SET expires_at = datetime('now', '-1 minute') WHERE email = 'old@example.test'").run();
  assert.match(await verify(env, stale), /magic_error=expired/);
});

test('sign-in: a refused send, then one that times out after acceptance, ends with one email under one reference', async () => {
  // Mutation checked: deliverNow ignoring `send_ref` (sending unreferenced) mails a second time on the third delivery;
  // claiming a `timed_out` row again (state IN ('queued','refused','timed_out')) does the same.
  const db = freshDb(); const { env, queue } = signInEnv(db);
  assert.equal(await start(env, 'retry@example.test'), 202);
  const msg = queue[0];
  const token = tokenOf(magicUrlOf(msg));
  const tokenId = Number((db.prepare("SELECT id FROM magic_link_tokens WHERE email = 'retry@example.test'").get() as any).id);
  const ref = refKey({ flow: 'sign_in', subject: { kind: 'magic_link_token', id: tokenId }, attempt: 1 });
  assert.equal(JSON.stringify(msg.payload.send_ref), JSON.stringify({ flow: 'sign_in', subject: { kind: 'magic_link_token', id: tokenId }, attempt: 1 }));

  plan = ['refuse', 'accept_then_timeout'];
  // Queue delivery 1: refused, so the consumer throws and Cloudflare Queues retries.
  assert.equal(await deliverNow(env, msg.payload), false);
  // Queue delivery 2 (the retry, the same message): Gmail takes it, the answer never comes. Settled: no further retry.
  assert.equal(await deliverNow(env, msg.payload), true);
  // Queue delivery 3 (at-least-once redelivery): reconciled from the ledger, Gmail is not called.
  assert.equal(await deliverNow(env, msg.payload), true);

  assert.equal(mail.length, 1, 'the flow did not end with exactly one email');
  assert.equal(gmailCalls, 2);
  const rows = db.prepare('SELECT * FROM email_send_refs').all() as any[];
  assert.equal(rows.length, 1, 'the retry did not carry the same reference');
  assert.deepEqual([rows[0].ref, rows[0].state, rows[0].tries], [ref, 'timed_out', 2]);
  const log = db.prepare('SELECT status FROM email_send_log').all() as any[];
  assert.deepEqual(log.map((r) => r.status), ['timed_out']);
  assertNoLink(db, token);
});

test('sign-in: the email goes to the address the token row names, whatever the queued payload says', async () => {
  // Mutation checked: deliverWithReference calling provider(payload.to) — i.e. trusting the caller's address — fails.
  const db = freshDb(); const { env, queue } = signInEnv(db);
  assert.equal(await start(env, 'owner@example.test'), 202);
  const payload = { ...queue[0].payload, to: 'someone.else@example.test' };
  assert.ok(await deliverNow(env, payload));
  assert.deepEqual(mail.map((m) => m.to), ['owner@example.test']);
});

test('sign-in: no usable link reaches a log line or a row, on success or on failure', async () => {
  // Mutation checked: `console.log('[AUTH:magic-start] link', magicUrl)` in /magic/start fails this.
  const db = freshDb(); const { env, queue } = signInEnv(db);
  assert.equal(await start(env, 'quiet@example.test'), 202);
  const token = tokenOf(magicUrlOf(queue[0]));
  plan = ['refuse', 'accept'];
  await deliverNow(env, queue[0].payload);
  await deliverNow(env, queue[0].payload);
  // And with no queue binding (the inline path) and no mailer (the refusal path).
  const inline = signInEnv(db); delete inline.env.JOB_QUEUE; delete inline.env.GMAIL_REFRESH_TOKEN;
  assert.equal(await start(inline.env, 'quiet2@example.test', '203.0.113.77'), 502);
  assert.equal(mail.length, 1);
  assertNoLink(db, token);
  for (const row of db.prepare('SELECT token_hash FROM magic_link_tokens').all() as any[]) {
    assert.ok(!logs.some((l) => l.includes(row.token_hash)), 'a token hash reached a log line');
  }
  assert.ok(!logs.some((l) => /magic\/verify\?token=/.test(l)), 'a verify link reached a log line');
});

// =====================================================================
// Invitations: POST /company/:uid/invitations, resend, accept
// =====================================================================
const OWNER = 801, INVITEE = 802;
function companyDb() {
  const db = freshDb();
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
  u.run(OWNER, 'founder', 'Owner Person', 'owner@example.test');
  u.run(INVITEE, 'founder', 'Invitee Person', 'invitee@example.test');
  db.prepare("INSERT INTO company_profiles (id, uid, company_name, created_at, updated_at) VALUES (1, 'co-8536', 'Halyard', '2026-01-01', '2026-01-01')").run();
  db.prepare("INSERT INTO user_company_links (uid, company_id, user_id, role_in_company, is_primary_admin, created_at) VALUES ('l-1', 1, ?, 'Owner', 1, '2026-01-01')").run(OWNER);
  return db;
}
async function co(db: DatabaseSync, who: number, method: string, path: string, body?: unknown, base = 'https://axal.vc') {
  const jwt = await new SignJWT({ user_id: who, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await company.request(path, {
    method, headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db), PUBLIC_BASE_URL: base, ...GMAIL } as any);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}
const inviteTokenOf = (text: string) => decodeURIComponent(/\/company\/invitations\/accept\?token=([A-Za-z0-9._~%-]+)/.exec(text)?.[1] || '');

test('invitation: the link carries the host of the environment it was sent from', async () => {
  // Mutation checked: issueInvitationEmail building the link on a fixed 'https://axal.vc' fails the preview host.
  for (const host of ['https://preview-8536.example.test', 'https://axal.vc']) {
    const db = companyDb();
    const r = await co(db, OWNER, 'POST', '/company/co-8536/invitations', { email: 'invitee@example.test' }, host);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.email_sent, true);
    assert.equal(mail.length, 1);
    assert.ok(mail[0].text.includes(`${host}/company/invitations/accept?token=`), 'the invitation carries another host');
    mail = [];
  }
});

test('invitation: an expired link is refused, and a replacement link makes the old one invalid', async () => {
  // Mutation checked: the resend keeping the old token_hash lets the first link accept.
  const db = companyDb();
  await co(db, OWNER, 'POST', '/company/co-8536/invitations', { email: 'invitee@example.test' });
  const first = inviteTokenOf(mail[0].text);
  const uid = (db.prepare('SELECT uid FROM company_invitations').get() as any).uid;
  const re = await co(db, OWNER, 'POST', `/company/co-8536/invitations/${uid}/resend`);
  assert.equal(re.status, 200, JSON.stringify(re.body));
  assert.equal(mail.length, 2, 'the resend did not mail a replacement');
  const second = inviteTokenOf(mail[1].text);
  assert.notEqual(first, second);
  // Two issuances, two references.
  assert.equal((db.prepare('SELECT COUNT(*) n FROM email_send_refs').get() as any).n, 2);

  const old = await co(db, INVITEE, 'POST', '/company/invitations/accept', { token: first });
  assert.equal(old.status, 404, 'the replaced link still accepts');
  db.prepare("UPDATE company_invitations SET expires_at = datetime('now', '-1 minute')").run();
  const expired = await co(db, INVITEE, 'POST', '/company/invitations/accept', { token: second });
  assert.deepEqual([expired.status, expired.body.code], [410, 'expired']);
});

test('invitation: a refused send, then one that times out after acceptance, ends with one email under one reference', async () => {
  // Mutation checked: deliverWithReference not reading the ledger (always claiming) sends again on the retry below.
  const db = companyDb();
  plan = ['refuse', 'accept_then_timeout'];
  const r = await co(db, OWNER, 'POST', '/company/co-8536/invitations', { email: 'invitee@example.test' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.email_sent, false, 'a send whose answer never came is reported as sent');
  assert.equal(mail.length, 1);
  const inv = db.prepare('SELECT id, token_hash FROM company_invitations').get() as any;
  const ref = { flow: 'invitation' as const, subject: { kind: 'company_invitation' as const, id: Number(inv.id) }, attempt: String(inv.token_hash).slice(0, 16) };
  const rows = db.prepare('SELECT * FROM email_send_refs').all() as any[];
  assert.deepEqual(rows.map((x) => [x.ref, x.state, x.tries]), [[refKey(ref), 'timed_out', 2]]);

  // A retry of the same issuance reconciles: same reference, no second email.
  const token = inviteTokenOf(mail[0].text);
  const again = await sendCompanyInvitationEmailBound({ DB: d1Over(db), ...GMAIL } as any, ref, {
    companyName: 'Halyard', inviterName: 'Owner Person', link: `https://axal.vc/company/invitations/accept?token=${token}`,
  });
  assert.deepEqual([again.ref, again.state, again.reconciled], [refKey(ref), 'timed_out', true]);
  assert.equal(mail.length, 1, 'the flow did not end with exactly one email');
  assert.equal(gmailCalls, 2);
});

test('invitation: the email goes to the address the invitation row names, and a revoked one is not sent', async () => {
  // Mutation checked: dropping `AND status = 'pending'` from the company_invitation resolver mails the revoked invitation.
  const db = companyDb();
  await co(db, OWNER, 'POST', '/company/co-8536/invitations', { email: 'Invitee@Example.test' });
  assert.deepEqual(mail.map((m) => m.to), ['invitee@example.test']);
  const inv = db.prepare('SELECT id FROM company_invitations').get() as any;
  db.prepare("UPDATE company_invitations SET status = 'revoked'").run();
  const r = await sendCompanyInvitationEmailBound({ DB: d1Over(db), ...GMAIL } as any,
    { flow: 'invitation', subject: { kind: 'company_invitation', id: Number(inv.id) }, attempt: 'revoked-check' },
    { companyName: 'Halyard', inviterName: 'Owner', link: 'https://axal.vc/company/invitations/accept?token=x' });
  assert.deepEqual([r.state, r.reason], ['refused', 'no_recipient']);
  assert.equal(mail.length, 1);
});

test('invitation: no usable link reaches a log line or a row, on success or on failure', async () => {
  // Mutation checked: `console.warn('[company] link', link)` in issueInvitationEmail fails this.
  const db = companyDb();
  plan = ['refuse', 'refuse'];
  const r = await co(db, OWNER, 'POST', '/company/co-8536/invitations', { email: 'invitee@example.test' });
  assert.equal(r.body.email_sent, false);
  const uid = (db.prepare('SELECT uid FROM company_invitations').get() as any).uid;
  const re = await co(db, OWNER, 'POST', `/company/co-8536/invitations/${uid}/resend`);
  assert.equal(re.body.email_sent, true);
  const tokens = [decodeURIComponent(String(r.body.accept_path).split('token=')[1]), inviteTokenOf(mail[0].text)];
  for (const t of tokens) assertNoLink(db, t);
  assert.ok(!logs.some((l) => /invitations\/accept\?token=/.test(l)), 'an accept link reached a log line');
});

// =====================================================================
// The contract itself
// =====================================================================
test('contract: a reference names its flow, subject and attempt, and a subject cannot be sent under another flow', () => {
  // Mutation checked: removing the flow check, or the id/attempt character check, fails this.
  assert.equal(refKey({ flow: 'sign_in', subject: { kind: 'magic_link_token', id: 7 }, attempt: 1 }), 'sign_in:magic_link_token:7:1');
  assert.throws(() => refKey({ flow: 'billing', subject: { kind: 'magic_link_token', id: 7 }, attempt: 1 }), /belongs to sign_in/);
  assert.throws(() => refKey({ flow: 'sign_in', subject: { kind: 'magic_link_token', id: '7:x' }, attempt: 1 }), /malformed/);
});

test('contract: accepted is final — a second call with the same reference is answered from the ledger', async () => {
  // Mutation checked: claiming an `accepted` row again calls the provider twice.
  const db = freshDb();
  db.prepare("INSERT INTO magic_link_tokens (id, email, token_hash, expires_at) VALUES (5, 'a@example.test', 'h', datetime('now', '+1 hour'))").run();
  const env: any = { DB: d1Over(db) };
  const ref = { flow: 'sign_in' as const, subject: { kind: 'magic_link_token' as const, id: 5 }, attempt: 1 };
  let calls = 0;
  const provider = async () => { calls++; return { state: 'accepted' as const, providerId: 'p1', reason: null }; };
  const a = await deliverWithReference(env, ref, provider);
  const b = await deliverWithReference(env, ref, provider);
  assert.deepEqual([a.state, a.reconciled, b.state, b.reconciled, calls], ['accepted', false, 'accepted', true, 1]);
  assert.equal((db.prepare('SELECT provider_message_id FROM email_send_refs').get() as any).provider_message_id, 'p1');
});
