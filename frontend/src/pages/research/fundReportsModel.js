/**
 * D7169 (#7169) — the pure half of Research › Fund dossier quarterly reports
 * (canvas `Research Funds Quarterly Reports`, boards FND-Q0 to FND-Q11, D7034).
 * No React and no requests, so every rule the boards draw is testable here:
 *
 *   · Quarters sit at their own calendar position. A quarter between two
 *     reports with no row is "No report" — a gap in the chart and a row in the
 *     table, never a line joining its neighbours (FND-Q6). Quarters are listed
 *     from the first reported one to the latest, none before or after
 *     (the owner's option A, D7034 § Pending the owner).
 *   · One look per meaning (FND-Q5): a measured 0.0%, a negative −2.1% with a
 *     true minus, a percent to one decimal, TVPI as a multiple (1.4×, stored
 *     as hundredths), money as US$ — USD only today.
 *   · Editing keeps, replaces or clears each value (FND-Q4). Blank is not a
 *     command: emptying a saved field keeps it until "Clear value" is chosen,
 *     and only a clear is sent as null. The PATCH body carries changed fields
 *     only.
 *   · A conflict (409 `report_changed`) is resolved field by field: a field
 *     only one side changed is merged, a field both changed asks Mine/Theirs
 *     (FND-Q7).
 */
import { parseMinor, plainAmount } from '../../lib/money.js';

const MINUS = '−';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const QUARTER_DAYS = [['1 Jan', '31 Mar'], ['1 Apr', '30 Jun'], ['1 Jul', '30 Sep'], ['1 Oct', '31 Dec']];

/* ---------- periods ---------- */

/** '2026-Q2' → { year: 2026, q: 2 }, or null. */
export function parsePeriod(period) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(period || ''));
  return m ? { year: Number(m[1]), q: Number(m[2]) } : null;
}
export const periodOf = (year, q) => `${year}-Q${q}`;
export const periodIndex = (period) => { const p = parsePeriod(period); return p ? p.year * 4 + (p.q - 1) : null; };
const periodAt = (i) => periodOf(Math.floor(i / 4), (i % 4) + 1);
/** '2026-Q2' → '2026 Q2'. */
export const periodLabel = (period) => { const p = parsePeriod(period); return p ? `${p.year} Q${p.q}` : String(period || ''); };
/** '2026-Q2' → '1 Apr – 30 Jun 2026'. */
export function periodRange(period, { withYear = true } = {}) {
  const p = parsePeriod(period);
  if (!p) return '';
  const [a, b] = QUARTER_DAYS[p.q - 1];
  return `${a} – ${b}${withYear ? ` ${p.year}` : ''}`;
}

/** The last quarter that has ended on `now`: the default period for Add quarter. */
export function lastClosedQuarter(now = new Date()) {
  const i = now.getUTCFullYear() * 4 + Math.floor(now.getUTCMonth() / 3) - 1;
  return periodAt(i);
}

/**
 * Every quarter from the first reported to the latest, oldest first, each with
 * its report or null. Reports with a malformed period are dropped from the
 * timeline (the Worker refuses them, so none should exist).
 */
export function quarterTimeline(reports) {
  const byIndex = new Map();
  for (const r of reports || []) { const i = periodIndex(r?.period); if (i != null) byIndex.set(i, r); }
  if (!byIndex.size) return [];
  const keys = [...byIndex.keys()];
  const lo = Math.min(...keys); const hi = Math.max(...keys);
  const out = [];
  for (let i = lo; i <= hi; i += 1) out.push({ period: periodAt(i), report: byIndex.get(i) || null });
  return out;
}

/** The latest report, by period. */
export function latestReport(reports) {
  let best = null;
  for (const r of reports || []) if (periodIndex(r?.period) != null && (!best || periodIndex(r.period) > periodIndex(best.period))) best = r;
  return best;
}

/* ---------- formatting (FND-Q5) ---------- */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Basis points as a percent to one decimal with a true minus: 420 → '4.2%', −210 → '−2.1%', 0 → '0.0%'. */
export function fmtPercent(bps) {
  if (!isNum(bps)) return null;
  const text = (Math.abs(bps) / 100).toFixed(1);
  return `${bps < 0 && text !== '0.0' ? MINUS : ''}${text}%`;
}

