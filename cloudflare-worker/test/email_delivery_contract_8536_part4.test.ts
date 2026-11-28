/**
 * D8536 (#8536) part 4 — the owner's answers of 2026-11-27, over the migrated
 * schema with Gmail stubbed at fetch. No real email is sent.
 *
 *   1B: a recovery notice reaches the account holder once, by its referenced
 *       templated send; notify() no longer mails a second, unreferenced copy.
 *   2A: the claim email at the end of a trusted-contact or admin-cosign
 *       recovery carries the claim link in its body (`auth_recovery_claim`),
 *       and no bell row holds it.
 *
 * For the claim emails, as the issue asks of every critical flow:
 *   - the link uses the host of the environment it was sent from;
 *   - an expired link is refused, and a replacement link makes the old one invalid;
 *   - refused, then timed out after accepting: one email under one reference;
 *   - the recipient is the ticket's account holder;
 *   - no usable link appears in a captured log line or a stored row.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/email_delivery_contract_8536_part4.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { format } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import recover from '../src/routes/auth_recover.ts';
import { sendBound } from '../src/services/email/send.ts';
import { getTemplate } from '../src/templates/email/registry.ts';
import { refKey, type SendReference } from '../src/services/email/deliveryContract.ts';
import { d1Over } from './_d1_sqlite.mjs';
import { loadSchema } from './_schema_once.mjs';

// ---------- Gmail, stubbed at fetch ----------
type Step = 'accept' | 'refuse' | 'accept_then_timeout';
let plan: Step[] = [];
let mail: { to: string; subject: string; text: string }[] = [];
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
    const enc = /^Subject: =\?UTF-8\?B\?(.*)\?=\r?$/m.exec(raw)?.[1];
    const subject = enc ? Buffer.from(enc, 'base64').toString('utf8') : (/^Subject: (.*)$/m.exec(raw)?.[1] ?? '').trim();
    // Some MIME builders write the body as quoted-printable or plain; keep the raw text too.
    mail.push({ to: (/^To: (.*)$/m.exec(raw)?.[1] ?? '').trim(), subject, text: parts.join('\n') + '\n' + raw });
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
const JWT_SECRET = 'unit-test-jwt-secret-8536-part4-0123456789';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
}
const USER = 901, OTHER = 902;
function freshDb() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  loadSchema(db);
  const u = db.prepare('INSERT INTO users (id, role, name, email, is_active, email_verified) VALUES (?, ?, ?, ?, 1, 1)');
  u.run(USER, 'founder', 'Robin Holder', 'holder@example.test');
  u.run(OTHER, 'founder', 'Other Person', 'other@example.test');
  return db;
}
/** No JOB_QUEUE: `send()` delivers in the request, so the contract runs end to end. */
const envOf = (db: DatabaseSync, appUrl = 'https://axal.vc') =>
  ({ APP_URL: appUrl, PUBLIC_BASE_URL: appUrl, ENVIRONMENT: 'development', JWT_SECRET, DB: d1Over(db), RATE_LIMITS: kv(), ...GMAIL } as any);
const refs = (db: DatabaseSync) => db.prepare('SELECT ref, state, tries FROM email_send_refs ORDER BY ref').all() as any[];
const STORED = ['email_send_log', 'email_send_refs', 'activity_logs', 'notifications_inbox', 'auth_recovery_tickets', 'users', 'email_change_requests', 'security_events'];
function assertNoLink(db: DatabaseSync, secret: string) {
  assert.ok(secret.length >= 20, 'no secret to look for');
  assert.deepEqual(logs.filter((l) => l.includes(secret)), [], 'a usable link reached a log line');
  for (const t of STORED) {
    let rows: unknown[] = [];
    try { rows = db.prepare(`SELECT * FROM ${t}`).all(); } catch { continue; }
    assert.ok(!JSON.stringify(rows).includes(secret), `a usable link was stored in ${t}`);
  }
}
/**
 * Refused, then accepted-but-timed-out: the retry carries the same reference
 * and the flow ends with one email. A direct bound sender tries a refused send
 * twice in one call; a registry template through `sendBound` tries once.
 */
