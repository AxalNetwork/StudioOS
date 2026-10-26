/**
 * D1235 (#3243) — KYC part 7: the rules behind Renewals (KYC9), Audit (KYC10),
 * the renewal periods (KYC17c) and the export (KYC17d, KYC14b), over part 4's
 * reads (D1232, `lib/api/kycGovernance.js` on `routes/kyc_governance.ts`).
 * Pure, so `frontend/test/kyc_governance_d1235.test.mjs` holds each rule.
 *
 * NEVER A ZERO FOR A MISSING VALUE. A count the read did not return is null
 * here, and the page says "Not recorded" with the read's own reason. A 0 is
 * drawn only when the Worker counted and found none.
 */
import { isSuperAdminUser, branchOfUser } from '../../../lib/shellRole';
import { statusWord } from './kycModel';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

/** A stamp the Worker wrote (ISO, or SQL's `YYYY-MM-DD HH:MM:SS`, read as UTC) in ms, or NaN. */
export function stampMs(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) return Date.parse(`${s.replace(' ', 'T')}Z`);
  return Date.parse(s);
}

/** `2 Nov 2026`, or null when the stamp does not read as a date. */
export function dayLabel(raw) {
  const t = stampMs(raw);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `21 Oct 2026 10:45`, the audit's When. */
export function minuteLabel(raw) {
  const t = stampMs(raw);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const two = (n) => String(n).padStart(2, '0');
  return `${dayLabel(raw)} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const isCount = (n) => Number.isInteger(n) && n >= 0;

/* ------------------------------------------------------------------ *
 * KYC9 — Renewals
 * ------------------------------------------------------------------ */

/** The chips, in the canvas's order. The Worker filters by these three; "Re-checks asked" has no filter, so it is a tile only. */
export const RENEWAL_FILTERS = Object.freeze([
  { key: 'soon', label: 'Expire in 30 days' },
  { key: 'expired', label: 'Expired' },
  { key: 'all', label: 'All' },
]);

/** The chip's count, from the read's counts; null when the read did not give it. */
export function renewalChipCount(counts, key) {
  if (!counts) return null;
  const n = key === 'soon' ? counts.expire_30?.count : key === 'expired' ? counts.expired : counts.all;
  return isCount(n) ? n : null;
}

/**
 * The four tiles (KYC9). `value` is null when the read did not count it, and
 * `sub` then carries the read's own reason.
 */
export function renewalTiles(counts) {
  const c = counts || {};
  const soon = isCount(c.expire_30?.count) ? c.expire_30.count : null;
  const next = dayLabel(c.expire_30?.next);
  const re = c.rechecks || {};
  const sc = c.screened_over_12 || {};
  return [
    { key: 'expire_30', label: 'Expire in 30 days', value: soon,
      sub: soon == null ? 'Not returned by the read.' : next ? `Next: ${next}` : 'None in the next 30 days.' },
    { key: 'expired', label: 'Expired', value: isCount(c.expired) ? c.expired : null,
      sub: isCount(c.expired) ? 'Listed first in the table.' : 'Not returned by the read.' },
    { key: 'rechecks', label: 'Re-checks asked, not done', value: re.recorded && isCount(re.count) ? re.count : null,
      sub: re.recorded ? (re.oldest ? `Oldest asked ${dayLabel(re.oldest) ?? 'on a date not recorded'}` : 'None open.') : (re.reason || 'Not returned by the read.') },
    { key: 'screened', label: 'Screened over 12 months ago', value: sc.recorded && isCount(sc.count) ? sc.count : null,
      sub: sc.recorded
        ? `${isCount(sc.never_screened) ? `${plural(sc.never_screened, 'person', 'people')} never screened, counted apart. ` : ''}Screen again from each case.`
        : (sc.reason || 'Not returned by the read.') },
  ];
}

/** `Nov 26` from `2026-11`. */
export function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1].slice(2)}` : String(ym || '');
}

/** The chart's columns: one per month of the next twelve, people and businesses. */
export function monthBars(months) {
  return (months || []).map((m) => ({
    key: m.month, label: monthLabel(m.month),
    people: isCount(m.people) ? m.people : 0, businesses: isCount(m.businesses) ? m.businesses : 0,
  }));
}

/** The chart's lead sentence, from its own columns. */
export function monthLead(months) {
  const bars = monthBars(months);
  if (!bars.length) return null;
  const total = (b) => b.people + b.businesses;
  const most = Math.max(...bars.map(total));
  if (most === 0) return 'No check expires in the next 12 months.';
  const full = (b) => { const m = /^(\d{4})-(\d{2})$/.exec(b.key); return m ? `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m[2]) - 1]} ${m[1]}` : b.label; };
  const peaks = bars.filter((b) => total(b) === most).map(full);
  const peakLine = peaks.length === 1 ? `${peaks[0]} carries the most renewals (${most}).`
    : `${peaks.slice(0, -1).join(', ')} and ${peaks.at(-1)} carry the most renewals (${most} each).`;
  const now = bars[0];
  return `${peakLine} ${full(now).split(' ')[0]} has ${plural(total(now), 'check')} to warn and re-check.`;
}

const KIND_WORD = { person: 'Person', business: 'Business' };
const OBLIGATION_WORD = { satisfied: 'Approved', expired: 'Expired' };

/** One table row (KYC9), in words. */
export function renewalRow(item) {
  const name = item.who?.name || (item.who?.id ? `Account ${item.who.id}` : 'An account no longer here');
  const d = Number.isInteger(item.days_left) ? item.days_left : null;
  const when = d == null ? 'Date not recorded'
    : item.expired ? (d < 0 ? `Expired ${plural(-d, 'day')} ago` : 'Expired')
      : d === 0 ? 'Expires today' : `In ${plural(d, 'day')}`;
  const status = item.kind === 'person'
    ? statusWord(item.kyc_status)
    : (OBLIGATION_WORD[item.obligation_status] || 'Not recorded');
  return {
    id: item.id,
    name,
    personId: item.kind === 'person' && item.who?.id ? item.who.id : null,
    kind: KIND_WORD[item.kind] || 'Not recorded',
    what: item.what || item.check || 'Not recorded',
    expires: dayLabel(item.expires_at) ?? 'Not recorded',
    when,
    expired: Boolean(item.expired),
    warned: (item.warned || []).map((w) => ({ days: w.days, sent: Boolean(w.sent_at), at: dayLabel(w.sent_at) })),
    status,
    statusKey: item.kind === 'person' ? item.kyc_status : null,
    recheck: item.recheck_asked_at ? `Re-check asked ${dayLabel(item.recheck_asked_at) ?? ''}`.trim() : null,
  };
}

/** The warnings in words, for a screen reader and the table view. */
export function warnedLine(warned) {
  const sent = warned.filter((w) => w.sent).map((w) => w.days);
  if (!warned.length) return 'Not recorded';
  if (!sent.length) return 'Not warned yet';
  return `Warned at ${sent.length === 1 ? sent[0] : `${sent.slice(0, -1).join(', ')} and ${sent.at(-1)}`} days`;
}

/** `1–8 of 8`, or the empty line. */
export function rangeLine(total, page, pageSize) {
  if (!isCount(total)) return 'Not recorded';
  if (total === 0) return '0 of 0';
  const from = (page - 1) * pageSize + 1;
  return `${from}–${Math.min(total, page * pageSize)} of ${total.toLocaleString('en-GB')}`;
}

/* ------------------------------------------------------------------ *
 * KYC17c — how long a check lasts
 * ------------------------------------------------------------------ */

export const PERIOD_MIN = 1;
export const PERIOD_MAX = 120;
export const PERIOD_NOTE = 'New periods apply to checks approved from today. Existing dates do not move.';
export const PERIOD_TOLD = 'This deployment uses these periods. A studio on its own deployment keeps the defaults until HQ’s setting reaches it. Recorded under your name.';
export const PERIOD_CODE = 'Saving asks for your authenticator code when your last check has lapsed.';

/** One period's row on the card. */
export function periodRow(p) {
  return {
    key: p.key,
    label: p.label,
    months: isCount(p.months) ? p.months : null,
    source: p.set_by_hq
      ? `Set by ${p.updated_by || 'an account no longer here'}${dayLabel(p.updated_at) ? ` on ${dayLabel(p.updated_at)}` : ''}`
      : 'The default',
    unused: p.applied === false ? (p.reason || 'Kept, and not used yet.') : null,
  };
}

/**
 * What a draft changes, and why it cannot be saved. Only changed values are
 * sent; each is a whole number of months from 1 to 120, as the Worker asks.
 */
export function periodChanges(periods, draft) {
  const changes = [];
  for (const p of periods || []) {
    if (!(p.key in (draft || {}))) continue;
    const raw = String(draft[p.key]).trim();
    if (!/^\d+$/.test(raw)) return { changes: [], error: `${p.label}: a whole number of months.` };
    const to = Number(raw);
    if (to < PERIOD_MIN || to > PERIOD_MAX) return { changes: [], error: `${p.label}: from ${PERIOD_MIN} to ${PERIOD_MAX} months.` };
    if (to !== p.months) changes.push({ key: p.key, label: p.label, from: p.months, to });
  }
  return { changes, error: changes.length ? null : 'Nothing has changed yet.' };
}

/** The dialog's lines: `Accreditation evidence: 12 months → 18 months.` */
export const changeLine = (c) => `${c.label}: ${c.from == null ? 'not recorded' : `${c.from} months`} → ${c.to} months.`;

/* ------------------------------------------------------------------ *
 * KYC10 — Audit
 * ------------------------------------------------------------------ */

/** The window's choices. The Worker takes at most a year. */
export const AUDIT_WINDOWS = Object.freeze([
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '365', label: 'Last 12 months', days: 365 },
]);

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

