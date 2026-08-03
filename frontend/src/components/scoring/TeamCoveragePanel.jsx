// Team drill-down: skill coverage + archetype coverage.
//
// Restores the design's Team-only drawer panels (skill-coverage matrix,
// gap callout, archetype chips with the dashed "missing" treatment) from
// endpoints that genuinely exist for a single signed-in user:
//
//   - GET /radar/me   (routes/radar.ts L52 — requireAuth only, NO cofounder
//                      connection required) → 8 skill axes, score 0–100.
//   - GET /assessment/results/me → the founder's own archetype, rendered with
//                      the same loading / empty / unavailable states as
//                      SpinoutLabAdvisorsPage.
//
// What is deliberately NOT rendered, because it has no connection-free source:
//   - the design's SECOND founder column (needs an active cofounder
//     connection; POST /radar/team enforces areUsersConnected).
//   - the design's pair values-alignment bars (no pair-alignment endpoint
//     exists anywhere in the worker).
// Both are replaced by a stated reason, never by a placeholder number.
//
// Nothing here feeds the composite score: skill coverage is scored separately
// from the Team dimension's 20 engine points, and the panel says so.

import { Link } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { archetypeMeta } from '../../lib/assessmentMeta';

// Mirrors the worker's own coverage-gap rule (services/radar.ts L172:
// `normCoverage < 60` → gap_axes). The single-user response omits gap_axes, so
// the same threshold is applied client-side and named in the copy.
const GAP_THRESHOLD = 60;

const barClass = (pct) => (pct >= 70 ? 'bg-emerald-500' : pct >= GAP_THRESHOLD ? 'bg-amber-500' : 'bg-rose-500');

function Muted({ children, testId }) {
  return <div className="text-[11.5px] text-gray-400 dark:text-gray-500" data-testid={testId}>{children}</div>;
}

