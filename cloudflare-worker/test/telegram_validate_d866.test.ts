/**
 * D866 (#2512) — a Telegram chat fills Validate as a WhatsApp chat or a
 * recording does.
 *
 *   1. The channel dimension: every analytics read names its sessions'
 *      channel; a venture's read gives its figures per channel and both reads
 *      filter on it.
 *   2. Coverage, Telegram end to end: an assigned text chat (its text enters
 *      at once) and a consented voice note each reach `structureSession` and
 *      D859's extraction, and give proposals that cite their segment; a
 *      prototype ask carries `build_candidate`.
 *   3. Held notes: without a YES the note is never fetched and the proposals
 *      come from the text alone; after a NO, D757 runs nothing on the chat;
 *      a STOP fetches nothing more.
 *   4. Re-running proposes nothing twice.
 *
 * Real SQLite through the channel fixture; Telegram's Bot API and Workers AI
 * are stubbed, nothing is sent live, and no customer content is logged.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/telegram_validate_d866.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import validateConversations from '../src/routes/validate_conversations.ts';
import { channelOf } from '../src/services/conversationAnalytics.ts';
import { runSessionStructureJob } from '../src/services/sessionAutoStructure.ts';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import {
  AUDIO, INTERVIEW, JWT_SECRET, ME, OTHER, PROJECT, call, ids, mockFetch, noSecretsSeen, now, seen, tgHook, world,
} from './_channels_fixture.ts';

test.afterEach(() => { noSecretsSeen(); seen.length = 0; });

const analytics = new Hono<any>();
analytics.route('/api/validate', validateConversations);
analytics.onError((err: any, c) => {
  const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
});
async function get(env: any, user: number, path: string) {
  const token = await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res = await analytics.fetch(new Request(`https://axal.vc/api/validate${path}`, { headers: { authorization: `Bearer ${token}` } }), env);
  const text = await res.text();
  seen.push(text);
  return { status: res.status, text, body: JSON.parse(text) };
}

// ── 1. The channel dimension ─────────────────────────────────────────────

/** A venture with one session per channel, each with lines and suggestions to count. */
async function channels() {
  const w: any = await world({ seed: true });
  const db = w.db;
  const session = (id: number, channel: string, via: string | null, at: string) =>
    db.prepare(`INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status,
                  submitted_via, active_ms, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'structured', 'given', ?, 60000, ?)`)
      .run(id, `d866-${id}`, INTERVIEW, PROJECT, ME, channel, via, at);
  const line = (sessionId: number, speaker: string, text: string) =>
    db.prepare(`INSERT INTO interview_transcript_segments (session_id, source, speaker_label, text, model) VALUES (?, 'final', ?, ?, 'channel:fixture')`)
      .run(sessionId, speaker, text);
  const proposal = (sessionId: number, kind: string, payload: object, status: string, cite: [number, number]) =>
    db.prepare(`INSERT INTO validate_proposals (project_id, kind, payload_json, status, created_by, session_id, run_id, cite_from, cite_to)
                VALUES (?, ?, ?, ?, ?, ?, 'run-1', ?, ?)`)
      .run(PROJECT, kind, JSON.stringify(payload), status, ME, sessionId, cite[0], cite[1]);

  // Telegram: three lines, two suggestions.
  session(11, 'text', 'telegram', '2026-10-05 09:00:00');
  line(11, 'Sam Okafor', 'We pay Ledgerly every month.'); line(11, 'Me', 'What does it miss?'); line(11, 'Sam Okafor', 'Matching payments.');
  proposal(11, 'competitor_mention', { name: 'Ledgerly' }, 'pending', [0, 1000]);
  proposal(11, 'objection', { about: 'price', detail: 'too dear' }, 'accepted', [2000, 3000]);
  // WhatsApp: one line, one suggestion.
  session(12, 'text', 'whatsapp', '2026-10-06 09:00:00');
  line(12, 'Priya Shah', 'Month end takes four days.');
  proposal(12, 'competitor_mention', { name: 'Sheets' }, 'pending', [0, 1000]);
  // A recording made in StudioOS.
  session(13, 'in_person', null, '2026-10-07 09:00:00');
  line(13, 'Me', 'Walk me through it.'); line(13, 'Dana Ruiz', 'It hurts.');
  // Typed notes: neither a chat nor a recording.
  session(14, 'manual', null, '2026-10-08 09:00:00');
  line(14, 'Notes', 'They close books by hand.');
  return w;
}

