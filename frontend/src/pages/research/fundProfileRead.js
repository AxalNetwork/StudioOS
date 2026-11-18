/**
 * D7167 (#7167) — what the fund Sheet, the full profile and a fund comparison
 * cell derive from the Worker's dated provenance contract
 * (`services/researchFundProfile.ts`), as plain functions the tests read
 * without a DOM.
 *
 * One provenance object makes one chip: the publisher and the date the list
 * reported the figure, the same in all three places. The three dates are
 * never merged: Reported (the source's observation), Imported on (when Axal VC
 * copied the row) and Source use reviewed (when the list's terms were read).
 * Amounts are printed in the currency the list reported; nothing is converted.
 */
import { toMajorString } from '../../lib/money.js';
import { NOT_RECORDED } from './researchStates.js';

/** The three action names (D7031, FND-P01). */
export const ACTIONS = Object.freeze({
  save: 'Save to shortlist',
  saving: 'Saving…',
  open: 'Open dossier →',
  add: 'Add to research project',
  compare: 'Compare in project',
  profile: 'Open full profile →',
});

/** The Platform States word for a read that failed (D5129). */
export const UNAVAILABLE = 'Unavailable';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2023-09-25" → "25 Sep 2023"; anything that is not a date is returned as written, or null. */
export function day(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return s;
  return `${Number(m[3])} ${MONTHS[mo - 1]} ${m[1]}`;
}

const SYMBOL = { EUR: '€', USD: 'US$', GBP: '£' };

/** Cents in a named currency → "€75m", "US$185m"; null for an unknown currency. Never converted. */
export function amount(cents, currency) {
  if (cents == null || !SYMBOL[currency]) return null;
  // Minor to major units through the money layer (D5029, D5373), never a bare factor.
  const major = Number(toMajorString(Math.round(Number(cents)), currency));
  if (!Number.isFinite(major)) return null;
  const m = major / 1e6;
  const text = m >= 1
    ? m.toLocaleString('en-US', { maximumFractionDigits: m < 10 ? 1 : 0 })
    : (major / 1e3).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return `${SYMBOL[currency]}${text}${m >= 1 ? 'm' : 'k'}`;
}

/** The chip on a figure: "@Euro_VC · reported 25 Sep 2023". */
export function sourceChip(p) {
  if (!p) return null;
  const who = p.publisher || p.list_title || p.list_name || 'Source not recorded';
  const when = day(p.reported_on);
  return when ? `${who} · reported ${when}` : `${who} · reported date not recorded`;
}

const VERDICTS = { 'republish allowed': 'Republishing allowed', 'cite only': 'Cite only', 'not allowed': 'Not allowed' };

/** The three dates, each with what it answers. A date the API does not give reads Not recorded. */
export function datesOf(p) {
  const publisher = p?.publisher || 'the publisher';
  return [
    { key: 'reported', label: 'Reported', value: day(p?.reported_on), hint: `When ${publisher} recorded this figure` },
    { key: 'imported', label: 'Imported on', value: day(p?.imported_on), hint: 'When Axal VC copied the list row' },
    {
      key: 'reviewed',
      label: 'Source use reviewed',
      value: day(p?.reviewed_on),
      hint: p?.verdict ? `${VERDICTS[p.verdict] || p.verdict}: named and linked on every fact` : 'This list’s terms have not been reviewed',
    },
  ].map((d) => ({ ...d, text: d.value || NOT_RECORDED }));
}

/** The source card's list line: title (else name), publisher, terms and a web link only. */
export function listOf(p) {
  const href = typeof p?.published_url === 'string' && /^https?:\/\//i.test(p.published_url.trim()) ? p.published_url.trim() : null;
  return {
    title: p?.list_title || p?.list_name || null,
    publisher: p?.publisher || null,
    terms: p?.verdict ? (VERDICTS[p.verdict] || p.verdict) : NOT_RECORDED,
    href,
  };
}

export const PROPOSED_LABELS = Object.freeze({
  manager_name: 'Manager',
  investment_stage: 'Investment stage',
  investment_geography: 'Investment geography',
  initial_cheque: 'Initial cheque range',
});

/** A cheque range as text: "€1m–€5m", "up to US$2m", "from €500k". */
export function chequeText(v) {
  if (!v || typeof v !== 'object') return null;
  const lo = amount(v.min_cents, v.currency);
  const hi = amount(v.max_cents, v.currency);
  if (lo && hi) return `${lo}–${hi}`;
  if (hi) return `up to ${hi}`;
  if (lo) return `from ${lo}`;
  return null;
}

/**
 * The proposed fields in the canvas's order, each `recorded` with its text and
 * chip, `not_recorded` with the reason, or `unavailable` (a failed read is
 * never Not recorded).
 */
