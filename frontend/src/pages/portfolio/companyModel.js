/**
 * D4817 part 6 (#5311, canvas PF-06 and addendum PFA01, PFA02, PFA08, PFA09,
 * PFA11): the pure model of one portfolio company's workspace at
 * `/portfolio/companies/:uid` — Overview, Financials, Reports, Support and
 * Activity. No React, no fetch, no clock.
 *
 * It reads only what today's Worker answers for one company:
 *   - `GET /api/positions` — the caller's position in it (cost, rounds,
 *     ownership, the latest mark the book carries);
 *   - `GET /api/positions/:uid` — its rounds, marks and distributions;
 *   - `GET /api/reporting/companies/:uid` — the duties and periods it owes the
 *     caller, and the holding route those duties record (404: owes nothing);
 *   - `GET /api/portfolio/health/:uid` — its health snapshots;
 *   - `GET /api/portfolio-support` — the support ledger, of which this
 *     company's entries and its rollup are kept;
 *   - `GET /api/positions/:uid/activity` (D6227) — the Activity tab's one
 *     joined timeline, merged and paged by the Worker.
 *
 * Each figure is a value, Not recorded with its reason, or Unreadable when its
 * own read failed. A measured zero stays 0. Nothing is joined here that the
 * Worker keeps apart: the Activity timeline is the Worker's own join.
 */

import {
  NOT_RECORDED, UNREADABLE, basisLabel, day, markHistoryOf, markOf, money, multiple, percent,
} from './portfolioModel';
import { COMPANY_UID } from '../cycles/reportingModel';
import { ROUTE_WORDS, companyRows, periodWord, routeOf } from '../investor/portfolioReportsModel';

const isNum = (v) => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));

/* --------------------------------------------------------------- the tabs */

/** The company's five tabs (canvas PF-06), each its own address. */
export const COMPANY_TABS = Object.freeze([
  { id: 'overview', label: 'Overview', path: '' },
  { id: 'financials', label: 'Financials', path: '/financials' },
  { id: 'reports', label: 'Reports', path: '/reports' },
  { id: 'support', label: 'Support', path: '/support' },
  { id: 'activity', label: 'Activity', path: '/activity' },
]);

/** The anchor the old Terms address lands on, inside Financials (addendum PFA02). */
export const OWNERSHIP_ANCHOR = 'ownership-rights';

/**
 * The tab an address names, from its last segment. `terms` is the old Terms
 * address, kept so a saved link still lands (it is replaced by Financials).
 */
export function companyTabOfPath(pathname = '') {
  const m = /\/portfolio\/companies\/[^/]+\/([a-z]+)\/?$/.exec(String(pathname));
  if (!m) return 'overview';
  if (m[1] === 'terms') return 'terms';
  return COMPANY_TABS.some((t) => t.id === m[1]) ? m[1] : 'overview';
}

/** A tab's address, or null for a uid the Worker would never write. */
export function companyTabHref(uid, tab = 'overview') {
  if (!COMPANY_UID.test(String(uid || ''))) return null;
  const t = COMPANY_TABS.find((x) => x.id === tab) || COMPANY_TABS[0];
  return `/portfolio/companies/${encodeURIComponent(uid)}${t.path}`;
}

/**
 * The document title (addendum PFA16). The company's name appears only once
 * an authorised read has named it; until then, and for a company that is not
 * held or could not be read, the title is generic.
 */
export function companyDocTitle(name, tab = 'overview') {
  if (!name) return 'Company · Portfolio · Axal VC';
  const t = COMPANY_TABS.find((x) => x.id === tab);
  return t && t.id !== 'overview' ? `${name} · ${t.label} · Portfolio · Axal VC` : `${name} · Portfolio · Axal VC`;
}

/* -------------------------------------------------------------- the reads */

/** The positions list, whichever key the Worker put it under; null when it carries none. */
export function positionsOf(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.positions)) return value.positions;
  return null;
}

