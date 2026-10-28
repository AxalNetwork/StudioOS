/**
 * D1275 (#3301) — New code in five steps (PRM3, PRM4), and the drafts Copy as
 * a new code and Replace start from (PRM5). Pure, so
 * `frontend/test/promo_page_d1275.test.mjs` holds each rule.
 *
 * The body it builds is `POST /api/admin/promos`'s (routes/admin_promos.ts
 * `createPromo`, with part 3's scope and limits, D1273):
 *   code, type (percent | fixed), percent_off | amount_off (minor units) +
 *   currency, duration (once | repeating | forever) + duration_in_months,
 *   max_redemptions, expires_at, product_ids, plan_keys, intervals,
 *   once_per_member, first_purchase_only, name, note.
 * Money is typed in major units and sent in minor units. The Worker checks
 * each again; this only says what is missing before the press.
 */
import { CURRENCIES, money, planKeyWord, toMinor } from './promoModel';

export const STEPS = Object.freeze(['Applies to', 'Discount', 'Duration', 'Limits and dates', 'Review']);
export const CODE_RE = /^[A-Z0-9_-]{3,64}$/;
export const NAME_MAX = 80;
export const NOTE_MAX = 500;
export const MONTHS_MAX = 36;

/** The Worker's `planKeyOf` (services/promos.ts), on a catalogue product's metadata. */
export function planKeyOfProduct(p) {
  const m = p?.metadata || {};
  if (m.tier === 'growth' || m.tier === 'studio') return `tier:${m.tier}`;
  if (m.investor_tier === 'plus' || m.investor_tier === 'professional' || m.investor_tier === 'institutional') return `investor:${m.investor_tier}`;
  if (typeof m.plan_group === 'string' && m.plan_group.trim()) return `plan:${m.plan_group.trim()}`;
  if (m.plan === 'mi_pro') return 'mi:mi_pro';
  return null;
}

const isPack = (p) => p?.kind === 'token_pack' || (p?.shows_on || []).some((s) => s?.key === 'packs');

/**
 * The plans and one-time products a code can name, from the catalogue
 * (`api.adminCatalogList`). Only live products; never a token pack (D755 §5).
 * A plan is every live product its key resolves to, as the Worker resolves it.
 */
