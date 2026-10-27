/**
 * D1287 (#3370, part 2 of #2452) — the checkout sheet's pack mode, "Add
 * tokens" (canvas CRP2–CRP5, CRP7, CRP8, CRP15, CRP17), as pure rules so
 * `frontend/test/checkout_pack_mode_d1287.test.mjs` holds each one.
 *
 * Every figure is the Worker's:
 *   - the packs, their offers and the hold from `GET /api/ai-budget/top-up`;
 *   - the balance from `GET /api/ai-budget/me`;
 *   - the order's totals from `POST /api/orders/intent`, sent one pack line;
 *   - the landing from `GET /api/orders/:ref`'s `ai_topup` (`purchaseState`).
 * Only the verified webhook credits a pack (D755 §6): "Tokens added." is drawn
 * on `credited` and nothing else. The one sum drawn here is the balance line's
 * "before → after", which the canvas asks for and which the ledger, not this
 * page, decides.
 */
import { TOKENS_LINE, purchaseState, sellableLine } from '../../lib/aiTokens';
import { moneyOf } from './checkoutModel';

export const PACK_TITLE = 'Add tokens';
export const HISTORY_TITLE = 'History';
export const PACK_RATE = TOKENS_LINE;
export const PACK_PROMO = 'Promo codes don’t apply to token packs. Offers show on the pack.';
export const HISTORY_EMPTY = 'No top-ups yet.';
export const HISTORY_EMPTY_LINE = 'Packs you buy, bonuses and refunds will be listed here.';
export const HISTORY_MORE = 'See all on Usage ›';
export const RUNS_TOGGLE = 'Show AI runs';
export const PACKS_UNREADABLE = 'Token packs couldn’t be read just now.';
export const NOTHING_ON_SALE = 'Top-up isn’t available yet.';
export const PICK_ANOTHER = 'Choose another pack to continue.';

const usdWhole = (cents) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 });
const isMicro = (n) => Number.isSafeInteger(n) && n >= 0;

