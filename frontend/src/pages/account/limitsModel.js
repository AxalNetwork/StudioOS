/**
 * D807 (#2246) — the words and figures of `/account/usage/limits`, board B4 of
 * the "Usage & Billing console" canvas (`Usage Page.dc.html`, `screen:
 * 'limits'`). Pure, so `frontend/test/limits_page_d807.test.mjs` holds each rule.
 *
 * Four reads, none of them new (no `/api/*` method is added):
 *   - D788's `GET /api/ai-budget/limit`: the limit, this UTC month's charge,
 *     the notices and the reset day; and D805's (#2243) `pack_orders`;
 *   - D640's `GET /api/ai-budget/me`: the plan allowance and what it has used;
 *   - D794's `GET /api/ai-budget/auto-reload` and D755's `GET
 *     /api/ai-budget/top-up` (the pack's label).
 *
 * AI tokens are never "credits" (D793).
 */
import { allowanceView, microUsd } from './usageModel';
import { packOptions } from './autoReloadModel';

/** The page's header, byte for byte from the canvas's `HEAD.limits`. */
export const LIMITS_PAGE = Object.freeze({ title: 'Limits', sub: 'What stops spend, and when it resets.' });

/**
 * Usage's pages under the account navigation, in the canvas's order. The
 * canvas draws three children — Overview, Cost and Limits (D789, D807).
 */
export const USAGE_PAGES = Object.freeze([
  { id: 'overview', label: 'Overview', path: '/account/usage' },
  { id: 'cost', label: 'Cost', path: '/account/usage/cost' },
  { id: 'limits', label: 'Limits', path: '/account/usage/limits' },
]);

/** Which Usage page an address opens: `'cost'` or `'limits'`, or `'overview'` for anything else under `/account/usage`. */
export function usagePageFor(pathname = '') {
  const m = String(pathname).match(/^\/(?:account|settings)\/usage\/([^/?#]+)\/?$/);
  const hit = m && USAGE_PAGES.find((p) => p.id === m[1].toLowerCase() && p.id !== 'overview');
  return hit ? hit.id : 'overview';
}

/** A Usage page's own path. */
export function usagePathFor(page) {
  return (USAGE_PAGES.find((p) => p.id === page) ?? USAGE_PAGES[0]).path;
}

/** D788's ceiling for a limit (`SPEND_LIMIT_MAX_USD`). */
export const LIMIT_MAX_USD = 100_000;

/** A typed limit in US dollars: 0 to $100,000, at most two decimals, or null. Mirrors D788's `parseSpendLimit`. */
export function parseLimitUsd(text) {
  const t = String(text ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n <= LIMIT_MAX_USD ? n : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `1 Nov` from `2026-11-01`; null for anything else. */
export function dayText(isoDay) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDay ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

/** The first day of the next UTC month, as `YYYY-MM-DD`. */
export function nextMonthStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 10);
}

const isMicro = (n) => Number.isSafeInteger(n) && n >= 0;
const notifyOf = (n) => ({ 50: n?.[50] !== false, 80: n?.[80] !== false, 100: n?.[100] !== false });

/**
 * The spend-limit card from D788's read: `null` when the read is not one
 * (Unreadable), else `{ set, ... }`. With no limit it is the canvas's empty
 * state; the notices still round-trip, as the Worker keeps them on.
 */
export function limitView(read) {
  if (!read || typeof read !== 'object' || !isMicro(read.charged_microusd)) return null;
  const resets = dayText(read.resets_on);
  const base = { spent: microUsd(read.charged_microusd), resets, notify: notifyOf(read.notify) };
  if (read.limit_microusd == null) return { ...base, set: false, limitUsd: null, limit: null, pct: null };
  if (!isMicro(read.limit_microusd)) return null;
  const pct = read.limit_microusd > 0 ? Math.min(100, Math.round((read.charged_microusd / read.limit_microusd) * 100)) : 100;
  return { ...base, set: true, limitUsd: read.limit_microusd / 1_000_000, limit: microUsd(read.limit_microusd), pct };
}

/** The canvas's empty state for the spend limit. */
export const NO_LIMIT = 'No limit set. Runs continue while your plan allowance and token balance last.';
/** The canvas's "Not recorded" for the plan allowance. */
export const NO_PLAN_ALLOWANCE = 'Plan allowance: there is no plan, so there is no allowance.';

/** The sentence under the limit. */
export function stopsLine(view) {
  return `Runs, and auto-reloads, that would pass it are stopped until ${view?.resets ?? 'the 1st of next month'}.`;
}

/**
 * The plan allowance card from D640's `/ai-budget/me`: `null` when unreadable,
 * `{ none: true }` with no allowance, else the month's figures.
 */
export function allowanceCard(budget, now = new Date()) {
  const v = allowanceView(budget, now);
  if (!v) return null;
  if (!v.month) return { none: true };
  return { none: false, perMonth: v.month.of, used: v.month.used, pct: v.month.pct, resets: dayText(nextMonthStart(now)) };
}

/** A whole-dollar amount as `$25`, else `$5.50`. */
function dollars(n) {
  if (!Number.isFinite(n) || n < 0) return null;
  return Number.isInteger(n) ? `$${n.toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
}

/**
 * The auto-reload card from D794's read and the packs on sale: `null` when
 * unreadable, else `{ on, line }`. The line names the pack's face value and the
 * threshold, as the canvas does; with no pack chosen it says so.
 */
export function autoReloadCard(read, topUp) {
  if (!read || typeof read !== 'object' || typeof read.enabled !== 'boolean') return null;
  const label = packOptions(topUp).find((p) => p.uid === read.pack_uid)?.label ?? null;
  const face = label ? /^\$[\d,]+(?:\.\d{2})?/.exec(label)?.[0] ?? null : null;
  const below = dollars(read.threshold_usd);
  const line = face && below
    ? `When on, buys the ${face} pack below ${below}.`
    : 'No pack chosen yet. Choose one on Billing.';
  return { on: read.enabled, line };
}

/** D794's sentence: the one limit is also auto-reload's. */
export const AUTO_RELOAD_LIMIT_NOTE = 'The spend limit above is also auto-reload’s limit.';

/** Why today's pack orders read Not recorded when the limit read carries no `pack_orders` (D805, #2243). */
export const PACK_ORDERS_NOT_READ = 'Today’s count is not read yet.';

/**
 * Today's token-pack orders from D805's `pack_orders` on the limit read:
 * `{ today, perDay, pct }`, or null when the read does not carry it.
 */
export function packOrdersCard(read) {
  const p = read?.pack_orders;
  if (!p || !Number.isSafeInteger(p.today) || !Number.isSafeInteger(p.per_day) || p.today < 0 || p.per_day <= 0) return null;
  return { today: p.today, perDay: p.per_day, pct: Math.min(100, Math.round((p.today / p.per_day) * 100)) };
}