/** What each company read must carry to be read at all. */
export const COMPANY_SHAPES = {
  positions: (v) => positionsOf(v) !== null,
  owed: () => true,
  detail: (v) => Array.isArray(v.rounds) && Array.isArray(v.marks) && Array.isArray(v.distributions),
  health: (v) => Array.isArray(v.history),
  support: (v) => Array.isArray(v.entries) && Array.isArray(v.companies),
  activity: (v) => Array.isArray(v.items) && Array.isArray(v.sources),
};

/** The caller's position in this company from the positions read, or null. */
export function positionIn(read, uid) {
  if (read.state !== 'ok') return null;
  return positionsOf(read.value).find((p) => p?.project?.uid && String(p.project.uid) === String(uid)) || null;
}

/** The company the reporting read names (its duties and periods), or null when it owes the caller nothing. */
export function owedIn(read) {
  return read.state === 'ok' ? read.value?.company || null : null;
}

/**
 * Who this company is to the caller (addendum PFA09):
 *   loading      a read that decides it has not answered;
 *   unreadable   the positions read failed and no duty names the company, or
 *                the reporting read failed and no position does: Unreadable,
 *                never "not held";
 *   not_held     both answered and neither names it (or the uid is malformed);
 *   held         a position, a duty, or both, name it.
 */
export function identityOf(uid, positions, owed) {
  if (!COMPANY_UID.test(String(uid || ''))) return { state: 'not_held' };
  const position = positionIn(positions, uid);
  const company = owedIn(owed);
  if (position || company) return { state: 'held', position, company, name: position?.project?.name || company?.name || null };
  if (positions.state === 'loading' || owed.state === 'loading') return { state: 'loading' };
  if (positions.state === 'unreadable') return { state: 'unreadable', source: 'positions' };
  if (owed.state === 'unreadable') return { state: 'unreadable', source: 'owed' };
  return { state: 'not_held' };
}

/* ------------------------------------------------------- the holding route */

/**
 * The holding route and the ownership recorded for it (addendum PFA01, PFA03,
 * PFA11). The route is what this company's reporting duties record; the
 * ownership is the caller's latest round's, as recorded.
 */
export function holdingRouteOf(owed, position) {
  const company = owedIn(owed);
  const own = position && isNum(position.latest_ownership_pct) ? `${percent(position.latest_ownership_pct)} ownership as recorded` : null;
  if (owed.state === 'loading') return { state: 'loading', text: null };
  if (owed.state === 'unreadable') return { state: 'unreadable', text: `Holding route: ${UNREADABLE}`, own };
  const route = company ? routeOf(company) : null;
  if (!route) return { state: 'not_recorded', text: `Holding route: ${NOT_RECORDED}`, reason: 'No reporting duty records how this is held.', own };
  if (route === 'mixed') return { state: 'ok', route, text: 'Holding route: several holdings', own };
  return { state: 'ok', route, text: `Holding route: ${ROUTE_WORDS[route] || NOT_RECORDED}`, own };
}

/* ----------------------------------------------------------- the key facts */

const fact = (key, label, rest) => ({ key, label, ...rest });
const unreadable = (key, label, what) => fact(key, label, { state: 'unreadable', value: UNREADABLE, reason: `${what} could not be read.` });
const loading = (key, label) => fact(key, label, { state: 'loading', value: null });
const notRecorded = (key, label, reason) => fact(key, label, { state: 'not_recorded', value: NOT_RECORDED, reason });

/** The support ledger's rollup row for this company, or null. */
export function supportRollupOf(support, uid) {
  if (support.state !== 'ok') return null;
  return support.value.companies.find((c) => c.project_uid && String(c.project_uid) === String(uid)) || null;
}

/**
 * The six key facts under the company's name (canvas PF-06): invested,
 * ownership, latest FMV, multiple, latest report and open support. Each says
 * which read it comes from by the reason it gives when that read fails.
 */
