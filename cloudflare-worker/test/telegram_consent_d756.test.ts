/**
 * D756 (#1977) — the interviewee's consent in the Telegram chat: the notice,
 * the member's pasted copy, YES, NO and STOP, through D754's consent store
 * (#1893). On the SQLite D1 harness; Telegram's Bot API is a mocked
 * `globalThis.fetch` (an unexpected URL fails the test, nothing is sent live).
 *
 * What these prove:
 *   · The notice goes from the member's business connection, once per key,
 *     only with the reply right, inside the window, on a chat not ignored and
 *     a bot not switched off; it is kept as the member's message.
 *   · The member's own pasted notice records the request, with no reply right
 *     and outside the window.
 *   · An answer counts only from the chat's own user — not the owner, an
 *     offline auto-reply or a business bot — when it is exactly YES, NO or
 *     STOP, replies to the notice or is the contact's first message after it,
 *     and arrives within 7 days. Edits never count. The message is also kept
 *     as chat text.
 *   · YES queues the held notes; NO queues none; STOP stops new ones.
 *   · The bot answers once per counted answer, only with the reply right.
 *   · No member's word for Telegram.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/telegram_consent_d756.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import { TELEGRAM_COPY } from '../src/services/channels/telegram.ts';
import {
  INTERVIEW, ME, TG_ME, call, count, ids, mockFetch, noSecretsSeen, now, ref, seen, tgHook, world, type Route,
} from './_channels_fixture.ts';

test.afterEach(() => { noSecretsSeen(); seen.length = 0; });

const CHAT = 8001;
const URL_V1 = 'https://axal.vc/privacy/interviews?n=1';

/** Telegram's Bot API: each sendMessage gets the next message id, from 9001. */
function telegram(extra: Route = () => undefined) {
  let next = 9000;
  const sends: any[] = [];
  const m = mockFetch((url, init) => {
    if (url.hostname !== 'api.telegram.org') return extra(url, init);
    if (url.pathname.endsWith('/sendMessage')) {
      const body = JSON.parse(String(init.body));
      sends.push(body);
      return { json: { ok: true, result: { message_id: ++next, date: 1 } } };
    }
    if (url.pathname.endsWith('/getFile')) return { json: { ok: true, result: { file_id: 'VOICE-1', file_size: 4000, file_path: 'voice/f.oga' } } };
    if (url.pathname.startsWith('/file/bot')) return { body: new Uint8Array(4000).fill(7), headers: { 'content-type': 'audio/ogg' } };
    return undefined;
  });
  return { ...m, sends };
}

let mid = 700;
/** A business message in the test chat. Default: from the chat's own user (the contact). */
function msg(o: {
  text?: string; voice?: unknown; from?: Record<string, unknown>; replyTo?: number; offline?: boolean; bot?: boolean; edited?: boolean; id?: number;
} = {}) {
  return {
    update_id: ++ids.update,
    [o.edited ? 'edited_business_message' : 'business_message']: {
      message_id: o.id ?? ++mid, business_connection_id: 'BC-ME', date: now(),
      chat: { id: CHAT, type: 'private', first_name: 'Sam' },
      from: o.from ?? { id: CHAT, is_bot: false, first_name: 'Sam', last_name: 'Okafor' },
      ...(o.voice ? { voice: o.voice } : { text: o.text ?? 'Hello.' }),
      ...(o.replyTo ? { reply_to_message: { message_id: o.replyTo, date: now(), chat: { id: CHAT, type: 'private' } } } : {}),
      ...(o.offline ? { is_from_offline: true } : {}),
      ...(o.bot ? { sender_business_bot: { id: 777, is_bot: true, first_name: 'Axal' } } : {}),
    },
  };
}
const OWNER = { id: Number(TG_ME), is_bot: false, first_name: 'Dana' };
const VOICE = { file_id: 'VOICE-1', duration: 5, mime_type: 'audio/ogg', file_size: 4000 };

async function seeded() {
  const w = await world({ seed: true });
  return w;
}

/** A Telegram chat with one contact message, and its uid. */
async function chat(env: any, text = 'We reconcile invoices by hand.'): Promise<string> {
  const f = telegram();
  try { assert.equal((await tgHook(env, msg({ text }))).status, 200); } finally { f.restore(); }
  return (await call(env, ME, 'GET', '/threads')).body.items.find((t: any) => t.provider === 'telegram').uid;
}

