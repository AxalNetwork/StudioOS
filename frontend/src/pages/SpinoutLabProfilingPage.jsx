// Spin-Out Lab "Profiling" tool page — founder profiling report per the design
// handoff (Profiling .dc / repo spin-out-lab-pipeline/project). Every element
// is live data; nothing is fabricated:
//   - Skills come from /skills/taxonomy + /skills/me (self-ratings 0–5). The
//     radar shows the real radar-axis categories; "% assessed" is the actual
//     rated-skill coverage. Strongest / least evidenced come from real scores.
//   - Values come from /values/me (Worker-only; the dev API lacks it, so the
//     section degrades to an explicit "not available" state rather than fake
//     bars). Bar = signal strength (|score| / 2); chip = stored confidence.
//   - Archetype comes from /assessment/results/me (read-only results store)
//     plus the shared ARCHETYPES display copy. The design's fabricated
//     secondary/blend, strengths, blind-spot and complement copy has no data
//     source and is NOT reproduced — implications are derived from the real
//     lowest-evidenced skill dimensions instead.
//   - "Next best questions" become real gap-driven actions (unrated skill
//     dimensions, missing values survey, missing archetype) that link to the
//     real Studio (/studio — the skills + values profile builder).
//   - Profile evolution lists real timestamps only (ratings updated_at,
//     values updated_at, assessment created_at). No invented dates.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Fingerprint,
  Loader2,
  Lock,
  Sparkles,
} from 'lucide-react';
import { api, assessment } from '../lib/api';
import { spinoutLab } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { useAuth } from '../hooks/useAuthSync';
import { reportError } from '../lib/log';
import { archetypeMeta } from '../lib/assessmentMeta';

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm';

// Confidence band from a 0–100 pct. Thresholds match the platform's loose
// High/Medium/Low language (values confidence is stored 0–1; results 0–1).
export function confidenceBand(pct) {
  const n = Number(pct) || 0;
  if (n >= 75) return 'High';
  if (n >= 45) return 'Medium';
  return 'Low';
}
const BAND_TEXT = {
  High: 'text-emerald-700 dark:text-emerald-400',
  Medium: 'text-amber-700 dark:text-amber-400',
  Low: 'text-gray-400 dark:text-gray-500',
};
const BAND_BAR = { High: 'bg-emerald-500', Medium: 'bg-amber-500', Low: 'bg-violet-300 dark:bg-violet-700' };

// Pure: taxonomy categories + self-ratings → per-dimension model.
// Category score = mean self_level of its RATED skills, as a 0–100 pct of the
// 0–5 scale; categories with no rated skills have score:null (never faked to 0
// in lists — the radar plots them at 0 with an explicit unrated note).
export function buildSkillsModel(categories = [], ratings = []) {
  // Malformed ratings (missing/non-numeric self_level) are ignored rather
  // than counted as assessed zeroes.
  const cleanRatings = (Array.isArray(ratings) ? ratings : []).filter(
    (r) => r && Number.isFinite(Number(r.self_level)),
  );
  const bySkill = new Map(cleanRatings.map((r) => [r.skill_id, r]));
  let total = 0;
  let rated = 0;
  const dims = (Array.isArray(categories) ? categories : []).map((c) => {
    const skills = Array.isArray(c.skills) ? c.skills : [];
    total += skills.length;
    const levels = skills
      .map((s) => bySkill.get(s.id))
      .filter(Boolean)
      .map((r) => Math.max(0, Math.min(5, Number(r.self_level))));
    rated += levels.length;
    const score = levels.length
      ? Math.round((levels.reduce((a, b) => a + b, 0) / levels.length / 5) * 100)
      : null;
    return {
      slug: c.slug,
      label: c.label,
      isAxis: !!c.is_radar_axis,
      skillCount: skills.length,
      ratedCount: levels.length,
      score,
    };
  });
  const assessedPct = total ? Math.round((rated / total) * 100) : 0;
  const scored = dims.filter((d) => d.score != null);
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  return {
    dims,
    totalSkills: total,
    ratedSkills: rated,
    assessedPct,
    strongest: ranked.slice(0, 3),
    weakest: ranked.length > 3 ? ranked.slice(-3).reverse() : [],
    unrated: dims.filter((d) => d.score == null),
  };
}