export function catalogueChoices(products) {
  const live = (products || []).filter((p) => p?.active && !isPack(p));
  const plans = new Map();
  const oneTime = [];
  for (const p of live) {
    const key = planKeyOfProduct(p);
    const prices = (p.prices || []).filter((x) => x.active && Number.isSafeInteger(x.unit_amount));
    if (key) {
      const e = plans.get(key) || { key, label: p.plan?.label || p.name || planKeyWord(key), prices: [], products: [] };
      e.products.push(p.id);
      for (const x of prices) if (x.type === 'recurring' && (x.interval === 'month' || x.interval === 'year')) e.prices.push({ name: p.name, ...x });
      plans.set(key, e);
    } else {
      oneTime.push({ id: p.id, name: p.name, kind: p.kind, prices: prices.filter((x) => x.type !== 'recurring') });
    }
  }
  return { plans: [...plans.values()].sort((a, b) => a.label.localeCompare(b.label)), products: oneTime.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Names for the list and the drawer: product ids and plan keys to their catalogue names. */
export function catalogueNames(products) {
  const out = {};
  for (const p of products || []) {
    if (p?.id) out[p.id] = p.name;
    const key = planKeyOfProduct(p);
    if (key && !out[key]) out[key] = p.plan?.label || p.name;
  }
  return out;
}

/** An empty draft. A new code applies to monthly billing unless HQ chooses yearly too (#2381 question 3). */
export function emptyDraft() {
  return {
    scope: 'plans', plans: [], intervals: ['month'], products: [],
    type: 'percent', percent: '', amount: '', currency: 'usd',
    duration: 'once', months: '3',
    cap: '', once_per_member: false, first_purchase_only: false, ends_on: '',
    code: '', name: '', note: '',
  };
}

/** A draft with a code's terms, for Copy as a new code and Replace. The code itself is never copied: it can never be reused. */
export function draftFrom(p) {
  const d = emptyDraft();
  const plans = p?.plan_keys || [];
  const products = p?.product_ids || [];
  d.scope = plans.length ? 'plans' : products.length ? 'products' : 'every';
  d.plans = [...plans];
  d.intervals = Array.isArray(p?.intervals) && p.intervals.length ? [...p.intervals] : ['month'];
  d.products = plans.length ? [] : [...products];
  if (p?.percent_off != null) { d.type = 'percent'; d.percent = String(p.percent_off); } else if (p?.amount_off != null) {
    d.type = 'fixed'; d.currency = String(p.currency || 'usd').toLowerCase();
    d.amount = Number.isSafeInteger(Number(p.amount_off)) ? (Number(p.amount_off) / 100).toFixed(2) : '';
  }
  d.duration = ['once', 'repeating', 'forever'].includes(p?.duration) ? p.duration : 'once';
  if (p?.duration_in_months) d.months = String(p.duration_in_months);
  d.cap = p?.max_redemptions != null ? String(p.max_redemptions) : '';
  d.once_per_member = Boolean(p?.once_per_member);
  d.first_purchase_only = Boolean(p?.first_purchase_only);
  d.ends_on = p?.expires_at ? String(p.expires_at).slice(0, 10) : '';
  d.name = p?.name || '';
  d.note = p?.note || '';
  return d;
}

/** Whether the duration step asks anything: with only one-time products in scope, a purchase is discounted once. */
export const asksDuration = (d) => d.scope !== 'products';

/** The steps this draft walks, by index into STEPS. */
export const stepsFor = (d) => (asksDuration(d) ? [0, 1, 2, 3, 4] : [0, 1, 3, 4]);

const todayUtc = (now) => new Date(now).toISOString().slice(0, 10);

/** Why this step cannot go on yet, or null. */
export function stepProblem(step, d, { now = Date.now(), taken = [] } = {}) {
  if (step === 0) {
    if (d.scope === 'plans' && !d.plans.length) return 'Choose at least one plan.';
    if (d.scope === 'plans' && !d.intervals.length) return 'Choose monthly, yearly or both.';
    if (d.scope === 'products' && !d.products.length) return 'Choose at least one product.';
    return null;
  }
  if (step === 1) {
    if (d.type === 'percent') {
      const n = Number(d.percent);
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(String(d.percent).trim()) || n <= 0 || n > 100) return 'Percent off is 1 to 100.';
      return null;
    }
    if (!CURRENCIES.some((c) => c.code === d.currency)) return 'Choose USD, EUR or GBP.';
    const minor = toMinor(d.amount, d.currency);
    if (minor == null || minor <= 0) return 'Type the amount off, such as 10 or 10.50.';
    return null;
  }
  if (step === 2) {
    if (d.duration === 'repeating') {
      const n = Number(d.months);
      if (!/^\d{1,2}$/.test(String(d.months).trim()) || n < 1 || n > MONTHS_MAX) return `For 1 to ${MONTHS_MAX} months.`;
    }
    return null;
  }
  if (step === 3) {
    if (String(d.cap).trim() && !/^[1-9]\d{0,6}$/.test(String(d.cap).trim())) return 'Total redemptions is a whole number from 1, or blank for no limit.';
    if (d.ends_on) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.ends_on)) return 'Choose the day it ends.';
      if (d.ends_on < todayUtc(now)) return 'It cannot end in the past.';
    }
    const code = String(d.code).trim().toUpperCase();
    if (!CODE_RE.test(code)) return '3 to 64 characters: letters, digits, _ or -.';
    if (taken.includes(code)) return `${code} is already taken. Codes can never be reused.`;
    if (d.name.length > NAME_MAX) return `The name is at most ${NAME_MAX} characters.`;
    if (d.note.length > NOTE_MAX) return `The note is at most ${NOTE_MAX} characters.`;
    return null;
  }
  return null;
}

/** The first step with a problem, so Create is only offered on a draft that is whole. */
export function draftProblem(d, opts) {
  for (const s of stepsFor(d)) { const p = stepProblem(s, d, opts); if (p) return { step: s, problem: p }; }
  return null;
}

