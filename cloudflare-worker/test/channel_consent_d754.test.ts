/**
 * D754 (#1893) — consent before anything from a WhatsApp chat is kept: the
 * in-chat notice, the interviewee's reply, the member's word and the gate.
 * On the SQLite D1 harness, every provider call answered by a mocked
 * `globalThis.fetch` (an unexpected URL fails the test, so nothing reaches
 * Meta), with migration 488 loaded after the 449–458 set.
 *
 * What these prove:
 *   · A WhatsApp chat added to an interview keeps nothing there until the
 *     interviewee taps Yes, or replies YES to Axal's notice, or the member
 *     confirms after WhatsApp reported the notice delivered: no text moves,
 *     no voice note is queued or fetched, and Structure, Ask, the summary,
 *     finish and process answer the gate's 409.
 *   · Only the contact's own answer, on its own chat, to its own request's
 *     notice, counts — once. A bare "yes" or "no" is conversation; STOP
 *     counts anywhere once a notice went.
 *   · The notice goes only when asked, inside the window, at most twice and
 *     24 hours apart, from the member's own number, and carries the notice
 *     page's link; `consent:` client keys are the server's.
 *   · A decline deletes what waited; a withdrawal stops everything new,
 *     switches quotes off and refuses Structure, Ask and playback, and
 *     Discard removes the rest.
 *   · Re-links, the 30-day purge, disconnect and deleteSession keep the rule.
 *   · Telegram behaves exactly as before while its switch is off.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/channel_consent_d754.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Hono } from 'hono';
import founderValidateSessions from '../src/routes/founder_validate_sessions.ts';
import founderValidateStructure from '../src/routes/founder_validate_structure.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import { forgetConnection, purgeExpired, type ThreadRow } from '../src/services/channels/threads.ts';
import {
  attest, consentForThread, noticeText, openRequest, recordReply, withdraw,
} from '../src/services/channels/consent.ts';
import { CONSENT_NOTICE_VERSION, consentNoticeUrl } from '../src/services/channels/consentNotice.ts';
import { consentBlocks } from '../src/services/interviewSessions.ts';
import { sweepQuietChats } from '../src/services/sessionAutoStructure.ts';
import { normaliseWhatsAppPayload, GRAPH_BASE } from '../src/services/channels/whatsapp.ts';
import {
  INTERVIEW, JWT_SECRET, ME, OTHER, PNID, PNID_GONE, PROJECT, SECRET_VALUES, SECRETS, WA_CUSTOMER, WA_TOKEN,
  businessMessage, call, count, mockFetch, noSecretsSeen, now, ref, seen, sign, telegramApi, tgHook, waHook, waPayload, waText,
  world, type Route,
} from './_channels_fixture.ts';
import { SignJWT } from 'jose';

test.afterEach(() => { noSecretsSeen(); seen.length = 0; });

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** The Validate session and structure routes, mounted as index.ts mounts them. */
const validate = (() => {
  const a = new Hono();
  a.route('/api/founder/validate', founderValidateSessions as any);
  a.route('/api/founder/validate', founderValidateStructure as any);
  a.onError((err: any, c) => {
    const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
    if (st) return c.json({ detail: err.message }, st);
    console.error(err);
    return c.json({ detail: 'Internal server error' }, 500);
  });
  return a;
})();

