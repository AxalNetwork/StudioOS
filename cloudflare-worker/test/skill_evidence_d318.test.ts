/**
 * D318 — skill evidence from platform tools (migration 362,
 * services/skillEvidence.ts, GET /api/skills/me/evidence).
 *
 * On node:sqlite over the baseline's own tables (plus the later migrations the
 * sources read: 238, 339, 360, 361):
 *
 *   1. THE MIGRATION stands alone, and its CHECKs hold the axis and the counts.
 *   2. EVERY SOURCE counts its owner's rows and never another user's: two users
 *      are seeded per role, one row each per source, and each owner must see
 *      exactly one per source.
 *   3. THE WINDOW: an action in the last 12 months counts 1, an older one fades
 *      with a 12-month half-life; lifetime totals stay for display.
 *   4. NO EVIDENCE IS "none", never 0; the corroborate blend never raises or
 *      creates a self-rating.
 *   5. THE ROUTE reads the caller's own evidence only.
 *   6. THE BATCH is bounded, resumable and idempotent: a second pass at the
 *      same moment changes nothing.
 *   7. THE MAP in PROFILING_V2.md names every source in code.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/skill_evidence_d318.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import skillsRoutes from '../src/routes/skills.ts';
import { AUTH_ERROR_STATUSES } from '../src/util/authErrors.ts';
import {
  EVIDENCE_SOURCES, ageWeight, blend, collectEvidence, evidenceReport, evidenceScore,
  parseAt, provenanceLine, recomputeEvidenceBatch, recomputeUserEvidence, specializationAxes,
} from '../src/services/skillEvidence.ts';
import { tableFromBaseline, stripForeignKeys } from './_baseline.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const BASELINE = read('cloudflare-worker/sql/schema_baseline.sql');
const MIGRATION = read('cloudflare-worker/sql/migrations/362_skill_evidence.sql');
const LATER = [
  'cloudflare-worker/sql/migrations/238_advisor_engagements.sql',
  'cloudflare-worker/sql/migrations/339_dd_section_signoff.sql',
  'cloudflare-worker/sql/migrations/360_partner_booking_action_items.sql',
  'cloudflare-worker/sql/migrations/361_partner_booking_ratings.sql',
].map(read);
const JWT_SECRET = 'unit-test-jwt-secret-0123456789-abcdef';

const NOW = new Date('2026-09-28T12:00:00Z');
const RECENT = '2026-08-15 10:00:00';
const OLD = '2024-09-28 12:00:00'; // 730 days before NOW → weight 0.5

// Two of each role: the owner (first) and someone else (second).
const FAY = 1; const FRED = 2;   // founders (founders.id 100, 101)
const IVY = 3; const IKE = 4;    // investors
const PIA = 5; const PAT = 6;    // partners (partners.id 20, 21)
const VIC = 7; const VAL = 8;    // advisors (advisors.id 30, 31; experts.id 40, 41)
const NIL = 9;                   // has nothing at all
const ROLE: Record<number, string> = {
  [FAY]: 'founder', [FRED]: 'founder', [IVY]: 'investor', [IKE]: 'investor',
  [PIA]: 'partner', [PAT]: 'partner', [VIC]: 'advisor', [VAL]: 'advisor', [NIL]: 'founder',
};

const TABLES = [
  'users', 'projects', 'skills', 'user_skills', 'pitch_decks', 'brand_sites', 'discovery_interviews',
  'roadmap_okrs', 'financial_models', 'esign_envelopes', 'esign_recipients', 'cap_table_securities',
  'spinout_lab_milestones', 'dd_sections', 'deal_stage_events', 'commitments', 'partners',
  'partner_bookings', 'perks', 'perk_claims', 'advisors', 'engagements', 'engagement_milestones',
  'experts', 'expert_bookings', 'expert_ratings', 'cohort_guidance',
];

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
        async run() {
          const r = db.prepare(sql).run(...b);
          return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
        },
      };
      return api;
    },
    async exec(sql: string) { db.exec(sql); return { count: 0, duration: 0 }; },
    async batch(x: any[]) { const out = []; for (const s of x) out.push(await s.run()); return out; },
  };
}

function schemaOnly() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const t of TABLES) db.exec(stripForeignKeys(tableFromBaseline(BASELINE, t)));
  for (const m of LATER) db.exec(m);
  db.exec(MIGRATION);
  return db;
}

/** One row per source for each owner, and one for the other user of the same role. */
function seeded() {
  const db = schemaOnly();
  const run = (sql: string, ...a: any[]) => db.prepare(sql).run(...coerce(a));
  const u = (id: number, name: string, extra: { founder_id?: number; partner_id?: number } = {}) =>
    run('INSERT INTO users (id, email, role, name, founder_id, partner_id) VALUES (?,?,?,?,?,?)',
      id, `${name.toLowerCase().replace(/ /g, '.')}@example.test`, ROLE[id], name, extra.founder_id ?? null, extra.partner_id ?? null);
  u(FAY, 'Fay Founder', { founder_id: 100 });
  u(FRED, 'Fred Founder', { founder_id: 101 });
  u(IVY, 'Ivy Investor'); u(IKE, 'Ike Investor');
  u(PIA, 'Pia Partner', { partner_id: 20 }); u(PAT, 'Pat Partner', { partner_id: 21 });
  u(VIC, 'Vic Advisor'); u(VAL, 'Val Advisor'); u(NIL, 'Nil Newcomer', { founder_id: 102 });

  run(`INSERT INTO projects (id, uid, name, founder_id) VALUES (10, 'p-fay', 'Fay Co', 100), (11, 'p-fred', 'Fred Co', 101)`);
  run(`INSERT INTO partners (id, name, email, specialization, status) VALUES
    (20, 'Pia Studio', 'pia@example.test', 'GTM and growth', 'active'),
    (21, 'Pat Law', 'pat@example.test', 'Legal counsel', 'active')`);
  run(`INSERT INTO advisors (id, uid, user_id, display_name, email, expertise_json, is_active) VALUES
    (30, 'a-vic', ?, 'Vic Advisor', 'vic@example.test', '["Finance","Fundraising"]', 1),
    (31, 'a-val', ?, 'Val Advisor', 'val@example.test', '["Design"]', 1)`, VIC, VAL);
  run(`INSERT INTO experts (id, uid, user_id, name) VALUES (40, 'x-vic', ?, 'Vic Advisor'), (41, 'x-val', ?, 'Val Advisor')`, VIC, VAL);

  for (const [owner, project] of [[FAY, 10], [FRED, 11]] as const) {
    run(`INSERT INTO pitch_decks (project_id, version, slides, title, is_current, created_by, created_at) VALUES (?, 1, '[]', 'Deck', 1, ?, ?)`, project, owner, RECENT);
    run(`INSERT INTO brand_sites (project_id, slug, created_at, updated_at) VALUES (?, ?, ?, ?)`, project, `s${owner}`, RECENT, RECENT);
    run(`INSERT INTO discovery_interviews (project_id, interviewee_name, interview_date, created_at, updated_at) VALUES (?, 'Ann Example', ?, ?, ?)`, project, RECENT, RECENT, RECENT);
    run(`INSERT INTO roadmap_okrs (project_id, objective, kanban_status, created_at, updated_at) VALUES (?, 'Ship', 'done', ?, ?)`, project, RECENT, RECENT);
    run(`INSERT INTO roadmap_okrs (project_id, objective, kanban_status, created_at, updated_at) VALUES (?, 'Not yet', 'now', ?, ?)`, project, RECENT, RECENT);
    run(`INSERT INTO financial_models (project_id, updated_by, updated_at) VALUES (?, ?, ?)`, project, owner, RECENT);
    run(`INSERT INTO cap_table_securities (user_id, project_id, name, created_at, updated_at) VALUES (?, ?, 'Common', ?, ?)`, owner, project, RECENT, RECENT);
    const env = run(`INSERT INTO esign_envelopes (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by, created_at, completed_at) VALUES (?, ?, 'safe', 'SAFE', 'x', 'x', 'completed', ?, ?, ?)`,
      `env-${owner}`, owner, owner, RECENT, RECENT);
    run(`INSERT INTO esign_recipients (envelope_id, user_id, recipient_email, recipient_name, signing_token, token_expires_at, signed_at, status) VALUES (?, ?, 'r@example.test', 'Rae Signer', ?, ?, ?, 'signed')`,
      Number(env.lastInsertRowid), owner, `tok-${owner}`, RECENT, RECENT);
    run(`INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at) VALUES (?, 1, 'incorporation_completed', ?)`, owner, RECENT);
    // Taking part is not a skill: this one must not count.
    run(`INSERT INTO spinout_lab_milestones (user_id, week, milestone_key, completed_at) VALUES (?, 1, 'project_created', ?)`, owner, RECENT);
  }
  for (const [owner, n] of [[IVY, 1], [IKE, 2]] as const) {
    run(`INSERT INTO dd_sections (case_id, section_key, title, status, completed_at, signed_off_by) VALUES (?, 'financial_health', 'Financials', 'completed', ?, ?)`, n, RECENT, owner);
    run(`INSERT INTO commitments (uid, deal_id, investor_user_id, amount, status, created_at) VALUES (?, ?, ?, 1000, 'pending', ?)`, `c-${owner}`, n, owner, RECENT);
    run(`INSERT INTO commitments (uid, deal_id, investor_user_id, amount, status, created_at) VALUES (?, ?, ?, 1000, 'withdrawn', ?)`, `cx-${owner}`, n, owner, RECENT);
    // Two moves on one deal are one deal worked.
    run(`INSERT INTO deal_stage_events (deal_id, from_stage, to_stage, actor_user_id, created_at) VALUES (?, 'sourced', 'screening', ?, ?)`, 50 + n, owner, OLD);
    run(`INSERT INTO deal_stage_events (deal_id, from_stage, to_stage, actor_user_id, created_at) VALUES (?, 'screening', 'dd', ?, ?)`, 50 + n, owner, RECENT);
  }
  for (const [owner, partnerId] of [[PIA, 20], [PAT, 21]] as const) {
    const b = run(`INSERT INTO partner_bookings (uid, slot_id, partner_id, founder_user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'completed', ?, ?)`,
      `b-${owner}`, partnerId, partnerId, FAY, RECENT, RECENT);
    run(`INSERT INTO partner_bookings (uid, slot_id, partner_id, founder_user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      `bp-${owner}`, partnerId + 100, partnerId, FAY, RECENT, RECENT);
    const bid = Number(b.lastInsertRowid);
    run(`INSERT INTO partner_booking_ratings (booking_id, partner_id, founder_user_id, rating, created_at) VALUES (?, ?, ?, 5, ?)`, bid, partnerId, FAY, RECENT);
    run(`INSERT INTO partner_booking_action_items (booking_id, title, done_at, created_by_user_id, created_by_role) VALUES (?, 'Follow up', ?, ?, 'partner')`, bid, RECENT, owner);
    const e = run(`INSERT INTO engagements (uid, need_id, quote_id, partner_id, founder_id, project_id, price, status, created_at, updated_at) VALUES (?, ?, ?, ?, 100, 10, 0, 'active', ?, ?)`, `e-${owner}`, partnerId, partnerId, partnerId, RECENT, RECENT);
    run(`INSERT INTO engagement_milestones (uid, engagement_id, title, completed_at) VALUES (?, ?, 'M1', ?)`, `m-${owner}`, Number(e.lastInsertRowid), RECENT);
    const pk = run(`INSERT INTO perks (uid, partner_user_id, partner_name, category, offer, status) VALUES (?, ?, 'Pia Studio', 'software', 'Offer', 'live')`, `pk-${owner}`, owner);
    run(`INSERT INTO perk_claims (uid, perk_id, user_id, status, redeemed_at) VALUES (?, ?, ?, 'redeemed', ?)`, `pc-${owner}`, Number(pk.lastInsertRowid), FAY, RECENT);
  }
  for (const [owner, advisorId, expertId] of [[VIC, 30, 40], [VAL, 31, 41]] as const) {
    run(`INSERT INTO advisor_engagements (uid, advisor_id, client_name, started_at) VALUES (?, ?, 'Client', ?)`, `ae-${owner}`, advisorId, RECENT);
    run(`INSERT INTO expert_bookings (uid, expert_id, user_id, scheduled_at, status) VALUES (?, ?, ?, ?, 'completed')`, `eb-${owner}`, expertId, FAY, RECENT);
    run(`INSERT INTO expert_ratings (uid, expert_id, user_id, stars) VALUES (?, ?, ?, 4)`, `er-${owner}`, expertId, FAY);
    run(`UPDATE expert_ratings SET created_at = ? WHERE uid = ?`, RECENT, `er-${owner}`);
    run(`INSERT INTO cohort_guidance (uid, cohort_cycle_id, advisor_user_id, body, answer, answered_at) VALUES (?, 1, ?, 'Q', 'A', ?)`, `g-${owner}`, owner, RECENT);
  }
  return db;
}

const env = (db: any) => ({ DB: makeD1(db), JWT_SECRET } as any);

/* 1 · the migration ------------------------------------------------------ */

test('D318: migration 362 stands alone, and its CHECKs hold the axis and the counts', () => {
  const sql = MIGRATION.replace(/^\s*--.*$/gm, '');
  assert.ok(!/\bBEGIN\b|\bCOMMIT\b|DROP |ALTER /i.test(sql));
  const db = schemaOnly();
  const ins = db.prepare(`INSERT INTO skill_evidence (user_id, axis, source, count_lifetime, count_window, weighted, first_at, last_at, computed_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  assert.throws(() => ins.run(1, 'cooking', 's', 1, 1, 1, 'a', 'a', 'a'), /CHECK/, 'an axis that is not on the radar');
  assert.throws(() => ins.run(1, 'product', 's', 0, 0, 0, 'a', 'a', 'a'), /CHECK/, 'a row with no actions');
  assert.throws(() => ins.run(1, 'product', 's', 1, 2, 1, 'a', 'a', 'a'), /CHECK/, 'more in the window than in a lifetime');
  ins.run(1, 'product', 's', 2, 1, 1.5, 'a', 'b', 'c');
  assert.throws(() => ins.run(1, 'product', 's', 1, 1, 1, 'a', 'a', 'a'), /UNIQUE|PRIMARY/);
  assert.throws(() => db.prepare('INSERT INTO skill_evidence_cursor (id) VALUES (2)').run(), /CHECK/);
  // It stores counts and dates, never content.
  const cols = db.prepare('PRAGMA table_info(skill_evidence)').all().map((c: any) => c.name);
  assert.deepEqual(cols, ['user_id', 'axis', 'source', 'count_lifetime', 'count_window', 'weighted', 'first_at', 'last_at', 'computed_at']);
});

/* 2 · every source counts its owner only --------------------------------- */

test('D318: every source counts its owner’s own rows, once, and never another user’s', async () => {
  const db = seeded();
  const owners = [FAY, FRED, IVY, IKE, PIA, PAT, VIC, VAL];
  const seen = new Set<string>();
  for (const who of owners) {
    const { rows } = await collectEvidence(env(db), who, NOW);
    const bySource = new Map<string, number>();
    for (const r of rows) {
      seen.add(r.source);
      // Every axis a source feeds carries the same single action.
      const prev = bySource.get(r.source);
      if (prev != null) assert.equal(r.count_lifetime, prev, `${r.source} disagrees with itself across axes for user ${who}`);
      bySource.set(r.source, r.count_lifetime);
    }
    for (const [source, n] of bySource) {
      assert.equal(n, 1, `user ${who}: ${source} counted ${n} — another user's row, or a row that is not evidence, leaked in`);
    }
  }
  assert.deepEqual([...seen].sort(), EVIDENCE_SOURCES.map((s) => s.key).sort(), 'a source in the map found nothing to count');
});

test('D318: the axes come from the source — fixed, by key, or from the person’s own specialization', async () => {
  const db = seeded();
  const axesOf = async (who: number, source: string) =>
    (await collectEvidence(env(db), who, NOW)).rows.filter((r) => r.source === source).map((r) => r.axis).sort();
  assert.deepEqual(await axesOf(FAY, 'deck_version'), ['capital_network', 'marketing_brand']);
  assert.deepEqual(await axesOf(FAY, 'lab_milestone'), ['legal_compliance']);
  assert.deepEqual(await axesOf(IVY, 'dd_section_signed_off'), ['finance_ops']);
  assert.deepEqual(await axesOf(PIA, 'office_hours_completed'), ['gtm_sales'], 'Pia’s specialization is GTM and growth');
  assert.deepEqual(await axesOf(PAT, 'office_hours_completed'), ['legal_compliance'], 'Pat’s is legal counsel');
  assert.deepEqual(await axesOf(VIC, 'expert_session_completed'), ['capital_network', 'finance_ops']);
  assert.deepEqual(await axesOf(VAL, 'advisor_engagement'), ['design']);
});

test('D318: a specialization that names no axis is reported as not counted, not guessed', async () => {
  const db = seeded();
  db.prepare(`UPDATE partners SET specialization = 'Good vibes' WHERE id = 20`).run();
  const r = await evidenceReport(env(db), PIA, NOW);
  assert.ok(r.axes.every((a) => a.evidence === null), 'an unmapped specialization produced evidence on some axis');
  const office = r.unmapped.find((u) => u.source === 'office_hours_completed');
  assert.ok(office && office.count === 1 && /names no radar axis/.test(office.note));
  assert.deepEqual(specializationAxes(['["Legal","Ops"]', 'Brand design']).sort(), ['design', 'finance_ops', 'legal_compliance', 'marketing_brand']);
  assert.deepEqual(specializationAxes([null, '', 'Vibes']), []);
});

test('D318: what is not evidence is not counted — unfinished, unsigned, poorly rated, not held', async () => {
  const db = seeded();
  const run = (sql: string, ...a: any[]) => db.prepare(sql).run(...coerce(a));
  // Fay: an envelope still out for signature, and a copy she has not signed.
  const env2 = run(`INSERT INTO esign_envelopes (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by, created_at) VALUES ('env-open', ?, 'nda', 'NDA', 'x', 'x', 'sent', ?, ?)`, FAY, FAY, RECENT);
  run(`INSERT INTO esign_recipients (envelope_id, user_id, recipient_email, recipient_name, signing_token, token_expires_at, status) VALUES (?, ?, 'r@example.test', 'Rae Signer', 'tok-open', ?, 'pending')`, Number(env2.lastInsertRowid), FAY, RECENT);
  // …and one voided after it was dated: the status decides, not the date.
  run(`INSERT INTO esign_envelopes (envelope_uuid, user_id, document_type, document_title, document_body, body_sha256, status, created_by, created_at, completed_at) VALUES ('env-void', ?, 'nda', 'NDA', 'x', 'x', 'voided', ?, ?, ?)`, FAY, FAY, RECENT, RECENT);
  // Ivy: a second deal is a second deal worked.
  run(`INSERT INTO deal_stage_events (deal_id, from_stage, to_stage, actor_user_id, created_at) VALUES (60, 'sourced', 'screening', ?, ?)`, IVY, RECENT);
  // Pia: a second session held, rated 2★ — held, but not rated well.
  const b2 = run(`INSERT INTO partner_bookings (uid, slot_id, partner_id, founder_user_id, status, created_at, updated_at) VALUES ('b-pia-2', 300, 20, ?, 'completed', ?, ?)`, FRED, RECENT, RECENT);
  run(`INSERT INTO partner_booking_ratings (booking_id, partner_id, founder_user_id, rating, created_at) VALUES (?, 20, ?, 2, ?)`, Number(b2.lastInsertRowid), FRED, RECENT);
  // Vic: a session booked but not yet held, and a 3★ rating.
  run(`INSERT INTO expert_bookings (uid, expert_id, user_id, scheduled_at, status) VALUES ('eb-vic-2', 40, ?, ?, 'confirmed')`, FRED, RECENT);
  run(`INSERT INTO expert_ratings (uid, expert_id, user_id, stars, created_at) VALUES ('er-vic-2', 40, ?, 3, ?)`, FRED, RECENT);

  // Vic: an answer later retired is withdrawn guidance.
  run(`INSERT INTO cohort_guidance (uid, cohort_cycle_id, advisor_user_id, body, answer, answered_at, retired_at) VALUES ('g-vic-2', 1, ?, 'Q', 'A', ?, ?)`, VIC, RECENT, RECENT);

  const count = async (who: number, source: string) =>
    (await collectEvidence(env(db), who, NOW)).rows.find((r) => r.source === source)?.count_lifetime ?? 0;
  assert.equal(await count(FAY, 'esign_sent_completed'), 1, 'an envelope still out for signature counted');
  assert.equal(await count(FAY, 'esign_signed'), 1, 'an unsigned copy counted');
  assert.equal(await count(IVY, 'deal_worked'), 2, 'two deals are two deals');
  assert.equal(await count(PIA, 'office_hours_completed'), 2);
  assert.equal(await count(PIA, 'office_hours_rated_well'), 1, 'a 2★ session counted as rated well');
  assert.equal(await count(VIC, 'expert_session_completed'), 1, 'a session not yet held counted');
  assert.equal(await count(VIC, 'expert_rated_well'), 1, 'a 3★ rating counted as rated well');
  assert.equal(await count(VIC, 'guidance_answered'), 1, 'retired guidance counted');
});

/* 3 · the window --------------------------------------------------------- */

test('D318: an action inside 12 months counts 1, an older one fades with a 12-month half-life', async () => {
  assert.equal(ageWeight(Date.parse('2026-09-01T00:00:00Z'), NOW.getTime()), 1);
  assert.equal(ageWeight(NOW.getTime() - 365 * 86_400_000, NOW.getTime()), 1);
  assert.equal(ageWeight(NOW.getTime() - 730 * 86_400_000, NOW.getTime()), 0.5);
  assert.equal(ageWeight(NOW.getTime() - 1095 * 86_400_000, NOW.getTime()), 0.25);
  assert.equal(ageWeight(NOW.getTime() + 86_400_000, NOW.getTime()), 1, 'a future date is not a bonus');
  assert.equal(parseAt('2026-08-15 10:00:00'), Date.parse('2026-08-15T10:00:00Z'));
  assert.equal(parseAt(null), null);
  assert.equal(parseAt('not a date'), null);

  const db = seeded();
  db.prepare(`INSERT INTO pitch_decks (project_id, version, slides, title, is_current, created_by, created_at) VALUES (10, 2, '[]', 'Deck', 0, ?, ?)`).run(FAY, OLD);
  const deck = (await collectEvidence(env(db), FAY, NOW)).rows.find((r) => r.source === 'deck_version' && r.axis === 'marketing_brand')!;
  assert.equal(deck.count_lifetime, 2);
  assert.equal(deck.count_window, 1);
  assert.equal(deck.weighted, 1.5);
  assert.equal(deck.first_at, '2024-09-28T12:00:00.000Z');
  assert.equal(provenanceLine(deck), '2 pitch-deck versions saved, last in August 2026 (1 in the last 12 months)');
  // The investor's two moves on one deal are one deal, dated by the latest.
  const deal = (await collectEvidence(env(db), IVY, NOW)).rows.find((r) => r.source === 'deal_worked')!;
  assert.equal(deal.count_lifetime, 1);
  assert.equal(deal.weighted, 1);
});

/* 4 · none is none, and the blend corroborates --------------------------- */

test('D318: an axis with no evidence says so — null and "none", never 0', async () => {
  const db = seeded();
  const r = await evidenceReport(env(db), NIL, NOW);
  assert.equal(r.axes.length, 8);
  for (const a of r.axes) {
    assert.equal(a.evidence, null, `${a.axis} drew absent evidence as a number`);
    assert.equal(a.blended, null);
    assert.equal(a.basis, 'none');
    assert.deepEqual(a.provenance, []);
  }
  assert.equal(evidenceScore([]), null);
});

test('D318: the corroborate blend — evidence confirms a self-rating, never raises or creates one', () => {
  assert.deepEqual(blend(null, null), { blended: null, basis: 'none' });
  assert.deepEqual(blend(3, null), { blended: 3, basis: 'self_rated_only' });
  assert.deepEqual(blend(null, 4.2), { blended: null, basis: 'evidence_only' });
  assert.deepEqual(blend(3, 4.2), { blended: 3, basis: 'corroborated' });
  assert.deepEqual(blend(3, 3), { blended: 3, basis: 'corroborated' });
  assert.deepEqual(blend(4, 1), { blended: 2.5, basis: 'partly_corroborated' });
  const one = [{ axis: 'product', source: 'deck_version', count_lifetime: 3, count_window: 3, weighted: 3, first_at: '', last_at: '' }] as any;
  assert.equal(evidenceScore(one), 3.16, '3 weighted actions reach ~63% of the scale');
  const half = [{ ...one[0], source: 'lab_milestone' }];
  assert.equal(evidenceScore(half), 1.97, 'a half-weight source counts half');
});

test('D318: the report joins the self-rating per axis and blends it', async () => {
  const db = seeded();
  db.exec(`INSERT INTO skills (id, slug, category_slug, label, is_active) VALUES
    (1, 'legal-basics', 'legal_compliance', 'Legal basics', 1), (2, 'ux', 'design', 'UX', 1), (3, 'contracts', 'legal_compliance', 'Contracts', 1)`);
  db.prepare('INSERT INTO user_skills (user_id, skill_id, self_level) VALUES (?, 1, 2), (?, 3, 4), (?, 2, 3)').run(FAY, FAY, FAY);
  db.prepare('INSERT INTO user_skills (user_id, skill_id, self_level) VALUES (?, 1, 5)').run(FRED);
  const r = await evidenceReport(env(db), FAY, NOW);
  const legal = r.axes.find((a) => a.axis === 'legal_compliance')!;
  assert.equal(legal.self_level, 4, 'the highest of Fay’s legal skills, never Fred’s 5');
  assert.ok(legal.evidence! > 0);
  assert.ok(['corroborated', 'partly_corroborated'].includes(legal.basis));
  assert.ok(legal.provenance.some((l) => /^1 document signed, last in August 2026$/.test(l)));
  const eng = r.axes.find((a) => a.axis === 'engineering')!;
  assert.equal(eng.basis, 'evidence_only', 'a shipped OKR is evidence, but Fay never rated engineering');
  assert.equal(eng.blended, null);
  const gtm = r.axes.find((a) => a.axis === 'gtm_sales')!;
  assert.equal(gtm.self_level, null);
});

/* 5 · the route ---------------------------------------------------------- */

async function call(db: any, as: number | null, path: string) {
  const app = new Hono<any>();
  app.route('/api/skills', skillsRoutes);
  app.onError((err: any, c) => {
    const s = AUTH_ERROR_STATUSES[String(err?.message || '')];
    if (s) return c.json({ detail: err.message }, s);
    throw err;
  });
  const headers: Record<string, string> = {};
  if (as != null) {
    headers.Authorization = `Bearer ${await new SignJWT({ user_id: as, role: ROLE[as] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET))}`;
  }
  const res = await app.request(path, { headers }, env(db));
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

test('D318: GET /api/skills/me/evidence returns the caller’s own evidence, and needs a session', async () => {
  const db = seeded();
  const anon = await call(db, null, '/api/skills/me/evidence');
  assert.equal(anon.status, 401);
  const fay = await call(db, FAY, '/api/skills/me/evidence');
  assert.equal(fay.status, 200);
  assert.equal(fay.body.user_id, FAY);
  assert.equal(fay.body.window_days, 365);
  const brand = fay.body.axes.find((a: any) => a.axis === 'marketing_brand');
  assert.ok(brand.provenance.includes('1 pitch-deck version saved, last in August 2026'));
  assert.equal(brand.lifetime_actions, 2, 'one deck and one brand site — not Fred’s');
  // A query string cannot point it at someone else.
  const sneaky = await call(db, FAY, `/api/skills/me/evidence?user_id=${FRED}`);
  assert.equal(sneaky.body.user_id, FAY);
  const partner = await call(db, PIA, '/api/skills/me/evidence');
  assert.equal(partner.body.axes.find((a: any) => a.axis === 'marketing_brand').evidence, null,
    'Pia’s axes are her own specialization, not Fay’s deck');
});

/* 6 · the batch ---------------------------------------------------------- */

test('D318: the batch is bounded and resumable, stores what the report reads, and a second pass changes nothing', async () => {
  const db = seeded();
  const e = env(db);
  const first = await recomputeEvidenceBatch(e, { limit: 4, now: NOW });
  assert.deepEqual([first.processed, first.next_cursor, first.pass_complete], [4, 4, false]);
  const second = await recomputeEvidenceBatch(e, { limit: 4, now: NOW });
  assert.deepEqual([second.processed, second.next_cursor, second.pass_complete], [4, 8, false]);
  const third = await recomputeEvidenceBatch(e, { limit: 4, now: NOW });
  assert.deepEqual([third.processed, third.next_cursor, third.pass_complete], [1, 0, true]);
  assert.ok(first.changed + second.changed > 0);

  for (const who of [FAY, IVY, PIA, VIC]) {
    const stored = db.prepare('SELECT axis, source, count_lifetime, count_window, weighted, first_at, last_at FROM skill_evidence WHERE user_id = ? ORDER BY axis, source').all(who);
    const fresh = (await collectEvidence(e, who, NOW)).rows;
    assert.deepEqual(stored.map((r: any) => ({ ...r })), fresh, `stored evidence for ${who} differs from a fresh read`);
  }
  const before = db.prepare('SELECT * FROM skill_evidence ORDER BY user_id, axis, source').all();
  let again = 0;
  for (let i = 0; i < 3; i++) again += (await recomputeEvidenceBatch(e, { limit: 4, now: NOW })).changed;
  assert.equal(again, 0, 'a second pass at the same moment rewrote rows');
  assert.deepEqual(db.prepare('SELECT * FROM skill_evidence ORDER BY user_id, axis, source').all(), before, 'computed_at moved on an unchanged row');

  // Evidence that goes away is removed; evidence that ages is rewritten.
  db.prepare('DELETE FROM financial_models WHERE updated_by = ?').run(FAY);
  assert.equal(await recomputeUserEvidence(e, FAY, NOW), 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM skill_evidence WHERE user_id = ? AND source = 'financial_model'`).get(FAY).n, 0);
  const later = new Date('2028-02-01T00:00:00Z');
  assert.ok(await recomputeUserEvidence(e, FAY, later) > 0, 'ageing past the window did not rewrite the rows');
  const aged = db.prepare(`SELECT count_window, weighted FROM skill_evidence WHERE user_id = ? AND source = 'deck_version' AND axis = 'marketing_brand'`).get(FAY);
  assert.equal(aged.count_window, 0);
  assert.ok(aged.weighted < 1 && aged.weighted > 0.5);
  // Nobody else's rows moved.
  assert.deepEqual(db.prepare('SELECT * FROM skill_evidence WHERE user_id <> ? ORDER BY user_id, axis, source').all(FAY),
    before.filter((r: any) => r.user_id !== FAY));
  // The limit is clamped.
  db.prepare('UPDATE skill_evidence_cursor SET last_user_id = 0').run();
  assert.equal((await recomputeEvidenceBatch(e, { limit: 0, now: NOW })).processed, 1);
});

/* 7 · the map, in code and in the spec ----------------------------------- */

test('D318: PROFILING_V2.md’s tool map names every source in code, and the code reads no content column', () => {
  const doc = read('documentation/architecture/PROFILING_V2.md');
  for (const s of EVIDENCE_SOURCES) assert.ok(doc.includes(`\`${s.key}\``), `PROFILING_V2.md does not list ${s.key}`);
  for (const s of EVIDENCE_SOURCES) {
    assert.match(s.sql, /\?1/, `${s.key} is not bound to the user`);
    const selected = s.sql.slice(s.sql.indexOf('SELECT') + 6, s.sql.indexOf(' FROM '));
    assert.doesNotMatch(selected, /\b(?:\w+\.)?(?:title|notes?|body|content|comment|answer|objective|slides|name|review)\b/i, `${s.key} selects content`);
  }
  const src = read('cloudflare-worker/src/services/skillEvidence.ts');
  assert.doesNotMatch(src, /DB\.prepare\(`[^`]*\$\{/, 'SQL is built by interpolation');
});
