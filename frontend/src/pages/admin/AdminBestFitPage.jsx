// Task #20 — Admin Best-Fit console. Two panes:
//   • a consultation-request queue (admin list + per-request status controls)
//   • the full Best-Fit report for the selected user, rendered against the
//     ACTUAL backend shapes (see services/bestFit.ts + ventureRisk.ts):
//       report = { subject, archetype, primary_persona, skills, values,
//                  axal_values, fit[], matches[], gaps_to_fill[], venture, computed_at }
// The spin-out section uses the real venture-risk field names (overall_score /
// overall_band / overall_color / layers[].{score,band,color,signals,...}).
import React, { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck, Loader2, AlertCircle, RefreshCw, Users, Target, Heart,
  Gauge, Rocket, ChevronRight,
} from 'lucide-react';
import { api } from '../../lib/api';
import SkillRadar from '../../components/play/SkillRadar';
import { archetypeMeta, iconFor, valueLabel, skillLabel, humanize } from '../../lib/assessmentMeta';

const STATUSES = ['requested', 'confirmed', 'completed', 'cancelled'];
const STATUS_CLS = {
  requested: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  confirmed: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  completed: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
  cancelled: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
};
const FIT_BAND_CLS = {
  strong_yes: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700',
  yes_caution: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 border-sky-300 dark:border-sky-700',
  hold: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700',
  no: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700',
};
const MATCH_BAND_CLS = {
  strong: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  good: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
  fair: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  low: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
};
const RISK_COLOR_CLS = {
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};
const RISK_TEXT_CLS = {
  emerald: 'text-emerald-700 dark:text-emerald-300',
  amber: 'text-amber-700 dark:text-amber-300',
  red: 'text-red-700 dark:text-red-300',
};

const CARD = 'rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5';
const SUB = 'text-xs text-gray-500 dark:text-gray-400';
const pct = (v) => `${Math.round((Number(v) || 0) * 100)}%`;
const fmtDate = (s) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(); };

