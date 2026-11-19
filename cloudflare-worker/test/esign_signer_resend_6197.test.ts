/**
 * D6197 (#6197) — a signer's own link again, and the room's way to their own
 * envelope, over real SQLite.
 *
 *   POST /:id/resend   the caller's own pending row only: the link goes to their
 *                      inbox, never the response; once an hour; refused with a
 *                      sentence when there is nothing to send
 *   GET  /staged/:uid  `you` names the caller's own stage and its envelope id,
 *                      which `/:id/resend` and `/:id/document` take
 *
 * The first half is the D410/D411 harness (`_esign_harness.ts`), with Gmail
 * stubbed at fetch as the D411 tests stub it.
 *
 * Run:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/esign_signer_resend_6197.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import { ESIGN_SENDER_ACTION, ESIGN_SIGNER_RESEND } from '../src/middleware/rateLimit.ts';
import { SENDER, RECIPIENT, STRANGER, ADMIN, freshDb, envFor, fakeR2, call } from './_esign_harness.ts';
import { makeD1 as makeBaselineD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';
import esign from '../src/routes/esign.ts';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const recipients = (db: any) => db.prepare('SELECT * FROM esign_recipients ORDER BY id').all();
const audit = (db: any, action: string) =>
  db.prepare('SELECT * FROM esign_audit_events WHERE action = ? ORDER BY id').all(action);

// ---------- Gmail, stubbed at fetch (as esign_send_for_signature_d411 does) ----------
const GMAIL = { GMAIL_CLIENT_ID: 'test-client', GMAIL_CLIENT_SECRET: 'test-secret-not-real', GMAIL_REFRESH_TOKEN: 'test-refresh-not-real' };
let mail: { to: string; text: string }[] = [];
let mailFails = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  if (host === 'oauth2.googleapis.com') {
    return new Response(JSON.stringify({ access_token: 'test-access', expires_in: 3600 }), { status: 200 });
  }
  if (host === 'gmail.googleapis.com') {
    if (mailFails) return new Response('{"error":"down"}', { status: 503 });
    const body = JSON.parse(String(init?.body ?? '{}'));
    const raw = Buffer.from(String(body.raw).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const parts = [...raw.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/g)]
      .map((m) => Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8'));
    mail.push({ to: (/^To: (.*)$/m.exec(raw)?.[1] ?? '').trim(), text: parts.join('\n') });
    return new Response(JSON.stringify({ id: 'm' + mail.length }), { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;
test.beforeEach(() => { mail = []; mailFails = false; });

const mailEnv = (db: any) => envFor(db, fakeR2(), GMAIL);
/** An NDA from SENDER to the investor, whose account (RECIPIENT) is linked by email. */
async function sentToInvestor(e: any) {
  const s = await call(e, 'POST', '/send', SENDER, { document_type: 'founder_nda_v1', recipient_email: 'investor@example.test', recipient_name: 'Ivy', provider: 'native' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  mail = [];
  return Number(s.body.envelope_id);
}

// ---------- the signer's own link ----------

test('the signer gets their own link again in their inbox, and never in the response', async () => {
  // Mutation checked: the token returned in the body; the mail sent to the sender; no audit row written.
  const db = freshDb(); const e = mailEnv(db);
  const id = await sentToInvestor(e);
  const tok = recipients(db)[0].signing_token;
  const r = await call(e, 'POST', `/${id}/resend`, RECIPIENT, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.resent, r.body.link_renewed], [true, false]);
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, 'investor@example.test');
  assert.ok(mail[0].text.includes(`/esign/${tok}`), 'the mail does not carry the signer’s link');
  assert.ok(!JSON.stringify(r.body).includes(tok), 'the signing token reached the response');
  const [row] = audit(db, 'signing_link_resent');
  assert.equal(row.signer_id, RECIPIENT);
  assert.equal(JSON.parse(row.meta).recipient_id, recipients(db)[0].id);
});

