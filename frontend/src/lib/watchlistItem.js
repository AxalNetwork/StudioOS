/**
 * D636 (#1394) — one watchlist item and the journal entries written about it,
 * the Ops canvas's sp-watchlist screen at /watchlist/:uid. Pure: the page in
 * `pages/WatchlistItemPage.jsx` draws what these return.
 *
 * Every field the item does not hold reads as "Not recorded" with its reason,
 * never as a blank, a zero or a guess.
 */

export const CONVICTION_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };
export const STATUS_LABEL = { watching: 'Watching', converted: 'Converted', passed_on: 'Passed', archived: 'Archived' };
export const DECISION_LABEL = { invest: 'Invest', pass: 'Pass', defer: 'Defer' };
export const OUTCOME_LABEL = { hit: 'Hit', miss: 'Miss', partial: 'Partial', inconclusive: 'Inconclusive' };
/** The mark D618 records, word for word from the canvas. */
export const EDITED_AFTER_OUTCOME = 'Edited after the outcome';

const day = (v) => {
  if (typeof v !== 'string' || v.length < 10) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** The company's name: the onboarded project's, or the external prospect's. */
export const itemName = (item) => item?.project?.name || item?.external_name || 'Unnamed company';

/** "[Sector] · [Stage] · on the watchlist since [date]", leaving out what is not recorded. */
export function itemSubline(item) {
  const sector = item?.project?.sector || item?.sector;
  const stage = item?.project?.stage || item?.stage;
  const since = day(item?.created_at);
  return [sector, stage, since ? `on the watchlist since ${since}` : null].filter(Boolean).join(' · ');
}

const nr = (reason) => ({ v: null, nr: reason });

/** The item's rows, in the canvas's order. A row with `nr` reads "Not recorded" and its reason. */
export function itemRows(item) {
  const tags = Array.isArray(item?.tags) ? item.tags.filter(Boolean) : [];
  const rows = [
    { k: 'Thesis', ...(item?.thesis ? { v: item.thesis } : nr('Thesis: none written yet.')) },
    { k: 'Conviction', ...(CONVICTION_LABEL[item?.conviction] ? { v: CONVICTION_LABEL[item.conviction], pill: item.conviction } : nr('Conviction: not set.')) },
    { k: 'Source', ...(item?.source ? { v: item.source } : nr('Source: not recorded when it was added.')) },
    { k: 'Tags', ...(tags.length ? { v: tags.join(' · ') } : nr('Tags: none added.')) },
    { k: 'Status', v: STATUS_LABEL[item?.status] || String(item?.status || ''), pill: item?.status },
    { k: 'Next check', ...(day(item?.next_check_at) ? { v: day(item.next_check_at) } : nr('Next check: no date set.')) },
  ];
  const ended = endedLine(item);
  if (ended) rows.push({ k: 'Ended', v: ended, pill: item.status });
  return rows;
}

/**
 * How it ended, or null while it is still open:
 *   converted → "Converted to a deal · [date]" (and says when the deal is not recorded);
 *   passed_on → "Passed · [reason] · [date]", or "no reason recorded".
 */
export function endedLine(item) {
  if (item?.status === 'converted') {
    const when = day(item.converted_at);
    const deal = item.converted_deal_id ? '' : ' · the deal is not recorded';
    return `Converted to a deal${when ? ` · ${when}` : ''}${deal}`;
  }
  if (item?.status === 'passed_on') {
    const reason = item.passed_reason ? item.passed_reason : 'no reason recorded';
    const when = day(item.passed_at);
    return `Passed · ${reason}${when ? ` · ${when}` : ''}`;
  }
  return null;
}

/** "3×". */
export const multipleOf = (x) => (x === null || x === undefined || x === '' || Number.isNaN(Number(x)) ? null : `${Number(x)}×`);

/** "5 years" for whole years, else "18 months". */
export function timelineOf(months) {
  const m = Number(months);
  if (!Number.isFinite(m) || m <= 0) return null;
  if (m % 12 === 0) return `${m / 12} ${m === 12 ? 'year' : 'years'}`;
  return `${m} ${m === 1 ? 'month' : 'months'}`;
}

/** The expected line, "[Outcome] · [3×] · [5 years]", leaving out what is not recorded; null when none is. */
export function expectedLine(entry) {
  const parts = [entry?.expected_outcome, multipleOf(entry?.expected_multiple), timelineOf(entry?.expected_timeline_months)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The outcome half: pending, or recorded with its label, notes and actual multiple. */
export function outcomeOf(entry) {
  const label = OUTCOME_LABEL[entry?.outcome_status];
  if (!label) return { recorded: false };
  return { recorded: true, label, status: entry.outcome_status, notes: entry.outcome_notes || null, actual: multipleOf(entry.outcome_actual_multiple) };
}

/** Whether D618's mark shows: the thesis or decision changed after the outcome was recorded. */
export const editedAfterOutcome = (entry) => !!entry?.edited_after_outcome_at;
