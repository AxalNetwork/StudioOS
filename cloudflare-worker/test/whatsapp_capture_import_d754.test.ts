/**
 * D754 way B, "Send to Axal" part 2 (#1938) — the import: once the member says
 * everyone recorded agreed, a `channel_followup` { kind: 'capture' } job fetches
 * each forwarded file with Axal's token through #1896's `boundedDownload`,
 * admits it with `admitAudio`, and stores it as a chunk of one new `in_person`
 * session in a new draft interview, then hands off to the recorder's own
 * `finishSession`. On the SQLite D1 harness, with Graph and Meta's media host
 * stubbed per media id; no model is called, and no AI binding exists.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/whatsapp_capture_import_d754.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AXAL_PNID, AXAL_TOKEN, ME, PROJECT, SENDER, call, link, mockGraph, now, waHook, world,
} from './_whatsapp_axal_fixture.ts';
import { runChannelJob } from '../src/services/channels/jobs.ts';
import { CAPTURE_COPY, CAPTURE_INTERVIEWEE, importCapture } from '../src/services/channels/whatsappCapture.ts';

let msgId = 0;
const waMessage = (message: Record<string, unknown>, from = SENDER) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '3000002', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '15550009999', phone_number_id: AXAL_PNID },
    contacts: [{ profile: { name: 'Dana Ruiz' }, wa_id: from }],
    messages: [{ from, id: `wamid.IMP${++msgId}`, timestamp: String(now()), ...message }],
  } }] }],
});
const voice = (mediaId: string) => waMessage({ type: 'audio', audio: { id: mediaId, mime_type: 'audio/ogg; codecs=opus', voice: true } });
const press = (buttonId: string) =>
  waMessage({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'x' } } });

/** An Ogg file's first bytes, and some more: the container the sniff names. */
const ogg = (n = 64) => { const b = new Uint8Array(n); b.set([0x4f, 0x67, 0x67, 0x53]); return b; };
const junk = () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

const captures = (db: any) => db.prepare('SELECT * FROM whatsapp_captures ORDER BY id').all();
const interviews = (db: any) => db.prepare('SELECT * FROM discovery_interviews ORDER BY id').all();
const sessions = (db: any) => db.prepare('SELECT * FROM interview_sessions ORDER BY id').all();
const chunks = (db: any) => db.prepare('SELECT * FROM interview_session_chunks ORDER BY session_id, seq').all();
const captureJobs = (queued: any[]) => queued.filter((q) => q.job_type === 'channel_followup' && q.payload?.kind === 'capture');
/** Run the capture's queued job, as the queue would deliver it. */
const runCapture = (env: any, queued: any[], i = -1) => runChannelJob(env, 'channel_followup', captureJobs(queued).at(i).payload);

/** Link, forward `ids` as voice notes, and press `answer` on the one capture. */
async function forwardAndAnswer(env: any, db: any, ids: string[], answer = 'verbal') {
  await link(env);
  for (const id of ids) await waHook(env, voice(id));
  await waHook(env, press(`capture_${answer}:${captures(db)[0].uid}`));
}

test('two voice notes, then "Yes, out loud": one draft interview, one session, two chunks, the recorder\'s pipeline, one "Saved"', async () => {
  const { env, db, queued, files } = world();
  const g = mockGraph({ 'MEDIA-A': { bytes: ogg(80) }, 'MEDIA-B': { bytes: ogg(96) } });
  try {
    await forwardAndAnswer(env, db, ['MEDIA-A', 'MEDIA-B']);
    assert.equal(g.fetched.length, 0, 'nothing is fetched before the job');
    assert.equal(captureJobs(queued).length, 1, 'a yes queues the import once');
    await runCapture(env, queued);

    const [iv] = interviews(db);
    assert.equal(interviews(db).length, 1);
    assert.deepEqual([iv.project_id, iv.interviewee_name], [PROJECT, CAPTURE_INTERVIEWEE]);
    const [s] = sessions(db);
    assert.equal(sessions(db).length, 1);
    assert.deepEqual(
      [s.interview_id, s.channel, s.submitted_via, s.consent_status, s.consent_method, s.status, s.created_by_user_id],
      [iv.id, 'in_person', 'whatsapp', 'given', 'verbal', 'stopped', ME],
    );
    const stored = chunks(db);
    assert.deepEqual(stored.map((c: any) => [c.seq, c.mime, c.size_bytes]), [[0, 'audio/ogg', 80], [1, 'audio/ogg', 96]]);
    for (const c of stored) {
      assert.ok(c.r2_key.startsWith(`validate-audio/${ME}/sessions/${s.uid}/`), c.r2_key);
      assert.ok(files.has(c.r2_key), 'the chunk is in R2');
    }
    // finishSession: the recorder's own hand-off, and the job it queues.
    assert.deepEqual([s.processing_stage, s.expected_last_seq, s.processing_auto, s.processing_total], ['uploading', 1, 1, 2]);
    assert.equal(queued.filter((q) => q.job_type === 'interview_process' && q.payload.session_id === s.id).length, 1);
    // Downloaded with Axal's token, from Meta's host, two lookups and two downloads.
    assert.equal(g.fetched.length, 4);
    assert.ok(g.fetched.every((f) => f.auth === `Bearer ${AXAL_TOKEN}`));
    // One "Saved" from Axal's number, to the sender.
    const saved = g.sent.filter((x) => x.text === CAPTURE_COPY.saved);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].to, SENDER);
    const [cap] = captures(db);
    assert.deepEqual([cap.status, cap.session_id, cap.media_refs_enc, cap.import_job], ['imported', s.id, null, null]);

    // Delivered again: nothing more.
    await runCapture(env, queued);
    assert.deepEqual([interviews(db).length, sessions(db).length, chunks(db).length], [1, 1, 2]);
    assert.equal(g.sent.filter((x) => x.text === CAPTURE_COPY.saved).length, 1);
    assert.equal(g.fetched.length, 4);
  } finally { g.restore(); }
});