async function vcall(env: any, method: string, path: string, body?: unknown) {
  const tok = await new SignJWT({ user_id: ME, role: 'founder' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const headers: Record<string, string> = { authorization: `Bearer ${tok}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await validate.fetch(new Request(`https://axal.vc/api/founder/validate${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  const text = await res.text();
  seen.push(text);
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

/** Meta's Graph API for these tests: the notice send, and nothing else unless a test adds it. */
function graph(extra: Route = () => undefined) {
  let n = 0;
  return mockFetch((url, init) => {
    if (url.hostname === 'graph.facebook.com' && url.pathname === `/v23.0/${PNID}/messages` && init.method === 'POST') {
      n += 1;
      return { json: { messaging_product: 'whatsapp', messages: [{ id: `wamid.NOTICE.${n}` }] } };
    }
    return extra(url, init);
  });
}

async function seeded() {
  const w = await world({ seed: true });
  // Discard (deleteSession) deletes the processing pipeline's tables too: the
  // world's applyEngineSchema (D757) applies 453 already.
  w.db.prepare(`UPDATE users SET name = 'Dana Ruiz' WHERE id = ?`).run(ME);
  return w;
}

/** A WhatsApp chat for ME, with `texts` from the customer, and its uid. */
async function waChat(env: any, texts: string[] = ['One.', 'Two.', 'Three.']): Promise<string> {
  for (const [i, t] of texts.entries()) await waHook(env, waText(PNID, `wamid.IN.${i}.${Math.random()}`, t));
  const items = (await call(env, ME, 'GET', '/threads')).body.items;
  return items.find((t: any) => t.provider === 'whatsapp').uid;
}
const waVoice = (wamid: string, media = 'MEDIA-1') => waPayload(PNID, {
  messages: [{ from: WA_CUSTOMER, id: wamid, timestamp: String(now()), type: 'audio', audio: { id: media, mime_type: 'audio/ogg', voice: true } }],
});
const button = (wamid: string, id: string, context: string | null, o: { from?: string; pnid?: string } = {}) => waPayload(o.pnid ?? PNID, {
  messages: [{
    from: o.from ?? WA_CUSTOMER, id: wamid, timestamp: String(now()), type: 'interactive',
    ...(context ? { context: { from: '15550001234', id: context } } : {}),
    interactive: { type: 'button_reply', button_reply: { id, title: id.startsWith('consent_yes') ? 'Yes, I agree' : 'No, thanks' } },
  }],
});
const typed = (wamid: string, text: string, context: string | null = null) => waPayload(PNID, {
  messages: [{ from: WA_CUSTOMER, id: wamid, timestamp: String(now()), type: 'text', text: { body: text }, ...(context ? { context: { from: '15550001234', id: context } } : {}) }],
});
const delivered = (wamid: string, status = 'delivered') => waPayload(PNID, {
  statuses: [{ id: wamid, status, timestamp: String(now()), recipient_id: WA_CUSTOMER }],
});

const threadRow = (db: any, uid: string): ThreadRow => db.prepare('SELECT * FROM channel_threads WHERE uid = ?').get(uid);
const consentRow = (db: any, uid: string) => db.prepare(
  `SELECT c.* FROM channel_consents c JOIN channel_threads t ON t.id = c.thread_id WHERE t.uid = ? ORDER BY c.id DESC LIMIT 1`,
).get(uid);
const sessionRow = (db: any, id: number) => db.prepare('SELECT * FROM interview_sessions WHERE id = ?').get(id);
const segs = (db: any, sessionId: number) => db.prepare('SELECT text FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(sessionId).map((r: any) => r.text);
const jobsOf = (queued: any[], type: string) => queued.filter((j) => j.job_type === type);
const pendingCount = (db: any, uid: string) => count(db,
  'SELECT COUNT(*) n FROM channel_thread_messages m JOIN channel_threads t ON t.id = m.thread_id WHERE t.uid = ?', uid);

/** Assign a WhatsApp chat to INTERVIEW: it links and waits. */
async function assigned(env: any, uid: string, extra: Record<string, unknown> = {}) {
  const a = await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW, ...extra });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  return a;
}

/** Ask for consent; the notice's wamid. */
async function asked(env: any, uid: string): Promise<string> {
  const g = graph();
  try {
    const r = await call(env, ME, 'POST', `/threads/${uid}/consent-request`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    return String(g.calls.length ? 'wamid.NOTICE.1' : '');
  } finally { g.restore(); }
}

/** Run every queued consent follow-up, as the queue would. */
async function runConsentJobs(env: any, queued: any[]) {
  for (const j of jobsOf(queued, 'channel_followup').filter((x) => x.payload.kind === 'consent')) {
    await runChannelJob(env, 'channel_followup', j.payload);
  }
}

// ---------------------------------------------------------------------------
// Nothing before 'given'
// ---------------------------------------------------------------------------

test('a WhatsApp chat added to an interview keeps nothing there before consent: no move, no voice note, no AI', async () => {
  const { env, db, queued, aiCalls } = await seeded();
  const uid = await waChat(env);
  await waHook(env, waVoice('wamid.V1'));
  const f = mockFetch(() => undefined);
  let a: any;
  try {
    a = await assigned(env, uid);
    assert.deepEqual([a.body.moved, a.body.voice_queued], [0, 0]);
    assert.equal(a.body.consent.status, 'not_asked');
    assert.equal(a.body.consent.required, true);
    assert.equal(segs(db, a.body.session_id).length, 0, 'no segment');
    assert.equal(jobsOf(queued, 'channel_followup').length, 0, 'no voice job');
    assert.equal(jobsOf(queued, 'session_structure').length, 0, 'no Structure job');
    // A later text and a later voice note stay pending too.
    await waHook(env, waText(PNID, 'wamid.LATER', 'Later.'));
    await waHook(env, waVoice('wamid.V2', 'MEDIA-2'));
    assert.equal(pendingCount(db, uid), 6);
    assert.equal(segs(db, a.body.session_id).length, 0);
    assert.equal(jobsOf(queued, 'channel_followup').length, 0);
    assert.equal(f.calls.length, 0, 'no Graph call');
  } finally { f.restore(); }

  const sid = a.body.session_id;
  for (const [method, path, body] of [
    ['POST', `/sessions/${sid}/structure`, {}], ['POST', `/sessions/${sid}/ask`, { question: 'What hurts?' }],
    ['POST', `/sessions/${sid}/summarise`, {}], ['POST', `/sessions/${sid}/process`, {}],
  ] as const) {
    const r = await vcall(env, method, path, body);
    assert.deepEqual([r.status, r.body.error], [409, 'consent_not_recorded'], path);
  }
  assert.equal(aiCalls.length, 0);
  const read = await call(env, ME, 'GET', `/threads/${uid}`);
  assert.equal(read.body.thread.consent_status, 'awaiting');
  assert.equal(read.body.consent.status, 'not_asked');
  const s = await vcall(env, 'GET', `/sessions/${sid}`);
  assert.equal(s.body.channel_consent.status, 'not_asked');
});

// ---------------------------------------------------------------------------
// The notice
// ---------------------------------------------------------------------------

test('the notice: one POST to the member\'s number with their token, two buttons, the exact words and the page link', async () => {
  const { env, db } = await seeded();
  const uid = await waChat(env);
  const a = await assigned(env, uid);
  const g = graph();
  try {
    const r = await call(env, ME, 'POST', `/threads/${uid}/consent-request`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.consent.status, 'requested');
    assert.equal(r.body.consent.notices_left, 1);
    assert.equal(g.calls.length, 1);
    const [c] = g.calls;
    assert.equal(c.url, `${GRAPH_BASE}/${PNID}/messages`);
    assert.equal(c.auth, `Bearer ${WA_TOKEN}`);
    assert.equal(c.body.type, 'interactive');
    assert.equal(c.body.to, WA_CUSTOMER);
    const row = consentRow(db, uid);
    assert.deepEqual(c.body.interactive.action.buttons, [
      { type: 'reply', reply: { id: `consent_yes:${row.uid}`, title: 'Yes, I agree' } },
      { type: 'reply', reply: { id: `consent_no:${row.uid}`, title: 'No, thanks' } },
    ]);
    assert.equal(c.body.interactive.body.text,
      'Dana at Ledger tool would like to record and transcribe this chat for customer research, using Axal VC. '
      + 'That includes voice notes, audio files and videos, and what you have already sent here. '
      + 'It is kept until Dana deletes it. What this means: https://axal.vc/privacy/interviews?n=1\n\n'
      + 'Tap Yes to agree or No to decline. You can send STOP at any time.');
    assert.equal(row.notice_version, CONSENT_NOTICE_VERSION);
    assert.equal(row.session_id, a.body.session_id);
    assert.ok(row.requested_at && row.request_ref_hash === ref('whatsapp', 'wamid.NOTICE.1'));
    // The notice is no chat message: the transcript stays the conversation.
    assert.equal(count(db, `SELECT COUNT(*) n FROM channel_thread_messages WHERE direction = 'out'`), 0);
  } finally { g.restore(); }
  // The view carries no hash and no wamid.
  const read = JSON.stringify((await call(env, ME, 'GET', `/threads/${uid}`)).body);
  assert.equal(read.includes('NOTICE'), false);
  assert.equal(read.includes(ref('whatsapp', 'wamid.NOTICE.1')), false);
});

test('the notice\'s words: a name and a venture with line breaks and 200 characters are cleaned and clipped; without them it still reads', () => {
  const long = `Dana\nRuiz${'x'.repeat(200)}`;
  const text = noticeText(1, { firstName: long, venture: `Ledger\r\n tool ${'y'.repeat(200)}`, url: 'https://axal.vc/privacy/interviews?n=1' })!;
  assert.ok(text.length <= 1024, `${text.length}`);
  assert.equal(/[\r]/.test(text.split('\n\n')[0]), false);
  assert.ok(text.startsWith(`Dana Ruiz${'x'.repeat(31)} at Ledger tool ${'y'.repeat(68)} would like`), text.slice(0, 160));
  const bare = noticeText(1, { firstName: null, venture: null, url: 'https://axal.vc/privacy/interviews?n=1' })!;
  assert.ok(bare.startsWith('The founder would like to record'));
  assert.ok(bare.includes('kept until the founder deletes it'));
  assert.equal(noticeText(99, { firstName: null, venture: null, url: 'x' }), null, 'no words for an unknown version');
});

test('without an https base URL the request refuses with 503 base_url_missing and nothing is sent', async () => {
  const { env, db } = await seeded();
  const uid = await waChat(env);
  await assigned(env, uid);
  assert.equal(consentNoticeUrl({ PUBLIC_BASE_URL: 'http://axal.vc', APP_URL: '' } as any), null);
  const bare = { ...env, PUBLIC_BASE_URL: '', APP_URL: 'http://axal.vc' };
  const g = graph();
  try {
    const r = await call(bare, ME, 'POST', `/threads/${uid}/consent-request`);
    assert.deepEqual([r.status, r.body.code], [503, 'base_url_missing']);
    assert.equal(g.calls.length, 0);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_outbound'), 0);
  } finally { g.restore(); }
});

test('the request\'s checks, in order: provider, link, consent, window', async () => {
  const { env, db } = await seeded();
  const uid = await waChat(env);
  const g = graph();
  try {
    assert.equal((await call(env, ME, 'POST', `/threads/${uid}/consent-request`)).body.code, 'consent_needs_interview');
    assert.equal((await call(env, OTHER, 'POST', `/threads/${uid}/consent-request`)).status, 404, 'another member\'s thread is not there');
    assert.equal((await call(env, OTHER, 'POST', `/threads/${uid}/consent`, { method: 'verbal' })).status, 404);
    await assigned(env, uid);
    db.prepare(`UPDATE channel_threads SET last_inbound_at = datetime('now', '-25 hours') WHERE uid = ?`).run(uid);
    const closed = await call(env, ME, 'POST', `/threads/${uid}/consent-request`);
    assert.deepEqual([closed.status, closed.body.code], [409, 'window_closed']);
    assert.equal(closed.body.message,
      'Dana Ruiz last wrote more than 24 hours ago, and WhatsApp only lets Axal write within 24 hours of their last message. '
      + 'Ask Dana Ruiz to send you a message from your WhatsApp Business app, then ask again.');
    assert.equal(g.calls.length, 0, 'nothing sent outside the window');
  } finally { g.restore(); }
});

test('assign with { ask: true } outside the window links nothing; inside it links, then asks', async () => {
  const { env, db } = await seeded();
  const uid = await waChat(env);
  db.prepare(`UPDATE channel_threads SET last_inbound_at = datetime('now', '-25 hours') WHERE uid = ?`).run(uid);
  const g = graph();
  try {
    const r = await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW, consent: { ask: true } });
    assert.deepEqual([r.status, r.body.code], [409, 'window_closed']);
    assert.equal(threadRow(db, uid).status, 'pending', 'a refusal links nothing');
    assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_sessions'), 0);
    assert.equal((await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW, consent: { ask: 'yes' } })).status, 400);
    db.prepare(`UPDATE channel_threads SET last_inbound_at = datetime('now') WHERE uid = ?`).run(uid);
    const ok = await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW, consent: { ask: true } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.consent_request, { ok: true });
    assert.equal(ok.body.consent.status, 'requested');
    assert.equal(g.calls.length, 1);
  } finally { g.restore(); }
});

