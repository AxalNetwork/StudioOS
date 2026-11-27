import { centsToInput } from '../../../lib/moneyInput.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Skeleton } from '../../../ui';
import { api } from '../../../lib/api';
import { railProposalsApi } from '../../../lib/api/railProposals.js';
import {
  BLOCK_EXACT_SCOPE, BLOCK_QUERY_KEYS, blockWallInstant, blockWallRange, parseBlockQuery,
} from '../../../ui/sessionsBlockHandoff.js';
import { buildIcs, downloadIcs } from '../../../lib/ics';
import {
  Field, NothingYet, Pill, SaveNote, StatedLimit, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, dollarsToCents, ghostButtonClass, inputClass, money, zoneError,
} from '../expertise/kit';
import {
  KIND_LABEL, KIND_TONE, VIEW_DAYS, blackoutLabel, bookedNote, groupByDay,
  narrowSlots, openNote, ruleNote, ruleValue, slotCounts, slotKind, slotTime, windowFrom,
} from './sessionGrid';
import { bookingView, offerLine } from '../advisory/kit';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import LabHostApplyCard from '../../../components/officehours/LabHostApplyCard';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import { advisorZoneFilters } from '../../../workspaces/advisorZoneFilters';
import useScrollToHash from '../../../hooks/useScrollToHash';
import SessionTypesPanel from './SessionTypesPanel';
import BookingLinksPanel from './BookingLinksPanel';
import { PublishAvailabilityCard, SessionLifecyclePanel } from './SessionActions';
import { readEveryPage } from './everyPage';
import { bookingLinkUrl } from './practiceTools';
import { moneyState, priceClass, sessionCounts, sessionsFor, shareTarget } from './sessionFeed';

/**
 * Practice · Sessions — `/practice/sessions`, built to board PX-05 of the
 * Practice v2 canvas (D4874) by #4832 (D4832): OPERATIONS FIRST, SCHEDULING
 * SETUP SECOND.
 *
 * THE TOP OF THE PAGE IS THE ADVISOR'S DAY. The header carries Block time (the
 * primary) and Share booking link, and the chip row is Upcoming · Past ·
 * Cancelled over the bookings read. Each booking is a card (client, topic,
 * time, status, the offer it was booked on, its recorded price) with Open,
 * Complete, No-show and Cancel session (`SessionLifecyclePanel`). PAST IS TIME
 * THAT HAS PASSED (`sessionFeed.sessionTab`), never a wider forward window.
 *
 * THE PRICE IS WHAT THE BOOKING RECORDS. Free is a recorded $0, Included is
 * D5316's recorded state, Unpriced is no amount, and a missing price is never
 * Free. Collected, Billed and Written off are a separate money state. Open
 * holds the price record (`BillingEditor`): migration 205's `amount_cents` and
 * `billing_state` have exactly one writer in the product and it is here, with
 * #5358's confirmed reprice step and the Included control (#5316).
 *
 * YOUR HOURS sit below the feed: the published slots the bookings are made
 * into, with their own window (two weeks, a month, past hours, unpaid held),
 * the four tiles and the publish card. The grid reads `GET /me/slots`, not the
 * public `GET /:uid/slots`, because `recording_state`, `payment_state` and
 * `blocked_reason` must not reach a founder browsing this calendar.
 *
 * SCHEDULING SETUP is its own section, last: Availability, Session types and
 * Booking links. Practice Sessions owns booking configuration (owner's answer
 * on #4832, 2026-11-09); Expertise links to a session type read-only.
 *
 * NOTHING ON THIS PAGE CHARGES ANYONE. A held slot is rendered as the reason a
 * booking could NOT be charged and never as a receipt. D75.
 */

const STATE_LABEL = {
  unpriced: 'Unpriced',
  billed: 'Billed',
  collected: 'Collected',
  written_off: 'Written off',
  // #5316 (D5316): recorded as included in an engagement; no price of its own.
  included: 'Included',
};
// `unpriced` is absent from the picker on purpose: it is where a session
// STARTS, not somewhere an advisor moves one. Clearing the amount is how you
// go back, and that is one action rather than two that must agree.
const SETTABLE = ['billed', 'collected', 'written_off'];

const RECORDING_LABEL = {
  none: null,               // the common case draws no chip at all
  requested: 'Consent asked',
  consented: 'Recording',
  declined: 'No recording',
};

/**
 * The rule set's own empty shape, which is what this page HOLDS before the
 * read lands — never `null`.
 *
 * `<ZoneBody>`'s children are BUILT when this component renders, before
 * ZoneBody reads `loading` to choose between them and a skeleton, so a null
 * dereferenced in them throws on the very first render whatever `loading`
 * says. `frontend/test/_zoneGuards.mjs` rule 2 states it and fails the build.
 *
 * Its fields are all null rather than zero on purpose: `availabilityDto`
 * returns null for every unset rule and says so in its own comment, and a cap
 * nobody chose must not arrive on screen as a number (D56/D68). `configured`
 * is the route's own flag for "no row at all", carried here so the seed is the
 * same shape the server sends.
 */
const EMPTY_RULES = Object.freeze({
  weekly_paid_cap: null,
  buffer_minutes: null,
  min_notice_hours: null,
  blackouts: [],
  timezone: null,
  configured: false,
  revision: '',
});

/** D1424 / D1596: the Block form's shape, closed. Never null (a ZoneBody child reads it on first render). */
const CLOSED_BLOCK = Object.freeze({
  open: false, from: '', startTime: '', until: '', endTime: '', reason: '', error: '', proposal: '',
  sourceFrom: '', sourceUntil: '', timezone: '',
});

