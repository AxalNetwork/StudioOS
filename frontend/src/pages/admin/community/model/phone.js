/**
 * D4820 (#4820) part 2 — the phone dashboard's own hierarchy (CM09): the queue at three rows, the activity summary's three totals, and the one-line summary of each More analytics row.
 *
 * Pure: nothing here fetches. Every line is written from figures that were
 * read; a part that could not be read says Unreadable, one still reading says
 * so, and neither is ever drawn as a zero.
 */
import { ROLE_PLURAL } from './activity.js';
import { funnelEmpty, jobsEmpty, circlesEmpty, rosterEmpty, expertsEmpty, bookingsEmpty } from './empty.js';
import { nf } from './format.js';
import { blockOf, countsAt, onWeeks, pct, weeksOf } from './read.js';

/** CM09: the phone queue lists three rows, then "+ N more waiting in Approvals". */
export const PHONE_NEEDS_ROWS = 3;

/** Needs your attention cut to the phone's rows. The rest are counted from the queues' own totals, as on desktop. */
export function needsOnPhone(needs, show = PHONE_NEEDS_ROWS) {
  if (needs?.state !== 'ready' || !Array.isArray(needs.rows)) return needs;
  const rows = needs.rows.slice(0, show);
  return { ...needs, rows, more: Math.max(0, needs.total - rows.length) };
}

/** "+28%", "−6%", "Same", or "None before" when the period before had none, so no share is invented from a zero. */
export function shortDelta(window, previous) {
  if (!Number.isFinite(window) || !Number.isFinite(previous)) return null;
  if (previous === 0) return window === 0 ? 'None either period' : 'None before';
  const p = Math.round(((window - previous) / previous) * 100);
  if (p === 0) return 'Same';
  return `${p > 0 ? '+' : '−'}${Math.abs(p)}%`;
}

const SUMMARY = [
  { key: 'registrations', label: 'Registrations', path: 'events.weekly', totals: (b) => b.registrations, rows: (b) => b.weekly, field: 'registrations' },
  { key: 'applications', label: 'Applications', path: 'jobs', totals: (b) => b.applications, rows: (b) => b.weekly, field: 'count' },
  { key: 'bookings', label: 'Bookings', path: 'wellbeing.bookings', totals: (b) => ({ window: b.window, previous: b.previous }), rows: (b) => b.weekly, field: 'count' },
];

/**
 * CM09's activity summary in place of the chart: each series' total in the
 * period, its change on the period before, and how many of its weeks the read
 * does not carry ("1 week n/r", a gap, never a zero). Each series answers alone.
 */
export function activitySummary(reads) {
  const o = reads?.overview;
  const weeks = o?.status === 'ready' ? weeksOf(o.data) : null;
  return SUMMARY.map((s) => {
    const b = blockOf(o, s.path);
    if (b.state === 'loading') return { key: s.key, label: s.label, state: 'loading' };
    if (b.state !== 'ready') return { key: s.key, label: s.label, state: 'unreadable' };
    const t = countsAt(s.totals(b.block), ['window', 'previous']);
    const values = weeks ? onWeeks(weeks, s.rows(b.block), s.field) : null;
    if (!t || !values) return { key: s.key, label: s.label, state: 'unreadable' };
    const gaps = values.filter((v) => v === null).length;
    const delta = shortDelta(t.window, t.previous);
    const sub = [delta, gaps ? `${nf(gaps)} week${gaps === 1 ? '' : 's'} n/r` : null].filter(Boolean).join(' · ');
    return { key: s.key, label: s.label, state: 'ready', value: nf(t.window), sub };
  });
}

/** A part's line when it is not ready: Reading…, or Unreadable. Never a zero. */
const notReady = (part) => (part?.state === 'loading' ? { state: 'loading', line: 'Reading…' } : { state: 'unreadable', line: 'Unreadable' });
const isReady = (part) => part?.state === 'ready';

