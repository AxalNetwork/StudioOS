/**
 * #4717 package 6 — The activity chart (registrations, applications and bookings by week), its sentence, and Who takes part.
 *
 * Split out of communityModel.js, which re-exports what the page and the
 * tests import. Pure: nothing here fetches.
 */
import { beforeLabel, nf, weekLabel } from './format.js';
import { FIGURE_UNREAD, blockOf, count, countMap, countsAt, failed, onWeeks, pct, weeksOf } from './read.js';

export const ROLE_LABELS = [
  ['founder', 'Founder'], ['investor', 'Investor'], ['advisor', 'Advisor'], ['operating_partner', 'Operating partner'],
  ['explorer', 'Explorer'], ['guest', 'Guest'], ['other', 'Other'],
];

export const ROLE_PLURAL = {
  founder: 'Founders', investor: 'Investors', advisor: 'Advisors', operating_partner: 'Operating partners', explorer: 'Explorers', guest: 'Guests', other: 'Other accounts',
};

/**
 * A weekly series' counts on the read's own weeks; a week the block does not
 * carry is null, which breaks the line. #4717 package 3: null for the whole
 * series when the rows are not a list, or a row is not on one of the read's
 * weeks, or its count is not a whole number,
 * so the series is named as unreadable instead of drawn with holes or zeros.
 */

export function buildActivity(reads) {
  const o = reads.overview;
  if (!o || o.status === 'loading') return { state: 'loading' };
  if (failed(o)) return { state: 'unreadable', reason: 'The Community read could not be read. That is not the same as no activity.' };
  const weeks = weeksOf(o.data);
  if (!weeks) return { state: 'unreadable', reason: 'The weeks of this read could not be read. That is not the same as no activity.' };
  const current = weeks.indexOf(o.data?.current_week);
  const specs = [
    { key: 'registrations', label: 'Event registrations', noun: 'event registrations', tone: 'violet', path: 'events.weekly', rows: (b) => b.weekly, field: 'registrations', totals: (b) => b.registrations, opens: 'events' },
    { key: 'applications', label: 'Job applications', noun: 'job applications', tone: 'sky', path: 'jobs', rows: (b) => b.weekly, field: 'count', totals: (b) => b.applications },
    { key: 'bookings', label: 'Expert bookings', noun: 'expert bookings', tone: 'amber', path: 'wellbeing.bookings', rows: (b) => b.weekly, field: 'count', totals: (b) => ({ window: b.window, previous: b.previous }) },
  ];
  const series = [];
  const missing = [];
  const totals = [];
  for (const sp of specs) {
    const b = blockOf(o, sp.path);
    if (b.state !== 'ready') { missing.push(sp.label); continue; }
    // #4717 package 3: a series whose weeks or totals are not whole numbers is named as missing, never drawn as zeros.
    const values = onWeeks(weeks, sp.rows(b.block), sp.field);
    const t = countsAt(sp.totals(b.block), ['window', 'previous']);
    if (!values || !t) { missing.push(sp.label); continue; }
    // D1121: a point on the events series opens CM3, the events lightbox.
    series.push({ key: sp.key, label: sp.label, tone: sp.tone, dash: series.length === 1, values, ...(sp.opens ? { clickable: true, opens: sp.opens } : {}) });
    totals.push({ noun: sp.noun, window: t.window, previous: t.previous });
  }
  if (!series.length) return { state: 'unreadable', reason: 'Registrations, applications and bookings could not be read. That is not the same as none.' };
  const labels = weeks.map(weekLabel);
  return {
    state: 'ready',
    chart: { type: 'lines', series, labels, currentIndex: current },
    missing: missing.length ? `${missing.join(', ')} could not be read, so ${missing.length === 1 ? 'it is' : 'they are'} not drawn. That is not the same as none.` : null,
    sentence: biggestChange(totals, o.data.weeks),
  };
}

/**
 * The one sentence on the biggest change, written from the numbers: the
 * series whose count moved most against the weeks before. The current week is
 * to date, which the sentence says.
 */

