// Task #102 — Admin Spin-Out Lab dashboard: applications inbox (review +
// approve/refuse with cohort assignment) and cohort participants (week-by-
// week milestone progress, tool unlocks, workspace access via the existing
// admin impersonation flow). Rendered both as the AdminPage
// "Spin-Out Lab" tab and standalone at /admin/spinout-lab.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check, X, RefreshCw, Search, FlaskConical, Users, Inbox, ExternalLink,
  Lock, Unlock, ChevronRight, Calendar, Building2, CircleDashed,
} from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';

// Presentational labels only — the catalog itself (keys, weeks, unlock
// lists) always comes from the server so it can never drift from the
// founder-side source of truth.
const MILESTONE_LABELS = {
  project_created: 'Startup project created',
  customer_interview_logged_1: 'Customer interview #1 logged',
  customer_interview_logged_2: 'Customer interview #2 logged',
  customer_interview_logged_3: 'Customer interview #3 logged',
  okrs_created: 'Quarterly OKRs created',
  brand_basics_filled: 'Brand basics filled in',
  pitch_deck_drafted: 'Pitch deck drafted',
  scoring_run_completed: 'AI scoring run completed',
  advisor_meeting_booked: 'Advisor meeting booked',
  cofounder_request_sent: 'Co-founder intro request sent',
  incorporation_completed: 'Incorporation completed',
};

// Mirrors SpinoutLabSidebar's FEATURE_CATALOGUE labels.
const FEATURE_LABELS = {
  'spinout-lab': 'Spin-Out Lab',
  projects: 'Startups',
  'customer-discovery': 'Customer Discovery',
  'market-intelligence': 'Market Intelligence',
  roadmap: 'Roadmap',
  'brand-builder': 'Brand Builder',
  'pitch-deck': 'Pitch Deck',
  'cofounder-match': 'Co-founder Match',
  advisors: 'Advisors',
  'office-hours': 'Office Hours',
  scoring: 'AI Scoring',
  incorporate: 'Incorporate',
  captable: 'Cap Table',
  'section-83b': 'Section 83(b)',
  'cofounder-agreement': 'Co-founder Agreement',
  capital: 'Capital',
  compliance: 'Compliance Calendar',
};

const STATUS_PILL = {
  active: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/40 border-emerald-200 dark:border-emerald-800/50',
  graduated: 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/40 border-violet-200 dark:border-violet-800/50',
  admitted: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/40 border-amber-200 dark:border-amber-800/50',
};
const STATUS_LABEL = { active: 'Active', graduated: 'Graduated', admitted: 'Admitted — not started' };

const APP_STATUS_PILL = {
  pending: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/40 border-amber-200 dark:border-amber-800/50',
  accepted: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/40 border-emerald-200 dark:border-emerald-800/50',
  refused: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/40 border-red-200 dark:border-red-800/50',
};

const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(String(s).includes('T') || String(s).includes('Z') ? s : `${String(s).replace(' ', 'T')}Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : '—';
};

// x/y milestone completion against the shared catalog: every requiredAll
// key counts one; a requiredAny group counts one (met by any member).
function milestoneProgress(participant, catalog) {
  const done = new Set((participant.milestones || []).map((m) => m.key));
  let total = 0;
  let completed = 0;
  for (const w of catalog || []) {
    for (const k of w.required_all || []) { total += 1; if (done.has(k)) completed += 1; }
    if ((w.required_any || []).length > 0) {
      total += 1;
      if ((w.required_any || []).some((k) => done.has(k))) completed += 1;
    }
  }
  return { completed, total };
}

function Pill({ className, children }) {
  return (
    <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 border ${className}`}>{children}</span>
  );
}

