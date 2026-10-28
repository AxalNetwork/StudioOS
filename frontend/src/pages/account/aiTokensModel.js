/**
 * D1277 (#2482) — Account › Usage › AI tokens at `/account/usage/ai-tokens`,
 * from the owner's canvas "AI tokens" (TOKB1–TOKB13): the page's header, its
 * five cards in the canvas's order, and the words of every block no read
 * carries here yet. Pure, so `frontend/test/ai_tokens_page_d1277.test.mjs`
 * holds each rule.
 *
 * WHAT EXISTS. `GET /api/ai-budget/me` (balance, allowance, holds totals, the
 * review holds, HQ's cap and, from D1277 step 1, `ai_paused`) and `GET
 * /api/ai-budget/limit` are built; the price list read and the list of holds
 * in progress are #2482's contract gaps 1 and 2 (#3304, D1278).
 *
 * STEP 1 (#2482) draws Card 1 (Available now), Card 4's plan, own-limit and
 * HQ-cap rows, and Card 5 from those two reads, with the stop states of TOKB3
 * and TOKB4 in the Worker's own words. Step 2 draws Cards 2 and 3 and Card 4's
 * per-key rows. One currency: AI tokens, never "credits".
 */
import { budgetReadable, microUsd, planLabel } from './usageModel';
import { dayText, limitView, nextMonthStart } from './limitsModel';

/** The page's header, from the canvas. */
export const AI_TOKENS_PAGE = Object.freeze({
  title: 'AI tokens',
  sub: 'What you can spend now, what is held, what things cost, and what stops spend.',
});

/** The five cards, in the canvas's order. */
export const CARDS = Object.freeze([
  { id: 'available', title: 'Available now' },
  { id: 'holds', title: 'Held right now' },
  { id: 'prices', title: 'What things cost' },
  { id: 'limits', title: 'Limits that stop spend' },
  { id: 'run_out', title: 'When tokens run out' },
]);

export const NOT_YET = 'Not read here yet';

/** Why each card step 2 draws still draws nothing. Never a zero, never "none". */
export const WAITS = Object.freeze({
  holds: 'Each hold in progress, what it is for and when it returns are not read here yet: the list of holds is #2482’s contract gap 2 (step 2).',
  prices: 'The price of each operation is not read here yet: the price list read is #2482’s contract gap 1 (step 2). No price is written into this page.',
});

/** Card 4's per-key rows wait for step 2: one muted line, never sample rows. */
export const KEYS_WAIT = 'Per API key: being built. Each key’s limit and what it has used this month are read here in step 2.';

/** The page's links, all to pages that exist. */
export const LINKS = Object.freeze({
  cost: '/account/usage/cost', billing: '/account/billing', limits: '/account/usage/limits',
  plans: '/pricing', keys: '/account/builder/keys', // D1315: Builder › API keys
});

/** The Worker's own words for each stop (`aiRouter.ts` `budgetRefusalMessage`, `aiBudget.ts` `AI_PAUSED_MESSAGE`). */
export const WORKER_WORDS = Object.freeze({
  ai_paused: 'AI is paused on this account. Contact support.',
  budget_review: 'An AI run is held for review. New runs can start after it is settled.',
  not_enough: 'The included AI allowance and top-up balance cannot cover this run. Add tokens to continue.',
});

/** Card 5 (TOKB1), from the canvas. */
export const RUN_OUT = Object.freeze([
  { id: 'eadwyn', text: 'Eadwyn stops before it starts and offers Add tokens. Nothing is charged.' },
  { id: 'callers', text: 'An assistant or script gets a ‘not enough AI tokens’ answer. Nothing is charged.' },
  { id: 'holds', text: 'A hold already placed finishes; nothing new starts.' },
]);

export const UNREADABLE_BALANCE = 'Your balance could not be read. That is not the same as none.';
export const FIRST_RULE = 'Runs use your plan’s AI allowance first, then your AI tokens.';
export const SUPPORT_NOTICE = (who) => `You are viewing as ${who || 'this member'}. Adding tokens is not possible in a support session.`;