test('at most two notices, 24 hours apart; two concurrent first presses send one', async () => {
  const { env, db } = await seeded();
  const uid = await waChat(env);
  await assigned(env, uid);
  const g = graph();
  try {
    const [a, b] = await Promise.all([
      call(env, ME, 'POST', `/threads/${uid}/consent-request`), call(env, ME, 'POST', `/threads/${uid}/consent-request`),
    ]);
    assert.equal(g.calls.length, 1, 'one notice for two presses');
    assert.deepEqual([a.status, b.status].sort(), [200, 409], 'the second press is told to wait');
    const soon = await call(env, ME, 'POST', `/threads/${uid}/consent-request`);
    assert.deepEqual([soon.status, soon.body.code], [409, 'too_soon']);
    assert.ok(Date.parse(soon.body.next_at) > Date.now());
    assert.equal(g.calls.length, 1);
    db.prepare(`UPDATE channel_outbound SET created_at = datetime('now', '-25 hours')`).run();
    assert.equal((await call(env, ME, 'POST', `/threads/${uid}/consent-request`)).status, 200, 'after 24 hours the second goes');
    assert.equal(g.calls.length, 2);
    db.prepare(`UPDATE channel_outbound SET created_at = datetime('now', '-25 hours')`).run();
    const third = await call(env, ME, 'POST', `/threads/${uid}/consent-request`);
    assert.deepEqual([third.status, third.body.code], [409, 'asked_twice']);
    assert.equal(third.body.message, 'Axal has asked Dana Ruiz twice. Ask them in your own words, then confirm here once they agree.');
    assert.equal(g.calls.length, 2);
    assert.equal(count(db, `SELECT COUNT(*) n FROM channel_consents WHERE status = 'requested'`), 1, 'one open request');
  } finally { g.restore(); }
});

test('a browser reply under a consent: key is refused, so it can never stand in for the notice', async () => {
  const { env, db } = await seeded();
  const uid = await waChat(env);
  await assigned(env, uid);
  const g = graph();
  try {
    const r = await call(env, ME, 'POST', `/threads/${uid}/reply`, { text: 'Hi', client_key: `consent:${uid}:v1:1` });
    assert.deepEqual([r.status, r.body.code], [400, 'client_key_reserved']);
    assert.equal(g.calls.length, 0);
    assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_outbound'), 0);
  } finally { g.restore(); }
  // So a delivered status can only ever be the real notice's: the member's word stays locked.
  const word = await call(env, ME, 'POST', `/threads/${uid}/consent`, { method: 'verbal' });
  assert.deepEqual([word.status, word.body.code], [409, 'notice_not_delivered']);
});

// ---------------------------------------------------------------------------
// The interviewee's answer
// ---------------------------------------------------------------------------

test('the interviewee\'s Yes button gives consent; the follow-up moves what waited, queues the voice note once and Structure', async () => {
  const { env, db, queued } = await seeded();
  const uid = await waChat(env);
  await waHook(env, waVoice('wamid.V1'));
  const a = await assigned(env, uid);
  const notice = await asked(env, uid);
  const row = consentRow(db, uid);
  assert.equal((await waHook(env, button('wamid.YES', `consent_yes:${row.uid}`, notice))).status, 200);
  const given = consentRow(db, uid);
  assert.deepEqual([given.status, given.source, given.method], ['given', 'interviewee_reply', 'chat_reply']);
  const s = sessionRow(db, a.body.session_id);
  assert.deepEqual([s.consent_status, s.consent_method, !!s.consent_at], ['given', 'chat_reply', true]);
  assert.equal(segs(db, a.body.session_id).length, 0, 'the webhook itself moves no text');
  const consentJobs = jobsOf(queued, 'channel_followup').filter((j) => j.payload.kind === 'consent');
  assert.equal(consentJobs.length, 1);
  assert.equal(JSON.stringify(consentJobs[0]).includes('wamid'), false, 'ids only');

  await runConsentJobs(env, queued);
  assert.deepEqual(segs(db, a.body.session_id), ['One.', 'Two.', 'Three.']);
  assert.equal(jobsOf(queued, 'channel_followup').filter((j) => j.payload.kind === 'voice').length, 1);
  assert.deepEqual(jobsOf(queued, 'session_structure').map((j) => j.payload.trigger), ['chat_assigned']);
  await runConsentJobs(env, queued);
  assert.equal(segs(db, a.body.session_id).length, 3, 'a second run moves nothing');
  assert.equal(jobsOf(queued, 'channel_followup').filter((j) => j.payload.kind === 'voice').length, 1, 'the note is queued once');
  // Later text now goes straight in.
  await waHook(env, waText(PNID, 'wamid.AFTER', 'After.'));
  assert.equal(segs(db, a.body.session_id).at(-1), 'After.');
  assert.equal((await vcall(env, 'GET', `/sessions/${a.body.session_id}`)).body.channel_consent.status, 'given');
});

test('a typed YES counts only as a reply to the notice; a bare yes is an ordinary message', async () => {
  const { env, db } = await seeded();
  const uid = await waChat(env, ['Hello.']);
  await assigned(env, uid);
  const notice = await asked(env, uid);
  await waHook(env, typed('wamid.Y1', 'Yes!'));
  assert.equal(consentRow(db, uid).status, 'requested', 'a bare yes is conversation');
  assert.equal(pendingCount(db, uid), 2, 'and kept as a pending message');
  await waHook(env, typed('wamid.Y2', ' yes. ', notice));
  assert.equal(consentRow(db, uid).status, 'given');
  assert.equal(pendingCount(db, uid), 2, 'the answer itself is not a message');
});

