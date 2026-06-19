import React, { useState } from 'react';
import { Check, Minus, Pencil, X, Trash2, AlertCircle } from 'lucide-react';
import { RISK_BAND_CHIP, RISK_BAND_LABEL } from '../lib/riskBands';

// Task #10 — one Venture Risk layer.
//
// Shows the "what investors must believe" thesis, the proof signal that retires
// the risk, the auto score (live from platform data), the contributing signals
// the platform already has, and — for analysts (admin/partner) — an override
// editor. `layer` is a merged layer from GET /venture-risk/by-project/:id.

const STATUS_OPTIONS = ['open', 'in_review', 'mitigated', 'accepted', 'flagged'];

const STATUS_LABEL = {
  open: 'Open',
  in_review: 'In review',
  mitigated: 'Mitigated',
  accepted: 'Accepted',
  flagged: 'Flagged',
};

function Band({ band }) {
  const cls = RISK_BAND_CHIP[band] || RISK_BAND_CHIP.medium;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>
      {RISK_BAND_LABEL[band] || 'Unknown'}
    </span>
  );
}

export default function RiskLayerCard({ layer, canWrite = false, onSave, onClear, busy = false }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    analyst_score: layer.analyst_score ?? '',
    analyst_band: layer.analyst_band ?? '',
    status: layer.status || 'open',
    analyst_note: layer.analyst_note || '',
  });

  const openEditor = () => {
    setForm({
      analyst_score: layer.analyst_score ?? '',
      analyst_band: layer.analyst_band ?? '',
      status: layer.status || 'open',
      analyst_note: layer.analyst_note || '',
    });
    setError('');
    setEditing(true);
  };

  const submit = async () => {
    setError('');
    let scoreVal = null;
    if (form.analyst_score !== '' && form.analyst_score != null) {
      const n = Number(form.analyst_score);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        setError('Score must be a number between 0 and 100.');
        return;
      }
      scoreVal = n;
    }
    try {
      await onSave(layer.key, {
        analyst_score: scoreVal,
        analyst_band: form.analyst_band || null,
        status: form.status || 'open',
        analyst_note: form.analyst_note ? form.analyst_note.trim() : null,
      });
      setEditing(false);
    } catch (e) {
      setError(e?.message || 'Failed to save override.');
    }
  };

  const clear = async () => {
    setError('');
    try {
      await onClear(layer.key);
      setEditing(false);
    } catch (e) {
      setError(e?.message || 'Failed to clear override.');
    }
  };

  const signals = Array.isArray(layer.signals) ? layer.signals : [];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 dark:bg-gray-900 dark:border-slate-700 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{layer.label}</h4>
            {layer.is_overridden && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
                title="An analyst has overridden the auto score"
              >
                Analyst override
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{layer.score}</span>
          <Band band={layer.band} />
        </div>
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">
        <span className="font-medium text-slate-700 dark:text-slate-300">Investors must believe:</span>{' '}
        {layer.thesis}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        <span className="font-medium text-slate-600 dark:text-slate-300">Proof signal:</span>{' '}
        {layer.proof_signal}
      </p>

      {/* Auto score + contributing signals */}
      <div className="mt-auto">
        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
          <span>
            Auto score:{' '}
            {layer.auto_has_data ? (
              <span className="font-semibold text-slate-700 dark:text-slate-200">{layer.auto_score}</span>
            ) : (
              <span className="italic">no platform data yet</span>
            )}
          </span>
          {layer.status && layer.status !== 'open' && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {STATUS_LABEL[layer.status] || layer.status}
            </span>
          )}
        </div>

        {signals.length > 0 ? (
          <ul className="space-y-0.5 mb-2">
            {signals.map((s, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                <Check size={12} className="mt-0.5 flex-shrink-0 text-emerald-500" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 mb-2">
            <Minus size={12} className="flex-shrink-0" />
            No contributing signals detected yet.
          </div>
        )}

        {layer.is_overridden && layer.analyst_note && (
          <div className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded p-2 mb-2">
            <span className="font-medium">Analyst note:</span> {layer.analyst_note}
          </div>
        )}

        {canWrite && !editing && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openEditor}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Pencil size={11} /> {layer.is_overridden ? 'Edit override' : 'Override'}
            </button>
            {layer.is_overridden && (
              <button
                type="button"
                onClick={clear}
                disabled={busy}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-900/20"
              >
                <Trash2 size={11} /> Clear
              </button>
            )}
          </div>
        )}

        {canWrite && editing && (
          <div className="mt-1 border-t border-slate-100 dark:border-slate-800 pt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Score (0–100)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.analyst_score}
                  onChange={(e) => setForm((f) => ({ ...f, analyst_score: e.target.value }))}
                  placeholder="auto"
                  className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:bg-gray-800 dark:border-slate-700 dark:text-slate-100"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Band</span>
                <select
                  value={form.analyst_band}
                  onChange={(e) => setForm((f) => ({ ...f, analyst_band: e.target.value }))}
                  className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:bg-gray-800 dark:border-slate-700 dark:text-slate-100"
                >
                  <option value="">Auto</option>
                  <option value="low">Low risk</option>
                  <option value="medium">Medium risk</option>
                  <option value="high">High risk</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Status</span>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:bg-gray-800 dark:border-slate-700 dark:text-slate-100"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Note</span>
              <textarea
                rows={2}
                value={form.analyst_note}
                onChange={(e) => setForm((f) => ({ ...f, analyst_note: e.target.value }))}
                placeholder="Rationale for the override…"
                className="w-full px-2 py-1 text-xs rounded border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:bg-gray-800 dark:border-slate-700 dark:text-slate-100"
              />
            </label>
            {error && (
              <div className="flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400">
                <AlertCircle size={12} /> {error}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => { setEditing(false); setError(''); }}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <X size={11} /> Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
