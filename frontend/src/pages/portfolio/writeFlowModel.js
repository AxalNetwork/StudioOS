/**
 * D4817 part 7 (#5311, canvas PF-07): the pure model of a money write — a
 * valuation mark or a distribution recorded by an admin against one
 * company's position — taken Prepare → Review → Confirm → Receipt.
 *
 * No React, no fetch, no clock. Every figure it draws comes from the company
 * detail read (`GET /api/positions/:projectUid`) or from what the Worker
 * returned for the write. What neither supplies reads "Not recorded" or "Not
 * projected" with its reason; it is never estimated, and never 0.
 *
 * The Worker routes (`POST /api/positions/:projectUid/marks`, `/distributions`)
 * are admin-only and carry no revision or "what I read" field, so a conflict
 * is found the only way the client can: the company is read again just before
 * the write, and the write waits if what it was prepared against has moved.
 * That check narrows the window; it does not close it.
 */

import { NOT_RECORDED } from '../../lib/absence';
import { basisLabel, day, money, multiple } from './portfolioModel.js';

export { NOT_RECORDED };
export const NOT_PROJECTED = 'Not projected';
export const STEPS = ['Prepare', 'Review', 'Confirm', 'Receipt'];

/** The values each route accepts, in the order the Worker's sets hold them. */
export const MARK_BASES = [['gp_estimate', 'GP estimate'], ['round_price', 'Priced round'], ['secondary', 'Secondary'], ['write_down', 'Write-down'], ['cost', 'Cost']];
export const DIST_KINDS = [['exit', 'Exit'], ['secondary', 'Secondary'], ['dividend', 'Dividend'], ['recapitalization', 'Recapitalization']];

/** The two writes: their fields, words and the payload each route reads. */
export const WRITES = {
  mark: {
    noun: 'mark',
    title: 'Record a mark',
    done: 'Mark recorded',
    store: 'portfolio_marks',
    audit: 'portfolio.mark_recorded',
    fields: [
      { key: 'as_of_date', label: 'As-of date', type: 'date', required: true },
      { key: 'fmv', label: 'Fair market value of the position (USD)', type: 'money', required: true, min: 0 },
      { key: 'basis', label: 'Basis', type: 'select', options: MARK_BASES, required: true },
      { key: 'event', label: 'Event', type: 'text', max: 120, hint: 'Optional, e.g. Down round' },
      { key: 'source', label: 'Source', type: 'text', max: 200, hint: 'Optional, e.g. Q3 board pack' },
      { key: 'note', label: 'Note', type: 'textarea', max: 2000, hint: 'Optional' },
    ],
  },
  distribution: {
    noun: 'distribution',
    title: 'Record a distribution',
    done: 'Distribution recorded',
    store: 'portfolio_distributions',
    audit: 'portfolio.distribution_recorded',
    fields: [
      { key: 'distribution_date', label: 'Date received', type: 'date', required: true },
      { key: 'amount', label: 'Amount received (USD)', type: 'money', required: true, min: 0, exclusive: true },
      { key: 'kind', label: 'Kind', type: 'select', options: DIST_KINDS, required: true },
      { key: 'note', label: 'Note', type: 'textarea', max: 2000, hint: 'Optional' },
    ],
  },
};

/** An empty draft. `today` is the caller's (the page's clock), never read here. */
export function draftOf(kind, today = '') {
  if (kind === 'mark') return { as_of_date: today || '', fmv: '', basis: 'gp_estimate', event: '', source: '', note: '' };
  return { distribution_date: today || '', amount: '', kind: 'exit', note: '' };
}

/** True when the draft holds anything the admin typed. */
export function isDirty(kind, values, initial) {
  return WRITES[kind].fields.some((f) => String(values?.[f.key] ?? '').trim() !== String(initial?.[f.key] ?? '').trim());
}