/**
 * #4832: the hours grid's own window. Two weeks and Month ask the server for a
 * different span; Past hours asks for the window that just ended (#4702);
 * Unpaid held narrows what is loaded. It was the zone's chip row until the
 * row became Upcoming · Past · Cancelled over the sessions themselves.
 */
const HOURS_VIEWS = [
  ['two_weeks', 'Two weeks'],
  ['month', 'Month'],
  ['past', 'Past hours'],
  ['unpaid_held', 'Unpaid held'],
];

const SECTION_TITLE = 'text-[13px] font-extrabold tracking-tight';
const TAP = 'min-h-[44px] sm:min-h-0';

export default function SessionsZone() {
  // The zone's chip row: which sessions the feed shows.
  const [tab, setTab] = useState('upcoming');
  // The hours grid's own window.
  const [view, setView] = useState('two_weeks');
  const [slots, setSlots] = useState({ loading: true, error: '', items: [] });
  const [rules, setRules] = useState(EMPTY_RULES);
  // WHETHER THE RULES WERE READ AT ALL, which the four fields cannot say: an
  // unreadable rule set and an unset one both arrive as nulls, and they are
  // different absences. The card names which one it is, and the editor is
  // withheld for the first (see RulesBody).
  // #4713 (D4713): 'loading' until the first read settles, then 'read' or
  // 'unreadable'. The editor can SAVE only for 'read': before that the form would
  // hold the empty defaults, and the route replaces the whole rule set.
  const [rulesRead, setRulesRead] = useState('loading');
  const [types, setTypes] = useState([]);
  const [links, setLinks] = useState([]);
  // D571 — the same distinction for the two lists the cards now edit. A failed
  // read used to land as `[]` and print "Nothing is offered yet", which is a
  // claim the page had not read; and `[]` before the first read printed it too.
  const [restLoading, setRestLoading] = useState(true);
  const [typesRead, setTypesRead] = useState(true);
  const [linksRead, setLinksRead] = useState(true);
  const [bookings, setBookings] = useState({ loading: true, error: '', items: [] });
  const [billingNotice, setBillingNotice] = useState(null);
  const [blocking, setBlocking] = useState(false);
  const [blockNote, setBlockNote] = useState(null);
  const [shareNote, setShareNote] = useState(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const loadSlots = useCallback(async (forView) => {
    setSlots((c) => ({ ...c, loading: true, error: '' }));
    try {
      const days = forView === 'month' ? VIEW_DAYS.month
        : forView === 'past' ? VIEW_DAYS.past
          : forView === 'unpaid_held' ? VIEW_DAYS.unpaid_held
            : VIEW_DAYS.two_weeks;
      // #4702: the past view reads the window that just ended, not the one ahead.
      const res = await api.listMyAdvisorSlots({ days, from: windowFrom(forView, days) });
      setSlots({ loading: false, error: '', items: Array.isArray(res?.items) ? res.items : [], truncated: res?.truncated === true });
    } catch (e) {
      setSlots({ loading: false, error: zoneError(e, e?.message || 'Your calendar could not be read.', 'practice'), items: [] });
    }
  }, []);

  const loadRest = useCallback(async () => {
    // TOLERATED, NOT REQUIRED. The feed is the page; the three setup cards are
    // configuration. A reader whose rules fail to load should still see their
    // sessions, and each card says its own absence rather than taking the
    // page down with it.
    const [r, t, l] = await Promise.all([
      api.getMyAdvisorAvailability().catch(() => null),
      api.listMyAdvisorSessionTypes().catch(() => null),
      api.listMyAdvisorBookingLinks().catch(() => null),
    ]);
    setRules(r || EMPTY_RULES);
    setRulesRead(r != null ? 'read' : 'unreadable');
    setTypes(Array.isArray(t?.items) ? t.items : []);
    setTypesRead(Array.isArray(t?.items));
    setLinks(Array.isArray(l?.items) ? l.items : []);
    setLinksRead(Array.isArray(l?.items));
    setRestLoading(false);
  }, []);

  const loadBookings = useCallback(async () => {
    setBookings((c) => ({ ...c, loading: true, error: '' }));
    try {
      // #4714 (D4714): every page of the bookings, not the 200 newest.
      const res = await readEveryPage((page) => api.listMyAdvisorBookings(undefined, page));
      setBookings({
        loading: false, error: '',
        items: (Array.isArray(res?.items) ? res.items : []).map(bookingView),
      });
    } catch (e) {
      setBookings({ loading: false, error: zoneError(e, e?.message || 'Your sessions could not be read.', 'practice'), items: [] });
    }
  }, []);

  useEffect(() => { loadSlots(view); }, [loadSlots, view]);
  useEffect(() => { loadRest(); loadBookings(); }, [loadRest, loadBookings]);
  // `/practice/session-types` and `/practice/booking-links` land here with a
  // hash (D571), and React Router does not scroll to one. Both cards render
  // their ids from the first paint, so the element is there once the lists are.
  useScrollToHash(restLoading);

  const onSaved = useCallback(() => { loadBookings(); }, [loadBookings]);
  const onBillingChanged = (note) => { setBillingNotice(note); onSaved(); };

  // THE CHIP ROW'S THREE VIEWS, each named here because the page that mounts
  // the row must serve it (`profile_zone_filters.test.mjs`): 'upcoming',
  // 'past' and 'cancelled', counted over every booking read. A failed read
  // has no counts at all, never zeros.
  const now = Date.now();
  const counted = sessionCounts(bookings.items, now);
  const tabCounts = { upcoming: counted.upcoming, past: counted.past, cancelled: counted.cancelled };
  const shownSessions = sessionsFor(bookings.items, tab, now);

  // NARROWING LIVES IN THE PAGE, not in `sessionGrid`.
  const hours = useMemo(() => narrowSlots(slots.items, view), [slots.items, view]);
  const counts = useMemo(() => slotCounts(hours), [hours]);
  const days = useMemo(() => groupByDay(hours), [hours]);

  // The fourth tile. The cap is a RULE, not a count, so it reads from the rules
  // card and says "Not set" rather than 0 when nobody set one.
  const capValue = ruleValue(rules?.weekly_paid_cap);

  // D1424 (#3700) and D1596 (#3869): Block time opens this page's own Block
  // form instead of three `window.prompt`s. It is where a Block card accepted
  // in the Ask panel puts its exact range here (D5364): the panel sends the
  // advisor here with the card's uid and instants in the address, this page
  // fills date/time inputs in their zone and takes the keys out, and the
  // proposal is decided (`railProposalsApi.decide`) only after `POST
  // /api/advisors/me/slots/block` succeeds. Cancelling leaves the card waiting
  // in Ask. Nothing is blocked until the advisor presses Block. The reason
  // stays the advisor's own words and is never filled.
  const [blockForm, setBlockForm] = useState(() => ({ ...CLOSED_BLOCK }));
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const handoff = parseBlockQuery(searchParams);
    if (!handoff) return;
    setBlockNote(null);
    setBlockForm({
      ...CLOSED_BLOCK,
      open: true,
      from: handoff.exact ? '' : handoff.from,
      until: handoff.exact ? '' : handoff.until,
      proposal: handoff.uid,
      sourceFrom: handoff.exact ? handoff.from : '',
      sourceUntil: handoff.exact ? handoff.until : '',
    });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      BLOCK_QUERY_KEYS.forEach((k) => next.delete(k));
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);
  useEffect(() => {
    if (!blockForm.open || !blockForm.sourceFrom || blockForm.timezone || rulesRead === 'loading') return;
    const timezone = rules?.timezone || 'UTC';
    const wall = blockWallRange({ from: blockForm.sourceFrom, until: blockForm.sourceUntil }, timezone);
    setBlockForm((form) => ({ ...form, ...wall, timezone }));
  }, [blockForm.open, blockForm.sourceFrom, blockForm.sourceUntil, blockForm.timezone, rules?.timezone, rulesRead]);
  const blockFromRef = useRef(null);
  const blockRange = useCallback(() => {
    setBlockNote(null);
    setBlockForm((f) => (f.open ? { ...CLOSED_BLOCK } : { ...CLOSED_BLOCK, open: true }));
  }, []);
  useEffect(() => { if (blockForm.open) blockFromRef.current?.focus?.(); }, [blockForm.open]);

  const submitBlock = useCallback(async (event) => {
    event?.preventDefault?.();
    const { from, startTime, until, endTime, reason, proposal } = blockForm;
    if (!from || !until) { setBlockForm((f) => ({ ...f, error: 'Choose the first day and the day after the last.' })); return; }
    if (!!startTime !== !!endTime) { setBlockForm((f) => ({ ...f, error: 'Choose both a start time and an end time, or leave both empty for whole days.' })); return; }
    let fromInstant;
    let untilInstant;
    try {
      if (startTime && endTime) {
        const timezone = blockForm.timezone || rules?.timezone || 'UTC';
        const original = blockForm.sourceFrom && blockForm.sourceUntil
          ? blockWallRange({ from: blockForm.sourceFrom, until: blockForm.sourceUntil }, timezone) : null;
        const unchanged = original && original.from === from && original.startTime === startTime
          && original.until === until && original.endTime === endTime;
        fromInstant = unchanged ? blockForm.sourceFrom : blockWallInstant(from, startTime, timezone);
        untilInstant = unchanged ? blockForm.sourceUntil : blockWallInstant(until, endTime, timezone);
      } else {
        fromInstant = `${from}T00:00:00.000Z`;
        untilInstant = `${until}T00:00:00.000Z`;
      }
    } catch (e) {
      setBlockForm((f) => ({ ...f, error: e?.message || 'Choose a valid range.' }));
      return;
    }
    if (Date.parse(untilInstant) <= Date.parse(fromInstant)) { setBlockForm((f) => ({ ...f, error: 'The end comes after the start.' })); return; }
    setBlocking(true); setBlockNote(null);
    try {
      const res = await api.blockMyAdvisorSlotRange({
        from: fromInstant, until: untilInstant, reason: reason || '',
      });
      // THE SKIPPED COUNT IS REPORTED, NEVER SWALLOWED. A booked hour cannot be
      // blocked — someone holds it — and an advisor who asked for a fortnight
      // and got eleven days needs to know which request was not honoured.
      const done = res.skipped_booked
        ? `Blocked ${res.blocked} slot${res.blocked === 1 ? '' : 's'}. ${res.skipped_booked} `
          + `already booked and left alone — cancel those from their session cards if you mean to.`
        : `Blocked ${res.blocked} slot${res.blocked === 1 ? '' : 's'}.`;
      // D1596 §4 step 3: the card is decided only now that Block has written. A
      // decide that fails leaves the block in place, says so, and leaves the
      // card waiting in Ask; it never shows the Worker's message.
      let note = { ok: true, text: done };
      if (proposal) {
        try { await railProposalsApi.decide(proposal, 'accept'); }
        catch { note = { ok: false, text: `${done} Its Ask proposal could not be marked accepted, so it is still waiting in Ask.` }; }
      }
      setBlockNote(note);
      setBlockForm({ ...CLOSED_BLOCK });
      loadSlots(view);
    } catch (e) {
      setBlockNote({ ok: false, text: e?.message || 'Nothing was blocked.' });
    } finally { setBlocking(false); }
  }, [blockForm, loadSlots, rules?.timezone, view]);

  // #4832: Share booking link copies the one active link, or sends the reader
  // to the Booking links card to choose; it never picks one of several for them.
  const shareBookingLink = useCallback(async () => {
    if (restLoading) { setShareNote({ ok: false, text: 'Your booking links are still loading. Try again in a moment.' }); return; }
    const target = shareTarget(links, linksRead);
    const toLinks = () => document.getElementById?.('booking-links')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    if (target.kind === 'unreadable') {
      setShareNote({ ok: false, text: 'Your booking links could not be read, so there is nothing to share from here. Try again under Booking links.' });
      toLinks();
      return;
    }
    if (target.kind === 'none') {
      setShareNote({ ok: false, text: 'You have no active booking link yet. Create one under Scheduling setup, Booking links.' });
      toLinks();
      return;
    }
    if (target.kind === 'many') {
      setShareNote({ ok: true, text: `You have ${target.count} active booking links. Copy the one you want under Booking links.` });
      toLinks();
      return;
    }
    const url = bookingLinkUrl(target.link.slug);
    try {
      await navigator.clipboard.writeText(url);
      setShareNote({ ok: true, text: `Copied ${url}.` });
    } catch {
      setShareNote({ ok: false, text: `That could not be copied. Select the address to copy it: ${url}` });
    }
  }, [links, linksRead, restLoading]);

  const timed = shownSessions.filter((b) => b.startsAt);
  const exportCalendar = useCallback(() => {
    // Built from the session cards on screen, so nothing leaves the browser and
    // no endpoint is needed. One VEVENT per session the current tab shows that
    // has a time. The builder is shared with the Cohorts calendar (lib/ics.js, D393).
    downloadIcs(buildIcs({
      prodId: '-//Axal//Practice Sessions//EN',
      events: timed.map((b) => ({
        uid: `booking-${b.uid || b.id}`, start: b.startsAt, end: b.endsAt || b.startsAt,
        summary: [b.topic || 'Session', b.counterpartyName].filter(Boolean).join(' · '),
        description: b.note || '',
      })),
    }), 'axal-sessions.ics');
  }, [timed]);

  // Hoisted out of the JSX: `profile_zone_actions.test.mjs` scans the
  // `advisorZoneActions(...)` call for identifiers, and prose inside it has
  // been read as an undeclared one before (PR3b, `Opens`).
  const opsHandlers = {
    blockRange: { onClick: blockRange, busy: blocking },
    shareBookingLink: { onClick: shareBookingLink },
    exportCalendar: { onClick: exportCalendar, disabled: timed.length === 0,
      title: timed.length === 0 ? 'no session with a time in this tab to export' : undefined },
  };

  const billable = bookings.items.filter((b) => ['completed', 'confirmed'].includes(b.status));
  // #5316 (D5316): a session included in an engagement has no price and is not unpriced.
  const unpriced = billable.filter((b) => b.amount_cents == null && b.billing_state !== 'included').length;

  const renderOpen = (b) => <SessionDetail booking={b} onSaved={onSaved} onChanged={onBillingChanged} />;

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="Sessions"
        blurb="Your calendar and booking setup."
        action={counts.held > 0 ? <Pill tone="warn">{counts.held} held unpaid</Pill> : null}
      />

      <ZoneToolbar
        role="advisor"
        filters={advisorZoneFilters('practice/sessions', {
          value: tab, onChange: setTab, counts: bookings.loading || bookings.error ? {} : tabCounts,
        })}
        actions={advisorZoneActions('practice/sessions', { handlers: opsHandlers })}
      />
      <SaveNote note={shareNote} />

      {blockForm.open && (
        <Card padding="lg">
          <form onSubmit={submitBlock} className="grid grid-cols-1 gap-3 sm:grid-cols-4" data-testid="advisor-block-form">
            {blockForm.proposal && blockForm.sourceFrom ? (
              <p className="m-0 text-[12.5px] leading-relaxed text-axal-muted sm:col-span-4" data-testid="advisor-block-from-ask">{BLOCK_EXACT_SCOPE}</p>
            ) : null}
            <Field label="From">
              <input ref={blockFromRef} type="date" className={inputClass} value={blockForm.from} data-testid="advisor-block-from"
                onChange={(e) => setBlockForm({ ...blockForm, from: e.target.value, error: '' })} />
            </Field>
            <Field label="Start time" hint={`Optional · ${blockForm.timezone || rules?.timezone || 'UTC'}`}>
              <input type="time" className={inputClass} value={blockForm.startTime} data-testid="advisor-block-start-time"
                onChange={(e) => setBlockForm({ ...blockForm, startTime: e.target.value, sourceFrom: '', sourceUntil: '', error: '' })} />
            </Field>
            <Field label="Until" hint={blockForm.endTime ? 'The ending date.' : 'The day after the last whole day.'}>
              <input type="date" className={inputClass} value={blockForm.until} data-testid="advisor-block-until"
                onChange={(e) => setBlockForm({ ...blockForm, until: e.target.value, error: '' })} />
            </Field>
            <Field label="End time" hint={`Optional · ${blockForm.timezone || rules?.timezone || 'UTC'}`}>
              <input type="time" className={inputClass} value={blockForm.endTime} data-testid="advisor-block-end-time"
                onChange={(e) => setBlockForm({ ...blockForm, endTime: e.target.value, sourceFrom: '', sourceUntil: '', error: '' })} />
            </Field>
            <Field label="Why" hint="Optional, and private to you.">
              <input className={inputClass} value={blockForm.reason}
                onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} />
            </Field>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
              <button type="submit" className={`${buttonClass} ${TAP}`} disabled={blocking}>{blocking ? 'Blocking…' : 'Block'}</button>
              <button type="button" className={`${ghostButtonClass} ${TAP}`} onClick={() => setBlockForm({ ...CLOSED_BLOCK })}>Cancel</button>
              {blockForm.error ? <span className="text-[12px] text-rose-700 dark:text-rose-300" role="alert">{blockForm.error}</span> : null}
            </div>
          </form>
        </Card>
      )}
      <SaveNote note={blockNote} />

      {/* ── The operational feed (PX-05 A) ─────────────────────────────── */}
      <Card padding="md" data-testid="sessions-feed">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={SECTION_TITLE}>
            {tab === 'past' ? 'Past sessions' : tab === 'cancelled' ? 'Cancelled sessions' : 'Upcoming sessions'}
          </h3>
          {unpriced > 0 && <Pill tone="warn">{unpriced} unpriced</Pill>}
        </div>
        <SaveNote note={billingNotice} />
        <div className="mt-3">
          <ZoneBody loading={bookings.loading} error={bookings.error} onRetry={loadBookings} isEmpty={false}>
            <SessionLifecyclePanel bookings={bookings.items} loading={bookings.loading} onChanged={loadBookings}
              tab={tab} now={now} renderOpen={renderOpen} />
          </ZoneBody>
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-axal-faint">
          Prices are your own record of what you charged and whether you were paid. Nothing is billed,
          invoiced or collected through Axal — this is bookkeeping, not a payment rail.
        </p>
      </Card>

      {/* D377 — Spin-Out Lab founders see only approved hosts. */}
      <LabHostApplyCard kind="advisor" />

      {/* ── Your hours: the published slots the bookings are made into ─── */}
      <section aria-labelledby="sessions-hours" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="sessions-hours" className={SECTION_TITLE}>Your hours</h3>
          <div role="group" aria-label="Hours window" className="flex flex-wrap gap-1.5" data-testid="hours-window">
            {HOURS_VIEWS.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}
                data-testid={`hours-${key}`}
                className={`${TAP} rounded-full border px-3 py-1 text-[11.5px] font-semibold ${view === key
                  ? 'border-emerald-700 bg-emerald-700 text-white dark:border-emerald-500 dark:bg-emerald-600'
                  : 'border-axal-hairline bg-white text-axal-muted hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Booked" value={counts.booked} note={bookedNote(counts)} />
          <Stat label="Open slots" value={counts.open} note={openNote(counts)} />
          <Stat label="Held unpaid" value={counts.held}
            note={counts.held ? 'booked while payout pending' : 'nothing is waiting on a payout account'} />
          {/* A CAP NOBODY SET IS NOT A CAP OF ZERO. Zero means "accept no paid
              sessions" and is a decision; absent means the question was never
              answered, and rendering it as a number would put words in the
              advisor's mouth (D56/D68). */}
          <Stat label="Weekly cap"
            value={rulesRead === 'loading' ? <Unrecorded>Reading…</Unrecorded>
              : (capValue ?? <Unrecorded>{rulesRead === 'read' ? 'Not set' : 'Not recorded'}</Unrecorded>)}
            note={rulesRead === 'loading' ? 'reading your rules'
              : rulesRead === 'read'
                ? (capValue ? 'paid sessions, self-set' : 'no cap on paid sessions')
                : 'your rules could not be read'} />
        </div>

        <PublishAvailabilityCard open={publishOpen} onToggle={() => setPublishOpen((v) => !v)}
          onPublished={() => loadSlots(view)} />

        <ZoneBody loading={slots.loading} error={slots.error} onRetry={() => loadSlots(view)}
          isEmpty={!slots.loading && !slots.error && days.length === 0}
          empty={<NothingYet
            title="No slots in this window"
            body="This grid shows the hours you have published. Publish availability above; your availability rules decide how many hours exist to begin with."
            action={<button type="button" className={`${buttonClass} ${TAP}`} onClick={() => setPublishOpen(true)}>Publish availability</button>}
          />}>
          <Card padding="md">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className={SECTION_TITLE}>The grid</h3>
              <span className="text-[10.5px] text-axal-faint">Recording state per slot</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {days.map((day) => (
                <div key={day.key} data-testid={`day-pr4-${day.key}`}
                  className="rounded-[11px] border border-axal-hairline bg-axal-ground p-2.5 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
                    {day.label}
                  </div>
                  <div className="mt-2 grid gap-1.5">
                    {day.slots.map((s) => <SlotCard key={s.id} slot={s} />)}
                  </div>
                </div>
              ))}
            </div>
            {slots.truncated && (
              <p className="mt-3 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300" data-testid="slots-truncated">
                This window holds more than 500 slots, so only the first 500 are shown. Narrow the window to see the rest.
              </p>
            )}
            {counts.held > 0 && (
              <p className="mt-3 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                A held slot is booked and <strong>not charged</strong>: it was taken while the payout
                account was still unverified. Both sides see it as unpaid, and it is counted under
                held rather than under booked. A slot that silently fails to charge is worse than one
                that says so.
              </p>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-axal-faint">{ruleNote(counts)}</p>
          </Card>
        </ZoneBody>
      </section>

      {/* ── Scheduling setup (PX-05 A, below the feed) ──────────────────
          D571: `/practice/session-types` and `/practice/booking-links`
          redirect to the two ids below. Practice Sessions owns booking
          configuration (owner's answer on #4832). */}
      <section aria-labelledby="scheduling-setup" data-testid="scheduling-setup"
        className="space-y-3 border-t border-axal-hairline pt-4 dark:border-gray-700">
        <h2 id="scheduling-setup" className="text-[16px] font-extrabold tracking-tight">Scheduling setup</h2>
        <div className="grid gap-3 lg:grid-cols-3">
          <Card padding="md" id="availability" className="scroll-mt-24">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className={SECTION_TITLE}>Availability</h3>
              <span className="text-[10.5px] text-axal-faint">The rules that generate your hours</span>
            </div>
            <RulesBody rules={rules} read={rulesRead} onSaved={loadRest} />
          </Card>

          <Card padding="md" id="session-types" className="scroll-mt-24 lg:col-span-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className={SECTION_TITLE}>Session types</h3>
              <span className="text-[10.5px] text-axal-faint">What can be booked</span>
            </div>
            <SessionTypesPanel types={types} loading={restLoading} read={typesRead} onChanged={loadRest} />
          </Card>

          <Card padding="md" id="booking-links" className="scroll-mt-24 lg:col-span-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className={SECTION_TITLE}>Booking links</h3>
              <span className="text-[10.5px] text-axal-faint">Only here</span>
            </div>
            <BookingLinksPanel links={links} types={types} loading={restLoading} read={linksRead}
              typesRead={typesRead} onChanged={loadRest} />
          </Card>
        </div>
      </section>

      {/* NO AI BAND, stated rather than left as an absence a reader has to
          notice: nothing records that a session was recorded, captures consent
          to record one, or holds a transcript. `recording_state` names the
          consent; it does not produce the recording. */}
      <StatedLimit title="No batch summary on this page">
        A session summary would need a recording and a transcript, and Axal does not record
        sessions: a slot can carry a consent state, but no recording or transcript is kept to
        summarise. The chip says what was agreed, not
        what was captured.
      </StatedLimit>
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <Card padding="md">
      <div className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint">{label}</div>
      <div className="mt-1.5 text-[22px] font-extrabold leading-none tracking-tight tabular-nums">{value}</div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-axal-faint">{note}</div>
    </Card>
  );
}

function SlotCard({ slot }) {
  const kind = slotKind(slot);
  const rec = RECORDING_LABEL[slot.recording_state] || null;
  return (
    <div data-testid={`slot-pr4-${slot.id}`}
      className={`rounded-[7px] border p-2 ${
        kind === 'held' ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20'
          : kind === 'booked' ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20'
            : 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900'}`}>
      <div className="text-[11.5px] font-bold tabular-nums">
        {slotTime(slot.starts_at) ?? <Unrecorded>No time</Unrecorded>}
      </div>
      <div className="mt-0.5 text-[10.5px] leading-snug text-axal-faint">
        {kind === 'blocked'
          ? (slot.blocked_reason || 'Blocked')
          : (slot.notes || KIND_LABEL[kind])}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {kind === 'held' && <Pill tone="warn">Held · unpaid</Pill>}
        {rec && <Pill tone={slot.recording_state === 'declined' ? 'neutral' : 'ok'}>{rec}</Pill>}
        {kind !== 'held' && kind !== 'booked' && kind !== 'open' && (
          <Pill tone={KIND_TONE[kind]}>{KIND_LABEL[kind]}</Pill>
        )}
      </div>
    </div>
  );
}

