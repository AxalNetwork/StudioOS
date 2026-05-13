/**
 * Task #12 — Reminder endpoint reject-paths + backfillJoinedStatus.
 *
 * Loads the real `POST /api/email/invites/:id/remind` handler and the
 * `backfillJoinedStatus` helper out of `cloudflare-worker/src/routes/email.ts`
 * by string-extract + `new Function`, mirroring the pattern used by
 * `projects.test.mjs` and `referral_join_notify.test.mjs`. We exercise the
 * EXACT source bytes shipped to Cloudflare so a future edit that loosens
 * a guard (e.g. drops the cooldown check, swaps the KV bucket key,
 * renames `RATE_LIMITS`) fails CI.
 *
 * Coverage matrix per task:
 *   - 200 success path (KV bump + DB update + activity log)
 *   - 403 forbidden  (other sender)
 *   - 400 already-joined
 *   - 400 original-send-failed
 *   - 429 cooldown   (last_reminded_at within REMINDER_COOLDOWN_HOURS)
 *   - 429 daily cap  (KV usedToday >= DAILY_REMINDER_LIMIT)
 *   - 404 not found  (defensive — sanity, also exercises the lookup path)
 *   - 400 invalid id (negative / non-numeric)
 *   - backfillJoinedStatus(): out-of-band registration → row stamped
 *
 * Run with:  node --test cloudflare-worker/test/invite_reminder_limits.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/* Source extractor — pulls the constants + handler body + helper.    */
/* ------------------------------------------------------------------ */
async function loadSource() {
  const srcPath = resolve(__dirname, '../src/routes/email.ts');
  return await readFile(srcPath, 'utf8');
}