/** TVPI hundredths as a multiple: 140 → '1.4×', 118 → '1.18×'. */
export function fmtMultiple(hundredths) {
  if (!isNum(hundredths) || !Number.isInteger(hundredths)) return null;
  // From the digits, exactly: 140 → '1.40' → '1.4'.
  const digits = String(Math.abs(hundredths)).padStart(3, '0');
  return `${hundredths < 0 ? MINUS : ''}${digits.slice(0, -2)}.${digits.slice(-2).replace(/0$/, '')}×`;
}

/** USD cents as 'US$100,000' (cents shown only when there are some). USD is the only currency today. */
export function fmtUsd(cents) {
  if (!isNum(cents)) return null;
  const plain = plainAmount(cents, 'USD', { trimWhole: true });
  return plain === null ? null : `US$${plain}`;
}

/** '2026-07-14' → '14 Jul 2026'. */
export function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** A stored stamp as the time of day it was saved, in the reader's zone: '14:32'. */
export function fmtTime(stamp) {
  const t = Date.parse(String(stamp || '').replace(' ', 'T'));
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- fields ---------- */

/**
 * Every field of a report, in the sheet's order. `kind` picks the parser and
 * the formatter; `metric` marks the four the chart can draw; `unitName` is the
 * spoken unit in the input's accessible name.
 */
export const FIELDS = Object.freeze([
  { key: 'source_url', label: 'Source URL', kind: 'url', group: 'source', required: true },
  { key: 'report_date', label: 'Report date', kind: 'date', group: 'source' },
  { key: 'report_url', label: 'Report URL (optional)', short: 'Report URL', kind: 'url', group: 'source' },
  { key: 'nav_cents', label: 'NAV', kind: 'usd', group: 'money', unitName: 'US dollars' },
  { key: 'fund_size_cents', label: 'Fund size', kind: 'usd', group: 'money', unitName: 'US dollars' },
  { key: 'quarterly_return_bps', label: 'Quarterly return', kind: 'pct', group: 'rates', unitName: 'percent', hint: `Negative returns are allowed: type ${MINUS}2.1` },
  { key: 'net_irr_bps', label: 'Net IRR', kind: 'pct', group: 'rates', unitName: 'percent' },
  { key: 'tvpi_bps', label: 'TVPI', kind: 'mult', group: 'multiple', unitName: 'multiple', hint: 'A multiple, not a percent: 1.4 means 1.4×' },
  { key: 'notes', label: 'Note (private)', short: 'Note', kind: 'text', group: 'note' },
]);
export const FIELD = Object.freeze(Object.fromEntries(FIELDS.map((f) => [f.key, f])));
export const METRICS = Object.freeze(['quarterly_return_bps', 'nav_cents', 'net_irr_bps', 'tvpi_bps']);

/** A stored value as words on screen; null when there is no value (the caller draws Not recorded). */
export function fmtValue(key, value) {
  const f = FIELD[key];
  if (value === null || value === undefined || value === '') return null;
  if (!f) return String(value);
  if (f.kind === 'usd') return fmtUsd(value);
  if (f.kind === 'pct') return fmtPercent(value);
  if (f.kind === 'mult') return fmtMultiple(value);
  if (f.kind === 'date') return fmtDate(value);
  return String(value);
}

/** A stored value as the text an edit box starts with. */
export function toInput(key, value) {
  const f = FIELD[key];
  if (value === null || value === undefined) return '';
  if (f?.kind === 'usd') return plainAmount(value, 'USD', { trimWhole: true }) ?? '';
  if (f?.kind === 'pct') return `${value < 0 ? MINUS : ''}${String(Math.abs(value) / 100)}`;
  if (f?.kind === 'mult') return String(value / 100);
  return String(value);
}

const typed = (raw) => `You typed “${raw}”.`;

/**
 * What a person typed, as the value to store. `{ value }` (null for an empty
 * box) or `{ error }` with the fix, keeping what was typed in the sentence.
 */
export function parseInput(key, text) {
  const f = FIELD[key];
  const raw = String(text ?? '');
  const t = raw.trim();
  if (t === '') return { value: null };
  if (!f) return { value: t };
  if (f.kind === 'usd') {
    const cleaned = t.replace(/^US\$\s*/i, '').replace(/^\$\s*/, '');
    const r = parseMinor(cleaned, 'USD');
    return r.ok ? { value: r.minor } : { error: `Enter whole US dollars, like 100000. ${typed(raw)}` };
  }
  if (f.kind === 'pct') {
    const n = t.replace(MINUS, '-').replace(/\s*%$/, '').trim();
    if (!/^-?\d+(\.\d{1,2})?$/.test(n)) {
      return { error: /,/.test(t) ? `Use a number with a full stop, like 4.2. ${typed(raw)}` : `Use a number, like 4.2 or ${MINUS}2.1. ${typed(raw)}` };
    }
    const basisPoints = Math.round(Number(n) * 100);
    if (basisPoints < -10000) return { error: `A ${f.label.toLowerCase()} cannot be below ${MINUS}100%. ${typed(raw)}` };
    if (basisPoints > 1000000) return { error: `That is above 10,000%. ${typed(raw)}` };
    return { value: basisPoints };
  }
  if (f.kind === 'mult') {
    if (/%/.test(t)) return { error: `TVPI is a multiple. Type 1.4 for 1.4×. ${typed(raw)}` };
    const n = t.replace(/\s*[×x]$/i, '').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(n)) return { error: `Use a multiple with up to two decimals, like 1.4. ${typed(raw)}` };
    const hundredths = Math.round(Number(n) * 100);
    if (hundredths > 100000) return { error: `That is above 1,000×. ${typed(raw)}` };
    return { value: hundredths };
  }
  if (f.kind === 'url') {
    if (!/^https?:\/\/\S+$/i.test(t) || t.length > 500) return { error: `Paste a web address starting with https://. ${typed(raw)}` };
    return { value: t };
  }
  if (f.kind === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || !fmtDate(t)) return { error: `Pick the date printed on the report. ${typed(raw)}` };
    return { value: t };
  }
  if (t.length > 2000) return { error: `The note is ${t.length} characters; the limit is 2000.` };
  return { value: t };
}

