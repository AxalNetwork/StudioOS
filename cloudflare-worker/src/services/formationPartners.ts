/**
 * D6692 (#6692, P1 of #6680) — the formation partner registry's rules, for
 * `routes/admin_formation_partners.ts`: what a value must look like, when a
 * coverage row may be switched on, when a partner may be verified, the batch
 * a suspension or an end writes, and how a record reads to an HQ admin.
 *
 * THE THREE RULES THAT NEED MORE THAN A COLUMN.
 *   1. Coverage is switched on only for a verified partner holding a licence
 *      for that country that has not expired (`coverageOnRefusal`). An
 *      expiry is a date: a licence valid until a day holds through that day.
 *   2. Verify is refused without a signed data agreement, `dpa_missing`
 *      (`verifyRefusal`). `dpa_signed_on` is the day it was signed.
 *   3. A suspension or an end switches every coverage row of the partner off
 *      in the same `DB.batch` as the status change (`statusChangeBatch`), so
 *      no reader ever sees a suspended partner with coverage on.
 *
 * MONEY. Prices are integer minor units with a currency. `cost_minor` is what
 * the partner costs Axal and is the Super Admin's: `presentPrice` drops it
 * for anyone else, never returning a 0 in its place.
 */
import type { Env } from '../types';

export const STATUSES = ['draft', 'verified', 'suspended', 'ended'] as const;
export type PartnerStatus = typeof STATUSES[number];

export const SERVICES = [
  'formation', 'registered_agent', 'registered_office', 'company_secretary',
  'resident_director', 'contact_person', 'identity_verification',
  'structure_memo', 'tax_registration', 'bank_introduction',
] as const;
export const DATA_ROLES = ['processor', 'controller', 'joint_controller'] as const;
export const CADENCES = ['one_time', 'monthly', 'annual'] as const;
export const MEMBER_ROLES = ['lead', 'staff'] as const;

/** Every admin action this registry writes, as `logAdminAction` records it. */
export const FORMATION_PARTNER_ACTIONS = [
  'formation_partner.created', 'formation_partner.updated', 'formation_partner.data_terms_updated',
  'formation_partner.credential_added', 'formation_partner.credential_updated',
  'formation_partner.coverage_added', 'formation_partner.coverage_updated',
  'formation_partner.price_added', 'formation_partner.price_updated',
  'formation_partner.verified', 'formation_partner.suspended', 'formation_partner.ended',
  'formation_partner.member_added', 'formation_partner.member_revoked',
] as const;

export const TEXT_MAX = 2000;
export const SHORT_MAX = 200;
/** A price above this many minor units is a typing mistake, not a fee. */
export const MINOR_MAX = 100_000_000_000;

export const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);
/** ISO 3166-1 alpha-2, upper case. */
export const isCountry = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{2}$/.test(v);
/** A form's key, as the catalogue will name it: lower case, digits and underscores. */
export const isFormKey = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(v);
export const isCurrency = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
/** A calendar date, YYYY-MM-DD, that exists. */
export const isDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
};
export const isMinor = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MINOR_MAX;
export const isPositiveId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** Trimmed text up to `max`, null for empty or absent, 'bad' for anything else. */
export function textOrNull(v: unknown, max: number): string | null | 'bad' {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return 'bad';
  const t = v.trim();
  if (t.length > max) return 'bad';
  return t || null;
}

export type Refusal = { status: 400 | 403 | 404 | 409; code: string; message: string };

/**
 * Why a coverage row may not be switched on, or null when it may. The partner
 * must be verified, and hold a credential for the country whose `valid_until`
 * is today or later (UTC).
 */
