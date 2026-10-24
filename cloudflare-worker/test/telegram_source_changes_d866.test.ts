/** D866 §4 (#2618): synthetic source messages only; real SQLite/webhook/engine. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import structureRoutes, { storePlacements } from '../src/routes/founder_validate_structure.ts';
import { changeTelegramSource } from '../src/services/channels/telegramSource.ts';
import { extractConversationItems } from '../src/services/conversationItems.ts';
import { loadSession, SOURCE_DELETED_TEXT, SOURCE_DELETED_NOTE } from '../src/services/interviewSessions.ts';
import { transcribeVoiceNote, summariseSession } from '../src/services/interviewProcessing.ts';
import { translateSession } from '../src/services/sessionTranslation.ts';
import { digestSession } from '../src/services/validateEngine.ts';
import { toSegments } from '../src/services/interviewStructuring.ts';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import {
  INTERVIEW, ME, PROJECT, JWT_SECRET, businessMessage, call, ids, mockFetch, noSecretsSeen, ref, seen, telegramApi, tgHook, world,
} from './_channels_fixture.ts';

const OLD = 'We use Ledgerly every day.';
const NEW = 'We use Ledgerly every week.';
const OTHER_LINE = 'Our second synthetic passage.';
const methods = ['log', 'warn', 'error'] as const;
let logs: string[] = [];
const original = Object.fromEntries(methods.map((m) => [m, console[m]])) as Record<typeof methods[number], (...args: any[]) => void>;
test.beforeEach(() => {
  logs = [];
  for (const m of methods) console[m] = (...args) => { logs.push(args.map(String).join(' ')); };
});
test.afterEach(() => {
  for (const m of methods) console[m] = original[m];
  noSecretsSeen(); seen.length = 0;
  for (const text of [OLD, NEW, OTHER_LINE]) assert.equal(logs.join('\n').includes(text), false, 'source content is never logged');
});
const lines = (w: any, sid: number) => w.db.prepare("SELECT * FROM interview_transcript_segments WHERE session_id = ? AND source = 'final' ORDER BY id").all(sid);
const proposals = (w: any, sid: number) => w.db.prepare('SELECT * FROM validate_proposals WHERE session_id = ? ORDER BY id').all(sid);
const edit = (id: number, text = NEW, chat = 8001) => businessMessage('BC-ME', { key: 'edited_business_message', id, text, chat });
const deleted = (messageIds: number[], chat = 8001) => ({
  update_id: ++ids.update, deleted_business_messages: { business_connection_id: 'BC-ME', chat: { id: chat, type: 'private' }, message_ids: messageIds },
});
async function hook(w: any, update: unknown) {
  const f = mockFetch(telegramApi);
  try { assert.equal((await tgHook(w.env, update)).status, 200); } finally { f.restore(); }
}
async function assigned() {
  const w = await world({ seed: true });
  const first = ++ids.message, second = ++ids.message;
  await hook(w, businessMessage('BC-ME', { id: first, text: OLD }));
  await hook(w, businessMessage('BC-ME', { id: second, text: OTHER_LINE }));
  const t = w.db.prepare("SELECT * FROM channel_threads WHERE provider = 'telegram'").get();
  const r = await call(w.env, ME, 'POST', '/threads/' + t.uid + '/assign', { interview_id: INTERVIEW });
  assert.equal(r.status, 200);
  const sid = Number(r.body.session_id);
  w.db.prepare("UPDATE interview_transcript_segments SET source_lang = 'en' WHERE session_id = ?").run(sid);
  return { ...w, sid, first, second, thread: w.db.prepare('SELECT * FROM channel_threads WHERE id = ?').get(t.id) };
}
function seed(w: any, status = 'pending', from = 0, name = 'Ledgerly') {
  return Number(w.db.prepare("INSERT INTO validate_proposals (project_id, kind, payload_json, citation_json, status, created_by, session_id, target_ref, run_id, cite_from, cite_to, decided_by, decided_at) VALUES (?, 'competitor_mention', ?, ?, ?, ?, ?, ?, 'synthetic-run', ?, ?, ?, ?)")
    .run(PROJECT, JSON.stringify({ name }), JSON.stringify({ kind: 'transcript', quote: OLD, quote_original: OLD, from, to: from + 1000 }),
      status, ME, w.sid, 'interview:' + INTERVIEW, from, from + 1000, status === 'pending' ? null : ME, status === 'pending' ? null : '2026-10-01').lastInsertRowid);
}
function ai(w: any, before?: (kind: string) => Promise<void>) {
  w.env.AI.run = async (model: string, input: any) => {
    if (/guard/.test(model)) return { response: 'safe' };
    if (!input?.messages) {
      await before?.('translation');
      return { translated_text: 'Translated synthetic passage.' };
    }
    const prompt = JSON.stringify(input);
    if (prompt.includes('Summarise one customer')) {
      await before?.('summary');
      return { response: JSON.stringify({ overview: [{ text: 'A synthetic overview.', cites: [{ from: 0, to: 1000 }] }], key_quotes: [] }) };
    }
    if (!prompt.includes('list what the founder can act on')) return { response: JSON.stringify({ placements: [] }) };
    await before?.('extract');
    const shown = String(input.messages.at(-1).content);
    const match = [...shown.matchAll(/\[(\d+)-(\d+)\][^\n]*?: ([^\n]+)/g)].find((m) => m[3].includes('Ledgerly'));
    const items = match ? ['Ledgerly', 'DecidedTool'].map((name) => ({ type: 'data_point', kind: 'current_tool', value: name,
      confidence: 0.9, cite: { from: Number(match[1]), to: Number(match[2]) }, quote: match[3].trim() })) : [];
    return { response: JSON.stringify({ items }) };
  };
}
test('hashed source survives pending assignment and direct appends; voice passages keep the same source', async () => {
  const w = await assigned();
  assert.deepEqual(lines(w, w.sid).map((s: any) => s.source_ref), [ref('telegram', '8001:' + w.first), ref('telegram', '8001:' + w.second)]);
  const third = ++ids.message;
  await hook(w, businessMessage('BC-ME', { id: third, text: 'Another synthetic message.' }));
  assert.equal(lines(w, w.sid).at(-1).source_ref, ref('telegram', '8001:' + third));
  w.db.prepare("UPDATE channel_threads SET consent_state = 'given' WHERE id = ?").run(w.thread.id);
  w.db.prepare("UPDATE interview_sessions SET consent_status = 'given' WHERE id = ?").run(w.sid);
  const voiceId = ++ids.message;
  await hook(w, businessMessage('BC-ME', { id: voiceId, voice: { file_id: 'synthetic-voice', duration: 5, mime_type: 'audio/ogg', file_size: 4000 } }));
  w.env.AI.run = async (model: string) => /guard/.test(model) ? { response: 'safe' } : { text: 'Synthetic voice passage.', transcription_info: { language: 'en' } };
  const job = w.queued.filter((j: any) => j.job_type === 'channel_followup' && j.payload.kind === 'voice').at(-1);
  const f = mockFetch(telegramApi);
  try { await runChannelJob(w.env, 'channel_followup', job.payload); } finally { f.restore(); }
  const passage = lines(w, w.sid).at(-1);
  assert.deepEqual([passage.text, passage.source_ref], ['Synthetic voice passage.', ref('telegram', '8001:' + voiceId)]);
  await hook(w, deleted([voiceId]));
  assert.equal(lines(w, w.sid).at(-1).text, SOURCE_DELETED_TEXT);
  assert.deepEqual(w.db.prepare('SELECT segments_json FROM interview_chunk_transcripts WHERE session_id = ?').all(w.sid)
    .map((r: any) => JSON.parse(r.segments_json)), [[]], 'the staged text is cleared while the receipt stays');
});
test('edit withdraws only cited undecided proposals and re-extracts under D859 keys without changing decisions', async () => {
  const w = await assigned();
  const pendingId = seed(w), decidedIds = ['accepted', 'edited', 'discarded'].map((s) => seed(w, s, 0, 'DecidedTool'));
  const unrelatedId = seed(w, 'pending', 1000, 'OtherTool');
  const before = proposals(w, w.sid).filter((p: any) => decidedIds.includes(p.id));
  await hook(w, edit(w.first));
  assert.deepEqual(lines(w, w.sid).map((s: any) => s.text), [NEW, OTHER_LINE]);
  assert.deepEqual(proposals(w, w.sid).filter((p: any) => decidedIds.includes(p.id)), before);
  assert.equal(proposals(w, w.sid).some((p: any) => p.id === pendingId), false);
  assert.equal(proposals(w, w.sid).some((p: any) => p.id === unrelatedId), true);
  assert.ok(w.queued.some((j: any) => j.job_type === 'session_structure' && j.payload.trigger === 'chat_text_added'));
  ai(w);
  const r = await extractConversationItems(w.env, { sessionId: w.sid, userId: ME });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual([r.stored, r.deduped], [1, 1]);
  const fresh = proposals(w, w.sid).filter((p: any) => p.status === 'pending' && p.id !== unrelatedId);
  assert.equal(fresh.length, 1);
  assert.deepEqual([JSON.parse(fresh[0].payload_json).name, JSON.parse(fresh[0].citation_json).quote], ['Ledgerly', NEW]);
  await hook(w, edit(w.first));
  assert.equal(proposals(w, w.sid).filter((p: any) => p.status === 'pending').length, 2, 'replay cannot withdraw newly extracted proposals');
});
test('deletion leaves a neutral stable-span marker, withdraws pending and annotates all decisions without changing their payload/status', async () => {
  const w = await assigned();
  seed(w);
  const decidedIds = ['accepted', 'edited', 'discarded'].map((s) => seed(w, s));
  const unrelated = seed(w, 'pending', 1000, 'OtherTool');
  const before = proposals(w, w.sid).filter((p: any) => decidedIds.includes(p.id));
  w.db.prepare("UPDATE interview_sessions SET summary = ?, digest_json = ?, summary_citations_json = ?, digest_hash = 'old' WHERE id = ?")
    .run(OLD, JSON.stringify({ overview: OLD }), JSON.stringify([{ quote: OLD }]), w.sid);
  w.db.prepare("UPDATE interview_transcript_segments SET translated_text = 'synthetic-stale-ciphertext', translation_status = 'done' WHERE session_id = ?").run(w.sid);
  await hook(w, deleted([w.first]));
  const rows = lines(w, w.sid);
  assert.deepEqual(rows.map((r: any) => r.text), [SOURCE_DELETED_TEXT, OTHER_LINE]);
  assert.equal(rows[0].translated_text, null);
  assert.deepEqual(toSegments(rows).map((r) => [r.start, r.end, r.text]), [[1000, 2000, OTHER_LINE]]);
  const after = proposals(w, w.sid);
  assert.equal(after.filter((p: any) => p.status === 'pending').length, 1);
  assert.ok(after.some((p: any) => p.id === unrelated));
  for (const old of before) {
    const kept = after.find((p: any) => p.id === old.id);
    assert.deepEqual([kept.payload_json, kept.edited_payload_json, kept.status, kept.decided_at, kept.decided_by],
      [old.payload_json, old.edited_payload_json, old.status, old.decided_at, old.decided_by]);
    const cite = JSON.parse(kept.citation_json);
    assert.deepEqual([cite.source_deleted, cite.source_note, cite.quote, cite.quote_original], [true, SOURCE_DELETED_NOTE, undefined, undefined]);
  }
  const session = await loadSession(w.env, w.sid);
  assert.deepEqual([session!.summary, session!.digest_json, session!.summary_citations_json], [null, null, null]);
  const mirror = w.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript;
  assert.equal(mirror.includes(OLD), false); assert.ok(mirror.includes(OTHER_LINE));
  const snapshot = proposals(w, w.sid);
  const api = new Hono().route('/api/validate', structureRoutes);
  const token = await new SignJWT({ user_id: ME }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
  const response = await api.fetch(new Request('https://axal.vc/api/validate/sessions/' + w.sid + '/placements', { headers: { authorization: 'Bearer ' + token } }), w.env);
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  const apiDecisions = body.runs.flatMap((r: any) => r.placements).filter((p: any) => decidedIds.includes(p.id));
  assert.equal(apiDecisions.length, decidedIds.length);
  assert.ok(apiDecisions.every((p: any) => p.cite.source_deleted === true && p.cite.source_note === SOURCE_DELETED_NOTE && p.cite.quote === null));
  await hook(w, deleted([w.first]));
  await hook(w, edit(w.first));
  assert.deepEqual(proposals(w, w.sid), snapshot);
  assert.equal(lines(w, w.sid)[0].text, SOURCE_DELETED_TEXT, 'a late edit cannot resurrect a deleted source');
});
test('unknown messages/chats and another session are untouched; unassigned edits stay in the pending store', async () => {
  const w = await assigned(); seed(w);
  const before = { lines: lines(w, w.sid), proposals: proposals(w, w.sid) };
  await hook(w, edit(999999)); await hook(w, deleted([999999])); await hook(w, deleted([w.first], 8999));
  assert.deepEqual({ lines: lines(w, w.sid), proposals: proposals(w, w.sid) }, before);
  const id = ++ids.message;
  await hook(w, businessMessage('BC-ME', { chat: 8999, id, text: OLD }));
  await hook(w, edit(id, NEW, 8999));
  assert.deepEqual({ lines: lines(w, w.sid), proposals: proposals(w, w.sid) }, before);
  const conn = { provider: 'telegram', userId: ME, integrationId: w.thread.integration_id } as any;
  assert.equal(await changeTelegramSource(w.env, { ...conn, userId: ME + 99 }, w.thread, ['8001:' + w.first], NEW), 0);
  w.db.prepare('UPDATE channel_threads SET session_id = NULL WHERE id = ?').run(w.thread.id);
  await hook(w, edit(w.first));
  assert.equal(lines(w, w.sid)[0].text, OLD);
});
for (const kind of ['edit', 'delete']) {
  test('late extraction cannot restore ' + kind + ' source content', async () => {
    const w = await assigned();
    seed(w, 'accepted', 0, 'DecidedTool');
    let changed = false;
    ai(w, async (stage) => {
      if (stage === 'extract' && !changed) {
        changed = true;
        await hook(w, kind === 'edit' ? edit(w.first) : deleted([w.first]));
      }
    });
    const out = await extractConversationItems(w.env, { sessionId: w.sid, userId: ME });
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.stored, 0);
    assert.equal(proposals(w, w.sid).filter((p: any) => p.status === 'pending').length, 0);
    assert.equal(proposals(w, w.sid).filter((p: any) => p.status === 'accepted').length, 1);
    ai(w);
    const fresh = await extractConversationItems(w.env, { sessionId: w.sid, userId: ME });
    assert.equal(fresh.ok, true);
    if (fresh.ok) assert.equal(fresh.stored, kind === 'edit' ? 1 : 0);
  });
}
test('late summaries and translations cannot restore replaced text; the original result has a positive control', async () => {
  const w = await assigned(); ai(w);
  assert.equal((await summariseSession(w.env, (await loadSession(w.env, w.sid))!, ME)).ok, true);
  assert.ok((await loadSession(w.env, w.sid))!.summary);
  let changed = false;
  ai(w, async (stage) => { if (stage === 'summary' && !changed) { changed = true; await hook(w, edit(w.first)); } });
  await summariseSession(w.env, (await loadSession(w.env, w.sid))!, ME);
  assert.equal((await loadSession(w.env, w.sid))!.summary, null);
  w.db.prepare("UPDATE interview_transcript_segments SET text = ?, source_lang = 'es', translation_status = NULL WHERE id = ?").run('Un pasaje sintético para traducir.', lines(w, w.sid)[0].id);
  changed = false;
  ai(w, async (stage) => { if (stage === 'translation' && !changed) { changed = true; await hook(w, deleted([w.first])); } });
  const translated = await translateSession(w.env, { sessionId: w.sid, userId: ME });
  assert.equal(translated.translated, 0, 'a discarded late translation is not reported as stored');
  const row = lines(w, w.sid)[0];
  assert.deepEqual([row.text, row.translated_text, row.translation_status], [SOURCE_DELETED_TEXT, null, 'undetected']);
});
test('an engine run overtaken by a source edit leaves the current transcript due without sealing the stale hash', async () => {
  const w = await assigned(); let changed = false;
  ai(w, async (stage) => { if (stage === 'summary' && !changed) { changed = true; await hook(w, edit(w.first)); } });
  const r = await digestSession(w.env, { sessionId: w.sid, userId: ME, trigger: 'chat_assigned' });
  assert.deepEqual([r.ok, r.status, !r.ok && 'reason' in r ? r.reason : null], [false, 'skipped', 'source_changed']);
  const s = await loadSession(w.env, w.sid);
  assert.deepEqual([s!.status, s!.digest_status, s!.digest_hash], ['transcribed', 'queued', null]);
});
test('concurrent identical edits claim once and cannot delete a fresh replacement proposal', async () => {
  const w = await assigned(); seed(w);
  const conn = { provider: 'telegram', userId: ME, integrationId: w.thread.integration_id } as any;
  const prepare = w.env.DB.prepare.bind(w.env.DB);
  let reads = 0, releaseReads!: () => void, releaseFirstBatch!: () => void;
  const bothRead = new Promise<void>((r) => { releaseReads = r; });
  const firstBatchDone = new Promise<void>((r) => { releaseFirstBatch = r; });
  w.env.DB.prepare = (sql: string) => {
    const stmt = prepare(sql);
    if (sql.includes('speaker_label, text, source_ref, model')) {
      const all = stmt.all.bind(stmt);
      stmt.all = async () => {
        const out = await all();
        if (++reads === 2) releaseReads();
        await bothRead; // Both callers saw the old text before either claim.
        return out;
      };
    }
    return stmt;
  };
  const batch = w.env.DB.batch.bind(w.env.DB); let batches = 0, freshId = 0;
  w.env.DB.batch = async (stmts: any[]) => {
    const number = ++batches;
    if (number === 2) await firstBatchDone;
    const out = await batch(stmts);
    if (number === 1) { freshId = seed(w, 'pending', 0, 'Fresh'); releaseFirstBatch(); }
    return out;
  };
  const outcomes = await Promise.all([1, 2].map(() => changeTelegramSource(w.env, conn, w.thread, ['8001:' + w.first], NEW)));
  assert.equal(outcomes.reduce((a, b) => a + b, 0), 1);
  assert.ok(proposals(w, w.sid).some((p: any) => p.id === freshId));
});

test('the source hash cannot change another session and legacy NULL references are never guessed', async () => {
  const w = await assigned();
  w.db.prepare("INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (999, ?, 'Synthetic second interview')").run(PROJECT);
  const other = Number(w.db.prepare("INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status, submitted_via) VALUES ('synthetic-other-session', 999, ?, ?, 'text', 'transcribed', 'telegram')")
    .run(PROJECT, ME).lastInsertRowid);
  w.db.prepare("INSERT INTO interview_transcript_segments (session_id, source, text, model, source_ref) VALUES (?, 'final', ?, 'channel:telegram', ?)")
    .run(other, OLD, ref('telegram', '8001:' + w.first));
  const unrelated = seed({ ...w, sid: other });
  await hook(w, edit(w.first));
  assert.equal(lines(w, other)[0].text, OLD);
  assert.equal(proposals(w, other).length, 1);
  assert.equal(proposals(w, other)[0].id, unrelated);
  w.db.prepare('UPDATE interview_transcript_segments SET source_ref = NULL WHERE session_id = ?').run(w.sid);
  await hook(w, deleted([w.first]));
  assert.equal(lines(w, w.sid)[0].text, NEW);
});
test('source edits preserve a declined consent state and never queue AI after STOP', async () => {
  const w = await assigned();
  w.db.prepare("UPDATE interview_sessions SET consent_status = 'declined', digest_status = 'skipped', digest_note = 'Synthetic consent stopped' WHERE id = ?").run(w.sid);
  const queued = w.queued.length;
  await hook(w, edit(w.first));
  const s = await loadSession(w.env, w.sid);
  assert.deepEqual([lines(w, w.sid)[0].text, s!.consent_status, s!.digest_status, s!.digest_note, w.queued.length],
    [NEW, 'declined', 'skipped', 'Synthetic consent stopped', queued]);
});

test('the updated legacy mirror is bounded in UTF-8 bytes without changing later passages', async () => {
  const w = await assigned();
  const large = '🟣'.repeat(100000);
  for (let i = 0; i < 3; i++) w.db.prepare("INSERT INTO interview_transcript_segments (session_id, source, text, model) VALUES (?, 'final', ?, 'channel:telegram')").run(w.sid, large);
  await hook(w, edit(w.first));
  const mirror = w.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript;
  assert.ok(Buffer.byteLength(mirror) <= 1000000);
  assert.ok(mirror.startsWith(NEW + '\n' + OTHER_LINE));
  assert.equal(lines(w, w.sid).at(-1).text, large);
});

test('source changes preserve manual and legacy mirror text, including an oversized first passage', async () => {
  const w = await assigned();
  const prefix = 'Synthetic manually pasted history.\n';
  w.db.prepare('UPDATE discovery_interviews SET transcript = ? WHERE id = ?').run(prefix + OLD + '\n' + OTHER_LINE, INTERVIEW);
  await hook(w, edit(w.first));
  assert.equal(w.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript, prefix + NEW + '\n' + OTHER_LINE);
  await hook(w, deleted([w.first]));
  assert.equal(w.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript, prefix + SOURCE_DELETED_TEXT + '\n' + OTHER_LINE);
  w.db.prepare('UPDATE interview_transcript_segments SET text = ? WHERE id = ?').run('🟣'.repeat(300000), lines(w, w.sid)[0].id);
  await hook(w, edit(w.second));
  assert.equal(w.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript, prefix + SOURCE_DELETED_TEXT + '\n' + NEW);
  const full = '🟣'.repeat(249990) + '\n' + NEW;
  w.db.prepare('UPDATE discovery_interviews SET transcript = ? WHERE id = ?').run(full, INTERVIEW);
  await hook(w, edit(w.second, NEW.repeat(100)));
  const capped = w.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript;
  assert.equal(capped, full.replaceAll(NEW, ''));
  assert.ok(Buffer.byteLength(capped) <= 1000000);
});

test('bulk deletion reads source rows once and keeps unrelated passages and citation spans', async () => {
  const w = await assigned();
  const prepare = w.env.DB.prepare.bind(w.env.DB); let reads = 0;
  w.env.DB.prepare = (sql: string) => {
    if (sql.includes('speaker_label, text, source_ref, model')) reads++;
    return prepare(sql);
  };
  await hook(w, deleted([w.first, w.second, ...Array.from({ length: 98 }, (_, i) => 900000 + i)]));
  assert.deepEqual(lines(w, w.sid).map((r: any) => r.text), [SOURCE_DELETED_TEXT, SOURCE_DELETED_TEXT]);
  assert.equal(reads, 1);
});

test('a long source snapshot is bound once for many placements and a stale source rejects the entire run', async () => {
  const w = await assigned();
  const sourceText = 'Synthetic long passage. '.repeat(10000);
  const id = lines(w, w.sid)[0].id;
  w.db.prepare('UPDATE interview_transcript_segments SET text = ? WHERE id = ?').run(sourceText, id);
  const snapshot = [{ id, text: sourceText }];
  const prepare = w.env.DB.prepare.bind(w.env.DB); let snapshotBinds = 0;
  w.env.DB.prepare = (sql: string) => {
    const stmt = prepare(sql);
    if (sql.includes('INSERT INTO validate_proposals')) {
      const bind = stmt.bind.bind(stmt);
      stmt.bind = (...args: any[]) => {
        snapshotBinds += args.filter((v) => v === JSON.stringify(snapshot)).length;
        return bind(...args);
      };
    }
    return stmt;
  };
  const opts = { projectId: PROJECT, sessionId: w.sid, interviewId: INTERVIEW, runId: 'long-synthetic', userId: ME, model: 'synthetic',
    sourceSnapshot: snapshot, placements: Array.from({ length: 40 }, (_, i) => ({ kind: 'competitor_mention', payload: { name: 'Synthetic ' + i },
      cite: { from: 0, to: 1000 }, quote: 'Synthetic long passage.' })) as any };
  assert.equal((await storePlacements(w.env, opts)).stored, 40);
  assert.equal(snapshotBinds, 1);
  assert.equal(proposals(w, w.sid).length, 40);
  w.db.prepare('UPDATE interview_transcript_segments SET text = ? WHERE id = ?').run(NEW, id);
  assert.equal((await storePlacements(w.env, { ...opts, runId: 'stale-synthetic' })).stored, 0);
  assert.equal(proposals(w, w.sid).length, 40);
});

test('STOP plus an in-flight source edit keeps withdrawal state and cleans up late suggestions', async () => {
  const w = await assigned(); seed(w, 'pending', 1000); seed(w, 'accepted');
  let stopped = false, queuedAtStop = 0;
  ai(w, async (stage) => {
    if (stage === 'summary' && !stopped) {
      stopped = true; await hook(w, edit(w.first));
      w.db.prepare("UPDATE interview_sessions SET consent_status = 'declined', digest_status = 'skipped', digest_note = 'Synthetic STOP' WHERE id = ?").run(w.sid);
      queuedAtStop = w.queued.length;
    }
  });
  const r = await digestSession(w.env, { sessionId: w.sid, userId: ME, trigger: 'chat_assigned' });
  assert.deepEqual([r.ok, !r.ok && 'reason' in r ? r.reason : null], [false, 'consent_not_recorded']);
  const session = (await loadSession(w.env, w.sid))!;
  assert.equal(session.digest_status, 'skipped');
  assert.ok(session.digest_note!.includes('withdrew consent'));
  assert.equal(w.queued.length, queuedAtStop);
  assert.equal(proposals(w, w.sid).length, 1);
  assert.deepEqual([proposals(w, w.sid)[0].status, proposals(w, w.sid)[0].citation_json], ['accepted', null]);
});

for (const timing of ['before_source', 'during_speech', 'before_commit']) {
  test('a voice deletion ' + timing + ' cannot append untracked text or lose a paid receipt', async () => {
    const w = await assigned();
    w.db.prepare("UPDATE channel_threads SET consent_state = 'given' WHERE id = ?").run(w.thread.id);
    w.db.prepare("UPDATE interview_sessions SET consent_status = 'given' WHERE id = ?").run(w.sid);
    const voiceId = ++ids.message;
    await hook(w, businessMessage('BC-ME', { id: voiceId, voice: { file_id: 'synthetic-voice', duration: 5, mime_type: 'audio/ogg', file_size: 4000 } }));
    let speechCalls = 0, staged = false, removed = false;
    const remove = () => {
      removed = true;
      w.db.prepare('DELETE FROM channel_thread_messages WHERE thread_id = ? AND external_message_id = ?').run(w.thread.id, ref('telegram', '8001:' + voiceId));
    };
    const prepare = w.env.DB.prepare.bind(w.env.DB);
    w.env.DB.prepare = (sql: string) => {
      if (timing === 'before_source' && sql.includes('SELECT m.external_message_id') && !removed) remove();
      if (sql.includes('INSERT INTO interview_chunk_transcripts')) staged = true;
      return prepare(sql);
    };
    const batch = w.env.DB.batch.bind(w.env.DB);
    w.env.DB.batch = async (stmts: any[]) => {
      if (timing === 'before_commit' && staged && !removed) remove();
      return batch(stmts);
    };
    w.env.AI.run = async (model: string) => {
      if (/guard/.test(model)) return { response: 'safe' };
      speechCalls++;
      if (timing === 'during_speech') remove();
      return { text: 'Synthetic deleted voice.', transcription_info: { language: 'en' } };
    };
    const job = w.queued.filter((j: any) => j.job_type === 'channel_followup' && j.payload.kind === 'voice').at(-1);
    const f = mockFetch(telegramApi);
    try { await runChannelJob(w.env, 'channel_followup', job.payload); } finally { f.restore(); }
    assert.equal(removed, true);
    assert.equal(speechCalls, timing === 'before_source' ? 0 : 1);
    assert.deepEqual(lines(w, w.sid).map((r: any) => r.text), [OLD, OTHER_LINE]);
    const chunks = w.db.prepare('SELECT * FROM interview_chunk_transcripts WHERE session_id = ?').all(w.sid);
    assert.equal(chunks.length, 1);
    assert.deepEqual(JSON.parse(chunks[0].segments_json), []);
    const receipts = w.db.prepare("SELECT * FROM interview_session_receipts WHERE session_id = ? AND kind = 'final'").all(w.sid);
    assert.equal(receipts.length, timing === 'before_source' ? 0 : 1);
    if (receipts.length) assert.equal(receipts[0].cost_microusd, chunks[0].cost_microusd);
    const replay = await transcribeVoiceNote(w.env, { session: (await loadSession(w.env, w.sid))!, userId: ME, seq: chunks[0].seq,
      speakerLabel: 'Interviewee', provider: 'telegram' });
    assert.deepEqual(replay, { ok: true, appended: 0, already: true });
    assert.equal(speechCalls, timing === 'before_source' ? 0 : 1);
  });
}

test('a voice append racing the deletion lookup is either suppressed or found and tombstoned', async () => {
  const w = await assigned();
  w.db.prepare("UPDATE channel_threads SET consent_state = 'given' WHERE id = ?").run(w.thread.id);
  w.db.prepare("UPDATE interview_sessions SET consent_status = 'given' WHERE id = ?").run(w.sid);
  const voiceId = ++ids.message;
  await hook(w, businessMessage('BC-ME', { id: voiceId, voice: { file_id: 'synthetic-voice', duration: 5, mime_type: 'audio/ogg', file_size: 4000 } }));
  w.env.AI.run = async (model: string) => /guard/.test(model) ? { response: 'safe' }
    : { text: 'Synthetic deleted voice.', transcription_info: { language: 'en' } };
  let staged = false, releaseAppend!: () => void, appendReady!: () => void;
  const paused = new Promise<void>((r) => { appendReady = r; });
  const commit = new Promise<void>((r) => { releaseAppend = r; });
  const prepare = w.env.DB.prepare.bind(w.env.DB);
  let jobRun: Promise<unknown>;
  w.env.DB.prepare = (sql: string) => {
    if (sql.includes('INSERT INTO interview_chunk_transcripts')) staged = true;
    const stmt = prepare(sql);
    if (sql.includes('speaker_label, text, source_ref, model')) {
      const all = stmt.all.bind(stmt);
      stmt.all = async () => {
        const rows = await all();
        releaseAppend(); await jobRun;
        return rows;
      };
    }
    return stmt;
  };
  const batch = w.env.DB.batch.bind(w.env.DB);
  w.env.DB.batch = async (stmts: any[]) => {
    if (staged) { staged = false; appendReady(); await commit; }
    return batch(stmts);
  };
  const job = w.queued.filter((j: any) => j.job_type === 'channel_followup' && j.payload.kind === 'voice').at(-1);
  const f = mockFetch(telegramApi);
  try {
    jobRun = runChannelJob(w.env, 'channel_followup', job.payload);
    await paused;
    await hook(w, deleted([voiceId]));
    await jobRun;
  } finally { releaseAppend(); f.restore(); }
  assert.deepEqual(lines(w, w.sid).map((r: any) => r.text), [OLD, OTHER_LINE]);
  const chunks = w.db.prepare('SELECT segments_json FROM interview_chunk_transcripts WHERE session_id = ?').all(w.sid);
  assert.deepEqual(chunks.map((c: any) => JSON.parse(c.segments_json)), [[]]);
  assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM interview_session_receipts WHERE session_id = ? AND kind = 'final'").get(w.sid).n, 1);
});


test('short and multiline source passages replace only unique full mirror passages', async () => {
  const w = await assigned();
  const row = lines(w, w.sid)[0];
  for (const word of ['no', 'a', '1', 'first\nsecond']) {
    const prefix = 'Synthetic history: not, know, enough, a note, 11 and first\nsecondhand.\n';
    w.db.prepare("UPDATE interview_transcript_segments SET text = ?, model = 'channel:telegram' WHERE id = ?").run(word, row.id);
    w.db.prepare('UPDATE discovery_interviews SET transcript = ? WHERE id = ?').run(prefix + word + '\n' + OTHER_LINE, INTERVIEW);
    await hook(w, edit(w.first, NEW));
    assert.equal(w.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript, prefix + NEW + '\n' + OTHER_LINE);
    w.db.prepare("UPDATE interview_transcript_segments SET text = ?, model = 'channel:telegram' WHERE id = ?").run(word, row.id);
    w.db.prepare('UPDATE discovery_interviews SET transcript = ? WHERE id = ?').run(prefix + word, INTERVIEW);
    await hook(w, deleted([w.first]));
    assert.equal(w.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript, prefix + SOURCE_DELETED_TEXT);
  }
  w.db.prepare("UPDATE interview_transcript_segments SET text = 'no', model = 'channel:telegram' WHERE id = ?").run(row.id);
  w.db.prepare("UPDATE discovery_interviews SET transcript = 'no\nno' WHERE id = ?").run(INTERVIEW);
  await hook(w, deleted([w.first]));
  assert.equal(w.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript, 'no\nno', 'an ambiguous mirror has no source mapping to guess');
  assert.equal(lines(w, w.sid)[0].text, SOURCE_DELETED_TEXT);
  w.db.prepare("UPDATE interview_transcript_segments SET text = 'no', model = 'channel:telegram' WHERE id = ?").run(row.id);
  w.db.prepare("UPDATE discovery_interviews SET transcript = 'no' WHERE id = ?").run(INTERVIEW);
  await hook(w, edit(w.first));
  assert.equal(w.db.prepare('SELECT transcript FROM discovery_interviews WHERE id = ?').get(INTERVIEW).transcript, NEW, 'first and last line may be the same passage');
});
