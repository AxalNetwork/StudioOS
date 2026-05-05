import React, { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  BarChart, Bar,
} from 'recharts';
import {
  TrendingUp, Map, Sparkles, Mail, Loader2, AlertCircle, Eye, Check, X,
  Globe, Layers,
} from 'lucide-react';
import { api } from '../lib/api';

const TONES = {
  highlight: 'bg-violet-50 border-violet-200 text-violet-800',
  positive: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  neutral: 'bg-white border-gray-200 text-gray-800',
};

export default function PartnerInsightsPage() {
  const [windowDays, setWindowDays] = useState(180);
  const [heat, setHeat] = useState(null);
  const [trend, setTrend] = useState(null);
  const [feed, setFeed] = useState(null);
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  async function loadAll() {
    setLoading(true); setError(null);
    // Each insights endpoint is independent — if the worker is missing one
    // (404), we still want to render the others. The empty-state cards
    // already cover "no data" so don't surface a raw red banner for 404s.
    // `includes('not found')` (not strict ===) covers backends that prefix
    // the path or other context onto the detail string.
    const quiet404 = (fallback) => (e) => {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg.includes('not found')) return fallback;
      throw e;
    };
    try {
      const [h, t, f, s] = await Promise.all([
        api.insightsHeatmap(windowDays).catch(quiet404({ matrix: [], stages: [], totals_by_category: {}, total_needs: 0 })),
        api.insightsTrends(6).catch(quiet404({ months: [], series: [] })),
        api.insightsFeed(Math.min(windowDays, 365)).catch(quiet404({ items: [], sectors: [], geographies: [] })),
        api.insightsNewsletterStatus().catch(() => ({ active: false })),
      ]);
      setHeat(h); setTrend(t); setFeed(f); setSub(s);
    } catch (e) {
      // A non-404 from one of the insights endpoints reached the outer catch.
      // Classify into fixed friendly strings — never leak raw e.message.
      const status = e?.status;
      if (status === 401 || status === 403) {
        setError('Your session expired. Please sign in again to view insights.');
      } else {
        setError("Couldn't load demand insights right now. Please retry in a moment, or contact support if it persists.");
      }
    }
    finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); /* eslint-disable-line */ }, [windowDays]);

  async function toggleSub() {
    setError(null);
    const wasActive = !!sub?.active;
    try {
      const next = wasActive
        ? await api.insightsNewsletterUnsubscribe()
        : await api.insightsNewsletterSubscribe();
      setSub(next);
    } catch (e) {
      const status = e?.status;
      const msg = (e?.message || '').toLowerCase();
      if (status === 401 || status === 403) {
        setError('Your session expired. Please sign in again to manage your digest subscription.');
      } else if (status === 404 || msg.includes('not found')) {
        setError("The weekly digest isn't available on this deployment yet. Please check back soon, or contact support.");
      } else {
        setError(
          wasActive
            ? "Couldn't unsubscribe right now. Please retry in a moment."
            : "Couldn't subscribe to the weekly digest right now. Please retry in a moment."
        );
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Demand Insights</h1>
          <p className="text-sm text-gray-500 mt-1">Where founder demand is concentrated and how it's trending. Updated live from the needs board.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white">
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 6 months</option>
            <option value={365}>Last 12 months</option>
          </select>
          <button onClick={toggleSub} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border transition ${sub?.active ? 'bg-violet-50 text-violet-700 border-violet-300 hover:bg-violet-100' : 'bg-violet-600 text-white border-violet-600 hover:bg-violet-700'}`}>
            <Mail size={14} /> {sub?.active ? 'Subscribed' : 'Subscribe to weekly digest'}
          </button>
          <button onClick={() => setPreviewOpen(true)} className="text-sm border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-50 flex items-center gap-1.5"><Eye size={14} /> Preview digest</button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-sm">
          <AlertCircle size={14} className="mt-0.5" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading insights…</div>
      ) : (
        <>
          {/* Insight feed */}
          <Section title="What we're seeing" icon={Sparkles}>
            {feed && feed.items.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {feed.items.map((it) => (
                  <div key={it.id} className={`rounded-xl border p-4 ${TONES[it.tone] || TONES.neutral}`}>
                    <div className="text-sm font-semibold">{it.headline}</div>
                    <div className="text-xs mt-1 opacity-80">{it.detail}</div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="Not enough need data yet to surface insights." />
            )}
          </Section>

          {/* Heatmap */}
          <Section title="Demand heatmap — category × stage" icon={Map}>
            <Heatmap heat={heat?.heatmap} />
          </Section>

          {/* Trend */}
          <Section title="Monthly trend" icon={TrendingUp}>
            <TrendChart series={trend?.series || []} />
          </Section>

          {/* Sector & geography */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Section title="Top sectors" icon={Layers}>
              <BreakdownBars rows={heat?.heatmap?.by_sector || []} keyName="sector" />
            </Section>
            <Section title="Top geographies" icon={Globe}>
              <BreakdownBars rows={heat?.heatmap?.by_geography || []} keyName="geography" />
            </Section>
          </div>
        </>
      )}

      {previewOpen && <PreviewModal onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}

function Section({ title, icon: Icon, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><Icon size={14} className="text-violet-600" /> {title}</h2>
      {children}
    </section>
  );
}

// Heatmap — CSS grid w/ value-scaled background. More legible than a recharts hack.
function Heatmap({ heat }) {
  if (!heat || !heat.matrix?.length) return <Empty text="No need data in the selected window." />;
  const max = Math.max(1, ...heat.matrix.flatMap((row) => row.row.map((c) => c.count)));
  const stages = heat.stages;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="text-left text-[11px] uppercase tracking-wide text-gray-500 font-medium pr-3 pb-2">Category</th>
            {stages.map((s) => (
              <th key={s} className="text-[11px] uppercase tracking-wide text-gray-500 font-medium px-2 pb-2 text-center">{s.replace('_', ' ')}</th>
            ))}
            <th className="text-[11px] uppercase tracking-wide text-gray-500 font-medium pl-3 pb-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {heat.matrix.map((row) => (
            <tr key={row.category} className="border-t border-gray-100">
              <td className="py-1.5 pr-3 text-gray-800 font-medium">{row.category.replace('_', ' ')}</td>
              {row.row.map((cell) => {
                const intensity = cell.count / max;
                const bg = intensity === 0 ? '#f9fafb' : `rgba(124,58,237,${0.10 + intensity * 0.8})`;
                const fg = intensity > 0.55 ? '#fff' : '#374151';
                return (
                  <td key={cell.stage} className="px-1 py-1.5">
                    <div title={`${row.category} · ${cell.stage}: ${cell.count}`}
                      style={{ backgroundColor: bg, color: fg }}
                      className="rounded-md text-center py-1.5 font-semibold">
                      {cell.count || ''}
                    </div>
                  </td>
                );
              })}
              <td className="py-1.5 pl-3 text-gray-700 text-right">{heat.totals_by_category?.[row.category] || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-gray-500">
        <span>Less</span>
        <div className="flex">
          {[0.1, 0.25, 0.45, 0.65, 0.85].map((v, i) => (
            <div key={i} className="w-4 h-3" style={{ backgroundColor: `rgba(124,58,237,${v})` }} />
          ))}
        </div>
        <span>More</span>
        <span className="ml-auto">Total: {heat.total_needs}</span>
      </div>
    </div>
  );
}

function TrendChart({ series }) {
  const data = useMemo(() => series.map((s) => ({ month: s.month, total: s.total })), [series]);
  if (!data.length) return <Empty text="No trend data available." />;
  return (
    <div style={{ width: '100%', height: 240 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="total" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} name="New needs" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BreakdownBars({ rows, keyName }) {
  if (!rows.length) return <Empty text="No data." />;
  const data = rows.map((r) => ({ name: r[keyName], count: r.count }));
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 30, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: '#374151' }} />
          <Tooltip />
          <Bar dataKey="count" fill="#7c3aed" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PreviewModal({ onClose }) {
  const [body, setBody] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api.insightsNewsletterPreview()
      .then((r) => setBody(r.body_md))
      .catch((e) => {
        const status = e?.status;
        const msg = (e?.message || '').toLowerCase();
        if (status === 401 || status === 403) {
          setError('Your session expired. Please sign in again to preview the digest.');
        } else if (status === 404 || msg.includes('not found')) {
          setError("The weekly digest isn't available on this deployment yet.");
        } else {
          setError("Couldn't generate a preview right now. Please retry in a moment.");
        }
      });
  }, []);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Mail size={16} className="text-violet-600" /> Weekly digest preview</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5">
          {error && <div className="text-sm text-rose-700">{error}</div>}
          {!body && !error && <div className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Generating…</div>}
          {body && <pre className="text-xs whitespace-pre-wrap bg-gray-50 rounded-lg p-4 border border-gray-100 leading-relaxed">{body}</pre>}
        </div>
      </div>
    </div>
  );
}

function Empty({ text }) {
  return <div className="text-sm text-gray-400 italic py-6 text-center">{text}</div>;
}
