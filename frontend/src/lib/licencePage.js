// D800 (#2233) — the Licences page's frame and Summary, as pure functions the
// page and its tests share (canvas `Licences Page.dc.html`, boards L1, L6–L8).
//
// EVERY CARD READS WHAT A WORKER READ ALREADY SENDS, and says "Not recorded"
// for what it does not. `GET /api/licence/mine` gives the ledger (term, fee,
// share, seats, territories, status); D798's `/mine/needs`, `/mine/statements`
// and `/mine/contract` give Needs you, What you owe HQ and Your contract; D799's
// `/mine/requests` says whether a renewal or a notice of non-renewal is with
// HQ; `/api/ai-budget/me` is the caller's own allowance. Nothing is computed
// that a read does not carry: a renewal mode HQ has not recorded is not
// guessed, and seats used on HQ, which nothing counts, is not drawn as zero.
import { NOT_RECORDED } from './absence';
import { bpsPercent } from './bps';

export { NOT_RECORDED };

export const LICENCE_PATH = '/admin/my-licence';

/**
 * The six tabs, as sub-paths of `/admin/my-licence` (board L1's tab row). The
 * Licences row stays lit on each (`sidebarConfig.js`'s `match`).
 */
export const LICENCE_TABS = [
  { key: 'summary', label: 'Summary', path: LICENCE_PATH },
  { key: 'terms', label: 'Terms', path: `${LICENCE_PATH}/terms` },
  { key: 'contract', label: 'Contract', path: `${LICENCE_PATH}/contract` },
  { key: 'statements', label: 'Statements', path: `${LICENCE_PATH}/statements` },
  { key: 'requests', label: 'Requests', path: `${LICENCE_PATH}/requests` },
  { key: 'history', label: 'History', path: `${LICENCE_PATH}/history` },
];

/** The tabs D804 (#2241) builds; until it lands each draws a placeholder. */
export const PART_TWO_TABS = new Set(['contract', 'statements', 'requests']);

export const tabPath = (key) => LICENCE_TABS.find((t) => t.key === key)?.path ?? LICENCE_PATH;

/** "Request a change" on a term: the Requests tab, with the term D799's `terms_change` sheet opens on. */
export const changeHref = (term) => `${tabPath('requests')}?change=${encodeURIComponent(term)}`;

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A stored date (`YYYY-MM-DD…`) as a UTC midnight, or null when it is not one. */
export function dayOf(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? new Date(t) : null;
}

/** "1 Mar 2025", or "Not recorded". */
export function longDate(value) {
  const d = value instanceof Date ? value : dayOf(value);
  if (!d) return NOT_RECORDED;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const addYears = (d, n) => new Date(Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate()));
const today = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Whole cents in the licence's own currency: "€90,000", or "Not recorded". */
export function money(cents, currency) {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return NOT_RECORDED;
  const amount = Number(cents) / 100;
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency', currency: currency || 'EUR', maximumFractionDigits: amount % 1 ? 2 : 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString('en-GB')} ${currency || ''}`.trim();
  }
}

export const percent = (bps) => bpsPercent(bps) ?? NOT_RECORDED;

/** The licence's status as the header's pill reads it. */
export const STATUS_LABEL = {
  active: 'Active',
  pending_activation: 'Pending activation',
  suspended: 'Suspended',
  terminated: 'Terminated',
  draft: 'Draft',
};
export const statusLabel = (s) => STATUS_LABEL[s] || (s ? String(s).replace(/_/g, ' ') : NOT_RECORDED);

/** The kind pill. A copy pushed before migration 284 carries none, which is not a guessed "Subsidiary". */
export const kindLabel = (k) => (k === 'white_label' ? 'White-label' : k === 'subsidiary' ? 'Subsidiary' : NOT_RECORDED);

/**
 * Which of board L7's states the page is in. `none` and `not_pushed` are the
 * two 404s (no licence of yours; a branch HQ has not pushed one to yet).
 */
export function pageState(data) {
  if (!data) return 'loading';
  if (data.none) return 'none';
  if (data.notPushed) return 'not_pushed';
  const s = data.licence?.status;
  if (s === 'pending_activation' || s === 'suspended' || s === 'terminated') return s;
  return 'active';
}

