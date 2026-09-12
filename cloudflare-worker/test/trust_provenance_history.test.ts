/**
 * Trust Center v2's two server-side derivations: where a status came from,
 * and what the score was the last month we have on record.
 *
 * Both print a sentence to someone checking their own compliance, and both
 * can be wrong in a way that looks perfectly reasonable on screen:
 *
 *   `obligationSource` — a filler provenance over a row nothing has touched
 *     ("Added manually") is an invention about evidence that does not exist.
 *     D56/D68: an absence is stated, never rendered as a plausible value.
 *
 *   `recordAndCompareScore` — the canvas fakes the month-over-month delta
 *     from a per-role literal. Backing it for real means the SERVER writes
 *     the snapshot, because a history the caller can set is not a history.
 *     What is tested here is that a brand-new account gets `null` rather
 *     than a comparison against a month it did not exist for.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/trust_provenance_history.test.ts
 */
// Set before any test body runs, so `monthLabel`'s UTC assertions are worth
// something: a local-calendar implementation is indistinguishable from a UTC
// one when the process itself is in UTC, which is where CI runs.
process.env.TZ = 'America/Los_Angeles';

import test from 'node:test';
import assert from 'node:assert/strict';
import { obligationSource, monthLabel, recordAndCompareScore } from '../src/services/trust.ts';

// ---------------------------------------------------------------------------
// obligationSource

test('a signed envelope names itself, short enough to read', () => {
  const s = obligationSource({ evidence_envelope_uuid: 'a1b2c3d4-5e6f-7890-abcd-ef1234567890' });
  assert.equal(s, 'Signed envelope a1b2c3d4');
  // Not the whole uuid: the row is one line under an obligation title, and
  // 36 characters of hex tells the reader nothing the first 8 do not.
  assert.ok(!String(s).includes('ef1234567890'));
});

test('the envelope wins over evidence_meta when a row carries both', () => {
  // A row satisfied by signing has both fields; the envelope is the more
  // specific fact, and naming the sync instead would point at the wrong thing.
  assert.equal(
    obligationSource({
      evidence_envelope_uuid: 'deadbeef-0000',
      evidence_meta: '{"source":"kyc_provider"}',
    }),
    'Signed envelope deadbeef',
  );
});

test('the two known sync sources read as sentences, not as column values', () => {
  assert.equal(obligationSource({ evidence_meta: '{"source":"kyc_provider"}' }),
    'Synced from identity verification');
  assert.equal(obligationSource({ evidence_meta: '{"source":"kyb_provider"}' }),
    'Synced from entity verification');
  // The writers those two labels describe, still in place.
  // (`resyncKycKyb` is what stamps them — see its COALESCE json_object calls.)
});

test('meta already parsed by a caller works the same as the raw string', () => {
  // D1 returns TEXT, but a caller with an object must not silently get null.
  assert.equal(obligationSource({ evidence_meta: { source: 'kyc_provider' } }),
    'Synced from identity verification');
});

test('an unknown source surfaces rather than vanishing', () => {
  // A new writer stamping `evidence_meta` should become visible on the page,
  // not be silently dropped for not being on a list.
  assert.equal(obligationSource({ evidence_meta: '{"source":"persona_inquiry"}' }),
    'Synced from persona inquiry');
});

test('no evidence produces NO line — never a plausible-sounding origin', () => {
  for (const row of [
    {},
    { evidence_meta: null },
    { evidence_meta: '' },
    { evidence_meta: '{}' },
    { evidence_meta: '{"source":""}' },
    { evidence_meta: '{"source":"   "}' },
    { evidence_meta: '{"source":42}' },
    { evidence_meta: 'not json at all' },
    { evidence_envelope_uuid: '' },
    null,
    undefined,
  ]) {
    assert.equal(obligationSource(row as any), null,
      `${JSON.stringify(row)} produced a provenance line out of nothing`);
  }
});

// ---------------------------------------------------------------------------
// monthLabel — a UTC calendar label, not a local one

test('the month label is UTC, so two readers on the same day agree', () => {
  assert.equal(monthLabel(new Date('2026-09-15T12:00:00Z')), '2026-09');
  assert.equal(monthLabel(new Date('2026-01-01T00:00:00Z')), '2026-01');
  assert.equal(monthLabel(new Date('2026-12-31T23:59:59Z')), '2026-12');
  // THE BOUNDARY THAT MATTERS. This instant is 1 October in UTC and
  // 30 September in Los Angeles. A local-month label would key the snapshot
  // differently depending on where the reader sits, so one of them would
  // silently write a second row for "the same" month.
  assert.equal(monthLabel(new Date('2026-10-01T00:30:00Z')), '2026-10');
  // Zero-padded, because the column is TEXT and sorts lexicographically —
  // '2026-9' would sort after '2026-10' and pick the wrong previous month.
  assert.equal(monthLabel(new Date('2026-09-01T00:00:00Z')), '2026-09');
  assert.match(monthLabel(new Date('2026-03-05T00:00:00Z')), /^\d{4}-\d{2}$/);
});

