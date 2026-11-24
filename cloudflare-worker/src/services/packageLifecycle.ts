/**
 * D5025 (#5025, part 1) — the lifecycle of an accepted Axal VC package term:
 * its state, the review of a renewal, upgrade, downgrade or change before HQ
 * accepts it, and a deterministic proration quote. Read only: nothing here
 * writes an offer, a grant, an invoice or an adjustment.
 *
 * STATES. An accepted term (D5024 `licence_package_offers.state = 'accepted'`)
 * is, on a UTC day:
 *   scheduled         its term has not started;
 *   active            its term covers the day;
 *   renewal_pending   active, and a later draft or offered offer for the same
 *                     licence starts after it (HQ has not accepted it);
 *   superseded        a later accepted term for the licence has started;
 *   ended             its term is over and no later accepted term has started.
 *
 * REVIEW. A proposed offer is read against the licence's current term (the
 * active one, else the latest that is scheduled): the kind (renewal for the
 * same package with the same programs, upgrade for a strict superset of programs, downgrade for a
 * strict subset, change otherwise), the programs held, added, ending, and
 * held standalone that become bundled, the old accepted price against the new
 * recommendation, and the country index movement between the two frozen
 * recommendations. The accepted term itself never changes (D5024): HQ accepts
 * the new offer through D5024's route.
 *
 * PRORATION. `prorate` is actual-day, integer cents (BigInt), inclusive of
 * both term ends: the unused share of the old annual fee is a credit and the
 * same share of the new fee a debit, each floored, with the trace frozen in the
 * answer. It is a quote. Whether a change is next-term only or immediate with
 * proration, and which billing record would carry an adjustment, are the
 * owner's decisions (#5025): `financial_rule` reads `not_decided` until then.
 */
import type { Env } from '../types';
import type { PackageOffer } from './packageOffers';

export const TERM_STATES = Object.freeze(['scheduled', 'active', 'renewal_pending', 'superseded', 'ended'] as const);
export type TermState = typeof TERM_STATES[number];
export const CHANGE_KINDS = Object.freeze(['renewal', 'upgrade', 'downgrade', 'change'] as const);
export type ChangeKind = typeof CHANGE_KINDS[number];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const today = () => new Date().toISOString().slice(0, 10);
const programKeys = (o: Pick<PackageOffer, 'composition_json'>): string[] => {
  try {
    const list = JSON.parse(o.composition_json);
    return Array.isArray(list) ? [...new Set(list.map((p: any) => String(p?.program_key)).filter(Boolean))].sort() : [];
  } catch { return []; }
};
const indexPpm = (o: Pick<PackageOffer, 'recommendation_json'>): number | null => {
  try { const n = Number(JSON.parse(o.recommendation_json)?.country_index_ppm); return Number.isSafeInteger(n) && n > 0 ? n : null; } catch { return null; }
};

/** The state of one accepted term on `day`, given every offer of the same licence. */
export function termState(term: PackageOffer, all: PackageOffer[], day: string): TermState {
  const laterAccepted = all.filter((o) => o.uid !== term.uid && o.state === 'accepted' && o.starts_on > term.starts_on);
  if (laterAccepted.some((o) => o.starts_on <= day)) return 'superseded';
  if (day < term.starts_on) return 'scheduled';
  if (day > term.ends_on) return 'ended';
  const pending = all.some((o) => o.uid !== term.uid && (o.state === 'draft' || o.state === 'offered') && o.starts_on > term.starts_on);
  return pending ? 'renewal_pending' : 'active';
}

/** The term a proposal is read against: the active one, else the latest scheduled; null with none. */
export function currentTerm(all: PackageOffer[], day: string): PackageOffer | null {
  const accepted = all.filter((o) => o.state === 'accepted').sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const live = accepted.filter((o) => {
    const s = termState(o, all, day);
    return s === 'active' || s === 'renewal_pending';
  });
  if (live.length) return live[live.length - 1];
  const scheduled = accepted.filter((o) => termState(o, all, day) === 'scheduled');
  return scheduled.length ? scheduled[scheduled.length - 1] : null;
}

