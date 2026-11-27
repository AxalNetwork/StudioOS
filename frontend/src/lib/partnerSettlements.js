/**
 * D713 (#1778): the words for a partner-deal settlement, shared by the
 * member's list on Earnings and the Admin's desk on Contracts › Partner deals.
 * The keys are the Worker's (`routes/partner_settlements.ts`); an unknown one
 * is said as unknown, never guessed. A settlement is an obligation under a
 * signed deal: nothing here or in the Worker moves money.
 */

export const SETTLEMENT_KINDS = [
  { k: 'revenue_share', label: 'Revenue share' },
  { k: 'capital', label: 'Capital' },
  { k: 'equity_for_services', label: 'Equity for services' },
  { k: 'other', label: 'Other' },
];

export const SETTLEMENT_DIRECTIONS = [
  { k: 'to_member', label: 'Management pays the partner' },
  { k: 'from_member', label: 'The partner pays Management' },
];

export const SETTLEMENT_STATES = {
  draft: { label: 'Draft', tone: 'gray' },
  issued: { label: 'Issued', tone: 'amber' },
  matched: { label: 'Matched', tone: 'green' },
  void: { label: 'Void', tone: 'gray' },
};

const labelIn = (list, k, fallback) => list.find((x) => x.k === k)?.label || fallback;
export const settlementKindLabel = (k) => labelIn(SETTLEMENT_KINDS, k, 'Unknown kind');
export const settlementDirectionLabel = (k) => labelIn(SETTLEMENT_DIRECTIONS, k, 'Unknown direction');
export const settlementStateLabel = (k) => (Object.hasOwn(SETTLEMENT_STATES, k) ? SETTLEMENT_STATES[k].label : 'Unknown state');

/** The member's own words for a direction: who pays whom, from their side. */
export function memberDirection(k) {
  if (k === 'to_member') return 'Owed to you';
  if (k === 'from_member') return 'Owed by you';
  return 'Unknown direction';
}

/** Dollars typed by an Admin → integer cents, or null (text-parsed, never a float). */
export function settlementCents(raw) {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(raw ?? '').trim().replace(/^\$/, '').replace(/,/g, ''));
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/**
 * A draft form → the Worker's body, or the first reason it would be refused,
 * checked here too so the Admin sees it before sending. The Worker checks it
 * again and its answer wins.
 */
export function settlementDraft(form) {
  const f = form || {};
  const deal = Number(f.partner_deal_id);
  if (!Number.isSafeInteger(deal) || deal <= 0) return { error: 'Choose the partner deal.' };
  if (!SETTLEMENT_KINDS.some((x) => x.k === f.kind)) return { error: 'Choose a settlement kind.' };
  if (!SETTLEMENT_DIRECTIONS.some((x) => x.k === f.direction)) return { error: 'Choose a direction.' };
  const amount_cents = settlementCents(f.amount);
  if (amount_cents === null) return { error: 'Enter a positive amount in dollars, at most two decimals.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.due_on || ''))) return { error: 'Choose a due date.' };
  const memo = String(f.memo ?? '').trim();
  if (memo.length > 2000) return { error: 'The memo is at most 2,000 characters.' };
  if (/\d{8,}/.test(memo)) return { error: 'The memo cannot hold a run of eight digits: no account or routing number belongs here.' };
  return { body: { partner_deal_id: deal, kind: f.kind, direction: f.direction, amount_cents, due_on: f.due_on, memo: memo || null } };
}