test('the member\'s side, another chat, another thread\'s request and a closed request never count', async () => {
  const { env, db } = await seeded();
  const uid = await waChat(env);
  await assigned(env, uid);
  const notice = await asked(env, uid);
  const row = consentRow(db, uid);
  // An echo of "YES" from the member's own app.
  await waHook(env, waPayload(PNID, {
    message_echoes: [{ from: '15550001234', to: WA_CUSTOMER, id: 'wamid.ECHO', timestamp: String(now()), type: 'text', text: { body: 'YES' }, context: { id: notice } }],
  }, 'smb_message_echoes'));
  assert.equal(consentRow(db, uid).status, 'requested');
  // An echo of the button itself, from the member's side.
  await waHook(env, waPayload(PNID, {
    message_echoes: [{ from: '15550001234', to: WA_CUSTOMER, id: 'wamid.ECHOBTN', timestamp: String(now()), type: 'interactive', context: { id: notice },
      interactive: { type: 'button_reply', button_reply: { id: `consent_yes:${row.uid}`, title: 'Yes, I agree' } } }],
  }, 'smb_message_echoes'));
  assert.equal(consentRow(db, uid).status, 'requested');
  // This request's uid, from another chat on the same number — one with its own thread.
  await waHook(env, waText(PNID, 'wamid.OTHERHI', 'Hi from elsewhere.', '447700900999'));
  await waHook(env, button('wamid.OTHERCHAT', `consent_yes:${row.uid}`, notice, { from: '447700900999' }));
  assert.equal(db.prepare(`SELECT error FROM channel_events WHERE external_event_id = ?`).get(ref('whatsapp', 'wamid.OTHERCHAT')).error, 'request_mismatch');
  assert.equal(consentRow(db, uid).status, 'requested');
  // Another thread's request uid on this chat.
  await waHook(env, button('wamid.WRONGUID', `consent_yes:${crypto.randomUUID()}`, notice));
  assert.equal(consentRow(db, uid).status, 'requested');
  // A button with no context is not a reply to the notice.
  await waHook(env, button('wamid.NOCTX', `consent_yes:${row.uid}`, null));
  assert.equal(consentRow(db, uid).status, 'requested');
  // A closed request: expired by a move.
  db.prepare(`UPDATE channel_consents SET status = 'expired' WHERE id = ?`).run(row.id);
  await waHook(env, button('wamid.CLOSED', `consent_yes:${row.uid}`, notice));
  assert.equal(db.prepare('SELECT status FROM channel_consents WHERE id = ?').get(row.id).status, 'expired');
  assert.equal(threadRow(db, uid).consent_state, 'awaiting');
  assert.equal(db.prepare(`SELECT error FROM channel_events WHERE external_event_id = ?`).get(ref('whatsapp', 'wamid.CLOSED')).error, 'request_closed');
});

test('signatures: an unsigned or wrongly signed answer changes nothing; another member\'s number reaches none of these threads', async () => {
  const { env, db, queued } = await seeded();
  const uid = await waChat(env);
  await assigned(env, uid);
  const notice = await asked(env, uid);
  const row = consentRow(db, uid);
  const yes = button('wamid.SIGNED', `consent_yes:${row.uid}`, notice);
  assert.equal((await waHook(env, yes, null)).status, 401);
  assert.equal((await waHook(env, yes, sign(JSON.stringify(yes), 'not-the-secret'))).status, 401);
  assert.equal(consentRow(db, uid).status, 'requested');
  assert.equal(jobsOf(queued, 'channel_followup').length, 0);
  await waHook(env, button('wamid.GONE', `consent_yes:${row.uid}`, notice, { pnid: PNID_GONE }));
  assert.equal(consentRow(db, uid).status, 'requested', 'tenancy comes from phone_number_id only');
  // An unsigned delivered status does not unlock the member's word.
  assert.equal((await waHook(env, delivered(notice), null)).status, 401);
  assert.equal((await call(env, ME, 'POST', `/threads/${uid}/consent`, { method: 'verbal' })).body.code, 'notice_not_delivered');
});

test('a redelivered answer is counted once: the same event, and the same wamid under a new event id', async () => {
  const { env, db, queued } = await seeded();
  const uid = await waChat(env);
  await assigned(env, uid);
  const notice = await asked(env, uid);
  const row = consentRow(db, uid);
  const yes = button('wamid.ONCE', `consent_yes:${row.uid}`, notice);
  await waHook(env, yes);
  await waHook(env, yes);
  assert.equal(jobsOf(queued, 'channel_followup').filter((j) => j.payload.kind === 'consent').length, 1);
  const before = consentRow(db, uid);
  // The same wamid as a new event: the claim is new, reply_ref_hash is not.
  db.prepare('DELETE FROM channel_events').run();
  await waHook(env, yes);
  assert.deepEqual(consentRow(db, uid), before, 'the row is unchanged');
  assert.equal(jobsOf(queued, 'channel_followup').filter((j) => j.payload.kind === 'consent').length, 1);
  await runConsentJobs(env, queued);
  await runConsentJobs(env, queued);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_transcript_segments'), 3, 'one move');
});

// ---------------------------------------------------------------------------
// The member's word
// ---------------------------------------------------------------------------

test('the member\'s word: refused before the notice and before it is delivered; taken once WhatsApp says delivered', async () => {
  const { env, db, queued } = await seeded();
  const uid = await waChat(env);
  const a = await assigned(env, uid);
  assert.equal((await call(env, ME, 'POST', `/threads/${uid}/consent`, { method: 'verbal' })).body.code, 'notice_not_delivered');
  const notice = await asked(env, uid);
  const sent = await call(env, ME, 'POST', `/threads/${uid}/consent`, { method: 'verbal' });
  assert.deepEqual([sent.status, sent.body.code], [409, 'notice_not_delivered']);
  assert.equal(sent.body.message, 'Axal\'s notice has not reached Dana Ruiz yet. Ask in WhatsApp first, and confirm once WhatsApp shows it delivered.');
  for (const m of ['in_app', 'chat_reply', '']) {
    const r = await call(env, ME, 'POST', `/threads/${uid}/consent`, { method: m });
    assert.deepEqual([r.status, r.body.code], [400, 'consent_method_required'], m);
  }
  await waHook(env, delivered(notice));
  assert.ok(consentRow(db, uid).delivered_at, 'delivered_at recorded');
  const ok = await call(env, ME, 'POST', `/threads/${uid}/consent`, { method: 'verbal' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.consent.status, ok.body.consent.source, ok.body.consent.method, ok.body.moved], ['given', 'member_attested', 'verbal', 3]);
  assert.deepEqual(segs(db, a.body.session_id), ['One.', 'Two.', 'Three.']);
  assert.equal(sessionRow(db, a.body.session_id).consent_method, 'verbal');
  const again = await call(env, ME, 'POST', `/threads/${uid}/consent`, { method: 'written' });
  assert.deepEqual([again.status, again.body.moved], [200, 0], 'given already: nothing changes');
  assert.equal(consentRow(db, uid).method, 'verbal');
  // A "No" after the member's word withdraws it: the interviewee wins.
  await waHook(env, typed('wamid.STOP', 'STOP'));
  assert.equal(consentRow(db, uid).status, 'withdrawn');
  void queued;
});