// Pure: real profile events, newest first. Only sources with actual
// timestamps produce entries — no invented dates.
export function buildEvolution({ ratings = [], values = null, results = [] } = {}) {
  const events = [];
  const safeRatings = Array.isArray(ratings) ? ratings : [];
  const ratingDates = safeRatings.map((r) => r?.updated_at).filter(Boolean).sort();
  if (ratingDates.length) {
    events.push({
      key: 'skills',
      title: 'Skills self-ratings updated',
      date: ratingDates[ratingDates.length - 1],
      detail: `${safeRatings.length} skill${safeRatings.length === 1 ? '' : 's'} rated.`,
    });
  }
  if (values && !values.unavailable && !values.failed && values.updated_at) {
    events.push({
      key: 'values',
      title: 'Values profile updated',
      date: values.updated_at,
      detail: `${(Array.isArray(values.vector) ? values.vector : []).length} working-principle dimensions measured.`,
    });
  }
  (Array.isArray(results) ? results : []).forEach((r, i) => {
    if (!r?.created_at) return;
    events.push({
      key: `result-${r.session_id || i}`,
      title: r.archetype_label ? `Archetype assessed → ${r.archetype_label}` : 'Assessment session recorded',
      date: r.created_at,
      detail: r.confidence != null ? `${Math.round(Number(r.confidence) * 100)}% confidence.` : '',
    });
  });
  return events.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Inline SVG radar over the live radar-axis dimensions (the shared SkillRadar
// component is fixed to the 8 canonical assessment axes; this page plots the
// live skills taxonomy instead, which can differ per environment).
function TaxonomyRadar({ dims }) {
  const axes = dims.filter((d) => d.isAxis);
  if (axes.length < 3) return null;
  const cx = 210;
  const cy = 140;
  const R = 92;
  const n = axes.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const ring = (f) =>
    axes.map((_, i) => pt(i, R * f).map((v) => v.toFixed(1)).join(' ')).join(' L ');
  const poly = axes
    .map((d, i) => pt(i, (R * (d.score || 0)) / 100).map((v) => v.toFixed(1)).join(' '))
    .join(' L ');
  return (
    <svg width="420" height="290" viewBox="0 0 420 290" className="max-w-full" data-testid="skills-radar">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <path key={f} d={`M ${ring(f)} Z`} fill="none" stroke="#94a3b8" strokeOpacity="0.35" />
      ))}
      {axes.map((d, i) => {
        const [x, y] = pt(i, R);
        const [lx, ly] = pt(i, R + 16);
        const anchor = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
        return (
          <g key={d.slug}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="#94a3b8" strokeOpacity="0.35" />
            <text x={lx} y={ly + 3} fontSize="10" fill="#94a3b8" textAnchor={anchor}>
              {d.label}{d.score == null ? ' *' : ''}
            </text>
          </g>
        );
      })}
      <path d={`M ${poly} Z`} fill="rgba(124,58,237,.18)" stroke="#7c3aed" strokeWidth="2" />
      {axes.map((d, i) => {
        const [x, y] = pt(i, (R * (d.score || 0)) / 100);
        return <circle key={d.slug} cx={x} cy={y} r="3" fill="#7c3aed" />;
      })}
    </svg>
  );
}

