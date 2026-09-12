import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import {
  Field, NothingYet, Pill, SaveNote, StatedLimit, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, dollarsToCents, ghostButtonClass, inputClass, money,
} from '../expertise/kit';
import {
  KIND_LABEL, KIND_TONE, VIEW_DAYS, blackoutLabel, bookedNote, groupByDay,
  narrowSlots, openNote, ruleNote, ruleValue, slotCounts, slotKind, slotTime,
} from './sessionGrid';
import { bookingView, formatDateTime, slotMinutes } from '../advisory/kit';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';
import { advisorZoneFilters } from '../../../workspaces/advisorZoneFilters';

/**
 * Practice · Sessions — canvas PR4, `/practice/sessions`, tagged **FEED**.
 *
 * IT IS A CALENDAR, AND IT USED TO BE A BILLING LEDGER. The artboard's blurb is
 * the whole brief — "The full calendar, the rules that generate it, and the
 * booking links that fill it" — and the page that stood here drew none of
 * those three. It drew the per-session money that migration 205 added, which
 * is a real capability and stays (below), but it was answering a different
 * question from the one the zone is for.
 *
 * WHAT THE GRID IS, and why the counts are not obvious. A slot can be several
 * things at once in the raw row, so `sessionGrid.slotKind` fixes a precedence
 * and every tile derives from one pass over one list. The order matters in one
 * place especially: `held` comes BEFORE `booked`, because the artboard's own
 * "Booked, next 14 d" tile excludes the held slot and its gate note says why —
 * *"it is counted under held rather than under booked. A slot that silently
 * fails to charge is worse than one that says so."*
 *
 * NOTHING ON THIS PAGE CHARGES ANYONE. Session types carry prices and a booking
 * link can say it needs a verified payout account, but no money moves: the
 * take-rate and payout account arrive in migration 241 and the Stripe Connect
 * service leg after that, in test mode behind a production flag. So
 * `payment_state` is rendered as the reason a booking could NOT be charged and
 * never as a receipt. D75.
 *
 * THE OPERATIONAL STATE IS THE ADVISOR'S ALONE. The grid reads `GET /me/slots`,
 * not the public `GET /:uid/slots`, because `recording_state`, `payment_state`
 * and `blocked_reason` must not reach a founder browsing this calendar — one
 * would tell them the payout account is unverified and another is a private
 * note about why an hour is not for sale.
 *
 * THE BILLING SECTION STAYED, and the rule is the one PR3b followed: an
 * artboard that does not draw a working feature is not an instruction to delete
 * it. Migration 205's `amount_cents` and `billing_state` have exactly one
 * writer in the product and it is here. Its copy still says Axal settles
 * nothing, which remains TRUE after this PR and stops being true the day the
 * production charging flag flips — that reconciliation belongs to PR5a, with
 * the rest of the contradictions, not to a calendar.
 */

const STATE_LABEL = {
  unpriced: 'Unpriced',
  billed: 'Billed',
  collected: 'Collected',
  written_off: 'Written off',
};
const STATE_TONE = {
  unpriced: 'neutral',
  billed: 'warn',
  collected: 'ok',
  written_off: 'danger',
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
});

