/**
 * D1035 (#2876, part 5 of #2387) — My events' two drawers and their dialogs,
 * as pure functions: the ticket at `/my/events/ticket/[event id]` (MEV3), the
 * hosted event at `/my/events/hosting/[event id]` (MEV5), the publish dialogs
 * (MEV6), the cancel dialogs (MEV7) and MEV17. No React here, so `node --test`
 * loads it alone.
 *
 * The reads:
 *   - `GET /api/events`: the place (`attending`, then `past.places`) with its
 *     payment, comp, check-in code and the host's reason (D1032), and each
 *     hosted event with its counts;
 *   - `GET /api/events/:id`: the event, the agenda and the caller's own
 *     registration, for a place older than Past's first page and for an admin
 *     opening an event someone else hosts;
 *   - `GET /api/calendar/event-links/:id`: Google and Outlook (D1033).
 * The host's name is in none of them, so the ticket says so.
 */
import { formatWord, isPast, statusOf, timeLine, visibilityWord } from './myEventsModel';
import { GATE, onEventDay } from './hostHeaderModel';
import { publishAction } from './eventOrganiserModel';

export const MY = '/my/events';
export const ticketPath = (id) => `${MY}/ticket/${encodeURIComponent(String(id))}`;
export const hostedPath = (id) => `${MY}/hosting/${encodeURIComponent(String(id))}`;

/** Which drawer an address opens, if any: `{ kind: 'ticket' | 'hosted', id }`. */
export function drawerOf(pathname) {
  const m = /^\/my\/events\/(ticket|hosting)\/([^/]+)\/?$/.exec(String(pathname || ''));
  if (!m) return null;
  const id = Number(decodeURIComponent(m[2]));
  // A malformed id still opens the drawer, which says the event was not found.
  return { kind: m[1] === 'ticket' ? 'ticket' : 'hosted', id: Number.isInteger(id) && id > 0 ? id : null };
}

/** The tab under a drawer: Upcoming under a ticket, Hosting under a hosted event. */
export const tabUnder = (drawer) => (drawer?.kind === 'hosted' ? 'hosting' : 'upcoming');

export const NOT_HOST = 'Only the host and studio admins manage this event.';
/**
 * D967 (#3350): the ticket's host line, from the event read's `host_name`
 * (`GET /api/events/:id`). A null name is "Not recorded" with its reason;
 * a read that failed says so, never a host.
 */
export const HOST_NOT_RECORDED = 'Not recorded: this event has no host on record, or the host’s account was removed.';
export function hostLine(detail) {
  if (!detail || detail.status === 'loading') return { state: 'loading', text: 'Reading…' };
  if (detail.status !== 'ready') return { state: 'unreadable', text: 'The host’s name could not be read.' };
  const name = typeof detail.data?.host_name === 'string' ? detail.data.host_name.trim() : '';
  return name ? { state: 'named', text: `Hosted by ${name}` } : { state: 'not_recorded', text: HOST_NOT_RECORDED };
}
export const NO_PLACE = 'You hold no place at this event.';
export const JOIN_FOOT = 'The join link shows only to people holding a seat.';
export const CODE_LINE = 'Show this at the door. The host scans it to check you in.';
export const NO_CODE = 'The check-in code appears once your seat is confirmed and paid.';
/** MEV17b: kept for the day the owner closes My events to Explorers. D1030 opened it to them (MEV2). */
export const MY_EVENTS_OPEN_TO_EXPLORERS = true;
export const EXPLORER_CLOSED = {
  title: 'Events open once your profile is set.',
  line: 'Until then, the public calendar shows what is coming up.',
  actions: [{ label: 'See the public calendar', to: '/events' }, { label: 'Go to your home', to: '/' }],
};

const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Money in the event's currency, or null when no amount is recorded. */
export function money(cents, currency) {
  const c = n(cents);
  if (c == null) return null;
  const code = /^[A-Za-z]{3}$/.test(String(currency || '')) ? String(currency).toUpperCase() : 'USD';
  try { return (c / 100).toLocaleString('en-US', { style: 'currency', currency: code, maximumFractionDigits: c % 100 ? 2 : 0 }); }
  catch { return `${c / 100} ${code}`; }
}

