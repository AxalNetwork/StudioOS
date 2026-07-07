/**
 * OverviewTab — the founder's default Command Center landing surface.
 *
 * Resolves the founder's project (?project_id= or first in scope), then composes:
 *   1. a venture snapshot card (name / status / playbook week / score-tier),
 *   2. the editable LifecycleModule, and
 *   3. a read-only traction strip (MRR, active users, churn|new users, traction
 *      score) that deep-links into /build/metrics.
 *
 * Every sub-fetch is independent (Promise.allSettled) so one failing endpoint
 * never blanks the page. Deliberately NO runway tile — the metrics schema has
 * no runway column.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TrendingUp, Users, Activity, Target, FolderPlus, ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import LifecycleModule from './LifecycleModule';

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtNum(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return isFinite(n) ? n.toLocaleString() : '—';
}

function fmtPct(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return isFinite(n) ? `${n.toFixed(1)}%` : '—';
}

function latestSnapshot(snaps) {
  if (!Array.isArray(snaps) || snaps.length === 0) return null;
  return [...snaps].sort((a, b) =>
    String(b.snapshot_date || '').localeCompare(String(a.snapshot_date || '')),
  )[0];
}

function StatCard({ icon: Icon, label, value, to }) {
  const inner = (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
        <Icon size={15} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1.5 text-xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
  return to ? (
    <Link
      to={to}
      className="block rounded-xl transition hover:ring-2 hover:ring-violet-200 dark:hover:ring-violet-800"
    >
      {inner}
    </Link>
  ) : (
    inner
  );
}

export default function OverviewTab() {
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState(null); // null = loading
  const [projectId, setProjectId] = useState(null);
  const [data, setData] = useState({ lifecycle: null, project: null, score: null, snapshot: null, signals: null });
  const [error, setError] = useState(null);

  // Resolve the active project (mirrors MetricsPage's ?project_id → first-in-scope pattern).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await api.listProjects();
        if (!alive) return;
        const safe = list || [];
        setProjects(safe);
        const fromQuery = parseInt(searchParams.get('project_id'), 10);
        if (fromQuery && safe.find((p) => p.id === fromQuery)) setProjectId(fromQuery);
        else if (safe.length > 0) setProjectId(safe[0].id);
      } catch (e) {
        if (!alive) return;
        const msg = (e?.message || '').toLowerCase();
        if (e?.status === 404 || msg.includes('not found')) {
          setProjects([]);
          return;
        }
        reportError('OverviewTab:listProjects', e);
        setProjects([]);
        setError('Could not load your startups.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [searchParams]);

  const loadAll = useCallback(async (pid) => {
    const [lc, pr, sc, ms, sg] = await Promise.allSettled([
      api.getLifecycle(pid),
      api.getProject(pid),
      api.getScores(pid),
      api.listMetricsSnapshots(pid),
      api.getProgressSignals(pid),
    ]);
    if (lc.status === 'rejected') reportError('OverviewTab:getLifecycle', lc.reason);
    setData({
      lifecycle: lc.status === 'fulfilled' ? lc.value : null,
      project: pr.status === 'fulfilled' ? pr.value : null,
      score: sc.status === 'fulfilled' ? (Array.isArray(sc.value) ? sc.value[0] : sc.value) : null,
      snapshot: ms.status === 'fulfilled' ? latestSnapshot(ms.value?.snapshots) : null,
      signals: sg.status === 'fulfilled' ? sg.value : null,
    });
  }, []);

  useEffect(() => {
    if (projectId != null) loadAll(projectId);
  }, [projectId, loadAll]);

  const onSetStage = useCallback(
    async (stage) => {
      if (projectId == null) return;
      try {
        const lc = await api.updateLifecycle(projectId, { stage });
        setData((d) => ({ ...d, lifecycle: lc }));
        setError(null);
      } catch (e) {
        reportError('OverviewTab:setStage', e);
        setError('Could not update your stage.');
      }
    },
    [projectId],
  );

  const onToggleCheck = useCallback(
    async (key, done) => {
      if (projectId == null) return;
      try {
        const lc = await api.updateLifecycle(projectId, { manual_checks: { [key]: done } });
        setData((d) => ({ ...d, lifecycle: lc }));
        setError(null);
      } catch (e) {
        reportError('OverviewTab:toggleCheck', e);
        setError('Could not save that check.');
      }
    },
    [projectId],
  );

  if (projects === null) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Loading your Command Center…</div>;
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
        <FolderPlus className="mx-auto text-gray-400" size={28} />
        <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-gray-100">No startup yet</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Submit your first startup to get it scored and start tracking its lifecycle.
        </p>
        <Link
          to="/build/command-center?tab=founder-portal"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          <FolderPlus size={15} /> Submit a startup
        </Link>
      </div>
    );
  }

  const { lifecycle, project, score, snapshot, signals } = data;
  const metricsHref = `/build/metrics?project_id=${projectId}`;
  const churnHasValue =
    snapshot && snapshot.monthly_churn_pct !== null && snapshot.monthly_churn_pct !== undefined && snapshot.monthly_churn_pct !== '';
  const tierLabel = score ? score.tier_label || score.tier : null;

  return (
    <div className="space-y-5" data-testid="overview-tab">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Venture snapshot */}
      <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Your venture</p>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{project?.name || '—'}</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {project?.status && (
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium capitalize text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                {String(project.status).replace(/_/g, ' ')}
              </span>
            )}
            {project?.playbook_week !== null && project?.playbook_week !== undefined && (
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                Week {project.playbook_week}
              </span>
            )}
            {tierLabel && (
              <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                {tierLabel}
                {score?.total_score !== null && score?.total_score !== undefined ? ` · ${Math.round(score.total_score)}` : ''}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Lifecycle */}
      <LifecycleModule lifecycle={lifecycle} canEdit onSetStage={onSetStage} onToggleCheck={onToggleCheck} />

      {/* Traction strip (read-only, deep-links to metrics). No runway tile. */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Traction snapshot</p>
          <Link
            to={metricsHref}
            className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline dark:text-violet-300"
          >
            Open metrics <ArrowRight size={12} />
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={TrendingUp} label="MRR" value={fmtMoney(snapshot?.mrr)} to={metricsHref} />
          <StatCard icon={Users} label="Active users" value={fmtNum(snapshot?.active_users)} to={metricsHref} />
          <StatCard
            icon={Activity}
            label={churnHasValue ? 'Monthly churn' : 'New users'}
            value={churnHasValue ? fmtPct(snapshot?.monthly_churn_pct) : fmtNum(snapshot?.new_users)}
            to={metricsHref}
          />
          <StatCard
            icon={Target}
            label="Traction score"
            value={signals && signals.total !== null && signals.total !== undefined ? `${signals.total}/${signals.max ?? 10}` : '—'}
            to={metricsHref}
          />
        </div>
      </section>
    </div>
  );
}
