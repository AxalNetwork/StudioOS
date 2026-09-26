/**
 * D411 — the Send for Signature rebuild's Worker half, run against real SQLite.
 *
 *   GET  /templates           role, what may be sent, and what may not (with why)
 *   GET  /templates/:doc_type the body the envelope will hash, and its fields
 *   POST /send                refuses while any {{field}} is still blank
 *   POST /:id/void            the sender withdraws it; nobody "declined"
 *   POST /:id/remind          the link goes to the inbox again, never the response
 *   GET  /:id                 can_manage says whose controls those are
 *   completion notices        link to the status view the reader can open
 *
 * The harness is shared with the D410 tests (`_esign_harness.ts`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ESIGN_SENDER_ACTION } from '../src/middleware/rateLimit.ts';
import {
  SENDER, OTHER_SENDER, RECIPIENT, STRANGER, ADMIN, EXPLORER,
  freshDb, envFor, fakeR2, call,
} from './_esign_harness.ts';

const envelopes = (db: any) => db.prepare('SELECT * FROM esign_envelopes ORDER BY id').all();
const recipients = (db: any) => db.prepare('SELECT * FROM esign_recipients ORDER BY id').all();
const audit = (db: any, action: string) =>
  db.prepare('SELECT * FROM esign_audit_events WHERE action = ? ORDER BY id').all(action);

const NDA = 'founder_nda_v1';                        // no fields of its own
const THREE_WAY = 'nda_3way_founder_investor_axal';  // five sender fields
const THREE_WAY_FIELDS = {
  founder_name: 'Sam Sender', founder_email: 'sender@example.test',
  investor_name: 'Ivy Investor', investor_email: 'investor@example.test',
  axal_signer_email: 'legal@axal.example.test',
};

const send = (e: any, who: number, email: string, extra: Record<string, unknown> = {}) =>
  call(e, 'POST', '/send', who, { document_type: NDA, recipient_email: email, recipient_name: 'R', provider: 'native', ...extra });

// ---------- Gmail, stubbed at fetch ----------
// Remind sends real mail through services/email.ts. The stub sits at the
// network edge so the route's own email code runs; `mail` is what it sent.
const GMAIL = { GMAIL_CLIENT_ID: 'test-client', GMAIL_CLIENT_SECRET: 'test-secret-not-real', GMAIL_REFRESH_TOKEN: 'test-refresh-not-real' };
let mail: { to: string; text: string }[] = [];
let mailFails = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (url.includes('oauth2.googleapis.com')) {
    return new Response(JSON.stringify({ access_token: 'test-access', expires_in: 3600 }), { status: 200 });
  }
  if (url.includes('gmail.googleapis.com')) {
    if (mailFails) return new Response('{"error":"down"}', { status: 503 });
    const body = JSON.parse(String(init?.body ?? '{}'));
    const raw = Buffer.from(String(body.raw).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    // Each MIME part is base64; decode them so assertions read the words sent.
    const parts = [...raw.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/g)]
      .map((m) => Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8'));
    mail.push({ to: (/^To: (.*)$/m.exec(raw)?.[1] ?? '').trim(), text: parts.join('\n') });
    return new Response(JSON.stringify({ id: 'm' + mail.length }), { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;
test.beforeEach(() => { mail = []; mailFails = false; });

const mailEnv = (db: any) => envFor(db, fakeR2(), GMAIL);

// ---------- the picker ----------

test('GET /templates names the role, what it may send, and what the canvas offers that it may not', async () => {
  const db = freshDb();
  const r = await call(envFor(db), 'GET', '/templates', SENDER);
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'founder');
  assert.ok(r.body.items.some((t: any) => t.doc_type === NDA));
  const names = r.body.not_offered.map((t: any) => t.name);
  assert.deepEqual(names, ['SAFE', 'Term Sheet', 'Co-founder Agreement']);
  for (const t of r.body.not_offered) assert.ok(t.reason.length > 20, `${t.name} is absent with no reason`);
  const cofounder = r.body.not_offered.find((t: any) => t.name === 'Co-founder Agreement');
  assert.equal(cofounder.instead.path, '/incorporate/cofounder-agreement');
});

// ---------- the preview ----------

test('GET /templates/:doc_type returns the body and the sender’s fields, with the send-filled ones marked', async () => {
  const db = freshDb();
  const r = await call(envFor(db), 'GET', `/templates/${THREE_WAY}`, SENDER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.source, 'template');
  assert.match(r.body.body, /\{\{founder_name\}\}/);
  const sender = r.body.fields.filter((f: any) => f.filled_by === 'sender').map((f: any) => f.key).sort();
  assert.deepEqual(sender, Object.keys(THREE_WAY_FIELDS).sort());
  for (const k of ['prefill', 'pre_send_checks', 'ordered_signers']) {
    assert.ok(String(r.body.absent[k]).length > 20, `absence ${k} has no reason`);
  }
});

test('a template this role may not send answers exactly like one that does not exist', async () => {
  const db = freshDb(); const e = envFor(db);
  const notMine = await call(e, 'GET', '/templates/investor_nda_axal', SENDER);   // an investor's
  const nothing = await call(e, 'GET', '/templates/no_such_template', SENDER);
  const bad = await call(e, 'GET', '/templates/..%2Fetc', SENDER);
  assert.equal(notMine.status, 404);
  assert.deepEqual(notMine, nothing);
  assert.deepEqual(bad, nothing);
});

test('the preview and the send read ONE body: a store override shows in both', async () => {
  const db = freshDb(); const e = envFor(db);
  await call(e, 'GET', `/templates/${NDA}`, SENDER);            // creates legal_templates
  db.prepare(`INSERT INTO legal_templates (slug, title, body_md, is_active, is_stub) VALUES (?, 'NDA', ?, 1, 0)`)
    .run(NDA, 'Between {{company_name}} and {{recipient_name}}.');
  const preview = await call(e, 'GET', `/templates/${NDA}`, SENDER);
  assert.equal(preview.body.source, 'store');
  assert.deepEqual(preview.body.fields.map((f: any) => [f.key, f.filled_by]),
    [['company_name', 'sender'], ['recipient_name', 'send']]);
  const blank = await send(e, SENDER, 'r1@nowhere.test');
  assert.equal(blank.status, 422);
  const ok = await send(e, SENDER, 'r1@nowhere.test', { merge_fields: { company_name: 'Northwind Robotics, Inc.' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(envelopes(db)[0].document_body, 'Between Northwind Robotics, Inc. and R.');
});

// ---------- unfilled placeholders ----------

test('POST /send refuses while any field is blank, names them, and writes nothing', async () => {
  const db = freshDb(); const e = envFor(db);
  const { investor_email: _left, ...most } = THREE_WAY_FIELDS;
  const r = await call(e, 'POST', '/send', SENDER, {
    document_type: THREE_WAY, recipient_email: 'r@nowhere.test', merge_fields: most,
  });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, 'unfilled_fields');
  assert.deepEqual(r.body.fields, ['investor_email']);
  assert.match(r.body.message, /investor_email/);
  assert.equal(envelopes(db).length, 0, 'an envelope was written for a document with a blank');
  assert.equal(recipients(db).length, 0);
});

test('with every field filled, the sent document carries no {{token}} at all', async () => {
  const db = freshDb(); const e = envFor(db);
  const r = await call(e, 'POST', '/send', SENDER, {
    document_type: THREE_WAY, recipient_email: 'r@nowhere.test', merge_fields: THREE_WAY_FIELDS,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [env] = envelopes(db);
  assert.doesNotMatch(env.document_body, /\{\{/);
  assert.match(env.document_body, /legal@axal\.example\.test/);
});

test('an envelope is titled with the document’s name, not its doc type', async () => {
  // The title is what the signing email's subject, the PDF and the status
  // view print; it used to be the raw `founder_nda_v1`.
  const db = freshDb(); const e = envFor(db);
  await send(e, SENDER, 'r@nowhere.test');
  assert.equal(envelopes(db)[0].document_title, 'Founder Mutual NDA');
});

// ---------- void ----------

test('the sender voids a pending envelope: void, not rejected, with an audit row', async () => {
  const db = freshDb(); const e = envFor(db);
  const s = await send(e, SENDER, 'investor@example.test');
  const r = await call(e, 'POST', `/${s.body.envelope_id}/void`, SENDER, { reason: 'Terms changed' },
    { 'CF-Connecting-IP': '203.0.113.7' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(envelopes(db)[0].status, 'void');
  assert.equal(recipients(db)[0].status, 'void', 'a void must not read as a decline');
  const [row] = audit(db, 'envelope_voided');
  assert.equal(row.ip, '203.0.113.7');
  assert.equal(JSON.parse(row.meta).reason, 'Terms changed');
});

test('a voided envelope cannot be opened, signed or declined through its link', async () => {
  const db = freshDb(); const e = envFor(db);
  const s = await send(e, SENDER, 'nobody@nowhere.test');
  const tok = recipients(db)[0].signing_token;
  await call(e, 'POST', `/${s.body.envelope_id}/void`, SENDER, {});
  const view = await call(e, 'GET', `/sign/${tok}`, null);
  const sign = await call(e, 'POST', `/sign/${tok}`, null, { accepted: true, signature_data_url: 'data:image/png;base64,AAAA' });
  const decline = await call(e, 'POST', `/sign/${tok}/reject`, null, { reason: 'x' });
  for (const [what, r] of [['view', view], ['sign', sign], ['decline', decline]] as const) {
    assert.equal(r.status, 410, `${what}: ${r.status}`);
    assert.equal(r.body.error, 'envelope_voided', what);
  }
  assert.equal(recipients(db)[0].status, 'void');
});

test('an envelope voided by the admin console is refused on the signer’s link too', async () => {
  const db = freshDb(); const e = envFor(db);
  await send(e, SENDER, 'nobody@nowhere.test');
  // What admin_contracts' void writes today.
  db.exec(`UPDATE esign_envelopes SET status = 'void'; UPDATE esign_recipients SET status = 'rejected';`);
  const r = await call(e, 'GET', `/sign/${recipients(db)[0].signing_token}`, null);
  assert.equal(r.status, 410);
  assert.equal(r.body.error, 'envelope_voided');
});

test('only the sender may void: recipient, subject, stranger and a non-sending admin get the missing-id 404', async () => {
  const db = freshDb(); const e = envFor(db);
  const s = await send(e, SENDER, 'investor@example.test');   // RECIPIENT is subject and recipient
  const absent = await call(e, 'POST', '/999999/void', STRANGER, {});
  for (const who of [RECIPIENT, STRANGER, ADMIN, OTHER_SENDER]) {
    const r = await call(e, 'POST', `/${s.body.envelope_id}/void`, who, {});
    assert.deepEqual(r, absent, `user ${who} got ${r.status}`);
  }
  assert.equal(envelopes(db)[0].status, 'sent');
});

test('void is refused once a signature is being recorded, and the envelope is untouched', async () => {
  const db = freshDb(); const e = envFor(db);
  const s = await send(e, SENDER, 'nobody@nowhere.test');
  db.prepare(`UPDATE esign_recipients SET status = 'signing'`).run();   // mid POST /sign/:token
  const r = await call(e, 'POST', `/${s.body.envelope_id}/void`, SENDER, {});
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'signature_in_progress');
  assert.equal(envelopes(db)[0].status, 'sent');
  assert.equal(recipients(db)[0].status, 'signing');
  assert.equal(audit(db, 'envelope_voided').length, 0);
});

test('an executed or already-voided envelope cannot be voided', async () => {
  const db = freshDb(); const e = envFor(db);
  const s = await send(e, SENDER, 'nobody@nowhere.test');
  await call(e, 'POST', `/${s.body.envelope_id}/void`, SENDER, {});
  const twice = await call(e, 'POST', `/${s.body.envelope_id}/void`, SENDER, {});
  assert.equal(twice.status, 409);
  assert.equal(twice.body.error, 'envelope_not_pending');
  db.prepare(`UPDATE esign_envelopes SET status = 'completed'`).run();
  const done = await call(e, 'POST', `/${s.body.envelope_id}/void`, SENDER, {});
  assert.equal(done.status, 409);
  assert.match(done.body.message, /fully executed/);
});

test('a DocuSign envelope is voided and reminded in DocuSign, not here', async () => {
  const db = freshDb(); const e = envFor(db);
  const s = await send(e, SENDER, 'nobody@nowhere.test');
  db.prepare(`UPDATE esign_envelopes SET provider = 'docusign'`).run();
  for (const act of ['void', 'remind']) {
    const r = await call(e, 'POST', `/${s.body.envelope_id}/${act}`, SENDER, {});
    assert.equal(r.status, 409, act);
    assert.equal(r.body.error, 'provider_managed', act);
  }
});

// ---------- remind ----------

test('remind re-sends the live link to the recipient’s inbox and never into the response', async () => {
  const db = freshDb(); const e = mailEnv(db);
  const s = await send(e, SENDER, 'nobody@nowhere.test');
  mail = [];
  const tok = recipients(db)[0].signing_token;
  const r = await call(e, 'POST', `/${s.body.envelope_id}/remind`, SENDER, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'nobody@nowhere.test');
  assert.ok(mail[0].text.includes(`/esign/${tok}`), 'the reminder does not carry the recipient’s link');
  assert.ok(!JSON.stringify(r.body).includes(tok), 'the signing token reached the sender');
  assert.deepEqual(r.body.results.map((x: any) => [x.sent, x.link_renewed]), [[true, false]]);
  assert.equal(audit(db, 'reminder_sent').length, 1);
});

test('a second reminder inside 24 hours is refused and sends nothing', async () => {
  const db = freshDb(); const e = mailEnv(db);
  const s = await send(e, SENDER, 'nobody@nowhere.test');
  await call(e, 'POST', `/${s.body.envelope_id}/remind`, SENDER, {});
  mail = [];
  const r = await call(e, 'POST', `/${s.body.envelope_id}/remind`, SENDER, {});
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'remind_too_soon');
  assert.ok(Date.parse(r.body.next_reminder_at) > Date.now());
  assert.equal(mail.length, 0);
});

test('a failed reminder does not count against the day, and says it was not sent', async () => {
  const db = freshDb(); const e = mailEnv(db);
  const s = await send(e, SENDER, 'nobody@nowhere.test');
  mailFails = true;
  const failed = await call(e, 'POST', `/${s.body.envelope_id}/remind`, SENDER, {});
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, 'reminder_not_sent');
  mailFails = false;
  const retry = await call(e, 'POST', `/${s.body.envelope_id}/remind`, SENDER, {});
  assert.equal(retry.status, 200);
});

test('a lapsed link is replaced by a fresh one; the old link stops working', async () => {
  const db = freshDb(); const e = mailEnv(db);
  const s = await send(e, SENDER, 'nobody@nowhere.test');
  const old = recipients(db)[0].signing_token;
  db.prepare(`UPDATE esign_recipients SET token_expires_at = '2020-01-01T00:00:00.000Z'`).run();
  const r = await call(e, 'POST', `/${s.body.envelope_id}/remind`, SENDER, {});
  assert.equal(r.status, 200);
  const [rec] = recipients(db);
  assert.notEqual(rec.signing_token, old);
  assert.ok(Date.parse(rec.token_expires_at) > Date.now() + 6 * 24 * 3600 * 1000);
  assert.equal(r.body.results[0].link_renewed, true);
  assert.equal((await call(e, 'GET', `/sign/${old}`, null)).status, 404);
  assert.equal((await call(e, 'GET', `/sign/${rec.signing_token}`, null)).status, 200);
});

test('only the sender may remind, and only while someone is still to sign', async () => {
  const db = freshDb(); const e = mailEnv(db);
  const s = await send(e, SENDER, 'investor@example.test');
  mail = [];
  const absent = await call(e, 'POST', '/999999/remind', STRANGER, {});
  for (const who of [RECIPIENT, STRANGER, ADMIN]) {
    assert.deepEqual(await call(e, 'POST', `/${s.body.envelope_id}/remind`, who, {}), absent, `user ${who}`);
  }
  db.prepare(`UPDATE esign_envelopes SET status = 'completed'`).run();
  const done = await call(e, 'POST', `/${s.body.envelope_id}/remind`, SENDER, {});
  assert.equal(done.status, 409);
  assert.equal(mail.length, 0, 'a refused reminder still sent mail');
});

// ---------- the status view's data ----------

test('GET /:id says who manages the envelope, and serves the absences with reasons', async () => {
  const db = freshDb(); const e = envFor(db);
  const s = await send(e, SENDER, 'investor@example.test');
  const mine = await call(e, 'GET', `/${s.body.envelope_id}`, SENDER);
  const theirs = await call(e, 'GET', `/${s.body.envelope_id}`, RECIPIENT);
  assert.equal(mine.body.can_manage, true);
  assert.equal(theirs.status, 200);
  assert.equal(theirs.body.can_manage, false);
  assert.ok(String(mine.body.absent.signer_ip).length > 20);
  assert.ok(String(mine.body.absent.data_room).length > 20);
});

// ---------- completion notices ----------

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('the completion notices link to the status view, or to /account for a role that cannot open it', async () => {
  // Investor subject: the status view.
  {
    const db = freshDb(); const e = envFor(db);
    await send(e, SENDER, 'investor@example.test');
    const [rec] = recipients(db);
    await call(e, 'POST', `/sign/${rec.signing_token}`, RECIPIENT, { accepted: true, typed_name: 'Ivy', signature_data_url: PNG });
    const links = Object.fromEntries(db.prepare('SELECT user_id, link FROM notifications_inbox').all().map((n: any) => [n.user_id, n.link]));
    assert.equal(links[SENDER], `/legal/send?envelope=${rec.envelope_id}`);
    assert.equal(links[RECIPIENT], `/legal/send?envelope=${rec.envelope_id}`);
  }
  // Exploring subject: /legal/send's guard turns that role away, so /account.
  {
    const db = freshDb(); const e = envFor(db);
    await send(e, SENDER, 'explorer@example.test');
    const [rec] = recipients(db);
    await call(e, 'POST', `/sign/${rec.signing_token}`, EXPLORER, { accepted: true, typed_name: 'Eli', signature_data_url: PNG });
    const links = Object.fromEntries(db.prepare('SELECT user_id, link FROM notifications_inbox').all().map((n: any) => [n.user_id, n.link]));
    assert.equal(links[EXPLORER], '/account');
    assert.equal(links[SENDER], `/legal/send?envelope=${rec.envelope_id}`);
  }
});

// ---------- the pattern that meters remind and void ----------

test('ESIGN_SENDER_ACTION matches remind and void under both mounts, and nothing else', () => {
  for (const p of ['/api/legal/esign/1/remind', '/api/legal/esign/42/void', '/api/esign/7/remind', '/api/esign/7/void']) {
    assert.ok(ESIGN_SENDER_ACTION.test(p), p);
  }
  for (const p of [
    '/api/legal/esign/1/remind/x', '/api/legal/esign/x/void', '/api/legal/esign/sign/1/void',
    '/api/legal/esign/1/voids', '/api/legal/esign/1/forward', '/x/api/legal/esign/1/void',
  ]) assert.ok(!ESIGN_SENDER_ACTION.test(p), p);
  assert.equal(/[gy]/.test(ESIGN_SENDER_ACTION.flags), false);
});
