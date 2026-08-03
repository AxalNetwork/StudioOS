// Cohort Timing & Gating — admin timeline + review queue. Rendered as the
// "Timing" tab of AdminSpinoutLab. Everything shown here is decided by the
// Worker cron; this UI only inspects it and issues audited overrides.
//
// Worker-only endpoints (dev backend answers 404/405) — the load error path
// shows an explanatory fallback instead of a broken page, matching the
// existing dev/Worker parity convention.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Clock, CalendarRange, AlertTriangle, ShieldCheck, ShieldX,
  Hourglass, Eye, CheckCircle2, XCircle,
} from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';

function parseUtc(ts) {
  if (!ts) return null;
  const ms = Date.parse(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : null;
}
function fmt(ts) {
  const ms = parseUtc(ts);
  if (ms === null) return '—';
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function timeUntil(ts) {
  const ms = parseUtc(ts);
  if (ms === null) return null;
  const diff = ms - Date.now();
  if (diff <= 0) return 'passed';
  const h = Math.floor(diff / 3600_000);
  if (h >= 48) return `${Math.floor(h / 24)}d`;
  return `${h}h ${Math.floor((diff % 3600_000) / 60000)}m`;
}

const STATUS_BADGE = {
  passed: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  failed: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  grace: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  pending: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};

export default function AdminCohortTiming() {
  const [cycles, setCycles] = useState([]);
  const [review, setReview] = useState([]);
  const [atRisk, setAtRisk] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [busyKey, setBusyKey] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tl, rv] = await Promise.all([api.adminCohortTimeline(), api.adminCohortReview()]);
      setCycles(tl?.cycles || []);
      setReview(rv?.review || []);
      setAtRisk(rv?.at_risk || []);
      setUnsupported(false);
    } catch (e) {
      reportError('AdminCohortTiming:load', e);
      setUnsupported(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (key, fn) => {
    setBusyKey(key);
    try { await fn(); await load(); }
    catch (e) { reportError('AdminCohortTiming:action', e); window.alert(e?.message || 'Action failed'); }
    finally { setBusyKey(null); }
  };

  const grantGrace = (row) => {
    const hours = parseInt(window.prompt('Grace extension length in hours (1-168):', '24') || '', 10);
    if (!hours || hours < 1) return;
    const reason = (window.prompt('Reason for the grace extension (required, audited):') || '').trim();
    if (!reason) { window.alert('A reason is required.'); return; }
    act(`grace:${row.user_id}:${row.week}`, () => api.adminCohortGrace({
      user_id: row.user_id, cycle_id: row.cycle_id ?? row.cohort_cycle_id, week: row.week ?? row.week_number, hours, reason,
    }));
  };

  const override = (row, decision) => {
    const reason = (window.prompt(`Reason for force-${decision} (required, audited):`) || '').trim();
    if (!reason) { window.alert('A reason is required.'); return; }
    act(`override:${row.user_id}:${decision}`, () => api.adminCohortOverride({
      user_id: row.user_id, cycle_id: row.cycle_id ?? row.cohort_cycle_id, week: row.week ?? row.week_number, decision, reason,
    }));
  };

  if (unsupported) {
    return (
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center" data-testid="cohort-timing-unsupported">
        <Clock size={24} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Cohort timing runs on the production Worker</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          The timeline, review queue and overrides are served by the Worker cron scheduler and aren't available from the dev backend.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="admin-cohort-timing">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Cohorts start the 1st of each month at midnight Delaware time · weeks unlock &amp; lock automatically on the Worker scheduler.
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100" data-testid="button-cohort-refresh">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* ---- Cycle timeline ---- */}
      <section>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5">
          <CalendarRange size={12} /> Cohort timeline
        </div>
        {cycles.length === 0 && !loading && (
          <div className="text-sm text-gray-500 dark:text-gray-400">No cycles materialized yet — the scheduler creates the current and next month automatically.</div>
        )}
        <div className="space-y-3">
          {cycles.map((cy) => (
            <div key={cy.id} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4" data-testid={`cohort-cycle-${cy.id}`}>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <div className="text-sm font-bold text-gray-900 dark:text-gray-50">
                  {new Date(cy.year, cy.month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} cohort
                </div>
                <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${cy.status === 'active' ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300' : cy.status === 'completed' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
                  {cy.status}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">{cy.participant_count} participant{cy.participant_count === 1 ? '' : 's'}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {(cy.windows || []).map((w) => {
                  const until = timeUntil(w.deadline_at);
                  const counts = (cy.status_counts || []).filter((s) => s.week_number === w.week_number);
                  return (
                    <div key={w.week_number} className="rounded-xl border border-gray-100 dark:border-gray-800 px-3 py-2">
                      <div className="text-xs font-bold text-gray-700 dark:text-gray-300">Week {w.week_number}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">Opens {fmt(w.unlock_at)}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        Deadline {fmt(w.deadline_at)}{until && until !== 'passed' ? ` · in ${until}` : ''}
                      </div>
                      {counts.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {counts.map((s) => (
                            <span key={s.status} className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${STATUS_BADGE[s.status] || STATUS_BADGE.pending}`}>
                              {s.n} {s.status}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- At-risk ---- */}
      <section>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5">
          <AlertTriangle size={12} /> At risk — incomplete with a live deadline
        </div>
        {atRisk.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">No founders currently at risk.</div>
        ) : (
          <div className="space-y-2">
            {atRisk.map((r) => (
              <div key={`${r.user_id}:${r.week}`} className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/10 px-3 py-2 flex flex-wrap items-center gap-2" data-testid={`at-risk-${r.user_id}-${r.week}`}>
                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{r.name || r.email}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400">Week {r.week} · {r.done}/{r.required} required done · deadline in {timeUntil(r.deadline_at) || '—'}</span>
                <span className="text-[11px] text-amber-700 dark:text-amber-400 truncate max-w-[24rem]">missing: {(r.missing || []).join(', ')}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Review queue: failed & grace ---- */}
      <section>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5">
          <Hourglass size={12} /> Review queue — failed &amp; grace
        </div>
        {review.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Nothing awaiting review.</div>
        ) : (
          <div className="space-y-2">
            {review.map((r) => {
              const key = `${r.user_id}:${r.week_number}`;
              return (
                <div key={r.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2 flex flex-wrap items-center gap-2" data-testid={`review-row-${r.user_id}-${r.week_number}`}>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{r.name || r.email}</span>
                  <span className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 ${STATUS_BADGE[r.status] || STATUS_BADGE.pending}`}>{r.status}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Week {r.week_number} · {r.deliverables_done}/{r.deliverables_required} done · decided {fmt(r.decided_at)} by {r.decided_by || 'system'}
                  </span>
                  {r.status === 'grace' && r.grace_until && (
                    <span className="text-[11px] text-amber-700 dark:text-amber-400">grace until {fmt(r.grace_until)}</span>
                  )}
                  {r.decision_reason && <span className="text-[11px] text-gray-400 truncate max-w-[20rem]">{r.decision_reason}</span>}
                  <span className="ml-auto flex items-center gap-1.5">
                    {r.status !== 'grace' && (
                      <button type="button" disabled={busyKey === `grace:${key}`} onClick={() => grantGrace(r)}
                        className="inline-flex items-center gap-1 text-xs font-semibold rounded-lg border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 px-2 py-1 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                        data-testid={`button-grace-${r.user_id}-${r.week_number}`}>
                        <Hourglass size={12} /> Grace
                      </button>
                    )}
                    <button type="button" disabled={busyKey === `override:${r.user_id}:pass`} onClick={() => override(r, 'pass')}
                      className="inline-flex items-center gap-1 text-xs font-semibold rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 px-2 py-1 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                      data-testid={`button-force-pass-${r.user_id}-${r.week_number}`}>
                      <CheckCircle2 size={12} /> Force pass
                    </button>
                    <button type="button" disabled={busyKey === `override:${r.user_id}:fail`} onClick={() => override(r, 'fail')}
                      className="inline-flex items-center gap-1 text-xs font-semibold rounded-lg border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-2 py-1 hover:bg-red-50 dark:hover:bg-red-900/20"
                      data-testid={`button-force-fail-${r.user_id}-${r.week_number}`}>
                      <XCircle size={12} /> Force fail
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