test('after the interviewee\'s No the member\'s word is refused, on this link and on a re-link', async () => {
  const { env, db } = await seeded();
  const uid = await waChat(env);
  await assigned(env, uid);
  const notice = await asked(env, uid);
  await waHook(env, delivered(notice));
  await waHook(env, button('wamid.NO', `consent_no:${consentRow(db, uid).uid}`, notice));
  const r = await call(env, ME, 'POST', `/threads/${uid}/consent`, { method: 'verbal' });
  assert.deepEqual([r.status, r.body.code], [409, 'interviewee_declined']);
  // Set aside, un-ignored and assigned again: awaiting, and only a new Yes gives consent.
  await call(env, ME, 'POST', `/threads/${uid}/ignore`, { ignored: false });
  const re = await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: INTERVIEW, consent: { method: 'verbal' } });
  assert.deepEqual([re.status, re.body.code], [409, 'interviewee_declined'], 'refused before the claim');
  await assigned(env, uid);
  assert.equal(threadRow(db, uid).consent_state, 'awaiting');
  assert.equal((await call(env, ME, 'POST', `/threads/${uid}/consent`, { method: 'verbal' })).body.code, 'interviewee_declined');
});

// ---------------------------------------------------------------------------
// Decline and withdrawal
// ---------------------------------------------------------------------------

test('"No, thanks" on an open request deletes every waiting copy and sets the chat aside; Customer research reads declined', async () => {
  const { env, db } = await seeded();
  const uid = await waChat(env);
  await waHook(env, waVoice('wamid.V1'));
  const a = await assigned(env, uid);
  const notice = await asked(env, uid);
  await waHook(env, button('wamid.NO', `consent_no:${consentRow(db, uid).uid}`, notice));
  assert.equal(pendingCount(db, uid), 0, 'texts and the placeholder are gone');
  const t = threadRow(db, uid);
  assert.deepEqual([t.status, t.consent_state, t.session_id], ['ignored', 'declined', null]);
  assert.equal(sessionRow(db, a.body.session_id).consent_status, 'declined');
  assert.equal(consentRow(db, uid).status, 'declined');
  const read = (await call(env, ME, 'GET', `/threads/${uid}`)).body;
  assert.equal(read.consent.status, 'declined');
  const { interviewState } = await import('../src/services/cycleValidate.ts');
  const s = sessionRow(db, a.body.session_id);
  assert.equal(interviewState({ status: s.status, submitted_via: s.submitted_via, processing_stage: s.processing_stage, consent_status: s.consent_status }, null), 'consent_declined');
  assert.equal(interviewState({ status: 'draft', submitted_via: 'whatsapp', processing_stage: null, consent_status: 'not_recorded' }, null), 'waiting_consent');
  // Later messages are dropped, as on an ignored chat.
  await waHook(env, waText(PNID, 'wamid.LATE', 'Late.'));
  assert.equal(pendingCount(db, uid), 0);
});

test('STOP on an open request declines too', async () => {
  const { env, db } = await seeded();
  const uid = await waChat(env);
  await assigned(env, uid);
  await asked(env, uid);
  await waHook(env, typed('wamid.STOP', 'stop.'));
  assert.equal(consentRow(db, uid).status, 'declined');
  assert.equal(pendingCount(db, uid), 0);
});

test('STOP after consent withdraws it: nothing new is kept, quotes go off, Structure, Ask and playback refuse; Discard removes the rest', async () => {
  const { env, db, queued } = await seeded();
  const uid = await waChat(env);
  const a = await assigned(env, uid, { quote_consent: true });
  const sid = a.body.session_id;
  const notice = await asked(env, uid);
  await waHook(env, button('wamid.YES', `consent_yes:${consentRow(db, uid).uid}`, notice));
  await runConsentJobs(env, queued);
  assert.equal(segs(db, sid).length, 3);
  // A typed "no" that is not a reply is conversation.
  await waHook(env, typed('wamid.NO1', 'No'));
  assert.equal(consentRow(db, uid).status, 'given');
  assert.equal(segs(db, sid).at(-1), 'No');
  // A voice note held by a job when consent goes.
  await waHook(env, waVoice('wamid.VHELD', 'MEDIA-H'));
  const held = jobsOf(queued, 'channel_followup').filter((j) => j.payload.kind === 'voice').at(-1);
  // A summary written while consent stood (D757's engine).
  db.prepare(`UPDATE interview_sessions SET summary = 'They close the books by hand.', summarised_at = datetime('now') WHERE id = ?`).run(sid);
  await waHook(env, typed('wamid.STOP', 'STOP'));
  assert.equal(sessionRow(db, sid).summary, null, 'withdrawDigest: the summary goes with the consent');
  await waHook(env, typed('wamid.STOP', 'STOP'));
  db.prepare(`DELETE FROM channel_events WHERE external_event_id = ?`).run(ref('whatsapp', 'wamid.STOP'));
  await waHook(env, typed('wamid.STOP', 'STOP'));
  assert.equal(segs(db, sid).includes('STOP'), false, 'a redelivered STOP is neither a second withdrawal nor a message');
  const row = consentRow(db, uid);
  assert.deepEqual([row.status, !!row.withdrawn_at], ['withdrawn', true]);
  assert.equal(count(db, `SELECT COUNT(*) n FROM channel_consents WHERE status = 'withdrawn'`), 1, 'one withdrawal');
  const t = threadRow(db, uid);
  assert.deepEqual([t.status, t.consent_state], ['ignored', 'withdrawn']);
  const s = sessionRow(db, sid);
  assert.deepEqual([s.consent_status, s.consent_method, s.consent_at], ['declined', null, null]);
  assert.equal(db.prepare('SELECT quote_consent FROM discovery_interviews WHERE id = ?').get(INTERVIEW).quote_consent, 0);
  // The held note finds nothing; no fetch.
  const f = mockFetch(() => undefined);
  try { await runChannelJob(env, 'channel_followup', held.payload); assert.equal(f.calls.length, 0); } finally { f.restore(); }
  // Nothing new is kept.
  await waHook(env, waText(PNID, 'wamid.LATER', 'Later.'));
  await waHook(env, waVoice('wamid.VLATER', 'MEDIA-L'));
  assert.equal(pendingCount(db, uid), 0);
  assert.equal(segs(db, sid).length, 4);
  for (const path of [`/sessions/${sid}/structure`, `/sessions/${sid}/ask`]) {
    assert.equal((await vcall(env, 'POST', path, { question: 'Why?' })).status, 409, path);
  }
  db.prepare(`INSERT INTO interview_session_chunks (session_id, seq, r2_key, mime, size_bytes) VALUES (?, 0, 'validate-audio/2/sessions/x/000000.webm', 'audio/webm', 10)`).run(sid);
  assert.equal((await vcall(env, 'GET', `/sessions/${sid}/audio`)).status, 409, 'no playback');
  db.prepare('DELETE FROM interview_session_chunks WHERE session_id = ?').run(sid);
  // Discard removes the segments and the consent row.
  const del = await vcall(env, 'DELETE', `/sessions/${sid}`);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(segs(db, sid).length, 0);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_consents WHERE session_id = ?', sid), 0);
});

test('the "No, thanks" button after consent withdraws it', async () => {
  const { env, db } = await seeded();
  const uid = await waChat(env);
  await assigned(env, uid);
  const notice = await asked(env, uid);
  const r = consentRow(db, uid);
  await waHook(env, button('wamid.YES', `consent_yes:${r.uid}`, notice));
  await waHook(env, button('wamid.NO', `consent_no:${r.uid}`, notice));
  assert.equal(consentRow(db, uid).status, 'withdrawn');
});