/* ---------- drafts: keep, replace, clear (FND-Q4) ---------- */

/** A draft: per field, the text in its box and whether a clear was chosen. `saved` is null for a new quarter. */
export function draftFrom(saved) {
  const fields = {};
  for (const f of FIELDS) fields[f.key] = { text: saved ? toInput(f.key, saved[f.key]) : '', clear: false };
  return { fields };
}

/**
 * One field's state against the saved report:
 *   kept      unchanged (or emptied without choosing Clear: `blank` is true)
 *   new       a value where none was saved
 *   replaced  a different value over a saved one
 *   clear     Clear value was chosen; saves as Not recorded
 *   invalid   the box cannot be read; `error` says how to fix it
 */
export function fieldState(key, entry, saved) {
  const before = saved ? (saved[key] ?? null) : null;
  if (entry?.clear) return before === null ? { state: 'kept', value: null, before } : { state: 'clear', value: null, before };
  const parsed = parseInput(key, entry?.text);
  if (parsed.error) return { state: 'invalid', error: parsed.error, before };
  if (parsed.value === null) return { state: 'kept', value: before, before, blank: before !== null };
  if (parsed.value === before) return { state: 'kept', value: before, before };
  return { state: before === null ? 'new' : 'replaced', value: parsed.value, before };
}

/**
 * The whole draft against the saved report: what changes, what is kept, what
 * cannot be read, and the body to send — changed fields only, null for a
 * clear. For a new quarter `saved` is null and the body carries every value
 * typed plus the period.
 */
export function changeSet(draft, saved, { period } = {}) {
  const changes = []; const kept = []; const errors = []; const body = {};
  for (const f of FIELDS) {
    const s = fieldState(f.key, draft?.fields?.[f.key], saved);
    if (s.state === 'invalid') errors.push({ key: f.key, error: s.error });
    else if (s.state === 'kept') kept.push({ key: f.key, value: s.value, blank: !!s.blank });
    else { changes.push({ key: f.key, state: s.state, from: s.before, to: s.value }); body[f.key] = s.value; }
  }
  if (!saved) {
    if (period) body.period = period;
    if (!body.source_url && !errors.some((e) => e.key === 'source_url')) errors.unshift({ key: 'source_url', error: 'Paste the source URL: every report needs one.' });
  }
  return { changes, kept, errors, body };
}

