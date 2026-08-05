/**
 * LP applications — validation + shaping for the Spin-Out Fund I
 * request-for-access flow behind /api/spinout-lab/lp-application.
 *
 * Pure module (no Hono / db / auth imports) so the test harness can drive it
 * directly, and so `routes/spinout_lab.ts` — whose smoke test slices exact
 * source strings out of the file — gains only a thin wire handler.
 *
 * WHAT AN APPLICATION IS, AND IS NOT
 * =================================
 * It is an expression of interest that the fund team reviews by hand. It is
 * NOT an entitlement: nothing downstream reads this table to decide what a
 * viewer may see. The LP workspace's access ladder is derived from
 * `limited_partners` rows (a countersigned LPA, a real commitment) via
 * lpAccessState(); a submitted application only moves a viewer from 'visitor'
 * to 'pending', and 'pending' unlocks nothing — no reporting archive, no data
 * room, no allocation. That is what makes it safe for the applicant to be the
 * author of their own row.
 *
 * `target_commitment` is a stated INTENTION in dollars (matching
 * `limited_partners.commitment_amount`, so the two are never compared across a
 * unit boundary). It is not capital, it is not counted in the raise totals, and
 * `/fund-metrics` never reads this table.
 */

/** Investor types the form offers. Anything else is rejected, not coerced. */
export const INVESTOR_TYPES = [
  'individual',
  'family_office',
  'fund_of_funds',
  'institution',
  'corporate',
  'other',
] as const;
export type InvestorType = (typeof INVESTOR_TYPES)[number];

/** Preference areas are INFORMATIONAL — they never restrict fund strategy. */
export const PREFERENCE_AREAS = [
  'ai_infrastructure',
  'vertical_saas',
  'fintech',
  'healthtech',
  'climate',
  'deeptech',
  'marketplaces',
  'security',
] as const;

/** Lifecycle. Only the GP moves an application off `pending`; the applicant
 *  may withdraw their own. */
export const APPLICATION_STATUSES = ['pending', 'approved', 'declined', 'withdrawn'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Ticket bounds in DOLLARS, mirroring the workspace's own slider. */
export const MIN_TICKET = 50_000;
export const MAX_TICKET = 2_000_000;
const MAX_NOTE = 2_000;
const MAX_PREFERENCES = PREFERENCE_AREAS.length;

export type LpApplicationInput = {
  investor_type: InvestorType;
  target_commitment: number;
  preference_areas: string[];
  accredited: true;
  note: string;
};

export type ValidationResult =
  | { ok: true; value: LpApplicationInput }
  | { ok: false; errors: string[] };

/**
 * Validate a submitted application body.
 *
 * REJECTS rather than coerces wherever a coerced value would misrepresent the
 * applicant: an unrecognised investor type, a commitment outside the stated
 * bounds, or an unchecked accreditation box are all errors. Free text is
 * trimmed and length-capped; unknown preference areas are dropped (they are
 * informational, so a stale option is not worth failing a submission over).
 */
export function validateLpApplication(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const body = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : {};

  const investorType = String(body.investor_type ?? '').trim().toLowerCase();
  if (!(INVESTOR_TYPES as readonly string[]).includes(investorType)) {
    errors.push(`investor_type must be one of: ${INVESTOR_TYPES.join(', ')}`);
  }

  // Number(null) is 0 and Number('') is 0 — both would silently pass a
  // `>= MIN` check written against the coerced value, so the raw shape is
  // checked first.
  const rawCommitment = body.target_commitment;
  const commitment = typeof rawCommitment === 'number' || typeof rawCommitment === 'string'
    ? Number(rawCommitment)
    : NaN;
  if (!Number.isFinite(commitment) || commitment < MIN_TICKET || commitment > MAX_TICKET) {
    errors.push(`target_commitment must be a number between ${MIN_TICKET} and ${MAX_TICKET}`);
  }

  // Accreditation is a legal precondition of participation (Rule 501), so it
  // is an explicit true — not a truthy value, and never a default.
  if (body.accredited !== true) {
    errors.push('accredited must be explicitly true — participation is limited to accredited investors');
  }

  const allowed = new Set<string>(PREFERENCE_AREAS);
  const prefs = Array.isArray(body.preference_areas)
    ? [...new Set(
      body.preference_areas
        .map((p) => String(p ?? '').trim().toLowerCase())
        .filter((p) => allowed.has(p)),
    )].slice(0, MAX_PREFERENCES)
    : [];

  const note = String(body.note ?? '').trim().slice(0, MAX_NOTE);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      investor_type: investorType as InvestorType,
      target_commitment: Math.round(commitment),
      preference_areas: prefs,
      accredited: true,
      note,
    },
  };
}

/** Row shape as stored. `preference_areas` is JSON text in D1. */
export type LpApplicationRow = {
  id: number;
  user_id: number;
  fund_slug: string;
  investor_type: string;
  target_commitment: number | null;
  preference_areas: string | null;
  accredited: number | null;
  note: string | null;
  status: string;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Shape a stored row for the SPA.
 *
 * `review_note` is deliberately included: an applicant who was declined is
 * entitled to the reason the GP recorded. Reviewer identity is NOT — that is
 * internal, and the applicant's own row is the only thing this endpoint ever
 * returns.
 */
export function presentLpApplication(row: LpApplicationRow | null | undefined) {
  if (!row) return null;
  let preferences: string[] = [];
  try {
    const parsed = JSON.parse(row.preference_areas || '[]');
    if (Array.isArray(parsed)) preferences = parsed.map(String);
  } catch { /* stored text was not JSON — an empty list is the honest read */ }
  const status = (APPLICATION_STATUSES as readonly string[]).includes(row.status)
    ? row.status as ApplicationStatus
    // An unrecognised stored status must not read as approved. Anything the
    // code does not know about is treated as still under review.
    : 'pending';
  return {
    id: row.id,
    fund_slug: row.fund_slug,
    investor_type: row.investor_type,
    target_commitment: row.target_commitment != null ? Number(row.target_commitment) : null,
    preference_areas: preferences,
    accredited: Number(row.accredited ?? 0) === 1,
    note: row.note || '',
    status,
    review_note: row.review_note || '',
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
