/**
 * D6129 (#6129, canvas D6126 SM16 to SM27): the pure rules behind Investor
 * Studio home v2's five modules: Needs you, Funds, Returns, Thesis fit on live
 * deals and Arrivals. No React, no fetch and no clock: `today` (YYYY-MM-DD) is
 * always handed in, so the same reads always draw the same rows.
 *
 * Every figure is one of three things, never folded together: a value (a
 * measured 0 included), Not recorded with its reason, or Unreadable when its
 * read failed. Nothing here invents a date, a score or a ranking.
 */
import { commitmentsByFund } from '../../lib/lpCommitmentModel';
import { waitingOn } from '../../lib/trustCenter';
import { requirementLabel } from '../trust/memberTrustModel';
import { canSignBooklet } from '../../lib/bookletSigning';
import { RETURN_REASONS, money, multiple, rate } from '../portfolio/portfolioModel';
import { formatMinor, toMajorString } from '../../lib/money';

export const LP_WORKSPACE = '/spinout-lab/investor-workspace';
export const COMMITMENT = LP_WORKSPACE + '#my-commitment';
export const NOTICES = LP_WORKSPACE + '#my-notices';
export const BOOKLET = LP_WORKSPACE + '#subscription-booklet';
/** D8731 (#8731): Axal VC Fund › Fund and terms, the fund brief every investor may read. */
export const FUND_TERMS = LP_WORKSPACE + '#fund';
/** D8731: router state a Studio card link carries, so the destination can offer ‹ Studio on phone. */
export const FROM_STUDIO = { from: 'studio' };
export const INBOX = '/inbox';

