/**
 * D714 (#1779) PR 4a — the fund administration console's tabs and words.
 *
 * The console draws every control from the Worker's act table
 * (`GET /api/fund-admin/access`); this file holds only what does not come
 * from a read: the tab order, the sentences the console says itself, and the
 * money and state helpers its tabs share.
 */
import { formatCents } from '../../investor/fundCallsModel.js';

export const BASE = '/admin/fund-admin';

/**
 * D1157 (#2388): the canvas's tabs (FND1–FND15), each at its own address under
 * `/admin/fund-admin`. Funds, LPs and NAV & performance are new; "Management
 * fees" is "Fees"; Reconciliation is a part of Banking.
 */
export const TABS = Object.freeze([
  { key: 'overview', label: 'Overview', path: '' },
  { key: 'funds', label: 'Funds', path: 'funds' },
  { key: 'lps', label: 'LPs', path: 'lps' },
  { key: 'calls', label: 'Capital calls', path: 'calls' },
  { key: 'distributions', label: 'Distributions', path: 'distributions' },
  { key: 'performance', label: 'NAV & performance', path: 'performance' },
  { key: 'fees', label: 'Fees', path: 'fees' },
  { key: 'reports', label: 'Reports', path: 'reports' },
  { key: 'banking', label: 'Banking', path: 'banking' },
]);

/** Banking's three parts (FND15), each at its own address. */
export const BANKING_PARTS = Object.freeze([
  { key: 'banking', label: 'Accounts and transactions', path: 'banking' },
  { key: 'reconciliation', label: 'Reconciliation', path: 'banking/reconciliation' },
  { key: 'books', label: 'Books', path: 'banking/books' },
]);

/** D714's `?tab=` values and where each now lives. */
export const LEGACY_TABS = Object.freeze({
  overview: '', banking: 'banking', reconciliation: 'banking/reconciliation', calls: 'calls', distributions: 'distributions', fees: 'fees', reports: 'reports',
});

/** A `?tab=` value D714 knew, or Overview. */
export function tabFrom(value) {
  return Object.prototype.hasOwnProperty.call(LEGACY_TABS, value) ? value : 'overview';
}

/**
 * The view an address names: a tab's key, or a Banking part's. Anything under
 * a tab's word (`/reports/notices`) is that tab; an unknown word is Overview.
 */
export function viewFrom(pathname) {
  const rest = String(pathname || '').startsWith(BASE) ? String(pathname).slice(BASE.length) : '';
  const [first = '', second = ''] = rest.replace(/^\/+|\/+$/g, '').split('/');
  if (first === 'banking') return second === 'reconciliation' || second === 'books' ? second : 'banking';
  return TABS.some((t) => t.path && t.path === first) ? first : 'overview';
}

/** The tab a view sits under. */
export const tabOfView = (view) => (view === 'reconciliation' || view === 'books' ? 'banking' : view);

/** The only query a tab keeps: the fund filter. */
export function keepFund(search = '') {
  const id = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('fund');
  return id && /^[1-9]\d*$/.test(id) ? `?fund=${id}` : '';
}

/** An address under the console, keeping the fund filter. */
export const viewHref = (path, search = '') => `${BASE}${path ? `/${path}` : ''}${keepFund(search)}`;

/** Where a D714 `?tab=` link now lives, or null when the address has none. */
export function legacyHref(search = '') {
  const tab = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('tab');
  if (tab == null) return null;
  return viewHref(LEGACY_TABS[tabFrom(tab)], search);
}

export const NOT_YET = 'Not read here yet';

/** Why a tab draws no blocks today. Never a zero, never "none". */
export const WAITS = Object.freeze({
  funds: 'Each administered fund with its facts, its economics and New fund are not drawn here yet. The administered funds are listed on Overview, from the overview read.',
  lps: 'No read lists the LPs across funds yet. Each fund\u2019s LPs are read per fund; one view of every LP\u2019s commitment, calls, LPA, identity check and booklet waits for its read.',
  books: 'The books of each administered fund are not drawn here yet. The fund ledger read exists; this part draws it.',
});

/**
 * The canvas's amber count flags on the tabs, from the overview only: overdue
 * call lines on Capital calls, matches to review on Reconciliation, prepared
 * drafts on Reports. A block that is not `ok` flags nothing, never a zero it
 * did not read.
 */
export function tabFlags(overview) {
  const sum = (block, f) => (block?.state === 'ok' && Array.isArray(block.items)
    ? block.items.reduce((n, x) => n + (Number.isSafeInteger(Number(f(x))) ? Number(f(x)) : 0), 0) : 0);
  return {
    calls: sum(overview?.funds, (f) => f.overdue_lines),
    reconciliation: sum(overview?.matches, (m) => Number(m.proposed || 0) + Number(m.needs_review || 0)),
    reports: sum(overview?.drafts, (d) => d.prepared),
  };
}

