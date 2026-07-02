import React, { useEffect, useState } from 'react';
import { Clock, RefreshCw, ChevronLeft, ChevronRight, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';

const PAGE_SIZE = 50;

function StatusIcon({ status }) {
  if (status === 'completed' || status === 'ok') return <CheckCircle size={14} className="text-emerald-600" />;
  if (status === 'failed' || status === 'error') return <XCircle size={14} className="text-red-600" />;
  return <AlertCircle size={14} className="text-amber-600" />;
}

export default function CronTab() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [trigger, setTrigger] = useState('');
  const [triggers, setTriggers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [wsCheck, setWsCheck] = useState(null);
  const [reembed, setReembed] = useState([]);

  const load = async () => {
    setBusy(true); setErr('');
    try {
      const [cr, ws, re] = await Promise.allSettled([
        api.infraCronHistory({ trigger, limit: PAGE_SIZE, offset }),
        api.infraWSCheck(),
        api.infraReembedMetrics(24),
      ]);
      if (cr.status === 'fulfilled') {
        setItems(cr.value.items || []);
        setTotal(cr.value.total || 0);
        setTriggers(cr.value.triggers || []);
      }
      if (ws.status === 'fulfilled') setWsCheck(ws.value);
      if (re.status === 'fulfilled') setReembed(re.value.items || []);
    } catch (e) {
      setErr(e?.message || 'Failed to load cron history');
    } finally { setBusy(false); }
  };

  useEffect(() => { load(); }, [offset, trigger]);

  const pages = Math.ceil(total / PAGE_SIZE);
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-6">
      {/* WS spot-check */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
        <div className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">WebSocket spot-check</div>
        {wsCheck ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(wsCheck.checks || {}).map(([name, c]) => (
              <div key={name} className={`border rounded-lg px-3 py-2 text-xs flex items-center justify-between ${c.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                <span className="font-medium text-gray-800 dark:text-gray-200 capitalize">{name}</span>
                <span className={`font-mono ${c.ok ? 'text-emerald-700' : 'text-red-700'}`}>{c.detail}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-500">Loading WS health…</div>
        )}
      </div>

      {/* Search re-index health (hourly axal-search sweep) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
        <div className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">Search re-index (last 24h)</div>
        {reembed.length === 0 ? (
          <div className="text-xs text-gray-500">No re-index activity recorded in the last 24h.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-500 border-b border-gray-200 dark:border-gray-800">
                <tr>
                  <th className="text-left py-2 font-medium">Type</th>
                  <th className="text-right font-medium">Enqueued</th>
                  <th className="text-right font-medium">Failed</th>
                  <th className="text-right font-medium">Skipped</th>
                  <th className="text-right font-medium">Ticks</th>
                  <th className="text-left font-medium pl-4">Last run</th>
                </tr>
              </thead>
              <tbody className="text-gray-800 dark:text-gray-200">
                {reembed.map(r => (
                  <tr key={r.type} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 font-mono">{r.type}</td>
                    <td className="text-right tabular-nums">{r.enqueued ?? 0}</td>
                    <td className={`text-right tabular-nums ${Number(r.failed) > 0 ? 'text-red-700 font-semibold' : ''}`}>{r.failed ?? 0}</td>
                    <td className={`text-right tabular-nums ${Number(r.skipped) > 0 ? 'text-amber-700' : ''}`}>{r.skipped ?? 0}</td>
                    <td className="text-right tabular-nums text-gray-500">{r.ticks ?? 0}</td>
                    <td className="text-gray-500 pl-4">
                      {r.last_run_at ? new Date(r.last_run_at + (r.last_run_at.endsWith('Z') ? '' : 'Z')).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Triggers metadata */}
      {triggers.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
          <div className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">Triggers schedule</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {triggers.map(t => (
              <div key={t.name} className="border border-gray-100 rounded-lg p-3 dark:border-gray-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-semibold text-gray-800 dark:text-gray-200">{t.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">{t.expr}</span>
                </div>
                <div className="text-xs text-gray-500 space-y-0.5">
                  <div>Last: {t.last_run_at ? new Date(t.last_run_at + (t.last_run_at.endsWith('Z') ? '' : 'Z')).toLocaleString() : '—'}</div>
                  <div>Next: {t.next_run_at ? new Date(t.next_run_at + (t.next_run_at.endsWith('Z') ? '' : 'Z')).toLocaleString() : '—'}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cron history */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-violet-600" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Cron run history</h2>
            <span className="text-xs text-gray-500">{total} run(s)</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter trigger name"
              value={trigger}
              onChange={e => { setTrigger(e.target.value); setOffset(0); }}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
            <button onClick={load} disabled={busy}
              className="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-1.5">
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {err && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{err}</div>
        )}

        {items.length === 0 && !busy ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-500 dark:bg-gray-900 dark:border-gray-800">
            No cron runs recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-500 border-b border-gray-200 dark:border-gray-800">
                <tr>
                  <th className="text-left py-2 font-medium">Trigger</th>
                  <th className="text-left font-medium">Status</th>
                  <th className="text-left font-medium">Started</th>
                  <th className="text-left font-medium">Finished</th>
                  <th className="text-left font-medium">Summary</th>
                  <th className="text-left font-medium">Error</th>
                </tr>
              </thead>
              <tbody className="text-gray-800 dark:text-gray-200">
                {items.map(it => (
                  <tr key={it.id} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 font-mono">{it.trigger_name}</td>
                    <td>
                      <span className="inline-flex items-center gap-1">
                        <StatusIcon status={it.status} />
                        <span className={it.status === 'completed' ? 'text-emerald-700' : it.status === 'failed' ? 'text-red-700' : 'text-amber-700'}>
                          {it.status}
                        </span>
                      </span>
                    </td>
                    <td className="text-gray-500">
                      {it.started_at ? new Date(it.started_at + (it.started_at.endsWith('Z') ? '' : 'Z')).toLocaleString() : '—'}
                    </td>
                    <td className="text-gray-500">
                      {it.finished_at ? new Date(it.finished_at + (it.finished_at.endsWith('Z') ? '' : 'Z')).toLocaleString() : '—'}
                    </td>
                    <td className="max-w-xs truncate" title={it.summary || ''}>{it.summary || '—'}</td>
                    <td className="text-red-700 max-w-xs truncate" title={it.error || ''}>{it.error || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0 || busy}
              className="px-3 py-1.5 text-sm bg-white border border-gray-300 hover:bg-gray-50 rounded-lg flex items-center gap-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <span className="text-xs text-gray-500">Page {page} of {pages}</span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total || busy}
              className="px-3 py-1.5 text-sm bg-white border border-gray-300 hover:bg-gray-50 rounded-lg flex items-center gap-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