/**
 * The Term card: "Year 2 of 3", the dates, and how far through it is. Each
 * piece the ledger lacks reads "Not recorded" rather than being estimated.
 */
export function termCard(licence, now = new Date()) {
  const start = dayOf(licence?.starts_on);
  const years = Number.isInteger(licence?.term_years) && licence.term_years > 0 ? licence.term_years : null;
  const end = start && years ? new Date(addYears(start, years).getTime() - DAY) : null;
  if (!start || !years) {
    return { title: NOT_RECORDED, range: `${longDate(start)} to ${longDate(end)}`, pct: null };
  }
  const t = today(now).getTime();
  const elapsedYears = Math.floor((t - start.getTime()) / (365.25 * DAY));
  const year = Math.min(years, Math.max(1, elapsedYears + 1));
  const span = end.getTime() - start.getTime();
  const pct = span > 0 ? Math.max(0, Math.min(100, Math.round(((t - start.getTime()) / span) * 100))) : null;
  return { title: `Year ${year} of ${years}`, range: `${longDate(start)} to ${longDate(end)}`, pct };
}

/** Whole days from today to `d`, never negative. */
const daysUntil = (d, now) => Math.max(0, Math.round((d.getTime() - today(now).getTime()) / DAY));

/**
 * The Renewal card (board L1's four variants). What HQ is already deciding
 * comes first: a notice of non-renewal given, then a renewal requested and not
 * yet answered. Then D797's `renewal_mode` when the terms carry one. Otherwise
 * the date alone, and how renewal works reads "Not recorded".
 */
export function renewalCard(licence, { terms = null, requests = null, now = new Date() } = {}) {
  const renews = dayOf(licence?.renews_on);
  const items = Array.isArray(requests?.items) ? requests.items : [];
  const notice = items.find((r) => r.kind === 'non_renewal' && r.status !== 'undelivered');
  if (notice) {
    const start = dayOf(licence?.starts_on);
    const years = Number.isInteger(licence?.term_years) ? licence.term_years : null;
    const end = renews ? new Date(renews.getTime() - DAY) : (start && years ? new Date(addYears(start, years).getTime() - DAY) : null);
    return { variant: 'notice', title: 'Notice of non-renewal given', detail: `Ends ${longDate(end)} · given ${longDate(notice.created_at)}` };
  }
  const asked = items.find((r) => r.kind === 'renewal' && r.status === 'open');
  if (asked) {
    const hours = requests?.response_hours?.renewal;
    return {
      variant: 'requested',
      title: `Renewal requested ${longDate(asked.created_at)}`,
      detail: Number.isFinite(hours) ? `HQ answers within ${hours} hours` : 'HQ has not answered yet',
    };
  }
  const days = Number.isInteger(terms?.non_renewal_notice_days) ? terms.non_renewal_notice_days : null;
  const noticeBy = renews && days !== null ? new Date(renews.getTime() - days * DAY) : null;
  if (!renews) return { variant: 'date', title: `Renewal date: ${NOT_RECORDED}`, detail: 'HQ has not recorded one' };
  if (terms?.renewal_mode === 'auto') {
    return {
      variant: 'auto',
      title: `Auto-renews ${longDate(renews)}`,
      detail: noticeBy ? `Give notice by ${longDate(noticeBy)} to stop it` : 'Notice period: Not recorded',
    };
  }
  const how = terms?.renewal_mode === 'on_request' ? 'On request' : 'Renewal: Not recorded';
  return {
    variant: 'date',
    title: `Renews ${longDate(renews)}, in ${daysUntil(renews, now)} days`,
    detail: noticeBy ? `${how} · notice by ${longDate(noticeBy)}` : how,
  };
}

/**
 * The Annual licence fee card. The fee is invoiced on the licence's
 * anniversary (`starts_on`, D797), so the next invoice is the next one from
 * today; with no start date it reads "Not recorded".
 */