test('the sender, a stranger and an admin who is not the recipient get the 404 a missing id gets, and nothing is sent', async () => {
  // Mutation checked: the scope widened to esignEnvelopeScope (the sender passes); the 404 made a 403.
  const db = freshDb(); const e = mailEnv(db);
  const id = await sentToInvestor(e);
  const absent = await call(e, 'POST', '/999999/resend', RECIPIENT, {});
  assert.equal(absent.status, 404);
  assert.equal(absent.body.error, 'envelope_not_found');
  for (const who of [SENDER, STRANGER, ADMIN]) {
    assert.deepEqual(await call(e, 'POST', `/${id}/resend`, who, {}), absent, `user ${who}`);
  }
  assert.equal(mail.length, 0);
  assert.equal(audit(db, 'signing_link_resent').length, 0);
});

test('a second resend inside the hour is refused with when the next may go; a failed send does not count', async () => {
  // Mutation checked: the hour check dropped; the failed send counted as a resend.
  const db = freshDb(); const e = mailEnv(db);
  const id = await sentToInvestor(e);
  mailFails = true;
  const failed = await call(e, 'POST', `/${id}/resend`, RECIPIENT, {});
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, 'resend_not_sent');
  assert.match(failed.body.message, /could not be emailed/);
  assert.equal(audit(db, 'signing_link_resend_failed').length, 1);
  mailFails = false;
  assert.equal((await call(e, 'POST', `/${id}/resend`, RECIPIENT, {})).status, 200);
  mail = [];
  const again = await call(e, 'POST', `/${id}/resend`, RECIPIENT, {});
  assert.equal(again.status, 429);
  assert.equal(again.body.error, 'resend_too_soon');
  const [last] = audit(db, 'signing_link_resent');
  assert.equal(Date.parse(again.body.next_resend_at), Date.parse(last.ts) + 60 * 60 * 1000, 'the next resend is an hour after the last one');
  assert.equal(mail.length, 0, 'a refused resend still sent mail');
});

test('the sender’s reminder does not use up the signer’s hour, and the signer’s resend is not a reminder', async () => {
  // Mutation checked: the hour read from `reminder_sent`, or from any signer on the envelope.
  const db = freshDb(); const e = mailEnv(db);
  const id = await sentToInvestor(e);
  assert.equal((await call(e, 'POST', `/${id}/remind`, SENDER, {})).status, 200);
  assert.equal((await call(e, 'POST', `/${id}/resend`, RECIPIENT, {})).status, 200);
  assert.equal(audit(db, 'reminder_sent').length, 1);
  assert.equal((await call(e, 'POST', `/${id}/remind`, SENDER, {})).status, 429, 'the sender’s own day still holds');
});

test('a lapsed link is replaced; the old one stops working', async () => {
  const db = freshDb(); const e = mailEnv(db);
  const id = await sentToInvestor(e);
  const old = recipients(db)[0].signing_token;
  db.prepare(`UPDATE esign_recipients SET token_expires_at = '2020-01-01T00:00:00.000Z'`).run();
  const r = await call(e, 'POST', `/${id}/resend`, RECIPIENT, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.link_renewed, true);
  const [rec] = recipients(db);
  assert.notEqual(rec.signing_token, old);
  assert.ok(mail[0].text.includes(`/esign/${rec.signing_token}`));
  assert.equal((await call(e, 'GET', `/sign/${old}`, null)).status, 404);
});

test('nothing to send: signed, executed, voided or DocuSign each say why, and send nothing', async () => {
  // Mutation checked: a signed row re-sent; a voided envelope re-sent; the DocuSign check dropped.
  const db = freshDb(); const e = mailEnv(db);
  const id = await sentToInvestor(e);
  db.prepare(`UPDATE esign_recipients SET status = 'signed'`).run();
  const signed = await call(e, 'POST', `/${id}/resend`, RECIPIENT, {});
  assert.deepEqual([signed.status, signed.body.error], [409, 'already_signed']);
  db.prepare(`UPDATE esign_recipients SET status = 'pending'`).run();
  db.prepare(`UPDATE esign_envelopes SET status = 'completed'`).run();
  const done = await call(e, 'POST', `/${id}/resend`, RECIPIENT, {});
  assert.deepEqual([done.status, done.body.error], [409, 'envelope_not_pending']);
  assert.match(done.body.message, /fully executed/);
  db.prepare(`UPDATE esign_envelopes SET status = 'void'`).run();
  assert.match((await call(e, 'POST', `/${id}/resend`, RECIPIENT, {})).body.message, /voided/);
  db.prepare(`UPDATE esign_envelopes SET status = 'sent', provider = 'docusign'`).run();
  const ds = await call(e, 'POST', `/${id}/resend`, RECIPIENT, {});
  assert.deepEqual([ds.status, ds.body.error], [409, 'provider_managed']);
  assert.equal(mail.length, 0);
});

