/**
 * Pipeline vote tally round-trip (Worker / D1 path).
 *
 * The regression this pins is a missing GET. For a long stretch the
 * worker served only `POST /api/pipeline/votes/:deal_id`, while the
 * React client called `api.getVotes()` on mount from PipelinePage's
 * VoteWidget and fanned it out across every deal from
 * PipelineCommitPage. Both callers `.catch(() => {})`, so the 404 was
 * silent: a tally appeared the moment you voted and was gone on the
 * next page load. Nothing in the suite noticed, because nothing read
 * a tally back.
 *
 * So the assertion that matters here is the round-trip — what the POST
 * returns and what a later GET returns have to be the same numbers.
 * Both now share `buildPublicTally()`; these tests are what keeps them
 * sharing it.
 *
 * Drives the real Hono app against a stateful in-memory D1 stub.
 *
 * Run with the strip-types loader (see package.json test:drift):
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/pipeline_votes_tally.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import votes from '../src/routes/votes.ts';

/**
 * `requireAuth` throws rather than returning null, and the status it
 * turns into is decided by the global `app.onError` in index.ts:948.
 * Driving the bare sub-app would therefore report a 500 for a missing
 * token and prove nothing about production, so the router is mounted
 * here under the same mapping it runs under at axal.vc
 * (AUTH_ERROR_STATUSES, index.ts:940).
 */
const app = new Hono();
app.route('/', votes);
app.onError((err: any, c) => {
  const msg = (err?.message ?? '') as string;
  if (msg === 'Unauthorized') return c.json({ detail: msg }, 401);
  if (msg === 'Forbidden') return c.json({ detail: msg }, 403);
  return c.json({ detail: 'Internal server error' }, 500);
});

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // >= 32 bytes
const DEAL = 7;

type VoteRow = {
  id: number; deal_id: number; user_id: number; vote_type: string;
  weight: number; comment: string | null; anonymous: number; updated_at: string;
};

