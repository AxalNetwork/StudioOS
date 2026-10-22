/**
 * D864 (#2510) — the customer-chat tools on the MCP server
 * (`mcp/tools/channels.ts`), driven through the real `callTool` on D684's
 * channel world (`_channels_fixture.ts`) plus migration 524: real Telegram
 * webhooks make the chats, the inbox route assigns one, and the tools read and
 * assign the rest.
 *
 * Covers the scope gates, ownership and ventures, the provider filter, the
 * no-text rule, assignment parity with the route, and one usage row per call.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/channel_mcp_tools_d864.test.ts
 */
import test from 'node:test';
import { encryptColumn } from '../src/services/columnCipher.ts';
import assert from 'node:assert/strict';
import { callTool, listedTools, registeredTools } from '../src/mcp/server.ts';
import {
  businessMessage, call, consentGiven, count, INTERVIEW, ME, mig, mockFetch, OTHER, OTHER_PROJECT, PROJECT, SECRET_VALUES,
  TG_ME, telegramApi, tgHook, WA_CUSTOMER, world,
} from './_channels_fixture.ts';

const SECOND = 11, SECOND_INTERVIEW = 102, LOST_INTERVIEW = 103;
const TEXT = { a: 'TEXT-A invoices by hand every Friday', b: 'TEXT-B month-end takes four days', c: 'TEXT-C payroll by spreadsheet' };
const QUOTE = 'QUOTE-ONLY-IN-CITATION';
const READ = ['validate:read'];
const WRITE = ['validate:read', 'validate:write'];

const grant = (companies: number[], userId = ME) => ({
  userId, companies, clientId: 'client-864', clientName: 'Test Assistant', redirectHost: null, redirectUri: null,
  grantedAt: Math.floor(Date.now() / 1000),
});
const tool = (name: string) => registeredTools().find((t) => t.name === name)!;
const body = (r: any) => JSON.parse(r.content[0].text);
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const saved = [console.warn, console.error];
  console.warn = () => {}; console.error = () => {};
  try { return await f(); } finally { [console.warn, console.error] = saved; }
};

/**
 * ME's chats: A pending (Telegram), B assigned to INTERVIEW in PROJECT through
 * the route, C assigned to SECOND_INTERVIEW in SECOND (ME's second venture),
 * W a WhatsApp chat (direct row). OTHER has one pending chat of their own.
 */