export function feeCard(licence, now = new Date()) {
  const start = dayOf(licence?.starts_on);
  let next = null;
  if (start) {
    const t = today(now).getTime();
    next = start;
    for (let n = 1; next.getTime() < t && n < 200; n += 1) next = addYears(start, n);
  }
  return { amount: money(licence?.annual_fee_cents, licence?.currency), next: `next invoice ${longDate(next)}` };
}

/** The Revenue share card: the share, the AI token split and, when D797 records it, the royalty on licences sold. */
export function shareCard(licence, terms = null) {
  const parts = [`AI token split ${percent(licence?.token_split_bps)}`];
  if (terms && 'royalty_platform_licence_bps' in terms) {
    parts.push(`royalty on licences sold ${percent(terms.royalty_platform_licence_bps)}`);
  }
  return { share: percent(licence?.revenue_share_bps), detail: parts.join(' · ') };
}

/** Each "Needs you" item's one button (board L1), by D798's `kind`. */
const NEED_ACTION = {
  contract: { label: 'Sign', primary: true },
  notice: { label: 'Answer', primary: true },
  statement: { label: 'View', primary: false },
  seats: { label: 'Request seats', primary: false },
};

/**
 * A "Needs you" item as the row draws it: its sentence, and the button that
 * opens its link. A notice is answered on History (board L6, where D136's
 * answer form is), so its button goes there whatever link D798 gave it.
 */
export function needRow(item) {
  const action = NEED_ACTION[item?.kind] || { label: 'Open', primary: false };
  const to = item?.kind === 'notice' ? tabPath('history') : (item?.link || LICENCE_PATH);
  return { title: String(item?.title || ''), to, ...action };
}

/**
 * The count on the Licences row and the Needs you header: D798's own count,
 * or null when nothing was read, which draws no pill rather than a zero.
 */
export function needsCount(needs) {
  if (!needs || needs.available === false) return null;
  if (Number.isInteger(needs.count)) return needs.count;
  return Array.isArray(needs.items) ? needs.items.length : null;
}

/** The statement statuses, as the pill reads them. */
export const STATEMENT_LABEL = { issued: 'Issued', paid: 'Paid', void: 'Void', draft: 'Draft', disputed: 'Disputed' };

/**
 * "What you owe HQ": the latest statement HQ has issued, with its five rows.
 * `null` when there is none; `{ reason }` when the read is HQ's alone (a branch).
 */
export function oweCard(statements) {
  if (!statements) return null;
  if (statements.available === false) return { reason: statements.reason || 'Statements are read on HQ.' };
  const latest = (Array.isArray(statements.statements) ? statements.statements : [])
    .find((s) => s.status !== 'void');
  if (!latest) return { empty: true };
  const c = latest.currency;
  return {
    status: STATEMENT_LABEL[latest.status] || statusLabel(latest.status),
    rows: [
      ['Period', latest.period || NOT_RECORDED],
      ['Gross', money(latest.gross_cents, c)],
      ['Share', percent(latest.revenue_share_bps)],
      ['Owed', money(latest.owed_cents, c)],
      ['Paid', money(latest.paid_cents, c)],
    ],
  };
}

/**
 * "Your contract": the one sent and waiting, and the one in force. `null` while
 * unread; `{ reason }` on a branch, where the contract is HQ's to read.
 */
export function contractCard(contract) {
  if (!contract) return null;
  if (contract.available === false) return { reason: contract.reason || 'The contract is read on HQ.' };
  const title = (c) => `${c.template_title || 'Licence agreement'} v${c.template_version}`;
  const pending = contract.pending;
  const inForce = contract.in_force;
  if (!pending && !inForce) return { title: null, lines: [contract.sign_reason || 'HQ has not drawn a contract for this licence yet'] };
  const lines = [];
  if (pending) lines.push({ tone: 'waiting', text: `Sent ${longDate(pending.sent_at)} · ${contract.sign_url ? 'waiting for your signature' : (contract.sign_reason || 'waiting for a signature')}` });
  if (inForce) lines.push({ tone: pending ? 'muted' : 'ok', text: `${pending ? 'In force: ' : ''}${pending ? `v${inForce.template_version}, ` : ''}signed ${longDate(inForce.signed_at)}` });
  return { title: title(pending || inForce), lines, signUrl: contract.sign_url || null };
}