// ---------------------------------------------------------------------------
// Re-links
// ---------------------------------------------------------------------------

test('re-links: the same interview twice opens one session; another venture is refused; the same venture carries consent; a move expires the request', async () => {
  const { env, db, queued } = await seeded();
  const uid = await waChat(env);
  const a = await assigned(env, uid);
  const b = await assigned(env, uid);
  assert.equal(b.body.session_id, a.body.session_id);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM interview_sessions'), 1);

  // A move with an open request expires it.
  await asked(env, uid);
  const open = consentRow(db, uid);
  db.prepare(`INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (301, ${PROJECT}, 'Dana again')`).run();
  await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: 301 });
  assert.equal(db.prepare('SELECT status FROM channel_consents WHERE id = ?').get(open.id).status, 'expired');
  assert.equal(threadRow(db, uid).consent_state, 'awaiting');

  // Consent given on 301, then moves.
  await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: 301 });
  db.prepare(`UPDATE channel_outbound SET created_at = datetime('now', '-25 hours')`).run();
  const g = graph(); let notice = '';
  try { assert.equal((await call(env, ME, 'POST', `/threads/${uid}/consent-request`)).status, 200); notice = 'wamid.NOTICE.1'; } finally { g.restore(); }
  await waHook(env, button('wamid.YES', `consent_yes:${consentRow(db, uid).uid}`, notice));
  await runConsentJobs(env, queued);
  assert.equal(threadRow(db, uid).consent_state, 'given');
  db.prepare(`INSERT INTO projects (id, name, founder_id) VALUES (12, 'Second venture', 9)`).run();
  db.prepare(`INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (302, 12, 'Elsewhere')`).run();
  const before = threadRow(db, uid);
  const other = await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: 302 });
  assert.deepEqual([other.status, other.body.code], [409, 'consent_other_venture']);
  assert.deepEqual(threadRow(db, uid), before, 'nothing changes');
  const made = await call(env, ME, 'POST', `/threads/${uid}/assign`, { create: { interviewee_name: 'X', project_id: 12 } });
  assert.deepEqual([made.status, made.body.code], [409, 'consent_other_venture']);
  assert.equal(count(db, `SELECT COUNT(*) n FROM discovery_interviews WHERE interviewee_name = 'X'`), 0, 'no interview left behind');
  db.prepare(`INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (303, ${PROJECT}, 'Same venture')`).run();
  const same = await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: 303 });
  assert.equal(same.status, 200, JSON.stringify(same.body));
  const ns = sessionRow(db, same.body.session_id);
  assert.deepEqual([ns.consent_status, ns.consent_method], ['given', 'chat_reply']);
  assert.equal(threadRow(db, uid).consent_state, 'given');
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

test('the purge removes an empty waiting draft after 30 days, with the interview made for it, and nothing else', async () => {
  const { env, db } = await seeded();
  // A draft from "Create interview from this chat", 31 days old, its thread holding no waiting copy.
  const uid1 = await waChat(env, ['Old.']);
  const made = await call(env, ME, 'POST', `/threads/${uid1}/assign`, { create: { interviewee_name: 'Old chat', project_id: PROJECT } });
  db.prepare(`UPDATE interview_sessions SET created_at = datetime('now', '-31 days') WHERE id = ?`).run(made.body.session_id);
  db.prepare(`UPDATE discovery_interviews SET created_at = datetime('now', '-31 days') WHERE id = ?`).run(made.body.interview_id);
  db.prepare(`UPDATE channel_thread_messages SET sent_at = datetime('now', '-31 days')`).run();
  // A draft on an interview the member made earlier, with no waiting copy.
  db.prepare(`INSERT INTO discovery_interviews (id, project_id, interviewee_name, created_at) VALUES (401, ${PROJECT}, 'Mine', datetime('now', '-60 days'))`).run();
  db.exec(`INSERT INTO channel_threads (uid, provider, integration_id, user_id, external_chat_id) SELECT 'thread-2', 'whatsapp', integration_id, user_id, '447700900222' FROM channel_threads LIMIT 1`);
  const mine = await call(env, ME, 'POST', `/threads/thread-2/assign`, { interview_id: 401 });
  db.prepare(`UPDATE interview_sessions SET created_at = datetime('now', '-31 days') WHERE id = ?`).run(mine.body.session_id);
  // A draft whose thread still holds a waiting copy younger than 30 days.
  db.exec(`INSERT INTO channel_threads (uid, provider, integration_id, user_id, external_chat_id) SELECT 'thread-3', 'whatsapp', integration_id, user_id, '447700900333' FROM channel_threads LIMIT 1`);
  const fresh = await call(env, ME, 'POST', `/threads/thread-3/assign`, { interview_id: INTERVIEW });
  db.prepare(`UPDATE interview_sessions SET created_at = datetime('now', '-31 days') WHERE id = ?`).run(fresh.body.session_id);
  db.exec(`INSERT INTO channel_thread_messages (uid, thread_id, external_message_id, direction, kind, text_enc, sent_at)
           SELECT 'm-3', id, 'x3', 'in', 'text', '', datetime('now', '-2 days') FROM channel_threads WHERE uid = 'thread-3'`);
  // A given session with segments.
  db.prepare(`INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, submitted_via, created_at)
              VALUES ('given-1', ${INTERVIEW}, ${PROJECT}, ${ME}, 'text', 'transcribed', 'given', 'whatsapp', datetime('now', '-40 days'))`).run();

  const r = await purgeExpired(env, new Date());
  assert.equal(r.drafts, 2);
  assert.equal(sessionRow(db, made.body.session_id), undefined);
  assert.equal(db.prepare('SELECT id FROM discovery_interviews WHERE id = ?').get(made.body.interview_id), undefined, 'the interview made for it goes');
  assert.equal(sessionRow(db, mine.body.session_id), undefined);
  assert.ok(db.prepare('SELECT id FROM discovery_interviews WHERE id = 401').get(), 'an interview the member made is kept');
  assert.ok(sessionRow(db, fresh.body.session_id), 'a draft with a waiting copy stays');
  assert.ok(db.prepare(`SELECT id FROM interview_sessions WHERE uid = 'given-1'`).get(), 'a given session is untouched');
  assert.equal(threadRow(db, uid1)?.status ?? 'pending', 'pending', 'its thread is pending again');
});

test('disconnect: open requests and empty waiting drafts go; a given consent with segments survives, without its thread', async () => {
  const { env, db, queued } = await seeded();
  const uid = await waChat(env);
  const a = await assigned(env, uid);
  const notice = await asked(env, uid);
  await waHook(env, button('wamid.YES', `consent_yes:${consentRow(db, uid).uid}`, notice));
  await runConsentJobs(env, queued);
  db.exec(`INSERT INTO channel_threads (uid, provider, integration_id, user_id, external_chat_id) SELECT 'thread-w', 'whatsapp', integration_id, user_id, '447700900444' FROM channel_threads LIMIT 1`);
  db.prepare(`INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (501, ${PROJECT}, 'Waiting')`).run();
  const w = await call(env, ME, 'POST', '/threads/thread-w/assign', { interview_id: 501 });
  db.exec(`UPDATE channel_threads SET last_inbound_at = datetime('now') WHERE uid = 'thread-w'`);
  db.exec(`INSERT INTO channel_consents (uid, user_id, provider, thread_id, session_id, interview_id)
           SELECT 'open-w', user_id, 'whatsapp', id, session_id, interview_id FROM channel_threads WHERE uid = 'thread-w'`);
  const integration = threadRow(db, uid).integration_id;
  await forgetConnection(env, integration);
  assert.equal(count(db, `SELECT COUNT(*) n FROM channel_consents WHERE status = 'requested'`), 0);
  assert.equal(sessionRow(db, w.body.session_id), undefined, 'the empty waiting draft goes');
  const kept = db.prepare('SELECT * FROM channel_consents WHERE session_id = ?').get(a.body.session_id);
  assert.deepEqual([kept.status, kept.thread_id], ['given', null]);
  assert.equal(segs(db, a.body.session_id).length, 3);
});

