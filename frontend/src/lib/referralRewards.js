/**
 * D965 (#2798) — the referral rewards paid in perk credits, in words. Pure.
 *
 * The Worker names each rule, the status that pays it and its amount
 * (`GET /api/refer-earn/admin/rewards`, and each category's `rewards` on
 * `GET /api/refer-earn/overview`). Every amount comes from that read, set by
 * HQ in Credit rules: none is written here, and no line promises credits
 * while its rule is off.
 */

export const REWARD_CATEGORIES = Object.freeze([
  { key: 'startup', name: 'Startup / founder' },
  { key: 'customer', name: 'Platform user' },
  { key: 'strategic', name: 'Strategic & capital' },
]);

export const CASE_BY_CASE = 'Agreed case by case';
export const RULE_OFF = 'HQ has switched this reward off.';
export const RULE_MISSING = 'No rule is stored for this reward, so it pays nothing.';
export const CARD_FOOT = 'Credits are spent on Perks. HQ sets the rewards.';
export const SETTLED_OFF_PLATFORM = 'The count includes referrals whose reward was settled off the platform, so it is not the number of perk-credit rewards.';
export const PAID_HQ_ONLY = 'HQ reads these figures.';

const nf = (n) => Number(n).toLocaleString('en-US');
export const credits = (n) => `${nf(n)} credit${Number(n) === 1 ? '' : 's'}`;

/**
 * The Rewards card's rows (PG9), one per category, from the rules read.
 * Each rule is a line: its credits and when, "Off" with its reason, or
 * "Not recorded" when no row holds it. Strategic is agreed case by case.
 */
export function rewardRows(rules) {
  const list = Array.isArray(rules) ? rules : [];
  return REWARD_CATEGORIES.map((c) => {
    const mine = list.filter((r) => r.category === c.key);
    if (!mine.length) return { key: c.key, name: c.name, lines: [{ key: 'case', text: CASE_BY_CASE, tone: 'muted' }] };
    return {
      key: c.key,
      name: c.name,
      lines: mine.map((r) => {
        if (r.credits === null || r.credits === undefined) return { key: r.key, text: `Not recorded ${r.when}`, reason: RULE_MISSING, tone: 'muted' };
        if (!r.active) return { key: r.key, text: `Off ${r.when}`, reason: RULE_OFF, tone: 'muted' };
        return { key: r.key, text: `${credits(r.credits)} ${r.when}`, tone: 'ink' };
      }),
    };
  });
}

/**
 * The Rewards issued tile's second figure: credits paid, for a Super Admin.
 * An Admin's read carries `paid: null`, which is "Not read here yet", never 0.
 */
export function paidFigure(read) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'error') return { state: 'unreadable' };
  const paid = read.data?.paid;
  if (paid === null || paid === undefined) return { state: 'hq', word: 'Not read here yet', reason: PAID_HQ_ONLY };
  return { state: 'ready', text: `${credits(paid.credits)} paid` };
}

/** What a save paid, in the Queue's result line. Null when the move paid no rule. */
export function rewardSaveLine(reward) {
  if (!reward) return null;
  if (reward.paid) {
    return reward.credits === null || reward.credits === undefined
      ? 'Perk credits were paid to the referrer.'
      : `${credits(reward.credits)} paid to the referrer.`;
  }
  if (reward.code === 'rule_inactive') return 'No credits paid: HQ has switched this reward off.';
  if (reward.code === 'not_eligible') return 'No credits paid: partner and admin accounts do not earn perk credits.';
  return 'No credits paid.';
}

/**
 * The member page's reward matrix, from the overview's categories. A
 * category with a rule on reads "Perk credits" and the Worker's reward line;
 * one with none on says so; strategic is case by case. With no overview read,
 * nothing is promised.
 */
export function memberRewardMatrix(categories) {
  const byKey = new Map((Array.isArray(categories) ? categories : []).map((c) => [c.key, c]));
  return REWARD_CATEGORIES.map((c) => {
    const cat = byKey.get(c.key);
    if (c.key === 'strategic') {
      return { cat: 'Strategic & capital', model: 'Invite-only / custom', modelTone: 'amber', note: 'Terms negotiated directly, not published — case by case.' };
    }
    if (!cat || !Array.isArray(cat.rewards)) {
      return { cat: c.name, model: 'Not read', modelTone: 'grey', note: cat?.reward || 'The reward could not be read. Reload the page to try again.' };
    }
    if (!cat.rewards.length) return { cat: c.name, model: 'No perk credits now', modelTone: 'grey', note: cat.reward };
    return { cat: c.name, model: 'Perk credits', modelTone: 'green', note: cat.reward };
  });
}
