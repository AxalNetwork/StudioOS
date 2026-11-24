/**
 * D7120 part 2 (#7120, canvas `Wellness Member Home`, WLM-07, WLM-07B, WLM-08): group sessions for a member.
 *
 *   GroupSeatPanel  one session: when (in the member's zone), facilitator, format, seats as a count, Free, the
 *                   release rule, what the facilitator learns and what other members learn, a calendar choice and
 *                   Reserve a seat; then Reserved, or "Someone reserved the last seat first" (nothing reserved,
 *                   nothing charged); No seats, Cancelled and Started each say so
 *   MyGroupSeats    the member's own seats: reserved, released, cancelled by the facilitator (with the reason), with
 *                   Release seat while the rule allows it
 *
 * Members never see who else reserved. The page sends a session's uid and the calendar choice, nothing else.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { wellbeingGroupSessionsApi } from '../../lib/api/wellbeingGroupSessions';
import { BTN, FIELD } from './WellbeingParts';
import { CALENDAR, isFull, reservationRow, seatAction, seatRefusal, seatsLine, sessionWhen } from './groupSessionsModel';
import { deviceTimezone } from './reflectionsModel';

const CARD = 'rounded-axal border border-stone-200 bg-stone-50 p-4 dark:border-gray-800 dark:bg-gray-900';
const OK = 'rounded-axal-sm border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200';
const ALERT = 'rounded-axal-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200';

/** WLM-07 (group): reserve a seat in one session. */
export function GroupSeatPanel({ uid, onChanged, onClose }) {
  const tz = deviceTimezone();
  const [read, setRead] = useState({ state: 'loading' });
  const [calendar, setCalendar] = useState('discreet');
  const [act, setAct] = useState({ busy: false, outcome: null, error: null, full: false });
  const load = useCallback(async () => {
    setRead({ state: 'loading' });
    try { const s = await wellbeingGroupSessionsApi.get(uid); setRead(s && s.uid ? { state: 'ok', value: s } : { state: 'unreadable' }); }
    catch { setRead({ state: 'unreadable' }); }
  }, [uid]);
  useEffect(() => { load(); }, [load]);

  const reserve = async () => {
    setAct({ busy: true, outcome: null, error: null, full: false });
    try {
      await wellbeingGroupSessionsApi.reserve(uid, calendar);
      setAct({ busy: false, outcome: 'reserved', error: null, full: false });
      await load(); onChanged?.();
    } catch (e) { setAct({ busy: false, outcome: null, error: seatRefusal(e), full: isFull(e) }); if (isFull(e)) load(); }
  };

  if (read.state === 'loading') return <div className={`${CARD} h-48 animate-pulse`} aria-busy="true" data-testid="group-seat-loading" />;
  if (read.state !== 'ok') {
    return <div className={`${CARD} text-sm text-stone-700 dark:text-gray-300`} role="alert" data-testid="group-seat-unreadable">This session couldn’t be read. Nothing was reserved. <button type="button" className={BTN.ghost} onClick={load}>Retry</button></div>;
  }
  const s = read.value;
  const a = seatAction(s);
  const rows = [
    ['When', sessionWhen(s, tz) ? `${sessionWhen(s, tz)} your time (${tz})` : null],
    ['Facilitator', [s.facilitator?.name, s.facilitator?.headline].filter(Boolean).join(' · ') || null],
    ['Format', [`Group of ${s.capacity}`, s.language].filter(Boolean).join(' · ')],
    ['Seats', seatsLine(s)],
    ['Price', 'Free'],
    ['Releasing', s.cancellation?.rule || null],
  ];
  return (
    <section className={`${CARD} space-y-3`} aria-labelledby={`seat-${s.uid}`} data-testid="group-seat-panel">
      <div>
        <span className="text-[11px] font-bold uppercase tracking-wide text-stone-500 dark:text-gray-400">Group · reserve a seat</span>
        <h3 id={`seat-${s.uid}`} className="text-[15px] font-bold text-stone-900 dark:text-gray-100">{s.title}</h3>
      </div>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}><dt className="text-stone-500 dark:text-gray-400">{k}</dt><dd className="text-stone-800 dark:text-gray-200" data-testid={`group-seat-${k.toLowerCase()}`}>{v || 'Not recorded'}</dd></React.Fragment>
        ))}
      </dl>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-axal-sm border border-stone-200 bg-white p-3 text-xs dark:border-gray-800 dark:bg-gray-950" data-testid="group-seat-facilitator-learns">
          <b className="block text-stone-900 dark:text-gray-100">What the facilitator learns when you reserve</b>
          <span className="text-stone-700 dark:text-gray-300">{s.what_facilitator_learns}</span>
        </div>
        <div className="rounded-axal-sm border border-stone-200 bg-white p-3 text-xs dark:border-gray-800 dark:bg-gray-950" data-testid="group-seat-members-learn">
          <b className="block text-stone-900 dark:text-gray-100">What other members learn</b>
          <span className="text-stone-700 dark:text-gray-300">{s.what_other_members_learn}</span>
        </div>
      </div>
      {act.outcome === 'reserved' || a.kind === 'reserved' ? (
        <p className={OK} role="status" data-testid="group-seat-reserved"><b>Your seat is reserved.</b> It’s in your group seats below. Nothing was charged.</p>
      ) : a.kind === 'open' ? (
        <fieldset>
          <legend className={FIELD.label}>Your calendar entry</legend>
          <div className="flex flex-wrap gap-2">
            {CALENDAR.map((c) => (
              <label key={c.key} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                <input type="radio" name={`cal-${s.uid}`} value={c.key} checked={calendar === c.key} onChange={() => setCalendar(c.key)} data-testid={`group-seat-calendar-${c.key}`} /> {c.label}
              </label>
            ))}
          </div>
          <p className={`${FIELD.note} mt-1`}>{CALENDAR.find((c) => c.key === calendar)?.note}</p>
        </fieldset>
      ) : (
        <p className={ALERT} role="status" data-testid={`group-seat-${a.kind}`}>{a.line}</p>
      )}
      {act.error ? <p className={ALERT} role="alert" data-testid="group-seat-error">{act.error}</p> : null}
      <p className={FIELD.note}>Your reflections, interests and other bookings are never shared with the facilitator or the group.</p>
      <div className="flex flex-wrap justify-end gap-2">
        {onClose ? <button type="button" className={BTN.ghost} onClick={onClose}>Not now</button> : null}
        {a.kind === 'open' && act.outcome !== 'reserved'
          ? <button type="button" className={BTN.primary} disabled={act.busy} onClick={reserve} data-testid="button-group-reserve">{act.busy ? 'Reserving…' : 'Reserve a seat'}</button>
          : null}
      </div>
    </section>
  );
}

