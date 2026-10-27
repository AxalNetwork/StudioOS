/**
 * D1259 (#3282, part 6 of #2428) — SC13's words, over the two reads
 * `ventureScoreModelsApi` makes. Pure, so the tests read them without a page.
 *
 * NOTHING HERE GUESSES. A version with no publication says so; a source with
 * no recorded licence says it is not imported or read; a count is the read's
 * own, and a read that failed is Unreadable, never zero.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "26 Oct 2026" from an ISO day or stamp; null when it is not one. */
export function longDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export const STATE_WORD = { live: 'Live', draft: 'Draft', retired: 'Retired' };

/** One row of the versions table. */
export function versionRow(v) {
  const recompute = v.recompute;
  const running = recompute && !recompute.finished_at;
  return {
    version: `v${v.version}`,
    state: STATE_WORD[v.state] || v.state,
    date: v.published_at ? longDay(v.published_at) : v.default_live ? 'Scoring since part 2' : 'Not published',
    by: v.published_by ?? (v.default_live ? 'No publication recorded' : '—'),
    ventures: String(v.ventures_scored ?? 0),
    progress: running
      ? `Recomputing: ${recompute.done} of ${recompute.total} ventures${recompute.failed ? `, ${recompute.failed} could not be scored` : ''}.`
      : recompute?.failed ? `${recompute.failed} ventures could not be scored in its recompute.` : null,
  };
}

const WINDOW = { records: 'a year', connector: '90 days', quarter: '120 days' };

/** One cell of "What vX changes": weight, store and freshness, or that the input is absent. */
export function changeCell(side) {
  if (!side) return 'Not in this version';
  return `${side.weight}% · ${side.source ? side.source : 'No source'} · fresh for ${WINDOW[side.freshness] || side.freshness}`;
}

/** The Publish dialog's lines (canvas SC13, "Publish Model v1.1?"). */
export function publishLines(draft) {
  return [
    `${draft.ventures} ventures recompute, about ${draft.minutes} ${draft.minutes === 1 ? 'minute' : 'minutes'} at 25 a minute.`,
    'Each venture’s earlier values stay in its history. Nothing is deleted.',
    'A scorecard read after its venture recomputes shows the new values.',
    'You are asked for your authenticator code before it is published.',
  ];
}

/** A source's licence line: the licence D1259 recorded, or why it is not read. */
export function licenceLine(s) {
  return s.licence ? `Licence: ${s.licence} (${s.licence_decision})` : `Licence not recorded: not imported or read (${s.licence_decision})`;
}

/** An edition's line, and whether its values count. */
export function editionLine(e) {
  return `${e.edition} · published ${longDay(e.published_on) || 'Not recorded'} · ${e.countries} ${e.countries === 1 ? 'country' : 'countries'}${e.read ? '' : ' · not read: imported under a licence no longer recorded'}`;
}

/** Codes typed into a list's box: two letters each, upper-cased, de-duplicated. Anything else is returned as `bad`. */
export function parseCodes(text) {
  const parts = String(text ?? '').split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  const good = [...new Set(parts.filter((x) => /^[A-Z]{2}$/.test(x)))];
  const bad = parts.filter((x) => !/^[A-Z]{2}$/.test(x));
  return { good, bad };
}