function formatDBTimestamp(date) {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function extractConst(src, name) {
  const m = src.match(new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`));
  assert.ok(m, `${name} const not found`);
  // Evaluate the RHS in a sandbox — the real file uses simple arithmetic
  // (e.g. `24 * 7`) so this is safe.
  // eslint-disable-next-line no-new-func
  return new Function(`return (${m[1]});`)();
}

function extractHandlerBody(src) {
  const start = src.indexOf("email.post('/invites/:id/remind'");
  assert.notEqual(start, -1, 'reminder handler not found');
  const arrow = src.indexOf('async (c) => {', start);
  assert.notEqual(arrow, -1, 'handler arrow not found');
  const open = src.indexOf('{', arrow);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  // Body BETWEEN the outer braces (exclusive).
  let body = src.slice(open + 1, i - 1);
  // Strip TS annotations + replace dependency lookups with injected stubs.
  body = body
    .replace(/:\s*any\b/g, '')
    .replace(/const user = await requireAuth\(c\);/, 'const user = __user;')
    .replace(/await ensureSchema\(c\.env\);?/g, '')
    .replace(
      /const\s*\{\s*hashEmail\s*\}\s*=\s*await import\('[^']+'\);/,
      'const hashEmail = __hashEmail;'
    );
  return body;
}

function extractBackfillBody(src) {
  const start = src.indexOf('async function backfillJoinedStatus(');
  assert.notEqual(start, -1, 'backfillJoinedStatus not found');
  const open = src.indexOf('{', start);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  let body = src.slice(start, i)
    .replace(/:\s*Promise<void>/g, '')
    .replace(/:\s*Env\b/g, '')
    .replace(/:\s*number\b/g, '')
    .replace(/:\s*any\b/g, '');
  return body;
}

async function loadHandler({ user, hashEmail, sendReferralInviteEmail }) {
  const src = await loadSource();
  const REMINDER_COOLDOWN_HOURS = extractConst(src, 'REMINDER_COOLDOWN_HOURS');
  const DAILY_REMINDER_LIMIT = extractConst(src, 'DAILY_REMINDER_LIMIT');
  const body = extractHandlerBody(src);
  // The handler references `sendReferralInviteEmail` by name — inject as
  // a closure variable. Same for the two top-level constants.
  const wrapped = `
    return async function runHandler(c, __user, __hashEmail) {
      const REMINDER_COOLDOWN_HOURS = ${REMINDER_COOLDOWN_HOURS};
      const DAILY_REMINDER_LIMIT = ${DAILY_REMINDER_LIMIT};
      ${body}
    };
  `;
  const fn = new Function('sendReferralInviteEmail', wrapped)(sendReferralInviteEmail);
  return { fn, user, hashEmail, REMINDER_COOLDOWN_HOURS, DAILY_REMINDER_LIMIT };
}

async function loadBackfill() {
  const src = await loadSource();
  const body = extractBackfillBody(src);
  const wrapped = `${body}; return backfillJoinedStatus;`;
  return new Function(wrapped)();
}

/* ------------------------------------------------------------------ */
/* Mock helpers                                                       */
/* ------------------------------------------------------------------ */
function makeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(k) { return store.has(k) ? String(store.get(k)) : null; },
    async put(k, v) { store.set(k, String(v)); },
  };
}

function makeDB({ invite, sender, activityLog = [], updates = [] }) {
  const state = { invite, sender, activityLog, updates };
  function prepare(rawSql) {
    const sql = String(rawSql).replace(/\s+/g, ' ').trim();
    let bindings = [];
    return {
      bind(...args) { bindings = args; return this; },
      async first() {
        if (sql.startsWith('SELECT id, sender_user_id, recipient_email')) {
          const [id] = bindings;
          return state.invite && state.invite.id === id ? state.invite : null;
        }
        if (sql.startsWith('SELECT name, email, referral_code FROM users')) {
          return state.sender;
        }
        throw new Error(`unexpected first(): ${sql}`);
      },
      async run() {
        if (sql.startsWith('UPDATE referral_invites SET reminder_count')) {
          state.updates.push({ kind: 'bump', id: bindings[0] });
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith('INSERT INTO activity_logs')) {
          state.activityLog.push({ bindings });
          return { meta: { changes: 1 } };
        }
        throw new Error(`unexpected run(): ${sql}`);
      },
    };
  }
  return { state, DB: { prepare } };
}

function makeCtx({ inviteId, env }) {
  const responses = [];
  const ctx = {
    env,
    req: { param: (k) => k === 'id' ? String(inviteId) : undefined },
    json(body, status = 200) {
      responses.push({ body, status });
      return { body, status };
    },
  };
  return { ctx, responses };
}

const SENDER_USER = { id: 7, role: 'founder', email: 'me@axal.io' };
const SENDER_ROW  = { name: 'Me', email: 'me@axal.io', referral_code: 'AXC123' };
const fakeHash = async (e) => `h${(e || '').length.toString(16)}deadbeef0000000`;
const okSend = async () => true;
const failSend = async () => false;

/* ------------------------------------------------------------------ */
/* Tests                                                              */
/* ------------------------------------------------------------------ */

test('200 — success bumps KV + DB + activity log', async () => {
  const { fn } = await loadHandler({ user: SENDER_USER, hashEmail: fakeHash, sendReferralInviteEmail: okSend });
  const kv = makeKV();
  const { DB, state } = makeDB({
    invite: { id: 11, sender_user_id: 7, recipient_email: 'a@b.co', recipient_name: 'A',
              referral_code: 'AXC123', personal_message: 'hi', status: 'sent',
              signed_up_user_id: null, reminder_count: 2, last_reminded_at: null },
    sender: SENDER_ROW,
  });
  const env = { DB, RATE_LIMITS: kv, APP_URL: 'https://axal.vc' };
  const { ctx, responses } = makeCtx({ inviteId: 11, env });
  await fn(ctx, SENDER_USER, fakeHash);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].body.ok, true);
  assert.equal(responses[0].body.invite_id, 11);
  assert.equal(responses[0].body.reminder_count, 3, 'bump increments existing count');
  // KV bucket bumped by exactly 1 under the documented key shape.
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  assert.equal(kv.store.get(`invite_reminders:daily:7:${today}`), '1');
  assert.equal(state.updates.length, 1);
  assert.equal(state.activityLog.length, 1);
  // Activity log binds: (action, details, actor, user_id) — actor MUST be
  // the hashed sender email (T22.1), NOT plaintext.
  const [action, details, actor, userId] = state.activityLog[0].bindings;
  assert.equal(action, 'invite_reminder_sent');
  assert.equal(userId, 7);
  assert.equal(actor, await fakeHash(SENDER_ROW.email),
    'activity_logs.actor must be the hashed sender email');
  assert.doesNotMatch(actor, /@/, 'actor must not contain plaintext email');
  const parsedDetails = JSON.parse(details);
  assert.equal(parsedDetails.invite_id, 11);
  assert.equal(parsedDetails.reminder_count, 3);
});

test('400 — sender row is missing referral_code (must visit Refer & Earn first)', async () => {
  const { fn } = await loadHandler({ user: SENDER_USER, hashEmail: fakeHash, sendReferralInviteEmail: okSend });
  const kv = makeKV();
  const { DB } = makeDB({
    invite: { id: 19, sender_user_id: 7, recipient_email: 'a@b.co', status: 'sent',
              signed_up_user_id: null, reminder_count: 0, last_reminded_at: null,
              referral_code: 'X', personal_message: '', recipient_name: '' },
    sender: { name: 'Me', email: 'me@axal.io', referral_code: null },
  });
  const { ctx, responses } = makeCtx({ inviteId: 19, env: { DB, RATE_LIMITS: kv, APP_URL: 'https://axal.vc' } });
  await fn(ctx, SENDER_USER, fakeHash);
  assert.equal(responses[0].status, 400);
  assert.match(responses[0].body.error, /referral code/i);
  assert.equal(kv.store.size, 0, 'no KV write when sender lacks a referral code');
});

test('403 — different sender cannot remind another user\'s invite', async () => {
  const { fn } = await loadHandler({ user: SENDER_USER, hashEmail: fakeHash, sendReferralInviteEmail: okSend });
  const kv = makeKV();
  const { DB } = makeDB({
    invite: { id: 12, sender_user_id: 99 /* not 7 */, recipient_email: 'a@b.co',
              status: 'sent', signed_up_user_id: null, reminder_count: 0, last_reminded_at: null,
              referral_code: 'X', personal_message: '', recipient_name: '' },
    sender: SENDER_ROW,
  });
  const { ctx, responses } = makeCtx({ inviteId: 12, env: { DB, RATE_LIMITS: kv, APP_URL: 'https://axal.vc' } });
  await fn(ctx, SENDER_USER, fakeHash);
  assert.equal(responses[0].status, 403);
  assert.equal(kv.store.size, 0, 'no KV write on 403');
});

test('400 — recipient already joined', async () => {
  const { fn } = await loadHandler({ user: SENDER_USER, hashEmail: fakeHash, sendReferralInviteEmail: okSend });
  const kv = makeKV();
  const { DB } = makeDB({
    invite: { id: 13, sender_user_id: 7, recipient_email: 'a@b.co', status: 'joined',
              signed_up_user_id: 50, reminder_count: 0, last_reminded_at: null,
              referral_code: 'X', personal_message: '', recipient_name: '' },
    sender: SENDER_ROW,
  });
  const { ctx, responses } = makeCtx({ inviteId: 13, env: { DB, RATE_LIMITS: kv, APP_URL: 'https://axal.vc' } });
  await fn(ctx, SENDER_USER, fakeHash);
  assert.equal(responses[0].status, 400);
  assert.match(responses[0].body.error, /already joined/i);
  assert.equal(kv.store.size, 0);
});

test('400 — original send failed cannot be reminded (must re-send)', async () => {
  const { fn } = await loadHandler({ user: SENDER_USER, hashEmail: fakeHash, sendReferralInviteEmail: okSend });
  const kv = makeKV();
  const { DB } = makeDB({
    invite: { id: 14, sender_user_id: 7, recipient_email: 'a@b.co', status: 'failed',
              signed_up_user_id: null, reminder_count: 0, last_reminded_at: null,
              referral_code: 'X', personal_message: '', recipient_name: '' },
    sender: SENDER_ROW,
  });
  const { ctx, responses } = makeCtx({ inviteId: 14, env: { DB, RATE_LIMITS: kv, APP_URL: 'https://axal.vc' } });
  await fn(ctx, SENDER_USER, fakeHash);
  assert.equal(responses[0].status, 400);
  assert.match(responses[0].body.error, /failed/i);
  assert.equal(kv.store.size, 0);
});

test('429 — cooldown: last_reminded_at within 7d window', async () => {
  const { fn, REMINDER_COOLDOWN_HOURS } = await loadHandler({ user: SENDER_USER, hashEmail: fakeHash, sendReferralInviteEmail: okSend });
  // Pretend the last reminder was 1 hour ago — well inside the cooldown.
  const oneHourAgo = formatDBTimestamp(new Date(Date.now() - 3600 * 1000));
  const kv = makeKV();
  const { DB } = makeDB({
    invite: { id: 15, sender_user_id: 7, recipient_email: 'a@b.co', status: 'sent',
              signed_up_user_id: null, reminder_count: 1, last_reminded_at: oneHourAgo,
              referral_code: 'X', personal_message: '', recipient_name: '' },
    sender: SENDER_ROW,
  });
  const { ctx, responses } = makeCtx({ inviteId: 15, env: { DB, RATE_LIMITS: kv, APP_URL: 'https://axal.vc' } });
  await fn(ctx, SENDER_USER, fakeHash);
  assert.equal(responses[0].status, 429);
  assert.match(responses[0].body.error, /cooldown/i);
  assert.ok(responses[0].body.retry_after, 'retry_after timestamp must be returned');
  // retry_after = last_reminded_at + cooldown. Last was ~1h ago so the
  // gate should reopen ~(cooldown - 1h) from now.
  const retry = Date.parse(responses[0].body.retry_after);
  const expected = Date.now() + (REMINDER_COOLDOWN_HOURS - 1) * 3600 * 1000;
  assert.ok(Math.abs(retry - expected) < 5 * 60 * 1000, 'retry_after within ~5min of expected');
  assert.equal(kv.store.size, 0);
});

test('cooldown EXPIRED (older than 7d) is allowed through', async () => {
  const { fn, REMINDER_COOLDOWN_HOURS } = await loadHandler({ user: SENDER_USER, hashEmail: fakeHash, sendReferralInviteEmail: okSend });
  const long = (REMINDER_COOLDOWN_HOURS + 1) * 3600 * 1000;
  const old = new Date(Date.now() - long).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const kv = makeKV();
  const { DB } = makeDB({
    invite: { id: 16, sender_user_id: 7, recipient_email: 'a@b.co', status: 'sent',
              signed_up_user_id: null, reminder_count: 1, last_reminded_at: old,
              referral_code: 'X', personal_message: '', recipient_name: '' },
    sender: SENDER_ROW,
  });
  const { ctx, responses } = makeCtx({ inviteId: 16, env: { DB, RATE_LIMITS: kv, APP_URL: 'https://axal.vc' } });
  await fn(ctx, SENDER_USER, fakeHash);
  assert.equal(responses[0].status, 200);
});

test('429 — daily cap: KV usedToday at limit blocks further reminds', async () => {
  const { fn, DAILY_REMINDER_LIMIT } = await loadHandler({ user: SENDER_USER, hashEmail: fakeHash, sendReferralInviteEmail: okSend });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const kv = makeKV({ [`invite_reminders:daily:7:${today}`]: String(DAILY_REMINDER_LIMIT) });
  const { DB } = makeDB({
    invite: { id: 17, sender_user_id: 7, recipient_email: 'a@b.co', status: 'sent',
              signed_up_user_id: null, reminder_count: 0, last_reminded_at: null,
              referral_code: 'X', personal_message: '', recipient_name: '' },
    sender: SENDER_ROW,
  });
  const { ctx, responses } = makeCtx({ inviteId: 17, env: { DB, RATE_LIMITS: kv, APP_URL: 'https://axal.vc' } });
  await fn(ctx, SENDER_USER, fakeHash);
  assert.equal(responses[0].status, 429);
  assert.match(responses[0].body.error, new RegExp(`${DAILY_REMINDER_LIMIT}/day`));
  // KV must not have been bumped past the limit.
  assert.equal(kv.store.get(`invite_reminders:daily:7:${today}`), String(DAILY_REMINDER_LIMIT));
});

test('502 + KV refund when email provider rejects the send', async () => {
  const { fn } = await loadHandler({ user: SENDER_USER, hashEmail: fakeHash, sendReferralInviteEmail: failSend });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const kv = makeKV();
  const { DB, state } = makeDB({
    invite: { id: 18, sender_user_id: 7, recipient_email: 'a@b.co', status: 'sent',
              signed_up_user_id: null, reminder_count: 0, last_reminded_at: null,
              referral_code: 'X', personal_message: '', recipient_name: '' },
    sender: SENDER_ROW,
  });
  const { ctx, responses } = makeCtx({ inviteId: 18, env: { DB, RATE_LIMITS: kv, APP_URL: 'https://axal.vc' } });
  await fn(ctx, SENDER_USER, fakeHash);
  assert.equal(responses[0].status, 502);
  // Reservation refunded back to 0 — not stuck at 1 — so a retry is allowed.
  assert.equal(kv.store.get(`invite_reminders:daily:7:${today}`), '0');
  // No DB bump on failure.
  assert.equal(state.updates.length, 0);
});

test('404 — invite id not found in DB', async () => {
  const { fn } = await loadHandler({ user: SENDER_USER, hashEmail: fakeHash, sendReferralInviteEmail: okSend });
  const kv = makeKV();
  const { DB } = makeDB({ invite: null, sender: SENDER_ROW });
  const { ctx, responses } = makeCtx({ inviteId: 999, env: { DB, RATE_LIMITS: kv, APP_URL: 'https://axal.vc' } });
  await fn(ctx, SENDER_USER, fakeHash);
  assert.equal(responses[0].status, 404);
});

test('400 — invalid id (NaN / non-positive)', async () => {
  const { fn } = await loadHandler({ user: SENDER_USER, hashEmail: fakeHash, sendReferralInviteEmail: okSend });
  const kv = makeKV();
  const { DB } = makeDB({ invite: null, sender: SENDER_ROW });
  for (const bad of ['abc', '0', '-3']) {
    const ctx = {
      env: { DB, RATE_LIMITS: kv, APP_URL: 'https://axal.vc' },
      req: { param: () => bad },
      _resp: null,
      json(body, status = 200) { this._resp = { body, status }; return this._resp; },
    };
    await fn(ctx, SENDER_USER, fakeHash);
    assert.equal(ctx._resp.status, 400, `id="${bad}" must 400`);
  }
});

/* ------------------------------------------------------------------ */
/* backfillJoinedStatus — out-of-band registration is picked up.       */
/* ------------------------------------------------------------------ */
test('backfillJoinedStatus stamps signed_up_user_id when user exists', async () => {
  const backfill = await loadBackfill();
  const calls = [];
  const env = {
    DB: {
      prepare(sql) {
        const norm = String(sql).replace(/\s+/g, ' ').trim();
        let binds = [];
        return {
          bind(...a) { binds = a; return this; },
          async run() { calls.push({ sql: norm, binds }); return { meta: { changes: 1 } }; },
        };
      },
    },
  };
  await backfill(env, 7);
  assert.equal(calls.length, 1, 'one UPDATE issued');
  const { sql, binds } = calls[0];
  assert.match(sql, /^UPDATE referral_invites/);
  assert.match(sql, /SET signed_up_user_id = \(\s*SELECT u\.id FROM users u/);
  assert.match(sql, /status = 'joined'/);
  assert.match(sql, /WHERE sender_user_id = \?/);
  assert.match(sql, /AND signed_up_user_id IS NULL/);
  assert.match(sql, /AND EXISTS \(/);
  assert.deepEqual(binds, [7]);
});

test('backfillJoinedStatus swallows DB errors (best-effort)', async () => {
  const backfill = await loadBackfill();
  const env = {
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async run() { throw new Error('D1 transient'); },
        };
      },
    },
  };
  // Must resolve, not reject.
  await backfill(env, 7);
});
