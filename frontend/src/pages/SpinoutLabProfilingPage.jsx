// Spin-Out Lab "Profiling" tool page — founder profiling report per the design
// handoff (Profiling .dc / repo spin-out-lab-pipeline/project). Every element is
// live data; nothing is fabricated. Where the design ships a demo number with no
// source behind it, this page renders an explicit empty/unavailable state
// instead of reproducing the number.
//
// SKILLS — the nine founder dimensions
//   The radar's nine axes (Product, Strategy, Technical, Leadership, Hiring,
//   Operations, Sales / GTM, Finance / legal, Fundraising) are NOT taxonomy
//   categories and are not served by any endpoint. They are a documented
//   projection over the real 128-skill catalog, defined in
//   `../lib/founderDimensions` (every canonical skill slug maps to exactly one
//   dimension). The axis count is therefore a fixed product contract — nine,
//   always — rather than "however many categories /skills/taxonomy happened to
//   return", which is what previously drew 4 axes in dev and 8 in production.
//   Consequences the UI must state, and does:
//     * A dimension score is DERIVED, never measured: it is the mean of your own
//       0–5 self-ratings on the mapped skills, rescaled to 0–100. Nobody is ever
//       asked "how strong is your fundraising?".
//     * A dimension with no rated skills scores `null`, not 0. It is plotted at
//       the centre with an explicit unrated marker (a lighter dot and a " *" on
//       the axis label, explained by the footnote) and is excluded from the
//       strongest / least-evidenced lists.
//     * The per-dimension High/Medium/Low band is EVIDENCE COVERAGE (rated
//       skills ÷ mapped skills), surfaced as its own "Evidence coverage" block
//       and always worded as coverage. The design's per-axis `conf` was
//       hand-authored demo data and is deliberately not reproduced.
//   `assessedPct` / `ratedSkills` / `totalSkills` stay RAW CATALOG coverage
//   (every taxonomy skill, mapped or not) so the W1 milestone threshold below
//   keeps its original meaning.
//
// VALUES — /values/me (Worker-only; the dev API lacks it, so the section
//   degrades to an explicit "not available" state rather than fake bars). The
//   design's ten "working principles" (Ownership, Integrity, …) are not this
//   platform's taxonomy: the real one is 10 Schwartz unipolar values plus 5
//   founder bipolar spectrums. Unipolar rows map the stored −2..+2 importance
//   onto 0–100; bipolar rows get a pole-labelled centre-out bar the design does
//   not provide, because |score| would read a strong lean toward `pole_low` as
//   an equally strong lean toward `pole_high`. The chip is mean stored
//   confidence and is labelled "confidence", not "assessed".
//
// ARCHETYPE — /assessment/results/me plus the shared ARCHETYPES display copy
//   (static per-archetype strengths / blind spots / complements — descriptive
//   metadata like the tagline, not user data). The endpoint returns `confidence`
//   as a per-dimension record, not a scalar, so it is averaged into one figure.
//   The design's Secondary + Blend tiles have NO data source (one archetype per
//   track is stored, with no runner-up or mix ratio) and are replaced by a
//   one-line statement saying so.
//
// NO SOURCE → EXPLICIT EMPTY STATE, never a demo value:
//   "Questions answered 54 / 79" and "12 open Qs"  → no answered-question count
//     is exposed anywhere, so KPI 1 counts skills rated under its own label.
//   Per-axis confidence bands                      → replaced by real coverage.
//   Archetype secondary / "62 / 38" blend          → stated as not modelled.
//   "Leadership style" / "Working style" progress  → kept as design rows but
//     marked "Not modelled yet"; no such dimension exists in either taxonomy.
//   Authored "next best questions" + "Answer 4"    → real gap-driven actions
//     with real remaining counts, naming the dimension each one lifts.
//   Timeline dates "Week 2 · Jul 13"               → real timestamps only
//     (ratings updated_at, values updated_at, assessment created_at); no events
//     means an explicit empty state, not three invented rows.
//   `Last answered: "<question>"`                  → no question bank exists;
//     the Studio card shows real last-activity instead.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Compass,
  Copy,
  Download,
  Fingerprint,
  Loader2,
  Lock,
  Share2,
  Sparkles,
  Target,
} from 'lucide-react';
import { api, assessment } from '../lib/api';
import { spinoutLab } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { useAuth } from '../hooks/useAuthSync';
import { reportError } from '../lib/log';
import { archetypeMeta } from '../lib/assessmentMeta';
import { FOUNDER_DIMENSIONS, buildFounderSkillsModel } from '../lib/founderDimensions';

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm';
// Quick-action ghost buttons (design toolbar): transparent until hover.
const QA_BTN =
  'inline-flex items-center gap-1.5 rounded-lg border border-transparent bg-transparent px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 enabled:cursor-pointer enabled:hover:border-gray-200 enabled:hover:bg-white dark:enabled:hover:border-gray-700 dark:enabled:hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed';

