/**
 * D896 (#2675, part 2 of #2434) — DECK_SOURCES, `GET /api/decks/sources` and
 * `POST /api/decks/:id/refresh`.
 *
 * The database is the baseline plus every numbered migration above the
 * cutoff, schema only, as cycle_records_raise_d691.test.ts builds one, so the
 * adapters' SQL runs against the columns production has. Every person,
 * venture and figure is made up.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/deck_sources_d896.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import deckSources from '../src/routes/deck_sources.ts';
import decks from '../src/routes/decks.ts';
import { DECK_SOURCES, coverageOf, sourceAndGrade, bindingsOf, sanitizeBinding, type SourceItem } from '../src/services/decks/sources.ts';
import { BASELINE_CUTOFF, migrationNumber, compareMigrations } from '../../scripts/lib/migrationPlan.mjs';
import { d1Over } from './_d1_sqlite.mjs';
import { withThrownResponses } from '../src/util/thrownResponse.ts';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef'; // synthetic test fixture
const BASELINE = readFileSync(resolve(process.cwd(), 'cloudflare-worker/sql/schema_baseline.sql'), 'utf8');
const MIGRATIONS = resolve(process.cwd(), 'cloudflare-worker/sql/migrations');

const FOUNDER = 10, ADMIN = 30, OTHER = 20, INVESTOR = 50, COFOUNDER = 11;
const P = 1, P_OTHER = 2;

const FILES = readdirSync(MIGRATIONS).filter((f) => /^\d+_.*\.sql$/.test(f)).sort(compareMigrations);
const BUILT_DDL = (() => {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(BASELINE);
  for (const f of FILES.filter((n) => migrationNumber(n) > BASELINE_CUTOFF)) db.exec(readFileSync(resolve(MIGRATIONS, f), 'utf8'));
  return (db.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all() as any[]).map((r) => r.sql as string);
})();

function fixture() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false, enableDoubleQuotedStringLiterals: true });
  for (const s of BUILT_DDL) { try { db.exec(s); } catch { /* a view or trigger naming an object replayed later */ } }
  const add = db.prepare('INSERT INTO users (id, role, name, email, is_active, founder_id) VALUES (?, ?, ?, ?, 1, ?)');
  add.run(FOUNDER, 'founder', 'Fay Founder', 'fay@example.test', 1001);
  add.run(COFOUNDER, 'founder', 'Cy Cofounder', 'cy@example.test', 1003);
  add.run(OTHER, 'founder', 'Oz Other', 'oz@example.test', 1002);
  add.run(ADMIN, 'admin', 'Ada Admin', 'ada@example.test', null);
  add.run(INVESTOR, 'investor', 'Ivo Investor', 'ivo@example.test', null);
  db.exec(`INSERT INTO projects (id, name, founder_id) VALUES (${P}, 'Kestrel Labs', 1001), (${P_OTHER}, 'Beta Works', 1002)`);
  db.exec(`INSERT INTO project_members (project_id, user_id, role, status) VALUES (${P}, ${COFOUNDER}, 'cofounder', 'accepted')`);
  return db;
}

