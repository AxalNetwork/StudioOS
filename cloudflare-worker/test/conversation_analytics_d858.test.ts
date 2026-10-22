/**
 * D858 (#2503) — conversation analytics for Record a Session.
 *
 *   1. A fixture venture's figures equal hand-counted values, for one session
 *      and for the venture's chats over a date range.
 *   2. What the stores do not hold reads null with its reason, never 0; a
 *      store this build lacks reads null and names it.
 *   3. Another founder's venture or session answers 404; HQ staff read it.
 *   4. Quotes appear only for a session whose interview allows quoting, and a
 *      venture's read carries counts, never a quote's words.
 *   5. Coverage: an assigned WhatsApp text chat and a voice note each reach
 *      `structureSession` and produce a module suggestion.
 *
 * Real SQLite through the channel fixture; no provider is called and no
 * customer content is logged.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/conversation_analytics_d858.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import validateConversations from '../src/routes/validate_conversations.ts';
import { REASONS, QUOTES_PER_THEME } from '../src/services/conversationAnalytics.ts';
import { QUOTE_WITHHELD } from '../src/services/cycleValidate.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import { runSessionStructureJob } from '../src/services/sessionAutoStructure.ts';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import {
  ADMIN, call, consentGiven, INTERVIEW, JWT_SECRET, ME, mockFetch, noSecretsSeen, now, OTHER, OTHER_PROJECT, PNID,
  PROJECT, seen, WA_CUSTOMER, waHook, waPayload, waText, world,
} from './_channels_fixture.ts';

test.afterEach(() => { noSecretsSeen(); seen.length = 0; });

const app = new Hono<any>();
app.route('/api/validate', validateConversations);
app.onError((err: any, c) => {
  const st = AUTH_ERROR_STATUSES[err?.message ?? ''];
  return st ? c.json({ detail: err.message }, st) : c.json({ detail: 'Internal server error' }, 500);
});
async function get(env: any, user: number | null, path: string) {
  const headers: Record<string, string> = {};
  if (user != null) {
    headers.authorization = `Bearer ${await new SignJWT({ user_id: user }).setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await app.fetch(new Request(`https://axal.vc/api/validate${path}`, { headers }), env);
  const text = await res.text();
  seen.push(text);
  return { status: res.status, text, body: JSON.parse(text) };
}

// ── The hand-counted venture ─────────────────────────────────────────────

const Q = {
  friday: 'We reconcile invoices by hand every Friday.',
  ask: 'How long does that take?',
  day: 'We lose a whole day every month to this.',
  xero: 'We tried Xero but it was too expensive.',
  pay: 'Would you pay for a fix?',
  sheets: 'Spreadsheets break every quarter.',
};
const SECOND_INTERVIEW = 102;

async function venture() {
  const w: any = await world({ seed: true });
  const db = w.db;
  db.exec(`INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (${SECOND_INTERVIEW}, ${PROJECT}, 'Ana Lee'), (201, ${OTHER_PROJECT}, 'Someone')`);
  db.prepare('UPDATE discovery_interviews SET quote_consent = 1 WHERE id = ?').run(INTERVIEW);
  const session = (id: number, o: { interview: number; project?: number; channel: string; via: string | null; at: string; consent?: string; ms?: number; lang?: string }) =>
    db.prepare(`INSERT INTO interview_sessions (id, uid, interview_id, project_id, created_by_user_id, channel, status, consent_status,
                  submitted_via, active_ms, language, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'structured', ?, ?, ?, ?, ?)`)
      .run(id, `d858-${id}`, o.interview, o.project ?? PROJECT, ME, o.channel, o.consent ?? 'given', o.via, o.ms ?? 0, o.lang ?? null, o.at);
  const line = (sessionId: number, speaker: string, text: string) =>
    db.prepare(`INSERT INTO interview_transcript_segments (session_id, source, speaker_label, text, model) VALUES (?, 'final', ?, ?, 'channel:fixture')`)
      .run(sessionId, speaker, text);
  const note = (sessionId: number, seq: number, lang: string, speaker: string, text: string) =>
    db.prepare(`INSERT INTO interview_chunk_transcripts (session_id, seq, model, language, segments_json, cost_microusd, fallback_used)
                VALUES (?, ?, 'stt-fixture', ?, ?, 0, 0)`).run(sessionId, seq, lang, JSON.stringify([{ speaker_label: speaker, text }]));
  const proposal = (sessionId: number, kind: string, payload: object, status: string, cite: [number, number] | null, quote: string | null = null) =>
    db.prepare(`INSERT INTO validate_proposals (project_id, kind, payload_json, status, created_by, session_id, run_id, cite_from, cite_to, citation_json)
                VALUES (?, ?, ?, ?, ?, ?, 'run-1', ?, ?, ?)`)
      .run(PROJECT, kind, JSON.stringify(payload), status, ME, sessionId, cite?.[0] ?? null, cite?.[1] ?? null,
        quote ? JSON.stringify({ kind: 'transcript', session_id: sessionId, quote }) : null);

  // A — a WhatsApp chat on the interview that allows quoting: five lines, two of them voice notes.
  session(1, { interview: INTERVIEW, channel: 'text', via: 'whatsapp', at: '2026-10-10 09:00:00' });
  line(1, 'Dana Ruiz', Q.friday); line(1, 'Me', Q.ask); line(1, 'Dana Ruiz', Q.day); line(1, 'Dana Ruiz', Q.xero); line(1, 'Me', Q.pay);
  note(1, 10, 'en', 'Dana Ruiz', Q.day); note(1, 11, 'es', 'Me', Q.pay);
  db.exec(`INSERT INTO pain_groups (id, project_id, title) VALUES (1, ${PROJECT}, 'Manual reconciliation'), (2, ${OTHER_PROJECT}, 'Not theirs')`);
  db.exec(`INSERT INTO pain_group_aliases (project_id, group_id, phrase_norm, display_phrase) VALUES (${PROJECT}, 1, 'manual invoices', 'Manual invoices')`);
  proposal(1, 'pain_severity', { phrase: 'Manual invoices', severity: 'severe' }, 'accepted', [0, 1000], Q.friday);
  proposal(1, 'pain_severity', { phrase: 'lost days', severity: 'real', pain_group_id: 1 }, 'pending', [2000, 3000], Q.day);
  proposal(1, 'pain_severity', { phrase: 'onboarding', severity: 'mild' }, 'discarded', [1000, 2000], Q.ask);
  proposal(1, 'objection', { about: 'price', detail: 'too expensive' }, 'pending', [3000, 4000]);
  proposal(1, 'competitor_mention', { name: 'Xero', amount_cents: null }, 'accepted', [3000, 4000]);
  proposal(1, 'demand_signal', { signal: 'would_pay', detail: 'a fix' }, 'pending', null);
  proposal(1, 'budget', { detail: 'none yet' }, 'discarded', null);

  // B — a Telegram chat on an interview with no consent to quote.
  session(2, { interview: SECOND_INTERVIEW, channel: 'text', via: 'telegram', at: '2026-10-20 09:00:00' });
  line(2, 'Ana Lee', Q.sheets);
  // It names another venture's theme: that is no theme of this venture.
  proposal(2, 'pain_severity', { phrase: 'spreadsheets', severity: 'real', pain_group_id: 2 }, 'pending', [0, 1000], Q.sheets);

  // C — a recording, not a chat: in the session read, never in the venture's chats.
  session(3, { interview: INTERVIEW, channel: 'in_person', via: null, at: '2026-10-12 09:00:00', ms: 90_000, lang: 'fr' });
  line(3, 'Me', 'Tell me about month end.'); line(3, 'Dana Ruiz', 'It hurts.');

  // D — another founder's venture.
  session(4, { interview: 201, project: OTHER_PROJECT, channel: 'text', via: 'whatsapp', at: '2026-10-11 09:00:00' });
  line(4, 'Someone', 'Not yours to read.');
  return w;
}

// ── 1. Hand-counted figures ──────────────────────────────────────────────

test('1. a WhatsApp session: every figure equals the hand count, with its sources', async () => {
  const w = await venture();
  const r = await get(w.env, ME, '/sessions/1/analytics');
  assert.equal(r.status, 200, r.text);
  const b = r.body;
  assert.deepEqual(b.session, { id: 1, kind: 'chat', provider: 'whatsapp', channel: 'whatsapp', created_at: '2026-10-10 09:00:00' });
  assert.deepEqual(b.messages, {
    value: { founder: { typed: 1, recorded: 1 }, customer: { typed: 2, recorded: 1 }, unattributed: { typed: 0, recorded: 0 }, total: 5 }, sources: ['Recorded', 'Typed'], reason: null,
  });
  assert.deepEqual(b.voice_notes, { value: 2, sources: ['Recorded'], reason: null });
  assert.deepEqual(b.languages.value, [{ language: 'en', count: 1 }, { language: 'es', count: 1 }]);
  assert.deepEqual(b.suggestion_reach.value, { cited: 4, of: 5, share: 0.8 }, 'the discarded suggestion still reached its line; the uncited one reached none');
  assert.deepEqual(b.pain_themes.value, [{ group_id: 1, title: 'Manual reconciliation', suggested: 2, accepted: 1 }],
    'one by its alias, one by its named theme; the discarded pain is not a theme');
  assert.deepEqual(b.objections.value, [{ about: 'price', suggested: 1, accepted: 0 }]);
  assert.deepEqual(b.wtp_mentions.value, { suggested: 1, accepted: 0, by_kind: { would_pay: 1 } }, 'a discarded budget is not counted');
  assert.deepEqual(b.competitor_mentions.value, [{ name: 'Xero', suggested: 1, accepted: 1 }]);
  assert.deepEqual(b.quotes_by_theme.value, [{ group_id: 1, title: 'Manual reconciliation', quotes: [Q.friday, Q.day] }]);
});

test('1. the venture over a range: aggregates of its chats only, and the range narrows them', async () => {
  const w = await venture();
  const r = await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}&from=2026-10-01&to=2026-10-31`);
  assert.equal(r.status, 200, r.text);
  const b = r.body;
  assert.equal(b.sessions, 2, 'the recording and the other venture are not its chats');
  assert.deepEqual(b.sessions_by_provider, { whatsapp: 1, telegram: 1 });
  assert.deepEqual(b.messages.value, { founder: { typed: 1, recorded: 1 }, customer: { typed: 3, recorded: 1 }, unattributed: { typed: 0, recorded: 0 }, total: 6 });
  assert.equal(b.voice_notes.value, 2);
  assert.deepEqual(b.suggestion_reach.value, { cited: 5, of: 6, share: 0.833 });
  assert.deepEqual(b.pain_themes.value, [
    { group_id: 1, title: 'Manual reconciliation', suggested: 2, accepted: 1 },
    { group_id: null, title: null, suggested: 1, accepted: 0 },
  ]);
  assert.deepEqual(b.quotes_by_theme.value, [
    { group_id: 1, title: 'Manual reconciliation', quotable: 2, withheld: 0 },
    { group_id: null, title: null, quotable: 0, withheld: 1 },
  ]);
  assert.deepEqual(b.languages.value, [{ language: 'en', count: 1 }, { language: 'es', count: 1 }]);
  for (const words of Object.values(Q)) assert.equal(r.text.includes(words), false, 'a venture read carries no conversation text');
  assert.equal(r.text.includes('Not theirs'), false, "another venture's theme is not read");

  const narrow = await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}&from=2026-10-01&to=2026-10-15`);
  assert.equal(narrow.body.sessions, 1, 'to is inclusive of its day, and B on the 20th is out');
  assert.deepEqual(narrow.body.sessions_by_provider, { whatsapp: 1 });
  const onTheDay = await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}&from=2026-10-10&to=2026-10-10`);
  assert.equal(onTheDay.body.sessions, 1, 'a chat at 09:00 on the to-day is in');
  const all = await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}`);
  assert.equal(all.body.sessions, 2, 'no range is every chat');

  w.db.prepare(`INSERT INTO interview_chunk_transcripts (session_id, seq, model, language, segments_json, cost_microusd, fallback_used)
                VALUES (2, 10, 'stt-fixture', 'en', ?, 0, 0)`).run(JSON.stringify([{ speaker_label: 'Ana Lee', text: Q.sheets }]));
  const grouped = await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}`);
  assert.deepEqual(grouped.body.languages.value, [{ language: 'en', count: 2 }, { language: 'es', count: 1 }], 'one language, counted across chats');
});

// ── 2. NULLs with a reason ───────────────────────────────────────────────

test('2. what no store holds reads null with its reason, never 0', async () => {
  const w = await venture();
  const chat = (await get(w.env, ME, '/sessions/1/analytics')).body;
  assert.deepEqual(chat.median_reply_seconds, { value: null, sources: [], reason: REASONS.replyTime });
  assert.deepEqual(chat.voice_minutes, { value: null, sources: [], reason: REASONS.chatVoiceMinutes });
  assert.deepEqual(chat.text_languages, { value: null, sources: [], reason: REASONS.textLanguage });

  const rec = (await get(w.env, ME, '/sessions/3/analytics')).body;
  assert.equal(rec.session.kind, 'recording');
  assert.deepEqual(rec.voice_minutes, { value: 1.5, sources: ['Recorded'], reason: null }, 'a recording knows its minutes');
  assert.deepEqual(rec.voice_notes, { value: null, sources: [], reason: REASONS.notChat });
  assert.deepEqual(rec.languages.value, [{ language: 'fr', count: 1 }]);
  assert.deepEqual(rec.messages.value, { founder: { typed: 0, recorded: 1 }, customer: { typed: 0, recorded: 1 }, unattributed: { typed: 0, recorded: 0 }, total: 2 });
  assert.deepEqual(rec.median_reply_seconds.reason, REASONS.replyTimeNotChat);

  assert.deepEqual(rec.suggestion_reach.value, { cited: 0, of: 2, share: 0 });
  w.db.prepare(`INSERT INTO validate_proposals (project_id, kind, payload_json, status, created_by, session_id, run_id, cite_from, cite_to)
                VALUES (?, 'objection', '{}', 'pending', ?, 3, 'run-3', ?, ?)`).run(PROJECT, ME, null, null);
  w.db.prepare(`INSERT INTO validate_proposals (project_id, kind, payload_json, status, created_by, session_id, run_id, cite_from, cite_to)
                VALUES (?, 'objection', '{}', 'pending', ?, 3, 'run-3', ?, ?)`).run(PROJECT, ME, null, 2000);
  const uncited = (await get(w.env, ME, '/sessions/3/analytics')).body;
  assert.deepEqual(uncited.suggestion_reach.value, { cited: 0, of: 2, share: 0 }, 'a suggestion without a whole cite reaches no line');

  const empty = (await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}&from=2025-01-01&to=2025-01-31`)).body;
  assert.equal(empty.sessions, 0);
  assert.deepEqual(empty.suggestion_reach, { value: null, sources: [], reason: REASONS.noTranscript }, 'no transcript is not a reach of 0');
});

test('2. a store this build lacks reads null and names it, never 0', async () => {
  const w = await venture();
  w.db.exec('DROP TABLE pain_group_aliases');
  const noThemes = (await get(w.env, ME, '/sessions/1/analytics')).body;
  assert.deepEqual(noThemes.pain_themes, { value: null, sources: [], reason: REASONS.unreadable('pain-theme store') });
  assert.deepEqual(noThemes.quotes_by_theme.reason, REASONS.unreadable('pain-theme store'));
  assert.equal(noThemes.objections.value.length, 1, 'the other figures still read');

  w.db.exec('DROP TABLE validate_proposals');
  const r = await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}`);
  assert.equal(r.status, 200, r.text);
  for (const k of ['suggestion_reach', 'pain_themes', 'objections', 'wtp_mentions', 'competitor_mentions', 'quotes_by_theme']) {
    assert.deepEqual(r.body[k], { value: null, sources: [], reason: REASONS.unreadable('suggestion store') }, k);
  }
  assert.equal(r.body.messages.value.total, 6, 'the transcript still counts');
});

// ── 3. Tenant ────────────────────────────────────────────────────────────

test("3. another founder's venture and session answer 404; HQ staff read; bad input is 400; signed out is 401", async () => {
  const w = await venture();
  assert.equal((await get(w.env, OTHER, '/sessions/1/analytics')).status, 404);
  assert.equal((await get(w.env, OTHER, `/conversations/analytics?project_id=${PROJECT}`)).status, 404);
  assert.equal((await get(w.env, ME, '/sessions/4/analytics')).status, 404, "a session in another venture");
  assert.equal((await get(w.env, ME, `/conversations/analytics?project_id=${OTHER_PROJECT}`)).status, 404);
  assert.equal((await get(w.env, ME, '/sessions/999/analytics')).status, 404);
  assert.equal((await get(w.env, ME, '/conversations/analytics?project_id=999')).status, 404);
  const other = await get(w.env, OTHER, '/sessions/1/analytics');
  assert.equal(other.text.includes('Dana'), false);
  assert.equal((await get(w.env, ADMIN, '/sessions/1/analytics')).status, 200);
  assert.equal((await get(w.env, ME, '/sessions/abc/analytics')).status, 400);
  assert.equal((await get(w.env, ME, '/conversations/analytics')).status, 400);
  assert.equal((await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}&from=2026-02-30`)).status, 400);
  assert.equal((await get(w.env, ME, `/conversations/analytics?project_id=${PROJECT}&from=2026-10-31&to=2026-10-01`)).status, 400);
  assert.equal((await get(w.env, null, '/sessions/1/analytics')).status, 401);
});

// ── 4. Quote consent ─────────────────────────────────────────────────────

test('4. quotes only where the interview allows quoting, and not once the chat consent is withdrawn', async () => {
  const w = await venture();
  const b = await get(w.env, ME, '/sessions/2/analytics');
  assert.deepEqual(b.body.quotes_by_theme, { value: null, sources: [], reason: QUOTE_WITHHELD });
  assert.equal(b.text.includes(Q.sheets), false, 'a withheld quote is not answered');

  w.db.prepare("UPDATE interview_sessions SET consent_status = 'declined' WHERE id = 1").run();
  const a = await get(w.env, ME, '/sessions/1/analytics');
  assert.deepEqual(a.body.quotes_by_theme.reason, QUOTE_WITHHELD);
  assert.equal(a.text.includes(Q.friday), false);

  w.db.prepare("UPDATE interview_sessions SET consent_status = 'given' WHERE id = 1").run();
  for (let i = 0; i < QUOTES_PER_THEME + 2; i += 1) {
    w.db.prepare(`INSERT INTO validate_proposals (project_id, kind, payload_json, status, created_by, session_id, run_id, citation_json)
                  VALUES (?, 'pain_severity', ?, 'pending', ?, 1, 'run-2', ?)`)
      .run(PROJECT, JSON.stringify({ phrase: 'manual invoices', severity: 'real' }), ME, JSON.stringify({ quote: `${Q.friday} (${i})` }));
  }
  const capped = await get(w.env, ME, '/sessions/1/analytics');
  assert.equal(capped.body.quotes_by_theme.value[0].quotes.length, QUOTES_PER_THEME);
});

// ── 5. Coverage: text and voice reach structureSession ───────────────────

/** A model that answers the summary and places one pain on the line it is given. */
function placingModel(w: any, quote: string, cite: { from: number; to: number }) {
  const calls: string[] = [];
  w.env.AI.run = async (model: string, input: unknown) => {
    if (/guard/.test(model)) return { response: 'safe' };
    const prompt = JSON.stringify(input);
    calls.push(prompt.includes('Summarise one customer') ? 'summary' : 'structure');
    return { response: JSON.stringify(prompt.includes('Summarise one customer')
      ? { overview: [], key_quotes: [] }
      : { placements: [{ kind: 'pain_severity', payload: { phrase: 'month end by hand', severity: 'severe' }, cite, quote }] }) };
  };
  return calls;
}
const structureJobs = (w: any, trigger: string) => w.queued.filter((j: any) => j.job_type === 'session_structure' && j.payload?.trigger === trigger);

