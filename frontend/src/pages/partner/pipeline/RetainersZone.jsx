import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Unrecorded, Pill,
  StatCard, Section, Field, SaveNote, NotComputable, NoPartnerProfile,
  isNoPartnerProfile, inputClass, buttonClass, ghostButtonClass,
  moneyCents, dollarsToCents, formatDay,
} from '../kit';

/**
 * Pipeline · Retainers — `/pipeline/retainers`.
 *
 * WHAT WAS MISSING AND WHAT MIGRATION 208 ADDED. An engagement is a single
 * accepted quote at a single price: no cadence, no renewal date, no
 * consumption. So nothing in the store distinguished a retainer from a
 * one-off, and this zone's card said exactly that. `partner_retainers` adds
 * the shape (`retainer` or `embedded_seat`), the cadence, the amount and the
 * hours retained; `retainer_usage` adds one row per period of hours actually
 * used. Every figure below reads one of those two.
 *
 * WHY EVERY ENGAGEMENT APPEARS, NOT ONLY THE RETAINERS. `GET /retainers` left
 * joins, so a firm whose work is all one-off sees its engagements with
 * "Not a retainer" beside each rather than an empty page. Recording the first
 * retainer is then a click on the row it belongs to, instead of a form asking
 * for an engagement id.
 *
 * TWO NUMBERS THIS PAGE REFUSES TO INVENT, and both refusals are the point:
 *
 *   UTILISATION IS NEVER 0%. It is null in two different ways — a retainer
 *   with no retained hours HAS no utilisation (a different shape of deal), and
 *   a retainer whose period has no logged hours has one nobody has recorded
 *   yet. Rendering either as 0% would say the client used none of what they
 *   bought. The worker returns the note; this page prints it.
 *
 *   MRR SAYS WHAT IT COUNTED. A retainer with no amount is skipped rather than
 *   summed as zero, and `mrr_basis` names how many rows are in the total. A
 *   monthly figure that quietly counts three unpriced retainers as free is
 *   worse than no figure.
 *
 * UTILISATION IS COMPUTED IN THE WORKER, in `_partner_workspace_helpers.ts`,
 * and Delivery · Health reads the same helper rather than recomputing it —
 * which is why that zone marks the figure as a read. Two pages disagreeing
 * about one client's utilisation is worse than either number.
 */

const SHAPES = [
  ['retainer', 'Retainer'],
  ['embedded_seat', 'Embedded seat'],
];
const SHAPE_LABEL = Object.fromEntries(SHAPES);
const CADENCES = [
  ['monthly', 'Monthly'],
  ['quarterly', 'Quarterly'],
];
const CADENCE_LABEL = Object.fromEntries(CADENCES);