test('"No": the capture is deleted, nothing is downloaded, and Axal answers once', async () => {
  const { env, db, queued } = world();
  const g = mockGraph({ 'MEDIA-A': { bytes: ogg() } });
  try {
    await forwardAndAnswer(env, db, ['MEDIA-A'], 'no');
    assert.equal(captures(db).length, 0);
    assert.equal(captureJobs(queued).length, 0);
    assert.equal(g.fetched.length, 0);
    assert.deepEqual(g.sent.filter((x) => x.text === CAPTURE_COPY.declined).map((x) => x.to), [SENDER]);
    assert.equal(interviews(db).length, 0);
  } finally { g.restore(); }
});

test('no answer by fetch_by: a consented capture past it imports nothing and downloads nothing', async () => {
  const { env, db, queued } = world();
  const g = mockGraph({ 'MEDIA-A': { bytes: ogg() } });
  try {
    await forwardAndAnswer(env, db, ['MEDIA-A']);
    db.prepare("UPDATE whatsapp_captures SET fetch_by = '2020-01-01T00:00:00.000Z'").run();
    await runCapture(env, queued);
    assert.deepEqual([g.fetched.length, interviews(db).length, sessions(db).length], [0, 0, 0]);
  } finally { g.restore(); }
});

test('a file Graph declares over 5 MB is refused before its download, and the draft is removed', async () => {
  const { env, db, queued, files } = world();
  const g = mockGraph({ 'MEDIA-A': { bytes: ogg() }, 'MEDIA-B': { bytes: ogg(), size: 6 * 1024 * 1024 } });
  try {
    await forwardAndAnswer(env, db, ['MEDIA-A', 'MEDIA-B']);
    await runCapture(env, queued);
    const downloads = g.fetched.filter((f) => f.url.includes('lookaside'));
    assert.deepEqual(downloads.map((f) => new URL(f.url).searchParams.get('mid')), ['MEDIA-A'], 'the 6 MB file was never downloaded');
    assert.deepEqual([interviews(db).length, sessions(db).length, chunks(db).length, files.size], [0, 0, 0, 0], 'nothing half-made is left');
    const [cap] = captures(db);
    assert.deepEqual([cap.status, cap.import_error, cap.session_id, cap.import_job], ['consented', 'too_large', null, null]);
    assert.equal(g.sent.filter((x) => x.text === CAPTURE_COPY.saved).length, 0);
  } finally { g.restore(); }
});

test('bytes that are not the declared audio are refused as unsupported_format; nothing is kept', async () => {
  const { env, db, queued, files } = world();
  const g = mockGraph({ 'MEDIA-A': { bytes: junk() } });
  try {
    await forwardAndAnswer(env, db, ['MEDIA-A']);
    await runCapture(env, queued);
    assert.equal(captures(db)[0].import_error, 'unsupported_format');
    assert.deepEqual([interviews(db).length, sessions(db).length, files.size], [0, 0, 0]);
  } finally { g.restore(); }
});

