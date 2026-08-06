/**
 * Automatic graduation-certificate issuance.
 *
 * The registry shipped complete — issue, revoke, list, mine, sharing, plus a
 * live public verifier — and NOTHING EVER CALLED IT. No admin surface bound
 * the issue route and no server path invoked it, so not one credential had
 * ever been allocated and every graduate's page honestly read "not yet
 * issued". These tests cover the module that closes that.
 *
 * The properties that matter, and why:
 *
 *   • Idempotence. Issuance hangs off a milestone write that can fire more
 *     than once (the canonical route AND the advisor write-router both record
 *     `incorporation_completed`). A second call must never mint a second
 *     credential — the founder would then have two ids for one graduation.
 *
 *   • Never throws. It runs as a side effect of graduation. A founder
 *     finishing the program must not have their completion rejected because a
 *     certificate insert failed.
 *
 *   • Refuses to mint a nameless credential. A certificate whose holder line
 *     reads "null" is worse than no certificate: it is a broken artifact
 *     someone may hand to an investor. Leaving it unissued lets the backfill
 *     retry once the profile is complete.
 *
 * Run with the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/certificateIssuance.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { issueOnGraduation, backfillCertificates } from '../src/services/certificateIssuance.ts';

// ---------------------------------------------------------------------------
// A D1 stand-in driven by a tiny scripted table. Each prepare() is matched by
// the distinctive fragment of its SQL, so the mock stays readable and a
// rewritten query fails loudly rather than silently matching the wrong branch.
// ---------------------------------------------------------------------------

type Scenario = {
  existingCert?: { id: number } | null;
  facts?: Record<string, unknown> | null;
  insertChanges?: number;
  backfillRows?: Array<{ user_id: number }>;
  throwOn?: string;
};

function fakeEnv(s: Scenario) {
  const calls: Array<{ sql: string; binds: unknown[] }> = [];
  const answer = (sql: string) => {
    if (sql.includes("FROM spinout_certificates WHERE user_id = ? AND status = 'issued'")) {
      return { first: s.existingCert ?? null };
    }
    if (sql.includes('JOIN spinout_lab_milestones m')) return { first: s.facts ?? null };
    if (sql.includes('INSERT OR IGNORE INTO spinout_certificates')) {
      return { run: { meta: { changes: s.insertChanges ?? 1 } } };
    }
    if (sql.includes('SELECT DISTINCT m.user_id')) {
      return { all: { results: s.backfillRows ?? [] } };
    }
    return { first: null, all: { results: [] }, run: { meta: { changes: 0 } } };
  };
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            calls.push({ sql, binds });
            const a = answer(sql);
            // Real D1 raises from the awaited call, not from bind().
            const boom = () => { if (s.throwOn && sql.includes(s.throwOn)) throw new Error('boom'); };
            return {
              async first() { boom(); return (a as any).first ?? null; },
              async all() { boom(); return (a as any).all ?? { results: [] }; },
              async run() { boom(); return (a as any).run ?? { meta: { changes: 0 } }; },
            };
          },
        };
      },
    },
  };
  return { env: env as never, calls };
}

const GRADUATE = {
  user_id: 117,
  name: 'Ada Lovelace',
  started_at: '2026-07-01 00:00:00',
  conferred_at: '2026-07-31 14:02:00',
  cohort: 'Cohort 4',
  project_id: 9,
  project_name: 'Analytical Engines Inc',
  application_company: 'AE',
  jurisdiction: 'Delaware C-Corp',
};

// ---------------------------------------------------------------------------
// The happy path, and what lands in the snapshot.
// ---------------------------------------------------------------------------

test('a graduate with no credential gets one issued', async () => {
  const { env, calls } = fakeEnv({ facts: GRADUATE });
  assert.equal(await issueOnGraduation(env, 117), 'issued');
  const ins = calls.find((c) => c.sql.includes('INSERT OR IGNORE INTO spinout_certificates'));
  assert.ok(ins, 'an insert was attempted');
  const [credentialId, userId, projectId, name, company, cohort, issuedOn, juris, days, ] = ins!.binds;
  assert.equal(credentialId, 'AXL-SOL-C4-260731-0117');
  assert.equal(userId, 117);
  assert.equal(projectId, 9);
  assert.equal(name, 'Ada Lovelace');
  assert.equal(cohort, 'Cohort 4');
  assert.equal(issuedOn, '2026-07-31', 'the date is the milestone day, not now()');
  assert.equal(juris, 'Delaware C-Corp');
  assert.equal(days, 31, 'inclusive day count, matching the page');
  assert.equal(company, 'Analytical Engines Inc', 'the Lab project name wins over the application');
});

test('the company falls back to the application when there is no project', async () => {
  const { env, calls } = fakeEnv({ facts: { ...GRADUATE, project_id: null, project_name: null } });
  assert.equal(await issueOnGraduation(env, 117), 'issued');
  const ins = calls.find((c) => c.sql.includes('INSERT OR IGNORE'))!;
  assert.equal(ins.binds[4], 'AE');
});

test('issued_by_user_id is NULL — nobody issued this by hand', async () => {
  // Writing a real admin id would misattribute an automatic action to a
  // person in the audit trail.
  const { env, calls } = fakeEnv({ facts: GRADUATE });
  await issueOnGraduation(env, 117);
  const ins = calls.find((c) => c.sql.includes('INSERT OR IGNORE'))!;
  assert.match(ins.sql, /issued_by_user_id\)\s*VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, NULL\)/);
});

// ---------------------------------------------------------------------------
// Idempotence — two graduation paths write the same milestone.
// ---------------------------------------------------------------------------

test('a founder who already holds a credential is not issued a second', async () => {
  const { env, calls } = fakeEnv({ existingCert: { id: 5 }, facts: GRADUATE });
  assert.equal(await issueOnGraduation(env, 117), 'already_issued');
  assert.ok(!calls.some((c) => c.sql.includes('INSERT OR IGNORE')), 'no insert attempted');
});

test('a racing insert that changes nothing reports already_issued, not issued', async () => {
  // The registry's partial UNIQUE index on (user_id) WHERE status='issued' is
  // the real guard; INSERT OR IGNORE turns the race into 0 changes.
  const { env } = fakeEnv({ facts: GRADUATE, insertChanges: 0 });
  assert.equal(await issueOnGraduation(env, 117), 'already_issued');
});

// ---------------------------------------------------------------------------
// Refusals — each leaves the founder issuable later rather than minting junk.
// ---------------------------------------------------------------------------

test('a non-graduate is refused', async () => {
  const { env, calls } = fakeEnv({ facts: null });
  assert.equal(await issueOnGraduation(env, 117), 'not_graduated');
  assert.ok(!calls.some((c) => c.sql.includes('INSERT OR IGNORE')));
});

test('a graduate row with no conferral date is refused', async () => {
  const { env } = fakeEnv({ facts: { ...GRADUATE, conferred_at: null } });
  assert.equal(await issueOnGraduation(env, 117), 'not_graduated');
});

test('a nameless founder is refused rather than given a credential reading null', async () => {
  for (const name of [null, '', '   ']) {
    const { env, calls } = fakeEnv({ facts: { ...GRADUATE, name } });
    assert.equal(await issueOnGraduation(env, 117), 'insufficient_data', `name=${JSON.stringify(name)}`);
    assert.ok(!calls.some((c) => c.sql.includes('INSERT OR IGNORE')));
  }
});

test('an invalid user id is refused before any query runs', async () => {
  const { env, calls } = fakeEnv({ facts: GRADUATE });
  for (const id of [0, -1, NaN]) {
    assert.equal(await issueOnGraduation(env, id), 'insufficient_data');
  }
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// It never throws — graduation must not fail because issuance did.
// ---------------------------------------------------------------------------

test('a database failure returns an outcome instead of throwing', async () => {
  const { env } = fakeEnv({ facts: GRADUATE, throwOn: 'INSERT OR IGNORE' });
  assert.equal(await issueOnGraduation(env, 117), 'error');
});

test('a failure reading the existing-certificate check degrades to issuing', async () => {
  // The pre-check is an optimisation; the UNIQUE index is the real guard, so
  // losing the check must not block a legitimate first issuance.
  const { env } = fakeEnv({ facts: GRADUATE, throwOn: "status = 'issued'" });
  assert.equal(await issueOnGraduation(env, 117), 'issued');
});

// ---------------------------------------------------------------------------
// Program days.
// ---------------------------------------------------------------------------

test('program days is computed from the real start and conferral', async () => {
  const cases: Array<[string | null, string | null, number | null]> = [
    ['2026-07-01 00:00:00', '2026-07-29 00:00:00', 29],
    ['2026-07-01 00:00:00', '2026-07-01 00:00:00', 1],
    [null, '2026-07-29 00:00:00', null],
    ['2026-07-01 00:00:00', null, null],
    ['2026-08-01 00:00:00', '2026-07-01 00:00:00', null], // conferred before start
  ];
  for (const [started, conferred, want] of cases) {
    const { env, calls } = fakeEnv({ facts: { ...GRADUATE, started_at: started, conferred_at: conferred } });
    const r = await issueOnGraduation(env, 117);
    if (conferred == null) { assert.equal(r, 'not_graduated'); continue; }
    const ins = calls.find((c) => c.sql.includes('INSERT OR IGNORE'))!;
    assert.equal(ins.binds[8], want, `started=${started} conferred=${conferred}`);
  }
});

// ---------------------------------------------------------------------------
// Backfill.
// ---------------------------------------------------------------------------

test('the backfill issues for each pending graduate', async () => {
  const { env } = fakeEnv({ backfillRows: [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }], facts: GRADUATE });
  const r = await backfillCertificates(env, 100);
  assert.equal(r.scanned, 3);
  assert.equal(r.issued, 3);
  assert.equal(r.remaining, 0);
});

test('the backfill is bounded and reports what it did not reach', async () => {
  // It fetches limit+1 purely to answer "is there more?" — a caller that
  // stopped at `issued` would wrongly believe the queue was drained.
  const rows = Array.from({ length: 6 }, (_, i) => ({ user_id: i + 1 }));
  const { env } = fakeEnv({ backfillRows: rows, facts: GRADUATE });
  const r = await backfillCertificates(env, 5);
  assert.equal(r.scanned, 5);
  assert.equal(r.remaining, 1);
});

test('the backfill clamps an absurd limit rather than trusting the caller', async () => {
  const { env, calls } = fakeEnv({ backfillRows: [], facts: GRADUATE });
  await backfillCertificates(env, 10_000);
  const q = calls.find((c) => c.sql.includes('SELECT DISTINCT m.user_id'))!;
  assert.equal(q.binds[0], 501, 'capped at 500 (+1 lookahead)');
  await backfillCertificates(env, 0);
  const q2 = calls.filter((c) => c.sql.includes('SELECT DISTINCT m.user_id'))[1]!;
  assert.equal(q2.binds[0], 101, 'a falsy limit takes the default, not zero');
});

test('a graduate the backfill cannot issue is skipped, not counted as issued', async () => {
  const { env } = fakeEnv({ backfillRows: [{ user_id: 1 }], facts: { ...GRADUATE, name: null } });
  const r = await backfillCertificates(env, 100);
  assert.equal(r.scanned, 1);
  assert.equal(r.issued, 0);
  assert.equal(r.skipped, 1);
});

test('the backfill only considers graduates without an issued credential', async () => {
  const { env, calls } = fakeEnv({ backfillRows: [], facts: GRADUATE });
  await backfillCertificates(env, 10);
  const q = calls.find((c) => c.sql.includes('SELECT DISTINCT m.user_id'))!;
  assert.match(q.sql, /milestone_key = 'incorporation_completed'/);
  assert.match(q.sql, /c\.id IS NULL/);
  assert.match(q.sql, /c\.user_id = m\.user_id AND c\.status = 'issued'/);
});

test('the backfill never throws', async () => {
  const { env } = fakeEnv({ throwOn: 'SELECT DISTINCT m.user_id' });
  const r = await backfillCertificates(env, 10);
  assert.deepEqual(r, { scanned: 0, issued: 0, skipped: 0, remaining: 0 });
});
