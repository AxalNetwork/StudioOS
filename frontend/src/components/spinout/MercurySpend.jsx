// D752 §4 (#1988): "Spending from Mercury" on the revenue page. The founder's
// own months, net burn, cash and runway, read from their own connection by
// GET /api/revenue/projects/:id/mercury-spend while the sheet is open, and
// shown only to them. The last full month's net burn (and cash, only when the
// box is ticked) goes into Grow's figures only after the founder confirms the
// Worker's visibility sentence; the Worker refuses the save without it.
//
// `MercurySourceBadge` marks a saved Mercury row on the revenue log and on
// MetricsPage: locked by the Worker (`mercury_figure_locked`), so the row
// offers delete only. Built from the existing parts; the "Mercury · Members"
// canvas pass lays it out later. Nothing here sends, transfers or requests money.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Lock, X } from 'lucide-react';
import { mercuryPersonalApi } from '../../lib/api/mercuryPersonal';
import { reportError } from '../../lib/log';
import { BrandIcon, Unreadable, Unrecorded } from '../../ui';
import {
  CONFIRM_LABEL, FINANCING_NOTE, INCLUDE_CASH_LABEL, LOCKED_BADGE, LOCKED_TITLE, NO_LINES, SAVE_START, SHOWN_ONLY_TO_YOU,
  SPEND_MONTHS_DEFAULT, SPEND_MONTH_CHOICES, cashTile, monthLabel, runwayTile, saveRefusal, savedLine, snapshotRequest,
  spendMonthRows, spendReadOutcome, unreadableLine,
} from '../../lib/mercurySpend';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const PILL_ON = 'border-teal-500 bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300';
const PILL_OFF = 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400';
const notRecorded = (reason) => <Unrecorded reason={reason}>Not recorded</Unrecorded>;

/** A saved row read from Mercury: its figures are locked, so the row offers delete only. */
export function MercurySourceBadge() {
  return (
    <span title={LOCKED_TITLE} data-testid="badge-from-mercury"
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
      <Lock size={9} aria-hidden="true" /> {LOCKED_BADGE}
    </span>
  );
}

function Tile({ label, value, reason, sub, testid }) {
  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-3" data-testid={testid}>
      <div className={LBL}>{label}</div>
      <div className="text-[16px] font-extrabold tabular-nums text-gray-900 dark:text-gray-50 mt-0.5">{value ?? notRecorded(reason)}</div>
      {value == null && reason && <div className="text-[10.5px] text-gray-500 dark:text-gray-400">{reason}</div>}
      {sub && <div className="text-[10.5px] text-gray-400 dark:text-gray-500">{sub}</div>}
    </div>
  );
}

/** The save: the Worker's visibility sentence, cash off by default, and nothing sent until it is confirmed. */
export function SpendSaveView({ month, visibility, form, busy, err, result, on }) {
  const ready = snapshotRequest(form) !== null;
  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-3 space-y-2" data-testid="spend-save">
      <div className="text-[12.5px] font-bold text-gray-900 dark:text-gray-50">Save {monthLabel(month)}'s net burn to Grow</div>
      <p className="text-[11.5px] text-gray-600 dark:text-gray-300" data-testid="spend-visibility">{visibility}</p>
      <label className="flex items-start gap-2 text-[11.5px] text-gray-700 dark:text-gray-200">
        <input type="checkbox" checked={form.includeCash === true} onChange={(ev) => on.form({ includeCash: ev.target.checked })} data-testid="spend-include-cash" className="mt-0.5" />
        <span>{INCLUDE_CASH_LABEL}</span>
      </label>
      <label className="flex items-start gap-2 text-[11.5px] text-gray-700 dark:text-gray-200">
        <input type="checkbox" checked={form.confirmed === true} onChange={(ev) => on.form({ confirmed: ev.target.checked })} data-testid="spend-confirm" className="mt-0.5" />
        <span>{CONFIRM_LABEL}</span>
      </label>
      {err && <p className="text-[11.5px] text-rose-600 dark:text-rose-400" role="alert" data-testid="spend-save-error">{err}</p>}
      {result && <p className="text-[11.5px] text-emerald-700 dark:text-emerald-300" data-testid="spend-saved">{savedLine(result)}</p>}
      <button type="button" onClick={on.save} disabled={!ready || busy} data-testid="spend-save-button"
        className="w-full text-[12.5px] font-bold text-white bg-teal-600 rounded-lg py-2 disabled:opacity-50">
        {busy ? 'Saving…' : ready ? 'Save to Grow' : 'Confirm who will see it first'}
      </button>
    </div>
  );
}