/** "1 change will be saved", "1 replacement and 1 clear will be saved". */
export function changeTitle(changes) {
  const n = changes.length;
  if (!n) return 'No changes yet';
  const rep = changes.filter((c) => c.state === 'replaced').length;
  const clr = changes.filter((c) => c.state === 'clear').length;
  const nw = n - rep - clr;
  if (rep && clr && !nw) return `${rep} replacement${rep === 1 ? '' : 's'} and ${clr} clear${clr === 1 ? '' : 's'} will be saved`;
  return `${n} change${n === 1 ? '' : 's'} will be saved`;
}
export const saveLabel = (n) => (n ? `Save ${n} change${n === 1 ? '' : 's'}` : 'No changes to save');

/** The announcement after a save (FND-Q9). */
export function savedSentence(period, changes, { added = false } = {}) {
  const p = periodLabel(period);
  if (added) return `Saved. ${p} added.`;
  if (!changes.length) return `Nothing changed. ${p} is as it was.`;
  const parts = changes.map((c) => `${FIELD[c.key]?.short || FIELD[c.key]?.label || c.key} ${c.to === null ? 'cleared' : fmtValue(c.key, c.to)}`.replace(/^(\S)/, (m) => m.toLowerCase()));
  return `Saved. ${p} updated: ${parts.join(', ')}. Other values unchanged.`;
}

/* ---------- conflict (FND-Q7) ---------- */

/**
 * `base` is the report as it was when the edit opened, `mine` the body this
 * edit would send, `theirs` the row the 409 returned. Each row: a field both
 * sides changed to different values (`conflict`, default Mine), or merged.
 */
export function conflictRows(base, mine, theirs) {
  const rows = [];
  for (const f of FIELDS) {
    const b = base?.[f.key] ?? null; const t = theirs?.[f.key] ?? null;
    const mineHas = Object.prototype.hasOwnProperty.call(mine || {}, f.key);
    const m = mineHas ? mine[f.key] : b;
    const theyChanged = t !== b;
    if (mineHas && theyChanged && m !== t) rows.push({ key: f.key, kind: 'conflict', mine: m, theirs: t });
    else if (mineHas && m !== t) rows.push({ key: f.key, kind: 'mine', mine: m, theirs: t });
    else if (theyChanged) rows.push({ key: f.key, kind: 'theirs', mine: m, theirs: t });
    else rows.push({ key: f.key, kind: 'same', mine: m, theirs: t });
  }
  return rows;
}

/** The body to send against `theirs` once each conflict has a pick ('mine' | 'theirs'; default mine). */
export function resolvedBody(rows, picks = {}) {
  const body = {};
  for (const r of rows) {
    if (r.kind === 'mine') body[r.key] = r.mine;
    if (r.kind === 'conflict' && (picks[r.key] || 'mine') === 'mine') body[r.key] = r.mine;
  }
  return body;
}

/** A draft rebased on the newer row: their values in every box, this edit's changes on top. */
export function rebaseDraft(theirs, body) {
  const d = draftFrom(theirs);
  for (const [k, v] of Object.entries(body || {})) {
    if (!d.fields[k]) continue;
    d.fields[k] = v === null ? { text: '', clear: (theirs?.[k] ?? null) !== null } : { text: toInput(k, v), clear: false };
  }
  return d;
}

/* ---------- server refusals onto fields ---------- */

/** A 400 `invalid_report_field` body as `{ key: sentence }`. */
export function serverFieldErrors(data) {
  const out = {};
  for (const e of Array.isArray(data?.errors) ? data.errors : []) if (e?.field && e?.detail && !out[e.field]) out[e.field] = e.detail;
  if (!Object.keys(out).length && data?.field && (data?.detail || data?.message)) out[data.field] = data.detail || data.message;
  return out;
}

/**
 * Typed values carried to a quarter that already has a report (FND-Q2,
 * the owner's option A): every box the person filled whose value differs from
 * the saved one.
 */
export function carriedValues(addDraft, saved) {
  const out = [];
  for (const f of FIELDS) {
    const text = addDraft?.fields?.[f.key]?.text ?? '';
    if (!text.trim()) continue;
    const p = parseInput(f.key, text);
    if (p.error || p.value === (saved?.[f.key] ?? null)) continue;
    out.push({ key: f.key, text });
  }
  return out;
}
