/** D757 #1930: chat text enters the engine, audio consent stays at transcription.
 * Real SQLite/channel fixture; provider requests are refused and the model binding is counted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { world, call, consentGiven, ME, OTHER, INTERVIEW, PROJECT, seen, noSecretsSeen } from './_channels_fixture.ts';
import { memberConnection } from '../src/services/channels/connections.ts';
import { assignThread, storeMessage, storeVoiceNote, listThreads, readThread, threadForChat } from '../src/services/channels/threads.ts';
import { withdraw, recordReply } from '../src/services/channels/consent.ts';
import { refKey } from '../src/services/channels/events.ts';
import { digestSession, NOTES } from '../src/services/validateEngine.ts';
import { runSessionStructureJob } from '../src/services/sessionAutoStructure.ts';
import { loadSession, sessionConsentBlocks, sessionDigestConsentBlocks } from '../src/services/interviewSessions.ts';
import { openSession, writableInterview } from '../src/services/interviewIntake.ts';
import { runVoiceFollowup } from '../src/routes/channels.ts';
import { codeOnly } from './_codeOnly.mjs';
import type { MessagingProvider } from '../src/services/channels/types.ts';

const OWNER = 'We will send the pilot details.';
const LINE = 'We reconcile invoices by hand every Friday.';
const jobs = (f: any) => f.queued.filter((j: any) => j.job_type === 'session_structure');
async function fixture(t: any, provider: MessagingProvider, given = true) {
  const f = await world({ seed: true }); t.after(() => f.db.close());
  f.db.exec(readFileSync('cloudflare-worker/sql/migrations/489_interview_findings.sql', 'utf8'));
  let modelCalls = 0;
  f.env.AI.run = async (model: string, input: unknown) => {
    modelCalls++;
    if (/guard/.test(model)) return { response: 'safe' };
    const summary = JSON.stringify(input).includes('Summarise one customer');
    return { response: JSON.stringify(summary
      ? { overview: [{ text: 'They reconcile invoices by hand.', cites: [{ from: 0, to: 100000000 }] }], key_quotes: [{ quote: LINE }, { quote: OWNER }] }
      : { placements: [] }) };
  };
  const conn = (await memberConnection(f.env, ME, provider))!;
  const message = (id: string, side: 'me' | 'contact' = 'contact') => ({ externalChatId: 'chat-notes', externalMessageId: id,
    side, contactName: 'Contact', text: side === 'me' ? OWNER : LINE, kind: 'text' as const, sentAt: new Date().toISOString() });
  await storeMessage(f.env, conn, message('first'));
  const before = (await threadForChat(f.env, conn, 'chat-notes'))!;
  const assigned = await assignThread(f.env, ME, before.uid, { interviewId: INTERVIEW });
  if (given) await consentGiven(f.env, f.db, before.uid);
  const thread = (await threadForChat(f.env, conn, 'chat-notes'))!;
  return { ...f, conn, thread, sessionId: assigned.sessionId, message, modelCalls: () => modelCalls };
}
function proposals(f: any) {
  f.db.prepare(`INSERT INTO interview_findings(uid, project_id, interview_id, session_id, module, kind, key_norm, payload_json, quote, cite_from, cite_to)
    VALUES ('accepted-finding', ?, ?, ?, 'demand-signals', 'objection', 'manual', ?, ?, 0, 1000)`)
    .run(PROJECT, INTERVIEW, f.sessionId, JSON.stringify({ text: 'Keep accepted content' }), LINE);
  for (const [i, status] of ['pending', 'accepted', 'discarded'].entries()) f.db.prepare(
    `INSERT INTO validate_proposals(project_id, kind, payload_json, status, created_by, session_id, run_id, citation_json)
     VALUES (?, 'pain_severity', ?, ?, ?, ?, ?, ?)`,
  ).run(PROJECT, JSON.stringify({ phrase: 'manual invoices', severity: 'severe' }), status, ME, f.sessionId,
    `run-${i}`, JSON.stringify({ quote: LINE, session_id: f.sessionId }));
}
async function chunk(f: any) {
  f.db.prepare(`INSERT INTO interview_session_chunks(session_id, seq, r2_key, size_bytes, mime)
    VALUES (?, 1, 'fixture-audio', 100, 'audio/ogg')`).run(f.sessionId);
}
test.afterEach(() => { noSecretsSeen(); seen.length = 0; });

for (const provider of ['telegram', 'whatsapp'] as const) {
  test(`${provider}: assignment and new text queue only chat_text_added; owner speech is Me`, async t => {
    const f = await fixture(t, provider);
    assert.equal(f.modelCalls(), 0, 'ingestion never calls a model');
    assert.equal(jobs(f).length, 1); assert.equal(jobs(f)[0].payload.trigger, 'chat_text_added');
    const added = await storeMessage(f.env, f.conn, f.message('owner', 'me'));
    assert.equal(added.stored, 'session'); assert.equal(jobs(f).length, 2);
    assert.equal(jobs(f)[1].payload.trigger, 'chat_text_added'); assert.equal(f.modelCalls(), 0);
    const rows = f.db.prepare('SELECT speaker_label, text FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(f.sessionId);
    assert.deepEqual(rows.map((r: any) => r.speaker_label), ['Dana Ruiz', 'Me']);
    assert.deepEqual(rows.map((r: any) => r.text), [LINE, OWNER]);
    const out: any = await runSessionStructureJob(f.env, jobs(f)[0].payload);
    assert.equal(out.status, 'done'); assert.ok(f.modelCalls() > 0, 'the engine alone invokes the router/model');
    const digest = JSON.parse((await loadSession(f.env, f.sessionId))!.digest_json!);
    assert.deepEqual(digest.key_quotes.map((q: any) => q.speaker), ['Dana Ruiz', 'Me']);
    const calls = f.modelCalls();
    assert.equal((await runSessionStructureJob(f.env, jobs(f)[1].payload))?.status, 'unchanged');
    assert.equal(f.modelCalls(), calls, 'the transcript hash prevents a second bill');
  });
  test(`${provider}: text with consented audio digests, while ingestion never transcribes it`, async t => {
    const f = await fixture(t, provider); await chunk(f);
    assert.equal(await sessionConsentBlocks(f.env, (await loadSession(f.env, f.sessionId))!), null);
    assert.equal((await runSessionStructureJob(f.env, jobs(f)[0].payload))?.status, 'done');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interview_session_chunks').get()!.n, 1);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interview_chunk_transcripts').get()!.n, 0);
  });
  test(`${provider}: withdrawal clears digest/pending suggestions, preserves accepted content without citations`, async t => {
    const f = await fixture(t, provider);
    await runSessionStructureJob(f.env, jobs(f)[0].payload); proposals(f);
    const consent: any = f.db.prepare('SELECT * FROM channel_consents WHERE thread_id = ?').get(f.thread.id);
    assert.equal((await withdraw(f.env, f.thread, consent, await refKey(provider, 'stop'))).outcome, 'withdrawn');
    const s = (await loadSession(f.env, f.sessionId))!;
    assert.equal(s.consent_status, 'declined'); assert.equal(s.summary, null); assert.equal(s.digest_json, null);
    assert.equal(s.digest_hash, null); assert.equal(s.digest_status, 'skipped'); assert.equal(s.digest_note, NOTES.withdrawn);
    const rows: any[] = f.db.prepare('SELECT status, payload_json, citation_json FROM validate_proposals').all();
    assert.deepEqual(rows.map(r => r.status), ['accepted', 'discarded']);
    assert.ok(rows.every(r => r.citation_json === null && JSON.parse(r.payload_json).phrase === 'manual invoices'));
    const finding: any = f.db.prepare('SELECT * FROM interview_findings').get();
    assert.equal(JSON.parse(finding.payload_json).text, 'Keep accepted content');
    assert.equal(finding.quote, null); assert.equal(finding.cite_from, null); assert.equal(finding.cite_to, null);
    f.db.prepare("UPDATE interview_sessions SET digested_at = datetime('now', '-7 hours') WHERE id = ?").run(f.sessionId);
    const calls = f.modelCalls(), queued = jobs(f).length;
    await storeMessage(f.env, f.conn, f.message('later'));
    assert.equal(jobs(f).length, queued);
    assert.equal((await digestSession(f.env, { sessionId: f.sessionId, userId: ME, trigger: 'chat_text_added' })).status, 'refused');
    assert.equal(f.modelCalls(), calls); assert.equal((await loadSession(f.env, f.sessionId))?.digest_note, NOTES.withdrawn);
  });
  test(`${provider}: Inbox list and detail expose only this thread's engine state and pending count`, async t => {
    const f = await fixture(t, provider); proposals(f);
    for (const state of ['queued', 'running', 'done', 'refused', 'skipped']) {
      f.db.prepare('UPDATE interview_sessions SET digest_status = ? WHERE id = ?').run(state, f.sessionId);
      const list = await call(f.env, ME, 'GET', '/threads');
      const detail = await call(f.env, ME, 'GET', `/threads/${f.thread.uid}`);
      assert.equal(list.status, 200); assert.equal(detail.status, 200);
      for (const v of [list.body.items[0], detail.body.thread]) {
        assert.equal(v.digest_status, state); assert.equal(v.pending_suggestions, 1);
      }
    }
    assert.equal((await call(f.env, OTHER, 'GET', `/threads/${f.thread.uid}`)).status, 404);
    assert.deepEqual((await listThreads(f.env, OTHER)), []);
    f.db.prepare('UPDATE interview_sessions SET created_by_user_id = ? WHERE id = ?').run(OTHER, f.sessionId);
    for (const v of [(await readThread(f.env, ME, f.thread.uid)).thread, (await listThreads(f.env, ME))[0]]) {
      assert.equal(v.digest_status, null); assert.equal(v.pending_suggestions, 0);
    }
    f.db.prepare('UPDATE channel_threads SET session_id = NULL WHERE id = ?').run(f.thread.id);
    const detached = (await readThread(f.env, ME, f.thread.uid)).thread;
    assert.equal(detached.digest_status, null); assert.equal(detached.pending_suggestions, 0);
  });
}

test('Telegram: an unconsented voice note waits, but existing final text still reaches the engine', async t => {
  const f = await fixture(t, 'telegram', false); await chunk(f);
  const session = (await loadSession(f.env, f.sessionId))!;
  assert.ok(await sessionConsentBlocks(f.env, session), 'transcription remains gated');
  assert.equal(await sessionDigestConsentBlocks(f.env, session), null, 'final text has its own gate');
  const msg: any = { ...f.message('note'), provider: 'telegram', externalEventId: 'note', voice: { fileRef: 'never-download', mime: 'audio/ogg', durationSec: 2 }, text: null };
  const stored: any = await storeVoiceNote(f.env, f.conn, msg);
  f.db.prepare('UPDATE channel_thread_messages SET transcribe_job = ? WHERE uid = ?').run('note-job', stored.messageUid);
  const real = globalThis.fetch; let fetched = 0;
  globalThis.fetch = (async () => { fetched++; throw new Error('no provider expected'); }) as any;
  t.after(() => { globalThis.fetch = real; });
  await runVoiceFollowup(f.env, { provider: 'telegram', kind: 'voice', job: 'note-job', message: stored.messageUid });
  assert.equal(fetched, 0); assert.equal(f.modelCalls(), 0);
  assert.equal(f.db.prepare('SELECT transcribe_error FROM channel_thread_messages WHERE uid = ?').get(stored.messageUid)!.transcribe_error, 'no_consent');
  assert.equal((await runSessionStructureJob(f.env, jobs(f)[0].payload))?.status, 'done');
});

test('WhatsApp: unconsented text stays pending and no voice or digest job starts', async t => {
  const f = await fixture(t, 'whatsapp', false);
  assert.equal(jobs(f).length, 0); assert.equal(f.modelCalls(), 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interview_transcript_segments').get()!.n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM channel_thread_messages').get()!.n, 1);
});

test('chat text respects the six-hour quiet bound without sliding it, then uses the transcript hash', async t => {
  const f = await fixture(t, 'telegram');
  await runSessionStructureJob(f.env, jobs(f)[0].payload); const calls = f.modelCalls();
  f.db.prepare("UPDATE interview_sessions SET digested_at = datetime('now', '-1 hours') WHERE id = ?").run(f.sessionId);
  const at = (await loadSession(f.env, f.sessionId))!.digested_at;
  await storeMessage(f.env, f.conn, f.message('within-bound'));
  assert.equal(jobs(f).length, 1); assert.equal(f.modelCalls(), calls);
  assert.equal((await loadSession(f.env, f.sessionId))!.digested_at, at);
  f.db.prepare("UPDATE interview_sessions SET digested_at = datetime('now', '-7 hours') WHERE id = ?").run(f.sessionId);
  await storeMessage(f.env, f.conn, f.message('after-bound'));
  assert.equal(jobs(f).length, 2); assert.equal((await runSessionStructureJob(f.env, jobs(f)[1].payload))?.status, 'done');
  const after = f.modelCalls();
  assert.equal((await runSessionStructureJob(f.env, jobs(f)[1].payload))?.status, 'unchanged'); assert.equal(f.modelCalls(), after);
});

test('Telegram: declining an open request clears a text digest that was already allowed to run', async t => {
  const f = await fixture(t, 'telegram', false);
  await runSessionStructureJob(f.env, jobs(f)[0].payload); proposals(f);
  f.db.prepare(`INSERT INTO channel_consents(uid, user_id, provider, integration_id, thread_id, interview_id, session_id,
    status, notice_version, requested_at, request_ref_hash) VALUES ('request', ?, 'telegram', ?, ?, ?, ?, 'requested', 1, datetime('now'), ?)`)
    .run(ME, f.conn.integrationId, f.thread.id, INTERVIEW, f.sessionId, await refKey('telegram', 'notice'));
  const out = await recordReply(f.env, f.thread, { provider: 'telegram', kind: 'consent_reply', side: 'contact',
    externalChatId: 'chat-notes', externalMessageId: 'no', externalEventId: 'no', contextMessageId: 'notice',
    via: 'word', answer: 'no', requestUid: null, sentAt: new Date().toISOString() } as any);
  assert.equal(out.outcome, 'declined'); assert.equal((await loadSession(f.env, f.sessionId))!.digest_json, null);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM validate_proposals WHERE status = 'pending'").get()!.n, 0);
});

test('a phone call still needs recorded consent; chat ingestion has no direct summary/structure/model call', async t => {
  const f = await fixture(t, 'telegram');
  const phone = await openSession(f.env, await writableInterview(f.env, ME, INTERVIEW), 'zoom', 'phone');
  assert.ok(await sessionDigestConsentBlocks(f.env, phone)); assert.equal(f.modelCalls(), 0);
  const source = readFileSync('cloudflare-worker/src/services/channels/threads.ts', 'utf8');
  assert.doesNotMatch(codeOnly(source), /\b(?:aiRun|aiRouter\.run|structureSession|summariseSession)\s*\(/);
});

test('a queue failure after append keeps the committed text successful for the quiet sweep', async t => {
  const f = await fixture(t, 'telegram');
  f.env.JOB_QUEUE.send = async () => { throw new Error('queue unavailable'); };
  const out = await storeMessage(f.env, f.conn, f.message('queue-failure'));
  assert.equal(out.stored, 'session');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM interview_transcript_segments WHERE session_id = ?').get(f.sessionId)!.n, 2);
  assert.equal((await loadSession(f.env, f.sessionId))!.status, 'transcribed');
  assert.equal(f.modelCalls(), 0);
});

test('a repeated assignment recovers text left pending while its session was being assigned', async t => {
  const f = await fixture(t, 'telegram');
  f.db.prepare('UPDATE channel_threads SET session_id = NULL WHERE id = ?').run(f.thread.id);
  await storeMessage(f.env, f.conn, f.message('recover'));
  f.db.prepare('UPDATE channel_threads SET session_id = ? WHERE id = ?').run(f.sessionId, f.thread.id);
  const out = await assignThread(f.env, ME, f.thread.uid, { interviewId: INTERVIEW });
  assert.equal(out.moved, 1); assert.equal(jobs(f).length, 2);
  assert.equal(jobs(f)[1].payload.trigger, 'chat_text_added'); assert.equal(f.modelCalls(), 0);
});

test('a job already queued before the first digest cannot bill changed text again inside six hours', async t => {
  const f = await fixture(t, 'telegram');
  await storeMessage(f.env, f.conn, f.message('queued-before-run'));
  await runSessionStructureJob(f.env, jobs(f)[0].payload);
  const calls = f.modelCalls(), at = (await loadSession(f.env, f.sessionId))!.digested_at;
  await storeMessage(f.env, f.conn, f.message('changed-after-run'));
  const skipped: any = await runSessionStructureJob(f.env, jobs(f)[1].payload);
  assert.equal(skipped.reason, 'quiet_window'); assert.equal(f.modelCalls(), calls);
  const held = (await loadSession(f.env, f.sessionId))!;
  assert.equal(held.digested_at, at); assert.equal(held.digest_status, 'queued'); assert.equal(held.digest_note, NOTES.chatQuiet);
  f.db.prepare("UPDATE interview_sessions SET digested_at = datetime('now', '-7 hours') WHERE id = ?").run(f.sessionId);
  assert.equal((await runSessionStructureJob(f.env, jobs(f)[1].payload))?.status, 'done');
  assert.ok(f.modelCalls() > calls);
});
