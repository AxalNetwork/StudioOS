/**
 * Network Introductions — service layer.
 *
 * The relationship-native "Introductions" feature under Network, for EVERY
 * user type (founders, investors, LPs, partners, advisors, service providers,
 * …). The platform proposes curated warm intros; the receiving user accepts
 * (spending one introduction credit) or declines (free).
 *
 * Distinct from the investor-only quarterly request quota that also lives on
 * /api/introductions (Task #6 W-1) — that pipe stays untouched.
 *
 * Owns:
 *   - the self-healing mirror of sql/migrations/150_introductions_network.sql
 *   - credit-state math (monthly allowance / purchased / referral buckets)
 *   - the INTRO_PACKS purchase catalog (10 / 100 / 1000)
 *   - purchase fulfilment from the Stripe webhook (idempotent on the PI id)
 *   - pair scoring (values / skills / archetypes / jurisdiction /
 *     specialization / relationship proximity) + proposition generation
 *
 * Matching reuses the canonical primitives: user vectors from
 * services/matchingVectors.ts, consent from services/matchingConsent.ts,
 * archetypes from profile_archetypes / assessment_results, personas from
 * ../personas.ts. No new scoring stores — breakdowns are stamped onto the
 * proposition row at generation time so "why this intro" stays auditable.
 */
import type { Env } from '../types';
import {
  confidenceAdjustedAlignment,
  skillComplementarity,
  loadUserVectors,
  loadUserVectorsBatch,
  type UserVectors,
  type ValueEntry,
} from './matchingVectors';
import { filterOptedInUserIds } from './matchingConsent';
import { PERSONAS } from '../personas';

