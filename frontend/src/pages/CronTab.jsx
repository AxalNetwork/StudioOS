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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [wsCheck, setWsCheck] = useState(null);

  const load = async () => {
    setBusy(true); setErr('');
    try {
      const [cr, ws] = await Promise.allSettled([
        api.infraCronHistory({ trigger, limit: PAGE_SIZE, offset }),
        api.infraWSCheck(),
      ]);
      if (cr.status === 'fulfilled') {
        setItems(cr.value.items || []);
        setTotal(cr.value.total || 0);
      }
      if (ws.status === 'fulfilled') setWsCheck(ws.value);
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
