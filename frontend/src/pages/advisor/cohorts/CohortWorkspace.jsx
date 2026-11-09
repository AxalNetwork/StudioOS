import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import {
  COHORT_PARAM, REMEMBER_KEY, FOUNDER_STATES, cohortLabel, cohortRange, createRequestGate,
  guardedRead, resolveCohort, weekOfLabel, withCohort,
} from './cohortModel';

/**
 * D4813 (#4813, package 1) — one selected cohort for the whole Cohorts workspace.
 *
 * WHY A PROVIDER. Overview, Founders, Guidance, This week, Calendar and
 * Outcomes each used to read `/me/cohort` and keep their own `cycleId`, so the
 * batch picked on Founders was forgotten on Guidance and lost on refresh. The
 * selection now lives in the URL (`?cohort=<cycleId>`), every section link
 * carries it, and this provider is the one place it is read, validated and
 * written back:
 *
 *   · a malformed value, or a cycle the advisor is not assigned to, falls back
 *     to a cohort they hold and the header SAYS so — a silent swap would show a
 *     different batch under a link someone shared for another;
 *   · without a value, the cohort this browser chose last is used (local
 *     storage, a convenience only), else the newest assignment, and the URL is
 *     rewritten so a refresh or a copied link keeps it;
 *   · every read goes through `guardedRead`, so a response for the cohort the
 *     advisor just left is dropped rather than painted over the new one.
 *
 * The week record is read here once, because the header's "Week n of 4" and
 * the Overview, Founders and This week sections all need the same answer —
 * two reads could disagree about which week it is.
 *
 * IN PREVIEW (an admin viewing the Advisor role) NOTHING IS READ. The admin
 * holds no assignment, so the workspace renders its structure with neutral
 * unavailable states and no founder data (C18).
 */

const Ctx = createContext(null);
/** Exported so a test can render a section against a known selection. */
export const CohortWorkspaceContext = Ctx;

function readRemembered() {
  try { return window.localStorage.getItem(REMEMBER_KEY); } catch { return null; }
}
function writeRemembered(id) {
  try { window.localStorage.setItem(REMEMBER_KEY, String(id)); } catch { /* a convenience only */ }
}

const WEEKS_UNAVAILABLE = 'The Lab’s week record could not be read.';
/** A 200 that is itself a failed Lab read is unavailable, never an empty week. */
export const acceptWeeks = (data) => (data && data.available === false ? (data.detail || WEEKS_UNAVAILABLE) : null);