// ---------------------------------------------------------------------------
// Applications inbox
// ---------------------------------------------------------------------------
function ApplicationsSection({ apps, loading, onDecided }) {
  const [statusFilter, setStatusFilter] = useState('pending');
  const [cohortFilter, setCohortFilter] = useState('all');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [deciding, setDeciding] = useState(false);
  const [approveCohort, setApproveCohort] = useState('');

  const cohorts = useMemo(
    () => [...new Set(apps.map((a) => a.cohort).filter(Boolean))].sort(),
    [apps],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return apps.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (cohortFilter !== 'all' && a.cohort !== cohortFilter) return false;
      if (!needle) return true;
      return [a.company_name, a.name, a.email, a.idea]
        .some((f) => (f || '').toLowerCase().includes(needle));
    });
  }, [apps, statusFilter, cohortFilter, q]);

  const selected = useMemo(
    () => filtered.find((a) => a.id === selectedId) || apps.find((a) => a.id === selectedId) || null,
    [filtered, apps, selectedId],
  );

  // Cohort options for approval: the applied cohort + every known cohort +
  // a couple of next ones so an admin can push an applicant forward.
  const approveOptions = useMemo(() => {
    const opts = new Set(cohorts);
    if (selected?.cohort) opts.add(selected.cohort);
    const nums = [...opts].map((c) => /^Cohort (\d+)$/.exec(c)?.[1]).filter(Boolean).map(Number);
    const maxN = nums.length ? Math.max(...nums) : 3;
    opts.add(`Cohort ${maxN + 1}`);
    opts.add(`Cohort ${maxN + 2}`);
    return [...opts].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [cohorts, selected]);

  useEffect(() => {
    setApproveCohort(selected?.cohort || '');
  }, [selected?.id, selected?.cohort]);

  const decide = async (app, decision) => {
    const cohort = decision === 'accepted' ? (approveCohort || app.cohort) : undefined;
    const verb = decision === 'accepted' ? 'Accept' : 'Refuse';
    const ok = window.confirm(
      `${verb} ${app.name || app.email}'s application for "${app.company_name}"?\n\n` +
      (decision === 'accepted'
        ? `They'll be admitted to ${cohort || 'the Lab'} and receive the "You're in" email with a link to their Spin-Out Lab workspace.`
        : `They'll receive an email encouraging them to re-apply for the next cohort.`),
    );
    if (!ok) return;
    setDeciding(true);
    try {
      const res = await api.adminSpinoutDecide(app.id, decision, cohort !== app.cohort ? cohort : undefined);
      alert(`Application ${decision}.${res?.emailed ? ' Email sent.' : ' Email not sent (dev or send failure).'}`);
      onDecided();
    } catch (e) { alert(e.message || 'Failed to decide'); }
    finally { setDeciding(false); }
  };

  return (
    <div data-testid="admin-lab-applications-panel">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search company, founder, idea…"
            data-testid="input-application-search"
            className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 w-64"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          data-testid="select-application-status"
          className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2.5 py-1.5"
        >
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="refused">Refused</option>
          <option value="all">All statuses</option>
        </select>
        <select
          value={cohortFilter}
          onChange={(e) => setCohortFilter(e.target.value)}
          data-testid="select-application-cohort"
          className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2.5 py-1.5"
        >
          <option value="all">All cohorts</option>
          {cohorts.map((cName) => <option key={cName} value={cName}>{cName}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-16">Loading applications…</div>
      ) : filtered.length === 0 ? (
        <div className="text-gray-500 text-center py-16 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
          {apps.length === 0 ? 'No applications yet.' : 'No applications match these filters.'}
        </div>
      ) : (
        <div className="grid lg:grid-cols-5 gap-4 items-start">
          <div className="lg:col-span-2 space-y-2">
            {filtered.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedId(a.id)}
                data-testid={`lab-application-${a.id}`}
                className={`w-full text-left bg-white dark:bg-gray-900 border rounded-xl p-3 transition-colors ${selectedId === a.id ? 'border-violet-400 dark:border-violet-600 ring-1 ring-violet-200 dark:ring-violet-800' : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm text-gray-900 dark:text-gray-100 truncate">{a.company_name}</span>
                  <Pill className={APP_STATUS_PILL[a.status] || APP_STATUS_PILL.pending}>{a.status}</Pill>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{a.name} · {a.email}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">{a.cohort} · {fmtDate(a.created_at)}</div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-3 lg:sticky lg:top-4">
            {!selected ? (
              <div className="text-gray-400 text-sm text-center py-16 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
                Select an application to review it.
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5" data-testid="application-detail">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{selected.company_name}</h3>
                      <Pill className="text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/50 border-violet-100 dark:border-violet-800/50">{selected.cohort}</Pill>
                      <Pill className={APP_STATUS_PILL[selected.status] || APP_STATUS_PILL.pending}>{selected.status}</Pill>
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">{selected.name} · {selected.email}</div>
                  </div>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-xs">
                  <div><dt className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">Incorporated</dt><dd className="text-gray-800 dark:text-gray-200 mt-0.5">{selected.incorporated === 'yes' ? 'Yes' : 'Not yet'}</dd></div>
                  <div><dt className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">Stage</dt><dd className="text-gray-800 dark:text-gray-200 mt-0.5">{selected.stage || '—'}</dd></div>
                  <div><dt className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">Jurisdiction</dt><dd className="text-gray-800 dark:text-gray-200 mt-0.5">{selected.jurisdiction || '—'}</dd></div>
                  <div><dt className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">Applied</dt><dd className="text-gray-800 dark:text-gray-200 mt-0.5">{fmtDate(selected.created_at)}</dd></div>
                </dl>

                <div className="mt-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Idea</div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{selected.idea || '—'}</p>
                </div>

                {selected.status === 'pending' ? (
                  <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-end gap-3">
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                      Admit into cohort
                      <select
                        value={approveCohort}
                        onChange={(e) => setApproveCohort(e.target.value)}
                        data-testid="select-approve-cohort"
                        className="block mt-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2.5 py-1.5"
                      >
                        {approveOptions.map((cName) => (
                          <option key={cName} value={cName}>{cName}{cName === selected.cohort ? ' (applied)' : ''}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      onClick={() => decide(selected, 'accepted')}
                      disabled={deciding}
                      data-testid={`lab-application-accept-${selected.id}`}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <Check size={13} /> Accept
                    </button>
                    <button
                      onClick={() => decide(selected, 'refused')}
                      disabled={deciding}
                      data-testid={`lab-application-refuse-${selected.id}`}
                      className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5"
                    >
                      <X size={13} /> Refuse
                    </button>
                  </div>
                ) : (
                  <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400">
                    Decided {fmtDate(selected.decided_at)}.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cohort participants
// ---------------------------------------------------------------------------
function ParticipantsSection({ participants, catalog, loading, onOpenWorkspace, openingId }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [cohortFilter, setCohortFilter] = useState('all');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const cohorts = useMemo(
    () => [...new Set(participants.map((p) => p.cohort).filter(Boolean))].sort(),
    [participants],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return participants.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (cohortFilter !== 'all' && p.cohort !== cohortFilter) return false;
      if (!needle) return true;
      return [p.name, p.email, p.company_name, p.sector]
        .some((f) => (f || '').toLowerCase().includes(needle));
    });
  }, [participants, statusFilter, cohortFilter, q]);

  const selected = useMemo(
    () => participants.find((p) => p.user_id === selectedId) || null,
    [participants, selectedId],
  );

  const doneKeys = useMemo(
    () => new Set((selected?.milestones || []).map((m) => m.key)),
    [selected],
  );
  const unlocked = useMemo(
    () => new Set(selected?.unlocked_features || []),
    [selected],
  );

  return (
    <div data-testid="admin-lab-participants-panel">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search founder or company…"
            data-testid="input-participant-search"
            className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 w-64"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          data-testid="select-participant-status"
          className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2.5 py-1.5"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="admitted">Admitted — not started</option>
          <option value="graduated">Graduated</option>
        </select>
        <select
          value={cohortFilter}
          onChange={(e) => setCohortFilter(e.target.value)}
          data-testid="select-participant-cohort"
          className="text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2.5 py-1.5"
        >
          <option value="all">All cohorts</option>
          {cohorts.map((cName) => <option key={cName} value={cName}>{cName}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-16">Loading participants…</div>
      ) : filtered.length === 0 ? (
        <div className="text-gray-500 text-center py-16 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
          {participants.length === 0 ? 'No admitted founders yet — accept an application to get started.' : 'No participants match these filters.'}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="px-3 py-2.5 font-semibold">Founder</th>
                  <th className="px-3 py-2.5 font-semibold">Company</th>
                  <th className="px-3 py-2.5 font-semibold">Cohort</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Week / Day</th>
                  <th className="px-3 py-2.5 font-semibold">Milestones</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const prog = milestoneProgress(p, catalog);
                  return (
                    <tr
                      key={p.user_id}
                      onClick={() => setSelectedId(p.user_id === selectedId ? null : p.user_id)}
                      data-testid={`lab-participant-${p.user_id}`}
                      className={`border-b border-gray-50 dark:border-gray-800/60 last:border-0 cursor-pointer ${selectedId === p.user_id ? 'bg-violet-50/60 dark:bg-violet-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'}`}
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{p.name || '—'}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{p.email}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-gray-800 dark:text-gray-200">{p.company_name || '—'}</div>
                        {p.sector && <div className="text-xs text-gray-400">{p.sector}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300">{p.cohort || '—'}</td>
                      <td className="px-3 py-2.5"><Pill className={STATUS_PILL[p.status]}>{STATUS_LABEL[p.status]}</Pill></td>
                      <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300">
                        {p.status === 'admitted' ? '—' : `W${p.week}${p.day ? ` · D${p.day}` : ''}`}
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300">{prog.completed}/{prog.total}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                          Details <ChevronRight size={13} className={`transition-transform ${selectedId === p.user_id ? 'rotate-90' : ''}`} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="mt-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5" data-testid="participant-detail">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{selected.name || selected.email}</h3>
                    <Pill className={STATUS_PILL[selected.status]}>{STATUS_LABEL[selected.status]}</Pill>
                    {selected.cohort && <Pill className="text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/50 border-violet-100 dark:border-violet-800/50">{selected.cohort}</Pill>}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-300 mt-1 flex items-center gap-1.5">
                    <Building2 size={14} className="text-gray-400" />
                    {selected.company_name || 'No company yet'}{selected.sector ? ` · ${selected.sector}` : ''}
                  </div>
                </div>
                <button
                  onClick={() => onOpenWorkspace(selected)}
                  disabled={openingId === selected.user_id}
                  data-testid={`button-open-workspace-${selected.user_id}`}
                  className="px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 hover:opacity-90 text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5"
                  title="Impersonate this founder and open their Spin-Out Lab workspace (banner + exit as usual)"
                >
                  <ExternalLink size={13} /> {openingId === selected.user_id ? 'Opening…' : 'Open workspace'}
                </button>
              </div>

              {/* Workspace summary */}
              <dl className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 text-xs" data-testid="participant-workspace-summary">
                <div><dt className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">Started</dt><dd className="text-gray-800 dark:text-gray-200 mt-0.5">{fmtDate(selected.started_at)}</dd></div>
                <div><dt className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">Week</dt><dd className="text-gray-800 dark:text-gray-200 mt-0.5">{selected.status === 'admitted' ? 'Not started' : `Week ${selected.week} of 4`}</dd></div>
                <div><dt className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">Day</dt><dd className="text-gray-800 dark:text-gray-200 mt-0.5">{selected.day ? `Day ${selected.day} of 28` : '—'}</dd></div>
                <div><dt className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">Days remaining</dt><dd className="text-gray-800 dark:text-gray-200 mt-0.5">{selected.days_remaining ?? '—'}</dd></div>
                <div><dt className="text-gray-400 font-semibold uppercase tracking-wide text-[10px]">Incorporated</dt><dd className="text-gray-800 dark:text-gray-200 mt-0.5">{selected.is_incorporated ? 'Yes' : 'No'}</dd></div>
              </dl>

              <div className="grid md:grid-cols-2 gap-6 mt-5">
                {/* Week-by-week milestone checklist */}
                <div data-testid="participant-milestones">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Milestones</div>
                  <div className="space-y-4">
                    {(catalog || []).map((w) => {
                      const anyMet = (w.required_any || []).some((k) => doneKeys.has(k));
                      return (
                        <div key={w.week}>
                          <div className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 flex items-center gap-1.5">
                            <Calendar size={12} className="text-gray-400" /> Week {w.week}
                            {selected.status !== 'admitted' && selected.week === w.week && selected.status === 'active' && (
                              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">· current</span>
                            )}
                          </div>
                          <ul className="space-y-1">
                            {(w.required_all || []).map((k) => (
                              <li key={k} className="flex items-center gap-2 text-sm">
                                {doneKeys.has(k)
                                  ? <Check size={14} className="text-emerald-500 shrink-0" />
                                  : <CircleDashed size={14} className="text-gray-300 dark:text-gray-600 shrink-0" />}
                                <span className={doneKeys.has(k) ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}>
                                  {MILESTONE_LABELS[k] || k}
                                </span>
                              </li>
                            ))}
                            {(w.required_any || []).length > 0 && (
                              <li className="text-sm">
                                <div className={`flex items-center gap-2 ${anyMet ? '' : ''}`}>
                                  {anyMet
                                    ? <Check size={14} className="text-emerald-500 shrink-0" />
                                    : <CircleDashed size={14} className="text-gray-300 dark:text-gray-600 shrink-0" />}
                                  <span className={anyMet ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}>
                                    Any one of:
                                  </span>
                                </div>
                                <ul className="ml-6 mt-0.5 space-y-0.5">
                                  {(w.required_any || []).map((k) => (
                                    <li key={k} className={`text-xs ${doneKeys.has(k) ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-gray-400 dark:text-gray-500'}`}>
                                      {MILESTONE_LABELS[k] || k}
                                    </li>
                                  ))}
                                </ul>
                              </li>
                            )}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Tool unlock grid */}
                <div data-testid="participant-tools">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                    Tool unlocks ({unlocked.size} of {(catalog || []).reduce((n, w) => n + (w.unlocked_features || []).length, 0)})
                  </div>
                  <div className="space-y-4">
                    {(catalog || []).map((w) => (
                      <div key={w.week}>
                        <div className="text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">Week {w.week}</div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {(w.unlocked_features || []).map((f) => {
                            const isOpen = unlocked.has(f);
                            return (
                              <div
                                key={f}
                                className={`flex items-center gap-1.5 text-xs rounded-lg border px-2 py-1.5 ${isOpen ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/60 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300' : 'border-gray-100 dark:border-gray-800 text-gray-400 dark:text-gray-500'}`}
                              >
                                {isOpen ? <Unlock size={12} className="shrink-0" /> : <Lock size={12} className="shrink-0" />}
                                <span className="truncate">{FEATURE_LABELS[f] || f}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------
export default function AdminSpinoutLab({ onImpersonate, standalone = false }) {
  const navigate = useNavigate();
  const [section, setSection] = useState('applications');
  const [apps, setApps] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [appsRes, partsRes] = await Promise.all([
        api.adminSpinoutApplications().catch((e) => { reportError('AdminSpinoutLab:applications', e); return null; }),
        api.adminSpinoutParticipants().catch((e) => { reportError('AdminSpinoutLab:participants', e); return null; }),
      ]);
      setApps(appsRes?.applications || []);
      setParticipants(partsRes?.participants || []);
      setCatalog(partsRes?.catalog || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openWorkspace = async (p) => {
    setOpeningId(p.user_id);
    try {
      const res = await api.adminImpersonate(p.user_id);
      if (onImpersonate) {
        // Third arg = target path. The App-level handler owns the
        // navigation (including the role-guard redirect that fires while
        // the session flips admin→founder), so no navigate() here.
        onImpersonate(res.token, res.user, '/spinout-lab');
      } else {
        navigate('/spinout-lab');
      }
    } catch (e) { alert(e.message || 'Failed to open workspace'); }
    finally { setOpeningId(null); }
  };

  const pendingCount = apps.filter((a) => a.status === 'pending').length;

  const body = (
    <div data-testid="admin-spinout-lab">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <FlaskConical size={18} className="text-violet-500" />
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Spin-Out Lab</h2>
        </div>
        <button onClick={load} className="text-xs font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1.5" data-testid="button-refresh-spinout-lab">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="flex gap-1.5 mb-5" role="tablist">
        <button
          role="tab"
          aria-selected={section === 'applications'}
          onClick={() => setSection('applications')}
          data-testid="tab-applications"
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${section === 'applications' ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
        >
          <Inbox size={14} /> Applications
          {pendingCount > 0 && (
            <span className="text-[10px] font-bold bg-amber-400 text-amber-950 rounded-full px-1.5 py-0.5">{pendingCount}</span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={section === 'participants'}
          onClick={() => setSection('participants')}
          data-testid="tab-participants"
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${section === 'participants' ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
        >
          <Users size={14} /> Participants
          {participants.length > 0 && (
            <span className="text-[10px] font-bold bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-full px-1.5 py-0.5">{participants.length}</span>
          )}
        </button>
      </div>

      {section === 'applications' ? (
        <ApplicationsSection apps={apps} loading={loading} onDecided={load} />
      ) : (
        <ParticipantsSection
          participants={participants}
          catalog={catalog}
          loading={loading}
          onOpenWorkspace={openWorkspace}
          openingId={openingId}
        />
      )}
    </div>
  );

  if (!standalone) return body;
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {body}
    </div>
  );
}
