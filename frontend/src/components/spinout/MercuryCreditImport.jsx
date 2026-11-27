// D713 (#1778, F28): "Import from Mercury" on the revenue ledger. The founder's
// own Mercury credits, read from their own connection by
// GET /api/revenue/projects/:id/mercury-credits, each with a checkbox when it
// can be imported and the Worker's reason when it cannot. A picked credit gets
// the customer label and type the founder gives it; the amount and date are
// Mercury's, re-read by the Worker on import, never sent from here.
//
// Drawn inside the ledger's own modal with its parts; the canvas PR lays it
// out to board F28. D752 (#1989): a matched raise receipt's line shows the
// `raise_receipt` reason, and a credit that fits a raise commitment says "This
// may be an investment" without blocking it. Nothing here sends, transfers or
// requests money.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { mercuryPersonalApi } from '../../lib/api/mercuryPersonal';
import { reportError } from '../../lib/log';
import { Unreadable, Unrecorded } from '../../ui';
import {
  FITS_RAISE_TARGET, FITS_RAISE_TARGET_NOTE, LEDGER_TYPES, fmtLedgerCents, mercuryCreditReason, mercuryImportItems, mercuryImportLine, mercuryImportReady, mercuryReadOutcome,
} from '../../lib/revenueLedger';

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const INPUT = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-[13px] text-gray-900 dark:text-gray-100';
const PILL_ON = 'border-teal-500 bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300';
const PILL_OFF = 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400';

