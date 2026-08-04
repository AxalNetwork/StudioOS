// Spin-Out Lab "Startups" tool page — the founder's company record, per the
// design handoff (attached_assets/Spin-Out_Lab_Workspace.dc_*.html, tool-pages
// section / repo spin-out-lab-pipeline/project). Everything renders from live
// data: GET /spinout-lab/state (week, milestones, cohort, application),
// GET /projects (the founder's own record) and the signed-in user. The design's
// mock content (NovaCraft copy, fake documents, fake dates) is NOT reproduced —
// documents and activity derive from real milestone completions, and a founder
// without a record gets an explicit create CTA instead of placeholder data.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronRight,
  FileText,
  Loader2,
  Lock,
  X,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { reportError } from '../lib/log';
import { TOOL_INFO, WEEK_DEFS, countDeliverables, milestoneKeySet } from './SpinoutLabWorkspace';

// Past-tense titles for the activity timeline; falls back to the raw key.
const MILESTONE_LABELS = {
  project_created: 'Startup record created',
  customer_interview_logged_1: 'Customer interview #1 logged',
  customer_interview_logged_2: 'Customer interview #2 logged',
  customer_interview_logged_3: 'Customer interview #3 logged',
  okrs_created: '90-day OKRs set',
  brand_basics_filled: 'Brand v1 drafted',
  pitch_deck_drafted: 'Pitch deck v1 drafted',
  scoring_run_completed: 'Venture-readiness score run',
  advisor_meeting_booked: 'Advisor session booked',
  cofounder_request_sent: 'Co-founder intro request sent',
  incorporation_completed: 'Entity incorporated',
};

const CHIP = {
  complete: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  progress: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
  notStarted: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  locked: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  ready: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  missing: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500',
};

function initialsOf(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || '?';
}