async function setup() {
  const w = await world({ seed: true });
  const { db, env } = w;
  db.exec(mig('524_api_usage_events.sql'));
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${SECOND}, 'Second venture', 9);
           INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (${SECOND_INTERVIEW}, ${SECOND}, 'Lee'), (${LOST_INTERVIEW}, ${OTHER_PROJECT}, 'Nope');
           INSERT INTO integrations (uid, user_id, provider_key, auth_type, external_account_id, config_json) VALUES ('tg-other', ${OTHER}, 'telegram', 'webhook', '555009', '{}')`);
  const f = mockFetch(telegramApi);
  try {
    await tgHook(env, businessMessage('BC-ME', { chat: 8001, text: TEXT.a }));
    await tgHook(env, businessMessage('BC-ME', { chat: 8002, text: TEXT.b }));
    await tgHook(env, businessMessage('BC-ME', { chat: 8003, text: TEXT.c }));
  } finally { f.restore(); }
  const uidOf = (chat: string) => db.prepare('SELECT uid FROM channel_threads WHERE external_chat_id = ?').get(chat).uid as string;
  const A = uidOf('8001'), B = uidOf('8002'), C = uidOf('8003');
  const viaRoute = async (uid: string, interviewId: number) => {
    const r = await call(env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: interviewId });
    assert.equal(r.status, 200);
    return Number(r.body.session_id);
  };
  const sessionB = await viaRoute(B, INTERVIEW);
  const sessionC = await viaRoute(C, SECOND_INTERVIEW);
  const waIntegration = db.prepare(`SELECT id FROM integrations WHERE uid = 'wa-me'`).get().id;
  const otherIntegration = db.prepare(`SELECT id FROM integrations WHERE uid = 'tg-other'`).get().id;
  db.prepare(`INSERT INTO channel_threads (uid, provider, integration_id, user_id, external_chat_id, status) VALUES ('wa-thread-1', 'whatsapp', ?, ?, ?, 'pending')`)
    .run(waIntegration, ME, WA_CUSTOMER);
  db.prepare(`INSERT INTO channel_threads (uid, provider, integration_id, user_id, external_chat_id, status) VALUES ('other-thread-1', 'telegram', ?, ?, '9009', 'pending')`)
    .run(otherIntegration, OTHER);
  return { ...w, A, B, C, W: 'wa-thread-1', OTHERS: 'other-thread-1', sessionB, sessionC };
}

const ids = (r: any) => body(r).chats.map((c: any) => c.id).sort();

test('list_channel_chats: only the member\'s own chats; an assigned chat only while its venture is in the grant and readable', async () => {
  const s = await setup();
  const all = await quiet(() => callTool(s.env, grant([PROJECT, SECOND]), 'g-864', tool('list_channel_chats'), {}, READ));
  assert.deepEqual(ids(all), [s.A, s.B, s.C, s.W].sort(), 'ME\'s four chats; never OTHER\'s');
  const byId = Object.fromEntries(body(all).chats.map((c: any) => [c.id, c]));
  assert.deepEqual(
    [byId[s.A].state, byId[s.A].company, byId[s.B].state, byId[s.B].company, byId[s.B].interview_id, byId[s.B].session_id],
    ['pending', null, 'assigned', { id: PROJECT, name: 'Ledger tool' }, INTERVIEW, s.sessionB],
  );
  assert.deepEqual([byId[s.A].messages, byId[s.A].notes_waiting, byId[s.A].language], [1, 0, null]);
  assert.equal(byId[s.A].consent, 'not_asked', 'a Telegram chat\'s note consent, never asked yet');

  // A grant without SECOND does not reach the chat assigned there.
  assert.deepEqual(ids(await quiet(() => callTool(s.env, grant([PROJECT]), 'g-864', tool('list_channel_chats'), {}, READ))), [s.A, s.B, s.W].sort());
  // ME loses SECOND: still in the grant, no longer readable (canReadBoard), so its chat drops out.
  s.db.exec(`UPDATE projects SET founder_id = 99 WHERE id = ${SECOND}`);
  assert.deepEqual(ids(await quiet(() => callTool(s.env, grant([PROJECT, SECOND]), 'g-864', tool('list_channel_chats'), {}, READ))), [s.A, s.B, s.W].sort());
  // OTHER sees only their own.
  assert.deepEqual(ids(await quiet(() => callTool(s.env, grant([], OTHER), 'g-other', tool('list_channel_chats'), {}, READ))), [s.OTHERS]);
});

test('list_channel_chats: the provider and state filters, and the limit counts only what the call may see', async () => {
  const s = await setup();
  const list = (args: Record<string, unknown>, companies = [PROJECT, SECOND]) =>
    quiet(() => callTool(s.env, grant(companies), 'g-864', tool('list_channel_chats'), args, READ));
  assert.deepEqual(ids(await list({ provider: 'whatsapp' })), [s.W]);
  assert.deepEqual(ids(await list({ provider: 'telegram' })), [s.A, s.B, s.C].sort());
  assert.deepEqual(ids(await list({ state: 'assigned' })), [s.B, s.C].sort());
  assert.deepEqual(ids(await list({ provider: 'telegram', state: 'pending' })), [s.A]);
  // SECOND out of the grant: limit 3 still returns three chats this call may see.
  assert.deepEqual(ids(await list({ limit: 3 }, [PROJECT])), [s.A, s.B, s.W].sort());
});

test('default tool output carries no message text, a contact name, a phone number, a provider id, a quote or a secret', async () => {
  const s = await setup();
  s.db.prepare(`INSERT INTO validate_proposals (project_id, kind, payload_json, status, session_id, citation_json) VALUES (?, 'pain_tag', ?, 'pending', ?, ?)`)
    .run(PROJECT, JSON.stringify({ label: 'Manual reconciliation' }), s.sessionB, JSON.stringify({ kind: 'transcript', quote: QUOTE }));
  const outs = [
    await quiet(() => callTool(s.env, grant([PROJECT, SECOND]), 'g-864', tool('list_channel_chats'), {}, READ)),
    await quiet(() => callTool(s.env, grant([PROJECT]), 'g-864', tool('get_session_insights'), { company: PROJECT, session_id: s.sessionB }, READ)),
    await quiet(() => callTool(s.env, grant([PROJECT]), 'g-864', tool('assign_chat_to_interview'), { company: PROJECT, chat: s.A, interview_id: INTERVIEW }, WRITE)),
  ];
  const dump = JSON.stringify(outs);
  for (const t of [...Object.values(TEXT), QUOTE, 'Sam', 'Okafor', '8001', '8002', TG_ME, WA_CUSTOMER, ...SECRET_VALUES]) {
    assert.equal(dump.includes(t), false, `a tool output carried ${t}`);
  }
  assert.ok(outs.every((o: any) => !o.isError), 'every call answered');
  // Tool output is data: the listing a client reads names no chat's text.
  const listing = JSON.stringify((await listedTools(s.env, grant([PROJECT]), WRITE)).tools.map((t) => [t.name, t.title, t.description]));
  for (const t of Object.values(TEXT)) assert.equal(listing.includes(t), false);
});

test('get_session_insights: the session\'s suggestions as kind, state and payload; refused for any other session', async () => {
  const s = await setup();
  const p = s.db.prepare(`INSERT INTO validate_proposals (project_id, kind, payload_json, edited_payload_json, status, session_id, citation_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  p.run(PROJECT, 'pain_tag', JSON.stringify({ label: 'Manual reconciliation' }), null, 'pending', s.sessionB, JSON.stringify({ quote: QUOTE }));
  p.run(PROJECT, 'hypothesis', JSON.stringify({ statement: 'draft' }), JSON.stringify({ statement: 'Finance teams close late' }), 'accepted', s.sessionB, null);
  const insights = (company: number, session: number, companies = [PROJECT, SECOND], user = ME) =>
    quiet(() => callTool(s.env, grant(companies, user), 'g-864', tool('get_session_insights'), { company, session_id: session }, READ));

  const ok = body(await insights(PROJECT, s.sessionB));
  assert.deepEqual([ok.session.id, ok.session.provider, ok.session.interview_id], [s.sessionB, 'telegram', INTERVIEW]);
  assert.equal(ok.analytics.messages.value.total, 1);
  assert.equal('quotes_by_theme' in ok.analytics, false);
  assert.deepEqual(ok.suggestions.map((x: any) => [x.kind, x.state, x.payload]), [
    ['pain_tag', 'pending', { label: 'Manual reconciliation' }],
    ['hypothesis', 'accepted', { statement: 'Finance teams close late' }],
  ], 'the edited payload when there is one; never the citation');

  // In order: the second case changes the session the first one reads.
  const refusals: Array<[string, () => Promise<any>]> = [
    ['the session in another company', () => insights(PROJECT, s.sessionC)],
    ['a chat session another member of the venture made', async () => {
      s.db.exec(`UPDATE interview_sessions SET created_by_user_id = ${OTHER} WHERE id = ${s.sessionB}`);
      try { return await insights(PROJECT, s.sessionB); } finally {
        s.db.exec(`UPDATE interview_sessions SET created_by_user_id = ${ME} WHERE id = ${s.sessionB}`);
      }
    }],
    ['a session that is not a chat session', () => {
      s.db.exec(`UPDATE interview_sessions SET submitted_via = NULL WHERE id = ${s.sessionC}`);
      return insights(SECOND, s.sessionC);
    }],
  ];
  for (const [label, r] of refusals) {
    const res = await r();
    assert.equal(res.isError, true, label);
    assert.equal(body(res).code, 'session_not_found', label);
  }
  // OTHER, granted ME's company, is refused at the company check before any read.
  const other = await insights(PROJECT, s.sessionB, [PROJECT], OTHER);
  assert.equal(other.isError, true);
  assert.equal(JSON.stringify(body(other)).includes('Manual'), false);
  // A contact who said no: the session's state, and no suggestions.
  s.db.exec(`UPDATE interview_sessions SET consent_status = 'declined' WHERE id = ${s.sessionB}`);
  assert.deepEqual(body(await insights(PROJECT, s.sessionB)).suggestions, []);
});