export function keyFactsOf({ positions, owed, support }, uid) {
  const position = positionIn(positions, uid);
  const posFact = (key, label, draw) => {
    if (positions.state === 'loading') return loading(key, label);
    if (positions.state === 'unreadable') return unreadable(key, label, 'Your positions');
    if (!position) return notRecorded(key, label, 'You hold no recorded position in this company.');
    return fact(key, label, draw(position));
  };
  const invested = posFact('invested', 'Invested', (p) => {
    const v = money(p.total_invested);
    if (v == null) return { state: 'not_recorded', value: NOT_RECORDED, reason: 'No cost is recorded on your position.' };
    const n = isNum(p.rounds) ? Number(p.rounds) : null;
    return { state: 'ok', value: v, note: n == null ? 'Gross deployed cost' : `${n} ${n === 1 ? 'round' : 'rounds'} · gross` };
  });
  const ownership = posFact('ownership', 'Ownership', (p) => {
    const v = percent(p.latest_ownership_pct);
    if (v == null) return { state: 'not_recorded', value: NOT_RECORDED, reason: 'No ownership is recorded on your latest round.' };
    return { state: 'ok', value: v, note: p.latest_round ? `Recorded after ${p.latest_round}` : 'As recorded' };
  });
  const fmv = posFact('fmv', 'Latest FMV', (p) => {
    const mark = markOf(p);
    if (mark.kind === 'unusable') return { state: 'not_recorded', value: 'Mark not usable', reason: `${mark.reason} Carried at cost for NAV.` };
    if (mark.kind === 'none') return { state: 'not_recorded', value: NOT_RECORDED, reason: 'No mark is recorded. Carried at cost for NAV.' };
    return { state: 'ok', value: money(p.fmv), note: [mark.date ? `As of ${day(mark.date)}` : 'Undated mark', basisLabel(mark.basis)].filter(Boolean).join(' · ') };
  });
  const moic = posFact('multiple', 'Multiple', (p) => {
    const v = multiple(p.multiple);
    if (v == null) return { state: 'not_recorded', value: NOT_RECORDED, reason: 'No multiple: no cost is recorded.' };
    return { state: 'ok', value: v, note: markOf(p).kind === 'marked' ? 'Carrying value ÷ invested · gross' : 'At cost: no usable mark' };
  });

  let report;
  if (owed.state === 'loading') report = loading('report', 'Latest report');
  else if (owed.state === 'unreadable') report = unreadable('report', 'Latest report', 'The reports owed to you');
  else {
    const company = owedIn(owed);
    if (!company) report = notRecorded('report', 'Latest report', 'This company owes you no report under a document you signed.');
    else {
      const row = companyRows([company], position ? [position] : [])[0];
      const open = row.state && !['sent', 'none'].includes(row.state.key) ? `${row.next?.label || 'A period'} · ${row.state.text}` : null;
      report = row.last
        ? fact('report', 'Latest report', { state: 'ok', value: row.last.label, note: [`Received ${row.last.on}`, open].filter(Boolean).join(' · ') })
        : fact('report', 'Latest report', { state: 'not_recorded', value: NOT_RECORDED, reason: open ? `No report received yet · ${open}` : 'No report received yet.' });
    }
  }

  let supportFact;
  if (support.state === 'loading') supportFact = loading('support', 'Open support');
  else if (support.state === 'unreadable' || support.value.page_state === 'unreadable') supportFact = unreadable('support', 'Open support', 'The support ledger');
  else {
    const row = supportRollupOf(support, uid);
    supportFact = row
      ? fact('support', 'Open support', { state: 'ok', value: String(Number(row.promised) || 0), note: `Promised · ${Number(row.delivered) || 0} delivered` })
      : notRecorded('support', 'Open support', 'This company is not in your support ledger.');
  }
  return [invested, ownership, fmv, moic, report, supportFact];
}

/* ------------------------------------------------------------------ health */

const BADGE = { red: 'Attention', yellow: 'Watch', green: 'Healthy' };