test('1. channelOf: the provider, else the chat that points at the session, else recorder, else its own channel; unknown is null', () => {
  assert.equal(channelOf({ channel: 'text', submitted_via: 'telegram' }), 'telegram');
  assert.equal(channelOf({ channel: 'text', submitted_via: null, thread_provider: 'telegram' }), 'telegram', 'the thread names it when the session does not');
  assert.equal(channelOf({ channel: 'text', submitted_via: 'whatsapp', thread_provider: 'telegram' }), 'whatsapp', 'the session first');
  assert.equal(channelOf({ channel: 'in_person', submitted_via: null }), 'recorder');
  assert.equal(channelOf({ channel: 'phone', submitted_via: null }), 'recorder');
  assert.equal(channelOf({ channel: 'manual', submitted_via: null }), 'manual');
  assert.equal(channelOf({ channel: 'video', submitted_via: 'zoom' }), 'zoom', 'a meeting is its provider, not a recording');
  assert.equal(channelOf({ channel: '', submitted_via: '  ' }), null, 'unknown is null, never a guess');
});

test('1. a venture: its chats per channel, each figure counted on its own channel, and the totals unchanged', async () => {
  const w = await channels();
  const r = await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}`);
  assert.equal(r.status, 200, r.text);
  const b = r.body;
  assert.equal(b.channel, null);
  assert.equal(b.sessions, 2, 'no filter is D858: the chats');
  assert.deepEqual(b.sessions_by_channel, { telegram: 1, whatsapp: 1 });
  assert.deepEqual(Object.keys(b.by_channel), ['telegram', 'whatsapp']);
  const tg = b.by_channel.telegram;
  assert.equal(tg.channel, 'telegram');
  assert.equal(tg.sessions, 1);
  assert.deepEqual(tg.messages.value, { founder: { typed: 1, recorded: 0 }, customer: { typed: 2, recorded: 0 }, total: 3 });
  assert.deepEqual(tg.suggestion_reach.value, { cited: 2, of: 3, share: 0.667 });
  assert.deepEqual(tg.competitor_mentions.value, [{ name: 'Ledgerly', suggested: 1, accepted: 0 }]);
  assert.deepEqual(tg.objections.value, [{ about: 'price', suggested: 1, accepted: 1 }]);
  const wa = b.by_channel.whatsapp;
  assert.deepEqual(wa.messages.value.total, 1);
  assert.deepEqual(wa.competitor_mentions.value, [{ name: 'Sheets', suggested: 1, accepted: 0 }]);
  assert.deepEqual(wa.objections.value, []);
  assert.equal(tg.messages.value.total + wa.messages.value.total, b.messages.value.total, 'the channels add up to the whole');
  assert.equal('quotes_by_theme' in tg, false, 'a channel carries no quotes, not even their count');
});

test('1. the channel filter: a venture reads that channel\'s sessions, recordings and notes included; a session of another channel is 404', async () => {
  const w = await channels();
  const tg = (await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}&channel=telegram`)).body;
  assert.deepEqual([tg.channel, tg.sessions, Object.keys(tg.by_channel)], ['telegram', 1, ['telegram']]);
  assert.equal(tg.messages.value.total, 3);

  const rec = (await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}&channel=recorder`)).body;
  assert.deepEqual([rec.sessions, rec.sessions_by_channel], [1, { recorder: 1 }], 'a recording is read when its channel is named');
  assert.deepEqual(rec.messages.value, { founder: { typed: 0, recorded: 1 }, customer: { typed: 0, recorded: 1 }, total: 2 });
  assert.deepEqual(rec.voice_minutes.value, 1);

  const notes = (await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}&channel=manual`)).body;
  assert.deepEqual(notes.sessions_by_channel, { manual: 1 });

  const none = (await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}&channel=zoom`)).body;
  assert.deepEqual([none.sessions, none.by_channel], [0, {}]);

  // A chat whose session names no provider is still the thread's channel.
  w.db.prepare('UPDATE interview_sessions SET submitted_via = NULL WHERE id = 11').run();
  w.db.prepare(`INSERT INTO channel_threads (uid, provider, integration_id, user_id, external_chat_id, interview_id, session_id, status)
                VALUES ('th-11', 'telegram', 1, ?, '8001', ?, 11, 'assigned')`).run(ME, INTERVIEW);
  const byThread = (await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}&channel=telegram`)).body;
  assert.equal(byThread.sessions, 1, 'the filter narrows in SQL, by the thread');
  assert.equal((await get(w.env, ME, '/sessions/11/analytics')).body.session.channel, 'telegram');

  const s = await get(w.env, ME, '/sessions/12/analytics?channel=whatsapp');
  assert.equal(s.status, 200);
  assert.equal(s.body.session.channel, 'whatsapp');
  assert.equal((await get(w.env, ME, '/sessions/12/analytics?channel=telegram')).status, 404);
  assert.equal((await get(w.env, ME, '/sessions/13/analytics')).body.session.channel, 'recorder');
  assert.equal((await get(w.env, ME, '/sessions/12/analytics?channel=Tele gram')).status, 400);
  assert.equal((await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}&channel=x;drop`)).status, 400);
  assert.equal((await get(w.env, OTHER, `/conversations/analytics?project_id=${PROJECT}&channel=telegram`)).status, 404, 'the filter changes no one\'s access');
});

// ── 2–4. Telegram end to end ─────────────────────────────────────────────

const LINES = {
  tool: 'We pay Ledgerly every month and still match payments by hand.',
  ask: 'Could it export straight to our accounting tool?',
  voice: 'We lose a whole day every month to this.',
};

/**
 * Workers AI for the digest: speech-to-text answers the note, the summary
 * answers empty, the structure pass places nothing, and D859's extraction
 * lists one item per line it is shown, citing that line.
 */
function model(w: any) {
  const calls: string[] = [];
  w.env.AI.run = async (name: string, input: any) => {
    if (/guard/.test(name)) return { response: 'safe' };
    if (!input?.messages) {
      calls.push('stt');
      return { text: LINES.voice, transcription_info: { language: 'en' } };
    }
    const prompt = JSON.stringify(input);
    if (prompt.includes('Summarise one customer')) { calls.push('summary'); return { response: JSON.stringify({ overview: [], key_quotes: [] }) }; }
    if (!prompt.includes('list what the founder can act on')) { calls.push('structure'); return { response: JSON.stringify({ placements: [] }) }; }
    calls.push('extract');
    const shown = String(input.messages.at(-1).content);
    const items: any[] = [];
    for (const m of shown.matchAll(/\[(\d+)-(\d+)\][^\n]*?: ([^\n]+)/g)) {
      const [from, to, text] = [Number(m[1]), Number(m[2]), m[3].trim()];
      const cite = { from, to };
      if (text === LINES.tool) items.push({ type: 'data_point', kind: 'current_tool', value: 'Ledgerly', confidence: 0.9, cite, quote: text });
      if (text === LINES.ask) items.push({ type: 'prototype_ask', feature: 'Export to the accounting tool', cite, quote: text });
      if (text === LINES.voice) items.push({ type: 'data_point', kind: 'pain', value: 'a lost day each month', severity: 'real', confidence: 0.8, cite, quote: text });
    }
    return { response: JSON.stringify({ items }) };
  };
  return calls;
}

const CHAT = 8001;
let mid = 4000;
/** A business message in the test chat, from the contact unless `me`. */
const msg = (o: { text?: string; voice?: unknown; replyTo?: number } = {}) => ({
  update_id: ++ids.update,
  business_message: {
    message_id: ++mid, business_connection_id: 'BC-ME', date: now(),
    chat: { id: CHAT, type: 'private', first_name: 'Sam' },
    from: { id: CHAT, is_bot: false, first_name: 'Sam', last_name: 'Okafor' },
    ...(o.voice ? { voice: o.voice } : { text: o.text ?? 'Hello.' }),
    ...(o.replyTo ? { reply_to_message: { message_id: o.replyTo, date: now(), chat: { id: CHAT, type: 'private' } } } : {}),
  },
});
const VOICE = { file_id: 'VOICE-1', duration: 5, mime_type: 'audio/ogg', file_size: 4000 };

/** Telegram's Bot API: sendMessage numbered from 9001; one voice file. */
function telegram() {
  let next = 9000;
  return mockFetch((url) => {
    if (url.hostname !== 'api.telegram.org') return undefined;
    if (url.pathname.endsWith('/sendMessage')) return { json: { ok: true, result: { message_id: ++next, date: 1 } } };
    if (url.pathname.endsWith('/getFile')) return { json: { ok: true, result: { file_id: 'VOICE-1', file_size: 4000, file_path: 'voice/f.oga' } } };
    if (url.pathname.startsWith('/file/bot')) return { body: AUDIO.OGG, headers: { 'content-type': 'application/octet-stream' } };
    return undefined;
  });
}
async function hook(env: any, update: unknown) {
  const f = telegram();
  try { assert.equal((await tgHook(env, update)).status, 200); return f.calls; } finally { f.restore(); }
}
const fetchedFiles = (calls: { url: string }[]) => calls.filter((c) => c.url.includes('/getFile') || c.url.includes('/file/bot')).length;

/** A Telegram chat with its two text lines, assigned to the interview. Its text enters at once (D684). */
async function assigned(w: any) {
  await hook(w.env, msg({ text: LINES.tool }));
  await hook(w.env, msg({ text: LINES.ask }));
  const t = (await call(w.env, ME, 'GET', '/threads')).body.items.find((x: any) => x.provider === 'telegram');
  const a = await call(w.env, ME, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.moved, 2, 'Telegram text enters without a YES');
  return { uid: t.uid as string, sessionId: Number(a.body.session_id) };
}

/** The member asks for consent from Axal; the notice's Telegram message id. */
async function ask(w: any, uid: string): Promise<number> {
  const f = telegram();
  try {
    const r = await call(w.env, ME, 'POST', `/threads/${uid}/consent-request`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return 9001;
  } finally { f.restore(); }
}
async function answer(w: any, uid: string, word: string) {
  await hook(w.env, msg({ text: word, replyTo: await ask(w, uid) }));
  for (const j of w.queued.filter((x: any) => x.job_type === 'channel_followup' && x.payload?.kind === 'consent')) {
    await runChannelJob(w.env, 'channel_followup', j.payload);
  }
}
const voiceJobs = (w: any) => w.queued.filter((j: any) => j.job_type === 'channel_followup' && j.payload?.kind === 'voice');
async function runVoice(w: any) {
  const f = telegram();
  try { for (const j of voiceJobs(w)) await runChannelJob(w.env, 'channel_followup', j.payload); return f.calls; } finally { f.restore(); }
}
/** Run the latest digest job the chat queued, as the queue would. */
async function digest(w: any) {
  const job = w.queued.filter((j: any) => j.job_type === 'session_structure').at(-1);
  assert.ok(job, 'the chat queued the engine');
  return runSessionStructureJob(w.env, job.payload) as Promise<any>;
}
const proposals = (w: any, sessionId: number) => w.db.prepare(
  'SELECT kind, status, payload_json, cite_from, cite_to FROM validate_proposals WHERE session_id = ? ORDER BY id',
).all(sessionId).map((p: any) => ({ kind: p.kind, status: p.status, payload: JSON.parse(p.payload_json), cite: [p.cite_from, p.cite_to] }));
const segmentsOf = (w: any, sessionId: number) => w.db.prepare(
  "SELECT text FROM interview_transcript_segments WHERE session_id = ? AND source = 'final' ORDER BY id",
).all(sessionId).map((s: any) => s.text);

test('2. an assigned Telegram text chat reaches structureSession and D859, and its proposals cite their lines', async () => {
  const w: any = await world({ seed: true });
  const { sessionId } = await assigned(w);
  const calls = model(w);
  const out = await digest(w);
  assert.equal(out?.status, 'done', JSON.stringify(out));
  assert.ok(calls.includes('structure'), 'structureSession ran');
  assert.ok(calls.includes('extract'), "D859's extraction ran on the Telegram chat");
  const got = proposals(w, sessionId);
  assert.deepEqual(got.map((p: any) => [p.kind, p.status, p.cite]), [
    ['competitor_mention', 'pending', [0, 1000]],
    ['prototype_ask', 'pending', [1000, 2000]],
  ], 'each a proposal on its own segment, for the founder to accept');
  assert.equal(got[0].payload.name, 'Ledgerly');
  assert.deepEqual(got[1].payload, { feature: 'Export to the accounting tool', build_candidate: true }, 'the prototype ask is marked for Build');
  const r = await get(w.env, ME, `/sessions/${sessionId}/analytics`);
  assert.equal(r.body.session.channel, 'telegram');
  assert.deepEqual(r.body.suggestion_reach.value, { cited: 2, of: 2, share: 1 });
  assert.deepEqual(r.body.messages.sources, ['Typed'], 'chat text is Typed');
});

test('2. a consented Telegram voice note reaches structureSession and D859, and its proposal cites the note', async () => {
  const w: any = await world({ seed: true });
  const { uid, sessionId } = await assigned(w);
  await answer(w, uid, 'YES');
  await hook(w.env, msg({ voice: VOICE }));
  assert.equal(voiceJobs(w).length, 1, 'the note is queued once the contact said YES');
  const calls = model(w);
  assert.equal(fetchedFiles(await runVoice(w)), 2, 'getFile and the download');
  assert.ok(calls.includes('stt'));
  const lines = segmentsOf(w, sessionId);
  assert.equal(lines.at(-1), LINES.voice, 'the note is the last line');
  await digest(w);
  const pain = proposals(w, sessionId).find((p: any) => p.kind === 'pain_severity');
  const at = lines.length - 1;
  assert.deepEqual(pain, { kind: 'pain_severity', status: 'pending', payload: { phrase: 'a lost day each month', severity: 'real' }, cite: [at * 1000, at * 1000 + 1000] });
  const r = await get(w.env, ME, `/sessions/${sessionId}/analytics`);
  assert.deepEqual(r.body.voice_notes, { value: 1, sources: ['Recorded'], reason: null }, 'a voice note is Recorded');
});

test('3. notes held without a YES: nothing is fetched, and the proposals come from the text alone', async () => {
  const w: any = await world({ seed: true });
  const { sessionId } = await assigned(w);
  await hook(w.env, msg({ voice: VOICE }));
  assert.equal(voiceJobs(w).length, 0, 'no YES, no note queued');
  model(w);
  await digest(w);
  assert.deepEqual(proposals(w, sessionId).map((p: any) => p.kind), ['competitor_mention', 'prototype_ask']);
  assert.equal(segmentsOf(w, sessionId).includes(LINES.voice), false, 'the note never became a line');
  assert.equal(w.db.prepare('SELECT COUNT(*) n FROM channel_thread_messages WHERE voice_ref_enc IS NOT NULL').get().n, 1, 'it stays held');
});

test('3. after a NO: the note stays held, and D757 runs nothing more on the declined chat', async () => {
  const w: any = await world({ seed: true });
  const { uid, sessionId } = await assigned(w);
  await hook(w.env, msg({ voice: VOICE }));
  await answer(w, uid, 'No');
  assert.equal(voiceJobs(w).length, 0);
  const calls = model(w);
  const out = await runSessionStructureJob(w.env, { session_id: sessionId, user_id: ME, trigger: 'chat_text_added' }) as any;
  assert.notEqual(out?.status, 'done', 'the declined chat is not digested');
  assert.deepEqual(calls.filter((c) => c !== 'stt'), [], 'no model is called');
  assert.deepEqual(proposals(w, sessionId), [], 'nothing is proposed');
});

test('3. a STOP after a YES fetches nothing more', async () => {
  const w: any = await world({ seed: true });
  const { uid } = await assigned(w);
  await answer(w, uid, 'yes');
  await hook(w.env, msg({ text: 'STOP' }));
  await hook(w.env, msg({ voice: { ...VOICE, file_id: 'VOICE-9' } }));
  assert.equal(voiceJobs(w).length, 0, 'no new note is queued');
  assert.equal(fetchedFiles(await runVoice(w)), 0, 'and nothing is downloaded');
});

test('4. re-running proposes nothing twice, and a decided proposal never returns', async () => {
  const w: any = await world({ seed: true });
  const { sessionId } = await assigned(w);
  const calls = model(w);
  await digest(w);
  assert.equal(proposals(w, sessionId).length, 2);
  calls.length = 0;
  w.db.prepare("UPDATE validate_proposals SET status = 'discarded' WHERE kind = 'prototype_ask' AND session_id = ?").run(sessionId);
  // A new message changes the transcript, so the whole chat is read again, past the engine's spacing.
  await hook(w.env, msg({ text: 'Thanks, talk soon.' }));
  w.db.prepare("UPDATE interview_sessions SET digested_at = datetime('now', '-2 days') WHERE id = ?").run(sessionId);
  const again: any = await runSessionStructureJob(w.env, { session_id: sessionId, user_id: ME, trigger: 'chat_text_added' });
  assert.equal(again?.status, 'done', JSON.stringify(again));
  assert.ok(calls.includes('extract'), 'the second run extracted the same items again');
  assert.deepEqual(proposals(w, sessionId).map((p: any) => [p.kind, p.status]), [['competitor_mention', 'pending'], ['prototype_ask', 'discarded']]);
});
