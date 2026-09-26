/**
 * D410 — the e-sign `/send` hardening, run against real SQLite.
 *
 * Five defects, each of which let one signed-in user act on, or learn about,
 * an agreement that was not theirs:
 *
 *   1. The duplicate check keyed on (document_type, user_id, deal_id). POST
 *      /send never had a user id, so every /legal/send envelope of a document
 *      type was one key platform-wide: the second sender was handed the first
 *      sender's envelope id and no mail went out.
 *   2. `recipient_user_id` came from an optional body field the page never
 *      sent, so the signer-identity check never ran on these envelopes.
 *   3. The sender was handed the recipient's signing URL, and it was written
 *      into audit meta and served back by GET /:id — so a sender could sign
 *      for a recipient with no account.
 *   4. Download and forward checked `envelope.user_id` after finding the row:
 *      the sender got a 403, and 403-versus-404 told anyone which ids exist.
 *   5. The completion notice went only to the envelope's subject.
 *
 * Real SQLite, for the reason `_d1_sqlite.mjs` gives: the route's own
 * predicate with its own binds decides which rows exist, so a regression in
 * the dedupe key or the scope fails because the wrong rows appear.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { Hono } from 'hono';

import esign from '../src/routes/esign.ts';
import { ESIGN_FORWARD } from '../src/middleware/rateLimit.ts';

const app = new Hono<any>();
app.route('/', esign);
app.onError((err: any, c) => {
  if (String(err?.message || '') === 'Unauthorized') return c.json({ detail: 'Unauthorized' }, 401);
  throw err;
});

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const SENDER = 1;        // a founder who sends
const OTHER_SENDER = 2;  // a second founder, a different tenant
const RECIPIENT = 3;     // an investor with an account
const STRANGER = 4;      // signed in, nothing to do with any envelope
const ADMIN = 5;

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  const stmt = (sql: string) => {
    let b: any[] = [];
    const api: any = {
      bind: (...x: any[]) => { b = coerce(x); return api; },
      async first() { return db.prepare(sql).get(...b) ?? null; },
      async all() { return { results: db.prepare(sql).all(...b) }; },
      async run() {
        const r = db.prepare(sql).run(...b);
        return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return api;
  };
  return {
    prepare: stmt,
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    // D1 runs a batch as one transaction; so does this.
    async batch(x: any[]) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const st of x || []) out.push(await st.run());
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

function freshDb() {
  const db = new DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY, role TEXT NOT NULL, email TEXT, name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, jwt_min_iat INTEGER,
      founder_id INTEGER, partner_id INTEGER,
      founder_public_id TEXT, partner_public_id TEXT,
      access_level TEXT, kyc_status TEXT
    );
    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, details TEXT, actor TEXT, user_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users (id, role, email, name) VALUES
      (${SENDER},       'founder',  'sender@example.test',   'Sam Sender'),
      (${OTHER_SENDER}, 'founder',  'other@example.test',    'Olu Other'),
      (${RECIPIENT},    'investor', 'Investor@Example.test', 'Ivy Investor'),
      (${STRANGER},     'founder',  'stranger@example.test', 'Stu Stranger'),
      (${ADMIN},        'admin',    'admin@example.test',    'Ada Admin');
  `);
  return db;
}

// A private R2 stand-in: puts are kept, gets return what was put (or a
// placeholder PDF for a key a test seeded directly into D1).
function fakeR2() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async put(key: string, bytes: Uint8Array) { objects.set(key, bytes); },
    async get(key: string) {
      const bytes = objects.get(key) ?? new TextEncoder().encode('%PDF-1.4 placeholder');
      return { arrayBuffer: async () => bytes.slice().buffer };
    },
  };
}

const envFor = (db: InstanceType<typeof DatabaseSync>, files = fakeR2()) =>
  ({ JWT_SECRET, ENVIRONMENT: 'development', APP_URL: 'https://app.example.test', DB: makeD1(db), FILES: files });

async function token(userId: number, role: string): Promise<string> {
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

const ROLE: Record<number, string> = {
  [SENDER]: 'founder', [OTHER_SENDER]: 'founder', [RECIPIENT]: 'investor', [STRANGER]: 'founder', [ADMIN]: 'admin',
};

async function call(e: any, method: string, path: string, who: number | null, body?: any, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extraHeaders };
  if (who) headers.Authorization = `Bearer ${await token(who, ROLE[who])}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    (init as any).body = JSON.stringify(body);
  }
  const res = await app.request(path, init, e);
  const text = await res.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

const DOC = 'founder_nda_v1';   // a founder may originate it (esignOriginators.ts)
const send = (e: any, who: number, email: string, extra: Record<string, unknown> = {}) =>
  call(e, 'POST', '/send', who, { document_type: DOC, recipient_email: email, recipient_name: 'R', provider: 'native', ...extra });

const envelopes = (db: any) => db.prepare('SELECT * FROM esign_envelopes ORDER BY id').all();
const recipients = (db: any) => db.prepare('SELECT * FROM esign_recipients ORDER BY id').all();

// ---------- 1. the duplicate key ----------

test('two no-account invitations to different emails are two envelopes, each mailed', async () => {
  const db = freshDb(); const e = envFor(db);
  const a = await send(e, SENDER, 'first@nowhere.test');
  const b = await send(e, SENDER, 'second@nowhere.test');
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.notEqual(a.body.envelope_id, b.body.envelope_id, 'the second invitation was handed the first one’s envelope');
  assert.notEqual(b.body.already_pending, true);
  assert.equal(envelopes(db).length, 2);
  assert.deepEqual(recipients(db).map((r: any) => r.recipient_email), ['first@nowhere.test', 'second@nowhere.test']);
  // Neither has an account, so neither envelope is ABOUT anyone.
  assert.deepEqual(envelopes(db).map((r: any) => r.user_id), [null, null]);
});

test('two senders sending the same document to the same address never share an envelope', async () => {
  const db = freshDb(); const e = envFor(db);
  const a = await send(e, SENDER, 'shared@nowhere.test');
  const b = await send(e, OTHER_SENDER, 'shared@nowhere.test');
  assert.equal(b.status, 200);
  assert.notEqual(b.body.envelope_id, a.body.envelope_id, 'a second tenant was handed the first tenant’s envelope id');
  assert.notEqual(b.body.already_pending, true);
  assert.deepEqual(envelopes(db).map((r: any) => r.created_by), [SENDER, OTHER_SENDER]);
});

test('the same sender re-sending to the same address gets their pending envelope back, and no second mail', async () => {
  const db = freshDb(); const e = envFor(db);
  const a = await send(e, SENDER, 'again@nowhere.test');
  const b = await send(e, SENDER, 'AGAIN@nowhere.test');
  assert.equal(b.status, 200);
  assert.equal(b.body.envelope_id, a.body.envelope_id);
  assert.equal(b.body.already_pending, true);
  assert.equal(b.body.email_sent, false);
  assert.equal(envelopes(db).length, 1);
  assert.equal(recipients(db).length, 1, 'a duplicate send wrote an orphan recipients row');
});

test('a completed envelope does not block a fresh send of the same document', async () => {
  const db = freshDb(); const e = envFor(db);
  const a = await send(e, SENDER, 'done@nowhere.test');
  db.prepare(`UPDATE esign_envelopes SET status = 'completed' WHERE id = ?`).run(a.body.envelope_id);
  const b = await send(e, SENDER, 'done@nowhere.test');
  assert.notEqual(b.body.envelope_id, a.body.envelope_id);
  assert.notEqual(b.body.already_pending, true);
});

// ---------- 2. the recipient's account ----------

test('the recipient’s account is found by email, case-insensitively, and pinned on both rows', async () => {
  const db = freshDb(); const e = envFor(db);
  const r = await send(e, SENDER, 'investor@example.test');
  assert.equal(r.status, 200);
  const [env] = envelopes(db);
  const [rec] = recipients(db);
  assert.equal(env.user_id, RECIPIENT);
  assert.equal(rec.user_id, RECIPIENT);
});

test('a body recipient_user_id that is not the address’s account is refused, and nothing is created', async () => {
  const db = freshDb(); const e = envFor(db);
  // The attack: name yourself as the account behind someone else's address,
  // so that only you can sign what they are mailed.
  const r = await send(e, SENDER, 'investor@example.test', { recipient_user_id: SENDER });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'recipient_user_mismatch');
  assert.equal(typeof r.body.message, 'string');
  assert.equal(envelopes(db).length, 0);
});

test('with the account pinned, the sender cannot sign in the recipient’s place', async () => {
  const db = freshDb(); const e = envFor(db);
  await send(e, SENDER, 'investor@example.test');
  const [rec] = recipients(db);
  const r = await call(e, 'POST', `/sign/${rec.signing_token}`, SENDER, {
    accepted: true, typed_name: 'Not Ivy', signature_data_url: 'data:image/png;base64,AAAA',
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'signer_identity_mismatch');
  assert.equal(recipients(db)[0].status, 'pending');
});

// ---------- 3. the signing URL ----------

test('a non-admin sender is not handed the signing URL; an admin still is', async () => {
  const db = freshDb(); const e = envFor(db);
  const founder = await send(e, SENDER, 'nolink@nowhere.test');
  assert.equal(founder.status, 200);
  assert.equal('signing_url' in founder.body, false, 'the recipient’s bearer link reached the sender');
  assert.ok(!JSON.stringify(founder.body).includes(recipients(db)[0].signing_token));

  const admin = await call(e, 'POST', '/send', ADMIN, {
    document_type: DOC, recipient_email: 'viaadmin@nowhere.test', provider: 'native',
  });
  assert.equal(admin.status, 200);
  assert.match(admin.body.signing_url, /\/esign\/[0-9a-f]{64}$/);
});

test('no audit row and no activity row carries the signing token', async () => {
  const db = freshDb(); const e = envFor(db);
  await send(e, SENDER, 'audit@nowhere.test');
  const tok = recipients(db)[0].signing_token;
  const audit = db.prepare('SELECT * FROM esign_audit_events').all();
  const activity = db.prepare('SELECT * FROM activity_logs').all();
  assert.ok(audit.length >= 2, 'envelope_created and the mail row were written');
  assert.ok(!JSON.stringify(audit).includes(tok), 'the token is in esign_audit_events');
  assert.ok(!JSON.stringify(activity).includes(tok), 'the token is in activity_logs');
});

test('the envelope_created row names the sender and their address, not "admin"', async () => {
  const db = freshDb(); const e = envFor(db);
  await call(e, 'POST', '/send', SENDER,
    { document_type: DOC, recipient_email: 'ip@nowhere.test', provider: 'native' },
    { 'CF-Connecting-IP': '203.0.113.9' });
  const row: any = db.prepare(`SELECT * FROM esign_audit_events WHERE action = 'envelope_created'`).get();
  assert.equal(row.ip, '203.0.113.9');
  const meta = JSON.parse(row.meta);
  assert.equal(meta.sender, 'Sam Sender');
  assert.equal('admin' in meta, false);
});

test('GET /:id redacts a signing URL an older audit row still carries', async () => {
  const db = freshDb(); const e = envFor(db);
  const s = await send(e, SENDER, 'legacy@nowhere.test');
  // What every `email_sent` row looked like before D410.
  db.prepare(
    `INSERT INTO esign_audit_events (envelope_id, ts, signer_email, action, ip, meta) VALUES (?, ?, ?, 'email_sent', 'system', ?)`
  ).run(s.body.envelope_id, new Date().toISOString(), 'legacy@nowhere.test',
    JSON.stringify({ signing_url: 'https://app.example.test/esign/' + 'f'.repeat(64), merge_keys_applied: [] }));
  const r = await call(e, 'GET', `/${s.body.envelope_id}`, SENDER);
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r.body).includes('f'.repeat(64)), 'the legacy link was served back');
  assert.ok(r.body.audit_log.some((a: any) => a.meta?.signing_url_redacted === true));
});

// ---------- 4. download and forward: one scope, 404 outside it ----------

function completedEnvelope(db: any, createdBy: number, userId: number | null, recipientUser: number | null = null) {
  const id = Number(db.prepare(
    `INSERT INTO esign_envelopes (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by, signed_r2_key)
     VALUES (?, ?, 'founder_nda_v1', 'NDA', 'body', 'x', 'completed', ?, ?)`
  ).run(crypto.randomUUID(), userId, createdBy, 'esign/signed/test.pdf').lastInsertRowid);
  db.prepare(
    `INSERT INTO esign_recipients (envelope_id, user_id, recipient_email, signing_token, token_expires_at, status)
     VALUES (?, ?, 'r@nowhere.test', ?, '2099-01-01T00:00:00Z', 'signed')`
  ).run(id, recipientUser, 'a'.repeat(32) + String(id).padStart(32, '0'));
  return id;
}

test('the sender can download what they sent; before D410 this was a 403', async () => {
  const db = freshDb(); const e = envFor(db);
  await send(e, SENDER, 'warmup@nowhere.test');   // creates the tables
  const id = completedEnvelope(db, SENDER, null);
  const r = await call(e, 'GET', `/${id}/document`, SENDER);
  assert.equal(r.status, 200);
});

test('a recipient with an account can download it too', async () => {
  const db = freshDb(); const e = envFor(db);
  await send(e, SENDER, 'warmup@nowhere.test');
  const id = completedEnvelope(db, SENDER, null, RECIPIENT);
  assert.equal((await call(e, 'GET', `/${id}/document`, RECIPIENT)).status, 200);
});

test('outside the scope, download and both forward routes answer exactly as for an id that does not exist', async () => {
  const db = freshDb(); const e = envFor(db);
  await send(e, SENDER, 'warmup@nowhere.test');
  const id = completedEnvelope(db, SENDER, null);
  const missing = 999999;
  for (const [method, suffix, body] of [
    ['GET', '/document', undefined],
    ['GET', '/forward', undefined],
    ['POST', '/forward', { recipients: ['counsel@nowhere.test'] }],
  ] as const) {
    const theirs = await call(e, method, `/${id}${suffix}`, STRANGER, body);
    const absent = await call(e, method, `/${missing}${suffix}`, STRANGER, body);
    assert.equal(theirs.status, 404, `${method} ${suffix} leaked with ${theirs.status}`);
    assert.deepEqual(theirs, absent, `${method} ${suffix} tells an existing id from a missing one`);
  }
  // And nothing was forwarded on the stranger's say-so.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM esign_forward_log').get().n, 0);
});

test('the sender reads the forward log of what they sent', async () => {
  const db = freshDb(); const e = envFor(db);
  await send(e, SENDER, 'warmup@nowhere.test');
  const id = completedEnvelope(db, SENDER, null);
  const r = await call(e, 'GET', `/${id}/forward`, SENDER);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.forwards, []);
});

// ---------- 5. the sender hears it is done ----------

// A 1×1 PNG: the smallest drawing pdf-lib will embed.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('when the last signer signs, the sender is notified as well as the subject', async () => {
  const db = freshDb(); const e = envFor(db);
  await send(e, SENDER, 'investor@example.test');
  const [rec] = recipients(db);
  const r = await call(e, 'POST', `/sign/${rec.signing_token}`, RECIPIENT, {
    accepted: true, typed_name: 'Ivy Investor', signature_data_url: PNG,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.completed, true);
  const inbox = db.prepare(`SELECT user_id, type, link FROM notifications_inbox ORDER BY user_id`).all();
  assert.deepEqual(inbox.map((n: any) => n.user_id), [SENDER, RECIPIENT], 'one notice each for the sender and the subject');
  assert.ok(inbox.every((n: any) => n.type === 'contract_signed'));
  assert.equal(inbox.find((n: any) => n.user_id === SENDER).link, '/account');
});

test('a sender who is also the subject is notified once, not twice', async () => {
  const db = freshDb(); const e = envFor(db);
  await send(e, SENDER, 'sender@example.test');   // to themselves
  const [rec] = recipients(db);
  const r = await call(e, 'POST', `/sign/${rec.signing_token}`, SENDER, {
    accepted: true, typed_name: 'Sam Sender', signature_data_url: PNG,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const n = db.prepare(`SELECT COUNT(*) AS n FROM notifications_inbox WHERE user_id = ?`).get(SENDER).n;
  assert.equal(n, 1);
});

// ---------- the forward route's pattern ----------
// The bucket itself (fail-closed, per user, and that it calls this pattern) is
// pinned beside the rest of esign_send in rateLimit_esign_send.test.ts.

test('ESIGN_FORWARD matches the forward route under both mounts, and nothing else', () => {
  for (const p of ['/api/legal/esign/1/forward', '/api/legal/esign/99417/forward', '/api/esign/42/forward']) {
    assert.ok(ESIGN_FORWARD.test(p), `${p} mails a PDF and is not capped`);
  }
  for (const p of [
    '/api/legal/esign/42/forward/x',
    '/api/legal/esign/42/document',
    '/api/legal/esign/abc/forward',
    '/api/legal/esign/sign/42/forward',
    '/api/legal/esign/42/1/forward',
    '/x/api/legal/esign/42/forward',
  ]) assert.ok(!ESIGN_FORWARD.test(p), `${p} should not be in the bucket`);
  // Stateless: a /g or /y flag advances lastIndex, so every second call on
  // the same path would miss the bucket. Ask three times in a row.
  for (let i = 0; i < 3; i++) {
    assert.ok(ESIGN_FORWARD.test('/api/legal/esign/7/forward'), `call ${i + 1} missed`);
  }
  assert.equal(ESIGN_FORWARD.flags.includes('g') || ESIGN_FORWARD.flags.includes('y'), false);
});
