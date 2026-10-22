/**
 * D685 §5.9 (#1584) — the `interview_process` job is registered, so Stop
 * reaches the transcript in production.
 *
 * Before this, `services/interviewProcessing.ts` cast the type into being and
 * `handleJob` had no case for it: its default threw "unknown job type", so on
 * the Cloudflare Queues path every message was retried and dead-lettered, and
 * no recording went past `uploading`. What these prove:
 *   · `handleJob` hands the job to `runInterviewProcessJob`, which transcribes
 *     the stored chunk and writes the final transcript;
 *   · the Cloudflare Queues consumer acks the message once the run lands;
 *   · the D1 drain completes it, not fails it;
 *   · the two per-drain AI caps are one set, and `interview_process` is kept
 *     out of it (queueWorker.ts says why: a deferral spends a retry).
 *
 * Real SQLite: migrations 438, 452 and 453 as production has them, with the
 * D640 budget fixture. R2 and Workers AI are in-memory stand-ins.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/queue_interview_process_d685.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiBudgetFixture } from './_ai_budget_fixture.mjs';
import { applyEngineSchema } from './_engine_schema.mjs';
import { tableFromBaseline } from './_baseline.mjs';
import { __resetForTest } from '../src/services/aiRouter.ts';
import { AI_JOB_TYPES as DRAIN_AI_JOB_TYPES, handleJob, processQueueBatch } from '../src/services/queueWorker.ts';
import { AI_JOB_TYPES as CONSUMER_AI_JOB_TYPES, queueConsumer } from '../src/queue-consumer.ts';
import { Jobs } from '../src/models/jobs.ts';
import { PROCESS_JOB } from '../src/services/interviewProcessing.ts';

import { withGuard } from './_guard_stub.mjs';
import { applySessionTranslationColumns } from './_session_translation_columns.mjs';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const mig = (name: string) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), 'utf8');
const FOUNDER = 2;
const SAID = 'We reconcile two systems by hand every Friday.';

/** A stopped, consented recording with one stored chunk, waiting for its job (Manual mode: it stops after Transcribing). */
function world() {
  __resetForTest();
  const { DB, db } = aiBudgetFixture();
  db.exec(`
    ALTER TABLE activity_logs ADD COLUMN project_id INTEGER;
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, founder_id INTEGER);
    CREATE TABLE discovery_interviews (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, interviewee_name TEXT NOT NULL,
      transcript TEXT, transcribed_at TEXT, transcribed_by_model TEXT, stage TEXT, channel TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    INSERT INTO projects VALUES (10, 'Venture', 100);
    INSERT INTO discovery_interviews (id, project_id, interviewee_name) VALUES (1, 10, 'Dana');
  `);
  db.exec(mig('438_interview_sessions.sql'));
  applySessionTranslationColumns(db); // D857: migration 527's segment columns
  db.exec('ALTER TABLE interview_sessions ADD COLUMN submitted_via TEXT');
  db.exec(mig('452_record_session_setup.sql'));
  db.exec(mig('453_interview_processing.sql'));
  for (const t of ['queue_jobs', 'job_idempotency', 'system_metrics']) db.exec(tableFromBaseline(BASELINE, t));
  // D757: the Validate engine's schema (487, 465, 453 and the re-scope's columns).
  applyEngineSchema(db);
  for (const key of ['founder:free', 'other']) {
    db.prepare('INSERT INTO ai_licence_caps(licence_key, daily_microusd, monthly_microusd, recorded_by) VALUES (?, ?, ?, 1)')
      .run(key, 50_000_000, 500_000_000);
  }
  const sid = Number(db.prepare(
    `INSERT INTO interview_sessions
       (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status, consent_method,
        processing_stage, processing_done, processing_total, processing_auto, expected_last_seq, processing_updated_at)
     VALUES ('s-1', 1, 10, ?, 'in_person', 'stopped', 'given', 'verbal', 'uploading', 1, 1, 0, 0, datetime('now'))`,
  ).run(FOUNDER).lastInsertRowid);
  const key = `validate-audio/${sid}/0.webm`;
  db.prepare(`INSERT INTO interview_session_chunks (session_id, seq, r2_key, mime, size_bytes, start_ms) VALUES (?, 0, ?, 'audio/webm', 64, 0)`)
    .run(sid, key);
  const audio = new Uint8Array(64).fill(7);
  const FILES = { async get(k: string) { return k === key ? { arrayBuffer: async () => audio.buffer.slice(0) } : null; } };
  const aiCalls: string[] = [];
  const AI = withGuard({
    async run(model: string) {
      aiCalls.push(model);
      return { text: SAID, transcription_info: { language: 'en' }, segments: [{ start: 0, end: 3, text: SAID }] };
    },
  });
  const env: any = { DB, ENVIRONMENT: 'development', FILES, AI };
  const payload = { session_id: sid, user_id: FOUNDER };
  return { env, db, sid, payload, aiCalls };
}

