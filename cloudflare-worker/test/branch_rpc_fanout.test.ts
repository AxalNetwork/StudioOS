/**
 * D108 — HQ reads every branch at once, and one failure stays local.
 *
 * THE ASSERTION THIS FILE EXISTS FOR is the third test: when one binding
 * rejects and another answers, the answering branch keeps its data AND the
 * totals say how many of how many replied. A fan-out that dropped the failing
 * branch would produce a smaller number presented as the whole business —
 * which is not a smaller truth, it is a false one, and it is the failure mode
 * the entire per-branch-state design exists to prevent.
 *
 * Every assertion is checked in both directions: a fan-out that marked
 * everything unreadable would pass a test that only looked for the failure.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/branch_rpc_fanout.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
  fanOut, coverage, withRegistry, branchBindings, BRANCH_BINDING_PREFIX,
} from '../src/services/branches.ts';
import { branchHealth, branchOverview, branchSearchAccounts, applyLicenceCopy } from '../src/rpc/branchOps.ts';
import { recordEscalation, openEscalations, slaBand, ESCALATION_KINDS } from '../src/rpc/hqOps.ts';

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

function coerce(a: any[]): any[] {
  return a.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));
}
function makeD1(db: InstanceType<typeof DatabaseSync>) {
  return {
    prepare(sql: string) {
      let b: any[] = [];
      const api: any = {
        bind: (...x: any[]) => { b = coerce(x); return api; },
        async first() { return db.prepare(sql).get(...b) ?? null; },
        async all() { return { results: db.prepare(sql).all(...b) }; },
        async run() { const r = db.prepare(sql).run(...b); return { meta: { changes: Number(r.changes) } }; },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
  };
}

const BRANCH_SCHEMA = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
                      name TEXT, email TEXT, created_at TEXT);
  CREATE TABLE branch_licence (id INTEGER PRIMARY KEY CHECK (id = 1), licence_uid TEXT NOT NULL,
    licence_ref TEXT, legal_entity TEXT, brand_name TEXT, territory TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active', seats_json TEXT, revenue_share_bps INTEGER,
    token_split_bps INTEGER, annual_fee_cents INTEGER, currency TEXT, term_start TEXT, term_end TEXT,
    renewal_at TEXT, template_version TEXT, suspended_at TEXT, suspended_note TEXT,
    registered_address TEXT, signatory_name TEXT, signatory_title TEXT,
    term_years INTEGER, terminated_at TEXT,
    pushed_at TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE lp_applications (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT);
  CREATE TABLE referral_submissions (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT);
  CREATE TABLE cohort_applicants (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT);
  CREATE TABLE spinout_moderation_cases (id INTEGER PRIMARY KEY, status TEXT, created_at TEXT);
`;

const HQ_SCHEMA = `
  CREATE TABLE licence_deployments (id INTEGER PRIMARY KEY AUTOINCREMENT, licence_uid TEXT NOT NULL UNIQUE,
    code TEXT NOT NULL UNIQUE, hostname TEXT NOT NULL, worker_name TEXT NOT NULL, d1_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested', requested_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE hq_escalations (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
    branch_code TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, subject_ref TEXT, detail TEXT,
    raised_by_name TEXT, raised_by_branch_user_id INTEGER, status TEXT NOT NULL DEFAULT 'open',
    due_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), answer TEXT,
    answered_by_user_id INTEGER, answered_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

function branchDb(seed = '') {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  d.exec(BRANCH_SCHEMA);
  if (seed) d.exec(seed);
  return d;
}
function hqDb(seed = '') {
  const d = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  d.exec(HQ_SCHEMA);
  if (seed) d.exec(seed);
  return d;
}

const FR = { BRANCH_CODE: 'fr', BRANCH_NAME: 'Axal VC France', BRANCH_TERRITORY: 'FR,BE,LU' };
const HQ = { APP_URL: 'https://axal.vc' };

// ── the fan-out ────────────────────────────────────────────────────────────

test('bindings are discovered by prefix, and the reserved vars are not bindings', () => {
  const env: any = {
    ...FR,
    BRANCH_FR: { overview: async () => ({}) },
    BRANCH_DACH: { overview: async () => ({}) },
    // Not a binding: a string. A branch's own vars share the prefix.
    TOKENS: {}, DB: {},
  };
  assert.deepEqual(branchBindings(env).map((b) => b.code), ['dach', 'fr']);
  // The three reserved vars must never be read as branches, even though they
  // carry the prefix — this is the assertion that fails if one is added to
  // the binding scan by accident.
  assert.ok(!branchBindings(env).some((b) => ['code', 'name', 'territory'].includes(b.code)));
  assert.equal(BRANCH_BINDING_PREFIX, 'BRANCH_');
});

test('HQ with no branches deployed fans out to nothing, which is not a failure', async () => {
  const results = await fanOut({ ...HQ } as any, 'overview');
  assert.deepEqual(results, []);
  const cov = coverage(results);
  assert.deepEqual(cov, { total: 0, answered: 0, complete: true, unreadable: [] });
});

test('one branch rejecting does not poison the others, and the totals say so', async () => {
  const env: any = {
    ...HQ,
    BRANCH_FR: { overview: async () => ({ accounts: { total: 12 }, as_of: '2026-09-15T09:00:00Z' }) },
    BRANCH_DACH: { overview: async () => { throw new Error('D1_ERROR: no such table'); } },
    BRANCH_NORDICS: { overview: async () => ({ accounts: { total: 4 }, as_of: '2026-09-15T09:00:01Z' }) },
  };
  const results = await fanOut<any>(env, 'overview');
  const byCode = Object.fromEntries(results.map((r) => [r.code, r]));

  assert.equal(byCode.fr.status, 'ok');
  assert.equal(byCode.fr.data.accounts.total, 12, 'the answering branch keeps its own data');
  assert.equal(byCode.fr.as_of, '2026-09-15T09:00:00Z', 'and its own stamp');
  assert.equal(byCode.nordics.status, 'ok');

  assert.equal(byCode.dach.status, 'unreadable');
  assert.ok(byCode.dach.data === undefined, 'a failed branch carries no data to be summed');
  assert.match(byCode.dach.reason, /no such table/);

  // The denominator. Without it a caller sums 16 and calls it the platform.
  assert.deepEqual(coverage(results), {
    total: 3, answered: 2, complete: false, unreadable: ['dach'],
  });
});

test('a branch that never answers is unreadable rather than a hang', async () => {
  const env: any = {
    ...HQ,
    BRANCH_FR: { overview: async () => ({ ok: true }) },
    BRANCH_SLOW: { overview: () => new Promise(() => {}) },
  };
  const started = Date.now();
  const results = await fanOut<any>(env, 'overview', [], 60);
  const elapsed = Date.now() - started;
  const slow = results.find((r) => r.code === 'slow')!;
  assert.equal(slow.status, 'unreadable');
  assert.match(slow.reason!, /did not answer/);
  assert.equal(results.find((r) => r.code === 'fr')!.status, 'ok');
  // The deadline is the point: a hang must not become the page's latency.
  assert.ok(elapsed < 2_000, `the fan-out must not wait on the hanging branch (took ${elapsed}ms)`);
});

test('a binding on an older deploy missing the method is named, not silently ok', async () => {
  const env: any = { ...HQ, BRANCH_FR: { health: async () => ({}) } };
  const [r] = await fanOut<any>(env, 'overview');
  assert.equal(r.status, 'unreadable');
  assert.match(r.reason!, /does not expose overview\(\)/);
});

test('a provisioned licence with no binding reads not_deployed, not unreadable', async () => {
  const results = await fanOut<any>({ ...HQ, BRANCH_FR: { overview: async () => ({ ok: 1 }) } } as any, 'overview');
  const merged = withRegistry(results, [
    { code: 'fr', hostname: 'fr.axal.vc', status: 'worker_live' },
    { code: 'dach', hostname: 'dach.axal.vc', status: 'requested' },
  ]);
  const byCode = Object.fromEntries(merged.map((r) => [r.code, r]));
  assert.equal(byCode.fr.status, 'ok');
  assert.equal(byCode.dach.status, 'not_deployed');
  // The two must not share a state: one is an outage-shaped unknown, the
  // other is a deploy that has not happened, and they need different copy.
  assert.notEqual(byCode.dach.status, 'unreadable');
  assert.match(byCode.dach.reason!, /no service binding/);
});

// ── what a branch answers ──────────────────────────────────────────────────

test('health does a real query, so a broken DB binding cannot read as healthy', async () => {
  const good = await branchHealth({ ...FR, DB: makeD1(branchDb()) } as any);
  assert.equal(good.ok, true);
  assert.equal(good.db_ok, true);
  assert.equal(good.branch, 'fr');

  // A DB whose every statement throws. If `health()` answered without
  // touching D1 this would still say ok — which is the failure a health check
  // on a freshly provisioned branch exists to catch.
  const brokenDb: any = { prepare() { throw new Error('D1_ERROR: binding missing'); } };
  const bad = await branchHealth({ ...FR, DB: brokenDb } as any);
  assert.equal(bad.ok, false);
  assert.match(bad.detail!, /binding missing/);
});

test('every branch answer is refused on HQ', async () => {
  const env: any = { ...HQ, DB: makeD1(branchDb()) };
  for (const [label, call] of [
    ['health', () => branchHealth(env)],
    ['overview', () => branchOverview(env)],
    ['searchAccounts', () => branchSearchAccounts(env, 'ab')],
    ['applyLicence', () => applyLicenceCopy(env, {})],
  ] as const) {
    await assert.rejects(call, /only live on a branch/, `${label} must refuse on HQ`);
  }
});

test('the backlog sums the four queues, and one unreadable queue voids the total', async () => {
  const seeded = branchDb(`
    INSERT INTO users (id, role, is_active) VALUES (1,'founder',1),(2,'founder',1),(3,'admin',1);
    INSERT INTO lp_applications (id,status,created_at) VALUES (1,'pending','2026-09-01T00:00:00Z');
    INSERT INTO referral_submissions (id,status,created_at) VALUES
      (1,'submitted','2026-09-02T00:00:00Z'),(2,'draft','2026-08-01T00:00:00Z');
    INSERT INTO cohort_applicants (id,status,created_at) VALUES (1,'pending','2026-09-03T00:00:00Z');
    INSERT INTO spinout_moderation_cases (id,status,created_at) VALUES
      (1,'under_review','2026-09-04T00:00:00Z'),(2,'active','2026-08-01T00:00:00Z');
  `);
  const o = await branchOverview({ ...FR, DB: makeD1(seeded) } as any);
  assert.equal(o.accounts.total, 3);
  assert.deepEqual(o.accounts.by_role, { founder: 2, admin: 1 });
  // 1 LP + 1 referral + 1 cohort + 1 moderation. A 'draft' referral is the
  // member's own and is NOT reviewer backlog; an 'active' moderation case is
  // decided. Both are seeded precisely so a query that counted them fails.
  assert.equal(o.backlog!.count, 4);
  assert.equal(o.backlog!.oldest_at, '2026-09-01T00:00:00Z');
  assert.ok(!('backlog_reason' in o) || o.backlog_reason === undefined);

  // Drop one queue: the answer becomes null WITH a reason, never the sum of
  // the other three presented as the backlog.
  const partial = branchDb('INSERT INTO users (id, role) VALUES (1, \'founder\');');
  partial.exec('DROP TABLE cohort_applicants');
  const p = await branchOverview({ ...FR, DB: makeD1(partial) } as any);
  assert.equal(p.backlog, null);
  // CASE-INSENSITIVE, AND THAT IS NOT A LOOSENING. The lane's name now comes
  // from the shared `APPROVAL_SOURCES` label (D130), which is title-case
  // because it also heads a lane on S3's board; this reason interpolates it
  // mid-sentence. What the assertion is about is WHICH lane is named — it
  // still fails if the reason names the wrong one, or names none.
  assert.match(p.backlog_reason!, /cohort applications/i);
  assert.match(p.backlog_reason!, /smaller than the truth/);
});

test('revenue is null with a reason, never zero', async () => {
  // SPLIT FROM SEATS (D127), not loosened. This test used to assert
  // `seats_used === null` and `!== 0` together with revenue, on the shared
  // premise that neither could be known. Seats can be now — a branch counts
  // its own — so the two facts came apart and are asserted apart. The
  // assertion this must NEVER become is
  // `o.seats_used === null || typeof o.seats_used === 'number'`, which is the
  // assertion-that-cannot-fail this programme keeps catching.
  const o = await branchOverview({ ...FR, DB: makeD1(branchDb()) } as any);
  assert.equal(o.revenue_mtd_cents, null);
  assert.ok(o.revenue_reason.length > 0);
});

test('seats used counts the roles a licence sells a seat for, and nothing else', async () => {
  // A correct EMPTY branch now returns 0, which the old shape forbade
  // outright. Zero here is a figure, not a fabrication: the read succeeded and
  // the answer is that nobody holds a seat.
  const empty = await branchOverview({ ...FR, DB: makeD1(branchDb()) } as any);
  assert.equal(empty.seats_used, 0);

  const db = branchDb(`
    INSERT INTO users (id, role, is_active) VALUES
      (1, 'founder',   1),
      (2, 'investor',  1),
      (3, 'advisor',   1),
      (4, 'partner',   1),
      (5, 'admin',     1),
      (6, 'exploring', 1),
      (7, 'founder',   0);
  `);
  const o = await branchOverview({ ...FR, DB: makeD1(db) } as any);
  // Four seat roles counted; `admin` and `exploring` hold no seat, which is
  // exactly what S2's Exploring board describes, and the deactivated founder
  // released theirs.
  assert.equal(o.seats_used, 4);
  assert.equal(o.accounts.total, 6, 'the deactivated account is out of both figures');
});

test('the seats-used reason states that a role is not a licensed seat', async () => {
  // The honesty point, asserted rather than left to a comment: this figure is
  // a DEFINITION, and the screen that shows it must say so. S8's seat ledger
  // does not ship, so nothing may imply a seat has an id.
  const o = await branchOverview({ ...FR, DB: makeD1(branchDb()) } as any);
  assert.match(o.seats_used_reason, /Role is not the same thing as a licensed seat/);
  assert.match(o.seats_used_reason, /no seat has an id/);
  assert.doesNotMatch(o.seats_used_reason, /seat_assignments/,
    'the reason still names a store that is not coming');
});

test('suspended comes from the pushed licence copy, in both directions', async () => {
  const mk = (status: string) => branchDb(
    `INSERT INTO branch_licence (id, licence_uid, status, pushed_at)
     VALUES (1, 'lic_1', '${status}', '2026-09-14T00:00:00Z')`,
  );
  assert.equal((await branchOverview({ ...FR, DB: makeD1(mk('suspended')) } as any)).suspended, true);
  assert.equal((await branchOverview({ ...FR, DB: makeD1(mk('active')) } as any)).suspended, false);
  // No copy at all is not suspended: provisioning has not finished, and
  // freezing a branch for that would freeze it exactly when it is being set up.
  assert.equal((await branchOverview({ ...FR, DB: makeD1(branchDb()) } as any)).suspended, false);
});

test('account search is bounded, escapes LIKE wildcards, and ignores a short needle', async () => {
  const db = branchDb(`
    INSERT INTO users (id, role, is_active, name, email) VALUES
      (1,'founder',1,'Ada Lovelace','ada@example.com'),
      (2,'founder',1,'100% Cotton','cotton@example.com'),
      (3,'founder',1,'1000 Cotton','kilo@example.com');
  `);
  const env: any = { ...FR, DB: makeD1(db) };

  assert.deepEqual((await branchSearchAccounts(env, 'a')).results, [], 'a one-character needle scans nothing');

  const hit = await branchSearchAccounts(env, 'ada');
  assert.deepEqual(hit.results.map((r) => r.id), [1]);
  assert.equal(hit.branch, 'fr');

  // A literal '%' must match a literal '%', not act as a wildcard. The two
  // rows are built so escaping CHANGES THE ANSWER: escaped, `0%` matches only
  // "100% Cotton"; unescaped it becomes "contains 0" and drags in "1000
  // Cotton" too. A needle of just '%' would prove nothing here — it is one
  // character and the short-needle guard returns before the query runs.
  const pct = await branchSearchAccounts(env, '0%');
  assert.deepEqual(pct.results.map((r) => r.id), [2]);

  const capped = await branchSearchAccounts(env, 'example', 2);
  assert.equal(capped.results.length, 2);
  assert.equal(capped.truncated, true, 'a truncated page must say so rather than look complete');
});

test('applyLicence keeps HQ\'s pushed_at rather than stamping its own', async () => {
  const db = branchDb();
  const env: any = { ...FR, DB: makeD1(db) };
  await applyLicenceCopy(env, {
    licence_uid: 'lic_fr', licence_ref: 'AXL-001', legal_entity: 'Axal VC France SAS',
    brand_name: 'Axal VC France', territory: 'FR,BE,LU', status: 'active',
    revenue_share_bps: 3500, pushed_at: '2026-09-14T22:10:00Z',
  });
  const row: any = db.prepare('SELECT * FROM branch_licence WHERE id = 1').get();
  assert.equal(row.pushed_at, '2026-09-14T22:10:00Z', 'the age of the FACT, not of this write');
  assert.equal(row.licence_ref, 'AXL-001');
  assert.equal(row.revenue_share_bps, 3500);

  // A second push replaces in place — one licence, one singleton row.
  await applyLicenceCopy(env, {
    licence_uid: 'lic_fr', status: 'suspended', pushed_at: '2026-09-15T08:00:00Z',
  });
  const after: any = db.prepare('SELECT COUNT(*) AS n, status, pushed_at FROM branch_licence').get();
  assert.equal(after.n, 1);
  assert.equal(after.status, 'suspended');
  assert.equal(after.pushed_at, '2026-09-15T08:00:00Z');
});

// ── what HQ answers a branch ───────────────────────────────────────────────

const DEPLOYED = `
  INSERT INTO licence_deployments (licence_uid, code, hostname, worker_name, d1_name, status)
  VALUES ('lic_fr', 'fr', 'fr.axal.vc', 'studioos-fr', 'studioos-fr', 'worker_live');
`;

test('an escalation is filed under the CALLER\'s code, and only a provisioned one', async () => {
  const db = hqDb(DEPLOYED);
  const env: any = { ...HQ, DB: makeD1(db) };

  const r = await recordEscalation(env, 'fr', {
    kind: 'seat_increase', subject: 'Four more founder seats', raised_by_name: 'Sophie',
  });
  assert.match(r.uid, /^esc_/);
  assert.equal(r.status, 'open');
  const row: any = db.prepare('SELECT * FROM hq_escalations WHERE uid = ?').get(r.uid);
  assert.equal(row.branch_code, 'fr');
  assert.equal(row.kind, 'seat_increase');

  // A branch HQ has never provisioned cannot file. This is the check that
  // makes the stamp mean anything, given that the transport cannot identify
  // the caller at all (D.7).
  await assert.rejects(
    () => recordEscalation(env, 'dach', { kind: 'other', subject: 'hello' }),
    /not a provisioned branch/,
  );
  // A malformed code is refused before it reaches the lookup.
  await assert.rejects(
    () => recordEscalation(env, 'NOT A CODE', { kind: 'other', subject: 'hello' }),
    /valid branch code/,
  );
});

test('escalate validates kind and subject against the migration\'s vocabulary', async () => {
  const env: any = { ...HQ, DB: makeD1(hqDb(DEPLOYED)) };
  await assert.rejects(
    () => recordEscalation(env, 'fr', { kind: 'refund', subject: 'x' }),
    /kind must be one of/,
  );
  await assert.rejects(
    () => recordEscalation(env, 'fr', { kind: 'other', subject: '   ' }),
    /subject is required/,
  );
  // And every declared kind is actually accepted — a validator that refused
  // everything would pass the two rejections above.
  for (const kind of ESCALATION_KINDS) {
    const ok = await recordEscalation(env, 'fr', { kind, subject: `a ${kind} item` });
    assert.equal(ok.status, 'open', `${kind} must be accepted`);
  }
});

test('HQ\'s escalation surface is refused on a branch', async () => {
  const env: any = { ...FR, DB: makeD1(hqDb(DEPLOYED)) };
  await assert.rejects(
    () => recordEscalation(env, 'fr', { kind: 'other', subject: 'x' }),
    /only live on HQ/,
  );
});

test('open escalations come back oldest first, with the band derived on read', async () => {
  const db = hqDb(DEPLOYED);
  const env: any = { ...HQ, DB: makeD1(db) };
  db.exec(`
    INSERT INTO hq_escalations (uid, branch_code, kind, subject, status, due_at, created_at) VALUES
      ('esc_b','fr','other','newer','open','2099-01-01T00:00:00Z','2026-09-10T00:00:00Z'),
      ('esc_a','fr','other','older','open','2000-01-01T00:00:00Z','2026-09-01T00:00:00Z'),
      ('esc_c','fr','other','closed one','answered','2099-01-01T00:00:00Z','2026-08-01T00:00:00Z');
  `);
  const rows = await openEscalations(env);
  assert.deepEqual(rows.map((r) => r.uid), ['esc_a', 'esc_b'], 'oldest first, answered excluded');
  assert.equal(rows[0].sla, 'past', 'a due date in the past is past SLA');
  assert.equal(rows[1].sla, 'ok');
});

test('the SLA band is a function of NOW, which is why it is not stored', () => {
  const due = '2026-09-15T12:00:00Z';
  const at = (iso: string) => slaBand(due, Date.parse(iso));
  assert.equal(at('2026-09-13T00:00:00Z'), 'ok');
  assert.equal(at('2026-09-15T00:00:00Z'), 'due_soon');
  assert.equal(at('2026-09-15T13:00:00Z'), 'past');
  // No due date is not "past": an item with no clock has not missed one.
  assert.equal(slaBand(null), 'ok');
});

// ── the wiring, asserted on source ─────────────────────────────────────────

test('both entrypoints are re-exported from index.ts, where a binding resolves them', () => {
  const src = read('cloudflare-worker/src/index.ts');
  assert.match(src, /export \{ HqEntrypoint, BranchEntrypoint \} from '\.\/rpc'/);
  // The Durable Objects are re-exported for the same reason; if that line
  // ever moves, this one has to move with it.
  assert.match(src, /export \{ PipelineRoom \}/);
});

test('the entrypoint classes hold no logic of their own', () => {
  const src = read('cloudflare-worker/src/rpc/index.ts');
  // They cannot be imported under node --test, so the only way they stay
  // testable is by containing nothing to test. A method body with a query, a
  // conditional or a loop in it is the regression.
  assert.ok(!/\bSELECT\b|\bINSERT\b/i.test(src), 'no SQL may live in the entrypoint classes');
  assert.ok(!/\bif\s*\(|\bfor\s*\(|\bwhile\s*\(/.test(src), 'no control flow in the entrypoint classes');
  assert.match(src, /class HqEntrypoint extends WorkerEntrypoint/);
  assert.match(src, /class BranchEntrypoint extends WorkerEntrypoint/);
});

test('HQ Home fans out and carries its denominator', () => {
  const src = read('cloudflare-worker/src/routes/admin_hq.ts');
  assert.match(src, /fanOut<BranchOverview>\(env, 'overview'\)/);
  assert.match(src, /withRegistry\(/, 'a provisioned-but-unbound branch must still appear');
  assert.match(src, /branches_coverage: branchCoverage/);
  // The retired reason must be GONE, not reworded: a stale refusal that still
  // reads plausibly is what the next surface cites.
  assert.ok(
    !src.includes('No escalation exists on the platform'),
    'the old escalations refusal is superseded by migration 259 and must be deleted',
  );
});
