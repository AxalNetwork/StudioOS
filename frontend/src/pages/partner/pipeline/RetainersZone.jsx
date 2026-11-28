import { centsToInput } from '../../../lib/moneyInput.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { readAllPages } from '../../../lib/pagedRead';
import PartialRead, { PipelineReadStatus } from './PartialRead';
import { usePipelineZone } from './usePipelineZone';
import OpportunitySheet, { OPEN_OPPORTUNITY_CLASS } from './OpportunitySheet';
import { matchesFocus, useEngagementFocus } from '../delivery/engagementFocus';
import { BackToFeedLink, NotFoundNotice, feedItemName } from '../FromStudioBack';
import {
  BAND, LOW_USE_PCT, TAB_LABEL, attentionSets, healthOf, monthlyEquivalent, retainerRows,
  retainerStrip, scopeText, sheetTabs, utilisationRead,
} from './retainersModel';
import { retainerActive, retainerUtilPct } from './commandCentre';
import { partnerZoneActions } from '../../../workspaces/partnerZoneActions';
import { partnerZoneFilters } from '../../../workspaces/partnerZoneFilters';
import ZoneToolbar from '../../../workspaces/ZoneToolbar';
import ZoneDraft from '../../../workspaces/ZoneDraft';
import { Eyebrow, NotRecorded } from '../../../workspaces/canvasKit';
import {
  ZoneBody, NothingYet, StatedLimit, ZoneHeading, Unrecorded, Pill,
  Section, Field, SaveNote, NotComputable, NoPartnerProfile,
  isNoPartnerProfile, inputClass, buttonClass, ghostButtonClass,
  moneyCents, dollarsToCents, formatDay,
} from '../kit';