/** Every store given one record, each with a known origin. */
function seed(db: DatabaseSync) {
  // Validate: two held interviews, one with a recorded session; one lead that is not held.
  db.exec(`INSERT INTO discovery_interviews (id, project_id, interviewee_name, interview_date, icp_fit, stage, created_at) VALUES
    (1, ${P}, 'Person A', '2026-09-10', 'strong', 'done', '2026-09-10'),
    (2, ${P}, 'Person B', '2026-10-03', 'partial', NULL, '2026-10-03'),
    (3, ${P}, 'Person C', NULL, NULL, 'invited', '2026-10-05'),
    (9, ${P_OTHER}, 'Person Z', '2026-10-01', 'strong', 'done', '2026-10-01')`);
  db.exec(`INSERT INTO interview_sessions (uid, interview_id, project_id, created_by_user_id, channel, status, consent_status)
    VALUES ('s1', 1, ${P}, ${FOUNDER}, 'video', 'reviewed', 'given')`);
  db.exec(`INSERT INTO demand_signals (id, project_id, kind, who, status, evidence_file_key, signal_date) VALUES
    (1, ${P}, 'loi', 'Buyer A', 'confirmed', 'k/1.pdf', '2026-09-20'),
    (2, ${P}, 'loi', 'Buyer B', 'counted', 'k/2.pdf', '2026-10-01'),
    (3, ${P}, 'waitlist', 'Buyer C', 'confirmed', NULL, '2026-10-02'),
    (4, ${P}, 'pre_sale', 'Buyer D', 'to_confirm', NULL, '2026-10-04')`);
  db.exec(`INSERT INTO competitor_tracking (uid, project_id, name_norm, updated_at) VALUES ('t1', ${P}, 'rival a', '2026-10-06'), ('t2', ${P}, 'rival b', '2026-10-07')`);
  // Build.
  db.exec(`INSERT INTO mvp_features (project_id, title, delivery_status, is_must_have, done_at, updated_at) VALUES
    (${P}, 'Login', 'Done', 1, '2026-10-01', '2026-10-01'), (${P}, 'Export', 'Backlog', 1, NULL, '2026-10-02'), (${P}, 'Theme', 'Done', 0, '2026-10-20', '2026-10-20')`);
  db.exec(`INSERT INTO roadmap_releases (project_id, repository, tag, published_at) VALUES
    (${P}, 'acme/app', 'v1.1', '2026-09-30T10:00:00Z'), (${P}, 'acme/app', 'v0.1', '2026-01-02T10:00:00Z')`);
  db.exec(`INSERT INTO roadmap_okrs (project_id, objective, updated_at) VALUES (${P}, 'Ship v2', '2026-10-01')`);
  db.exec(`INSERT INTO github_contributors (integration_id, project_id, repository, login, commits_90d, updated_at) VALUES
    (7, ${P}, 'acme/app', 'dev-a', 120, '2026-10-08'), (7, ${P}, 'acme/app', 'dev-b', 30, '2026-10-08')`);
  // Raise.
  db.exec(`INSERT INTO raise_rounds (uid, project_id, name, target_amount, close_date, status, updated_at) VALUES ('r1', ${P}, 'Seed', 1500000, '2026-12-15', 'active', '2026-10-09')`);
  db.exec(`INSERT INTO round_calls (uid, project_id, round_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, created_by, terms_hash, counsel_approved_hash, counsel_approved_by, counsel_approved_at, counsel_approval_reference, updated_at)
    VALUES ('rc1', ${P}, 1, 'Seed call', 150000000, 'safe', 'Post-money SAFE', 2500000, '2026-12-15', ${FOUNDER}, 'h1', 'h1', 77, '2026-10-09', 'ref-1', '2026-10-09')`);
  db.exec(`INSERT INTO cap_table_holders (project_id, user_id, name, shares, source, founder_role, updated_at) VALUES
    (${P}, ${FOUNDER}, 'Holder A', 6000000, 'manual', 'ceo', '2026-10-01'), (${P}, ${FOUNDER}, 'Holder B', 1000000, 'manual', NULL, '2026-10-02')`);
  db.prepare('UPDATE projects SET use_of_funds = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify([{ label: 'Product & engineering', pct: 60 }, { label: 'GTM: sales and marketing', pct: 40 }]), '2026-10-04', P);
  db.exec(`INSERT INTO narrative_version_meta (uid, project_id, version, updated_at) VALUES ('n1', ${P}, 1, '2026-09-01'), ('n2', ${P}, 2, '2026-10-01')`);
  // Grow: a typed snapshot and a newer Stripe one.
  db.exec(`INSERT INTO project_metrics (project_id, snapshot_date, mrr, paying_accounts, source) VALUES
    (${P}, '2026-08-31', 9000, 40, NULL),
    (${P}, '2026-09-30', 16950, 38, 'stripe')`);
  db.exec(`INSERT INTO portfolio_updates (uid, project_id, author_user_id, period, title, status, submitted_at) VALUES ('u1', ${P}, ${FOUNDER}, '2026-09', 'September', 'submitted', '2026-10-02')`);
  // Team.
  db.exec(`INSERT INTO skill_evidence (user_id, axis, source, count_lifetime, count_window, weighted, first_at, last_at, computed_at) VALUES
    (${FOUNDER}, 'engineering', 'github', 4, 2, 5, '2026-01-01', '2026-09-01', '2026-10-01'),
    (${COFOUNDER}, 'finance_ops', 'mercury', 3, 1, 3, '2026-01-01', '2026-09-01', '2026-10-02'),
    (${OTHER}, 'design', 'x', 9, 9, 9, '2026-01-01', '2026-09-01', '2026-10-02')`);
  db.exec(`INSERT INTO profile_archetypes (user_id, persona, archetype_slug, archetype_label, computed_at) VALUES
    (${FOUNDER}, 'founder', 'builder', 'Builder', '2026-10-01'), (${COFOUNDER}, 'founder', 'operator', 'Operator', '2026-10-01')`);
  db.exec(`INSERT INTO profile_archetype_publish (user_id, published) VALUES (${FOUNDER}, 1), (${COFOUNDER}, 0)`);
  // The scorecard's raw score: it must never reach a deck source.
  db.exec(`INSERT INTO score_snapshots (uid, project_id, total_score, tier) VALUES ('sc1', ${P}, 91, 'TIER_1')`);
}

function mercury(db: DatabaseSync) {
  db.exec(`INSERT INTO integrations (id, uid, user_id, provider_key, status, auth_type) VALUES (5, 'i5', ${FOUNDER}, 'mercury', 'active', 'oauth_mcp')`);
  db.exec(`INSERT INTO mercury_raise_facts (id, integration_id, project_id, kind, fact_key, label, months, amount_cents, burn_cents, value, as_of) VALUES
    (1, 5, ${P}, 'revenue', 'revenue:2026-09', '2026-09', 1, 1695000, NULL, NULL, '2026-10-01'),
    (2, 5, ${P}, 'revenue', 'revenue:growth', '2026-09', 1, NULL, NULL, 6, '2026-10-01'),
    (3, 5, ${P}, 'runway', 'runway', 'runway', 3, NULL, 2100000, 14.2, '2026-10-01')`);
}

const sources = new Hono<any>();
sources.route('/api/decks', deckSources);
sources.route('/api/decks', decks);
sources.onError((err: any, c) => c.json({ detail: String(err?.message || '') }, 500));

async function call(db: DatabaseSync, who: number, method: string, path: string, extra: Record<string, unknown> = {}, body?: unknown) {
  const role = { [ADMIN]: 'admin', [INVESTOR]: 'investor' }[who] ?? 'founder';
  const token = await new SignJWT({ user_id: who, role, ...extra }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
  const saved = [console.warn, console.error]; console.warn = () => {}; console.error = () => {};
  try {
    const res = await withThrownResponses(() => sources.request(path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) },
      { JWT_SECRET, ENVIRONMENT: 'development', DB: d1Over(db) } as any));
    return { status: res.status, body: await res.json().catch(() => null) as any };
  } finally { [console.warn, console.error] = saved; }
}

