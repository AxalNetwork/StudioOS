import React, { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Card } from '../../../ui';
import { api } from '../../../lib/api';
import {
  Field, NothingYet, Pill, SaveNote, Unrecorded, ZoneBody, ZoneHeading,
  buttonClass, dollarsToCents, ghostButtonClass, inputClass, money,
} from './kit';
import { advisorZoneActions } from '../../../workspaces/advisorZoneActions';

/**
 * Expertise · Services — what you sell, and what you charge for it.
 *
 * MONEY IS RECORDED, NOT MOVED. Nothing on this page is a checkout. There is no
 * payment provider behind it, Axal issues no invoice and takes no position on
 * collection — a price here is the advisor's own statement of what they charge,
 * the same way a rate card is. Migration 203's header says the same thing from
 * the schema side.
 *
 * AN UNPRICED SERVICE IS NOT A FREE ONE. `price_cents` is nullable and the
 * empty state reads "Not recorded", never "$0". Zero is a price an advisor may
 * genuinely mean, so it cannot double as "no answer" — and CLAUDE.md's rule is
 * that an unset fact reads as unset.
 *
 * `units_sold` IS NOT SHOWN, and it is a null rather than a zero for a reason
 * worth stating: nothing in the schema links a booking to a service. A booking
 * carries free text in `topic`. Counting the bookings whose topic happens to
 * match a service title would render a guess in the shape of a fact.
 */

const KINDS = [
  ['fixed', 'Fixed', 'One engagement, one price.'],
  ['package', 'Package', 'A bundle of sessions or deliverables.'],
  ['retainer', 'Retainer', 'Recurring, usually monthly.'],
];

const BLANK = { title: '', kind: 'fixed', duration_note: '', price: '', scope: '' };

