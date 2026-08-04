// Spin-Out Lab "Roadmap" tool page — 90-day OKRs, value-ranked MVP scope and
// program milestones, per the design handoff (Roadmap .dc screenshots / repo
// spin-out-lab-pipeline/project). Every element is live data:
//   - OKRs come from /progress/roadmap/:projectId (objective + key results
//     with numeric target/current → real progress bars). Creating the 3rd OKR
//     marks the `okrs_created` Week-2 milestone (parity with RoadmapPage).
//   - MVP priorities come from /progress/mvp-scope/:projectId. Tier and cycle
//     assignment are DERIVED from added_value (High → Core / active cycle,
//     Medium → v2 / next cycle, Low → out of scope) — priority is derived,
//     not chosen, matching the platform's value-ranked planning model.
//   - Milestones are the REAL program milestones from /spinout-lab/state
//     (completed with actual timestamps; remaining shown against their week
//     target — the design's invented calendar dates are not reproduced).
// The design's fake sprint numbering ("Cycle 2") has no real counterpart and
// is rendered as the honest "Active cycle" instead.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Columns3,
  Loader2,
  Lock,
  Map as MapIcon,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';
import { reportError } from '../lib/log';
import { pickLabProject } from './SpinoutLabStartupPage';
import LabPageHeader, { labBtn, LAB_ICON_SIZE } from '../components/spinout/LabPageHeader';

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm';
const INPUT = 'mt-1 w-full h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 text-[13px] text-gray-900 dark:text-gray-50';

const VALUE_BADGE = {
  High: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  Medium: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  Low: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};
const TIER_FOR = { High: 'Core', Medium: 'v2', Low: 'Out of scope' };
const TIER_BADGE = {
  Core: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
  v2: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  'Out of scope': 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};
const STATUS_BADGE = {
  Done: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  'In Progress': 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  Review: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  Backlog: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  Blocked: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
};
const VALUE_OPTS = ['High', 'Medium', 'Low'];
// The design mock also offers an "XS" effort, but the backend contract
// (MVP_EFFORTS in backend/app/api/routes/progress.py + the worker mirror)
// only accepts S/M/L/XL — an XS pill would be rejected on save, so it is
// intentionally omitted here.
const EFFORT_OPTS = ['S', 'M', 'L', 'XL'];
const STATUS_OPTS = ['Backlog', 'In Progress', 'Review', 'Done', 'Blocked'];

// Rating pill-button groups (the design swaps the value/effort selects for pills).
const PILL = 'px-[11px] py-1.5 rounded-lg border text-xs font-semibold transition-colors';
const PILL_ON = 'bg-violet-600 border-violet-600 text-white';
const PILL_OFF = 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700';

const GROUPS = [
  { value: 'High', title: 'Must ship now', sub: 'High value → active cycle', note: 'Active cycle', dot: 'bg-emerald-500' },
  { value: 'Medium', title: 'Valuable next', sub: 'Medium value → next cycle / backlog', note: 'Next cycle candidate', dot: 'bg-amber-600 dark:bg-amber-500' },
  { value: 'Low', title: 'Deprioritized', sub: 'Low value → v2 / out of scope', note: 'Deferred from MVP', dot: 'bg-gray-400 dark:bg-gray-500' },
];

