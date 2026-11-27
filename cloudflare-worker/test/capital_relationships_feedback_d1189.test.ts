/**
 * D1189 (#3123) — a Capital relationships record's Feedback section draws the
 * answer Add feedback stores beside each objection (`raiseWriters.ts`), and
 * says "No answer recorded" where none was written. The table is migration
 * 463's own statement, read from the file; every objection here is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/capital_relationships_feedback_d1189.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { d1Over } from './_d1_sqlite.mjs';
import { RAISE_RECORDS, feedbackRow } from '../src/services/records/raise.ts';

const M463 = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/migrations/463_raise_record_stores.sql'), 'utf8');
const FEEDBACK_DDL = M463.match(/CREATE TABLE IF NOT EXISTS raise_prospect_feedback \([\s\S]*?\n\);/)![0];

test('a feedback row: the objection, then the answer or that none was recorded, then the day', () => {
  assert.deepEqual(feedbackRow({ objection: 'Too early for us', answer: ' Two pilots signed since. ', created_at: '2026-10-20 09:00:00' }),
    { a: '"Too early for us"', b: 'Answer: Two pilots signed since. · 2026-10-20' });
  assert.equal(feedbackRow({ objection: 'Market too small', answer: null, created_at: null }).b, 'No answer recorded');
  assert.equal(feedbackRow({ objection: 'Market too small', answer: '   ' }).b, 'No answer recorded');
});

test('the record\'s Feedback section reads the stored answer', async () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(FEEDBACK_DDL);
  db.exec(`INSERT INTO raise_prospect_feedback (prospect_id, objection, answer, created_at) VALUES
    (5, 'Too early for us', 'Two pilots signed since.', '2026-10-20 09:00:00'),
    (5, 'Market too small', NULL, '2026-10-21 09:00:00'),
    (6, 'Not our sector', 'Fair.', '2026-10-22 09:00:00')`);
  const spec = RAISE_RECORDS['capital-relationships'].sections.find((s) => s.key === 'feedback')!;
  const out = await spec.read({ env: { DB: d1Over(db) }, projectId: 1 } as any, '5', {} as any);
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].a, '"Market too small"');
  assert.match(out.rows[0].b!, /^No answer recorded · 2026-10-21$/);
  assert.equal(out.rows[1].a, '"Too early for us"');
  assert.match(out.rows[1].b!, /^Answer: Two pilots signed since\. · 2026-10-20$/);
  assert.equal(out.action, 'add-feedback');
});
