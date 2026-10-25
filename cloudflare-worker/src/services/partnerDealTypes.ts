/**
 * D986 (#2776, part 5 of #2376) — which partner deal types a licence may offer.
 *
 * HQ keeps one row per licence (`licence_partner_deal_types`, migration 555):
 * the subset of `ALL_PARTNER_DEAL_TYPES` the studio may put in a partner
 * invitation. The licence push carries it to the branch's copy
 * (`branch_licence.partner_deal_types_json`), and the branch's invitation write
 * refuses a type the copy does not allow.
 *
 * NO ROW IS "NOT RECORDED", NEVER "EVERY TYPE". What an unset licence may offer
 * until HQ sets it is D986 §3's rule: every type, as before this store existed,
 * so no studio loses a deal type because HQ has not got to it. The read says
 * which it is (`recorded: false`), so no page passes that rule off as HQ's
 * decision.
 */
import type { Env } from '../types';
import { ALL_PARTNER_DEAL_TYPES, type PartnerDealType } from './partnerDeals';

/** The canvas's words for each type (GR3, GR7), in `ALL_PARTNER_DEAL_TYPES` order. */
export const DEAL_TYPE_LABELS: Readonly<Record<PartnerDealType, string>> = {
  equity_partnership: 'Equity partnership',
  services_partnership: 'Services partnership',
  deal_sourcing_revshare: 'Deal sourcing revenue share',
  capital_partnership: 'Capital partnership',
  custom: 'Custom deal',
};

export const NOT_RECORDED_SENTENCE = 'Not recorded. HQ has not set which partner deal types this studio may offer, so every type stays open until it does.';
export const NOT_PUSHED_SENTENCE = 'Not recorded. HQ has not sent this studio its partner deal types yet, so every type stays open until it does.';

/** Every type with its label, for a page that draws the list. */
export function catalogue(): { type: PartnerDealType; label: string }[] {
  return ALL_PARTNER_DEAL_TYPES.map((type) => ({ type, label: DEAL_TYPE_LABELS[type] }));
}

export class DealTypesInputError extends Error {
  code: string;
  sentence: string;
  extra: Record<string, unknown>;
  constructor(code: string, sentence: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.sentence = sentence;
    this.extra = extra;
  }
}

/**
 * A write's `types`: an array of known types, de-duplicated and put in
 * catalogue order, so two writes naming the same set compare equal. `null`
 * clears the row (back to Not recorded). Anything else is refused.
 */
export function normalizeTypes(raw: unknown): PartnerDealType[] | null {
  if (raw === null) return null;
  if (!Array.isArray(raw)) {
    throw new DealTypesInputError('invalid_types', 'Send `types` as a list of deal types, or null to clear it.');
  }
  const asked = raw.map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : ''));
  const unknown = asked.filter((t) => !(ALL_PARTNER_DEAL_TYPES as string[]).includes(t));
  if (unknown.length) {
    throw new DealTypesInputError('unknown_deal_type', 'One of these is not a partner deal type.', {
      unknown, valid: ALL_PARTNER_DEAL_TYPES,
    });
  }
  return ALL_PARTNER_DEAL_TYPES.filter((t) => asked.includes(t));
}

/** A stored or pushed JSON array, read back to known types in catalogue order; null when it is not an array. */
export function parseTypes(raw: string | null | undefined): PartnerDealType[] | null {
  if (raw == null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(parsed)) return null;
  return ALL_PARTNER_DEAL_TYPES.filter((t) => parsed.includes(t));
}

export interface HqDealTypes {
  recorded: boolean;
  types: PartnerDealType[] | null;
  updated_at: string | null;
  updated_by_user_id: number | null;
  reason: string | null;
}

/** HQ's row for one licence. Throws on a D1 error: the caller answers 5xx, never "not recorded". */
export async function readHqDealTypes(env: Env, licenceId: number): Promise<HqDealTypes> {
  const row = await env.DB.prepare(
    'SELECT types_json, updated_at, updated_by_user_id FROM licence_partner_deal_types WHERE licence_id = ?',
  ).bind(licenceId).first<{ types_json: string; updated_at: string; updated_by_user_id: number | null }>();
  if (!row) return { recorded: false, types: null, updated_at: null, updated_by_user_id: null, reason: NOT_RECORDED_SENTENCE };
  return {
    recorded: true,
    types: parseTypes(row.types_json) ?? [],
    updated_at: row.updated_at,
    updated_by_user_id: row.updated_by_user_id ?? null,
    reason: null,
  };
}

/** Every licence's row, keyed by licence id, for HQ's list. */
export async function readAllHqDealTypes(env: Env): Promise<Map<number, { types: PartnerDealType[]; updated_at: string }>> {
  const res = await env.DB.prepare(
    'SELECT licence_id, types_json, updated_at FROM licence_partner_deal_types',
  ).all<{ licence_id: number; types_json: string; updated_at: string }>();
  const out = new Map<number, { types: PartnerDealType[]; updated_at: string }>();
  for (const r of res.results || []) out.set(Number(r.licence_id), { types: parseTypes(r.types_json) ?? [], updated_at: r.updated_at });
  return out;
}

/**
 * What the licence push carries: the JSON array, or the JSON `null` when HQ has
 * recorded none. A read that fails throws, and the push omits the key, so the
 * branch keeps the copy it has rather than losing it.
 */
export async function dealTypesForPush(env: Env, licenceId: number): Promise<string> {
  const rec = await readHqDealTypes(env, licenceId);
  return JSON.stringify(rec.recorded ? rec.types : null);
}

export type BranchDealTypes =
  | { state: 'recorded'; types: PartnerDealType[] }
  | { state: 'not_recorded' | 'not_pushed'; types: null; reason: string };

/**
 * The branch's copy. SQL NULL is a copy HQ pushed before migration 555; the
 * JSON `null` is a push that says HQ has recorded none. A copy that cannot be
 * read throws, so the invitation write answers 503 rather than guessing.
 */
export async function readBranchDealTypes(env: Env): Promise<BranchDealTypes> {
  const row = await env.DB.prepare('SELECT partner_deal_types_json FROM branch_licence WHERE id = 1')
    .first<{ partner_deal_types_json: string | null }>();
  const raw = row?.partner_deal_types_json ?? null;
  if (raw === null) return { state: 'not_pushed', types: null, reason: NOT_PUSHED_SENTENCE };
  if (raw === 'null') return { state: 'not_recorded', types: null, reason: NOT_RECORDED_SENTENCE };
  const types = parseTypes(raw);
  if (types === null) throw new Error('branch_licence.partner_deal_types_json is not a list');
  return { state: 'recorded', types };
}

/**
 * The refusal an invitation gets for types its licence does not allow, naming
 * each one; null when every asked type is allowed.
 */
export function notAllowedRefusal(asked: PartnerDealType[], allowed: PartnerDealType[]):
  { error: 'deal_type_not_allowed'; message: string; not_allowed: PartnerDealType[]; allowed: PartnerDealType[] } | null {
  const refused = asked.filter((t) => !allowed.includes(t));
  if (!refused.length) return null;
  const names = refused.map((t) => DEAL_TYPE_LABELS[t]);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return {
    error: 'deal_type_not_allowed',
    message: `This studio's licence does not allow ${list}. HQ sets which partner deal types a studio may offer.`,
    not_allowed: refused,
    allowed,
  };
}
