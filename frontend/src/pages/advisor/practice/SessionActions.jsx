// D4687 (#4687): the two Practice > Sessions controls that had no mounted home.
// The old advisory pages held them (publish a slot; mark a confirmed session
// held, no-show or cancelled) and both pages are no longer mounted, so an
// advisor could receive and accept a request but never publish the hour nor
// close the session. Both write through the existing Worker routes
// (`POST /api/advisors/me/slots`, `POST /api/advisors/bookings/:id/...`).
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Pill, Unrecorded } from '../../../ui';
import { api } from '../../../lib/api';
import { Field, SaveNote, ZoneHeading, buttonClass, ghostButtonClass, inputClass } from '../expertise/kit';
import { moneyState, offerText, priceClass, sessionsFor, whenLine } from './sessionFeed';
import { slotBody } from './practiceTools';

const TAP = 'min-h-[44px] sm:min-h-0';

const EMPTY_SLOT = { starts_at: '', ends_at: '', capacity: '1', meeting_url: '' };

/** Publish one office-hour slot. `open` is owned by the page so the empty state can reveal it. */
export function PublishAvailabilityCard({ open, onToggle, onPublished }) {
  const [form, setForm] = useState(EMPTY_SLOT);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const publish = async () => {
    // #4712: one rule for a slot (future start, end after start, 1 to 20 seats,
    // an https meeting link or none), checked here before anything is sent.
    const res = slotBody(form);
    if (res.error) { setNote({ ok: false, text: res.error }); return; }
    setBusy(true); setNote(null);
    try {
      await api.createAdvisorSlot(res.body);
      setForm(EMPTY_SLOT);
      setNote({ ok: true, text: 'Published. The slot is on the grid and can be booked.' });
      onPublished?.();
    } catch {
      setNote({ ok: false, text: 'That slot could not be published. Nothing was recorded.' });
    } finally { setBusy(false); }
  };

  return (
    <Card padding="md" id="publish-availability" className="scroll-mt-24" data-testid="publish-availability">
      <ZoneHeading
        title="Publish availability"
        blurb="Add an hour a founder can book. Rules below decide the cap; this creates the hour itself."
        action={<button type="button" className={`${ghostButtonClass} ${TAP}`} onClick={onToggle}>
          {open ? 'Close' : 'Publish a slot'}
        </button>}
      />
      {open && (
        <div className="mt-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts">
              <input type="datetime-local" className={inputClass} value={form.starts_at} data-testid="slot-starts"
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
            </Field>
            <Field label="Ends">
              <input type="datetime-local" className={inputClass} value={form.ends_at} data-testid="slot-ends"
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
            </Field>
            <Field label="Seats" hint="How many founders can hold this hour. One is a one-to-one.">
              <input className={inputClass} inputMode="numeric" value={form.capacity} data-testid="slot-seats"
                onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
            </Field>
            <Field label="Meeting link" hint="Optional. Shown to whoever books.">
              <input className={inputClass} value={form.meeting_url} placeholder="https://…"
                onChange={(e) => setForm({ ...form, meeting_url: e.target.value })} />
            </Field>
          </div>
          <button type="button" className={`${buttonClass} ${TAP} mt-3`} disabled={busy} onClick={publish}>
            {busy ? 'Publishing…' : 'Publish slot'}
          </button>
        </div>
      )}
      <SaveNote note={note} />
    </Card>
  );
}

const STATUS_LABEL = {
  confirmed: 'Confirmed', completed: 'Held', no_show: 'No-show', cancelled: 'Cancelled',
  pending: 'Awaiting you', requested: 'Awaiting you',
};
const STATUS_TONE = {
  confirmed: 'neutral', completed: 'ok', no_show: 'warn', cancelled: 'neutral',
  pending: 'warn', requested: 'warn',
};
const PRICE_TONE = { unpriced: 'warn', included: 'neutral', free: 'neutral', priced: 'ok' };

// #4832 (D4832): each tab's empty state says what the tab is for.
const EMPTY = {
  upcoming: 'No upcoming sessions. Share your booking link, or accept a request on Opportunities, and the next one appears here.',
  past: 'No session has passed yet. A session moves here once its time is over, or once you close it as held or a no-show.',
  cancelled: 'Nothing has been cancelled or declined.',
};