function ErrorNote({ children }) {
  return (
    <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
      <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}
function SectionTitle({ icon: Icon, children, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        {Icon && <Icon size={16} className="text-violet-600 dark:text-violet-400" />}{children}
      </h3>
      {right || null}
    </div>
  );
}

// ── Consultation queue ────────────────────────────────────────────────────────
function ConsultationQueue({ selectedUserId, onSelect }) {
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(() => {
    setRows(null); setError('');
    api.adminListConsultations(filter || undefined)
      .then((res) => setRows(Array.isArray(res) ? res : []))
      .catch((e) => setError(e?.message || 'Failed to load requests'));
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const updateStatus = useCallback(async (id, status) => {
    setSavingId(id);
    try {
      await api.adminUpdateConsultationStatus(id, { status });
      load();
    } catch (e) {
      setError(e?.message || 'Failed to update status');
    } finally {
      setSavingId(null);
    }
  }, [load]);

  return (
    <div className={CARD}>
      <SectionTitle icon={Users} right={
        <button type="button" onClick={load} className="text-gray-400 hover:text-violet-600 dark:hover:text-violet-400" aria-label="Refresh">
          <RefreshCw size={15} />
        </button>
      }>Consultation requests</SectionTitle>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {['', ...STATUSES].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setFilter(s)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filter === s
                ? 'bg-violet-600 border-violet-600 text-white'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >{s ? humanize(s) : 'All'}</button>
        ))}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <div className="py-6 flex justify-center text-gray-400"><Loader2 className="animate-spin" size={18} /></div>}
      {rows && rows.length === 0 && <p className={SUB}>No consultation requests{filter ? ` (${filter})` : ''} yet.</p>}

      {rows && rows.length > 0 && (
        <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {rows.map((r) => {
            const active = Number(r.user_id) === Number(selectedUserId);
            return (
              <li key={r.id} className={`rounded-lg border p-3 ${active ? 'border-violet-500 ring-1 ring-violet-500/40' : 'border-gray-200 dark:border-gray-700'}`}>
                <button type="button" onClick={() => onSelect(r.user_id)} className="w-full text-left">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{r.user_name || `User #${r.user_id}`}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_CLS[r.status] || STATUS_CLS.requested}`}>{r.status}</span>
                  </div>
                  {r.user_email && <p className={`${SUB} truncate`}>{r.user_email}</p>}
                  {r.topic && <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 truncate">“{r.topic}”</p>}
                  <p className={`${SUB} mt-1`}>Requested {fmtDate(r.requested_at || r.created_at)}{r.slot_at ? ` · Slot ${fmtDate(r.slot_at)}` : ''}</p>
                </button>
                <div className="flex items-center gap-2 mt-2">
                  <select
                    value={r.status}
                    disabled={savingId === r.id}
                    onChange={(e) => updateStatus(r.id, e.target.value)}
                    className="text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-2 py-1 disabled:opacity-50"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                  </select>
                  {savingId === r.id && <Loader2 size={13} className="animate-spin text-gray-400" />}
                  <button type="button" onClick={() => onSelect(r.user_id)} className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium text-violet-700 dark:text-violet-300 hover:underline">
                    View report <ChevronRight size={13} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Report sub-views ──────────────────────────────────────────────────────────
function Bar({ value, max = 5, colorCls = 'bg-violet-600 dark:bg-violet-500' }) {
  const w = Math.max(0, Math.min(100, (Number(value) / max) * 100));
  return (
    <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
      <div className={`h-full ${colorCls}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function SkillsBlock({ skills, gaps }) {
  const vec = skills || {};
  const hasData = Object.values(vec).some((v) => Number(v) > 0);
  return (
    <div className={CARD}>
      <SectionTitle icon={Target}>Skills radar</SectionTitle>
      {hasData ? <SkillRadar skillVector={vec} height={240} /> : <p className={SUB}>No skill signal recorded.</p>}
      {Array.isArray(gaps) && gaps.length > 0 && (
        <div className="mt-3">
          <p className={`${SUB} mb-1.5`}>Gaps to fill</p>
          <div className="flex flex-wrap gap-1.5">
            {gaps.map((g) => (
              <span key={g} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">{skillLabel(g)}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ValuesBlock({ values, axalValues }) {
  const entries = Object.entries(values || {});
  const axal = Array.isArray(axalValues) ? axalValues : [];
  return (
    <div className={CARD}>
      <SectionTitle icon={Heart}>Values</SectionTitle>
      {axal.length > 0 && (
        <div className="mb-4">
          <p className={`${SUB} mb-2`}>5 Axal behavioral values</p>
          <ul className="space-y-2">
            {axal.map((v) => (
              <li key={v.value_key}>
                <div className="flex items-center justify-between text-sm mb-0.5">
                  <span className="text-gray-800 dark:text-gray-200">{humanize(v.value_key)}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{(Number(v.score) || 0).toFixed(1)}/5 · conf {pct(v.confidence)}</span>
                </div>
                <Bar value={v.score} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className={`${SUB} mb-2`}>15-dimension lean</p>
      {entries.length === 0 ? <p className={SUB}>No values recorded.</p> : (
        <ul className="space-y-1.5">
          {entries
            .sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1])))
            .slice(0, 15)
            .map(([slug, score]) => (
              <li key={slug} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-700 dark:text-gray-300 truncate">{valueLabel(slug)}</span>
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">{(Number(score) || 0).toFixed(2)}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function FitBlock({ fit, primary }) {
  const list = Array.isArray(fit) ? fit : [];
  return (
    <div className={CARD}>
      <SectionTitle icon={Gauge} right={primary ? <span className={SUB}>Primary: <strong className="text-gray-700 dark:text-gray-200">{humanize(primary)}</strong></span> : null}>
        Axal Fit scorecard
      </SectionTitle>
      {list.length === 0 ? <p className={SUB}>No fit computed (insufficient signal).</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {list.map((f) => (
            <div key={f.persona} className={`rounded-lg border p-3 ${primary === f.persona ? 'ring-1 ring-violet-500/50' : ''} ${FIT_BAND_CLS[f.band] || FIT_BAND_CLS.no}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold capitalize">{humanize(f.persona)}</span>
                <span className="text-lg font-bold">{Math.round(Number(f.total_score) || 0)}<span className="text-xs font-normal">/100</span></span>
              </div>
              <p className="text-xs font-medium mt-0.5">{f.band_label}</p>
              {f.narrative_fit && <p className="text-xs mt-1.5 opacity-90">{f.narrative_fit}</p>}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-[11px] opacity-80">
                <span>Signal {pct(f.signal_quality)}</span>
                <span>Coverage {pct(f.coverage)}</span>
                <span>Confidence {pct(f.mean_confidence)}</span>
              </div>
              {Array.isArray(f.red_flags) && f.red_flags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {f.red_flags.map((rf) => (
                    <span key={rf} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-200/70 dark:bg-red-900/50 text-red-800 dark:text-red-200">⚑ {humanize(rf)}</span>
                  ))}
                </div>
              )}
              {f.rubric && Object.keys(f.rubric).length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {Object.entries(f.rubric).map(([cat, r]) => (
                    <li key={cat} className="flex items-center justify-between text-[11px] opacity-80">
                      <span>{humanize(cat)}{r && r.answered === false ? ' (unanswered)' : ''}</span>
                      <span className="font-medium">{(Number(r?.score) || 0).toFixed(1)}/5</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchesBlock({ matches }) {
  const list = Array.isArray(matches) ? matches : [];
  return (
    <div className={CARD}>
      <SectionTitle icon={Users}>Best-fit matches</SectionTitle>
      {list.length === 0 ? <p className={SUB}>No counterparty pools available.</p> : (
        <div className="space-y-4">
          {list.map((ct) => (
            <div key={ct.type}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{ct.label}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{ct.count} candidate{ct.count === 1 ? '' : 's'}</span>
              </div>
              {(!ct.matches || ct.matches.length === 0) ? (
                <p className={SUB}>No qualifying matches.</p>
              ) : (
                <ul className="space-y-2">
                  {ct.matches.map((m) => (
                    <li key={m.user_id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{m.name || m.uid || `#${m.user_id}`}</span>
                        <span className="flex items-center gap-1.5">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${MATCH_BAND_CLS[m.band] || MATCH_BAND_CLS.low}`}>{humanize(m.band)}</span>
                          <span className="text-sm font-bold text-gray-700 dark:text-gray-200">{Math.round(Number(m.match_score) || 0)}</span>
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                        <span>Values align {(Number(m.values_alignment) || 0).toFixed(2)}</span>
                        <span>Skill complement {Math.round(Number(m.skill_complementarity) || 0)}</span>
                        <span>Overlap {m.overlap}</span>
                      </div>
                      {Array.isArray(m.reasons) && m.reasons.length > 0 && (
                        <ul className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-300 list-disc list-inside space-y-0.5">
                          {m.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                      )}
                      {Array.isArray(m.gaps) && m.gaps.length > 0 && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Gaps: {m.gaps.join(', ')}</p>
                      )}
                      {Array.isArray(m.watch_outs) && m.watch_outs.length > 0 && (
                        <p className="mt-1 text-xs text-red-700 dark:text-red-300">Watch-outs: {m.watch_outs.join(', ')}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VentureBlock({ venture }) {
  if (!venture) return null;
  const layers = Array.isArray(venture.layers) ? venture.layers : [];
  return (
    <div className={CARD}>
      <SectionTitle icon={Rocket} right={
        <span className={`text-sm font-bold ${RISK_TEXT_CLS[venture.overall_color] || ''}`}>{Math.round(Number(venture.overall_score) || 0)}/100 · {humanize(venture.overall_band)}</span>
      }>Spin-out assessment — {venture.project_name || `Project #${venture.project_id}`}</SectionTitle>
      <ul className="space-y-2.5">
        {layers.map((l) => (
          <li key={l.key}>
            <div className="flex items-center justify-between text-sm mb-0.5">
              <span className="text-gray-800 dark:text-gray-200">
                {l.label}{l.is_overridden ? <span className="ml-1 text-[10px] text-violet-600 dark:text-violet-400">(analyst)</span> : null}
              </span>
              <span className={`text-xs font-medium ${l.has_data ? (RISK_TEXT_CLS[l.color] || '') : 'text-gray-400'}`}>
                {l.has_data ? `${Math.round(Number(l.score) || 0)} · ${humanize(l.band)}` : 'No data'}
              </span>
            </div>
            <Bar value={l.has_data ? l.score : 0} max={100} colorCls={l.has_data ? (RISK_COLOR_CLS[l.color] || 'bg-gray-400') : 'bg-gray-300 dark:bg-gray-600'} />
            {Array.isArray(l.signals) && l.signals.length > 0 && (
              <p className={`${SUB} mt-1`}>{l.signals.join(' · ')}</p>
            )}
            {l.analyst_note && <p className="text-xs text-violet-700 dark:text-violet-300 mt-0.5">Note: {l.analyst_note}</p>}
          </li>
        ))}
      </ul>
      <p className={`${SUB} mt-3`}>Computed {fmtDate(venture.computed_at)}</p>
    </div>
  );
}

// ── Report viewer ─────────────────────────────────────────────────────────────
function ReportViewer({ userId }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) { setReport(null); setError(''); return undefined; }
    let alive = true;
    setLoading(true); setError(''); setReport(null);
    api.adminGetBestFitReport(userId)
      .then((r) => { if (alive) setReport(r); })
      .catch((e) => { if (alive) setError(e?.message || 'Failed to load report'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [userId]);

  if (!userId) {
    return (
      <div className={`${CARD} text-center text-sm text-gray-500 dark:text-gray-400 py-16`}>
        Select a consultation request to view that user’s full Best-Fit report.
      </div>
    );
  }
  if (loading) return <div className={`${CARD} py-16 flex justify-center text-gray-400`}><Loader2 className="animate-spin" size={22} /></div>;
  if (error) return <div className={CARD}><ErrorNote>{error}</ErrorNote></div>;
  if (!report) return null;

  const s = report.subject || {};
  const arch = report.archetype;
  const meta = arch ? archetypeMeta(arch.slug) : null;
  const ArchIcon = iconFor(meta?.icon);

  return (
    <div className="space-y-4">
      <div className={CARD}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate">{s.name || `User #${s.user_id}`}</h2>
            <p className={SUB}>{s.email || '—'} · {humanize(s.role || 'member')}{s.uid ? ` · ${s.uid}` : ''}</p>
          </div>
          {arch && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <ArchIcon size={18} style={{ color: meta?.accent || '#7c3aed' }} />
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{arch.label || meta?.label || arch.slug}</span>
            </div>
          )}
        </div>
        <p className={`${SUB} mt-2`}>Report computed {fmtDate(report.computed_at)}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SkillsBlock skills={report.skills} gaps={report.gaps_to_fill} />
        <ValuesBlock values={report.values} axalValues={report.axal_values} />
      </div>
      <FitBlock fit={report.fit} primary={report.primary_persona} />
      <MatchesBlock matches={report.matches} />
      <VentureBlock venture={report.venture} />
    </div>
  );
}

export default function AdminBestFitPage() {
  const [selectedUserId, setSelectedUserId] = useState(null);
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-center gap-2">
        <ShieldCheck size={22} className="text-violet-600 dark:text-violet-400" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Best-Fit Console</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 -mt-3">
        Review consultation requests and open any user’s full Best-Fit report — skills, values, Axal Fit, matches, and spin-out risk.
      </p>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-1">
          <ConsultationQueue selectedUserId={selectedUserId} onSelect={setSelectedUserId} />
        </div>
        <div className="xl:col-span-2">
          <ReportViewer userId={selectedUserId} />
        </div>
      </div>
    </div>
  );
}