/** The panel's body for one state; pure, so the states render in node --test. */
export function MercuryCreditImportView({ state, on }) {
  const { read, picks, busy, err, result } = state;
  if (read.status === 'loading') {
    return <div className="py-6 text-center" data-testid="mercury-import-loading"><Loader2 size={16} className="animate-spin text-gray-400 inline" /></div>;
  }
  if (read.status === 'failed') {
    const out = read.outcome;
    if (out.kind === 'not_recorded') {
      return (
        <div className="space-y-2 text-[12px]" data-testid="mercury-import-not-recorded">
          <Unrecorded reason={out.reason}>Not recorded</Unrecorded>
          <p className="text-gray-500 dark:text-gray-400">{out.reason} <Link to="/account/connectors/mercury" className="font-semibold text-teal-700 dark:text-teal-300">Open Connectors</Link></p>
        </div>
      );
    }
    if (out.kind === 'refused') return <p className="text-[12px] text-amber-700 dark:text-amber-300" role="alert" data-testid="mercury-import-refused">{out.reason}</p>;
    return <div data-testid="mercury-import-unreadable"><Unreadable what="Your Mercury credits" claim="This is not a claim that there are none." onRetry={on.retry} /></div>;
  }
  const { credits, window, capped } = read.data;
  const items = mercuryImportItems(credits, picks);
  const ready = mercuryImportReady(items);
  return (
    <div className="space-y-3">
      <div className={LBL} data-testid="mercury-import-window">
        Credits · {window?.from || '—'} to {window?.to || '—'} · {credits.length} found
      </div>
      {credits.length === 0 ? (
        <p className="text-[12px] text-gray-500 dark:text-gray-400 py-4 text-center" data-testid="mercury-import-empty">
          Your Mercury account has no credits in this window.
        </p>
      ) : (
        <ul className="space-y-2 max-h-[50vh] overflow-y-auto" data-testid="mercury-import-list">
          {credits.map((c) => {
            const pick = picks[c.transaction_id] || {};
            return (
              <li key={c.transaction_id} className="rounded-lg border border-gray-100 dark:border-gray-800 p-2.5 text-[12px]" data-testid={`mercury-credit-${c.transaction_id}`}>
                <label className="flex items-start gap-2">
                  {c.importable
                    ? <input type="checkbox" checked={!!pick.on} onChange={(ev) => on.pick(c.transaction_id, { on: ev.target.checked })} data-testid={`mercury-pick-${c.transaction_id}`} className="mt-0.5" />
                    : <span className="w-[13px]" />}
                  <span className="flex-1 min-w-0">
                    <span className="flex justify-between gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-50 truncate">{c.counterparty_name || <Unrecorded reason="Mercury gave no counterparty for this line.">Not recorded</Unrecorded>}</span>
                      <span className="font-mono font-bold tabular-nums">{fmtLedgerCents(c.amount_cents) ?? <Unrecorded reason="The amount is not a whole number of cents.">Not recorded</Unrecorded>}</span>
                    </span>
                    <span className="block text-[10.5px] text-gray-400 font-mono">{c.posted_on || 'Not recorded'} · ••{c.last_four || '—'}</span>
                    {!c.importable && <span className="block text-[10.5px] text-amber-700 dark:text-amber-300" data-testid={`mercury-reason-${c.transaction_id}`}>{mercuryCreditReason(c.reason)}</span>}
                    {c.fits_raise_target === true && (
                      <span className="block text-[10.5px] text-violet-700 dark:text-violet-300" title={FITS_RAISE_TARGET_NOTE} data-testid={`mercury-raise-hint-${c.transaction_id}`}>
                        {FITS_RAISE_TARGET}. {FITS_RAISE_TARGET_NOTE}
                      </span>
                    )}
                  </span>
                </label>
                {c.importable && pick.on && (
                  <div className="mt-2 pl-5 space-y-1.5">
                    <input className={INPUT} value={pick.customer || ''} maxLength={200} placeholder="Customer / company" aria-label="Customer / company"
                      onChange={(ev) => on.pick(c.transaction_id, { customer: ev.target.value })} data-testid={`mercury-customer-${c.transaction_id}`} />
                    <div className="flex flex-wrap gap-1.5">
                      {LEDGER_TYPES.map((t) => (
                        <button key={t.k} type="button" onClick={() => on.pick(c.transaction_id, { revenue_type: t.k })}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${pick.revenue_type === t.k ? PILL_ON : PILL_OFF}`}>{t.label}</button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {capped && <p className="text-[10.5px] text-amber-600 dark:text-amber-400" data-testid="mercury-import-capped">Only part of this window was read. Credits outside this partial result are not shown.</p>}
      <p className="text-[10.5px] text-gray-400">The amount and date come from Mercury, not from this form. Imported credits are Supported: matched to a credit in your Mercury account.</p>
      {result && <p className="text-[11.5px] text-gray-600 dark:text-gray-300" data-testid="mercury-import-result">{mercuryImportLine(result)}</p>}
      {result && Array.isArray(result.refused) && result.refused.length > 0 && (
        <ul className="text-[11px] text-amber-700 dark:text-amber-300" data-testid="mercury-import-refusals">
          {result.refused.map((r) => <li key={r.transaction_id}>{mercuryCreditReason(r.reason)}</li>)}
        </ul>
      )}
      {err && <p className="text-[11.5px] text-rose-600" role="alert" data-testid="mercury-import-error">{err}</p>}
      <button type="button" onClick={on.submit} disabled={!ready || busy} data-testid="mercury-run-import"
        className="w-full text-[13px] font-bold text-white bg-teal-600 rounded-lg py-2 disabled:opacity-50">
        {busy ? 'Importing…' : items.length ? `Import ${items.length} credit${items.length === 1 ? '' : 's'}` : 'Pick the credits to import'}
      </button>
    </div>
  );
}

export default function MercuryCreditImport({ projectId, onImported, onBusy }) {
  const [read, setRead] = useState({ status: 'loading' });
  const [picks, setPicks] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    setRead({ status: 'loading' });
    try {
      const res = await mercuryPersonalApi.credits(projectId);
      if (!Array.isArray(res?.credits)) throw new Error('The Mercury credits response could not be read.');
      setRead({ status: 'ok', data: { credits: res.credits, window: res?.window || null, capped: !!res?.capped } });
    } catch (e) {
      reportError('spinout-revenue:ledger-mercury-read', e);
      setRead({ status: 'failed', outcome: mercuryReadOutcome(e) });
    }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const pick = (id, patch) => setPicks((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const submit = async () => {
    const items = read.status === 'ok' ? mercuryImportItems(read.data.credits, picks) : [];
    if (!mercuryImportReady(items) || busy) return;
    setBusy(true); onBusy?.(true); setErr(''); setResult(null);
    try {
      const res = await mercuryPersonalApi.importCredits(projectId, items);
      setResult(res);
      setPicks({});
      await onImported?.();
      await load();
    } catch (e) {
      reportError('spinout-revenue:ledger-mercury-import', e);
      setErr(e?.message || 'Your Mercury credits could not be imported.');
    } finally { setBusy(false); onBusy?.(false); }
  };

  return <MercuryCreditImportView state={{ read, picks, busy, err, result }} on={{ pick, submit, retry: load }} />;
}
