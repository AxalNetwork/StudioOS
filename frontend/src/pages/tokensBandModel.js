/**
 * D1286 (#3369, part 1 of #2452) — the "Your AI tokens" band's model, pure:
 * what the Models tab draws for a signed-in member from three reads,
 * `GET /api/ai-budget/me`, D1166's `GET /api/usage/storage` and D794's
 * `GET /api/ai-budget/auto-reload` (CRP1, CRP10, CRP13, CRP18).
 *
 * NOTHING IS COMPUTED BEYOND FORMATTING. The allowance left and the balance
 * are `availableView`'s (D1277), the reset day the month's next 1st; the plan's
 * name is the plan card whose licence the member holds. A read that failed says
 * so; a figure no read holds is never drawn as zero.
 *
 * THE PROFILES (CRP13). The plan is named only where the licence says which
 * plan it is: founder and investor tiers do; `advisor` and `partner` do not
 * tell a paid plan from a free one, so they are named only once an allowance
 * shows the paid plan. `other` is no plan; `admin` is a staff account, and a
 * Super Admin is pointed at HQ › AI allowances, where packs are set (CRP18).
 */
import { PLAN_CARDS, TOKENS_BAND as W } from '../lib/sitePricing';
import { availableView } from './account/aiTokensModel';
import { bytes } from './account/usageModel';
import { TOPUP_UNAVAILABLE } from '../lib/aiTokens';

/** The plan card's name for a licence key, from every tab's cards. */
export function planNameFor(licence) {
  for (const cards of Object.values(PLAN_CARDS)) {
    const card = (Array.isArray(cards) ? cards : []).find((c) => c.match === licence);
    if (card) return card.name;
  }
  return null;
}

const AMBIGUOUS = new Set(['advisor', 'partner']);

/**
 * The middle block and the bar, from `/me`. `null` while `/me` reads; a block
 * with `state: 'unreadable'` when it is not whole.
 */
export function planBlock(me, { superAdmin = false, now = new Date() } = {}) {
  const v = availableView(me, now);
  if (!v) return { state: 'unreadable', line: W.planUnreadable };
  const licence = me.licence;
  const bar = barOf(v);
  // Only a Super Admin's own staff account is pointed at HQ, where packs are set.
  if (licence === 'admin') return { state: 'ok', eye: W.yourPlan, plan: W.staffName, lines: [W.staff], hq: superAdmin, bar };
  if (licence === 'other') return { state: 'ok', eye: W.yourPlan, plan: W.noPlanName, lines: [W.noPlan], hq: false, bar };
  const name = planNameFor(licence);
  if (v.noAllowance) {
    const named = name && !AMBIGUOUS.has(licence);
    return { state: 'ok', eye: W.yourPlan, plan: named ? name : null, lines: [named ? W.noAllowance(name) : W.planNoAllowance], hq: false, bar };
  }
  return { state: 'ok', eye: W.included, plan: name, lines: [W.left(v.left, v.of), W.resets(v.resets)], hq: false, bar };
}

/**
 * The bar: allowance left (violet), then tokens (sky), each part labelled so
 * the colour never carries the meaning alone. A part at zero is not drawn but
 * keeps its label, so "Plan allowance left $0.00" is still said.
 */
function barOf(v) {
  const left = v.noAllowance ? null : (v.segments.find((s) => s.id === 'allowance')?.micro ?? 0);
  const tokens = v.segments.find((s) => s.id === 'balance')?.micro ?? 0;
  const whole = (left ?? 0) + tokens;
  const parts = [
    left == null ? null : { id: 'allowance', label: W.barAllowance(v.left), pct: whole ? (left / whole) * 100 : 0 },
    { id: 'tokens', label: W.barTokens(v.balance), pct: whole ? (tokens / whole) * 100 : 0 },
  ].filter(Boolean);
  return { parts, label: parts.map((p) => p.label).join(', then ') };
}

/** The storage line from D1166's read: the plan's allowance, why there is none, or that it couldn't be read. */
export function storageLine(read) {
  if (!read || read.status === 'loading') return null;
  if (read.status !== 'ready' || !read.body || typeof read.body !== 'object') return { state: 'unreadable', text: W.storageUnreadable };
  const b = read.body;
  const size = bytes(b.allowance_bytes);
  if (size && b.allowance_bytes > 0) return { state: 'ok', text: W.storage(size) };
  return { state: 'none', text: W.storageNone(b.allowance_reason || 'Not recorded') };
}

/** The auto-reload line from D794's read: off with Set up, on with Manage, or that it couldn't be read. */
export function autoReloadLine(read) {
  if (!read || read.status === 'loading') return null;
  if (read.status !== 'ready' || !read.body || typeof read.body !== 'object') return { state: 'unreadable', text: W.autoUnreadable, link: W.autoManage };
  const r = read.body;
  if (r.enabled === true) {
    const t = typeof r.threshold_usd === 'number' && Number.isFinite(r.threshold_usd) ? `$${r.threshold_usd.toFixed(2)}` : null;
    return { state: 'on', text: W.autoOn(t), link: W.autoManage };
  }
  if (r.disabled_reason) return { state: 'paused', text: W.autoPaused, link: W.autoManage };
  return { state: 'off', text: W.autoOff, link: W.autoSetUp };
}

/**
 * Add tokens: enabled, or disabled with its visible line. Disabled while `/me`
 * reads ("Reading…") and when nothing is on sale (CRP10); a packs read that
 * failed leaves it on, because the packs below say so themselves.
 */
export function addState({ meLoading, packCount }) {
  if (meLoading) return { enabled: false, line: W.reading };
  // `packCount` is null while the packs are unread or failed.
  if (packCount === 0) return { enabled: false, line: TOPUP_UNAVAILABLE };
  return { enabled: true, line: null };
}
