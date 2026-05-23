import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ShieldAlert, ShieldCheck, ShieldQuestion, RefreshCw } from 'lucide-react';

const BAND_STYLES = {
  low:    { cls: 'bg-green-100 text-green-700 border-green-300', Icon: ShieldCheck, label: 'Low risk' },
  medium: { cls: 'bg-yellow-100 text-yellow-700 border-yellow-300', Icon: ShieldAlert, label: 'Medium risk' },
  high:   { cls: 'bg-red-100 text-red-700 border-red-300', Icon: ShieldAlert, label: 'High risk' },
};

export default function FounderRiskBadge({ dealId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState('');
  const popRef = useRef(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    api.getFounderRiskByDeal(dealId)
      .then(d => { if (!cancel) setData(d); })
      .catch(e => { if (!cancel) setError(e.message || 'Failed to load risk'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [dealId]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (popRef.current && !popRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pull = async () => {
    if (!data?.founder_id) return;
    setPulling(true); setError('');
    try {
      await api.pullFounderRisk(data.founder_id);
      const fresh = await api.getFounderRiskByDeal(dealId);
      setData(fresh);
    } catch (e) {
      setError(e.message || 'Pull failed');
    }
    setPulling(false);
  };

  if (loading) {
    return <span className="text-xs text-gray-400 px-2 py-0.5">risk…</span>;
  }
  if (!data || !data.founder_id) return null;

  const profile = data.profile;
  if (!profile) {
    return (
      <button
        onClick={pull}
        disabled={pulling}
        className="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 flex items-center gap-1 disabled:opacity-50 dark:border-gray-700"
        title="Pull founder risk profile from PitchBook"
      >
        <ShieldQuestion size={12} /> {pulling ? 'Pulling…' : 'Pull risk'}
      </button>
    );
  }

  const band = BAND_STYLES[profile.risk_band] || BAND_STYLES.medium;
  const Icon = band.Icon;
  return (
    <div className="relative inline-block" ref={popRef}>
      <button
        onClick={() => setOpen(!open)}
        className={`text-xs px-2 py-0.5 rounded-full border ${band.cls} flex items-center gap-1`}
        title={`${band.label} · score ${profile.risk_score}`}
      >
        <Icon size={12} /> Risk {profile.risk_score} · {profile.risk_band}
      </button>
      {open && (
        <div className="absolute z-30 right-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-left dark:bg-gray-900 dark:border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {data.founder_name || 'Founder'} · risk profile
              </div>
              <div className="text-[11px] text-gray-500">
                Source: {profile.source_provider}
                {profile.pulled_at && ` · pulled ${new Date(profile.pulled_at).toLocaleDateString()}`}
              </div>
            </div>
            <button
              onClick={pull}
              disabled={pulling}
              className="text-gray-400 hover:text-gray-700 disabled:opacity-50"
              title="Re-pull"
            >
              <RefreshCw size={14} className={pulling ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center mb-2">
            <Stat label="Exits" value={profile.exits_count} good />
            <Stat label="Failures" value={profile.failures_count} bad />
            <Stat label="Years" value={profile.domain_expertise_years} />
          </div>

          {profile.domain_tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {profile.domain_tags.map(t => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 dark:text-gray-300">
                  #{t}
                </span>
              ))}
            </div>
          )}

          {profile.notable_signals?.length > 0 && (
            <ul className="text-[11px] text-gray-700 list-disc pl-4 mb-2 space-y-0.5 dark:text-gray-300">
              {profile.notable_signals.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}

          {profile.score_breakdown && (
            <details className="text-[11px] text-gray-600">
              <summary className="cursor-pointer hover:text-gray-900">Score breakdown</summary>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(profile.score_breakdown).map(([k, v]) => (
                  <li key={k} className="flex justify-between">
                    <span>{v.rationale}</span>
                    <span className={v.points > 0 ? 'text-red-700' : v.points < 0 ? 'text-green-700' : 'text-gray-500'}>
                      {v.points > 0 ? '+' : ''}{v.points}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {error && <div className="mt-2 text-[11px] text-red-700">{error}</div>}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, good, bad }) {
  const color = good ? 'text-green-700' : bad ? 'text-red-700' : 'text-gray-900';
  return (
    <div className="border border-gray-200 rounded p-1.5 dark:border-gray-800">
      <div className={`text-base font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] text-gray-500 uppercase">{label}</div>
    </div>
  );
}
