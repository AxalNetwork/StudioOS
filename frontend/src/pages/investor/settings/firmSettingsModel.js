/**
 * D6287 part 2 (#6287): the pure rules behind Firm Settings' status blocks,
 * the "In your deal flow now" fit panel and Team seats (canvas boards CS-17,
 * CS-18, CS-20, CS-24, CS-25). Every function reads what a Worker route
 * returned and never invents a value: a missing one comes back null, and the
 * page draws it as Not recorded.
 */

/** What deal fit needs before it can say Match (CS-19): type, a sector, a stage, a cheque size. */
export function firmCompleteness(profile) {
  if (!profile) return null;
  const needs = [];
  if (!profile.investor_type) needs.push('investor type');
  if (!(profile.sectors || []).length) needs.push('a sector');
  if (!(profile.stages || []).length) needs.push('a stage');
  if (!profile.ticket_band) needs.push('a cheque size');
  return { complete: needs.length === 0, needs };
}

/** `GET /api/kyc/status` → the word the Identity block shows. Unknown values stay as recorded. */
const KYC_WORDS = {
  approved: 'Verified',
  pending: 'In review',
  submitted: 'In review',
  needs_info: 'Needs information',
  rejected: 'Not verified',
  not_started: 'Not started',
};
export function kycWord(status) {
  const key = String(status || '').trim();
  if (!key) return null;
  return KYC_WORDS[key] || key.replace(/_/g, ' ');
}

/** The self-declared accreditation from the investor profile, as words; null is Not recorded. */
export function accreditationWord(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  const words = v.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The investor licence's plan from `GET /api/account/licences` (`held[].plan`), or null. */
export function investorPlan(licences) {
  const held = Array.isArray(licences?.held) ? licences.held : [];
  const investor = held.find((row) => row?.licence === 'investor');
  return investor?.plan || null;
}

/**
 * Whether the licences read says seats come with this account's plan.
 * true / false when the read answered, null when it has not (loading or failed):
 * the page then lets the Worker decide (`POST /investor-seats/invite` refuses 402).
 */
export function seatsIncluded(licencesRead) {
  if (licencesRead?.kind !== 'ok') return null;
  return investorPlan(licencesRead.data)?.key === 'investor:institutional';
}

/** `GET /api/funds` item → how the caller stands in it (D4636 `relationship`). */
export function fundRelation(fund) {
  if (fund?.relationship === 'gp') return 'You manage';
  if (fund?.relationship === 'lp') return 'You are an LP';
  if (fund?.relationship === 'admin') return 'Admin view';
  return null;
}

/** The four fit criteria, in the canvas's column order, and their words (CS-18 legend). */
export const FIT_KEYS = [['sector', 'Sector'], ['stage', 'Stage'], ['region', 'Region'], ['ticket', 'Cheque']];
export const FIT_WORDS = { match: 'Match', outside: 'Outside', not_set: 'Not set', not_recorded: 'Not recorded' };

/**
 * One `GET /api/deals/fit` item → what its row draws. `unreadable` and
 * `unavailable` are whole-row states (CS-18: Try again, Deal unavailable);
 * otherwise one state per criterion, `not_recorded` when the item omits one.
 */
export function fitRow(item) {
  if (!item) return { kind: 'unreadable' };
  if (item.state === 'unreadable') return { kind: 'unreadable' };
  if (item.state === 'unavailable') return { kind: 'unavailable' };
  const byKey = new Map((Array.isArray(item.criteria) ? item.criteria : []).map((c) => [c.key, c.state]));
  const cells = {};
  for (const [key] of FIT_KEYS) cells[key] = FIT_WORDS[byKey.get(key)] ? byKey.get(key) : 'not_recorded';
  return { kind: 'criteria', cells };
}

/**
 * The session-only compare (CS-18): which criteria changed between the fit
 * read before Save and the one after it. Only deals present in both reads
 * with criteria in both are compared; nothing is kept past this page.
 */
export function fitMoves(beforeFits, afterFits) {
  if (!(beforeFits instanceof Map) || !(afterFits instanceof Map)) return null;
  const moves = [];
  for (const [id, after] of afterFits) {
    const was = fitRow(beforeFits.get(id));
    const now = fitRow(after);
    if (!beforeFits.has(id) || was.kind !== 'criteria' || now.kind !== 'criteria') continue;
    for (const [key, label] of FIT_KEYS) {
      if (was.cells[key] !== now.cells[key]) moves.push({ dealId: id, key, label, from: was.cells[key], to: now.cells[key] });
    }
  }
  return moves;
}

/** A failed deal-flow or fit read → which of CS-18B's three answers it is. */
export function fitFailure(error) {
  if (error?.status === 402) return 'plan';
  if (error?.status === 403) return 'refused';
  return 'unreadable';
}

/** The fit read is at most 50 deals a call (`deal_views.ts`). */
export const FIT_LIMIT = 50;

/** `GET /api/deals/flow` items → the deals the panel lists, at most FIT_LIMIT. */
export function flowDeals(flow) {
  const items = Array.isArray(flow?.items) ? flow.items : [];
  const seen = new Set();
  const deals = [];
  for (const item of items) {
    const id = Number(item?.deal_id);
    if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    deals.push({ id: String(id), name: item.venture || null, sector: item.sector || null, canOpen: !!item.can_open });
  }
  return { deals: deals.slice(0, FIT_LIMIT), total: deals.length };
}

/** A seat invite's refusal → the sentence Team seats shows; never the raw server text. */
export function inviteRefusal(error) {
  const code = error?.code || error?.data?.error || null;
  if (code === 'forbidden' || error?.status === 403) return 'Ask the account owner to add seats.';
  if (code === 'investor_tier_required' || error?.status === 402) return 'Colleague seats come with the Institutional plan.';
  if (code === 'invalid_email') return 'Enter a valid email address.';
  if (code === 'seat_cap_exceeded') return 'All seats are in use. Revoke one to invite someone new.';
  if (code === 'already_invited') return 'This address already has a seat on your plan.';
  return 'The invite could not be created. Try again.';
}