/** Ask from Axal; the notice's Telegram message id. */
async function ask(env: any, uid: string): Promise<number> {
  const f = telegram();
  try {
    const r = await call(env, ME, 'POST', `/threads/${uid}/consent-request`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return 9001;
  } finally { f.restore(); }
}

const row = (db: any, uid: string) => db.prepare(
  `SELECT c.* FROM channel_consents c JOIN channel_threads t ON t.id = c.thread_id WHERE t.uid = ? ORDER BY c.id DESC LIMIT 1`,
).get(uid);
const thread = (db: any, uid: string) => db.prepare('SELECT * FROM channel_threads WHERE uid = ?').get(uid);
const voiceJobs = (queued: any[]) => queued.filter((j) => j.job_type === 'channel_followup' && j.payload.kind === 'voice');
const consentJobs = (queued: any[]) => queued.filter((j) => j.job_type === 'channel_followup' && j.payload.kind === 'consent');
async function runConsentJobs(env: any, queued: any[]) {
  for (const j of consentJobs(queued)) await runChannelJob(env, 'channel_followup', j.payload);
}
async function hook(env: any, update: unknown) {
  const f = telegram();
  try { return { res: await tgHook(env, update), sends: f.sends }; } finally { f.restore(); }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

test('dispatch: the notice goes once, from the member\'s business connection, kept as their message; the request records it', async () => {
  const { env, db } = await seeded();
  const uid = await chat(env);
  const f = telegram();
  try {
    const r = await call(env, ME, 'POST', `/threads/${uid}/consent-request`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.consent.status, 'requested');
    assert.equal(f.sends.length, 1);
    assert.equal(f.sends[0].business_connection_id, 'BC-ME');
    assert.equal(String(f.sends[0].chat_id), String(CHAT));
    assert.equal(f.sends[0].text, TELEGRAM_COPY.consentNotice('Sam', null, URL_V1));
    assert.ok(f.sends[0].text.startsWith('Hi Sam. I\'d like to record this chat for my customer research at my venture.'));
    const again = await call(env, ME, 'POST', `/threads/${uid}/consent-request`);
    assert.deepEqual([again.status, again.body.code], [409, 'too_soon']);
    assert.equal(f.sends.length, 1, 'a repeat never sends twice');
  } finally { f.restore(); }
  const ob = db.prepare('SELECT client_key, status FROM channel_outbound').all();
  assert.deepEqual(ob.map((o: any) => [o.client_key, o.status]), [[`consent:${uid}:v1:1`, 'submitted']]);
  const c = row(db, uid);
  assert.equal(c.provider, 'telegram');
  assert.equal(c.request_ref_hash, ref('telegram', `${CHAT}:9001`));
  assert.equal(thread(db, uid).consent_state, 'awaiting');
  assert.equal(count(db, `SELECT COUNT(*) n FROM channel_thread_messages WHERE direction = 'out'`), 1, 'the notice is the member\'s message');
});

test('dispatch: each refusal, and nothing sent', async () => {
  for (const [code, setup] of [
    ['no_reply_right', (db: any) => db.exec(`UPDATE telegram_business_connections SET can_reply = 0`)],
    ['connection_disabled', (db: any) => db.exec(`UPDATE telegram_business_connections SET is_enabled = 0`)],
    ['window_closed', (db: any) => db.exec(`UPDATE channel_threads SET last_inbound_at = datetime('now', '-25 hours')`)],
    ['thread_ignored', (db: any) => db.exec(`UPDATE channel_threads SET status = 'ignored'`)],
  ] as const) {
    const { env, db } = await seeded();
    const uid = await chat(env);
    setup(db);
    const f = telegram();
    try {
      const r = await call(env, ME, 'POST', `/threads/${uid}/consent-request`);
      assert.deepEqual([r.status, r.body.code], [409, code], code);
      assert.equal(f.sends.length, 0, `${code}: nothing sent`);
    } finally { f.restore(); }
  }
});

test('the copy path: the member\'s own pasted notice records the request, without the reply right and outside the window', async () => {
  const { env, db } = await seeded();
  const uid = await chat(env);
  db.exec(`UPDATE telegram_business_connections SET can_reply = 0`);
  db.exec(`UPDATE channel_threads SET last_inbound_at = datetime('now', '-3 days')`);
  const pasted = msg({ from: OWNER, text: TELEGRAM_COPY.consentNotice('Sam', 'Ledger tool', URL_V1), id: 5000 });
  const { sends } = await hook(env, pasted);
  assert.equal(sends.length, 0);
  const c = row(db, uid);
  assert.equal(c.status, 'requested');
  assert.equal(c.request_ref_hash, ref('telegram', `${CHAT}:5000`));
  assert.equal(thread(db, uid).consent_state, 'awaiting');
  // Another version's link records nothing.
  const { env: env2, db: db2 } = await seeded();
  const uid2 = await chat(env2);
  await hook(env2, msg({ from: OWNER, text: 'See https://axal.vc/privacy/interviews?n=2' }));
  assert.equal(row(db2, uid2), undefined);
  // The answer to a pasted notice counts like one to Axal's.
  await hook(env, msg({ text: 'yes', replyTo: 5000 }));
  assert.equal(row(db, uid).status, 'given');
});

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

test('YES as a reply to the notice gives consent, is kept as chat text, queues the held notes once, and the bot thanks them once', async () => {
  const { env, db, queued } = await seeded();
  const uid = await chat(env);
  const a = await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW });
  assert.equal(a.status, 200);
  assert.equal(a.body.moved, 1, 'Telegram text keeps D684\'s rule');
  await hook(env, msg({ voice: VOICE }));
  assert.equal(voiceJobs(queued).length, 0, 'no note queued before YES');
  const notice = await ask(env, uid);
  const { sends } = await hook(env, msg({ text: 'Yes.', replyTo: notice }));
  const c = row(db, uid);
  assert.deepEqual([c.status, c.source, c.method, c.provider], ['given', 'interviewee_reply', 'chat_reply', 'telegram']);
  const s = db.prepare('SELECT consent_status, consent_method FROM interview_sessions WHERE id = ?').get(a.body.session_id);
  assert.deepEqual([s.consent_status, s.consent_method], ['given', 'chat_reply']);
  const texts = db.prepare('SELECT text FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(a.body.session_id).map((r: any) => r.text);
  assert.equal(texts.at(-1), 'Yes.', 'the answer is ordinary chat text too');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].text, TELEGRAM_COPY.consentYes('Ledger tool'));
  await runConsentJobs(env, queued);
  assert.equal(voiceJobs(queued).length, 1, 'the held note is queued');
  await runConsentJobs(env, queued);
  assert.equal(voiceJobs(queued).length, 1, 'once');
  // A later note is covered.
  await hook(env, msg({ voice: { ...VOICE, file_id: 'VOICE-2' } }));
  assert.equal(voiceJobs(queued).length, 2);
});

