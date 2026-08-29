/**
 * Task #4 (ID) — Public /status page.
 *
 * Reads `GET /api/public/status` for service health + admin-written
 * incidents. The endpoint also returns 90 days of per-service uptime
 * cells so we can paint the green/yellow/red strip per row.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle, AlertTriangle, XCircle, Clock, Loader2 } from 'lucide-react';
import { request } from '../lib/api';
import { overallStatus } from '../lib/statusOverall';
import { usePageMeta } from '../lib/seo';

const STATUS_PILL = {
  operational: { label: 'Operational', icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-100' },
  degraded:    { label: 'Degraded',    icon: AlertTriangle, color: 'text-amber-600',   bg: 'bg-amber-100' },
  down:        { label: 'Outage',      icon: XCircle,       color: 'text-red-600',     bg: 'bg-red-100' },
  unknown:     { label: 'Unknown',     icon: Clock,         color: 'text-gray-500',    bg: 'bg-gray-100' },
};

const SEVERITY_PILL = {
  minor:    { label: 'Minor',    color: 'bg-amber-100 text-amber-800' },
  major:    { label: 'Major',    color: 'bg-orange-100 text-orange-800' },
  critical: { label: 'Critical', color: 'bg-red-100 text-red-800' },
};

function UptimeStrip({ cells }) {
  // 90 cells (one per day); each cell is { day: 'YYYY-MM-DD', status }
  return (
    <div className="flex gap-[2px] items-end" aria-label="90-day uptime history" role="img">
      {(cells || []).map((c, i) => {
        const cls =
          c.status === 'operational' ? 'bg-emerald-500'
          : c.status === 'degraded' ? 'bg-amber-400'
          : c.status === 'down' ? 'bg-red-500'
          : 'bg-gray-200';
        return <span key={i} title={`${c.day}: ${c.status}`} className={`inline-block w-[3px] h-6 rounded-sm ${cls}`} />;
      })}
    </div>
  );
}

export default function StatusPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  usePageMeta({
    title: 'System status',
    description: 'Real-time health of Axal VC StudioOS services, plus a 90-day uptime history.',
    path: '/status',
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await request('/public/status');
        if (alive) setData(res);
      } catch (ex) {
        if (alive) setError(ex.message || 'Could not load status.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const services = data?.services || [];
  const incidents = data?.incidents || [];
  // Shared with the Help Center's "Still stuck?" block. It also returns
  // 'unknown' for an empty probe list — the inline `every()` this replaced
  // reported a confident "Operational" when no service had been probed at all,
  // which is why the `unknown` pill below has never been reachable.
  const overall = overallStatus(services);
  const OverallIcon = STATUS_PILL[overall].icon;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link to="/" className="inline-flex items-center gap-2 text-violet-600 hover:text-violet-700 mb-8 min-h-[44px]">
          <ArrowLeft size={16} aria-hidden="true" /> Back to Axal VC
        </Link>

        <header className="mb-8 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">System status</h1>
            <p className="text-sm text-gray-600 mt-1">Live health of Axal VC StudioOS services.</p>
          </div>
          {!loading && !error && (
            <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${STATUS_PILL[overall].bg}`}>
              <OverallIcon className={STATUS_PILL[overall].color} size={18} aria-hidden="true" />
              <span className={`font-semibold ${STATUS_PILL[overall].color}`}>
                {overall === 'operational' ? 'All systems operational' : STATUS_PILL[overall].label}
              </span>
            </div>
          )}
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-gray-500"><Loader2 className="animate-spin" size={18} /> Loading status…</div>
        )}
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-4">{error}</div>
        )}

        {!loading && !error && (
          <>
            <section aria-labelledby="services" className="mb-10">
              <h2 id="services" className="text-lg font-semibold text-gray-900 mb-3 dark:text-gray-100">Services</h2>
              <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 dark:border-gray-800 dark:bg-gray-900" data-card>
                {services.map((s) => {
                  const pill = STATUS_PILL[s.status] || STATUS_PILL.unknown;
                  const Icon = pill.icon;
                  return (
                    <div key={s.name} className="p-4 flex items-center justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{s.name}</div>
                        {typeof s.uptime_pct === 'number' && (
                          <div className="text-xs text-gray-500 mt-0.5">{s.uptime_pct.toFixed(2)}% uptime · 90 days</div>
                        )}
                      </div>
                      <UptimeStrip cells={s.history} />
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${pill.color}`}>
                        <Icon size={14} aria-hidden="true" /> {pill.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="incidents">
              <h2 id="incidents" className="text-lg font-semibold text-gray-900 mb-3 dark:text-gray-100">Recent incidents</h2>
              {incidents.length === 0 ? (
                <div className="rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-600 text-center dark:border-gray-800 dark:bg-gray-900" data-card>
                  No incidents in the last 90 days. We'll post updates here when something needs your attention.
                </div>
              ) : (
                <div className="space-y-3">
                  {incidents.map((inc) => (
                    <article key={inc.id} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900" data-card>
                      <header className="flex items-center justify-between gap-3 flex-wrap mb-2">
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100">{inc.title}</h3>
                        <div className="flex items-center gap-2">
                          {SEVERITY_PILL[inc.severity] && (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_PILL[inc.severity].color}`}>
                              {SEVERITY_PILL[inc.severity].label}
                            </span>
                          )}
                          <span className="text-xs text-gray-500">{new Date(inc.created_at).toLocaleString()}</span>
                        </div>
                      </header>
                      <div className="text-sm text-gray-700 mb-3 dark:text-gray-300">Status: <span className="font-medium capitalize">{inc.status.replace(/_/g, ' ')}</span></div>
                      {(inc.updates || []).length > 0 && (
                        <ol className="border-l-2 border-gray-200 pl-4 space-y-3 dark:border-gray-800">
                          {inc.updates.map((u) => (
                            <li key={u.id}>
                              <div className="text-xs uppercase tracking-wide text-gray-500">
                                {u.status.replace(/_/g, ' ')} · {new Date(u.created_at).toLocaleString()}
                              </div>
                              <div className="text-sm text-gray-800 mt-0.5 dark:text-gray-200">{u.body}</div>
                            </li>
                          ))}
                        </ol>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
