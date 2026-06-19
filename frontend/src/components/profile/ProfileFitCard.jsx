// "Your Profile & Fit" — the consolidated dashboard surface for the
// conversational assessment. Shows the 8-axis skills radar, the 5 Axal
// behavioral values, the "where you lean" value spectrums, and the fit
// scorecard band. Replaces the standalone Skills + Values pages. Visible to
// all roles; nudges the user into the Personal Advisor conversation when empty.
import React, { useEffect, useState } from 'react';
import { Sparkles, Loader2, ArrowUp } from 'lucide-react';
import { api } from '../../lib/api';
import SkillRadar from '../play/SkillRadar';

const LEAN_LABELS = {
  founder_mission_vs_profit: ['Profit', 'Mission'],
  founder_speed_vs_quality: ['Quality', 'Speed'],
  founder_risk_appetite: ['Risk-averse', 'Risk-seeking'],
  founder_growth_vs_sustain: ['Sustainable', 'Hyper-growth'],
  founder_autonomy_vs_structure: ['Structure', 'Autonomy'],
};

const BAND_STYLE = {
  strong_yes:  { ring: 'stroke-emerald-500', tone: 'text-emerald-600' },
  yes_caution: { ring: 'stroke-blue-500',    tone: 'text-blue-600' },
  hold:        { ring: 'stroke-amber-500',   tone: 'text-amber-600' },
  no:          { ring: 'stroke-red-500',     tone: 'text-red-600' },
};

function FitGauge({ score = 0, band = 'hold', label }) {
  const ring = 84, stroke = 8, r = (ring - stroke) / 2, c = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * c;
  const s = BAND_STYLE[band] || BAND_STYLE.hold;
  return (
    <div className="flex flex-col items-center">
      <span className="relative inline-flex items-center justify-center" style={{ width: ring, height: ring }}>
        <svg width={ring} height={ring} className="-rotate-90">
          <circle cx={ring / 2} cy={ring / 2} r={r} className="stroke-slate-200 dark:stroke-slate-700" fill="none" strokeWidth={stroke} />
          <circle cx={ring / 2} cy={ring / 2} r={r} className={s.ring} fill="none" strokeWidth={stroke} strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center text-xl font-bold ${s.tone}`}>{score}</span>
      </span>
      {label && <span className={`text-[11px] mt-1 font-medium ${s.tone}`}>{label}</span>}
    </div>
  );
}

function Bar({ label, value, max = 5 }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="flex justify-between text-[10px] text-gray-500 mb-0.5"><span>{label}</span><span>{value.toFixed(1)}</span></div>
      <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-violet-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LeanRow({ dimKey, value }) {
  const [low, high] = LEAN_LABELS[dimKey] || [dimKey, ''];
  const pct = ((value + 2) / 4) * 100; // −2..+2 → 0..100
  return (
    <div>
      <div className="flex justify-between text-[10px] text-gray-500 mb-0.5"><span>{low}</span><span>{high}</span></div>
      <div className="relative h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full">
        <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-violet-600 -ml-1.25" style={{ left: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ProfileFitCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    api.advisor.fit()
      .then((d) => { if (!cancel) setData(d); })
      .catch(() => { if (!cancel) setData(null); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading your profile…</div>
      </div>
    );
  }
  if (!data) return null;

  const skillCount = Object.keys(data.skill_vector || {}).length;
  const completion = data.completion ?? 0;

  if (skillCount === 0 && completion === 0) {
    return (
      <div className="bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/20 dark:to-gray-900 border border-violet-200 dark:border-violet-900/40 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={16} className="text-violet-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Your Profile & Fit</h3>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-1">
          <ArrowUp size={13} /> Chat with your Personal Advisor above — a few quick questions build your skills radar, values, and fit.
        </p>
      </div>
    );
  }

  const axalValues = data.axal_values || [];
  const lean = data.value_lean || {};
  const leanKeys = Object.keys(LEAN_LABELS).filter((k) => k in lean);

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Sparkles size={15} className="text-violet-600" /> Your Profile & Fit
        </h3>
        <span className="text-[11px] text-gray-400">{completion}% complete</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Skills radar */}
        <div className="lg:col-span-1">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Skills</div>
          {skillCount > 0 ? <SkillRadar skillVector={data.skill_vector} height={200} /> : <p className="text-xs text-gray-400">Keep chatting to fill your radar.</p>}
        </div>

        {/* Axal values + fit */}
        <div className="lg:col-span-1 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">Axal values</div>
          {axalValues.map((v) => <Bar key={v.key} label={v.label} value={v.score} />)}
        </div>

        {/* Fit gauge + lean */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          {data.fit ? (
            <div className="flex items-center gap-3">
              <FitGauge score={Math.round(data.fit.total_score)} band={data.fit.band} label={data.fit.band_label} />
              <p className="text-[11px] text-gray-500 flex-1">{data.fit.narrative_fit}</p>
            </div>
          ) : (
            <p className="text-xs text-gray-400">Answer a few scorecard questions to see your fit.</p>
          )}
          {leanKeys.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Where you lean</div>
              {leanKeys.map((k) => <LeanRow key={k} dimKey={k} value={lean[k]} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