test('assign_chat_to_interview: scope first, then the route\'s own refusals; it assigns as the route does and leaves consent alone', async () => {
  const s = await setup();
  const assign = (args: Record<string, unknown>, scope = WRITE, companies = [PROJECT, SECOND]) =>
    quiet(() => callTool(s.env, grant(companies), 'g-864', tool('assign_chat_to_interview'), args, scope));
  const state = (uid: string) => s.db.prepare('SELECT status, interview_id, session_id, consent_state FROM channel_threads WHERE uid = ?').get(uid);
  const before = state(s.A);

  // Without validate:write: refused before any work.
  const noScope = await assign({ company: PROJECT, chat: s.A, interview_id: INTERVIEW }, READ);
  assert.equal(noScope.isError, true);
  assert.deepEqual(state(s.A), before, 'nothing changed');
  assert.equal(count(s.db, `SELECT COUNT(*) n FROM interview_sessions WHERE interview_id = ${INTERVIEW}`), 1, 'no session opened');

  // The route's refusals, code for code.
  const route = async (uid: string, interviewId: number) => (await call(s.env, ME, 'POST', `/threads/${uid}/assign`, { interview_id: interviewId })).body.code;
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['another member\'s chat', { company: PROJECT, chat: s.OTHERS, interview_id: INTERVIEW }, await route(s.OTHERS, INTERVIEW)],
    ['an interview in another venture', { company: PROJECT, chat: s.A, interview_id: SECOND_INTERVIEW }, 'interview_not_found'],
    ['an interview the member cannot write', { company: PROJECT, chat: s.A, interview_id: LOST_INTERVIEW }, await route(s.A, LOST_INTERVIEW)],
  ];
  for (const [label, args, code] of cases) {
    const r = await assign(args);
    assert.equal(r.isError, true, label);
    assert.equal(body(r).code, code, label);
    assert.deepEqual(state(s.A), before, `${label}: nothing changed`);
  }
  assert.equal(cases[0][2], 'thread_not_found');
  assert.equal(cases[2][2], 'interview_not_found');
  // A company outside the grant is refused at the company check.
  assert.equal((await assign({ company: OTHER_PROJECT, chat: s.A, interview_id: LOST_INTERVIEW })).isError, true);

  // The assignment itself: the waiting text becomes the session's first segment, as the route does it.
  const ok = await assign({ company: PROJECT, chat: s.A, interview_id: INTERVIEW });
  assert.equal(ok.isError, undefined);
  const out = body(ok);
  const after = state(s.A);
  assert.deepEqual([after.status, after.interview_id, after.session_id], ['assigned', INTERVIEW, out.session_id]);
  assert.deepEqual([out.chat, out.interview_id, out.moved, out.notes_queued, out.consent], [s.A, INTERVIEW, 1, 0, 'not_asked']);
  assert.equal(count(s.db, `SELECT COUNT(*) n FROM interview_transcript_segments WHERE session_id = ${out.session_id}`), 1);
  assert.equal(count(s.db, `SELECT COUNT(*) n FROM channel_thread_messages WHERE thread_id = (SELECT id FROM channel_threads WHERE uid = '${s.A}')`), 0);
  // Consent untouched: none recorded, and no quote consent on the interview.
  assert.equal(after.consent_state, before.consent_state);
  assert.equal(count(s.db, 'SELECT COUNT(*) n FROM channel_consents'), 0);
  assert.equal(s.db.prepare(`SELECT quote_consent FROM discovery_interviews WHERE id = ${INTERVIEW}`).get().quote_consent, null);
  // A Telegram chat given consent through the contact's own YES keeps it.
  await consentGiven(s.env, null, s.B);
  assert.equal(body(await quiet(() => callTool(s.env, grant([PROJECT]), 'g-864', tool('list_channel_chats'), { state: 'assigned' }, READ)))
    .chats.find((c: any) => c.id === s.B).consent, 'given');
});