const byKey = (items: SourceItem[]) => new Map(items.map((i) => [i.source_key, i]));
const SLOT_KEYS = DECK_SOURCES.flatMap((a) => a.slots.filter((s) => !s.optional).map((s) => s.key));
const SCORING_KEYS = DECK_SOURCES.flatMap((a) => a.slots.filter((s) => s.optional).map((s) => s.key));

test('without a record, every slot is Not recorded with the module that fills it — never 0', async () => {
  const db = fixture();
  const { status, body } = await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`);
  assert.equal(status, 200);
  assert.deepEqual(body.items.map((i: SourceItem) => i.source_key), SLOT_KEYS, 'one item per slot, scoring left out');
  for (const it of body.items as SourceItem[]) {
    assert.equal(it.state, 'not_recorded', it.source_key);
    assert.equal(it.value, null, it.source_key);
    assert.equal(it.grade, 'Not recorded', it.source_key);
    assert.equal(it.snapshot_hash, null, it.source_key);
    assert.match(it.href, new RegExp(`^/(validate|build|raise|grow)/[a-z-]+\\?project=${P}$`), it.source_key);
    assert.ok(it.module.includes(' › '), it.source_key);
  }
  assert.deepEqual(body.coverage, { slots: SLOT_KEYS.length, filled: 0, by_grade: { Measured: 0, Reviewed: 0, Sourced: 0, Stated: 0 }, not_recorded: SLOT_KEYS.length, unreadable: 0 });
});

test('with a record, each adapter reads its value, date, source and grade', async () => {
  const db = fixture(); seed(db);
  const { status, body } = await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`);
  assert.equal(status, 200);
  const m = byKey(body.items);
  const is = (key: string, value: unknown, source: string, grade: string, as_of?: string | null, of?: number) => {
    const it = m.get(key)!;
    assert.equal(it.state, 'recorded', key);
    assert.deepEqual(it.value, value, key);
    assert.equal(it.source, source, `${key} source`);
    assert.equal(it.grade, grade, `${key} grade`);
    if (as_of !== undefined) assert.equal(it.as_of, as_of, `${key} as_of`);
    if (of !== undefined) assert.equal(it.of, of, `${key} of`);
    assert.match(String(it.snapshot_hash), /^[0-9a-f]{24}$/, key);
  };
  // Two held interviews (the invited lead is not one); one was logged by hand, so the count is Sourced.
  is('validate.interviews', 2, 'Recorded', 'Sourced', '2026-10-03');
  // The one strong-fit interview had a recorded session: Measured.
  is('validate.strong_fit', 1, 'Recorded', 'Measured');
  is('validate.lois', 2, 'Document', 'Sourced', '2026-10-01');
  is('validate.demand', 1, 'Typed', 'Stated', '2026-10-02');
  is('validate.competitors', 2, 'Document', 'Sourced', '2026-10-07');
  is('build.must_haves', 1, 'Typed', 'Stated', '2026-10-02', 2);
  is('build.releases_90d', 1, 'Connector', 'Measured', '2026-09-30');
  is('build.roadmap', 1, 'Typed', 'Stated');
  is('build.commits_90d', 150, 'Connector', 'Measured', '2026-10-08', 2);
  is('raise.round_target', 1500000, 'Document', 'Reviewed', '2026-10-09');
  is('raise.round_close', '2026-12-15', 'Document', 'Reviewed');
  is('raise.round_terms', 'safe', 'Document', 'Reviewed');
  is('raise.cap_table', 2, 'Typed', 'Stated');
  is('raise.use_of_funds', 'Product & engineering 60% · GTM: sales and marketing 40%', 'Typed', 'Stated', '2026-10-04');
  is('raise.narrative', 2, 'Typed', 'Stated', '2026-10-01');
  // Stripe's snapshot wins over the founder's older typed one.
  is('grow.mrr', 16950, 'Connector', 'Measured', '2026-09-30');
  is('grow.paying_customers', 38, 'Connector', 'Measured');
  is('grow.investor_updates', 1, 'Typed', 'Stated', '2026-10-02');
  is('team.founders', 1, 'Recorded', 'Measured');
  // Another venture's founder never counts toward this one's skills.
  is('team.skills', 'engineering · finance_ops', 'Recorded', 'Measured');
  // Published only: the cofounder has not published theirs.
  is('team.archetypes', 'Builder', 'Typed', 'Stated');
  // Recorded nowhere: churn, ARR, vesting, the top pain theme and claims stay missing.
  for (const key of ['grow.churn', 'grow.arr', 'raise.vesting', 'validate.top_pain', 'validate.claims_validated']) {
    assert.equal(m.get(key)!.state, 'not_recorded', key);
    assert.equal(m.get(key)!.value, null, key);
  }
  // Another venture's interview is not read.
  assert.ok(!JSON.stringify(body).includes('Person Z'));
});

