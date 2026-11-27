/**
 * D671 (#1540) — the daily "N flagged scores awaiting review" email is retired.
 *
 * The 14:00 UTC cron enqueued `flagged_score_digest`, and the job emailed every
 * admin the same unreviewed list each day. This pins that:
 *   - nothing enqueues the job any more;
 *   - a leftover job drains without touching D1 or sending anything;
 *   - the digest's builder and its email sender are gone;
 *   - the one-time alert when a score is first flagged, and the nightly
 *     integrity audit, both stay.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { handleJob } from '../src/services/queueWorker.ts';
import { codeOnly } from './_codeOnly.mjs';

const src = (p: string) => codeOnly(readFileSync(resolve(process.cwd(), 'cloudflare-worker/src', p), 'utf8'));

test('nothing enqueues the flagged-score digest', () => {
  for (const f of ['index.ts', 'services/queueWorker.ts', 'services/notifications.ts']) {
    assert.doesNotMatch(src(f), /enqueue\([^)]*['"]flagged_score_digest['"]/, `${f} enqueues the digest again`);
  }
});

test('a leftover digest job drains without reading D1 or sending mail', async () => {
  const calls: string[] = [];
  const env: any = {
    DB: { prepare(sql: string) { calls.push(`db:${sql.trim().slice(0, 40)}`); throw new Error('the digest must not touch D1'); } },
    GMAIL_CLIENT_ID: 'x', GMAIL_CLIENT_SECRET: 'x', GMAIL_REFRESH_TOKEN: 'x',
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => { calls.push(`fetch:${String(url)}`); throw new Error('the digest must not send'); }) as any;
  try {
    await handleJob(env, { id: 1, job_type: 'flagged_score_digest', payload: '{}', status: 'processing', attempts: 0, max_retries: 3, error: null, created_at: '2026-10-11 14:00:00' } as any);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(calls, []);
});

test('the digest builder and its email are deleted', () => {
  assert.doesNotMatch(src('services/notifications.ts'), /digestUnreviewedFlaggedScores/);
  assert.doesNotMatch(src('services/email.ts'), /sendFlaggedScoreDigestEmail|flagged scores? still awaiting review/);
});

test('the first-flag alert and the nightly integrity audit stay', () => {
  assert.match(src('services/notifications.ts'), /export async function notifyAdminsOfFlaggedScore\(/);
  assert.match(src('services/email.ts'), /export async function sendFlaggedScoreEmail\(/);
  assert.match(src('index.ts'), /Jobs\.enqueue\(env, 'score_hash_audit'/);
});
