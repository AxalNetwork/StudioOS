import React, { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle, Plus, Trash2, RefreshCw } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * §409A safe-harbour state for the selected project.
 *
 * Every judgement here is made in the worker
 * (services/valuation409a.ts) and rendered as-is. That matters more than
 * usual: the rule is "12 months from the valuation date, OR until a
 * material event makes the appraisal unreliable, whichever comes first",
 * and a UI that counted days on its own would confidently report a
 * four-month-old valuation as fine after the company priced a round.
 *
 * Nothing on this page is tax advice, and it deliberately does not
 * compute a fair market value — it tracks the status of an appraisal a
 * qualified provider produced.
 */

const STATE_STYLE = {
  valid: { pill: 'bg-emerald-100 text-emerald-800', bar: 'border-emerald-200 bg-emerald-50' },
  expiring: { pill: 'bg-amber-100 text-amber-800', bar: 'border-amber-200 bg-amber-50' },
  expired: { pill: 'bg-red-100 text-red-700', bar: 'border-red-200 bg-red-50' },
  invalidated: { pill: 'bg-red-100 text-red-700', bar: 'border-red-200 bg-red-50' },
  none: { pill: 'bg-gray-200 text-gray-700', bar: 'border-gray-200 bg-gray-50' },
};

const STATE_LABEL = {
  valid: 'Safe harbour valid',
  expiring: 'Expiring soon',
  expired: 'Expired',
  invalidated: 'Invalidated early',
  none: 'No valuation on file',
};

const EVENT_KINDS = [
  { value: 'priced_round', label: 'Priced financing round' },
  { value: 'material_change', label: 'Material change in the business' },
  { value: 'secondary_transaction', label: 'Secondary sale of shares' },
  { value: 'acquisition_discussion', label: 'Acquisition discussions' },
  { value: 'financial_restatement', label: 'Financial restatement' },
];

const METHODS = [
  { value: '', label: 'Method (optional)' },
  { value: 'backsolve', label: 'Backsolve' },
  { value: 'obm', label: 'Option pricing (OPM)' },
  { value: 'income', label: 'Income' },
  { value: 'market', label: 'Market' },
  { value: 'asset', label: 'Asset' },
  { value: 'other', label: 'Other' },
];

const RATIO_NOTE = {
  low: 'Below the customary range. Not wrong on its own, but it is the number an auditor asks about first.',
  customary: 'Within the range auditors typically expect.',
  high: 'Above the customary range. Expect questions about how the discount was derived.',
};

const field = 'px-2 py-1.5 text-sm border border-gray-300 rounded bg-white dark:bg-gray-900 dark:border-gray-700';