// ---------------------------------------------------------------------------
// Schema (mirrors migration 150 so dev/preview D1s self-heal).
// ---------------------------------------------------------------------------
// Keyed by DB binding (not a bare boolean) so unit tests — which build a
// fresh in-memory DB per case inside one module instance — each get the
// schema. In the worker there is one DB per isolate, so this is equivalent.
const migratedDbs = new WeakSet<object>();
export async function ensureIntroNetworkSchema(env: Env): Promise<void> {
  if (migratedDbs.has(env.DB as unknown as object)) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS intro_propositions (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL,
       user_id INTEGER NOT NULL,
       target_user_id INTEGER NOT NULL,
       status TEXT NOT NULL DEFAULT 'pending'
         CHECK (status IN ('pending','accepted','declined','expired')),
       score REAL NOT NULL DEFAULT 0,
       breakdown_json TEXT,
       source TEXT NOT NULL DEFAULT 'matching',
       expires_at TEXT,
       responded_at TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_intro_props_pair
       ON intro_propositions(user_id, target_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_intro_props_user_status
       ON intro_propositions(user_id, status, created_at)`,
    `CREATE TABLE IF NOT EXISTS intro_credit_ledger (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id INTEGER NOT NULL,
       delta INTEGER NOT NULL,
       bucket TEXT NOT NULL CHECK (bucket IN ('allowance','purchased','referral')),
       kind TEXT NOT NULL CHECK (kind IN
         ('monthly_grant','purchase','referral_reward','spend','admin_adjust')),
       source_ref TEXT NOT NULL,
       note TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_intro_ledger_idem
       ON intro_credit_ledger(user_id, kind, source_ref)`,
    `CREATE INDEX IF NOT EXISTS idx_intro_ledger_user
       ON intro_credit_ledger(user_id, created_at)`,
  ];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch { /* idempotent */ } }
  migratedDbs.add(env.DB as unknown as object);
}

// ---------------------------------------------------------------------------
// Purchase packs (Products page). Platform-owned SKUs, no Stripe catalog
// dependency: POST /api/payments/intro-credits/intent mints a PaymentIntent
// with metadata.kind='intro_credits' and the webhook fulfils via
// grantPurchasedIntroCredits().
// ---------------------------------------------------------------------------
export interface IntroPack { credits: number; amount_cents: number; currency: string; label: string; blurb: string }
export const INTRO_PACKS: Record<string, IntroPack> = {
  intro_10: {
    credits: 10, amount_cents: 4_900, currency: 'usd', label: '10 introductions',
    blurb: 'A focused batch of warm intros for the current push.',
  },
  intro_100: {
    credits: 100, amount_cents: 39_900, currency: 'usd', label: '100 introductions',
    blurb: 'A quarter of serious relationship building.',
  },
  intro_1000: {
    credits: 1_000, amount_cents: 2_990_00, currency: 'usd', label: '1,000 introductions',
    blurb: 'Firm-scale allocation for teams and funds.',
  },
};
export function isIntroPackKey(v: unknown): v is keyof typeof INTRO_PACKS {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(INTRO_PACKS, v);
}

// ---------------------------------------------------------------------------
// Monthly allowance per plan. Free and paid users both get one; paid plans
// (founder subscription_tier OR investor investor_tier) raise the cap.
// ---------------------------------------------------------------------------
interface AllowanceUser {
  role?: string | null;
  subscription_tier?: string | null;
  investor_tier?: string | null;
  investor_subscription_status?: string | null;
}
export function monthlyAllowanceFor(user: AllowanceUser): number {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin') return 25;
  if (role === 'investor') {
    const status = String(user?.investor_subscription_status || 'free').toLowerCase();
    const lapsed = status === 'past_due' || status === 'unpaid' || status === 'cancelled';
    const tier = lapsed ? 'free' : String(user?.investor_tier || 'free').toLowerCase();
    if (tier === 'institutional') return 25;
    if (tier === 'professional') return 10;
    return 3;
  }
  const tier = String(user?.subscription_tier || 'free').toLowerCase();
  if (tier === 'studio') return 25;
  if (tier === 'growth') return 10;
  return 3;
}

/** UTC month key, e.g. '2026-07'. The allowance bucket does not roll over. */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Credit state. Grants are lazy + idempotent (UNIQUE(user_id, kind,
// source_ref)); balance math is derived from the ledger, never a counter.
// ---------------------------------------------------------------------------
export interface IntroCreditState {
  month: string;
  monthly_allowance: number;
  allowance_remaining: number;
  used_this_month: number;
  purchased_total: number;
  purchased_remaining: number;
  referral_total: number;
  referral_remaining: number;
  balance: number;
}

interface LedgerSums {
  allowanceMonth: number;   // net allowance rows in the current month
  purchased: number;        // net purchased bucket (all time)
  referral: number;         // net referral bucket (all time)
  purchasedGranted: number; // gross purchase grants
  referralGranted: number;  // gross referral grants
  spentThisMonth: number;   // spend count in the current month (all buckets)
}

/** Pure balance math over the ledger sums — exported for tests. */
export function deriveCreditState(
  allowanceCap: number,
  month: string,
  sums: LedgerSums,
): IntroCreditState {
  const allowanceRemaining = Math.max(0, sums.allowanceMonth);
  const purchasedRemaining = Math.max(0, sums.purchased);
  const referralRemaining = Math.max(0, sums.referral);
  return {
    month,
    monthly_allowance: allowanceCap,
    allowance_remaining: allowanceRemaining,
    used_this_month: sums.spentThisMonth,
    purchased_total: sums.purchasedGranted,
    purchased_remaining: purchasedRemaining,
    referral_total: sums.referralGranted,
    referral_remaining: referralRemaining,
    balance: allowanceRemaining + purchasedRemaining + referralRemaining,
  };
}

/** Spend priority: monthly allowance first, then referral-earned, then purchased. */
export function pickSpendBucket(state: IntroCreditState): 'allowance' | 'referral' | 'purchased' {
  if (state.allowance_remaining > 0) return 'allowance';
  if (state.referral_remaining > 0) return 'referral';
  return 'purchased';
}

export async function getIntroCreditState(
  env: Env,
  user: { id: number } & AllowanceUser,
): Promise<IntroCreditState> {
  await ensureIntroNetworkSchema(env);
  const month = currentMonthKey();
  const cap = monthlyAllowanceFor(user);

  // Lazy monthly grant — INSERT OR IGNORE keyed 'month:YYYY-MM' means the
  // first read of a new month plants exactly one grant row (the reset).
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO intro_credit_ledger
         (user_id, delta, bucket, kind, source_ref, note)
       VALUES (?, ?, 'allowance', 'monthly_grant', ?, ?)`,
    ).bind(user.id, cap, `month:${month}`, `Monthly allowance (${cap})`).run();
  } catch { /* ledger may be cold on the very first call — ensured above */ }

  // Lazy referral sync — one credit per valid referred signup (verified email
  // or converted). Idempotent per referral row; re-running never double-counts.
  try {
    const refs = await env.DB.prepare(
      `SELECT r.id FROM referrals r
         JOIN users u ON u.id = r.referred_id
        WHERE r.referrer_id = ?
          AND (r.status = 'converted' OR COALESCE(u.email_verified, 0) = 1)
        LIMIT 500`,
    ).bind(user.id).all<{ id: number }>();
    for (const r of refs.results || []) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO intro_credit_ledger
           (user_id, delta, bucket, kind, source_ref, note)
         VALUES (?, 1, 'referral', 'referral_reward', ?, 'Referred user joined')`,
      ).bind(user.id, `referral:${r.id}`).run();
    }
  } catch { /* referrals table may not exist on a cold dev DB */ }

  const row = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN bucket = 'allowance'
                          AND strftime('%Y-%m', created_at) = ?1
                         THEN delta ELSE 0 END), 0) AS allowance_month,
       COALESCE(SUM(CASE WHEN bucket = 'purchased' THEN delta ELSE 0 END), 0) AS purchased,
       COALESCE(SUM(CASE WHEN bucket = 'referral' THEN delta ELSE 0 END), 0) AS referral,
       COALESCE(SUM(CASE WHEN kind = 'purchase' THEN delta ELSE 0 END), 0) AS purchased_granted,
       COALESCE(SUM(CASE WHEN kind = 'referral_reward' THEN delta ELSE 0 END), 0) AS referral_granted,
       COALESCE(SUM(CASE WHEN kind = 'spend'
                          AND strftime('%Y-%m', created_at) = ?1
                         THEN 1 ELSE 0 END), 0) AS spent_month
     FROM intro_credit_ledger WHERE user_id = ?2`,
  ).bind(month, user.id).first<{
    allowance_month: number; purchased: number; referral: number;
    purchased_granted: number; referral_granted: number; spent_month: number;
  }>();

  return deriveCreditState(cap, month, {
    allowanceMonth: Number(row?.allowance_month || 0),
    purchased: Number(row?.purchased || 0),
    referral: Number(row?.referral || 0),
    purchasedGranted: Number(row?.purchased_granted || 0),
    referralGranted: Number(row?.referral_granted || 0),
    spentThisMonth: Number(row?.spent_month || 0),
  });
}

/**
 * Webhook fulfilment for an intro-credit pack purchase. Idempotent on the
 * PaymentIntent id — a Stripe retry can never double-credit. Returns true
 * when THIS call created the grant (gates the once-only notification).
 */
export async function grantPurchasedIntroCredits(
  env: Env,
  args: { userId: number; credits: number; paymentIntentId: string; pack?: string },
): Promise<boolean> {
  if (!args.userId || !Number.isFinite(args.credits) || args.credits <= 0) return false;
  await ensureIntroNetworkSchema(env);
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO intro_credit_ledger
       (user_id, delta, bucket, kind, source_ref, note)
     VALUES (?, ?, 'purchased', 'purchase', ?, ?)`,
  ).bind(
    args.userId,
    Math.floor(args.credits),
    `pi:${args.paymentIntentId}`,
    `Purchased ${args.credits} introduction credits${args.pack ? ` (${args.pack})` : ''}`,
  ).run();
  const isNew = Number(r?.meta?.changes || 0) > 0;
  if (isNew) {
    try {
      const { notify } = await import('./notify');
      await notify(env, {
        userId: args.userId,
        type: 'intro_credits_purchased',
        category: 'billing',
        title: `${args.credits} introduction credits added`,
        body: 'Your purchase is confirmed — the credits are ready to use on new introductions.',
        link: '/network?tab=introductions',
        payload: { credits: args.credits, pack: args.pack || null },
        channels: ['in_app'],
      });
    } catch { /* best-effort */ }
  }
  return isNew;
}

// ---------------------------------------------------------------------------
// Pair scoring. Weighted composite over the five spec'd dimensions plus a
// relationship-proximity bonus. Pure function — exported for tests.
// ---------------------------------------------------------------------------
export interface IntroProfileFacts {
  userId: number;
  country: string | null;
  specializations: string[];
  archetypeSlug: string | null;
  archetypeLabel: string | null;
  personaId: string | null;
  personaLabel: string | null;
  role: string | null;
}

export interface IntroPairSide {
  vectors: UserVectors;
  facts: IntroProfileFacts;
}

export interface IntroScoreBreakdown {
  score: number; // 0..100
  components: {
    values: number;         // 0..30
    skills: number;         // 0..25
    archetype: number;      // 0..15
    jurisdiction: number;   // 0..15
    specialization: number; // 0..15
    proximity: number;      // 0..10 bonus
  };
  reasons: string[];
  shared_values: string[];
  complementary_skills: string[];
  archetypes: { viewer: string | null; candidate: string | null };
  jurisdiction: { viewer: string | null; candidate: string | null; match: boolean };
  specializations: string[]; // candidate tags (shared first)
  relationship_context: string | null;
}

const WEIGHTS = { values: 30, skills: 25, archetype: 15, jurisdiction: 15, specialization: 15 } as const;

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9+#]+/).filter((t) => t.length > 2);
}

/** Human label from a slug ('deep_tech' → 'Deep tech'). */
function prettySlug(slug: string): string {
  const s = slug.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Value dimensions where both sides lean the same way with real signal. */
export function sharedValueDimensions(
  a: Record<string, ValueEntry>,
  b: Record<string, ValueEntry>,
): string[] {
  const out: string[] = [];
  for (const [slug, av] of Object.entries(a)) {
    const bv = b[slug];
    if (!bv) continue;
    if (Math.abs(av.score) >= 1 && Math.abs(bv.score) >= 1 && Math.sign(av.score) === Math.sign(bv.score)) {
      out.push(slug);
    }
  }
  return out;
}

export function scoreIntroPair(
  viewer: IntroPairSide,
  candidate: IntroPairSide,
  proximity: { viewerFollows: boolean; followsViewer: boolean },
): IntroScoreBreakdown {
  const reasons: string[] = [];

  // Shared values — confidence-adjusted alignment, opposition floored at 0.
  const val = confidenceAdjustedAlignment(viewer.vectors.values, candidate.vectors.values);
  const sharedValues = sharedValueDimensions(viewer.vectors.values, candidate.vectors.values)
    .slice(0, 6);
  const valuesPts = Math.round(Math.max(0, val.score) * WEIGHTS.values);
  if (sharedValues.length >= 3) {
    reasons.push(`Strong values alignment — ${sharedValues.length} shared dimensions`);
  } else if (sharedValues.length > 0) {
    reasons.push(`Shared values: ${sharedValues.map(prettySlug).join(', ')}`);
  }

  // Complementary skills — they are strong where you are not.
  const comp = skillComplementarity(viewer.vectors.skills, candidate.vectors.skills);
  const skillsPts = Math.round((comp.score / 100) * WEIGHTS.skills);
  const complementarySkills = comp.reasons.slice(0, 4);
  if (complementarySkills.length > 0) {
    reasons.push(`Complementary skills: ${complementarySkills.join('; ')}`);
  }

  // Archetype compatibility — different archetypes complement (visionary ×
  // operator); matching archetypes still share a working style.
  let archetypePts = 0;
  const aSlug = viewer.facts.archetypeSlug;
  const bSlug = candidate.facts.archetypeSlug;
  if (aSlug && bSlug) {
    archetypePts = aSlug === bSlug ? Math.round(WEIGHTS.archetype * 0.55) : WEIGHTS.archetype;
    const aLabel = viewer.facts.archetypeLabel || prettySlug(aSlug);
    const bLabel = candidate.facts.archetypeLabel || prettySlug(bSlug);
    reasons.push(aSlug === bSlug
      ? `Matching archetype: ${bLabel}`
      : `Complementary archetypes: ${aLabel} × ${bLabel}`);
  }

  // Jurisdiction — same country wins the full weight.
  const aJur = (viewer.facts.country || '').trim();
  const bJur = (candidate.facts.country || '').trim();
  const jurMatch = !!aJur && !!bJur && aJur.toLowerCase() === bJur.toLowerCase();
  const jurisdictionPts = jurMatch ? WEIGHTS.jurisdiction : 0;
  if (jurMatch) reasons.push(`Same jurisdiction: ${bJur}`);

  // Specialization — token overlap across the two tag sets.
  const aTokens = new Set(viewer.facts.specializations.flatMap(tokenize));
  const sharedSpecs = candidate.facts.specializations.filter((s) =>
    tokenize(s).some((t) => aTokens.has(t)));
  const specializationPts = sharedSpecs.length >= 2
    ? WEIGHTS.specialization
    : sharedSpecs.length === 1
      ? Math.round(WEIGHTS.specialization * 0.66)
      : 0;
  if (sharedSpecs.length > 0) {
    reasons.push(`Specialization overlap: ${sharedSpecs.slice(0, 3).join(', ')}`);
  }

  // Relationship proximity — an existing follow in either direction.
  let proximityPts = 0;
  let relationshipContext: string | null = null;
  if (proximity.viewerFollows && proximity.followsViewer) {
    proximityPts = 10;
    relationshipContext = 'You already follow each other';
  } else if (proximity.followsViewer) {
    proximityPts = 6;
    relationshipContext = 'They follow you';
  } else if (proximity.viewerFollows) {
    proximityPts = 5;
    relationshipContext = 'You follow them';
  }
  if (relationshipContext) reasons.push(relationshipContext);

  const score = Math.min(
    100,
    valuesPts + skillsPts + archetypePts + jurisdictionPts + specializationPts + proximityPts,
  );

  return {
    score,
    components: {
      values: valuesPts,
      skills: skillsPts,
      archetype: archetypePts,
      jurisdiction: jurisdictionPts,
      specialization: specializationPts,
      proximity: proximityPts,
    },
    reasons,
    shared_values: sharedValues.map(prettySlug),
    complementary_skills: complementarySkills,
    archetypes: {
      viewer: viewer.facts.archetypeLabel || (aSlug ? prettySlug(aSlug) : null),
      candidate: candidate.facts.archetypeLabel || (bSlug ? prettySlug(bSlug) : null),
    },
    jurisdiction: { viewer: aJur || null, candidate: bJur || null, match: jurMatch },
    specializations: [
      ...sharedSpecs,
      ...candidate.facts.specializations.filter((s) => !sharedSpecs.includes(s)),
    ].slice(0, 6),
    relationship_context: relationshipContext,
  };
}

// ---------------------------------------------------------------------------
// Profile facts (jurisdiction / specialization / archetype / persona) for a
// batch of users. Three queries + per-role side-table reads; every lookup is
// defensive because dev DBs may lack any given table.
// ---------------------------------------------------------------------------
const PERSONA_LABEL: Record<string, string> = Object.fromEntries(
  PERSONAS.map((p) => [p.id, p.label]),
);

export async function loadIntroProfileFacts(
  env: Env,
  userIds: number[],
): Promise<Map<number, IntroProfileFacts>> {
  const out = new Map<number, IntroProfileFacts>();
  const ids = [...new Set(userIds.filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0) return out;
  const ph = ids.map(() => '?').join(',');

  interface URow {
    id: number; role: string | null; country: string | null;
    nationality: string | null; tax_residency_country: string | null;
    founder_id: number | null; partner_id: number | null; investor_id: number | null;
  }
  let users: URow[] = [];
  try {
    const r = await env.DB.prepare(
      `SELECT id, role, country, nationality, tax_residency_country,
              founder_id, partner_id, investor_id
         FROM users WHERE id IN (${ph})`,
    ).bind(...ids).all<URow>();
    users = r.results || [];
  } catch { return out; }

  for (const u of users) {
    out.set(Number(u.id), {
      userId: Number(u.id),
      country: u.country || u.tax_residency_country || u.nationality || null,
      specializations: [],
      archetypeSlug: null,
      archetypeLabel: null,
      personaId: null,
      personaLabel: null,
      role: u.role || null,
    });
  }

  // Specializations from the role side-tables.
  const bySide = (col: 'founder_id' | 'partner_id' | 'investor_id') =>
    users.filter((u) => u[col]).map((u) => ({ userId: Number(u.id), sideId: Number(u[col]) }));

  const founderSides = bySide('founder_id');
  if (founderSides.length) {
    try {
      const fph = founderSides.map(() => '?').join(',');
      const r = await env.DB.prepare(
        `SELECT id, domain_expertise FROM founders WHERE id IN (${fph})`,
      ).bind(...founderSides.map((s) => s.sideId)).all<{ id: number; domain_expertise: string | null }>();
      const m = new Map((r.results || []).map((x) => [Number(x.id), x.domain_expertise]));
      for (const s of founderSides) {
        const v = m.get(s.sideId);
        if (v) out.get(s.userId)!.specializations.push(...v.split(/[,;/]+/).map((x) => x.trim()).filter(Boolean));
      }
    } catch { /* optional */ }
  }
  const partnerSides = bySide('partner_id');
  if (partnerSides.length) {
    try {
      const pph = partnerSides.map(() => '?').join(',');
      const r = await env.DB.prepare(
        `SELECT id, specialization FROM partners WHERE id IN (${pph})`,
      ).bind(...partnerSides.map((s) => s.sideId)).all<{ id: number; specialization: string | null }>();
      const m = new Map((r.results || []).map((x) => [Number(x.id), x.specialization]));
      for (const s of partnerSides) {
        const v = m.get(s.sideId);
        if (v) out.get(s.userId)!.specializations.push(...v.split(/[,;/]+/).map((x) => x.trim()).filter(Boolean));
      }
    } catch { /* optional */ }
  }
  const investorSides = bySide('investor_id');
  if (investorSides.length) {
    try {
      const iph = investorSides.map(() => '?').join(',');
      const r = await env.DB.prepare(
        `SELECT id, sector_focus FROM investors WHERE id IN (${iph})`,
      ).bind(...investorSides.map((s) => s.sideId)).all<{ id: number; sector_focus: string | null }>();
      const m = new Map((r.results || []).map((x) => [Number(x.id), x.sector_focus]));
      for (const s of investorSides) {
        const v = m.get(s.sideId);
        if (v) out.get(s.userId)!.specializations.push(...v.split(/[,;/]+/).map((x) => x.trim()).filter(Boolean));
      }
    } catch { /* optional */ }
  }

  // Latest archetype per user — conversational store first, then the gamified
  // assessment fallback (same precedence as the Profile & Fit page).
  try {
    const r = await env.DB.prepare(
      `SELECT user_id, archetype_slug, archetype_label
         FROM profile_archetypes WHERE user_id IN (${ph})
        ORDER BY computed_at ASC`,
    ).bind(...ids).all<{ user_id: number; archetype_slug: string; archetype_label: string | null }>();
    for (const row of r.results || []) {
      const f = out.get(Number(row.user_id));
      if (f) { f.archetypeSlug = row.archetype_slug; f.archetypeLabel = row.archetype_label; }
    }
  } catch { /* optional */ }
  const missingArch = ids.filter((id) => !out.get(id)?.archetypeSlug);
  if (missingArch.length) {
    try {
      const mph = missingArch.map(() => '?').join(',');
      const r = await env.DB.prepare(
        `SELECT user_id, archetype_slug, archetype_label
           FROM assessment_results
          WHERE user_id IN (${mph}) AND archetype_slug IS NOT NULL
          ORDER BY updated_at ASC`,
      ).bind(...missingArch).all<{ user_id: number; archetype_slug: string; archetype_label: string | null }>();
      for (const row of r.results || []) {
        const f = out.get(Number(row.user_id));
        if (f) { f.archetypeSlug = row.archetype_slug; f.archetypeLabel = row.archetype_label; }
      }
    } catch { /* optional */ }
  }

  // Primary persona → entity-type label (LP / family office / corporate VC …).
  try {
    const r = await env.DB.prepare(
      `SELECT user_id, persona_id FROM user_personas
        WHERE user_id IN (${ph}) AND is_primary = 1`,
    ).bind(...ids).all<{ user_id: number; persona_id: string }>();
    for (const row of r.results || []) {
      const f = out.get(Number(row.user_id));
      if (f) { f.personaId = row.persona_id; f.personaLabel = PERSONA_LABEL[row.persona_id] || null; }
    }
  } catch { /* optional */ }

  return out;
}

// ---------------------------------------------------------------------------
// Proposition generation. Lazy (invoked from the list read): score the
// consent-gated pool, keep the best candidates the user hasn't seen yet,
// write the rows + reciprocal mirrors, and notify the counterpart.
// ---------------------------------------------------------------------------
const PROPOSITION_TTL_DAYS = 14;
const MIN_PROPOSITION_SCORE = 20;

export async function generateIntroPropositions(
  env: Env,
  user: { id: number } & AllowanceUser,
  opts: { max?: number } = {},
): Promise<number> {
  const max = Math.max(1, Math.min(opts.max ?? 5, 10));
  await ensureIntroNetworkSchema(env);

  // Candidate pool: every active, non-admin user except the viewer…
  interface CandRow { id: number }
  let cands: CandRow[] = [];
  try {
    const r = await env.DB.prepare(
      `SELECT id FROM users
        WHERE COALESCE(is_active, 1) = 1
          AND id != ?
          AND role NOT IN ('admin', 'exploring')
        LIMIT 500`,
    ).bind(user.id).all<CandRow>();
    cands = r.results || [];
  } catch { return 0; }

  // …who has opted in to matching (hard privacy filter, fails closed)…
  const optedIn = await filterOptedInUserIds(env, cands.map((c) => c.id));
  let pool = cands.map((c) => Number(c.id)).filter((id) => optedIn.has(id));
  if (pool.length === 0) return 0;

  // …and has never been proposed to this user before (either direction —
  // a pair that already met through the mirror must not resurface).
  try {
    const eph = pool.map(() => '?').join(',');
    const seen = await env.DB.prepare(
      `SELECT target_user_id AS other FROM intro_propositions
        WHERE user_id = ? AND target_user_id IN (${eph})
       UNION
       SELECT user_id AS other FROM intro_propositions
        WHERE target_user_id = ? AND user_id IN (${eph})`,
    ).bind(user.id, ...pool, user.id, ...pool).all<{ other: number }>();
    const seenSet = new Set((seen.results || []).map((r) => Number(r.other)));
    pool = pool.filter((id) => !seenSet.has(id));
  } catch { /* table cold → nothing seen */ }
  if (pool.length === 0) return 0;

  const [viewerVectors, vecMap, factsMap] = await Promise.all([
    loadUserVectors(env, user.id),
    loadUserVectorsBatch(env, pool),
    loadIntroProfileFacts(env, [user.id, ...pool]),
  ]);
  const viewerFacts = factsMap.get(user.id) || {
    userId: user.id, country: null, specializations: [], archetypeSlug: null,
    archetypeLabel: null, personaId: null, personaLabel: null, role: null,
  };

  // Follow edges for the proximity bonus (both directions in two queries).
  const followsOut = new Set<number>();
  const followsIn = new Set<number>();
  try {
    const eph = pool.map(() => '?').join(',');
    const [o, i] = await Promise.all([
      env.DB.prepare(
        `SELECT entity_id FROM follows
          WHERE follower_user_id = ? AND entity_type = 'user' AND entity_id IN (${eph})`,
      ).bind(user.id, ...pool).all<{ entity_id: number }>(),
      env.DB.prepare(
        `SELECT follower_user_id FROM follows
          WHERE entity_type = 'user' AND entity_id = ? AND follower_user_id IN (${eph})`,
      ).bind(user.id, ...pool).all<{ follower_user_id: number }>(),
    ]);
    for (const r of o.results || []) followsOut.add(Number(r.entity_id));
    for (const r of i.results || []) followsIn.add(Number(r.follower_user_id));
  } catch { /* optional */ }

  const viewerSide: IntroPairSide = { vectors: viewerVectors, facts: viewerFacts };
  const scored: Array<{ candidateId: number; breakdown: IntroScoreBreakdown }> = [];
  for (const candId of pool) {
    const cv = vecMap.get(candId) || { values: {}, skills: {} };
    const cf = factsMap.get(candId);
    if (!cf) continue;
    // Skip candidates with zero signal on every dimension — a 0-score card
    // is noise, not curation.
    const hasSignal = Object.keys(cv.values).length > 0
      || Object.keys(cv.skills).length > 0
      || cf.specializations.length > 0
      || !!cf.archetypeSlug
      || !!cf.country;
    if (!hasSignal) continue;
    const breakdown = scoreIntroPair(viewerSide, { vectors: cv, facts: cf }, {
      viewerFollows: followsOut.has(candId),
      followsViewer: followsIn.has(candId),
    });
    if (breakdown.score < MIN_PROPOSITION_SCORE) continue;
    scored.push({ candidateId: candId, breakdown });
  }
  scored.sort((a, b) => b.breakdown.score - a.breakdown.score);

  const picks = scored.slice(0, max);
  let created = 0;
  const expires = new Date(Date.now() + PROPOSITION_TTL_DAYS * 86_400_000)
    .toISOString().replace('T', ' ').slice(0, 19);

  for (const pick of picks) {
    const uid = crypto.randomUUID();
    try {
      const ins = await env.DB.prepare(
        `INSERT OR IGNORE INTO intro_propositions
           (uid, user_id, target_user_id, status, score, breakdown_json, source, expires_at)
         VALUES (?, ?, ?, 'pending', ?, ?, 'matching', ?)`,
      ).bind(uid, user.id, pick.candidateId, pick.breakdown.score,
        JSON.stringify(pick.breakdown), expires).run();
      if (!Number(ins?.meta?.changes || 0)) continue;
      created += 1;
    } catch { continue; }

    // Reciprocal mirror — the counterpart receives the same curated intro
    // (scored from THEIR side) and a notification that deep-links here.
    try {
      const cv = vecMap.get(pick.candidateId) || { values: {}, skills: {} };
      const cf = factsMap.get(pick.candidateId)!;
      const mirror = scoreIntroPair({ vectors: cv, facts: cf }, viewerSide, {
        viewerFollows: followsIn.has(pick.candidateId),
        followsViewer: followsOut.has(pick.candidateId),
      });
      const mirrorUid = crypto.randomUUID();
      const mIns = await env.DB.prepare(
        `INSERT OR IGNORE INTO intro_propositions
           (uid, user_id, target_user_id, status, score, breakdown_json, source, expires_at)
         VALUES (?, ?, ?, 'pending', ?, ?, 'reciprocal', ?)`,
      ).bind(mirrorUid, pick.candidateId, user.id, mirror.score,
        JSON.stringify(mirror), expires).run();
      if (Number(mIns?.meta?.changes || 0)) {
        const viewerName = await env.DB.prepare(
          `SELECT COALESCE(display_name, name) AS n FROM users WHERE id = ?`,
        ).bind(user.id).first<{ n: string | null }>().then((r) => r?.n || 'A member')
          .catch(() => 'A member');
        const topReason = mirror.reasons[0] || 'A curated match based on your profile';
        const urgent = mirror.score >= 70;
        const { notify } = await import('./notify');
        await notify(env, {
          userId: pick.candidateId,
          type: 'intro_proposition_received',
          category: 'proactive_nudges',
          title: urgent
            ? `Strong introduction match: ${viewerName}`
            : `New introduction proposition: ${viewerName}`,
          body: `${topReason}. Review the match and accept or decline — accepting uses one introduction credit.`,
          link: `/network?tab=introductions&intro=${mirrorUid}`,
          payload: { proposition_uid: mirrorUid, score: mirror.score, urgent },
          channels: ['in_app'],
        });
      }
    } catch { /* mirror + notify are best-effort; the viewer row stands */ }
  }
  return created;
}