test('one usage row per call, with its operation and outcome; no AI tokens held', async () => {
  const s = await setup();
  const g = grant([PROJECT]);
  await quiet(() => callTool(s.env, g, 'g-864', tool('list_channel_chats'), {}, READ));
  await quiet(() => callTool(s.env, g, 'g-864', tool('get_session_insights'), { company: PROJECT, session_id: s.sessionB }, READ));
  await quiet(() => callTool(s.env, g, 'g-864', tool('assign_chat_to_interview'), { company: PROJECT, chat: s.A, interview_id: INTERVIEW }, READ));
  await quiet(() => callTool(s.env, g, 'g-864', tool('assign_chat_to_interview'), { company: PROJECT, chat: s.A, interview_id: INTERVIEW }, WRITE));
  const rows = s.db.prepare('SELECT operation, outcome, error_category, user_id, grant_id FROM api_usage_events ORDER BY id').all()
    .map((r: any) => [r.operation, r.outcome, r.error_category, r.user_id, r.grant_id]);
  assert.deepEqual(rows, [
    ['list_channel_chats', 'ok', null, ME, 'g-864'],
    ['get_session_insights', 'ok', null, ME, 'g-864'],
    ['assign_chat_to_interview', 'refused', 'scope', ME, 'g-864'],
    ['assign_chat_to_interview', 'ok', null, ME, 'g-864'],
  ]);
  assert.equal(count(s.db, 'SELECT COUNT(*) n FROM ai_budget_reservations'), 0, 'a free tool holds nothing');
});

