import React, { useState } from 'react';
import { Unreadable } from '../../ui';
import { researchBenchmarkFundsApi } from '../../lib/api/researchBenchmarkFunds';
import { FUND_METRICS, fundChoice, typedOurs } from './oursFromFundRead.js';

/**
 * D6278 (#6278) — "Use our figure from…" under a benchmark's "Ours" (canvas
 * RS-14). It offers only the funds the reader can open, with the figure fund
 * performance records for each; a figure that is not recorded says why and
 * cannot be used. A figure typed on the row is replaced only after the writer
 * confirms. The parent's `onUse` is its own write runner, so the record gate
 * and the busy state stay the page's.
 */

const selectClass = 'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] text-axal-ink '
  + 'focus:border-indigo-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const linkBtn = 'text-[12px] font-semibold text-indigo-700 underline disabled:opacity-50 dark:text-indigo-300';
const primaryBtn = 'min-h-[44px] rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 '
  + 'disabled:cursor-not-allowed disabled:bg-indigo-200 disabled:text-indigo-800 sm:min-h-0';
const keepBtn = 'min-h-[44px] rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold text-axal-ink '
  + 'hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-900 sm:min-h-0';

export default function OursFromFund({ item, busy, onUse }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState('idle'); // idle | loading | ready | unreadable
  const [figures, setFigures] = useState([]);
  const [fundId, setFundId] = useState('');
  const [metric, setMetric] = useState('tvpi');
  const [confirming, setConfirming] = useState(false);

  const load = async () => {
    setState('loading');
    try {
      const d = await researchBenchmarkFundsApi.figures();
      const items = d?.items || [];
      setFigures(items);
      setFundId((prev) => prev || (items[0] ? String(items[0].fund_id) : ''));
      setState('ready');
    } catch {
      setState('unreadable');
    }
  };
  const start = () => { setOpen(true); setConfirming(false); if (state !== 'ready') load(); };
  const choice = fundChoice(figures, fundId, metric);
  const typed = typedOurs(item);

  const use = async (replace) => {
    const ok = await onUse({ fund_id: Number(fundId), metric, replace });
    if (ok) { setOpen(false); setConfirming(false); }
  };

  if (!open) {
    return (
      <button type="button" className={`${linkBtn} mt-2`} disabled={busy !== ''} onClick={start}>
        Use our figure from a fund…
      </button>
    );
  }
  return (
    <div data-testid="benchmark-ours-from-fund" className="mt-3 rounded-xl border border-axal-hairline p-3 dark:border-gray-800">
      <div className="text-[11px] font-semibold text-axal-muted">Use our figure from a fund</div>
      {state === 'loading' && <p className="mt-2 text-[12px] text-axal-muted">Reading the funds you can open.</p>}
      {state === 'unreadable' && (
        <div className="mt-2"><Unreadable what="Fund figures" claim="No figure is offered rather than one the record may not hold." onRetry={load} /></div>
      )}
      {state === 'ready' && figures.length === 0 && (
        <p className="mt-2 text-[12px] text-axal-muted">
          You cannot open any fund’s performance, so there is no recorded figure to use. Ours stays as entered on this row.
        </p>
      )}
      {state === 'ready' && figures.length > 0 && (
        <>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-[11px] font-semibold text-axal-muted">
              Fund
              <select aria-label="Fund" className={selectClass} value={fundId}
                onChange={(e) => { setFundId(e.target.value); setConfirming(false); }}>
                {figures.map((f) => <option key={f.fund_id} value={String(f.fund_id)}>{f.name}</option>)}
              </select>
            </label>
            <label className="block text-[11px] font-semibold text-axal-muted">
              Figure
              <select aria-label="Figure" className={selectClass} value={metric}
                onChange={(e) => { setMetric(e.target.value); setConfirming(false); }}>
                {FUND_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
          </div>
          {choice && (choice.recorded ? (
            <p className="mt-2 text-[12px] text-axal-ink dark:text-gray-100">
              <span className="font-mono font-bold">{choice.display}</span>
              <span className="ml-1 text-axal-muted">{`recorded as of ${choice.as_of}`}</span>
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-amber-800 dark:text-amber-300">{choice.text}</p>
          ))}
          {confirming && choice?.recorded && (
            <p className="mt-2 text-[12px] text-axal-ink dark:text-gray-100">
              {`This replaces the figure you typed (${item.our_value}) with ${choice.fund.name}’s recorded ${metric.toUpperCase()} of ${choice.display}.`}
            </p>
          )}
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {state === 'ready' && figures.length > 0 && (
          confirming ? (
            <button type="button" className={primaryBtn} disabled={busy !== '' || !choice?.recorded} onClick={() => use(true)}>
              Replace my figure
            </button>
          ) : (
            <button type="button" className={primaryBtn} disabled={busy !== '' || !choice?.recorded}
              onClick={() => (typed ? setConfirming(true) : use(false))}>
              {choice?.recorded ? `Use ${choice.display}` : 'Use this figure'}
            </button>
          )
        )}
        <button type="button" className={keepBtn} disabled={busy === 'fund'}
          onClick={() => { setOpen(false); setConfirming(false); }}>
          {confirming ? 'Keep mine' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