/** The company's health from its own snapshot history: `{ state, date, stale, ageDays, intervention, reason }`. */
export function companyHealthOf(read) {
  if (read.state === 'loading') return { state: 'loading' };
  if (read.state !== 'ok') return { state: 'Unreadable', reason: 'Health could not be read.' };
  const latest = read.value.latest || read.value.history[0] || null;
  if (!latest) return { state: 'Not recorded', reason: 'No health snapshot is recorded for this company.' };
  const state = BADGE[latest.badge];
  if (!state) return { state: 'Not recorded', reason: 'The snapshot carries no badge.' };
  return {
    state,
    date: latest.snapshot_date || null,
    stale: latest.stale === true,
    ageDays: isNum(latest.age_days) ? Number(latest.age_days) : null,
    intervention: Boolean(latest.intervention),
  };
}

/**
 * Why the company reads as it does (canvas PF-06 A "Why Attention"): one line
 * per piece of evidence a read recorded, with its date. A source that failed
 * adds an Unreadable line rather than nothing.
 */
export function evidenceOf({ health, positions, owed }, uid) {
  const lines = [];
  const h = companyHealthOf(health);
  if (h.state === 'Unreadable') lines.push({ key: 'health', label: 'Health', text: 'Unreadable · the health snapshots could not be read', state: 'unreadable' });
  else if (h.state === 'Not recorded') lines.push({ key: 'health', label: 'Health', text: h.reason, state: 'not_recorded' });
  else if (h.state !== 'loading') {
    lines.push({ key: 'health', label: 'Health', text: `${h.state} in the snapshot of ${day(h.date) || 'an undated day'}${h.intervention ? ' · flagged for intervention' : ''}${h.stale ? ` · stale${h.ageDays != null ? `, ${h.ageDays} days old` : ''}` : ''}`, state: 'ok' });
  }
  const position = positionIn(positions, uid);
  if (positions.state === 'unreadable') lines.push({ key: 'mark', label: 'Mark', text: 'Unreadable · your positions could not be read', state: 'unreadable' });
  else if (position) {
    const mark = markOf(position);
    if (mark.kind === 'marked') {
      const below = position.marked_down === true || (isNum(position.multiple) && Number(position.multiple) < 1);
      lines.push({ key: 'mark', label: 'Mark', text: `${below ? 'Below cost' : 'Latest mark'} · ${money(position.fmv)} as of ${day(mark.date) || 'an undated day'}${mark.basis ? ` · ${basisLabel(mark.basis)}` : ''}`, state: 'ok' });
    } else lines.push({ key: 'mark', label: 'Mark', text: mark.kind === 'unusable' ? `Mark not usable · ${mark.reason}` : 'No mark recorded · carried at cost', state: 'not_recorded' });
  }
  if (owed.state === 'unreadable') lines.push({ key: 'report', label: 'Reporting', text: 'Unreadable · the reports owed to you could not be read', state: 'unreadable' });
  else {
    const company = owedIn(owed);
    if (company) {
      const row = companyRows([company], position ? [position] : [])[0];
      if (row.state && ['late', 'missing'].includes(row.state.key)) {
        lines.push({ key: 'report', label: 'Reporting', text: `${row.next?.kind || 'Report'} · ${row.state.text}${row.state.expected ? ` · expected ${row.state.expected}` : ''}`, state: 'ok' });
      } else if (row.last) lines.push({ key: 'report', label: 'Reporting', text: `Last received ${row.last.label} · ${row.last.on}`, state: 'ok' });
    }
  }
  return { health: h, lines };
}

/** Next actions on the Overview (canvas PF-06 A), each one a door to the tab that holds it. */
export function nextActionsOf({ owed, support }, uid) {
  const actions = [];
  const company = owedIn(owed);
  if (company) {
    const asks = (company.periods || []).filter((p) => ['late', 'missing'].includes(p.state) && !p.asked);
    for (const p of asks.slice(0, 2)) {
      actions.push({ key: `ask-${p.uid}`, title: `${periodWord(p.label)} report ${p.state === 'missing' ? 'missing' : `late · ${p.days_late} ${p.days_late === 1 ? 'day' : 'days'}`}`, sub: 'You can ask the company for it on Reports.', tab: 'reports', cta: 'Open Reports' });
    }
  }
  if (support.state === 'ok') {
    const open = support.value.entries.filter((e) => String(e.project_uid) === String(uid) && e.state === 'promised');
    for (const e of open.slice(0, 2)) {
      actions.push({ key: `support-${e.uid}`, title: e.summary || 'Promised support', sub: `Promised ${day(e.promised_at || e.created_at) || 'on an undated day'}`, tab: 'support', cta: 'Open Support' });
    }
  }
  return actions;
}