// Owner ruling Q1 B / Q2 A, relayed on #2510 on 2026-10-22.
const transcriptRead = (s: any, args: Record<string, unknown> = {}, scope = READ, companies = [PROJECT], user = ME) =>
  quiet(() => callTool(s.env, grant(companies, user), 'g-864', tool('get_session_insights'),
    { company: PROJECT, session_id: s.sessionB, include_transcript: true, ...args }, scope));

test('transcripts are opt-in, require validate:read, and recheck session, venture and assignment consent', async () => {
  const s = await setup();
  await consentGiven(s.env, null, s.B);
  const normal = body(await transcriptRead(s, { include_transcript: false }));
  assert.equal('transcript' in normal, false);
  assert.equal(JSON.stringify(normal).includes(TEXT.b), false);
  assert.equal((await transcriptRead(s, {}, [])).isError, true);
  const allowed = body(await transcriptRead(s));
  assert.equal(allowed.transcript.segments[0].text, TEXT.b);
  assert.equal(allowed.transcript.segments[0].speaker, s.db.prepare('SELECT speaker_label FROM interview_transcript_segments WHERE session_id = ?').get(s.sessionB).speaker_label);
  assert.equal(allowed.transcript.complete, true);
  const changes = [
    [`UPDATE interview_sessions SET consent_status = 'not_recorded' WHERE id = ?`, [s.sessionB],
     `UPDATE interview_sessions SET consent_status = 'given' WHERE id = ?`, [s.sessionB]],
    [`UPDATE channel_threads SET consent_state = 'awaiting' WHERE uid = ?`, [s.B],
     `UPDATE channel_threads SET consent_state = 'given' WHERE uid = ?`, [s.B]],
    [`UPDATE channel_threads SET consent_state = 'withdrawn' WHERE uid = ?`, [s.B],
     `UPDATE channel_threads SET consent_state = 'given' WHERE uid = ?`, [s.B]],
    [`UPDATE channel_threads SET status = 'pending' WHERE uid = ?`, [s.B],
     `UPDATE channel_threads SET status = 'assigned' WHERE uid = ?`, [s.B]],
    [`UPDATE channel_threads SET status = 'ignored' WHERE uid = ?`, [s.B],
     `UPDATE channel_threads SET status = 'assigned' WHERE uid = ?`, [s.B]],
    [`UPDATE channel_threads SET user_id = ? WHERE uid = ?`, [OTHER, s.B],
     `UPDATE channel_threads SET user_id = ? WHERE uid = ?`, [ME, s.B]],
    [`UPDATE integrations SET status = 'revoked' WHERE uid = 'tg-me'`, [],
     `UPDATE integrations SET status = 'active' WHERE uid = 'tg-me'`, []],
  ] as Array<[string, any[], string, any[]]>;
  for (const [change, values, restore, old] of changes) {
    s.db.prepare(change).run(...values);
    try {
      const refused = body(await transcriptRead(s));
      assert.equal(refused.transcript, null, change);
      assert.equal(JSON.stringify(refused).includes(TEXT.b), false, change);
    } finally { s.db.prepare(restore).run(...old); }
  }
  // A thread on another member's own integration still cannot export this session.
  const integration = s.db.prepare('SELECT integration_id FROM channel_threads WHERE uid = ?').get(s.B).integration_id;
  const foreignIntegration = s.db.prepare("SELECT id FROM integrations WHERE uid = 'tg-other'").get().id;
  s.db.prepare('UPDATE channel_threads SET user_id = ?, integration_id = ? WHERE uid = ?').run(OTHER, foreignIntegration, s.B);
  try {
    const otherThread = body(await transcriptRead(s));
    assert.equal(otherThread.transcript, null);
    assert.equal(JSON.stringify(otherThread).includes(TEXT.b), false);
  } finally {
    s.db.prepare('UPDATE channel_threads SET user_id = ?, integration_id = ? WHERE uid = ?').run(ME, integration, s.B);
  }
  assert.equal((await transcriptRead(s, { company: SECOND }, READ, [PROJECT, SECOND])).isError, true);
  assert.equal((await transcriptRead(s, {}, READ, [PROJECT], OTHER)).isError, true);
});

