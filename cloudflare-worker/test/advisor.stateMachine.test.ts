/**
 * Task #6 (CB) — Personal Advisor state machine unit tests.
 *
 * Loads the real `services/advisor/stateMachine.ts` source via Node 22's
 * built-in `--experimental-strip-types` so the coverage reporter sees
 * the actual file (the IIFE-transpile pattern used elsewhere in this
 * repo would hide the module from `--experimental-test-coverage`).
 *
 * Coverage target: ≥80% branch coverage on stateMachine.ts.
 * Enforced by `scripts/check-statemachine-coverage.mjs`, wired into
 * `npm run test:drift`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as SM from '../src/services/advisor/stateMachine.ts';

// ---------------------------------------------------------------------------
// Question fixture builder. Mirrors the minimal `Question` shape the
// state machine reads so tests don't need to import the bank registry.
// ---------------------------------------------------------------------------
type AnyQ = Record<string, unknown> & { id: string };
function q(over: Partial<AnyQ> = {}): any {
  return {
    id: 'qx',
    persona: 'founder',
    section: 'BUILD',
    prompt: 'A test prompt',
    input_kind: 'text',
    importance: 'normal',
    page_target: '/build',
    skip_allowed: true,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// In-memory D1 mock — minimal implementation of the `prepare/bind/all/run`
// surface the state machine touches.
// ---------------------------------------------------------------------------
interface AnswerRow { user_id: number; question_id: string; saved_status: string }
interface StateRow  { user_id: number; question_id: string; last_asked_at: string; answer_count?: number }
interface LogRow    { action: string; details: string; user_id: number }
interface UserRow   { id: number; spinout_lab_week?: number }

function makeDb() {
  const tables = {
    advisor_answers: [] as AnswerRow[],
    advisor_state: [] as StateRow[],
    activity_logs: [] as LogRow[],
    users: [] as UserRow[],
  };
  function prepare(sql: string) {
    const params: any[] = [];
    return {
      bind(...vals: any[]) { params.push(...vals); return this; },
      async all() {
        if (/FROM advisor_answers/.test(sql)) {
          const [uid] = params;
          const rows = tables.advisor_answers
            .filter((r) => r.user_id === uid && (r.saved_status === 'saved' || r.saved_status === 'skipped'))
            .map((r) => ({ question_id: r.question_id }));
          return { results: rows } as any;
        }
        if (/FROM advisor_state/.test(sql)) {
          const [uid] = params;
          const rows = tables.advisor_state
            .filter((r) => r.user_id === uid)
            .map((r) => ({ question_id: r.question_id, last_asked_at: r.last_asked_at }));
          return { results: rows } as any;
        }
        return { results: [] } as any;
      },
      async run() {
        if (/INSERT INTO advisor_state/.test(sql)) {
          const [uid, qid] = params;
          const existing = tables.advisor_state.find((r) => r.user_id === uid && r.question_id === qid);
          const now = new Date().toISOString();
          if (existing) {
            existing.last_asked_at = now;
            if (/answer_count = COALESCE/.test(sql)) existing.answer_count = (existing.answer_count || 0) + 1;
          } else {
            tables.advisor_state.push({
              user_id: uid, question_id: qid, last_asked_at: now,
              answer_count: /VALUES \(\?, \?, datetime\('now'\), 1\)/.test(sql) ? 1 : 0,
            });
          }
          return { meta: {} } as any;
        }
        if (/INSERT INTO activity_logs/.test(sql)) {
          const [action, details, user_id] = params;
          tables.activity_logs.push({ action, details, user_id });
          return { meta: {} } as any;
        }
        if (/UPDATE users SET spinout_lab_week/.test(sql)) {
          const [week, uid] = params;
          let u = tables.users.find((r) => r.id === uid);
          if (!u) { u = { id: uid }; tables.users.push(u); }
          u.spinout_lab_week = week;
          return { meta: {} } as any;
        }
        return { meta: {} } as any;
      },
    };
  }
  return { DB: { prepare } as any, _tables: tables } as any;
}

function makeBrokenDb(): any {
  return {
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async all() { throw new Error('boom'); },
          async run() { throw new Error('boom'); },
        };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Test 1 — pure ranking surface (importance + focus + proximity + anti-repeat).
// ---------------------------------------------------------------------------
test('scoreCandidate composes importance × focus + proximity − anti-repeat', () => {
  const base = SM.scoreCandidate(q({ id: 'a', importance: 'normal' }), {
    focusPage: null, week: 1, completedMilestones: new Set(),
    recentlyAsked: new Map(), now: 1000,
  });
  assert.equal(base.score, 2);
  assert.equal(base.breakdown.focus_boost, false);
  assert.equal(base.breakdown.unlock_proximity, false);
  assert.equal(base.breakdown.anti_repeat, false);

  const crit = SM.scoreCandidate(q({ id: 'b', importance: 'critical' }), {
    focusPage: null, week: 1, completedMilestones: new Set(),
    recentlyAsked: new Map(), now: 0,
  });
  assert.equal(crit.score, SM.IMPORTANCE_SCORE.critical);
  assert.equal(crit.breakdown.importance, 4);

  const low = SM.scoreCandidate(q({ id: 'c', importance: 'low' }), {
    focusPage: null, week: 1, completedMilestones: new Set(),
    recentlyAsked: new Map(), now: 0,
  });
  assert.equal(low.score, 1);

  // Default importance ('normal') when omitted.
  assert.equal(SM.importanceScore({ id: 'x' } as any), 2);

  // Focus boost on a critical → 4 × 2 = 8.
  const focused = SM.scoreCandidate(q({ id: 'd', importance: 'critical', page_target: '/build' }), {
    focusPage: '/build', week: 1, completedMilestones: new Set(),
    recentlyAsked: new Map(), now: 0,
  });
  assert.equal(focused.score, 8);
  assert.equal(focused.breakdown.focus_boost, true);

  // Mismatched page — no boost.
  const mismatch = SM.scoreCandidate(q({ id: 'e', importance: 'high', page_target: '/other' }), {
    focusPage: '/build', week: 1, completedMilestones: new Set(),
    recentlyAsked: new Map(), now: 0,
  });
  assert.equal(mismatch.score, 3);
  assert.equal(mismatch.breakdown.focus_boost, false);

  // focusPage null → never boosts.
  const noFocus = SM.scoreCandidate(q({ id: 'f', importance: 'normal' }), {
    focusPage: null, week: 1, completedMilestones: new Set(),
    recentlyAsked: new Map(), now: 0,
  });
  assert.equal(noFocus.breakdown.focus_boost, false);

  // Question without page_target → focus comparison short-circuits false.
  assert.equal(SM.isFocusMatch({ id: 'g' } as any, '/build'), false);
});

// ---------------------------------------------------------------------------
// Test 2 — unlock proximity (week + milestone branches).
// ---------------------------------------------------------------------------
test('isUnlockProximate fires only on next-week / one-missing-milestone', () => {
  // No unlock_required → false.
  assert.equal(SM.isUnlockProximate(q({ id: 'a' }), 1, new Set()), false);

  // week === currentWeek + 1 → proximate.
  assert.equal(SM.isUnlockProximate(q({ id: 'b', unlock_required: { week: 2 } }), 1, new Set()), true);

  // Far week → not proximate.
  assert.equal(SM.isUnlockProximate(q({ id: 'c', unlock_required: { week: 4 } }), 1, new Set()), false);

  // Exactly one missing milestone → proximate.
  const ms = q({ id: 'd', unlock_required: { milestones: ['m1', 'm2'] } });
  assert.equal(SM.isUnlockProximate(ms, 1, new Set(['m1'])), true);

  // Zero missing → already unlocked, not "proximate".
  assert.equal(SM.isUnlockProximate(ms, 1, new Set(['m1', 'm2'])), false);

  // Two missing → not proximate.
  assert.equal(SM.isUnlockProximate(ms, 1, new Set()), false);

  // Empty milestones array → false.
  assert.equal(SM.isUnlockProximate(q({ id: 'e', unlock_required: { milestones: [] } }), 1, new Set()), false);

  // Proximity bonus shows up in score.
  const cand = SM.scoreCandidate(
    q({ id: 'p', importance: 'normal', unlock_required: { week: 2 } }),
    { focusPage: null, week: 1, completedMilestones: new Set(), recentlyAsked: new Map(), now: 0 },
  );
  assert.equal(cand.score, 2 + SM.UNLOCK_PROXIMITY_BOOST);
  assert.equal(cand.breakdown.unlock_proximity, true);
});

// ---------------------------------------------------------------------------
// Test 3 — anti-repeat penalty + recency window edges.
// ---------------------------------------------------------------------------
test('isRecentlyAsked applies −100 inside the 5-minute window only', () => {
  const recent = new Map([['a', 1_000_000]]);
  assert.equal(SM.isRecentlyAsked('a', recent, 1_000_000 + 60_000), true);
  assert.equal(SM.isRecentlyAsked('a', recent, 1_000_000 + SM.ANTI_REPEAT_WINDOW_MS + 1), false);
  // Boundary: now - t === window → strict <, so NOT recent.
  assert.equal(SM.isRecentlyAsked('a', recent, 1_000_000 + SM.ANTI_REPEAT_WINDOW_MS), false);
  // Unknown id → false.
  assert.equal(SM.isRecentlyAsked('zz', recent, 1_000_000), false);

  // Penalty pulls a critical question down below a fresh normal one.
  const critRecent = SM.scoreCandidate(q({ id: 'a', importance: 'critical' }), {
    focusPage: null, week: 1, completedMilestones: new Set(),
    recentlyAsked: recent, now: 1_000_000 + 1000,
  });
  assert.equal(critRecent.score, 4 + SM.ANTI_REPEAT_PENALTY);
  assert.equal(critRecent.breakdown.anti_repeat, true);

  const normFresh = SM.scoreCandidate(q({ id: 'b', importance: 'normal' }), {
    focusPage: null, week: 1, completedMilestones: new Set(),
    recentlyAsked: new Map(), now: 1_000_000 + 1000,
  });
  assert.ok(normFresh.score > critRecent.score);
});

// ---------------------------------------------------------------------------
// Test 4 — pickNext orders by composite score, drops answered, returns queue.
// ---------------------------------------------------------------------------
test('pickNext drops answered ids and returns top-of-queue + capped queue', () => {
  const bank = [
    q({ id: 'a', importance: 'low' }),
    q({ id: 'b', importance: 'normal' }),
    q({ id: 'c', importance: 'critical', page_target: '/build' }),
    q({ id: 'd', importance: 'high', page_target: '/other', unlock_required: { week: 2 } }),
    q({ id: 'e', importance: 'normal' }),
  ];
  const ctx = {
    focusPage: '/build', week: 1, completedMilestones: new Set<string>(),
    recentlyAsked: new Map<string, number>(), now: 0,
  };
  const r = SM.pickNext(bank, new Set(), ctx);
  // 'c' wins: critical (4) × focus (×2) = 8.
  assert.equal(r.next!.id, 'c');
  // 'd' next: high (3) + proximity (+5) = 8 — tied 8, lexicographic
  // tiebreak by id ascending puts 'c' first then 'd'.
  assert.equal(r.queue.length, 5);
  assert.equal(r.queue[0].question.id, 'c');
  assert.equal(r.queue[1].question.id, 'd');

  // Answered ids dropped.
  const r2 = SM.pickNext(bank, new Set(['c', 'd']), ctx);
  assert.notEqual(r2.next?.id, 'c');
  assert.notEqual(r2.next?.id, 'd');
  assert.equal(r2.queue.find((c) => c.question.id === 'c'), undefined);

  // Empty bank.
  const r3 = SM.pickNext([], new Set(), ctx);
  assert.equal(r3.next, null);
  assert.deepEqual(r3.queue, []);

  // All answered.
  const r4 = SM.pickNext(bank, new Set(['a', 'b', 'c', 'd', 'e']), ctx);
  assert.equal(r4.next, null);

  // queueLimit clamps the returned slice.
  const r5 = SM.pickNext(bank, new Set(), ctx, 2);
  assert.equal(r5.queue.length, 2);

  // publicCandidate exposes the documented shape.
  const pub = SM.publicCandidate(r.queue[0]);
  assert.equal(pub.id, 'c');
  assert.equal(typeof pub.score, 'number');
  assert.equal((pub.breakdown as any).focus_boost, true);
});

// ---------------------------------------------------------------------------
// Test 5 — D1 helpers + nextTurn + onAnswered side effects + error paths.
// ---------------------------------------------------------------------------
test('nextTurn loads state, ranks, marks asked, and onAnswered fires hooks', async () => {
  const env = makeDb();

  env._tables.advisor_answers.push({ user_id: 7, question_id: 'a', saved_status: 'saved' });
  env._tables.advisor_answers.push({ user_id: 7, question_id: 'b', saved_status: 'skipped' });
  env._tables.advisor_answers.push({ user_id: 7, question_id: 'old', saved_status: 'failed' });

  const ans = await SM.loadAnsweredForUser(env, 7);
  assert.deepEqual([...ans].sort(), ['a', 'b']);

  const nowMs = Date.now();
  const insideIso  = new Date(nowMs - 60_000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  const outsideIso = new Date(nowMs - 10 * 60_000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  env._tables.advisor_state.push({ user_id: 7, question_id: 'c', last_asked_at: insideIso });
  env._tables.advisor_state.push({ user_id: 7, question_id: 'old', last_asked_at: outsideIso });

  const recent = await SM.loadRecentlyAsked(env, 7, nowMs - SM.ANTI_REPEAT_WINDOW_MS);
  assert.equal(recent.has('c'), true);
  assert.equal(recent.has('old'), false);

  const bank = [
    q({ id: 'a', importance: 'critical' }),  // answered → dropped
    q({ id: 'c', importance: 'critical' }),  // recently-asked → 4 − 100 = −96
    q({ id: 'd', importance: 'normal' }),    // 2
  ];
  const result = await SM.nextTurn(env, 7, bank, {
    focusPage: null, week: 1, completedMilestones: new Set(), now: nowMs,
  });
  assert.equal(result.next_question!.id, 'd');
  assert.ok(env._tables.advisor_state.find((r: StateRow) => r.question_id === 'd'));

  // onAnswered: counter bump + activity log + week advance.
  const advancingQ = q({
    id: 'm.lab.week1', importance: 'high',
    unlock_required: { week: 2, advances_week: true },
  });
  const se = await SM.onAnswered(env, 7, advancingQ, 'value-text', 1);
  assert.equal(se.counter_bumped, true);
  assert.equal(se.notification_emitted, true);
  assert.equal(se.week_advanced, true);
  assert.equal(se.new_week, 2);
  assert.ok(env._tables.activity_logs.some((r: LogRow) => r.action === 'advisor.answered'));
  assert.equal(env._tables.users.find((u: UserRow) => u.id === 7)!.spinout_lab_week, 2);

  // Second call increments answer_count rather than re-inserting.
  await SM.onAnswered(env, 7, advancingQ, 'v2', 2);
  const counter = env._tables.advisor_state.find((r: StateRow) => r.question_id === 'm.lab.week1')!;
  assert.equal(counter.answer_count, 2);

  // Question without advances_week → no week change.
  const plain = q({ id: 'plain', importance: 'normal' });
  const se2 = await SM.onAnswered(env, 7, plain, 'x', 2);
  assert.equal(se2.week_advanced, false);
  assert.equal(se2.new_week, null);

  // currentWeek already at 4 → no advance.
  const cap = q({ id: 'cap', unlock_required: { advances_week: true } });
  const se3 = await SM.onAnswered(env, 7, cap, 'x', 4);
  assert.equal(se3.week_advanced, false);

  // Broken DB — every helper degrades to its safe default.
  const broken = makeBrokenDb();
  assert.equal((await SM.loadAnsweredForUser(broken, 99)).size, 0);
  assert.equal((await SM.loadRecentlyAsked(broken, 99, 0)).size, 0);
  await SM.markAsked(broken, 99, 'qq'); // must not throw
  const seBroken = await SM.onAnswered(broken, 99, plain, 'x', 1);
  assert.equal(seBroken.counter_bumped, false);
  assert.equal(seBroken.notification_emitted, false);
  assert.equal(seBroken.week_advanced, false);

  // nextTurn against an empty bank returns null + empty queue (no markAsked).
  const empty = await SM.nextTurn(env, 7, [], {
    focusPage: null, week: 1, completedMilestones: new Set(), now: nowMs,
  });
  assert.equal(empty.next_question, null);
  assert.deepEqual(empty.queue, []);

  // nextTurn with the default `now` exercises the `?? Date.now()` branch.
  const live = await SM.nextTurn(env, 7, [q({ id: 'fresh' })], {
    focusPage: null, week: 1, completedMilestones: new Set(),
  });
  assert.equal(live.next_question!.id, 'fresh');
});