/* -------------------------------------------------------------- financials */

/** The investment history (canvas PF-06 B), oldest first, with its total. */
export function roundsOf(detail) {
  const rounds = (detail?.rounds || []).slice().sort((a, b) => String(a.position_date || a.created_at || '').localeCompare(String(b.position_date || b.created_at || '')));
  const rows = rounds.map((r, i) => ({
    key: r.uid || `round-${i}`,
    date: day(r.position_date) || null,
    round: r.round_name || null,
    amount: money(r.invested_amount),
    ownership: percent(r.ownership_pct),
    shares: isNum(r.shares) ? Number(r.shares).toLocaleString('en-US') : null,
    price: isNum(r.price_per_share) ? money(r.price_per_share) : null,
  }));
  const known = rounds.filter((r) => isNum(r.invested_amount));
  const last = rounds.length ? rounds[rounds.length - 1] : null;
  return {
    rows,
    total: rows.length ? {
      amount: money(known.reduce((s, r) => s + Number(r.invested_amount), 0)),
      missing: rounds.length - known.length,
      ownership: last ? percent(last.ownership_pct) : null,
    } : null,
  };
}

/** The realisations recorded against the company (canvas PF-06 B), newest first. */
export function distributionsOf(detail) {
  return (detail?.distributions || []).slice()
    .sort((a, b) => String(b.distribution_date || '').localeCompare(String(a.distribution_date || '')))
    .map((d, i) => ({ key: d.uid || `dist-${i}`, date: day(d.distribution_date), amount: money(d.amount), kind: d.kind || null, note: d.note || null }));
}

/**
 * The return card (canvas PF-06 B): the multiple, distributions, IRR and the
 * marks behind them. A company with no distribution recorded reads $0 —
 * the read answered and holds none — and says so; a per-company IRR is not
 * computed by the platform, so it reads Not recorded with that reason.
 */
export function returnOf(detail) {
  const roll = detail?.rollup || {};
  const marks = markHistoryOf(detail, { date: null });
  const dists = detail?.distributions || [];
  const moic = multiple(roll.multiple);
  const latest = marks.rows[0] || null;
  return [
    moic == null
      ? { key: 'moic', label: 'Multiple · gross', state: 'not_recorded', value: NOT_RECORDED, reason: 'No multiple: no cost is recorded.' }
      : { key: 'moic', label: 'Multiple · gross', state: 'ok', value: moic, note: roll.unmarked ? 'At cost: no usable mark' : 'Latest mark ÷ invested' },
    { key: 'distributed', label: 'Distributions', state: 'ok', value: money(isNum(roll.distributed) ? roll.distributed : dists.reduce((s, d) => s + (Number(d.amount) || 0), 0)) || '$0', note: dists.length ? `${dists.length} recorded` : 'None recorded' },
    { key: 'irr', label: 'IRR', state: 'not_recorded', value: NOT_RECORDED, reason: 'A per-company IRR is not computed by the platform.' },
    { key: 'coverage', label: 'Marks', state: marks.rows.length ? 'ok' : 'not_recorded', value: marks.rows.length ? String(marks.rows.length) : NOT_RECORDED, note: latest ? `Latest ${latest.date || 'undated'}` : undefined, reason: marks.rows.length ? undefined : 'No mark is recorded. The position carries at cost.' },
  ];
}

/* ----------------------------------------------------------------- support */

export const SUPPORT_STATE_WORDS = Object.freeze({ promised: 'Promised', delivered: 'Delivered', withdrawn: 'Withdrawn' });

/**
 * This company's support (canvas PF-06 D): its entries on the ledger page the
 * Worker returned, and how many of its entries that page leaves out (the
 * rollup counts every entry; the page is the newest of the whole ledger).
 */