/** The member's own group seats, with Release seat while the rule allows it. */
export function MyGroupSeats({ version = 0 }) {
  const tz = deviceTimezone();
  const [read, setRead] = useState({ state: 'loading' });
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    setRead({ state: 'loading' });
    try { const v = await wellbeingGroupSessionsApi.mine(); setRead(Array.isArray(v?.reservations) ? { state: 'ok', value: v.reservations } : { state: 'unreadable' }); }
    catch { setRead({ state: 'unreadable' }); }
  }, []);
  useEffect(() => { load(); }, [load, version]);
  const release = async (uid) => {
    setError(null);
    try { await wellbeingGroupSessionsApi.cancel(uid); setConfirm(null); await load(); }
    catch (e) { setError(seatRefusal(e)); setConfirm(null); }
  };
  if (read.state === 'ok' && !read.value.length) return null;
  const now = Date.now();
  return (
    <section className={CARD} aria-labelledby="h-group-seats" data-testid="group-seats">
      <h2 id="h-group-seats" className="mb-2 text-[15px] font-bold text-stone-900 dark:text-gray-100">My group seats</h2>
      {read.state === 'loading' ? <div className="h-12 animate-pulse rounded bg-stone-200 dark:bg-gray-800" /> : read.state !== 'ok' ? (
        <p className="text-sm text-stone-700 dark:text-gray-300" role="alert" data-testid="group-seats-unreadable">Your group seats couldn’t be read. They are unchanged. <button type="button" className={BTN.ghost} onClick={load}>Retry</button></p>
      ) : (
        <ul className="divide-y divide-stone-200 dark:divide-gray-800">
          {read.value.map((r) => {
            const row = reservationRow(r, tz, now);
            return (
              <li key={row.uid} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid={`group-seat-row-${row.uid}`}>
                <div className="min-w-0">
                  <b className="text-stone-900 dark:text-gray-100">{row.title}</b>
                  <span className="block text-xs text-stone-600 dark:text-gray-400">{[row.when, row.facilitator].filter(Boolean).join(' · ')}</span>
                  <span className={`text-xs font-semibold ${row.status.tone === 'ok' ? 'text-emerald-800 dark:text-emerald-300' : row.status.tone === 'alert' ? 'text-amber-800 dark:text-amber-300' : 'text-stone-600 dark:text-gray-400'}`} data-testid={`group-seat-status-${row.uid}`}>
                    {row.status.word}{row.reason ? ` · ${row.reason}` : ''}
                  </span>
                </div>
                {row.releasable ? (confirm === row.uid ? (
                  <span className="flex items-center gap-2 text-xs text-stone-700 dark:text-gray-300">
                    Release your seat?
                    <button type="button" className={BTN.danger} onClick={() => release(row.uid)} data-testid={`button-group-release-confirm-${row.uid}`}>Release seat</button>
                    <button type="button" className={BTN.ghost} onClick={() => setConfirm(null)}>Keep it</button>
                  </span>
                ) : <button type="button" className={BTN.ghost} onClick={() => setConfirm(row.uid)} data-testid={`button-group-release-${row.uid}`}>Release seat</button>) : null}
              </li>
            );
          })}
        </ul>
      )}
      {error ? <p className={`${ALERT} mt-2`} role="alert" data-testid="group-seats-error">{error}</p> : null}
      <p className={`${FIELD.note} mt-2`}>Only you and the facilitator know you reserved. Group sessions are free, so there is nothing to refund.</p>
    </section>
  );
}