// Confidence band from a 0–100 pct. Thresholds match the platform's loose
// High/Medium/Low language (values confidence is stored 0–1; results 0–1) and
// `coverageBand` in ../lib/founderDimensions, so one vocabulary covers the page.
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
// Evidence-coverage chips (skills card). Deliberately worded and coloured as
// coverage, never as a quality score.
const COVERAGE_CHIP = {
  High: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/25 border-emerald-100 dark:border-emerald-900',
  Medium: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/25 border-amber-100 dark:border-amber-900',
  Low: 'text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 border-gray-200 dark:border-gray-700',
};
// KPI-chip vocabulary — the design words its completion-KPI bands
// "Reliable" / "Partial"; mapped from the shared confidence bands.
const KPI_BAND_WORD = { High: 'Reliable', Medium: 'Partial', Low: 'Low' };

// The nine axes are a product contract, not a server response: when the
// taxonomy can't be loaded the frame still renders, with every axis explicitly
// unmeasured (score null) rather than silently drawn at zero.
const UNMEASURED_DIMS = FOUNDER_DIMENSIONS.map((d) => ({
  key: d.key,
  label: d.label,
  score: null,
  band: 'Low',
  ratedCount: 0,
  skillCount: 0,
  coveragePct: 0,
  topSkills: [],
}));

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// /assessment/results/me returns `confidence` as a per-dimension record
// (Record<slug, 0..1>), NOT a scalar — Number(record) is NaN, which used to
// render as "NaN%". Averaging the measured dimensions is the only honest single
// figure; a scalar is still accepted in case the shape ever changes.
export function resultConfidencePct(result) {
  const raw = result?.confidence;
  if (raw == null) return null;
  const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n * 100)));
  if (typeof raw === 'number') return Number.isFinite(raw) ? clampPct(raw) : null;
  if (typeof raw !== 'object') return null;
  const nums = Object.values(raw)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return clampPct(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// /values/me has no top-level timestamp — each vector row carries its own
// `updated_at`, so the profile's values event is the newest of those.
export function valuesUpdatedAt(values) {
  if (!values || values.unavailable || values.failed) return null;
  const stamps = (Array.isArray(values.vector) ? values.vector : [])
    .map((v) => v?.updated_at)
    .filter(Boolean)
    .sort();
  return stamps.length ? stamps[stamps.length - 1] : values.updated_at || null;
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
      detail: `${plural(safeRatings.length, 'skill')} rated.`,
    });
  }
  const valuesAt = valuesUpdatedAt(values);
  if (valuesAt) {
    const vector = Array.isArray(values?.vector) ? values.vector : [];
    const spectrums = vector.filter((v) => v?.is_bipolar).length;
    events.push({
      key: 'values',
      title: 'Values profile updated',
      date: valuesAt,
      detail: `${plural(vector.length - spectrums, 'core value')} and ${plural(spectrums, 'founder spectrum')} measured.`,
    });
  }
  (Array.isArray(results) ? results : []).forEach((r, i) => {
    if (!r?.created_at) return;
    const conf = resultConfidencePct(r);
    events.push({
      key: `result-${r.session_id || i}`,
      title: r.archetype_label ? `Archetype assessed → ${r.archetype_label}` : 'Assessment session recorded',
      date: r.created_at,
      detail: conf != null ? `${conf}% mean confidence across measured dimensions.` : '',
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

// Inline SVG radar over the nine founder dimensions. Geometry is the design's
// (430×290 canvas, centre 215/140, R 90, four grid rings, 2.6r dots, 9px axis
// labels, first axis at 12 o'clock going clockwise). The design is light-only,
// so grid/spoke/label strokes use `currentColor` under a themed <g> instead of
// its hard-coded #eceaf3 / #71717a — the app supports dark mode.
// Draw order matches the design: grid → spokes → polygon → dots → labels.
function FounderRadar({ dims }) {
  const axes = Array.isArray(dims) ? dims : [];
  if (axes.length < 3) return null;
  const cx = 215;
  const cy = 140;
  const R = 90;
  const n = axes.length;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  // A null score has no measurement behind it: it is plotted at the centre and
  // flagged, never treated as a real zero.
  const radius = (d) => (R * (d.score == null ? 0 : d.score)) / 100;
  const ring = (f) => axes.map((_, i) => pt(i, R * f).map((v) => v.toFixed(1)).join(' ')).join(' L ');
  const poly = axes.map((d, i) => pt(i, radius(d)).map((v) => v.toFixed(1)).join(' ')).join(' L ');
  const measured = axes.filter((d) => d.score != null).length;
  return (
    <svg
      width="430"
      height="290"
      viewBox="0 0 430 290"
      className="max-w-full h-auto"
      data-testid="skills-radar"
      role="img"
      aria-label={`Radar of nine founder skill dimensions; ${measured} of ${n} have rated skills behind them.`}
    >
      <g className="text-gray-200 dark:text-gray-700">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <path key={f} d={`M ${ring(f)} Z`} fill="none" stroke="currentColor" strokeWidth="1" />
        ))}
        {axes.map((d, i) => {
          const [x, y] = pt(i, R);
          return <line key={d.key} x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke="currentColor" strokeWidth="1" />;
        })}
      </g>
      <path d={`M ${poly} Z`} fill="rgba(107,70,193,.16)" stroke="#7c3aed" strokeWidth="2" />
      {axes.map((d, i) => {
        const [x, y] = pt(i, radius(d));
        return (
          <circle
            key={d.key}
            cx={x.toFixed(1)}
            cy={y.toFixed(1)}
            r="2.6"
            fill={d.score == null ? '#c4b5fd' : '#7c3aed'}
            data-testid={`radar-axis-${d.key}`}
          />
        );
      })}
      <g className="text-gray-500 dark:text-gray-400">
        {axes.map((d, i) => {
          const [lx, ly] = pt(i, R + 14);
          const anchor = Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end';
          return (
            <text key={d.key} x={lx.toFixed(1)} y={(ly + 3).toFixed(1)} fontSize="9" fill="currentColor" textAnchor={anchor}>
              {d.label}
              {d.score == null ? ' *' : ''}
            </text>
          );
        })}
      </g>
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

// Bipolar value spectrums (−2..+2) need a centre-out bar: the fill grows from
// the midpoint toward whichever pole the founder leans to. A one-directional
// bar would render "strongly Quality-First" and "strongly Speed-First"
// identically, which is the opposite of what the row claims to say.
function SpectrumBar({ score, band }) {
  const s = Math.max(-2, Math.min(2, Number(score) || 0));
  const half = (Math.abs(s) / 2) * 50;
  return (
    <div className="relative h-[7px] rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
      <div
        className={`absolute inset-y-0 ${BAND_BAR[band] || 'bg-violet-500'}`}
        style={{ left: `${s >= 0 ? 50 : 50 - half}%`, width: `${half}%` }}
      />
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gray-300 dark:bg-gray-600" />
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
  const [copied, setCopied] = useState(false); // transient "Copied ✓" state

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

  // The nine founder dimensions, projected from the real taxonomy + ratings.
  // null only when the skills endpoints themselves failed — "we don't know"
  // is a different state from "nothing rated yet" and must not be conflated.
  const model = useMemo(
    () => (skills && !skills.error ? buildFounderSkillsModel(skills.categories, skills.ratings) : null),
    [skills],
  );
  const radarDims = model ? model.dims : UNMEASURED_DIMS;
  // Lowest scored dimension across ALL of them (not just `weakest`, which needs
  // 4+ scored dimensions before it means anything) — drives the implications.
  const lowestScored = useMemo(() => {
    const scored = (model?.dims || []).filter((d) => d.score != null);
    return scored.length ? scored.reduce((lo, d) => (d.score < lo.score ? d : lo)) : null;
  }, [model]);

  const valuesModel = useMemo(() => {
    if (!values || values.unavailable || values.failed) return null;
    const rows = (Array.isArray(values.vector) ? values.vector : []).map((v) => {
      const raw = Number(v.score);
      const score = Number.isFinite(raw) ? Math.max(-2, Math.min(2, raw)) : 0;
      const conf = Math.round(Math.max(0, Math.min(1, Number(v.confidence) || 0)) * 100);
      const bipolar = !!v.is_bipolar;
      const poleLow = v.pole_low || null;
      const poleHigh = v.pole_high || null;
      return {
        slug: v.dimension_slug,
        label: v.dimension_label || v.dimension_slug,
        bipolar,
        poleLow,
        poleHigh,
        score,
        // Unipolar (Schwartz) rows store importance on −2..+2, so the bar is
        // that range mapped onto 0–100. Bipolar rows use lean magnitude and get
        // the pole-labelled treatment instead.
        pct: bipolar ? Math.round((Math.abs(score) / 2) * 100) : Math.round(((score + 2) / 4) * 100),
        lean: !bipolar ? null : score > 0.2 ? poleHigh : score < -0.2 ? poleLow : 'Balanced',
        conf,
        band: confidenceBand(conf),
      };
    });
    const core = rows.filter((r) => !r.bipolar).sort((a, b) => b.pct - a.pct);
    const spectrums = rows.filter((r) => r.bipolar);
    return {
      rows,
      core,
      spectrums,
      meanConf: rows.length ? Math.round(rows.reduce((a, r) => a + r.conf, 0) / rows.length) : 0,
    };
  }, [values]);

  const latestResult = useMemo(() => {
    if (!Array.isArray(results) || !results.length) return null;
    return [...results].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
  }, [results]);
  const archMeta = latestResult ? archetypeMeta(latestResult.archetype_slug) : null;
  const archConfPct = resultConfidencePct(latestResult);

  // Profile completion — a derived composite, weights documented on-page:
  // 40% skills coverage, 40% values coverage (mean stored confidence),
  // 20% archetype (its stored confidence when a result exists).
  const valuesPct = valuesModel?.meanConf || 0;
  const completion = model
    ? Math.round(model.assessedPct * 0.4 + valuesPct * 0.4 + (archConfPct || 0) * 0.2)
    : 0;
  const overallBand = confidenceBand(completion);

  // W1 deliverable — the assessment counts as complete only when all three
  // real components exist: skills rated, values vector, archetype result.
  // `assessedPct` is raw catalog coverage (every taxonomy skill), unchanged by
  // the nine-dimension projection, so this threshold keeps its meaning.
  useEffect(() => {
    if (status !== 'ready') return;
    const complete = model && model.assessedPct >= 75 && valuesModel?.rows.length > 0 && latestResult;
    if (complete) markMilestone(user, 'profiling_completed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, model?.assessedPct, valuesModel?.rows.length, latestResult?.id]);

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

  // Gap-driven next actions — the honest version of the design's authored
  // "next best questions" (there is no question-recommendation source). Each
  // one names the real founder dimension it lifts and carries a real count.
  const nextActions = useMemo(() => {
    const acts = [];
    if (model) {
      if (!model.ratedSkills) {
        acts.push({
          key: 'rate-first',
          glyph: Target,
          label: 'Rate your first skills',
          improves: 'every dimension on your skills radar',
          count: model.totalSkills,
        });
      } else {
        // Fully-unrated dimensions first (a real blank on the radar), then the
        // biggest remaining gap. The sort is stable, so ties keep the canonical
        // dimension order.
        const gaps = model.dims
          .filter((d) => d.skillCount > 0 && d.ratedCount < d.skillCount)
          .sort((a, b) => {
            const empty = (a.ratedCount === 0 ? 0 : 1) - (b.ratedCount === 0 ? 0 : 1);
            if (empty !== 0) return empty;
            return b.skillCount - b.ratedCount - (a.skillCount - a.ratedCount);
          });
        gaps.slice(0, 2).forEach((d) =>
          acts.push({
            key: `rate-${d.key}`,
            glyph: Target,
            label: `Rate your ${d.label} skills (${d.skillCount - d.ratedCount} unrated)`,
            improves: `${d.label} on your skills radar`,
            count: d.skillCount - d.ratedCount,
          }),
        );
      }
    }
    // Only genuinely-empty states become actions — unavailable/error states
    // are explained in their sections and would dead-end in Studio here.
    if (valuesModel && !valuesModel.rows.length)
      acts.push({ key: 'values', glyph: Compass, label: 'Complete the values survey', improves: 'Values graph confidence' });
    if (Array.isArray(results) && !latestResult)
      acts.push({ key: 'archetype', glyph: Sparkles, label: 'Finish the assessment to unlock your archetype', improves: 'Archetype + matching reliability' });
    return acts.slice(0, 3);
  }, [model, valuesModel, latestResult, results]);

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
  const isAdmin = user?.role === 'admin';
  if (!state?.active && !isAdmin)
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center" data-testid="profiling-inactive">
        <Lock className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Profiling is part of the Spin-Out Lab. <Link to="/spinout-lab" className="text-violet-600 dark:text-violet-400 font-semibold">Go to the Lab</Link>
        </p>
      </div>
    );

  const name = user?.name || user?.email || 'Founder';

  // Copy link is the only quick action with no backend dependency.
  const copyLink = () => {
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5" data-testid="page-spinout-profiling">
      {/* Phase stripe (design: 3px violet bar across the top of the tool) */}
      <div className="h-[3px] rounded-b-[3px] bg-violet-600 dark:bg-violet-500" aria-hidden="true" />
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
          <span
            className="w-[34px] h-[34px] flex-none rounded-[9px] bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center"
            data-testid="tool-icon"
          >
            <Fingerprint className="w-4 h-4" />
          </span>
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

      {/* Quick actions (design toolbar). Share + Export need the report-export
          service, which doesn't exist yet — they render disabled with the
          reason instead of faking success. Copy link is fully client-side. */}
      <div className="flex items-center gap-1 flex-wrap" data-testid="quick-actions">
        <button
          type="button"
          disabled
          title="Requires the report-export service (not yet available)"
          className={QA_BTN}
          data-testid="button-share"
        >
          <Share2 className="w-3.5 h-3.5" /> Share
        </button>
        <button
          type="button"
          disabled
          title="Requires the report-export service (not yet available)"
          className={QA_BTN}
          data-testid="button-export-report"
        >
          <Download className="w-3.5 h-3.5" /> Export report
        </button>
        <button type="button" onClick={copyLink} className={QA_BTN} data-testid="button-copy-link">
          {copied ? 'Copied ✓' : <><Copy className="w-3.5 h-3.5" /> Copy link</>}
        </button>
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
              ? `Your profile is ${completion}% complete — ${model.ratedSkills} of ${model.totalSkills} catalog skills rated across nine founder dimensions${
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
        {/* The design labels this KPI "Questions answered" (54/79); no loaded
            source exposes an answered-question count (/assessment/results/me
            carries only vectors + confidence), so the honest skills-rated
            count keeps its own label. */}
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
            <span className={`text-[10px] font-bold ${BAND_TEXT[confidenceBand(model?.assessedPct || 0)]}`}>{model ? KPI_BAND_WORD[confidenceBand(model.assessedPct)] : ''}</span>
          </div>
          <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-1">Skills graph assessed</div>
          <div className="mt-2"><Bar pct={model?.assessedPct || 0} band={confidenceBand(model?.assessedPct || 0)} /></div>
        </div>
        <div className={CARD} data-testid="kpi-values-graph">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold text-gray-900 dark:text-gray-50 tabular-nums">{valuesModel?.rows.length ? `${valuesPct}%` : '—'}</span>
            <span className={`text-[10px] font-bold ${valuesModel?.rows.length ? BAND_TEXT[confidenceBand(valuesPct)] : values?.failed ? 'text-rose-500' : 'text-gray-400'}`}>
              {values?.unavailable ? 'Unavailable' : values?.failed ? 'Load failed' : valuesModel?.rows.length ? KPI_BAND_WORD[confidenceBand(valuesPct)] : 'Not taken'}
            </span>
          </div>
          <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-1">Values graph confidence</div>
          <div className="mt-2"><Bar pct={valuesModel?.rows.length ? valuesPct : 0} band={confidenceBand(valuesPct)} /></div>
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
          {/* Nine is fixed by the founder-dimension model, not by whatever the
              taxonomy endpoint returns. */}
          <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-3">
            Radar of nine founder skill dimensions — derived from your Studio skill self-ratings, not asked directly.
          </p>
          <div className="flex justify-center mb-3"><FounderRadar dims={radarDims} /></div>
          {model ? (
            <>
              {model.unrated.length > 0 && (
                <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-3">
                  * {model.unrated.map((d) => d.label).join(', ')}: no rated skills behind {model.unrated.length === 1 ? 'it' : 'them'} yet — drawn at the centre, not scored.
                </p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className={`${LBL} !text-emerald-600 dark:!text-emerald-500 mb-2`}>Strongest</div>
                  {model.strongest.length ? model.strongest.map((s) => (
                    <div
                      key={s.key}
                      className="flex items-start justify-between gap-2 py-1"
                      data-testid={`skill-strong-${s.key}`}
                      title={s.topSkills.length ? `Top rated: ${s.topSkills.map((t) => `${t.label} ${t.level}/5`).join(', ')}` : undefined}
                    >
                      <span className="min-w-0">
                        <span className="block text-[12px] text-gray-600 dark:text-gray-300 truncate">{s.label}</span>
                        <span className="block text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">{s.ratedCount}/{s.skillCount} rated · {s.band} coverage</span>
                      </span>
                      <span className="text-[12px] font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{s.score}</span>
                    </div>
                  )) : <p className="text-[12px] text-gray-400">No skills rated yet.</p>}
                </div>
                <div>
                  <div className={`${LBL} !text-amber-600 dark:!text-amber-500 mb-2`}>Least evidenced</div>
                  {model.weakest.length ? model.weakest.map((s) => (
                    <div
                      key={s.key}
                      className="flex items-start justify-between gap-2 py-1"
                      data-testid={`skill-weak-${s.key}`}
                      title={s.topSkills.length ? `Top rated: ${s.topSkills.map((t) => `${t.label} ${t.level}/5`).join(', ')}` : undefined}
                    >
                      <span className="min-w-0">
                        <span className="block text-[12px] text-gray-600 dark:text-gray-300 truncate">{s.label}</span>
                        <span className="block text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">{s.ratedCount}/{s.skillCount} rated · {s.band} coverage</span>
                      </span>
                      {/* Design rule: below 45 the score turns red, otherwise amber. */}
                      <span className={`text-[12px] font-bold tabular-nums ${s.score < 45 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>{s.score}</span>
                    </div>
                  )) : model.unrated.length ? (
                    <p className="text-[12px] text-gray-400">{model.unrated.map((d) => d.label).join(', ')} unrated.</p>
                  ) : <p className="text-[12px] text-gray-400">Rate more skills to compare.</p>}
                </div>
              </div>
              {/* The design carries a per-axis High/Medium/Low band in its data
                  and never renders it — and its bands were hand-authored demo
                  values anyway. The only honest per-dimension band is coverage,
                  so it gets its own block, worded as coverage. */}
              <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800" data-testid="skills-coverage">
                <div className={`${LBL} mb-1`}>Evidence coverage</div>
                <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-2">
                  How much of each dimension you have actually rated — how far to trust the score, not how good you are.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {model.dims.map((d) => (
                    <span
                      key={d.key}
                      data-testid={`coverage-${d.key}`}
                      title={`${d.ratedCount} of ${d.skillCount} mapped skills rated — ${d.band} coverage`}
                      className={`text-[10.5px] font-semibold rounded-lg border px-2 py-1 ${COVERAGE_CHIP[d.band] || COVERAGE_CHIP.Low}`}
                    >
                      {d.label} <span className="tabular-nums">{d.coveragePct}%</span>
                    </span>
                  ))}
                </div>
                {model.unmappedSkillCount > 0 && (
                  <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2">
                    {plural(model.unmappedSkillCount, 'catalog skill')} not yet mapped to a founder dimension — counted in coverage above, but not on the radar.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-[13px] text-gray-500 dark:text-gray-400 py-6 text-center">
              Skills data could not be loaded — the nine axes above are the report's fixed frame, drawn unmeasured.
            </p>
          )}
        </div>

        <div className={CARD} data-testid="card-values-graph">
          <div className="flex items-center justify-between mb-1">
            <div className={LBL}>Values graph</div>
            {valuesModel?.rows.length > 0 && (
              <span className={`text-[10.5px] font-bold rounded-full px-2 py-0.5 ${valuesPct >= 75 ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30' : 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30'}`}>
                {valuesPct}% confidence
              </span>
            )}
          </div>
          {/* The design's caption says "ten working principles"; this platform
              measures 10 Schwartz core values plus 5 founder spectrums, so the
              caption reports what was actually measured. */}
          <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-4">
            {valuesModel?.rows.length
              ? `Signal strength across your ${valuesModel.rows.length} measured value dimensions — ${plural(valuesModel.core.length, 'core value')} and ${plural(valuesModel.spectrums.length, 'founder spectrum')}.`
              : 'Signal strength across your measured core values and founder spectrums.'}
          </p>
          {values?.unavailable ? (
            <p className="text-[13px] text-gray-500 dark:text-gray-400 py-8 text-center" data-testid="values-unavailable">
              The values assessment isn't available in this environment yet — it runs on the production Studio.
            </p>
          ) : values?.failed ? (
            <p className="text-[13px] text-rose-500 dark:text-rose-400 py-8 text-center" data-testid="values-error">
              Your values data couldn't be loaded right now — try refreshing the page.
            </p>
          ) : valuesModel?.rows.length ? (
            <div className="space-y-4">
              {valuesModel.core.length > 0 && (
                <div>
                  <div className={`${LBL} mb-2`}>Core values</div>
                  <div className="space-y-2.5">
                    {valuesModel.core.map((v) => (
                      <div key={v.slug} data-testid={`value-row-${v.slug}`}>
                        <div className="flex justify-between gap-2 mb-1">
                          <span className="text-[12px] font-semibold text-gray-600 dark:text-gray-300 truncate">{v.label}</span>
                          {/* Bare High/Medium/Low word, per the design — it is
                              the stored per-dimension confidence. */}
                          <span className={`text-[10.5px] font-semibold flex-none ${BAND_TEXT[v.band]}`} title={`${v.conf}% stored confidence`}>{v.band}</span>
                        </div>
                        <Bar pct={v.pct} band={v.band} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {valuesModel.spectrums.length > 0 && (
                <div className="pt-1">
                  <div className={`${LBL} mb-1`}>Founder spectrums</div>
                  <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-2">
                    Bipolar — the fill leans from the centre toward the pole you scored.
                  </p>
                  <div className="space-y-2.5">
                    {valuesModel.spectrums.map((v) => (
                      <div key={v.slug} data-testid={`value-row-${v.slug}`}>
                        <div className="flex justify-between gap-2 mb-1">
                          <span className="text-[12px] font-semibold text-gray-600 dark:text-gray-300 truncate">{v.label}</span>
                          <span className={`text-[10.5px] font-semibold flex-none ${BAND_TEXT[v.band]}`} title={`${v.conf}% stored confidence`}>{v.band}</span>
                        </div>
                        <SpectrumBar score={v.score} band={v.band} />
                        <div className="flex justify-between gap-2 mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                          <span className={v.score < -0.2 ? 'font-semibold text-gray-600 dark:text-gray-300' : ''}>{v.poleLow || 'Low'}</span>
                          <span className="font-semibold text-violet-600 dark:text-violet-400">{v.lean}</span>
                          <span className={v.score > 0.2 ? 'font-semibold text-gray-600 dark:text-gray-300' : ''}>{v.poleHigh || 'High'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
          <div className="grid md:grid-cols-[300px_1fr] gap-6 items-start">
            <div>
              <div className="rounded-2xl p-5 text-white" style={{ background: `linear-gradient(140deg, ${archMeta?.accent || '#6d28d9'}, #7c3aed)` }}>
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-white/70 mb-2">Primary archetype</div>
                <div className="text-[22px] font-extrabold tracking-tight" data-testid="text-archetype-label">{archMeta?.label || latestResult.archetype_label}</div>
                <div className="text-[12.5px] text-white/80 mt-1.5 leading-relaxed">{archMeta?.description || archMeta?.tagline || ''}</div>
              </div>
              {/* The design puts Secondary + Blend tiles here. The results store
                  keeps a single archetype per track with no runner-up and no mix
                  ratio, so those tiles are replaced by live Confidence /
                  Assessed data plus an explicit statement below. */}
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
              <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2" data-testid="archetype-no-blend">
                Your assessment resolves one archetype per track — there is no secondary archetype or blend ratio to show.
              </p>
            </div>
            {archMeta?.strengths?.length ? (
              /* Static per-archetype display copy from the shared ARCHETYPES
                 seed (descriptive metadata, not user data). */
              <div className="grid grid-cols-2 gap-5">
                <div data-testid="archetype-strengths">
                  <div className={`${LBL} !text-emerald-600 dark:!text-emerald-500 mb-2`}>Strengths</div>
                  <div className="space-y-1.5">
                    {archMeta.strengths.map((s) => (
                      <div key={s} className="text-[12.5px] text-gray-600 dark:text-gray-300 flex gap-2">
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">+</span>
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div data-testid="archetype-blindspots">
                  <div className={`${LBL} !text-amber-600 dark:!text-amber-500 mb-2`}>Likely blind spots</div>
                  <div className="space-y-1.5">
                    {(archMeta.blindSpots || []).map((b) => (
                      <div key={b} className="text-[12.5px] text-gray-600 dark:text-gray-300 flex gap-2">
                        <span className="font-bold text-amber-600 dark:text-amber-500">!</span>
                        <span>{b}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="col-span-2 border-t border-gray-100 dark:border-gray-800 pt-4" data-testid="archetype-complements">
                  <div className={`${LBL} mb-2`}>Compatible complements</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(archMeta.complements || []).map((c) => (
                      <span
                        key={c}
                        className="text-[11.5px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border border-violet-100 dark:border-violet-800 rounded-lg px-2.5 py-1"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* Unknown slug → no seeded copy; keep the honest prose state. */
              <div className="text-[12.5px] text-gray-600 dark:text-gray-300 leading-relaxed">
                {archMeta?.tagline && <p className="font-semibold mb-2">{archMeta.tagline}</p>}
                <p>
                  Your archetype comes from your assessment answers. Strength and gap detail lives in the skills and
                  values graphs on this page — the assessment doesn't produce a separate strengths/blind-spot list.
                </p>
              </div>
            )}
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
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
        <div className="space-y-4">
          <div className={CARD} data-testid="card-assessment-progress">
            <div className={`${LBL} mb-1`}>Assessment progress</div>
            <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-4">Which graphs are reliable vs still low-confidence, by category.</p>
            <div className="space-y-3">
              {[
                { cat: 'Skills', pct: model?.assessedPct || 0, na: !!model && !model.ratedSkills, err: !model },
                { cat: 'Values', pct: valuesPct, na: !valuesModel?.rows.length, off: values?.unavailable, err: values?.failed },
                { cat: 'Archetype', pct: archConfPct || 0, na: !latestResult, off: results?.unavailable, err: results?.failed },
                // The design also lists these two. Neither exists in the skills
                // taxonomy (8 categories / 128 skills) nor in the values
                // taxonomy (10 core values + 5 founder spectrums), so there is
                // nothing to bind: they stay at zero, explicitly not modelled,
                // rather than carrying the design's 48% / 40% bars.
                { cat: 'Leadership style', pct: 0, unmodelled: true },
                { cat: 'Working style', pct: 0, unmodelled: true },
              ].map((row) => (
                <div key={row.cat} data-testid={`progress-row-${row.cat.toLowerCase().replace(/\s+/g, '-')}`}>
                  <div className="flex justify-between gap-2 mb-1">
                    <span className="text-[12.5px] font-semibold text-gray-600 dark:text-gray-300">{row.cat}</span>
                    <span
                      className={`text-[11px] font-semibold flex-none ${row.err ? 'text-rose-500' : row.na || row.off || row.unmodelled ? 'text-gray-400' : BAND_TEXT[confidenceBand(row.pct)]}`}
                      title={row.unmodelled ? 'This platform does not measure this dimension yet.' : undefined}
                    >
                      {row.unmodelled
                        ? 'Not modelled yet'
                        : row.err
                          ? "Couldn't load"
                          : row.off
                            ? 'Not available here'
                            : row.na
                              ? 'No data yet'
                              : `${row.pct}% · ${confidenceBand(row.pct)} confidence`}
                    </span>
                  </div>
                  <Bar pct={row.na || row.off || row.err || row.unmodelled ? 0 : row.pct} band={confidenceBand(row.pct)} />
                </div>
              ))}
            </div>
          </div>

          <div className={CARD} data-testid="card-next-actions">
            <div className={`${LBL} mb-3`}>Next best questions · answer in Studio</div>
            {nextActions.length ? (
              <div className="space-y-2.5">
                {nextActions.map((a) => {
                  const Glyph = a.glyph || Fingerprint;
                  return (
                    <div key={a.key} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800" data-testid={`action-${a.key}`}>
                      <span className="w-[34px] h-[34px] flex-none rounded-[9px] bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                        <Glyph className="w-4 h-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50">{a.label}</div>
                        <div className="text-[11px] text-gray-400">Improves {a.improves}</div>
                      </div>
                      <Link
                        to="/studio"
                        className="text-[11.5px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30 border border-violet-100 dark:border-violet-800 rounded-lg px-3 py-1.5 whitespace-nowrap"
                      >
                        {a.count ? `Answer ${a.count} →` : 'Answer →'}
                      </Link>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[12.5px] text-gray-400 dark:text-gray-500">Nothing outstanding — your profile inputs are complete.</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className={CARD} data-testid="card-implications">
            <div className={`${LBL} mb-3`}>What this profile implies</div>
            {/* The design's first three rows are prose written about its demo
                numbers. They are templated off the real lowest-evidenced
                dimensions instead; "Downstream" is product documentation and is
                true regardless of the data. */}
            <div className="space-y-3 text-[12.5px] text-gray-600 dark:text-gray-300 leading-relaxed">
              {lowestScored ? (
                <>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">Co-founder complement</div>
                    <p>You rate yourself lowest in {lowestScored.label.toLowerCase()} — worth considering a co-founder or early hire who is strong there.</p>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">Advisor fit</div>
                    <p>An advisor experienced in {lowestScored.label.toLowerCase()} could help offset your lowest self-rated dimension.</p>
                  </div>
                </>
              ) : (
                <p className="text-gray-400 dark:text-gray-500">
                  Rate skills in Studio and the complement / advisor reads will fill in from your weakest dimensions.
                </p>
              )}
              {model && model.unrated.length > 0 && (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">Operating risk</div>
                  <p>
                    {model.unrated.map((d) => d.label).join(', ')} {model.unrated.length === 1 ? 'has' : 'have'} no rated skills behind{' '}
                    {model.unrated.length === 1 ? 'it' : 'them'} — operating risk there is unknown, not low.
                  </p>
                </div>
              )}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-0.5">Downstream</div>
                <p>Feeds Scoring Engine (Team), Co-founder Match, and Advisors matching.</p>
              </div>
            </div>
          </div>

          <div className={CARD} data-testid="card-evolution">
            <div className={`${LBL} mb-3`}>Profile evolution</div>
            {evolution.length ? (
              <div>
                {evolution.map((e, i) => (
                  <div key={e.key} className="flex gap-3" data-testid={`evolution-${e.key}`}>
                    <div className="flex flex-col items-center">
                      {/* Dot colour encodes recency, newest first (design). */}
                      <span className={`w-2.5 h-2.5 rounded-full mt-1 ${i === 0 ? 'bg-violet-600' : i === 1 ? 'bg-violet-300 dark:bg-violet-700' : 'bg-gray-200 dark:bg-gray-700'}`} />
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
                <div className="text-[13px] font-bold text-gray-900 dark:text-gray-50">Resume assessment in Studio</div>
                {/* The design quotes the last question answered. No question
                    bank is exposed to this page, and a quoted string would read
                    as a real answer — so this reports real last activity. */}
                <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-1 leading-relaxed" data-testid="text-resume-note">
                  {lastUpdated
                    ? `Last activity ${fmtDate(lastUpdated)} — skills self-ratings and the values survey both live in Studio, and this report updates as you answer.`
                    : 'Nothing answered yet — skills self-ratings and the values survey both live in Studio, and this report fills in as you answer.'}
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