test('a typed figure is Stated when no connector holds it', async () => {
  const db = fixture();
  db.exec(`INSERT INTO project_metrics (project_id, snapshot_date, mrr, monthly_churn_pct, source) VALUES (${P}, '2026-08-31', 9000, 2.5, NULL)`);
  const m = byKey((await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`)).body.items);
  assert.equal(m.get('grow.mrr')!.value, 9000);
  assert.equal(m.get('grow.mrr')!.source, 'Typed');
  assert.equal(m.get('grow.mrr')!.grade, 'Stated');
  assert.equal(m.get('grow.churn')!.value, 2.5);
});

test('Stripe wins over a newer typed snapshot; approval of other terms is not Reviewed', async () => {
  const db = fixture();
  db.exec(`INSERT INTO project_metrics (project_id, snapshot_date, mrr, source) VALUES (${P}, '2026-09-30', 16950, 'stripe'), (${P}, '2026-10-15', 99999, NULL)`);
  db.exec(`INSERT INTO raise_rounds (uid, project_id, name, target_amount, status, updated_at) VALUES ('r1', ${P}, 'Seed', 1500000, 'active', '2026-10-09')`);
  // Counsel approved an earlier revision; the terms have changed since.
  db.exec(`INSERT INTO round_calls (uid, project_id, round_id, name, amount_cents, instrument, terms, minimum_cheque_cents, target_close, created_by, terms_hash, counsel_approved_hash, counsel_approved_by, counsel_approved_at, counsel_approval_reference)
    VALUES ('rc1', ${P}, 1, 'Seed call', 150000000, 'safe', 'Post-money SAFE', 2500000, '2026-12-15', ${FOUNDER}, 'h2', 'h1', 77, '2026-10-09', 'ref-1')`);
  const m = byKey((await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`)).body.items);
  assert.equal(m.get('grow.mrr')!.value, 16950);
  assert.equal(m.get('grow.mrr')!.source, 'Connector');
  assert.equal(m.get('raise.round_terms')!.grade, 'Stated');
  assert.equal(m.get('raise.round_target')!.grade, 'Stated');
});