/** `{ from, to }` as the Worker's dates, the window ending today (UTC). */
export function windowDates(key, nowMs = Date.now()) {
  const w = AUDIT_WINDOWS.find((x) => x.key === key) || AUDIT_WINDOWS[1];
  return { from: ymd(nowMs - (w.days - 1) * DAY_MS), to: ymd(nowMs) };
}

/** The audit read's query: only what is set. */
export function auditParams(f, nowMs = Date.now()) {
  const { from, to } = windowDates(f.window, nowMs);
  const out = { from, to };
  if (f.action) out.action = f.action;
  if (f.admin) out.admin = f.admin;
  if (f.case?.id) out.case = f.case.id;
  if (String(f.q || '').trim()) out.q = String(f.q).trim();
  if (f.page > 1) out.page = f.page;
  return out;
}

/** Ways the record can be read differently; two actions share "Opened a case". */
const QUALIFIER = { kyc_record_access: 'the record', kyc_case_access: 'its history' };

/** The action filter's options, one per audited action, each named so no two read alike. */
export function actionOptions(actions) {
  const list = actions || [];
  const count = new Map();
  for (const a of list) count.set(a.word, (count.get(a.word) || 0) + 1);
  return list.map((a) => ({ key: a.key, label: count.get(a.word) > 1 ? `${a.word} · ${QUALIFIER[a.key] || a.key}` : a.word }));
}

