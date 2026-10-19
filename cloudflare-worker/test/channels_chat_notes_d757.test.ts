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
    assert.ok(await sessionDigestConsentBlocks(f.env, s), 'withdrawn text has an explicit engine refusal');
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

for (const provider of ['telegram', 'whatsapp'] as const) test(`${provider}: an unconsented voice note waits, but existing final text still reaches the engine`, async t => {
  const f = await fixture(t, provider, provider === 'whatsapp');
  f.db.prepare("UPDATE interview_sessions SET consent_status = 'not_recorded' WHERE id = ?").run(f.sessionId);
  f.db.prepare("UPDATE channel_threads SET consent_state = 'awaiting' WHERE id = ?").run(f.thread.id);
  await chunk(f);
  const session = (await loadSession(f.env, f.sessionId))!;
  assert.ok(await sessionConsentBlocks(f.env, session), 'transcription remains gated');
  assert.equal(await sessionDigestConsentBlocks(f.env, session), null, 'final text has its own gate');
  const msg: any = { ...f.message('note'), provider, externalEventId: 'note', voice: { fileRef: 'never-download', mime: 'audio/ogg', durationSec: 2 }, text: null };
  const stored: any = await storeVoiceNote(f.env, f.conn, msg);
  f.db.prepare('UPDATE channel_thread_messages SET transcribe_job = ? WHERE uid = ?').run('note-job', stored.messageUid);
  const real = globalThis.fetch; let fetched = 0;
  globalThis.fetch = (async () => { fetched++; throw new Error('no provider expected'); }) as any;
  t.after(() => { globalThis.fetch = real; });
  await runVoiceFollowup(f.env, { provider, kind: 'voice', job: 'note-job', message: stored.messageUid });
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

for (const initial of ['requested', 'given'] as const) test(`${initial}: consent and digest cleanup roll back together and the identical reply can retry`, async t => {
  const f = await fixture(t, 'telegram', initial === 'given');
  await runSessionStructureJob(f.env, jobs(f)[0].payload); proposals(f);
  if (initial === 'requested') f.db.prepare(`INSERT INTO channel_consents(uid, user_id, provider, integration_id, thread_id, interview_id, session_id,
    status, notice_version, requested_at, request_ref_hash) VALUES ('atomic-request', ?, 'telegram', ?, ?, ?, ?, 'requested', 1, datetime('now'), ?)`)
    .run(ME, f.conn.integrationId, f.thread.id, INTERVIEW, f.sessionId, await refKey('telegram', 'atomic-notice'));
  const reply: any = { provider: 'telegram', kind: 'consent_reply', side: 'contact', externalChatId: 'chat-notes',
    externalMessageId: 'atomic-stop', externalEventId: 'atomic-stop', contextMessageId: 'atomic-notice', via: 'word',
    answer: initial === 'given' ? 'stop' : 'no', requestUid: null, sentAt: new Date().toISOString() };
  f.db.exec("CREATE TEMP TRIGGER fail_digest_cleanup BEFORE DELETE ON validate_proposals BEGIN SELECT RAISE(ABORT, 'fixture_cleanup_failure'); END");
  await assert.rejects(recordReply(f.env, f.thread, reply), /fixture_cleanup_failure/);
  assert.equal(f.db.prepare('SELECT status FROM channel_consents WHERE thread_id = ?').get(f.thread.id)!.status, initial);
  assert.ok((await loadSession(f.env, f.sessionId))!.digest_json);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM validate_proposals WHERE status = 'pending'").get()!.n, 1);
  f.db.exec('DROP TRIGGER fail_digest_cleanup');
  assert.equal((await recordReply(f.env, f.thread, reply)).outcome, initial === 'given' ? 'withdrawn' : 'declined');
  assert.equal((await loadSession(f.env, f.sessionId))!.digest_json, null);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM validate_proposals WHERE status = 'pending'").get()!.n, 0);
  assert.equal((await recordReply(f.env, f.thread, reply)).outcome, 'ignored');
});

test('a declined request cleans only the session actually marked declined, not an older unrevoked session', async t => {
  const f = await fixture(t, 'telegram', false);
  await runSessionStructureJob(f.env, jobs(f)[0].payload);
  const old = await openSession(f.env, await writableInterview(f.env, ME, INTERVIEW), 'telegram', 'text', { method: 'verbal' });
  f.db.prepare('UPDATE interview_sessions SET summary = ?, digest_json = ? WHERE id = ?').run('Keep the earlier session', '{"kept":true}', old.id);
  f.db.prepare(`INSERT INTO channel_consents(uid, user_id, provider, integration_id, thread_id, interview_id, session_id,
    status, notice_version, requested_at, request_ref_hash) VALUES ('old-request', ?, 'telegram', ?, ?, ?, ?, 'requested', 1, datetime('now'), ?)`)
    .run(ME, f.conn.integrationId, f.thread.id, INTERVIEW, old.id, await refKey('telegram', 'old-notice'));
  const out = await recordReply(f.env, f.thread, { provider: 'telegram', kind: 'consent_reply', side: 'contact',
    externalChatId: 'chat-notes', externalMessageId: 'target-no', contextMessageId: 'old-notice', via: 'word', answer: 'no' } as any);
  assert.equal(out.outcome, 'declined'); assert.equal((await loadSession(f.env, f.sessionId))!.digest_json, null);
  const preserved = (await loadSession(f.env, old.id))!;
  assert.equal(preserved.consent_status, 'given'); assert.equal(preserved.summary, 'Keep the earlier session');
  assert.equal(preserved.digest_json, '{"kept":true}');
});

test('a withdrawal claim that lost its race cannot clear a still-consented digest', async t => {
  const f = await fixture(t, 'telegram'); await runSessionStructureJob(f.env, jobs(f)[0].payload);
  const consent: any = f.db.prepare('SELECT * FROM channel_consents WHERE thread_id = ?').get(f.thread.id);
  f.db.prepare("UPDATE channel_consents SET status = 'expired' WHERE id = ?").run(consent.id);
  assert.equal((await withdraw(f.env, f.thread, consent, await refKey('telegram', 'lost-claim'))).outcome, 'ignored');
  const session = (await loadSession(f.env, f.sessionId))!;
  assert.equal(session.consent_status, 'given'); assert.ok(session.digest_json);
});

test('the quiet sweep never requeues a declined chat even after all timing bounds expire', async t => {
  const f = await fixture(t, 'telegram');
  f.db.prepare("UPDATE interview_sessions SET consent_status = 'declined', status = 'transcribed', updated_at = datetime('now', '-2 hours'), digested_at = datetime('now', '-7 hours') WHERE id = ?").run(f.sessionId);
  const { sweepQuietChats } = await import('../src/services/sessionAutoStructure.ts');
  assert.equal(await sweepQuietChats(f.env, new Date()), 0); assert.equal(jobs(f).length, 1);
});

for (const phase of ['summary', 'structure'] as const) test(`withdrawal during the ${phase} model call cannot restore digest content or engine state`, { timeout: 10000 }, async t => {
  const f = await fixture(t, 'telegram');
  const model = f.env.AI.run;
  let start!: () => void, resume!: () => void;
  const started = new Promise<void>(r => { start = r; });
  const paused = new Promise<void>(r => { resume = r; });
  let held = false;
  f.env.AI.run = async (name: string, input: unknown) => {
    const summary = JSON.stringify(input).includes('Summarise one customer');
    if (!held && !/guard/.test(name) && (phase === 'summary' ? summary : !summary)) {
      held = true; start(); await paused;
    }
    return model(name, input);
  };
  const running = runSessionStructureJob(f.env, jobs(f)[0].payload);
  t.after(async () => { resume(); await running.catch(() => {}); });
  await started;
  const consent: any = f.db.prepare('SELECT * FROM channel_consents WHERE thread_id = ?').get(f.thread.id);
  await withdraw(f.env, f.thread, consent, await refKey('telegram', `during-${phase}`));
  resume(); const outcome: any = await running;
  assert.equal(outcome.reason, 'consent_not_recorded');
  const session = (await loadSession(f.env, f.sessionId))!;
  assert.equal(session.consent_status, 'declined'); assert.equal(session.summary, null); assert.equal(session.digest_json, null);
  assert.equal(session.digest_hash, null); assert.equal(session.digest_status, 'skipped'); assert.equal(session.digest_note, NOTES.withdrawn);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM validate_proposals WHERE status = 'pending'").get()!.n, 0);
});

test('late summary and placement writes themselves refuse a declined session', async t => {
  const f = await fixture(t, 'telegram'); const stale = (await loadSession(f.env, f.sessionId))!;
  const { summariseSession } = await import('../src/services/interviewProcessing.ts');
  const { storePlacements } = await import('../src/routes/founder_validate_structure.ts');
  const placement: any = { projectId: PROJECT, sessionId: f.sessionId, interviewId: INTERVIEW, runId: 'late-result', userId: ME,
    model: 'fixture', placements: [{ kind: 'pain_severity', payload: { phrase: 'manual invoices', severity: 'severe' }, cite: { from: 0, to: 1000 }, quote: LINE }] };
  assert.equal((await summariseSession(f.env, stale, ME)).ok, true);
  assert.equal((await storePlacements(f.env, placement)).stored, 1);
  const consent: any = f.db.prepare('SELECT * FROM channel_consents WHERE thread_id = ?').get(f.thread.id);
  await withdraw(f.env, f.thread, consent, await refKey('telegram', 'before-late-writes'));
  await summariseSession(f.env, stale, ME);
  assert.equal((await loadSession(f.env, f.sessionId))!.digest_json, null);
  assert.equal((await storePlacements(f.env, placement)).stored, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM validate_proposals WHERE status = 'pending'").get()!.n, 0);
});

test('withdrawal between the final check and outcome write cannot overwrite the skipped state', async t => {
  const f = await fixture(t, 'telegram');
  const consent: any = f.db.prepare('SELECT * FROM channel_consents WHERE thread_id = ?').get(f.thread.id);
  const prepare = f.env.DB.prepare.bind(f.env.DB); let injected = false;
  f.env.DB.prepare = (sql: string) => {
    const p = prepare(sql);
    if (!sql.includes('digest_run_id = COALESCE')) return p;
    return { ...p, bind(...args: unknown[]) {
      const statement = p.bind(...args);
      return { ...statement, async run() {
        if (!injected) { injected = true; await withdraw(f.env, f.thread, consent, await refKey('telegram', 'at-final-write')); }
        return statement.run();
      } };
    } };
  };
  await runSessionStructureJob(f.env, jobs(f)[0].payload); assert.equal(injected, true);
  const session = (await loadSession(f.env, f.sessionId))!;
  assert.equal(session.digest_status, 'skipped'); assert.equal(session.digest_hash, null); assert.equal(session.digest_note, NOTES.withdrawn);
});

test('replayed withdrawal preserves the original cleanup timestamp and writes no duplicate audit row', async t => {
  const f = await fixture(t, 'telegram'); await runSessionStructureJob(f.env, jobs(f)[0].payload);
  const consent: any = f.db.prepare('SELECT * FROM channel_consents WHERE thread_id = ?').get(f.thread.id);
  const reply = await refKey('telegram', 'replay');
  await withdraw(f.env, f.thread, consent, reply);
  const audits = f.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action = 'interview_consent_withdrawn'").get()!.n;
  f.db.prepare("UPDATE interview_sessions SET digested_at = '2000-01-01 00:00:00', updated_at = '2000-01-01 00:00:00' WHERE id = ?").run(f.sessionId);
  assert.equal((await withdraw(f.env, f.thread, consent, reply)).outcome, 'ignored');
  const session = (await loadSession(f.env, f.sessionId))!;
  assert.equal(session.digested_at, '2000-01-01 00:00:00'); assert.equal(session.updated_at, '2000-01-01 00:00:00');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM activity_logs WHERE action = 'interview_consent_withdrawn'").get()!.n, audits);
});