async function mintToken(userId: number, role: string): Promise<string> {
  // No `jti` so getCurrentUser skips the user_sessions revocation lookup.
  return new SignJWT({ user_id: userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/**
 * Stateful `pipeline_votes` stub. Rows really persist across requests,
 * which is the whole point: a tally that only ever came back from the
 * same call that wrote it would have passed against the broken build.
 */
function makeEnv(users: any[]) {
  const rows: VoteRow[] = [];
  let nextId = 1;
  const thresholdLog = new Set<number>();

  const handle = (rawSql: string) => {
    const s = rawSql.toLowerCase().replace(/\s+/g, ' ');
    let bound: any[] = [];
    const api: any = {
      bind: (...a: any[]) => { bound = a; return api; },
      async all() {
        if (s.includes('from users where id')) {
          const u = users.find((x) => x.id === bound[0]);
          return { results: u ? [u] : [] };
        }
        if (s.includes("from users where role = 'admin'")) {
          return { results: users.filter((u) => u.role === 'admin').map((u) => ({ id: u.id })) };
        }
        // Comment list — LEFT JOIN users, non-empty comments, newest first.
        if (s.includes('from pipeline_votes v')) {
          return {
            results: rows
              .filter((r) => r.deal_id === bound[0] && r.comment)
              .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
              .map((r) => ({
                ...r,
                voter_name: users.find((u) => u.id === r.user_id)?.name ?? null,
              })),
          };
        }
        // Grouped tally.
        if (s.includes('from pipeline_votes') && s.includes('group by vote_type')) {
          const mine = rows.filter((r) => r.deal_id === bound[0]);
          const byType = new Map<string, { count: number; weight: number }>();
          for (const r of mine) {
            const cur = byType.get(r.vote_type) || { count: 0, weight: 0 };
            cur.count++; cur.weight += r.weight;
            byType.set(r.vote_type, cur);
          }
          return {
            results: [...byType.entries()].map(([vote_type, v]) => ({
              vote_type, count: v.count, weight: v.weight,
            })),
          };
        }
        return { results: [] };
      },
      async first() {
        if (s.includes('from pipeline_votes where deal_id = ? and user_id = ?')) {
          return rows.find((r) => r.deal_id === bound[0] && r.user_id === bound[1]) ?? null;
        }
        return null;
      },
      async run() {
        if (s.startsWith('insert into pipeline_votes')) {
          // bound: deal_id, user_id, vote_type, weight, comment, anonymous
          rows.push({
            id: nextId++, deal_id: bound[0], user_id: bound[1], vote_type: bound[2],
            weight: bound[3], comment: bound[4], anonymous: bound[5],
            updated_at: `2026-08-21T00:00:${String(nextId).padStart(2, '0')}Z`,
          });
        } else if (s.startsWith('update pipeline_votes')) {
          // bound: vote_type, weight, comment, anonymous, deal_id, user_id
          const row = rows.find((r) => r.deal_id === bound[4] && r.user_id === bound[5]);
          if (row) {
            row.vote_type = bound[0]; row.weight = bound[1];
            row.comment = bound[2]; row.anonymous = bound[3];
          }
        } else if (s.includes('insert or ignore into pipeline_vote_threshold_log')) {
          const already = thresholdLog.has(bound[0]);
          thresholdLog.add(bound[0]);
          return { meta: { changes: already ? 0 : 1 } };
        }
        return { meta: { changes: 1 } };
      },
    };
    return api;
  };

  return {
    JWT_SECRET,
    ENVIRONMENT: 'development',
    DB: {
      prepare: (sql: string) => handle(sql),
      async batch(stmts: any[]) { return (stmts || []).map(() => ({ results: [] })); },
    },
  };
}

function req(env: any, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.request(
    path,
    { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } },
    env,
  );
}

const USERS = [
  { id: 1, name: 'Ada Admin', role: 'admin', email: 'ada@example.com', is_active: 1 },
  { id: 2, name: 'Pat Partner', role: 'partner', email: 'pat@example.com', is_active: 1 },
  { id: 3, name: 'Fay Founder', role: 'founder', email: 'fay@example.com', is_active: 1 },
];

async function cast(env: any, userId: number, role: string, body: any) {
  const token = await mintToken(userId, role);
  return req(env, token, `/${DEAL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('a cast vote is still there on the next page load', async () => {
  const env = makeEnv(USERS);
  const written = await (await cast(env, 1, 'admin', { vote_type: 'Strong_Buy' })).json() as any;

  const res = await req(env, await mintToken(1, 'admin'), `/${DEAL}`);
  assert.equal(res.status, 200, 'the GET used to 404 — that was the whole bug');
  const read = await res.json() as any;

  assert.equal(read.total_voters, written.total_voters);
  assert.equal(read.total_weight, written.total_weight);
  assert.equal(read.strong_buy_pct, written.strong_buy_pct);
  assert.deepEqual(read.by_type, written.by_type);
  assert.equal(read.threshold_reached, written.threshold_reached);
});

test('an unvoted deal returns a zeroed tally, not an error', async () => {
  // PipelineCommitPage fans this call out across every deal on the board.
  // An error per unvoted deal would be noise standing in for a fact.
  const env = makeEnv(USERS);
  const res = await req(env, await mintToken(2, 'partner'), '/4242');
  assert.equal(res.status, 200);
  const t = await res.json() as any;
  assert.equal(t.total_voters, 0);
  assert.equal(t.total_weight, 0);
  assert.equal(t.strong_buy_pct, 0);
  assert.equal(t.my_vote, null);
  assert.deepEqual(Object.keys(t.by_type).sort(), ['Buy', 'Hold', 'Pass', 'Strong_Buy']);
});

test('the tally aggregates across voters at their role weights', async () => {
  const env = makeEnv(USERS);
  await cast(env, 1, 'admin', { vote_type: 'Strong_Buy' });   // weight 3
  await cast(env, 2, 'partner', { vote_type: 'Buy' });        // weight 2
  await cast(env, 3, 'founder', { vote_type: 'Pass' });       // weight 1

  const t = await (await req(env, await mintToken(3, 'founder'), `/${DEAL}`)).json() as any;
  assert.equal(t.total_voters, 3);
  assert.equal(t.total_weight, 6);
  // Strong_Buy + Buy = 5 of 6 weighted.
  assert.equal(t.strong_buy_pct, 83.3);
  assert.equal(t.by_type.Strong_Buy.weight, 3);
  assert.equal(t.by_type.Pass.count, 1);
});

test('my_vote is the viewer\'s own row, not whoever voted last', async () => {
  const env = makeEnv(USERS);
  await cast(env, 1, 'admin', { vote_type: 'Strong_Buy', comment: 'in' });
  await cast(env, 3, 'founder', { vote_type: 'Pass', comment: 'out' });

  const asAdmin = await (await req(env, await mintToken(1, 'admin'), `/${DEAL}`)).json() as any;
  const asFounder = await (await req(env, await mintToken(3, 'founder'), `/${DEAL}`)).json() as any;
  assert.equal(asAdmin.my_vote.vote_type, 'Strong_Buy');
  assert.equal(asFounder.my_vote.vote_type, 'Pass');
  // Same public tally for both — personal state never leaks into it.
  assert.equal(asAdmin.total_weight, asFounder.total_weight);
});

test('a viewer who has not voted gets my_vote null while the tally still reads', async () => {
  const env = makeEnv(USERS);
  await cast(env, 1, 'admin', { vote_type: 'Buy' });
  const t = await (await req(env, await mintToken(2, 'partner'), `/${DEAL}`)).json() as any;
  assert.equal(t.my_vote, null);
  assert.equal(t.total_voters, 1);
});

test('comments are withheld unless asked for', async () => {
  const env = makeEnv(USERS);
  await cast(env, 1, 'admin', { vote_type: 'Buy', comment: 'good team' });

  const plain = await (await req(env, await mintToken(1, 'admin'), `/${DEAL}`)).json() as any;
  assert.equal(plain.comments, undefined, 'the default payload stays small');

  const withComments = await (await req(
    env, await mintToken(1, 'admin'), `/${DEAL}?include_comments=true`,
  )).json() as any;
  assert.equal(withComments.comments.length, 1);
  assert.equal(withComments.comments[0].comment, 'good team');
  assert.equal(withComments.comments[0].voter_name, 'Ada Admin');
});

test('an anonymous voter\'s name never leaves the worker', async () => {
  const env = makeEnv(USERS);
  await cast(env, 3, 'founder', { vote_type: 'Pass', comment: 'weak moat', anonymous: true });

  const res = await req(env, await mintToken(1, 'admin'), `/${DEAL}?include_comments=true`);
  const body = await res.text();
  assert.ok(!body.includes('Fay Founder'), 'redaction must happen server-side, not in the client');
  const t = JSON.parse(body);
  assert.equal(t.comments[0].voter_name, 'Anonymous');
  assert.equal(t.comments[0].comment, 'weak moat', 'the comment itself still shows');
});

test('votes without a comment are not listed as empty comments', async () => {
  const env = makeEnv(USERS);
  await cast(env, 1, 'admin', { vote_type: 'Buy' });
  await cast(env, 2, 'partner', { vote_type: 'Hold', comment: 'wait for the pilot' });

  const t = await (await req(
    env, await mintToken(1, 'admin'), `/${DEAL}?include_comments=true`,
  )).json() as any;
  assert.equal(t.comments.length, 1);
});

test('changing your vote replaces it rather than stacking a second one', async () => {
  const env = makeEnv(USERS);
  await cast(env, 2, 'partner', { vote_type: 'Buy' });
  await cast(env, 2, 'partner', { vote_type: 'Pass' });

  const t = await (await req(env, await mintToken(2, 'partner'), `/${DEAL}`)).json() as any;
  assert.equal(t.total_voters, 1, 'one voter, one vote');
  assert.equal(t.total_weight, 2);
  assert.equal(t.by_type.Buy.count, 0);
  assert.equal(t.by_type.Pass.count, 1);
  assert.equal(t.my_vote.vote_type, 'Pass');
});

test('the GET requires auth', async () => {
  const env = makeEnv(USERS);
  const res = await app.request(`/${DEAL}`, {}, env);
  assert.equal(res.status, 401);
});

test('a non-numeric segment is rejected instead of being coerced to a deal', async () => {
  // `/:deal_id` is a catch-all over this router's root, so anything that
  // is not a bare integer — a future static sibling like /leaderboard
  // included — must fail loudly rather than parse to NaN or to a prefix.
  const env = makeEnv(USERS);
  const token = await mintToken(1, 'admin');
  for (const bad of ['leaderboard', '7x', 'abc']) {
    const res = await req(env, token, `/${bad}`);
    assert.equal(res.status, 400, `${bad} should not resolve to a deal`);
  }
});

test('the threshold flag agrees between the write and the read', async () => {
  // 5 voters and weight >= 12 is what pages admins. If the POST said
  // "reached" and a reload said otherwise, the banner would flicker on
  // a decision gate.
  const env = makeEnv([
    ...USERS,
    { id: 4, name: 'Ivy Investor', role: 'investor', email: 'ivy@example.com', is_active: 1 },
    { id: 5, name: 'Sam Second', role: 'investor', email: 'sam@example.com', is_active: 1 },
  ]);
  await cast(env, 1, 'admin', { vote_type: 'Strong_Buy' });    // 3
  await cast(env, 2, 'partner', { vote_type: 'Buy' });         // 2
  await cast(env, 3, 'founder', { vote_type: 'Buy' });         // 1
  await cast(env, 4, 'investor', { vote_type: 'Strong_Buy' }); // 3
  const last = await (await cast(env, 5, 'investor', { vote_type: 'Buy' })).json() as any; // 3

  assert.equal(last.total_voters, 5);
  assert.equal(last.total_weight, 12);
  assert.equal(last.threshold_reached, true);

  const read = await (await req(env, await mintToken(1, 'admin'), `/${DEAL}`)).json() as any;
  assert.equal(read.threshold_reached, true);
  assert.deepEqual(read.threshold, last.threshold);
});
