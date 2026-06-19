// One of the 10 venture-risk layers: belief statement, risk band, the auto
// proof-signal checklist (with evidence), and — for admin/partner — sticky
// analyst controls (band / score / status / note). Band colours follow the
// emerald/amber/red convention used by FounderRiskBadge.
import React, { useState } from 'react';
import {
  CheckCircle2, CircleDashed, XCircle, HelpCircle, ShieldCheck, ShieldAlert,
  Pencil, Loader2,
} from 'lucide-react';

const BAND = {
  low:    { cls: 'bg-emerald-100 text-emerald-700 border-emerald-300', Icon: ShieldCheck, label: 'Low risk' },
  medium: { cls: 'bg-amber-100 text-amber-700 border-amber-300',       Icon: ShieldAlert, label: 'Medium risk' },
  high:   { cls: 'bg-red-100 text-red-700 border-red-300',             Icon: ShieldAlert, label: 'High risk' },
};

const SIGNAL = {
  met:     { Icon: CheckCircle2, cls: 'text-emerald-600', label: 'Met' },
  partial: { Icon: CircleDashed, cls: 'text-amber-600',   label: 'Partial' },
  missing: { Icon: XCircle,      cls: 'text-red-600',      label: 'Missing' },
  unknown: { Icon: HelpCircle,   cls: 'text-gray-400',     label: 'No data' },
};

const STATUS_LABEL = { open: 'Open', mitigating: 'Mitigating', cleared: 'Cleared' };

export default function RiskLayerCard({ layer, index, canManage = false, onSave }) {
  const band = BAND[layer.band] || BAND.medium;
  const BandIcon = band.Icon;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const ov = layer.override || {};
  const [form, setForm] = useState({
    band: ov.band || layer.band || '',
    score: ov.score != null ? String(ov.score) : '',
    status: ov.status || layer.status || 'open',
    note: ov.note || '',
  });

  const save = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(layer.key, {
        band: form.band || null,
        score: form.score === '' ? null : Number(form.score),
        status: form.status || 'open',
        note: form.note || null,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex-shrink-0 h-7 w-7 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center text-xs font-bold dark:bg-violet-500/20 dark:text-violet-300">
            {index}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{layer.label}</div>
            <div className="text-[11px] text-gray-500 italic">“{layer.belief}”</div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={`text-[11px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${band.cls}`} title={`${band.label} · risk ${layer.risk}/100`}>
            <BandIcon size={11} /> {layer.risk}
          </span>
          {layer.overridden && (
            <span className="text-[9px] uppercase tracking-wide text-violet-600 font-semibold" title="Analyst override applied">
              analyst · {STATUS_LABEL[layer.status] || layer.status}
            </span>
          )}
        </div>
      </div>

      {/* Proof-signal checklist */}
      <ul className="mt-3 space-y-1.5">
        {(layer.signals || []).map((s) => {
          const cfg = SIGNAL[s.status] || SIGNAL.unknown;
          const Icon = cfg.Icon;
          return (
            <li key={s.key} className="flex items-center gap-2 text-[12px]" title={s.evidence}>
              <Icon size={13} className={`flex-shrink-0 ${cfg.cls}`} />
              <span className="text-gray-700 dark:text-gray-300 flex-1 min-w-0 truncate">{s.label}</span>
              {s.value && <span className="text-gray-400 text-[11px] flex-shrink-0">{s.value}</span>}
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-gray-500">{layer.rationale}</span>
        <span className="text-[10px] text-gray-400" title="Share of signals backed by real data">
          {layer.confidence}% data
        </span>
      </div>

      {layer.override?.note && !editing && (
        <div className="mt-2 text-[11px] text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5 dark:bg-gray-800 dark:text-gray-300">
          <span className="font-medium">Note:</span> {layer.override.note}
        </div>
      )}

      {/* Analyst controls (admin/partner only) */}
      {canManage && (
        <div className="mt-3 border-t border-gray-100 pt-2 dark:border-gray-800">
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="text-[11px] text-violet-600 hover:text-violet-700 flex items-center gap-1 font-medium"
            >
              <Pencil size={11} /> {layer.overridden ? 'Edit assessment' : 'Add analyst assessment'}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <label className="text-[10px] text-gray-500">
                  Band
                  <select
                    value={form.band}
                    onChange={(e) => setForm((f) => ({ ...f, band: e.target.value }))}
                    className="mt-0.5 w-full bg-white border border-gray-300 rounded-md px-1.5 py-1 text-xs dark:bg-gray-900 dark:border-gray-700"
                  >
                    <option value="">auto</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="text-[10px] text-gray-500">
                  Risk 0–100
                  <input
                    type="number" min="0" max="100" value={form.score}
                    onChange={(e) => setForm((f) => ({ ...f, score: e.target.value }))}
                    placeholder="auto"
                    className="mt-0.5 w-full bg-white border border-gray-300 rounded-md px-1.5 py-1 text-xs dark:bg-gray-900 dark:border-gray-700"
                  />
                </label>
                <label className="text-[10px] text-gray-500">
                  Status
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    className="mt-0.5 w-full bg-white border border-gray-300 rounded-md px-1.5 py-1 text-xs dark:bg-gray-900 dark:border-gray-700"
                  >
                    <option value="open">Open</option>
                    <option value="mitigating">Mitigating</option>
                    <option value="cleared">Cleared</option>
                  </select>
                </label>
              </div>
              <textarea
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Evidence, mitigation plan, or rationale…"
                rows={2}
                className="w-full bg-white border border-gray-300 rounded-md px-2 py-1 text-xs dark:bg-gray-900 dark:border-gray-700"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="text-xs px-3 py-1 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1"
                >
                  {saving && <Loader2 size={12} className="animate-spin" />} Save
                </button>
                <button onClick={() => setEditing(false)} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { BAND as RISK_BAND_STYLES };
