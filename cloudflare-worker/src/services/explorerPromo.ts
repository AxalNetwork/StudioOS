/**
 * Explorer completion incentive — one-time 30-day license promo codes.
 *
 * Exploring users who complete their track's Problem/Challenge Discovery
 * bank (banks/explorer.ts) earn a ONE-TIME promo code redeemable on the
 * Products page for a free 30-day license matched to their track. The code
 * is surfaced in the Personal Advisor chat together with a recommendations
 * summary derived from their explorer_needs answers.
 *
 * Deliberately NOT wedged into the Stripe-mirrored `promo_codes` table:
 * those rows mirror real Stripe coupons (admin-created, product-scoped,
 * deleted via the Stripe API), while these are per-user synthetic grants
 * that never touch Stripe — redemption goes straight to a time-bounded
 * `feature_unlocks` row (services/featureUnlocks.ts), the same mechanism a
 * 100%-off à-la-carte purchase lands on. Mixing the two would break the
 * admin promo panel's Stripe-coupon lifecycle assumptions.
 *
 * Codes are bound to the issued user (redeeming someone else's code fails
 * with the same `not_found` as a bogus code, so codes don't leak account
 * existence), single-use (atomic claim on redeemed_at), and expire 90 days
 * after issuance.
 */
import type { Env } from '../types';
import { writeFeatureUnlock } from './featureUnlocks';

export interface ExplorerPromoRow {
  id: number;
  user_id: number;
  code: string;
  track: string;
  feature_key: string;
  license_label: string;
  unlock_days: number;
  issued_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
}

export interface ExplorerRedeemResult {
  ok: boolean;
  reason?: 'not_found' | 'already_redeemed' | 'expired';
  confirmation?: {
    code: string;
    license_label: string;
    feature_key: string;
    unlock_days: number;
    amount_cents: 0;
    currency: 'usd';
    redeemed_at: string;
    license_expires_at: string;
  };
}

// Track → license the code redeems into. `feature_key` is the
// feature_unlocks key gates can read (same namespace as à-la-carte
// metadata.feature_key); the label is what the chat + receipt show.
const TRACK_LICENSES: Record<string, { feature_key: string; label: string }> = {
  founder:  { feature_key: 'explorer_license_founder',  label: 'Founder toolkit — 30-day license' },
  investor: { feature_key: 'explorer_license_investor', label: 'Investor toolkit — 30-day license' },
  advisor:  { feature_key: 'explorer_license_advisor',  label: 'Advisor toolkit — 30-day license' },
  partner:  { feature_key: 'explorer_license_partner',  label: 'Partner toolkit — 30-day license' },
};

const UNLOCK_DAYS = 30;
const CODE_TTL_DAYS = 90;

let _schemaReady = false;

/** Idempotent bootstrap — mirrors migration 149_explorer_promo_codes.sql. */
export async function ensureExplorerPromoSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS explorer_promo_codes (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
        'user_id INTEGER NOT NULL UNIQUE REFERENCES users(id), ' +
        'code TEXT NOT NULL UNIQUE, ' +
        'track TEXT NOT NULL, ' +
        'feature_key TEXT NOT NULL, ' +
        'license_label TEXT NOT NULL, ' +
        `unlock_days INTEGER NOT NULL DEFAULT ${UNLOCK_DAYS}, ` +
        "issued_at TEXT NOT NULL DEFAULT (datetime('now')), " +
        'expires_at TEXT, ' +
        'redeemed_at TEXT' +
        ')',
    );
    _schemaReady = true;
  } catch (e) {
    console.warn('[explorerPromo] ensure schema failed:', (e as Error).message);
  }
}

// Unambiguous alphabet (no 0/O/1/I/L) so codes survive being read aloud
// or retyped from a screenshot.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes).map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `AXAL-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

