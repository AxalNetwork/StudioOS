/**
 * D186 — every repaired checklist detector, exercised against a SATISFYING ROW.
 *
 * `onboarding_checklist_detectors_d184.test.ts` asks whether each detect query
 * PREPARES against a fresh build. That is necessary and it is not sufficient:
 * a query that prepares and matches nothing produces exactly the silent zero
 * this whole task is about — `num()` is `try { … } catch { return 0 }`, so a
 * wrong-but-valid column, a join through the wrong key, or a predicate that
 * can never be true all read as "the user has not done this yet", forever,
 * with nothing logged.
 *
 * So this file seeds the fact each item claims to observe and asserts the item
 * comes back `completed` through the real `loadChecklist` path — the same
 * lazy-detect-then-upsert the dashboard runs. Every case carries its negative
 * half: a CONTROL user of the same role, with nothing seeded, must read
 * `pending`. Without that half an assertion passes just as well against a
 * detector that matches every row, which is the D186 trap `mt.comp` names in
 * its own comment: `experts.pricing_model` is `NOT NULL DEFAULT 'paid'`, so
 * the obvious rename would have flipped that item from never- to
 * ALWAYS-satisfiable and every assertion here would still have been green.
 *
 * The database is the real one — `schema_baseline.sql` plus every post-cutoff
 * migration — because a hand-written fixture is how this class hides. #203 was
 * exactly that, and `board_lanes.test.ts` says so in its own header.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/onboarding_checklist_repairs_d186.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { d1Over } from './_d1_sqlite.mjs';
import { splitStatements } from './_baseline.mjs';
import { BASELINE_CUTOFF, migrationNumber } from '../../scripts/lib/migrationPlan.mjs';
import { loadChecklist, markItem, CATALOG } from '../src/services/onboardingChecklist.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SQL = resolve(HERE, '../sql');
const MIGRATIONS = resolve(SQL, 'migrations');

/** A new environment's schema: the baseline, then every migration past it. */
function freshDb(): InstanceType<typeof DatabaseSync> {
  const db = new DatabaseSync(':memory:', { enableDoubleQuotedStringLiterals: true });
  db.exec(readFileSync(resolve(SQL, 'schema_baseline.sql'), 'utf8'));
  for (const name of readdirSync(MIGRATIONS)
    .filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF)
    .sort((a, b) => migrationNumber(a) - migrationNumber(b) || a.localeCompare(b))) {
    for (const stmt of splitStatements(readFileSync(resolve(MIGRATIONS, name), 'utf8'))) {
      try { db.exec(stmt); } catch { /* fresh-build failures are migrations_fresh_build's to report */ }
    }
  }
  return db;
}

const db = freshDb();
const env = { DB: d1Over(db) } as any;

let seq = 0;
const next = () => ++seq;

function run(sql: string, ...binds: any[]): void {
  db.prepare(sql).run(...binds);
}
function lastId(): number {
  return Number((db.prepare('SELECT last_insert_rowid() AS id').get() as any).id);
}

/** A user of the given role, with a unique email so the UNIQUE holds. */
function mkUser(role: string): number {
  const n = next();
  run(`INSERT INTO users (email, name, role) VALUES (?, ?, ?)`, `u${n}@t.test`, `User ${n}`, role);
  return lastId();
}

/** A founder row, a user pointing at it, and a project under it. */
function mkFounderWithProject(userId: number): number {
  const n = next();
  run(`INSERT INTO founders (name, email) VALUES (?, ?)`, `F${n}`, `f${n}@t.test`);
  const founderId = lastId();
  run(`UPDATE users SET founder_id = ? WHERE id = ?`, founderId, userId);
  run(`INSERT INTO projects (name, founder_id) VALUES (?, ?)`, `P${n}`, founderId);
  return lastId();
}

/** An advisors row bound to the user through users.advisor_id. */
function mkAdvisor(userId: number): number {
  const n = next();
  run(`INSERT INTO advisors (uid, display_name) VALUES (?, ?)`, `adv-${n}`, `Advisor ${n}`);
  const advisorId = lastId();
  run(`UPDATE users SET advisor_id = ? WHERE id = ?`, advisorId, userId);
  return advisorId;
}