const isMicro = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * Card 1, from `/ai-budget/me`, or null when the read is not whole (the card
 * says Unreadable, never a part). "Available now" is the allowance left plus
 * the token balance, both already net of holds (a hold is taken when it is
 * placed: the month's spend counts it and the balance drops); what is held is
 * named apart, never added in.
 */
export function availableView(me, now = new Date()) {
  if (!budgetReadable(me)) return null;
  const noAllowance = me.monthly_microusd === 0;
  const left = noAllowance ? 0 : Math.max(0, me.monthly_microusd - me.month_spend_microusd - me.month_reserved_microusd);
  const balance = me.balance_microusd;
  const held = me.month_reserved_microusd + me.topup_reserved_microusd;
  const review = me.held_for_review.reduce((n, r) => n + (isMicro(r?.held_microusd) ? r.held_microusd : 0), 0);
  const available = left + balance;
  // D1363: a Super Admin's AI has no limit; their figures say so, never $1 billion.
  const unlimited = me.unlimited === true;
  const resets = dayText(nextMonthStart(now));
  const heldText = microUsd(held);
  const heldLine = held === 0 ? null : review > 0 && review >= held ? `${heldText} is held for review.` : `${heldText} is held by work in progress.`;
  return {
    noAllowance,
    available: unlimited ? 'No limit' : microUsd(available),
    unlimited,
    availableMicro: available,
    left: noAllowance ? null : unlimited ? 'No limit' : microUsd(left),
    balance: microUsd(balance),
    held: heldText,
    heldMicro: held,
    review: review > 0,
    plan: planLabel(me.licence),
    used: noAllowance ? null : microUsd(me.month_spend_microusd),
    of: noAllowance ? null : unlimited ? 'No limit' : microUsd(me.monthly_microusd),
    resets,
    summary: noAllowance
      ? `Token balance ${microUsd(balance)}. ${heldLine ?? 'Nothing is held right now.'}`
      : unlimited ? `No limit: a Super Admin's AI runs are never refused for the allowance. Token balance ${microUsd(balance)}.`
        : `Plan allowance left ${microUsd(left)} + token balance ${microUsd(balance)}.${heldLine ? ` ${heldLine}` : ''}`,
    srSummary: unlimited ? `No limit: ${microUsd(balance)} tokens${held ? `; ${heldText} held` : ''}.`
      : `${microUsd(available)} available: ${noAllowance ? '' : `${microUsd(left)} allowance and `}${microUsd(balance)} tokens${held ? `; ${heldText} held` : ''}.`,
    // The bar's segments, in the canvas's order and colours; a zero segment is left out, never drawn as a sliver.
    segments: [
      noAllowance || unlimited ? null : { id: 'allowance', label: 'Plan allowance left', value: microUsd(left), micro: left },
      { id: 'balance', label: 'Token balance', value: microUsd(balance), micro: balance },
      held ? { id: 'held', label: review > 0 && review >= held ? 'Held for review' : 'Held', value: heldText, micro: held } : null,
    ].filter((x) => x && x.micro > 0),
  };
}

/**
 * The one stop that applies now, first match wins, in the Worker's order (the
 * hold checks the pause, then a review, then the member's own limit, then the
 * allowance and balance). `addTokens` is true only where tokens would help:
 * never for a pause, a review or a limit (TOKB4).
 */
export function stopState(me, limit, now = new Date()) {
  if (!me) return null;
  if (me.ai_paused === true) return { id: 'ai_paused', text: WORKER_WORDS.ai_paused, sub: 'Adding tokens does not lift a pause.', addTokens: false };
  if (Array.isArray(me.held_for_review) && me.held_for_review.length) return { id: 'budget_review', text: WORKER_WORDS.budget_review, addTokens: false };
  const lv = limit ? limitView(limit) : null;
  if (lv?.set && isMicro(limit.charged_microusd) && limit.charged_microusd >= limit.limit_microusd) {
    return { id: 'spend_limit', text: `You reached your own monthly limit of ${lv.limit}. New AI work waits until ${lv.resets ?? dayText(nextMonthStart(now))}, or raise it in Limits.`, link: 'limits', addTokens: false };
  }
  const v = availableView(me, now);
  if (v && v.availableMicro === 0) {
    return v.noAllowance
      ? { id: 'empty', text: 'Add tokens to use Eadwyn and AI tools.', addTokens: true }
      : { id: 'no_tokens', text: `You have no AI tokens left this month. Eadwyn, assistants and keys that run AI are paused until you add tokens or your allowance resets on ${v.resets}.`, addTokens: true };
  }
  return null;
}

/**
 * Card 4's rows from step 1: the plan's allowance, the member's own monthly
 * limit (`/limit`), and HQ's cap when HQ set one. A read that failed is said,
 * never drawn as no limit.
 */
export function limitRows(me, limit) {
  const plan = !budgetReadable(me) ? { state: 'unreadable' }
    : me.monthly_microusd === 0 ? { state: 'none', text: 'No plan allowance. Your AI runs use AI tokens.' }
      : me.unlimited === true ? { state: 'ok', perMonth: 'No limit', from: 'Super Admin' }
        : { state: 'ok', perMonth: microUsd(me.monthly_microusd), from: planLabel(me.licence) };
  const lv = limit === undefined ? undefined : limit ? limitView(limit) : null;
  const own = lv === undefined ? { state: 'loading' } : !lv ? { state: 'unreadable' }
    : !lv.set ? { state: 'none' } : { state: 'ok', spent: lv.spent, limit: lv.limit, pct: lv.pct };
  const hq = budgetReadable(me) && isMicro(me.member_cap_microusd) ? `${microUsd(me.member_cap_microusd)} a month, set by StudioOS` : null;
  return { plan, own, hq };
}

/** Whether this viewer may buy: never in a support session, an HQ one or a View As (TOKB10). */
export const canBuy = ({ hqSupport, impersonating }) => !hqSupport && !impersonating;