test('fit nobody recorded is not "no strong fit"', async () => {
  const db = fixture();
  db.exec(`INSERT INTO discovery_interviews (id, project_id, interviewee_name, interview_date, stage) VALUES (1, ${P}, 'Person A', '2026-09-10', 'done')`);
  const m = byKey((await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`)).body.items);
  assert.equal(m.get('validate.interviews')!.value, 1);
  assert.equal(m.get('validate.strong_fit')!.state, 'not_recorded');
  assert.equal(m.get('validate.strong_fit')!.value, null);
});

test('a pain theme and a validated claim, read from their stores', async () => {
  const db = fixture();
  db.exec(`INSERT INTO pain_groups (id, project_id, title, sort_order, updated_at) VALUES (4, ${P}, 'Manual reconciliation', 0, '2026-10-01')`);
  db.exec(`INSERT INTO pain_group_aliases (group_id, project_id, phrase_norm, display_phrase) VALUES (4, ${P}, 'manual reconciliation', 'Manual reconciliation')`);
  const pains = JSON.stringify(['Manual reconciliation']);
  for (let i = 1; i <= 5; i++) {
    db.prepare("INSERT INTO discovery_interviews (id, project_id, interviewee_name, interview_date, icp_fit, pains_json, stage) VALUES (?, ?, ?, ?, 'strong', ?, 'done')")
      .run(i, P, `Person ${i}`, `2026-09-0${i}`, pains);
  }
  db.exec(`INSERT INTO hypotheses (id, project_id, code, claim, sort_order, updated_at) VALUES (8, ${P}, 'H1', 'Teams will pay', 0, '2026-10-02')`);
  db.exec(`INSERT INTO hypothesis_pain_links (hypothesis_id, pain_group_id, direction) VALUES (8, 4, 'supports')`);
  const m = byKey((await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`)).body.items);
  const pain = m.get('validate.top_pain')!;
  assert.equal(pain.state, 'recorded', JSON.stringify(pain));
  assert.equal(pain.value, 5);
  assert.equal(pain.of, 5);
  assert.equal(pain.record_ref, 'pain_groups:4');
  const claim = m.get('validate.claims_validated')!;
  assert.equal(claim.state, 'recorded', JSON.stringify(claim));
  assert.equal(claim.value, 1);
  assert.equal(claim.of, 1);
});