export default function SafeHarbourPanel({ projectId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [addingValuation, setAddingValuation] = useState(false);
  const [addingEvent, setAddingEvent] = useState(false);
  const [valuation, setValuation] = useState({
    valuation_date: '', fmv_per_share: '', provider: '', method: '',
    preferred_price_per_share: '',
  });
  const [event, setEvent] = useState({ kind: 'priced_round', occurred_on: '', note: '' });

  const load = async () => {
    if (!projectId) return;
    setLoading(true); setErr('');
    try { setData(await api.get409a(projectId)); }
    catch (e) { setErr(e.message || 'Could not load the 409A status'); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  const saveValuation = async () => {
    setErr('');
    try {
      await api.record409a(projectId, {
        valuation_date: valuation.valuation_date,
        fmv_per_share: Number(valuation.fmv_per_share),
        provider: valuation.provider || null,
        method: valuation.method || null,
        preferred_price_per_share: valuation.preferred_price_per_share === ''
          ? null : Number(valuation.preferred_price_per_share),
      });
      setAddingValuation(false);
      setValuation({ valuation_date: '', fmv_per_share: '', provider: '', method: '', preferred_price_per_share: '' });
      await load();
    } catch (e) { setErr(e.message || 'Could not record the valuation'); }
  };

  const saveEvent = async () => {
    setErr('');
    try {
      await api.record409aEvent(projectId, {
        kind: event.kind, occurred_on: event.occurred_on, note: event.note || null,
      });
      setAddingEvent(false);
      setEvent({ kind: 'priced_round', occurred_on: '', note: '' });
      await load();
    } catch (e) { setErr(e.message || 'Could not record the event'); }
  };

  const removeEvent = async (id) => {
    setErr('');
    try { await api.delete409aEvent(projectId, id); await load(); }
    catch (e) { setErr(e.message || 'Could not remove the event'); }
  };

  if (!projectId) return null;
  const status = data?.status;
  const style = STATE_STYLE[status?.state] || STATE_STYLE.none;

  return (
    <div className="mt-4 bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-violet-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">409A safe harbour</h3>
        </div>
        <button onClick={load} disabled={loading} title="Refresh"
          className="p-1.5 text-gray-400 hover:text-gray-600 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {err && (
        <div className="mb-3 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-700">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {err}
        </div>
      )}

      {!data && loading && <div className="text-xs text-gray-400">Loading…</div>}

      {status && (
        <div className={`border rounded-lg px-3 py-2.5 mb-4 ${style.bar}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${style.pill}`}>
              {STATE_LABEL[status.state] || status.state}
            </span>
            {status.days_remaining != null && status.state !== 'none' && (
              <span className="text-[11px] text-gray-600 dark:text-gray-400">
                {status.days_remaining} days on the clock
                {status.expires_on ? ` · nominal expiry ${status.expires_on}` : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-700 dark:text-gray-300">{status.reason}</p>
        </div>
      )}

      {data?.current && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-xs">
          <div>
            <div className="text-gray-500">Common FMV</div>
            <div className="font-medium text-gray-900 dark:text-gray-100">
              ${Number(data.current.fmv_per_share).toLocaleString(undefined, { maximumFractionDigits: 6 })}
            </div>
          </div>
          <div>
            <div className="text-gray-500">Valuation date</div>
            <div className="font-medium text-gray-900 dark:text-gray-100">{data.current.valuation_date}</div>
          </div>
          <div>
            <div className="text-gray-500">Provider</div>
            <div className="font-medium text-gray-900 dark:text-gray-100">{data.current.provider || '—'}</div>
          </div>
          <div>
            <div className="text-gray-500">Common : preferred</div>
            {data.common_to_preferred ? (
              <div className="font-medium text-gray-900 dark:text-gray-100"
                title={RATIO_NOTE[data.common_to_preferred.flag]}>
                {(data.common_to_preferred.ratio * 100).toFixed(1)}%
                <span className={`ml-1 text-[10px] ${data.common_to_preferred.flag === 'customary' ? 'text-gray-400' : 'text-amber-700'}`}>
                  {data.common_to_preferred.flag}
                </span>
              </div>
            ) : (
              // Deliberately not a zero or a dash-with-a-number: without a
              // preferred price there is no ratio to report.
              <div className="text-gray-400">No preferred price on file</div>
            )}
          </div>
        </div>
      )}

      {/* ---------- triggers ---------- */}
      {data?.triggers && (
        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-900 mb-2 dark:text-gray-100">Event triggers</div>
          <div className="space-y-1">
            {data.triggers.map((t) => (
              <div key={t.kind} className="flex items-start gap-2 text-xs py-1 border-t border-gray-100 first:border-t-0 dark:border-gray-800">
                <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${t.fired ? 'bg-red-500' : 'bg-gray-300'}`} />
                <div className="flex-1">
                  <div className={t.fired ? 'text-gray-900 font-medium dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}>
                    {t.label}
                  </div>
                  <div className="text-[11px] text-gray-500">{t.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- record ---------- */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setAddingValuation((v) => !v)}
          className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1 dark:bg-gray-900 dark:border-gray-700">
          <Plus size={12} /> Record a valuation
        </button>
        <button onClick={() => setAddingEvent((v) => !v)}
          className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1 dark:bg-gray-900 dark:border-gray-700">
          <Plus size={12} /> Record a material event
        </button>
      </div>

      {addingValuation && (
        <div className="mt-3 border border-gray-200 rounded-lg p-3 dark:border-gray-800">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Valuation date</span>
              <input type="date" className={field} value={valuation.valuation_date}
                onChange={(e) => setValuation({ ...valuation, valuation_date: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Common FMV / share</span>
              <input type="number" step="0.0001" min="0" className={field} value={valuation.fmv_per_share}
                onChange={(e) => setValuation({ ...valuation, fmv_per_share: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Last preferred / share</span>
              <input type="number" step="0.0001" min="0" className={field}
                value={valuation.preferred_price_per_share}
                onChange={(e) => setValuation({ ...valuation, preferred_price_per_share: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Provider</span>
              <input type="text" className={field} value={valuation.provider}
                onChange={(e) => setValuation({ ...valuation, provider: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Method</span>
              <select className={field} value={valuation.method}
                onChange={(e) => setValuation({ ...valuation, method: e.target.value })}>
                {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={saveValuation}
              className="px-3 py-1.5 text-xs bg-violet-600 text-white rounded hover:bg-violet-700">Save</button>
            <button onClick={() => setAddingValuation(false)}
              className="px-3 py-1.5 text-xs text-gray-600">Cancel</button>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            The date the appraisal speaks as of, not the day it was delivered — the 12-month
            clock runs from that date. Earlier valuations are kept, not replaced.
          </p>
        </div>
      )}

      {addingEvent && (
        <div className="mt-3 border border-gray-200 rounded-lg p-3 dark:border-gray-800">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">What happened</span>
              <select className={field} value={event.kind}
                onChange={(e) => setEvent({ ...event, kind: e.target.value })}>
                {EVENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Date</span>
              <input type="date" className={field} value={event.occurred_on}
                onChange={(e) => setEvent({ ...event, occurred_on: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Note</span>
              <input type="text" className={field} value={event.note}
                onChange={(e) => setEvent({ ...event, note: e.target.value })} />
            </label>
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={saveEvent}
              className="px-3 py-1.5 text-xs bg-violet-600 text-white rounded hover:bg-violet-700">Save</button>
            <button onClick={() => setAddingEvent(false)}
              className="px-3 py-1.5 text-xs text-gray-600">Cancel</button>
          </div>
        </div>
      )}

      {/* ---------- history ---------- */}
      {data?.history?.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-900 mb-1 dark:text-gray-100">Valuation history</div>
          <table className="w-full text-xs">
            <thead className="text-gray-500"><tr>
              <th className="text-left py-1 font-medium">As of</th>
              <th className="text-right font-medium">FMV / share</th>
              <th className="text-left font-medium pl-3">Provider</th>
              <th className="text-left font-medium">Method</th>
            </tr></thead>
            <tbody>
              {data.history.map((v) => (
                <tr key={v.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-1.5 text-gray-900 dark:text-gray-100">{String(v.valuation_date).slice(0, 10)}</td>
                  <td className="text-right tabular-nums">
                    ${Number(v.fmv_per_share).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </td>
                  <td className="pl-3 text-gray-600 dark:text-gray-400">{v.provider || '—'}</td>
                  <td className="text-gray-600 dark:text-gray-400">{v.method || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.events?.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-semibold text-gray-900 mb-1 dark:text-gray-100">Recorded events</div>
          {data.events.map((e) => (
            <div key={e.id} className="flex items-center justify-between text-xs py-1.5 border-t border-gray-100 dark:border-gray-800">
              <div>
                <span className="text-gray-900 dark:text-gray-100">
                  {EVENT_KINDS.find((k) => k.value === e.kind)?.label || e.kind}
                </span>
                <span className="text-gray-500"> · {String(e.occurred_on).slice(0, 10)}</span>
                {e.note && <div className="text-[11px] text-gray-500">{e.note}</div>}
              </div>
              <button onClick={() => removeEvent(e.id)} title="Remove this event"
                className="p-1 text-gray-400 hover:text-red-600">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
