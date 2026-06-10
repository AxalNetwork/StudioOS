import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';

const PAGE_SIZE = 25;

export default function DlqTab() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [jobType, setJobType] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [actionId, setActionId] = useState(null);

  const load = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.infraDLQ({ job_type: jobType, source, limit: PAGE_SIZE, offset });
      setItems(r.items || []);
      setTotal(r.total || 0);
    } catch (e) {
      setErr(e?.message || 'Failed to load DLQ');
    } finally { setBusy(false); }
  };

  useEffect(() => { load(); }, [offset, jobType, source]);

  const retry = async (id) => {
    if (!confirm(`Re-enqueue DLQ item #${id}?`)) return;
    setActionId(id);
    try {
      await api.infraRetryDLQ(id);
      await load();
    } catch (e) {
      setErr(e?.message || 'Retry failed');
    } finally { setActionId(null); }
  };

  const discard = async (id) => {
    if (!confirm(`Permanently discard DLQ item #${id}?`)) return;
    setActionId(id);
    try {
      await api.infraDeleteDLQ(id);
      await load();
    } catch (e) {
      setErr(e?.message || 'Discard failed');
    } finally { setActionId(null); }
  };

  const pages = Math.ceil(total / PAGE_SIZE);
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-red-600" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Dead-letter queue</h2>
          <span className="text-xs text-gray-500">{total} item(s)</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter by job_type"
            value={jobType}
            onChange={e => { setJobType(e.target.value); setOffset(0); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
          <select
            value={source}
            onChange={e => { setSource(e.target.value); setOffset(0); }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="">All sources</option>
            <option value="d1">D1 (legacy)</option>
            <option value="cf">CF Queue</option>
          </select>
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
          No dead-letter items.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(d => (
            <div key={d.id} className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm text-red-800 font-semibold">{d.job_type}</span>
                    <span className="text-xs text-gray-500">#{d.id} · orig #{d.original_job_id}</span>
                    {d.source && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${d.source === 'cf' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                        {d.source === 'cf' ? 'CF Queue' : 'D1'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {d.moved_at ? new Date(d.moved_at + (d.moved_at.endsWith('Z') ? '' : 'Z')).toLocaleString() : '—'} · {d.attempts} attempt(s)
                  </div>
                  {d.last_error && (
                    <div className="text-xs text-red-700 mt-1 font-mono whitespace-pre-wrap break-words max-w-2xl">
                      {d.last_error}
                    </div>
                  )}
                  {d.payload && (
                    <div className="text-[11px] text-gray-600 mt-1 font-mono whitespace-pre-wrap break-words max-w-2xl dark:text-gray-400">
                      {d.payload}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => retry(d.id)}
                    disabled={actionId === d.id}
                    className="px-2.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded-lg flex items-center gap-1"
                  >
                    <RotateCcw size={12} /> Retry
                  </button>
                  <button
                    onClick={() => discard(d.id)}
                    disabled={actionId === d.id}
                    className="px-2.5 py-1.5 text-xs bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg flex items-center gap-1 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300"
                  >
                    <Trash2 size={12} /> Discard
                  </button>
                </div>
              </div>
            </div>
          ))}
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
  );
}