test('YES on a pending chat waits on the thread and is copied to the session at assignment, with its notes', async () => {
  const { env, db, queued } = await seeded();
  const uid = await chat(env);
  await hook(env, msg({ voice: VOICE }));
  const notice = await ask(env, uid);
  await hook(env, msg({ text: 'YES', replyTo: notice }));
  await runConsentJobs(env, queued);
  assert.equal(thread(db, uid).consent_state, 'given');
  assert.equal(voiceJobs(queued).length, 0, 'a pending chat queues nothing');
  const a = await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW });
  assert.equal(a.body.voice_queued, 1);
  const s = db.prepare('SELECT consent_status, consent_method FROM interview_sessions WHERE id = ?').get(a.body.session_id);
  assert.deepEqual([s.consent_status, s.consent_method], ['given', 'chat_reply']);
  assert.equal(row(db, uid).session_id, a.body.session_id, 'the row takes its first session');
});

test('the first message after the notice counts without replying to it; after another contact message it does not', async () => {
  const { env, db } = await seeded();
  const uid = await chat(env);
  db.exec(`UPDATE channel_threads SET last_inbound_at = datetime('now', '-5 minutes')`);
  await ask(env, uid);
  await hook(env, msg({ text: 'yes' }));
  assert.equal(row(db, uid).status, 'given');

  const { env: env2, db: db2 } = await seeded();
  const uid2 = await chat(env2);
  db2.exec(`UPDATE channel_threads SET last_inbound_at = datetime('now', '-5 minutes')`);
  await ask(env2, uid2);
  await hook(env2, msg({ text: 'Let me think about it.' }));
  await hook(env2, msg({ text: 'yes' }));
  assert.equal(row(db2, uid2).status, 'requested', 'not a reply, and not the first message after the notice');
});

test('each rule failing once leaves the request open, and the message is kept as text', async () => {
  const cases: Array<[string, (n: number) => unknown]> = [
    ['the owner\'s own YES', (n) => msg({ from: OWNER, text: 'YES', replyTo: n })],
    ['an offline auto-reply', (n) => msg({ text: 'YES', replyTo: n, offline: true })],
    ['a business bot', (n) => msg({ from: { id: 777, is_bot: true, first_name: 'Axal' }, bot: true, text: 'YES', replyTo: n })],
    ['"yes please"', (n) => msg({ text: 'yes please', replyTo: n })],
    ['"yes!!"', (n) => msg({ text: 'yes!!', replyTo: n })],
    ['an edit', (n) => msg({ text: 'YES', replyTo: n, edited: true, id: 701 })],
  ];
  for (const [name, update] of cases) {
    const { env, db } = await seeded();
    const uid = await chat(env);
    const notice = await ask(env, uid);
    const { sends } = await hook(env, update(notice));
    assert.equal(row(db, uid).status, 'requested', name);
    assert.equal(sends.length, 0, `${name}: no bot reply`);
  }
  // Day 8.
  const { env, db } = await seeded();
  const uid = await chat(env);
  const notice = await ask(env, uid);
  db.exec(`UPDATE channel_consents SET requested_at = datetime('now', '-8 days')`);
  await hook(env, msg({ text: 'YES', replyTo: notice }));
  assert.equal(row(db, uid).status, 'requested', 'too late');
  assert.ok(count(db, `SELECT COUNT(*) n FROM channel_thread_messages WHERE direction = 'in'`) >= 2, 'kept as ordinary text');
});

