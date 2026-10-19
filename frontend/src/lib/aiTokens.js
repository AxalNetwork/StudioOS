// D755 (#1916, CR4 PR 1) — the AI top-up as every screen reads it: one state
// model, one sentence for "nothing is on sale", one path for Add tokens, and
// the money formatters the rail, the Assist card and the Usage page share.
//
// It reads both answers of `GET /api/ai-budget/top-up`: D750's
// `{configured, state, product}` and CR2's `{state, packs, on_hold, latest}`
// (#1919). A failed read is `unreadable`; a configuration HQ must fix is
// `not_ready`, which a retry cannot change.

/** "Nothing is on sale" (D750 decision 3), in one place. */
export const TOPUP_UNAVAILABLE = "Top-up isn't available yet.";
/** The same sentence where the page also says what runs do instead. */
export const TOPUP_UNAVAILABLE_RUNS = `${TOPUP_UNAVAILABLE} Runs use your included allowance only.`;
/** AMP's tokens line (account_phone_d700 pins it to the canvas). */
export const TOKENS_LINE = '$1 of tokens buys $1 of AI use. Tokens never expire.';
/** Where every Add tokens link goes. PR 2 moves it to `/plans-and-pricing#token-packs`. */
export const ADD_TOKENS_PATH = '/checkout?ai_topup=1';
/** The pricing page's Token packs section, where the retired `/checkout?ai_topup=1` now lands. */
export const TOKEN_PACKS_PATH = '/plans-and-pricing#token-packs';

const integer = (n) => Number.isSafeInteger(n) && n >= 0;
/** A price the checkout can sell: a Stripe price ID, USD, a whole positive amount in cents. */
export function sellableLine(line) {
  return !!line && typeof line === 'object' && /^price_[A-Za-z0-9]+$/.test(String(line.price_id))
    && line.currency === 'usd' && integer(line.unit_amount) && line.unit_amount > 0;
}

/**
 * The line Add tokens puts in the cart: D750's single product, else the first
 * pack on sale. Null when there is none.
 */
export function topUpLine(data) {
  if (sellableLine(data?.product)) return data.product;
  const packs = Array.isArray(data?.packs) ? data.packs : [];
  return packs.find(sellableLine) || null;
}

/**
 * `loading`, `unreadable`, `not_ready` or `ready`.
 * `reading` is `{ loading, error, data }`: `data` is the route's answer.
 */
export function aiTokenState(reading) {
  const { loading = false, error = false, data } = reading || {};
  if (loading) return 'loading';
  if (error || !data || typeof data !== 'object') return 'unreadable';
  // CR2 answers `unset`; D750 answers `{configured:false}`. Both: nothing is on sale.
  if (data.state === 'unset' || data.configured === false || data.state === 'not_ready') return 'not_ready';
  if (data.state !== 'ready') return 'unreadable';
  return topUpLine(data) ? 'ready' : 'unreadable';
}

const PURCHASE_STATES = new Set(['waiting', 'credited', 'overdue', 'refunded', 'disputed']);
const HOUR_MS = 60 * 60 * 1000;

/**
 * A purchase in the last 24 hours (CR2's `latest`): `waiting`, `credited`,
 * `overdue` (paid more than an hour ago and not credited), `refunded`,
 * `disputed`, or null. Null until CR2 sends `latest`.
 */
export function purchaseState(latest, now = Date.now()) {
  if (!latest || typeof latest !== 'object' || !PURCHASE_STATES.has(latest.state)) return null;
  if (latest.state === 'waiting') {
    const at = Date.parse(String(latest.at ?? '').replace(' ', 'T'));
    if (Number.isFinite(at) && now - at > HOUR_MS) return 'overdue';
  }
  return latest.state;
}

/** "$25 of tokens" from a pack's face value in cents; null for anything else. */
export function packLabel(faceCents) {
  if (!integer(faceCents) || faceCents === 0) return null;
  const dollars = faceCents / 100;
  const face = Number.isInteger(dollars) ? dollars.toLocaleString('en-US') : dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${face} of tokens`;
}

/** Every micro-dollar the figure has: "$0.029536". */
export function microMoney(n) {
  const micro = BigInt(n);
  const fraction = (micro % 1000000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `$${(micro / 1000000n).toLocaleString('en-US')}.${fraction}`;
}

/**
 * D750 (#1841) — a spend to the cent, for the rail and the Assist card: rounded
 * half up, and "<$0.01" for a spend above zero that rounds to nothing. The
 * exact figure stays on `/account/usage` and in the element's `title`.
 */
export function usageMoney(n) {
  const micro = BigInt(n);
  if (micro > 0n && micro < 5000n) return '<$0.01';
  const cents = (micro + 5000n) / 10000n;
  return `$${(cents / 100n).toLocaleString('en-US')}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/**
 * What runs do past the allowance (#1916 step 5): with nothing on sale
 * (`aiTokenState` is `not_ready`) they wait for the reset rather than "use
 * your top-up balance". A failed read is not knowledge that nothing is on sale,
 * so only `nothingOnSale` changes the line.
 */
export function pastAllowanceLine(nothingOnSale, { untilThen = false } = {}) {
  return nothingOnSale ? 'Runs wait until your allowance resets.'
    : `Runs use your top-up balance${untilThen ? ' until then' : ''}.`;
}
