/**
 * #4717 package 6 — the Community read keeps its contract. The worker's real
 * `communityOverview` answer, over the migrated schema, is checked by the page's
 * own runtime contract (`frontend/src/pages/admin/community/model/contract.js`),
 * so a field the worker renames, drops or sends as text fails HERE, on the
 * worker's side, before the page has to draw it as unreadable.
 *
 * Checked: an empty network (every block available, every count 0, every list
 * empty), a lived-in one (rows in every list), each period, and a block that
 * cannot be read (its table gone), which keeps the contract by saying why.
 * Every record is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/community_contract_4717.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { loadSchema } from './_schema_once.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { communityOverview, parseCommunityWeeks } from '../src/services/communityOverview.ts';
import { OVERVIEW_BLOCKS, checkOverview } from '../../frontend/src/pages/admin/community/model/contract.js';
import { DEFAULT_WEEKS, PERIODS } from '../../frontend/src/pages/admin/community/model/period.js';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const at = (days: number) => new Date(NOW + days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

async function db(lived: boolean) {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  await loadSchema(d);
  if (lived) {
    const u = d.prepare('INSERT INTO users (id, role, name, email, is_active) VALUES (?, ?, ?, ?, 1)');
    ['founder', 'investor', 'advisor', 'partner', 'exploring', 'admin'].forEach((role, i) => u.run(i + 1, role, `Synthetic ${i + 1}`, `s${i + 1}@example.invalid`));
    const ev = d.prepare(`INSERT INTO events (id, slug, title, type, starts_at, status, capacity, created_at, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    ev.run(1, 'next', 'Next Thing', 'workshop', at(5), 'published', 40, at(-30), null);
    ev.run(2, 'waiting', 'Waiting Thing', 'meetup', at(10), 'pending_review', null, at(-6), at(-5));
    ev.run(3, 'past', 'Past Thing', 'demo_day', at(-10), 'published', 100, at(-60), null);
    const reg = d.prepare(`INSERT INTO event_registrations (event_id, user_id, email, status, registered_at) VALUES (?, ?, ?, ?, ?)`);
    reg.run(1, 1, 'r1@example.invalid', 'registered', at(-1));
    reg.run(3, 2, 'r2@example.invalid', 'attended', at(-12));
    reg.run(3, 3, 'r3@example.invalid', 'waitlisted', at(-12));
    const job = d.prepare(`INSERT INTO job_postings (id, slug, title, status, created_at, updated_at, submitted_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    job.run(1, 'open', 'Open Role', 'published', at(-20), at(-19), null, at(-19));
    job.run(2, 'queued', 'Queued Role', 'pending_review', at(-4), at(-4), at(-4), null);
    d.prepare(`INSERT INTO job_applications (posting_id, user_id, email, created_at) VALUES (1, 1, 'a1@example.invalid', ?)`).run(at(-2));
    d.prepare(`INSERT INTO circles (id, slug, name, type, published, featured, members) VALUES (1, 'c', 'A Circle', 'founder', 1, 0, 12)`).run();
    d.prepare(`INSERT INTO network_profiles (name, kind, is_active) VALUES ('A Profile', 'advisor', 1)`).run();
    d.prepare(`INSERT INTO experts (id, name, verified, is_active) VALUES (1, 'An Expert', 1, 1)`).run();
    d.prepare(`INSERT INTO expert_bookings (expert_id, user_id, status, created_at) VALUES (1, 1, 'confirmed', ?)`).run(at(-3));
  }
  return d;
}

test('the worker\'s answer keeps the page\'s contract, empty and lived-in, at every period', async () => {
  for (const lived of [false, true]) {
    const d = await db(lived);
    try {
      for (const { weeks } of PERIODS) {
        const answer = await communityOverview({ DB: d1Over(d) } as any, weeks as 4 | 12 | 52, NOW);
        assert.deepEqual(checkOverview(answer), [], `${lived ? 'lived-in' : 'empty'}, ${weeks} weeks`);
        // Every block the contract names is available here, so every field was checked, not skipped.
        for (const path of Object.keys(OVERVIEW_BLOCKS)) {
          const b = path.split('.').reduce((v: any, k) => v?.[k], answer.blocks);
          assert.equal(b?.available, true, `${path} was not read, so its fields were not checked`);
        }
        if (lived) {
          const rows = (p: string, k: string) => p.split('.').reduce((v: any, x) => v?.[x], answer.blocks)[k].length;
          assert.ok(rows('events.next_up', 'rows') > 0 && rows('jobs', 'most_applied') > 0 && rows('queue.jobs', 'review') > 0, 'the lists have rows to check');
        }
      }
    } finally { d.close(); }
  }
});

test('a block that cannot be read keeps the contract by saying why', async () => {
  const d = await db(true);
  try {
    d.exec('DROP TABLE expert_bookings');
    const answer = await communityOverview({ DB: d1Over(d) } as any, 12, NOW);
    assert.equal((answer.blocks.wellbeing as any).bookings.available, false);
    assert.deepEqual(checkOverview(answer), []);
  } finally { d.close(); }
});

test('the contract finds what it promises to: a field sent as text, a key left out, a block with no reason', async () => {
  // Mutation checked: the map's keys check removed → the dropped event type passes; the rows' text check
  // removed → a row with no title passes.
  const d = await db(true);
  try {
    const answer: any = await communityOverview({ DB: d1Over(d) } as any, 12, NOW);
    const broken = (f: (a: any) => void) => { const a = structuredClone(answer); f(a); return checkOverview(a); };
    assert.deepEqual(broken((a) => { a.blocks.queue.events.count = '2'; }), ['blocks.queue.events.count: not a whole number']);
    assert.deepEqual(broken((a) => { delete a.blocks.events.by_type.counts.social; }), ['blocks.events.by_type.counts.social: missing']);
    assert.deepEqual(broken((a) => { a.blocks.jobs.most_applied[0].title = null; }), ['blocks.jobs.most_applied.0.title: not text']);
    assert.deepEqual(broken((a) => { a.blocks.circles = { available: false }; }), ['blocks.circles: neither available nor a reason']);
    assert.deepEqual(broken((a) => { a.blocks.wellbeing.checkins = { available: true, withheld: 'no' }; }), ['blocks.wellbeing.checkins.withheld: not true or false']);
    // Paths and field names only: no value from the answer is ever in a line.
    const lines = broken((a) => { a.blocks.events.next_up.rows[0].title = ''; a.blocks.queue.jobs.review[0].waiting_hours = 'Queued Role'; });
    assert.ok(lines.length === 2 && lines.every((l) => !/Queued Role|Next Thing/.test(l)), lines.join(' | '));
  } finally { d.close(); }
});

test('one default period: the worker answers 12 weeks when none is asked for, as the page does', () => {
  // Mutation checked: the worker's default back to 4 → this fails (D931 said 4; the page has always said 12, D933).
  assert.equal(parseCommunityWeeks(undefined), DEFAULT_WEEKS);
  assert.equal(parseCommunityWeeks(''), DEFAULT_WEEKS);
  assert.deepEqual(PERIODS.map((p) => parseCommunityWeeks(String(p.weeks))), PERIODS.map((p) => p.weeks));
  assert.equal(parseCommunityWeeks('13'), null);
});
