import React, { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Card, InfoStrip, Pill, Skeleton, Unrecorded, Unreadable } from '../../ui';
import {
  availabilityGrid, bookingStatus, cellAction, expertActions, formatWhen, fullDayName, serviceBody,
  serviceDraft, serviceRate, splitBookings, windowLabel, DAY_NAMES, SESSION_MINUTES,
} from './wellbeingModel';
import { BTN, FIELD, CardHead, Outcome } from './WellbeingParts';

/**
 * D570 — the expert's practice (canvas `wbx-practice`): services, the weekly
 * availability grid and upcoming bookings. Bodies only: `ExpertEditorPage.jsx`
 * holds the reads and the writes and passes each zone what it needs.
 *
 * NAMES AND TIMES ONLY. `GET /experts/me/bookings` also returns the booker's
 * note; no zone here renders it (D331, and the canvas's own footnote).
 *
 * WHAT MEMBERS SEE (D574). The active services are listed to members on the
 * directory and the profile, and a booking names the one chosen. The slots
 * members book from are cut from this grid, each window in its own zone; an
 * expert with no grid is offered on the default weekday hours, 09:00 to 17:00
 * UTC, which the grid's strip says. Both count toward the profile completion
 * the directory listing needs.
 */

const SERVICES_GAP = `Members see your active services when they book, or can book a plain ${SESSION_MINUTES}-minute session. Services count toward your profile’s completion.`;
const SLOTS_GAP = 'Members are offered half-hours inside these windows, read in each window’s own timezone. With no window set, they are offered weekdays 09:00 to 17:00 UTC. Open hours count toward your profile’s completion.';
const CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud'];

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
export function ServiceForm({ draft, fields = {}, busy = false, error, mode = 'edit', onChange, onSubmit, onCancel }) {
  const set = (key) => (e) => onChange?.({ ...draft, [key]: e.target.value });
  const currencies = CURRENCIES.includes(draft.currency) ? CURRENCIES : [draft.currency, ...CURRENCIES];
  return (
    <form
      className="space-y-2.5 rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700"
      onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}
      data-testid={`form-service-${mode}`}
    >
      <div>
        <label className={FIELD.label} htmlFor={`svc-${mode}-title`}>Name</label>
        <input id={`svc-${mode}-title`} className={FIELD.input} value={draft.title} onChange={set('title')} maxLength={240} />
        {fields.title && <p role="alert" className={FIELD.error}>{fields.title}</p>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={FIELD.label} htmlFor={`svc-${mode}-minutes`}>Length (min)</label>
          <input id={`svc-${mode}-minutes`} className={FIELD.input} inputMode="numeric" value={draft.minutes} onChange={set('minutes')} />
        </div>
        <div>
          <label className={FIELD.label} htmlFor={`svc-${mode}-price`}>Rate</label>
          <input id={`svc-${mode}-price`} className={FIELD.input} inputMode="decimal" value={draft.price} onChange={set('price')} />
        </div>
        <div>
          <label className={FIELD.label} htmlFor={`svc-${mode}-currency`}>Currency</label>
          <select id={`svc-${mode}-currency`} className={FIELD.input} value={draft.currency} onChange={set('currency')}>
            {currencies.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>
        </div>
      </div>
      {(fields.minutes || fields.price) && <p role="alert" className={FIELD.error}>{fields.minutes || fields.price}</p>}
      <div>
        <label className={FIELD.label} htmlFor={`svc-${mode}-description`}>Description (optional)</label>
        <textarea id={`svc-${mode}-description`} rows={2} maxLength={2000} className={FIELD.input} value={draft.description} onChange={set('description')} />
      </div>
      <p className={FIELD.note}>A rate of zero is a free session.</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={BTN.primary} disabled={busy}>{busy ? 'Saving…' : mode === 'create' ? 'Add service' : 'Save service'}</button>
        <button type="button" className={BTN.ghost} onClick={onCancel} disabled={busy}>Cancel</button>
        <Outcome error={error} />
      </div>
    </form>
  );
}

export function ServiceRow({ service, busy = false, confirming = false, onToggle, onEdit, onAskDelete, onConfirmDelete, onCancelDelete }) {
  const active = service.is_active !== 0 && service.is_active !== false;
  return (
    <li className="py-2.5" data-testid={`service-${service.uid}`}>
      {/* One line when the card is wide (32rem); in a narrow card the switch
          and the edit controls drop under the name, so the name keeps its room. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 @lg:grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_auto]">
        <span className="truncate text-[13px] font-semibold text-axal-ink dark:text-gray-100">{service.title}</span>
        <span className="text-xs tabular-nums text-axal-muted dark:text-gray-400">{service.duration_minutes} min</span>
        <span className="text-xs font-semibold tabular-nums text-axal-ink dark:text-gray-100">{serviceRate(service)}</span>
        <span className="col-span-3 flex items-center gap-2 @lg:col-span-1 @lg:justify-end">
          <button
            type="button"
            role="switch"
            aria-checked={active}
            aria-label={`${service.title}: ${active ? 'active' : 'inactive'}`}
            disabled={busy}
            onClick={() => onToggle?.(service, !active)}
            className="inline-flex items-center gap-1.5 text-xs text-axal-muted disabled:opacity-50 dark:text-gray-400"
          >
            <span className={`relative h-5 w-9 rounded-axal-pill transition-colors ${active ? 'bg-axal-violet' : 'bg-gray-300 dark:bg-gray-600'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${active ? 'right-0.5' : 'left-0.5'}`} />
            </span>
            {active ? 'Active' : 'Inactive'}
          </button>
          <button type="button" className={BTN.link} onClick={() => onEdit?.(service)} disabled={busy} aria-label={`Edit ${service.title}`}>
            <Pencil size={12} aria-hidden="true" /> Edit
          </button>
          <button type="button" className="text-red-700 hover:text-red-800 disabled:opacity-50 dark:text-red-300" onClick={() => onAskDelete?.(service)} disabled={busy} aria-label={`Delete ${service.title}`}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </span>
      </div>
      {confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-axal-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alertdialog" aria-label="Confirm delete" data-testid={`confirm-delete-service-${service.uid}`}>
          <span>Delete “{service.title}”? This cannot be undone.</span>
          <button type="button" className={BTN.danger} onClick={() => onConfirmDelete?.(service)} disabled={busy}>Delete service</button>
          <button type="button" className={BTN.ghost} onClick={onCancelDelete} disabled={busy}>Keep</button>
        </div>
      )}
    </li>
  );
}

export function ServicesCard({ status, services = [], creating = false, onCreatingChange, onCreate, onUpdate, onDelete, onRetry }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [newDraft, setNewDraft] = useState(() => serviceDraft(null));

  const run = async (key, fn, done) => {
    setBusy(key); setError(null); setOk(null);
    try { await fn(); done?.(); }
    catch (e) { setError(e?.message || 'That change could not be saved.'); }
    finally { setBusy(null); }
  };
  const saveEdit = () => {
    const parsed = serviceBody(draft);
    if (!parsed.ok) { setFields(parsed.fields); return; }
    setFields({});
    run(editing, () => onUpdate(editing, parsed.body), () => { setEditing(null); setOk('Service saved.'); });
  };
  const saveNew = () => {
    const parsed = serviceBody(newDraft);
    if (!parsed.ok) { setFields(parsed.fields); return; }
    setFields({});
    run('new', () => onCreate(parsed.body), () => { setNewDraft(serviceDraft(null)); onCreatingChange?.(false); setOk('Service added.'); });
  };

  return (
    <Card data-testid="card-services">
      <CardHead title="Services" meta={status === 'ready' ? `${services.length} listed` : null} />
      {status === 'loading' ? <Skeleton.Text lines={3} /> : status === 'unreadable' ? (
        <Unreadable what="Your services" claim="This is not a sign that you have none." onRetry={onRetry} />
      ) : (
        <>
          {services.length ? (
            <ul className="@container divide-y divide-axal-hairline dark:divide-gray-800" data-testid="list-services">
              {services.map((s) => (editing === s.uid ? (
                <li key={s.uid} className="py-2.5">
                  <ServiceForm
                    draft={draft}
                    fields={fields}
                    busy={busy === s.uid}
                    error={busy ? null : error}
                    onChange={setDraft}
                    onSubmit={saveEdit}
                    onCancel={() => { setEditing(null); setFields({}); setError(null); }}
                  />
                </li>
              ) : (
                <ServiceRow
                  key={s.uid}
                  service={s}
                  busy={busy === s.uid}
                  confirming={confirming === s.uid}
                  onToggle={(svc, next) => run(svc.uid, () => onUpdate(svc.uid, { is_active: next }), () => setOk(`${svc.title} is ${next ? 'active' : 'inactive'}.`))}
                  onEdit={(svc) => { setEditing(svc.uid); setDraft(serviceDraft(svc)); setFields({}); setError(null); setOk(null); }}
                  onAskDelete={(svc) => { setConfirming(svc.uid); setError(null); setOk(null); }}
                  onConfirmDelete={(svc) => run(svc.uid, () => onDelete(svc.uid), () => { setConfirming(null); setOk('Service deleted.'); })}
                  onCancelDelete={() => setConfirming(null)}
                />
              )))}
            </ul>
          ) : !creating && (
            <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="text-services-empty">No services yet. Add your first with New service.</p>
          )}
          {creating && (
            <div className="mt-2">
              <ServiceForm
                mode="create"
                draft={newDraft}
                fields={fields}
                busy={busy === 'new'}
                error={busy ? null : error}
                onChange={setNewDraft}
                onSubmit={saveNew}
                onCancel={() => { onCreatingChange?.(false); setFields({}); setError(null); }}
              />
            </div>
          )}
          {!editing && !creating && <div className="mt-2"><Outcome ok={ok} error={error} testId="services" /></div>}
          <p className="mt-3 border-t border-axal-hairline pt-3 text-xs text-axal-muted dark:border-gray-700 dark:text-gray-400" data-testid="text-services-gap">{SERVICES_GAP}</p>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Weekly availability
// ---------------------------------------------------------------------------
const CELL_LOOK = {
  open: 'bg-axal-lavender-edge hover:bg-violet-300 dark:bg-violet-800/60 dark:hover:bg-violet-700/70',
  booked: 'bg-axal-violet cursor-not-allowed',
  closed: 'border border-axal-hairline bg-white hover:border-axal-violet/40 dark:border-gray-700 dark:bg-gray-900',
};
const CELL_WORD = { open: 'open', booked: 'booked', closed: 'closed' };
const hourLabel = (h) => String(h).padStart(2, '0');

export function AvailabilityGrid({ grid, busy = false, onCell }) {
  return (
    <div className="overflow-x-auto" data-testid="availability-grid">
      <table className="w-full min-w-[22rem] border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th scope="col" className="w-10" aria-label="Day" />
            {grid.hours.map((h) => (
              <th key={h} scope="col" className="text-center font-medium tabular-nums text-axal-faint dark:text-gray-500">{hourLabel(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.days.map((d) => (
            <tr key={d}>
              <th scope="row" className="text-left font-semibold text-axal-ink dark:text-gray-100">{DAY_NAMES[d]}</th>
              {grid.hours.map((h) => {
                const state = grid.cells[`${d}:${h}`];
                return (
                  <td key={h} className="p-0">
                    <button
                      type="button"
                      disabled={busy || state === 'booked'}
                      onClick={() => onCell?.(d, h)}
                      aria-label={`${fullDayName(d)} ${hourLabel(h)}:00, ${CELL_WORD[state]}${state === 'booked' ? '' : state === 'open' ? ' — close this hour' : ' — open this hour'}`}
                      className={`block h-[26px] w-full min-w-[1.5rem] rounded-[5px] transition-colors disabled:opacity-100 ${CELL_LOOK[state]}`}
                      data-testid={`cell-${d}-${h}`}
                      data-state={state}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AvailabilityCard({
  status, windows = [], bookings = [], timeZone = 'UTC', now = Date.now(), busy = false, error, ok,
  onRetry, onOpen, onClose, onRemove,
}) {
  const [pending, setPending] = useState(null);
  const grid = availabilityGrid({ windows, bookings, timeZone, now });
  const click = (day, hour) => {
    const action = cellAction({ windows, cells: grid.cells, day, hour, timeZone });
    if (action.kind === 'open') { setPending(null); onOpen?.(action.body); }
    else if (action.kind === 'close') { setPending(null); onClose?.(action.uid); }
    else setPending({ ...action, day, hour });
  };
  const legend = [['Open', CELL_LOOK.open], ['Booked', 'bg-axal-violet'], ['Closed', 'border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900']];
  return (
    <Card data-testid="card-availability">
      <CardHead title="Weekly availability">
        <span className="flex flex-wrap items-center gap-3 text-xs text-axal-muted dark:text-gray-400">
          {legend.map(([label, look]) => (
            <span key={label} className="inline-flex items-center gap-1.5"><span className={`h-3 w-3 rounded-[3px] ${look}`} aria-hidden="true" />{label}</span>
          ))}
        </span>
      </CardHead>
      {status === 'loading' ? <Skeleton.Text lines={4} /> : status === 'unreadable' ? (
        <Unreadable what="Your weekly availability" claim="This is not a sign that every hour is closed." onRetry={onRetry} />
      ) : (
        <>
          <p className="mb-2 text-xs text-axal-muted dark:text-gray-400">Times in {timeZone}. Click a cell to open or close it. Booked cells cannot be closed.</p>
          <AvailabilityGrid grid={grid} busy={busy} onCell={click} />
          {pending?.kind === 'remove' && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-axal-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alertdialog" aria-label="Confirm removing a window" data-testid="confirm-remove-window">
              <span>
                {DAY_NAMES[pending.day]} {hourLabel(pending.hour)}:00 is part of {pending.windows.map(windowLabel).join(' and ')}.
                {' '}A window is removed whole. Remove it?
              </span>
              <button type="button" className={BTN.danger} disabled={busy} onClick={() => { const uids = pending.windows.map((w) => w.uid); setPending(null); onRemove?.(uids); }}>
                Remove window
              </button>
              <button type="button" className={BTN.ghost} disabled={busy} onClick={() => setPending(null)}>Keep</button>
            </div>
          )}
          {pending?.kind === 'blocked' && (
            <p className="mt-2 text-xs text-axal-amber-deep dark:text-amber-300" role="status" data-testid="text-cell-blocked">{pending.reason}</p>
          )}
          {grid.other.length > 0 && (
            <div className="mt-3 text-xs text-axal-muted dark:text-gray-400" data-testid="list-other-zone-windows">
              <span className="font-semibold">Set in another time zone, not drawn above:</span>
              <ul className="mt-1 space-y-1">
                {grid.other.map((w) => (
                  <li key={w.uid} className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums">{windowLabel(w)} ({w.timezone})</span>
                    <button type="button" className={BTN.link} disabled={busy} onClick={() => setPending({ kind: 'remove', windows: [w], day: w.day_of_week, hour: Math.floor(w.start_minute / 60) })}>Remove</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-2"><Outcome ok={ok} error={error} testId="availability" /></div>
          <div className="mt-3"><InfoStrip variant="info" dismissible={false} body={SLOTS_GAP} /></div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Upcoming bookings — names and times only
// ---------------------------------------------------------------------------
const ACTION_LABEL = { confirmed: 'Confirm', cancelled: 'Cancel', completed: 'Mark completed' };

export function PracticeBookingRow({ booking, now = Date.now(), timeZone, busy = false, confirmingCancel = false, onAction, onAskCancel, onCancelCancel }) {
  const status = bookingStatus(booking.status);
  const when = formatWhen(booking.scheduled_at, { timeZone });
  return (
    <li className="py-2.5" data-testid={`practice-booking-${booking.uid}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-axal-ink dark:text-gray-100">
            {booking.booker_name || <Unrecorded reason="The member's account has no name on record.">Name not recorded</Unrecorded>}
          </div>
          <div className="text-xs text-axal-muted dark:text-gray-400">
            {String(booking.service_title ?? '').trim()
              || <Unrecorded reason="The member chose no service for this booking.">No service chosen</Unrecorded>}
          </div>
        </div>
        <div className="text-right text-xs tabular-nums text-axal-muted dark:text-gray-400">
          {when || <Unrecorded reason="Booked through your own scheduler, which keeps the time.">Time not recorded</Unrecorded>}
          <br />
          {Number.isFinite(Number(booking.duration_minutes)) ? `${booking.duration_minutes} min` : 'length not recorded'}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Pill tone={status.tone}>{status.label}</Pill>
        {expertActions(booking, now).map((next) => (
          <button
            key={next}
            type="button"
            disabled={busy}
            className={next === 'cancelled' ? BTN.dangerLink : BTN.link}
            onClick={() => (next === 'cancelled' ? onAskCancel?.(booking) : onAction?.(booking, next))}
          >
            {ACTION_LABEL[next]}
          </button>
        ))}
      </div>
      {confirmingCancel && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-axal-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="alertdialog" aria-label="Confirm cancelling a booking" data-testid={`confirm-cancel-${booking.uid}`}>
          <span>Cancel this booking? The member is told, and it cannot be undone.</span>
          <button type="button" className={BTN.danger} disabled={busy} onClick={() => onAction?.(booking, 'cancelled')}>Cancel booking</button>
          <button type="button" className={BTN.ghost} disabled={busy} onClick={onCancelCancel}>Keep</button>
        </div>
      )}
    </li>
  );
}

export function PracticeBookingsCard({ status, bookings = [], now = Date.now(), timeZone, busyUid = null, error, ok, onAction, onRetry }) {
  const [confirming, setConfirming] = useState(null);
  const { upcoming, past } = splitBookings(bookings, now);
  const act = (booking, next) => { setConfirming(null); onAction?.(booking, next); };
  const row = (b) => (
    <PracticeBookingRow
      key={b.uid}
      booking={b}
      now={now}
      timeZone={timeZone}
      busy={busyUid === b.uid}
      confirmingCancel={confirming === b.uid}
      onAction={act}
      onAskCancel={(bk) => setConfirming(bk.uid)}
      onCancelCancel={() => setConfirming(null)}
    />
  );
  return (
    <Card data-testid="card-practice-bookings">
      <CardHead title="Upcoming bookings" meta={status === 'ready' ? `${upcoming.length}` : null} />
      {status === 'loading' ? <Skeleton.Text lines={4} /> : status === 'unreadable' ? (
        <Unreadable what="Your bookings" claim="This is not a sign that you have none." onRetry={onRetry} />
      ) : (
        <>
          {upcoming.length ? (
            <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="list-practice-upcoming">{upcoming.map(row)}</ul>
          ) : (
            <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="text-practice-bookings-empty">No upcoming bookings.</p>
          )}
          {past.length > 0 && (
            <details className="mt-2" data-testid="practice-earlier">
              <summary className="cursor-pointer text-xs font-semibold text-axal-ink dark:text-gray-100">Earlier bookings · {past.length}</summary>
              <ul className="divide-y divide-axal-hairline dark:divide-gray-800">{past.map(row)}</ul>
            </details>
          )}
          <div className="mt-2"><Outcome ok={ok} error={error} testId="practice-bookings" /></div>
        </>
      )}
      <p className="mt-3 border-t border-axal-hairline pt-3 text-xs text-axal-muted dark:border-gray-700 dark:text-gray-400">
        Names and times only. This list never shows a booking’s note.
      </p>
    </Card>
  );
}