/** FND20a, in the canvas's words (D1160): the title and its line, said together. */
export const HQ_ONLY = 'Fund administration runs on HQ. Axal VC’s funds and entity accounts are not administered from a branch.';
export const PAYMENT_INSTRUCTIONS_ADMIN = 'Only the Super Admin can see or change payment instructions.';
export const PAYMENT_INSTRUCTIONS_LINK = { text: 'Payment instructions', href: '/admin/platform/bank-accounts' };
export const NO_FUND = 'No administered fund is recorded. A fund whose general partner of record is an outside GP is run from its own fund page.';
export const REJECT_REASON_MIN = 10;

/** Integer cents as dollars, or null for a value that is not a whole number of cents. */
export const money = (cents) => formatCents(cents);

/**
 * `{ cents, reason }` from `/api/admin/mercury/accounts` as a phrase: the
 * amount, "Unreadable" for a read that failed, else "Not recorded". Never 0.
 */
export function balanceText(value) {
  if (value && value.cents != null) return money(value.cents) ?? 'Not recorded';
  return value?.reason === 'unreadable' ? 'Unreadable' : 'Not recorded';
}

/** An account by its last four only. */
export const ending = (lastFour) => (lastFour ? `ending ${lastFour}` : 'ending not recorded');

/** The act table's row for `act`, or null. */
export function actRow(access, act) {
  return Array.isArray(access?.acts) ? access.acts.find((a) => a?.act === act) || null : null;
}

/** The administered funds the overview's funds block lists, as `{ id, name }`. */
export function administeredFunds(overview) {
  const items = overview?.funds?.state === 'ok' && Array.isArray(overview.funds.items) ? overview.funds.items : [];
  return items.map((f) => ({ id: Number(f.fund_id), name: f.name || `Fund #${f.fund_id}` }));
}

/** The fund `?fund=` names among `funds`, else the first. */
export function pickFund(funds, wanted) {
  if (!Array.isArray(funds) || funds.length === 0) return null;
  return funds.find((f) => String(f.id) === String(wanted ?? '')) || funds[0];
}

/** A quarter as #1774 writes it: `2026Q3`. */
export const QUARTER_RE = /^\d{4}Q[1-4]$/;

/**
 * D749 (#1838): why a credit is not ours, as `[key, label]` in the Worker's
 * order (`services/mercury/notOurs.ts`). The canvas may rename a label; the
 * keys stay.
 */
export const NOT_OURS_REASONS = Object.freeze([
  ['not_fund_transaction', 'Not a fund transaction'],
  ['other_entity', 'Belongs to another entity'],
  ['duplicate', 'Duplicate'],
  ['other', 'Other'],
]);
export const NOT_OURS_NOTE_MAX = 500;

/** A mark as a pill: "Not ours · Duplicate", or "Not ours · needs review" after the line changed. */
export function notOursText(mark) {
  if (!mark) return null;
  if (mark.state === 'needs_review') return 'Not ours · needs review';
  const label = NOT_OURS_REASONS.find(([k]) => k === mark.reason)?.[1];
  return label ? `Not ours · ${label}` : 'Not ours';
}

/** A refusal's own sentence, else the fallback. */
export function refusalText(e, fallback) {
  const msg = typeof e?.message === 'string' ? e.message.trim() : '';
  return msg || fallback;
}

// ─────────────────────────────────────────────────────────── D1160: the header (FND1, FND2, FND16, FND20)

export const TITLE = 'Fund administration';
/** The canvas's muted line under the title. */
export const LINE = 'Run the Axal VC funds: LPs, capital calls, distributions, NAV, fees, reports and cash. Admins prepare; the Super Admin issues.';
/** FND16: the notice `/funds` and `/funds/performance` add when they forward an admin here. */
export const MOVED_KEY = 'fund-ops';
export const MOVED_NOTICE = 'Fund Ops is now Fund administration, under Fund admin.';
export const MOVED_NOTICES = Object.freeze({ [MOVED_KEY]: MOVED_NOTICE });

/** Where an admin's old Fund Ops address forwards, keeping its query and hash and adding the notice. */
export function fundOpsTarget(pathname, search = '', hash = '') {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  params.delete('moved');
  params.set('moved', MOVED_KEY);
  const to = String(pathname || '').replace(/\/+$/, '') === '/funds/performance' ? `${BASE}/performance` : BASE;
  return `${to}?${params}${hash || ''}`;
}

/** The tabs that act on one administered fund, chosen by `?fund=`. */
export const PER_FUND = Object.freeze(['calls', 'distributions', 'fees', 'reports']);

/**
 * The fund filter (FND2): All funds, then each administered fund. On a tab
 * that acts on one fund, All funds is not offered and the chosen fund is the
 * one `?fund=` names, else the first, as the tab reads it. Elsewhere the
 * filter is kept in the address for the next tab and the tab says it shows
 * every fund.
 */
