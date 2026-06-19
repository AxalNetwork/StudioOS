import React, { useEffect, useState, useCallback } from 'react';
import { ShieldAlert, RefreshCw, Info } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import RiskRadar from './RiskRadar';
import RiskLayerCard from './RiskLayerCard';
import { RISK_BAND_CHIP, RISK_BAND_LABEL, RISK_BAND_HEX, layerHasRiskData } from '../lib/riskBands';

// Task #10 — per-company Venture Risk panel (internal deal team only).
//
// Renders the 10-axis radar, an overall de-risking score, and a card per layer
// with the analyst override controls. Reads gate to admin/partner/investor;
// `canWrite` (admin/partner) unlocks the recompute + override controls.

function RiskGauge({ score, band, size = 96, muted = false }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * c;
  const accent = muted ? '#cbd5e1' : (RISK_BAND_HEX[band] || RISK_BAND_HEX.medium);
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="stroke-slate-200 dark:stroke-slate-700"
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth={stroke}
          strokeDasharray={muted ? `0 ${c}` : `${dash} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-slate-900 dark:text-slate-100">{muted ? '—' : score}</span>
        <span className="text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">/ 100</span>
      </span>
    </span>
  );
}

export default function VentureRiskPanel({ projectId, canWrite = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    setUnavailable(false);
    try {
      const res = await api.ventureRiskByProject(projectId);
      setData(res);
    } catch (e) {
      // The venture-risk surface is worker-only (D1); the dev FastAPI backend
      // 404s on the whole prefix. Surface that as an "unavailable in this
      // environment" notice rather than a hard error.
      if (e?.status === 404) {
        setUnavailable(true);
        setData(null);
      } else {
        reportError('VentureRiskPanel:load', e);
        setErr(e?.message || 'Failed to load venture risk.');
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const recompute = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const res = await api.ventureRiskRecompute(projectId);
      setData(res);
    } catch (e) {
      reportError('VentureRiskPanel:recompute', e);
      setErr(e?.message || 'Recompute failed.');
    } finally {
      setBusy(false);
    }
  };

  const saveLayer = async (layerKey, body) => {
    setBusy(true);
    try {
      const res = await api.ventureRiskSetLayer(projectId, layerKey, body);
      setData(res);
    } finally {
      setBusy(false);
    }
  };

  const clearLayer = async (layerKey) => {
    setBusy(true);
    try {
      const res = await api.ventureRiskClearLayer(projectId, layerKey);
      setData(res);
    } finally {
      setBusy(false);
    }
  };

  const hasAnyData = data ? data.layers.some(layerHasRiskData) : false;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6 dark:bg-gray-900 dark:border-slate-700">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-violet-600" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Venture Risk</h3>
          <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">
            Internal
          </span>
        </div>
        {canWrite && data && !unavailable && (
          <button
            type="button"
            onClick={recompute}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 dark:text-slate-200"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            Recompute
          </button>
        )}
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
        The 10-layer rating system. Each layer scores de-risk confidence (0–100, higher = lower risk),
        computed live from platform data and refined by analyst overrides.
      </p>

      {unavailable && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded flex items-start gap-2 text-amber-800 dark:text-amber-200 text-sm">
          <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Venture risk is unavailable in this environment.</div>
            <div>This surface runs on the production worker (D1). It will populate once deployed.</div>
          </div>
        </div>
      )}

      {err && (
        <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded text-rose-700 dark:text-rose-300 text-sm mb-3">
          {err}
        </div>
      )}

      {loading && !data && !unavailable && (
        <div className="py-8 text-center text-slate-400 text-sm">Loading venture risk…</div>
      )}

      {data && !unavailable && (
        <>
          <div className="grid lg:grid-cols-[auto_1fr] gap-6 items-center mb-6">
            <div className="flex items-center gap-4 justify-center lg:justify-start">
              <RiskGauge score={data.overall_score} band={data.overall_band} muted={!hasAnyData} />
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Overall derisking</div>
                {hasAnyData ? (
                  <span className={`inline-flex items-center px-2 py-0.5 mt-1 rounded-full text-xs font-medium border ${RISK_BAND_CHIP[data.overall_band] || RISK_BAND_CHIP.medium}`}>
                    {RISK_BAND_LABEL[data.overall_band] || 'Unknown'}
                  </span>
                ) : (
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-[16rem]">
                    Not enough platform data yet to score this company. Add an analyst override or capture signals to begin.
                  </div>
                )}
                {hasAnyData && data.computed_at && (
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                    Computed {new Date(data.computed_at).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-center">
              <RiskRadar layers={data.layers} band={data.overall_band} size={300} muted={!hasAnyData} />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {data.layers.map((layer) => (
              <RiskLayerCard
                key={layer.key}
                layer={layer}
                canWrite={canWrite}
                onSave={saveLayer}
                onClear={clearLayer}
                busy={busy}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
