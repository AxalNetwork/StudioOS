/**
 * D4842 (#4842) — Audience fit in business language (Offers v2, boards OF-04 and OF04b).
 *
 * The store is unchanged: `partner_fit_rules` rows of four kinds (`best_fit`,
 * `budget_floor`, `sector_declined`, `capability_absent`), each with `value`
 * or `floor_cents`, `statement`, `referred_to`, and on a profile a `signal`
 * (`GET /api/partner-offers/fit-rules`). This file says each row the way the
 * canvas does, Great fit or Not a fit, and words the create sheet's questions
 * for the kind being written. It holds no React, so a test reads it directly.
 *
 * NOTHING HERE SAYS A RULE DECLINES ANYONE. Pipeline · Leads reads the rules in
 * use to rank and explain leads (`enforcement: 'score_and_rank'`,
 * `auto_decline: false`), so the copy says rank and explain, never reject.
 */

export const FIT_KINDS = Object.freeze([
  ['best_fit', 'Great fit', 'A kind of client your firm is for.'],
  ['budget_floor', 'Below a minimum engagement', 'The smallest engagement worth starting.'],
  ['sector_declined', 'A sector you decline', 'Work the firm turns down.'],
  ['capability_absent', 'Something you do not do', 'A capability the firm does not offer, said plainly.'],
]);
const KIND_WORD = Object.fromEntries(FIT_KINDS.map(([k, w]) => [k, w]));

/**
 * A profile's strength, in the stored words. OF04b draws Strong, Good and
 * Possible; Pipeline's chips and its scoring receipts use Best fit, Qualified
 * and Weak intent, so this screen keeps those words and the two never disagree.
 */
export const FIT_STRENGTHS = Object.freeze([
  ['best_fit', 'Best fit'],
  ['qualified', 'Qualified'],
  ['weak_intent', 'Weak intent'],
]);
const STRENGTH_WORD = Object.fromEntries(FIT_STRENGTHS);

/** One table row (OF-04), from one stored rule. `money` formats cents. */
export function fitRuleRow(rule, money) {
  const isProfile = rule?.kind === 'best_fit';
  const floor = rule?.kind === 'budget_floor';
  let who = null;
  if (floor) who = rule.floor_cents != null ? `Projects below ${money(rule.floor_cents)}` : null;
  else who = String(rule?.value || '').trim() || null;
  return {
    rule: isProfile ? 'Great fit' : 'Not a fit',
    kind: isProfile ? null : (KIND_WORD[rule?.kind] || rule?.kind || null),
    who,
    strength: isProfile ? (STRENGTH_WORD[rule.signal] || null) : null,
    says: String(rule?.statement || '').trim() || null,
    pointTo: String(rule?.referred_to || '').trim() || null,
    inUse: rule?.is_active !== false && rule?.is_active !== 0,
    // OF-04: a rule with nothing to say is the one row whose action is the primary one.
    needsReply: !String(rule?.statement || '').trim(),
  };
}

/**
 * The create sheet's questions for one kind (OF04b). A profile asks who is a
 * great fit and what to say to them; an exclusion asks who is not a fit and
 * what to say when someone is not.
 */
export function fitSheetCopy(kind) {
  if (kind === 'best_fit') {
    return {
      title: 'Who is a great fit?',
      who: 'Client type or sector',
      says: 'What should we say to them?',
      saysHint: 'Shown beside a lead that fits, so you know why it ranked well.',
    };
  }
  return {
    title: 'Who isn’t a fit?',
    who: kind === 'budget_floor' ? 'Minimum engagement' : kind === 'sector_declined' ? 'Sector you decline' : 'What you do not do',
    says: 'When someone isn’t a fit, what should we say?',
    saysHint: 'Pipeline quotes this so a pass carries a reason. Without it a pass says nothing.',
  };
}