test('NO queues no note and keeps the chat; STOP after YES stops a new note; the bot says so once each', async () => {
  const { env, db, queued } = await seeded();
  const uid = await chat(env);
  await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW });
  await hook(env, msg({ voice: VOICE }));
  const notice = await ask(env, uid);
  const no = await hook(env, msg({ text: 'No', replyTo: notice }));
  assert.equal(row(db, uid).status, 'declined');
  const t = thread(db, uid);
  assert.deepEqual([t.status, t.consent_state], ['assigned', 'declined'], 'the chat is not set aside');
  assert.equal(voiceJobs(queued).length, 0);
  assert.equal(count(db, `SELECT COUNT(*) n FROM channel_thread_messages WHERE voice_ref_enc IS NOT NULL`), 1, 'the note stays held');
  assert.deepEqual(no.sends.map((s: any) => s.text), [TELEGRAM_COPY.consentNo]);

  const { env: e2, db: d2, queued: q2 } = await seeded();
  const u2 = await chat(e2);
  await call(e2, ME, 'POST', `/threads/${u2}/assign`, { interview_id: INTERVIEW });
  const n2 = await ask(e2, u2);
  await hook(e2, msg({ text: 'yes', replyTo: n2 }));
  const stop = await hook(e2, msg({ text: 'STOP' }));
  assert.equal(row(d2, u2).status, 'withdrawn');
  assert.deepEqual(stop.sends.map((s: any) => s.text), [TELEGRAM_COPY.consentStop]);
  await hook(e2, msg({ voice: { ...VOICE, file_id: 'VOICE-9' } }));
  assert.equal(voiceJobs(q2).length, 0, 'STOP stops new notes');
  await hook(e2, msg({ text: 'Still here.' }));
  assert.equal(count(d2, `SELECT COUNT(*) n FROM interview_transcript_segments WHERE text = 'Still here.'`), 1, 'the text keeps flowing');
});

test('the bot\'s replies: none without the reply right, none for an unclear reply, one per answer on a redelivery', async () => {
  const { env, db } = await seeded();
  const uid = await chat(env);
  const notice = await ask(env, uid);
  const unclear = await hook(env, msg({ text: 'maybe', replyTo: notice }));
  assert.equal(unclear.sends.length, 0);
  db.exec(`UPDATE telegram_business_connections SET can_reply = 0`);
  const yes = msg({ text: 'yes', replyTo: notice });
  const first = await hook(env, yes);
  assert.equal(row(db, uid).status, 'given');
  assert.equal(first.sends.length, 0, 'no reply right, no reply');
  db.exec(`UPDATE telegram_business_connections SET can_reply = 1`);
  db.exec('DELETE FROM channel_events');
  const again = await hook(env, yes);
  assert.equal(again.sends.length, 0, 'a redelivered answer is a duplicate: no reply');
});

test('no member\'s word for Telegram', async () => {
  const { env } = await seeded();
  const uid = await chat(env);
  await ask(env, uid);
  const r = await call(env, ME, 'POST', `/threads/${uid}/consent`, { method: 'verbal' });
  assert.deepEqual([r.status, r.body.code], [409, 'attestation_not_offered']);
});

test('without consent the voice job fetches nothing and says why', async () => {
  const { env, db, queued } = await seeded();
  const uid = await chat(env);
  await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW });
  db.exec(`UPDATE channel_threads SET consent_state = 'given'`);
  await hook(env, msg({ voice: VOICE }));
  const [job] = voiceJobs(queued);
  db.exec(`UPDATE channel_threads SET consent_state = 'withdrawn'`);
  const f = telegram();
  try {
    await runChannelJob(env, 'channel_followup', job.payload);
    assert.equal(f.calls.length, 0, 'no getFile, no download');
  } finally { f.restore(); }
  const note = (await call(env, ME, 'GET', `/threads/${uid}`)).body.messages.find((m: any) => m.awaiting_transcription);
  assert.equal(note.transcription_failure.reason, 'no_consent');
});