export function supportOf(support, uid) {
  if (support.state !== 'ok') return { state: support.state };
  const s = support.value;
  const entries = s.entries.filter((e) => e.project_uid && String(e.project_uid) === String(uid)).map((e) => ({
    key: e.uid,
    uid: e.uid,
    summary: e.summary || null,
    kind: e.kind ? String(e.kind).replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : null,
    state: SUPPORT_STATE_WORDS[e.state] || NOT_RECORDED,
    stateKey: e.state,
    promised: day(e.promised_at || e.created_at),
    delivered: day(e.delivered_at),
    withdrawn: day(e.withdrawn_at),
    hours: isNum(e.hours) ? `${Number(e.hours)} h` : null,
    outcome: e.outcome || null,
  }));
  const rollup = supportRollupOf(support, uid);
  const total = rollup ? Number(rollup.entries) || 0 : entries.length;
  const totals = s.page_state === 'unreadable' || !rollup ? null : { promised: Number(rollup.promised) || 0, delivered: Number(rollup.delivered) || 0, withdrawn: Number(rollup.withdrawn) || 0, hours: Number(rollup.hours) || 0, withoutHours: Number(rollup.entries_without_hours) || 0 };
  return { state: 'ok', entries, total, beyondPage: Math.max(0, total - entries.length), inLedger: Boolean(rollup), totals, figuresUnreadable: s.page_state === 'unreadable' };
}

/* ---------------------------------------------------------------- activity */

/**
 * D6227 (#6227): the company's joined activity, from `GET /api/positions/:uid/
 * activity`. The Worker merges the sources newest first and pages them; each
 * source answers `ok`, `failed` or `not_in_scope`. A failed source is named
 * with its own Retry and is never read as "nothing happened".
 *
 * The Activity switch groups the sources: Financial (investments, marks,
 * distributions), Reports (reports received and corrected, your asks and
 * waivers) and Support.
 */
export const ACTIVITY_GROUPS = Object.freeze({
  financial: ['investments', 'marks', 'distributions'],
  reports: ['reports', 'requests'],
  support: ['support'],
});

export const ACTIVITY_SOURCE_WORDS = Object.freeze({
  investments: 'Investments',
  marks: 'Valuation marks',
  distributions: 'Distributions',
  reports: 'Reports received',
  requests: 'Your asks and waivers',
  support: 'Support',
});

/** One row as the timeline draws it: its day, its label and any amount. */
export function activityRow(item) {
  const amount = isNum(item?.amount) ? money(item.amount) : null;
  return {
    key: String(item?.id ?? ''),
    date: day(item?.at) || null,
    source: item?.source || null,
    text: `${item?.label || NOT_RECORDED}${amount ? ` · ${amount}` : ''}`,
    href: item?.link?.href || null,
  };
}

/**
 * The timeline for one group (`all`, `financial`, `reports`, `support`):
 * its rows (the first page plus any older pages read since), the sources in
 * the group that failed or are out of scope, and whether every source in the
 * group answered.
 */
export function activityOf(read, group = 'all', older = []) {
  if (!read || read.state !== 'ok') return { state: read?.state || 'loading' };
  const v = read.value;
  const want = group === 'all' ? null : new Set(ACTIVITY_GROUPS[group] || []);
  const inGroup = (s) => !want || want.has(s);
  const sources = (v.sources || []).filter((s) => inGroup(s.source));
  const failed = sources.filter((s) => s.state === 'failed').map((s) => ({ source: s.source, what: ACTIVITY_SOURCE_WORDS[s.source] || s.source }));
  const outOfScope = sources.filter((s) => s.state === 'not_in_scope').map((s) => ({ source: s.source, what: ACTIVITY_SOURCE_WORDS[s.source] || s.source, reason: s.reason || null }));
  const rows = [...(v.items || []), ...older].filter((x) => inGroup(x.source)).map(activityRow);
  return { state: 'ok', rows, failed, outOfScope, complete: failed.length === 0 };
}