/**
 * The chart's columns: a day each up to two months, a week each beyond, so a
 * year never draws 365 slivers. Every day the Worker returns was counted, so
 * its 0 is a measured 0.
 */
export function dayBars(perDay) {
  const days = (perDay || []).filter((d) => isCount(d.looks) && isCount(d.decisions));
  if (days.length <= 62) return days.map((d) => ({ key: d.day, label: dayLabel(d.day)?.replace(/ \d{4}$/, '') ?? d.day, looks: d.looks, decisions: d.decisions }));
  const out = [];
  for (let i = 0; i < days.length; i += 7) {
    const wk = days.slice(i, i + 7);
    out.push({ key: wk[0].day, label: `w/c ${dayLabel(wk[0].day)?.replace(/ \d{4}$/, '') ?? wk[0].day}`,
      looks: wk.reduce((t, d) => t + d.looks, 0), decisions: wk.reduce((t, d) => t + d.decisions, 0) });
  }
  return out;
}

/** The chart's lead: the window's totals, and today's when today is in it. */
export function auditLead(perDay, nowMs = Date.now()) {
  const days = (perDay || []).filter((d) => isCount(d.looks) && isCount(d.decisions));
  if (!days.length) return null;
  const looks = days.reduce((t, d) => t + d.looks, 0);
  const decisions = days.reduce((t, d) => t + d.decisions, 0);
  const today = days.find((d) => d.day === ymd(nowMs));
  const base = `${plural(looks, 'look')} and ${plural(decisions, 'decision')} in this window.`;
  return today ? `${base} Today so far: ${plural(today.looks, 'look')} and ${plural(today.decisions, 'decision')}.` : base;
}