/** `$2,100,000`, `2100000`, `2,100,000.50` → a number; null for anything else. */
export function parseMoney(input) {
  const s = String(input ?? '').replace(/[\s$,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** A real calendar date in `YYYY-MM-DD`; `2026-02-30` is not one. */
export function isIsoDate(input) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input ?? ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/**
 * Each field's error, in words tied to the field. The rules are the Worker's
 * own (fmv ≥ 0, amount > 0, a real date, a value from the set) plus its
 * length limits, which it would otherwise apply by cutting the text short.
 */
export function validate(kind, values) {
  const errors = {};
  for (const f of WRITES[kind].fields) {
    const raw = String(values?.[f.key] ?? '').trim();
    if (!raw) {
      if (f.required) errors[f.key] = f.type === 'date' ? `Enter the ${f.label.toLowerCase()}.` : `Enter the ${f.label.replace(/ \(USD\)$/, '').toLowerCase()}.`;
      continue;
    }
    if (f.type === 'money') {
      const n = parseMoney(raw);
      if (n == null) errors[f.key] = 'Enter an amount in US dollars, like 2,100,000.';
      else if (f.exclusive && n <= 0) errors[f.key] = 'The amount must be more than $0.';
      else if (n < f.min) errors[f.key] = 'The value cannot be negative.';
    } else if (f.type === 'date') {
      if (!isIsoDate(raw)) errors[f.key] = 'Enter a real date as YYYY-MM-DD.';
    } else if (f.type === 'select') {
      if (!f.options.some(([v]) => v === raw)) errors[f.key] = `Choose a ${f.label.toLowerCase()} from the list.`;
    } else if (f.max && raw.length > f.max) {
      errors[f.key] = `Keep this to ${f.max.toLocaleString('en-US')} characters (now ${raw.length.toLocaleString('en-US')}).`;
    }
  }
  return errors;
}

/** The body the route reads. Blank optional fields are left out, not sent empty. */
export function payloadOf(kind, values) {
  const t = (k) => String(values?.[k] ?? '').trim();
  if (kind === 'mark') {
    const body = { fmv: parseMoney(values.fmv), as_of_date: t('as_of_date'), basis: t('basis') };
    for (const k of ['event', 'source', 'note']) if (t(k)) body[k] = t(k);
    return body;
  }
  const body = { amount: parseMoney(values.amount), distribution_date: t('distribution_date'), kind: t('kind') };
  if (t('note')) body.note = t('note');
  return body;
}

/** The Worker's 400 sentence names the field it refused; this maps it back. */
export function fieldOfError(kind, message) {
  const m = /^(\w+) (is|must)/.exec(String(message || ''));
  if (!m) return null;
  return WRITES[kind].fields.some((f) => f.key === m[1]) ? m[1] : null;
}

/* ------------------------------------------------- what the write is against */

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const byDateDesc = (key) => (a, b) => String(b?.[key] || '').localeCompare(String(a?.[key] || ''));

/**
 * What the company read says now, for the write to be measured against:
 * the latest mark, the cost, what has been distributed, and a fingerprint of
 * each history so a change between Prepare and the save is seen.
 */
export function baseOf(detail) {
  const rounds = Array.isArray(detail?.rounds) ? detail.rounds : [];
  const marks = (Array.isArray(detail?.marks) ? detail.marks : []).slice().sort(byDateDesc('as_of_date'));
  const dists = (Array.isArray(detail?.distributions) ? detail.distributions : []).slice().sort(byDateDesc('distribution_date'));
  const invested = rounds.length ? rounds.reduce((a, r) => a + (isNum(r.invested_amount) ? Number(r.invested_amount) : 0), 0) : null;
  const latest = marks[0] || null;
  return {
    name: detail?.project?.name || null,
    uid: detail?.project?.uid || null,
    rounds: rounds.length,
    invested,
    latestMark: latest && isNum(latest.fmv) ? { uid: latest.uid, as_of_date: latest.as_of_date, fmv: Number(latest.fmv), basis: latest.basis || null } : null,
    marks: marks.map((m) => m.uid).join(','),
    distributed: dists.reduce((a, d) => a + (isNum(d.amount) ? Number(d.amount) : 0), 0),
    distributionCount: dists.length,
    latestDistribution: dists[0] ? { uid: dists[0].uid, distribution_date: dists[0].distribution_date, amount: Number(dists[0].amount) } : null,
    distributions: dists.map((d) => d.uid).join(','),
  };
}

/** True when the history this write lands in moved since `before` was read. */
export function changedSince(kind, before, now) {
  return kind === 'mark' ? before.marks !== now.marks : before.distributions !== now.distributions;
}

const usd = (v) => money(v) ?? NOT_RECORDED;
const ratio = (num, den) => (isNum(num) && isNum(den) && Number(den) > 0 ? Number(num) / Number(den) : null);

/** The carrying value before: the latest mark, or cost when none is recorded. */
function carrying(base) {
  if (base.latestMark) return { value: base.latestMark.fmv, words: `${usd(base.latestMark.fmv)} · mark of ${day(base.latestMark.as_of_date) || base.latestMark.as_of_date}` };
  if (base.invested != null) return { value: base.invested, words: `${usd(base.invested)} · no mark, carried at cost` };
  return { value: null, words: `${NOT_RECORDED} · no mark and no round recorded` };
}

/**
 * What the latest mark becomes. A mark dated before the latest one is
 * recorded but does not become the carrying value; one on the same date
 * leaves which of the two reads as latest undetermined, and the row says so.
 */
export function markAfter(base, values) {
  const fmv = parseMoney(values.fmv);
  const date = String(values.as_of_date || '');
  const latest = base.latestMark;
  if (!latest || date > String(latest.as_of_date)) return { value: fmv, words: `${usd(fmv)} · mark of ${day(date) || date}`, note: null };
  if (date < String(latest.as_of_date)) {
    return { value: latest.fmv, words: `${usd(latest.fmv)} · unchanged`, note: `The mark of ${day(latest.as_of_date)} is later, so it stays the carrying value; this one joins the history.` };
  }
  return { value: null, words: 'Not determined', note: `A mark is already recorded for ${day(date)}; the Worker does not say which of two marks on one date reads as latest.` };
}

/**
 * Review: exactly what is written, to which company and store, and the effect
 * on the figures this company's read supplies, before → after. The book-wide
 * NAV, TVPI and DPI are the Worker's to recompute; they are not projected.
 */
export function reviewOf(kind, values, base) {
  const body = payloadOf(kind, values);
  const written = WRITES[kind].fields.map((f) => {
    const v = body[f.key];
    let words;
    if (v == null || v === '') words = `${NOT_RECORDED} · left blank`;
    else if (f.type === 'money') words = usd(v);
    else if (f.type === 'date') words = day(v) || v;
    else if (f.type === 'select') words = (f.options.find(([k]) => k === v) || [v, v])[1];
    else words = String(v);
    return { key: f.key, label: f.label.replace(/ \(USD\)$/, ''), value: words };
  });
  const effect = [];
  if (kind === 'mark') {
    const before = carrying(base);
    const after = markAfter(base, values);
    effect.push({ key: 'fmv', label: 'Carrying value', before: before.words, after: after.words, note: after.note });
    const mb = ratio(before.value, base.invested);
    const ma = ratio(after.value, base.invested);
    const why = base.invested == null ? 'no invested amount recorded' : null;
    effect.push({
      key: 'moic', label: 'MOIC (gross)',
      before: multiple(mb) || `${NOT_RECORDED}${why ? ` · ${why}` : ''}`,
      after: multiple(ma) || (after.value == null ? 'Not determined' : `${NOT_RECORDED}${why ? ` · ${why}` : ''}`),
      note: null,
    });
  } else {
    const amount = parseMoney(values.amount);
    const after = base.distributed + (amount || 0);
    effect.push({ key: 'distributed', label: 'Distributed from this company', before: usd(base.distributed), after: usd(after), note: base.distributionCount ? null : 'None recorded before this one.' });
    const why = base.invested == null ? ` · no invested amount recorded` : '';
    effect.push({ key: 'dpi', label: 'DPI for this company', before: multiple(ratio(base.distributed, base.invested)) || `${NOT_RECORDED}${why}`, after: multiple(ratio(after, base.invested)) || `${NOT_RECORDED}${why}`, note: null });
  }
  effect.push({ key: 'book', label: 'Portfolio NAV, TVPI and DPI', before: NOT_PROJECTED, after: NOT_PROJECTED, note: 'The Worker recomputes the book on its next read; this page does not estimate it.' });
  return { written, effect, store: WRITES[kind].store, fund: 'No fund named: recorded at firm level' };
}

/** The act, named on the button: "Record $2,100,000 mark for Northwind Labs". */
export function actLabel(kind, values, base) {
  const amount = usd(parseMoney(kind === 'mark' ? values.fmv : values.amount));
  return `Record ${amount} ${WRITES[kind].noun} for ${base.name || 'this company'}`;
}

/* -------------------------------------------------------------- the answer */

/** `2026-11-14T14:44:09.123Z` → `14 Nov 2026, 14:44:09 UTC`; null for anything else. */
export function stamp(value) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(String(value || ''));
  return m ? `${day(m[1])}, ${m[2]} UTC` : null;
}

/** The receipt: the stored row as the Worker returned it. Absent fields say so. */
export function receiptOf(kind, record) {
  const r = record || {};
  const rows = [{ key: 'uid', label: 'Record id', value: r.uid ? String(r.uid) : NOT_RECORDED }];
  if (kind === 'mark') {
    rows.push(
      { key: 'fmv', label: 'Fair market value', value: usd(r.fmv) },
      { key: 'as_of_date', label: 'As of', value: day(r.as_of_date) || NOT_RECORDED },
      { key: 'basis', label: 'Basis', value: basisLabel(r.basis) || NOT_RECORDED },
      { key: 'event', label: 'Event', value: r.event || NOT_RECORDED },
      { key: 'source', label: 'Source', value: r.source || NOT_RECORDED },
    );
  } else {
    rows.push(
      { key: 'amount', label: 'Amount', value: usd(r.amount) },
      { key: 'distribution_date', label: 'Date received', value: day(r.distribution_date) || NOT_RECORDED },
      { key: 'kind', label: 'Kind', value: (DIST_KINDS.find(([k]) => k === r.kind) || [null, r.kind || NOT_RECORDED])[1] },
    );
  }
  rows.push(
    { key: 'note', label: 'Note', value: r.note || NOT_RECORDED },
    { key: 'revision', label: 'Revision', value: `${NOT_RECORDED} · the Worker keeps no revision for this record; a correction is a new record` },
    { key: 'created_at', label: 'Saved by the Worker', value: stamp(r.created_at) || NOT_RECORDED },
  );
  return rows;
}

/**
 * What a failed save was. A refusal with a status means nothing was written;
 * no answer at all means the outcome is not known, and the next attempt
 * re-reads first so a write that did land shows as a change.
 */
export function failureOf(error) {
  const status = Number(error?.status) || null;
  const message = String(error?.message || '').trim() || 'No reason was given.';
  if (status === 409) return { kind: 'conflict', status, message };
  if (status) return { kind: 'refused', status, message };
  return { kind: 'unknown', status: null, message };
}
