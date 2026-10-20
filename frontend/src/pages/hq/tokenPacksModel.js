/**
 * D755 §4 and §14 (#1986, CR8) — the rules HQ › AI allowances draws its token
 * packs, one member's AI account and the reconcile list by. Pure: no React,
 * no fetch, so a Node test can hold every sentence and every bound.
 *
 * The bounds mirror the Worker's (`services/aiCredits.ts`, TOKEN_PACK_LIMITS;
 * `routes/catalog.ts`, the pack routes; `recordAdjustment`). The page refuses
 * out of bounds before it asks, and the Worker refuses again: its sentence is
 * the one shown when it does.
 */
import { microUsd } from '../account/usageModel';

/** D755 §4 and §16, as the Worker enforces them. */
export const PACK_LIMITS = Object.freeze({
  minUsd: 5,
  maxUsd: 500,
  maxBonusPercent: 10,
  maxAdjustmentUsd: 100,
  maxAdjustmentAddedUsd: 250,
  adjustmentWindowDays: 30,
});

/** A typed reason, here as on the held runs. */
export const REASON_MIN = 10;
export const REASON_MAX = 500;

/** The fallback price's name, as members and the Super Admin know it. */
export const FALLBACK = 'STRIPE_PRICE_AI_TOPUP';

/**
 * D750 (#1841) — the fallback's sentences, one per reason, about
 * STRIPE_PRICE_AI_TOPUP. They read as they did before packs.
 */
export const TOPUP_REASON_LINES = {
  missing_from_catalog: (mode) => `The price is not in the catalog mirror and Stripe does not know it in ${mode} mode.`,
  inactive: () => 'The price or its product is archived in Stripe. The top-up needs an active price.',
  not_one_time: () => 'STRIPE_PRICE_AI_TOPUP names a recurring price. The top-up needs a one-time USD price.',
  not_usd: () => 'STRIPE_PRICE_AI_TOPUP names a price that is not in US dollars. The top-up needs a one-time USD price.',
  bad_amount: () => 'The price has no whole, positive amount. The top-up needs a fixed amount in cents.',
  bad_config: () => 'STRIPE_PRICE_AI_TOPUP does not look like a Stripe price ID (price_…).',
  mode_mismatch: (mode) => `STRIPE_PRICE_AI_TOPUP is a price from the other Stripe mode; the secret key is ${mode} mode.`,
};

/**
 * The same reasons about one pack, after "{pack}: " (§14): they name the pack
 * by its label instead of STRIPE_PRICE_AI_TOPUP. The last three are judged per
 * pack row by `packLines` (services/aiCredits.ts) against the catalog mirror.
 */
export const PACK_REASON_LINES = {
  missing_from_catalog: (mode) => `its price is not in the catalog mirror and Stripe does not know it in ${mode} mode.`,
  inactive: () => 'its price or product is archived in Stripe.',
  not_one_time: () => 'its price is recurring. A pack needs a one-time USD price.',
  not_usd: () => 'its price is not in US dollars. A pack needs a one-time USD price.',
  bad_amount: () => 'its price has no whole, positive amount.',
  bad_config: () => 'its price does not look like a Stripe price ID (price_…).',
  mode_mismatch: (mode) => `its price is from the other Stripe mode; the secret key is ${mode} mode.`,
  product_mismatch: () => 'its price now belongs to a different Stripe product than the one recorded.',
  price_mismatch: () => 'its Stripe price no longer has the pack\'s amount.',
  off_sale: () => 'off sale.',
};

const modeOf = (m) => (m === 'live' ? 'live' : 'test');

/**
 * One line per pack (§14), from `GET /api/ai-budget/top-up/status`'s `packs`.
 * The price shows as its last six characters only. The fallback's line says it
 * comes from STRIPE_PRICE_AI_TOPUP and is the only one offered Adopt. An
 * unknown state or reason is not guessed: null.
 */
export function packLine(p, mode) {
  if (!p || (p.state !== 'ready' && p.state !== 'not_ready')) return null;
  const m = modeOf(mode);
  const fallback = p.origin === 'environment';
  const suffix = typeof p.price_id_suffix === 'string' && p.price_id_suffix ? p.price_id_suffix : null;
  const label = typeof p.label === 'string' && p.label ? p.label : null;
  if (!fallback && !label) return null;
  const base = { uid: typeof p.uid === 'string' ? p.uid : null, fallback, adoptable: fallback && p.adoptable === true, suffix };
  const price = suffix ? ` (price …${suffix})` : '';
  if (p.state === 'ready') {
    const name = fallback ? `From ${FALLBACK}: ${label || 'the top-up'}` : label;
    return { ...base, tone: 'success', text: `${name} is on sale${price}, ${m} mode. Members see Add tokens.` };
  }
  if (fallback) {
    const line = TOPUP_REASON_LINES[p.reason];
    return line ? { ...base, tone: 'warning', text: `From ${FALLBACK}: ${line(m)}${suffix ? ` Price …${suffix}.` : ''} Members don't see it.` } : null;
  }
  const line = PACK_REASON_LINES[p.reason];
  return line ? { ...base, tone: 'warning', text: `${label}${price}: ${line(m)} Members don't see it.` } : null;
}

