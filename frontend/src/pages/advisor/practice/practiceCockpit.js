/** D4829: recorded Practice cockpit facts, with independent sources, calendar dates and exact record destinations. */
import { formatMinor } from '../../../lib/money.js';
import { earningsCards } from './earningsLedger.js';
import { SIGNED_LANES } from './engagementBoard.js';
import { classifyBooking } from './opportunityLog.js';

export const PRACTICE_SOURCES = {
  bookings: { label: 'Requests and sessions', to: '/practice/opportunities' },
  engagements: { label: 'Engagements', to: '/practice/engagements' },
  deliverables: { label: 'Delivery', to: '/practice/delivery' },
  ledger: { label: 'Recorded earnings', to: '/practice/earnings' },
  availability: { label: 'Practice timezone', to: '/practice/sessions' },
};
export const recordLink = (kind, id) => {
  const zone = { request: 'opportunities', engagement: 'engagements', session: 'sessions', delivery: 'delivery' }[kind];
  return zone && Number.isSafeInteger(Number(id)) && Number(id) > 0
    ? `/practice/${zone}?record=${kind}&id=${Number(id)}` : '/practice';
};
export function instant(value) {
  if (!value) return NaN;
  const raw = String(value).replace(' ', 'T');
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${raw}Z`);
}
export function calendarDay(value, timeZone) {
  const date = new Date(typeof value === 'number' ? value : instant(value));
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = type => parts.find(p => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function clockTime(value, timeZone) {
  const at = typeof value === 'number' ? value : instant(value);
  return Number.isFinite(at) ? new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(at) : 'Time not recorded';
}
const rows = (src, key) => src[key]?.state === 'read' ? src[key].data.items : [];
const total = (value, data) => data?.complete === false ? (value ? `${value}+` : 'Not recorded') : value;
const name = row => row.client_name || row.client_user_name || 'Client name not recorded';
const money = cents => formatMinor(cents, 'USD', { locale: 'en-US' }) ?? 'Not recorded';
const loadedBasis = data => data?.complete === false ? `Loaded ${data.items.length} of ${data.total ?? 'more'} records; this is a partial view.` : null;

export function cockpitModel(src, now = Date.now()) {
  let timeZone = src.availability?.state === 'read' ? src.availability.data.timezone || 'UTC' : null;
  try { if (timeZone) new Intl.DateTimeFormat('en', { timeZone }); } catch { timeZone = null; }
  const day = timeZone ? calendarDay(now, timeZone) : null;
  const month = day?.slice(0, 7);
  const bookings = rows(src, 'bookings'), engagements = rows(src, 'engagements'), delivery = rows(src, 'deliverables');
  const liveSessions = bookings.filter(b => b.status === 'confirmed');
  const waiting = bookings.filter(b => classifyBooking({ ...b, startsAt: b.slot_starts_at }, now) === 'awaiting')
    .sort((a, b) => (instant(a.created_at) || Infinity) - (instant(b.created_at) || Infinity));
  const renewals = engagements.filter(e => e.lane === 'renewal_due' || (e.lane === 'signed' && month && String(e.term_ends_at || '').slice(0, 7) === month))
    .sort((a, b) => String(a.term_ends_at || '9999').localeCompare(String(b.term_ends_at || '9999')));
  const sessionsToday = day ? liveSessions.filter(b => calendarDay(b.slot_starts_at, timeZone) === day).sort((a, b) => instant(a.slot_starts_at) - instant(b.slot_starts_at)) : [];
  const nextToday = sessionsToday.find(b => instant(b.slot_ends_at || b.slot_starts_at) > now) || sessionsToday[0];
  const ready = delivery.filter(d => d.ready_version != null && d.versions?.some(v => Number(v.version) === Number(d.ready_version) && v.ready_at && !v.sent_at));
  const ledger = src.ledger?.state === 'read' ? src.ledger.data : null;
  const queue = [];
  if (waiting.length) {
    const oldest = waiting[0], age = Math.floor((now - instant(oldest.created_at)) / 86400000);
    queue.push({ key: 'requests', title: `${total(waiting.length, src.bookings.data)} ${waiting.length === 1 ? 'request' : 'requests'} waiting`, detail: Number.isFinite(age) ? `Oldest ${Math.max(0, age)} days · ${name(oldest)}` : 'Request date not recorded', to: recordLink('request', oldest.id), action: 'Review oldest', priority: 1 });
  }
  if (renewals.length) {
    const e = renewals[0];
    queue.push({ key: 'renewals', title: `${total(renewals.length, src.engagements.data)} ${e.lane === 'renewal_due' ? (renewals.length === 1 ? 'renewal due' : 'renewals due') : 'term ending this month'}`, detail: `${name(e)} · ${e.term_ends_at || 'Term end not recorded'}`, to: recordLink('engagement', e.id), action: 'Open engagement', priority: e.term_ends_at && e.term_ends_at < day ? 0 : 2 });
  }
  if (sessionsToday.length) queue.push({ key: 'sessions', title: `${total(sessionsToday.length, src.bookings.data)} ${sessionsToday.length === 1 ? 'session' : 'sessions'} today`, detail: `${instant(nextToday.slot_ends_at || nextToday.slot_starts_at) > now ? 'Next' : 'Earlier'} ${clockTime(nextToday.slot_starts_at, timeZone)} · ${name(nextToday)}`, to: recordLink('session', nextToday.id), action: 'Open session', priority: 3 });
  if (ready.length) queue.push({ key: 'ready', title: `${total(ready.length, src.deliverables.data)} ${ready.length === 1 ? 'work product' : 'work products'} ready to send`, detail: `${name(ready[0])} · ${ready[0].title}`, to: recordLink('delivery', ready[0].id), action: 'Review', priority: 4 });
  const unpaid = ledger?.states?.billed;
  if (unpaid?.gross_cents > 0) queue.push({ key: 'money', title: `${money(unpaid.gross_cents)} recorded outstanding`, detail: `${unpaid.sessions} sessions marked billed, not collected`, to: '/practice/earnings', action: 'Open Earnings', priority: 5 });
  queue.sort((a, b) => a.priority - b.priority);

  const today = [];
  for (const b of sessionsToday) today.push({ key: `session-${b.id}`, at: instant(b.slot_starts_at), time: clockTime(b.slot_starts_at, timeZone), client: name(b), title: b.topic || 'Session', state: 'Confirmed', to: recordLink('session', b.id) });
  for (const d of delivery) {
    if (day && d.due_date === day && !d.latest_version?.sent_at) today.push({ key: `due-${d.id}`, at: Infinity, time: 'Today', client: name(d), title: `${d.title} · due today`, state: 'Due', to: recordLink('delivery', d.id) });
    for (const v of d.versions || []) {
      for (const [field, event, state] of [['sent_at', 'sent', 'Sent'], ['opened_at', 'opened', 'Opened'], ['signed_off_at', 'accepted', 'Accepted']]) {
        if (day && calendarDay(v[field], timeZone) === day) today.push({ key: `${event}-${d.id}-${v.version}`, at: instant(v[field]), time: clockTime(v[field], timeZone), client: v.recipient_name || (v.recipient_user_id != null && Number(v.recipient_user_id) === Number(d.client_user_id) ? name(d) : 'Recipient not recorded'), title: `${d.title} v${v.version}`, state, to: recordLink('delivery', d.id) });
      }
    }
  }
  for (const e of engagements) if (day && SIGNED_LANES.has(e.lane) && e.term_ends_at === day) today.push({ key: `term-${e.id}`, at: Infinity, time: 'Today', client: name(e), title: e.scope_label || 'Engagement term ends', state: 'Term ends', to: recordLink('engagement', e.id) });
  today.sort((a, b) => a.at - b.at);

  const upcoming = liveSessions.filter(b => instant(b.slot_starts_at) >= now && instant(b.slot_starts_at) < now + 14 * 86400000);
  const sent = delivery.reduce((n, d) => n + (d.versions || []).filter(v => month && calendarDay(v.sent_at, timeZone)?.slice(0, 7) === month).length, 0);
  const earnings = earningsCards(ledger);
  const health = [
    { key: 'active', source: 'engagements', title: 'Active engagements', value: src.engagements?.data?.first?.totals?.active ?? total(engagements.filter(e => SIGNED_LANES.has(e.lane)).length, src.engagements?.data), basis: 'Signed and renewal due', to: '/practice/engagements' },
    { key: 'upcoming', source: 'bookings', title: 'Upcoming sessions', value: total(upcoming.length, src.bookings?.data), basis: 'Confirmed · next 14 days', to: '/practice/sessions' },
    { key: 'sent', source: timeZone ? 'deliverables' : 'availability', title: 'Delivered this month', value: total(sent, src.deliverables?.data), basis: `Versions sent · ${timeZone || 'timezone unreadable'}`, to: '/practice/delivery' },
    ...['billed', 'collected'].map(key => ({ key, source: 'ledger', title: key === 'billed' ? 'Recorded billed' : 'Recorded collected', value: money(earnings.find(c => c.key === key)?.cents), basis: `All time · ${earnings.find(c => c.key === key)?.basis || 'Basis not recorded'}`, to: '/practice/earnings' })),
  ].map(h => ({ ...h, state: h.source === 'availability' && !timeZone && src.availability?.state === 'read' ? 'unreadable' : src[h.source]?.state || 'loading', basis: [h.basis, loadedBasis(src[h.source]?.data)].filter(Boolean).join(' ') }));

  const clients = new Map();
  function client(id, label, at) {
    if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) return;
    const key = Number(id), old = clients.get(key);
    if (!old) clients.set(key, { id: key, name: label, at: instant(at) || 0 });
    else if (instant(at) > old.at) { old.at = instant(at); old.name = label; }
  }
  engagements.forEach(e => client(e.founder_user_id, name(e), e.updated_at || e.created_at));
  bookings.forEach(b => client(b.client_user_id, name(b), b.updated_at || b.created_at));
  delivery.forEach(d => {
    client(d.client_user_id, name(d), d.updated_at || d.created_at);
    for (const v of d.versions || []) if (v.sent_at) client(v.recipient_user_id, v.recipient_name || 'Recipient name not recorded', v.signed_off_at || v.opened_at || v.sent_at);
  });
  const recent = [...clients.values()].sort((a, b) => b.at - a.at).slice(0, 4).map(c => {
    const es = engagements.filter(e => Number(e.founder_user_id) === c.id);
    const active = es.find(e => SIGNED_LANES.has(e.lane));
    const partialEngagements = src.engagements?.data?.complete === false;
    const next = bookings.filter(b => Number(b.client_user_id) === c.id && b.status === 'confirmed' && instant(b.slot_starts_at) >= now).sort((a, b) => instant(a.slot_starts_at) - instant(b.slot_starts_at))[0];
    const receivedDelivery = delivery.some(d => d.versions?.some(v => v.sent_at && Number(v.recipient_user_id) === c.id));
    const clientReady = ready.find(d => Number(d.client_user_id) === c.id);
    const lastHeld = bookings.filter(b => Number(b.client_user_id) === c.id && b.status === 'completed').sort((a, b) => instant(b.slot_starts_at) - instant(a.slot_starts_at))[0];
    return { ...c, engagement: src.engagements?.state !== 'read' ? 'Engagements could not be read' : active?.scope_label || (partialEngagements ? 'Engagements partially read' : es.length ? 'No active engagement' : 'No engagement yet'), next: next ? (timeZone ? `Next session ${clockTime(next.slot_starts_at, timeZone)} · ${calendarDay(next.slot_starts_at, timeZone)}` : 'Next session · practice timezone could not be read') : clientReady ? `${clientReady.title} v${clientReady.ready_version} ready to send` : src.bookings?.state !== 'read' ? 'Sessions could not be read' : lastHeld && timeZone ? `Last session ${calendarDay(lastHeld.slot_starts_at, timeZone)}` : src.deliverables?.state !== 'read' ? 'Delivery could not be read' : 'Next activity not recorded', relationship: src.engagements?.state !== 'read' ? 'Relationship could not be read' : active ? 'Active client' : partialEngagements ? 'Relationship partially read' : es.length && es.every(e => e.lane === 'ended') ? 'Past client' : lastHeld || receivedDelivery ? 'Client' : 'Prospect' };
  });
  return { queue, today, health, clients: recent, day, timeZone, sources: Object.entries(PRACTICE_SOURCES).map(([key, meta]) => ({ key, ...meta, state: key === 'availability' && !timeZone && src.availability?.state === 'read' ? 'unreadable' : src[key]?.state || 'loading', partial: loadedBasis(src[key]?.data) })) };
}