/**
 * CM09's More analytics: one row per secondary card, each with the line it
 * shows while closed. Opened, a row draws its card. The inputs are the
 * page's own builders' output, so a row and its card cannot disagree.
 */
export function moreRows({ ev, showUp, who, jobs, applications, circles, roster, wb, weeks }) {
  const rows = [];

  // Events participation: show-up over the events that ended, and the waitlist beside it.
  const f = ev?.funnel;
  let events;
  if (!isReady(f)) events = notReady(f);
  else if (funnelEmpty(f)) events = { state: 'ready', line: f.events ? 'No seat taken on the events that ended' : `No event ended in these ${weeks} weeks` };
  else {
    const wl = ev.waitlisted;
    const tail = isReady(wl) ? ` · ${nf(wl.value)} waitlisted` : ' · waitlist unreadable';
    events = { state: 'ready', line: `${isReady(showUp) ? showUp.value : 'Unreadable'} show-up${tail}` };
  }
  rows.push({ key: 'events', title: 'Events participation', ...events });

  // Who takes part: the profile with the largest share.
  let part;
  if (!isReady(who)) part = notReady(who);
  else if (!who.rows.length) part = { state: 'ready', line: 'No participation yet' };
  else {
    const all = who.rows.reduce((t, r) => t + r.sum, 0);
    const top = [...who.rows].sort((a, b) => b.sum - a.sum)[0];
    const of = who.parts.length > 1 ? 'participation' : who.parts[0].label.toLowerCase();
    part = { state: 'ready', line: `${ROLE_PLURAL[top.key]} ${pct(top.sum, all)}% of ${of}` };
  }
  rows.push({ key: 'who', title: 'Who takes part', ...part });

  // Opportunities: open postings and applications in the period.
  let opp;
  if (!isReady(jobs)) opp = notReady(jobs);
  else if (jobsEmpty(jobs)) opp = { state: 'ready', line: 'No job postings yet' };
  else {
    const open = jobs.parts.find((p) => p.label === 'Published')?.value ?? 0;
    const apps = isReady(applications) ? `${applications.value} applications` : 'applications unreadable';
    opp = { state: 'ready', line: `${nf(open)} open job${open === 1 ? '' : 's'} · ${apps}` };
  }
  rows.push({ key: 'jobs', title: 'Opportunities', ...opp });

  // Network: published circles and active advisors and partners, each half alone.
  let net;
  if (!isReady(circles) && !isReady(roster)) net = notReady(circles?.state === 'loading' ? circles : roster);
  else if (circlesEmpty(circles) && rosterEmpty(roster)) net = { state: 'ready', line: 'No circles, advisors or partners yet' };
  else {
    const c = isReady(circles) ? `${nf(circles.published)} published circle${circles.published === 1 ? '' : 's'}` : 'circles unreadable';
    const r = isReady(roster) ? `${nf(roster.active)} active advisors & partners` : 'roster unreadable';
    net = { state: 'ready', line: `${c} · ${r}` };
  }
  rows.push({ key: 'network', title: 'Network', ...net });

  // Wellbeing: verified experts and bookings in the period. No check-in figure: that stays a range inside the card.
  const ex = wb?.experts;
  const bk = wb?.bookings;
  let well;
  if (!isReady(ex) && !isReady(bk)) well = notReady(ex?.state === 'loading' ? ex : bk);
  else if (expertsEmpty(ex) && bookingsEmpty(bk)) well = { state: 'ready', line: 'No wellbeing experts or bookings yet' };
  else {
    const verified = isReady(ex) ? ex.parts.find((p) => p.label === 'Verified')?.value ?? 0 : null;
    const e = verified === null ? 'experts unreadable' : `${nf(verified)} verified expert${verified === 1 ? '' : 's'}`;
    const b = isReady(bk) ? `${nf(bk.window)} booking${bk.window === 1 ? '' : 's'}` : 'bookings unreadable';
    well = { state: 'ready', line: `${e} · ${b}` };
  }
  rows.push({ key: 'wellbeing', title: 'Wellbeing', ...well });

  return rows;
}
