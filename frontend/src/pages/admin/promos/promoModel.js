/**
 * D1270 (#2381) — HQ › Platform › Promo codes, from the owner's canvas "Promo
 * codes" (PRM1–PRM13): Codes and Usage as addresses, one code's drawer at
 * `/admin/platform/promo-codes/:id`, the filters in the address, the state
 * words, and the words of every block no read carries yet. Pure, so
 * `frontend/test/promo_codes_d1270.test.mjs` and
 * `frontend/test/promo_page_d1275.test.mjs` hold each rule.
 *
 * WHAT IS READ (D1275). The paged list (`GET /api/admin/promos`, part 2, D1272)
 * with each code's state, its name and note and its scope (part 3, D1273); one
 * code (`GET /:id`) for the drawer; its recorded redemptions with Stripe's own
 * count, and its history (part 4, D1274); and the usage read's last 30 days for
 * the tiles. Usage itself is part 6 (D1276) and still waits here.
 *
 * NEVER A ZERO FOR A MISSING VALUE. A figure the read did not give is null, and
 * the page says "Not recorded" with its reason.
 */

export const BASE = '/admin/platform/promo-codes';
export const USAGE = `${BASE}/usage`;

export const TITLE = 'Promo codes';
export const PAGE_LINE = 'The codes members can use at checkout, and what each one takes off.';

/** The canvas's states, in the Worker's order (`listState`, services/promos.ts). */
export const STATE_WORD = Object.freeze({
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
  expired: 'Expired',
  at_cap: 'At its cap',
  off: 'Switched off',
});

/**
 * A row's state from the mirror, in `promoState`'s order (`wk/services/promos.ts`):
 * ended, paused, switched off, then expired, then at its cap, then active. The
 * list read now sends `state` itself; this stays for a row that does not.
 */
export function stateOf(p = {}, now = Date.now()) {
  if (p.state && STATE_WORD[p.state]) return p.state;
  if (p.ended_at) return 'ended';
  if (p.paused_at) return 'paused';
  if (!Number(p.active)) return 'off';
  if (p.expires_at && stampMs(p.expires_at) <= now) return 'expired';
  if (p.max_redemptions != null && Number(p.times_redeemed ?? 0) >= Number(p.max_redemptions)) return 'at_cap';
  return 'active';
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const STATES = Object.keys(STATE_WORD);
const APPLIES = ['all', 'plans', 'products'];
export const SORTS = Object.freeze([
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'code', label: 'Code, A to Z' },
  { key: 'redeemed', label: 'Most redeemed' },
]);
export const APPLIES_WORD = Object.freeze({ plans: 'Plans', products: 'Chosen products', all: 'Every product' });
export const PAGE_SIZE = 25;

/** What the address names: the tab, one code's drawer, and the filters (`?state=&applies=&q=&sort=&page=`). */
export function viewOf(pathname = '', search = '') {
  const rest = String(pathname).startsWith(BASE) ? String(pathname).slice(BASE.length).replace(/^\/+|\/+$/g, '') : '';
  const q = new URLSearchParams(String(search));
  const page = /^[1-9]\d{0,5}$/.test(q.get('page') || '') ? Number(q.get('page')) : 1;
  const filters = {
    state: STATES.includes(q.get('state')) ? q.get('state') : null,
    applies: APPLIES.includes(q.get('applies')) ? q.get('applies') : null,
    q: (q.get('q') || '').trim().slice(0, 80) || null,
    sort: SORTS.some((s) => s.key === q.get('sort')) ? q.get('sort') : null,
    page,
  };
  if (rest === 'usage') return { tab: 'usage', id: null, filters };
  if (rest && ID.test(rest) && !rest.includes('/')) return { tab: 'codes', id: rest, filters };
  return { tab: 'codes', id: null, filters };
}

/** The search string of these filters, for the list's address and a drawer's. */
export function filterSearch({ state = null, applies = null, q = null, sort = null, page = 1 } = {}) {
  const s = new URLSearchParams();
  if (STATES.includes(state)) s.set('state', state);
  if (APPLIES.includes(applies)) s.set('applies', applies);
  if (q && String(q).trim()) s.set('q', String(q).trim());
  if (SORTS.some((x) => x.key === sort) && sort !== 'newest') s.set('sort', sort);
  if (Number(page) > 1) s.set('page', String(page));
  const out = s.toString();
  return out ? `?${out}` : '';
}
export const codesHref = (f = {}) => `${BASE}${filterSearch(f)}`;
export const codeHref = (id, f = {}) => (ID.test(String(id ?? '')) ? `${BASE}/${id}${filterSearch(f)}` : codesHref(f));