async function assignedChat(w: any) {
  await waHook(w.env, waText(PNID, 'wamid.T1', 'We close the books by hand every month.'));
  const [t] = (await call(w.env, ME, 'GET', '/threads')).body.items;
  const a = await call(w.env, ME, 'POST', `/threads/${t.uid}/assign`, { interview_id: INTERVIEW });
  assert.equal(a.status, 200);
  await consentGiven(w.env, w.db, t.uid);
  return Number(a.body.session_id);
}

test('5. coverage: an assigned WhatsApp text chat reaches structureSession and produces a suggestion', async () => {
  const w: any = await world({ seed: true });
  const sessionId = await assignedChat(w);
  const [job] = structureJobs(w, 'chat_text_added');
  assert.ok(job, 'the moved text queues the engine');
  const calls = placingModel(w, 'We close the books by hand every month.', { from: 0, to: 1000 });
  const out: any = await runSessionStructureJob(w.env, job.payload);
  assert.equal(out?.status, 'done');
  assert.ok(calls.includes('structure'), 'structureSession ran');
  const rows = w.db.prepare("SELECT kind, status FROM validate_proposals WHERE session_id = ?").all(sessionId);
  assert.deepEqual(rows.map((r: any) => [r.kind, r.status]), [['pain_severity', 'pending']], 'a suggestion for the founder to accept');
  const r = await get(w.env, ME, `/sessions/${sessionId}/analytics`);
  assert.deepEqual(r.body.pain_themes.value, [{ group_id: null, title: null, suggested: 1, accepted: 0 }]);
  assert.deepEqual(r.body.suggestion_reach.value, { cited: 1, of: 1, share: 1 });
});

