// Admin Best-Fit & Consultations — the consultation queue plus the full
// best-fit report for any requesting user: skills radar, Axal values, the
// weighted fit scorecard, the range of matches with reasons/watch-outs/gaps,
// the gaps to fill, and the spin-out (venture-risk) assessment.
import React, { useEffect, useState, useCallback } from 'react';
import { Users, Loader2, CalendarCheck, AlertTriangle, Target, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import SkillRadar from '../components/play/SkillRadar';

const BAND_TONE = {
  strong_yes: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
  yes_caution: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30',
  hold: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30',
  no: 'text-red-600 bg-red-50 dark:bg-red-950/30',
};
const STATUS_TONE = {
  requested: 'bg-amber-100 text-amber-700', confirmed: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700', declined: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-gray-100 text-gray-600',
};
// Venture-risk band: 'high' risk is bad (red), 'low' is good (green).
const RISK_TONE = {
  low: 'bg-emerald-50 text-emerald-700', medium: 'bg-amber-50 text-amber-700', high: 'bg-red-50 text-red-700',
};

function Bar({ label, value, max = 5 }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] text-gray-500 mb-0.5"><span>{label}</span><span>{Number(value).toFixed(1)}</span></div>
      <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full bg-violet-500" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
      </div>
    </div>
  );
}

function ReportView({ data }) {
  if (!data) return null;
  const { report, user } = data;
  const fit = report.fit;
  const skillCount = Object.keys(report.skill_vector || {}).length;
  const spin = report.spinout_assessment;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{user.name}</h2>
          <p className="text-xs text-gray-500 capitalize">{user.role} · persona: {report.persona}</p>
        </div>
        {fit && (
          <div className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${BAND_TONE[fit.band] || BAND_TONE.hold}`}>
            {Math.round(fit.total_score)} · {String(fit.band).replace('_', ' ')}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Skills</div>
          {skillCount > 0 ? <SkillRadar skillVector={report.skill_vector} height={210} /> : <p className="text-xs text-gray-400">No skill signal yet.</p>}
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-2">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Axal values</div>
          {(report.axal_values || []).map((v) => <Bar key={v.key} label={v.label} value={v.score} />)}
        </div>
      </div>

      {fit && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Fit scorecard</div>
          <p className="text-xs text-gray-500 mb-3">{fit.narrative_fit}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(fit.rubric || []).map((r) => (
              <div key={r.key} className="text-[11px] flex justify-between border border-gray-100 dark:border-gray-800 rounded px-2 py-1">
                <span className="text-gray-600 dark:text-gray-400">{r.label}</span>
                <span className="font-semibold">{r.score == null ? '—' : r.score.toFixed(1)}</span>
              </div>
            ))}
          </div>
          {(fit.red_flags || []).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {fit.red_flags.map((f) => (
                <span key={f} className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-600 inline-flex items-center gap-1"><AlertTriangle size={9} /> {String(f).replace(/_/g, ' ')}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5"><Users size={13} /> Range of matches</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(report.matches || []).map((t) => (
            <div key={t.type} className="border border-gray-100 dark:border-gray-800 rounded-lg p-2.5">
              <div className="flex justify-between text-xs font-medium mb-1"><span>{t.label}</span><span className="text-violet-600">{t.count}</span></div>
              {(t.top || []).slice(0, 3).map((m, i) => (
                <div key={i} className="text-[11px] mb-1">
                  <div className="flex justify-between"><span className="text-gray-700 dark:text-gray-300">{m.name}</span><span className="font-semibold text-violet-600">{m.match_score}</span></div>
                  {(m.reasons || []).length > 0 && <div className="text-[10px] text-gray-400 truncate">{m.reasons[0]}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5"><Target size={13} /> Gaps to fill</div>
          {(report.gaps_to_fill || []).length > 0 ? (
            <div className="flex flex-wrap gap-1.5">{report.gaps_to_fill.map((g) => <span key={g} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 capitalize">{String(g).replace(/_/g, ' ')}</span>)}</div>
          ) : <p className="text-xs text-gray-400">No major skill gaps.</p>}
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5"><TrendingUp size={13} /> Spin-out assessment</div>
          {spin && spin.overall_band ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{spin.project_name || 'Venture'}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize ${RISK_TONE[spin.overall_band] || ''}`}>{spin.overall_band} risk</span>
              </div>
              <Bar label="De-risk score" value={spin.derisk_score ?? (100 - (spin.overall_risk ?? 0))} max={100} />
              <p className="text-[11px] text-gray-500">{Math.round(spin.derisk_score ?? 0)}/100 de-risked · {(spin.layers || []).length} risk layers assessed</p>
            </div>
          ) : <p className="text-xs text-gray-400">No project linked — spin-out assessment unavailable.</p>}
        </div>
      </div>
    </div>
  );
}

export default function AdminBestFitPage() {
  const [list, setList] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selected, setSelected] = useState(null);
  const [report, setReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);

  const loadList = useCallback(() => {
    setLoadingList(true);
    api.adminConsultations()
      .then((d) => setList(d.consultations || []))
      .catch(() => setList([]))
      .finally(() => setLoadingList(false));
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  const openReport = async (userId) => {
    setSelected(userId);
    setLoadingReport(true);
    setReport(null);
    try { setReport(await api.adminBestFitReport(userId)); } catch { setReport(null); }
    setLoadingReport(false);
  };

  const setStatus = async (id, status) => {
    try { await api.adminConsultationStatus(id, status); loadList(); } catch { /* no-op */ }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1 flex items-center gap-2"><Users size={22} className="text-violet-600" /> Best-Fit & Consultations</h1>
      <p className="text-sm text-gray-500 mb-5">Consultation requests with the founder’s assembled best-fit report, matches, and spin-out assessment.</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-1 space-y-2">
          <div className="flex items-center justify-between"><span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Requests</span>{loadingList && <Loader2 size={13} className="animate-spin text-gray-400" />}</div>
          {list.length === 0 && !loadingList && <p className="text-xs text-gray-400">No consultation requests yet.</p>}
          {list.map((c) => (
            <button key={c.id} onClick={() => openReport(c.user_id)} className={`w-full text-left border rounded-lg p-3 transition-colors ${selected === c.user_id ? 'border-violet-400 bg-violet-50/50 dark:bg-violet-950/20' : 'border-gray-200 dark:border-gray-800 hover:border-violet-300'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.user_name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_TONE[c.status] || STATUS_TONE.requested}`}>{c.status}</span>
              </div>
              <div className="text-[11px] text-gray-500 capitalize">{c.user_role} · {c.topic || 'consultation'}</div>
              <div className="mt-1.5 flex gap-1">
                {['confirmed', 'completed', 'declined'].map((s) => (
                  <span key={s} role="button" tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setStatus(c.id, s); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setStatus(c.id, s); } }}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">{s}</span>
                ))}
              </div>
            </button>
          ))}
        </div>

        <div className="lg:col-span-2">
          {loadingReport ? (
            <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={15} className="animate-spin" /> Building report…</div>
          ) : report ? (
            <ReportView data={report} />
          ) : (
            <div className="text-sm text-gray-400 flex items-center gap-2 h-40 justify-center border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
              <CalendarCheck size={16} /> Select a request to view its best-fit report.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
