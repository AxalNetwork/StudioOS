/**
 * D1277 (#2482) — Account › Usage › AI tokens at `/account/usage/ai-tokens`,
 * from the owner's canvas "AI tokens" (TOKB1–TOKB13): the page's header, its
 * five cards in the canvas's order, and the words of every block no read
 * carries here yet. Pure, so `frontend/test/ai_tokens_page_d1277.test.mjs`
 * holds each rule.
 *
 * WHAT EXISTS. `GET /api/ai-budget/me` (balance, allowance, holds totals, the
 * review holds) and `GET /api/ai-budget/limit` are built; the price list read
 * and the list of holds in progress are #2482's contract gaps 1 and 2. This
 * page reads nothing yet: Step 1 (#2482, S20) draws Cards 1, 4 and 5 from the
 * reads that exist, Step 2 the rest. One currency: AI tokens, never "credits".
 */

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
  { id: 'limits', title: 'What stops spend' },
  { id: 'run_out', title: 'When tokens run out' },
]);

export const NOT_YET = 'Not read here yet';

/** Why each card draws nothing today. Never a zero, never "none". */
export const WAITS = Object.freeze({
  available: 'Your plan allowance left, your token balance and what runs in progress hold are not read here yet; Usage › Overview shows your balance (#2482 step 1).',
  holds: 'Each hold in progress, what it is for and when it returns are not read here yet: the list of holds is #2482’s contract gap 2 (step 2).',
  prices: 'The price of each operation is not read here yet: the price list read is #2482’s contract gap 1 (step 2). No price is written into this page.',
  limits: 'Your plan’s allowance, your own monthly limit and each API key’s limit are not read here yet; Limits sets your own (#2482 steps 1 and 2).',
  run_out: 'What happens when tokens run out, in Eadwyn, an assistant or a script, is not drawn here yet (#2482 step 1).',
});