export function proposedRows(proposed, keys = ['investment_stage', 'investment_geography', 'initial_cheque']) {
  return keys.map((key) => {
    const v = proposed?.[key];
    const label = PROPOSED_LABELS[key];
    if (!v || v.status === 'unavailable') return { key, label, state: 'unavailable', text: UNAVAILABLE, reason: 'This field could not be read just now.' };
    if (v.status !== 'recorded') return { key, label, state: 'not_recorded', text: NOT_RECORDED, reason: v.reason || NOT_RECORDED };
    const text = key === 'initial_cheque' ? chequeText(v.value) : (typeof v.value === 'string' ? v.value : null);
    if (!text) return { key, label, state: 'not_recorded', text: NOT_RECORDED, reason: 'Not recorded: the value is held in a form this page cannot show' };
    return { key, label, state: 'recorded', text, chip: sourceChip(v.provenance), provenance: v.provenance };
  });
}

/** "Managed by Dawn Capital · vintage 2023", from what the read recorded. */
export function managedLine(item) {
  const m = item?.proposed?.manager_name;
  const parts = [];
  if (m?.status === 'recorded' && typeof m.value === 'string') parts.push(`Managed by ${m.value}`);
  else parts.push('Manager not recorded');
  if (item?.fund_year != null) parts.push(`vintage ${item.fund_year}`);
  return parts.join(' · ');
}

/** The reported size, in its own currency, or the reason it is not shown. */
export function reportedSize(item) {
  const text = amount(item?.fund_size_cents, item?.size_currency);
  if (text) return { text, currency: item.size_currency, reason: null };
  return { text: null, currency: null, reason: item?.size_reason || 'The list records no size for this vehicle.' };
}

/**
 * The manager history and this vehicle's observations, from the read's
 * `history`. Each vehicle keeps the label its list gives it; sizes are never
 * added up or drawn as one line.
 */
export function historyView(history, item) {
  const h = history || {};
  const vehicles = Array.isArray(h.vehicles) ? h.vehicles : [];
  const observations = (Array.isArray(h.observations) ? h.observations : [])
    .map((o) => ({ key: `${o.period || ''}-${o.reported_on || ''}`, text: amount(o.fund_size_cents, o.size_currency), currency: o.size_currency, when: day(o.reported_on), cents: Number(o.fund_size_cents) }))
    .filter((o) => o.text);
  return {
    manager: typeof h.manager === 'string' ? h.manager : null,
    vehicles: {
      state: h.vehicles_status === 'unavailable' ? 'unavailable' : h.vehicles_status === 'not_recorded' ? 'not_recorded' : 'ok',
      reason: h.vehicles_reason || null,
      // D7032 option A: vehicles a list labels alike carry their vintage beside the label.
      rows: vehicles.map((v) => ({
        uid: v.uid,
        label: (v.label || v.name || NOT_RECORDED)
          + (v.label && v.fund_year != null && vehicles.filter((w) => w.label === v.label).length > 1 ? ` (${v.fund_year})` : ''),
        size: amount(v.fund_size_cents, v.size_currency),
        currency: v.size_currency || null,
        reported: day(v.provenance?.reported_on),
        current: !!v.current,
      })),
    },
    observations: {
      state: h.observations_status === 'unavailable' ? 'unavailable' : 'ok',
      rows: observations,
      unlabelled: Number(h.unlabelled_reports || 0),
      name: item?.name || 'this vehicle',
    },
  };
}

/** The founder's shortlist row for this directory vehicle: matched on `catalogue_uid`, never on the name. */
export function shortlistMatch(items, uid) {
  if (!uid || !Array.isArray(items)) return null;
  return items.find((x) => x && x.catalogue_uid === uid) || null;
}

/**
 * The source-policy refresh: Save, Add and Compare re-read the fund first. A
 * 410 clears the Sheet's facts and the action is not taken; any other failure
 * leaves the facts and says the action could not be checked.
 */
export async function rereadBeforeAction(get, uid) {
  try {
    const data = await get(uid);
    return { ok: true, data };
  } catch (e) {
    if (e?.status === 410) return { ok: false, withdrawn: true, removed: e?.data?.removed || null, reason: e?.data?.reason || null };
    return { ok: false, withdrawn: false, message: 'This fund could not be checked just now, so nothing was saved. Try again.' };
  }
}

/** The withdrawn panel's sentences (FND-P07 B). */
export const WITHDRAWN = Object.freeze({
  title: 'This fund’s source list was withdrawn while you were reading',
  body: 'The facts shown a moment ago were removed from this panel. Save, Add and Compare are no longer offered. Nothing was saved.',
  read: 'This fund’s source list was withdrawn',
});

/**
 * Where "Back to results" goes: the directory address the Sheet was opened
 * from (its search, filters, sort and page, D4612), else the directory tab.
 */
export function backTo(state) {
  const back = state && typeof state.back === 'string' ? state.back : '';
  return back.startsWith('/research/funds?') ? back : '/research/funds?view=directory';
}
