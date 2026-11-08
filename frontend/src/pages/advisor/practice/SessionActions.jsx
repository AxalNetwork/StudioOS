// D4687 (#4687): the two Practice > Sessions controls that had no mounted home.
// The old advisory pages held them (publish a slot; mark a confirmed session
// held, no-show or cancelled) and both pages are no longer mounted, so an
// advisor could receive and accept a request but never publish the hour nor
// close the session. Both write through the existing Worker routes
// (`POST /api/advisors/me/slots`, `POST /api/advisors/bookings/:id/...`).
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Pill } from '../../../ui';
import { api } from '../../../lib/api';
import { Field, SaveNote, ZoneHeading, buttonClass, ghostButtonClass, inputClass } from '../expertise/kit';
import { formatDateTime } from '../advisory/kit';
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
};
const CLOSED = ['completed', 'no_show', 'cancelled'];

/**
 * Close the loop on a booking: confirmed sessions take Session held / No-show /
 * Cancel (the last two ask for a reason in the page), and closed ones are the
 * history, with where a held session is reviewed. Accepting a request stays on
 * Opportunities, which is mounted and holds Accept / Decline.
 */
export function SessionLifecyclePanel({ bookings, loading, onChanged }) {
  const [busy, setBusy] = useState(0);
  const [asking, setAsking] = useState(null); // { id, action }
  const [reason, setReason] = useState('');
  const [note, setNote] = useState(null);

  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const awaiting = bookings.filter((b) => b.awaitingDecision).length;
  const history = bookings.filter((b) => CLOSED.includes(b.status));

  const run = async (b, action) => {
    // #4712: a cancel needs a reason, because the founder is told why.
    if (action === 'cancel' && !reason.trim()) {
      setNote({ ok: false, text: 'Say why you are cancelling. The founder is told.' });
      return;
    }
    setBusy(b.id); setNote(null);
    try {
      if (action === 'complete') await api.completeAdvisorBooking(b.id);
      else if (action === 'no-show') await api.noShowAdvisorBooking(b.id, reason.trim() || undefined);
      else await api.cancelAdvisorBooking(b.id, reason.trim());
      setAsking(null); setReason('');
      setNote({ ok: true, text: action === 'complete' ? 'Marked as held.' : action === 'no-show' ? 'Recorded as a no-show.' : 'Cancelled. The founder is told.' });
      await onChanged?.();
    } catch {
      setNote({ ok: false, text: 'That could not be recorded. The session is unchanged.' });
    } finally { setBusy(0); }
  };

  const who = (b) => b.counterpartyName || 'Requester not recorded';

  return (
    <Card padding="md" id="session-lifecycle" className="scroll-mt-24" data-testid="session-lifecycle">
      <ZoneHeading
        title="Run your sessions"
        blurb="Close each confirmed session once its hour has passed. History and reviews follow from what you record here."
      />
      {awaiting > 0 && (
        <p className="mb-2 text-[12px] text-amber-700 dark:text-amber-300">
          {awaiting} {awaiting === 1 ? 'request is' : 'requests are'} waiting on you.{' '}
          <Link to="/practice/opportunities" className="underline">Accept or decline on Opportunities</Link>.
        </p>
      )}
      <SaveNote note={note} />
      {loading ? null : confirmed.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-axal-muted">
          No confirmed session is waiting to be closed. Accept a request on Opportunities and it appears here.
        </p>
      ) : (
        <ul className="space-y-2">{confirmed.map((b) => (
          <li key={b.id} data-testid={`lifecycle-${b.id}`}
            className="rounded-[10px] border border-axal-hairline p-3 dark:border-gray-700">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="text-[13px] font-extrabold tracking-tight">{b.topic || 'Session'}</strong>
                <p className="mt-0.5 text-[11.5px] text-axal-faint">
                  {who(b)}{b.startsAt ? ` · ${formatDateTime(b.startsAt)}` : ' · time not recorded'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={`${buttonClass} ${TAP}`} disabled={busy === b.id}
                  onClick={() => run(b, 'complete')}>Session held</button>
                <button type="button" className={`${ghostButtonClass} ${TAP}`} disabled={busy === b.id}
                  onClick={() => { setAsking({ id: b.id, action: 'no-show' }); setReason(''); }}>No-show</button>
                <button type="button" className={`${ghostButtonClass} ${TAP}`} disabled={busy === b.id}
                  onClick={() => { setAsking({ id: b.id, action: 'cancel' }); setReason(''); }}>Cancel session</button>
              </div>
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
          </li>
        ))}</ul>
      )}

      {!loading && history.length > 0 && (
        <div className="mt-4" data-testid="session-history">
          <div className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint">History</div>
          <ul className="mt-2 space-y-1.5">{history.map((b) => (
            <li key={b.id} data-testid={`history-${b.id}`}
              className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <span className="min-w-0">
                <strong className="font-semibold">{b.topic || 'Session'}</strong>
                <span className="text-axal-faint">{` · ${who(b)}${b.startsAt ? ` · ${formatDateTime(b.startsAt)}` : ''}`}</span>
              </span>
              <span className="flex items-center gap-2">
                <Pill tone={STATUS_TONE[b.status] || 'neutral'}>{STATUS_LABEL[b.status] || b.status}</Pill>
                {b.status === 'completed' && (
                  <Link to="/practice/delivery" className="text-emerald-700 underline dark:text-emerald-300">Review it</Link>
                )}
              </span>
            </li>
          ))}</ul>
        </div>
      )}
    </Card>
  );
}