/** One audit row in words. */
export function auditRow(r) {
  return {
    id: r.id,
    when: minuteLabel(r.at) ?? 'Not recorded',
    admin: r.admin?.name || (r.admin?.id ? `Account ${r.admin.id}` : 'Not recorded'),
    word: r.word || 'Not recorded',
    kind: r.kind,
    case: r.case ? { id: r.case.id, name: r.case.name || `Account ${r.case.id}` } : null,
    detail: r.detail || '',
  };
}

/* ------------------------------------------------------------------ *
 * KYC17d and KYC14b — the export is HQ's
 * ------------------------------------------------------------------ */

export const EXPORT_REASON_MIN = 10;
export const EXPORT_REASON_MAX = 500;
export const EXPORT_ONLY_HQ = 'Only a Super Admin can export the audit record.';
export const EXPORT_NOTE = 'The file holds names and actions, never documents or shown values. The export is recorded.';
export const EXPORT_SCOPE = 'This deployment’s record only.';

/**
 * Whether to draw Export. A Super Admin at HQ, as `/me` says; on a branch the
 * elevation reads 0 (D106). The Worker decides: this only spares an Admin a
 * button the Worker would refuse.
 */
export function canExport(user) {
  return isSuperAdminUser(user) && !branchOfUser(user);
}

/** What the bar says after an export: recorded either way, and whether the browser took the file. */
export function exportedLine(rows, saved) {
  const n = `${rows} ${rows === 1 ? 'row' : 'rows'}`;
  return saved ? `Exported ${n}. The export is recorded.`
    : `The export of ${n} is recorded, but this browser did not take the file. Export again to get it.`;
}

/** Why the export cannot be sent yet, or null. */
export function exportProblem({ from, to, reason }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to || ''))) return 'Choose the dates to export.';
  if (from > to) return 'The start comes before the end.';
  if (stampMs(to) - stampMs(from) > 365 * DAY_MS) return 'Ask for at most a year at a time.';
  const n = String(reason || '').trim().length;
  if (n < EXPORT_REASON_MIN || n > EXPORT_REASON_MAX) return `Say why, in ${EXPORT_REASON_MIN} to ${EXPORT_REASON_MAX} characters. The reason is recorded with the export.`;
  return null;
}

/** A refusal from these reads and writes, in words. The Worker's own sentence wins when it sent one. */
export function governanceRefusal(e) {
  const code = e?.code || e?.data?.code;
  if (code === 'step_up_required') return 'Your authenticator code was not confirmed, so nothing was saved.';
  if (e?.status === 403) return 'Only a Super Admin at HQ can do this. Nothing was changed.';
  return e?.data?.detail || e?.message || 'It could not be done. Try again.';
}