// Program milestone labels + the required keys per week (mirrors the backend
// MILESTONES catalog; week 3 is scoring + EITHER advisor/co-founder).
export const MILESTONE_LABELS = {
  project_created: 'Startup record created',
  customer_interview_logged_1: 'Customer interview #1',
  customer_interview_logged_2: 'Customer interview #2',
  customer_interview_logged_3: 'Customer interview #3',
  okrs_created: '3+ OKRs set (90-day)',
  brand_basics_filled: 'Brand v1 basics',
  pitch_deck_drafted: 'Pitch deck v1 drafted',
  scoring_run_completed: 'Venture-readiness score',
  advisor_meeting_booked: 'Advisor meeting booked',
  cofounder_request_sent: 'Co-founder request sent',
  incorporation_completed: 'Incorporation completed',
};
const WEEK_REQUIRED = [
  { week: 1, all: ['project_created', 'customer_interview_logged_1', 'customer_interview_logged_2', 'customer_interview_logged_3'], any: [] },
  { week: 2, all: ['okrs_created', 'brand_basics_filled', 'pitch_deck_drafted'], any: [] },
  { week: 3, all: ['scoring_run_completed'], any: ['advisor_meeting_booked', 'cofounder_request_sent'] },
  { week: 4, all: ['incorporation_completed'], any: [] },
];

export function krProgress(kr) {
  const target = Number(kr?.target);
  const current = Number(kr?.current);
  if (!Number.isFinite(target) || target <= 0) return Number.isFinite(current) && current > 0 ? 100 : 0;
  if (!Number.isFinite(current) || current <= 0) return 0;
  return Math.min(100, Math.round((current / target) * 100));
}

