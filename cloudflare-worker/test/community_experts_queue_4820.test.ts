/**
 * D4820 part 3 (#4820, CM02) — the Community read's third queue: the wellbeing
 * experts waiting to be verified (`queue.experts`), counted by the same rule as
 * Approvals' `wellbeing_experts` lane, with each one's id, headline and wait,
 * and never the expert's name or account. Every record is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/community_experts_queue_4820.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { EXPERTS_TO_VERIFY_WHERE, communityOverview } from '../src/services/communityOverview.ts';
import { APPROVAL_SOURCES } from '../src/services/approvalSources.ts';
import { checkOverview } from '../../frontend/src/pages/admin/community/model/contract.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const at = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString().slice(0, 19).replace('T', ' ');

async function db() {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  await loadSchema(d);
  d.prepare(`INSERT INTO users (id, role, name, email, is_active) VALUES (1, 'advisor', 'Synthetic Person', 'person@example.invalid', 1)`).run();
  const e = d.prepare(`INSERT INTO experts (id, uid, user_id, name, headline, verified, is_active, hidden_by_admin, decision_state, profile_completion_pct, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // Waiting: active, unverified, not hidden or declined, 70% or more complete, not a sample.
  e.run(1, 'u-old', 1, 'Old Waiting Name', 'Sleep coach', 0, 1, 0, 'pending', 80, at(-100));
  e.run(2, 'u-new', null, 'New Waiting Name', '  ', 0, 1, 0, 'pending', 70, at(-10));
  e.run(9, 'u-newer', null, 'Newer Waiting Name', 'Breathwork', 0, 1, 0, 'pending', 90, at(-5));
  // Not waiting, each for one reason.
  e.run(3, 'u-verified', null, 'Verified Name', 'Coach', 1, 1, 0, 'verified', 100, at(-200));
  e.run(4, 'u-inactive', null, 'Inactive Name', 'Coach', 0, 0, 0, 'pending', 100, at(-200));
  e.run(5, 'u-hidden', null, 'Hidden Name', 'Coach', 0, 1, 1, 'pending', 100, at(-200));
  e.run(6, 'u-declined', null, 'Declined Name', 'Coach', 0, 1, 0, 'declined', 100, at(-200));
  e.run(7, 'u-thin', null, 'Thin Name', 'Coach', 0, 1, 0, 'pending', 69, at(-200));
  e.run(8, 'seed_sample', null, 'Sample Name', 'Coach', 0, 1, 0, 'pending', 100, at(-200));
  return d;
}

test('D4820 part 3: queue.experts counts the experts waiting, the overdue ones and the oldest wait', async () => {
  const d = await db();
  try {
    const answer = await communityOverview({ DB: d1Over(d) } as any, 4, NOW);
    const q = answer.blocks.queue.experts as any;
    // Mutation checked: dropping the decision_state clause → the declined expert is counted and pending is 4.
    assert.equal(q.available, true);
    assert.equal(q.pending, 3);
    // Mutation checked: `<` swapped for `>` in the overdue CASE → the two recent experts are overdue and this is 2.
    assert.equal(q.overdue, 1, 'only the one waiting more than 72 hours is overdue');
    assert.equal(q.oldest_wait_hours, 100);
    assert.deepEqual(q.rows.map((r: any) => [r.expert_id, r.headline, r.waiting_hours, r.overdue]), [
      [1, 'Sleep coach', 100, true],
      [2, null, 10, false],
      [9, 'Breathwork', 5, false],
    ], 'oldest first; a blank headline is null, never an empty title');
    assert.deepEqual(checkOverview(answer), [], 'the answer keeps the page\'s contract');
  } finally { d.close(); }
});

test('D4820 part 3: no person travels — never the expert\'s name, the account or the email', async () => {
  const d = await db();
  try {
    const answer = await communityOverview({ DB: d1Over(d) } as any, 4, NOW);
    const text = JSON.stringify(answer.blocks.queue.experts);
    // Mutation checked: selecting `name` into the rows → this fails.
    for (const name of ['Old Waiting Name', 'New Waiting Name', 'Newer Waiting Name', 'Synthetic Person', 'person@example.invalid']) {
      assert.ok(!text.includes(name), `${name} is in the queue`);
    }
    assert.deepEqual(Object.keys((answer.blocks.queue.experts as any).rows[0]).sort(), ['expert_id', 'headline', 'overdue', 'waiting_hours', 'waiting_since']);
  } finally { d.close(); }
});

test('D4820 part 3: Community and Approvals count the same experts', () => {
  // The lane's WHERE, without its table alias, is Community's, clause for clause.
  const lane = APPROVAL_SOURCES.find((s) => s.key === 'wellbeing_experts');
  assert.ok(lane, 'Approvals has no wellbeing_experts lane');
  const clauses = (sql: string) => sql.replace(/\be\./g, '').split(/\s+AND\s+/i).map((c) => c.replace(/\s+/g, ' ').trim()).sort();
  const laneWhere = lane!.countSql.slice(lane!.countSql.indexOf('WHERE ') + 'WHERE '.length);
  // Mutation checked: changing 70 to 60 in EXPERTS_TO_VERIFY_WHERE → this fails.
  assert.deepEqual(clauses(EXPERTS_TO_VERIFY_WHERE), clauses(laneWhere));
});

test('D4820 part 3: an experts store that cannot be read is unreadable, and the other queues still answer', async () => {
  const d = await db();
  try {
    d.exec('DROP TABLE experts');
    const answer = await communityOverview({ DB: d1Over(d) } as any, 4, NOW);
    const q = answer.blocks.queue as any;
    assert.equal(q.experts.available, false);
    assert.equal(q.experts.unreadable, true);
    assert.match(q.experts.reason, /not the same as none/);
    assert.equal(q.jobs.available, true, 'the job queue answered');
    assert.deepEqual(checkOverview(answer), [], 'an unreadable block keeps the contract by saying why');
  } finally { d.close(); }
});
