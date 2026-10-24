/** D920 (#2703): the Events overview's derivations over D918's independent blocks. */
import { EVENT_TYPES } from '../../../lib/eventTypes.js';
import { STATUSES, money, parseStamp, readyList, statusWord, whenLine } from './eventsDeskModel.js';

export const PERIODS = [4, 12, 52];
export const count = (n) => Number.isFinite(n) ? n.toLocaleString('en-US') : 'Not recorded';
export const percent = (n) => Number.isFinite(n) ? `${Math.round(n * 100)}%` : 'Not recorded';
export const shortWeek = (day) => {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? 'Date not recorded' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/** Absent/malformed answers are unreadable; only an explicit recorded:false means no store. */
export function overviewBlock(read, key) {
  if (!read || read.status === 'loading') return { state: 'loading' };
  if (read.status === 'error') return { state: 'unreadable', reason: 'The overview request failed.' };
  const b = read.data?.[key];
  if (b?.recorded === false) return { ...b, state: 'unrecorded' };
  if (b?.available === true) return { ...b, state: 'ready' };
  return { state: 'unreadable', reason: b?.reason || 'This block did not return a readable answer.' };
}

export function registrationDelta(now, before) {
  if (!Number.isFinite(now) || !Number.isFinite(before)) return 'Comparison not recorded';
  if (before === 0) return now === 0 ? 'No change from the previous period' : 'No registrations in the previous period';
  const change = Math.round((now - before) / before * 100);
  return change === 0 ? 'No change from the previous period' : `${change > 0 ? '+' : ''}${change}% from the previous period`;
}

export function overviewTileData(read) {
  const make = (key, block, label, derive) => {
    const b = overviewBlock(read, block);
    return { key, label, ...b, ...(b.state === 'ready' ? derive(b) : {}) };
  };
  return [
    make('waiting', 'queue', 'Waiting for review', (b) => ({ value: count(b.count), sub: b.count === 0 ? 'Nothing waits' : `Oldest ${count(b.oldest_hours)} hours`, flag: b.overdue > 0 ? `${count(b.overdue)} Overdue · past ${count(b.overdue_after_hours)} hours` : null, note: b.waiting_from_created_at > 0 ? `${count(b.waiting_from_created_at)} legacy waits count from creation.` : null })),
    make('next30', 'upcoming_30d', 'Next 30 days', (b) => ({ value: count(b.events), sub: `events · ${count(b.seats_taken)} seats taken · ${count(b.full)} full` })),
    make('registrations', 'weekly', 'Registrations', (b) => ({ value: count(b.registrations?.this_period), sub: 'this period', delta: registrationDelta(b.registrations?.this_period, b.registrations?.previous_period) })),
    make('showup', 'show_up', 'Show-up rate', (b) => ({ value: b.events === 0 ? 'No event has ended yet' : b.seats_taken === 0 ? 'No seats taken' : percent(b.rate), sub: `${count(b.events)} events ended this period` })),
    make('waitlists', 'waitlisted', 'On waitlists', (b) => ({ value: count(b.registrations), sub: `registrations · ${count(b.events)} upcoming events` })),
    make('paid', 'paid', 'Paid tickets', (b) => ({ value: paidLines(b), sub: `${count(b.count)} paid` })),
    make('free', 'free_seats', 'Free seats given', (b) => ({ value: count(b.count), sub: 'From audience rules and free invitations' })),
    make('cancelled', 'cancelled', 'Cancelled', (b) => ({ value: count(b.events), sub: `starting this period · ${count(b.with_paid_tickets)} had paid tickets` })),
  ];
}

export function paidLines(b) {
  if (!Array.isArray(b.by_currency)) return ['Not recorded'];
  if (!b.by_currency.length) return [b.count === 0 ? 'No paid tickets' : 'Amounts not recorded'];
  return b.by_currency.map((c) => c.amount_not_recorded > 0
    ? `${String(c.currency || 'Currency not recorded').toUpperCase()} · amount not recorded for ${count(c.amount_not_recorded)} tickets`
    : c.currency ? `${money(c.amount_cents, c.currency)} ${c.currency.toUpperCase()}` : 'Currency not recorded');
}

export function weeklyChart(b) {
  const rows = Array.isArray(b.weeks) ? b.weeks : [];
  return { type: 'lines', currentIndex: rows.findIndex((r) => r.to_date === true), labels: rows.map((r) => shortWeek(r.week_start)), series: [
    { label: 'Registrations', tone: 'violet', values: rows.map((r) => Number.isFinite(r.registrations) ? r.registrations : null) },
    { label: 'Check-ins', tone: 'sky', dash: true, values: rows.map((r) => Number.isFinite(r.checkins) ? r.checkins : null) },
  ] };
}
export function weeklySentence(weekly, showup) {
  const r = weekly.registrations;
  const comparison = registrationDelta(r?.this_period, r?.previous_period);
  const attendance = showup.state === 'ready'
    ? showup.events === 0 ? 'No event has ended yet.' : showup.seats_taken === 0 ? 'No seats were taken at ended events.' : `${percent(showup.rate)} of people who took a seat at ended events came.`
    : showup.state === 'loading' ? 'Show-up is still being read.' : showup.state === 'unrecorded' ? 'Show-up is not recorded.' : 'Show-up could not be read.';
  return `${comparison}. ${attendance}`;
}

export function typeRows(b, showAll) {
  return EVENT_TYPES.map((t) => ({ label: t.label, value: Number.isFinite(b.counts?.[t.id]) ? b.counts[t.id] : null, text: count(b.counts?.[t.id]), tone: 'violet' }))
    .filter((r) => showAll || r.value !== 0).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
}
/** D915: founders, investors, advisors, operating partners, then explorers/guests/admins as Other. */
export function profileParts(b) {
  const c = b.counts || {};
  return [
    { label: 'Founders', value: c.founder, tone: 'violet' },
    { label: 'Investors', value: c.investor, tone: 'sky' },
    { label: 'Advisors', value: c.advisor, tone: 'amber' },
    { label: 'Operating Partners', value: c.partner, tone: 'emerald' },
    { label: 'Other', value: [c.exploring, c.guest, c.admin].every(Number.isFinite) ? c.exploring + c.guest + c.admin : null, tone: 'muted' },
  ];
}
export function sourceParts(b) {
  return [
    { label: 'Signed up', value: b.counts?.signed_up, tone: 'violet' },
    { label: 'Invitation', value: b.counts?.invitation, tone: 'sky' },
    { label: 'Free seat', value: b.counts?.free_seat, tone: 'amber' },
  ];
}
export function overviewStatuses(b) {
  const rows = STATUSES.map((s) => ({ ...s, count: b.counts?.[s.key] }));
  if (b.counts?.other > 0) rows.push({ key: 'other', word: 'Other', tone: 'muted', count: b.counts.other });
  return rows;
}

const ATTENTION = {
  overdue: ['Overdue', 'Review queue', 'amber'], full: ['Full', 'Change capacity', 'muted'],
  low_signups: ['Low sign-ups', 'Open', 'muted'], clash: ['Clash', 'See calendar', 'amber'],
  changed_after_approval: ['Changed after approval', 'Open', 'amber'], paid_on_cancelled: ['Paid tickets', 'Open', 'red'],
};
export function attentionRows(b) {
  return (Array.isArray(b.items) ? b.items : []).slice(0, 6).map((r) => {
    const [label, action, tone] = ATTENTION[r.kind] || ['Needs attention', 'Open', 'muted'];
    const detail = r.kind === 'overdue' ? `has waited ${count(r.waiting_hours)} hours.`
      : r.kind === 'paid_on_cancelled' ? `was cancelled with ${count(r.paid_tickets)} paid tickets. Refunds are handled in Revenue › Billing.`
      : r.kind === 'clash' ? 'overlaps another event.'
      : r.kind === 'changed_after_approval' ? 'changed after approval.'
      : r.kind === 'full' ? `has ${count(r.seats_taken)} of ${count(r.capacity)} seats taken, ${count(r.waitlisted)} waiting.` : `starts soon with ${count(r.seats_taken)} of ${count(r.capacity)} seats taken.`;
    return { ...r, label, action, tone, detail, href: r.kind === 'overdue' ? '/admin/events/review' : r.kind === 'clash' ? `/admin/events/calendar?month=${String(r.starts_at || '').slice(0, 7)}` : `/admin/events/${r.event_id}` };
  });
}

/** D918's overview has no Next-up rows: use its enriched paged list, never the capped analytics read. */
export function nextEvents(read, now) {
  const rows = readyList(read);
  if (rows === null) return { state: read?.status === 'loading' ? 'loading' : 'unreadable', reason: 'The events list could not be read.' };
  return { state: 'ready', rows: rows.filter((e) => ['published', 'pending_review'].includes(e.status) && parseStamp(e.starts_at) >= now)
    .sort((a, b) => parseStamp(a.starts_at) - parseStamp(b.starts_at) || a.id - b.id).slice(0, 5).map((e) => ({ ...e,
      typeLabel: EVENT_TYPES.find((t) => t.id === e.type)?.label || 'Type not recorded',
      formatLabel: ({ virtual: 'Online', physical: 'In person', in_person: 'In person', hybrid: 'Hybrid' })[e.location_kind] || 'Format not recorded',
      when: whenLine(e), statusLabel: statusWord(e.status),
    })) };
}