export default function ServicesZone() {
  const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }));
    try {
      const res = await api.listMyAdvisorServices();
      setState({ loading: false, error: '', items: Array.isArray(res?.items) ? res.items : [] });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Your services could not be read.', items: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setNote(null);
    const title = draft.title.trim();
    if (!title) { setNote({ ok: false, text: 'A service needs a title.' }); return; }
    // Parsed here so a typo is a sentence rather than a 400 from the worker.
    const parsed = dollarsToCents(draft.price);
    if (parsed.error) { setNote({ ok: false, text: parsed.error }); return; }
    setBusy(true);
    try {
      await api.createMyAdvisorService({
        title,
        kind: draft.kind,
        duration_note: draft.duration_note.trim() || null,
        price_cents: parsed.cents,
        scope: draft.scope.trim() || null,
      });
      setDraft(BLANK);
      setNote({ ok: true, text: 'Service added.' });
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'The service could not be saved. Nothing was added.' });
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row) => {
    setNote(null);
    try {
      await api.updateMyAdvisorService(row.id, { is_active: !row.is_active });
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be changed.' });
    }
  };

  const remove = async (row) => {
    setNote(null);
    try {
      await api.deleteMyAdvisorService(row.id);
      await load();
    } catch (err) {
      setNote({ ok: false, text: err?.message || 'That could not be removed.' });
    }
  };

  const priced = state.items.filter((s) => s.price_cents != null);
  const unpriced = state.items.filter((s) => s.price_cents == null);

  /**
   * HOW MANY TIMES A SERVICE SOLD IS NOT KNOWN, and the two stats that depend
   * on it say so rather than computing a confident zero.
   *
   * `GET /me/services` returns `units_sold: null` on every row — not sometimes,
   * always — and `routes/advisors.ts` explains why: nothing links a booking to
   * a service. `advisor_bookings` carries a free-text `topic`, not a service
   * id, so counting bookings whose topic happens to match a title would be a
   * guess wearing a number's clothes. Migration 203's header says the same.
   *
   * An earlier revision of this strip read `s.sold` — a field that exists under
   * no name — and defaulted it to 0. That did NOT render as blank: `money(0)`
   * returns "$0", so an advisor with real bookings was shown a practice that
   * had booked $0, and "Most sold" named whichever service happened to be
   * first, since nothing ever beat zero.
   *
   * So both are `null` here, and null reaches the strip as "Not recorded". When
   * a booking can name the service it delivered, `unitsFor` becomes real and
   * these two light up on their own.
   */
  const unitsFor = (s) => (s.units_sold == null ? null : s.units_sold);
  const anyUnitsKnown = state.items.some((s) => unitsFor(s) != null);
  const bookedCents = anyUnitsKnown
    ? priced.reduce((a, s) => a + s.price_cents * (unitsFor(s) ?? 0), 0)
    : null;
  const unitsSold = anyUnitsKnown
    ? state.items.reduce((a, s) => a + (unitsFor(s) ?? 0), 0)
    : null;
  const mostSold = anyUnitsKnown
    ? state.items.reduce((a, b) => ((unitsFor(b) ?? 0) > (unitsFor(a) ?? 0) ? b : a), state.items[0])
    : null;

  const empty = (
    <NothingYet
      title="No services recorded yet"
      body="Add what you actually sell — a fixed engagement, a package, a retainer — with the price you charge for it. This is your own record: nothing is billed, invoiced or collected through Axal."
    />
  );

  return (
    <div className="space-y-4">
      {/* Canvas stats strip — computed from the ledger, not asserted. */}
      {state.items.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Services', value: String(state.items.length), note: `${priced.length} priced, ${unpriced.length} not` },
            {
              label: 'Booked',
              value: bookedCents == null ? <Unrecorded /> : money(bookedCents),
              note: unitsSold == null ? 'a booking records a topic, not a service' : `from ${unitsSold} units`,
            },
            {
              label: 'Most sold',
              value: mostSold?.title || <Unrecorded />,
              note: mostSold ? `${unitsFor(mostSold)} units` : 'nothing counts sales per service yet',
            },
            { label: 'Unpriced', value: String(unpriced.length), note: unpriced.length ? 'scope settled, price is not' : 'all priced' },
          ].map((s) => (
            <Card key={s.label} padding="md">
              <div className="text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">{s.label}</div>
              <div className="mt-1 text-[15px] font-extrabold tabular-nums">{s.value}</div>
              <div className="mt-0.5 text-[10px] text-axal-ink-3">{s.note}</div>
            </Card>
          ))}
        </div>
      )}

      <Card padding="lg">
        <ZoneHeading
          title="Add a service"
          blurb="A price here is what you charge, recorded for your own storefront. No payment runs through this page."
        />
        <form onSubmit={add} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title">
            <input className={inputClass} value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Fractional CTO day" />
          </Field>
          <Field label="Kind" hint={KINDS.find(([k]) => k === draft.kind)?.[2]}>
            <select className={inputClass} value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Price" hint="Leave blank if you have not set one — blank reads as “not recorded”, not as free.">
            <input className={inputClass} value={draft.price} inputMode="decimal"
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              placeholder="2500" />
          </Field>
          <Field label="Duration" hint="In your own words.">
            <input className={inputClass} value={draft.duration_note}
              onChange={(e) => setDraft({ ...draft, duration_note: e.target.value })}
              placeholder="One day, on site" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="What it covers">
              <textarea rows={2} className={inputClass} value={draft.scope}
                onChange={(e) => setDraft({ ...draft, scope: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className={buttonClass} disabled={busy}>
              {busy ? 'Adding…' : 'Add service'}
            </button>
            <SaveNote note={note} />
          </div>
        </form>
      </Card>

      <ZoneBody loading={state.loading} error={state.error} onRetry={load}
        actions={advisorZoneActions('expertise/services', { view: { header: ['Service', 'Active', 'Price (cents)', 'Units sold'], rows: state.items, cells: (r) => [r.title, r.is_active, r.price_cents, r.units_sold] } })}
        isEmpty={state.items.length === 0} empty={empty}>
        <div className="space-y-3">
          {state.items.map((row) => (
            <Card key={row.id} padding="md">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-extrabold">{row.title}</span>
                    <Pill tone="neutral">{KINDS.find(([k]) => k === row.kind)?.[1] || row.kind}</Pill>
                    {!row.is_active && <Pill tone="warn">Hidden</Pill>}
                  </div>
                  {row.duration_note && (
                    <div className="mt-0.5 text-[11.5px] text-axal-ink-3">{row.duration_note}</div>
                  )}
                  {row.scope && (
                    <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-axal-ink-2">{row.scope}</p>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[15px] font-extrabold tabular-nums">
                    {money(row.price_cents, row.currency) ?? <Unrecorded />}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className={ghostButtonClass} onClick={() => toggleActive(row)}>
                      {row.is_active ? 'Hide' : 'Show'}
                    </button>
                    <button type="button" className={ghostButtonClass} onClick={() => remove(row)}
                      aria-label={`Remove ${row.title}`}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
          <p className="text-[11px] leading-relaxed text-axal-ink-3">
            How many times each service has been delivered is not shown. Nothing in the product links
            a booking to a service — a booking records a free-text topic — so a count here would be a
            guess wearing the shape of a number.
          </p>
        </div>
      </ZoneBody>
    </div>
  );
}