test('transcript pages contain only stored final segments, in transcript order, and a cursor is scoped to that session', async () => {
  const s = await setup();
  await consentGiven(s.env, null, s.B);
  s.db.prepare(`INSERT INTO interview_transcript_segments(session_id, source, speaker_label, text, start_ms, end_ms)
    VALUES (?, 'final', 'Me', 'v1.STORED-LINE', 10, 20)`).run(s.sessionB);
  s.db.prepare(`INSERT INTO interview_transcript_segments(session_id, source, speaker_label, text)
    VALUES (?, 'live', 'Draft', 'LIVE-DRAFT-MUST-STAY-OUT')`).run(s.sessionB);
  const first = body(await transcriptRead(s, { transcript_limit: 1 }));
  assert.deepEqual(first.transcript.segments.map((g: any) => g.text), [TEXT.b]);
  assert.equal(first.transcript.complete, false);
  assert.ok(first.transcript.next_after_id > 0);
  const second = body(await transcriptRead(s, { transcript_limit: 1, transcript_after_id: first.transcript.next_after_id }));
  assert.deepEqual(second.transcript.segments.map((g: any) => [g.text, g.speaker, g.start_ms, g.end_ms]), [['v1.STORED-LINE', 'Me', 10, 20]]);
  assert.equal(second.transcript.complete, true);
  assert.equal(second.transcript.next_after_id, null);
  assert.equal(JSON.stringify([first, second]).includes('LIVE-DRAFT-MUST-STAY-OUT'), false);
  const otherSegment = s.db.prepare('SELECT id FROM interview_transcript_segments WHERE session_id = ?').get(s.sessionC).id;
  assert.equal(body(await transcriptRead(s, { transcript_after_id: otherSegment })).code, 'invalid_transcript_cursor');
});