/**
 * Pipeline · Retainers — `/pipeline/retainers`.
 *
 * D4838 PP06 / PP06m (#5939): EXCEPTIONS FIRST. An attention band sits above the
 * ledger with three items — over-serviced, renewing within 30 days, under 50%
 * utilization — and pressing one filters the ledger to exactly the rows it
 * counted. Then the KPI strip (Current recurring revenue, Active retainers,
 * Renewal value next 30d, Utilization risk) and the ledger (Client, Monthly
 * equivalent, Scope, Utilization, Renewal, Health). On a phone each retainer is
 * a card that leads with utilization, renewal, the monthly equivalent and health.
 *
 * THE BAND USES THE COMMAND CENTRE'S RULES, IMPORTED, NOT COPIED. Before this
 * part the zone called a retainer under-consuming below 60% while the Pipeline
 * root called it low use below 50, so a retainer at 55% was an exception in one
 * place and not the other. `retainersModel.js` takes `isLowUse`,
 * `isOverServiced`, `isRenewingSoon` and `retainerActive` from
 * `commandCentre.js`, and the band, the strip and the ledger filter all read
 * them. The Worker's own `under_consuming_count` still counts below 60 and is
 * not drawn here (the Worker is out of this part's scope).
 *
 * WHAT WAS MISSING AND WHAT MIGRATION 208 ADDED. An engagement is a single
 * accepted quote at a single price: no cadence, no renewal date, no
 * consumption. `partner_retainers` adds the shape (`retainer` or
 * `embedded_seat`), the cadence, the amount and the hours retained;
 * `retainer_usage` adds one row per period of hours actually used. Every figure
 * below reads one of those two.
 *
 * TWO NUMBERS THIS PAGE REFUSES TO INVENT:
 *
 *   UTILIZATION IS NEVER 0% BY ABSENCE. It is null in two different ways — a
 *   retainer with no retained hours HAS no utilization (a fee-based deal is a
 *   different shape, not a badly consumed one), and a retainer whose period has
 *   no logged hours has one nobody has recorded yet. Both read Not recorded
 *   with the Worker's note, and neither is in a consumption item. A logged 0 is
 *   a recorded 0%, and that IS low use.
 *
 *   A QUARTERLY AMOUNT IS NEVER CALLED MONTHLY. The column is the monthly
 *   equivalent the Worker computes (quarterly ÷ 3), and a quarterly row says
 *   how it was reached.
 *
 * THE EDITOR LIVES IN A SHEET, AND A REFRESH KEEPS IT. The sheet holds an
 * engagement id, not a row, and looks the row up on every render, so a
 * background refresh (after any save) hands it the fresh row without closing
 * it. Each form keeps what was typed as a draft until a save succeeds; a
 * refresh changes the stored values underneath and never the draft. The tab
 * panels stay mounted while hidden, so switching tabs does not drop a draft
 * either.
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
const CADENCE_PER = { monthly: 'a month', quarterly: 'a quarter' };

/** The period label the worker would pick for a cadence, for the usage form. */
function currentPeriod(cadence) {
  const d = new Date();
  const y = d.getUTCFullYear();
  if (cadence === 'quarterly') return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const clientName = (r) => r.founder_name || r.need_title || null;

/** A KPI tile, in the anatomy the artboards share. */
function RetainerTile({ t }) {
  return (
    <div data-testid="retainer-kpi" className="rounded-[10px] border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <Eyebrow>{t.label}</Eyebrow>
      <div className="mt-1.5">
        {t.state === 'unrecorded' ? <NotRecorded /> : (
          <span className="font-mono text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{t.value}</span>
        )}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-600 dark:text-gray-400">{t.note}</div>
    </div>
  );
}

/**
 * Utilization in words: the percentage, a shape and a word ("118% · over scope"),
 * with the bar as decoration only. Where none is recorded it reads Not recorded
 * with the Worker's own reason — the two nulls are different facts, and only the
 * Worker knows which this is.
 */
function Utilisation({ row, compact = false }) {
  const pct = retainerUtilPct(row);
  if (pct === null || pct === undefined) {
    return <NotComputable why={compact ? null : row.utilisation_note}>Not recorded</NotComputable>;
  }
  const u = utilisationRead(row);
  const bar = u.key === 'over' ? 'bg-red-600' : u.key === 'low' ? 'bg-amber-500' : 'bg-emerald-600';
  return (
    <div className="min-w-[140px]" data-testid="utilisation-read">
      <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
        <span className="font-extrabold tabular-nums text-axal-ink dark:text-gray-100">
          <span aria-hidden="true">{u.icon} </span>{u.pct}% · {u.word}
        </span>
        {row.hours_used != null && row.retained_hours != null ? (
          <span className="text-[11px] text-axal-faint tabular-nums">{row.hours_used} of {row.retained_hours} h</span>
        ) : null}
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" aria-hidden="true">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, u.pct)}%` }} />
      </div>
    </div>
  );
}

/** The Health column: a shape and a word, never a colour alone. */
function HealthMark({ row }) {
  const h = healthOf(row);
  return (
    <Pill tone={h.tone} className="!text-[11px]">
      <span aria-hidden="true">{h.icon}</span> {h.word}
    </Pill>
  );
}

/** The monthly equivalent, or Not recorded with why. A quarterly row says how it was divided. */
function MonthlyCell({ row }) {
  const m = monthlyEquivalent(row);
  if (m.cents === null) {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <NotRecorded />
        {m.why ? <span className="text-[11px] text-axal-faint">{m.why}</span> : null}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col">
      <span className="font-mono font-bold tabular-nums">{moneyCents(m.cents)}/mo</span>
      {m.basis ? <span className="text-[11px] text-axal-faint">{m.basis}</span> : null}
    </span>
  );
}

function RenewalText({ row }) {
  const t = row.retainer;
  if (!t?.renews_at) return <Unrecorded>No renewal date</Unrecorded>;
  const days = t.days_to_renewal;
  return (
    <span>
      {formatDay(t.renews_at)}
      {days != null ? <span className="ml-1.5 text-axal-faint">({days < 0 ? `${-days} d ago` : days === 0 ? 'today' : `in ${days} d`})</span> : null}
    </span>
  );
}

/**
 * The attention band (PP06). Each item counts the rows its predicate selects,
 * and pressing it narrows the ledger to the same rows; pressing it again shows
 * every retainer. An item with nothing in it is not drawn, and a band with
 * nothing in it says so — with how many active retainers it could not measure.
 */
function AttentionBand({ sets, view, onView, unmeasured }) {
  const shown = BAND.filter((b) => sets[b.key].length);
  return (
    <div className="flex flex-col gap-2" data-testid="retainer-attention">
      <Eyebrow>Needs attention</Eyebrow>
      {shown.length ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Attention filters">
          {shown.map((b) => {
            const on = view === b.key;
            return (
              <button
                key={b.key} type="button" aria-pressed={on} data-band={b.key}
                onClick={() => onView(on ? 'all' : b.key)}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-[12.5px] font-semibold ${on
                  ? 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200'
                  : 'border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800'}`}
              >
                <span aria-hidden="true">{b.icon}</span>
                {b.label(sets[b.key].length)}
              </button>
            );
          })}
          {view !== 'all' ? (
            <button type="button" className={`${ghostButtonClass} min-h-[44px]`} onClick={() => onView('all')}>Show every retainer</button>
          ) : null}
        </div>
      ) : (
        <p className="text-[12.5px] text-axal-muted">
          No retainer is over its hours, renewing within 30 days or under {LOW_USE_PCT}% utilization.
        </p>
      )}
      {unmeasured ? (
        <p className="text-[11.5px] text-axal-faint">
          {unmeasured} active retainer{unmeasured === 1 ? ' has' : 's have'} no utilization recorded this period, so {unmeasured === 1 ? 'it is' : 'they are'} in neither utilization item.
        </p>
      ) : null}
    </div>
  );
}

/** Terms: the recorded retainer, or the form that records the first one. A draft survives a refresh. */
function RetainerForm({ row, onSave, onDelete, busy, note }) {
  const r = row.retainer;
  const stored = {
    shape: r?.shape || 'retainer',
    cadence: r?.cadence || 'monthly',
    amount: centsToInput(r?.amount_cents),
    hours: r?.retained_hours != null ? String(r.retained_hours) : '',
    renews: r?.renews_at || '',
    ended: r?.ended_at || '',
  };
  // NULL UNTIL SOMEONE TYPES. The form shows the stored values until then, and
  // what was typed after that — a background refresh changes `stored` and
  // never the draft. Only a save that the server accepted clears it.
  const [draft, setDraft] = useState(null);
  const [amountError, setAmountError] = useState('');
  const v = draft || stored;
  const set = (k) => (e) => setDraft({ ...(draft || stored), [k]: e.target.value });

  async function submit() {
    // Typed dollars become integer cents HERE and nowhere else — the worker
    // takes cents and rejects a fraction.
    const parsed = dollarsToCents(v.amount);
    if (parsed.error) { setAmountError(parsed.error); return; }
    setAmountError('');
    const saved = await onSave(row, {
      shape: v.shape,
      cadence: v.cadence,
      amount_cents: parsed.cents,
      retained_hours: v.hours.trim() === '' ? null : Number(v.hours),
      renews_at: v.renews.trim() || null,
      ended_at: v.ended.trim() || null,
    });
    if (saved === true) setDraft(null);
  }

  return (
    <div className="rounded-lg border border-axal-hairline bg-axal-ground p-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Shape" hint="An embedded seat is a person inside the client's systems, not a scope of work.">
          <select className={inputClass} value={v.shape} onChange={set('shape')}>
            {SHAPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Cadence" hint="A quarterly amount is shown as its monthly equivalent, divided by three.">
          <select className={inputClass} value={v.cadence} onChange={set('cadence')}>
            {CADENCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Amount per period" hint={amountError || 'Leave empty rather than typing 0 — an unpriced retainer is not a free one.'}>
          <input className={inputClass} value={v.amount} inputMode="decimal" placeholder="e.g. 8000" onChange={set('amount')} />
        </Field>
        <Field label="Retained hours" hint="Empty means this is not sold by the hour, so it has no utilization.">
          <input className={inputClass} value={v.hours} inputMode="decimal" placeholder="e.g. 40" onChange={set('hours')} />
        </Field>
        <Field label="Renews on" hint="YYYY-MM-DD">
          <input className={inputClass} value={v.renews} maxLength={40} placeholder="2026-12-01" onChange={set('renews')} />
        </Field>
        <Field label="Ended on" hint="Set this rather than deleting — an ended retainer is still what happened.">
          <input className={inputClass} value={v.ended} maxLength={40} placeholder="" onChange={set('ended')} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`${buttonClass} min-h-[44px]`} disabled={busy} onClick={submit}>
          {r ? 'Save retainer' : 'Record as a retainer'}
        </button>
        {draft ? (
          <button type="button" className={`${ghostButtonClass} min-h-[44px]`} disabled={busy} onClick={() => { setDraft(null); setAmountError(''); }}>
            Discard changes
          </button>
        ) : null}
        {r && (
          <button type="button" className={`${ghostButtonClass} ml-auto min-h-[44px] text-red-700 dark:text-red-300`}
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

/** Usage: this period's hours. The typed hours stay a draft until the log is accepted. */
function UsageForm({ row, onSave, onDelete, busy }) {
  const period = row.current_period || currentPeriod(row.retainer?.cadence || 'monthly');
  const logged = (row.usage || []).find((u) => u.period === period) || null;
  const stored = { hours: logged ? String(logged.hours_used) : '', note: logged?.note || '' };
  const [draft, setDraft] = useState(null);
  const v = draft || stored;
  const set = (k) => (e) => setDraft({ ...(draft || stored), [k]: e.target.value });

  async function log() {
    const saved = await onSave(row, period, { hours_used: Number(v.hours), note: v.note });
    if (saved === true) setDraft(null);
  }

  return (
    <div className="rounded-lg border border-axal-hairline p-3 dark:border-gray-700">
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Hours for {period}</div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Field label="Hours used">
          <input className={inputClass} value={v.hours} inputMode="decimal" placeholder="e.g. 31.5" onChange={set('hours')} />
        </Field>
        <Field label="Note" hint="Optional — what the period went on.">
          <input className={inputClass} value={v.note} maxLength={400} onChange={set('note')} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`${buttonClass} min-h-[44px]`} disabled={busy || v.hours.trim() === ''} onClick={log}>
          Log hours
        </button>
        {logged && (
          <button
            type="button" className={`${ghostButtonClass} min-h-[44px]`} disabled={busy}
            title="Removes the record for this period. Logging zero would claim they used none."
            onClick={() => onDelete(row, period)}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The retainer sheet: Summary, Usage, Terms and History, each only where
 * something is recorded behind it (`sheetTabs`). Every panel stays mounted and
 * the inactive ones are hidden, so a draft in Terms survives a look at Usage.
 *
 * #9110 (D9110): Open opportunity closes this sheet and opens the shared `OpportunitySheet` for the same
 * engagement, the read-across view of its lead, proposal and negotiation. This sheet stays the place to edit.
 */
function RetainerSheet({ row, tab, onTab, onClose, onOpenOpportunity, handlers, busy, note, backToStudio = false }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const opener = typeof document !== 'undefined' ? document.activeElement : null;
    closeRef.current?.focus?.();
    if (typeof document === 'undefined') return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, [onClose]);
  if (!row) return null;
  const tabs = sheetTabs(row);
  const current = tabs.includes(tab) ? tab : tabs[0];
  const id = `retainer-sheet-${row.engagement_id}`;
  const r = row.retainer;
  const m = monthlyEquivalent(row);
  const line = (label, value) => (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 border-t border-axal-hairline py-2.5 text-[13px] dark:border-gray-800">
      <span className="font-semibold text-axal-muted">{label}</span>
      <span className="min-w-0 text-axal-ink dark:text-gray-100">{value ?? <NotRecorded />}</span>
    </div>
  );
  const history = [...(row.usage || [])].sort((a, b) => String(b.period).localeCompare(String(a.period)));

  return (
    <div className="fixed inset-0 z-50" data-testid="retainer-sheet">
      <button type="button" aria-label="Close retainer" tabIndex={-1} className="absolute inset-0 h-full w-full cursor-default bg-black/30" onClick={onClose} />
      <aside
        role="dialog" aria-modal="true" aria-labelledby={`${id}-h`}
        className="absolute inset-y-0 right-0 flex w-full max-w-[620px] flex-col overflow-y-auto border-l border-axal-hairline bg-white shadow-xl dark:border-gray-800 dark:bg-gray-950"
      >
        <div className="border-b border-axal-hairline px-5 py-4 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <Eyebrow>Retainer</Eyebrow>
            <div className="flex items-center gap-1">
              {onOpenOpportunity && (
                <button type="button" onClick={() => onOpenOpportunity(row)} data-testid="retainer-open-opportunity" className={OPEN_OPPORTUNITY_CLASS}>
                  Open opportunity
                </button>
              )}
              <button ref={closeRef} type="button" onClick={onClose} aria-label="Close retainer"
                className="grid h-11 w-11 place-items-center rounded-lg text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800">✕</button>
            </div>
          </div>
          {backToStudio && <BackToFeedLink />}
          <h2 id={`${id}-h`} className="mt-1 text-[20px] font-extrabold text-axal-ink dark:text-gray-100">
            {clientName(row) || 'Client not recorded'}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-axal-muted">
            <span>{row.engagement_uid}</span>
            <HealthMark row={row} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Retainer">
            {tabs.map((t) => (
              <button
                key={t} type="button" role="tab" id={`${id}-tab-${t}`} aria-controls={`${id}-panel-${t}`}
                aria-selected={t === current}
                className={`min-h-[44px] rounded-[7px] border px-3 text-[12.5px] font-semibold ${t === current
                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                  : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'}`}
                onClick={() => onTab(t)}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-4">
          <div role="tabpanel" id={`${id}-panel-summary`} aria-labelledby={`${id}-tab-summary`} hidden={current !== 'summary'} data-testid="retainer-sheet-summary">
            {line('Client', clientName(row))}
            {row.need_title && row.founder_name ? line('Need', row.need_title) : null}
            {line('Engagement', [row.engagement_uid, row.engagement_status].filter(Boolean).join(' · ') || null)}
            {line('Shape', r ? (SHAPE_LABEL[r.shape] || r.shape) : 'Not a retainer')}
            {r ? line('Monthly equivalent', <MonthlyCell row={row} />) : null}
            {r ? line(`Utilization · ${row.current_period || 'this period'}`, <Utilisation row={row} />) : null}
            {r ? line('Renewal', <RenewalText row={row} />) : null}
            {line('Health', <HealthMark row={row} />)}
          </div>

          {tabs.includes('usage') ? (
            <div role="tabpanel" id={`${id}-panel-usage`} aria-labelledby={`${id}-tab-usage`} hidden={current !== 'usage'} data-testid="retainer-sheet-usage" className="flex flex-col gap-3">
              {line(`Utilization · ${row.current_period || 'this period'}`, <Utilisation row={row} />)}
              {line('Scope', scopeText(row))}
              <UsageForm row={row} onSave={handlers.onSaveUsage} onDelete={handlers.onDeleteUsage} busy={busy} />
              <SaveNote note={note?.scope === row.engagement_id && current === 'usage' ? note : null} />
              <p className="text-[12px] text-axal-muted">Hours are what somebody logged here. No timesheet, calendar or ticket system feeds them.</p>
            </div>
          ) : null}

          <div role="tabpanel" id={`${id}-panel-terms`} aria-labelledby={`${id}-tab-terms`} hidden={current !== 'terms'} data-testid="retainer-sheet-terms" className="flex flex-col gap-3">
            {r ? (
              <div>
                {line('Amount', r.amount_cents != null ? `${moneyCents(r.amount_cents)} ${CADENCE_PER[r.cadence] || 'per period'}` : null)}
                {line('Monthly equivalent', m.cents == null ? null : `${moneyCents(m.cents)}/mo${m.basis ? ` · ${m.basis}` : ''}`)}
                {line('Retained hours', scopeText(row))}
                {line('Renews', r.renews_at ? formatDay(r.renews_at) : null)}
                {line('Ended', r.ended_at ? formatDay(r.ended_at) : 'Running')}
              </div>
            ) : (
              <p className="text-[13px] text-axal-muted">This engagement is not recorded as a retainer. Record its terms below.</p>
            )}
            <RetainerForm row={row} onSave={handlers.onSaveRetainer} onDelete={handlers.onDeleteRetainer} busy={busy} note={current === 'terms' ? note : null} />
          </div>

          {tabs.includes('history') ? (
            <div role="tabpanel" id={`${id}-panel-history`} aria-labelledby={`${id}-tab-history`} hidden={current !== 'history'} data-testid="retainer-sheet-history" className="flex flex-col gap-2">
              <ul className="space-y-2">
                {r?.ended_at ? (
                  <li className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 text-[13px]">
                    <span className="text-axal-muted">{formatDay(r.ended_at)}</span>
                    <span>Retainer ended</span>
                  </li>
                ) : null}
                {history.map((u) => (
                  <li key={u.period} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 text-[13px]">
                    <span className="text-axal-muted">{u.period}</span>
                    <span>{u.hours_used} h logged{u.note ? ` · ${u.note}` : ''}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-axal-muted">
                What this retainer’s record holds: each logged period and the end date. A change to the terms is not
                kept with a date, so it is not listed.
              </p>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

export default function PartnerRetainersZone() {
  const { state, load, run, busy, note } = usePipelineZone(
    () => readAllPages((cur) => api.listPartnerRetainers(cur)), 'The retainer record did not load.',
  );
  const [view, setView] = useState('all');
  // The sheet holds an ENGAGEMENT ID, never a row object, and the row is looked
  // up on every render — so a refresh hands it the fresh row and keeps it open.
  const [sheet, setSheet] = useState(null);
  const openSheet = (engagementId, tab = 'summary') => setSheet({ id: engagementId, tab });
  // D8733 (#8733, SOP06 C): `?engagement=<uid>` opens that engagement's sheet, as Board does, so the Studio feed's
  // renewal alert lands on its retainer. Closing the sheet clears the parameter with it.
  const focus = useEngagementFocus();
  const [params] = useSearchParams();
  const fromStudio = params.get('from') === 'studio';
  const { key: focusKey, clear: clearFocus } = focus;
  const closeSheet = useCallback(() => { setSheet(null); if (focusKey) clearFocus(); }, [focusKey, clearFocus]);
  // #9110: the shared opportunity sheet, opened from a retainer's sheet. It closes that sheet the way × does (the
  // `?engagement=` focus goes with it), so only one sheet is open, and closing it returns focus to the row.
  const [opportunity, setOpportunity] = useState(null);
  const openOpportunity = useCallback((r) => {
    closeSheet();
    setOpportunity({ engagementId: r.engagement_id, title: clientName(r) || undefined });
  }, [closeSheet]);

  const d = state.data;
  const items = Array.isArray(d?.items) ? d.items : [];
  const retainerCount = d?.retainer_count ?? 0;
  // ONE SET PER BAND ITEM, from the command centre's own predicates.
  const sets = useMemo(() => attentionSets(items), [items]);
  const strip = useMemo(() => retainerStrip(d, items), [d, items]);
  const unmeasured = useMemo(
    () => items.filter((r) => retainerActive(r) && retainerUtilPct(r) === null).length,
    [items],
  );
  // THE LEDGER IS THE BAND ITEM'S ROWS, EXACTLY: the same array the item
  // counted. The keys are the toolbar chips' keys too, so either control
  // narrows to the same rows.
  const visible = useMemo(() => {
    if (view === 'over' || view === 'renewing' || view === 'under') return sets[view];
    return retainerRows(items);
  }, [view, sets, items]);
  const unretained = useMemo(() => items.filter((r) => !r.retainer), [items]);
  const focusRow = focusKey ? items.find((r) => matchesFocus(r, focusKey)) || null : null;
  const sheetRow = sheet ? (items.find((r) => r.engagement_id === sheet?.id) || null) : focusRow;
  // SOP08: an engagement the read does not hold opens nothing, and says so; the retainer list stays as it is.
  const focusMissing = Boolean(focusKey && !focusRow && !state.loading && !state.error && d);

  const handlers = {
    onSaveRetainer: (r, patch) => run(
      () => api.savePartnerRetainer(r.engagement_id, patch),
      'Saved.', r.engagement_id,
    ),
    onDeleteRetainer: (r) => run(
      () => api.deletePartnerRetainer(r.engagement_id),
      'Retainer record removed.', r.engagement_id,
    ),
    onSaveUsage: (r, period, patch) => run(
      () => api.savePartnerRetainerUsage(r.engagement_id, period, patch),
      'Hours logged.', r.engagement_id,
    ),
    onDeleteUsage: (r, period) => run(
      () => api.deletePartnerRetainerUsage(r.engagement_id, period),
      'Period cleared.', r.engagement_id,
    ),
  };

  // `utilisation_pct` is TOP-LEVEL on the row, spread there by `utilisationFor()`.
  const rowActions = partnerZoneActions('pipeline/retainers', { view: {
        header: ['Client', 'Engagement', 'Amount (cents)', 'Cadence', 'Monthly equivalent (cents)', 'Retained hours', 'Used', 'Utilisation %', 'Renews'],
        rows: visible,
        cells: (r) => [r.founder_name, r.need_title, r.retainer?.amount_cents, r.retainer?.cadence,
          monthlyEquivalent(r).cents, r.retained_hours, r.hours_used, r.utilisation_pct, r.retainer?.renews_at],
      } });

  // The gate: the read still 400s, so `isEmpty` is forced and `error` cleared,
  // and the zone draws in its own empty state under the notice.
  const unlinked = isNoPartnerProfile(state.error);

  return (
    <>
      {/* ACTIONS YES, FILTERS NO, when the account cannot read the store. The
          toolbar's chips and the attention band drive ONE view, so either
          narrows the ledger to the same rows. */}
      <ZoneToolbar
        className="mb-3"
        role="partner"
        filters={unlinked ? [] : partnerZoneFilters('pipeline/retainers', { value: view, onChange: setView })}
        actions={rowActions}
      />
    <ZoneBody
        what="Retainers"
      loading={state.loading}
      error={unlinked ? null : state.error}
      onRetry={load}
      notice={<>{unlinked ? <NoPartnerProfile /> : null}<PipelineReadStatus state={state} onRetry={load} /></>}
      isEmpty={unlinked || (items.length === 0)}
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
        {focusMissing && (
          <NotFoundNotice name={feedItemName('engagement', focusKey)} where="retainer list" onShowAll={clearFocus} showAllLabel="Show all retainers" />
        )}
        <PartialRead data={state.data} noun="engagements" onRetry={load} />
        <ZoneHeading
          title="Retainers"
          blurb={
            'Recurring revenue, usage against scope, and renewal risk. '
            + 'Utilization is the point: a client using a third of retained hours '
            + 'is a churn risk no complaint has surfaced yet, and one over a '
            + 'hundred per cent is unbilled work.'
          }
        />

        {retainerCount ? <AttentionBand sets={sets} view={view} onView={setView} unmeasured={unmeasured} /> : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {strip.map((t) => <RetainerTile key={t.label} t={t} />)}
        </div>
        {d?.mrr_basis ? <p className="text-[12px] leading-relaxed text-axal-muted">{d.mrr_basis}</p> : null}

        {retainerCount ? (
          <section className="rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900" data-testid="retainer-ledger">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3">
              <h3 className="text-sm font-extrabold tracking-tight text-axal-ink dark:text-gray-100">Ledger</h3>
              <span className="text-[11px] text-gray-600 dark:text-gray-400">
                {view === 'all' ? `${visible.length} retainer${visible.length === 1 ? '' : 's'}` : `${visible.length} shown · ${BAND.find((b) => b.key === view)?.label(visible.length)}`}
              </span>
            </div>

            {/* DESKTOP: the board's table. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="mt-2 w-full min-w-[760px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-axal-hairline text-[10px] uppercase tracking-[.07em] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    {['Client', 'Monthly equivalent', 'Scope', 'Utilization · this period', 'Renewal', 'Health'].map((h) => (
                      <th key={h} scope="col" className="px-4 py-2 font-extrabold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.engagement_id} data-row={r.engagement_id} className="border-b border-axal-hairline last:border-0 dark:border-gray-800">
                      <td className="px-4 py-2.5">
                        <button type="button" className="min-h-[44px] text-left font-bold text-axal-ink underline-offset-2 hover:underline dark:text-gray-100" onClick={() => openSheet(r.engagement_id)}>
                          {clientName(r) || 'Client not recorded'}
                        </button>
                      </td>
                      <td className="px-4 py-2.5"><MonthlyCell row={r} /></td>
                      <td className="px-4 py-2.5">{scopeText(r)}</td>
                      <td className="px-4 py-2.5 max-w-[260px]"><Utilisation row={r} /></td>
                      <td className="px-4 py-2.5"><RenewalText row={r} /></td>
                      <td className="px-4 py-2.5"><HealthMark row={r} /></td>
                    </tr>
                  ))}
                </tbody>
                {view === 'all' ? (
                  <tfoot>
                    <tr className="border-t-2 border-axal-hairline font-semibold dark:border-gray-700">
                      <td className="px-4 py-2.5">Total · active</td>
                      <td className="px-4 py-2.5">{d?.mrr_cents != null ? moneyCents(d.mrr_cents) : <NotRecorded />}{d?.mrr_cents != null ? '/mo' : null}</td>
                      <td className="px-4 py-2.5" colSpan={4} />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>

            {/* PHONE (PP06m): one card per retainer, leading with utilization,
                renewal, the monthly equivalent and health. */}
            <ul className="flex flex-col gap-2 p-3 md:hidden" data-testid="retainer-cards">
              {visible.map((r) => {
                const m = monthlyEquivalent(r);
                return (
                  <li key={r.engagement_id} data-card={r.engagement_id} className="rounded-xl border border-axal-hairline p-3 dark:border-gray-700">
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" className="min-h-[44px] text-left text-[14px] font-extrabold text-axal-ink dark:text-gray-100" onClick={() => openSheet(r.engagement_id)}>
                        {clientName(r) || 'Client not recorded'}
                      </button>
                      <HealthMark row={r} />
                    </div>
                    <div className="mt-1"><Utilisation row={r} compact /></div>
                    <div className="mt-1.5 text-[12px] text-axal-muted">
                      {m.cents != null ? `${moneyCents(m.cents)} / mo equivalent` : `Monthly equivalent not recorded · ${m.why}`}
                      {' · '}
                      {r.retainer?.renews_at ? `renews ${formatDay(r.retainer.renews_at)}` : 'no renewal date'}
                    </div>
                  </li>
                );
              })}
            </ul>

            <p className="border-t border-axal-hairline px-4 py-3 text-[11px] leading-relaxed text-gray-600 dark:border-gray-700 dark:text-gray-400">
              A quarterly amount is shown as its monthly equivalent, divided by three. Utilization not yet logged this period
              reads Not recorded, and a retainer sold as a fee rather than by the hour has none at all: a fee-based deal is a
              different shape, not a badly consumed one, so it is in neither utilization item.
            </p>
          </section>
        ) : null}

        <ZoneDraft
          surface="pipeline/retainers"
          railOption="draft:renewal-risk"
          label="Proposal · renewal risk"
          accept="Draft the conversation"
          run="Read the book"
          foot="Utilisation read from the retainer record."
          empty="For the retainer renewing soonest at the lowest consumption: a right-sizing conversation that opens with what the client has not used rather than what they owe — because a renewal notice at the current figure invites them to do the arithmetic themselves."
          nothingToDraft="No retainer is recorded, so there is no renewal to read."
        />

        {unretained.length ? (
          <Section title="Engagements not on a retainer">
            <ul className="flex flex-col gap-2" data-testid="unretained">
              {unretained.map((r) => (
                <li key={r.engagement_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-axal-hairline p-3 dark:border-gray-700">
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold tracking-tight">{clientName(r) || <Unrecorded>Unnamed client</Unrecorded>}</div>
                    <div className="text-[11.5px] text-axal-faint">{[r.engagement_uid, r.engagement_status].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button type="button" className={`${ghostButtonClass} min-h-[44px]`} onClick={() => openSheet(r.engagement_id, 'terms')}>
                    Record as a retainer
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <StatedLimit title="What this zone does not claim">
          <p>
            <strong>Utilization is never 0% by absence.</strong> A retainer sold without
            retained hours has no utilization at all, and a period with nothing logged has
            one nobody has recorded. Both read Not recorded with the reason beside them and
            are in neither utilization item. A period logged at zero hours is a recorded 0%,
            and that is low use.
          </p>
          <p className="mt-2">
            <strong>Recurring revenue counts only what is priced.</strong> A retainer with no
            amount is left out rather than summed as zero, and the figure states how many
            rows are in it. Quarterly amounts are divided by three; nothing is annualised,
            because a renewal date is not a commitment to renew.
          </p>
          <p className="mt-2">
            <strong>The attention band is the Pipeline root’s.</strong> Over-serviced is above
            100% of retained hours, renewing is a recorded renewal within 30 days, and low use is
            below {LOW_USE_PCT}% — the same rules Needs attention uses, so the two pages name the
            same retainers. An ended retainer is in none of them.
          </p>
          <p className="mt-2">
            <strong>Consumption is what somebody logged here.</strong> No timesheet, calendar
            or ticket system feeds these hours, so a period that reads light may be one nobody
            has filled in. That is why an unlogged period is Not recorded rather than low.
          </p>
        </StatedLimit>
      </div>
    </ZoneBody>
    {sheetRow ? (
      <RetainerSheet
        row={sheetRow} tab={sheet?.tab} onTab={(t) => setSheet((s) => (s ? { ...s, tab: t } : { id: sheetRow.engagement_id, tab: t }))}
        onClose={closeSheet} onOpenOpportunity={openOpportunity} handlers={handlers} busy={busy} note={note} backToStudio={fromStudio}
      />
    ) : null}
    {opportunity ? (
      <OpportunitySheet
        opportunity={{ engagementId: opportunity?.engagementId }} title={opportunity?.title}
        onClose={() => setOpportunity(null)}
      />
    ) : null}
    </>
  );
}