function normalizeCode(raw: string): string {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The caller's issued promo (null when none issued yet). */
export async function getExplorerPromo(env: Env, userId: number): Promise<ExplorerPromoRow | null> {
  await ensureExplorerPromoSchema(env);
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM explorer_promo_codes WHERE user_id = ?`,
    ).bind(userId).first<ExplorerPromoRow>();
    return row || null;
  } catch {
    return null;
  }
}

/**
 * Issue (idempotently) the user's one-time promo code. Reads the track from
 * explorer_needs; returns the existing row when already issued so a re-answer
 * of the final question can never mint a second code.
 */
export async function issueExplorerPromo(env: Env, userId: number): Promise<ExplorerPromoRow | null> {
  await ensureExplorerPromoSchema(env);
  const existing = await getExplorerPromo(env, userId);
  if (existing) return existing;

  const needs = await env.DB.prepare(
    `SELECT track FROM explorer_needs WHERE user_id = ?`,
  ).bind(userId).first<{ track: string | null }>().catch(() => null);
  const track = String(needs?.track || '').toLowerCase();
  const license = TRACK_LICENSES[track];
  if (!license) return null;

  const expiresAt = new Date(Date.now() + CODE_TTL_DAYS * 86_400_000).toISOString();
  // Retry a couple of times on the (astronomically unlikely) code collision;
  // the user_id UNIQUE means a concurrent double-issue resolves to one row.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await env.DB.prepare(
        `INSERT INTO explorer_promo_codes
           (user_id, code, track, feature_key, license_label, unlock_days, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO NOTHING`,
      ).bind(userId, generateCode(), track, license.feature_key, license.label, UNLOCK_DAYS, expiresAt).run();
      break;
    } catch (e) {
      if (attempt === 2) {
        console.warn('[explorerPromo] issue failed:', (e as Error).message);
        return null;
      }
    }
  }
  return getExplorerPromo(env, userId);
}

/**
 * Redeem the caller's code → grant the 30-day feature unlock. Single-use via
 * an atomic claim on redeemed_at. A code belonging to another user returns
 * `not_found` (indistinguishable from a bogus code by design).
 */
export async function redeemExplorerPromo(env: Env, userId: number, rawCode: string): Promise<ExplorerRedeemResult> {
  await ensureExplorerPromoSchema(env);
  const norm = normalizeCode(rawCode);
  if (!norm) return { ok: false, reason: 'not_found' };

  // Codes are stored with dashes — compare on the stripped form.
  const row = await env.DB.prepare(
    `SELECT * FROM explorer_promo_codes
      WHERE REPLACE(code, '-', '') = ? AND user_id = ?`,
  ).bind(norm, userId).first<ExplorerPromoRow>().catch(() => null);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.redeemed_at) return { ok: false, reason: 'already_redeemed' };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  // Atomic single-use claim: only one concurrent request can flip
  // redeemed_at from NULL.
  const claim = await env.DB.prepare(
    `UPDATE explorer_promo_codes SET redeemed_at = datetime('now')
      WHERE id = ? AND redeemed_at IS NULL`,
  ).bind(row.id).run();
  const changed = Number((claim as { meta?: { changes?: number } }).meta?.changes ?? 0);
  if (changed === 0) return { ok: false, reason: 'already_redeemed' };

  // Grant the license. Synthetic payment-intent id keeps the
  // feature_unlocks UNIQUE(source_payment_intent_id) idempotence — the same
  // pattern promos.ts uses for free grants (`promo:{id}:{userId}`).
  await writeFeatureUnlock(env, {
    userId,
    featureKey: row.feature_key,
    paymentIntentId: `explorer_promo:${row.id}:${userId}`,
    unlockDays: row.unlock_days,
  });

  const redeemedAt = new Date().toISOString();
  const licenseExpiresAt = new Date(Date.now() + row.unlock_days * 86_400_000).toISOString();
  return {
    ok: true,
    confirmation: {
      code: row.code,
      license_label: row.license_label,
      feature_key: row.feature_key,
      unlock_days: row.unlock_days,
      amount_cents: 0,
      currency: 'usd',
      redeemed_at: redeemedAt,
      license_expires_at: licenseExpiresAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Recommendations summary — deterministic mapping from the user's
// explorer_needs answers to platform features. No LLM: the summary must be
// instant, cheap, and identical on refresh.
// ---------------------------------------------------------------------------

interface NeedsRow {
  track: string | null;
  current_status: string | null;
  challenge_1: string | null;
  challenge_2: string | null;
  challenge_3: string | null;
  timeline_urgency: string | null;
}

// Challenge label (as authored in banks/explorer.ts) → recommendation line.
// Keyed per track so "pipeline" means deal flow for investors but customer
// acquisition for founders.
const CHALLENGE_FEATURES: Record<string, Record<string, string>> = {
  founder: {
    'Product & customer discovery (PMF)': 'Customer Discovery — log interviews and validate pains before you build',
    'Fundraising & capital strategy': 'Pitch Deck Builder + Capital tools — investor-ready deck and raise tracking',
    'Hiring & team building': 'Best-Fit Matching — find operators and teammates aligned with your values',
    'Go-to-market & customer acquisition': 'Brand Builder + Landing Pages — ship a landing page and test messaging',
    'Operations & scaling': 'Roadmap & OKRs — quarterly objectives with progress tracking',
    'Cap table & equity management': 'Legal & Capital — cap table modelling and equity docs',
    'Co-founder/co-leader search': 'Best-Fit Matching — co-founder search scored on skills and values fit',
    'Technology & product decisions': 'AI Advisory Suite — on-demand product and technology guidance',
    'Partnership & distribution': 'Partner Network — distribution and channel partners in the studio',
    'Personal financial runway': 'Personal Advisor — runway planning and milestone sequencing',
    'Board/advisor guidance': 'Advisor Matching — advisors matched to your stage and sector',
    'Legal/compliance setup': 'Incorporate + Compliance Calendar — entity setup and filing deadlines',
  },
  investor: {
    'Deal sourcing & pipeline building': 'Deal Flow + Market Intelligence — sector heat and curated pipeline',
    'Due diligence process & tooling': 'Due Diligence rooms — structured DD checklists and findings',
    'Portfolio construction & thesis definition': 'Market Intelligence — sector signals to sharpen your thesis',
    'LP relations & fund formation': 'Legal & Capital — fund docs and investor relations tooling',
    'Co-investor / syndicate network': 'Investor Network — co-investors matched by thesis overlap',
    'Follow-on & reserves strategy': 'Portfolio tools — reserve allocation and exit waterfall modelling',
    'Sector/stage focus definition': 'Market Intelligence — sector heat maps and capital velocity',
    'Board seats & portfolio support': 'Portfolio Health — coverage and support tracking across your book',
    'Exit strategy & liquidity planning': 'Liquidity & Exits — exit waterfall and scenario planning',
    'Ticket size & check-writing process': 'Deal Flow — standardised deal review and check-writing workflow',
    'Legal / fund structure setup': 'Legal & Capital — entity and fund structure templates',
    'Reporting & investor relations tooling': 'Portfolio Analytics — LP-ready reporting snapshots',
  },
  advisor: {
    'Building a client/founder pipeline': 'Advisor Directory + Matching — founders routed to your expertise',
    'Defining area of expertise & positioning': 'Profile & Fit — a skills radar and archetype that founders see',
    'Pricing & engagement model (equity vs cash vs hourly)': 'Advisory agreements — engagement templates with standard terms',
    'Capacity planning (how many founders to advise)': 'Advisor workspace — track engagements and cadence in one place',
    'Conflict-of-interest management': 'Trust Center — disclosure and conflict tracking',
    'Building credibility & track record': 'Profile & Fit — verified track record surfaced to matching founders',
    'Structuring advisory agreements': 'Legal templates — advisory agreement e-sign flow',
    'Network & referral building': 'Network tools — referral tracking and introductions',
    'Balancing advisory work with other commitments': 'Calendar sync — availability windows founders can book against',
    'Tools for tracking advisory relationships': 'Advisor workspace — per-founder notes and milestone tracking',
    'Board/observer seat opportunities': 'Advisor Matching — board-seat openings matched to your profile',
    'Specialization vs generalist positioning': 'Profile & Fit — positioning informed by your skills radar',
  },
  partner: {
    'Defining services offered to founders': 'Partner Portal — a service catalog founders browse',
    'Structuring the partnership (referral, revenue share, retainer)': 'Partner Deals — referral and revenue-share terms in one place',
    'Building founder/deal pipeline': 'Deal Flow — studio startups routed to matching partners',
    'Scoping engagement models (project vs ongoing)': 'Partner Deals — engagement templates per project type',
    'Capacity & team allocation': 'Partner Portal — engagement pipeline visibility for planning',
    'Pricing & fee structure': 'Partner Deals — standardised pricing and fee terms',
    "Integration with Axal's tools/systems": 'Integrations — connect your stack to StudioOS',
    'Conflict-of-interest & exclusivity terms': 'Trust Center — exclusivity and conflict disclosures',
    'Track record & case studies': 'Partner Directory — case studies surfaced to founders',
    'Building internal champions/referral sources': 'Network tools — champion and referral tracking',
    'Legal/contract templates for engagements': 'Legal templates — engagement contracts with e-sign',
    'Reporting & value demonstration to the studio': 'Partner analytics — engagement outcomes reporting',
  },
};

const URGENCY_NOTE: Record<string, string> = {
  'Within 30 days': "You're on a 30-day clock, so start with the first recommendation today.",
  'Within 90 days': 'With a ~90-day window, you have room to work these in order.',
  'Within 180 days': 'Your 6-month runway gives time to build these out properly.',
};

/**
 * Build the completion summary shown in the advisor chat: 1 line per top
 * challenge (max 3) + an urgency note. Returns null when the needs row is
 * missing (nothing to summarise).
 */
export async function buildExplorerRecommendations(env: Env, userId: number): Promise<string | null> {
  const needs = await env.DB.prepare(
    `SELECT track, current_status, challenge_1, challenge_2, challenge_3, timeline_urgency
       FROM explorer_needs WHERE user_id = ?`,
  ).bind(userId).first<NeedsRow>().catch(() => null);
  if (!needs) return null;

  const track = String(needs.track || '').toLowerCase();
  const features = CHALLENGE_FEATURES[track] || {};
  const lines: string[] = [];
  for (const ch of [needs.challenge_1, needs.challenge_2, needs.challenge_3]) {
    if (!ch) continue;
    const rec = features[ch];
    if (rec) lines.push(`• ${rec}`);
  }
  if (lines.length === 0) {
    lines.push('• Personal Advisor — keep refining your profile and we\'ll surface matching tools');
  }
  const urgency = needs.timeline_urgency ? URGENCY_NOTE[needs.timeline_urgency] : null;
  return [
    'Based on your answers, here\'s where StudioOS can help you first:',
    ...lines,
    ...(urgency ? [urgency] : []),
  ].join('\n');
}