/** Your place at this event: in Upcoming first, then Past's page. Null when neither read holds one. */
export function placeIn(list, id) {
  const want = Number(id);
  const hit = (rows) => (Array.isArray(rows) ? rows : []).find((r) => Number(r?.id) === want) || null;
  return hit(list?.attending) || hit(list?.past?.places) || null;
}

/**
 * The place from `GET /api/events/:id` when the list does not hold it (a
 * place older than Past's first page): the event with its registration's
 * status, payment and waitlist position. No comp, code or reason source here.
 */
export function placeFromDetail(detail) {
  const r = detail?.registration;
  if (!detail?.event || !r) return null;
  return {
    ...detail.event,
    registration_id: n(r.id),
    reg_status: r.status,
    payment_status: r.payment_status ?? null,
    reg_waitlist_position: n(r.waitlist_position),
    decision_reason: r.decision_reason ?? null,
    from_detail: true,
  };
}

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

/**
 * The ticket's state (MEV3, MEV3a–d), in the canvas's words, never an event
 * or registration code:
 *   - `pay`: a seat held for a paid ticket that is not paid (Pay to confirm);
 *   - `waitlist`: Waitlist · #n;
 *   - `host`: waiting for the host's approval;
 *   - `declined`, `cancelled`, `event_cancelled`, `ended`: no longer a seat;
 *   - `going`: a seat (Going, or Checked in).
 */
export function ticketState(place, now = Date.now()) {
  if (!place) return null;
  const s = place.reg_status;
  if (s === 'declined') return 'declined';
  if (s === 'cancelled') return 'cancelled';
  if (place.status === 'cancelled') return 'event_cancelled';
  if (s === 'waitlisted') return 'waitlist';
  if (isPast(place, now)) return 'ended';
  if (place.payment_status === 'pending' && (s === 'registered' || s === 'confirmed')) return 'pay';
  if (s === 'registered') return 'host';
  if (s === 'confirmed' || s === 'attended') return 'going';
  return null;
}

/** The pill and the note for a ticket that holds no code yet (MEV3a–d), or for one that ended. */
export function ticketCard(place, now = Date.now()) {
  const state = ticketState(place, now);
  const price = money(place?.amount_cents ?? place?.price_cents, place?.currency);
  switch (state) {
    case 'pay': return {
      state, pill: { label: price ? `Pay to confirm · ${price}` : 'Pay to confirm', tone: 'warn' }, tone: 'warn',
      note: price ? `Your seat is held until you pay ${price}. The check-in code appears after payment.` : 'Your seat is held until you pay. The check-in code appears after payment.',
      action: { label: 'Pay now', to: `/events/${place.id}` }, foot: 'Pay now opens the checkout on the event page.',
    };
    case 'waitlist': {
      const pos = n(place.reg_waitlist_position);
      const where = pos && pos > 0 ? (pos <= ORDINAL.length ? `You’re ${ORDINAL[pos - 1]} on the waitlist.` : `You’re #${pos} on the waitlist.`) : 'You’re on the waitlist.';
      return {
        state, pill: { label: pos && pos > 0 ? `Waitlist · #${pos}` : 'Waitlist', tone: 'warn' }, tone: 'info',
        note: `${where} You’ll be told if a seat opens.`, action: { label: 'Leave the waitlist', dialog: 'place' }, foot: 'No check-in code until a seat opens.',
      };
    }
    case 'host': return {
      state, pill: { label: 'Waiting for the host', tone: 'warn' }, tone: 'warn',
      note: 'The host approves each registration. You’ll be told when they decide.', action: null, foot: 'No check-in code until the host approves.',
    };
    case 'declined': return {
      state, pill: { label: 'Declined by the host', tone: 'bad' }, tone: 'bad',
      note: place.decision_reason ? `The host declined: ‘${place.decision_reason}’` : 'The host declined your registration. No reason is recorded.',
      action: null, foot: 'It is in Past.',
    };
    case 'cancelled': return { state, pill: { label: 'You cancelled', tone: 'muted' }, tone: 'info', note: 'You cancelled this place.', action: null, foot: 'It is in Past.' };
    case 'event_cancelled': return { state, pill: { label: 'Event cancelled', tone: 'bad' }, tone: 'bad', note: 'The host cancelled this event.', action: null, foot: 'It is in Past.' };
    case 'ended': return { state, pill: { label: place.reg_status === 'attended' || place.checked_in_at ? 'Checked in' : 'Ended', tone: 'muted' }, tone: 'info', note: 'This event has ended.', action: null, foot: 'It is in Past.' };
    default: return null;
  }
}

