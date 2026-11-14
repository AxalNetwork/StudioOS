/** D865: Telegram admission, metered speech and the shared D857 translation path.
 * All media and words below are synthetic; providers are always stubbed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fetchTelegramVoice, TELEGRAM_VIDEO_NOTES } from '../src/services/channels/telegram.ts';
import { setFixtureAllowance } from './_ai_budget_fixture.mjs';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import { CHANNEL_LIMITS } from '../src/services/channels/types.ts';
import { translateSession, readTranslation, TRANSLATION_MODEL } from '../src/services/sessionTranslation.ts';
import { structureSession } from '../src/services/sessionAutoStructure.ts';
import { CHANNEL_PAGES } from '../src/integrations/connectorPages.ts';
import { DEFAULT_FINAL_MODEL } from '../src/services/sttModels.ts';
import {
  AUDIO, businessMessage, call, consentGiven, INTERVIEW, ME, mockFetch, noSecretsSeen,
  seen, telegramApi, tgHook, world,
} from './_channels_fixture.ts';

test.afterEach(() => { noSecretsSeen(); seen.length = 0; });
const CAP = 5 * 1024 * 1024;
const SYNTHETIC_SPANISH = 'Esta es una frase de prueba.';
const paddedAudio = (n: number) => { const bytes = new Uint8Array(n); bytes.set(AUDIO.OGG); return bytes; };
const note = (size: number | null = null) => ({ file: 'SYNTHETIC', media: 'voice' as const, mime: 'audio/ogg', size });
const fileCalls = (f: { calls: { url: string }[] }) => f.calls.filter(c => /\/getFile$|\/file\/bot/.test(c.url));

async function admission(fetchVoice = fetchTelegramVoice) {
  // The cap is inclusive. An exact-cap control kills an accidental >= rule.
  for (const [declared, metadata, body, reason, requests] of [
    [CAP, CAP, CAP, null, 2],
    [CAP + 1, CAP, CAP, 'too_large', 0],
    [20 * 1024 * 1024, CAP, CAP, 'too_large', 0],
    [null, CAP + 1, CAP, 'too_large', 1],
    [null, CAP, CAP + 1, 'too_large', 2],
  ] as const) {
    const f = mockFetch((url) => url.pathname.endsWith('/getFile')
      ? { json: { ok: true, result: { file_size: metadata, file_path: 'voice/synthetic.ogg' } } }
      : { body: paddedAudio(body), headers: { 'content-type': 'application/octet-stream' } });
    try {
      const r = await fetchVoice({ TELEGRAM_CHANNEL_BOT_TOKEN: 'fixture' } as any, note(declared));
      if (reason) {
        assert.equal(r.ok, false, 'refused media never returns bytes');
        assert.deepEqual(r, { ok: false, code: reason, retryable: false });
      }
      else {
        assert.equal(r.ok, true);
        if (!r.ok) throw new Error('expected admitted synthetic audio');
        assert.equal(r.bytes.byteLength, CAP);
        assert.equal(r.mime, 'audio/ogg');
      }
      assert.equal(f.calls.length, requests);
    } finally { f.restore(); }
  }
}

async function roundVideo(fetchVoice = fetchTelegramVoice, enabled = false) {
  const f = mockFetch(telegramApi);
  try {
    const r = await fetchVoice({} as any, { ...note(4000), media: 'video_note', mime: 'video/mp4' });
    assert.deepEqual(r, { ok: false, code: enabled ? 'unsupported_format' : 'video_note_unsupported', retryable: false });
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
}

async function assigned(text = 'Synthetic test message.', appLanguage = 'de') {
  const w = await world({ seed: true });
  const update = businessMessage('BC-ME', { text });
  Object.assign(update.business_message.from, { language_code: appLanguage });
  await tgHook(w.env, update);
  const [thread] = (await call(w.env, ME, 'GET', '/threads')).body.items;
  const a = await call(w.env, ME, 'POST', `/threads/${thread.uid}/assign`, { interview_id: INTERVIEW });
  assert.equal(a.status, 200);
  return { ...w, thread: thread.uid, sessionId: Number(a.body.session_id) };
}
const jobs = (w: any) => w.queued.filter((j: any) => j.job_type === 'channel_followup' && j.payload.kind === 'voice');
const run = (w: any) => runChannelJob(w.env, 'channel_followup', jobs(w).at(-1).payload);
const reservations = (w: any) => w.db.prepare('SELECT * FROM ai_budget_reservations WHERE user_id = ?').all(ME);
const usage = (w: any) => w.db.prepare('SELECT * FROM ai_usage_logs WHERE user_id = ?').all(ME);
const sendNote = (w: any, media: Record<string, unknown> = { voice: { file_id: 'SYNTHETIC', mime_type: 'audio/ogg', file_size: 4000 } }) =>
  tgHook(w.env, businessMessage('BC-ME', media));

async function consentGate() {
  // A job queued under YES must re-check consent before even getFile.
  for (const state of [null, 'awaiting', 'declined', 'withdrawn']) {
    const w = await assigned();
    await consentGiven(w.env, w.db, w.thread);
    await sendNote(w);
    w.db.prepare('UPDATE channel_threads SET consent_state = ? WHERE uid = ?').run(state, w.thread);
    const f = mockFetch(telegramApi);
    try { await run(w); assert.equal(fileCalls(f).length, 0); } finally { f.restore(); }
    assert.equal(w.aiCalls.length, 0);
    assert.equal(w.r2.objects.size, 0);
    assert.deepEqual(reservations(w), []);
    assert.deepEqual(usage(w), []);
    assert.equal(w.db.prepare('SELECT transcribe_error FROM channel_thread_messages WHERE voice_ref_enc IS NOT NULL').get().transcribe_error, 'no_consent');
    w.db.close();
  }
}

async function heldBeforeYes() {
  const w = await assigned();
  const f = mockFetch(telegramApi);
  try {
    await sendNote(w);
    assert.equal(jobs(w).length, 0, 'a held note queues no download');
    assert.equal(fileCalls(f).length, 0);assert.equal(w.aiCalls.length, 0);
    assert.equal(w.r2.objects.size, 0);assert.deepEqual(reservations(w), []);
    await consentGiven(w.env, w.db, w.thread);
    assert.equal(jobs(w).length, 1, 'YES releases the waiting note');
    await run(w);
    assert.equal(fileCalls(f).length, 2);assert.equal(w.r2.objects.size, 1);
  } finally { f.restore(); w.db.close(); }
}

async function meteredSpeech(media?: Record<string, unknown>) {
  const w = await assigned();
  await consentGiven(w.env, w.db, w.thread);
  let held = 0;
  const original = w.env.AI.run;
  w.env.AI.run = async (model: string, input: unknown) => {
    if (model !== DEFAULT_FINAL_MODEL) return original(model, input);
    const pending = reservations(w).filter((r: any) => r.status === 'pending');
    assert.equal(pending.length, 1, 'speech has a hold before the model runs');
    assert.ok(pending[0].included_microusd + pending[0].topup_microusd > 0);
    held++;
    return { text: SYNTHETIC_SPANISH, transcription_info: { language: 'es' } };
  };
  const f = mockFetch(telegramApi);
  try { await sendNote(w, media); await run(w); } finally { f.restore(); w.env.AI.run = original; }
  assert.equal(held, 1);
  assert.equal(w.r2.objects.size, 1);
  const texts = w.db.prepare('SELECT text FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(w.sessionId);
  assert.deepEqual(texts.map((r: any) => r.text), ['Synthetic test message.', SYNTHETIC_SPANISH]);
  const holds = reservations(w);
  assert.equal(holds.length, 1);
  assert.equal(holds[0].status, 'settled');
  assert.ok(holds[0].actual_included_microusd + holds[0].actual_topup_microusd > 0);
  const logs = usage(w).filter((r: any) => r.task === 'transcribe');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].reservation_uid, holds[0].uid);
  assert.equal(logs[0].charged_microusd, holds[0].actual_included_microusd + holds[0].actual_topup_microusd);
  // Replay consumes neither another hold nor another transcription.
  const g = mockFetch(telegramApi);
  try { await run(w); assert.equal(fileCalls(g).length, 0); } finally { g.restore(); }
  assert.deepEqual(reservations(w), holds);
  w.db.close();
}

async function refusals() {
  for (const reason of ['too_large', 'video_note_unsupported', 'transcription_cap', 'budget_spent']) {
    const w = await assigned();
    await consentGiven(w.env, w.db, w.thread);
    if (reason === 'transcription_cap') {
      const integration = w.db.prepare("SELECT id FROM integrations WHERE uid = 'tg-me'").get().id;
      w.db.prepare("INSERT INTO channel_counters (integration_id, counter, window_start, n) VALUES (?, 'transcriptions_day', date('now'), ?)")
        .run(integration, CHANNEL_LIMITS.transcriptionsPerDay);
    }
    if (reason === 'budget_spent') setFixtureAllowance(w.db, 0);
    const media = reason === 'video_note_unsupported' ? { video_note: { file_id: 'SYNTHETIC', file_size: 4000, duration: 4, length: 384 } }
      : { voice: { file_id: 'SYNTHETIC', file_size: reason === 'too_large' ? CAP + 1 : 4000, mime_type: 'audio/ogg' } };
    const f = mockFetch(telegramApi);
    try {
      await sendNote(w, media); await run(w);
      assert.equal(fileCalls(f).length, reason === 'too_large' || reason === 'video_note_unsupported' ? 0 : 2);
    } finally { f.restore(); }
    assert.equal(w.aiCalls.length, 0);
    assert.deepEqual(reservations(w), []);
    assert.equal(usage(w).filter((r: any) => r.charged_microusd > 0).length, 0);
    const detail = await call(w.env, ME, 'GET', `/threads/${w.thread}`);
    const message = detail.body.messages.find((m: any) => m.awaiting_transcription);
    assert.ok(message.transcription_failure.sentence);
    assert.equal(message.transcription_failure.reason, reason === 'transcription_cap' ? 'daily_cap' : reason === 'budget_spent' ? 'budget' : reason);
    if (reason === 'too_large') assert.match(message.transcription_failure.sentence, /5 MB/);
    w.db.close();
  }
}

test('D865: inclusive cap, declared size, metadata size and bounded body', () => admission());
test('D865: round videos are refused before lookup', async () => { assert.equal(TELEGRAM_VIDEO_NOTES, false); await roundVideo(); });
test('D865: consent withdrawal is rechecked before download', () => consentGate());
test('D865: a held note downloads nothing until the contact has said YES', () => heldBeforeYes());
test('D865: Spanish voice, audio file and audio document each keep the original and reserve/settle AI tokens', async () => {
  for (const kind of ['voice', 'audio', 'document']) await meteredSpeech({ [kind]: { file_id: 'SYNTHETIC', mime_type: 'audio/ogg', file_size: 4000 } });
});
test('D865: media, daily-cap and budget refusals explain why and charge nothing', {timeout: 15000}, () => refusals());

const FR = 'Nous faisons une expérience avec les messages pour le test.';
const ES = 'Hola, hacemos una prueba con los mensajes para el test.';
const EN = 'This is the synthetic test message and we use it for the test.';
const TRANSLATED: Record<string, string> = {
  [FR]: 'We run an experiment with messages for the test.',
  [ES]: 'Hello, we run a test with messages for the test.',
};
const segments = (w: any) => w.db.prepare('SELECT * FROM interview_transcript_segments WHERE session_id = ? ORDER BY id').all(w.sessionId);
const translationLogs = (w: any) => usage(w).filter((r: any) => r.task === 'translate_segment');
function translatedAI(w: any, fail = false) {
  const original = w.env.AI.run;
  const calls: any[] = [];
  w.env.AI.run = async (model: string, input: any) => {
    if (model !== TRANSLATION_MODEL) return original(model, input);
    const pending = reservations(w).filter((r: any) => r.status === 'pending');
    assert.equal(pending.length, 1, 'translation is held before running');
    calls.push(input);
    if (fail) throw new Error('synthetic upstream refusal');
    return { translated_text: TRANSLATED[input.text] };
  };
  return calls;
}
function workingEnglish(w: any) {
  w.db.exec("CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY, validate_working_lang TEXT, locale TEXT)");
  w.db.prepare("INSERT INTO user_settings VALUES (?, 'en', 'fr')").run(ME);
}
async function translationPath(runStructure = structureSession, translateOverride?: typeof translateSession) {
  const w = await assigned(FR, 'de');
  workingEnglish(w);
  await consentGiven(w.env, w.db, w.thread);
  const original = w.env.AI.run;
  w.env.AI.run = async (model: string, input: any) => model === DEFAULT_FINAL_MODEL
    ? { text: ES, transcription_info: { language: 'es' } } : original(model, input);
  const calls = translatedAI(w);
  const f = mockFetch(telegramApi);
  try {
    await sendNote(w); await run(w);
    assert.equal(w.queued.some((j: any) => j.job_type === 'session_structure'), true, 'the note queues the shared engine');
    if (translateOverride) await translateOverride(w.env, { sessionId: w.sessionId, userId: ME });
    else await runStructure(w.env, { sessionId: w.sessionId, userId: ME, trigger: 'voice_note_added' });
    const rows = segments(w);
    assert.deepEqual(rows.map((r: any) => [r.text, r.source_lang, r.translated_lang, r.translation_status]), [[FR, 'fr', 'en', 'done'], [ES, 'es', 'en', 'done']]);
    assert.deepEqual(calls.map((c: any) => [c.text, c.source_lang, c.target_lang]), [[FR, 'fr', 'en'], [ES, 'es', 'en']]);
    for (const r of rows) {
      assert.notEqual(r.translated_text, TRANSLATED[r.text], 'translation is encrypted at rest');
      assert.equal(await readTranslation(w.env, r.id, r.translated_text), TRANSLATED[r.text]);
      const log = translationLogs(w).find((l: any) => l.reservation_uid === r.translation_reservation_uid);
      assert.ok(log, 'the segment names its metered translation');
      const hold = reservations(w).find((h: any) => h.uid === log.reservation_uid);
      assert.equal(hold.status, 'settled');
      assert.equal(log.charged_microusd, hold.actual_included_microusd + hold.actual_topup_microusd);
    }
    assert.equal(translationLogs(w).length, 2);
    const prior = reservations(w).length;
    assert.deepEqual(await translateSession(w.env, { sessionId: w.sessionId, userId: ME }), { translated: 0, same: 0, pending: 0, undetected: 0, stopped: null });
    assert.equal(reservations(w).length, prior, 'replaying translations creates no new hold');
  } finally { f.restore(); w.db.close(); }
}
async function sameLanguage(translate = translateSession) {
  const w = await assigned(EN, 'fr');workingEnglish(w);
  try {
    const calls = translatedAI(w);
    const pass = await translate(w.env, { sessionId: w.sessionId, userId: ME });
    assert.equal(pass.same, 1);
    const [row] = segments(w);
    assert.deepEqual([row.text, row.source_lang, row.translation_status, row.translated_text], [EN, 'en', 'same', null]);
    assert.equal(calls.length, 0);assert.deepEqual(reservations(w), []);assert.deepEqual(usage(w), []);
  } finally { w.db.close(); }
}
async function translationFailure(translate = translateSession) {
  const w = await assigned(FR);workingEnglish(w);
  try {
    translatedAI(w, true);
    const pass = await translate(w.env, { sessionId: w.sessionId, userId: ME });
    assert.equal(pass.pending, 1);
    const [row] = segments(w);
    assert.deepEqual([row.text, row.source_lang, row.translation_status, row.translated_text], [FR, 'fr', 'pending', null]);
    assert.equal(translationLogs(w).filter((l: any) => l.charged_microusd > 0).length, 0);
    assert.equal(reservations(w).every((h: any) => h.status !== 'pending'), true, 'failed translation releases its hold');
    translatedAI(w);
    assert.equal((await translate(w.env, { sessionId: w.sessionId, userId: ME })).translated, 1);
    assert.equal(await readTranslation(w.env, row.id, segments(w)[0].translated_text), TRANSLATED[FR]);
  } finally { w.db.close(); }
}
async function translationRefusal(translate = translateSession) {
  const w = await assigned(FR);workingEnglish(w);setFixtureAllowance(w.db, 0);
  try {
    const calls = translatedAI(w);
    const pass = await translate(w.env, { sessionId: w.sessionId, userId: ME });
    assert.equal(pass.pending, 1);assert.ok(pass.stopped);
    assert.equal(calls.length, 0);assert.deepEqual(reservations(w), []);
    const [row] = segments(w);assert.deepEqual([row.text, row.translated_text, row.translation_status], [FR, null, 'pending']);
  } finally { w.db.close(); }
}
async function limitationCopy(pages = CHANNEL_PAGES) {
  assert.match(pages.telegram.long_description.join(' '), /files over 5 MB, round videos for now.*audio track as an audio file up to 5 MB/);
}
test('D865: Telegram French text and Spanish note pass through D857 before structuring; app language never becomes source_lang', {timeout: 15000}, () => translationPath());
test('D865: working-language Telegram text is free despite a conflicting app language', () => sameLanguage());
test('D865: failed translation preserves original, releases its hold and can retry', {timeout: 15000}, () => translationFailure());
test('D865: budget refusal keeps the original usable and never runs translation', () => translationRefusal());
test('D865: the connector explains the audio-file alternative to round videos', () => limitationCopy());

// Import isolated mutated modules, leaving tracked files unchanged. Route
// imports register queue handlers, so always restore those handlers in finally.
let mutantId = 0;
async function variant(path: string, before = '', after = '') {
  const file = new URL(path, import.meta.url);
  const original = readFileSync(file, 'utf8');
  if (before) assert.ok(original.includes(before), 'mutation target exists');
  let source = stripTypeScriptTypes(before ? original.replace(before, () => after) : original, { mode: 'strip' });
  source = source.replace(/^((?:import\s+[^'";]+|export\s*\{[^}]*\})\s+from\s*['"])([^'"]+)(['"])/gm,
    (_m, prefix, spec, quote) => prefix + (spec.startsWith('.')
      ? new URL(/\.[mc]?[jt]s$/.test(spec) ? spec : spec + '.ts', file).href : import.meta.resolve(spec)) + quote);
  return import('data:text/javascript;base64,' + Buffer.from(source + '\n// D865 variant ' + ++mutantId).toString('base64'));
}
const adapter = '../src/services/channels/telegram.ts';
for (const [name, before, after] of [
  ['exclude exact cap', 'note.size > CHANNEL_AUDIO_MAX_BYTES', 'note.size >= CHANNEL_AUDIO_MAX_BYTES'],
  ['ignore declared size', 'note.size > CHANNEL_AUDIO_MAX_BYTES', 'false'],
  ['ignore metadata size', 'size > CHANNEL_AUDIO_MAX_BYTES', 'false'],
  ['raise stream cap', 'maxBytes: CHANNEL_AUDIO_MAX_BYTES', 'maxBytes: 20 * 1024 * 1024'],
]) test('D865 mutation: ' + name, async () => {
  await admission();
  const m = await variant(adapter, before, after);
  await assert.rejects(() => admission(m.fetchTelegramVoice), { name: 'AssertionError' });
  await admission();
});
test('D865 mutation: enabling round video alone still fails MIME admission', async () => {
  await roundVideo();
  const m = await variant(adapter, 'export const TELEGRAM_VIDEO_NOTES = false;', 'export const TELEGRAM_VIDEO_NOTES = true;');
  await assert.rejects(() => roundVideo(m.fetchTelegramVoice), { name: 'AssertionError' });
  await roundVideo(m.fetchTelegramVoice, true);
  await roundVideo();
});
test('D865 mutation: removing job consent recheck permits a forbidden download', async () => {
  await consentGate();
  const route = '../src/routes/channels.ts';
  try {
    await variant(route, "if (audioConsentRequired(provider) && note.thread.consent_state !== 'given') {", 'if (false) {');
    await assert.rejects(() => consentGate(), { name: 'AssertionError' });
  } finally { await variant(route); }
  await consentGate();
});

const translationSource = '../src/services/sessionTranslation.ts';
for (const [name, before, after, verify] of [
  ['skip working-language free path', 'if (lang === target) {', 'if (false) {', sameLanguage],
  ['replace detected language with app preference', 'let lang = primaryLang(row.source_lang);', "let lang = 'de';", (translate: typeof translateSession) => translationPath(structureSession, translate)],
  ['discard original text', 'SET source_lang = ?, translated_text = ?', "SET text = '', source_lang = ?, translated_text = ?", (translate: typeof translateSession) => translationPath(structureSession, translate)],
  ['store translation in plaintext', "await encryptColumn(env, SEGMENT_TABLE, 'translated_text', row.id, translated)", 'translated', (translate: typeof translateSession) => translationPath(structureSession, translate)],
  ['drop ledger reference', 'target, r.usage?.model || model, reservation, row.id', 'target, r.usage?.model || model, null, row.id', (translate: typeof translateSession) => translationPath(structureSession, translate)],
  ['turn failure into success', "translation_status = 'pending', translation_attempts", "translation_status = 'done', translation_attempts", translationFailure],
  ['mark refusal as undetected', 'out.pending += Number(written.meta?.changes ?? 0);', 'out.undetected += Number(written.meta?.changes ?? 0);', translationRefusal],
] as const) test('D865 mutation: ' + name, async () => {
  await verify(translateSession);
  const m = await variant(translationSource, before, after);
  await assert.rejects(() => verify(m.translateSession), { name: 'AssertionError' });
  await verify(translateSession);
});
test('D865 mutation: structuring must invoke the shared translation pass', async () => {
  await translationPath();
  const m = await variant('../src/services/sessionAutoStructure.ts', 'await translateSession(env, { sessionId: session.id, userId: opts.userId, rail });', '');
  await assert.rejects(() => translationPath(m.structureSession), { name: 'AssertionError' });
  await translationPath();
});
test('D865 mutation: removing the connector workaround fails the copy check', async () => {
  await limitationCopy();
  const m = await variant('../src/integrations/connectorPages.ts', 'For a round video, send its audio track as an audio file up to 5 MB instead.', '');
  await assert.rejects(() => limitationCopy(m.CHANNEL_PAGES), { name: 'AssertionError' });
  await limitationCopy();
});

test('D865 mutation: the daily voice cap must stop the model', async () => {
  await refusals();
  try {
    await variant('../src/routes/channels.ts', 'if (!(await reserveTranscription(env, conn.integrationId)))', 'if (false)');
    await assert.rejects(() => refusals(), { name: 'AssertionError' });
  } finally { await variant('../src/routes/channels.ts'); }
  await refusals();
});