function SkillCoverage({ state }) {
  if (!state || state.loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-[11.5px] text-gray-400 dark:text-gray-500" data-testid="skill-coverage-loading">
        <Loader2 size={13} className="animate-spin" /> Loading your skill coverage…
      </div>
    );
  }
  if (state.unavailable) return <Muted testId="skill-coverage-unavailable">Not available in this environment.</Muted>;
  if (state.failed) {
    return (
      <div className="text-[11.5px] text-amber-600 dark:text-amber-400" data-testid="skill-coverage-error">
        Couldn&apos;t load your skill coverage right now.
      </div>
    );
  }

  const axes = Array.isArray(state.data?.axes) ? state.data.axes : [];
  const rows = axes
    .filter((a) => a && (a.label || a.slug))
    .map((a) => ({
      slug: String(a.slug || a.label),
      label: String(a.label || a.slug),
      pct: Math.max(0, Math.min(100, Math.round(Number(a.score) || 0))),
      rated: Number(a.skill_count) || 0,
    }));
  const rated = rows.filter((r) => r.rated > 0);
  if (!rows.length || !rated.length) {
    return (
      <Muted testId="skill-coverage-empty">
        No skill ratings yet — build your profile in Profiling and this matrix fills in.
      </Muted>
    );
  }

  const gaps = rated.filter((r) => r.pct < GAP_THRESHOLD).sort((a, b) => a.pct - b.pct);

  return (
    <>
      <div className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden mb-3" data-testid="skill-coverage-matrix">
        <div className="grid grid-cols-[1.4fr_1fr] bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
          <div className="text-[10.5px] font-bold text-gray-500 dark:text-gray-400 px-3 py-2">Function</div>
          <div className="text-[10.5px] font-bold text-gray-500 dark:text-gray-400 px-2 py-2 text-right">You</div>
        </div>
        {rows.map((r) => (
          <div key={r.slug} className="grid grid-cols-[1.4fr_1fr] items-center border-t border-gray-100 dark:border-gray-800" data-testid={`skill-axis-${r.slug}`}>
            <div className="text-[12px] font-medium text-gray-700 dark:text-gray-200 px-3 py-2 truncate">{r.label}</div>
            <div className="px-2 py-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                {r.rated > 0 && <div className={`h-full rounded-full ${barClass(r.pct)}`} style={{ width: `${Math.max(3, r.pct)}%` }} />}
              </div>
              <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500 w-9 text-right">
                {r.rated > 0 ? `${r.pct}%` : 'n/a'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {gaps.length > 0 && (
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3.5 py-3 mb-3" data-testid="skill-coverage-gap">
          <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed inline-flex items-start gap-1.5">
            <AlertTriangle size={12} className="flex-none mt-0.5" />
            <span>
              Thin coverage (&lt;{GAP_THRESHOLD}%, the same rule the radar service uses) on{' '}
              <b>{gaps.slice(0, 3).map((g) => g.label).join(', ')}</b>
              {gaps.length > 3 ? ` and ${gaps.length - 3} more` : ''}.
            </span>
          </p>
        </div>
      )}

      <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-6">
        Your own profile only. A co-founder column needs an active co-founder connection — the team radar is
        connection-gated, and pair values-alignment has no endpoint at all, so neither is estimated here.
      </p>
    </>
  );
}

function ArchetypeCoverage({ state }) {
  if (!state || state.loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-[11.5px] text-gray-400 dark:text-gray-500" data-testid="archetype-loading">
        <Loader2 size={13} className="animate-spin" /> Loading your archetype…
      </div>
    );
  }
  if (state.unavailable) return <Muted testId="scoring-archetype-unavailable">Not available in this environment.</Muted>;
  if (state.failed) {
    return <div className="text-[11.5px] text-amber-600 dark:text-amber-400" data-testid="scoring-archetype-error">Couldn&apos;t load right now.</div>;
  }

  const results = Array.isArray(state.data) ? state.data : [];
  const latest = results.length ? results[0] : null;
  if (!latest) {
    return <Muted testId="scoring-archetype-empty">No archetype yet — finish the assessment in Studio.</Muted>;
  }

  const meta = archetypeMeta(latest.archetype_slug);
  const mine = meta?.label || latest.archetype_label || 'Your archetype';
  // `complements` is real static metadata on the archetype (lib/assessmentMeta),
  // not a prediction: these are the profiles that pair with yours and that no
  // profiled founder on this venture currently covers.
  const missing = Array.isArray(meta?.complements) ? meta.complements : [];

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-2" data-testid="archetype-coverage">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-full px-3 py-1.5 bg-violet-50 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300" data-testid="archetype-chip-covered">
          <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-violet-600 dark:bg-violet-400" />
          {mine}
        </span>
        {missing.map((label) => (
          <span
            key={label}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-full px-3 py-1.5 border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500"
            data-testid={`archetype-chip-missing-${label.replace(/\W+/g, '-').toLowerCase()}`}
          >
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
            {label}
          </span>
        ))}
      </div>
      <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-6">
        Solid = your assessed archetype. Dashed = the complements listed for it, none of which another profiled
        founder covers on this venture yet.
      </p>
    </>
  );
}

export default function TeamCoveragePanel({ skillState, archetypeState, profilingTo, profilingUnlocked, investorView }) {
  const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';

  return (
    <div className="mb-6" data-testid="drawer-team-panel">
      <div className="rounded-xl bg-violet-50/60 dark:bg-violet-900/20 border border-violet-100 dark:border-violet-800 px-3.5 py-3 mb-4">
        <p className="text-[11.5px] text-gray-600 dark:text-gray-300 leading-relaxed">
          Skill coverage and complementarity are scored separately — they are <b>not</b> part of this dimension&apos;s
          engine points above.
        </p>
      </div>

      <div className={`${LBL} mb-2`}>Skill coverage matrix</div>
      <SkillCoverage state={skillState} />

      <div className={`${LBL} mb-2`}>Archetype coverage</div>
      <ArchetypeCoverage state={archetypeState} />

      {!investorView && profilingUnlocked && profilingTo && (
        <Link to={profilingTo} className="text-[11.5px] font-semibold text-violet-600 dark:text-violet-300" data-testid="link-drawer-profiling">
          Open Profiling →
        </Link>
      )}
    </div>
  );
}