test('5. coverage: a consented WhatsApp voice note reaches structureSession and produces a suggestion', async () => {
  const w: any = await world({ seed: true });
  const sessionId = await assignedChat(w);
  await waHook(w.env, waPayload(PNID, {
    contacts: [{ profile: { name: 'Priya Shah' }, wa_id: WA_CUSTOMER }],
    messages: [{ from: WA_CUSTOMER, id: 'wamid.V1', timestamp: String(now()), type: 'audio', audio: { id: 'MEDIA-1', mime_type: 'audio/ogg; codecs=opus', voice: true } }],
  }));
  const voiceJob = w.queued.filter((j: any) => j.job_type === 'channel_followup' && j.payload?.kind === 'voice').at(-1);
  const f = mockFetch((url: URL) => {
    if (url.hostname === 'graph.facebook.com') return { json: { url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=MEDIA-1', mime_type: 'audio/ogg', file_size: 4000, id: 'MEDIA-1' } };
    if (url.hostname === 'lookaside.fbsbx.com') return { body: new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]), headers: { 'content-type': 'application/octet-stream' } };
    return undefined;
  });
  try { await runChannelJob(w.env, 'channel_followup', voiceJob.payload); } finally { f.restore(); }
  const [job] = structureJobs(w, 'voice_note_added');
  assert.ok(job, 'the transcribed note queues the engine');
  // The note is the second line: its span is [1000, 2000).
  const calls = placingModel(w, 'We lose a whole day every month to this.', { from: 1000, to: 2000 });
  const out: any = await runSessionStructureJob(w.env, job.payload);
  assert.equal(out?.status, 'done');
  assert.ok(calls.includes('structure'), 'structureSession ran');
  const rows = w.db.prepare('SELECT kind, cite_from FROM validate_proposals WHERE session_id = ?').all(sessionId);
  assert.deepEqual(rows.map((r: any) => [r.kind, r.cite_from]), [['pain_severity', 1000]], 'the suggestion cites the voice note');
  const r = await get(w.env, ME, `/sessions/${sessionId}/analytics`);
  assert.deepEqual(r.body.voice_notes, { value: 1, sources: ['Recorded'], reason: null });
  assert.deepEqual(r.body.messages.value.customer, { typed: 1, recorded: 1 });
  assert.deepEqual(r.body.languages.value, [{ language: 'en', count: 1 }]);
});