/**
 * #4832 (D4832): THE OPERATIONAL FEED — one card per booking under the tab the
 * page chose (Upcoming / Past / Cancelled, `sessionFeed.js`). A card names the
 * client, the topic, the time, its status, the offer it was booked on and its
 * recorded price, with Open (the page's `renderOpen`, which holds the price
 * record) and, on a confirmed session, Complete / No-show / Cancel session.
 *
 * The lifecycle itself is unchanged from #4687/#4692/#4712: only a confirmed
 * session can be closed, a cancel needs a reason because the founder is told,
 * and a 409 means the session moved, so the panel offers the reload. Accepting
 * a request stays on Opportunities, which holds Accept / Decline.
 */
export function SessionLifecyclePanel({ bookings, loading, onChanged, tab = 'upcoming', now, renderOpen }) {
  const [busy, setBusy] = useState(0);
  const [asking, setAsking] = useState(null); // { id, action }
  const [reason, setReason] = useState('');
  const [note, setNote] = useState(null);
  const [opened, setOpened] = useState(null);
  // #4692: set when the worker answered 409 — this panel is behind the booking.
  const [stale, setStale] = useState(false);

  const at = Number.isFinite(now) ? now : Date.now();
  const shown = sessionsFor(bookings, tab, at);
  const awaiting = bookings.filter((b) => b.awaitingDecision).length;
  const closable = (b) => b.status === 'confirmed';

  const run = async (b, action) => {
    // #4712: a cancel needs a reason, because the founder is told why.
    if (action === 'cancel' && !reason.trim()) {
      setNote({ ok: false, text: 'Say why you are cancelling. The founder is told.' });
      return;
    }
    setBusy(b.id); setNote(null); setStale(false);
    try {
      if (action === 'complete') await api.completeAdvisorBooking(b.id);
      else if (action === 'no-show') await api.noShowAdvisorBooking(b.id, reason.trim() || undefined);
      else await api.cancelAdvisorBooking(b.id, reason.trim());
      setAsking(null); setReason('');
      setNote({ ok: true, text: action === 'complete' ? 'Marked as held.' : action === 'no-show' ? 'Recorded as a no-show.' : 'Cancelled. The founder is told.' });
      await onChanged?.();
    } catch (e) {
      // #4692: a 409 is not "that could not be recorded". D4703 made the write
      // conditional on the status this panel read, so a 409 means the session
      // MOVED — the founder cancelled it, or a second press got there first —
      // and this press was refused against a status that no longer holds. The
      // old message was wrong both ways round: it claimed the session was
      // unchanged when it had just changed, and it left the advisor pressing
      // the same button against the same stale list. Say what happened and
      // offer the reload, which is the only thing that helps.
      if (e?.status === 409) {
        setAsking(null);
        setStale(true);
        setNote({ ok: false, text: 'This session changed somewhere else while this page was open, so nothing here was recorded. Reload to see where it stands.' });
      } else {
        setNote({ ok: false, text: 'That could not be recorded. The session is unchanged.' });
      }
    } finally { setBusy(0); }
  };

  const reload = async () => {
    setStale(false); setNote(null); setReason('');
    await onChanged?.();
  };

  const who = (b) => b.counterpartyName || 'Client not recorded';
  const statusLabel = (b) => (b.status === 'cancelled' && b.advisor_decision === 'declined'
    ? 'Declined' : (STATUS_LABEL[b.status] || b.status || 'Status not recorded'));

  return (
    <div id="session-lifecycle" className="scroll-mt-24" data-testid="session-lifecycle">
      {awaiting > 0 && (
        <p className="mb-2 text-[12px] text-amber-700 dark:text-amber-300">
          {awaiting} {awaiting === 1 ? 'request is' : 'requests are'} waiting on you.{' '}
          <Link to="/practice/opportunities" className="underline">Accept or decline on Opportunities</Link>.
        </p>
      )}
      <SaveNote note={note} />
      {stale && (
        <button type="button" data-testid="lifecycle-reload" className={`${buttonClass} ${TAP} mt-2`}
          onClick={reload}>Reload these sessions</button>
      )}
      {loading ? null : shown.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-axal-hairline p-3 text-[12.5px] leading-relaxed text-axal-muted dark:border-gray-700"
          data-testid={`sessions-empty-${tab}`}>
          {EMPTY[tab] || EMPTY.upcoming}
        </p>
      ) : (
        <ul className="space-y-2.5">{shown.map((b) => {
          const when = whenLine(b, at);
          const price = priceClass(b);
          const paid = moneyState(b);
          const offer = offerText(b);
          return (
            <li key={b.id} data-testid={`session-card-${b.id}`}
              className="rounded-[12px] border border-axal-hairline bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <div className="text-[11.5px] font-bold tabular-nums text-axal-muted dark:text-gray-300">
                    {when ?? <Unrecorded>Time not recorded</Unrecorded>}
                  </div>
                  <p className="mt-0.5 break-words text-[13.5px] leading-snug">
                    <strong className="font-extrabold tracking-tight">{who(b)}</strong>
                    <span className="text-axal-muted dark:text-gray-300"> · {b.topic || 'Session'}</span>
                  </p>
                  <p className="mt-1 break-words text-[11.5px] leading-relaxed text-axal-faint" data-testid={`session-terms-${b.id}`}>
                    {offer ?? <Unrecorded reason="This booking was made before its terms were copied onto it.">Session type not recorded</Unrecorded>}
                    {' · '}{price.detail}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Pill tone={PRICE_TONE[price.key]}>{price.label}</Pill>
                    {paid && <Pill tone={paid.tone}>{paid.label}</Pill>}
                  </div>
                </div>
                <span className="shrink-0" data-testid={`session-status-${b.id}`}>
                  <Pill tone={STATUS_TONE[b.status] || 'neutral'}>{statusLabel(b)}</Pill>
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {renderOpen && (
                  <button type="button" className={`${ghostButtonClass} ${TAP}`} aria-expanded={opened === b.id}
                    data-testid={`session-open-${b.id}`} onClick={() => setOpened(opened === b.id ? null : b.id)}>
                    {opened === b.id ? 'Close' : 'Open'}
                  </button>
                )}
                {closable(b) && (
                  <>
                    <button type="button" className={`${buttonClass} ${TAP}`} disabled={busy === b.id}
                      onClick={() => run(b, 'complete')}>Complete</button>
                    <button type="button" className={`${ghostButtonClass} ${TAP}`} disabled={busy === b.id}
                      onClick={() => { setAsking({ id: b.id, action: 'no-show' }); setReason(''); }}>No-show</button>
                    <button type="button" className={`${ghostButtonClass} ${TAP}`} disabled={busy === b.id}
                      onClick={() => { setAsking({ id: b.id, action: 'cancel' }); setReason(''); }}>Cancel session</button>
                  </>
                )}
                {b.status === 'completed' && (
                  <Link to="/practice/delivery" className={`${ghostButtonClass} ${TAP} inline-flex items-center`}>Review it</Link>
                )}
              </div>
              {asking?.id === b.id && (
                <div className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-700">
                  <Field label={asking.action === 'cancel' ? 'Why you are cancelling' : 'Note on the no-show'}
                    hint={asking.action === 'cancel' ? 'Required. The founder is told.' : 'Optional. Stored on the booking.'}>
                    <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}
                      aria-required={asking.action === 'cancel' || undefined} data-testid={`lifecycle-note-${b.id}`} />
                  </Field>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={`${buttonClass} ${TAP}`} disabled={busy === b.id}
                      onClick={() => run(b, asking.action)}>
                      {asking.action === 'cancel' ? 'Confirm cancellation' : 'Record no-show'}
                    </button>
                    <button type="button" className={`${ghostButtonClass} ${TAP}`} onClick={() => setAsking(null)}>Keep session</button>
                  </div>
                </div>
              )}
              {renderOpen && opened === b.id && (
                <div className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-700" data-testid={`session-detail-${b.id}`}>
                  {renderOpen(b)}
                </div>
              )}
            </li>
          );
        })}</ul>
      )}
      {tab === 'past' && (
        <p className="mt-2 text-[11px] leading-relaxed text-axal-faint" data-testid="past-means">
          Past means sessions whose time has passed, or that you closed as held or a no-show. It is not a longer window of upcoming ones.
        </p>
      )}
    </div>
  );
}
