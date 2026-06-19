// Venture Risk panel — the per-company risk surface shown on ProjectDetail for
// the internal deal team (admin/partner/investor). Composes an overall
// Derisking Score gauge, the 10-axis RiskRadar, and the 10 RiskLayerCards.
// Admin/partner can Recompute (re-derive from platform data) and edit any
// layer's analyst assessment.
import React, { useEffect, useState, useCallback } from 'react';
import { ShieldAlert, RefreshCw, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import RiskRadar from './RiskRadar';
import RiskLayerCard from './RiskLayerCard';

// Compact derisking gauge — same SVG-ring approach as TrustScoreBadge, but
// coloured by the venture-risk band (low risk = emerald = good).
function DeriskGauge({ score = 0, band = 'medium' }) {
  const ring = 92, stroke = 8;
  const r = (ring - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * c;
  const strokeCls = band === 'low' ? 'stroke-emerald-500' : band === 'medium' ? 'stroke-amber-500' : 'stroke-red-500';
  const tone = band === 'low' ? 'text-emerald-600' : band === 'medium' ? 'text-amber-600' : 'text-red-600';
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: ring, height: ring }}>
      <svg width={ring} height={ring} className="-rotate-90">
        <circle cx={ring / 2} cy={ring / 2} r={r} className="stroke-slate-200 dark:stroke-slate-700" fill="none" strokeWidth={stroke} />
        <circle cx={ring / 2} cy={ring / 2} r={r} className={strokeCls} fill="none" strokeWidth={stroke} strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold ${tone}`}>{score}</span>
        <span className="text-[9px] text-gray-500 uppercase tracking-wide">derisked</span>
      </span>
    </span>
  );
}

export default function VentureRiskPanel({ projectId }) {
  const { user } = useAuth();
  const canManage = ['admin', 'partner'].includes((user?.role || '').toLowerCase());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.getVentureRisk(projectId)
      .then(setData)
      .catch((e) => setError(e.message || 'Failed to load risk assessment'))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(load, [load]);

  const recompute = async () => {
    setRecomputing(true);
    setError('');
    try {
      setData(await api.computeVentureRisk(projectId));
    } catch (e) {
      setError(e.message || 'Recompute failed');
    } finally {
      setRecomputing(false);
    }
  };

  const saveLayer = async (layerKey, payload) => {
    const updated = await api.setVentureRiskLayer(projectId, layerKey, payload);
    setData(updated);
  };

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading risk assessment…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
        <div className="text-sm text-red-600">{error}</div>
      </div>
    );
  }
  if (!data) return null;

  const cleared = (data.layers || []).filter((l) => l.status === 'cleared').length;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800 mb-6">
      <div className="flex flex-col lg:flex-row lg:items-start gap-5">
        {/* Summary */}
        <div className="flex items-center gap-4 lg:w-72 flex-shrink-0">
          <DeriskGauge score={data.derisk_score} band={data.overall_band} />
          <div>
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
              <ShieldAlert size={14} className="text-violet-600" /> Venture Risk
            </h3>
            <div className="text-xs text-gray-600 mt-1 capitalize">{data.overall_band} risk · {data.derisk_pct}% signals met</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{cleared}/10 layers cleared</div>
            <div className="text-[11px] text-gray-400 mt-1">
              {data.saved ? (data.computed_at ? `Computed ${new Date(data.computed_at).toLocaleDateString()}` : 'Saved') : 'Live preview — not saved'}
            </div>
            {canManage && (
              <button
                onClick={recompute}
                disabled={recomputing}
                className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <RefreshCw size={12} className={recomputing ? 'animate-spin' : ''} /> {recomputing ? 'Recomputing…' : 'Recompute'}
              </button>
            )}
          </div>
        </div>
        {/* Radar */}
        <div className="flex-1 min-w-0">
          <RiskRadar layers={data.layers} />
        </div>
      </div>

      {/* Layer cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
        {(data.layers || []).map((l, i) => (
          <RiskLayerCard key={l.key} layer={l} index={i + 1} canManage={canManage} onSave={saveLayer} />
        ))}
      </div>
    </div>
  );
}