test('deleteSession removes the consent rows and puts the thread back to pending', async () => {
  const { env, db, queued } = await seeded();
  const uid = await waChat(env);
  const a = await assigned(env, uid);
  const notice = await asked(env, uid);
  await waHook(env, button('wamid.YES', `consent_yes:${consentRow(db, uid).uid}`, notice));
  await runConsentJobs(env, queued);
  assert.equal((await vcall(env, 'DELETE', `/sessions/${a.body.session_id}`)).status, 200);
  assert.equal(count(db, 'SELECT COUNT(*) n FROM channel_consents'), 0);
  const t = threadRow(db, uid);
  assert.deepEqual([t.status, t.session_id, t.consent_state], ['pending', null, null]);
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test('the gate: a session holding audio is gated whatever its channel; consentBlocks takes its options everywhere', async () => {
  assert.equal(consentBlocks('text', 'not_recorded', { hasAudio: false, submittedVia: null }), null);
  assert.equal(consentBlocks('text', 'not_recorded', { hasAudio: true, submittedVia: null })?.error, 'consent_not_recorded');
  assert.equal(consentBlocks('text', 'not_recorded', { hasAudio: false, submittedVia: 'whatsapp' })?.error, 'consent_not_recorded');
  assert.equal(consentBlocks('text', 'not_recorded', { hasAudio: false, submittedVia: 'telegram' }), null, 'Telegram is off');
  assert.equal(consentBlocks('text', 'given', { hasAudio: true, submittedVia: 'whatsapp' }), null);
  assert.equal(consentBlocks('phone', 'not_recorded', { hasAudio: false, submittedVia: null })?.error, 'consent_not_recorded');

  // Every caller passes three arguments; a new caller cannot skip them.
  const root = new URL('../src/', import.meta.url);
  const files: string[] = [];
  const walk = (dir: URL) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(new URL(`${e.name}/`, dir));
      else if (e.name.endsWith('.ts')) files.push(new URL(e.name, dir).pathname);
    }
  };
  walk(root);
  let calls = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bconsentBlocks\(/g)) {
      if (src.slice(Math.max(0, m.index! - 16), m.index!).endsWith('export function ')) continue;
      calls++;
      const args = src.slice(m.index!, m.index! + 260);
      assert.match(args, /^consentBlocks\([^,]+,[^,]+,\s*\{\s*hasAudio:[\s\S]*?submittedVia:/, `${f}: ${args.slice(0, 120)}`);
    }
  }
  // Six callers pass the options themselves; Structure and the stale-run sweep go through
  // `sessionConsentBlocks`, which reads them from the stored session.
  assert.ok(calls >= 6, `found ${calls} calls`);
  for (const f of ['services/sessionAutoStructure.ts', 'services/sessionSweeper.ts']) {
    assert.match(readFileSync(new URL(f, root), 'utf8'), /await sessionConsentBlocks\(env, s(ession)?\)/, f);
  }
});

test('the gate on Validate: a text session holding one chunk is refused for Structure and the audio route; a recorder session withdrawn while paused is refused playback, and Discard still works', async () => {
  const { env, db } = await seeded();
  db.prepare(`INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status)
              VALUES (900, 's-900', ${INTERVIEW}, ${PROJECT}, ${ME}, 'text', 'transcribed', 'not_recorded'),
                     (901, 's-901', ${INTERVIEW}, ${PROJECT}, ${ME}, 'phone', 'stopped', 'declined')`).run();
  db.prepare(`INSERT INTO interview_transcript_segments (session_id, source, speaker_label, text, model) VALUES (900, 'final', 'Dana', 'We lose a day.', 'm')`).run();
  for (const sid of [900, 901]) {
    db.prepare(`INSERT INTO interview_session_chunks (session_id, seq, r2_key, mime, size_bytes) VALUES (?, 0, 'validate-audio/2/sessions/s/000000.webm', 'audio/webm', 10)`).run(sid);
  }
  assert.equal((await vcall(env, 'POST', '/sessions/900/structure', {})).status, 409);
  assert.equal((await vcall(env, 'GET', '/sessions/900/audio')).status, 409);
  assert.equal((await vcall(env, 'GET', '/sessions/901/audio')).status, 409);
  const { structureSession } = await import('../src/services/sessionAutoStructure.ts');
  assert.deepEqual(await structureSession(env, { sessionId: 900, userId: ME, trigger: 'chat_quiet' }), { ok: false, reason: 'consent_not_recorded' });
  const files: string[] = [];
  env.FILES = { async delete(keys: string[]) { files.push(...keys); } };
  assert.equal((await vcall(env, 'DELETE', '/sessions/901')).status, 200, 'Discard still works');
  assert.equal(files.length, 1);
});

test('the quiet-chat sweep does not queue a chat waiting for consent', async () => {
  const { env, db, queued } = await seeded();
  db.prepare(`INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, submitted_via, updated_at)
              VALUES ('q-1', ${INTERVIEW}, ${PROJECT}, ${ME}, 'text', 'transcribed', 'not_recorded', 'whatsapp', datetime('now', '-2 hours')),
                     ('q-2', ${INTERVIEW}, ${PROJECT}, ${ME}, 'text', 'transcribed', 'given', 'whatsapp', datetime('now', '-2 hours'))`).run();
  assert.equal(await sweepQuietChats(env, new Date()), 1);
  assert.deepEqual(jobsOf(queued, 'session_structure').map((j) => j.payload.session_id),
    [db.prepare(`SELECT id FROM interview_sessions WHERE uid = 'q-2'`).get().id]);
});

// ---------------------------------------------------------------------------
// Voice reasons
// ---------------------------------------------------------------------------

test('voice: a job holding a note without consent gives it back as no_consent, with no fetch; the read says why; the retry refuses', async () => {
  const { env, db, queued } = await seeded();
  const uid = await waChat(env, ['Hi.']);
  await assigned(env, uid);
  // As if consent was given, a note queued, and consent then lost before the job ran.
  db.prepare(`UPDATE channel_threads SET consent_state = 'given' WHERE uid = ?`).run(uid);
  await waHook(env, waVoice('wamid.V1'));
  const job = jobsOf(queued, 'channel_followup').find((j) => j.payload.kind === 'voice');
  assert.ok(job, 'queued while given');
  db.prepare(`UPDATE channel_threads SET consent_state = 'awaiting' WHERE uid = ?`).run(uid);
  const f = mockFetch(() => undefined);
  try { await runChannelJob(env, 'channel_followup', job.payload); assert.equal(f.calls.length, 0); } finally { f.restore(); }
  const note = (await call(env, ME, 'GET', `/threads/${uid}`)).body.messages.find((m: any) => m.awaiting_transcription);
  assert.deepEqual(note.transcription_failure, {
    reason: 'no_consent', sentence: 'This voice note waits until consent is given in the chat. Axal fetches it only then.', retry: null,
  });
  const retry = await call(env, ME, 'POST', `/threads/${uid}/voice/${note.uid}/retry`);
  assert.deepEqual([retry.status, retry.body.code], [409, 'no_consent']);
});

