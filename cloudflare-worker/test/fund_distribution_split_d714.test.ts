/**
 * D714 (#1779) decision 3 — a distribution's preview is what the job writes.
 *
 * The preview route and the `returns_distribution` job both call
 * `splitDistribution`; this drives both on one fixture and compares the
 * preview's lines with the rows the job inserts, cent for cent.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_distribution_split_d714.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import funds from '../src/routes/funds.ts';
import { handleJob } from '../src/services/queueWorker.ts';
import { DEFAULT_CARRY_RATE, splitDistribution } from '../src/services/fundDistributionSplit.ts';
import { makeD1 } from './_d1_sqlite.mjs';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';
const BASELINE = readFileSync(new URL('../sql/schema_baseline.sql', import.meta.url), 'utf8');
const GP = 40;

const SCHEMA = ['users', 'vc_funds', 'limited_partners', 'fund_distributions', 'activity_logs']
  .map((t) => stripForeignKeys(tableFromBaseline(BASELINE, t))).join('\n');

/**
 * Commitments of 333, 333 and 334 split $1,000.01 unevenly, and a 1-dollar
 * commitment against a million rounds to a zero line the job drops.
 */
function makeEnv(lps: string, carry = 0.2): any {
  const { DB, db } = makeD1(SCHEMA, `
INSERT INTO users (id, email, name, role, is_active, investor_tier, investor_subscription_status)
  VALUES (${GP}, 'gp@example.test', 'GP', 'investor', 1, 'institutional', 'active');
INSERT INTO vc_funds (id, name, gp_user_id, carried_interest) VALUES (1, 'Fund 1', ${GP}, ${carry});
INSERT INTO limited_partners (id, fund_id, name, commitment_amount, invested_amount, status) VALUES ${lps};
`);
  return { JWT_SECRET, ENVIRONMENT: 'development', DB, __db: db };
}

async function preview(env: any, proceeds: number) {
  const jwt = await new SignJWT({ user_id: GP }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const res: Response = await (funds.request('/1/distributions/preview', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ proceeds_cents: proceeds }),
  }, env) as Promise<Response>).catch((e: unknown) => { if (e instanceof Response) return e; throw e; });
  return { status: res.status, body: await res.json() as any };
}

async function runJob(env: any, proceeds: number) {
  await handleJob(env, {
    id: 0, job_type: 'returns_distribution', status: 'processing', attempts: 1, max_retries: 3, error: null,
    payload: JSON.stringify({ liquidity_event_id: 9, fund_id: 1, proceeds_cents: proceeds }),
    created_at: '2026-10-17T00:00:00Z', updated_at: '2026-10-17T00:00:00Z',
    started_at: '2026-10-17T00:00:00Z', completed_at: null, dead_at: null,
  } as any);
  return (env.__db.prepare('SELECT lp_id, amount_cents, distribution_type FROM fund_distributions ORDER BY lp_id').all() as any[])
    .map((r) => ({ ...r }));
}

const FIXTURES: Array<[string, string, number]> = [
  ['uneven thirds, profit', `(1, 1, 'A', 333, 100, 'active'), (2, 1, 'B', 333, 100, 'committed'), (3, 1, 'C', 334, 100, 'active'), (4, 1, 'Gone', 999, 0, 'redeemed')`, 100_002],
  ['a line that rounds to zero', `(1, 1, 'Big', 1000000, 0, 'active'), (2, 1, 'Tiny', 1, 0, 'active')`, 999],
  ['return of capital only', `(1, 1, 'A', 600, 5000, 'active'), (2, 1, 'B', 400, 5000, 'active')`, 70_000],
];

test('on each fixture the preview\'s lines equal the rows the job inserts', async () => {
  for (const [name, lps, proceeds] of FIXTURES) {
    const env = makeEnv(lps);
    const p = await preview(env, proceeds);
    assert.equal(p.status, 200, `${name}: ${JSON.stringify(p.body)}`);
    const rows = await runJob(env, proceeds);
    assert.deepEqual(
      p.body.lines.map((l: any) => ({ lp_id: l.lp_id, amount_cents: l.amount_cents, distribution_type: p.body.distribution_type })),
      rows, name,
    );
  }
});