export function CohortWorkspaceProvider({ preview = false, children }) {
  const [params, setParams] = useSearchParams();
  const raw = params.get(COHORT_PARAM);
  const [assignments, setAssignments] = useState({ loading: !preview, error: '', data: null });
  const assignGate = useRef(createRequestGate()).current;
  const [version, setVersion] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadAssignments = useCallback(() => {
    if (preview) return undefined;
    return guardedRead({
      gate: assignGate,
      fetch: () => api.listMyAdvisorCohorts(),
      onState: setAssignments,
      fallbackError: 'Your cohort assignments could not be read.',
    });
  }, [preview, assignGate]);
  useEffect(() => { loadAssignments(); }, [loadAssignments]);

  const items = useMemo(
    () => (Array.isArray(assignments.data?.items) ? assignments.data.items : []),
    [assignments.data],
  );
  const resolved = useMemo(
    () => (assignments.loading || preview ? { cycleId: null, fallback: null } : resolveCohort({ items, raw, remembered: readRemembered() })),
    [assignments.loading, preview, items, raw],
  );
  const cycleId = resolved.cycleId;
  const current = items.find((a) => Number(a.cohort_cycle_id) === cycleId) || null;

  // Keep the URL and the selection in step: write the resolved cohort back
  // (replace, not push — this is a correction, not a navigation), and keep
  // the fallback sentence until the advisor picks a cohort themselves.
  useEffect(() => {
    if (cycleId == null) return;
    if (resolved.fallback) setNotice({ ...resolved.fallback, shown: cohortLabel(current?.cohort) });
    writeRemembered(cycleId);
    if (raw !== String(cycleId)) {
      const next = new URLSearchParams(params);
      next.set(COHORT_PARAM, String(cycleId));
      setParams(next, { replace: true });
    }
    // `params` is read, not watched: it changes on every write this makes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId, raw, resolved.fallback]);

  const select = useCallback((id) => {
    const next = new URLSearchParams(params);
    next.set(COHORT_PARAM, String(id));
    next.delete('founder');
    setNotice(null);
    setParams(next);
  }, [params, setParams]);

  // The shared week record, keyed by cohort and refresh.
  const [weeks, setWeeks] = useState({ loading: false, error: '', data: null });
  const weeksGate = useRef(createRequestGate()).current;
  const loadWeeks = useCallback(() => {
    if (cycleId == null) { weeksGate.invalidate(); setWeeks({ loading: false, error: '', data: null }); return undefined; }
    return guardedRead({
      gate: weeksGate,
      fetch: () => api.listMyAdvisorCohortWeeks(cycleId),
      accept: acceptWeeks,
      onState: (st) => setWeeks({ ...st, for: cycleId }),
      fallbackError: WEEKS_UNAVAILABLE,
    });
    // `version` is the refresh button.
  }, [cycleId, version, weeksGate]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadWeeks(); }, [loadWeeks]);

  const markUpdated = useCallback(() => setLastUpdated(new Date()), []);
  useEffect(() => { if (weeks.data) markUpdated(); }, [weeks.data, markUpdated]);

  const value = useMemo(() => ({
    preview,
    assignments: { loading: assignments.loading, error: assignments.error, items },
    reloadAssignments: loadAssignments,
    cycleId,
    current,
    label: current ? cohortLabel(current.cohort) : null,
    notice,
    select,
    version,
    refresh: () => { setVersion((v) => v + 1); loadAssignments(); },
    lastUpdated,
    markUpdated,
    // Until the read for THIS cohort has answered, the week record is loading:
    // the render between a switch and the read starting must not show the
    // previous cohort's weeks, or an empty record as if it were read.
    weeks: cycleId != null && weeks.for !== cycleId ? { loading: true, error: '', data: null } : weeks,
    reloadWeeks: loadWeeks,
    href: (path, extra) => withCohort(path, cycleId, extra),
  }), [preview, assignments.loading, assignments.error, items, loadAssignments, cycleId, current, notice, select,
    version, lastUpdated, markUpdated, weeks, loadWeeks]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCohortWorkspace() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useCohortWorkspace needs CohortWorkspaceProvider (AdvisorBucketRoutes mounts it on /cohorts).');
  return v;
}

/**
 * A section's own read, keyed by the selected cohort and the refresh button.
 * `fetch(cycleId)` performs it; `accept(payload)` may turn a 200 into a stated
 * failure. Old data is cleared before the new cohort loads, and a late answer
 * for the previous cohort is ignored (`guardedRead`).
 */
export function useCohortRead(fetch, { accept, fallbackError } = {}) {
  const { cycleId, version, markUpdated } = useCohortWorkspace();
  const [state, setState] = useState({ loading: false, error: '', data: null, for: undefined });
  const gate = useRef(createRequestGate()).current;
  const reload = useCallback(() => {
    if (cycleId == null) { gate.invalidate(); setState({ loading: false, error: '', data: null }); return undefined; }
    return guardedRead({
      gate,
      fetch: () => fetch(cycleId),
      accept,
      onState: (s) => { setState({ ...s, for: cycleId }); if (s.data) markUpdated(); },
      fallbackError,
    });
  }, [cycleId, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  // Loading until the read for the selected cohort has answered (see `weeks`).
  if (cycleId != null && state.for !== cycleId) return { loading: true, error: '', data: null, reload };
  return { loading: state.loading, error: state.error, data: state.data, reload };
}

/** "Loading November 2026…" — a loading line always names what is loading. */
export function CohortLoading({ what }) {
  const { label } = useCohortWorkspace();
  return (
    <p role="status" className="mb-2 text-[12px] text-axal-muted" data-testid="cohort-loading">
      {`Loading ${what ? `${what} for ` : ''}${label || 'your cohort'}…`}
    </p>
  );
}

/** A founder state in words and a shape, never colour alone. */
export function StatusBadge({ state, children }) {
  const meta = FOUNDER_STATES[state] || STATE_EXTRA[state] || { label: state, glyph: '·', tone: 'neutral' };
  const tone = TONE_CLASS[meta.tone] || TONE_CLASS.neutral;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${tone}`} data-state={state}>
      <span aria-hidden="true">{meta.glyph}</span>
      {children || meta.label}
    </span>
  );
}

const STATE_EXTRA = {
  needs_response: { label: 'Needs response', glyph: '▲', tone: 'warn' },
  upcoming: { label: 'Upcoming', glyph: '◷', tone: 'info' },
  deadline: { label: 'Deadline', glyph: '⚑', tone: 'info' },
  // D4813 package 2: guidance status, in words and a shape.
  published: { label: 'Published', glyph: '✓', tone: 'ok' },
  draft: { label: 'Draft', glyph: '✎', tone: 'info' },
  retired: { label: 'Retired', glyph: '⦸', tone: 'neutral' },
  answered: { label: 'Answered', glyph: '✓', tone: 'ok' },
};

const TONE_CLASS = {
  danger: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  info: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200',
  neutral: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
};

/** The six sections, Overview first; the five zones keep their routes. */
export const COHORT_SECTIONS = [
  { slug: null, label: 'Overview', path: '/cohorts' },
  { slug: 'founders', label: 'Founders', path: '/cohorts/founders' },
  { slug: 'guidance', label: 'Guidance', path: '/cohorts/guidance' },
  { slug: 'this-week', label: 'This week', path: '/cohorts/this-week' },
  { slug: 'calendar', label: 'Calendar', path: '/cohorts/calendar' },
  { slug: 'outcomes', label: 'Outcomes', path: '/cohorts/outcomes' },
];

function clock(d) {
  if (!d) return null;
  try { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return null; }
}

/**
 * The selector row and the section tabs, drawn where the shell would draw its
 * zone pills (`WorkspaceShell`'s `sectionNav`).
 */
export function CohortSectionNav() {
  const ws = useCohortWorkspace();
  const { pathname } = useLocation();
  const { items, loading, error } = ws.assignments;
  const range = cohortRange(ws.current?.cohort);
  const weekLine = ws.preview ? 'Not assigned' : weekOfLabel(ws.weeks.data);
  const updated = clock(ws.lastUpdated);

  return (
    <div className="mt-3 space-y-3" data-testid="cohort-section-nav">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-axal-hairline bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
        {ws.preview ? (
          <span className="text-[12.5px] font-bold" data-testid="cohort-selector-preview">No cohort · preview</span>
        ) : loading ? (
          <span role="status" className="text-[12.5px] text-axal-muted">Loading your cohorts…</span>
        ) : error ? (
          <span role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">{error}</span>
        ) : items.length === 0 ? (
          <span className="text-[12.5px] font-bold">No cohort assigned</span>
        ) : (
          <label className="flex items-center gap-2 text-[12px]">
            <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Cohort</span>
            <select
              data-testid="cohort-selector"
              className="min-h-[44px] rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] font-bold dark:border-gray-700 dark:bg-gray-900 lg:min-h-0"
              value={ws.cycleId ?? ''}
              onChange={(e) => ws.select(Number(e.target.value))}
            >
              {items.map((a) => (
                <option key={a.cohort_cycle_id} value={a.cohort_cycle_id}>{cohortLabel(a.cohort)}</option>
              ))}
            </select>
          </label>
        )}
        {!ws.preview && range && <span className="text-[12px] text-axal-muted">{range}</span>}
        {weekLine ? (
          <span className="text-[12px] font-bold">{weekLine}</span>
        ) : (!ws.preview && ws.cycleId != null && !ws.weeks.loading && (
          <span className="text-[12px] italic text-axal-faint">Week not recorded</span>
        ))}
        {!ws.preview && ws.cycleId != null && ws.weeks.loading && (
          <span role="status" className="text-[12px] text-axal-faint">{`Loading ${ws.label || 'cohort'}…`}</span>
        )}
        <span className="ml-auto flex items-center gap-2 text-[11.5px] text-axal-faint">
          {!ws.preview && <span>{updated ? `Updated ${updated}` : 'Not loaded yet'}</span>}
          {!ws.preview && (
            <button
              type="button"
              onClick={ws.refresh}
              disabled={ws.cycleId == null}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-axal-hairline px-2.5 py-1 font-semibold text-axal-muted hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800 lg:min-h-0"
            >
              <RefreshCw size={12} aria-hidden="true" /> Refresh
            </button>
          )}
        </span>
      </div>

      {ws.notice && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" data-testid="cohort-fallback">
          {ws.notice.reason === 'invalid'
            ? `“${ws.notice.raw}” is not a cohort id, so ${ws.notice.shown} is shown instead.`
            : `You are not assigned to cohort ${ws.notice.raw}, so ${ws.notice.shown} is shown instead.`}
        </p>
      )}

      <nav aria-label="Cohorts sections" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {COHORT_SECTIONS.map((s) => {
          const on = s.slug == null ? pathname === '/cohorts' || pathname === '/cohorts/' : pathname === s.path;
          return (
            <Link
              key={s.path}
              to={ws.href(s.path)}
              aria-current={on ? 'page' : undefined}
              data-testid={`cohort-tab-${s.slug || 'overview'}`}
              className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full border px-3 text-[11.5px] lg:min-h-[32px] ${on
                ? 'border-emerald-300 bg-emerald-50 font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                : 'border-axal-hairline bg-white font-semibold text-axal-muted hover:border-emerald-400 hover:text-emerald-800 dark:border-gray-700 dark:bg-transparent dark:text-gray-300'}`}
            >
              {s.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