/**
 * #4832: what Open shows on a session card — who, the terms it was booked on,
 * the note, and what each session was worth: the recorded price and its money
 * state, with the price record (`BillingEditor`) for a confirmed or completed
 * session. A request not answered yet has no agreed session to price, and a
 * cancelled or no-show session has no amount to record.
 */
function SessionDetail({ booking: b, onSaved, onChanged }) {
  const price = priceClass(b);
  const paid = moneyState(b);
  const priceable = ['completed', 'confirmed'].includes(b.status);
  return (
    <div className="space-y-2" data-testid={`billing-pr4-${b.id}`}>
      <dl className="grid gap-1.5 text-[12px] sm:grid-cols-[140px_minmax(0,1fr)]">
        <dt className="text-axal-faint">Client</dt>
        <dd className="min-w-0 break-words">
          {b.counterpartyName || <Unrecorded>Counterparty not recorded</Unrecorded>}
          {b.counterpartyEmail && b.counterpartyEmail !== b.counterpartyName ? ` · ${b.counterpartyEmail}` : ''}
        </dd>
        <dt className="text-axal-faint">Booked on</dt>
        <dd className="min-w-0 break-words">{offerLine(b.offer) ?? <Unrecorded>Terms not recorded</Unrecorded>}</dd>
        <dt className="text-axal-faint">What each session was worth</dt>
        <dd className="min-w-0 font-bold tabular-nums">
          {money(b.amount_cents) ?? <Unrecorded />}
          <span className="font-normal text-axal-faint"> · {price.label}{paid ? ` · ${paid.label}` : ''}</span>
        </dd>
        {b.note && <><dt className="text-axal-faint">Note</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{b.note}</dd></>}
      </dl>
      {priceable
        ? <BillingEditor booking={b} onSaved={onSaved} onChanged={onChanged} />
        : (
          <p className="text-[11.5px] leading-relaxed text-axal-faint">
            Only confirmed and completed sessions are priced. A request you have not answered yet has no
            agreed session to price, and a cancelled or no-show session has no amount to record.
          </p>
        )}
    </div>
  );
}