test('ESIGN_SIGNER_RESEND meters /:id/resend under both mounts and nothing else; the sender pattern is unchanged', () => {
  for (const p of ['/api/legal/esign/1/resend', '/api/esign/7/resend']) assert.ok(ESIGN_SIGNER_RESEND.test(p), p);
  for (const p of ['/api/legal/esign/x/resend', '/api/legal/esign/1/resend/x', '/api/legal/esign/sign/1/resend', '/x/api/legal/esign/1/resend', '/api/legal/esign/1/remind']) {
    assert.ok(!ESIGN_SIGNER_RESEND.test(p), p);
  }
  assert.ok(!ESIGN_SENDER_ACTION.test('/api/legal/esign/1/resend'));
  assert.equal(/[gy]/.test(ESIGN_SIGNER_RESEND.flags), false);
});

test('the route sits in the esign_send bucket', () => {
  const src = readFileSync(new URL('../src/middleware/rateLimit.ts', import.meta.url), 'utf8');
  const bucket = src.slice(src.indexOf("name: 'esign_send'"), src.indexOf("name: 'esign_send'") + 400);
  assert.match(bucket, /ESIGN_SIGNER_RESEND\.test\(p\)/);
});

// ---------- the staged read names the caller's own stage ----------
// The D1216 fixture (staged_signing_d1216.test.ts), cut to what the read needs.

const baseline = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const migration = (f: string) => readFileSync(new URL(`../sql/migrations/${f}`, import.meta.url), 'utf8');
const SCHEMA = ['users', 'super_admins', 'user_sessions', 'activity_logs', 'admin_audit_log', 'legal_templates', 'legal_template_versions',
  'esign_envelopes', 'esign_recipients', 'notifications_inbox', 'projects', 'deals', 'commitments']
  .map((t) => stripForeignKeys(tableFromBaseline(baseline, t))).join('\n')
  + '\n' + migration('434_contract_template_publications.sql')
  + '\n' + migration('475_legal_document_files.sql')
  + '\n' + migration('479_template_kind_party.sql')
  + '\n' + migration('633_staged_signing.sql');
