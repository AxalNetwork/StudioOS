/**
 * Task #14 — route-level regression for the Personal Advisor's GET /answered.
 *
 * Unblocked by fixing a value-import-of-a-type in services/queue.ts (it imported
 * the `JobType` / `QueueJob` TYPES as values, which the strip-types test runner
 * cannot erase), so `import advisor from '../src/routes/advisor.ts'` now loads
 * cleanly and its ~40 endpoints are finally testable like capital/events/billing.
 *
 * Locks in the Task #13 invariant for the right-rail "Completed" bucket:
 *   - GET /answered returns ONLY rows whose saved_status IN ('saved','noop')
 *     ('skipped' / 'paywalled' / 'failed' captures are excluded);
 *   - scoped to the user's LATEST conversation (older conversations don't leak);
 *   - newest-first (ORDER BY created_at DESC);
 *   - and its length EQUALS the answered_count reported by GET /progress — the
 *     "the Completed list can never disagree with the N/total header" guarantee
 *     (refreshCounts and /progress use the exact same saved/noop predicate).
 *
 * Harness modelled on capital.test.ts: mint a jose JWT, drive
 * advisor.request('/answered', {headers}, env) against an in-memory D1 mock.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/advisor.answered.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import advisor from '../src/routes/advisor.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes

const USER_ID = 7;

// Two conversations for the same user. id=2 is the LATEST (highest id), which
// is the only one /answered + /progress should read from.
const OLD_CONV = 1;
const LATEST_CONV = 2;

// advisor_answers across both conversations, with a spread of saved_status
// values. Only ('saved','noop') rows in the LATEST conversation count.
const ANSWERS = [
  // --- older conversation: must NOT appear in /answered ---
  { id: 1, conversation_id: OLD_CONV, question_id: 'old.saved', saved_status: 'saved', created_at: '2026-05-01T10:00:00Z' },
  { id: 2, conversation_id: OLD_CONV, question_id: 'old.noop', saved_status: 'noop', created_at: '2026-05-02T10:00:00Z' },
  // --- latest conversation ---
  { id: 10, conversation_id: LATEST_CONV, question_id: 'latest.saved.a', saved_status: 'saved', created_at: '2026-06-01T10:00:00Z' },
  { id: 11, conversation_id: LATEST_CONV, question_id: 'latest.noop', saved_status: 'noop', created_at: '2026-06-02T10:00:00Z' },
  { id: 12, conversation_id: LATEST_CONV, question_id: 'latest.skipped', saved_status: 'skipped', created_at: '2026-06-03T10:00:00Z' },
  { id: 13, conversation_id: LATEST_CONV, question_id: 'latest.paywalled', saved_status: 'paywalled', created_at: '2026-06-04T10:00:00Z' },
  { id: 14, conversation_id: LATEST_CONV, question_id: 'latest.saved.b', saved_status: 'saved', created_at: '2026-06-05T10:00:00Z' },
];

// Captured = saved|noop, the predicate refreshCounts() and /progress share.
const CAPTURED = new Set(['saved', 'noop']);
function isCaptured(s: string): boolean { return CAPTURED.has(s); }

// Derive the conversation counters the same way refreshCounts() would, so the
// stored answered_count read by /progress agrees with the live answers table.
function countsFor(convId: number) {
  const rows = ANSWERS.filter((a) => a.conversation_id === convId);
  return {
    answered_count: rows.filter((a) => isCaptured(a.saved_status)).length,
    skipped_count: rows.filter((a) => a.saved_status === 'skipped').length,
  };
}

const LATEST = countsFor(LATEST_CONV);

// Expected /answered ids: latest conversation, saved|noop only, newest-first.
const EXPECTED_ANSWERED_IDS = ANSWERS
  .filter((a) => a.conversation_id === LATEST_CONV && isCaptured(a.saved_status))
  .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id))
  .map((a) => a.question_id);

async function mintToken(userId: number, role: string): Promise<string> {
  // No `jti` so getCurrentUser skips the user_sessions revocation lookup.
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/**
 * In-memory D1 stub. All reads route through prepare().bind().first()/all();
 * writes (exec/run/batch) are accepted as no-ops. PRAGMA table_info returns
 * the full column set so the lazy column-ensure helpers no-op, and the
 * kill-switch / gate lookups resolve to an unblocked, non-founder user.
 */
