// Task #6 — Admin event moderation + analytics console (§8.3).
// Review queue (approve / reject + reason), lifecycle controls
// (unpublish / feature / cancel / capacity override) and portfolio-wide
// analytics (recharts). Worker-only surface (/api/admin/events/*) — the dev
// FastAPI backend does not implement these, so expect 404s in the dev preview.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, RefreshCw, Loader2, CheckCircle2, XCircle, Star, StarOff,
  Ban, Users, Ticket, Gauge, TrendingUp, Clock, X,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts';
import { adminEvents } from '../../lib/api';
import { useToast } from '../../components/useToast';

const STATUS_BADGE = {
  draft: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  pending_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function fmtDate(value) {
  if (!value) return 'Date TBD';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  try {
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return d.toLocaleString(); }
}

function pct(v) {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

function ToastHost({ toast, onDismiss }) {
  if (!toast?.msg) return null;
  const ok = toast.kind === 'success';
  return (
    <div className="fixed bottom-4 right-4 z-[60] max-w-sm">
      <div
        className={`flex items-start gap-2 rounded-lg px-4 py-3 shadow-lg text-sm ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}
        role="status"
      >
        <span className="flex-1">{toast.msg}</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="opacity-80 hover:opacity-100">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, tone = 'violet' }) {
  const toneMap = {
    violet: 'text-violet-600 dark:text-violet-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    sky: 'text-sky-600 dark:text-sky-400',
  };
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4" data-card>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <Icon className={`w-4 h-4 ${toneMap[tone] || toneMap.violet}`} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

export default function AdminEventsPage() {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejectFor, setRejectFor] = useState(null); // event being rejected
  const [rejectReason, setRejectReason] = useState('');
  const [capacityFor, setCapacityFor] = useState(null); // event whose capacity is edited
  const [capacityValue, setCapacityValue] = useState('');
  const { toast, showToast, dismissToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEvents.analytics();
      setSummary(res.summary || null);
      setRows(res.events || []);
    } catch (e) {
      showToast({ kind: 'error', msg: e.message || 'Failed to load event analytics' });
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const pending = useMemo(() => rows.filter((r) => r.status === 'pending_review'), [rows]);

  const chartData = useMemo(() => (
    rows
      .filter((r) => r.status === 'published' || r.status === 'pending_review')
      .slice(0, 10)
      .map((r) => ({
        name: (r.title || '').length > 18 ? `${r.title.slice(0, 18)}…` : (r.title || `#${r.id}`),
        registrations: r.registrations || 0,
        capacity: r.capacity || 0,
      }))
  ), [rows]);

  const runAction = useCallback(async (id, fn, okMsg) => {
    setBusyId(id);
    try {
      await fn();
      if (okMsg) showToast({ kind: 'success', msg: okMsg });
      await load();
    } catch (e) {
      showToast({ kind: 'error', msg: e.message || 'Action failed' });
    } finally { setBusyId(null); }
  }, [load, showToast]);

  const submitReject = useCallback(async () => {
    if (!rejectFor) return;
    const id = rejectFor.id;
    setRejectFor(null);
    await runAction(id, () => adminEvents.reject(id, rejectReason.trim() || undefined), 'Event rejected');
    setRejectReason('');
  }, [rejectFor, rejectReason, runAction]);

  const submitCapacity = useCallback(async () => {
    if (!capacityFor) return;
    const id = capacityFor.id;
    const raw = capacityValue.trim();
    let capacity = null;
    if (raw !== '') {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        showToast({ kind: 'error', msg: 'Capacity must be a whole number ≥ 0 (or blank for unlimited)' });
        return;
      }
      capacity = n;
    }
    setCapacityFor(null);
    await runAction(id, async () => {
      const res = await adminEvents.setCapacity(id, capacity);
      if (res?.promoted) showToast({ kind: 'success', msg: `Promoted ${res.promoted} from waitlist` });
    }, 'Capacity updated');
    setCapacityValue('');
  }, [capacityFor, capacityValue, runAction, showToast]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <ToastHost toast={toast} onDismiss={dismissToast} />
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 text-gray-900 dark:text-gray-100">
            <CalendarDays className="w-6 h-6 text-violet-600 dark:text-violet-400" />
            Events
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Moderate the event queue, manage lifecycle, and track attendance across the portfolio.
          </p>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      {loading ? (
        <div className="p-12 text-center text-gray-400 dark:text-gray-500 flex items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <SummaryCard icon={CalendarDays} label="Published" value={summary?.published ?? 0} tone="emerald" />
            <SummaryCard icon={Clock} label="Pending review" value={summary?.pending_review ?? 0} tone="amber" />
            <SummaryCard icon={Ticket} label="Registrations" value={summary?.total_registrations ?? 0} tone="violet" />
            <SummaryCard icon={Users} label="Attended" value={summary?.total_attended ?? 0} tone="sky" />
          </div>

          {/* Registrations vs capacity chart */}
          {chartData.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 mb-6" data-card>
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
                <TrendingUp className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                Registrations by event
              </div>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="registrations" fill="#7c3aed" radius={[3, 3, 0, 0]} name="Registered">
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.capacity > 0 && entry.registrations >= entry.capacity ? '#dc2626' : '#7c3aed'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Review queue */}
          {pending.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
                Awaiting review ({pending.length})
              </h2>
              <div className="space-y-3">
                {pending.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/10 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100">{ev.title}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-3">
                        <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" /> {fmtDate(ev.starts_at)}</span>
                        {ev.capacity != null && <span className="inline-flex items-center gap-1"><Gauge className="w-3 h-3" /> cap {ev.capacity}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        disabled={busyId === ev.id}
                        onClick={() => runAction(ev.id, () => adminEvents.approve(ev.id), 'Event approved & published')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
                      >
                        {busyId === ev.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        Approve
                      </button>
                      <button
                        disabled={busyId === ev.id}
                        onClick={() => { setRejectFor(ev); setRejectReason(''); }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm font-medium disabled:opacity-50"
                      >
                        <XCircle className="w-4 h-4" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* All events table */}
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
              All events
            </h2>
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto" data-card>
              {rows.length === 0 ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">No events yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800 text-xs uppercase text-gray-500 dark:text-gray-400">
                    <tr>
                      <th className="text-left px-4 py-2">Event</th>
                      <th className="text-left px-4 py-2">Status</th>
                      <th className="text-right px-4 py-2">Reg.</th>
                      <th className="text-right px-4 py-2">Cap.</th>
                      <th className="text-right px-4 py-2">Util.</th>
                      <th className="text-right px-4 py-2">Conv.</th>
                      <th className="text-right px-4 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((ev) => (
                      <tr key={ev.id} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="px-4 py-2">
                          <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-1">
                            {ev.featured && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />}
                            {ev.title}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{fmtDate(ev.starts_at)}</div>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[ev.status] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                            {ev.status?.replace(/_/g, ' ')}
                          </span>
                          {ev.waitlisted > 0 && (
                            <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">+{ev.waitlisted} wl</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-200">{ev.registrations}</td>
                        <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-200">{ev.capacity ?? '∞'}</td>
                        <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-200">{pct(ev.capacity_util)}</td>
                        <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-200">{pct(ev.conversion)}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              disabled={busyId === ev.id}
                              onClick={() => { setCapacityFor(ev); setCapacityValue(ev.capacity != null ? String(ev.capacity) : ''); }}
                              title="Set capacity"
                              className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:opacity-50"
                            >
                              <Gauge className="w-4 h-4" />
                            </button>
                            <button
                              disabled={busyId === ev.id}
                              onClick={() => runAction(ev.id, () => adminEvents.feature(ev.id, !ev.featured), ev.featured ? 'Unfeatured' : 'Featured')}
                              title={ev.featured ? 'Unfeature' : 'Feature'}
                              className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:opacity-50"
                            >
                              {ev.featured ? <StarOff className="w-4 h-4" /> : <Star className="w-4 h-4" />}
                            </button>
                            {ev.status === 'published' && (
                              <button
                                disabled={busyId === ev.id}
                                onClick={() => runAction(ev.id, () => adminEvents.unpublish(ev.id), 'Event unpublished')}
                                title="Unpublish"
                                className="px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs disabled:opacity-50"
                              >
                                Unpublish
                              </button>
                            )}
                            {ev.status !== 'cancelled' && (
                              <button
                                disabled={busyId === ev.id}
                                onClick={() => {
                                  if (!window.confirm(`Cancel "${ev.title}"? Registrants will be notified.`)) return;
                                  runAction(ev.id, () => adminEvents.cancel(ev.id), 'Event cancelled');
                                }}
                                title="Cancel event"
                                className="p-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                              >
                                <Ban className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}

      {/* Reject reason modal */}
      {rejectFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRejectFor(null)}>
          <div
            className="w-full max-w-md rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Reject event</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Optionally tell the host why “{rejectFor.title}” was rejected.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Reason (optional)"
              className="mt-3 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setRejectFor(null)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={submitReject}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
              >
                Reject event
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Capacity override modal */}
      {capacityFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCapacityFor(null)}>
          <div
            className="w-full max-w-md rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Set capacity</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              “{capacityFor.title}” — leave blank for unlimited. Raising the cap promotes the waitlist automatically.
            </p>
            <input
              type="number"
              min="0"
              step="1"
              value={capacityValue}
              onChange={(e) => setCapacityValue(e.target.value)}
              placeholder="Unlimited"
              className="mt-3 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setCapacityFor(null)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={submitCapacity}
                className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
