/** D867: synthetic media and identifiers only; real SQLite, recorder and queue dispatch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureItems, CAPTURE_COPY, importCapture } from '../src/services/channels/telegramCapture.ts';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import { runInterviewProcessJob } from '../src/services/interviewProcessing.ts';
import { purgeExpired } from '../src/services/channels/threads.ts';
import { decryptColumn } from '../src/services/columnCipher.ts';
import {
  AUDIO, ME, PROJECT, TG_ME, TG_OTHER, ids, mockFetch, noSecretsSeen, seen,
  telegramApi, tgHook, world as baseWorld,
} from './_channels_fixture.ts';

test.afterEach(() => { noSecretsSeen(); seen.length = 0; });
const captures = (db: any) => db.prepare('SELECT * FROM telegram_captures ORDER BY id').all();
const consents = (db: any) => db.prepare("SELECT * FROM channel_consents WHERE provider = 'telegram'").all();
const jobs = (w: any) => w.queued.filter((q: any) => q.job_type === 'channel_followup' && q.payload.kind === 'capture');
const fetched = (f: any) => f.calls.filter((c: any) => /\/getFile$|\/file\/bot/.test(c.url)).length;
const sent = (f: any) => f.calls.filter((c: any) => c.url.endsWith('/sendMessage')).map((c: any) => c.body);
async function world() {
  const w = await baseWorld({ seed: true });
  w.env.TELEGRAM_CAPTURE = 'on';
  w.db.exec("ALTER TABLE projects ADD COLUMN updated_at TEXT; UPDATE projects SET updated_at = CURRENT_TIMESTAMP;");
  // A private forward needs the proven link, never Telegram Business.
  w.db.exec('DELETE FROM telegram_business_connections');
  return w;
}
function message(body: Record<string, unknown>, who = TG_ME, extra: Record<string, unknown> = {}) {
  return { update_id: ++ids.update, message: { message_id: ++ids.message, date: Math.floor(Date.now() / 1000),
    chat: { id: Number(who), type: 'private' }, from: { id: Number(who), is_bot: false }, ...body, ...extra } };
}
const voice = (size = 64) => message({ voice: { file_id: 'synthetic-file', mime_type: 'audio/ogg', file_size: size }, forward_origin: { type: 'hidden_user' } });
const answer = (text = 'Yes, out loud', replyTo?: number) => message({ text, ...(replyTo ? { reply_to_message: { message_id: replyTo } } : {}) });
const run = (w: any) => runChannelJob(w.env, 'channel_followup', jobs(w).at(-1).payload);

test('forwarded notes are encrypted and held, one ordinary-text reply keyboard; replay and bad AAD keep nothing extra', async () => {
  const w = await world();
  const f = mockFetch(telegramApi);
  try {
    const first = voice();
    await tgHook(w.env, first);
    await tgHook(w.env, first);
    await tgHook(w.env, voice());
    const [cap] = captures(w.db);
    assert.deepEqual([captures(w.db).length, cap.item_count, cap.status, cap.user_id, cap.project_id], [1, 2, 'waiting', ME, PROJECT]);
    assert.equal(cap.media_refs_enc.includes('synthetic-file'), false);
    assert.deepEqual((await captureItems(w.env, cap))!.map((i) => [i.id, i.mime, i.size]), [['synthetic-file', 'audio/ogg', 64], ['synthetic-file', 'audio/ogg', 64]]);
    assert.equal(await decryptColumn(w.env, 'telegram_captures', 'media_refs_enc', 'wrong-row', cap.media_refs_enc), null);
    assert.deepEqual(sent(f).map((b: any) => b.reply_markup), [{ keyboard: [[{ text: 'Yes, out loud' }], [{ text: 'Yes, in writing' }], [{ text: 'No' }]], one_time_keyboard: true, resize_keyboard: true }]);
    assert.deepEqual(await importCapture(w.env, cap.uid, 'synthetic-held-control'), { done: 'nothing' });
    assert.deepEqual([fetched(f), w.r2.objects.size, w.aiCalls.length, jobs(w).length, consents(w.db).length], [0, 0, 0, 0, 0]);
  } finally { f.restore(); }
});

for (const [text, method] of [['Yes, out loud', 'verbal'], ['Yes, in writing', 'written']]) {
  test(`${text} imports recorder audio once and transcribes through the metered recorder`, async () => {
    const w = await world();
    const f = mockFetch(telegramApi);
    try {
      await tgHook(w.env, voice());
      await tgHook(w.env, answer(text));
      const [c] = consents(w.db);
      assert.deepEqual([c.source, c.method, c.status, c.user_id, c.capture_id], ['member_attested', method, 'given', ME, captures(w.db)[0].id]);
      assert.deepEqual([fetched(f), jobs(w).length], [0, 1]);
      await Promise.all([run(w), run(w)]);
      const cap = captures(w.db)[0];
      const session = w.db.prepare('SELECT * FROM interview_sessions WHERE id = ?').get(cap.session_id);
      assert.deepEqual([cap.status, cap.media_refs_enc, !!cap.answered_at, !!cap.imported_at], ['imported', null, true, true]);
      assert.deepEqual([session.channel, session.submitted_via, session.consent_status, session.consent_method, session.project_id, session.created_by_user_id], ['in_person', 'telegram', 'given', method, PROJECT, ME]);
      assert.deepEqual([w.r2.objects.size, fetched(f), sent(f).filter((s: any) => s.text === CAPTURE_COPY.saved).length], [1, 2, 1]);
      const chunk = w.db.prepare('SELECT * FROM interview_session_chunks WHERE session_id = ?').get(session.id);
      assert.deepEqual([chunk.seq, chunk.mime, chunk.size_bytes], [0, 'audio/ogg', AUDIO.OGG.byteLength]);
      assert.match(chunk.r2_key, new RegExp(`^validate-audio/${ME}/sessions/${session.uid}/`));
      assert.equal(consents(w.db)[0].session_id, session.id);
      const processing = w.queued.find((q: any) => q.job_type === 'interview_process');
      assert.ok(processing, 'the recorder processing job exists');
      // Manual finishing stops after transcription, so this checks speech without unrelated proposals.
      w.db.prepare('UPDATE interview_sessions SET processing_auto = 0 WHERE id = ?').run(session.id);
      assert.equal(await runInterviewProcessJob(w.env, processing.payload), 'done');
      assert.equal(w.aiCalls.length, 1);
      assert.ok(w.db.prepare('SELECT text FROM interview_transcript_segments WHERE session_id = ?').get(session.id)?.text);
      const log = w.db.prepare("SELECT reservation_uid, charged_microusd FROM ai_usage_logs WHERE user_id = ? AND task = 'transcribe'").get(ME);
      assert.ok(log?.reservation_uid);
      const hold = w.db.prepare('SELECT * FROM ai_budget_reservations WHERE uid = ?').get(log.reservation_uid);
      assert.equal(hold.status, 'settled');
      assert.ok(log.charged_microusd > 0);
      assert.equal(log.charged_microusd, hold.actual_included_microusd + hold.actual_topup_microusd);
      await run(w);
      assert.deepEqual([w.r2.objects.size, fetched(f), sent(f).filter((s: any) => s.text === CAPTURE_COPY.saved).length], [1, 2, 1]);
    } finally { f.restore(); }
  });
}

test('No deletes the waiting capture without a download or consent; another sender cannot answer it', async () => {
  const w = await world();
  const f = mockFetch(telegramApi);
  try {
    await tgHook(w.env, voice());
    await tgHook(w.env, message({ text: 'Yes, out loud' }, TG_OTHER));
    assert.deepEqual([captures(w.db)[0].status, consents(w.db).length], ['waiting', 0]);
    assert.equal(sent(f).at(-1).text, CAPTURE_COPY.unlinked);
    const no = answer('No');
    await tgHook(w.env, no);
    await tgHook(w.env, no);
    assert.deepEqual([captures(w.db).length, consents(w.db).length, fetched(f), jobs(w).length], [0, 0, 0, 0]);
    assert.equal(sent(f).filter((s: any) => s.text === CAPTURE_COPY.declined).length, 1);
  } finally { f.restore(); }
});

test('unlinked media gets link instructions; groups, bots and mismatched private sender are ignored', async () => {
  const w = await world();
  const f = mockFetch(telegramApi);
  try {
    await tgHook(w.env, message({ voice: { file_id: 'synthetic-file' } }, TG_OTHER));
    assert.equal(sent(f).at(-1).text, CAPTURE_COPY.unlinked);
    await tgHook(w.env, message({ voice: { file_id: 'synthetic-file' } }, TG_ME, { chat: { id: Number(TG_ME), type: 'group' } }));
    await tgHook(w.env, message({ voice: { file_id: 'synthetic-file' } }, TG_ME, { from: { id: Number(TG_ME), is_bot: true } }));
    await tgHook(w.env, message({ voice: { file_id: 'synthetic-file' } }, TG_ME, { from: { id: Number(TG_OTHER) } }));
    assert.deepEqual([captures(w.db).length, fetched(f), sent(f).length, w.r2.objects.size], [0, 0, 1, 0]);
  } finally { f.restore(); }
});

test('5 MB cap and format checks happen before storage/download; audio documents and files are admitted', async () => {
  const w = await world();
  const f = mockFetch(telegramApi);
  try {
    await tgHook(w.env, voice(5 * 1024 * 1024 + 1));
    assert.equal(sent(f).at(-1).text, CAPTURE_COPY.tooLarge);
    await tgHook(w.env, message({ document: { file_id: 'synthetic-file', mime_type: 'application/pdf' } }));
    await tgHook(w.env, message({ video_note: { file_id: 'synthetic-file' } }));
    assert.deepEqual([captures(w.db).length, fetched(f)], [0, 0]);
    await tgHook(w.env, message({ document: { file_id: 'synthetic-file', mime_type: 'audio/x-m4a' } }));
    await tgHook(w.env, message({ audio: { file_id: 'synthetic-file', mime_type: 'audio/ogg' } }));
    assert.equal(captures(w.db)[0].item_count, 2);
  } finally { f.restore(); }
});

test('purge expires waiting and consented captures without deleting another provider consent with the same capture_id', async () => {
  const w = await world();
  const f = mockFetch(telegramApi);
  try {
    await tgHook(w.env, voice());
    await tgHook(w.env, answer());
    await tgHook(w.env, voice());
    const cap = captures(w.db)[0];
    w.db.prepare(`INSERT INTO channel_consents (uid, user_id, provider, capture_id, source, method, status, answered_at)
      VALUES ('synthetic-wa-consent', ?, 'whatsapp', ?, 'member_attested', 'written', 'given', CURRENT_TIMESTAMP)`).run(ME, cap.id);
    w.db.prepare('UPDATE telegram_captures SET fetch_by = ?').run(new Date(Date.now() - 1000).toISOString());
    assert.equal((await purgeExpired(w.env)).captures, 2);
    assert.deepEqual([captures(w.db).length, consents(w.db).length], [0, 0]);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM channel_consents').get().n, 1);
    assert.equal(fetched(f), 0);
  } finally { f.restore(); }
});

test('WhatsApp purge also preserves Telegram consent on a colliding capture_id', async () => {
  const w = await world();
  const f = mockFetch(telegramApi);
  try {
    await tgHook(w.env, voice()); await tgHook(w.env, answer());
    const cap = captures(w.db)[0];
    w.db.prepare(`INSERT INTO whatsapp_captures (id, uid, user_id, integration_id, status, fetch_by)
      VALUES (?, 'synthetic-wa', ?, ?, 'waiting', '2020-01-01T00:00:00.000Z')`).run(cap.id, ME, cap.integration_id);
    await purgeExpired(w.env);
    assert.deepEqual([consents(w.db).length, captures(w.db)[0].status], [1, 'consented']);
  } finally { f.restore(); }
});

test('off, absent and unknown flags block forwards and queued imports; canary blocks ordinary members', async () => {
  const w = await world();
  const f = mockFetch(telegramApi);
  try {
    for (const flag of ['off', undefined, 'unknown']) {
      w.env.TELEGRAM_CAPTURE = flag;
      await tgHook(w.env, voice());
      assert.deepEqual([captures(w.db).length, fetched(f), sent(f).length], [0, 0, 0]);
    }
    w.env.TELEGRAM_CAPTURE = 'on';
    w.env.TELEGRAM_CHANNEL = 'canary';
    await tgHook(w.env, voice());
    assert.equal(captures(w.db).length, 0);
    w.env.TELEGRAM_CHANNEL = 'on';
    await tgHook(w.env, voice()); await tgHook(w.env, answer());
    w.env.TELEGRAM_CAPTURE = 'off';
    await run(w);
    assert.deepEqual([fetched(f), w.r2.objects.size], [0, 0]);
    const config = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
    assert.equal((config.match(/^TELEGRAM_CAPTURE = "off"$/gm) ?? []).length, 3);
  } finally { f.restore(); }
});

test('ended links, inactive members and withdrawn consent block queued download', async () => {
  for (const change of ["UPDATE integrations SET status = 'disconnected'", 'UPDATE users SET is_active = 0', "UPDATE channel_consents SET status = 'declined'"]) {
    const w = await world();
    const f = mockFetch(telegramApi);
    try {
      await tgHook(w.env, voice()); await tgHook(w.env, answer());
      w.db.exec(change);
      await run(w);
      assert.deepEqual([fetched(f), w.r2.objects.size, w.aiCalls.length], [0, 0, 0]);
    } finally { f.restore(); }
  }
});

test('item/window bounds open another capture; ambiguous bare answers cannot attest multiple captures', async () => {
  const w = await world();
  let promptId = 10000;
  const f = mockFetch((url, init) => url.pathname.endsWith('/sendMessage')
    ? { json: { ok: true, result: { message_id: ++promptId } } } : telegramApi(url, init));
  try {
    await Promise.all([tgHook(w.env, voice()), tgHook(w.env, voice())]);
    assert.deepEqual(captures(w.db).map((c: any) => c.item_count), [2]);
    for (let i = 0; i < 19; i++) await tgHook(w.env, voice());
    assert.deepEqual(captures(w.db).map((c: any) => c.item_count), [20, 1]);
    await tgHook(w.env, answer());
    assert.equal(consents(w.db).length, 0);
    await tgHook(w.env, answer('Yes, in writing', 10001));
    assert.equal(consents(w.db)[0].capture_id, captures(w.db)[0].id);
    w.db.prepare('UPDATE telegram_captures SET created_at = ? WHERE status = ?').run(new Date(Date.now() - 31 * 60000).toISOString(), 'waiting');
    await tgHook(w.env, voice());
    assert.deepEqual(captures(w.db).map((c: any) => c.item_count), [20, 1, 1]);
  } finally { f.restore(); }
});

test('queue failure after YES is recoverable on webhook redelivery, without duplicate consent', async () => {
  const w = await world();
  const f = mockFetch(telegramApi);
  try {
    await tgHook(w.env, voice());
    const save = w.env.JOB_QUEUE.send;
    w.env.JOB_QUEUE.send = async () => { throw new Error('synthetic failure'); };
    const yes = answer();
    assert.equal((await tgHook(w.env, yes)).status, 500);
    w.env.JOB_QUEUE.send = save;
    assert.equal((await tgHook(w.env, yes)).status, 200);
    assert.deepEqual([consents(w.db).length, jobs(w).length, fetched(f)], [1, 1, 0]);
  } finally { f.restore(); }
});

test('getFile size, container mismatch and temporary failure are bounded and retry-safe', async () => {
  for (const mode of ['large', 'junk', 'temporary']) {
    const w = await world();
    let failed = false;
    const f = mockFetch((url, init) => {
      if (url.pathname.endsWith('/getFile') && mode === 'large') return { json: { ok: true, result: { file_size: 6 * 1024 * 1024, file_path: 'synthetic.ogg' } } };
      if (url.pathname.startsWith('/file/bot') && mode === 'junk') return { body: AUDIO.JUNK };
      if (url.pathname.endsWith('/getFile') && mode === 'temporary' && !failed) { failed = true; return { status: 503, json: { ok: false, error_code: 503 } }; }
      return telegramApi(url, init);
    });
    try {
      await tgHook(w.env, voice()); await tgHook(w.env, answer());
      await run(w);
      if (mode === 'temporary') {
        assert.equal(jobs(w).length, 2);
        await run(w);
        assert.deepEqual([captures(w.db)[0].status, w.r2.objects.size], ['imported', 1]);
      } else {
        assert.deepEqual([captures(w.db)[0].status, !!captures(w.db)[0].import_error, w.r2.objects.size], ['consented', true, 0]);
        assert.equal(w.db.prepare('SELECT COUNT(*) n FROM interview_sessions').get().n, 0);
        const calls = fetched(f);
        await importCapture(w.env, captures(w.db)[0].uid, 'synthetic-job');
        assert.equal(fetched(f), calls);
      }
    } finally { f.restore(); }
  }
});

test('relinking the integration cannot attest or import the previous account capture', async () => {
  const w = await world(); const f = mockFetch(telegramApi);
  try {
    await tgHook(w.env, voice()); const old = captures(w.db)[0];
    w.db.prepare("UPDATE integrations SET external_account_id = ? WHERE id = ?").run(TG_OTHER, old.integration_id);
    await tgHook(w.env, message({ text: 'Yes, out loud' }, TG_OTHER));
    assert.equal(consents(w.db).length, 0);
    assert.equal(captures(w.db)[0].status, 'waiting');
    w.db.prepare("UPDATE integrations SET external_account_id = ? WHERE id = ?").run(TG_ME, old.integration_id);
    await tgHook(w.env, answer());
    w.db.prepare("UPDATE integrations SET external_account_id = ? WHERE id = ?").run(TG_OTHER, old.integration_id);
    await run(w);
    assert.deepEqual([fetched(f), w.r2.objects.size, w.aiCalls.length], [0, 0, 0]);
    assert.equal(sent(f).filter((s: any) => s.text === CAPTURE_COPY.saved).length, 0);
  } finally { f.restore(); w.db.close(); }
});

test('revoked consent during download stores no audio and removes the partial draft', async () => {
  const w = await world();
  const put = w.r2.put;
  w.r2.put = async (key: string, value: ArrayBuffer, opts: any) => {
    assert.equal(consents(w.db)[0]?.status, 'given', 'storage rechecks consent after a download');
    return put(key, value, opts);
  };
  const f = mockFetch((url, init) => {
    if (url.pathname.startsWith('/file/bot')) w.db.prepare("UPDATE channel_consents SET status = 'declined' WHERE provider = 'telegram'").run();
    return telegramApi(url, init);
  });
  try {
    await tgHook(w.env, voice()); await tgHook(w.env, answer()); await run(w);
    assert.deepEqual([w.r2.objects.size, w.aiCalls.length, captures(w.db)[0].status], [0, 0, 'consented']);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM interview_sessions').get().n, 0);
    assert.equal(sent(f).filter((s: any) => s.text === CAPTURE_COPY.saved).length, 0);
  } finally { f.restore(); w.db.close(); }
});

test('an import refusal explains the metadata size cap once, without keeping a draft', async () => {
  const w = await world();
  const f = mockFetch((url, init) => url.pathname.endsWith('/getFile')
    ? { json: { ok: true, result: { file_size: 6 * 1024 * 1024, file_path: 'synthetic.ogg' } } } : telegramApi(url, init));
  try {
    await tgHook(w.env, voice()); await tgHook(w.env, answer()); await run(w); await run(w);
    assert.equal(sent(f).filter((s: any) => s.text === CAPTURE_COPY.tooLarge).length, 1);
    assert.equal(sent(f).filter((s: any) => s.text === CAPTURE_COPY.saved).length, 0);
    assert.deepEqual([w.r2.objects.size, w.aiCalls.length, captures(w.db)[0].import_error], [0, 0, 'too_large']);
  } finally { f.restore(); w.db.close(); }
});

for (const mode of ['expiry', 'exhaustion']) test(`partial audio is removed on ${mode}, with no false Saved reply`, async () => {
  const w = await world();let lookup = 0;
  const f = mockFetch((url, init) => {
    if (url.pathname.endsWith('/getFile') && ++lookup > 1) return { status: 503, json: { ok: false } };
    return telegramApi(url, init);
  });
  try {
    await tgHook(w.env, voice()); await tgHook(w.env, voice()); await tgHook(w.env, answer()); await run(w);
    assert.equal(w.r2.objects.size, 1);assert.equal(captures(w.db)[0].status, 'consented');
    if (mode === 'expiry') {
      w.db.prepare('UPDATE telegram_captures SET fetch_by = ?').run(new Date(Date.now() - 1000).toISOString());
      assert.equal((await purgeExpired(w.env)).captures, 1);
      assert.equal(captures(w.db).length, 0);
    } else {
      await run(w);await run(w);await run(w);
      assert.equal(jobs(w).length, 3);
      assert.equal(captures(w.db)[0].import_error, 'provider_unavailable');
      assert.equal(sent(f).filter((s: any) => s.text === CAPTURE_COPY.failed).length, 1);
    }
    assert.equal(w.r2.objects.size, 0);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM interview_sessions').get().n, 0);
    assert.equal(sent(f).filter((s: any) => s.text === CAPTURE_COPY.saved).length, 0);
  } finally { f.restore(); w.db.close(); }
});

test('failure after audio storage resumes on the same session without refetching', async () => {
  const w = await world();const f = mockFetch(telegramApi);
  try {
    await tgHook(w.env, voice());await tgHook(w.env, answer());
    const send = w.env.JOB_QUEUE.send;
    w.env.JOB_QUEUE.send = async (body: any, opts: any) => {
      if (body.job_type === 'interview_process') throw new Error('synthetic queue failure');
      return send(body, opts);
    };
    await assert.rejects(() => run(w), /synthetic queue failure/);
    const sessionId = captures(w.db)[0].session_id;
    assert.equal(w.r2.objects.size, 1);
    w.env.JOB_QUEUE.send = send;
    await run(w);
    assert.deepEqual([captures(w.db)[0].session_id, captures(w.db)[0].status, fetched(f)], [sessionId, 'imported', 2]);
    assert.equal(w.db.prepare('SELECT COUNT(*) n FROM discovery_interviews').get().n, 2);
    assert.equal(sent(f).filter((s: any) => s.text === CAPTURE_COPY.saved).length, 1);
  } finally { f.restore(); w.db.close(); }
});

test('an unrelated reply cannot select one of several waiting captures', async () => {
  const w = await world();let prompt = 11000;
  const f = mockFetch((url, init) => url.pathname.endsWith('/sendMessage')
    ? { json: { ok: true, result: { message_id: ++prompt } } } : telegramApi(url, init));
  try {
    await tgHook(w.env, voice());
    w.db.prepare("UPDATE telegram_captures SET created_at = '2020-01-01T00:00:00.000Z'").run();
    await tgHook(w.env, voice());await tgHook(w.env, answer('Yes, out loud', 99999));
    assert.equal(consents(w.db).length, 0);
    assert.deepEqual(captures(w.db).map((c: any) => c.status), ['waiting', 'waiting']);
  } finally { f.restore(); w.db.close(); }
});

test('a WhatsApp consent cannot authorize a Telegram capture', async () => {
  const w = await world();const f = mockFetch(telegramApi);
  try {
    await tgHook(w.env, voice());await tgHook(w.env, answer());const cap = captures(w.db)[0];
    const c = w.db.prepare(`INSERT INTO channel_consents (uid, user_id, provider, capture_id, source, method, status, answered_at)
      VALUES ('synthetic-wrong-provider', ?, 'whatsapp', ?, 'member_attested', 'written', 'given', CURRENT_TIMESTAMP) RETURNING id`).get(ME, cap.id);
    w.db.prepare('UPDATE telegram_captures SET consent_id = ? WHERE id = ?').run(c.id, cap.id);
    await run(w);
    assert.deepEqual([fetched(f), w.r2.objects.size, w.aiCalls.length], [0, 0, 0]);
  } finally { f.restore(); w.db.close(); }
});

test('expiry preserves an imported session, its consent and its recorded audio', async () => {
  const w = await world();const f = mockFetch(telegramApi);
  try {
    await tgHook(w.env, voice());await tgHook(w.env, answer());await run(w);
    w.db.prepare("UPDATE telegram_captures SET fetch_by = '2020-01-01T00:00:00.000Z'").run();
    await purgeExpired(w.env);
    assert.equal(captures(w.db).length, 1);
    assert.equal(captures(w.db)[0].status, 'imported');
    assert.deepEqual([w.r2.objects.size, consents(w.db).length], [1, 1]);
  } finally { f.restore(); w.db.close(); }
});


test('expiry leaves a live import lease alone and reaps it once stale', async () => {
  const w = await world();const f = mockFetch(telegramApi);
  try {
    await tgHook(w.env, voice());await tgHook(w.env, answer());
    w.db.prepare("UPDATE telegram_captures SET fetch_by = '2020-01-01T00:00:00.000Z', import_job = 'synthetic-active'").run();
    assert.equal((await purgeExpired(w.env)).captures, 0);assert.equal(captures(w.db).length, 1);
    w.db.prepare("UPDATE telegram_captures SET updated_at = datetime('now', '-31 minutes')").run();
    assert.equal((await purgeExpired(w.env)).captures, 1);
    assert.deepEqual([captures(w.db).length, consents(w.db).length, fetched(f)], [0, 0, 0]);
  } finally { f.restore(); w.db.close(); }
});