function monthYear(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function shortDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// /projects returns the founder's own records plus any they're an accepted
// member of, in no guaranteed order — /spinout-lab/state carries no project
// id to correlate, so select deterministically: own record first (founder_id
// match), spin-out track preferred, oldest first. Never trust list order.
export function pickLabProject(projects, user) {
  if (!Array.isArray(projects) || projects.length === 0) return null;
  const ranked = [...projects].sort((a, b) => {
    const ownA = user?.founder_id != null && a.founder_id === user.founder_id ? 0 : 1;
    const ownB = user?.founder_id != null && b.founder_id === user.founder_id ? 0 : 1;
    if (ownA !== ownB) return ownA - ownB;
    const spinA = a.track_type === 'spin_out' ? 0 : 1;
    const spinB = b.track_type === 'spin_out' ? 0 : 1;
    if (spinA !== spinB) return spinA - spinB;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
  return ranked[0];
}

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 sm:p-6 shadow-sm';

export default function SpinoutLabStartupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [project, setProject] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [previewOpen, setPreviewOpen] = useState(false);
  const dataRoomRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    Promise.all([
      spinoutLab.state().catch(() => null),
      api.listProjects().catch(() => []),
    ])
      .then(([s, projects]) => {
        if (!alive) return;
        setState(s);
        setProject(pickLabProject(projects, user));
        setStatus('ready');
      })
      .catch((e) => {
        if (!alive) return;
        reportError('SpinoutLabStartupPage:load', e);
        setStatus('error');
      });
    return () => { alive = false; };
  }, []);

  const graduated = Boolean(state?.is_incorporated);
  const currentWeek = graduated ? 4 : Math.min(4, Math.max(1, Number(state?.week) || 1));
  const doneKeys = useMemo(() => milestoneKeySet(state?.milestones), [state]);

  const chipDone = (weekNum, keys) => {
    if (keys && keys.length > 0) return keys.every((k) => doneKeys.has(k));
    return graduated || weekNum < currentWeek;
  };

  const derived = useMemo(() => {
    if (!state) return null;

    // Program progress — grouped deliverable units across all four weeks.
    let unitsDone = 0;
    let unitsTotal = 0;
    WEEK_DEFS.forEach((w) => {
      const c = countDeliverables(w, (d) => chipDone(w.num, d.keys));
      unitsDone += c.done;
      unitsTotal += c.total;
    });
    const pct = unitsTotal ? Math.round((unitsDone / unitsTotal) * 100) : 0;
    const weekDef = WEEK_DEFS.find((w) => w.num === currentWeek) || WEEK_DEFS[0];

    // Company readiness rows.
    const wk = (n) => (currentWeek >= n ? null : `Locked · Wk ${n}`);
    const scoringDone = doneKeys.has('scoring_run_completed');
    const readiness = [
      {
        label: 'Legal entity', note: 'Incorporate in Week 4', to: '/incorporate', testid: 'readiness-legal',
        ...(graduated ? { chip: 'Complete', cls: CHIP.complete }
          : wk(4) ? { chip: wk(4), cls: CHIP.locked, locked: true }
          : { chip: 'Not started', cls: CHIP.notStarted }),
      },
      {
        label: 'Cap table', note: 'Founder stock issued in Week 4', to: '/build/captable', testid: 'readiness-captable',
        ...(wk(4) ? { chip: wk(4), cls: CHIP.locked, locked: true }
          : graduated ? { chip: 'In progress', cls: CHIP.progress }
          : { chip: 'Not started', cls: CHIP.notStarted }),
      },
      {
        label: 'Co-founder agreement', note: 'Draft & execute in Week 4', to: '/incorporate/cofounder-agreement', testid: 'readiness-cofounder-agreement',
        ...(wk(4) ? { chip: wk(4), cls: CHIP.locked, locked: true }
          : { chip: 'Not started', cls: CHIP.notStarted }),
      },
      {
        label: 'Scoring / readiness', note: '9-dimension diligence', to: '/scoring', testid: 'readiness-scoring',
        ...(scoringDone ? { chip: 'Complete', cls: CHIP.complete }
          : wk(3) ? { chip: wk(3), cls: CHIP.locked, locked: true }
          : { chip: 'In progress', cls: CHIP.progress }),
      },
    ];

    // Data room — documents the program actually generates, statused from
    // real milestone completions (no simulated files).
    const interviews = ['customer_interview_logged_1', 'customer_interview_logged_2', 'customer_interview_logged_3']
      .filter((k) => doneKeys.has(k)).length;
    const week1Done = graduated || currentWeek > 1;
    const docs = [
      { name: 'Pitch deck v1', meta: doneKeys.has('pitch_deck_drafted') ? 'Presentation' : 'Generates in Week 2', ready: doneKeys.has('pitch_deck_drafted'), testid: 'doc-pitch-deck' },
      { name: 'Market sizing (TAM / SAM)', meta: week1Done ? 'Research' : 'Generates in Week 1', ready: week1Done, testid: 'doc-market-sizing' },
      { name: 'Customer discovery log', meta: `${interviews} of 3 interviews`, ready: interviews >= 3, testid: 'doc-discovery-log' },
      { name: 'Certificate of incorporation', meta: graduated ? 'Formation' : 'Generates in Week 4', ready: graduated, testid: 'doc-incorporation' },
    ];
    const docsReady = docs.filter((d) => d.ready).length;
    readiness.push({
      label: 'Data room', note: `${docsReady} of ${docs.length} key documents`, testid: 'readiness-dataroom', scroll: true,
      ...(docsReady === docs.length ? { chip: 'Complete', cls: CHIP.complete } : { chip: 'In progress', cls: CHIP.progress }),
    });

    // Activity timeline — cohort acceptance, then real milestone completions.
    const activity = [];
    if (state.application?.decided_at && state.application?.status === 'accepted') {
      activity.push({ title: `Accepted to ${state.cohort || 'the cohort'}`, time: shortDate(state.application.decided_at), done: true });
    }
    [...(state.milestones || [])]
      .sort((a, b) => String(a.completed_at || '').localeCompare(String(b.completed_at || '')))
      .forEach((m) => {
        activity.push({
          title: MILESTONE_LABELS[m.key] || m.key,
          time: [shortDate(m.completed_at), `Week ${m.week}`].filter(Boolean).join(' · '),
          done: true,
        });
      });

    // Next required action — first incomplete deliverable in the earliest
    // unlocked week (either/or pairs count once; coming-soon tools skipped).
    let nextAction = null;
    for (const w of WEEK_DEFS) {
      if (w.num > currentWeek || nextAction) break;
      const groupSatisfied = new Set(
        w.deliverables.filter((d) => d.altGroup && chipDone(w.num, d.keys)).map((d) => d.altGroup),
      );
      for (const d of w.deliverables) {
        if (chipDone(w.num, d.keys)) continue;
        if (d.altGroup && groupSatisfied.has(d.altGroup)) continue;
        const tool = TOOL_INFO[d.tool];
        if (!tool || tool.comingSoon) continue;
        nextAction = { title: d.label, cta: `Open ${tool.label}`, to: tool.to };
        break;
      }
    }
    if (!nextAction) {
      nextAction = graduated
        ? { title: 'You\u2019re incorporated — stay compliant', cta: 'Open Compliance', to: '/compliance' }
        : { title: `Week ${currentWeek} complete — keep going in the workspace`, cta: 'Back to Workspace', to: '/spinout-lab' };
    }
    activity.push({ title: nextAction.title, time: 'Upcoming', done: false });

    return { pct, weekDef, readiness, docs, docsReady, activity, nextAction };
  }, [state, doneKeys, currentWeek, graduated]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-24" data-testid="startup-loading">
        <Loader2 className="animate-spin text-violet-600 dark:text-violet-400" size={28} />
      </div>
    );
  }

  if (status === 'error' || !state) {
    return (
      <div className="max-w-lg mx-auto text-center py-24 px-6" data-testid="startup-error">
        <div className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">Couldn&rsquo;t load your startup record</div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Check your connection and try again.</p>
        <button
          type="button"
          data-testid="button-retry-startup"
          onClick={() => window.location.reload()}
          className="h-10 px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }

  const isAdmin = user?.role === 'admin';
  if (!state.active && !graduated && !isAdmin) {
    return (
      <div className="max-w-lg mx-auto text-center py-24 px-6" data-testid="startup-inactive">
        <div className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">Spin-Out Lab isn&rsquo;t active on this account</div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">This page is the company record for active lab founders.</p>
        <Link to="/spinout-lab" className="inline-flex h-10 items-center px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          Go to Spin-Out Lab
        </Link>
      </div>
    );
  }

  const { pct, weekDef, readiness, docs, docsReady, activity, nextAction } = derived;
  const app = state.application || {};
  const name = project?.name || app.company_name || 'Your startup';
  const stageChip = graduated ? 'Incorporated' : 'Pre-formation';
  const founderName = user?.name || 'Founder';
  const hq = app.jurisdiction ? (app.jurisdiction.split('—').pop() || '').trim() || app.jurisdiction : 'Remote-first';
  const cofounderUnlocked = currentWeek >= 3;
  const facts = [
    { k: 'Founded', v: monthYear(project?.created_at) || monthYear(state.started_at) || '—' },
    { k: 'Stage', v: stageChip },
    { k: 'HQ', v: hq },
    { k: 'Team', v: '1 founder' },
    { k: 'Sector', v: project?.sector || '—' },
    { k: 'Cohort', v: state.cohort || '—' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6" data-testid="page-spinout-startup">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <Link
            to="/spinout-lab"
            data-testid="link-back-to-workspace"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-violet-700 dark:hover:text-violet-300 mb-2"
          >
            <ArrowLeft size={14} /> Back to Workspace
          </Link>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Startups</h1>
            <span className="text-[10.5px] font-bold rounded-full px-2.5 py-0.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
              {graduated ? 'Graduated' : 'Active'}
            </span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Your company record and founding team</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            data-testid="button-investor-preview"
            onClick={() => setPreviewOpen(true)}
            disabled={!project}
            className="h-9 px-3.5 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Preview as investor
          </button>
          <Link
            to={project ? `/projects/${project.id}` : '/projects'}
            data-testid="link-edit-record"
            className="h-9 px-3.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-xs font-semibold inline-flex items-center"
          >
            Edit record
          </Link>
        </div>
      </div>

      {/* Program bar */}
      <div
        data-testid="startup-program-bar"
        className="rounded-2xl border border-violet-100 dark:border-violet-900/50 bg-gradient-to-r from-violet-50/70 to-white dark:from-violet-950/30 dark:to-gray-900 p-4 sm:p-5 mb-5 flex items-center gap-5 flex-wrap"
      >
        <div className="min-w-[190px]">
          <div className="text-[11px] font-bold uppercase tracking-wider text-violet-400 dark:text-violet-500">
            30-day program · {pct}% complete
          </div>
          <div className="text-[15px] font-extrabold text-gray-900 dark:text-gray-50 mt-0.5">
            Week {currentWeek} — {weekDef.name}
          </div>
        </div>
        <div className="flex-1 min-w-[200px] max-w-[520px] flex gap-1.5">
          {WEEK_DEFS.map((w) => {
            const done = graduated || w.num < currentWeek;
            const active = !graduated && w.num === currentWeek;
            return (
              <div key={w.num} className="flex-1" title={w.name}>
                <div className={`h-[7px] rounded-full ${done ? 'bg-violet-600' : active ? 'bg-violet-400' : 'bg-gray-200 dark:bg-gray-700'}`} />
                <div className={`text-[10px] font-semibold mt-1 text-center ${done || active ? 'text-violet-700 dark:text-violet-300' : 'text-gray-400 dark:text-gray-500'}`}>
                  Wk {w.num}
                </div>
              </div>
            );
          })}
        </div>
        <Link
          to="/spinout-lab"
          data-testid="link-continue-week"
          className="h-9 px-4 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          Continue Week {currentWeek} <ArrowRight size={14} />
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_.85fr] gap-5 items-start">
        {/* LEFT column */}
        <div className="flex flex-col gap-5">
          {/* Identity card */}
          <div className={CARD} data-testid="startup-identity">
            {project ? (
              <>
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-14 h-14 flex-none rounded-xl bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 font-extrabold text-lg flex items-center justify-center">
                    {initialsOf(name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-gray-50">{name}</h2>
                      <span className="text-[10.5px] font-bold rounded-full px-2.5 py-0.5 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">{stageChip}</span>
                    </div>
                    {project.description && (
                      <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">{project.description}</p>
                    )}
                    <div className="flex gap-1.5 flex-wrap mt-2">
                      {[project.sector, project.track_type === 'spin_out' ? 'Spin-out' : project.track_type].filter(Boolean).map((t) => (
                        <span key={t} className="text-[10.5px] font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-md px-2 py-0.5">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
                {(project.problem_statement || project.solution) && (
                  <div className="border-t border-gray-100 dark:border-gray-800 pt-3.5">
                    <div className={`${LBL} mb-1.5`}>Founding thesis</div>
                    <p className="text-[12.5px] text-gray-600 dark:text-gray-300 leading-relaxed">
                      {[project.problem_statement, project.solution].filter(Boolean).join(' ')}
                    </p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 mt-4">
                  {facts.map((f) => (
                    <div key={f.k} className="bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 rounded-lg px-3 py-2">
                      <div className="text-[9.5px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{f.k}</div>
                      <div className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-100 mt-0.5">{f.v}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-8" data-testid="startup-empty">
                <div className="w-12 h-12 mx-auto rounded-xl bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300 flex items-center justify-center mb-3">
                  <Building2 size={22} />
                </div>
                <div className="text-base font-bold text-gray-900 dark:text-gray-50">No startup record yet</div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4 max-w-sm mx-auto">
                  Creating your startup record is the first Week 1 deliverable — it becomes your company profile, data room, and investor snapshot.
                </p>
                <Link
                  to="/projects"
                  data-testid="link-create-record"
                  className="inline-flex h-10 items-center px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold"
                >
                  Create your startup record
                </Link>
              </div>
            )}
          </div>

          {/* Company readiness */}
          <div className={CARD} data-testid="startup-readiness">
            <div className={`${LBL} mb-3`}>Company readiness</div>
            <div className="flex flex-col gap-0.5">
              {readiness.map((r) => {
                const inner = (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">{r.label}</div>
                      <div className="text-[11.5px] text-gray-400 dark:text-gray-500 mt-0.5">{r.note}</div>
                    </div>
                    <span className={`text-[10px] font-bold rounded-full px-2.5 py-1 whitespace-nowrap ${r.cls}`}>{r.chip}</span>
                    {!r.locked && <ChevronRight size={14} className="text-gray-300 dark:text-gray-600 flex-none" />}
                    {r.locked && <Lock size={13} className="text-gray-300 dark:text-gray-600 flex-none" />}
                  </>
                );
                const rowCls = 'flex items-center gap-3 px-2.5 py-3 rounded-lg';
                if (r.locked) {
                  return <div key={r.label} data-testid={r.testid} className={rowCls}>{inner}</div>;
                }
                if (r.scroll) {
                  return (
                    <button
                      key={r.label}
                      type="button"
                      data-testid={r.testid}
                      onClick={() => dataRoomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      className={`${rowCls} text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 w-full`}
                    >
                      {inner}
                    </button>
                  );
                }
                return (
                  <Link key={r.label} to={r.to} data-testid={r.testid} className={`${rowCls} hover:bg-gray-50 dark:hover:bg-gray-800/60`}>
                    {inner}
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Data room */}
          <div className={CARD} data-testid="startup-dataroom" ref={dataRoomRef}>
            <div className={`${LBL} mb-3`}>Data room · {docsReady} of {docs.length} documents ready</div>
            <div>
              {docs.map((d) => (
                <div key={d.name} data-testid={d.testid} className="flex items-center gap-3 py-2.5 border-t border-gray-100 dark:border-gray-800 first:border-t-0">
                  <FileText size={15} className={d.ready ? 'text-violet-600 dark:text-violet-400 flex-none' : 'text-gray-300 dark:text-gray-600 flex-none'} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-100">{d.name}</div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500">{d.meta}</div>
                  </div>
                  <span className={`text-[10px] font-bold rounded-full px-2.5 py-0.5 ${d.ready ? CHIP.ready : CHIP.missing}`}>
                    {d.ready ? 'Ready' : 'Missing'}
                  </span>
                </div>
              ))}
            </div>
            {!graduated && (
              <div className="flex items-center gap-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 rounded-xl px-3.5 py-2.5 mt-3.5">
                <Lock size={13} className="text-amber-600 dark:text-amber-400 flex-none" />
                <span className="text-[11.5px] text-amber-800 dark:text-amber-300 leading-snug">
                  Formation docs, cap table export, and signed agreements generate in Week 4.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT column */}
        <div className="flex flex-col gap-5">
          {/* Founding team */}
          <div className={CARD} data-testid="startup-team">
            <div className={`${LBL} mb-3`}>Founding team</div>
            <div className="border border-gray-100 dark:border-gray-800 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 flex-none rounded-full bg-violet-600 text-white font-bold text-[13px] flex items-center justify-center">
                  {initialsOf(founderName)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-50">{founderName}</span>
                    <span className="text-[10px] font-semibold rounded-md px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">Full-time</span>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Founder / CEO</div>
                  {user?.email && <div className="text-[11.5px] text-gray-400 dark:text-gray-500 mt-1.5">{user.email}</div>}
                </div>
                <div className="text-right flex-none">
                  <div className="text-[9.5px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">Equity</div>
                  <div className="text-[13px] font-bold text-gray-900 dark:text-gray-50 mt-0.5">TBD</div>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-800 rounded-xl px-3.5 py-2.5 mt-3.5">
              <span className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-snug">
                {cofounderUnlocked
                  ? 'Co-founder Match is active — add a co-founder, or document the solo path before formation.'
                  : 'Co-founder Match unlocks in Week 3. Equity and vesting finalize once a co-founder is added or a solo path is documented.'}
              </span>
            </div>
            <div className="flex gap-2.5 mt-3">
              {/* Week-gated actions render as inert spans while locked so they
                  are neither clickable nor keyboard-activatable. */}
              {cofounderUnlocked ? (
                <Link
                  to="/cofounder"
                  data-testid="link-add-cofounder"
                  className="flex-1 h-9 rounded-lg text-xs font-semibold inline-flex items-center justify-center border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
                >
                  Add co-founder
                </Link>
              ) : (
                <span
                  data-testid="link-add-cofounder"
                  aria-disabled="true"
                  className="flex-1 h-9 rounded-lg text-xs font-semibold inline-flex items-center justify-center border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 select-none"
                >
                  Add co-founder · Wk 3
                </span>
              )}
              {currentWeek >= 4 ? (
                <Link
                  to="/incorporate/cofounder-agreement"
                  data-testid="link-solo-path"
                  className="flex-1 h-9 rounded-lg text-xs font-semibold inline-flex items-center justify-center border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300"
                >
                  Document solo path
                </Link>
              ) : (
                <span
                  data-testid="link-solo-path"
                  aria-disabled="true"
                  className="flex-1 h-9 rounded-lg text-xs font-semibold inline-flex items-center justify-center border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 select-none"
                >
                  Solo path · Wk 4
                </span>
              )}
            </div>
          </div>

          {/* Activity & next milestone */}
          <div className={CARD} data-testid="startup-activity">
            <div className={`${LBL} mb-4`}>Activity & next milestone</div>
            <div className="relative pl-5">
              <div className="absolute left-[5px] top-1 bottom-4 w-0.5 bg-gray-100 dark:bg-gray-800" />
              {activity.map((a, i) => (
                <div key={`${a.title}-${i}`} className="relative pb-4">
                  <span
                    className={`absolute -left-5 top-0.5 w-3 h-3 rounded-full border-2 ${a.done
                      ? 'bg-violet-600 border-violet-200 dark:border-violet-900'
                      : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600'}`}
                  />
                  <div className={`text-[12.5px] font-semibold ${a.done ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>
                    {a.title}
                  </div>
                  {a.time && <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{a.time}</div>}
                </div>
              ))}
            </div>
            <div className="bg-violet-50/60 dark:bg-violet-950/30 border border-violet-100 dark:border-violet-900/50 rounded-xl px-4 py-3 mt-1" data-testid="startup-next-action">
              <div className="text-[10px] font-bold uppercase tracking-wider text-violet-400 dark:text-violet-500">Next required action</div>
              <div className="text-[13px] font-bold text-gray-900 dark:text-gray-50 mt-0.5">{nextAction.title}</div>
              <button
                type="button"
                data-testid="button-next-action"
                onClick={() => navigate(nextAction.to)}
                className="mt-2.5 h-8 px-3.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11.5px] font-semibold inline-flex items-center gap-1"
              >
                {nextAction.cta} <ArrowRight size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Investor preview modal */}
      {previewOpen && project && (
        <div
          className="fixed inset-0 z-[70] bg-gray-900/50 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-6 sm:p-10"
          onClick={() => setPreviewOpen(false)}
          data-testid="modal-investor-preview"
        >
          <div
            className="w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-violet-400 dark:text-violet-500">Investor preview</span>
                <span className="text-sm font-bold text-gray-900 dark:text-gray-50">Company snapshot</span>
              </div>
              <button
                type="button"
                data-testid="button-close-preview"
                onClick={() => setPreviewOpen(false)}
                className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 flex items-center justify-center"
              >
                <X size={15} />
              </button>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-3.5 mb-4">
                <div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 font-extrabold text-base flex items-center justify-center">
                  {initialsOf(name)}
                </div>
                <div>
                  <div className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-gray-50">{name}</div>
                  {project.description && <div className="text-xs text-gray-500 dark:text-gray-400">{project.description}</div>}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
                {facts.map((f) => (
                  <div key={f.k} className="bg-gray-50 dark:bg-gray-800/60 rounded-lg px-3 py-2">
                    <div className="text-[9.5px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{f.k}</div>
                    <div className="text-xs font-semibold text-gray-800 dark:text-gray-100 mt-0.5">{f.v}</div>
                  </div>
                ))}
              </div>
              {(project.problem_statement || project.solution) && (
                <>
                  <div className={`${LBL} mb-1.5`}>Founding thesis</div>
                  <p className="text-[12.5px] text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
                    {[project.problem_statement, project.solution].filter(Boolean).join(' ')}
                  </p>
                </>
              )}
              <div className={`${LBL} mb-2`}>Team</div>
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 flex-none rounded-full bg-violet-600 text-white font-bold text-[11px] flex items-center justify-center">
                  {initialsOf(founderName)}
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-gray-800 dark:text-gray-100">{founderName}</div>
                  <div className="text-[11px] text-gray-400 dark:text-gray-500">Founder / CEO · Full-time</div>
                </div>
              </div>
              <div className={`${LBL} mb-2`}>Data room</div>
              <div className="flex flex-wrap gap-1.5">
                {docs.map((d) => (
                  <span key={d.name} className={`inline-flex items-center gap-1 text-[10.5px] font-semibold rounded-md px-2 py-1 ${d.ready ? CHIP.ready : CHIP.missing}`}>
                    {d.ready && <Check size={10} />}{d.name}
                  </span>
                ))}
              </div>
              {!graduated && (
                <div className="text-[11.5px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 rounded-xl px-3.5 py-2.5 mt-4 leading-snug">
                  Pre-formation company in the Axal VC Spin-Out Lab. Legal entity, cap table, and vesting finalize in Week 4.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
