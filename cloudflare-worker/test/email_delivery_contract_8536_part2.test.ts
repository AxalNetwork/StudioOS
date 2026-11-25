/**
 * D8536 (#8536) part 2 — signatures, billing and operational alerts under the
 * delivery contract, over real SQLite with Gmail stubbed at fetch. No real
 * email is sent. Part 1 (sign-in, company invitations) is
 * `email_delivery_contract_8536.test.ts`.
 *
 * For each flow moved here:
 *   - signature (the native e-sign signing email: first send, `/remind`, a
 *     signer's `/resend`; the signed-PDF forward);
 *   - billing (the Stripe receipt, `invoice.paid` and `charge.succeeded`);
 *   - alert (the flagged-score alert to each admin);
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
 *     --test cloudflare-worker/test/email_delivery_contract_8536_part2.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { format } from 'node:util';
import { readFileSync } from 'node:fs';
import { SENDER, RECIPIENT, ADMIN, freshDb as harnessDb, envFor, fakeR2, call } from './_esign_harness.ts';
import { handleInvoiceEvent, handleChargeSucceeded } from '../src/services/invoiceEmails.ts';
import { notifyAdminsOfFlaggedScore } from '../src/services/notifications.ts';
import {
  sendAgreementAssignedEmailBound, sendSignedPdfForwardedEmailBound, sendFlaggedScoreEmailBound, signingRef,
} from '../src/services/email.ts';
import { refKey } from '../src/services/email/deliveryContract.ts';

// ---------- Gmail (and Stripe's PDF host), stubbed at fetch ----------
type Step = 'accept' | 'refuse' | 'accept_then_timeout';
let plan: Step[] = [];
let mail: { to: string; subject: string; text: string; raw: string }[] = [];
let gmailCalls = 0;
const PDF_URL = 'https://pay.stripe.example.test/invoice/acct_1/pdf?s=secret-pdf-access-8536';
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  let host = '';
  try { host = new URL(url).hostname; } catch { /* not a URL */ }
  if (url === PDF_URL) return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0xff, 0x00]), { status: 200 });
  if (host === 'oauth2.googleapis.com') return new Response(JSON.stringify({ access_token: 'stub-access' }), { status: 200 });
  if (host === 'gmail.googleapis.com') {
    gmailCalls++;
    const step = plan.shift() ?? 'accept';
    if (step === 'refuse') return new Response('{"error":"unavailable"}', { status: 503 });
    const raw = Buffer.from(String(JSON.parse(String(init?.body ?? '{}')).raw).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const parts = [...raw.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/g)]
      .map((m) => Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8'));
    const subject = Buffer.from(/^Subject: =\?UTF-8\?B\?(.*)\?=\r?$/m.exec(raw)?.[1] ?? '', 'base64').toString('utf8');
    mail.push({ to: (/^To: (.*)$/m.exec(raw)?.[1] ?? '').trim(), subject, text: parts.join('\n'), raw });
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
const LEDGER = readFileSync(new URL('../sql/migrations/202611250054_8536_email_send_refs.sql', import.meta.url), 'utf8');

/** The e-sign harness database, plus the send-reference ledger. */
function freshDb() {
  const db = harnessDb();
  db.exec(LEDGER);
  return db;
}
const mailEnv = (db: any, appUrl = 'https://app.example.test') => envFor(db, fakeR2(), { ...GMAIL, APP_URL: appUrl });
const refs = (db: any) => db.prepare('SELECT ref, state, tries FROM email_send_refs ORDER BY ref').all() as any[];

/** Every string in every row of the given tables, for the "no link stored" check. */
function assertNoLink(db: any, secret: string, tables: string[]) {
  assert.ok(secret.length >= 16, 'no secret to look for');
  assert.deepEqual(logs.filter((l) => l.includes(secret)), [], 'a usable link reached a log line');
  for (const t of tables) {
    assert.ok(!JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all()).includes(secret), `a usable link was stored in ${t}`);
  }
}

// =====================================================================
// Signatures: the native e-sign signing email
// =====================================================================
async function sentToInvestor(e: any) {
  const s = await call(e, 'POST', '/send', SENDER, { document_type: 'founder_nda_v1', recipient_email: 'investor@example.test', recipient_name: 'Ivy', provider: 'native' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return Number(s.body.envelope_id);
}
const recipientRow = (db: any) => db.prepare('SELECT * FROM esign_recipients ORDER BY id LIMIT 1').get() as any;
const SIGN_TABLES = ['email_send_refs', 'esign_audit_events', 'activity_logs'];

test('signature: the signing link carries the host of the environment it was sent from', async () => {
  // Mutation checked: signingEmailFor's callers building the link on a fixed 'https://axal.vc' fails the preview host.
  for (const host of ['https://preview-8536.example.test', 'https://axal.vc']) {
    mail = [];
    const db = freshDb(); const e = mailEnv(db, host);
    const id = await sentToInvestor(e);
    assert.equal(mail.length, 1);
    assert.ok(mail[0].text.includes(`${host}/esign/${recipientRow(db).signing_token}`), 'the first send carries another host');
    mail = [];
    assert.equal((await call(e, 'POST', `/${id}/resend`, RECIPIENT, {})).status, 200);
    assert.ok(mail[0].text.includes(`${host}/esign/`), 'the re-send carries another host');
  }
});

test('signature: an expired link is refused, and a replacement link makes the old one invalid', async () => {
  // Mutation checked: /resend re-sending the lapsed token instead of minting a new one lets the old link through.
  const db = freshDb(); const e = mailEnv(db);
  const id = await sentToInvestor(e);
  const old = recipientRow(db).signing_token;
  db.prepare("UPDATE esign_recipients SET token_expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await call(e, 'GET', `/sign/${old}`, null)).status, 410, 'an expired link was not refused');
  mail = [];
  const r = await call(e, 'POST', `/${id}/resend`, RECIPIENT, {});
  assert.deepEqual([r.status, r.body.link_renewed], [200, true], JSON.stringify(r.body));
  const fresh = recipientRow(db).signing_token;
  assert.notEqual(fresh, old);
  assert.ok(mail[0].text.includes(`/esign/${fresh}`));
  assert.equal((await call(e, 'GET', `/sign/${old}`, null)).status, 404, 'the replaced link still opens');
  assert.equal((await call(e, 'GET', `/sign/${fresh}`, null)).status, 200);
  // The first send and the replacement are two issuances: two references.
  assert.equal(refs(db).length, 2);
});

test('signature: a refused send, then one that times out after acceptance, ends with one email under one reference', async () => {
  // Mutation checked: signingEmailFor sending through the unreferenced sender (no ledger) mails again on the retry;
  // claiming a `timed_out` row again (state IN ('queued','refused','timed_out')) does the same.
  const db = freshDb(); const e = mailEnv(db);
  const id = await sentToInvestor(e);
  mail = []; gmailCalls = 0;
  const rec = recipientRow(db);
  plan = ['refuse', 'accept_then_timeout'];
  // A signing email is tried once per call (D924): the refusal answers 502, and the signer asks again.
  const first = await call(e, 'POST', `/${id}/resend`, RECIPIENT, {});
  assert.equal(first.status, 502, JSON.stringify(first.body));
  assert.equal(gmailCalls, 1);
  // The retry carries the same reference: Gmail takes it and the answer never comes. Not reported as sent.
  const second = await call(e, 'POST', `/${id}/resend`, RECIPIENT, {});
  assert.equal(second.status, 502);
  // A third ask is answered from the ledger: nothing is mailed again.
  const again = await call(e, 'POST', `/${id}/resend`, RECIPIENT, {});
  assert.equal(again.status, 502);
  assert.equal(mail.length, 1, 'the flow did not end with exactly one email');
  assert.equal(gmailCalls, 2);
  const ref = refKey(await signingRef(rec.id, rec.signing_token, 'resend'));
  const resend = refs(db).filter((r) => r.ref === ref);
  assert.deepEqual(resend.map((r) => [r.state, r.tries]), [['timed_out', 2]], 'the retry did not carry the same reference');
  assertNoLink(db, rec.signing_token, SIGN_TABLES);
});

test('signature: a reminder is its own send, and the email goes to the address the recipients row names', async () => {
  // Mutation checked: signingRef ignoring the occasion makes the reminder reconcile with the first send (no mail);
  // dropping `AND status = 'pending'` from the esign_recipient resolver mails a signed recipient.
  const db = freshDb(); const e = mailEnv(db);
  const id = await sentToInvestor(e);
  mail = [];
  assert.equal((await call(e, 'POST', `/${id}/remind`, SENDER, {})).status, 200);
  assert.deepEqual(mail.map((m) => m.to), ['investor@example.test']);
  const rec = recipientRow(db);
  db.prepare("UPDATE esign_recipients SET status = 'signed'").run();
  const r = await sendAgreementAssignedEmailBound(mailEnv(db) as any, await signingRef(rec.id, rec.signing_token, 'resend'), {
    recipientName: 'Ivy', agreementLabel: 'NDA', signLink: `https://app.example.test/esign/${rec.signing_token}`, adminName: 'Sam',
  });
  assert.deepEqual([r.state, r.reason], ['refused', 'no_recipient']);
  assert.equal(mail.length, 1);
});

test('signature: no usable signing link reaches a log line or a row, on success or on failure', async () => {
  // Mutation checked: `console.warn('[esign] link', signLink)` in signingEmailFor fails this.
  const db = freshDb(); const e = mailEnv(db);
  plan = ['refuse', 'refuse'];
  const id = await sentToInvestor(e);
  plan = ['accept'];
  assert.equal((await call(e, 'POST', `/${id}/remind`, SENDER, {})).status, 200);
  assertNoLink(db, recipientRow(db).signing_token, SIGN_TABLES);
  assert.ok(!logs.some((l) => /\/esign\/[0-9a-f]{20,}/.test(l)), 'a signing link reached a log line');
});

test('signature: a signed PDF forward goes to the address its log row names, with the PDF, and a retry is reconciled', async () => {
  // Mutation checked: deliverWithReference calling provider(<a passed address>) instead of the row's fails the `to` check;
  // dropping the attachment's bytes sends no application/pdf part.
  const db = freshDb(); const e: any = mailEnv(db);
  await call(e, 'GET', '/999999/forward', SENDER); // ensureSchema
  const row = db.prepare("INSERT INTO esign_forward_log (envelope_id, forwarded_by, forwarded_to, status) VALUES (1, 1, 'counsel@example.test', 'pending') RETURNING id").get() as any;
  const ref = { flow: 'signature' as const, subject: { kind: 'esign_forward' as const, id: row.id }, attempt: 1 };
  plan = ['refuse', 'accept_then_timeout'];
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
  const a = await sendSignedPdfForwardedEmailBound(e, ref, { documentTitle: 'Signed NDA', senderName: 'Sam', pdfBytes: pdf });
  const b = await sendSignedPdfForwardedEmailBound(e, ref, { documentTitle: 'Signed NDA', senderName: 'Sam', pdfBytes: pdf });
  assert.deepEqual([a.state, a.reconciled, b.state, b.reconciled], ['timed_out', false, 'timed_out', true]);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'counsel@example.test');
  assert.match(mail[0].raw, /Content-Type: application\/pdf; name="Signed NDA\.pdf"/);
  assert.ok(mail[0].raw.includes(Buffer.from(pdf).toString('base64')), 'the PDF bytes are not the attachment');
  assert.ok(mail[0].text.includes('Hi counsel,'), 'the greeting does not name the row’s address');
});

// =====================================================================
// Billing: the Stripe receipt
// =====================================================================
const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'in_8536', paid: true, status: 'paid', customer_email: 'payer@example.test', customer_name: 'Pat Payer',
  amount_paid: 4200, currency: 'usd', number: 'AX-8536', hosted_invoice_url: 'https://invoice.stripe.example.test/i/hosted-secret-8536',
  invoice_pdf: PDF_URL, lines: { data: [{ description: 'Studio plan' }] }, ...over,
});
const BILLING_TABLES = ['email_send_refs', 'invoice_email_log'];

test('billing: a refused send, then one that times out after acceptance, ends with one receipt under one reference', async () => {
  // Mutation checked: sendReceipt throwing on `timed_out` (Stripe retries) is harmless only because the ledger answers;
  // handleInvoiceEvent sending through the unreferenced sender mails a second receipt on the retry.
  const db = freshDb(); const e: any = mailEnv(db);
  plan = ['refuse', 'accept_then_timeout'];
  await handleInvoiceEvent(e, invoice());            // the webhook delivery: refused, then left without an answer
  await handleInvoiceEvent(e, invoice());            // Stripe's retry of the same event
  assert.equal(mail.length, 1, 'the flow did not end with exactly one receipt');
  assert.equal(gmailCalls, 2);
  const rows = refs(db);
  assert.equal(rows.length, 1, 'the retry did not carry the same reference');
  assert.match(rows[0].ref, /^billing:invoice_receipt:\d+:1$/);
  assert.deepEqual([rows[0].state, rows[0].tries], ['timed_out', 2]);
  assert.match(mail[0].raw, /Content-Type: application\/pdf; name="AX-8536\.pdf"/);
});

test('billing: a refused receipt throws for Stripe to retry, the retry sends once, and a later delivery is a no-op', async () => {
  // Mutation checked: sendReceipt not throwing on `refused` loses the receipt (Stripe never retries).
  const db = freshDb(); const e: any = mailEnv(db);
  plan = ['refuse', 'refuse'];
  await assert.rejects(handleChargeSucceeded(e, { id: 'ch_8536', paid: true, receipt_email: 'buyer@example.test', amount_captured: 900, currency: 'usd' }),
    /charge receipt send failed: provider_refused/);
  assert.equal(mail.length, 0);
  await handleChargeSucceeded(e, { id: 'ch_8536', paid: true, receipt_email: 'buyer@example.test', amount_captured: 900, currency: 'usd' });
  await handleChargeSucceeded(e, { id: 'ch_8536', paid: true, receipt_email: 'buyer@example.test', amount_captured: 900, currency: 'usd' });
  assert.equal(mail.length, 1);
  assert.deepEqual(refs(db).map((r) => [r.state, r.tries]), [['accepted', 3]]);
  assert.ok((db.prepare("SELECT sent_at FROM invoice_email_log WHERE dedupe_key = 'ch_8536'").get() as any).sent_at);
});

test('billing: the receipt goes to the address the receipt row names, whatever a retried event says', async () => {
  // Mutation checked: deliverWithReference calling provider(<the event's address>) fails this.
  const db = freshDb(); const e: any = mailEnv(db);
  plan = ['refuse', 'refuse'];
  await assert.rejects(handleInvoiceEvent(e, invoice()));
  await handleInvoiceEvent(e, invoice({ customer_email: 'someone.else@example.test' }));
  assert.deepEqual(mail.map((m) => m.to), ['payer@example.test']);
});

test('billing: no Stripe access link reaches a log line or a row', async () => {
  // Mutation checked: `console.warn('[invoice-email] pdf', inv.invoice_pdf)` in handleInvoiceEvent fails this.
  const db = freshDb(); const e: any = mailEnv(db);
  plan = ['refuse', 'refuse'];
  await assert.rejects(handleInvoiceEvent(e, invoice()));
  await handleInvoiceEvent(e, invoice());
  assertNoLink(db, 'secret-pdf-access-8536', BILLING_TABLES);
  assertNoLink(db, 'hosted-secret-8536', BILLING_TABLES);
});

// =====================================================================
// Alerts: the flagged-score alert to each admin
// =====================================================================
const flagged = { snapshotId: 77, projectId: 9, projectName: 'Halyard', totalScore: 41, flags: ['hash_mismatch'], source: 'hash_audit' as const };
const alertPayload = (host: string) => ({
  projectName: 'Halyard', snapshotId: 77, totalScore: 41, flagSummary: ['hash'], reviewUrl: `${host}/monitoring?tab=integrity&snapshot=77`, source: 'hash_audit' as const,
});

test('alert: the review link carries the host of the environment it was sent from', async () => {
  // Mutation checked: notifyAdminsOfFlaggedScore building reviewUrl on a fixed 'https://axal.vc' fails the preview host.
  for (const host of ['https://preview-8536.example.test', 'https://axal.vc']) {
    const db = freshDb(); const e: any = mailEnv(db, host);
    await notifyAdminsOfFlaggedScore(e, flagged as any);
    assert.deepEqual(mail.map((m) => m.to), ['admin@example.test']);
    assert.ok(mail[0].text.includes(`${host}/monitoring?tab=integrity&snapshot=77`));
    mail = [];
  }
});

test('alert: a refused send, then one that times out after acceptance, ends with one email under one reference', async () => {
  // Mutation checked: deliverWithReference not reading the ledger (always claiming) mails again on the retry below.
  const db = freshDb(); const e: any = mailEnv(db);
  plan = ['refuse', 'accept_then_timeout'];
  await notifyAdminsOfFlaggedScore(e, flagged as any);
  await notifyAdminsOfFlaggedScore(e, flagged as any); // a retried audit batch: the notification dedupe holds
  const n = db.prepare('SELECT id FROM notifications').get() as any;
  const ref = { flow: 'alert' as const, subject: { kind: 'admin_alert' as const, id: n.id }, attempt: 1 };
  const again = await sendFlaggedScoreEmailBound(e, ref, 'Ada', alertPayload('https://app.example.test'));
  assert.deepEqual([again.state, again.reconciled], ['timed_out', true]);
  assert.equal(mail.length, 1, 'the flow did not end with exactly one email');
  assert.equal(gmailCalls, 2);
  assert.deepEqual(refs(db).map((r) => [r.ref, r.state, r.tries]), [[refKey(ref), 'timed_out', 2]]);
});

test('alert: the email goes to the admin the notification row names, and not once they are no longer an admin', async () => {
  // Mutation checked: dropping `AND u.role = 'admin'` from the admin_alert resolver mails a demoted user.
  const db = freshDb(); const e: any = mailEnv(db);
  await notifyAdminsOfFlaggedScore(e, flagged as any);
  assert.deepEqual(mail.map((m) => m.to), ['admin@example.test']);
  const n = db.prepare('SELECT id FROM notifications').get() as any;
  db.prepare(`UPDATE users SET role = 'founder' WHERE id = ?`).run(ADMIN);
  const r = await sendFlaggedScoreEmailBound(e, { flow: 'alert', subject: { kind: 'admin_alert', id: n.id }, attempt: 'demoted' }, 'Ada', alertPayload('https://app.example.test'));
  assert.deepEqual([r.state, r.reason], ['refused', 'no_recipient']);
  assert.equal(mail.length, 1);
});