const SECRET = ['d6197', 'staged', 'fixture', 'secret'].join('-');
const S_ADMIN = 1, S_FOUNDER = 2, S_INVESTOR = 3, S_STRANGER = 4;
const DEAL = 30, LINE = 40;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function stagedFixture() {
  const { DB, db } = makeBaselineD1(SCHEMA);
  const u = db.prepare('INSERT INTO users (id, role, name, email, founder_id) VALUES (?, ?, ?, ?, ?)');
  for (const row of [
    [S_ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null], [S_FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 77],
    [S_INVESTOR, 'investor', 'Ivy Investor', 'ivy@example.test', null], [S_STRANGER, 'investor', 'Sam Stranger', 'sam@example.test', null],
  ] as const) u.run(...row);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (50, 'Lumen Labs', 77)`);
  db.exec(`INSERT INTO deals (id, project_id, status) VALUES (${DEAL}, 50, 'active')`);
  db.exec(`INSERT INTO commitments (id, deal_id, investor_user_id, amount, status) VALUES (${LINE}, ${DEAL}, ${S_INVESTOR}, 25000, 'confirmed')`);
  db.prepare(`INSERT INTO legal_templates (slug, title, category, body_md, merge_fields, version, is_active, is_stub)
    VALUES ('spv_joinder', 'SPV Joinder', 'deal', ?, '["closing_date"]', 1, 1, 0)`).run('## SPV Joinder\nJoined on {{closing_date}}.');
  const env: any = { DB, FILES: fakeR2(), JWT_SECRET: SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test' };
  const app = new Hono<any>();
  app.route('/api/legal/esign', esign);
  async function as(who: number | null, method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (who) {
      headers.Authorization = `Bearer ${await new SignJWT({ user_id: who })
        .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET))}`;
    }
    const res = await withThrownResponses(() => app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env));
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  }
  const one = (sql: string, ...a: unknown[]) => { const r = db.prepare(sql).get(...a); return r ? { ...(r as any) } : null; };
  return { db, as, one };
}

const STAGED = {
  deal_id: DEAL, commitment_id: LINE, document_type: 'spv_joinder', fields: { closing_date: '2026-11-30' },
  signers: [{ role: 'company', user_id: S_FOUNDER }, { role: 'investor', user_id: S_INVESTOR }], countersign: false,
};

test('the staged read names the caller’s own stage and its envelope id; a reader who signs none gets null', async () => {
  // Mutation checked: `you` taken by role, not account; the id of another stage's envelope; a token in `you`.
  const realFetchHere = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('no network in the staged fixture'); }) as typeof fetch;
  try {
    const f = stagedFixture();
    const made = await f.as(S_FOUNDER, 'POST', '/api/legal/esign/staged', STAGED);
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const uid = made.body.uid;
    const envOf = (pos: number) => f.one(`SELECT e.id FROM esign_envelopes e JOIN esign_staged_signers s ON s.envelope_uuid = e.envelope_uuid WHERE s.position = ?`, pos)?.id;

    const founder = await f.as(S_FOUNDER, 'GET', `/api/legal/esign/staged/${uid}`);
    assert.deepEqual(founder.body.you, { position: 1, role: 'company', state: 'sent', envelope_id: envOf(1) });
    const investor = await f.as(S_INVESTOR, 'GET', `/api/legal/esign/staged/${uid}`);
    assert.deepEqual(investor.body.you, { position: 2, role: 'investor', state: 'waiting', envelope_id: null }, 'not sent yet, so no envelope');
    const admin = await f.as(S_ADMIN, 'GET', `/api/legal/esign/staged/${uid}`);
    assert.equal(admin.status, 200);
    assert.equal(admin.body.you, null, 'an admin reads the paper but signs no stage');
    assert.equal((await f.as(S_STRANGER, 'GET', `/api/legal/esign/staged/${uid}`)).status, 404);

    // The company signs; the investor's stage goes out, and the investor's `you` now names its envelope.
    const tok1 = f.one(`SELECT r.signing_token FROM esign_recipients r WHERE r.envelope_id = ?`, envOf(1))?.signing_token;
    const signed = await f.as(S_FOUNDER, 'POST', `/api/legal/esign/sign/${tok1}`, { accepted: true, typed_name: 'Fay Founder', signature_data_url: PNG });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    const line = await f.as(S_INVESTOR, 'GET', `/api/legal/esign/staged/line/${LINE}`);
    const mine = line.body.envelopes[0].you;
    assert.deepEqual(mine, { position: 2, role: 'investor', state: 'sent', envelope_id: envOf(2) }, 'the line read keeps the caller, not an admin');
    assert.ok(!JSON.stringify(line.body).includes(String(f.one('SELECT signing_token FROM esign_recipients WHERE envelope_id = ?', envOf(2))?.signing_token)), 'no token in the read');

    // The id the room is handed reaches the caller's own envelope on the routes that take it, and no other.
    assert.equal((await f.as(S_INVESTOR, 'GET', `/api/legal/esign/${envOf(2)}`)).status, 200);
    assert.equal((await f.as(S_INVESTOR, 'GET', `/api/legal/esign/${envOf(1)}/document`)).status, 404, 'the company’s stage is not the investor’s');
  } finally {
    globalThis.fetch = realFetchHere;
  }
});