export function fundFilter(funds, search, view) {
  const wanted = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('fund');
  const perFund = PER_FUND.includes(view);
  const chosen = perFund ? pickFund(funds, wanted) : (funds || []).find((f) => String(f.id) === String(wanted ?? '')) || null;
  return {
    perFund,
    pills: [...(perFund ? [] : [{ key: 'all', label: 'All funds', id: null, on: !chosen }]),
      ...(funds || []).map((f) => ({ key: `f-${f.id}`, label: f.name, id: f.id, on: chosen?.id === f.id }))],
    note: !perFund && view !== 'reportPacks' && chosen ? FILTER_KEPT : null,
  };
}
export const FILTER_KEPT = 'This tab shows every fund. The filter is kept for Capital calls, Distributions, Fees and Reports.';

/** An address under the console with the fund filter set (or cleared, for All funds), keeping the path. */
export function withFund(pathname, search, id) {
  const p = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  p.delete('moved');
  if (id == null) p.delete('fund'); else p.set('fund', String(id));
  const q = p.toString();
  return `${pathname}${q ? `?${q}` : ''}`;
}

/**
 * Each tab's count (FND1): a number that was read, a dash with its reason, or
 * the amber flag with what waits. Never a zero for a value no read gives.
 */
export function tabCounts(overview) {
  const ok = overview?.funds?.state === 'ok' && Array.isArray(overview.funds.items);
  const flags = tabFlags(overview);
  const flag = (n, key) => (n > 0 ? { kind: 'flag', value: n, testId: `fund-admin-flag-${key}` } : null);
  return {
    funds: ok ? { kind: 'num', value: overview.funds.items.length } : overview ? { kind: 'dash', tip: 'The administered funds could not be read.' } : { kind: 'load' },
    lps: { kind: 'dash', tip: 'Not read here yet: no read lists the LPs across funds.' },
    calls: flag(flags.calls, 'calls'),
    reports: flag(flags.reports, 'reports'),
    // D1157: Reconciliation is a part of Banking, so its matches flag the Banking tab.
    banking: flag(flags.reconciliation, 'banking'),
  };
}

/**
 * The header's one primary button (FND1), named by the act table: the
 * Super Admin, whom it allows to issue, sees "New capital call"; an Admin,
 * "Preview a capital call". Each opens where the act is taken today. A tab
 * whose act has no page yet (New fund, Add LP, Record a mark, Sync now) has
 * none until its part draws it.
 */
export function headerPrimary(view, access, fund) {
  const may = (act) => actRow(access, act)?.allowed === true;
  const tab = tabOfView(view);
  if (tab === 'overview' || tab === 'calls') {
    return { label: may('capital_call.issue') ? 'New capital call' : 'Preview a capital call', to: fund ? `/funds/calls?fund=${fund.id}` : `${BASE}/calls` };
  }
  if (tab === 'distributions') return { label: may('distribution.execute') ? 'New distribution' : 'Preview a distribution', to: `${BASE}/distributions${fund ? `?fund=${fund.id}` : ''}#distribution-form` };
  if (tab === 'fees') return { label: 'Preview period', to: `${BASE}/fees${fund ? `?fund=${fund.id}` : ''}#fee-prepare` };
  return null;
}

/** The More menu (FND1): HQ › Funds for the Super Admin, LP applications, and Export. */
export function moreItems(access) {
  return [
    ...(access?.super_admin === true ? [{ key: 'hq-funds', label: 'All deployments’ funds (HQ › Funds)', to: '/admin/funds' }] : []),
    { key: 'lp-applications', label: 'LP applications (Approvals)', to: '/admin/lp-applications' },
    { key: 'export', label: 'Export the funds (CSV)' },
  ];
}

/**
 * Export (FND1): the overview's administered funds as CSV, made in the
 * browser from the read on the page. A block that did not read is written
 * with its state, never as zeros; money stays in whole cents as stored.
 */
export function fundsCsv(overview) {
  const cell = (v) => {
    const s = v == null ? 'Not recorded' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Fund', 'Committed (cents)', 'Called (cents)', 'Received (cents)', 'Outstanding (cents)', 'Overdue lines', 'Next due'];
  if (overview?.funds?.state !== 'ok' || !Array.isArray(overview.funds.items)) {
    return `${head.map(cell).join(',')}\n${cell(`The administered funds could not be read (${overview?.funds?.state || 'not read'}).`)}\n`;
  }
  const rows = overview.funds.items.map((f) => [f.name || `Fund #${f.fund_id}`, f.committed_cents, f.called_cents, f.received_cents, f.outstanding_cents, f.overdue_lines, f.next_due_date]);
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

/** The profile pill (FND1): who the act table says this viewer is, or none until it reads. */
export function profilePill(access) {
  if (!access) return null;
  return access.super_admin === true ? { label: 'Super Admin', tone: 'held' } : { label: 'Admin', tone: 'hq' };
}

/** FND20: the three refusals, in the canvas's words. */
export const REFUSALS = Object.freeze({
  branch: { title: HQ_ONLY.split('. ')[0] + '.', line: HQ_ONLY.split('. ').slice(1).join('. '), action: { label: 'Go to Studio', to: '/studio' } },
  support: { title: 'A support session cannot read fund administration.', line: 'End the support session in the bar above to return to your own admin account.' },
  member: { title: 'This page is for studio admins.', line: 'Fund administration is run by HQ’s admins.', action: { label: 'Go to your home' } },
});
