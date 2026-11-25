/**
 * D8536 (#8536) part 3 — the rest of sign-in, invitations and the alerts under
 * the delivery contract, over the migrated schema with Gmail stubbed at fetch.
 * No real email is sent. Part 1 is `email_delivery_contract_8536.test.ts`,
 * part 2 is `email_delivery_contract_8536_part2.test.ts`.
 *
 * For each flow moved here:
 *   - sign-in: the account-recovery email link (`/auth/recover/email/start`),
 *     the email-verification link (`resendVerification`, `GET /verify-email`),
 *     the email change (`POST /settings/email-change/request`);
 *   - invitations: co-founder, HQ move (`branch_invitation`), partner;
 *   - alerts: the recovery notices and trusted-contact invites, the
 *     authenticator-added alert, the compliance notice;
 * it checks, where the flow carries a link of ours:
 *   - the link uses the host of the environment it was sent from;
 *   - an expired link is refused, and a replacement link makes the old one invalid;
 * and for every flow:
 *   - the provider refuses, then times out after accepting: the retry carries
 *     the same reference and the flow ends with one email;
 *   - the recipient is the address the subject record names;
 *   - no usable link appears in a captured log line or a stored row.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/email_delivery_contract_8536_part3.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { format } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import recover from '../src/routes/auth_recover.ts';
import auth from '../src/routes/auth.ts';
import settings from '../src/routes/settings.ts';
import { resendVerification } from '../src/services/verificationResend.ts';
import {
  sendVerificationEmailBound, sendPartnerInvitationEmailBound, partnerInvitationRef, sendCompanyInvitationEmailBound,
} from '../src/services/email.ts';
import { sendBound } from '../src/services/email/send.ts';
import { refKey, recipientOf, issuanceOf, type SendReference } from '../src/services/email/deliveryContract.ts';
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
const JWT_SECRET = 'unit-test-jwt-secret-8536-part3-0123456789';

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

test('recovery link: the link carries the host of the environment it was sent from', async () => {
  // Mutation checked: building magicUrl on a fixed 'https://axal.vc' fails the preview host.
  for (const host of ['https://preview-8536.example.test', 'https://axal.vc']) {
    mail = [];
    const db = freshDb();
    assert.equal(await recoverStart(envOf(db, host)), 200);
    const l = linkMail();
    assert.equal(l.length, 1, 'one recovery link');
    assert.ok(l[0].text.includes(`${host}/auth/recover/email?token=`), 'the link carries another host');
  }
});

test('recovery link: an expired link is refused, and a replacement link makes the old one invalid', async () => {
  // Mutation checked: dropping the retire UPDATE lets the first link verify; dropping `t.status = 'open'` from recovery_link gives it a recipient.
  const db = freshDb(); const env = envOf(db);
  assert.equal(await recoverStart(env), 200);
  const first = recoveryLinkOf(linkMail()[0].text)!;
  mail = [];
  assert.equal(await recoverStart(env), 200);
  const second = recoveryLinkOf(linkMail()[0].text)!;
  assert.notEqual(first.ticket, second.ticket);
  assert.equal((await recoverVerify(env, first.token, first.ticket)).body.error, 'invalid_or_used', 'the replaced link still works');
  assert.equal(await recipientOf(env, { flow: 'sign_in', subject: { kind: 'recovery_link', id: first.ticket }, attempt: 1 }), null,
    'a retired link still has a recipient');
  // Expiry: the second ticket's link, lapsed.
  const t = db.prepare('SELECT state_json FROM auth_recovery_tickets WHERE id = ?').get(second.ticket) as any;
  db.prepare('UPDATE auth_recovery_tickets SET state_json = ? WHERE id = ?')
    .run(JSON.stringify({ ...JSON.parse(t.state_json), expires_at: '2000-01-01T00:00:00Z' }), second.ticket);
  assert.equal((await recoverVerify(env, second.token, second.ticket)).body.error, 'expired');
});

test('recovery link: a refused send keeps the earlier link, and refused-then-timed-out ends with one email under one reference', async () => {
  // Mutation checked: retiring earlier links before (or regardless of) the send's answer kills the first link here.
  const db = freshDb(); const env = envOf(db);
  assert.equal(await recoverStart(env), 200);
  const first = recoveryLinkOf(linkMail()[0].text)!;
  mail = [];
  // The second start's link send is refused (both in-call tries): the first link stays usable.
  plan = ['refuse'];
  assert.equal(await recoverStart(env), 200);
  assert.equal(linkMail().length, 0);
  assert.equal((db.prepare('SELECT status FROM auth_recovery_tickets WHERE id = ?').get(first.ticket) as any).status, 'open',
    'a refused replacement retired the link the person already has');
  // Under the contract directly: the reference of the newest ticket.
  const ticket = Number((db.prepare("SELECT max(id) AS id FROM auth_recovery_tickets").get() as any).id);
  const ref: SendReference = { flow: 'sign_in', subject: { kind: 'recovery_link', id: ticket }, attempt: 1 };
  mail = []; logs = [];
  db.prepare("DELETE FROM email_send_refs WHERE ref = ?").run(refKey(ref));
  await refusedThenTimedOut(db, async () => sendBound(env, 'auth_magic_link', ref, { name: 'Robin', magic_url: 'https://axal.vc/auth/recover/email?token=x' }, { userId: USER, skipMirror: true }),
    refKey(ref), 'holder@example.test', 1);
});

test('recovery link: the address is the ticket account\'s, and no link reaches a log line or a row', async () => {
  // Mutation checked: mirroring the link into the bell (no skipMirror) stores it in notifications_inbox.
  const db = freshDb(); const env = envOf(db);
  assert.equal(await recoverStart(env), 200);
  const l = linkMail();
  assert.equal(l[0].to, 'holder@example.test');
  const link = recoveryLinkOf(l[0].text)!;
  assertNoLink(db, link.token);
  assert.ok(refs(db).some((r) => r.ref === `sign_in:recovery_link:${link.ticket}:1` && r.state === 'accepted'));
});

// =====================================================================
// Alerts: the recovery notices and the trusted-contact invites
// =====================================================================
test('recovery notices: each step of a ticket is its own send, and a retry of a step reconciles', async () => {
  // Mutation checked: an attempt without the step (one reference per ticket) drops the resolved notice.
  const db = freshDb(); const env = envOf(db);
  assert.equal(await recoverStart(env), 200);
  const link = recoveryLinkOf(linkMail()[0].text)!;
  const v = await recoverVerify(env, link.token, link.ticket);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const notices = refs(db).filter((r) => r.ref.startsWith(`alert:recovery_notice:${link.ticket}:`)).map((r) => [r.ref.split(':')[3], r.state]);
  assert.deepEqual(notices.sort(), [['resolved.resolved', 'accepted'], ['started.open', 'accepted']]);
  const started = mail.filter((m) => /recovery started/i.test(m.subject));
  const resolved = mail.filter((m) => /recovery resolved/i.test(m.subject));
  assert.equal(started.length, 1); assert.equal(resolved.length, 1);
  assert.equal(started[0].to, 'holder@example.test');
  // The same step again is answered from the ledger.
  mail = [];
  const ref: SendReference = { flow: 'alert', subject: { kind: 'recovery_notice', id: link.ticket }, attempt: 'started.open' };
  const again = await sendBound(env, 'auth_recovery_started', ref, { name: 'Robin', ticket_id: String(link.ticket) }, { userId: USER });
  assert.equal(again.reason, 'reconciled');
  assert.equal(mail.length, 0, 'a settled step was mailed again');
});

test('recovery notices: refused, then timed out after accepting, is one email under one reference', async () => {
  const db = freshDb(); const env = envOf(db);
  db.prepare("INSERT INTO auth_recovery_tickets (id, user_id, layer, status, state_json) VALUES (77, ?, 'sms', 'open', '{}')").run(USER);
  const ref: SendReference = { flow: 'alert', subject: { kind: 'recovery_notice', id: 77 }, attempt: 'started.open' };
  // Mutation checked: claiming a timed_out row in deliverWithReference mails it a third time.
  await refusedThenTimedOut(db, async () => sendBound(env, 'auth_recovery_started', ref, { name: 'Robin', ticket_id: '77' }, { userId: OTHER }),
    refKey(ref), 'holder@example.test', 1);
});

test('trusted contacts: each active contact is invited once per ticket, at the address its contact row names', async () => {
  // Mutation checked: dropping `status = 'active'` from recovery_contact mails the removed contact.
  const db = freshDb(); const env = envOf(db);
  const c = db.prepare('INSERT INTO auth_trusted_contacts (id, user_id, contact_email, status) VALUES (?, ?, ?, ?)');
  c.run(11, USER, 'ally-one@example.test', 'active');
  c.run(12, USER, 'ally-two@example.test', 'active');
  const res = await recover.request('/trusted-contact/start', {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ email: 'holder@example.test' }),
  }, env);
  assert.equal(res.status, 200);
  const ticket = Number((db.prepare('SELECT max(id) AS id FROM auth_recovery_tickets').get() as any).id);
  const invites = refs(db).filter((r) => r.ref.startsWith('alert:recovery_contact:'));
  assert.deepEqual(invites.map((r) => r.ref).sort(), [`alert:recovery_contact:11:t${ticket}`, `alert:recovery_contact:12:t${ticket}`]);
  assert.deepEqual(mail.filter((m) => m.to.startsWith('ally-')).map((m) => m.to).sort(), ['ally-one@example.test', 'ally-two@example.test']);
  db.prepare("UPDATE auth_trusted_contacts SET status = 'removed' WHERE id = 12").run();
  const gone = await sendBound(env, 'auth_recovery_started', { flow: 'alert', subject: { kind: 'recovery_contact', id: 12 }, attempt: 't999' }, { name: 'x', ticket_id: '999' });
  assert.equal(gone.reason, 'no_recipient');
});

// =====================================================================
// Sign-in: the email-verification link
// =====================================================================
const ADMIN = { id: 1, email: 'admin@example.test', name: 'Ada' };
const TARGET = { id: USER, email: 'someone-else@example.test', name: 'Robin' };
const verifyTokenOf = (text: string) => /\/verify-email\?token=([0-9a-f]{64})/.exec(text)?.[1] || '';
async function verifyEmail(env: any, token: string) {
  const res = await auth.request(`/verify-email?token=${token}`, { headers: { 'cf-connecting-ip': '203.0.113.77' } }, env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

test('verification: the link carries the host, goes to the account\'s own address, and leaves no token behind', async () => {
  // Mutation checked: resendVerification sending to target.email (the caller's copy) instead of the account row.
  for (const host of ['https://preview-8536.example.test', 'https://axal.vc']) {
    mail = []; logs = [];
    const db = freshDb(); const env = envOf(db, host);
    const r = await resendVerification(env, ADMIN, TARGET);
    assert.equal(r.emailed, true);
    assert.equal(mail.length, 1);
    assert.equal(mail[0].to, 'holder@example.test', 'the passed address was trusted over the account row');
    assert.ok(mail[0].text.includes(`${host}/verify-email?token=`), 'the link carries another host');
    assertNoLink(db, verifyTokenOf(mail[0].text));
  }
});

test('verification: an expired link is refused, and a replacement link makes the old one invalid', async () => {
  // Mutation checked: an attempt that ignores the token (a constant) answers the second resend from the ledger, and no second link leaves.
  const db = freshDb(); const env = envOf(db);
  await resendVerification(env, ADMIN, TARGET);
  const first = verifyTokenOf(mail[0].text);
  await resendVerification(env, ADMIN, TARGET);
  assert.equal(mail.length, 2, 'the replacement link did not leave');
  const second = verifyTokenOf(mail[1].text);
  assert.notEqual(first, second);
  assert.equal((await verifyEmail(env, first)).status, 400, 'the replaced link still verifies');
  assert.equal((await verifyEmail(env, second)).status, 200);
  db.prepare("UPDATE users SET verification_token_expires = '2000-01-01T00:00:00Z' WHERE id = ?").run(USER);
  assert.match((await verifyEmail(env, second)).body.error, /expired/i);
});

test('verification: refused, then timed out after accepting, is one email under one reference', async () => {
  const db = freshDb(); const env = envOf(db);
  db.prepare("UPDATE users SET verification_token = 'hash-of-tok', verification_token_expires = '2999-01-01' WHERE id = ?").run(USER);
  const ref: SendReference = { flow: 'sign_in', subject: { kind: 'user_verification', id: USER }, attempt: await issuanceOf('tok-8536-verification') };
  await refusedThenTimedOut(db, async () => sendVerificationEmailBound(env, ref, 'Robin', 'https://axal.vc/verify-email?token=tok'), refKey(ref), 'holder@example.test');
});

// =====================================================================
// Sign-in: the email change (confirm to the new address, revoke to the old)
// =====================================================================
async function asUser(db: DatabaseSync, path: string, body: unknown, host = 'https://axal.vc') {
  const jwt = await new SignJWT({ user_id: USER, role: 'founder' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const res = await settings.request(path, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, envOf(db, host));
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

test('email change: each side goes to the address the request row names, on this host, and a newer request voids the old links', async () => {
  // Mutation checked: swapping the two subject kinds sends the confirm link to the old address.
  const host = 'https://preview-8536.example.test';
  const db = freshDb();
  const r = await asUser(db, '/email-change/request', { new_email: 'new-home@example.test' }, host);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.email_sent, true);
  const confirm = mail.find((m) => m.text.includes('/account/email/confirm?token='));
  const revoke = mail.find((m) => m.text.includes('/account/email/revoke?token='));
  assert.equal(confirm?.to, 'new-home@example.test');
  assert.equal(revoke?.to, 'holder@example.test');
  assert.ok(confirm!.text.includes(`${host}/account/email/confirm?token=`), 'the confirm link carries another host');
  const firstId = Number((db.prepare('SELECT max(id) AS id FROM email_change_requests').get() as any).id);
  assert.equal(r.body.confirm_url, undefined, 'a sent link was echoed back');
  const token = /confirm\?token=([A-Za-z0-9_-]{20,})/.exec(confirm!.text)![1];
  assertNoLink(db, token);
  // A newer request revokes this one: its links have no recipient now.
  mail = [];
  assert.equal((await asUser(db, '/email-change/request', { new_email: 'newer@example.test' })).status, 200);
  assert.equal(await recipientOf(envOf(db), { flow: 'sign_in', subject: { kind: 'email_change_confirm', id: firstId }, attempt: 1 }), null);
  const stale = await asUser(db, '/email-change/confirm', { token });
  assert.notEqual(stale.status, 200, 'the replaced confirm link still works');
});

test('email change: refused, then timed out after accepting, is one email under one reference', async () => {
  const db = freshDb(); const env = envOf(db);
  db.prepare(`INSERT INTO email_change_requests (id, user_id, old_email, new_email, confirm_token_hash, revoke_token_hash, confirm_expires_at, revoke_expires_at)
              VALUES (5, ?, 'holder@example.test', 'moving@example.test', 'c-hash', 'r-hash', '2999-01-01', '2999-01-01')`).run(USER);
  const ref: SendReference = { flow: 'sign_in', subject: { kind: 'email_change_confirm', id: 5 }, attempt: 1 };
  await refusedThenTimedOut(db, async () => sendVerificationEmailBound(env, ref, 'Robin', 'https://axal.vc/account/email/confirm?token=x'), refKey(ref), 'moving@example.test');
});

// =====================================================================
// Invitations: co-founder, HQ move, partner
// =====================================================================
test('co-founder invitation: the row names the address, and an accepted or revoked invite has none', async () => {
  // Mutation checked: dropping `revoked_at IS NULL` from founder_invite mails a revoked invitation.
  const db = freshDb(); const env = envOf(db);
  db.prepare(`INSERT INTO founder_invites (id, inviter_user_id, invitee_email, token_hash, expires_at) VALUES (3, ?, 'cofounder@example.test', 'h3', '2999-01-01')`).run(USER);
  const ref: SendReference = { flow: 'invitation', subject: { kind: 'founder_invite', id: 3 }, attempt: 1 };
  await refusedThenTimedOut(db, async () => sendVerificationEmailBound(env, ref, 'Cee', 'https://axal.vc/invites/cofounder?token=x'), refKey(ref), 'cofounder@example.test');
  db.prepare(`INSERT INTO founder_invites (id, inviter_user_id, invitee_email, token_hash, expires_at, revoked_at) VALUES (4, ?, 'gone@example.test', 'h4', '2999-01-01', '2026-01-01')`).run(USER);
  const r = await sendVerificationEmailBound(env, { flow: 'invitation', subject: { kind: 'founder_invite', id: 4 }, attempt: 1 }, 'x', 'https://axal.vc/x');
  assert.equal(r.reason, 'no_recipient');
});

test('HQ move invitation: a pending branch invitation names the address; a re-minted token is a new attempt', async () => {
  // Mutation checked: dropping `status = 'pending'` from branch_invitation mails a revoked invitation.
  const db = freshDb(); const env = envOf(db);
  const b = db.prepare(`INSERT INTO branch_invitations (uid, email, token_hash, status, invited_by_name, expires_at) VALUES (?, ?, ?, ?, 'HQ Op', '2999-01-01')`);
  b.run('inv_aaaaaaaaaaaaaaaaaaaa', 'mover@example.test', 'th-1', 'pending');
  b.run('inv_bbbbbbbbbbbbbbbbbbbb', 'revoked@example.test', 'th-2', 'revoked');
  const content = { companyName: 'Branch', inviterName: 'HQ Op', link: 'https://axal.vc/join/invt_x' };
  const ref = async (uid: string, tok: string): Promise<SendReference> => ({ flow: 'invitation', subject: { kind: 'branch_invitation', id: uid }, attempt: await issuanceOf(tok) });
  const one = await ref('inv_aaaaaaaaaaaaaaaaaaaa', 'invt_first');
  await refusedThenTimedOut(db, async () => sendCompanyInvitationEmailBound(env, one, content), refKey(one), 'mover@example.test');
  mail = [];
  const reminted = await sendCompanyInvitationEmailBound(env, await ref('inv_aaaaaaaaaaaaaaaaaaaa', 'invt_second'), content);
  assert.equal(reminted.state, 'accepted', 'a re-minted token was answered from the earlier attempt');
  assert.equal(mail.length, 1);
  assert.equal((await sendCompanyInvitationEmailBound(env, await ref('inv_bbbbbbbbbbbbbbbbbbbb', 'invt_z'), content)).reason, 'no_recipient');
});

test('partner invitation: the same link, sent and re-sent; each occasion is its own send and a retry within one reconciles', async () => {
  // Mutation checked: partnerInvitationRef ignoring the occasion answers the next hour's resend from the ledger.
  const db = freshDb(); const env = envOf(db);
  db.prepare(`INSERT INTO partner_invitations (id, token, recipient_email, invited_by_user_id, expires_at) VALUES (6, 'ptok-0123456789abcdef', 'partner@example.test', ?, '2999-01-01')`).run(USER);
  const content = { recipientName: 'Pat', adminName: 'Ada', link: 'https://axal.vc/partners/onboard?token=ptok-0123456789abcdef', personalMessage: '' };
  const send = await partnerInvitationRef(6, 'ptok-0123456789abcdef', 'send');
  assert.equal((await sendPartnerInvitationEmailBound(env, send, content)).state, 'accepted');
  const at = new Date('2026-11-25T10:15:00Z');
  const resendA = await partnerInvitationRef(6, 'ptok-0123456789abcdef', 'resend', at);
  assert.equal((await sendPartnerInvitationEmailBound(env, resendA, content)).state, 'accepted');
  const again = await sendPartnerInvitationEmailBound(env, await partnerInvitationRef(6, 'ptok-0123456789abcdef', 'resend', new Date('2026-11-25T10:55:00Z')), content);
  assert.equal(again.reconciled, true, 'a second click within the hour mailed again');
  const nextHour = await sendPartnerInvitationEmailBound(env, await partnerInvitationRef(6, 'ptok-0123456789abcdef', 'resend', new Date('2026-11-25T11:05:00Z')), content);
  assert.equal(nextHour.state, 'accepted');
  assert.equal(mail.length, 3);
  assert.ok(mail.every((m) => m.to === 'partner@example.test'));
  db.prepare("UPDATE partner_invitations SET status = 'revoked' WHERE id = 6").run();
  const revoked = await sendPartnerInvitationEmailBound(env, await partnerInvitationRef(6, 'ptok-0123456789abcdef', 'resend', new Date('2026-11-25T12:05:00Z')), content);
  assert.equal(revoked.reason, 'no_recipient', 'a revoked invitation was mailed');
});

test('partner invitation: refused, then timed out after accepting, is one email under one reference', async () => {
  const db = freshDb(); const env = envOf(db);
  db.prepare(`INSERT INTO partner_invitations (id, token, recipient_email, invited_by_user_id, expires_at) VALUES (7, 'ptok-7', 'partner7@example.test', ?, '2999-01-01')`).run(USER);
  const ref = await partnerInvitationRef(7, 'ptok-7', 'send');
  await refusedThenTimedOut(db, async () => sendPartnerInvitationEmailBound(env, ref, { recipientName: 'P', adminName: 'A', link: 'https://axal.vc/partners/onboard?token=ptok-7', personalMessage: '' }),
    refKey(ref), 'partner7@example.test');
});

// =====================================================================
// Alerts: the authenticator-added alert and the compliance notice
// =====================================================================
test('authenticator added: the totp_enrolled row names the account; another activity row names nobody', async () => {
  // Mutation checked: dropping `a.action = 'totp_enrolled'` lets any activity row pick the recipient.
  const db = freshDb(); const env = envOf(db);
  db.prepare("INSERT INTO activity_logs (id, action, user_id) VALUES (40, 'totp_enrolled', ?), (41, 'profile_updated', ?)").run(USER, OTHER);
  const ref: SendReference = { flow: 'alert', subject: { kind: 'totp_enrolment', id: 40 }, attempt: 1 };
  await refusedThenTimedOut(db, async () => sendBound(env, 'auth_totp_added', ref, { name: 'Robin', ip: '203.0.113.1' }, { userId: USER }), refKey(ref), 'holder@example.test', 1);
  const wrong = await sendBound(env, 'auth_totp_added', { flow: 'alert', subject: { kind: 'totp_enrolment', id: 41 }, attempt: 1 }, { name: 'x', ip: 'x' });
  assert.equal(wrong.reason, 'no_recipient');
});

test('compliance notice: the notice row names its addressee, and a retry of the notice reconciles', async () => {
  const db = freshDb(); const env = envOf(db);
  db.prepare(`INSERT INTO admin_notices (uid, user_id, kind, subject, body, respond_by) VALUES ('0123456789abcdef0123456789abcdef', ?, 'fees', 'Fees due', 'Please pay the fees.', '2999-01-01 00:00:00')`).run(OTHER);
  const ref: SendReference = { flow: 'alert', subject: { kind: 'compliance_notice', id: '0123456789abcdef0123456789abcdef' }, attempt: 1 };
  const vars = { name: 'Other', subject: 'Fees due', kind_label: 'Fees', respond_by: '2999-01-01', body: 'Please pay the fees.', licence_url: 'https://axal.vc/admin/my-licence' };
  await refusedThenTimedOut(db, async () => sendBound(env, 'compliance_notice_issued', ref, vars, { userId: OTHER }), refKey(ref), 'other@example.test', 1);
});

test('partner invitation (route): create mails the row\'s address once, and a second resend in the same hour is answered from the ledger', async () => {
  // Mutation checked: the create or resend route calling the unreferenced sender (no reference) mails the second resend again.
  const { default: adminPartners } = await import('../src/routes/admin_partners.ts');
  const db = freshDb();
  db.prepare("INSERT INTO users (id, role, name, email, is_active) VALUES (5, 'admin', 'Ada Admin', 'ada@example.test', 1)").run();
  const env = envOf(db, 'https://preview-8536.example.test');
  const jwt = await new SignJWT({ user_id: 5, role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const call = async (path: string, body: unknown) => {
    const res = await adminPartners.request(path, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, body: await res.json().catch(() => ({})) as any };
  };
  const made = await call('/invitations', { recipient_email: 'Partner-Route@example.test', recipient_name: 'Pat', allowed_deal_types: ['CUSTOM'] });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.email_sent, true);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'partner-route@example.test');
  assert.ok(mail[0].text.includes('https://preview-8536.example.test/partners/onboard?token='), 'the link carries another host');
  const id = Number(made.body.id);
  assert.ok(refs(db).some((r) => r.ref.startsWith(`invitation:partner_invitation:${id}:`) && r.ref.endsWith('.send') && r.state === 'accepted'),
    'the create did not send under its reference');
  const r1 = await call(`/invitations/${id}/resend`, {});
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const r2 = await call(`/invitations/${id}/resend`, {});
  assert.equal(r2.status, 200);
  assert.equal(r2.body.email_sent, true, 'a reconciled resend reads as not sent');
  // The two resends share one reference unless the hour turned between them;
  // either way no two resend references name the same hour, and each mailed once.
  const resendRefs = refs(db).filter((r) => r.ref.startsWith(`invitation:partner_invitation:${id}:`) && r.ref.includes('.resend-')).map((r) => r.ref);
  const hours = new Set(resendRefs.map((r) => r.split('.resend-')[1]));
  assert.ok(resendRefs.length >= 1 && resendRefs.length <= 2);
  assert.equal(hours.size, resendRefs.length, 'two resends in one hour carried different references');
  assert.equal(mail.length, 1 + resendRefs.length, 'a resend within one hour mailed twice');
});