test('the job\'s arithmetic, pinned: basis, carry on profit, each line rounded on its own', async () => {
  // $1,000.02 against $300 invested: 70,002 cents of profit, 14,000 withheld
  // at 20%, 86,002 split 333/333/334 — each share rounds up, so the lines
  // over-allocate by one cent, and the preview says so.
  const env = makeEnv(FIXTURES[0][1]);
  const p = (await preview(env, FIXTURES[0][2])).body;
  assert.deepEqual([p.basis_returned_cents, p.profit_cents, p.carry_withheld_cents, p.distributable_cents], [30_000, 70_002, 14_000, 86_002]);
  assert.deepEqual(p.lines.map((l: any) => [l.lp_id, l.amount_cents]), [[1, 28_639], [2, 28_639], [3, 28_725]]);
  assert.equal(p.unallocated_cents, -1);
  assert.deepEqual((await runJob(env, FIXTURES[0][2])).map((r: any) => r.amount_cents), [28_639, 28_639, 28_725]);
});

test('basis returned and profit make the proceeds; carry, lines and unallocated cents make them too', async () => {
  for (const [name, lps, proceeds] of FIXTURES) {
    const env = makeEnv(lps);
    const p = (await preview(env, proceeds)).body;
    assert.equal(p.basis_returned_cents + p.profit_cents, proceeds, name);
    const lines = p.lines.reduce((s: number, l: any) => s + l.amount_cents, 0);
    assert.equal(p.carry_withheld_cents + lines + p.unallocated_cents, proceeds, name);
    assert.equal(p.carry_rate, 0.2, name);
    assert.equal(p.carry_rate_defaulted, false, name);
  }
  const zero = (await preview(makeEnv(FIXTURES[1][1]), FIXTURES[1][2])).body;
  assert.deepEqual(zero.dropped_lp_ids, [2], 'the zero line is named, not hidden');
  const roc = (await preview(makeEnv(FIXTURES[2][1]), FIXTURES[2][2])).body;
  assert.equal(roc.distribution_type, 'return_of_capital');
  assert.equal(roc.carry_withheld_cents, 0);
});

test('with carried_interest NULL the split reports the job\'s 0.20 default and says so', () => {
  const lps = [{ id: 1, commitment_amount: 1, invested_amount: 0 }];
  const s = splitDistribution(10_000, null, lps);
  assert.equal(s.carry_rate, DEFAULT_CARRY_RATE);
  assert.equal(DEFAULT_CARRY_RATE, 0.2);
  assert.equal(s.carry_rate_defaulted, true);
  assert.equal(s.carry_withheld_cents, 2_000);
  const recorded = splitDistribution(10_000, 0, lps);
  assert.equal(recorded.carry_rate_defaulted, false, 'a recorded 0% is not the default');
  assert.equal(recorded.carry_withheld_cents, 0);
});

test('a fund with no committed LP previews nothing to write, as the job writes nothing', async () => {
  const env = makeEnv(`(1, 1, 'Gone', 500, 0, 'redeemed')`);
  const p = (await preview(env, 10_000)).body;
  assert.equal(p.distributable, false);
  assert.deepEqual(p.lines, []);
  assert.deepEqual(await runJob(env, 10_000), []);
});

test('the preview refuses a non-integer or non-positive amount and writes nothing', async () => {
  const env = makeEnv(FIXTURES[0][1]);
  for (const bad of [0, -5, 1.5]) {
    const p = await preview(env, bad);
    assert.equal(p.status, 400, String(bad));
    assert.equal(p.body.error, 'invalid_amount');
  }
  assert.equal(env.__db.prepare('SELECT COUNT(*) AS n FROM fund_distributions').get().n, 0);
});