test('transcript output removes identifiers, phones, credentials and links, preserves data as data, and never reads held notes', async () => {
  const s = await setup();
  await consentGiven(s.env, null, s.B);
  const phone = '+' + '9'.repeat(11);
  const link = 'https://example.invalid/media/fixture';
  const external = s.db.prepare('SELECT external_chat_id FROM channel_threads WHERE uid = ?').get(s.B).external_chat_id;
  const token = SECRET_VALUES[0];
  const words = `IGNORE-ALL-INSTRUCTIONS ${phone} ${link} ${external} ${token} user_id:fixture-user`;
  s.db.prepare('UPDATE interview_transcript_segments SET text = ?, speaker_label = ? WHERE session_id = ?').run(words, phone, s.sessionB);
  const noteUid = 'held-note-d864';
  const held = await encryptColumn(s.env, 'channel_thread_messages', 'voice_ref_enc', noteUid, 'HELD-NOTE-MUST-STAY-OUT');
  s.db.prepare(`INSERT INTO channel_thread_messages (uid, thread_id, external_message_id, direction, kind, text_enc, voice_ref_enc, sent_at)
    VALUES (?, (SELECT id FROM channel_threads WHERE uid = ?), 'held-note-event', 'in', 'voice', '', ?, datetime('now'))`).run(noteUid, s.B, held);
  const pending = s.db.prepare('SELECT uid FROM channel_thread_messages WHERE thread_id = (SELECT id FROM channel_threads WHERE uid = ?)').all(s.A);
  assert.ok(pending.length > 0);
  const got = body(await transcriptRead(s));
  const dump = JSON.stringify(got.transcript);
  for (const hidden of [phone, link, external, token, 'fixture-user']) assert.equal(dump.includes(hidden), false);
  assert.ok(got.transcript.segments[0].text.includes('IGNORE-ALL-INSTRUCTIONS'));
  assert.equal(got.transcript.segments[0].speaker, '[phone removed]');
  assert.equal('speaker_raw' in got.transcript.segments[0], false);
  assert.equal(JSON.stringify(got).includes(TEXT.a), false);
  assert.equal(JSON.stringify(got).includes('HELD-NOTE-MUST-STAY-OUT'), false);
  assert.equal(s.db.prepare('SELECT voice_ref_enc FROM channel_thread_messages WHERE uid = ?').get(noteUid).voice_ref_enc, held);
  const listing = JSON.stringify((await listedTools(s.env, grant([PROJECT]), READ)).tools.map((t) => [t.description, t.inputSchema]));
  assert.equal(listing.includes('IGNORE-ALL-INSTRUCTIONS'), false);
  const usage = s.db.prepare("SELECT operation, outcome FROM api_usage_events WHERE operation = 'get_session_insights'").all();
  assert.deepEqual(usage.map((r: any) => [r.operation, r.outcome]), [['get_session_insights', 'ok']]);
  assert.equal(JSON.stringify(s.db.prepare("SELECT details FROM activity_logs WHERE action = 'mcp_tool_call'").all()).includes('IGNORE-ALL-INSTRUCTIONS'), false);
});