// ---------------------------------------------------------------------------
// The normaliser
// ---------------------------------------------------------------------------

test('the normaliser: a consent button or a whole YES / NO / STOP from the contact; echoes and other interactive types never', () => {
  const uidStr = crypto.randomUUID();
  const [b] = normaliseWhatsAppPayload(button('wamid.B', `consent_yes:${uidStr}`, 'wamid.CTX')) as any[];
  assert.deepEqual([b.kind, b.answer, b.via, b.requestUid, b.contextMessageId, b.fallback], ['consent_reply', 'yes', 'button', uidStr, 'wamid.CTX', null]);
  const [bad] = normaliseWhatsAppPayload(button('wamid.B2', 'something_else:1', 'wamid.CTX')) as any[];
  assert.deepEqual([bad.kind, bad.reason], ['ignored', 'unsupported_type']);
  const list = waPayload(PNID, { messages: [{ from: WA_CUSTOMER, id: 'wamid.L', timestamp: '1', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: `consent_yes:${uidStr}` } } }] });
  assert.equal((normaliseWhatsAppPayload(list)[0] as any).kind, 'ignored');
  for (const [word, answer] of [['YES', 'yes'], [' no! ', 'no'], ['Stop.', 'stop']] as const) {
    const [t] = normaliseWhatsAppPayload(typed('wamid.T', word, 'wamid.CTX')) as any[];
    assert.deepEqual([t.kind, t.answer, t.via, t.contextMessageId, t.fallback?.kind], ['consent_reply', answer, 'text', 'wamid.CTX', 'message'], word);
  }
  assert.equal((normaliseWhatsAppPayload(typed('wamid.T2', 'yes please'))[0] as any).kind, 'message');
  const echo = waPayload(PNID, { message_echoes: [{ from: '1', to: WA_CUSTOMER, id: 'wamid.E', timestamp: '1', type: 'text', text: { body: 'STOP' } }] }, 'smb_message_echoes');
  assert.equal((normaliseWhatsAppPayload(echo)[0] as any).kind, 'message', 'an echo is the member\'s own message');
});

// ---------------------------------------------------------------------------
// Telegram, while its switch is off
// ---------------------------------------------------------------------------

test('Telegram is unchanged: assign moves the text, the read says not required, both routes refuse, STOP is a message, Structure is not gated', async () => {
  const { env, db, queued } = await seeded();
  const f = mockFetch(telegramApi);
  try {
    await tgHook(env, businessMessage('BC-ME', { text: 'Invoices eat my Friday.' }));
    const t = (await call(env, ME, 'GET', '/threads')).body.items.find((x: any) => x.provider === 'telegram');
    assert.equal(t.consent_status, null);
    const a = await call(env, ME, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW, consent: { ask: true } });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.moved, 1);
    assert.equal(a.body.consent, undefined, 'Telegram\'s answer is unchanged');
    assert.equal(jobsOf(queued, 'session_structure').length, 1);
    const read = (await call(env, ME, 'GET', `/threads/${t.uid}`)).body;
    assert.equal(read.consent.required, false);
    assert.equal((await call(env, ME, 'POST', `/threads/${t.uid}/consent-request`)).body.code, 'consent_not_offered');
    assert.equal((await call(env, ME, 'POST', `/threads/${t.uid}/consent`, { method: 'verbal' })).body.code, 'consent_not_offered');
    await tgHook(env, businessMessage('BC-ME', { text: 'STOP' }));
    assert.equal(segs(db, a.body.session_id).at(-1), 'STOP');
    const { structureSession } = await import('../src/services/sessionAutoStructure.ts');
    const out = await structureSession(env, { sessionId: a.body.session_id, userId: ME, trigger: 'chat_quiet' });
    assert.notEqual((out as any).reason, 'consent_not_recorded');
  } finally { f.restore(); }
});

test('the store is provider-neutral: openRequest, recordReply, attest, withdraw and consentForThread on a Telegram thread', async () => {
  const { env, db } = await seeded();
  const f = mockFetch(telegramApi);
  let thread: ThreadRow;
  try {
    await tgHook(env, businessMessage('BC-ME', { text: 'Hello.' }));
    const t = (await call(env, ME, 'GET', '/threads')).body.items.find((x: any) => x.provider === 'telegram');
    await call(env, ME, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW });
    thread = threadRow(db, t.uid);
  } finally { f.restore(); }
  assert.deepEqual((await consentForThread(env, thread)).required, false);
  const row = await openRequest(env, thread, { interviewId: thread.interview_id, sessionId: thread.session_id });
  assert.equal((await openRequest(env, thread, { interviewId: null, sessionId: null })).id, row.id, 'one open request');
  db.prepare(`INSERT INTO channel_outbound (uid, provider, user_id, thread_id, client_key, external_message_id, status)
              VALUES ('tg-n1', 'telegram', ?, ?, ?, ?, 'submitted')`).run(ME, thread.id, `consent:${thread.uid}:v1:1`, ref('telegram', '8001:77'));
  const reply = {
    kind: 'consent_reply', provider: 'telegram', eventId: 'e1', connectionRef: 'BC-ME', externalChatId: thread.external_chat_id,
    externalMessageId: '8001:78', side: 'contact', answer: 'yes', via: 'button', requestUid: row.uid, contextMessageId: '8001:77', fallback: null, sentAt: new Date().toISOString(),
  } as const;
  assert.deepEqual(await recordReply(env, thread, { ...reply, side: 'me' as any }), { outcome: 'ignored', reason: 'not_from_contact' });
  assert.deepEqual(await recordReply(env, thread, { ...reply, externalChatId: '9999' }), { outcome: 'ignored', reason: 'request_mismatch' });
  assert.deepEqual(await recordReply(env, thread, { ...reply, provider: 'whatsapp' }), { outcome: 'ignored', reason: 'request_mismatch' });
  const given = await recordReply(env, thread, reply);
  assert.equal(given.outcome, 'given');
  assert.deepEqual(await recordReply(env, thread, reply), { outcome: 'ignored', reason: 'duplicate' });
  const fresh = threadRow(db, thread.uid);
  assert.equal(fresh.consent_state, 'given');
  assert.deepEqual(await attest(env, ME, fresh, 'verbal'), { ok: false, code: 'consent_not_offered' }, 'Telegram takes no attestation while off');
  const w = await withdraw(env, fresh, (given as any).consent, ref('telegram', '8001:79'));
  assert.equal(w.outcome, 'withdrawn');
  assert.equal(threadRow(db, thread.uid).consent_state, 'withdrawn');
});

test('no response or log line carries a secret, a token or the contact\'s number', async () => {
  const { env, db } = await seeded();
  const logs: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  try {
    const uid = await waChat(env);
    await assigned(env, uid);
    const notice = await asked(env, uid);
    await waHook(env, delivered(notice));
    await waHook(env, button('wamid.YES', `consent_yes:${consentRow(db, uid).uid}`, notice));
    await call(env, ME, 'GET', `/threads/${uid}`);
  } finally { Object.assign(console, orig); }
  const all = [...seen, ...logs].join('\n');
  for (const s of [...SECRET_VALUES, SECRETS.WHATSAPP_APP_SECRET, WA_CUSTOMER]) assert.equal(all.includes(s), false, 'a secret or number leaked');
});
