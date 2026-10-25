/**
 * D1013 (#2832, part 5 of Payments #2386) — the dialogs' words and rules,
 * pure, so `node --test` loads them alone.
 *
 * Every rule here repeats one the Worker enforces, so a dialog can say what is
 * wrong before it is sent; the Worker's refusal stays the authority:
 *   - a product's metadata: `validateProductMetadata` (services/catalog.ts);
 *   - a plan's family and level: `aiCredits.planOf`;
 *   - a reason: `paymentChangeReason` (1 to 500 characters, D1009), and at
 *     least 10 for a price change (D1010);
 *   - the allowance a price gives: 25% of a USD monthly price, a yearly
 *     price's ÷ 12, rounded down (D783, D1010 §1).
 */
import { PLAN_CARDS } from '../../../lib/sitePricing';

export const REASON_MAX = 500;
export const CHANGE_REASON_MIN = 10;
export const RECORDED = 'It is recorded in the change log.';
export const STEP_UP_NEXT = 'Next you enter your authenticator code.';

/** PAY3a: what is being sold. Token packs are made on AI allowances. */
export const KINDS = [
  { kind: 'subscription', label: 'Plan', sub: 'Sold monthly or yearly. Makes one card on /pricing.' },
  { kind: 'incorporation', label: 'One-time service', sub: 'Incorporation and other one-off work.' },
  { kind: 'alacarte', label: 'Add-on', sub: 'Unlocks one feature for some days.' },
  { kind: 'session', label: 'Session', sub: 'A booked session.' },
];

/**
 * The plan families and their levels. Each level is a /pricing card
 * (`PLAN_CARDS`) or Market Intelligence, with the metadata `planOf` reads.
 * A level no checkout sells (Investor Plus: no `investor_tier` names it) has
 * no metadata, and the dialog says so instead of creating it.
 */
const LEVEL_META = {
  'founder:growth': { tier: 'growth' },
  'founder:studio': { tier: 'studio' },
  'investor:professional': { investor_tier: 'professional' },
  advisor: { plan_group: 'advisor' },
  partner: { plan_group: 'partner' },
};
const cardsOf = (tab) => (PLAN_CARDS[tab] || []).filter((c) => !c.free);
function levelsOf(tab) {
  return cardsOf(tab).map((c) => {
    if (c.custom && tab === 'investor') {
      return { id: c.id, name: c.name, key: 'investor:institutional', metadata: { investor_tier: 'institutional' }, card: c, note: '/pricing shows this level as Contact Sales, with no price.' };
    }
    if (c.custom) return null;
    const metadata = LEVEL_META[c.match] || null;
    return { id: c.id, name: c.name, key: c.match, metadata, card: c, note: metadata ? null : '/pricing shows this card, but no checkout sells this level yet.' };
  }).filter(Boolean);
}
export const PLAN_FAMILIES = [
  { key: 'founder', label: 'Founder', tab: 'Founder', levels: levelsOf('founder') },
  { key: 'investor', label: 'Investor', tab: 'Investor', levels: levelsOf('investor') },
  { key: 'advisor', label: 'Advisor', tab: 'Advisors', levels: levelsOf('advisor') },
  { key: 'partner', label: 'Operating Partner', tab: 'Operating Partners', levels: levelsOf('operating-partner') },
  {
    key: 'market_intelligence', label: 'Market Intelligence', tab: null,
    levels: [{ id: 'mi_pro', name: 'Market Intelligence Pro', key: 'market_intelligence', metadata: { plan: 'mi_pro' }, card: null, note: 'No /pricing tab shows Market Intelligence; it is sold from Market Intelligence itself.' }],
  },
];

/** `aiCredits.planOf`'s licence key for a product's metadata, or null. */
export function planKeyOf(metadata) {
  const m = metadata || {};
  if (m.tier === 'growth' || m.tier === 'studio') return `founder:${m.tier}`;
  if (m.investor_tier === 'professional' || m.investor_tier === 'institutional') return `investor:${m.investor_tier}`;
  if (m.plan_group === 'advisor' || m.plan_group === 'partner') return m.plan_group;
  if (m.plan === 'mi_pro') return 'market_intelligence';
  return null;
}

/** PAY3b: the active product that already makes this plan, or null. Two founder tiers are not a clash. */
export function planClash(products, level) {
  if (!level?.metadata) return null;
  const key = planKeyOf(level.metadata);
  return (products || []).find((p) => p?.active && (p.plan?.key ?? planKeyOf(p.metadata)) === key) || null;
}