/* ------------------------------------------------------------------ dates */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The calendar day of a stamp (`2026-11-20`, `2026-11-20T…`, `2026-11-20 10:00:00`), or null. */
export function isoDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  return d.getUTCMonth() === Number(m[2]) - 1 ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** `2026-11-20` → `Fri 20 Nov`, read in UTC; with `year`, `Fri 20 Nov 2026`. Null for anything else. */
export function shortDay(value, { year = false } = {}) {
  const iso = isoDay(value);
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD), or null. */
export function daysFrom(from, to) {
  const a = isoDay(from);
  const b = isoDay(to);
  if (!a || !b) return null;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// Cent amounts go through lib/money (D5373): exact decimal text, never a float division.
const cents = (c) => (c == null ? null : formatMinor(Number(c), 'USD', { locale: 'en-US', trimWhole: true }));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* -------------------------------------------------------------- Needs you */

/**
 * Each source's state for Needs you: loading, unreadable (a failed read, or an
 * answer in a shape the module cannot read), or ready.
 */
export function needsSources(records = {}, failures = {}) {
  const { fund, notices, trust, booklet, inbox } = records;
  return {
    fund: { unreadable: !!failures.fund || (fund != null && !Array.isArray(fund?.lp_holdings)), loading: fund === undefined && !failures.fund },
    notices: { unreadable: !!failures.notices || (notices != null && !Array.isArray(notices?.notices)), loading: notices === undefined && !failures.notices },
    trust: { unreadable: !!failures.trust || (trust != null && !Array.isArray(trust?.obligations)), loading: trust === undefined && !failures.trust },
    booklet: {
      unreadable: !!failures.booklet || (booklet != null && (!['open', 'submitted', 'withdrawn'].includes(booklet.status) || (booklet.status === 'submitted' && !booklet.signing?.state))),
      loading: booklet === undefined && !failures.booklet,
    },
    inbox: { unreadable: !!failures.inbox || (inbox != null && !Number.isSafeInteger(inbox?.count)), loading: inbox === undefined && !failures.inbox },
  };
}

/** The date cell of a row: overdue in words, due, expires, added, or said not recorded. */
function dateOf(row, today) {
  if (row.due) {
    const late = daysFrom(row.due, today);
    if (row.kind === 'call' && late != null && late > 0) return { overdue: true, text: `Overdue by ${plural(late, 'day')}` };
    const ahead = late == null ? null : -late;
    return { text: `${row.dueWord} ${shortDay(row.due)}`, sub: ahead == null ? null : ahead === 0 ? 'today' : ahead > 0 ? `in ${plural(ahead, 'day')}` : null };
  }
  if (row.noDue) return { missing: true, text: row.noDue };
  if (row.added && row.addedWord) return { text: `${row.addedWord} ${shortDay(row.added)}` };
  return null;
}

/**
 * Needs you's rows, ordered by due date, then date added (SM17). A row with
 * no due date sorts after every dated row; the inbox row is always last.
 */
export function needsYouRows(records = {}, failures = {}, today) {
  const sources = needsSources(records, failures);
  const { fund, notices, trust, booklet, inbox } = records;
  const holdings = sources.fund.unreadable || sources.fund.loading ? [] : commitmentsByFund(fund, today);
  const fundName = (id) => holdings.find((h) => h.fund_id === Number(id))?.fund_name || null;
  const callsUnreadable = holdings.some((h) => !h.calls_known);
  const rows = [];
  const unlinked = !sources.fund.unreadable && fund?.unlinked_commitment === true;
  // D8731: the label names the heading it opens; the plain lp-portal read there links the row.
  if (unlinked) rows.push({ key: 'link-lp', kind: 'link', title: 'Link your commitment in Axal VC Fund', detail: 'A commitment under your email is not linked to this account yet.', action: { label: 'Link my commitment', to: COMMITMENT } });

  const seen = new Set();
  for (const h of holdings) {
    for (const call of h.calls) {
      if (call.limited_partner_id != null && call.limited_partner_id !== h.lp_id) continue;
      if (seen.has(call.id) || call.status === 'paid' || !(call.outstanding_cents > 0)) continue;
      seen.add(call.id);
      const notice = (Array.isArray(notices?.notices) ? notices.notices : []).find((n) => !n.superseded && n.type === 'capital_call_notice' && Number(n.fund_id) === h.fund_id && Number(n.limited_partner_id) === h.lp_id && String(n.call_number) === String(call.call_number));
      const pay = call.pay_instructions;
      const received = `${cents(call.received_cents) ?? '$0'} received so far`;
      const detail = pay?.available
        ? `${received} · pay to account ${pay.account_masked || 'not recorded'}, quote ${pay.reference || 'not recorded'}`
        : pay && pay.available === false ? `Payment details are unavailable: ${pay.message || 'the fund has not recorded where to pay.'}` : received;
      rows.push({
        key: `call-${call.id}`, kind: 'call',
        title: `${call.call_number != null ? `Call ${call.call_number}` : 'Capital call'}${h.fund_name ? ` for ${h.fund_name}` : ''}: ${cents(call.outstanding_cents)} due`,
        detail, due: call.due_date, dueWord: 'Due', noDue: 'Due date not recorded', added: call.issued_on,
        action: { label: pay?.available ? 'Pay' : 'Open call', to: notice ? NOTICES : COMMITMENT },
        pay: pay?.available ? {
          title: `Pay ${call.call_number != null ? `Call ${call.call_number}` : 'this call'}${h.fund_name ? ` · ${h.fund_name}` : ''}`,
          lines: [['Amount due', cents(call.outstanding_cents)], ['Received so far', cents(call.received_cents) ?? '$0'], ['Due', shortDay(call.due_date, { year: true }) ?? 'Due date not recorded'], ['Pay to account', pay.account_masked || 'Not recorded'], ['Reference to quote', pay.reference || 'Not recorded']],
        } : null,
      });
    }
    if (!h.lpa_signed) {
      rows.push({ key: `lpa-${h.lp_id}`, kind: 'lpa', title: `LPA to sign${h.fund_name ? ` · ${h.fund_name}` : ''}`, detail: `Your ${cents(h.commitment_cents) ? `${cents(h.commitment_cents)} ` : ''}commitment is recorded; the LPA is not signed`, added: h.committed_on, addedWord: 'Added', action: { label: 'Sign', to: COMMITMENT } });
    }
  }

  if (!sources.notices.unreadable) {
    for (const n of Array.isArray(notices?.notices) ? notices.notices : []) {
      if (n.superseded || n.type === 'capital_call_notice') continue;
      const parts = [n.title || 'Fund notice', fundName(n.fund_id), cents(n.amount_cents)].filter(Boolean);
      const issued = shortDay(n.notice_date || n.created_at);
      rows.push({ key: `notice-${n.uid}`, kind: 'notice', title: parts.join(' · '), detail: issued ? `Fund notice issued to you ${issued}` : 'Fund notice issued to you', due: n.due_date, dueWord: n.type === 'default_notice' ? 'Cure by' : 'Due', added: isoDay(n.notice_date || n.created_at), action: { label: 'Open notice', to: NOTICES } });
    }
  }

  if (!sources.booklet.unreadable && !sources.booklet.loading) {
    if (booklet?.status === 'open') rows.push({ key: 'booklet', kind: 'booklet', title: 'Subscription booklet to finish', detail: 'Open, not yet submitted', action: { label: 'Continue', to: BOOKLET } });
    else if (canSignBooklet(booklet) || booklet?.signing?.state === 'sent') rows.push({ key: 'booklet', kind: 'booklet', title: 'Subscription booklet to sign', detail: 'Submitted, not yet signed', action: { label: 'Sign', to: BOOKLET } });
  }

  if (!sources.trust.unreadable) {
    for (const o of Array.isArray(trust?.obligations) ? trust.obligations : []) {
      if (Number(o.required) !== 1 || waitingOn(o.status) !== 'you' || !o.obligation_key) continue;
      rows.push({ key: `trust-${o.obligation_key}`, kind: 'trust', title: `Trust requirement open: ${requirementLabel(o)}`, detail: 'Required, and waiting on you', due: isoDay(o.expires_at), dueWord: 'Expires', noDue: 'No expiry recorded', added: isoDay(o.created_at), action: { label: 'Open Trust', to: '/trust/me?requirement=' + encodeURIComponent(o.obligation_key) } });
    }
  }

  // Dated rows first, soonest first; then by date added, oldest first; a row with neither last. Stable otherwise.
  const ordered = rows.map((row, i) => ({ row, i })).sort((a, b) => {
    const da = isoDay(a.row.due); const db = isoDay(b.row.due);
    if (da && db && da !== db) return da < db ? -1 : 1;
    if (!!da !== !!db) return da ? -1 : 1;
    const aa = isoDay(a.row.added); const ab = isoDay(b.row.added);
    if (aa && ab && aa !== ab) return aa < ab ? -1 : 1;
    if (!!aa !== !!ab) return aa ? -1 : 1;
    return a.i - b.i;
  }).map(({ row }) => ({ ...row, date: dateOf(row, today) }));

  const unread = sources.inbox.unreadable ? null : inbox?.count;
  if (unread > 0) ordered.push({ key: 'inbox', kind: 'inbox', title: `${unread} unread in your inbox`, detail: 'All kinds of notification, not only fund notices', action: { label: 'Open inbox', to: INBOX }, date: null });

  const incomplete = callsUnreadable || Object.values(sources).some((s) => s.loading || s.unreadable);
  return { rows: ordered, sources, callsUnreadable, incomplete };
}

/* ------------------------------------------------------------------ Funds */

/**
 * One row per fund (SM18), from the LP portal: committed, called, received,
 * due now, uncalled, TVPI, DPI and the LPA, and a total when they add up.
 * A figure the calls read could not support is `unreadable`, never 0.
 */
export function fundsOf(portal, today) {
  const holdings = commitmentsByFund(portal, today);
  const perf = Array.isArray(portal?.performance) ? portal.performance : [];
  const rows = holdings.map((h) => {
    const p = perf.find((row) => Number(row.lp_id) === h.lp_id) || {};
    const paidIn = Number(p.invested_amount ?? (h.invested_cents == null ? NaN : toMajorString(Number(h.invested_cents), 'USD')));
    const noPaidIn = !(paidIn > 0);
    const whole = h.commitment_cents && h.called_cents != null ? Math.max(h.commitment_cents, h.called_cents) : null;
    const pct = (v) => (whole ? Math.max(0, Math.min(100, ((v ?? 0) / whole) * 100)) : null);
    return {
      key: String(h.lp_id),
      name: h.fund_name || 'Fund name not recorded',
      committed: cents(h.commitment_cents),
      called: h.calls_known ? cents(h.called_cents) : null,
      received: h.calls_known ? cents(h.settled_cents) : null,
      due: h.calls_known ? cents(h.due_cents) : null,
      dueCents: h.calls_known ? h.due_cents : null,
      uncalled: h.calls_known ? cents(h.uncalled_cents) : null,
      callsKnown: h.calls_known,
      tvpi: noPaidIn ? null : multiple(p.tvpi ?? h.tvpi),
      dpi: noPaidIn ? null : multiple(p.dpi ?? h.dpi),
      noPaidIn,
      lpa: h.lpa_signed ? { signed: true, on: shortDay(h.lpa_signed_at, { year: true }) } : { signed: false },
      bar: whole == null ? null : { called: pct(h.called_cents), received: pct(h.settled_cents) },
      barLabel: h.calls_known ? `Called ${cents(h.called_cents)} of ${cents(h.commitment_cents) ?? 'an unrecorded commitment'} committed; ${cents(h.settled_cents)} received` : 'Capital calls unreadable',
    };
  });
  const callsKnown = holdings.every((h) => h.calls_known);
  const sum = (key) => (holdings.some((h) => h[key] == null) ? null : holdings.reduce((s, h) => s + h[key], 0));
  const total = holdings.length > 1 ? {
    committed: cents(sum('commitment_cents')),
    called: callsKnown ? cents(sum('called_cents')) : null,
    received: callsKnown ? cents(sum('settled_cents')) : null,
    due: callsKnown ? cents(sum('due_cents')) : null,
    uncalled: callsKnown ? cents(sum('uncalled_cents')) : null,
  } : null;
  return { rows, total, callsKnown, unlinked: portal?.unlinked_commitment === true };
}

/* ---------------------------------------------------------------- Returns */

/** One return figure: a value, Total loss beside −100%, or Not computed with its reason. */
function figure(fig, flat, format) {
  if (fig && fig.state === 'unavailable') return { state: 'not_computed', reason: RETURN_REASONS[fig.reason] || 'The recorded inputs do not define this figure.' };
  if (fig && fig.state === 'total_loss') return { state: 'total_loss', value: '−100%' };
  const value = format(fig ? fig.value : flat);
  return value == null ? { state: 'not_recorded', reason: 'The performance read returned no figure.' } : { state: 'value', value };
}

/**
 * Returns for the accessible book (SM19), from `GET /api/positions/analytics`:
 * gross, dated, and the mark coverage as a sentence.
 */
export function returnsOf(analytics) {
  const a = analytics || {};
  const r = a.returns || {};
  const asked = isoDay(a.as_of);
  const day = shortDay(asked || a.as_of_default, { year: true });
  const count = Number.isSafeInteger(Number(a.position_count)) ? Number(a.position_count) : null;
  const unmarked = Number.isSafeInteger(Number(a.unmarked_position_count)) ? Number(a.unmarked_position_count) : null;
  return {
    heading: `Your accessible book, gross, as at ${day ?? 'the latest read'}${asked ? '' : day ? ' (today’s read)' : ''}`,
    empty: count === 0,
    figures: [
      ['IRR', figure(r.irr, a.irr, rate)],
      ['TVPI', figure(r.tvpi, a.tvpi, multiple)],
      ['MOIC', figure(r.moic ?? r.tvpi, a.moic, multiple)],
      ['DPI', figure(r.dpi, a.dpi, multiple)],
    ],
    flows: [['Paid in', money(a.paid_in)], ['Distributed', money(a.distributed)], ['NAV', money(a.nav)]],
    positions: count,
    coverage: count && unmarked != null
      ? (unmarked === 0 ? `All ${plural(count, 'position')} marked.` : `${count - unmarked} of ${plural(count, 'position')} marked; the rest carry at cost.`)
      : null,
  };
}

/* ------------------------------------------------------------- Thesis fit */

export const FIT_SHOWN = 6;
export const CRITERIA = [['sector', 'Sector'], ['stage', 'Stage'], ['region', 'Region'], ['ticket', 'Ticket']];
export const CRITERION_WORD = { match: 'Match', outside: 'Outside', not_set: 'Not set', not_recorded: 'Not recorded' };
const FLOW_STAGE = { sourcing: 'Sourcing', screening: 'Screening', diligence: 'Diligence', ic: 'IC', commit: 'Commit', closing: 'Closing', portfolio: 'Portfolio' };

/** The flow's live deals (not passed), newest move first, as the Worker ordered them. */
export function liveDeals(flow) {
  return (Array.isArray(flow?.items) ? flow.items : []).filter((i) => i && i.stage !== 'passed' && Number.isSafeInteger(Number(i.deal_id)));
}

/**
 * Thesis fit on live deals (SM20): the first six live deals in the flow, each
 * with four criterion chips and the platform's reasons. No score and no
 * ranking: `score` and `confidence` from the fit read are never used.
 */
export function fitOf(deals) {
  const live = liveDeals(deals?.flow);
  const shown = live.slice(0, FIT_SHOWN);
  const byId = new Map((Array.isArray(deals?.fit?.items) ? deals.fit.items : []).map((f) => [String(f.deal_id), f]));
  const rows = shown.map((d) => {
    const f = byId.get(String(d.deal_id));
    const name = d.venture || 'Venture name not recorded';
    const meta = [d.sector || 'Sector not recorded', FLOW_STAGE[d.stage] || null].filter(Boolean).join(' · ');
    const ask = money(d.ask);
    const base = { key: String(d.deal_id), name, meta, ask: ask ? `Ask ${ask}` : 'Ask not recorded', to: d.can_open ? `/deals/${d.deal_id}` : null };
    if (!f || f.state === 'unavailable') return { ...base, state: 'unavailable' };
    if (f.state === 'unreadable') return { ...base, state: 'unreadable' };
    const criteria = Array.isArray(f.criteria) ? f.criteria : [];
    return {
      ...base,
      state: f.state === 'not_set' ? 'not_set' : 'ready',
      chips: CRITERIA.map(([key, label]) => {
        const c = criteria.find((x) => x.key === key);
        const state = CRITERION_WORD[c?.state] ? c.state : 'not_recorded';
        return { key, label, state, word: CRITERION_WORD[state], reason: c?.reason || 'The fit read returned no reason for this criterion.' };
      }),
    };
  });
  const notSet = rows.length > 0 && rows.filter((r) => r.state !== 'unavailable').every((r) => r.state === 'not_set') && rows.some((r) => r.state === 'not_set');
  return { rows, live: live.length, notSet };
}

/* --------------------------------------------------------------- Arrivals */

export const ARRIVALS_SHOWN = 5;

/**
 * Arrivals (SM21): founder updates, capital statements and fund reports in
 * one list, dated and newest first. No "new" badge: the last visit is not
 * recorded. Each source says when it could not be read.
 */
export function arrivalsOf({ updates, fund, updatesFailed = false, fundFailed = false }) {
  const items = [];
  const unreadable = [];
  if (updatesFailed || (updates != null && !Array.isArray(updates?.items))) unreadable.push('Founder updates');
  else for (const u of updates?.items || []) {
    if (u?.status && u.status !== 'submitted') continue;
    const on = isoDay(u?.submitted_at || u?.published_at);
    items.push({ key: `update-${u.uid || u.id}`, kind: 'update', title: ['Founder update', u?.project?.name || 'Company not recorded', u?.period].filter(Boolean).join(' · '), on, word: 'Submitted', action: { label: 'Open update', to: '/portfolio/updates' } });
  }
  const portalUnreadable = fundFailed || (fund != null && !Array.isArray(fund?.lp_holdings));
  if (portalUnreadable) unreadable.push('Fund statements and reports');
  else if (fund) {
    const names = new Map((fund.lp_holdings || []).map((h) => [Number(h.fund_id), h.fund_name]));
    if (fund.capital_statements_recorded === false) unreadable.push('Capital statements');
    for (const s of Array.isArray(fund.capital_statements) ? fund.capital_statements : []) {
      items.push({ key: `statement-${s.uid}`, kind: 'report', title: ['Capital statement', names.get(Number(s.fund_id)), s.period_label].filter(Boolean).join(' · '), on: isoDay(s.issued_at), word: 'Issued', action: { label: 'Open statement', to: COMMITMENT } });
    }
    for (const p of Array.isArray(fund.report_periods) ? fund.report_periods : []) {
      items.push({ key: `report-${p.id}`, kind: 'report', title: ['Fund report', names.get(Number(p.fund_id)), p.period].filter(Boolean).join(' · '), on: isoDay(p.issued_at), word: 'Issued', action: { label: 'Open report', to: LP_WORKSPACE } });
    }
  }
  // Newest first; an item with no date last, so it is never read as the newest.
  const ordered = items.map((it, i) => ({ it, i })).sort((a, b) => {
    if (a.it.on && b.it.on && a.it.on !== b.it.on) return a.it.on > b.it.on ? -1 : 1;
    if (!!a.it.on !== !!b.it.on) return a.it.on ? -1 : 1;
    return a.i - b.i;
  }).map(({ it }) => ({ ...it, date: it.on ? `${it.word} ${shortDay(it.on)}` : `${it.word}, date not recorded` }));
  return { items: ordered.slice(0, ARRIVALS_SHOWN), total: ordered.length, unreadable };
}

/* ----------------------------------------------------------- Thesis band */

/** The thesis band's chip groups (SM16) from the investor profile; exclusions apart. */
export function thesisGroups(profile) {
  const list = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : []);
  const dollars = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : money(Number(v)));
  const lo = dollars(profile?.ticket_min_usd);
  const hi = dollars(profile?.ticket_max_usd);
  const ticket = lo && hi ? `${lo}–${hi}` : lo ? `From ${lo}` : hi ? `Up to ${hi}` : (profile?.ticket_band ? String(profile.ticket_band) : null);
  const groups = [
    ['Sectors', list(profile?.sectors)],
    ['Stages', list(profile?.stages)],
    ['Regions', list(profile?.geos)],
    ['Ticket', ticket ? [ticket] : []],
  ].filter(([, chips]) => chips.length).map(([label, chips]) => ({ label, chips }));
  const excludes = [...list(profile?.anti_thesis_sectors), ...list(profile?.anti_thesis_stages)];
  return excludes.length ? [...groups, { label: 'Excludes', chips: excludes, excluded: true }] : groups;
}
