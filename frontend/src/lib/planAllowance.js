// D783 (#2124) — the words for a plan's AI allowance, everywhere they are
// drawn: the plan cards on /pricing/products (D786), the rail's Usage box, the usage
// card and /account/usage. Pure, so `frontend/test/plan_allowance_d783.test.mjs`
// holds each one.
//
// A plan includes 25% of its price as AI allowance each month; no plan means
// none, and every run uses top-up tokens. There is no daily limit for members:
// `GET /api/ai-budget/me` says so with `daily_capped: false`.
import { microMoney } from './aiTokens.js';

export const NO_PLAN_LINE = 'No plan: every run uses your tokens.';

const micro = (n) => Number.isSafeInteger(n) && n >= 0;
const percent = (share) => (typeof share === 'number' && share > 0 && share <= 1 ? `${Math.round(share * 100)}%` : null);

/**
 * "Includes $19.75 of AI each month: 25% of the price. Past it, runs use your
 * tokens." The no-plan line at $0. Null when the figure is not readable, so the
 * caller says Unreadable and never "$0.00".
 */
export function planAllowanceLine(allowance) {
  if (!allowance || !micro(allowance.monthly_microusd)) return null;
  if (allowance.monthly_microusd === 0) return NO_PLAN_LINE;
  const share = percent(allowance.share);
  if (!share) return null;
  return `Includes ${microMoney(allowance.monthly_microusd)} of AI each month: ${share} of the price. Past it, runs use your tokens.`;
}

/** Whether a budget read sets a daily limit. Only the admin licence still has one; a read from before D783 has no flag and keeps its day. */
export const dayCapped = (b) => !!b && b.daily_capped !== false;

/** A member with no paid plan: no day cap and nothing included this month. */
export const noPlan = (b) => !!b && b.daily_capped === false && b.monthly_microusd === 0;