// ---------------------------------------------------------------------------
// recordAndCompareScore — over an in-memory stand-in for the snapshot table

type Snap = { user_id: number; captured_month: string; score: number };

/**
 * A D1 stand-in that honours the two things this function depends on: the
 * UNIQUE(user_id, captured_month) index behind `INSERT OR IGNORE` (migration
 * 243), and the `captured_month < ?` DESC LIMIT 1 read.
 */
function fakeDb(rows: Snap[], opts: { failWrite?: boolean; failRead?: boolean } = {}) {
  const writes: Snap[] = [];
  const env: any = {
    DB: {
      prepare(sql: string) {
        // The conflict clause and the comparison operator are READ OFF THE
        // SQL rather than assumed, so swapping IGNORE for REPLACE, or `<`
        // for `<=`, actually changes what this stand-in does. A fake that
        // hardcodes the intended behaviour cannot fail when the query stops
        // matching it.
        const ins = /INSERT\s+OR\s+(IGNORE|REPLACE)\s+INTO\s+trust_score_snapshots/i.exec(sql);
        const cmp = /captured_month\s*(<=|<|=)\s*\?/.exec(sql);
        // The user scoping is read off the SQL for the same reason as the
        // month comparison. It was hardcoded to `===` at first, and a
        // mutation widening the query to `user_id >= ?` — which really does
        // leak another account's score — did not fail a single test.
        const who = /user_id\s*(>=|<=|=|>|<)\s*\?/.exec(sql);
        const desc = /ORDER BY captured_month DESC/i.test(sql);
        let bound: any[] = [];
        return {
          bind(...args: any[]) { bound = args; return this; },
          async run() {
            if (!ins) throw new Error(`unexpected run() on: ${sql}`);
            if (opts.failWrite) throw new Error('D1_ERROR: write failed');
            const [user_id, captured_month, score] = bound;
            const at = rows.findIndex(r => r.user_id === user_id && r.captured_month === captured_month);
            if (at < 0) {
              const row = { user_id, captured_month, score };
              rows.push(row);
              writes.push(row);
              return { meta: { changes: 1 } };
            }
            if (ins[1].toUpperCase() === 'REPLACE') {
              rows[at] = { user_id, captured_month, score };
              writes.push(rows[at]);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
          async first() {
            if (ins) throw new Error('unexpected first() on the insert');
            if (opts.failRead) throw new Error('D1_ERROR: read failed');
            if (!cmp) throw new Error(`the history read no longer bounds captured_month: ${sql}`);
            if (!who) throw new Error(`the history read no longer scopes to one user: ${sql}`);
            const [user_id, month] = bound;
            const keep = (m: string) => (cmp[1] === '<' ? m < month : cmp[1] === '<=' ? m <= month : m === month);
            const mine = (u: number) => ({
              '=': u === user_id, '>=': u >= user_id, '<=': u <= user_id,
              '>': u > user_id, '<': u < user_id,
            }[who[1]]);
            // A total order, not `a < b ? 1 : -1` — that returns -1 for a tie
            // in both directions, and V8's insertion sort then SWAPS equal
            // rows. Two rows sharing a month came back in reverse fixture
            // order, which silently rescued a leaked-scope mutation.
            const earlier = rows
              .filter(r => mine(r.user_id) && keep(r.captured_month))
              .sort((a, b) => (a.captured_month < b.captured_month ? 1
                : a.captured_month > b.captured_month ? -1 : 0));
            return (desc ? earlier[0] : earlier[earlier.length - 1]) || null;
          },
        };
      },
    },
  };
  return { env, rows, writes };
}

const SEP = new Date('2026-09-15T12:00:00Z');

test('a brand-new account is told nothing, not that its score held steady', () => {
  // The whole reason the snapshot table exists. The canvas would render
  // "Unchanged from last month" here, across a month the account did not
  // exist for.
  const { env, rows } = fakeDb([]);
  return recordAndCompareScore(env, 7, 72, SEP).then((r) => {
    assert.deepEqual(r, { previousScore: null, previousMonth: null });
    // And this month is now on record, so next month has something to read.
    assert.deepEqual(rows, [{ user_id: 7, captured_month: '2026-09', score: 72 }]);
  });
});

test('the current month is never its own comparison', () => {
  // `captured_month < ?` excludes the row just written. Without it every
  // reader would see "Unchanged since September (72)" against themselves.
  const { env } = fakeDb([{ user_id: 7, captured_month: '2026-09', score: 41 }]);
  return recordAndCompareScore(env, 7, 72, SEP).then((r) => {
    assert.deepEqual(r, { previousScore: null, previousMonth: null });
  });
});

test('the month\'s first reading is the record — a later one does not overwrite it', () => {
  // INSERT OR IGNORE, deliberately: the snapshot is what the score WAS when
  // the month was first observed. Re-reading the page an hour later must not
  // move it, or the previous month would drift all month long.
  const rows: Snap[] = [];
  const { env } = fakeDb(rows);
  return recordAndCompareScore(env, 7, 40, SEP)
    .then(() => recordAndCompareScore(env, 7, 95, new Date('2026-09-28T12:00:00Z')))
    .then(() => {
      assert.equal(rows.length, 1, 'a second row was written for the same month');
      assert.equal(rows[0].score, 40, 'the month\'s snapshot was overwritten by a later read');
    });
});

test('the comparison is the MOST RECENT earlier month, not the oldest', () => {
  const { env } = fakeDb([
    { user_id: 7, captured_month: '2026-03', score: 10 },
    { user_id: 7, captured_month: '2026-08', score: 55 },
    { user_id: 7, captured_month: '2026-07', score: 33 },
  ]);
  return recordAndCompareScore(env, 7, 72, SEP).then((r) => {
    assert.deepEqual(r, { previousScore: 55, previousMonth: '2026-08' });
  });
});

test('a gap of months is named, not called "last month"', () => {
  // Someone who last opened this page in March gets March, because the page
  // prints the month it is handed.
  const { env } = fakeDb([{ user_id: 7, captured_month: '2026-03', score: 10 }]);
  return recordAndCompareScore(env, 7, 72, SEP).then((r) => {
    assert.equal(r.previousMonth, '2026-03');
    assert.equal(r.previousScore, 10);
  });
});

test('one user\'s history is never another\'s', () => {
  // The neighbour's month is LATER than this user's, deliberately. With both
  // on the same month the DESC ordering is a tie, and a query that leaked
  // across accounts could still return the right row by luck — which is
  // exactly what happened: a `user_id >= ?` mutation passed this test until
  // the fixture stopped depending on tie-break order.
  const { env } = fakeDb([
    { user_id: 8, captured_month: '2026-08', score: 99 },
    { user_id: 7, captured_month: '2026-07', score: 20 },
  ]);
  return recordAndCompareScore(env, 7, 72, SEP).then((r) => {
    assert.equal(r.previousScore, 20, 'another account\'s score was reported as this one\'s history');
    assert.equal(r.previousMonth, '2026-07');
  });
});

test('a recorded zero is a history, and survives as one', () => {
  // `previousScore` is checked with `== null` on the page precisely so that a
  // real, terrible, recorded 0 still produces a delta instead of reading as
  // "no history".
  const { env } = fakeDb([{ user_id: 7, captured_month: '2026-08', score: 0 }]);
  return recordAndCompareScore(env, 7, 40, SEP).then((r) => {
    assert.equal(r.previousScore, 0);
    assert.notEqual(r.previousScore, null);
    assert.equal(r.previousMonth, '2026-08');
  });
});

test('a D1 failure loses the delta, never the page', () => {
  // /trust/me is the whole Trust Center. A snapshot table that is missing,
  // locked or mid-migration must degrade to "no comparison yet", not 500.
  const failWrite = fakeDb([{ user_id: 7, captured_month: '2026-08', score: 55 }], { failWrite: true });
  const failRead = fakeDb([{ user_id: 7, captured_month: '2026-08', score: 55 }], { failRead: true });
  return Promise.all([
    recordAndCompareScore(failWrite.env, 7, 72, SEP),
    recordAndCompareScore(failRead.env, 7, 72, SEP),
  ]).then(([w, r]) => {
    // A failed WRITE still lets the read answer — the history it already had
    // is not lost because this month could not be stamped.
    assert.deepEqual(w, { previousScore: 55, previousMonth: '2026-08' });
    // A failed READ has nothing to say, and says so.
    assert.deepEqual(r, { previousScore: null, previousMonth: null });
  });
});