/** "204.00" → 20400; null for anything that is not an amount with at most two decimals. */
export function centsOf(text) {
  const s = String(text ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

const money = (cents, currency) => {
  const cur = String(currency || '').toUpperCase();
  const n = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur === 'USD' ? `$${n}` : `${n} ${cur}`;
};

/** The monthly AI allowance a plan price gives, in cents, or null when it gives none. */
export function allowanceCents({ cents, currency, billing, isPlan }) {
  if (!isPlan || cents == null || String(currency).toLowerCase() !== 'usd') return null;
  if (billing === 'month') return Math.floor(cents * 0.25);
  if (billing === 'year') return Math.floor((cents * 0.25) / 12);
  return null;
}

/**
 * PAY4a's preview: "$204.00 / year · AI allowance $4.25 a month · saves 15%
 * against monthly." The saving is computed against the product's live
 * monthly price in the same currency, and only when it saves something.
 */
export function pricePreview({ cents, currency = 'usd', billing, isPlan, monthly = null }) {
  if (cents == null) return null;
  const parts = [`${money(cents, currency)}${billing === 'month' ? ' / month' : billing === 'year' ? ' / year' : ' once'}`];
  if (isPlan) {
    const a = allowanceCents({ cents, currency, billing, isPlan });
    parts.push(a == null ? (String(currency).toLowerCase() !== 'usd' ? 'no AI allowance: only USD prices give one' : 'no AI allowance') : `AI allowance ${money(a, 'usd')} a month`);
    if (billing === 'year' && monthly && monthly.unit_amount > 0 && String(monthly.currency).toLowerCase() === String(currency).toLowerCase()) {
      const saving = Math.round((1 - cents / (12 * monthly.unit_amount)) * 100);
      if (saving > 0) parts.push(`saves ${saving}% against monthly`);
    }
  }
  return `${parts.join(' · ')}.`;
}

/** The live monthly price, charged every one month, a product holds; null when none. */
export const monthlyOf = (product) => (product?.prices || []).find((p) => p.active && p.interval === 'month' && (p.interval_count ?? 1) === 1) || null;

/** A reason the Worker will take: null when it will, else the sentence. */
export function reasonProblem(text, min = 1) {
  const n = String(text ?? '').trim().length;
  if (n < min) return min > 1 ? `Say why, in at least ${min} characters.` : 'Say why. The reason is recorded with the change.';
  if (n > REASON_MAX) return `Keep the reason to ${REASON_MAX} characters.`;
  return null;
}

/**
 * PAY6a/b: the key typed into Replace key, checked before it is sent. A
 * secret or restricted key is refused here and never leaves the page.
 */
export function keyCheck(text, accountMode) {
  const k = String(text ?? '').trim();
  if (!k) return { ok: false, tone: 'muted', text: 'Paste the publishable key from the Stripe dashboard.' };
  if (/^(sk|rk)_/.test(k)) return { ok: false, tone: 'bad', text: 'That is a secret key. Never paste it here; this page takes the publishable key only (pk_…).' };
  if (!k.startsWith('pk_')) return { ok: false, tone: 'bad', text: 'A publishable key starts with pk_.' };
  if (k.length > 256) return { ok: false, tone: 'bad', text: 'That is longer than any Stripe key.' };
  const mode = k.startsWith('pk_live_') ? 'live' : k.startsWith('pk_test_') ? 'test' : null;
  if (!mode) return { ok: false, tone: 'bad', text: 'The key is in no known mode: it starts with neither pk_live_ nor pk_test_.' };
  const word = mode === 'live' ? 'Live' : 'Test';
  if (accountMode === 'live' || accountMode === 'test') {
    if (accountMode !== mode) return { ok: true, tone: 'bad', mismatch: true, mode, text: `This is a ${word} key. The account is ${accountMode === 'live' ? 'Live' : 'Test'}. Checkout and token packs will fail until they match.` };
    return { ok: true, tone: 'good', mode, text: `${word} key · matches the account.` };
  }
  return { ok: true, tone: 'muted', mode, text: `${word} key. The account's mode was not read, so it was not compared.` };
}

/** PAY6d: what a sync changed, by product ID, named by the catalogue before and after. */
export function syncDiff(before, after) {
  const was = new Map((before || []).map((p) => [p.id, p]));
  const now = new Map((after || []).map((p) => [p.id, p]));
  return {
    added: [...now.values()].filter((p) => !was.has(p.id)).map((p) => p.name || p.id),
    gone: [...was.values()].filter((p) => !now.has(p.id)).map((p) => p.name || p.id),
  };
}

/** A key that makes a retried change-a-price press one change (D1010 §5). */
export function idempotencyKey() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A refusal as the dialog prints it: the Worker's sentence, and its code for Technical details. */
export function refusalOf(e) {
  const status = Number(e?.status) || null;
  const code = e?.code || null;
  let message = e?.message || 'That did not go through. Nothing was changed.';
  if (status === 403 && code === 'step_up_required') message = 'The authenticator code was not entered, so nothing was changed.';
  if (status === 409 && code === 'token_pack_managed_on_hq') message = 'Token packs are managed on AI allowances. Nothing was changed.';
  return { message, code, status };
}

/** "37 members on it" from part 2's members read; null when the read did not answer. */
export function membersOn(members, priceIds) {
  if (!members || !Array.isArray(members.by_price)) return null;
  const ids = new Set(priceIds);
  const rows = members.by_price.filter((r) => ids.has(r.price_id));
  return rows.reduce((t, r) => t + (Number(r.active) || 0) + (Number(r.other) || 0), 0);
}