/** The four seat types, in the canvas's order, with D129's labels. */
export const SEAT_TYPES = [
  ['founder', 'Founder'], ['investor', 'Investor / LP'], ['advisor', 'Advisor'], ['partner', 'Service Partner'],
];

/**
 * The Seats card's bars. `used` is what a branch counts per type
 * (`seats_used_by_type`); on HQ nothing counts it, so `counted` is false and
 * no bar is filled. A licensed figure the copy lacks is null, never zero.
 */
export function seatRows(licence) {
  const licensed = licence?.seats || {};
  const usedByType = licence?.seats_used_by_type && typeof licence.seats_used_by_type === 'object'
    ? licence.seats_used_by_type : null;
  const rows = SEAT_TYPES.map(([key, label]) => {
    const n = Number.isFinite(Number(licensed[key])) && licensed[key] !== null && licensed[key] !== undefined ? Number(licensed[key]) : null;
    const u = usedByType ? usedByType[key] : null;
    const used = u !== null && u !== undefined && Number.isFinite(Number(u)) ? Number(u) : null;
    const pct = used !== null && n ? Math.min(100, Math.round((100 * used) / n)) : 0;
    return { key, label, licensed: n, used, pct, near: used !== null && n ? used * 10 >= n * 9 : false };
  });
  return { counted: usedByType !== null, rows };
}

/** The AI allowance card: the caller's daily and monthly allowance and this month's use, in dollars. */
export function allowanceCard(budget) {
  if (!budget) return null;
  // `Number(null)` is 0, and an allowance nobody recorded is not $0.
  const usd = (micro) => (micro !== null && micro !== undefined && Number.isFinite(Number(micro))
    ? `$${(Number(micro) / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 2 })}` : NOT_RECORDED);
  const month = Number(budget.monthly_microusd);
  const spent = Number(budget.month_spend_microusd);
  const pct = month > 0 && Number.isFinite(spent) ? Math.min(100, Math.round((100 * spent) / month)) : 0;
  return {
    daily: usd(budget.daily_microusd),
    monthly: usd(budget.monthly_microusd),
    used: `${usd(budget.month_spend_microusd)} of ${usd(budget.monthly_microusd)} used this month`,
    pct,
  };
}

/**
 * Board L7's banner for a state other than Active, or null. The Suspended
 * banner names what still works and what is frozen from `lib/branchFreeze.js`
 * on the page itself (D142), so only its title is here.
 */
export function stateBanner(state, licence, { signUrl = null } = {}) {
  if (state === 'pending_activation') {
    return {
      tone: 'amber',
      title: 'Sign your contract to activate',
      detail: 'Your licence becomes Active once you sign the agreement HQ sent you. Members cannot join the territory until then.',
      action: signUrl ? { label: 'Sign', href: signUrl } : { label: 'Open contract', to: tabPath('contract') },
    };
  }
  if (state === 'suspended') {
    return {
      tone: 'rose',
      title: `Suspended by HQ${licence?.suspended_at ? ` since ${longDate(licence.suspended_at)}` : ''}`,
      detail: licence?.status_note || null,
      action: { label: 'Answer the notice', to: tabPath('history') },
    };
  }
  if (state === 'terminated') {
    return {
      tone: 'grey',
      title: `Terminated${licence?.terminated_at ? ` ${longDate(licence.terminated_at)}` : ''} · read-only`,
      detail: 'This licence has ended. You can read every term, statement and notice here.',
      // No account data export exists to link (D800): the canvas's "Export your data" is not drawn.
      action: null,
    };
  }
  return null;
}

/** Board L1's header line: "Exclusive in" only when D797 records the territory as exclusive. */
export function territoryLine(licence, terms = null) {
  const list = Array.isArray(licence?.territories) ? licence.territories : [];
  const lead = terms?.exclusive === 1 ? 'Exclusive in' : terms?.exclusive === 0 ? 'Non-exclusive in' : 'Territory';
  return { lead, codes: list };
}
