// D553 (#1146) — an LP's type and the comms log, as the fund pages show them.
// The sets mirror `cloudflare-worker/src/services/fundLpComms.ts` (migration
// 387's CHECKs); `fund_lp_comms_d553.test.ts` fails if they drift apart.

export const LP_TYPE_LABELS = {
  individual: 'Individual',
  family_office: 'Family office',
  institution: 'Institution',
  fund_of_funds: 'Fund of funds',
  corporate: 'Corporate',
};
export const LP_TYPES = Object.keys(LP_TYPE_LABELS);

export const COMM_KIND_LABELS = {
  call_reminder: 'Call reminder',
  call_notice: 'Call notice',
  update: 'Update',
  other: 'Other',
};

/** The filter key for an LP with no type; it reads "Not recorded", never a guessed type. */
export const UNTYPED = 'untyped';

/** An LP's type label, or null when none is recorded (the page prints "Not recorded"). */
export const lpTypeLabel = (lp) => (lp?.lp_type && LP_TYPE_LABELS[lp.lp_type]) || null;

/**
 * The type chips for the register: one per type held by a row, plus
 * "Type not recorded" when any row has none. An account with no typed LP
 * shows only the latter, rather than five chips that each match nothing.
 */
export function typeChips(rows) {
  const held = new Set((rows || []).map((r) => r?.lp_type).filter((t) => t && LP_TYPE_LABELS[t]));
  const chips = LP_TYPES.filter((t) => held.has(t)).map((t) => ({ key: t, label: LP_TYPE_LABELS[t] }));
  if ((rows || []).some((r) => !r?.lp_type)) chips.push({ key: UNTYPED, label: 'Type not recorded' });
  return chips;
}

/** Does `row` pass the type chip `key`? */
export const matchesType = (row, key) => (key === UNTYPED ? !row?.lp_type : row?.lp_type === key);

/** The default subject for "Log as sent" on a call line. */
export const reminderSubject = (line) => (line?.call_number != null
  ? `Reminder: capital call ${line.call_number}`
  : 'Reminder: capital call');
