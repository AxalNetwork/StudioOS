// Build queue #129 — Round Manager: closes/tranches and pro-rata rights.
//
// Two panels mounted under the raise pipeline. Both read computed values
// from the worker (services/roundMath.ts) rather than recomputing in the
// browser, so the numbers a founder sees are the numbers the API would
// report to anyone else.
import React, { useEffect, useState } from 'react';
import { Layers, Plus, Users, RefreshCw, Download } from 'lucide-react';
import { api } from '../../lib/api';

const money = (v) => (v == null ? '—' : `$${Number(v).toLocaleString()}`);
const moneyShort = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
};

const CLOSE_STATE_META = {
  planned: { label: 'Planned', cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' },
  open: { label: 'Open', cls: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300' },
  closed: { label: 'Closed', cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
};
const PRO_RATA_STATE_META = {
  offered: { label: 'Offered', cls: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300' },
  taking: { label: 'Taking', cls: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
  waived: { label: 'Waived', cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500' },
  expired: { label: 'Expired', cls: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
};

export function RoundClosesPanel({ projectId, onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', target_date: '', state: 'planned' });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await api.raiseCloses(projectId)); }
    catch (e) { onError?.(e.message || 'Failed to load closes'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (projectId) load(); /* eslint-disable-next-line */ }, [projectId]);

  const addClose = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await api.raiseCloseCreate({ project_id: projectId, ...form, target_date: form.target_date || undefined });
      setForm({ name: '', target_date: '', state: 'planned' });
      setAdding(false);
      load();
    } catch (e) { onError?.(e.message || 'Failed to add close'); }
    finally { setBusy(false); }
  };

  const setState = async (id, state) => {
    try { await api.raiseCloseUpdate(id, { state }); load(); }
    catch (e) { onError?.(e.message || 'Failed to update close'); }
  };

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading closes…</div>;
  if (!data?.round) {
    return (
      <div className="p-6 text-sm text-gray-500">
        Set up the round first — closes are tranches of it.
      </div>
    );
  }

  const p = data.progress;
  const closes = data.closes || [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5">
            <Layers size={14} className="text-violet-600" /> Closes &amp; tranches
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-xl">
            A rolling close: money lands in tranches rather than all at once. Each close carries
            its own wire date and its own subtotal.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={load} className="p-2 text-gray-500 hover:text-violet-600" title="Refresh"><RefreshCw size={14} /></button>
          <button onClick={() => setAdding(a => !a)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 rounded-lg font-semibold hover:bg-violet-100 dark:hover:bg-violet-900/40">
            <Plus size={12} /> Add close
          </button>
        </div>
      </div>

      {/* Funnel — wired / signed / soft kept visually distinct, because
          only the first two are money the founder actually controls. */}
      {p && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-2 flex-wrap gap-2">
            <span>
              <strong className="text-gray-900 dark:text-gray-100">{money(p.committed)}</strong> committed
              {p.target ? <> of {money(p.target)} target</> : null}
              {p.soft > 0 && <> · {money(p.soft)} soft on top</>}
            </span>
            {p.committed_pct != null && (
              <span className={p.oversubscribed ? 'text-emerald-600 font-semibold' : ''}>
                {p.committed_pct}%{p.oversubscribed ? ' — oversubscribed' : ''}
              </span>
            )}
          </div>
          <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden flex">
            {p.target > 0 && (
              <>
                <div className="bg-emerald-500" style={{ width: `${Math.min(100, (p.wired / p.target) * 100)}%` }} title={`Wired ${money(p.wired)}`} />
                <div className="bg-violet-500" style={{ width: `${Math.min(100, (p.signed / p.target) * 100)}%` }} title={`Signed ${money(p.signed)}`} />
                <div className="bg-violet-200 dark:bg-violet-900/60" style={{ width: `${Math.min(100, (p.soft / p.target) * 100)}%` }} title={`Soft ${money(p.soft)}`} />
              </>
            )}
          </div>
          <div className="flex gap-4 flex-wrap mt-2 text-[10px] text-gray-500">
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Wired {money(p.wired)}</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-violet-500" /> Signed {money(p.signed)}</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-violet-200 dark:bg-violet-900/60" /> Soft {money(p.soft)} <em className="not-italic text-gray-400">(not counted as committed)</em></span>
          </div>
        </div>
      )}

      {adding && (
        <form onSubmit={addClose} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-wrap gap-2 items-end">
          <label className="flex-1 min-w-[160px]">
            <div className="text-[11px] text-gray-500 mb-1">Name</div>
            <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="First close" autoFocus
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900" />
          </label>
          <label>
            <div className="text-[11px] text-gray-500 mb-1">Target date</div>
            <input type="date" value={form.target_date} onChange={(e) => setForm(f => ({ ...f, target_date: e.target.value }))}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900" />
          </label>
          <label>
            <div className="text-[11px] text-gray-500 mb-1">State</div>
            <select value={form.state} onChange={(e) => setForm(f => ({ ...f, state: e.target.value }))}
              className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900">
              {Object.entries(CLOSE_STATE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy || !form.name.trim()}
            className="px-3 py-2 text-sm bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:opacity-60">
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button type="button" onClick={() => setAdding(false)} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-800">Cancel</button>
        </form>
      )}

      {closes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
          No closes yet. Add one to start splitting the round into tranches — each with its own
          wire date and subtotal.
        </div>
      ) : (
        <div className="space-y-3">
          {closes.map(c => (
            <div key={c.uid || c.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
              <div className="flex items-center gap-3 flex-wrap px-4 py-3 bg-gray-50 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800">
                <div className="flex-1 min-w-[160px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{c.name}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${CLOSE_STATE_META[c.state]?.cls || CLOSE_STATE_META.planned.cls}`}>
                      {CLOSE_STATE_META[c.state]?.label || c.state}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {c.closed_date ? `Closed ${c.closed_date}` : c.target_date ? `Target ${c.target_date}` : 'No date set'}
                    {' · '}{c.allocation_count || 0} investor{c.allocation_count === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">{moneyShort(c.committed)}</div>
                  <div className="text-[10px] text-gray-500">
                    {c.pct_of_round != null ? `${c.pct_of_round}% of round` : 'committed'}
                  </div>
                </div>
                <select value={c.state} onChange={(e) => setState(c.id, e.target.value)}
                  className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900">
                  {Object.entries(CLOSE_STATE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>
              </div>
              {(c.soft > 0 || c.signed > 0 || c.wired > 0) && (
                <div className="px-4 py-2 flex gap-4 flex-wrap text-[11px] text-gray-600 dark:text-gray-400">
                  <span>Wired <strong className="tabular-nums">{money(c.wired)}</strong></span>
                  <span>Signed <strong className="tabular-nums">{money(c.signed)}</strong></span>
                  <span className="text-gray-400">Soft <strong className="tabular-nums">{money(c.soft)}</strong></span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {data.unassigned && (data.unassigned.pipeline > 0) && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
          <strong>{money(data.unassigned.pipeline)}</strong> is committed but not assigned to any close
          ({money(data.unassigned.committed)} committed, {money(data.unassigned.soft)} soft). Assign each
          investor to a tranche so the subtotals add up.
        </div>
      )}
    </div>
  );
}

export function ProRataPanel({ projectId, onError }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await api.raiseProRata(projectId)); }
    catch (e) { onError?.(e.message || 'Failed to load pro-rata'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (projectId) load(); /* eslint-disable-next-line */ }, [projectId]);

  const seed = async () => {
    setBusy(true);
    try {
      const r = await api.raiseProRataCreate({ project_id: projectId, seed_from_cap_table: true });
      if (r.added === 0) onError?.('No new cap-table holders to import.');
      load();
    } catch (e) { onError?.(e.message || 'Failed to import holders'); }
    finally { setBusy(false); }
  };

  const patch = async (id, body) => {
    try { await api.raiseProRataUpdate(id, body); load(); }
    catch (e) { onError?.(e.message || 'Failed to update'); }
  };

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading pro-rata…</div>;
  if (!data?.round) {
    return <div className="p-6 text-sm text-gray-500">Set up the round first — pro-rata rights are scoped to it.</div>;
  }

  const res = data.result;
  const holders = data.holders || [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5">
            <Users size={14} className="text-violet-600" /> Pro-rata rights
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-xl">
            What existing holders are entitled to in this round, and what they have decided.
            Entitlements are recomputed on every load — they can never drift from the round size.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={load} className="p-2 text-gray-500 hover:text-violet-600" title="Refresh"><RefreshCw size={14} /></button>
          <button onClick={seed} disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 rounded-lg font-semibold hover:bg-violet-100 dark:hover:bg-violet-900/40 disabled:opacity-60">
            <Download size={12} /> {busy ? 'Importing…' : 'Import from cap table'}
          </button>
        </div>
      </div>

      {res && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Round size</div>
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">{moneyShort(res.round_size)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Reserved</div>
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">{res.reserved == null ? '—' : moneyShort(res.reserved)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Rights claimed</div>
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">{moneyShort(res.entitlement_total)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Taking</div>
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100 tabular-nums">{moneyShort(res.taking_total)}</div>
          </div>
        </div>
      )}

      {/* The reconciliation rule is stated, not hidden: a scaled-back
          entitlement is a materially different promise to a holder. */}
      {res?.rule === 'scaled' && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
          Rights total {money(res.entitlement_total)} against a {money(res.reserved)} reserve, so every
          entitlement below is <strong>scaled back in proportion</strong> — nobody is cut first. Raise
          the reserve to honour the full rights.
        </div>
      )}
      {res?.rule === 'raw' && holders.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60 px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
          No pro-rata reserve is set on the round, so entitlements below are the raw right
          (prior stake × round size). Set a reserve to see how far it actually stretches.
        </div>
      )}

      {holders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
          No holders tracked yet. Import them from the cap table to see who has rights in this round.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50 dark:bg-gray-900/60 border-b border-gray-100 dark:border-gray-800">
              <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                <th className="text-left px-4 py-2">Holder</th>
                <th className="text-right px-3 py-2">Prior stake</th>
                <th className="text-right px-3 py-2">Entitlement</th>
                <th className="text-right px-3 py-2">Taking</th>
                <th className="text-right px-3 py-2">Post-round</th>
                <th className="text-left px-3 py-2">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
              {holders.map(h => (
                <tr key={h.uid}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900 dark:text-gray-100">{h.holder_name}</div>
                    {h.holder_email && <div className="text-[11px] text-gray-500">{h.holder_email}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                    {Number(h.prior_stake_pct).toFixed(2)}%
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium text-gray-900 dark:text-gray-100">
                    {money(h.entitlement)}
                    {h.scaled && h.entitlement_raw != null && (
                      <div className="text-[10px] text-amber-600 dark:text-amber-400">scaled from {moneyShort(h.entitlement_raw)}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <input type="number" min="0" step="1000" defaultValue={h.taking_amount ?? ''}
                      disabled={h.state === 'waived' || h.state === 'expired'}
                      onBlur={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        if (String(v ?? '') !== String(h.taking_amount ?? '')) patch(h.id, { taking_amount: v, state: v ? 'taking' : h.state });
                      }}
                      className="w-28 px-2 py-1 text-xs text-right border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 disabled:opacity-40 tabular-nums" />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400">
                    {h.post_round_stake_pct == null ? '—' : `${h.post_round_stake_pct.toFixed(2)}%`}
                  </td>
                  <td className="px-3 py-2.5">
                    <select value={h.state} onChange={(e) => patch(h.id, { state: e.target.value })}
                      className={`text-[11px] px-2 py-1 rounded font-semibold border-0 ${PRO_RATA_STATE_META[h.state]?.cls || ''}`}>
                      {Object.entries(PRO_RATA_STATE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res?.reserve_remaining != null && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {money(res.reserve_remaining)} of the reserve is still unclaimed.
          {' '}Post-round stakes assume the round closes at target on the recorded pre-money.
        </div>
      )}
    </div>
  );
}