export default function SessionsZone() {
  const [view, setView] = useState('two_weeks');
  const [slots, setSlots] = useState({ loading: true, error: '', items: [] });
  const [rules, setRules] = useState(EMPTY_RULES);
  // WHETHER THE RULES WERE READ AT ALL, which the four fields cannot say: an
  // unreadable rule set and an unset one both arrive as nulls, and they are
  // different absences. The card names which one it is, and the editor is
  // withheld for the first (see RulesBody).
  const [rulesRead, setRulesRead] = useState(true);
  const [types, setTypes] = useState([]);
  const [links, setLinks] = useState([]);
  const [bookings, setBookings] = useState({ loading: true, error: '', items: [] });
  const [editing, setEditing] = useState(null);
  const [blocking, setBlocking] = useState(false);
  const [blockNote, setBlockNote] = useState(null);

  const loadSlots = useCallback(async (forView) => {
    setSlots((c) => ({ ...c, loading: true, error: '' }));
    try {
      // EACH CHIP KEY IS NAMED HERE, in the page that mounts the chip row,
      // rather than looked up from a map in the sibling module. A key resolved
      // one import away lets a chip be declared live over a page that cannot
      // serve it, and `profile_zone_filters.test.mjs` enforces the rule — it
      // caught `month` on the first draft of this page, which read its window
      // from `VIEW_DAYS[forView]` and so never mentioned the key at all.
      const days = forView === 'month' ? VIEW_DAYS.month
        : forView === 'past' ? VIEW_DAYS.past
          : forView === 'unpaid_held' ? VIEW_DAYS.unpaid_held
            : VIEW_DAYS.two_weeks;
      const res = await api.listMyAdvisorSlots({ days });
      setSlots({ loading: false, error: '', items: Array.isArray(res?.items) ? res.items : [] });
    } catch (e) {
      setSlots({ loading: false, error: e?.message || 'Your calendar could not be read.', items: [] });
    }
  }, []);

  const loadRest = useCallback(async () => {
    // TOLERATED, NOT REQUIRED. The grid is the page; the three cards beside it
    // are configuration. A reader whose rules fail to load should still see
    // their calendar, and each card says its own absence rather than taking
    // the page down with it.
    const [r, t, l] = await Promise.all([
      api.getMyAdvisorAvailability().catch(() => null),
      api.listMyAdvisorSessionTypes().catch(() => null),
      api.listMyAdvisorBookingLinks().catch(() => null),
    ]);
    setRules(r || EMPTY_RULES);
    setRulesRead(r != null);
    setTypes(Array.isArray(t?.items) ? t.items : []);
    setLinks(Array.isArray(l?.items) ? l.items : []);
  }, []);

  const loadBookings = useCallback(async () => {
    setBookings((c) => ({ ...c, loading: true, error: '' }));
    try {
      const res = await api.listMyAdvisorBookings();
      setBookings({
        loading: false, error: '',
        items: (Array.isArray(res?.items) ? res.items : []).map(bookingView),
      });
    } catch (e) {
      setBookings({ loading: false, error: e?.message || 'Your sessions could not be read.', items: [] });
    }
  }, []);

  useEffect(() => { loadSlots(view); }, [loadSlots, view]);
  useEffect(() => { loadRest(); loadBookings(); }, [loadRest, loadBookings]);

  const onSaved = useCallback(() => { setEditing(null); loadBookings(); }, [loadBookings]);

  // NARROWING LIVES IN THE PAGE, not in `sessionGrid`. A chip declared live in
  // `advisorZoneFilters.js` must be served by the page that mounts the chip
  // row — `profile_zone_filters.test.mjs` enforces it, because a predicate one
  // import away lets a chip be declared live over a page that cannot serve it.
  const visible = useMemo(() => narrowSlots(slots.items, view), [slots.items, view]);
  const counts = useMemo(() => slotCounts(visible), [visible]);
  const days = useMemo(() => groupByDay(visible), [visible]);

  // The artboard's fourth tile. The cap is a RULE, not a count, so it reads
  // from the rules card and says "Not set" rather than 0 when nobody set one.
  const capValue = ruleValue(rules?.weekly_paid_cap);

  const blockRange = useCallback(async () => {
    const from = window.prompt('Block from (YYYY-MM-DD)');
    if (!from) return;
    const until = window.prompt('Block until, exclusive (YYYY-MM-DD)');
    if (!until) return;
    const reason = window.prompt('Why? (optional, private to you)') || '';
    setBlocking(true); setBlockNote(null);
    try {
      const res = await api.blockMyAdvisorSlotRange({
        from: `${from}T00:00:00.000Z`, until: `${until}T00:00:00.000Z`, reason,
      });
      // THE SKIPPED COUNT IS REPORTED, NEVER SWALLOWED. A booked hour cannot be
      // blocked — someone holds it — and an advisor who asked for a fortnight
      // and got eleven days needs to know which request was not honoured.
      setBlockNote({
        ok: true,
        text: res.skipped_booked
          ? `Blocked ${res.blocked} slot${res.blocked === 1 ? '' : 's'}. ${res.skipped_booked} `
            + `already booked and left alone — cancel those from Engagements if you mean to.`
          : `Blocked ${res.blocked} slot${res.blocked === 1 ? '' : 's'}.`,
      });
      loadSlots(view);
    } catch (e) {
      setBlockNote({ ok: false, text: e?.message || 'Nothing was blocked.' });
    } finally { setBlocking(false); }
  }, [loadSlots, view]);

  const exportCalendar = useCallback(() => {
    // Built from rows already on screen, so nothing leaves the browser and no
    // endpoint is needed. One VEVENT per slot the current view shows.
    const pad = (s) => String(s).replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
    const stamp = (iso) => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? null : `${d.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
    };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Axal//Practice Sessions//EN'];
    for (const s of visible) {
      const start = stamp(s.starts_at); const end = stamp(s.ends_at);
      if (!start || !end) continue;
      lines.push('BEGIN:VEVENT', `UID:${pad(s.uid || s.id)}@axal.vc`,
        `DTSTART:${start}`, `DTEND:${end}`,
        `SUMMARY:${pad(KIND_LABEL[slotKind(s)] || 'Session')}`,
        s.notes ? `DESCRIPTION:${pad(s.notes)}` : 'DESCRIPTION:',
        'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'axal-sessions.ics';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, [visible]);

  // Hoisted out of the JSX: `profile_zone_actions.test.mjs` scans the
  // `advisorZoneActions(...)` call for identifiers, and prose inside it has
  // been read as an undeclared one before (PR3b, `Opens`).
  const opsHandlers = {
    blockRange: { onClick: blockRange, busy: blocking },
    exportCalendar: { onClick: exportCalendar, disabled: visible.length === 0,
      title: visible.length === 0 ? 'nothing in this view to export' : undefined },
  };

  const billable = useMemo(
    () => bookings.items.filter((b) => ['completed', 'confirmed'].includes(b.status)),
    [bookings.items],
  );
  const unpriced = billable.filter((b) => b.amount_cents == null).length;

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="Sessions"
        blurb="The full calendar, the rules that generate it, and the booking links that fill it."
        action={counts.held > 0 ? <Pill tone="warn">{counts.held} held unpaid</Pill> : null}
      />

      <ZoneToolbar
        role="advisor"
        filters={advisorZoneFilters('practice/sessions', { value: view, onChange: setView })}
        actions={advisorZoneActions('practice/sessions', { handlers: opsHandlers })}
      />

      <SaveNote note={blockNote} />

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
          value={capValue ?? <Unrecorded>{rulesRead ? 'Not set' : 'Not recorded'}</Unrecorded>}
          note={rulesRead
            ? (capValue ? 'paid sessions, self-set' : 'no cap on paid sessions')
            : 'your rules could not be read'} />
      </div>

      <ZoneBody loading={slots.loading} error={slots.error} onRetry={() => loadSlots(view)}
        isEmpty={!slots.loading && !slots.error && days.length === 0}
        empty={<NothingYet
          title="No slots in this window"
          body="This grid shows the hours you have published. Availability is created under Opportunities; the rules below decide how many hours exist to begin with."
          action={<Link to="/practice/opportunities" className="text-emerald-700 underline">Publish availability →</Link>}
        />}>
        <Card padding="md">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[13px] font-extrabold tracking-tight">The grid</h3>
            <span className="text-[10.5px] text-axal-ink-3">Recording state per slot</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {days.map((day) => (
              <div key={day.key} data-testid={`day-pr4-${day.key}`}
                className="rounded-[11px] border border-axal-hairline bg-axal-ground p-2.5 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
                  {day.label}
                </div>
                <div className="mt-2 grid gap-1.5">
                  {day.slots.map((s) => <SlotCard key={s.id} slot={s} />)}
                </div>
              </div>
            ))}
          </div>
          {counts.held > 0 && (
            <p className="mt-3 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
              A held slot is booked and <strong>not charged</strong>: it was taken while the payout
              account was still unverified. Both sides see it as unpaid, and it is counted under
              held rather than under booked. A slot that silently fails to charge is worse than one
              that says so.
            </p>
          )}
        </Card>
      </ZoneBody>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card padding="md">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[13px] font-extrabold tracking-tight">Availability rules</h3>
            <span className="text-[10.5px] text-axal-ink-3">Configuration</span>
          </div>
          <RulesBody rules={rules} read={rulesRead} onSaved={loadRest} />
          <p className="mt-3 text-[11px] leading-relaxed text-axal-ink-3">{ruleNote(counts)}</p>
        </Card>

        <Card padding="md">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[13px] font-extrabold tracking-tight">Session types</h3>
            <span className="text-[10.5px] text-axal-ink-3">What can be booked</span>
          </div>
          {types.length === 0 ? (
            <p className="mt-3 text-[11.5px] leading-relaxed text-axal-ink-3">
              Nothing is offered yet. A session type is what a booking link sells — a free intro, a
              single session, a pack, a retainer.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {types.map((t) => (
                <li key={t.id} data-testid={`type-pr4-${t.id}`}
                  className="flex items-start justify-between gap-3 rounded-[9px] border border-axal-hairline p-2.5 dark:border-gray-700">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-bold">{t.name}</div>
                    <div className="mt-0.5 text-[11px] text-axal-ink-3">
                      {[t.duration_minutes ? `${t.duration_minutes} min` : null, t.cadence_note]
                        .filter(Boolean).join(' · ') || <Unrecorded>No duration recorded</Unrecorded>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[12.5px] font-extrabold tabular-nums">
                    {/* THREE OUTCOMES, NOT TWO. "Free" is a price the advisor
                        chose; "Not priced" is a question they have not
                        answered. Rendering the second as $0 would invent the
                        first. */}
                    {t.is_free_intro
                      ? 'Free'
                      : (money(t.price_cents) ?? <Unrecorded>Not priced</Unrecorded>)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card padding="md">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[13px] font-extrabold tracking-tight">Booking links</h3>
            <span className="text-[10.5px] text-axal-ink-3">Only here</span>
          </div>
          {links.length === 0 ? (
            <p className="mt-3 text-[11.5px] leading-relaxed text-axal-ink-3">
              No link is published. A link is how someone reaches this calendar without going
              through your profile — one per audience.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {links.map((l) => (
                <li key={l.id} data-testid={`link-pr4-${l.id}`}
                  className="rounded-[9px] border border-axal-hairline p-2.5 dark:border-gray-700">
                  <div className="font-mono text-[11.5px] font-bold break-all">axal.vc/b/{l.slug}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-axal-ink-3">
                    {l.note || AUDIENCE_NOTE[l.audience] || null}
                    {l.requires_payout_account && (
                      <> Requires a verified payout account.</>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ── What each session was worth ───────────────────────────────────
          Kept, not ported away. The artboard does not draw it and migration
          205's two columns have exactly one writer in the product, which is
          this form. Deleting it because a drawing omits it would remove the
          only way to answer the question Earnings then sums. */}
      <Card padding="md">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-extrabold tracking-tight">What each session was worth</h3>
          {unpriced > 0 && <Pill tone="warn">{unpriced} unpriced</Pill>}
        </div>
        <p className="mt-1.5 max-w-2xl text-[11.5px] leading-relaxed text-axal-ink-3">
          Your own record of what you charged and whether you were paid. Nothing is billed,
          invoiced or collected through Axal — this is bookkeeping, not a payment rail.
        </p>
        <ZoneBody loading={bookings.loading} error={bookings.error} onRetry={loadBookings}
          isEmpty={billable.length === 0}
          empty={<NothingYet
            title="No sessions to price yet"
            body="Sessions appear here once a booking is confirmed. The lifecycle — complete, no-show, cancel — is run from Engagements. This records only what each session was worth."
            action={<Link to="/practice/engagements" className="text-emerald-700 underline">Run the lifecycle →</Link>}
          />}>
          <div className="mt-3 space-y-3">
            {billable.map((b) => (
              <div key={b.id} data-testid={`billing-pr4-${b.id}`}
                className="rounded-[9px] border border-axal-hairline p-3 dark:border-gray-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-extrabold">{b.topic || 'Session'}</span>
                      <Pill tone={STATE_TONE[b.billing_state] || 'neutral'}>
                        {STATE_LABEL[b.billing_state] || b.billing_state}
                      </Pill>
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-axal-ink-3">
                      {b.counterpartyName || <Unrecorded>Counterparty not recorded</Unrecorded>}
                      {b.startsAt && ` · ${formatDateTime(b.startsAt)}`}
                      {slotMinutes({ starts_at: b.startsAt, ends_at: b.endsAt }) != null
                        && ` · ${slotMinutes({ starts_at: b.startsAt, ends_at: b.endsAt })} min`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[15px] font-extrabold tabular-nums">
                      {money(b.amount_cents) ?? <Unrecorded />}
                    </div>
                    <button type="button" className={`${ghostButtonClass} mt-2`}
                      onClick={() => setEditing(editing === b.id ? null : b.id)}>
                      {editing === b.id ? 'Close' : (b.amount_cents == null ? 'Set a price' : 'Change')}
                    </button>
                  </div>
                </div>
                {editing === b.id && <BillingEditor booking={b} onSaved={onSaved} />}
              </div>
            ))}
            <p className="text-[11px] leading-relaxed text-axal-ink-3">
              Only confirmed and completed sessions are listed. A request you have not answered yet
              has no agreed session to price, and a cancelled or no-show session has no amount to
              record. The full booking history, including all three, is under{' '}
              <Link to="/practice/engagements" className="text-emerald-700 underline">Engagements</Link>.
            </p>
          </div>
        </ZoneBody>
      </Card>

      {/* NO AI BAND, for the same reason Delivery has none and stated again
          rather than left as an absence a reader has to notice. PR4's artboard
          draws no AI instrument at all — the batch summariser belongs to PR3 —
          and the premise both would need is still missing: nothing records
          that a session was recorded, captures consent to record one, or holds
          a transcript. `recording_state` names the consent; it does not
          produce the recording. */}
      <StatedLimit title="No batch summary on this page">
        The Practice canvas puts its AI instrument on Delivery, not here, and the thing it would
        need does not exist either way: a slot can carry a consent state, but nothing in this
        product stores a recording or a transcript to summarise. The chip says what was agreed, not
        what was captured.
      </StatedLimit>
    </div>
  );
}

const AUDIENCE_NOTE = {
  public: 'Public, on your profile.',
  cohort: 'Restricted to one cohort.',
  private: 'Unlisted — the link is the only way in.',
};

function Stat({ label, value, note }) {
  return (
    <Card padding="md">
      <div className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-ink-3">{label}</div>
      <div className="mt-1.5 text-[22px] font-extrabold leading-none tracking-tight tabular-nums">{value}</div>
      <div className="mt-1.5 text-[11px] leading-relaxed text-axal-ink-3">{note}</div>
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
      <div className="mt-0.5 text-[10.5px] leading-snug text-axal-ink-3">
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

function RulesBody({ rules, read, onSaved }) {
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
      });
      setOpen(false);
      onSaved();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'Those rules were not saved.' });
    } finally { setBusy(false); }
  };

  const rows = [
    ['Weekly paid cap', ruleValue(rules?.weekly_paid_cap)],
    ['Buffer between sessions', ruleValue(rules?.buffer_minutes, ' min')],
    ['Minimum notice', ruleValue(rules?.min_notice_hours, ' h')],
    ['Blackout', (rules?.blackouts || []).map(blackoutLabel).filter(Boolean).join(', ') || null],
  ];

  return (
    <>
      <dl className="mt-3 grid gap-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="text-[11.5px] text-axal-ink-3">{k}</dt>
            <dd className="text-[12px] font-bold tabular-nums">
              {v ?? <Unrecorded>{read ? 'Not set' : 'Not recorded'}</Unrecorded>}
            </dd>
          </div>
        ))}
      </dl>
      {read ? (
        <button type="button" className={`${ghostButtonClass} mt-3`} onClick={() => setOpen((v) => !v)}>
          {open ? 'Close' : 'Change the rules'}
        </button>
      ) : (
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
      )}
      {read && open && (
        <form onSubmit={save} className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-700">
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
          <button type="submit" className={`${buttonClass} mt-3`} disabled={busy}>
            {busy ? 'Saving…' : 'Save the rules'}
          </button>
          <SaveNote note={note} />
        </form>
      )}
    </>
  );
}

function BillingEditor({ booking, onSaved }) {
  const [amount, setAmount] = useState(
    booking.amount_cents == null ? '' : String(Number(booking.amount_cents) / 100),
  );
  const [state, setState] = useState(
    booking.billing_state === 'unpriced' ? 'billed' : (booking.billing_state || 'billed'),
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    setNote(null);
    const parsed = dollarsToCents(amount);
    if (parsed.error) { setNote({ ok: false, text: parsed.error }); return; }
    if (parsed.cents == null) {
      setNote({ ok: false, text: 'Enter an amount, or use Clear to take the price off entirely.' });
      return;
    }
    setBusy(true);
    try {
      await api.updateMyAdvisorBookingBilling(booking.id, {
        amount_cents: parsed.cents,
        billing_state: state,
      });
      onSaved();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be recorded. Nothing was changed.' });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setNote(null);
    setBusy(true);
    try {
      // Back to where every session starts. The worker refuses any other state
      // without an amount, so clearing the amount and the state is one act.
      await api.updateMyAdvisorBookingBilling(booking.id, {
        amount_cents: null,
        billing_state: 'unpriced',
      });
      onSaved();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be cleared.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-700">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Amount" hint="What you charged for this session.">
          <input className={inputClass} value={amount} inputMode="decimal"
            onChange={(e) => setAmount(e.target.value)} placeholder="300" />
        </Field>
        <Field label="What happened to it">
          <select className={inputClass} value={state} onChange={(e) => setState(e.target.value)}>
            {SETTABLE.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
          </select>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className={buttonClass} disabled={busy}>
          {busy ? 'Recording…' : 'Record'}
        </button>
        {booking.amount_cents != null && (
          <button type="button" className={ghostButtonClass} onClick={clear} disabled={busy}>
            Clear the price
          </button>
        )}
      </div>
      <SaveNote note={note} />
    </form>
  );
}
