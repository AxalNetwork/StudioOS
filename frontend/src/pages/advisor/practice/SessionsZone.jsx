import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import {
  Field, NothingYet, Pill, SaveNote, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, dollarsToCents, ghostButtonClass, inputClass, money,
} from '../expertise/kit';
import { bookingView, formatDateTime, slotMinutes } from '../advisory/kit';

/**
 * Practice · Sessions — the session LEDGER, not a third list of bookings.
 *
 * WHAT THIS ZONE OWNS, and the boundary is the whole design. Bookings are
 * already worked in two places, and both work: Opportunities takes the inbound
 * request and holds Confirm/Decline; Engagements runs the lifecycle — held,
 * no-show, cancelled. A third page rendering the same rows would be exactly
 * what the empty card that used to sit here warned against.
 *
 * What NOTHING reads is the money. Migration 205 added `amount_cents` and
 * `billing_state` to `advisor_bookings` and nothing has ever displayed them.
 * That is this page: what each session was worth and whether the advisor was
 * paid, per row and reconciled.
 *
 * NO MONEY MOVES THROUGH AXAL. There is no checkout here, no payment provider
 * behind it, no invoice issued and no obligation created. `billing_state` is
 * the advisor's own bookkeeping note about their own arrangement with their
 * own client — migration 205's header says the same from the schema side, and
 * the rail beside this page says it to the reader.
 *
 * THREE RULES THE WORKER ENFORCES, mirrored here so a person sees the reason
 * rather than a 400:
 *   - a session with no amount cannot be billed, collected or written off —
 *     there is no figure for those words to refer to;
 *   - naming an amount and saying nothing else means `billed`;
 *   - an unpriced session renders "Not recorded", never `$0`. Zero is a price
 *     an advisor may genuinely mean, so it cannot double as "no answer".
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

export default function SessionsZone() {
  const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      const res = await api.listMyAdvisorBookings();
      setState({
        loading: false,
        error: '',
        items: (Array.isArray(res?.items) ? res.items : []).map(bookingView),
      });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Your sessions could not be read.', items: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSaved = useCallback(() => { setEditing(null); load(); }, [load]);

  // Only sessions that actually happened can carry money. A cancelled or
  // no-show session has no amount to record, and offering the editor on one
  // would invite a figure that means nothing.
  const billable = useMemo(
    () => state.items.filter((b) => ['completed', 'confirmed'].includes(b.status)),
    [state.items],
  );
  const unpriced = billable.filter((b) => b.amount_cents == null).length;

  const empty = (
    <NothingYet
      title="No sessions to price yet"
      body="Sessions appear here once a booking is confirmed. Availability is published under Opportunities, and the lifecycle — held, no-show, cancelled — is run from Engagements. This zone records only what each session was worth."
      action={(
        <p className="flex flex-wrap gap-3 text-[12px]">
          <Link to="/practice/opportunities" className="text-emerald-700 underline">Publish availability →</Link>
          <Link to="/practice/engagements" className="text-emerald-700 underline">Run the lifecycle →</Link>
        </p>
      )}
    />
  );

  return (
    <div className="space-y-4">
      <ZoneHeading
        title="What each session was worth"
        blurb="Your own record of what you charged and whether you were paid. Nothing is billed, invoiced or collected through Axal — this is bookkeeping, not a payment rail."
        action={unpriced > 0 ? (
          <Pill tone="warn">{unpriced} unpriced</Pill>
        ) : null}
      />

      <ZoneBody loading={state.loading} error={state.error} onRetry={load}
        isEmpty={billable.length === 0} empty={empty}>
        <div className="space-y-3">
          {billable.map((b) => (
            <Card key={b.id} padding="md">
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
            </Card>
          ))}
          <p className="text-[11px] leading-relaxed text-axal-ink-3">
            Only confirmed and held sessions are listed — a cancelled or no-show session has no
            amount to record. The full booking history, including those, is under{' '}
            <Link to="/practice/engagements" className="text-emerald-700 underline">Engagements</Link>.
          </p>
        </div>
      </ZoneBody>
    </div>
  );
}