function Bar({ pct, band }) {
  return (
    <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
      <div
        className={`h-full rounded-full ${BAND_BAR[band] || 'bg-violet-500'}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

export default function SpinoutLabProfilingPage() {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [skills, setSkills] = useState(null); // {categories, ratings} | {error}
  const [values, setValues] = useState(null); // {vector,...} | {unavailable} | {empty}
  const [results, setResults] = useState(null); // [..] | {unavailable}
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        // Worker-only in production; the dev API lacks /api/values and
        // /api/assessment. ONLY a 404 means "capability not in this
        // environment" — any other failure (500, network, auth) is a real
        // error and must not be presented as unavailable.
        const wkOnly = (e) => (e?.status === 404 ? { unavailable: true } : { failed: true });
        const [st, tax, mine, vals, res] = await Promise.all([
          spinoutLab.state(),
          api.skills.getTaxonomy().catch(() => null),
          api.skills.getMySkills().catch(() => null),
          api.values.getMe().catch(wkOnly),
          assessment.myResults().catch(wkOnly),
        ]);
        if (dead) return;
        setState(st);
        setSkills(
          tax && mine
            ? {
                categories: Array.isArray(tax.categories) ? tax.categories : [],
                ratings: Array.isArray(mine.ratings) ? mine.ratings : [],
              }
            : { error: true },
        );
        setValues(vals);
        setResults(res?.unavailable || res?.failed ? res : Array.isArray(res?.results) ? res.results : []);
        setStatus('ready');
      } catch (e) {
        if (!dead) {
          reportError(e);
          setStatus('error');
        }
      }
    })();
    return () => { dead = true; };
  }, []);

  const model = useMemo(
    () => (skills && !skills.error ? buildSkillsModel(skills.categories, skills.ratings) : null),
    [skills],
  );

  const valuesRows = useMemo(() => {
    if (!values || values.unavailable || values.failed) return null;
    return (Array.isArray(values.vector) ? values.vector : [])
      .map((v) => {
        const conf = Math.round((Number(v.confidence) || 0) * 100);
        const strength = Math.round((Math.abs(Number(v.score) || 0) / 2) * 100);
        return { slug: v.dimension_slug, label: v.dimension_label || v.dimension_slug, strength, conf, band: confidenceBand(conf) };
      })
      .sort((a, b) => b.strength - a.strength);
  }, [values]);

  const latestResult = useMemo(() => {
    if (!Array.isArray(results) || !results.length) return null;
    return [...results].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
  }, [results]);
  const archMeta = latestResult ? archetypeMeta(latestResult.archetype_slug) : null;
  const archConfPct = latestResult?.confidence != null ? Math.round(Number(latestResult.confidence) * 100) : null;

  // Profile completion — a derived composite, weights documented on-page:
  // 40% skills coverage, 40% values coverage (mean stored confidence),
  // 20% archetype (its stored confidence when a result exists).
  const valuesPct = valuesRows?.length
    ? Math.round(valuesRows.reduce((a, v) => a + v.conf, 0) / valuesRows.length)
    : 0;
  const completion = model
    ? Math.round(model.assessedPct * 0.4 + valuesPct * 0.4 + (archConfPct || 0) * 0.2)
    : 0;
  const overallBand = confidenceBand(completion);

  // W1 deliverable — the assessment counts as complete only when all three
  // real components exist: skills rated, values vector, archetype result.
  useEffect(() => {
    if (status !== 'ready') return;
    const complete = model && model.assessedPct >= 75 && valuesRows?.length > 0 && latestResult;
    if (complete) markMilestone(user, 'profiling_completed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, model?.assessedPct, valuesRows?.length, latestResult?.id]);

  const evolution = useMemo(
    () =>
      buildEvolution({
        ratings: skills && !skills.error ? skills.ratings : [],
        values,
        results: Array.isArray(results) ? results : [],
      }),
    [skills, values, results],
  );
  const lastUpdated = evolution[0]?.date || null;

  // Gap-driven next actions — the honest version of the design's AI-written
  // "next best questions" (there is no question-recommendation source).
  const nextActions = useMemo(() => {
    const acts = [];
    if (model) {
      // Any dimension with unrated skills is a real coverage gap — fully
      // unrated dimensions first, then the most incomplete ones.
      const gaps = model.dims
        .filter((d) => d.ratedCount < d.skillCount)
        .sort((a, b) => (b.skillCount - b.ratedCount) - (a.skillCount - a.ratedCount) || (a.ratedCount === 0 ? -1 : 1));
      gaps.slice(0, 2).forEach((d) =>
        acts.push({
          key: `rate-${d.slug}`,
          label: `Rate your ${d.label} skills (${d.skillCount - d.ratedCount} unrated)`,
          improves: 'Skills graph coverage',
        }),
      );
      if (!model.ratedSkills)
        acts.splice(0, acts.length, { key: 'rate-first', label: 'Rate your first skills', improves: 'Skills graph coverage' });
    }
    // Only genuinely-empty states become actions — unavailable/error states
    // are explained in their sections and would dead-end in Studio here.
    if (valuesRows && !valuesRows.length)
      acts.push({ key: 'values', label: 'Complete the values survey', improves: 'Values graph confidence' });
    if (Array.isArray(results) && !latestResult)
      acts.push({ key: 'archetype', label: 'Finish the assessment to unlock your archetype', improves: 'Archetype + matching reliability' });
    return acts.slice(0, 3);
  }, [model, valuesRows, latestResult, results]);

  if (status === 'loading')
    return (
      <div className="flex items-center justify-center py-32" data-testid="profiling-loading">
        <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
      </div>
    );
  if (status === 'error')
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center" data-testid="profiling-error">
        <p className="text-sm text-gray-500 dark:text-gray-400">Couldn't load your profiling report. Please retry.</p>
      </div>
    );
  if (!state?.active)
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center" data-testid="profiling-inactive">
        <Lock className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Profiling is part of the Spin-Out Lab. <Link to="/spinout-lab" className="text-violet-600 dark:text-violet-400 font-semibold">Go to the Lab</Link>
        </p>
      </div>
    );

  const name = user?.name || user?.email || 'Founder';

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5" data-testid="page-spinout-profiling">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link
            to="/spinout-lab"
            data-testid="link-back-workspace"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[13px] font-semibold text-gray-600 dark:text-gray-300"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Workspace
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Profiling</h1>
              <span className="text-[10.5px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40 rounded-full px-2.5 py-0.5">Active</span>
            </div>
            <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">
              Founder profiling report — skills, values, archetypes, and assessment progress.
            </p>
          </div>
        </div>
        <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border border-violet-100 dark:border-violet-800 rounded-full px-3 py-1.5">
          Foundational · Wk 1
        </span>
      </div>

      {/* Profile summary */}
      <div className={`${CARD} flex items-center gap-6 flex-wrap`} data-testid="profile-summary">
        <div className="relative w-[104px] h-[104px] flex-none">
          <svg width="104" height="104" viewBox="0 0 104 104" className="-rotate-90">
            <circle cx="52" cy="52" r="46" fill="none" className="stroke-gray-100 dark:stroke-gray-800" strokeWidth="10" />
            <circle
              cx="52" cy="52" r="46" fill="none" stroke="#7c3aed" strokeWidth="10" strokeLinecap="round"
              strokeDasharray={`${((completion / 100) * 2 * Math.PI * 46).toFixed(1)} ${(2 * Math.PI * 46).toFixed(1)}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-violet-600 dark:text-violet-400 tabular-nums" data-testid="text-completion">{completion}%</span>
            <span className="text-[10px] text-gray-400">complete</span>
          </div>
        </div>
        <div className="flex-1 min-w-[260px]">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-base font-extrabold text-gray-900 dark:text-gray-50" data-testid="text-founder-name">{name}</span>
            <span className="text-[10.5px] font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 rounded-full px-2.5 py-0.5">
              {overallBand} confidence
            </span>
          </div>
          <p className="text-[13.5px] text-gray-600 dark:text-gray-300 leading-relaxed mb-3" data-testid="text-summary-line">
            {model
              ? `Your profile is ${completion}% complete — ${model.ratedSkills} of ${model.totalSkills} skills rated${
                  model.strongest.length ? `, self-rated strongest in ${model.strongest.map((s) => s.label.toLowerCase()).join(' and ')}` : ''
                }.${values?.unavailable ? ' Values and archetype assessments are not available in this environment yet.' : values?.failed ? ' Values and archetype data could not be loaded right now.' : ''}`
              : 'Skills data could not be loaded.'}
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              to="/studio"
              data-testid="link-open-studio"
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-bold"
            >
              Continue in Studio <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <span className="text-[11.5px] text-gray-400 dark:text-gray-500">
              {lastUpdated ? `Last updated ${fmtDate(lastUpdated)} · ` : ''}Studio is where you answer questions; this is where you see results.
            </span>
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={CARD} data-testid="kpi-skills-rated">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold text-gray-900 dark:text-gray-50 tabular-nums">{model ? `${model.ratedSkills} / ${model.totalSkills}` : '—'}</span>
          </div>
          <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-1">Skills rated</div>
          <div className="mt-2"><Bar pct={model?.assessedPct || 0} band="High" /></div>
        </div>
        <div className={CARD} data-testid="kpi-skills-graph">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold text-gray-900 dark:text-gray-50 tabular-nums">{model ? `${model.assessedPct}%` : '—'}</span>
            <span className={`text-[10px] font-bold ${BAND_TEXT[confidenceBand(model?.assessedPct || 0)]}`}>{model ? confidenceBand(model.assessedPct) : ''}</span>
          </div>
          <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-1">Skills graph assessed</div>
          <div className="mt-2"><Bar pct={model?.assessedPct || 0} band={confidenceBand(model?.assessedPct || 0)} /></div>
        </div>
        <div className={CARD} data-testid="kpi-values-graph">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold text-gray-900 dark:text-gray-50 tabular-nums">{valuesRows?.length ? `${valuesPct}%` : '—'}</span>
            <span className={`text-[10px] font-bold ${valuesRows?.length ? BAND_TEXT[confidenceBand(valuesPct)] : values?.failed ? 'text-rose-500' : 'text-gray-400'}`}>
              {values?.unavailable ? 'Unavailable' : values?.failed ? 'Load failed' : valuesRows?.length ? confidenceBand(valuesPct) : 'Not taken'}
            </span>
          </div>
          <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-1">Values graph confidence</div>
          <div className="mt-2"><Bar pct={valuesRows?.length ? valuesPct : 0} band={confidenceBand(valuesPct)} /></div>
        </div>
        <div className={CARD} data-testid="kpi-archetype">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold text-gray-900 dark:text-gray-50 truncate">{archMeta?.label || latestResult?.archetype_label || '—'}</span>
            {archConfPct != null && <span className={`text-[10px] font-bold ${BAND_TEXT[confidenceBand(archConfPct)]}`}>{archConfPct}%</span>}
          </div>
          <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-1">Archetype</div>
          <div className="mt-2"><Bar pct={archConfPct || 0} band={confidenceBand(archConfPct || 0)} /></div>
        </div>
      </div>

      {/* Skills + Values */}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <div className={CARD} data-testid="card-skills-graph">
          <div className="flex items-center justify-between mb-1">
            <div className={LBL}>Skills graph</div>
            {model && (
              <span className={`text-[10.5px] font-bold rounded-full px-2 py-0.5 ${model.assessedPct >= 75 ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30' : 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30'}`}>
                {model.assessedPct}% assessed
              </span>
            )}
          </div>
          <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-3">
            Radar of {model?.dims.filter((d) => d.isAxis).length || 0} founder skill dimensions, from your Studio self-ratings.
          </p>
          {model ? (
            <>
              <div className="flex justify-center mb-3"><TaxonomyRadar dims={model.dims} /></div>
              {model.unrated.length > 0 && (
                <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-3">* {model.unrated.map((d) => d.label).join(', ')}: not yet rated — plotted at zero.</p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className={`${LBL} !text-emerald-600 dark:!text-emerald-500 mb-2`}>Strongest</div>
                  {model.strongest.length ? model.strongest.map((s) => (
                    <div key={s.slug} className="flex justify-between text-[12px] py-0.5" data-testid={`skill-strong-${s.slug}`}>
                      <span className="text-gray-600 dark:text-gray-300">{s.label}</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{s.score}</span>
                    </div>
                  )) : <p className="text-[12px] text-gray-400">No skills rated yet.</p>}
                </div>
                <div>
                  <div className={`${LBL} !text-amber-600 dark:!text-amber-500 mb-2`}>Lowest self-rated</div>
                  {model.weakest.length ? model.weakest.map((s) => (
                    <div key={s.slug} className="flex justify-between text-[12px] py-0.5" data-testid={`skill-weak-${s.slug}`}>
                      <span className="text-gray-600 dark:text-gray-300">{s.label}</span>
                      <span className={`font-bold tabular-nums ${s.score < 45 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>{s.score}</span>
                    </div>
                  )) : model.unrated.length ? (
                    <p className="text-[12px] text-gray-400">{model.unrated.map((d) => d.label).join(', ')} unrated.</p>
                  ) : <p className="text-[12px] text-gray-400">Rate more skills to compare.</p>}
                </div>
              </div>
            </>
          ) : (
            <p className="text-[13px] text-gray-500 dark:text-gray-400 py-8 text-center">Skills data could not be loaded.</p>
          )}
        </div>

        <div className={CARD} data-testid="card-values-graph">
          <div className="flex items-center justify-between mb-1">
            <div className={LBL}>Values graph</div>
            {valuesRows?.length > 0 && (
              <span className="text-[10.5px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded-full px-2 py-0.5">{valuesPct}% confidence</span>
            )}
          </div>
          <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-4">Signal strength across your measured working principles.</p>
          {values?.unavailable ? (
            <p className="text-[13px] text-gray-500 dark:text-gray-400 py-8 text-center" data-testid="values-unavailable">
              The values assessment isn't available in this environment yet — it runs on the production Studio.
            </p>
          ) : values?.failed ? (
            <p className="text-[13px] text-rose-500 dark:text-rose-400 py-8 text-center" data-testid="values-error">
              Your values data couldn't be loaded right now — try refreshing the page.
            </p>
          ) : valuesRows?.length ? (
            <div className="space-y-2.5">
              {valuesRows.map((v) => (
                <div key={v.slug} data-testid={`value-row-${v.slug}`}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[12px] font-semibold text-gray-600 dark:text-gray-300">{v.label}</span>
                    <span className={`text-[10.5px] font-semibold ${BAND_TEXT[v.band]}`}>{v.band}</span>
                  </div>
                  <Bar pct={v.strength} band={v.band} />
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-3">You haven't taken the values survey yet.</p>
              <Link to="/studio" className="text-[12.5px] font-semibold text-violet-600 dark:text-violet-400">Take it in Studio →</Link>
            </div>
          )}
        </div>
      </div>

      {/* Archetype */}
      <div className={CARD} data-testid="card-archetype">
        <div className={`${LBL} mb-4`}>Founder archetype</div>
        {latestResult ? (
          <div className="grid md:grid-cols-[300px,1fr] gap-6 items-start">
            <div>
              <div className="rounded-2xl p-5 text-white" style={{ background: `linear-gradient(140deg, ${archMeta?.accent || '#6d28d9'}, #7c3aed)` }}>
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-white/70 mb-2">Primary archetype</div>
                <div className="text-[22px] font-extrabold tracking-tight" data-testid="text-archetype-label">{archMeta?.label || latestResult.archetype_label}</div>
                <div className="text-[12.5px] text-white/80 mt-1.5 leading-relaxed">{archMeta?.description || archMeta?.tagline || ''}</div>
              </div>
              <div className="flex gap-2.5 mt-3">
                <div className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">Confidence</div>
                  <div className="text-sm font-bold text-gray-900 dark:text-gray-50 tabular-nums">{archConfPct != null ? `${archConfPct}%` : '—'}</div>
                </div>
                <div className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">Assessed</div>
                  <div className="text-sm font-bold text-gray-900 dark:text-gray-50">{fmtDate(latestResult.created_at) || '—'}</div>
                </div>
              </div>
            </div>
            <div className="text-[12.5px] text-gray-600 dark:text-gray-300 leading-relaxed">
              {archMeta?.tagline && <p className="font-semibold mb-2">{archMeta.tagline}</p>}
              <p>
                Your archetype comes from your assessment answers. Strength and gap detail lives in the skills and
                values graphs on this page — the assessment doesn't produce a separate strengths/blind-spot list.
              </p>
            </div>
          </div>
        ) : (
          <p
            className={`text-[13px] py-6 text-center ${results?.failed ? 'text-rose-500 dark:text-rose-400' : 'text-gray-500 dark:text-gray-400'}`}
            data-testid={results?.failed ? 'archetype-error' : 'archetype-empty'}
          >
            {results?.unavailable
              ? 'Archetype assessment results aren\'t available in this environment yet — they run on the production Studio.'
              : results?.failed
                ? 'Your assessment results couldn\'t be loaded right now — try refreshing the page.'
                : 'No archetype yet — finish the assessment in Studio to unlock it.'}
          </p>
        )}
      </div>

      {/* Bottom grid */}
      <div className="grid lg:grid-cols-[1.4fr,1fr] gap-4 items-start">
        <div className="space-y-4">
          <div className={CARD} data-testid="card-assessment-progress">
            <div className={`${LBL} mb-1`}>Assessment progress</div>
            <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-4">Which graphs are reliable vs still low-confidence, by category.</p>
            <div className="space-y-3">
              {[
                { cat: 'Skills', pct: model?.assessedPct || 0, na: !model },
                { cat: 'Values', pct: valuesPct, na: values?.unavailable || !valuesRows?.length, err: values?.failed },
                { cat: 'Archetype', pct: archConfPct || 0, na: !latestResult, err: results?.failed },
              ].map((row) => (
                <div key={row.cat} data-testid={`progress-row-${row.cat.toLowerCase()}`}>
                  <div className="flex justify-between mb-1">
                    <span className="text-[12.5px] font-semibold text-gray-600 dark:text-gray-300">{row.cat}</span>
                    <span className={`text-[11px] font-semibold ${row.err ? 'text-rose-500' : row.na ? 'text-gray-400' : BAND_TEXT[confidenceBand(row.pct)]}`}>
                      {row.err ? "Couldn't load" : row.na ? 'No data yet' : `${row.pct}% · ${confidenceBand(row.pct)} confidence`}
                    </span>
                  </div>
                  <Bar pct={row.na || row.err ? 0 : row.pct} band={confidenceBand(row.pct)} />
                </div>
              ))}
            </div>
          </div>

          <div className={CARD} data-testid="card-next-actions">
            <div className={`${LBL} mb-3`}>Next best steps · answer in Studio</div>
            {nextActions.length ? (
              <div className="space-y-2.5">
                {nextActions.map((a) => (
                  <div key={a.key} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800" data-testid={`action-${a.key}`}>
                    <span className="w-8 h-8 flex-none rounded-lg bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                      <Fingerprint className="w-4 h-4" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50">{a.label}</div>
                      <div className="text-[11px] text-gray-400">Improves {a.improves}</div>
                    </div>
                    <Link
                      to="/studio"
                      className="text-[11.5px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border border-violet-100 dark:border-violet-800 rounded-lg px-3 py-1.5 whitespace-nowrap"
                    >
                      Answer →
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-gray-400 dark:text-gray-500">Nothing outstanding — your profile inputs are complete.</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className={CARD} data-testid="card-implications">
            <div className={`${LBL} mb-3`}>What this profile implies</div>
            {model?.weakest.length || model?.unrated.length ? (
              <div className="space-y-3 text-[12.5px] text-gray-600 dark:text-gray-300 leading-relaxed">
                {model.weakest.length > 0 && (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">Co-founder complement</div>
                    <p>You rate yourself lowest in {model.weakest[0].label.toLowerCase()} — worth considering a co-founder or early hire who is strong there.</p>
                  </div>
                )}
                {model.weakest.length > 0 && (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">Advisor fit</div>
                    <p>An advisor experienced in {model.weakest[0].label.toLowerCase()} could help offset your lowest self-rated skill.</p>
                  </div>
                )}
                {model.unrated.length > 0 && (
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">Coverage gap</div>
                    <p>{model.unrated.map((d) => d.label).join(', ')} {model.unrated.length === 1 ? 'is' : 'are'} unrated — implications there are unknown until you rate them.</p>
                  </div>
                )}
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">Downstream</div>
                  <p>Feeds co-founder matching and advisor matching across the platform.</p>
                </div>
              </div>
            ) : (
              <p className="text-[12.5px] text-gray-400 dark:text-gray-500">Rate skills in Studio to see what your profile implies.</p>
            )}
          </div>

          <div className={CARD} data-testid="card-evolution">
            <div className={`${LBL} mb-3`}>Profile evolution</div>
            {evolution.length ? (
              <div>
                {evolution.map((e, i) => (
                  <div key={e.key} className="flex gap-3" data-testid={`evolution-${e.key}`}>
                    <div className="flex flex-col items-center">
                      <span className={`w-2.5 h-2.5 rounded-full mt-1 ${i === 0 ? 'bg-violet-600' : 'bg-violet-300 dark:bg-violet-700'}`} />
                      {i < evolution.length - 1 && <span className="w-px flex-1 bg-gray-100 dark:bg-gray-800" />}
                    </div>
                    <div className="pb-4">
                      <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50">{e.title}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{fmtDate(e.date)}</div>
                      {e.detail && <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-1">{e.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-gray-400 dark:text-gray-500" data-testid="evolution-empty">No profile activity yet — your first Studio answers will appear here.</p>
            )}
          </div>

          <div className="rounded-2xl border border-violet-100 dark:border-violet-900 bg-violet-50/60 dark:bg-violet-900/20 p-5" data-testid="card-resume-studio">
            <div className="flex items-start gap-3">
              <span className="w-8 h-8 flex-none rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </span>
              <div className="flex-1">
                <div className="text-[13px] font-bold text-gray-900 dark:text-gray-50">Continue your assessment in Studio</div>
                <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                  Skills self-ratings and the values survey both live in Studio — this report updates as you answer.
                </p>
              </div>
            </div>
            <Link
              to="/studio"
              data-testid="button-open-studio"
              className="mt-3 w-full h-9 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[12.5px] font-bold flex items-center justify-center gap-1.5"
            >
              Open Studio <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
