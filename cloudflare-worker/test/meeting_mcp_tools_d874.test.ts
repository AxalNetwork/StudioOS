/**
 * D874 (#2521) — the call tools on the MCP server, through the real `callTool`
 * on D684's channel world.
 *
 *   1. Scope gates: the reads need validate:read, the summary validate:write.
 *   2. Only the member's own calls, in a company the grant reaches.
 *   3. The transcript follows #2510's ruling B: the stored final segments of
 *      an imported, consented call, paged, with speakers and times and D857's
 *      translation beside the original; links, phones, meeting ids and
 *      passcodes removed; nothing for a call not imported or not consented.
 *   4. The summary holds and settles AI tokens once: a second read runs
 *      nothing; a refusal is the ledger's and leaves no hold.
 *
 * Every transcript line is a fixture string, never a customer's words.
 *
 * Run: node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        --test cloudflare-worker/test/meeting_mcp_tools_d874.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { callTool, listedTools, registeredTools } from '../src/mcp/server.ts';
import { exportText } from '../src/mcp/tools/meetings.ts';
import { importMeetingRef } from '../src/services/channels/meetings.ts';
import { openSession, writableInterview } from '../src/services/interviewIntake.ts';
import { encryptColumn } from '../src/services/columnCipher.ts';
import { setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { INTERVIEW, ME, mig, OTHER, OTHER_PROJECT, PROJECT, world } from './_channels_fixture.ts';

const SECOND = 11, SECOND_INTERVIEW = 102;
const READ = ['validate:read'];
const WRITE = ['validate:read', 'validate:write'];
const MEETING_ID = '85746065432';
const JOIN = `https://zoom.us/j/${MEETING_ID}?pwd=fixturePwd`;
const LINE = { ask: 'LINE-ASK how do you close the month', pain: 'LINE-PAIN invoices by hand every Friday', third: 'LINE-THIRD two days a month' };
const SUMMARY_MARK = 'Summarise one customer';

const grant = (companies: number[], userId = ME) => ({
  userId, companies, clientId: 'client-874', clientName: 'Test Assistant', redirectHost: null, redirectUri: null,
  grantedAt: Math.floor(Date.now() / 1000),
});
const tool = (name: string) => registeredTools().find((t) => t.name === name)!;
const body = (r: any) => JSON.parse(r.content[0].text);
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const saved = [console.warn, console.error];
  console.warn = () => {}; console.error = () => {};
  try { return await f(); } finally { [console.warn, console.error] = saved; }
};
const run = (s: any, name: string, args: Record<string, unknown>, scope = WRITE, companies = [PROJECT, SECOND], user = ME) =>
  quiet(() => callTool(s.env, grant(companies, user), 'g-874', tool(name), args, scope));

/** A model that writes a cited summary of the line it is asked about, as a model would, and counts its calls. */
function summaryModel(s: any) {
  const calls: string[] = [];
  s.env.AI.run = async (model: string, input: unknown) => {
    if (/guard/.test(model)) return { response: 'safe' };
    const prompt = JSON.stringify(input);
    calls.push(prompt.includes(SUMMARY_MARK) ? 'summary' : 'other');
    const at = /\[(\d+)-(\d+)\][^[]*?LINE-PAIN/.exec(prompt);
    const cite = at ? { from: Number(at[1]), to: Number(at[2]) } : { from: -1, to: -1 };
    return { response: JSON.stringify({
      overview: [{ text: `They reconcile by hand; call ${MEETING_ID} again.`, cites: [cite] }],
      key_quotes: [{ quote: LINE.pain }],
      decisions: [], next_steps: [{ text: 'Send the pricing page.', who: 'me', cites: [cite] }],
    }) };
  };
  return calls;
}

/**
 * ME's calls: Z a scheduled Zoom call in PROJECT, imported, consented; M a
 * scheduled Meet call in PROJECT not imported yet; A a Zoom call attached to
 * a recording in PROJECT, imported into its own `meeting:` session; S a call
 * in SECOND. OTHER holds one call on ME's interview.
 */
async function setup() {
  const w: any = await world({ seed: true });
  const { db, env } = w;
  db.exec(mig('524_api_usage_events.sql'));
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${SECOND}, 'Second venture', 9);
           INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (${SECOND_INTERVIEW}, ${SECOND}, 'Lee')`);
  const ref = (uid: string, provider: string, sessionId: number, interviewId: number, user: number, status: string, ends: string | null, join = JOIN, external = MEETING_ID) =>
    db.prepare(`INSERT INTO interview_channel_refs (uid, provider, external_ref, session_id, interview_id, user_id, join_url, starts_at, ends_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, '2026-10-20 09:00:00', ?, ?)`).run(uid, provider, external, sessionId, interviewId, user, join, ends, status);
  const refRow = (uid: string) => db.prepare('SELECT * FROM interview_channel_refs WHERE uid = ?').get(uid);
  const scoped = await writableInterview(env, ME, INTERVIEW);
  const segments = [
    { speaker: 'Sam Founder', text: LINE.ask, startMs: 0, endMs: 4000 },
    { speaker: 'Dana Ruiz', text: LINE.pain, startMs: 4000, endMs: 9000 },
    { speaker: 'Lee Park', text: LINE.third, startMs: 9000, endMs: 13000 },
  ];

  const z = await openSession(env, scoped, 'zoom', 'video', { method: 'verbal' });
  ref('ref-z', 'zoom', z.id, INTERVIEW, ME, 'transcript_ready', '2026-10-20 10:00:00');
  assert.equal((await importMeetingRef(env, refRow('ref-z'), async () => ({ kind: 'segments', segments }))).status, 'imported');

  const m = await openSession(env, scoped, 'google_meet', 'video', { method: 'verbal' });
  ref('ref-m', 'google_meet', m.id, INTERVIEW, ME, 'scheduled', '2026-10-21 10:00:00', 'https://meet.google.com/abc-mnop-xyz', 'evt0123abc');

  // Attached: the recording is the anchor; the import opens `meeting:ref-a` beside it.
  db.prepare(`INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_method, consent_at)
              VALUES ('rec-1', ?, ?, ?, 'in_person', 'recording', 'given', 'verbal', datetime('now'))`).run(INTERVIEW, PROJECT, ME);
  const rec = { id: Number(db.prepare("SELECT id FROM interview_sessions WHERE uid = 'rec-1'").get().id) };
  ref('ref-a', 'zoom', rec.id, INTERVIEW, ME, 'transcript_ready', null, 'https://zoom.us/j/99887766554', '99887766554');
  assert.equal((await importMeetingRef(env, refRow('ref-a'), async () => ({ kind: 'segments', segments: segments.slice(0, 2) }))).status, 'imported');
  const attached = Number(db.prepare("SELECT id FROM interview_sessions WHERE uid = 'meeting:ref-a'").get().id);

  const second = await openSession(env, await writableInterview(env, ME, SECOND_INTERVIEW), 'zoom', 'video', { method: 'verbal' });
  ref('ref-s', 'zoom', second.id, SECOND_INTERVIEW, ME, 'scheduled', '2026-10-22 10:00:00', 'https://zoom.us/j/11122233344', '11122233344');

  // OTHER's call, on ME's interview: never ME's to see.
  db.prepare(`INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, submitted_via)
              VALUES ('other-call', ?, ?, ?, 'video', 'transcribed', 'given', 'zoom')`).run(INTERVIEW, PROJECT, OTHER);
  const otherSession = Number(db.prepare("SELECT id FROM interview_sessions WHERE uid = 'other-call'").get().id);
  ref('ref-o', 'zoom', otherSession, INTERVIEW, OTHER, 'imported', '2026-10-20 10:00:00', 'https://zoom.us/j/55566677788', '55566677788');
  db.prepare(`INSERT INTO interview_transcript_segments (session_id, source, speaker_label, text) VALUES (?, 'final', 'Someone', 'OTHER-LINE')`).run(otherSession);

  return { ...w, Z: z.id, M: m.id, A: attached, S: second.id, OTHER_SESSION: otherSession };
}

const transcript = (s: any, args: Record<string, unknown> = {}, scope = READ, companies = [PROJECT], user = ME) =>
  run(s, 'get_meeting_transcript', { company: PROJECT, meeting: 'ref-z', ...args }, scope, companies, user);

// ── 1. Scopes ────────────────────────────────────────────────────────────────

test('scope gates: the reads need validate:read, the summary validate:write; listing follows the scope', async () => {
  const s = await setup();
  assert.deepEqual(['list_meetings', 'get_meeting_transcript', 'summarize_meeting'].map((n) => [n, tool(n).requiredScope, tool(n).readOnly !== false]), [
    ['list_meetings', 'validate:read', true], ['get_meeting_transcript', 'validate:read', true], ['summarize_meeting', 'validate:write', false],
  ]);
  const none = await run(s, 'list_meetings', {}, []);
  assert.equal(none.isError, true);
  assert.match(body(none).error, /validate:read/);
  assert.equal((await transcript(s, {}, [])).isError, true);
  const readOnly = await run(s, 'summarize_meeting', { company: PROJECT, meeting: 'ref-z' }, READ);
  assert.equal(readOnly.isError, true);
  assert.match(body(readOnly).error, /validate:write/);
  const listed = (scope: string[]) => listedTools(s.env, grant([PROJECT]), scope).then((r) => r.tools.map((t) => t.name).filter((n) => /meeting/.test(n)).sort());
  assert.deepEqual(await listed(READ), ['get_meeting_transcript', 'list_meetings']);
  assert.deepEqual(await listed(WRITE), ['get_meeting_transcript', 'list_meetings', 'summarize_meeting']);
});

// ── 2. Only the member's own calls ───────────────────────────────────────────

test("list_meetings: the member's own calls in the grant's companies, as state and source, never a link or a meeting id", async () => {
  const s = await setup();
  const all = body(await run(s, 'list_meetings', {}, READ));
  assert.deepEqual(all.meetings.map((m: any) => m.id).sort(), ['ref-a', 'ref-m', 'ref-s', 'ref-z'], "OTHER's call is not listed");
  const z = all.meetings.find((m: any) => m.id === 'ref-z');
  assert.deepEqual(z, {
    id: 'ref-z', provider: 'zoom', state: 'imported', source: 'scheduled', error_code: null, error: null,
    starts_at: '2026-10-20 09:00:00', ends_at: '2026-10-20 10:00:00', company: { id: PROJECT, name: 'Ledger tool' },
    interview_id: INTERVIEW, session_id: s.Z,
  });
  const a = all.meetings.find((m: any) => m.id === 'ref-a');
  assert.deepEqual([a.source, a.session_id], ['attached', s.A], 'an attached call names the session its transcript is in, not the recording');
  assert.equal(all.meetings.find((m: any) => m.id === 'ref-m').session_id, s.M);

  const onlyFirst = body(await run(s, 'list_meetings', {}, READ, [PROJECT]));
  assert.deepEqual(onlyFirst.meetings.map((m: any) => m.id).sort(), ['ref-a', 'ref-m', 'ref-z'], 'a company outside the grant is not listed');
  assert.deepEqual(body(await run(s, 'list_meetings', { provider: 'google_meet' }, READ)).meetings.map((m: any) => m.id), ['ref-m']);
  assert.deepEqual(body(await run(s, 'list_meetings', { state: 'scheduled' }, READ)).meetings.map((m: any) => m.id).sort(), ['ref-m', 'ref-s']);
  assert.equal(body(await run(s, 'list_meetings', { limit: 1 }, READ)).meetings.length, 1);
  const dump = JSON.stringify(all);
  for (const hidden of [MEETING_ID, 'pwd', 'zoom.us', 'meet.google.com', 'abc-mnop-xyz', 'evt0123abc', '99887766554', LINE.pain]) {
    assert.equal(dump.includes(hidden), false, hidden);
  }

  // OTHER's call is on ME's interview, in a venture OTHER cannot read: their grant reaches nothing.
  assert.deepEqual(body(await run(s, 'list_meetings', {}, READ, [PROJECT], OTHER)).meetings, []);
});

test("another member's call, or a call outside the checked company, is not found", async () => {
  const s = await setup();
  const other = await transcript(s, { meeting: 'ref-o' });
  assert.deepEqual([other.isError, body(other).code], [true, 'meeting_not_found']);
  assert.equal(JSON.stringify(body(other)).includes('OTHER-LINE'), false);
  const elsewhere = await run(s, 'get_meeting_transcript', { company: SECOND, meeting: 'ref-z' }, READ);
  assert.equal(body(elsewhere).code, 'meeting_not_found', "a call is read only in its own interview's company");
  assert.equal(body(await run(s, 'summarize_meeting', { company: PROJECT, meeting: 'ref-o' })).code, 'meeting_not_found');
  assert.equal((await transcript(s, { company: OTHER_PROJECT }, READ, [OTHER_PROJECT])).isError, true, 'a company the member cannot read is refused by the grant');
});

// ── 3. The transcript ────────────────────────────────────────────────────────

test("get_meeting_transcript: an imported, consented call's stored final lines, with speakers and times; nothing otherwise", async () => {
  const s = await setup();
  const ok = body(await transcript(s));
  assert.deepEqual(ok.meeting, { id: 'ref-z', provider: 'zoom', state: 'imported', session_id: s.Z });
  assert.deepEqual(ok.transcript.segments.map((g: any) => [g.speaker, g.text, g.start_ms, g.end_ms, g.translation]), [
    ['Sam Founder', LINE.ask, 0, 4000, null], ['Dana Ruiz', LINE.pain, 4000, 9000, null], ['Lee Park', LINE.third, 9000, 13000, null],
  ]);
  assert.equal(ok.transcript.complete, true);
  assert.equal(ok.reason, null);
  const attached = body(await transcript(s, { meeting: 'ref-a' }));
  assert.deepEqual(attached.transcript.segments.map((g: any) => g.text), [LINE.ask, LINE.pain], "an attached call's own session, not the recording's");

  const notYet = body(await transcript(s, { meeting: 'ref-m' }));
  assert.deepEqual([notYet.transcript, notYet.reason], [null, "This call's transcript is not in StudioOS yet."]);

  s.db.prepare("INSERT INTO interview_transcript_segments (session_id, source, speaker_label, text) VALUES (?, 'live', 'Draft', 'LIVE-DRAFT')").run(s.Z);
  assert.equal(JSON.stringify(body(await transcript(s))).includes('LIVE-DRAFT'), false, 'only final lines');

  s.db.prepare("UPDATE interview_sessions SET consent_status = 'declined' WHERE id = ?").run(s.Z);
  const declined = body(await transcript(s));
  assert.deepEqual([declined.transcript, declined.reason], [null, 'This call has no recorded consent, so its transcript is not shared.']);
  assert.equal(JSON.stringify(declined).includes(LINE.pain), false);
  s.db.prepare("UPDATE interview_sessions SET consent_status = 'given' WHERE id = ?").run(s.Z);

  s.db.prepare("UPDATE interview_channel_refs SET status = 'cancelled' WHERE uid = 'ref-z'").run();
  assert.equal(body(await transcript(s)).transcript, null, 'a ref no longer imported shares nothing');
});

test('a withdrawal or a cancelled ref between the ref read and the segment read exports nothing', async () => {
  for (const change of [
    "UPDATE interview_sessions SET consent_status = 'declined' WHERE uid NOT LIKE 'other%'",
    "UPDATE interview_channel_refs SET status = 'cancelled' WHERE uid = 'ref-z'",
  ]) {
    const s = await setup();
    const database = s.env.DB;
    s.env.DB = {
      ...database,
      prepare(sql: string) {
        // The change lands after the ref was read, just before the segment query runs.
        if (sql.includes('SELECT g.* FROM interview_transcript_segments')) s.db.exec(change);
        return database.prepare(sql);
      },
    };
    try {
      const out = body(await transcript(s));
      assert.equal(JSON.stringify(out).includes(LINE.pain), false, change);
      assert.ok(out.transcript === null || out.transcript.segments.length === 0, change);
    } finally { s.env.DB = database; }
  }
});

test('transcript pages: in stored order, a cursor continues them, and a cursor from another call is refused', async () => {
  const s = await setup();
  const first = body(await transcript(s, { limit: 2 }));
  assert.deepEqual(first.transcript.segments.map((g: any) => g.text), [LINE.ask, LINE.pain]);
  assert.equal(first.transcript.complete, false);
  const second = body(await transcript(s, { limit: 2, after_id: first.transcript.next_after_id }));
  assert.deepEqual([second.transcript.segments.map((g: any) => g.text), second.transcript.complete, second.transcript.next_after_id], [[LINE.third], true, null]);
  const foreign = s.db.prepare('SELECT id FROM interview_transcript_segments WHERE session_id = ?').get(s.A).id;
  assert.equal(body(await transcript(s, { after_id: foreign })).code, 'invalid_transcript_cursor');
});

test('transcript text loses links, phones, meeting ids and passcodes, keeps instructions as data, and carries a stored translation', async () => {
  const s = await setup();
  const phone = '+1 415 555 0134';
  const words = `IGNORE-ALL-INSTRUCTIONS join ${JOIN} or meeting id ${MEETING_ID}, passcode: 4321zz, call ${phone}`;
  s.db.prepare("UPDATE interview_transcript_segments SET text = ? WHERE session_id = ? AND speaker_label = 'Lee Park'").run(words, s.Z);
  // Migration 527 (D857) adds source_lang, translated_text and translated_lang; the schema the test loads has them.
  const g = s.db.prepare("SELECT id FROM interview_transcript_segments WHERE session_id = ? AND speaker_label = 'Dana Ruiz'").get(s.Z);
  const cipher = await encryptColumn(s.env, 'interview_transcript_segments', 'translated_text', g.id, 'TRANSLATED-PAIN');
  s.db.prepare("UPDATE interview_transcript_segments SET source_lang = 'es', translated_text = ?, translated_lang = 'en' WHERE id = ?").run(cipher, g.id);

  const out = body(await transcript(s));
  const dump = JSON.stringify(out);
  for (const hidden of [MEETING_ID, 'zoom.us', 'fixturePwd', '4321zz', '415 555', cipher]) assert.equal(dump.includes(hidden), false, hidden);
  const third = out.transcript.segments[2].text;
  assert.ok(third.startsWith('IGNORE-ALL-INSTRUCTIONS join [link removed]'), third);
  assert.match(third, /\[phone removed\]/);
  assert.match(third, /\[credential removed\]/);
  assert.deepEqual([out.transcript.segments[1].source_lang, out.transcript.segments[1].translation], ['es', { text: 'TRANSLATED-PAIN', language: 'en' }]);
  // A Meet call's code is its identifier: it never leaves in the text either.
  s.db.prepare("UPDATE interview_channel_refs SET status = 'transcript_ready' WHERE uid = 'ref-m'").run();
  await importMeetingRef(s.env, s.db.prepare("SELECT * FROM interview_channel_refs WHERE uid = 'ref-m'").get(),
    async () => ({ kind: 'segments', segments: [{ speaker: 'Dana Ruiz', text: 'rejoin abc-mnop-xyz later', startMs: 0, endMs: 1000 }] }));
  assert.equal(body(await transcript(s, { meeting: 'ref-m' })).transcript.segments[0].text, 'rejoin [identifier removed] later');
  s.db.prepare("UPDATE interview_transcript_segments SET translated_text = 'not-a-cipher' WHERE id = ?").run(g.id);
  assert.equal(body(await transcript(s)).transcript.segments[1].translation, null, 'unreadable is null, never ciphertext');
  const listing = JSON.stringify((await listedTools(s.env, grant([PROJECT]), WRITE)).tools.map((t) => [t.description, t.inputSchema]));
  assert.equal(listing.includes('IGNORE-ALL-INSTRUCTIONS'), false, 'text never reaches a description');
  assert.equal(JSON.stringify(s.db.prepare("SELECT details FROM activity_logs WHERE action = 'mcp_tool_call'").all()).includes('IGNORE'), false);
});

test('exportText: what it removes and what it keeps', () => {
  assert.equal(exportText('see https://meet.google.com/abc-mnop-xyz now'), 'see [link removed] now');
  assert.equal(exportText('zoom.us/j/123 then'), '[link removed] then');
  assert.equal(exportText('Meeting ID: 857 4606 5432'), '[identifier removed]');
  assert.equal(exportText('pwd=abc123 ok'), '[credential removed] ok');
  assert.equal(exportText('call +44 20 7946 0958'), 'call [phone removed]');
  assert.equal(exportText('we pay 1500 a month'), 'we pay 1500 a month', 'a short number stays');
  assert.equal(exportText('order 123 456 units'), 'order 123 456 units', 'six digits are not a phone number');
  assert.equal(exportText('code abc-mnop-xyz', ['abc-mnop-xyz']), 'code [identifier removed]');
  assert.equal(exportText('token 123456:ABCdefGHIjklMNO here'), 'token [credential removed] here');
  assert.equal(exportText('key axk_live_abc123'), 'key [credential removed]');
  assert.equal(exportText(null), null);
});

// ── 4. The summary, metered once ─────────────────────────────────────────────

const reservations = (s: any) => s.db.prepare('SELECT status FROM ai_budget_reservations WHERE user_id = ? ORDER BY rowid').all(ME).map((r: any) => r.status);

test("summarize_meeting: runs the engine's summary once, holds and settles its AI tokens once, and reads it back after", async () => {
  const s = await setup();
  const calls = summaryModel(s);
  const before = reservations(s).length;
  const first = await run(s, 'summarize_meeting', { company: PROJECT, meeting: 'ref-z' });
  assert.equal(first.isError, undefined, first.content[0].text);
  const one = body(first);
  assert.equal(one.ran, true);
  assert.deepEqual(one.meeting, { id: 'ref-z', provider: 'zoom', session_id: s.Z });
  assert.equal(one.digest.overview[0].text, 'They reconcile by hand; call [identifier removed] again.', 'the summary is redacted as the transcript is');
  assert.deepEqual(one.digest.key_quotes.map((k: any) => k.quote), [LINE.pain]);
  assert.equal(one.digest.kept, false, 'a draft for the founder to keep or edit');
  assert.equal(calls.filter((c) => c === 'summary').length, 1);
  const held = reservations(s).slice(before);
  assert.equal(held.length, 1, 'one hold');
  assert.deepEqual(held, ['settled'], 'settled once, nothing left pending');

  const again = body(await run(s, 'summarize_meeting', { company: PROJECT, meeting: 'ref-z' }));
  assert.equal(again.ran, false);
  assert.equal(again.digest.overview[0].text, one.digest.overview[0].text);
  assert.equal(calls.filter((c) => c === 'summary').length, 1, 'a second read runs no model');
  assert.equal(reservations(s).length, before + 1, 'and holds nothing');

  const rerun = body(await run(s, 'summarize_meeting', { company: PROJECT, meeting: 'ref-z', rerun: true }));
  assert.equal(rerun.ran, true);
  assert.deepEqual(reservations(s).slice(before), ['settled', 'settled']);

  const usage = s.db.prepare("SELECT operation, outcome FROM api_usage_events WHERE operation = 'summarize_meeting' ORDER BY id").all();
  assert.deepEqual(usage.map((r: any) => r.outcome), ['ok', 'ok', 'ok'], 'one usage row per call');
  assert.equal(JSON.stringify(usage).includes(LINE.pain), false);
});

test('summarize_meeting: no AI tokens is the ledger\'s refusal and leaves no hold; a call not imported or not consented runs nothing', async () => {
  const s = await setup();
  const calls = summaryModel(s);
  setFixtureAllowance(s.db, 0);
  const broke = await run(s, 'summarize_meeting', { company: PROJECT, meeting: 'ref-z' });
  assert.equal(broke.isError, true);
  assert.equal(body(broke).code, 'insufficient_tokens');
  assert.equal(calls.length, 0, 'no model ran');
  assert.equal(reservations(s).filter((x: string) => x === 'pending').length, 0, 'no hold left pending');
  assert.deepEqual(s.db.prepare("SELECT outcome, error_category FROM api_usage_events WHERE operation = 'summarize_meeting'").all()
    .map((r: any) => [r.outcome, r.error_category]), [['refused', 'insufficient_tokens']]);

  const notYet = await run(s, 'summarize_meeting', { company: PROJECT, meeting: 'ref-m' });
  assert.equal(body(notYet).code, 'no_transcript');
  s.db.prepare("UPDATE interview_sessions SET consent_status = 'declined' WHERE id = ?").run(s.Z);
  const digestState = () => s.db.prepare('SELECT digest_status, digest_note FROM interview_sessions WHERE id = ?').get(s.Z);
  const before = digestState();
  assert.equal(body(await run(s, 'summarize_meeting', { company: PROJECT, meeting: 'ref-z' })).code, 'consent_not_recorded');
  assert.deepEqual(digestState(), before, 'refused before the engine: the session records no refused run');
  assert.equal(calls.length, 0);
});