export const NO_PACK_ON_SALE = 'No token pack is on sale, so members are told the top-up isn\'t available yet.';

/** The card's lines, or null when the read is not one this page understands (Unreadable, never a guess). */
export function packLines(status) {
  if (!status || !Array.isArray(status.packs)) return null;
  const lines = status.packs.map((p) => packLine(p, status.mode));
  if (lines.some((l) => l === null)) return null;
  const onSale = lines.some((l) => l.tone === 'success');
  return { mode: modeOf(status.mode), lines, empty: onSale ? null : NO_PACK_ON_SALE };
}

/** A new pack's amount as typed: whole dollars, $5 to $500. */
export function parsePackAmount(text) {
  const t = String(text ?? '').trim().replace(/^\$/, '');
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= PACK_LIMITS.minUsd && n <= PACK_LIMITS.maxUsd ? n : null;
}
export const packLabelPreview = (usd) => `$${usd} of tokens`;
export const newPackConfirm = (mode) => `This creates a product and a one-time price in Stripe's ${modeOf(mode)} mode.`;

/** A Stripe price ID as typed for Adopt. */
export function parsePriceId(text) {
  const t = String(text ?? '').trim();
  return /^price_[A-Za-z0-9]+$/.test(t) ? t : null;
}

/** A bonus as typed: 0 to 10 percent of the pack's face, at most two decimals. */
export function parseBonusPercent(text) {
  const t = String(text ?? '').trim().replace(/%$/, '');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= PACK_LIMITS.maxBonusPercent ? n : null;
}
/** The bonus the PATCH sends, in US dollars, for a face in cents. */
export function bonusUsd(faceCents, percent) {
  return Math.round(faceCents * percent) / 10_000;
}
/** A pack's bonus as a percent of its face, for the field's first value. */
export function bonusPercentOf(faceCents, bonusMicrousd) {
  if (!Number.isSafeInteger(faceCents) || faceCents <= 0 || !Number.isSafeInteger(bonusMicrousd) || bonusMicrousd < 0) return 0;
  return Math.round((bonusMicrousd / (faceCents * 10_000)) * 100 * 100) / 100;
}
/** A pack's face in cents, from its label ("$25 of tokens", as `packLabel` writes it); null when the label is not one. */
export function faceCentsOf(label) {
  const m = /^\$(\d{1,4})(?:\.(\d{2}))?\s+of tokens$/.exec(String(label ?? ''));
  return m ? Number(m[1]) * 100 + (m[2] ? Number(m[2]) : 0) : null;
}
export const BONUS_NOTE = 'A bonus is a cost while AI is billed at cost.';

