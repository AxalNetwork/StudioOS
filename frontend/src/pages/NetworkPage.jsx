import React, { useEffect, useRef, useState } from 'react';
import { Network as NetworkIcon, Trophy, DollarSign, Users } from 'lucide-react';
import { api } from '../lib/api';

const VIS_CSS = 'https://unpkg.com/vis-network/styles/vis-network.min.css';
const VIS_JS = 'https://unpkg.com/vis-network/standalone/umd/vis-network.min.js';

function loadVis() {
  return new Promise((resolve, reject) => {
    if (window.vis) return resolve(window.vis);
    if (!document.querySelector(`link[href="${VIS_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = VIS_CSS;
      document.head.appendChild(link);
    }
    const existing = document.querySelector(`script[src="${VIS_JS}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.vis));
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = VIS_JS;
    s.onload = () => resolve(window.vis);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

const ROLE_COLORS = {
  admin: { bg: '#7c3aed', border: '#5b21b6' },
  founder: { bg: '#3b82f6', border: '#1d4ed8' },
  partner: { bg: '#10b981', border: '#047857' },
};

export default function NetworkPage() {
  const containerRef = useRef(null);
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api.networkGraph();
        setGraph(data);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (!graph || !containerRef.current) return;
    let networkInstance;
    (async () => {
      try {
        const vis = await loadVis();
        const nodes = new vis.DataSet(
          graph.nodes.map(n => {
            const palette = ROLE_COLORS[n.role] || ROLE_COLORS.partner;
            const earned = (n.earned_cents || 0) / 100;
            const size = 18 + Math.min(28, Math.sqrt(earned));
            return {
              id: n.id,
              label: n.is_self ? `★ ${n.label}` : n.label,
              title: `${n.label}\n${n.email}\nRole: ${n.role}\nKYC: ${n.kyc_status || 'n/a'}\nEarned: $${earned.toFixed(2)}`,
              color: n.is_self
                ? { background: '#fbbf24', border: '#b45309' }
                : { background: palette.bg, border: palette.border },
              font: { color: n.is_self ? '#000' : '#fff', size: 12, face: 'Inter, sans-serif' },
              size,
              shape: 'dot',
            };
          })
        );
        const edges = new vis.DataSet(
          graph.edges.map(e => ({
            id: e.id, from: e.from, to: e.to,
            arrows: 'to',
            color: e.status === 'converted' ? '#10b981' : e.status === 'approved' ? '#3b82f6' : '#9ca3af',
            width: e.status === 'converted' ? 3 : 1.5,
            dashes: e.status === 'pending',
          }))
        );
        networkInstance = new vis.Network(containerRef.current, { nodes, edges }, {
          physics: { stabilization: { iterations: 200 }, barnesHut: { gravitationalConstant: -8000 } },
          nodes: { borderWidth: 2 },
          interaction: { hover: true, tooltipDelay: 150 },
        });
      } catch (e) {
        setError('Failed to load graph library: ' + e.message);
      }
    })();
    return () => { try { networkInstance?.destroy(); } catch {} };
  }, [graph]);

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading network…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  const fmt = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <NetworkIcon className="text-violet-600" size={24} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Referral Network</h1>
          <p className="text-sm text-gray-600">Interactive graph of your referral subtree. Edges show relationships; node size reflects commissions earned.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div ref={containerRef} style={{ width: '100%', height: '600px' }} />
          <div className="px-4 py-2 border-t border-gray-200 flex flex-wrap items-center gap-4 text-[11px] text-gray-600">
            <Legend color="#fbbf24" label="You" />
            <Legend color="#7c3aed" label="Admin" />
            <Legend color="#3b82f6" label="Founder" />
            <Legend color="#10b981" label="Partner" />
            <span className="ml-auto">Edge: solid = approved, green = converted, dashed = pending</span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="text-amber-500" size={18} />
            <h2 className="text-sm font-semibold text-gray-900">Top Referrers</h2>
          </div>
          {(!graph.top_referrers || graph.top_referrers.length === 0) ? (
            <p className="text-xs text-gray-500">No referrers yet.</p>
          ) : (
            <ol className="space-y-3">
              {graph.top_referrers.map((r, i) => (
                <li key={r.user_id} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-gray-300 text-gray-800' : i === 2 ? 'bg-orange-400 text-white' : 'bg-gray-100 text-gray-600'
                  }`}>{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-900 truncate">{r.name}</div>
                    <div className="text-[11px] text-gray-500 flex items-center gap-2">
                      <span className="flex items-center gap-0.5"><Users size={10} /> {r.referral_count}</span>
                      <span className="flex items-center gap-0.5"><DollarSign size={10} /> {fmt(r.earned_cents)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <div className="mt-6 pt-4 border-t border-gray-200">
            <div className="text-[11px] text-gray-500">
              <div>Total nodes: <span className="font-medium text-gray-700">{graph.nodes.length}</span></div>
              <div>Total edges: <span className="font-medium text-gray-700">{graph.edges.length}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