// Build the milestone timeline: completed program milestones (real dates) +
// remaining required ones grouped by week ("Week N target", never fake dates).
export function buildTimeline(stateMilestones, currentWeek) {
  const doneByKey = new Map((stateMilestones || []).map((m) => [m.key, m]));
  const items = (stateMilestones || [])
    .filter((m) => MILESTONE_LABELS[m.key])
    .sort((a, b) => String(a.completed_at).localeCompare(String(b.completed_at)))
    .map((m) => ({ key: m.key, label: MILESTONE_LABELS[m.key], status: 'done', when: m.completed_at, week: m.week }));
  for (const w of WEEK_REQUIRED) {
    for (const k of w.all) {
      if (!doneByKey.has(k)) {
        items.push({ key: k, label: MILESTONE_LABELS[k], status: w.week <= currentWeek ? 'in_progress' : 'upcoming', week: w.week });
      }
    }
    if (w.any.length && !w.any.some((k) => doneByKey.has(k))) {
      items.push({
        key: w.any.join('|'),
        label: w.any.map((k) => MILESTONE_LABELS[k]).join(' or '),
        status: w.week <= currentWeek ? 'in_progress' : 'upcoming',
        week: w.week,
      });
    }
  }
  return items;
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const EMPTY_KR = { text: '', target: '', current: '', unit: '' };
const EMPTY_OKR = { objective: '', key_results: [{ ...EMPTY_KR }, { ...EMPTY_KR }] };
const EMPTY_FEATURE = { title: '', added_value: 'High', effort: 'M', priority_reason: '', delivery_status: 'Backlog' };

export default function SpinoutLabRoadmapPage() {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [project, setProject] = useState(null);
  const [okrs, setOkrs] = useState([]);
  const [features, setFeatures] = useState([]);
  const [status, setStatus] = useState('loading');
  const [okrModal, setOkrModal] = useState(null); // { id?, objective, key_results }
  const [featModal, setFeatModal] = useState(null); // { id?, ...EMPTY_FEATURE }
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [s, projects] = await Promise.all([spinoutLab.state(), api.listProjects().catch(() => [])]);
      setState(s);
      const p = pickLabProject(projects, user);
      setProject(p);
      if (p) {
        const [ok, mv] = await Promise.all([
          api.listOkrs(p.id).catch(() => null),
          api.listMvpFeatures(p.id).catch(() => null),
        ]);
        // Stable objective numbering: the API orders by kanban lane; here the
        // design numbers objectives, so sort by sort_order then id.
        setOkrs([...(ok?.okrs || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0)));
        setFeatures(mv?.features || []);
      }
      setStatus('ready');
    } catch (e) {
      reportError('SpinoutLabRoadmapPage:load', e);
      setStatus('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveOkr = async () => {
    const krs = (okrModal.key_results || [])
      .filter((k) => k.text.trim())
      .map((k) => ({
        text: k.text.trim(),
        target: k.target === '' || k.target == null ? null : Number(k.target),
        current: k.current === '' || k.current == null ? null : Number(k.current),
        unit: (k.unit || '').trim() || null,
      }));
    if (!okrModal.objective.trim()) { setModalError('Give the objective a name.'); return; }
    if (krs.some((k) => (k.target != null && !Number.isFinite(k.target)) || (k.current != null && !Number.isFinite(k.current)))) {
      setModalError('Key-result target and current must be numbers.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const payload = { objective: okrModal.objective.trim(), key_results: krs, kanban_status: okrModal.kanban_status || 'now', quarter: okrModal.quarter || '', sort_order: okrModal.sort_order || 0 };
      const isCreate = !okrModal.id;
      if (okrModal.id) await api.updateOkr(okrModal.id, payload);
      else await api.createOkr(project.id, payload);
      setOkrModal(null);
      // 3+ OKRs is the Week-2 deliverable — fire the milestone once reached
      // (dedup server-side; done-set guard avoids redundant calls). Ownership
      // guard: lab milestones are user-scoped, so only the founder's OWN
      // startup may complete them — never an accepted-membership project.
      const ownsProject = user?.founder_id != null && project?.founder_id === user.founder_id;
      if (isCreate && ownsProject && okrs.length + 1 >= 3) {
        const done = new Set((state?.milestones || []).map((m) => m.key));
        if (!done.has('okrs_created')) await markMilestone(user, 'okrs_created');
      }
      await load();
    } catch (e) {
      reportError('SpinoutLabRoadmapPage:saveOkr', e);
      setModalError("Couldn't save the objective. Try again.");
    } finally { setSaving(false); }
  };

  const deleteOkr = async () => {
    if (!okrModal?.id) return;
    setSaving(true);
    try { await api.deleteOkr(okrModal.id); setOkrModal(null); await load(); }
    catch (e) { reportError('SpinoutLabRoadmapPage:deleteOkr', e); setModalError("Couldn't delete."); }
    finally { setSaving(false); }
  };

  const saveFeature = async () => {
    if (!featModal.title.trim()) { setModalError('Name the feature.'); return; }
    setSaving(true);
    setModalError('');
    try {
      const payload = {
        title: featModal.title.trim(),
        added_value: featModal.added_value,
        effort: featModal.effort,
        priority_reason: featModal.priority_reason.trim() || null,
        delivery_status: featModal.delivery_status,
      };
      if (featModal.id) await api.updateMvpFeature(featModal.id, payload);
      else await api.createMvpFeature(project.id, payload);
      setFeatModal(null);
      await load();
    } catch (e) {
      reportError('SpinoutLabRoadmapPage:saveFeature', e);
      setModalError("Couldn't save the feature. Try again.");
    } finally { setSaving(false); }
  };

  const deleteFeature = async () => {
    if (!featModal?.id) return;
    setSaving(true);
    try { await api.deleteMvpFeature(featModal.id); setFeatModal(null); await load(); }
    catch (e) { reportError('SpinoutLabRoadmapPage:deleteFeature', e); setModalError("Couldn't delete."); }
    finally { setSaving(false); }
  };

  const derived = useMemo(() => {
    const by = (v) => features.filter((f) => f.added_value === v);
    const high = by('High');
    const medium = by('Medium');
    const low = by('Low');
    let confidence = { label: '—', sub: 'Add features to rank scope' };
    if (features.length >= 3 && low.length >= 1 && high.length >= 1) confidence = { label: 'Strong', sub: 'Deliberate cuts made · focused scope' };
    else if (features.length > 0) confidence = { label: 'Forming', sub: 'Keep ranking until cuts emerge' };
    const timeline = buildTimeline(state?.milestones, state?.is_incorporated ? 4 : Number(state?.week) || 1);
    return { high, medium, low, confidence, timeline };
  }, [features, state]);

  // W2 deliverable — MVP counts as scoped by the page's own definition of a
  // strong scope: 3+ ranked features including at least one deliberate cut.
  useEffect(() => {
    if (derived.confidence.label === 'Strong') markMilestone(user, 'mvp_scoped');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.confidence.label]);

  if (status === 'loading') {
    return <div className="flex items-center justify-center py-24" data-testid="roadmap-loading"><Loader2 className="animate-spin text-violet-600 dark:text-violet-400" size={28} /></div>;
  }
  if (status === 'error' || !state) {
    return (
      <div className="max-w-lg mx-auto text-center py-24 px-6" data-testid="roadmap-error">
        <div className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">Couldn&rsquo;t load the Roadmap</div>
        <button type="button" data-testid="button-retry-roadmap" onClick={load} className="h-10 px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold mt-2">Retry</button>
      </div>
    );
  }
  const isAdmin = user?.role === 'admin';
  if (!state.active && !state.is_incorporated && !isAdmin) {
    return (
      <div className="max-w-lg mx-auto text-center py-24 px-6" data-testid="roadmap-inactive">
        <div className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">Spin-Out Lab isn&rsquo;t active on this account</div>
        <Link to="/spinout-lab" className="inline-flex h-10 items-center px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold mt-3">Go to Spin-Out Lab</Link>
      </div>
    );
  }
  if (!isAdmin && !(state.unlocked_features || []).includes('roadmap')) {
    return (
      <div className="max-w-lg mx-auto text-center py-24 px-6" data-testid="roadmap-locked">
        <Lock size={22} className="mx-auto text-gray-400 mb-3" />
        <div className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">The Roadmap unlocks in Week 2</div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Finish your Week 1 deliverables — startup record and three customer interviews — to open MVP scoping and OKRs.</p>
        <Link to="/spinout-lab" className="inline-flex h-10 items-center px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">Back to Workspace</Link>
      </div>
    );
  }

  const { high, medium, low, confidence, timeline } = derived;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6" data-testid="page-spinout-roadmap">
      {/* Header — canonical Lab header (LabPageHeader owns the back link, the
          icon tile, the status chip and the action cluster). The page root has
          no space-y-*, so the header carries its own bottom margin. */}
      <LabPageHeader
        className="mb-5"
        icon={MapIcon}
        title="Roadmap"
        status="Active"
        subtitle="OKRs, milestones, and MVP scope."
        actions={project && (
          <Link to={`/build/roadmap?project_id=${project.id}`} data-testid="link-kanban-view" className={labBtn('secondary')}>
            <Columns3 size={LAB_ICON_SIZE} /> Kanban view
          </Link>
        )}
      />

      {!project ? (
        <div className={`${CARD} text-center py-10`} data-testid="roadmap-no-project">
          <div className="text-base font-bold text-gray-900 dark:text-gray-50">Create your startup record first</div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">OKRs and MVP scope attach to your company record.</p>
          <Link to="/projects" className="inline-flex h-10 items-center px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">Create your startup record</Link>
        </div>
      ) : (
        <>
          {/* 90-day OKRs */}
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <div className={LBL} data-testid="okr-count">90-day OKRs · <span className="text-emerald-700 dark:text-emerald-400">{okrs.length} set</span></div>
            <button type="button" data-testid="button-add-okr" onClick={() => { setModalError(''); setOkrModal({ ...EMPTY_OKR, key_results: EMPTY_OKR.key_results.map((k) => ({ ...k })) }); }} className="h-8 px-3.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11.5px] font-semibold inline-flex items-center gap-1.5">
              <Plus size={13} /> Add objective
            </button>
          </div>
          {okrs.length === 0 ? (
            <div className={`${CARD} text-center py-8 mb-6`} data-testid="okrs-empty">
              <p className="text-sm text-gray-500 dark:text-gray-400">No objectives yet — setting 3+ OKRs is your Week 2 deliverable.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-6" data-testid="okr-grid">
              {okrs.map((o, idx) => (
                <div key={o.id} className={`${CARD} group relative`} data-testid={`okr-card-${idx}`}>
                  <button
                    type="button"
                    data-testid={`button-edit-okr-${idx}`}
                    onClick={() => {
                      setModalError('');
                      setOkrModal({
                        id: o.id,
                        objective: o.objective || '',
                        kanban_status: o.kanban_status,
                        quarter: o.quarter,
                        sort_order: o.sort_order,
                        key_results: (o.key_results || []).length ? o.key_results.map((k) => ({ text: k.text || '', target: k.target ?? '', current: k.current ?? '', unit: k.unit || '' })) : [{ ...EMPTY_KR }],
                      });
                    }}
                    className="absolute top-4 right-4 text-gray-300 dark:text-gray-600 hover:text-violet-600 dark:hover:text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={`Edit objective ${idx + 1}`}
                  >
                    <Pencil size={14} />
                  </button>
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400 mb-1">Objective {idx + 1}</div>
                  <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50 mb-3 pr-6">{o.objective}</div>
                  {(o.key_results || []).length === 0 ? (
                    <p className="text-[11.5px] text-gray-400 dark:text-gray-500">No key results yet.</p>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {o.key_results.map((kr, ki) => {
                        const pct = krProgress(kr);
                        return (
                          <div key={ki}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[12px] text-gray-600 dark:text-gray-300 truncate">{kr.text}</span>
                              <span className="text-[11.5px] font-bold text-gray-800 dark:text-gray-100 flex-none">{pct}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 mt-1 overflow-hidden">
                              <div className="h-full rounded-full bg-violet-600" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* MVP priorities — value-ranked planning */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-5 mb-5" data-testid="mvp-priorities">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div className={LBL}>MVP priorities · value-ranked planning</div>
              <div className="flex items-center gap-3">
                <span className="text-[10.5px] text-gray-400 dark:text-gray-500 hidden sm:inline">Value sets priority · top items feed the active cycle</span>
                <button type="button" data-testid="button-add-feature" onClick={() => { setModalError(''); setFeatModal({ ...EMPTY_FEATURE }); }} className="h-8 px-3.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[11.5px] font-semibold inline-flex items-center gap-1.5">
                  <Plus size={13} /> Add feature
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20 px-3.5 py-2.5" data-testid="stat-high">
                <div className="text-lg font-extrabold text-emerald-700 dark:text-emerald-300">{high.length}</div>
                <div className="text-[10.5px] text-gray-500 dark:text-gray-400">High-value features identified</div>
              </div>
              <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-900/20 px-3.5 py-2.5" data-testid="stat-active">
                <div className="text-lg font-extrabold text-violet-700 dark:text-violet-300">{high.filter((f) => f.delivery_status !== 'Done').length}</div>
                <div className="text-[10.5px] text-gray-500 dark:text-gray-400">In the active build cycle</div>
              </div>
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3.5 py-2.5" data-testid="stat-cut">
                <div className="text-lg font-extrabold text-gray-700 dark:text-gray-200">{low.length}</div>
                <div className="text-[10.5px] text-gray-500 dark:text-gray-400">Intentionally cut from MVP</div>
              </div>
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20 px-3.5 py-2.5" data-testid="stat-confidence">
                <div className="text-lg font-extrabold text-emerald-700 dark:text-emerald-300">{confidence.label}</div>
                <div className="text-[10.5px] text-gray-500 dark:text-gray-400">Scope confidence · {confidence.sub}</div>
              </div>
            </div>

            {features.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6" data-testid="features-empty">
                No features ranked yet — add your candidate features and rate their value; priority is derived, not chosen.
              </p>
            ) : (
              GROUPS.map((g) => {
                const rows = features.filter((f) => f.added_value === g.value);
                return (
                  <div key={g.value} className="mb-1.5" data-testid={`group-${g.value.toLowerCase()}`}>
                    <div className="flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 pb-1.5 mb-1">
                      <span className={`w-[7px] h-[7px] rounded-full flex-none ${g.dot}`} aria-hidden="true" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-700 dark:text-gray-200">{g.title}</span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">{g.sub}</span>
                    </div>
                    {rows.length === 0 ? (
                      <p className="text-[11.5px] text-gray-400 dark:text-gray-500 py-2">Nothing here yet.</p>
                    ) : rows.map((f) => (
                      <button
                        type="button"
                        key={f.id}
                        data-testid={`feature-row-${f.id}`}
                        onClick={() => { setModalError(''); setFeatModal({ id: f.id, title: f.title || '', added_value: f.added_value, effort: f.effort || 'M', priority_reason: f.priority_reason || '', delivery_status: f.delivery_status || 'Backlog' }); }}
                        className="w-full text-left py-2.5 border-b border-gray-50 dark:border-gray-800/60 last:border-b-0 hover:bg-gray-50/60 dark:hover:bg-gray-800/30 rounded-md px-1.5 -mx-1.5"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12.5px] font-bold text-gray-900 dark:text-gray-50">{f.title}</span>
                          <span className="ml-auto flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[9.5px] font-bold rounded px-1.5 py-0.5 ${VALUE_BADGE[f.added_value]}`}>{f.added_value} value</span>
                            <span className="text-[9.5px] font-bold rounded px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">Effort {f.effort}</span>
                            <span className={`text-[9.5px] font-bold rounded px-1.5 py-0.5 ${TIER_BADGE[TIER_FOR[f.added_value]]}`}>{TIER_FOR[f.added_value]}</span>
                            <span className={`text-[9.5px] font-bold rounded px-1.5 py-0.5 ${STATUS_BADGE[f.delivery_status] || STATUS_BADGE.Backlog}`}>{f.delivery_status}</span>
                          </span>
                        </div>
                        {f.priority_reason && <div className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5">{f.priority_reason}</div>}
                        <div className={`text-[10px] mt-0.5 text-right ${g.value === 'High' ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>{g.note}</div>
                      </button>
                    ))}
                  </div>
                );
              })
            )}
          </div>

          {/* Feeds active cycle */}
          <div className="rounded-2xl border border-violet-100 dark:border-violet-900/50 bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/30 dark:to-gray-900 p-5 mb-5" data-testid="feeds-active-cycle">
            <div className={`${LBL} mb-1`}>Feeds active cycle</div>
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3">High-value priorities pulled from the Roadmap into the MVP build loop.</p>
            {high.length === 0 ? (
              <p className="text-[12px] text-gray-400 dark:text-gray-500" data-testid="cycle-empty">Nothing feeds the cycle yet — rank a feature High value to pull it in.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {high.map((f) => (
                  <div key={f.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-2.5" data-testid={`cycle-row-${f.id}`}>
                    <div className="text-[12.5px] font-bold text-gray-900 dark:text-gray-50">{f.title}</div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap text-[10px] font-semibold">
                      <span className="text-gray-500 dark:text-gray-400">Roadmap priority</span>
                      <ArrowRight size={10} className="text-gray-400" />
                      <span className="rounded px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">In MVP build loop</span>
                      <ArrowRight size={10} className="text-gray-400" />
                      <span className={`rounded px-1.5 py-0.5 ${STATUS_BADGE[f.delivery_status] || STATUS_BADGE.Backlog}`}>{f.delivery_status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Milestones */}
          <div className={CARD} data-testid="roadmap-milestones">
            <div className={`${LBL} mb-3`}>Milestones</div>
            <div className="flex flex-col">
              {timeline.map((m, i) => (
                <div key={m.key} className="flex gap-2.5" data-testid={`milestone-${m.status}-${m.key}`}>
                  <div className="w-2 flex-none flex flex-col items-center">
                    <span className={`mt-1 w-2 h-2 rounded-full flex-none ${m.status === 'done' ? 'bg-emerald-500' : m.status === 'in_progress' ? 'bg-violet-600' : 'bg-gray-300 dark:bg-gray-600'}`} />
                    {/* 2px connector between milestone dots, hidden on the last item */}
                    {i < timeline.length - 1 && <span className="w-0.5 flex-1 mt-1 rounded-full bg-violet-100 dark:bg-violet-900/40" aria-hidden="true" />}
                  </div>
                  <div className={i < timeline.length - 1 ? 'pb-3' : ''}>
                    <div className={`text-[12.5px] font-semibold ${m.status === 'upcoming' ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-50'}`}>{m.label}</div>
                    <div className="text-[10.5px] text-gray-400 dark:text-gray-500">
                      {m.status === 'done' ? `${shortDate(m.when)} · Done` : m.status === 'in_progress' ? `Week ${m.week} target · In progress` : `Week ${m.week} target · Upcoming`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* OKR modal */}
      {okrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 overflow-y-auto py-8" data-testid="modal-okr" onClick={() => !saving && setOkrModal(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-lg w-full p-6 my-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-gray-900 dark:text-gray-50">{okrModal.id ? 'Edit objective' : 'New 90-day objective'}</h2>
              <button type="button" data-testid="button-close-okr" onClick={() => setOkrModal(null)} disabled={saving} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X size={17} /></button>
            </div>
            <label className="block mb-3">
              <span className={LBL}>Objective</span>
              <input data-testid="input-objective" value={okrModal.objective} onChange={(e) => setOkrModal((m) => ({ ...m, objective: e.target.value }))} className={INPUT} placeholder="e.g. Prove demand with a shippable MVP" />
            </label>
            <div className={`${LBL} mb-1`}>Key results</div>
            {okrModal.key_results.map((k, i) => (
              <div key={i} className="grid grid-cols-[1fr_64px_64px_56px] gap-1.5 mb-1.5">
                <input data-testid={`input-kr-text-${i}`} value={k.text} onChange={(e) => setOkrModal((m) => { const kr = [...m.key_results]; kr[i] = { ...kr[i], text: e.target.value }; return { ...m, key_results: kr }; })} className={`${INPUT} mt-0`} placeholder="Key result" />
                <input data-testid={`input-kr-current-${i}`} type="number" value={k.current} onChange={(e) => setOkrModal((m) => { const kr = [...m.key_results]; kr[i] = { ...kr[i], current: e.target.value }; return { ...m, key_results: kr }; })} className={`${INPUT} mt-0 px-2`} placeholder="Now" />
                <input data-testid={`input-kr-target-${i}`} type="number" value={k.target} onChange={(e) => setOkrModal((m) => { const kr = [...m.key_results]; kr[i] = { ...kr[i], target: e.target.value }; return { ...m, key_results: kr }; })} className={`${INPUT} mt-0 px-2`} placeholder="Goal" />
                <input data-testid={`input-kr-unit-${i}`} value={k.unit} onChange={(e) => setOkrModal((m) => { const kr = [...m.key_results]; kr[i] = { ...kr[i], unit: e.target.value }; return { ...m, key_results: kr }; })} className={`${INPUT} mt-0 px-2`} placeholder="Unit" />
              </div>
            ))}
            {okrModal.key_results.length < 4 && (
              <button type="button" data-testid="button-add-kr" onClick={() => setOkrModal((m) => ({ ...m, key_results: [...m.key_results, { ...EMPTY_KR }] }))} className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 mb-3 inline-flex items-center gap-1"><Plus size={11} /> Add key result</button>
            )}
            {modalError && <div className="text-[11.5px] text-red-600 dark:text-red-400 mb-3" data-testid="okr-error">{modalError}</div>}
            <div className="flex items-center gap-2">
              <button type="button" data-testid="button-save-okr" onClick={saveOkr} disabled={saving} className="flex-1 h-10 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2">
                {saving && <Loader2 size={14} className="animate-spin" />} Save objective
              </button>
              {okrModal.id && (
                <button type="button" data-testid="button-delete-okr" onClick={deleteOkr} disabled={saving} className="h-10 px-3.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400" aria-label="Delete objective"><Trash2 size={15} /></button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Feature modal */}
      {featModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" data-testid="modal-feature" onClick={() => !saving && setFeatModal(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="text-base font-bold text-gray-900 dark:text-gray-50">{featModal.id ? 'Edit feature' : 'Add feature'}</h2>
                <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mt-0.5">Rate its value and effort — priority is derived, not chosen</p>
              </div>
              <button type="button" data-testid="button-close-feature" onClick={() => setFeatModal(null)} disabled={saving} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 mt-0.5"><X size={17} /></button>
            </div>
            <label className="block mb-3">
              <span className={LBL}>Feature</span>
              <input data-testid="input-feature-title" value={featModal.title} onChange={(e) => setFeatModal((m) => ({ ...m, title: e.target.value }))} className={INPUT} placeholder="e.g. Async task threading" />
            </label>
            <div className="mb-3">
              <span className={LBL}>Value</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5" data-testid="select-feature-value">
                {VALUE_OPTS.map((v) => (
                  <button key={v} type="button" data-testid={`pill-value-${v.toLowerCase()}`} aria-pressed={featModal.added_value === v} onClick={() => setFeatModal((m) => ({ ...m, added_value: v }))} className={`${PILL} ${featModal.added_value === v ? PILL_ON : PILL_OFF}`}>{v}</button>
                ))}
              </div>
            </div>
            <div className="mb-3">
              <span className={LBL}>Effort</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5" data-testid="select-feature-effort">
                {EFFORT_OPTS.map((v) => (
                  <button key={v} type="button" data-testid={`pill-effort-${v.toLowerCase()}`} aria-pressed={featModal.effort === v} onClick={() => setFeatModal((m) => ({ ...m, effort: v }))} className={`${PILL} ${featModal.effort === v ? PILL_ON : PILL_OFF}`}>{v}</button>
                ))}
              </div>
            </div>
            <label className="block mb-3">
              <span className={LBL}>Status</span>
              <select data-testid="select-feature-status" value={featModal.delivery_status} onChange={(e) => setFeatModal((m) => ({ ...m, delivery_status: e.target.value }))} className={INPUT}>
                {STATUS_OPTS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="block mb-3">
              <span className={LBL}>Priority reason</span>
              <textarea data-testid="input-feature-reason" value={featModal.priority_reason} onChange={(e) => setFeatModal((m) => ({ ...m, priority_reason: e.target.value }))} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-[13px] text-gray-900 dark:text-gray-50" placeholder="Tie it to interview evidence — e.g. the pain 4 of 5 interviews named." />
            </label>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-3">High value → active cycle · Medium → next cycle · Low → v2 / out of scope. Applied automatically based on your rating.</p>
            {modalError && <div className="text-[11.5px] text-red-600 dark:text-red-400 mb-3" data-testid="feature-error">{modalError}</div>}
            <div className="flex items-center gap-2">
              <button type="button" data-testid="button-cancel-feature" onClick={() => setFeatModal(null)} disabled={saving} className="h-10 px-4 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
              <button type="button" data-testid="button-save-feature" onClick={saveFeature} disabled={saving || !featModal.title.trim()} className="flex-1 h-10 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2">
                {saving && <Loader2 size={14} className="animate-spin" />} {featModal.id ? 'Save feature' : 'Add to priorities'}
              </button>
              {featModal.id && (
                <button type="button" data-testid="button-delete-feature" onClick={deleteFeature} disabled={saving} className="h-10 px-3.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400" aria-label="Delete feature"><Trash2 size={15} /></button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