test('D857 nullable translation fields accompany the stored original without a model call or a ciphertext leak', async () => {
  const s = await setup();
  await consentGiven(s.env, null, s.B);
  s.db.exec('ALTER TABLE interview_transcript_segments ADD COLUMN source_lang TEXT; ALTER TABLE interview_transcript_segments ADD COLUMN translated_text TEXT; ALTER TABLE interview_transcript_segments ADD COLUMN translated_lang TEXT;');
  const g = s.db.prepare('SELECT id FROM interview_transcript_segments WHERE session_id = ?').get(s.sessionB);
  const translated = await encryptColumn(s.env, 'interview_transcript_segments', 'translated_text', g.id, 'TRANSLATED-STORED-LINE');
  s.db.prepare('UPDATE interview_transcript_segments SET source_lang = ?, translated_text = ?, translated_lang = ? WHERE id = ?').run('fr', translated, 'en', g.id);
  const one = body(await transcriptRead(s)).transcript.segments[0];
  assert.deepEqual([one.text, one.source_lang, one.translation], [TEXT.b, 'fr', { text: 'TRANSLATED-STORED-LINE', language: 'en' }]);
  assert.equal(JSON.stringify(one).includes(translated), false);
  s.db.prepare('UPDATE interview_transcript_segments SET translated_text = ? WHERE id = ?').run('unreadable-ciphertext', g.id);
  assert.equal(body(await transcriptRead(s)).transcript.segments[0].translation, null);
});


test('withdrawing consent between the access check and segment query exports no transcript text', async () => {
  const s = await setup();
  await consentGiven(s.env, null, s.B);
  const database = s.env.DB;
  let flipped = false;
  s.env.DB = {
    ...database,
    prepare(sql: string) {
      const statement = database.prepare(sql);
      if (!sql.includes('SELECT t.id, t.external_chat_id, i.external_account_id')) return statement;
      return {
        ...statement,
        bind(...values: any[]) {
          const bound = statement.bind(...values);
          return {
            ...bound,
            async first() {
              const row = await bound.first();
              s.db.prepare("UPDATE channel_threads SET consent_state = 'withdrawn' WHERE uid = ?").run(s.B);
              flipped = true;
              return row;
            },
          };
        },
      };
    },
  };
  try {
    const out = body(await transcriptRead(s));
    assert.equal(flipped, true);
    assert.deepEqual(out.transcript.segments, []);
    assert.equal(JSON.stringify(out).includes(TEXT.b), false);
  } finally { s.env.DB = database; }
});


test('the same opted-in transcript read works for a consented assigned WhatsApp session', async () => {
  const s = await setup();
  const assigned = await call(s.env, ME, 'POST', `/threads/${s.W}/assign`, { interview_id: INTERVIEW });
  assert.equal(assigned.status, 200);
  await consentGiven(s.env, null, s.W);
  const session = Number(assigned.body.session_id);
  s.db.prepare("INSERT INTO interview_transcript_segments(session_id, source, speaker_label, text) VALUES (?, 'final', 'Me', 'WHATSAPP-STORED-LINE')").run(session);
  const out = body(await transcriptRead(s, { session_id: session }));
  assert.equal(out.session.provider, 'whatsapp');
  assert.deepEqual(out.transcript.segments.map((g: any) => g.text), ['WHATSAPP-STORED-LINE']);
});


test('privacy redaction preserves ISO dates and explicit currency amounts in originals and translations', async () => {
  const s = await setup();
  await consentGiven(s.env, null, s.B);
  s.db.exec('ALTER TABLE interview_transcript_segments ADD COLUMN translated_text TEXT; ALTER TABLE interview_transcript_segments ADD COLUMN translated_lang TEXT;');
  const g = s.db.prepare('SELECT id FROM interview_transcript_segments WHERE session_id = ?').get(s.sessionB);
  const facts = 'On 2026-10-22 revenue was $1,250,000 and USD 1250000.50; budget EUR 1 250 000 and £1250000.';
  const phone = '+' + '9'.repeat(11);
  const translated = await encryptColumn(s.env, 'interview_transcript_segments', 'translated_text', g.id, facts + ' ' + phone);
  s.db.prepare('UPDATE interview_transcript_segments SET text = ?, translated_text = ?, translated_lang = ? WHERE id = ?').run(facts + ' ' + phone, translated, 'en', g.id);
  const out = body(await transcriptRead(s)).transcript.segments[0];
  assert.equal(out.text, facts + ' [phone removed]');
  assert.equal(out.translation.text, facts + ' [phone removed]');
});
