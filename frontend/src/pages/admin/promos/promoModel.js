/**
 * D1270 (#2381) — HQ › Platform › Promo codes, from the owner's canvas "Promo
 * codes" (PRM1–PRM13): Codes and Usage as addresses, one code's drawer at
 * `/admin/platform/promo-codes/:id`, the filters in the address, the state
 * words, and the words of every block no read carries yet. Pure, so
 * `frontend/test/promo_codes_d1270.test.mjs` holds each rule.
 *
 * WHAT IS READ TODAY. `GET /api/admin/promos` (every row, no paging) with
 * `active`, `expires_at`, `times_redeemed`, `max_redemptions`. Paused and ended
 * are not told apart (both leave `active = 0`), subscription redemptions are
 * never mirrored, and there is no usage, history or plan scope, so those blocks
 * wait (D1270 §2).
 */

export const BASE = '/admin/platform/promo-codes';
export const USAGE = `${BASE}/usage`;

export const TITLE = 'Promo codes';
export const PAGE_LINE = 'The codes members can use at checkout, and what each one takes off.';

/** The canvas's states. `paused` and `ended` are recorded facts from part 2; until then a code switched off is `off`. */
export const STATE_WORD = Object.freeze({
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
  expired: 'Expired',
  at_cap: 'At its cap',
  off: 'Switched off',
});

/**
 * A row's state from today's mirror, in `promoState`'s order (`wk/services/promos.ts`):
 * switched off, then expired, then at its cap, then active.
 */
export function stateOf(p = {}, now = Date.now()) {
  if (p.ended_at) return 'ended';
  if (p.paused_at) return 'paused';
  if (!Number(p.active)) return 'off';
  if (p.expires_at && Date.parse(p.expires_at) <= now) return 'expired';
  if (p.max_redemptions != null && Number(p.times_redeemed ?? 0) >= Number(p.max_redemptions)) return 'at_cap';
  return 'active';
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const STATES = Object.keys(STATE_WORD);
const APPLIES = ['all', 'plans', 'products'];

/** What the address names: the tab, one code's drawer, and the filters (`?state=`, `?applies=`). */
export function viewOf(pathname = '', search = '') {
  const rest = String(pathname).startsWith(BASE) ? String(pathname).slice(BASE.length).replace(/^\/+|\/+$/g, '') : '';
  const q = new URLSearchParams(String(search));
  const filters = {
    state: STATES.includes(q.get('state')) ? q.get('state') : null,
    applies: APPLIES.includes(q.get('applies')) ? q.get('applies') : null,
  };
  if (rest === 'usage') return { tab: 'usage', id: null, filters };
  if (rest && ID.test(rest) && !rest.includes('/')) return { tab: 'codes', id: rest, filters };
  return { tab: 'codes', id: null, filters };
}

export function codesHref({ state = null, applies = null } = {}) {
  const q = new URLSearchParams();
  if (STATES.includes(state)) q.set('state', state);
  if (APPLIES.includes(applies)) q.set('applies', applies);
  const s = q.toString();
  return s ? `${BASE}?${s}` : BASE;
}
export const codeHref = (id) => (ID.test(String(id ?? '')) ? `${BASE}/${id}` : BASE);

export const NOT_YET = 'Not read here yet';

/** What the canvas draws that no read carries yet. Never a zero, never "none". */
export const WAITS = Object.freeze({
  usage: 'Redemptions by week and source, the discount given per currency, top codes and codes near their end are not read here yet (part 4).',
  drawer: 'This code’s history, its plan and interval scope, its name and note, and who paused or ended it are not stored yet (parts 2 and 4).',
  redeemed: 'Redeemed counts what the platform mirrors: subscription redemptions Stripe counts are not added here yet, so the figure is a lower bound (part 4).',
  scope: 'Plans and monthly or yearly scope, once per member and first purchase only, are not stored yet (part 3).',
});