export async function coverageOnRefusal(
  env: Env, partner: { id: number; status: string }, country: string,
): Promise<Refusal | null> {
  if (partner.status !== 'verified') {
    return { status: 409, code: 'partner_not_verified', message: 'Coverage is switched on only for a verified partner.' };
  }
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN datetime(valid_until) >= datetime('now', 'start of day') THEN 1 ELSE 0 END) AS current
       FROM formation_partner_credentials WHERE formation_partner_id = ? AND country = ?`,
  ).bind(partner.id, country).first<{ n: number; current: number | null }>();
  if (!row || Number(row.n) === 0) {
    return { status: 409, code: 'credential_missing', message: `The partner holds no licence for ${country}. Add one before switching this coverage on.` };
  }
  if (!Number(row.current)) {
    return { status: 409, code: 'credential_expired', message: `Every licence the partner holds for ${country} has expired. Record a current one before switching this coverage on.` };
  }
  return null;
}

/** Why a partner may not be verified now, or null when it may. */
export function verifyRefusal(partner: { status: string; dpa_signed_on: string | null }): Refusal | null {
  if (partner.status === 'ended') return { status: 409, code: 'partner_ended', message: 'This partner has ended. Register the firm again to work with it.' };
  if (partner.status === 'verified') return { status: 409, code: 'already_verified', message: 'This partner is already verified.' };
  if (!partner.dpa_signed_on) {
    return { status: 409, code: 'dpa_missing', message: 'Record the signed data agreement and the day it was signed before verifying this partner.' };
  }
  return null;
}

/**
 * The statements a suspension or an end writes, in one batch: the status
 * change, guarded on the state it leaves, then every coverage row of the
 * partner switched off only if the status is now the one written.
 */
export function statusChangeBatch(
  env: Env, partnerId: number, to: 'suspended' | 'ended', from: readonly PartnerStatus[], actorId: number, reason: string,
) {
  const fromJson = JSON.stringify(from);
  return [
    env.DB.prepare(
      `UPDATE formation_partners
          SET status = ?, status_reason = ?, status_changed_by = ?, status_changed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND status IN (SELECT value FROM json_each(?))`,
    ).bind(to, reason, actorId, partnerId, fromJson),
    env.DB.prepare(
      `UPDATE formation_partner_coverage
          SET is_on = 0, switched_by = ?, switched_at = datetime('now'), updated_at = datetime('now')
        WHERE formation_partner_id = ? AND is_on = 1
          AND (SELECT status FROM formation_partners WHERE id = ?) = ?`,
    ).bind(actorId, partnerId, partnerId, to),
  ];
}

/** A price row as a reader sees it: `cost_minor` only for the Super Admin. */
export function presentPrice(p: any, superAdmin: boolean) {
  const out: Record<string, unknown> = {
    uid: p.uid, founder_price_minor: Number(p.founder_price_minor), currency: p.currency, cadence: p.cadence,
    effective_from: p.effective_from, effective_to: p.effective_to ?? null, created_at: p.created_at,
  };
  if (superAdmin) out.cost_minor = p.cost_minor === null || p.cost_minor === undefined ? null : Number(p.cost_minor);
  return out;
}

export function parsePlaces(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

export async function partnerByUid(env: Env, uid: string) {
  return env.DB.prepare(
    `SELECT f.*, p.uid AS partner_uid, p.name AS partner_name, p.company AS partner_company
       FROM formation_partners f JOIN partners p ON p.id = f.partner_id WHERE f.uid = ?`,
  ).bind(uid).first<any>();
}

/** One partner with its credentials, coverage and prices, and members, as HQ reads it. */
export async function readPartner(env: Env, f: any, superAdmin: boolean) {
  const [creds, cover, prices, members] = await Promise.all([
    env.DB.prepare(
      `SELECT c.*, CASE WHEN datetime(c.valid_until) >= datetime('now', 'start of day') THEN 1 ELSE 0 END AS current
         FROM formation_partner_credentials c WHERE c.formation_partner_id = ? ORDER BY c.country, c.valid_until DESC, c.id`,
    ).bind(f.id).all<any>(),
    env.DB.prepare(
      `SELECT * FROM formation_partner_coverage WHERE formation_partner_id = ? ORDER BY country, form_key, priority, service, id`,
    ).bind(f.id).all<any>(),
    env.DB.prepare(
      `SELECT pr.* FROM formation_partner_prices pr JOIN formation_partner_coverage v ON v.id = pr.coverage_id
        WHERE v.formation_partner_id = ? ORDER BY pr.coverage_id, pr.effective_from DESC, pr.id DESC`,
    ).bind(f.id).all<any>(),
    env.DB.prepare(
      `SELECT m.*, u.name AS user_name FROM formation_partner_members m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.formation_partner_id = ? ORDER BY m.revoked_at IS NOT NULL, m.granted_at, m.id`,
    ).bind(f.id).all<any>(),
  ]);
  const pricesBy = new Map<number, any[]>();
  for (const p of prices.results || []) {
    const list = pricesBy.get(Number(p.coverage_id)) ?? [];
    list.push(presentPrice(p, superAdmin));
    pricesBy.set(Number(p.coverage_id), list);
  }
  return {
    uid: f.uid,
    partner: { uid: f.partner_uid, name: f.partner_name, company: f.partner_company ?? null },
    status: f.status,
    deal_id: f.deal_id ?? null,
    verification: f.verified_at
      ? { by: f.verified_by ?? null, at: f.verified_at, what_was_checked: f.what_was_checked ?? null, next_review_on: f.next_review_on ?? null }
      : null,
    next_review_on: f.next_review_on ?? null,
    data_terms: {
      data_role: f.data_role ?? null, dpa_document_id: f.dpa_document_id ?? null, dpa_signed_on: f.dpa_signed_on ?? null,
      transfer_mechanism: f.transfer_mechanism ?? null, retention_terms: f.retention_terms ?? null,
      deletion_contact: f.deletion_contact ?? null, restricted_places: parsePlaces(f.restricted_places_json),
    },
    status_change: f.status_changed_at ? { by: f.status_changed_by ?? null, at: f.status_changed_at, reason: f.status_reason ?? null } : null,
    credentials: (creds.results || []).map((c) => ({
      uid: c.uid, country: c.country, licence_type: c.licence_type, licence_number: c.licence_number, regulator: c.regulator,
      valid_until: c.valid_until, current: Number(c.current) === 1, evidence_document_id: c.evidence_document_id ?? null,
      checked: c.checked_on ? { by: c.checked_by ?? null, on: c.checked_on } : null,
    })),
    coverage: (cover.results || []).map((v) => ({
      uid: v.uid, country: v.country, form_key: v.form_key, service: v.service, target_hours: v.target_hours ?? null,
      priority: Number(v.priority), on: Number(v.is_on) === 1,
      switched: v.switched_at ? { by: v.switched_by ?? null, at: v.switched_at } : null,
      prices: pricesBy.get(Number(v.id)) ?? [],
    })),
    members: (members.results || []).map((m) => ({
      uid: m.uid, user_id: Number(m.user_id), user_name: m.user_name ?? null, role: m.role,
      granted: { by: m.granted_by ?? null, at: m.granted_at },
      revoked: m.revoked_at ? { by: m.revoked_by ?? null, at: m.revoked_at } : null,
    })),
    cost_visible: superAdmin,
    created_at: f.created_at,
    updated_at: f.updated_at,
  };
}
