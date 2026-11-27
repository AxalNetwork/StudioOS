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
 * answer. It is only a quote: the owner decided (#5025) that a change takes
 * effect at the next term only, with no proration and no notice period, so
 * `financial_rule` reads `next_term_no_proration` and `proration_applies` is
 * false. Part 2 (`packageChanges.ts`) schedules such a change. Part 3
 * (`endingDependents`) reads the open items of each program a downgrade or
 * change ends, for the licence's holders.
 */
import type { Env } from '../types';
import type { PackageOffer } from './packageOffers';

export const TERM_STATES = Object.freeze(['scheduled', 'active', 'renewal_pending', 'superseded', 'ended'] as const);
export type TermState = typeof TERM_STATES[number];
export const CHANGE_KINDS = Object.freeze(['renewal', 'upgrade', 'downgrade', 'change'] as const);
export type ChangeKind = typeof CHANGE_KINDS[number];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The owner's rule (#5025): next term only, no proration, no notice. */
export const FINANCIAL_RULE = 'next_term_no_proration' as const;

export const today = () => new Date().toISOString().slice(0, 10);
export const programKeys = (o: Pick<PackageOffer, 'composition_json'>): string[] => {
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
/** The day after `d` (YYYY-MM-DD, UTC). */
export const nextDay = (d: string) => new Date(dayMs(d) + 86_400_000).toISOString().slice(0, 10);
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

/**
 * ENDING DEPENDENTS (D5025-p3, #8830). For a downgrade or change, each ending
 * program's OPEN items, read from that program's own store for the licence's
 * holders, with a count and identifiers. Read only: nothing here grants, ends,
 * pauses or rewrites a cohort, a claim or a workflow.
 *
 * THE HOLDERS. A package term is held by a territory licence, whose accounts on
 * HQ are its `licence_admins` (principal and delegates). Those are the accounts
 * whose items are read. A deployed branch's own members live in the branch's
 * database, which HQ does not read here.
 *
 * OPEN, per source, is work still running or still owed, never past activity
 * (D5059-p1's evidence table answers a different question):
 *   spinout-lab        cohort seat pending, waitlisted, approved or activated, in a cycle not completed
 *   learning           active enrolment in a program not archived
 *   investor-cohorts   investor cohort grant not ended, its end day today or later
 *   mentor-cohorts     active mentor assignment, not unassigned, in a cycle not completed
 *   perks              issued claim: not redeemed, revoked or past its expiry
 *   refer-and-earn     submitted referral not yet rewarded, rejected or closed
 *   referral-partners  partner terms in approval or signature, or active and current
 *   influencer         influencer membership active or paused
 *   product-testing    tester application or membership applied, active or paused
 * A program with no mapped source (AI-native Venture, any registry key) reads
 * `not_recorded` with its reason, never an empty list or 0. A source that fails
 * reads `unreadable`; a store this database lacks reads `not_recorded`.
 */
export const NO_DEPENDENTS_STORE =
  'Not recorded: no store is mapped that names the open cohorts, claims and workflows of this program, so the review cannot list them';
export const NO_HOLDERS =
  'Not recorded: no account is bound to this licence as an administrator, so there is no holder whose open items could be read';
export const STORE_MISSING = 'Not recorded: this program\'s store does not exist in this database';
export const STORE_UNREADABLE = 'Unreadable: this program\'s store could not be read. That is not the same as no open items.';
export const HOLDERS_SCOPE =
  'The licence\'s administrator accounts on HQ (licence_admins). A deployed branch\'s own members are in its database and are not read here.';
/** Identifiers returned per source; `count` is always the full number. */
export const OPEN_ITEMS_CAP = 100;

// One bound parameter order for every source: holders (JSON ids), UTC day, ISO now, cap + 1.
const OPEN = `WITH params AS (SELECT ? AS holders, ? AS day, ? AS now, ? AS cap),
  h AS (SELECT CAST(value AS INTEGER) AS user_id FROM json_each((SELECT holders FROM params)))`;
const OPEN_SOURCES: Record<string, { source: string; open_means: string; sql: string }> = {
  'spinout-lab': {
    source: 'cohort_applicants', open_means: 'A cohort seat pending, waitlisted, approved or activated, in a cycle not completed',
    sql: `${OPEN} SELECT COUNT(*) OVER () AS total, CAST(a.id AS TEXT) AS ref, a.user_id FROM cohort_applicants a
      JOIN cohort_cycles c ON c.id = a.cohort_cycle_id
      WHERE a.user_id IN (SELECT user_id FROM h) AND a.status IN ('pending', 'waitlisted', 'approved', 'activated') AND c.status <> 'completed'
      ORDER BY a.id LIMIT (SELECT cap FROM params)`,
  },
  learning: {
    source: 'learning_enrollments', open_means: 'An active enrolment in a learning program that is not archived',
    sql: `${OPEN} SELECT COUNT(*) OVER () AS total, CAST(e.id AS TEXT) AS ref, e.user_id FROM learning_enrollments e
      JOIN learning_programs p ON p.id = e.program_id
      WHERE e.user_id IN (SELECT user_id FROM h) AND e.status = 'active' AND p.status <> 'archived'
      ORDER BY e.id LIMIT (SELECT cap FROM params)`,
  },
  'investor-cohorts': {
    source: 'investor_cohort_access', open_means: 'An investor cohort grant not ended, whose end day is today or later',
    sql: `${OPEN} SELECT COUNT(*) OVER () AS total, g.uid AS ref, g.investor_user_id AS user_id FROM investor_cohort_access g
      WHERE g.investor_user_id IN (SELECT user_id FROM h) AND g.ended_at IS NULL AND date(g.ends_at) >= (SELECT day FROM params)
      ORDER BY g.id LIMIT (SELECT cap FROM params)`,
  },
  'mentor-cohorts': {
    source: 'advisor_cohort_assignments', open_means: 'An active mentor assignment, not unassigned, in a cycle not completed',
    sql: `${OPEN} SELECT COUNT(*) OVER () AS total, a.uid AS ref, a.advisor_user_id AS user_id FROM advisor_cohort_assignments a
      JOIN cohort_cycles c ON c.id = a.cohort_cycle_id
      WHERE a.advisor_user_id IN (SELECT user_id FROM h) AND a.is_active = 1 AND a.unassigned_at IS NULL AND c.status <> 'completed'
      ORDER BY a.id LIMIT (SELECT cap FROM params)`,
  },
  perks: {
    source: 'perk_claims', open_means: 'An issued perk claim: not redeemed, revoked or past its expiry',
    sql: `${OPEN} SELECT COUNT(*) OVER () AS total, p.uid AS ref, p.user_id FROM perk_claims p
      WHERE p.user_id IN (SELECT user_id FROM h) AND p.status = 'issued'
        AND (p.expires_at IS NULL OR datetime(p.expires_at) > datetime((SELECT now FROM params)))
      ORDER BY p.id LIMIT (SELECT cap FROM params)`,
  },
  'refer-and-earn': {
    source: 'referral_submissions', open_means: 'A submitted referral not yet rewarded, rejected or closed',
    sql: `${OPEN} SELECT COUNT(*) OVER () AS total, r.uid AS ref, r.referrer_user_id AS user_id FROM referral_submissions r
      WHERE r.referrer_user_id IN (SELECT user_id FROM h)
        AND r.status IN ('submitted', 'under_review', 'more_info_needed', 'qualified', 'in_conversation', 'converted', 'reward_eligible')
      ORDER BY r.id LIMIT (SELECT cap FROM params)`,
  },
  'referral-partners': {
    source: 'referral_partner_terms', open_means: 'Partner terms in approval or signature, or active with no end day before today',
    sql: `${OPEN} SELECT COUNT(*) OVER () AS total, t.uid AS ref, p.user_id FROM referral_partner_terms t
      JOIN referral_partners p ON p.id = t.partner_id
      WHERE p.user_id IN (SELECT user_id FROM h) AND p.segment <> 'influencers'
        AND (t.status IN ('submitted', 'approved', 'sent', 'signed')
          OR (t.status = 'active' AND (t.ends_on IS NULL OR date(t.ends_on) >= (SELECT day FROM params))))
      ORDER BY t.id LIMIT (SELECT cap FROM params)`,
  },
  influencer: {
    source: 'influencers', open_means: 'An influencer membership active or paused, not ended',
    sql: `${OPEN} SELECT COUNT(*) OVER () AS total, i.uid AS ref, i.user_id FROM influencers i
      WHERE i.user_id IN (SELECT user_id FROM h) AND i.status IN ('active', 'paused')
      ORDER BY i.id LIMIT (SELECT cap FROM params)`,
  },
  'product-testing': {
    source: 'product_testers', open_means: 'A tester application or membership applied, active or paused',
    sql: `${OPEN} SELECT COUNT(*) OVER () AS total, CAST(t.id AS TEXT) AS ref, t.user_id FROM product_testers t
      WHERE t.user_id IN (SELECT user_id FROM h) AND t.status IN ('applied', 'active', 'paused')
      ORDER BY t.id LIMIT (SELECT cap FROM params)`,
  },
};
/** The program keys whose open items have a mapped source. */
export const OPEN_ITEM_PROGRAMS = Object.freeze(Object.keys(OPEN_SOURCES).sort());

export type ProgramOpenItems =
  | { program_key: string; status: 'read'; source: string; open_means: string; count: number;
      items: Array<{ ref: string; user_id: number }>; truncated: boolean }
  | { program_key: string; status: 'not_recorded' | 'unreadable'; reason: string };
export type EndingDependents = {
  /** `read` when every ending program was read, `not_read` when none was, `partial` otherwise. */
  status: 'read' | 'partial' | 'not_read';
  read_only: true;
  holders: { scope: string; user_ids: number[] } | null;
  programs: ProgramOpenItems[];
};

const summarise = (programs: ProgramOpenItems[]): EndingDependents['status'] => {
  const read = programs.filter((p) => p.status === 'read').length;
  return read === programs.length ? 'read' : read === 0 ? 'not_read' : 'partial';
};

/** Every ending program as not recorded: the pure review's answer before any store is read. */
export function dependentsNotRead(keys: string[]): EndingDependents {
  const programs = keys.map((k): ProgramOpenItems => ({ program_key: k, status: 'not_recorded', reason: NO_DEPENDENTS_STORE }));
  return { status: 'not_read', read_only: true, holders: null, programs };
}

/** The licence's holder accounts on HQ: its administrators. */
export async function licenceHolders(env: Env, licenceUid: string): Promise<number[]> {
  const r = await env.DB.prepare(`SELECT DISTINCT la.user_id FROM licence_admins la JOIN territory_licences l ON l.id = la.licence_id
      WHERE l.uid = ? ORDER BY la.user_id`).bind(licenceUid).all<{ user_id: number }>();
  return (r.results || []).map((x) => Number(x.user_id));
}

/** The open items of each ending program, for the licence's holders. Read only. */
export async function endingDependents(env: Env, licenceUid: string, keys: string[], day: string, now: string): Promise<EndingDependents> {
  const holders = await licenceHolders(env, licenceUid);
  const programs = await Promise.all(keys.map(async (k): Promise<ProgramOpenItems> => {
    const src = Object.hasOwn(OPEN_SOURCES, k) ? OPEN_SOURCES[k] : null;
    if (!src) return { program_key: k, status: 'not_recorded', reason: NO_DEPENDENTS_STORE };
    if (!holders.length) return { program_key: k, status: 'not_recorded', reason: NO_HOLDERS };
    try {
      const r = await env.DB.prepare(src.sql).bind(JSON.stringify(holders), day, now, OPEN_ITEMS_CAP + 1)
        .all<{ total: number; ref: string; user_id: number }>();
      const rows = r.results || [];
      return {
        program_key: k, status: 'read', source: src.source, open_means: src.open_means,
        count: rows.length ? Number(rows[0].total) : 0,
        items: rows.slice(0, OPEN_ITEMS_CAP).map((x) => ({ ref: String(x.ref), user_id: Number(x.user_id) })),
        truncated: rows.length > OPEN_ITEMS_CAP,
      };
    } catch (e) {
      const missing = /no such table/i.test(String((e as Error)?.message ?? e));
      return { program_key: k, status: missing ? 'not_recorded' : 'unreadable', reason: missing ? STORE_MISSING : STORE_UNREADABLE };
    }
  }));
  return { status: summarise(programs), read_only: true, holders: { scope: HOLDERS_SCOPE, user_ids: holders }, programs };
}

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
  const nextTermStart = nextDay(term.ends_on);
  const effective = input.effectiveOn ?? null;
  const ending = oldKeys.filter((k) => !newKeys.includes(k));
  const dependents: EndingDependents | null = kind === 'downgrade' || kind === 'change' ? dependentsNotRead(ending) : null;
  return {
    current_term: { uid: term.uid, package_key: term.package_key, package_version: term.package_version, package_name: term.package_name,
      starts_on: term.starts_on, ends_on: term.ends_on, state: termState(term, all, day), accepted_annual_fee_cents: old, currency: term.currency },
    proposal: { uid: proposal.uid, state: proposal.state, package_key: proposal.package_key, package_version: proposal.package_version,
      package_name: proposal.package_name, starts_on: proposal.starts_on, ends_on: proposal.ends_on, currency: proposal.currency },
    kind,
    programs: {
      held: oldKeys.filter((k) => newKeys.includes(k)),
      added: newKeys.filter((k) => !oldKeys.includes(k)),
      ending,
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
    // The pure review reads no store; the route replaces this with `endingDependents`.
    ending_dependents: dependents,
    financial_rule: FINANCIAL_RULE,
    proration_applies: false,
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