export function biggestChange(totals, weeks) {
  if (!totals.length) return null;
  const moved = totals.map((t) => ({ ...t, by: t.window - t.previous })).sort((a, b) => Math.abs(b.by) - Math.abs(a.by));
  const top = moved[0];
  if (top.by === 0) {
    return top.window === 0 && moved.every((t) => t.window === 0 && t.previous === 0)
      ? `Nothing was recorded in these ${weeks} weeks or ${beforeLabel(weeks)}.`
      : `Nothing changed against ${beforeLabel(weeks)}: each count is the same.`;
  }
  const word = top.by > 0 ? 'up' : 'down';
  const name = top.noun.charAt(0).toUpperCase() + top.noun.slice(1);
  return `${name} moved most: ${nf(top.window)} in these ${weeks} weeks, this week so far, ${word} from ${nf(top.previous)} in ${beforeLabel(weeks)}.`;
}

/**
 * The Events card's funnel and events by type, from D918's blocks:
 *   - the funnel is the events that ended in the period: their seats taken
 *     (registered, confirmed and attended together), then the seats past
 *     confirmation (confirmed or attended, D918's `confirmed`, D1121), then
 *     attended. A read without the count says so, never 0;
 *   - waitlisted sits beside it, the seats waiting on upcoming events;
 *   - events by type, published or waiting, starting in the period, over the
 *     twelve stored types (`other` among them). Types with none are behind
 *     "Show all".
 */

export function buildWho(reads) {
  // #4717 package 3: a part is drawn only when it counts every profile, and (events) the accounts that are gone, in whole numbers.
  const roleKeys = ROLE_LABELS.map(([k]) => k);
  const checked = (b, extra) => {
    if (b.state !== 'ready') return b;
    const by = countMap(b.block.by_role, roleKeys);
    const gone = extra ? count(b.block.not_recorded) : 0;
    return by && gone !== null ? { state: 'ready', block: { by_role: by, not_recorded: gone } } : { state: 'unreadable', reason: FIGURE_UNREAD };
  };
  const ev = checked(blockOf(reads.overview, 'participation_by_role.events'), true);
  const jb = checked(blockOf(reads.overview, 'participation_by_role.jobs'), false);
  if (ev.state === 'loading' || jb.state === 'loading') return { state: 'loading' };
  if (ev.state !== 'ready' && jb.state !== 'ready') {
    return { state: 'unreadable', reason: 'Who registered and who applied could not be read. That is not the same as no one.' };
  }
  const parts = [];
  if (ev.state === 'ready') parts.push({ key: 'events', label: 'Event registrations', tone: 'violet', by: ev.block.by_role });
  if (jb.state === 'ready') parts.push({ key: 'jobs', label: 'Job applications', tone: 'sky', by: jb.block.by_role });
  const rows = ROLE_LABELS.map(([key, label]) => {
    const ps = parts.map((p) => ({ key: p.key, label: p.label, tone: p.tone, value: p.by[key] }));
    return { key, label, parts: ps, total: nf(ps.reduce((t, p) => t + p.value, 0)), sum: ps.reduce((t, p) => t + p.value, 0) };
  });
  const all = rows.reduce((t, r) => t + r.sum, 0);
  const top = [...rows].sort((a, b) => b.sum - a.sum)[0];
  const what = parts.map((p) => p.label.toLowerCase()).join(' and ');
  const sentence = all === 0
    ? `No ${what} in these ${reads.overview.data.weeks} weeks.`
    : `${ROLE_PLURAL[top.key]} took the largest share: ${nf(top.sum)} of ${nf(all)} ${what} (${pct(top.sum, all)}%).`;
  const gone = ev.state === 'ready' ? ev.block.not_recorded : 0;
  return {
    state: 'ready',
    rows: rows.filter((r) => r.sum > 0),
    parts: parts.map(({ key, label, tone }) => ({ key, label, tone })),
    sentence,
    missing: ev.state !== 'ready' ? 'Event registrations could not be read, so only applications are drawn.'
      : jb.state !== 'ready' ? 'Job applications could not be read, so only registrations are drawn.' : null,
    gone: gone ? `${nf(gone)} registrations are from accounts that are gone, so they have no profile here.` : null,
  };
}

/**
 * The Wellbeing card: experts by state as a 100% bar, bookings by week, and
 * the check-in band. Each part answers alone. The band is a range of
 * founders, never a mood or a stress figure, and under seven it is withheld
 * with the canvas's sentence.
 */