const sessionState = (db: any, sid: number) =>
  ({ ...db.prepare('SELECT status, processing_stage, processing_error FROM interview_sessions WHERE id = ?').get(sid) });
const finalText = (db: any, sid: number) =>
  db.prepare("SELECT text FROM interview_transcript_segments WHERE session_id = ? AND source = 'final'").all(sid).map((r: any) => r.text);

function asJob(payload: unknown) {
  return {
    id: 0, job_type: PROCESS_JOB, payload: JSON.stringify(payload), status: 'processing' as const, attempts: 1, max_retries: 3,
    error: null, created_at: '2026-10-14 09:00:00', updated_at: '2026-10-14 09:00:00', started_at: null, completed_at: null, dead_at: null,
  };
}

test('handleJob hands interview_process to runInterviewProcessJob, which writes the final transcript', async () => {
  const { env, db, sid, payload, aiCalls } = world();
  assert.equal(PROCESS_JOB, 'interview_process');
  await assert.doesNotReject(handleJob(env, asJob(payload)), 'no "unknown job type"');
  assert.deepEqual(sessionState(db, sid), { status: 'transcribed', processing_stage: 'done', processing_error: null });
  assert.deepEqual(finalText(db, sid), [SAID]);
  assert.equal(aiCalls.length, 1, 'the one stored chunk was transcribed once');
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM interview_session_receipts WHERE session_id = ? AND kind = 'final' AND outcome = 'ok'").get(sid).n), 1);
});

test('the Cloudflare Queues consumer acks an interview_process message once the run lands', async () => {
  const { env, db, sid, payload } = world();
  const seen = { acked: 0, retried: 0 };
  const message = {
    id: 'm-1', timestamp: new Date('2026-10-14T09:00:00Z'), attempts: 1,
    body: { job_type: 'interview_process', payload, idempotency_key: `interview_process:${sid}:finish` },
    ack() { seen.acked += 1; },
    retry() { seen.retried += 1; },
  };
  await queueConsumer({ queue: 'studioos-job-queue', messages: [message] } as any, env, {} as any);
  assert.deepEqual(seen, { acked: 1, retried: 0 });
  assert.equal(sessionState(db, sid).processing_stage, 'done');
  assert.deepEqual(finalText(db, sid), [SAID]);
  const claim = db.prepare('SELECT result_json FROM job_idempotency WHERE idempotency_key = ?').get(`interview_process:${sid}:finish`);
  assert.match(String(claim?.result_json), /"completed"/, 'the delivery is recorded as completed, not released for a retry');
});

test('the D1 drain completes an interview_process job instead of failing it', async () => {
  const { env, db, sid, payload } = world();
  await Jobs.enqueue(env, PROCESS_JOB, payload);
  assert.deepEqual(await processQueueBatch(env, 10), { processed: 1, failed: 0, deferred: 0 });
  assert.deepEqual({ ...db.prepare("SELECT status, error FROM queue_jobs WHERE job_type = 'interview_process'").get() },
    { status: 'completed', error: null });
  assert.equal(sessionState(db, sid).processing_stage, 'done');
});

test('the two per-drain AI caps are one set, and interview_process is kept out of it', () => {
  assert.deepEqual([...CONSUMER_AI_JOB_TYPES].sort(), [...DRAIN_AI_JOB_TYPES].sort(),
    'src/queue-consumer.ts mirrors services/queueWorker.ts');
  // Not an oversight: a deferral on the Cloudflare Queues path spends one of
  // the message's retries, so the cap would dead-letter a recording's run.
  // The reasoning is beside AI_JOB_TYPES in services/queueWorker.ts.
  assert.equal(DRAIN_AI_JOB_TYPES.has('interview_process'), false);
});