/** Whether "Cancel my place" belongs on this ticket: a seat, a hold or a waitlist place, before the event. */
export const canCancelPlace = (place, now = Date.now()) => ['going', 'pay', 'host', 'waitlist'].includes(ticketState(place, now));

const COMP_WORD = {
  invitation: 'An invitation',
  official_partner: 'Official partner',
  invested_lp: 'Invested LP',
  investor: 'Investor',
  startup_founder: 'Startup founder',
  host_contact: 'The host’s contact',
};

/** "Your seat" (MEV3): a free seat and where it came from, a paid ticket, or a free event. */
export function seatLine(place) {
  if (!place) return null;
  if (place.comp) {
    const word = COMP_WORD[place.comp_source];
    if (word) return { text: `Free seat · ${word}`, sub: 'Given by an invitation.' };
    return { text: 'Free seat', sub: 'Given by the event’s audience rules. Which rule is not recorded.' };
  }
  const price = money(place.amount_cents, place.currency);
  if (price && Number(place.amount_cents) > 0) {
    return { text: `Paid ticket · ${price}`, sub: place.payment_status === 'paid' ? 'Paid.' : place.payment_status === 'pending' ? 'Not paid yet.' : 'Payment not recorded.' };
  }
  if (Number(place.price_cents) > 0) return { text: 'Paid ticket', sub: 'The amount is not recorded on your place.' };
  return { text: 'Free event', sub: null };
}

/** An in-person or hybrid address opens in maps; an online event has none. */
export function mapsUrl(place) {
  const text = String(place?.location_text || '').trim();
  if (!text || place?.location_kind === 'virtual' || place?.location_kind === 'online') return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
}

/** The join link, only as the read sent it: the Worker sends it to seat holders alone (#2623). */
export function joinLinkOf(place) {
  const url = String(place?.location_url || '');
  if (!/^https?:\/\//i.test(url)) return null;
  if (place?.location_kind === 'in_person' || place?.location_kind === 'physical') return null;
  return url;
}

/** "When and where" (MEV3). */
export function whenWhere(place, viewerZone) {
  return {
    when: timeLine(place, viewerZone),
    where: place?.location_text || formatWord(place?.location_kind) || 'Not recorded',
    maps: mapsUrl(place),
    join: joinLinkOf(place),
  };
}

/** One agenda line: "18:00", the title, the speaker. */
export function agendaRows(agenda, zone) {
  return (Array.isArray(agenda) ? agenda : []).map((a) => {
    let at = '';
    const t = Date.parse(a?.starts_at || '');
    if (Number.isFinite(t)) {
      try { at = new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: zone || 'UTC' }); }
      catch { at = new Date(t).toISOString().slice(11, 16); }
    }
    return { key: a.id, at, title: a.title || 'Not recorded', speaker: [a.speaker_name, a.speaker_title].filter(Boolean).join(' · ') || null };
  });
}

/* ------------------------------------------------------------------ *
 * The hosted event (MEV5, MEV5b)
 * ------------------------------------------------------------------ */

/** Whether the caller may manage this event: its host, or an admin (`canManage`). */
export const mayManage = (event, user) => !!event && !!user
  && (String(user.role || '').toLowerCase() === 'admin' || Number(event.host_user_id) === Number(user.id));