/** The sheet's body for one state; pure, so the states render in node --test. */
export function MercurySpendView({ state, on }) {
  const { read, months, form, busy, err, result } = state;
  const picker = (
    <div className="flex gap-1.5" data-testid="spend-months">
      {SPEND_MONTH_CHOICES.map((n) => (
        <button key={n} type="button" onClick={() => on.months(n)} className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${months === n ? PILL_ON : PILL_OFF}`}>{n} months</button>
      ))}
    </div>
  );
  if (read.status === 'loading') {
    return <div className="py-6 text-center" data-testid="spend-loading"><Loader2 size={16} className="animate-spin text-gray-400 inline" /></div>;
  }
  if (read.status === 'failed') {
    const out = read.outcome;
    if (out.kind === 'not_recorded') {
      return (
        <div className="space-y-2 text-[12px]" data-testid="spend-not-recorded">
          {notRecorded(out.reason)}
          <p className="text-gray-500 dark:text-gray-400">{out.reason} <Link to="/account/connectors" className="font-semibold text-teal-700 dark:text-teal-300">Open Connectors</Link></p>
        </div>
      );
    }
    if (out.kind === 'refused') return <p className="text-[12px] text-amber-700 dark:text-amber-300" role="alert" data-testid="spend-refused">{out.reason}</p>;
    return <div data-testid="spend-unreadable"><Unreadable what="Your Mercury spending" claim="This is not a claim that you spent nothing." onRetry={on.retry} /></div>;
  }
  const res = read.data;
  const rows = spendMonthRows(res);
  const cash = cashTile(res);
  const runway = runwayTile(res);
  const unread = unreadableLine(res);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={LBL} data-testid="spend-window">{res.window?.from || '—'} to {res.window?.to || '—'}</div>
        {picker}
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400" data-testid="spend-only-you">{SHOWN_ONLY_TO_YOU}</p>
      {runway.kind === 'partial' && <p className="text-[11.5px] text-amber-700 dark:text-amber-300" role="status" data-testid="spend-partial">{runway.reason}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Cash now" value={cash.value} reason={cash.reason} sub={cash.sub} testid="spend-cash" />
        {runway.kind === 'partial'
          ? <Tile label="Runway" value={null} reason="Not shown on a partial read." testid="spend-runway" />
          : <Tile label="Runway" value={runway.value} reason={runway.reason} sub={runway.sub} testid="spend-runway" />}
      </div>
      <ul className="space-y-2 max-h-[45vh] overflow-y-auto" data-testid="spend-month-list">
        {rows.map((r) => (
          <li key={r.month} className="rounded-lg border border-gray-100 dark:border-gray-800 p-2.5 text-[12px]" data-testid={`spend-month-${r.month}`}>
            <div className="font-semibold text-gray-900 dark:text-gray-50 mb-1">{r.label}</div>
            {r.noLines ? (
              <div className="text-gray-500 dark:text-gray-400">{notRecorded(NO_LINES)} <span className="text-[10.5px]">{NO_LINES}</span></div>
            ) : (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
                <dt className="text-gray-500 dark:text-gray-400">Operating in</dt><dd className="text-right">{r.operatingIn ?? notRecorded('Mercury gave no whole-cent figure.')}</dd>
                <dt className="text-gray-500 dark:text-gray-400">Financing in <span className="text-[10px]">({FINANCING_NOTE})</span></dt><dd className="text-right">{r.financingIn ?? notRecorded('Mercury gave no whole-cent figure.')}</dd>
                <dt className="text-gray-500 dark:text-gray-400">Out</dt><dd className="text-right">{r.out ?? notRecorded('Mercury gave no whole-cent figure.')}</dd>
                <dt className="font-semibold text-gray-700 dark:text-gray-200">Net burn</dt><dd className="text-right font-bold">{r.netBurn ?? notRecorded('Mercury gave no whole-cent figure.')}</dd>
              </dl>
            )}
            {r.payees.length > 0 && (
              <div className="mt-1.5">
                <div className={LBL}>Top payees</div>
                <ul className="text-[11px] text-gray-600 dark:text-gray-300">
                  {r.payees.map((p, i) => (
                    <li key={`${p.name}-${i}`} className="flex justify-between gap-2">
                      <span className="truncate">{p.name || 'No counterparty given'}</span>
                      <span className="tabular-nums">{p.out ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.skipped && <div className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-1">{r.skipped}</div>}
          </li>
        ))}
      </ul>
      {unread && <p className="text-[10.5px] text-amber-600 dark:text-amber-400" data-testid="spend-unread-lines">{unread}</p>}
      <SpendSaveView month={res.save?.month || res.last_full_month} visibility={res.save?.visibility} form={form} busy={busy} err={err} result={result} on={on} />
    </div>
  );
}

/** The sheet: reads while it is open, and saves only through `snapshotRequest`. */
export function MercurySpendSheet({ projectId, onSaved, onClose, api = mercuryPersonalApi }) {
  const [months, setMonths] = useState(SPEND_MONTHS_DEFAULT);
  const [read, setRead] = useState({ status: 'loading' });
  const [form, setForm] = useState(SAVE_START);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    setRead({ status: 'loading' });
    try {
      const res = await api.spend(projectId, months);
      if (!Array.isArray(res?.months)) throw new Error('The Mercury spending response could not be read.');
      setRead({ status: 'ok', data: res });
    } catch (e) {
      reportError('spinout-revenue:mercury-spend-read', e);
      setRead({ status: 'failed', outcome: spendReadOutcome(e) });
    }
  }, [api, projectId, months]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const body = snapshotRequest(form);
    if (!body || busy) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      const res = await api.saveSpendSnapshot(projectId, body);
      setResult(res);
      setForm(SAVE_START);
      await onSaved?.();
    } catch (e) {
      reportError('spinout-revenue:mercury-spend-save', e);
      setErr(saveRefusal(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true"
      onClick={() => !busy && onClose?.()} data-testid="modal-mercury-spend">
      <div className={`${CARD} w-full max-w-lg`} onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BrandIcon provider="mercury" name="Mercury" size={24} />
            <div className="text-[14px] font-bold text-gray-900 dark:text-gray-50">Spending from Mercury</div>
          </div>
          <button type="button" onClick={() => !busy && onClose?.()} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={16} /></button>
        </div>
        <MercurySpendView
          state={{ read, months, form, busy, err, result }}
          on={{ months: setMonths, retry: load, form: (patch) => setForm((f) => ({ ...f, ...patch })), save }}
        />
      </div>
    </div>
  );
}

/** The source card beside Stripe's; drawn for the startup's founder only. */
export default function MercurySpendCard({ projectId, onSaved }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`${CARD} !p-4`} data-testid="source-mercury">
      <div className="mb-1"><BrandIcon provider="mercury" name="Mercury" size={24} /></div>
      <div className="text-[13px] font-bold text-gray-900 dark:text-gray-50">Mercury</div>
      <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-2.5">
        Spending, burn, cash and runway from your own Mercury. {SHOWN_ONLY_TO_YOU}
      </p>
      <button type="button" onClick={() => setOpen(true)} data-testid="button-open-mercury-spend"
        className="text-[11.5px] font-bold text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 rounded-lg px-3 py-1.5 hover:bg-teal-50 dark:hover:bg-teal-900/30">
        Spending from Mercury
      </button>
      {open && <MercurySpendSheet projectId={projectId} onSaved={onSaved} onClose={() => setOpen(false)} />}
    </div>
  );
}