/** "$1.20" from micro-dollars, to the cent; null for anything that is not a figure. */
export function centsOfMicro(n) {
  if (!isMicro(n)) return null;
  const cents = Math.floor(n / 10_000);
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

/** "27 Oct": an offer's end, in UTC as HQ set it; null when it is not a date. */
function offerDay(iso) {
  const d = new Date(String(iso ?? ''));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * CRP2, CRP6: the packs on sale as radio rows, in HQ's order (the Worker's).
 * A pack the checkout cannot sell is left out. `key` is the pack's uid, or its
 * price for the environment fallback, which has none.
 */
export function packRows(topUp) {
  const packs = Array.isArray(topUp?.packs) ? topUp.packs : [];
  return packs.filter(sellableLine).map((p) => {
    const bonus = isMicro(p.bonus_microusd) && p.bonus_microusd > 0 && isMicro(p.credit_microusd) && p.credit_microusd > 0
      ? Math.round((100 * p.bonus_microusd) / p.credit_microusd) : 0;
    const until = bonus && p.offer_ends_at ? offerDay(p.offer_ends_at) : null;
    const offers = [bonus ? `+${bonus}% bonus${until ? ` until ${until}` : ''}` : null, p.first_purchase_only === true ? 'First purchase only' : null].filter(Boolean);
    return {
      key: String(p.uid ?? p.price_id),
      uid: p.uid ?? null,
      priceId: p.price_id,
      cents: p.unit_amount,
      currency: p.currency,
      label: `${usdWhole(p.unit_amount)} of AI tokens`,
      price: moneyOf(p.unit_amount, p.currency),
      creditMicro: isMicro(p.credit_microusd) ? p.credit_microusd : null,
      bonusMicro: isMicro(p.bonus_microusd) ? p.bonus_microusd : 0,
      offers,
    };
  });
}

/** The sheet's state for the pack read: reading, couldn't be read, nothing on sale, or the rows. */
export function packsView(read) {
  if (!read || read.status === 'loading') return { status: 'loading', rows: [] };
  if (read.status !== 'ready') return { status: 'unreadable', rows: [] };
  const rows = packRows(read.data);
  return { status: rows.length ? 'ready' : 'none', rows, onHold: read.data?.on_hold === true };
}

/** The pack a caller asked for (Models' Buy), else the first one. */
export function startingPack(rows, wanted) {
  if (!rows.length) return null;
  return rows.find((r) => r.key === String(wanted) || (wanted && r.priceId === wanted))?.key ?? rows[0].key;
}

/**
 * CRP2: "Your balance: $3.40 → $28.40 once the payment is confirmed." The
 * after-figure adds the pack's tokens and its bonus to `/me`'s balance, for the
 * line only. With no balance read it names what the pack adds instead.
 */
export function balanceLine(balanceMicro, pack) {
  if (!pack) return null;
  const adds = (pack.creditMicro ?? 0) + (pack.bonusMicro ?? 0);
  if (!isMicro(balanceMicro) || pack.creditMicro == null) {
    return `Your balance couldn’t be read just now. This pack adds ${centsOfMicro(adds) ?? pack.price} of AI tokens once the payment is confirmed.`;
  }
  return `Your balance: ${centsOfMicro(balanceMicro)} → ${centsOfMicro(balanceMicro + adds)} once the payment is confirmed.`;
}

/**
 * CRP2's totals: the pack, its bonus, VAT where it applies, and Due today.
 * Before Pay the order does not exist, so VAT says when it is worked out and
 * Due today is the pack's price (a pack is sold at face value, D755 §5). Once
 * the intent answers, VAT and Due today are its own figures.
 */
export function packTotals(pack, intent = null) {
  if (!pack) return [];
  const rows = [{ key: 'pack', label: pack.label, value: pack.price }];
  if (pack.bonusMicro > 0) rows.push({ key: 'bonus', label: 'Bonus tokens', value: `+${centsOfMicro(pack.bonusMicro)}` });
  const vat = intent ? moneyOf(intent.vat_cents, intent.currency) : null;
  rows.push({ key: 'vat', label: 'VAT, where it applies', value: vat, reason: vat ? null : 'Worked out when you pay' });
  const due = intent ? moneyOf(intent.total, intent.currency) : pack.price;
  rows.push({ key: 'due', label: 'Due today', value: due, strong: true });
  return rows;
}

/** The one line the intent is sent: exactly one pack, once. */
export const intentBody = (pack, nonce) => ({ items: [{ price_id: pack.priceId, quantity: 1 }], nonce });

/**
 * CRP5: a pack rule, by the Worker's code (D755 §5, D790). Shown on the pack's
 * row with Pay disabled. The Worker's own sentence wins when it sends one
 * (D258); these are the canvas's for the codes that come without (#2452's
 * D1289 gives each a sentence on the Worker).
 */
export const PACK_RULES = Object.freeze({
  token_pack_first_purchase_only: 'This pack is for your first token purchase, and you have bought tokens before. Choose another pack.',
  token_pack_daily_limit: 'You’ve reached today’s limit of pack orders. Try again tomorrow.',
  token_balance_ceiling: 'This pack would take your balance over the most an account can hold. Choose a smaller pack.',
  token_packs_on_hold: 'Buying tokens is paused on this account while a payment is reviewed. Contact support.',
  token_pack_not_on_sale: 'This pack is no longer on sale. Choose another pack.',
  token_pack_alone: 'A token pack is bought on its own. Choose one pack.',
  promo_not_for_token_packs: PACK_PROMO,
  support_session_refused: 'A support session cannot buy AI tokens.',
});
const sentence = (m) => (typeof m === 'string' && m.trim() && !/^[a-z0-9_]+$/.test(m.trim()) ? m.trim() : null);

/** A refusal of the intent: a pack rule (on the row) or null, for D1053's refusal words. */
export function packRule(err) {
  const code = String(err?.code || '');
  if (!Object.hasOwn(PACK_RULES, code)) return null;
  return { code, line: sentence(err?.message) ?? PACK_RULES[code] };
}

/** The hold `/top-up` reports, as the same rule, before anything is sent. */
export const holdRule = (onHold) => (onHold ? { code: 'token_packs_on_hold', line: PACK_RULES.token_packs_on_hold } : null);

export const HOUR_MS = 60 * 60 * 1000;

/**
 * CRP3, CRP4: what the order says after Pay. `credited` is Accepted; `waiting`
 * is landing; `overdue` (paid over an hour ago, not credited) has no retry;
 * refunded and disputed say so. An order that does not answer, or answers
 * without a top-up, is not yet known: never Accepted.
 */
export function landingView(order, now = Date.now()) {
  const topup = order?.ai_topup;
  if (!topup || topup.state === 'unreadable') return { key: 'unknown' };
  const state = purchaseState(topup, now);
  if (!state) return { key: 'unknown' };
  const amount = centsOfMicro(topup.amount_microusd) ?? centsOfMicro(topup.credit_microusd);
  if (state === 'credited') {
    return {
      key: 'credited',
      title: 'Tokens added.',
      balanceMicro: isMicro(topup.balance_microusd) ? topup.balance_microusd : null,
      bonus: isMicro(topup.bonus_microusd) && topup.bonus_microusd > 0 ? `+${centsOfMicro(topup.bonus_microusd)} bonus added` : null,
      amount,
    };
  }
  if (state === 'waiting') return { key: 'waiting', title: 'Payment received.', line: `Adding ${amount ?? 'your tokens'} to your balance…`, sub: 'This usually takes a few seconds.' };
  if (state === 'overdue') {
    return {
      key: 'overdue',
      title: 'Your tokens are on their way.',
      line: `Your payment for ${order?.order_ref || 'this order'} is recorded, but the tokens are not in your balance yet. We’re on it.`,
      sub: 'You won’t be charged again for this order.',
    };
  }
  if (state === 'refunded') return { key: 'refunded', title: 'Tokens refunded.', line: 'This order was refunded, so its tokens left your balance. See Usage for the details.' };
  return { key: 'disputed', title: 'Payment disputed.', line: 'This payment is disputed with your bank. Its tokens are held until the dispute closes.' };
}

/** Whether the landing keeps reading the order: until credited, refunded or disputed. */
export const keepsReading = (view) => view.key === 'unknown' || view.key === 'waiting' || view.key === 'overdue';

/**
 * CRP3's balance counting up from old to new: `n` frames, the last exactly the
 * new figure. With reduced motion, a hidden tab or no old figure, one frame.
 */
export function countFrames(fromMicro, toMicro, n = 20, { still = false } = {}) {
  if (!isMicro(toMicro)) return [];
  if (still || !isMicro(fromMicro) || fromMicro >= toMicro || n < 2) return [centsOfMicro(toMicro)];
  const out = [];
  for (let i = 1; i <= n; i += 1) out.push(centsOfMicro(i === n ? toMicro : Math.floor(fromMicro + ((toMicro - fromMicro) * i) / n)));
  return out;
}

/** CRP3's buttons: back to where Add tokens was opened ("Back to Models" by default). */
export const backLabel = (from) => `Back to ${typeof from === 'string' && from.trim() ? from.trim() : 'Models'}`;

const DISABLED = Object.freeze({
  card_declined: 'Auto-reload is off: your card was declined. Update it on Billing.',
  authentication_required: 'Auto-reload is off: your bank asked to confirm the payment. Update your card on Billing.',
  card_unusable: 'Auto-reload is off: your saved card could not be charged. Update it on Billing.',
  pack_unavailable: 'Auto-reload is off: its token pack is no longer sold. Choose another pack on Billing.',
});

/**
 * CRP7: auto-reload's state, read only (D794: it is never set here). Off, on,
 * or turned off by a decline, each linking to Billing. The read asks for a
 * fresh authenticator code, which the sheet does not ask for; then the line
 * says the setting is on Billing.
 */
export function autoReloadView(read, rows = []) {
  if (!read || read.status === 'loading') return { key: 'loading' };
  if (read.status !== 'ready' || !read.data || typeof read.data !== 'object') {
    return { key: 'elsewhere', line: 'Auto-reload’s setting is shown on Billing.', link: 'Open Billing ›' };
  }
  const d = read.data;
  if (d.enabled === true) {
    const pack = rows.find((r) => r.uid && r.uid === d.pack_uid);
    const amount = pack ? pack.price : 'a token pack';
    const below = Number.isFinite(d.threshold_usd) ? ` when your balance drops below ${usdWhole(Math.round(d.threshold_usd * 100))}` : '';
    const card = d.card?.last4 ? ` Card: ${d.card.brand ? d.card.brand.charAt(0).toUpperCase() + d.card.brand.slice(1) : 'Card'} ending ${d.card.last4}.` : '';
    return { key: 'on', line: `Auto-reload is on: ${amount}${below}.${card}`, link: 'Change on Billing ›' };
  }
  if (d.disabled_reason && Object.hasOwn(DISABLED, d.disabled_reason)) return { key: 'declined', line: DISABLED[d.disabled_reason], link: 'Open Billing ›' };
  return { key: 'off', line: 'Auto-reload is off. Turn it on to buy tokens automatically when your balance runs low.', link: 'Set up on Billing ›' };
}