/**
 * The Availability card (PX-05 A) and its editor (PX-05 B).
 *
 * #4832: EDIT AVAILABILITY IS OFFERED BEFORE THE RULES HAVE LANDED, AND SAVE
 * IS NOT. The route replaces the whole rule set (#4713), so a form saved
 * before the read would write its empty defaults over what the advisor
 * configured. While the read is in flight the editor shows the skeleton and
 * "Save stays disabled until it has loaded"; once read, the fields carry the
 * stored rules; if the read failed there is no editor at all.
 */
function RulesBody({ rules, read: readState, onSaved }) {
  const loadingRules = readState === 'loading';
  const read = readState === 'read';
  const [open, setOpen] = useState(false);
  const [cap, setCap] = useState('');
  const [buffer, setBuffer] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  useEffect(() => {
    setCap(rules?.weekly_paid_cap == null ? '' : String(rules.weekly_paid_cap));
    setBuffer(rules?.buffer_minutes == null ? '' : String(rules.buffer_minutes));
    setNotice(rules?.min_notice_hours == null ? '' : String(rules.min_notice_hours));
  }, [rules]);

  const save = async (e) => {
    e.preventDefault();
    if (!read) return;
    setBusy(true); setNote(null);
    try {
      // EVERY FIELD, EVERY TIME. The route replaces the rule set rather than
      // merging, so sending a partial body would clear the fields this form
      // did not name. The blackouts are passed through untouched for the same
      // reason — they are part of the set even though this form does not edit
      // them yet.
      await api.saveMyAdvisorAvailability({
        weekly_paid_cap: cap === '' ? null : Number(cap),
        buffer_minutes: buffer === '' ? null : Number(buffer),
        min_notice_hours: notice === '' ? null : Number(notice),
        blackouts: rules?.blackouts || [],
        timezone: rules?.timezone || null,
        // The revision these rules were read at: if another tab changed them
        // since, the worker refuses (409 rules_changed) instead of overwriting.
        expected_revision: rules?.revision ?? '',
      });
      setOpen(false);
      onSaved();
    } catch (err) {
      if (err?.status === 409 || err?.code === 'rules_changed' || /changed somewhere else/.test(String(err?.message))) onSaved();
      setNote({ ok: false, text: err?.message || 'Those rules were not saved.' });
    } finally { setBusy(false); }
  };

  // PX-05's five rows. A weekly schedule is not a stored rule: hours are
  // published one slot at a time (Your hours), so it says so rather than
  // drawing a pattern nobody set.
  const rows = [
    ['Weekly schedule', null, 'No weekly pattern is stored. Your hours are the slots you publish.'],
    ['Minimum notice', ruleValue(rules?.min_notice_hours, ' h')],
    ['Buffers', ruleValue(rules?.buffer_minutes, ' min')],
    ['Blackouts', (rules?.blackouts || []).map(blackoutLabel).filter(Boolean).join(', ') || null],
    ['Session limits', rules?.weekly_paid_cap == null ? null : `${ruleValue(rules.weekly_paid_cap)} paid / week`],
  ];

  return (
    <>
      <dl className="mt-3 grid gap-1.5" data-testid="availability-rules">
        {rows.map(([k, v, why]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="text-[11.5px] text-axal-faint">{k}</dt>
            <dd className="min-w-0 text-right text-[12px] font-bold tabular-nums">
              {loadingRules ? <Unrecorded>Reading…</Unrecorded>
                : (v ?? (why && read
                  ? <Unrecorded reason={why}>Not recorded</Unrecorded>
                  : <Unrecorded>{read ? 'Not set' : 'Not recorded'}</Unrecorded>))}
            </dd>
          </div>
        ))}
      </dl>
      {readState === 'unreadable' ? (
        // NO EDITOR OVER A RULE SET WE COULD NOT READ. The route REPLACES the
        // whole set rather than merging, so saving this form after a failed
        // read would write four empty fields and an empty blackout list over
        // whatever the advisor actually configured. A control that would
        // destroy the thing it claims to edit is worse than no control, and
        // D56/D68 asks for the reason rather than a dead button.
        <StatedLimit title="Rules not recorded">
          Your availability rules could not be read, so they cannot be changed from here. Saving
          would replace the whole rule set — including blackouts this page never received — with
          what the form shows. Reload to try again.
        </StatedLimit>
      ) : (
        <button type="button" className={`${ghostButtonClass} ${TAP} mt-3`} onClick={() => setOpen((v) => !v)}
          data-testid="edit-availability">
          {open ? 'Close' : 'Edit availability'}
        </button>
      )}
      {open && loadingRules && (
        <div className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid="availability-editor-loading">
          <div aria-busy="true" className="space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-2/5" />
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-axal-faint" role="status">
            Loading your current schedule… Save stays disabled until it has loaded, so defaults can’t replace it.
          </p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button type="button" className={`${ghostButtonClass} ${TAP}`} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className={`${buttonClass} ${TAP}`} disabled aria-disabled="true">Save availability</button>
          </div>
        </div>
      )}
      {read && open && (
        <form onSubmit={save} className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid="availability-editor">
          <div className="grid gap-3">
            <Field label="Weekly paid cap" hint="Leave empty for no cap. Zero means you accept no paid sessions.">
              <input className={inputClass} value={cap} inputMode="numeric"
                onChange={(e) => setCap(e.target.value)} placeholder="6" />
            </Field>
            <Field label="Buffer between sessions" hint="Minutes.">
              <input className={inputClass} value={buffer} inputMode="numeric"
                onChange={(e) => setBuffer(e.target.value)} placeholder="15" />
            </Field>
            <Field label="Minimum notice" hint="Hours.">
              <input className={inputClass} value={notice} inputMode="numeric"
                onChange={(e) => setNotice(e.target.value)} placeholder="24" />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" className={`${ghostButtonClass} ${TAP}`} onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className={`${buttonClass} ${TAP}`} disabled={busy}>
              {busy ? 'Saving…' : 'Save availability'}
            </button>
          </div>
          <SaveNote note={note} />
        </form>
      )}
    </>
  );
}