test('a provider that does not answer is tried again on the same session; the second try finishes it', async () => {
  const { env, db, queued } = world();
  const media = { 'MEDIA-A': { bytes: ogg() }, 'MEDIA-B': { bytes: ogg(), lookupStatus: 503 } };
  const g = mockGraph(media);
  try {
    await forwardAndAnswer(env, db, ['MEDIA-A', 'MEDIA-B']);
    await runCapture(env, queued);
    assert.equal(captureJobs(queued).length, 2, 'the job queued its own next try');
    const retry = captureJobs(queued).at(-1);
    assert.equal(retry.payload.try, 2);
    assert.ok(retry.opts?.delaySeconds > 0);
    assert.deepEqual([sessions(db).length, chunks(db).length], [1, 1], 'the first file is kept for the next try');
    assert.equal(captures(db)[0].import_error, 'provider_unavailable');
    delete (media['MEDIA-B'] as any).lookupStatus;
    await runCapture(env, queued);
    assert.deepEqual([interviews(db).length, sessions(db).length, chunks(db).length], [1, 1, 2]);
    assert.equal(captures(db)[0].status, 'imported');
    assert.equal(g.fetched.filter((f) => f.url.includes('mid=MEDIA-A')).length, 1, 'a stored file is not fetched again');
  } finally { g.restore(); }
});

test('"Agreed beforehand" through the route queues the import, with its method on the session', async () => {
  const { env, db, queued } = world();
  const g = mockGraph({ 'MEDIA-A': { bytes: ogg() } });
  try {
    await link(env);
    await waHook(env, voice('MEDIA-A'));
    const r = await call(env, ME, 'POST', `/whatsapp/captures/${captures(db)[0].uid}/consent`, { method: 'pre_agreed' });
    assert.equal(r.status, 200);
    await runCapture(env, queued);
    assert.equal(sessions(db)[0].consent_method, 'pre_agreed');
  } finally { g.restore(); }
});

test('a replayed button press queues and imports once', async () => {
  const { env, db, queued } = world();
  const g = mockGraph({ 'MEDIA-A': { bytes: ogg() } });
  try {
    await forwardAndAnswer(env, db, ['MEDIA-A']);
    await waHook(env, press(`capture_verbal:${captures(db)[0].uid}`));
    assert.equal(captureJobs(queued).length, 1);
    await runCapture(env, queued);
    await runCapture(env, queued);
    assert.deepEqual([interviews(db).length, sessions(db).length], [1, 1]);
  } finally { g.restore(); }
});

test('a member with no venture: nothing is downloaded, and the capture says why', async () => {
  const { env, db, queued } = world();
  db.prepare('UPDATE projects SET deleted_at = datetime(\'now\')').run();
  const g = mockGraph({ 'MEDIA-A': { bytes: ogg() } });
  try {
    await forwardAndAnswer(env, db, ['MEDIA-A']);
    assert.equal(captures(db)[0].project_id, null);
    await runCapture(env, queued);
    assert.deepEqual([g.fetched.length, interviews(db).length], [0, 0]);
    assert.equal(captures(db)[0].import_error, 'no_venture');
  } finally { g.restore(); }
});

test('two runs at once import once: only the claim holder goes on', async () => {
  const { env, db } = world();
  const g = mockGraph({ 'MEDIA-A': { bytes: ogg() } });
  try {
    await forwardAndAnswer(env, db, ['MEDIA-A']);
    const uid = captures(db)[0].uid;
    const [a, b] = await Promise.all([importCapture(env, uid, 'job-a'), importCapture(env, uid, 'job-b')]);
    assert.deepEqual([a.done, b.done].sort(), ['imported', 'nothing']);
    assert.deepEqual([interviews(db).length, sessions(db).length], [1, 1]);
  } finally { g.restore(); }
});

test('no model is called: the import has no AI path, and the recorder\'s pipeline does the transcribing', () => {
  const src = readFileSync(new URL('../src/services/channels/whatsappCapture.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /aiRouter|aiRun|env\.AI\b|transcribeChunk|summariseSession|digestSession/);
  assert.match(src, /finishSession\(env, session, userId, items\.length - 1, true\)/);
});

test('consent withdrawn before the job runs: nothing is downloaded and nothing is made', async () => {
  const { env, db, queued } = world();
  const g = mockGraph({ 'MEDIA-A': { bytes: ogg() } });
  try {
    await forwardAndAnswer(env, db, ['MEDIA-A']);
    db.prepare("UPDATE channel_consents SET status = 'withdrawn', withdrawn_at = datetime('now')").run();
    await runCapture(env, queued);
    assert.deepEqual([g.fetched.length, interviews(db).length, sessions(db).length], [0, 0, 0]);
  } finally { g.restore(); }
});

test('the draft opens in the member\'s own venture, never a newer one of someone else\'s', async () => {
  const { env, db, queued } = world();
  db.exec("INSERT INTO founders (id, user_id) VALUES (71, 3); INSERT INTO projects (id, name, founder_id, updated_at) VALUES (501, 'Not mine', 71, '2099-01-01 00:00:00')");
  const g = mockGraph({ 'MEDIA-A': { bytes: ogg() } });
  try {
    await forwardAndAnswer(env, db, ['MEDIA-A']);
    assert.equal(captures(db)[0].project_id, PROJECT);
    await runCapture(env, queued);
    assert.equal(interviews(db)[0].project_id, PROJECT);
  } finally { g.restore(); }
});