export function changeKind(oldKeys: string[], newKeys: string[], samePackage: boolean): ChangeKind {
  const o = new Set(oldKeys), n = new Set(newKeys);
  const superset = oldKeys.every((k) => n.has(k)) && newKeys.length > oldKeys.length;
  const subset = newKeys.every((k) => o.has(k)) && newKeys.length < oldKeys.length;
  const same = oldKeys.length === newKeys.length && newKeys.every((k) => o.has(k));
  if (samePackage && same) return 'renewal';
  if (superset) return 'upgrade';
  if (subset) return 'downgrade';
  return 'change';
}

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const daysInclusive = (from: string, to: string) => Math.floor((dayMs(to) - dayMs(from)) / 86_400_000) + 1;

export interface Proration {
  convention: 'actual_day_inclusive';
  term_starts_on: string; term_ends_on: string; effective_on: string;
  term_days: number; remaining_days: number;
  old_annual_fee_cents: number; new_annual_fee_cents: number; currency: string;
  credit_cents: number; debit_cents: number; net_cents: number;
  direction: 'debit' | 'credit' | 'none';
  trace: string[];
}

/**
 * Actual-day proration over one term: the share of the term from `effective`
 * to its end, both days included. Each share is floored in integer cents.
 * Refuses (null) an effective day outside the term or a currency change.
 */