function makeEnv(user: any, opts: { noConversation?: boolean } = {}): any {
  const handle = (rawSql: string) => {
    const s = rawSql.toLowerCase();
    let bound: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { bound = a; return api; },
      async first() {
        // auth: mi_pro_subscriptions side lookup -> free tier.
        if (s.includes('from mi_pro_subscriptions')) return null;
        // kill-switch lock/shadow probe -> unblocked.
        if (s.includes('advisor_locked') && s.includes('from users')) {
          return { advisor_locked: 0, advisor_shadow_flag: 0 };
        }
        // loadAdvisorGate tier probe.
        if (s.includes('investor_subscription_status') && s.includes('from users')) {
          return { investor_subscription_status: null, subscription_status: null };
        }
        // loadAdvisorGate founder spinout probe (only hit for founders).
        if (s.includes('spinout_lab_active') && s.includes('from users')) {
          return { spinout_lab_active: 0, spinout_lab_week: 1 };
        }
        // getLatestConversation -> the highest-id conversation for the user.
        if (s.includes('from advisor_conversations') && s.includes('order by id desc')) {
          if (opts.noConversation) return null;
          return {
            id: LATEST_CONV, uid: 'conv-latest', user_id: USER_ID, persona: user?.role || 'unknown',
            state: 'active', current_question_id: null,
            total_questions: 20, answered_count: LATEST.answered_count, skipped_count: LATEST.skipped_count,
            created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-05T10:00:00Z',
          };
        }
        return null;
      },
      async all() {
        // auth: SELECT * FROM users WHERE id = ? (via getSQL tagged template).
        if (s.includes('from users where id')) {
          return { results: user ? [user] : [] };
        }
        // Lazy column-ensure / guardrail-column probes: report every column so
        // no ALTER TABLE fires.
        if (s.includes('pragma table_info(users)')) {
          return { results: [
            { name: 'id' }, { name: 'role' }, { name: 'is_active' },
            { name: 'spinout_lab_week' }, { name: 'spinout_lab_active' },
            { name: 'advisor_locked' }, { name: 'advisor_shadow_flag' },
            { name: 'investor_subscription_status' }, { name: 'subscription_status' },
          ] };
        }
        if (s.includes('pragma table_info(advisor_messages)')) {
          return { results: [
            { name: 'id' }, { name: 'safety_score' }, { name: 'sanitisation_actions_json' },
          ] };
        }
        // advisor_answers saved/noop reads (BOTH /answered and /progress). Scope
        // to the bound conversation_id and the saved|noop predicate, newest-first.
        if (s.includes('from advisor_answers') && s.includes("saved_status in ('saved', 'noop')")) {
          const convId = bound[0];
          const rows = ANSWERS
            .filter((a) => a.conversation_id === convId && isCaptured(a.saved_status))
            .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id))
            .map((a) => ({
              question_id: a.question_id,
              saved_to_table: null, saved_to_column: null, saved_to_id: null,
              saved_status: a.saved_status, created_at: a.created_at,
            }));
          return { results: rows };
        }
        // spinout_lab_milestones -> none.
        if (s.includes('from spinout_lab_milestones')) return { results: [] };
        return { results: [] };
      },
      async run() { return { meta: { changes: 1 } }; },
    };
    return api;
  };
  return {
    JWT_SECRET,
    ENVIRONMENT: 'development',
    DB: {
      prepare: (sql: string) => handle(sql),
      async exec() { return { count: 0, duration: 0 }; },
      async batch(stmts: any[]) { return (stmts || []).map(() => ({ results: [] })); },
    },
  };
}

function getAnswered(env: any, token: string): Promise<Response> {
  return advisor.request('/answered', { headers: { Authorization: `Bearer ${token}` } }, env);
}

function getProgress(env: any, token: string): Promise<Response> {
  return advisor.request('/progress', { headers: { Authorization: `Bearer ${token}` } }, env);
}

// --- /answered scope + predicate + ordering ---------------------------------

test('answered: returns only saved/noop rows from the latest conversation, newest-first', async () => {
  const token = await mintToken(USER_ID, 'founder');
  const env = makeEnv({ id: USER_ID, role: 'founder', is_active: 1 });
  const res = await getAnswered(env, token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.conversation_uid, 'conv-latest');
  const ids = body.answered.map((a: any) => a.question_id);
  // Exact order is enforced (newest created_at first).
  assert.deepEqual(ids, EXPECTED_ANSWERED_IDS);
  // Predicate guard: no skipped/paywalled rows leak in.
  assert.ok(body.answered.every((a: any) => a.saved_status === 'saved' || a.saved_status === 'noop'));
  assert.ok(!ids.some((id: string) => id === 'latest.skipped' || id === 'latest.paywalled'));
  // Scope guard: nothing from the older conversation leaks in.
  assert.ok(!ids.some((id: string) => id.startsWith('old.')));
});

test('answered: each row carries the saved_status that admitted it', async () => {
  const token = await mintToken(USER_ID, 'founder');
  const env = makeEnv({ id: USER_ID, role: 'founder', is_active: 1 });
  const res = await getAnswered(env, token);
  const body = (await res.json()) as any;
  const byId = Object.fromEntries(body.answered.map((a: any) => [a.question_id, a.saved_status]));
  assert.equal(byId['latest.saved.a'], 'saved');
  assert.equal(byId['latest.saved.b'], 'saved');
  assert.equal(byId['latest.noop'], 'noop');
});

// --- the count == list invariant against /progress --------------------------

test('answered: list length equals the answered_count reported by /progress', async () => {
  const token = await mintToken(USER_ID, 'founder');
  const env = makeEnv({ id: USER_ID, role: 'founder', is_active: 1 });

  const answeredBody = (await (await getAnswered(env, token)).json()) as any;
  const progressBody = (await (await getProgress(env, token)).json()) as any;

  // Stored counter (refreshCounts-maintained answered_count) agrees with list.
  assert.equal(answeredBody.answered.length, progressBody.answered);
  assert.equal(answeredBody.answered.length, progressBody.overall.answered);
  // Route-derived captured set (computed live in /progress) agrees too — this
  // proves the agreement isn't just the stored counter happening to match.
  assert.equal(answeredBody.answered.length, progressBody._answered_in_conversation);
  // And it matches what we seeded for the latest conversation.
  assert.equal(answeredBody.answered.length, LATEST.answered_count);
});

// --- empty state ------------------------------------------------------------

test('answered: a user with no conversation gets an empty list, not an error', async () => {
  const token = await mintToken(USER_ID, 'founder');
  const env = makeEnv({ id: USER_ID, role: 'founder', is_active: 1 }, { noConversation: true });
  const res = await getAnswered(env, token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.conversation_uid, null);
  assert.deepEqual(body.answered, []);
});

// --- auth guard -------------------------------------------------------------

test('answered: an unauthenticated request is rejected', async () => {
  const env = makeEnv({ id: USER_ID, role: 'founder', is_active: 1 });
  const res = await advisor.request('/answered', {}, env);
  assert.notEqual(res.status, 200);
});