/** A fresh idempotency key, one per form (the Worker accepts 8 to 64 of A–Z, a–z, 0–9, - and _). */
export function newKey() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** An adjustment as typed: plus or minus, at most $100 either way, never $0, at most two decimals. */
export function parseAdjustment(text) {
  const t = String(text ?? '').trim().replace(/^([+-]?)\$/, '$1');
  if (!/^[+-]?\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n !== 0 && Math.abs(n) <= PACK_LIMITS.maxAdjustmentUsd ? n : null;
}
export const reasonOk = (text) => {
  const t = String(text ?? '').trim();
  return t.length >= REASON_MIN && t.length <= REASON_MAX;
};
export const ADJUST_BOUNDS = `At most $${PACK_LIMITS.maxAdjustmentUsd} either way, never $0, never below a zero balance, and at most $${PACK_LIMITS.maxAdjustmentAddedUsd} added to one member in ${PACK_LIMITS.adjustmentWindowDays} days.`;
export const ADJUST_NOTICE = 'The member is told the amount, never the reason.';

/** What the lookup field holds: a member ID, an email, or neither. */
export function memberQuery(text) {
  const t = String(text ?? '').trim();
  if (/^\d{1,12}$/.test(t) && Number(t) > 0) return { id: Number(t) };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { email: t.toLowerCase() };
  return null;
}
/** The one account whose email is exactly this one, from `/admin/users?q=` (a search, so it may return others). */
export function exactEmailMatch(rows, email) {
  const list = Array.isArray(rows) ? rows : Array.isArray(rows?.users) ? rows.users : [];
  const hits = list.filter((u) => typeof u?.email === 'string' && u.email.toLowerCase() === email && Number.isSafeInteger(Number(u.id)));
  return hits.length === 1 ? Number(hits[0].id) : null;
}

const isInt = (n) => Number.isSafeInteger(n);
const str = (v) => (typeof v === 'string' && v ? v : null);

// ---------- one member's AI account (§14) -----------------------------------
// Each section is read on its own: a section whose part is missing or not the
// shape this page knows is Unreadable, and the others still draw.

// D783: a member's allowance is computed from the plans they pay; "catalogue" means a plan with no recorded amount yet.
export const ALLOWANCE_SOURCE = { recorded: 'Set by HQ', environment: 'Platform default', plan: 'From the plans they pay',
  catalogue: 'Catalogue price, not yet recorded', none: 'No plan' };
export function allowanceView(a) {
  const x = a?.allowance;
  if (!x || !isInt(x.daily_microusd) || !isInt(x.monthly_microusd)) return null;
  return { licence: str(x.licence_key), source: ALLOWANCE_SOURCE[x.source] || (str(x.source) ? x.source : 'Not recorded'),
    daily: x.daily_capped === false ? 'None' : microUsd(x.daily_microusd), monthly: microUsd(x.monthly_microusd) };
}
export function balanceView(a) {
  if (!a || !isInt(a.balance_microusd) || !isInt(a.topup_held_microusd) || !isInt(a.ledger_balance_microusd)) return null;
  return { balance: microUsd(a.balance_microusd), held: microUsd(a.topup_held_microusd), ledger: microUsd(a.ledger_balance_microusd),
    differs: a.balance_microusd !== a.ledger_balance_microusd, onHold: typeof a.on_hold === 'boolean' ? a.on_hold : null };
}
export const LEDGER_KIND = {
  purchase: 'Purchase', bonus: 'Bonus', refund: 'Refund', dispute: 'Dispute', dispute_won: 'Dispute won',
  adjustment: 'Adjustment', hold: 'Hold', release: 'Release', spend: 'Spend',
};
const signed = (n) => `${n < 0 ? '−' : '+'}${microUsd(Math.abs(n))}`;
export function ledgerView(ledger) {
  if (!ledger || !Array.isArray(ledger.items)) return null;
  const rows = [];
  for (const r of ledger.items) {
    if (!r || typeof r.uid !== 'string' || !isInt(r.delta_microusd)) return null;
    rows.push({ uid: r.uid, kind: LEDGER_KIND[r.kind] || String(r.kind || 'Not recorded'), amount: signed(r.delta_microusd),
      at: str(r.at), pack: str(r.pack_label), reason: str(r.reason), actor: str(r.actor), shortfall: isInt(r.shortfall_microusd) && r.shortfall_microusd > 0 ? microUsd(r.shortfall_microusd) : null });
  }
  return { rows, next: str(ledger.next_before) };
}
export const PURCHASE_STATE = { waiting: 'Waiting', overdue: 'Overdue', credited: 'Added', refunded: 'Refunded', disputed: 'Disputed' };
export function purchasesView(list) {
  if (!Array.isArray(list)) return null;
  const rows = [];
  for (const p of list) {
    if (!p || !PURCHASE_STATE[p.state] || !isInt(p.amount_microusd)) return null;
    rows.push({ key: str(p.payment_intent_id) || str(p.order_ref) || `${p.at}`, pack: str(p.pack_label), state: p.state, label: PURCHASE_STATE[p.state],
      amount: microUsd(p.amount_microusd), at: str(p.at), order: str(p.order_ref) });
  }
  return rows;
}
export function shortfallsView(list) {
  if (!Array.isArray(list)) return null;
  const rows = [];
  for (const s of list) {
    if (!s || typeof s.uid !== 'string' || !isInt(s.shortfall_microusd)) return null;
    rows.push({ uid: s.uid, kind: LEDGER_KIND[s.kind] || String(s.kind || 'Not recorded'), amount: microUsd(s.shortfall_microusd), at: str(s.at) });
  }
  return rows;
}

// ---------- reconcile (§14) -------------------------------------------------

export const RESEND = 'Resend payment_intent.succeeded from Stripe › Developers › Events';
/** The reconcile read, each list on its own: null where the part is not there. HQ never credits. */
export function reconcileView(r) {
  const list = (v, f) => (Array.isArray(v) && v.every(f) ? v : null);
  const mismatched = list(r?.mismatched, (m) => isInt(m?.member_id) && isInt(m?.difference_microusd));
  const overdue = list(r?.overdue, (p) => isInt(p?.member_id) && isInt(p?.amount_microusd));
  const disputes = list(r?.open_disputes, (p) => isInt(p?.member_id) && isInt(p?.amount_microusd));
  return {
    mismatched: mismatched && mismatched.map((m) => ({ member: m.member_id, balance: microUsd(m.balance_microusd), ledger: microUsd(m.ledger_microusd), difference: signed(m.difference_microusd) })),
    overdue: overdue && overdue.map((p) => ({ member: p.member_id, key: str(p.payment_intent_id) || str(p.order_ref), pack: str(p.pack_label), amount: microUsd(p.amount_microusd), at: str(p.at), instruction: str(p.instruction) || RESEND })),
    disputes: disputes && disputes.map((p) => ({ member: p.member_id, key: str(p.payment_intent_id) || str(p.order_ref), pack: str(p.pack_label), amount: microUsd(p.amount_microusd), at: str(p.at) })),
  };
}

export const CREDIT_RULES_LINE = 'AI tokens are not perk credits. They are on AI allowances › Token packs.';