/** The period label the worker would pick for a cadence, for the usage form. */
function currentPeriod(cadence) {
  const d = new Date();
  const y = d.getUTCFullYear();
  if (cadence === 'quarterly') return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Utilisation, or the reason there is none — never a percentage bar at zero.
 *
 * The bar is drawn only when there is a real percentage. Where there is not,
 * the chip carries the worker's own sentence, so the two null cases read
 * differently on the page as well as in the response.
 */
function Utilisation({ pct, note, used, retained }) {
  if (pct === null || pct === undefined) {
    return <NotComputable why={note}>No utilisation</NotComputable>;
  }
  const over = pct > 100;
  const low = pct < 60;
  return (
    <div className="min-w-[140px]">
      <div className="flex items-baseline gap-2">
        <span className={`text-sm font-extrabold tabular-nums ${over ? 'text-red-700 dark:text-red-300' : ''}`}>
          {pct}%
        </span>
        <span className="text-[11px] text-axal-ink-3 tabular-nums">
          {used}h of {retained}h
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-axal-surface-2">
        <div
          className={`h-full rounded-full ${over ? 'bg-red-500' : low ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function RetainerForm({ row, onSave, onDelete, busy, note }) {
  const r = row.retainer;
  const [shape, setShape] = useState(r?.shape || 'retainer');
  const [cadence, setCadence] = useState(r?.cadence || 'monthly');
  const [amount, setAmount] = useState(r?.amount_cents != null ? String(r.amount_cents / 100) : '');
  const [hours, setHours] = useState(r?.retained_hours != null ? String(r.retained_hours) : '');
  const [renews, setRenews] = useState(r?.renews_at || '');
  const [ended, setEnded] = useState(r?.ended_at || '');
  const [amountError, setAmountError] = useState('');

  useEffect(() => {
    setShape(r?.shape || 'retainer');
    setCadence(r?.cadence || 'monthly');
    setAmount(r?.amount_cents != null ? String(r.amount_cents / 100) : '');
    setHours(r?.retained_hours != null ? String(r.retained_hours) : '');
    setRenews(r?.renews_at || '');
    setEnded(r?.ended_at || '');
  }, [r]);

  function submit() {
    // Typed dollars become integer cents HERE and nowhere else — the worker
    // takes cents and rejects a fraction, so a form that sent 1500.5 would get
    // a 400 whose reason a person cannot act on. This turns it into one they
    // can, before it is sent.
    const parsed = dollarsToCents(amount);
    if (parsed.error) { setAmountError(parsed.error); return; }
    setAmountError('');
    onSave(row, {
      shape,
      cadence,
      amount_cents: parsed.cents,
      retained_hours: hours.trim() === '' ? null : Number(hours),
      renews_at: renews.trim() || null,
      ended_at: ended.trim() || null,
    });
  }

  return (
    <div className="mt-3 rounded-lg border border-axal-hairline bg-axal-surface-2 p-3 dark:border-gray-700">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Shape" hint="An embedded seat is a person inside the client's systems, not a scope of work.">
          <select className={inputClass} value={shape} onChange={(e) => setShape(e.target.value)}>
            {SHAPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Cadence">
          <select className={inputClass} value={cadence} onChange={(e) => setCadence(e.target.value)}>
            {CADENCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Amount per period" hint={amountError || 'Leave empty rather than typing 0 — an unpriced retainer is not a free one.'}>
          <input className={inputClass} value={amount} inputMode="decimal" placeholder="e.g. 8000"
            onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Retained hours" hint="Empty means this is not sold by the hour, so it has no utilisation.">
          <input className={inputClass} value={hours} inputMode="decimal" placeholder="e.g. 40"
            onChange={(e) => setHours(e.target.value)} />
        </Field>
        <Field label="Renews on" hint="YYYY-MM-DD">
          <input className={inputClass} value={renews} maxLength={40} placeholder="2026-12-01"
            onChange={(e) => setRenews(e.target.value)} />
        </Field>
        <Field label="Ended on" hint="Set this rather than deleting — an ended retainer is still what happened.">
          <input className={inputClass} value={ended} maxLength={40} placeholder=""
            onChange={(e) => setEnded(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={busy} onClick={submit}>
          {r ? 'Save retainer' : 'Record as a retainer'}
        </button>
        {r && (
          <button type="button" className={`${ghostButtonClass} ml-auto text-red-700 dark:text-red-300`}
            disabled={busy} onClick={() => onDelete(row)}>
            Remove the retainer record
          </button>
        )}
      </div>
      {/* Only this row's own result — see `run`'s docblock. */}
      <SaveNote note={note?.scope === row.engagement_id ? note : null} />
    </div>
  );
}

function UsageForm({ row, onSave, onDelete, busy }) {
  const period = row.current_period || currentPeriod(row.retainer?.cadence || 'monthly');
  const logged = (row.usage || []).find((u) => u.period === period) || null;
  const [hours, setHours] = useState(logged ? String(logged.hours_used) : '');
  const [note, setNote] = useState(logged?.note || '');
  useEffect(() => {
    setHours(logged ? String(logged.hours_used) : '');
    setNote(logged?.note || '');
  }, [logged?.hours_used, logged?.note]);

  return (
    <div className="mt-3 rounded-lg border border-axal-hairline p-3 dark:border-gray-700">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
        Hours for {period}
      </div>
      <div className="mt-2 grid gap-3 md:grid-cols-3">
        <Field label="Hours used">
          <input className={inputClass} value={hours} inputMode="decimal" placeholder="e.g. 31.5"
            onChange={(e) => setHours(e.target.value)} />
        </Field>
        <Field label="Note" hint="Optional — what the period went on.">
          <input className={inputClass} value={note} maxLength={400}
            onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex items-end gap-2">
          <button
            type="button" className={buttonClass}
            disabled={busy || hours.trim() === ''}
            onClick={() => onSave(row, period, { hours_used: Number(hours), note })}
          >
            Log hours
          </button>
          {logged && (
            <button
              type="button" className={ghostButtonClass} disabled={busy}
              title="Removes the record for this period. Logging zero would claim they used none."
              onClick={() => onDelete(row, period)}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {(row.usage || []).length > 1 && (
        <p className="mt-2 text-[11.5px] text-axal-ink-3">
          Also logged:{' '}
          {(row.usage || []).filter((u) => u.period !== period)
            .map((u) => `${u.period} · ${u.hours_used}h`).join(', ')}
        </p>
      )}
    </div>
  );
}

function RetainerRow({ row, onSaveRetainer, onDeleteRetainer, onSaveUsage, onDeleteUsage, busy, note }) {
  const [open, setOpen] = useState(false);
  const r = row.retainer;
  const days = r?.days_to_renewal ?? null;

  return (
    <div className="rounded-xl border border-axal-hairline p-4 dark:border-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-extrabold tracking-tight">
            {row.founder_name || row.need_title || <Unrecorded>Unnamed client</Unrecorded>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-axal-ink-3">
            <span>{row.engagement_uid}</span>
            {row.need_title && row.founder_name && <span>· {row.need_title}</span>}
            <span>· {row.engagement_status}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {r
            ? <Pill tone={r.ended_at ? 'neutral' : 'info'}>{SHAPE_LABEL[r.shape] || r.shape}</Pill>
            : <Pill tone="neutral">Not a retainer</Pill>}
          <button type="button" className={ghostButtonClass} onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : r ? 'Edit' : 'Record'}
          </button>
        </div>
      </div>

      {r && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Amount</div>
            <div className="mt-0.5 text-sm font-extrabold tabular-nums">
              {r.amount_cents != null
                ? <>{moneyCents(r.amount_cents)} <span className="text-[11px] font-semibold text-axal-ink-3">/ {CADENCE_LABEL[r.cadence]?.toLowerCase()}</span></>
                : <Unrecorded>No amount recorded</Unrecorded>}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">
              This period ({row.current_period})
            </div>
            <div className="mt-0.5">
              <Utilisation
                pct={row.utilisation_pct} note={row.utilisation_note}
                used={row.hours_used} retained={row.retained_hours}
              />
            </div>
          </div>
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Renews</div>
            <div className="mt-0.5 text-[12.5px]">
              {r.renews_at
                ? <>{formatDay(r.renews_at)}{days !== null && <span className="ml-1.5 text-axal-ink-3">({days < 0 ? `${-days}d ago` : `in ${days}d`})</span>}</>
                : <Unrecorded>No renewal date</Unrecorded>}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-ink-3">Ended</div>
            <div className="mt-0.5 text-[12.5px]">
              {r.ended_at ? formatDay(r.ended_at) : <span className="text-axal-ink-2">Running</span>}
            </div>
          </div>
        </div>
      )}

      {open && (
        <>
          <RetainerForm row={row} onSave={onSaveRetainer} onDelete={onDeleteRetainer} busy={busy} note={note} />
          {r && <UsageForm row={row} onSave={onSaveUsage} onDelete={onDeleteUsage} busy={busy} />}
        </>
      )}
    </div>
  );
}

export default function PartnerRetainersZone() {
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const r = await api.listPartnerRetainers();
      setState({ loading: false, error: '', data: r || {} });
    } catch (e) {
      setState({ loading: false, error: e?.message || 'The retainer record did not load.', data: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  /**
   * One write, with its result reported ON THE ROW THAT MADE IT.
   *
   * `scope` is why this takes a third argument. A single `note` here is
   * rendered by every open row, so logging hours against one client would print
   * "Hours logged." under every other row a person had expanded — each of them
   * a claim about a write that did not happen there.
   */
  const run = useCallback(async (fn, ok, scope) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setNote({ ok: true, text: ok, scope });
      await load();
    } catch (e) {
      setNote({ ok: false, text: e?.message || 'That did not save.', scope });
    } finally {
      setBusy(false);
    }
  }, [load]);

  const d = state.data;
  const items = Array.isArray(d?.items) ? d.items : [];
  const retainerCount = d?.retainer_count ?? 0;
  const renewingSoon = useMemo(
    () => items.filter((r) => {
      const days = r.retainer?.days_to_renewal;
      return !r.retainer?.ended_at && days !== null && days !== undefined && days >= 0 && days <= 30;
    }),
    [items],
  );
  const overScope = useMemo(
    () => items.filter((r) => r.utilisation_pct !== null && r.utilisation_pct > 100),
    [items],
  );

  if (isNoPartnerProfile(state.error)) {
    return (
      <>
        <ZoneHeading title="Retainers" />
        <NoPartnerProfile />
      </>
    );
  }

  return (
    <ZoneBody
      loading={state.loading}
      error={state.error}
      onRetry={load}
      isEmpty={items.length === 0}
      empty={(
        <NothingYet
          title="No engagement to hold a retainer yet"
          body={
            'A retainer is recorded against an accepted engagement. Win a quote '
            + 'and the engagement appears here — mark it a retainer or an '
            + 'embedded seat, and the recurring figures start answering.'
          }
          action={<Link to="/pipeline/proposals" className="text-[12.5px] font-semibold text-amber-700 underline">Open proposals</Link>}
        />
      )}
    >
      <div className="space-y-6">
        <ZoneHeading
          title="Recurring work"
          blurb={
            'What each client is on, what they are actually consuming against '
            + 'what they bought, and when it renews. Every engagement is listed; '
            + 'the ones that are not retainers say so rather than being hidden.'
          }
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Monthly recurring"
            value={d?.mrr_cents != null ? moneyCents(d.mrr_cents) : '—'}
            hint={d?.mrr_basis || d?.mrr_note || 'nothing priced yet'}
          />
          <StatCard label="On a retainer" value={retainerCount} hint={`of ${items.length} engagements`} />
          <StatCard
            label="Renewing in 30d"
            value={renewingSoon.length}
            hint={retainerCount ? 'with a recorded renewal date' : 'nothing recorded yet'}
          />
          <StatCard
            label="Over scope"
            value={overScope.length}
            hint={retainerCount ? 'past the retained hours this period' : 'nothing recorded yet'}
          />
        </div>

        {d?.mrr_note && d?.mrr_cents != null && (
          <p className="text-[12px] leading-relaxed text-axal-ink-2">{d.mrr_note}</p>
        )}

        <Section title="Engagements">
          <div className="space-y-3">
            {items.map((row) => (
              <RetainerRow
                key={row.engagement_id}
                row={row}
                busy={busy}
                note={note}
                onSaveRetainer={(r, patch) => run(
                  () => api.savePartnerRetainer(r.engagement_id, patch),
                  'Saved.', r.engagement_id,
                )}
                onDeleteRetainer={(r) => run(
                  () => api.deletePartnerRetainer(r.engagement_id),
                  'Retainer record removed.', r.engagement_id,
                )}
                onSaveUsage={(r, period, patch) => run(
                  () => api.savePartnerRetainerUsage(r.engagement_id, period, patch),
                  'Hours logged.', r.engagement_id,
                )}
                onDeleteUsage={(r, period) => run(
                  () => api.deletePartnerRetainerUsage(r.engagement_id, period),
                  'Period cleared.', r.engagement_id,
                )}
              />
            ))}
          </div>
        </Section>

        <StatedLimit title="What this zone does not claim">
          <p>
            <strong>Utilisation is never 0%.</strong> A retainer sold without
            retained hours has no utilisation at all — a different shape of deal,
            not a missing figure — and a period with nothing logged has one
            nobody has recorded. Both read as “No utilisation” with the reason
            beside them, because a bar at zero would say the client used none of
            what they paid for.
          </p>
          <p className="mt-2">
            <strong>Monthly recurring counts only what is priced.</strong> A
            retainer with no amount is left out rather than summed as zero, and
            the figure states how many rows are in it. Quarterly amounts are
            divided by three; nothing is annualised, because a renewal date is
            not a commitment to renew.
          </p>
          <p className="mt-2">
            <strong>Consumption is what somebody logged here.</strong> No
            timesheet, calendar or ticket system feeds these hours, so a period
            that reads light may be one nobody has filled in. That is why an
            unlogged period is blank rather than low.
          </p>
        </StatedLimit>
      </div>
    </ZoneBody>
  );
}