const BILLING_REFUSALS = new Map([
  ['reprice_required', 'Confirm the new price before recording the change.'],
  ['settled_price', 'This session was marked Collected or Written off. Its price cannot be changed or cleared.'],
  ['booking_changed', 'This session changed while you were editing. Review the refreshed record before trying again.'],
  ['fee_snapshot_missing', 'The fee details are missing. Confirm the current price to record them at today’s rate.'],
  // #4832 (D5316's two refusals of the Included record).
  ['included_has_no_price', 'A session included in an engagement has no price of its own.'],
  ['priced_line', 'This session has a price. Clear it first: a session included in an engagement is not billed.'],
  ['included_line', 'This session is recorded as included in an engagement. Choose what happened to it to change that.'],
]);

function BillingEditor({ booking, onSaved, onChanged }) {
  const [amount, setAmount] = useState(
    centsToInput(booking.amount_cents),
  );
  const [state, setState] = useState(
    ['unpriced', 'included'].includes(booking.billing_state) ? 'billed' : (booking.billing_state || 'billed'),
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [pending, setPending] = useState(null);
  const pendingAmount = pending?.amount_cents;
  const writing = useRef(false);
  const stored = booking.amount_cents == null ? null : Number(booking.amount_cents);
  const priceLocked = ['collected', 'written_off'].includes(booking.billing_state);
  const missingFee = stored != null && (booking.take_rate_bps === null || booking.platform_cut_cents === null);
  const included = booking.billing_state === 'included';

  const record = async (body) => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setNote(null);
    try {
      await api.updateMyAdvisorBookingBilling(booking.id, body);
      onSaved();
    } catch (err) {
      const refusal = { ok: false, text: BILLING_REFUSALS.get(err?.code) || 'The billing change could not be recorded. Try again.' };
      if (err?.code === 'booking_changed') onChanged(refusal);
      else setNote(refusal);
      setPending(null);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };

  const save = (e) => {
    e.preventDefault();
    if (busy || pending) return;
    setNote(null);
    const parsed = dollarsToCents(amount);
    if (parsed.error) { setNote({ ok: false, text: parsed.error }); return; }
    if (parsed.cents == null) {
      setNote({ ok: false, text: 'Enter an amount, or use Clear to take the price off entirely.' });
      return;
    }
    if (stored != null && parsed.cents !== stored) {
      setPending({ amount_cents: parsed.cents, billing_state: state, reprice: true });
      return;
    }
    record(stored == null ? { amount_cents: parsed.cents, billing_state: state } : { billing_state: state });
  };

  return (
    <form data-testid="session-billing-editor" onSubmit={save} className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-700">
      {included && (
        <p className="mb-2 text-[11.5px] leading-relaxed text-axal-faint" data-testid="session-billing-included">
          Recorded as included in an engagement: it has no price of its own and counts in no billed total.
          Record an amount to bill it separately instead.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Amount" hint="What you charged for this session. Enter 0 for a free session.">
          <input data-testid="session-billing-amount" className={inputClass} value={amount} inputMode="decimal" disabled={priceLocked || busy || Boolean(pending)}
            onChange={(e) => setAmount(e.target.value)} placeholder="300" />
        </Field>
        <Field label="What happened to it">
          <select data-testid="session-billing-state" className={inputClass} value={state} disabled={busy || Boolean(pending)} onChange={(e) => setState(e.target.value)}>
            {SETTABLE.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className={`${buttonClass} ${TAP}`} disabled={busy || Boolean(pending)}>
          {busy ? 'Recording…' : 'Record'}
        </button>
        {/* #4832 (D5316): Included is recorded only on a line with no price; a
            priced one (a $0 Free one too) is refused 409 priced_line. */}
        {stored == null && !included && !priceLocked && (
          <button type="button" className={`${ghostButtonClass} ${TAP}`} disabled={busy || Boolean(pending)}
            data-testid="session-billing-include" onClick={() => record({ billing_state: 'included' })}>
            Included in an engagement
          </button>
        )}
        {stored != null && !priceLocked && (
          <button type="button" className={`${ghostButtonClass} ${TAP}`} disabled={busy || Boolean(pending)}
            onClick={() => { setNote(null); setPending({ amount_cents: null, billing_state: 'unpriced', reprice: true }); }}>
            Clear the price
          </button>
        )}
        {stored != null && !priceLocked && (missingFee || note?.text === BILLING_REFUSALS.get('fee_snapshot_missing')) && (
          <button type="button" className={`${ghostButtonClass} ${TAP}`} disabled={busy || Boolean(pending)}
            onClick={() => setPending({ amount_cents: stored, billing_state: booking.billing_state, reprice: true })}>
            Confirm the current price
          </button>
        )}
      </div>
      {priceLocked && <p className="mt-2 text-sm">{BILLING_REFUSALS.get('settled_price')}</p>}
      {pending && <div className="mt-3 space-y-2" role="group" aria-label="Confirm price change">
        <p>Stored price: {money(stored)}. {pendingAmount == null
          ? 'Clearing the price also clears the recorded fee rate and cut.'
          : `Confirm ${money(pendingAmount)}. The fee rate and cut will be recorded at today’s rate.`}</p>
        <button type="button" className={`${buttonClass} ${TAP}`} disabled={busy} onClick={() => record(pending)}>
          {pendingAmount == null ? 'Confirm clear' : 'Confirm price'}
        </button>
        <button type="button" className={`${ghostButtonClass} ${TAP}`} disabled={busy} onClick={() => setPending(null)}>Cancel price change</button>
      </div>}
      <SaveNote note={note} />
    </form>
  );
}