/** The publish gate line (MEV5b), the host header's own (D1036), with lines for the states it leaves out. */
export function gateOf(event) {
  if (!event) return null;
  if (event.status === 'pending_review') return { key: 'wait', text: GATE.wait, tone: 'warn' };
  if (event.status === 'published') {
    if (event.visibility === 'public') return { key: 'pub', text: GATE.pub, tone: 'muted' };
    if (event.visibility === 'private') return { key: 'pri', text: GATE.pri, tone: 'muted' };
    if (event.visibility === 'unlisted') return { key: 'unl', text: GATE.unl, tone: 'muted' };
  }
  if (event.status === 'draft' || event.status === 'rejected') {
    const vis = visibilityWord(event.visibility);
    return event.visibility === 'public'
      ? { key: 'draft', text: `${vis} · ${statusOf(event).label} → Not on the public calendar. An admin reviews it once you send it.`, tone: 'muted' }
      : { key: 'draft', text: `${vis} · ${statusOf(event).label} → Registration opens once you publish it.`, tone: 'muted' };
  }
  return null;
}

const day = (v) => {
  const t = Date.parse(String(v || '').includes('T') || String(v || '').endsWith('Z') ? v : `${String(v || '').replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
};

/**
 * "What to do next" for each status (MEV5, MEV5b). `counts` is the list's
 * (D1032), or null when it was not read (an admin's view of another host's
 * event); a count it does not hold is never drawn as 0.
 */
export function nextStep(event, counts, now = Date.now()) {
  if (!event) return null;
  const id = event.id;
  switch (event.status) {
    case 'draft': {
      const act = publishAction(event.visibility, event.status);
      if (isPast(event, now)) return { eye: 'DRAFT', title: 'Its start date has passed. Change the date, or cancel it.', actions: [{ label: 'Edit details', to: `/events/${id}/edit` }] };
      return { eye: 'DRAFT', title: 'Finish the details, then publish.', actions: [{ label: 'Edit details', to: `/events/${id}/edit` }].concat(act ? [{ label: act.label, dialog: 'publish' }] : []) };
    }
    case 'rejected': return {
      // No send-back date is stored (`updated_at` moves with every edit), so none is drawn.
      eye: 'SENT BACK', title: 'Sent back by an admin.',
      note: event.review_note ? `‘${event.review_note}’` : 'No reason is recorded.',
      actions: [{ label: 'Edit and resend', to: `/events/${id}/edit` }],
    };
    case 'pending_review': return {
      eye: 'WAITING FOR REVIEW', title: event.submitted_at && day(event.submitted_at) ? `Submitted ${day(event.submitted_at)}.` : 'Submitted.',
      note: 'You’ll be told when an admin approves it or sends it back.', actions: [],
    };
    case 'published': {
      if (onEventDay(event, now)) {
        const seats = n(counts?.seats_taken);
        const inn = n(counts?.checked_in);
        return {
          eye: 'WHAT TO DO NEXT', title: 'Check-in is open.',
          progress: seats != null && inn != null ? { text: `${inn.toLocaleString('en-US')} of ${seats.toLocaleString('en-US')} checked in`, pct: seats > 0 ? Math.min(100, Math.round((inn / seats) * 100)) : 0 } : null,
          actions: [{ label: 'Check in', to: `/events/${id}/manage/check-in`, primary: true }],
        };
      }
      if (isPast(event, now)) {
        const seats = n(counts?.seats_taken);
        const inn = n(counts?.checked_in);
        return {
          eye: 'ENDED', title: seats != null && inn != null ? `${inn.toLocaleString('en-US')} of ${seats.toLocaleString('en-US')} came.` : 'It has ended. Who came is not read here.',
          actions: [{ label: 'Download roster (CSV)', href: `/api/events/${id}/export` }],
        };
      }
      return { eye: 'PUBLISHED · AHEAD', title: 'Registration is open.', actions: [{ label: 'Invite people', to: `/events/${id}/manage/registrations` }, { label: 'Registrations', to: `/events/${id}/manage/registrations` }] };
    }
    case 'cancelled': return { eye: 'CANCELLED', title: 'This event is cancelled.', note: 'Everyone who held a place was sent a notice.', actions: [] };
    default: return null;
  }
}

/**
 * The four tiles (MEV5) from the list's counts. Checked in is a dash until
 * the event's day; a count that was not read is "Not read here yet".
 */
export function hostedTiles(event, counts, now = Date.now()) {
  const read = counts && typeof counts === 'object';
  const num = (v) => (read && n(v) != null ? n(v).toLocaleString('en-US') : null);
  const cap = n(event?.capacity);
  const seats = num(counts?.seats_taken);
  const started = onEventDay(event, now) || isPast(event, now);
  return [
    { key: 'seats', label: 'Seats taken', value: seats == null ? null : cap != null ? `${seats} of ${cap.toLocaleString('en-US')}` : seats, sub: seats != null && cap == null ? 'No seat limit' : null },
    { key: 'waitlist', label: 'Waitlist', value: num(counts?.waitlisted) },
    { key: 'approve', label: 'To approve', value: num(counts?.pending_approvals) },
    started
      ? { key: 'checked', label: 'Checked in', value: num(counts?.checked_in) }
      : { key: 'checked', label: 'Checked in', value: read ? '—' : null, sub: read ? 'Not held yet' : null },
  ];
}

const PROFILE = { admin: 'Admin', founder: 'Founder', partner: 'Partner', investor: 'Investor', advisor: 'Advisor', exploring: 'Explorer' };
const FREE = [
  ['comp_official_partners', 'Official partners'],
  ['comp_invested_lps', 'Invested LPs'],
  ['comp_investors', 'Investors'],
  ['comp_project_founders', 'Startup founders'],
  ['comp_host_connections', 'Your contacts'],
];

/** "Who may register" (MEV5) from the event's audience rules, sent to its manager only. Null when not read. */
export function whoMayRegister(event) {
  const rules = event?.audience_rules;
  if (!rules || typeof rules !== 'object') return null;
  const lines = [];
  if (rules.mode === 'invite_only') lines.push('Invite only');
  else if (rules.mode === 'selected') {
    const roles = (Array.isArray(rules.roles) ? rules.roles : []).map((r) => PROFILE[r] || r);
    const personas = Array.isArray(rules.personas) ? rules.personas.length : 0;
    lines.push(roles.length ? `Selected profiles: ${roles.join(', ')}` : 'Selected profiles: none chosen');
    if (personas) lines.push(`${personas.toLocaleString('en-US')} ${personas === 1 ? 'persona' : 'personas'} chosen`);
  } else lines.push('Everyone with an account');
  const free = FREE.filter(([k]) => rules[k]).map(([, w]) => w);
  lines.push(free.length ? `Free seats for: ${free.join(', ')}` : 'No free seats by rule');
  if (event.approval_required) lines.push('The host approves each registration');
  return lines;
}

/** The four host pages (MEV5), each a literal address. */
export const hostPages = (id) => [
  { key: 'details', label: 'Details', sub: 'Title, time, place and description', to: `/events/${id}/edit` },
  { key: 'who', label: 'Who may register', sub: 'Profiles, capacity, approvals and free seats', to: `/events/${id}/manage` },
  { key: 'registrations', label: 'Registrations', sub: 'Approve, decline and message registrants', to: `/events/${id}/manage/registrations` },
  { key: 'agenda', label: 'Agenda', sub: 'Sessions, speakers and rooms', to: `/events/${id}/manage/agenda` },
];

/** Whether Cancel event belongs on the drawer: an event that is not cancelled and has not ended. */
export const canCancelEvent = (event, now = Date.now()) => !!event && event.status !== 'cancelled' && !isPast(event, now);

/* ------------------------------------------------------------------ *
 * The dialogs (MEV6, MEV7)
 * ------------------------------------------------------------------ */

const plural = (k, one, many) => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`;

/**
 * The publish dialog (MEV6a–c) for a draft or sent-back event, through
 * `POST /api/events/:id/submit-review`. Null for any other status.
 */
export function publishDialog(event, counts) {
  const act = publishAction(event?.visibility, event?.status);
  if (!act) return null;
  const title = event.title || 'this event';
  if (event.visibility === 'public') {
    return {
      kind: 'review', title: `Send ${title} for review?`, action: 'Send for review', busy: 'Sending…',
      lines: [
        'An admin checks public events before they go on the public calendar.',
        'You can still edit it while it waits; a change after approval may send it back.',
        'Admins see it in their review queue. No one else is told.',
      ],
      done: 'Sent for review.',
    };
  }
  const invites = n(counts?.invitations_open);
  const waiting = invites == null ? 'How many invitations are waiting is not read here.' : invites === 0 ? 'No invitations are waiting yet.' : `${plural(invites, 'invitation is', 'invitations are')} waiting for this.`;
  return event.visibility === 'unlisted'
    ? { kind: 'publish', title: `Publish ${title}?`, action: 'Publish', busy: 'Publishing…', lines: ['It goes live now. Anyone with the link can register. It is not listed on the public calendar.', 'Publishing sends no notice: share the link or invite people.'], done: 'Published.' }
    : { kind: 'publish', title: `Publish ${title}?`, action: 'Publish', busy: 'Publishing…', lines: ['It goes live now. Only people you invite can see it and register.', waiting, 'Publishing sends no notice of its own.'], done: 'Published.' };
}

/** Cancel my place (MEV7a), through `DELETE /api/events/:id/registration`; the paid-seat box only for a paid seat. */
export function cancelPlaceDialog(place, now = Date.now()) {
  const state = ticketState(place, now);
  if (!canCancelPlace(place, now)) return null;
  const title = place.title || 'this event';
  const paid = place.payment_status === 'paid' && Number(place.amount_cents) > 0;
  if (state === 'waitlist') {
    return { title: `Leave the waitlist for ${title}?`, lines: ['You lose your place in the queue.', 'The host sees it in Registrations. No one is sent a notice.'], paidBox: null, keep: 'Stay on the waitlist', action: 'Leave the waitlist', done: 'You left the waitlist.' };
  }
  return {
    title: `Cancel your place at ${title}?`,
    lines: [
      state === 'host' ? 'Your request to the host is withdrawn.' : 'Your seat goes to the next person on the waitlist, if there is one, and they are told.',
      'The host sees it in Registrations.',
    ],
    paidBox: paid ? 'StudioOS does not refund a place you cancel. Ask the studio team about a refund.' : null,
    keep: 'Keep my place', action: 'Cancel my place', done: 'Your place is cancelled.',
  };
}

/** Cancel event (MEV7b), through the host's cancel (D1032): who is told from the counts; the paid-ticket box for a paid event. */
export function cancelEventDialog(event, counts, now = Date.now()) {
  if (!canCancelEvent(event, now)) return null;
  const seats = n(counts?.seats_taken);
  const wait = n(counts?.waitlisted);
  const told = seats != null && wait != null
    ? (seats + wait === 0 ? 'No one holds a place yet, so no one gets a notice.' : `${plural(seats, 'person registered', 'people registered')} and ${plural(wait, 'person waitlisted', 'people waitlisted')} get a notice.`)
    : 'Everyone who holds a place or a waitlist spot gets a notice.';
  return {
    title: `Cancel ${event.title || 'this event'}?`,
    sub: 'This cannot be undone.',
    lines: ['It leaves every calendar.', told],
    paidBox: Number(event.price_cents) > 0 ? 'Paid tickets were paid to the studio, not to you. The Events desk handles their refunds.' : null,
    noteLabel: 'Note to registrants · optional', keep: 'Keep event', action: 'Cancel event',
  };
}

/** What the host's cancel answered: the paid tickets handed to the desk, in their own words. */
export function cancelledLine(reply) {
  const paid = reply?.paid_tickets;
  const k = n(paid?.count);
  if (k == null) return 'Event cancelled.';
  if (k === 0) return 'Event cancelled. No paid tickets to refund.';
  const sums = (Array.isArray(paid.by_currency) ? paid.by_currency : []).map((r) => money(r.amount_cents, r.currency)).filter(Boolean);
  return `Event cancelled. ${plural(k, 'paid ticket', 'paid tickets')}${sums.length ? ` (${sums.join(', ')})` : ''} went to the Events desk for refunds.`;
}