/** An experts row owned by the user. */
function mkExpert(userId: number, cols: Record<string, any> = {}): number {
  const n = next();
  const keys = ['user_id', 'name', ...Object.keys(cols)];
  const vals = [userId, `Expert ${n}`, ...Object.values(cols)];
  run(`INSERT INTO experts (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...vals);
  return lastId();
}

type Case = {
  key: string;
  role: string;
  persona?: string;
  /** Seeds the one fact this item observes. */
  seed: (userId: number) => void;
};

// One case per detector D186 repointed. The seed is the MINIMUM that should
// satisfy the item — anything more and a passing assertion stops telling us
// which column the query is actually reading.
const CASES: Case[] = [
  {
    // was expert_bookings.founder_user_id, a column that table never had
    key: 'nf.advisor', role: 'founder',
    seed: (u) => run(`INSERT INTO expert_bookings (expert_id, user_id) VALUES (1, ?)`, u),
  },
  {
    // the captable_holders arm was deleted; cap_table_holders is the real table
    key: 'ef.captable', role: 'founder', persona: 'founder_existing',
    seed: (u) => {
      const p = mkFounderWithProject(u);
      run(`INSERT INTO cap_table_holders (user_id, project_id, name) VALUES (?, ?, 'Holder')`, u, p);
    },
  },
  {
    // was financial_models.user_id; the table is keyed on project_id
    key: 'ef.financials', role: 'founder', persona: 'founder_existing',
    seed: (u) => {
      const p = mkFounderWithProject(u);
      run(`INSERT INTO financial_models (project_id) VALUES (?)`, p);
    },
  },
  {
    // was compliance_records, which has no subject column at all
    key: 'ef.83b', role: 'founder', persona: 'founder_existing',
    seed: (u) => {
      const p = mkFounderWithProject(u);
      run(
        `INSERT INTO section_83b_trackers (project_id, user_id, taxpayer_name, grant_date, deadline_date)
         VALUES (?, ?, 'Taxpayer', '2026-01-01', '2026-02-01')`, p, u,
      );
    },
  },
  {
    // was pairwise_ndas.user_a / user_b
    key: 'ef.nda', role: 'founder', persona: 'founder_existing',
    seed: (u) => run(
      `INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id) VALUES (?, ?)`, u, next() + 90000),
  },
  {
    // was kyc_records, a table that exists nowhere. BOTH obligations, per the label.
    key: 'inv.kyc', role: 'investor',
    seed: (u) => {
      run(`INSERT INTO legal_obligations (user_id, obligation_key, status) VALUES (?, 'kyc_v1', 'satisfied')`, u);
      run(`INSERT INTO legal_obligations (user_id, obligation_key, status) VALUES (?, 'accreditation_v1', 'satisfied')`, u);
    },
  },
  {
    // was investor_profiles.thesis
    key: 'inv.thesis', role: 'investor',
    seed: (u) => run(`INSERT INTO investor_profiles (user_id, thesis_text) VALUES (?, 'Seed B2B infra')`, u),
  },
  {
    // was match_scores.investor_user_id; the writer binds the investor to user_id
    key: 'inv.review', role: 'investor',
    seed: (u) => {
      // Three distinct targets: idx_match_scores_unique is
      // (user_id, score_type, deal_id, target_user_id), so three identical
      // rows would collide and the item needs >= 3.
      for (let i = 0; i < 3; i++) {
        run(`INSERT INTO match_scores (user_id, target_user_id, score_type, score)
             VALUES (?, ?, 'deal_flow', 0.5)`, u, mkUser('founder'));
      }
    },
  },
  {
    // was deployment_target_cents / reserve_percent, fields no table has
    key: 'inv.target', role: 'investor',
    seed: (u) => run(`INSERT INTO investor_profiles (user_id, ticket_min_usd) VALUES (?, 50000)`, u),
  },
  {
    // was accepted_user_id / email / redeemed_at
    key: 'op.accept', role: 'partner',
    seed: (u) => run(
      `INSERT INTO partner_invitations (token, recipient_email, invited_by_user_id, expires_at, signed_at, resulting_user_id)
       VALUES (?, ?, ?, '2030-01-01', '2026-01-01', ?)`,
      `tok-${next()}`, `inv${next()}@t.test`, u, u,
    ),
  },
  {
    // was partner_user_id / signed_at
    key: 'op.deal_type', role: 'partner',
    seed: (u) => run(
      `INSERT INTO partner_deals (user_id, deal_type, proposal_json, activated_at)
       VALUES (?, 'services_partnership', '{}', '2026-01-01')`, u),
  },
  {
    // was kyc_records; corporate_profiles IS the KYB configuration
    key: 'op.kyb', role: 'partner',
    seed: (u) => run(`INSERT INTO corporate_profiles (user_id, entity_name) VALUES (?, 'Acme Ltd')`, u),
  },
  {
    // was referral_invites.owner_user_id
    key: 'op.referral', role: 'partner',
    seed: (u) => run(
      `INSERT INTO referral_invites (sender_user_id, recipient_email, referral_code) VALUES (?, ?, ?)`,
      u, `r${next()}@t.test`, `code-${next()}`),
  },
  {
    // was investor_introductions.source_user_id / introducer_user_id — that table
    // records the two PARTIES and no introducer at all
    key: 'op.intro', role: 'partner',
    seed: (u) => run(
      `INSERT INTO intro_propositions (uid, user_id, target_user_id) VALUES (?, ?, ?)`,
      `ip-${next()}`, u, mkUser('founder')),
  },
  {
    // was experts.tags. BOTH json columns, and non-empty ARRAYS: '[]' is
    // filled-in-nothing, which the default already is.
    key: 'mt.tags', role: 'advisor',
    seed: (u) => mkExpert(u, { categories_json: '["product"]', sectors_json: '["fintech"]' }),
  },
  {
    // was experts.comp_model. NOT pricing_model — see the header.
    key: 'mt.comp', role: 'advisor',
    seed: (u) => mkExpert(u, { hourly_rate_usd: 250 }),
  },
  {
    // was experts.weekly_capacity — a DIFFERENT ENTITY: advisors, via users.advisor_id
    key: 'mt.capacity', role: 'advisor',
    seed: (u) => {
      const a = mkAdvisor(u);
      run(`UPDATE advisors SET weekly_hours_band = '5-10' WHERE id = ?`, a);
    },
  },
  {
    // was advisor_slots, which survives only in sql/historical/
    key: 'mt.slots', role: 'advisor',
    seed: (u) => {
      const a = mkAdvisor(u);
      run(`INSERT INTO advisor_availability_rules (advisor_id) VALUES (?)`, a);
    },
  },
  {
    // was expert_bookings.expert_user_id; the join is expert_id -> experts.user_id
    key: 'mt.booking', role: 'advisor',
    seed: (u) => {
      const e = mkExpert(u);
      run(`INSERT INTO expert_bookings (expert_id, user_id, status) VALUES (?, ?, 'confirmed')`, e, mkUser('founder'));
    },
  },
];

// The gates that do real work, each with the row that ALMOST satisfies it.
// A repoint can be right about the table and wrong about the threshold, and
// the cases above cannot see that: they seed the full fact, so a predicate
// loosened to match a partial one still passes every one of them. These are
// the near misses each gate exists to refuse.
const NEAR_MISSES: Case[] = [
  {
    // The label is "Complete KYC + Accreditation", so ONE obligation is not it.
    key: 'inv.kyc', role: 'investor',
    seed: (u) => run(
      `INSERT INTO legal_obligations (user_id, obligation_key, status) VALUES (?, 'kyc_v1', 'satisfied')`, u),
  },
  {
    // Two matched founders is not three.
    key: 'inv.review', role: 'investor',
    seed: (u) => {
      for (let i = 0; i < 2; i++) {
        run(`INSERT INTO match_scores (user_id, target_user_id, score_type, score)
             VALUES (?, ?, 'deal_flow', 0.5)`, u, mkUser('founder'));
      }
    },
  },
  {
    // A score of another kind is not deal flow.
    key: 'inv.review', role: 'investor',
    seed: (u) => {
      for (let i = 0; i < 3; i++) {
        run(`INSERT INTO match_scores (user_id, target_user_id, score_type, score)
             VALUES (?, ?, 'cofounder', 0.5)`, u, mkUser('founder'));
      }
    },
  },
  {
    // A corporate_profiles row with no entity name is not a configured KYB.
    key: 'op.kyb', role: 'partner',
    seed: (u) => run(`INSERT INTO corporate_profiles (user_id, entity_name) VALUES (?, '')`, u),
  },
  {
    // Proposed is not "signed and live" — activated_at is what says it went live.
    key: 'op.deal_type', role: 'partner',
    seed: (u) => run(
      `INSERT INTO partner_deals (user_id, deal_type, proposal_json) VALUES (?, 'services_partnership', '{}')`, u),
  },
  {
    // An invitation that was sent and never signed is not an accepted one.
    key: 'op.accept', role: 'partner',
    seed: (u) => run(
      `INSERT INTO partner_invitations (token, recipient_email, invited_by_user_id, expires_at, resulting_user_id)
       VALUES (?, ?, ?, '2030-01-01', ?)`,
      `tok-${next()}`, `inv${next()}@t.test`, u, u),
  },
  {
    // Sectors without categories is not "expertise tags + sectors": the label
    // names both, so an OR would let half of it read as done.
    key: 'mt.tags', role: 'advisor',
    seed: (u) => mkExpert(u, { sectors_json: '["fintech"]' }),
  },
  {
    // THE pricing_model TRAP, as a row. An experts profile with no rate and no
    // free first session has picked no comp model — but it DOES carry
    // pricing_model = 'paid', because that column is NOT NULL DEFAULT 'paid'.
    // Point mt.comp at it and this case is the one that goes red.
    key: 'mt.comp', role: 'advisor',
    seed: (u) => mkExpert(u),
  },
  {
    // An advisors row with no band declared is not a declared capacity.
    key: 'mt.capacity', role: 'advisor',
    seed: (u) => mkAdvisor(u),
  },
  {
    // A booking against SOMEBODY ELSE's expert profile is not this advisor's.
    key: 'mt.booking', role: 'advisor',
    seed: (u) => {
      mkExpert(u);
      const other = mkExpert(mkUser('advisor'));
      run(`INSERT INTO expert_bookings (expert_id, user_id, status) VALUES (?, ?, 'confirmed')`,
        other, mkUser('founder'));
    },
  },
];

async function statusOf(userId: number, role: string, key: string, persona?: string): Promise<string> {
  const res = await loadChecklist(env, { id: userId, role }, persona);
  const row = res.items.find((r: any) => r.key === key);
  assert.ok(row, `${key} is not in the ${res.role} catalogue — the case names a key that moved`);
  return row!.status;
}

// ---------------------------------------------------------------------------

test('every repointed detector is satisfied by a real row, and by nothing else', async () => {
  // NON-VACUITY. The count is the arithmetic D186 states: twenty-four broken
  // detectors, of which four became autoDetect:false (no store anywhere) and
  // one was a dead second arm on an item that already worked. Nineteen
  // repointed detectors are left, and each one is a case below.
  assert.equal(CASES.length, 19,
    `${CASES.length} cases — a repoint lost its satisfying-row case, or one was added without one`);

  for (const c of CASES) {
    const satisfied = mkUser(c.role);
    c.seed(satisfied);
    assert.equal(await statusOf(satisfied, c.role, c.key, c.persona), 'completed',
      `${c.key} PREPARES but does not MATCH — the repoint reads a column or a join the writer does not fill, `
      + 'so the item reads "not done" for every account exactly as it did before D186');

    // The half that makes the half above mean something: an identical account
    // with nothing seeded must NOT be satisfied. A detector that matches every
    // row passes the assertion above and is worse than the defect.
    const control = mkUser(c.role);
    assert.equal(await statusOf(control, c.role, c.key, c.persona), 'pending',
      `${c.key} is satisfied for an account that has done nothing — the predicate matches every row`);
  }
});

test('a row that almost satisfies an item does not satisfy it', async () => {
  // Non-vacuity, same shape as above: every gate D186 wrote deliberately has a
  // near miss here, so loosening one is caught by a row rather than by a
  // reader noticing.
  assert.ok(NEAR_MISSES.length >= 10,
    `${NEAR_MISSES.length} near misses — a deliberate gate lost the row that refuses it`);

  for (const c of NEAR_MISSES) {
    const u = mkUser(c.role);
    c.seed(u);
    assert.equal(await statusOf(u, c.role, c.key, c.persona), 'pending',
      `${c.key} is satisfied by a row that only half satisfies it — the gate was loosened`);
  }
});

test('the four storeless items are never auto-detected, and the user can tick them', async () => {
  // D186's other half. Nothing in the schema records an IP assignment, a
  // partner conflict disclosure, or a self-provided reference, so these four
  // carry autoDetect:false and their `case` arms were deleted outright —
  // leaving a dead arm would keep its literal harvestable and its baseline
  // entry alive, which is what both check-sqlite-* guards refuse.
  const storeless = [
    { key: 'ef.ip', role: 'founder', persona: 'founder_existing' },
    { key: 'op.conflicts', role: 'partner' },
    { key: 'op.refs', role: 'partner' },
    { key: 'mt.refs', role: 'advisor' },
  ];

  for (const s of storeless) {
    const item = Object.values(CATALOG).flat().find((i: any) => i.key === s.key);
    assert.ok(item, `${s.key} left the catalogue — a step whose only answer is "no" was removed, not flipped`);
    assert.equal(item!.autoDetect, false,
      `${s.key} is autoDetect:true again, so it runs a detector against a store that does not exist`);

    const u = mkUser(s.role);
    assert.equal(await statusOf(u, s.role, s.key, s.persona), 'pending');

    // The step is satisfiable BY HAND, which is the whole reason it stays.
    await markItem(env, u, s.key, 'complete');
    assert.equal(await statusOf(u, s.role, s.key, s.persona), 'completed',
      `${s.key} cannot be ticked by hand, so it is a step whose only possible answer is "no"`);
  }
});

test('the advisor catalogue can now reach the celebration threshold', async () => {
  // THE SHARPEST CONSEQUENCE, END TO END. Seven of the advisor's ten items were
  // broken while CELEBRATION_THRESHOLD is an absolute 8, so an advisor who did
  // everything the platform could observe reached 3 of 10 and the checklist
  // never finished. Seed the advisor side in full and count.
  const u = mkUser('advisor');
  const a = mkAdvisor(u);
  run(`UPDATE advisors SET weekly_hours_band = '5-10' WHERE id = ?`, a);
  run(`INSERT INTO advisor_availability_rules (advisor_id) VALUES (?)`, a);
  const e = mkExpert(u, { categories_json: '["product"]', sectors_json: '["fintech"]', hourly_rate_usd: 250 });
  run(`INSERT INTO expert_bookings (expert_id, user_id, status) VALUES (?, ?, 'completed')`, e, mkUser('founder'));
  run(`INSERT INTO user_personas (user_id, persona_id, is_primary) VALUES (?, 'advisor', 1)`, u);
  run(`INSERT INTO pairwise_ndas (party_a_user_id, party_b_user_id) VALUES (?, ?)`, u, next() + 90000);
  run(`INSERT INTO integrations (uid, user_id, provider_key, status, auth_type)
       VALUES (?, ?, 'calendly', 'active', 'oauth2')`, `int-${next()}`, u);
  run(`UPDATE users SET notification_prefs = '{"digest":true}' WHERE id = ?`, u);

  const res = await loadChecklist(env, { id: u, role: 'advisor' });
  assert.equal(res.role, 'advisor');
  const pending = res.items.filter((r: any) => r.status !== 'completed').map((r: any) => r.key);

  // mt.refs is the only one left, and it is the storeless step the advisor
  // ticks by hand — so nine of ten are detected and the threshold of eight is
  // reached without any manual tick at all.
  assert.deepEqual(pending, ['mt.refs'],
    `expected only the hand-ticked reference step to remain, got: ${pending.join(', ')}`);
  assert.ok(res.completed >= 8,
    `the advisor reached ${res.completed} of 10 against a threshold of 8 — the celebration is still unreachable`);
  assert.equal(res.meta.should_celebrate, true);
});