/** The create body. Money in minor units; the day ends at 23:59:59 UTC. */
export function createBody(d) {
  const body = {
    code: String(d.code).trim().toUpperCase(),
    type: d.type,
    duration: asksDuration(d) ? d.duration : 'once',
    once_per_member: Boolean(d.once_per_member),
    first_purchase_only: Boolean(d.first_purchase_only),
  };
  if (d.type === 'percent') body.percent_off = Number(d.percent);
  else { body.amount_off = toMinor(d.amount, d.currency); body.currency = d.currency; }
  if (body.duration === 'repeating') body.duration_in_months = Number(d.months);
  if (d.scope === 'plans') { body.plan_keys = [...d.plans]; body.intervals = [...d.intervals]; body.product_ids = []; }
  else if (d.scope === 'products') body.product_ids = [...d.products];
  else body.product_ids = [];
  if (String(d.cap).trim()) body.max_redemptions = Number(d.cap);
  if (d.ends_on) body.expires_at = `${d.ends_on}T23:59:59Z`;
  if (d.name.trim()) body.name = d.name.trim();
  if (d.note.trim()) body.note = d.note.trim();
  return body;
}

/** A code suggestion: a short prefix from the name, then four letters and digits nobody would type by chance. */
export function generateCode(name = '', rand = Math.random) {
  const prefix = String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'CODE';
  const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let tail = '';
  for (let i = 0; i < 4; i += 1) tail += ABC[Math.floor(rand() * ABC.length)];
  return `${prefix}-${tail}`;
}

/** Minor units after the discount, never below zero. */
function after(amount, d) {
  if (d.type === 'percent') return Math.max(0, Math.round(amount * (1 - Number(d.percent) / 100)));
  const off = toMinor(d.amount, d.currency);
  return off == null ? null : Math.max(0, amount - off);
}

const INTERVAL = { month: 'monthly', year: 'yearly' };
/**
 * What a member pays (PRM2, PRM3): each price in scope, before and after, in
 * its own currency. An amount off touches only prices in its currency.
 */
export function memberPays(d, choices) {
  const rows = [];
  if (d.scope === 'plans') {
    for (const plan of (choices?.plans || []).filter((p) => d.plans.includes(p.key))) {
      for (const x of plan.prices.filter((pr) => d.intervals.includes(pr.interval))) rows.push({ label: `${plan.label} · ${INTERVAL[x.interval]}`, ...x });
    }
  } else if (d.scope === 'products') {
    for (const p of (choices?.products || []).filter((q) => d.products.includes(q.id))) for (const x of p.prices) rows.push({ label: p.name, ...x });
  }
  return rows.map((r) => {
    const applies = d.type === 'percent' || String(r.currency).toLowerCase() === d.currency;
    const to = applies ? after(r.unit_amount, d) : null;
    return { label: r.label, from: money(r.unit_amount, r.currency), to: to == null ? null : money(to, r.currency), applies };
  });
}

/** The review's lines (PRM4c). */
export function reviewLines(d, choices, names = {}) {
  const planName = (k) => choices?.plans?.find((p) => p.key === k)?.label || names[k] || planKeyWord(k);
  const productName = (id) => choices?.products?.find((p) => p.id === id)?.name || names[id] || id;
  const ivs = d.intervals.map((i) => INTERVAL[i]).join(' and ');
  const applies = d.scope === 'plans' ? d.plans.map((k) => `${planName(k)} (${ivs})`).join(', ')
    : d.scope === 'products' ? d.products.map(productName).join(', ') : 'Every plan and product';
  const discount = d.type === 'percent' ? `${Number(d.percent)}% off` : `${money(toMinor(d.amount, d.currency), d.currency) ?? 'Not set'} off`;
  const duration = !asksDuration(d) ? 'Once' : d.duration === 'once' ? 'First payment only' : d.duration === 'forever' ? 'Every payment' : `${d.months} months`;
  const limits = [String(d.cap).trim() ? `${d.cap} in all` : 'No cap', d.once_per_member && 'once per member', d.first_purchase_only && 'first purchase only'].filter(Boolean).join('; ');
  return [
    ['Applies to', applies], ['Discount', discount], ['Duration', duration], ['Limits', limits],
    ['Ends', d.ends_on ? `${d.ends_on}, 23:59 UTC` : 'No expiry'],
    ['Code', String(d.code).trim().toUpperCase()], ['Name', d.name.trim() || 'None'], ['Note', d.note.trim() || 'None'],
  ];
}