test('coverage counts only record-filled slots, by grade', async () => {
  const db = fixture(); seed(db);
  const { body } = await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`);
  const recorded = (body.items as SourceItem[]).filter((i) => i.state === 'recorded');
  const tally = { Measured: 0, Reviewed: 0, Sourced: 0, Stated: 0 } as Record<string, number>;
  for (const i of recorded) tally[i.grade] += 1;
  assert.equal(body.coverage.filled, recorded.length);
  assert.deepEqual(body.coverage.by_grade, tally);
  assert.equal(body.coverage.slots, SLOT_KEYS.length);
  assert.equal(body.coverage.not_recorded, SLOT_KEYS.length - recorded.length);
  // A Not recorded item never counts as filled, whatever its grade field says.
  assert.equal(coverageOf([{ ...recorded[0], state: 'not_recorded' }]).filled, 0);
  // Withheld is not a slot.
  assert.equal(coverageOf([{ ...recorded[0], state: 'withheld' }]).slots, 0);
});

test('Mercury: the founder reads their own facts; anyone else gets the slots withheld, not missing', async () => {
  const db = fixture(); seed(db); mercury(db);
  const own = byKey((await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`)).body.items);
  assert.equal(own.get('grow.mercury_revenue')!.value, 1695000);
  assert.equal(own.get('grow.mercury_revenue')!.unit, 'cents');
  assert.equal(own.get('grow.mercury_growth')!.value, 6);
  assert.equal(own.get('grow.net_burn')!.value, 2100000);
  assert.equal(own.get('grow.runway')!.value, 14.2);
  assert.equal(own.get('grow.runway')!.as_of, '2026-10-01');
  assert.equal(own.get('grow.runway')!.source, 'Connector');
  // An admin reads the venture (projectOwned) but never its bank.
  const admin = await call(db, ADMIN, 'GET', `/api/decks/sources?project_id=${P}`);
  assert.equal(admin.status, 200);
  const a = byKey(admin.body.items);
  for (const k of ['grow.mercury_revenue', 'grow.mercury_growth', 'grow.net_burn', 'grow.runway']) {
    assert.equal(a.get(k)!.state, 'withheld', k);
    assert.equal(a.get(k)!.value, null, k);
  }
  assert.equal(admin.body.coverage.slots, SLOT_KEYS.length - 4);
  assert.ok(!JSON.stringify(admin.body).includes('1695000'));
  // A support session acting as the founder is refused the bank too.
  const support = byKey((await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`, { impersonated_by: ADMIN })).body.items);
  assert.equal(support.get('grow.runway')!.state, 'withheld');
});

test('Scoring rows are off by default; included, they are a band and never the score', async () => {
  const db = fixture(); seed(db);
  const off = await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`);
  assert.ok(!off.body.items.some((i: SourceItem) => i.area === 'scoring'));
  const on = await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}&include=scoring`);
  const rows = on.body.items.filter((i: SourceItem) => i.area === 'scoring');
  assert.deepEqual(rows.map((r: SourceItem) => r.source_key), SCORING_KEYS);
  for (const r of rows) {
    assert.equal(r.optional, true);
    assert.equal(r.state, 'not_recorded', 'neither band is defined yet (#2428, #2433)');
  }
  assert.equal(on.body.coverage.slots, off.body.coverage.slots + SCORING_KEYS.length);
  assert.ok(!JSON.stringify(on.body).includes('91'), 'the raw score never appears');
});

test('a store that fails to read marks its own slots unreadable, and only those', async () => {
  const db = fixture(); seed(db);
  db.exec('DROP TABLE roadmap_releases');
  const { status, body } = await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`);
  assert.equal(status, 200);
  const m = byKey(body.items);
  assert.equal(m.get('build.releases_90d')!.state, 'unreadable');
  assert.equal(m.get('build.roadmap')!.state, 'unreadable');
  assert.equal(m.get('grow.mrr')!.state, 'recorded');
  assert.equal(body.coverage.unreadable, 2);
});

test('who may read: the owner and an accepted cofounder; not another founder or an investor', async () => {
  const db = fixture(); seed(db);
  assert.equal((await call(db, COFOUNDER, 'GET', `/api/decks/sources?project_id=${P}`)).status, 200);
  assert.equal((await call(db, OTHER, 'GET', `/api/decks/sources?project_id=${P}`)).status, 403);
  // An investor never manages a venture's deck (projectContentAccess, #2435).
  assert.equal((await call(db, INVESTOR, 'GET', `/api/decks/sources?project_id=${P}`)).status, 403);
  assert.equal((await call(db, FOUNDER, 'GET', '/api/decks/sources?project_id=999')).status, 404);
  assert.equal((await call(db, FOUNDER, 'GET', '/api/decks/sources')).status, 400);
});

test('/sources is answered by the sources route, not shadowed by GET /:id', async () => {
  const db = fixture();
  const { status, body } = await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.items) && body.coverage);
});