export function prorate(input: {
  termStartsOn: string; termEndsOn: string; effectiveOn: string;
  oldAnnualFeeCents: number; newAnnualFeeCents: number; currency: string; newCurrency: string;
}): Proration | null {
  const { termStartsOn: s, termEndsOn: e, effectiveOn: f } = input;
  if (![s, e, f].every((d) => DAY.test(d)) || f < s || f > e || input.currency !== input.newCurrency) return null;
  if (![input.oldAnnualFeeCents, input.newAnnualFeeCents].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  const termDays = daysInclusive(s, e);
  const remaining = daysInclusive(f, e);
  const share = (cents: number) => Number((BigInt(cents) * BigInt(remaining)) / BigInt(termDays));
  const credit = share(input.oldAnnualFeeCents);
  const debit = share(input.newAnnualFeeCents);
  const net = debit - credit;
  return {
    convention: 'actual_day_inclusive',
    term_starts_on: s, term_ends_on: e, effective_on: f, term_days: termDays, remaining_days: remaining,
    old_annual_fee_cents: input.oldAnnualFeeCents, new_annual_fee_cents: input.newAnnualFeeCents, currency: input.currency,
    credit_cents: credit, debit_cents: debit, net_cents: net,
    direction: net > 0 ? 'debit' : net < 0 ? 'credit' : 'none',
    trace: [
      `term ${s} to ${e}: ${termDays} days, both included`,
      `effective ${f}: ${remaining} days remain, both included`,
      `credit floor(${input.oldAnnualFeeCents} × ${remaining} / ${termDays}) = ${credit}`,
      `debit floor(${input.newAnnualFeeCents} × ${remaining} / ${termDays}) = ${debit}`,
      `net ${debit} − ${credit} = ${net}`,
    ],
  };
}

export const NO_DEPENDENTS_STORE =
  'Not recorded: no shared store yet names the open cohorts, claims and workflows of a program, so the review cannot list them';

/** The review of `proposal` against the licence's current term. Read only. */
export function reviewChange(input: {
  proposal: PackageOffer; all: PackageOffer[]; standaloneGranted: string[]; day: string; effectiveOn?: string | null;
}) {
  const { proposal, all, day } = input;
  const term = currentTerm(all.filter((o) => o.uid !== proposal.uid), day);
  const newKeys = programKeys(proposal);
  if (!term) {
    return { current_term: null, kind: null, reason: 'This licence has no accepted package term to change; the offer is a first term.' };
  }
  const oldKeys = programKeys(term);
  const kind = changeKind(oldKeys, newKeys, term.package_key === proposal.package_key);
  const oldIdx = indexPpm(term), newIdx = indexPpm(proposal);
  const old = term.accepted_annual_fee_cents as number;
  const next = proposal.accepted_annual_fee_cents ?? proposal.recommended_annual_fee_cents;
  const nextTermStart = (() => { const d = new Date(dayMs(term.ends_on) + 86_400_000); return d.toISOString().slice(0, 10); })();
  const effective = input.effectiveOn ?? null;
  return {
    current_term: { uid: term.uid, package_key: term.package_key, package_version: term.package_version, package_name: term.package_name,
      starts_on: term.starts_on, ends_on: term.ends_on, state: termState(term, all, day), accepted_annual_fee_cents: old, currency: term.currency },
    proposal: { uid: proposal.uid, state: proposal.state, package_key: proposal.package_key, package_version: proposal.package_version,
      package_name: proposal.package_name, starts_on: proposal.starts_on, ends_on: proposal.ends_on, currency: proposal.currency },
    kind,
    programs: {
      held: oldKeys.filter((k) => newKeys.includes(k)),
      added: newKeys.filter((k) => !oldKeys.includes(k)),
      ending: oldKeys.filter((k) => !newKeys.includes(k)),
      standalone_becoming_bundled: input.standaloneGranted.filter((k) => newKeys.includes(k) && !oldKeys.includes(k)).sort(),
    },
    price: {
      old_accepted_annual_fee_cents: old,
      new_annual_fee_cents: next,
      new_is: proposal.accepted_annual_fee_cents != null ? 'accepted' : 'recommended',
      currency_changes: term.currency !== proposal.currency,
      difference_cents: term.currency === proposal.currency ? next - old : null,
    },
    country_index: {
      old_ppm: oldIdx, new_ppm: newIdx,
      movement_ppm: oldIdx != null && newIdx != null ? newIdx - oldIdx : null,
    },
    effective: {
      next_term_starts_on: nextTermStart,
      proposal_starts_on: proposal.starts_on,
      starts_inside_current_term: proposal.starts_on <= term.ends_on,
    },
    ending_dependents: kind === 'downgrade' || kind === 'change'
      ? { status: 'not_recorded', reason: NO_DEPENDENTS_STORE } : null,
    financial_rule: 'not_decided',
    proration_quote: effective
      ? prorate({ termStartsOn: term.starts_on, termEndsOn: term.ends_on, effectiveOn: effective,
        oldAnnualFeeCents: old, newAnnualFeeCents: next, currency: term.currency, newCurrency: proposal.currency })
      : null,
    current_term_changes: false,
  };
}

export async function licenceOffers(env: Env, licenceUid: string): Promise<PackageOffer[]> {
  const r = await env.DB.prepare('SELECT * FROM licence_package_offers WHERE licence_uid = ? ORDER BY starts_on, created_at, uid').bind(licenceUid).all<PackageOffer>();
  return r.results || [];
}

/** Programs the licence holds granted today outside any accepted package item. */
export async function standaloneGranted(env: Env, licenceUid: string): Promise<string[]> {
  const r = await env.DB.prepare(`SELECT DISTINCT g.program_key FROM program_grants g JOIN territory_licences l ON l.id = g.licence_id
      WHERE l.uid = ? AND g.state = 'granted'
        AND NOT EXISTS (SELECT 1 FROM licence_package_items i JOIN licence_package_offers o ON o.uid = i.offer_uid
                         WHERE i.grant_uid = g.uid AND o.state = 'accepted')`).bind(licenceUid).all<{ program_key: string }>();
  return (r.results || []).map((x) => x.program_key).sort();
}