/** The list read's query (`adminPromosApi.list`). Search starts at two characters, as the Worker's does. */
export function listQuery(f) {
  const out = { page: f.page || 1, page_size: PAGE_SIZE };
  if (f.state) out.state = f.state;
  if (f.applies) out.applies = f.applies;
  if (f.q && f.q.length >= 2) out.q = f.q;
  if (f.sort) out.sort = f.sort;
  return out;
}

/** Whether a filter narrows the list (so its counts are of the filtered codes). */
export const narrowed = (f) => Boolean(f.applies || (f.q && f.q.length >= 2));

export const NOT_YET = 'Not read here yet';

/** What the canvas draws that no read carries yet. Never a zero, never "none". */
export const WAITS = Object.freeze({
  usage: 'Redemptions by week and source, the discount given per currency, top codes and codes near their end are drawn on this tab in part 6.',
});

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

/** A stamp the Worker wrote (ISO, or SQL's `YYYY-MM-DD HH:MM:SS`, read as UTC), in ms, or NaN. */
export function stampMs(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) return Date.parse(`${s.replace(' ', 'T')}Z`);
  return Date.parse(s);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `31 Dec 2026`, or null. */
export function dayWord(raw) {
  const t = stampMs(raw);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** `21 Oct 2026, 09:12`, or null. */
export function minuteWord(raw) {
  const t = stampMs(raw);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const two = (n) => String(n).padStart(2, '0');
  return `${dayWord(raw)}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** The currencies a code can be made in (the canvas's picker), with their minor units. */
export const CURRENCIES = Object.freeze([
  { code: 'usd', label: 'USD', decimals: 2 },
  { code: 'eur', label: 'EUR', decimals: 2 },
  { code: 'gbp', label: 'GBP', decimals: 2 },
]);
const decimalsOf = (cur) => CURRENCIES.find((c) => c.code === String(cur || '').toLowerCase())?.decimals ?? 2;

/** Minor units as money in major units, `$25.00`; null when not a whole number of minor units. */
export function money(minor, currency) {
  if (!Number.isSafeInteger(minor) || !currency) return null;
  const cur = String(currency).toUpperCase();
  const d = decimalsOf(currency);
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).format(minor / 10 ** d);
  } catch {
    return `${(minor / 10 ** d).toFixed(d)} ${cur}`;
  }
}

/** Money typed in major units (`10`, `10.5`, `10.50`) as minor units, or null when it is not money. */
export function toMinor(typed, currency) {
  const s = String(typed ?? '').trim();
  const d = decimalsOf(currency);
  const m = /^(\d{1,9})(?:\.(\d+))?$/.exec(s);
  if (!m || (m[2] && m[2].length > d)) return null;
  return Number(m[1]) * 10 ** d + Number((m[2] || '').padEnd(d, '0') || 0);
}

/** `20% off` or `$25.00 off`. */
export function discountWord(p) {
  if (p?.percent_off != null && Number.isFinite(Number(p.percent_off))) return `${Number(p.percent_off)}% off`;
  const m = money(Number(p?.amount_off), p?.currency);
  return m ? `${m} off` : 'Not recorded';
}

/** What a plan key reads as when the catalogue does not name it. */
export function planKeyWord(key) {
  const [kind, value] = String(key || '').split(':');
  if (kind === 'mi') return 'Market Intelligence Pro';
  const word = String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  if (kind === 'investor') return `Investor ${word}`;
  return word || String(key || '');
}

const INTERVAL_WORD = { month: 'monthly', year: 'yearly' };
/** `monthly`, `yearly`, `monthly and yearly`; `every interval` for a code from before 630 (null). */
export function intervalsWord(intervals) {
  if (intervals == null) return 'every interval';
  const w = (intervals || []).map((i) => INTERVAL_WORD[i] || i);
  if (!w.length) return 'no interval';
  return w.length === 1 ? w[0] : `${w.slice(0, -1).join(', ')} and ${w.at(-1)}`;
}

/**
 * What a code applies to, in words. `names` maps a product id or a plan key
 * to its catalogue name. A product list the Worker could not read is said as
 * that, never as "every product".
 */
export function appliesWord(p, names = {}) {
  if (p?.product_ids_readable === false) return { text: 'Product list unreadable', unreadable: true };
  const plans = p?.plan_keys || [];
  if (plans.length) {
    const ivs = intervalsWord(p.intervals);
    return { text: plans.map((k) => `${names[k] || planKeyWord(k)} · ${ivs}`).join(', '), unreadable: false };
  }
  const ids = p?.product_ids || [];
  if (!ids.length) return { text: 'Every product', unreadable: false };
  return { text: ids.map((id) => names[id] || id).join(', '), unreadable: false };
}

/** How long the discount lasts. A one-time purchase is discounted once. */
export function durationWord(p) {
  const plans = (p?.plan_keys || []).length > 0;
  if (p?.duration === 'forever') return 'Every payment';
  if (p?.duration === 'repeating') {
    const n = Number(p.duration_in_months);
    return p.duration_in_months != null && Number.isSafeInteger(n) && n > 0 ? `${n} ${n === 1 ? 'month' : 'months'}` : 'Repeating, months not recorded';
  }
  if (p?.duration === 'once') return plans ? 'First payment only' : 'Once';
  return 'Not recorded';
}

/** `37 of 200` or `21, no cap`. The mirror's count: a lower bound (subscriptions are Stripe's). */
export function redeemedWord(p) {
  if (p?.times_redeemed == null || !Number.isSafeInteger(Number(p.times_redeemed))) return 'Not recorded';
  const n = Number(p.times_redeemed);
  return p.max_redemptions != null ? `${n} of ${p.max_redemptions}` : `${n}, no cap`;
}

/** `200 in all; once per member; first purchase only`. */
export function limitWord(p) {
  const parts = [p?.max_redemptions != null ? `${p.max_redemptions} in all` : 'No cap'];
  if (p?.once_per_member) parts.push('once per member');
  if (p?.first_purchase_only) parts.push('first purchase only');
  return parts.join('; ');
}

/** The Ends column: the date, and how soon when within 14 days; `No expiry`. */
export function endsWord(p, now = Date.now()) {
  if (p?.ended_at) return { day: dayWord(p.ended_at) ?? 'Not recorded', soon: 'Ended' };
  if (!p?.expires_at) return { day: 'No expiry', soon: null };
  const t = stampMs(p.expires_at);
  if (!Number.isFinite(t)) return { day: 'Not recorded', soon: null };
  const days = Math.ceil((t - now) / 86_400_000);
  return { day: dayWord(p.expires_at), soon: days > 0 && days <= 14 ? `in ${days} ${days === 1 ? 'day' : 'days'}` : null };
}

/* ------------------------------------------------------------------ *
 * PRM1m — the row menu, by state
 * ------------------------------------------------------------------ */

/**
 * The canvas's menu per state. An ended code offers nothing but Open and Copy
 * as a new code: it never resumes, and Stripe deleted its coupon.
 */
export function rowActions(state) {
  if (state === 'ended') return ['open', 'copy_new'];
  const out = ['open', 'copy_code'];
  if (state === 'active') out.push('pause');
  if (state === 'paused' || state === 'off') out.push('resume');
  out.push('end', 'replace', 'copy_new');
  return out;
}
export const ACTION_WORD = Object.freeze({
  open: 'Open', copy_code: 'Copy code', pause: 'Pause…', resume: 'Resume…', end: 'End now…',
  replace: 'Replace with a new code…', copy_new: 'Copy as a new code', edit: 'Edit name and note…',
});

/* ------------------------------------------------------------------ *
 * PRM1 — the four tiles
 * ------------------------------------------------------------------ */

/** The last 30 days, as the usage read takes them. */
export function last30(now = Date.now()) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  return { from: day(now - 29 * 86_400_000), to: day(now) };
}

/**
 * The tiles. `counts` is the list read's per-state counts (null when it did
 * not answer); `usage` the usage read for the last 30 days (null when it
 * failed). A figure no read gave is null, with why.
 */
export function tiles({ counts, usage, scoped = false }) {
  const c = counts && STATES.every((k) => Number.isSafeInteger(counts[k])) ? counts : null;
  const all = c ? STATES.reduce((t, k) => t + c[k], 0) : null;
  const scope = scoped ? ' under these filters' : '';
  const out = [{
    key: 'active', label: 'Active codes', value: c ? String(c.active) : null,
    sub: c ? `of ${all}${scope} · ${c.paused} paused · ${c.expired} expired · ${c.at_cap} at their cap · ${c.ended} ended${c.off ? ` · ${c.off} switched off` : ''}`
      : 'The list did not answer.',
  }];
  const red = usage?.redemptions;
  out.push({
    key: 'redemptions', label: 'Redemptions, last 30 days',
    value: red?.available && Number.isSafeInteger(red.total) ? String(red.total) : null,
    sub: red?.available ? 'Recorded by StudioOS. Each code’s drawer gives Stripe’s own count.' : 'Could not be read.',
  });
  const dis = usage?.discount;
  let dValue = null;
  let dSub = 'Could not be read.';
  if (dis?.available) {
    dValue = dis.currencies.map((x) => money(x.discount_cents, x.currency)).filter(Boolean).join(' and ') || null;
    dSub = `Each currency on its own.${dis.not_recorded ? ` ${dis.not_recorded} ${dis.not_recorded === 1 ? 'redemption carries' : 'redemptions carry'} no amount.` : ''}`;
  } else if (dis?.reason === 'no_redemptions') {
    dValue = 'None given'; dSub = 'Nothing was redeemed in these 30 days.';
  } else if (dis?.reason === 'not_recorded') {
    dSub = 'None of these redemptions carries its amount.';
  }
  out.push({ key: 'discount', label: 'Discount given, last 30 days', value: dValue, sub: dSub });
  const near = usage?.near_end;
  const ending = near?.available ? near.codes.filter((x) => x.ends_in_days != null) : null;
  out.push({
    key: 'ending', label: 'Codes ending in 14 days', value: ending ? String(ending.length) : null,
    sub: !ending ? 'Could not be read.' : ending.length ? ending.map((x) => x.code).join(', ') : 'No code is set to end.',
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * PRM2 — the drawer
 * ------------------------------------------------------------------ */

const SOURCE_WORD = { cart: 'Cart order', payment: 'Payment', free_unlock: 'Free unlock', subscription: 'Subscription' };
const intAt = (v) => (v != null && Number.isSafeInteger(Number(v)) ? Number(v) : null);
/** One recorded redemption in words. A field the redemption does not carry says so. */
export function redemptionRow(r, names = {}) {
  const before = intAt(r.amount_before_cents);
  const off = intAt(r.discount_cents);
  return {
    when: minuteWord(r.created_at) ?? 'Not recorded',
    member: r.member || (r.user_id ? `Account ${r.user_id}` : 'An account no longer here'),
    bought: r.product_id ? `${names[r.product_id] || r.product_id}${r.interval ? ` · ${INTERVAL_WORD[r.interval] || r.interval}` : ''}` : 'Not recorded',
    paid: before != null && off != null ? (money(before - off, r.currency) ?? 'Not recorded') : 'Not recorded',
    saved: off != null ? (money(off, r.currency) ?? 'Not recorded') : 'Not recorded',
    source: SOURCE_WORD[r.source] || 'Not recorded',
  };
}

/** The drawer's redeemed lines: the mirror's count, and Stripe's own beside it, or why not. */
export function redeemedLines(p, read) {
  const lines = [{ key: 'recorded', label: 'Recorded by StudioOS', value: redeemedWord(p), why: null }];
  const s = read?.stripe;
  if (s?.available) lines.push({ key: 'stripe', label: 'Stripe’s own count', value: String(s.times_redeemed), why: null });
  else lines.push({ key: 'stripe', label: 'Stripe’s own count', value: 'Not read', why: s?.reason === 'stripe_not_configured' ? 'Stripe is not configured on this deployment.' : 'Stripe could not be read.' });
  return lines;
}

const HISTORY_WORD = {
  promo_create: 'Created', promo_update: 'Changed', promo_delete: 'Ended', promo_pause: 'Paused',
  promo_resume: 'Resumed', promo_end: 'Ended',
};
/** One history event in words. The read never carries a reason's text, so none is drawn. */
export function historyRow(e) {
  const c = e.change || {};
  const terms = [];
  if (c.percent_off != null) terms.push(`${c.percent_off}% off`);
  else if (c.amount_off != null && c.currency) terms.push(`${money(Number(c.amount_off), c.currency) ?? c.amount_off} off`);
  if (c.max_redemptions != null) terms.push(`${c.max_redemptions} in all`);
  if (c.expires_at) terms.push(`ends ${dayWord(c.expires_at) ?? c.expires_at}`);
  if (c.active === false) terms.push('switched off');
  if (c.active === true) terms.push('switched on');
  return {
    what: `${HISTORY_WORD[e.action] || 'Changed'} by ${e.by?.name || (e.by?.id ? `Account ${e.by.id}` : 'an account no longer here')}`,
    when: minuteWord(e.at) ?? 'Not recorded',
    detail: terms.join(' · '),
  };
}

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

/** A write's refusal in words. The Worker's own sentence wins when it sent one. */
export function refusalWord(e) {
  const code = e?.code || e?.data?.code || e?.data?.error;
  if (code === 'step_up_required') return 'Your authenticator code was not confirmed, so nothing changed.';
  if (code === 'promo_ended') return 'This code has already ended. Nothing changed.';
  if (code === 'promo_changed') return 'Someone changed this code a moment ago. Close this and open it again.';
  return e?.message || 'It could not be saved. Try again.';
}