test('refresh: a Stripe value changed after as_of marks its card stale; an unchanged one stays fresh', async () => {
  const db = fixture(); seed(db);
  const first = byKey((await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`)).body.items);
  const bind = (it: SourceItem) => ({ source_key: it.source_key, record_ref: it.record_ref, as_of: it.as_of, grade: it.grade, snapshot_hash: it.snapshot_hash });
  const slides = [
    { title: 'Traction', fields: [
      { key: 'mrr', label: 'MRR', kind: 'paragraph', value: '$16,950', binding: bind(first.get('grow.mrr')!) },
      { key: 'customers', label: 'Paying customers', kind: 'paragraph', value: '38', binding: bind(first.get('grow.paying_customers')!) },
    ] },
    { title: 'Team', fields: [{ key: 'commits', label: 'Commits', kind: 'paragraph', value: '150', binding: bind(first.get('build.commits_90d')!) }] },
  ];
  db.exec(`CREATE TABLE IF NOT EXISTS pitch_decks (id INTEGER PRIMARY KEY, project_id INTEGER, version INTEGER, title TEXT, slides TEXT, is_current INTEGER DEFAULT 1, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, slides) VALUES (?, ?, ?, ?)').run(70, P, 4, JSON.stringify(slides));

  const before = await call(db, FOUNDER, 'POST', '/api/decks/70/refresh');
  assert.equal(before.status, 200);
  assert.equal(before.body.checked, 3);
  assert.equal(before.body.stale, 0);
  assert.ok(before.body.rows.every((r: any) => r.state === 'fresh'));

  // Stripe syncs a new month: MRR moves, paying customers do not.
  db.exec(`INSERT INTO project_metrics (project_id, snapshot_date, mrr, paying_accounts, source) VALUES (${P}, '2026-10-31', 18200, 38, 'stripe')`);
  const after = await call(db, FOUNDER, 'POST', '/api/decks/70/refresh');
  assert.equal(after.body.stale, 2, 'MRR moved; paying customers kept its value but its snapshot is a newer one');
  const mrr = after.body.rows.find((r: any) => r.source_key === 'grow.mrr');
  assert.equal(mrr.state, 'stale');
  assert.equal(mrr.slide, 0);
  assert.equal(mrr.field, 'mrr');
  assert.equal(mrr.bound.as_of, '2026-09-30');
  assert.equal(mrr.current.value, 18200);
  assert.equal(mrr.current.as_of, '2026-10-31');
  assert.equal(after.body.rows.find((r: any) => r.source_key === 'build.commits_90d').state, 'fresh');
  // Refresh writes nothing: the deck still carries the old binding.
  const kept = JSON.parse((db.prepare('SELECT slides FROM pitch_decks WHERE id = 70').get() as any).slides);
  assert.equal(kept[0].fields[0].binding.as_of, '2026-09-30');

  // The store loses the value: gone, not fresh.
  db.exec('DELETE FROM github_contributors');
  const gone = await call(db, FOUNDER, 'POST', '/api/decks/70/refresh');
  assert.equal(gone.body.rows.find((r: any) => r.source_key === 'build.commits_90d').state, 'gone');

  // Another founder may not ask.
  assert.equal((await call(db, OTHER, 'POST', '/api/decks/70/refresh')).status, 403);
  assert.equal((await call(db, FOUNDER, 'POST', '/api/decks/999/refresh')).status, 404);
});

test('a save keeps each figure\u2019s binding, drops a malformed one, and refresh finds what was saved', async () => {
  const db = fixture(); seed(db);
  // The deck tables are the deck route's own lazy schema: a read creates them.
  await call(db, FOUNDER, 'GET', '/api/decks/1');
  db.prepare('INSERT INTO pitch_decks (id, project_id, version, title, slides, is_current) VALUES (?, ?, ?, ?, ?, 1)').run(80, P, 1, 'Seed', '[]');
  const mrr = byKey((await call(db, FOUNDER, 'GET', `/api/decks/sources?project_id=${P}`)).body.items).get('grow.mrr')!;
  const binding = { source_key: mrr.source_key, record_ref: mrr.record_ref, as_of: mrr.as_of, grade: mrr.grade, snapshot_hash: mrr.snapshot_hash };
  const slides = [
    { title: 'Traction', binding, fields: [
      { key: 'mrr', label: 'MRR', kind: 'paragraph', value: '$16,950', binding: { ...binding, extra: 'dropped' } },
      { key: 'bad', label: 'Bad', kind: 'paragraph', value: 'x', binding: { source_key: 'DROP TABLE', snapshot_hash: 'zz' } },
    ] },
  ];
  const saved = await call(db, FOUNDER, 'PUT', '/api/decks/80', {}, { slides, title: 'Seed' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const kept = saved.body.slides;
  assert.deepEqual(kept[0].binding, binding, 'a slide-level binding survives the save');
  assert.deepEqual(kept[0].fields[0].binding, binding, 'a field binding survives, with only its five keys');
  assert.equal(kept[0].fields[1].binding, undefined, 'a malformed binding is dropped, not repaired');
  const fresh = await call(db, FOUNDER, 'POST', `/api/decks/${saved.body.id}/refresh`);
  assert.equal(fresh.body.checked, 2);
  assert.equal(fresh.body.stale, 0);
  db.exec(`INSERT INTO project_metrics (project_id, snapshot_date, mrr, paying_accounts, source) VALUES (${P}, '2026-10-31', 18200, 38, 'stripe')`);
  const stale = await call(db, FOUNDER, 'POST', `/api/decks/${saved.body.id}/refresh`);
  assert.equal(stale.body.stale, 2, 'both saved bindings to MRR are stale once Stripe moves');
});

test('sanitizeBinding keeps five bounded keys and refuses a key no slot could name', () => {
  const ok = { source_key: 'grow.mrr', record_ref: 'project_metrics:7', as_of: '2026-09-30', grade: 'Measured', snapshot_hash: 'a'.repeat(24) };
  assert.deepEqual(sanitizeBinding({ ...ok, value: 999, html: '<b>' }), ok);
  assert.equal(sanitizeBinding(null), null);
  assert.equal(sanitizeBinding('grow.mrr'), null);
  assert.equal(sanitizeBinding({ ...ok, source_key: 'Grow.MRR' }), null);
  assert.equal(sanitizeBinding({ ...ok, source_key: 'grow' }), null);
  assert.deepEqual(sanitizeBinding({ ...ok, as_of: '30 Sep', grade: 'Excellent', snapshot_hash: 'xyz', record_ref: 'r'.repeat(121) }),
    { source_key: 'grow.mrr', record_ref: null, as_of: null, grade: null, snapshot_hash: null });
});

test('bindingsOf finds slide, field and block bindings and ignores malformed ones', () => {
  const b = { source_key: 'grow.mrr', snapshot_hash: 'x' };
  const got = bindingsOf([{ binding: b, fields: [{ key: 'a', binding: b }, { key: 'b', binding: { source_key: '' } }, { key: 'c' }] }, { blocks: [{ binding: b }, { binding: 'x' }] }, null]);
  assert.deepEqual(got.map((g) => [g.slide, g.field]), [[0, null], [0, 'a'], [1, 'block:0']]);
});

test('sourceAndGrade: the one mapping every part shares', () => {
  assert.deepEqual(sourceAndGrade('connector'), { source: 'Connector', grade: 'Measured' });
  assert.deepEqual(sourceAndGrade('platform_count'), { source: 'Recorded', grade: 'Measured' });
  assert.deepEqual(sourceAndGrade('recorded_session'), { source: 'Recorded', grade: 'Measured' });
  assert.deepEqual(sourceAndGrade('logged_by_hand'), { source: 'Recorded', grade: 'Sourced' });
  assert.deepEqual(sourceAndGrade('file'), { source: 'Document', grade: 'Sourced' });
  assert.deepEqual(sourceAndGrade('counsel_approved'), { source: 'Document', grade: 'Reviewed' });
  assert.deepEqual(sourceAndGrade('typed'), { source: 'Typed', grade: 'Stated' });
});

test('every slot key is unique and every adapter owns at least one slot', () => {
  const keys = DECK_SOURCES.flatMap((a) => a.slots.map((s) => s.key));
  assert.equal(new Set(keys).size, keys.length);
  for (const a of DECK_SOURCES) assert.ok(a.slots.length > 0, a.id);
});