async function refusedThenTimedOut(db: DatabaseSync, send: () => Promise<{ state: string }>, ref: string, to: string, triesPerCall = 2) {
  plan = [...Array(triesPerCall).fill('refuse'), 'accept_then_timeout'];
  const first = await send();
  assert.equal(first.state, 'refused');
  assert.equal(mail.length, 0, 'a refused send left');
  const second = await send();
  assert.equal(second.state, 'timed_out');
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, to);
  const third = await send();
  assert.equal(third.state, 'timed_out', 'a timed-out send was answered as something else');
  assert.equal(mail.length, 1, 'a timed-out send was mailed again under the same reference');
  const rows = refs(db).filter((r) => r.ref === ref);
  assert.equal(rows.length, 1, 'the retry did not carry the same reference');
  assert.equal(rows[0].state, 'timed_out');
}

// =====================================================================
// Sign-in: the account-recovery email link
// =====================================================================
async function recoverStart(env: any, email = 'holder@example.test') {
  const res = await recover.request('/email/start', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ email }),
  }, env);
  return res.status;
}
const recoveryLinkOf = (text: string) => {
  const m = /https?:\/\/[^\s"<>]+\/auth\/recover\/email\?token=([A-Za-z0-9_-]+)&(?:amp;)?ticket=(\d+)/.exec(text);
  return m ? { url: m[0], token: m[1], ticket: Number(m[2]) } : null;
};
async function recoverVerify(env: any, token: string, ticket: number) {
  const res = await recover.request(`/email/verify?token=${token}&ticket=${ticket}`, { headers: { 'cf-connecting-ip': '203.0.113.50' } }, env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}
const linkMail = () => mail.filter((m) => recoveryLinkOf(m.text));

const HOLDER = 'holder@example.test';
const holderMail = () => mail.filter((m) => m.to === HOLDER);
const claimLinkOf = (text: string) => {
  const m = /https?:\/\/([^/\s"<>]+)\/auth\/recover\/email\?token=([A-Za-z0-9_-]+)&(?:amp;)?ticket=(\d+)&(?:amp;)?(trusted|admin)=1/.exec(text);
  return m ? { host: m[1], token: m[2], ticket: Number(m[3]), via: m[4] } : null;
};
const claimMail = () => holderMail().filter((m) => /Finish recovering/.test(m.subject));
async function claim(env: any, token: string, ticket: number) {
  const res = await recover.request('/claim', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.60' }, body: JSON.stringify({ token, ticket_id: ticket }),
  }, env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}
const sign = (claims: Record<string, unknown>) => new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
  .sign(new TextEncoder().encode(JWT_SECRET));

// ---------- the admin-cosign recovery ----------
const ADMINS = [5, 6, 7];
function adminTicket(db: DatabaseSync, id = 300) {
  const a = db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'admin', ?, ?, 1)");
  for (const n of ADMINS) a.run(n, `Admin ${n}`, `admin-${n}@example.test`);
  db.prepare("INSERT INTO auth_recovery_tickets (id, user_id, layer, status, state_json) VALUES (?, ?, 'admin_manual', 'awaiting_admin', '{}')").run(id, USER);
  return id;
}
async function cosign(env: any, admin: number, ticket: number) {
  const jwt = await sign({ user_id: admin, role: 'admin' });
  const res = await recover.request('/admin/cosign', {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ ticket_id: ticket }),
  }, env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

// ---------- the trusted-contact recovery ----------
const CONTACTS = [{ id: 921, email: 'ally-one@example.test' }, { id: 922, email: 'ally-two@example.test' }, { id: 923, email: 'ally-three@example.test' }];
function contactTicket(db: DatabaseSync, id = 400) {
  const u = db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (?, 'founder', ?, ?, 1)");
  const s = db.prepare("INSERT INTO user_sessions (user_id, jti, factor) VALUES (?, ?, 'totp')");
  for (const c of CONTACTS) { u.run(c.id, `Ally ${c.id}`, c.email); s.run(c.id, `jti-${c.id}`); }
  const state = { contacts: CONTACTS.map((c) => ({ user_id: c.id, email: c.email })), attestations: [] };
  db.prepare("INSERT INTO auth_recovery_tickets (id, user_id, layer, status, state_json) VALUES (?, ?, 'trusted_contact', 'awaiting_contacts', ?)").run(id, USER, JSON.stringify(state));
  return id;
}
async function attest(env: any, contact: number, ticket: number) {
  const jwt = await sign({ user_id: contact, role: 'founder', jti: `jti-${contact}` });
  const res = await recover.request('/trusted-contact/attest', {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ ticket_id: ticket }),
  }, env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

// =====================================================================
// 1B: one email per recovery notice
// =====================================================================
test('1B: each recovery notice reaches the account holder once, by its referenced send', async () => {
  // Mutation checked: putting 'email' back into notifyAllChannels' notify() channels mails each notice twice.
  const db = freshDb(); const env = envOf(db);
  assert.equal(await recoverStart(env), 200);
  const link = recoveryLinkOf(linkMail()[0].text)!;
  assert.equal((await recoverVerify(env, link.token, link.ticket)).status, 200);
  const notices = holderMail().filter((m) => !recoveryLinkOf(m.text));
  assert.deepEqual(notices.map((m) => m.subject).sort(), ['Account recovery resolved — Axal', 'Account recovery started — Axal'],
    `the holder got ${notices.length} notice emails: ${notices.map((m) => m.subject).join(' | ')}`);
  // notify()'s own in-app row (its title, not the template's) stays: only its email went.
  const bell = db.prepare("SELECT title FROM notifications_inbox WHERE user_id = ?").all(USER) as any[];
  assert.ok(bell.some((r) => r.title === 'Axal account recovery completed'), 'the in-app notice was dropped with the email');
});

// =====================================================================
// 2A: the admin-cosign claim email
// =====================================================================
test('2A: the claim template carries the link in both its text and its HTML part', () => {
  const t = getTemplate('auth_recovery_claim')!;
  assert.ok(t, 'no auth_recovery_claim template');
  assert.match(t.text, /\{\{claim_url\}\}/, 'a plain-text reader gets no link');
  assert.match(t.html, /href="\{\{\{claim_url\}\}\}"/, 'the HTML part has no link');
  assert.equal(t.category, 'security');
  assert.equal(t.alwaysSend, true);
});

test('2A admin: the second co-signature mails the account holder a working claim link on this host', async () => {
  // Mutation checked: sending auth_recovery_resolved (no claim_url) leaves no link in the email.
  const db = freshDb(); const env = envOf(db, 'https://preview-8536.example.test');
  const ticket = adminTicket(db);
  assert.equal((await cosign(env, 5, ticket)).status, 200);
  assert.equal(claimMail().length, 0, 'one co-signature mailed a claim link');
  const done = await cosign(env, 6, ticket);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const sent = claimMail();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, HOLDER);
  const link = claimLinkOf(sent[0].text);
  assert.ok(link, 'the claim email carries no claim link');
  assert.equal(link!.host, 'preview-8536.example.test');
  assert.equal(link!.ticket, ticket);
  assert.equal(link!.via, 'admin');
  assert.ok(refs(db).some((r) => r.ref === `alert:recovery_notice:${ticket}:claim.admin.2` && r.state === 'accepted'));
  const used = await claim(env, link!.token, ticket);
  assert.equal(used.status, 200, JSON.stringify(used.body));
});

test('2A admin: an expired link is refused, and a third co-signature mails a replacement that voids the earlier link', async () => {
  // Mutation checked: a fixed attempt ('claim.admin') answers the replacement from the ledger, so no email carries the live link.
  const db = freshDb(); const env = envOf(db);
  const ticket = adminTicket(db);
  await cosign(env, 5, ticket); await cosign(env, 6, ticket);
  const first = claimLinkOf(claimMail()[0].text)!;
  const state = JSON.parse((db.prepare('SELECT state_json FROM auth_recovery_tickets WHERE id = ?').get(ticket) as any).state_json);
  db.prepare('UPDATE auth_recovery_tickets SET state_json = ? WHERE id = ?').run(JSON.stringify({ ...state, claim_expires_at: '2000-01-01T00:00:00Z' }), ticket);
  assert.deepEqual((await claim(env, first.token, ticket)).body, { error: 'expired' });
  assert.equal((await cosign(env, 7, ticket)).status, 200);
  const sent = claimMail();
  assert.equal(sent.length, 2, 'the replacement link was not mailed');
  const second = claimLinkOf(sent[1].text)!;
  assert.notEqual(second.token, first.token);
  assert.deepEqual((await claim(env, first.token, ticket)).body, { error: 'invalid_or_used' });
  assert.equal((await claim(env, second.token, ticket)).status, 200);
});

test('2A admin: refused, then timed out after accepting, is one email under one reference', async () => {
  const db = freshDb(); const env = envOf(db);
  const ticket = adminTicket(db);
  const ref: SendReference = { flow: 'alert', subject: { kind: 'recovery_notice', id: ticket }, attempt: 'claim.admin.2' };
  await refusedThenTimedOut(db, async () => sendBound(env, 'auth_recovery_claim', ref,
    { name: 'Robin', ticket_id: String(ticket), claim_url: 'https://axal.vc/auth/recover/email?token=x&ticket=1&admin=1', expires_minutes: '15' },
    { userId: OTHER, skipMirror: true }), refKey(ref), HOLDER, 1);
});

test('2A admin: no claim link reaches a log line or a row, and no bell row is written for it', async () => {
  // Mutation checked: passing ctaUrl (or dropping skipMirror) stores the link in notifications_inbox.
  const db = freshDb(); const env = envOf(db);
  const ticket = adminTicket(db);
  await cosign(env, 5, ticket); await cosign(env, 6, ticket);
  const link = claimLinkOf(claimMail()[0].text)!;
  assertNoLink(db, link.token);
  const bell = db.prepare("SELECT 1 FROM notifications_inbox WHERE template_key = 'auth_recovery_claim'").all();
  assert.equal(bell.length, 0);
});

// =====================================================================
// 2A: the trusted-contact claim email
// =====================================================================
test('2A trusted contact: the second attestation mails the account holder, not a contact, a working claim link', async () => {
  // Mutation checked: sending auth_recovery_resolved (no claim_url) leaves no link in the email.
  const db = freshDb(); const env = envOf(db, 'https://preview-8536.example.test');
  const ticket = contactTicket(db);
  const one = await attest(env, 921, ticket);
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(claimMail().length, 0);
  const two = await attest(env, 922, ticket);
  assert.equal(two.status, 200, JSON.stringify(two.body));
  const sent = claimMail();
  assert.equal(sent.length, 1);
  assert.deepEqual(mail.filter((m) => /Finish recovering/.test(m.subject)).map((m) => m.to), [HOLDER], 'a contact received the claim link');
  const link = claimLinkOf(sent[0].text)!;
  assert.ok(link, 'the claim email carries no claim link');
  assert.equal(link.host, 'preview-8536.example.test');
  assert.equal(link.via, 'trusted');
  assert.ok(refs(db).some((r) => r.ref === `alert:recovery_notice:${ticket}:claim.trusted.2` && r.state === 'accepted'));
  assertNoLink(db, link.token);
  assert.equal((await claim(env, link.token, ticket)).status, 200);
});

test('2A trusted contact: a third attestation is refused, so the link already mailed stays the only one', async () => {
  // After two attestations the ticket moves on (awaiting_admin), so this flow never replaces its link.
  const db = freshDb(); const env = envOf(db);
  const ticket = contactTicket(db);
  await attest(env, 921, ticket); await attest(env, 922, ticket);
  const first = claimLinkOf(claimMail()[0].text)!;
  const three = await attest(env, 923, ticket);
  assert.deepEqual([three.status, three.body.error], [400, 'ticket_not_open']);
  assert.equal(claimMail().length, 1, 'a refused attestation mailed another link');
  assert.equal((await claim(env, first.token, ticket)).status, 200);
});
