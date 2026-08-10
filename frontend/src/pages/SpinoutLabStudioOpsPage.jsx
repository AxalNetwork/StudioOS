// Spin-Out Lab "Studio Ops" tool page — the founder's weekly operating rhythm,
// per the design handoff (attached_assets/Studio_Ops.dc.html): weekly focus,
// execution health, cadence lock, the cadence itself, the execution tracker,
// blockers & risks, and the weekly closeout review.
//
// NOT the same feature as the studio's admin operations console
// (StudioOpsPage.jsx — workflows/kanban across Strategic/Finance/HR/Legal/
// Compliance, reached via Command Center's Operations tab). This page is the
// LAB surface: one founder, one sprint week. The two share a name and nothing
// else, which is why this is a dedicated page rather than a redirect into
// Command Center.
//
// Every number here is live data:
//   - Week/day + objective come from /spinout-lab/state and the week catalog
//     (WEEK_DEFS) — the design's "Week 2 · Day 11" is computed, not copied.
//   - Commitments ARE the week's real deliverables, marked done by real
//     milestone rows — the tracker cannot disagree with the workspace.
//   - Blockers are derived (open required deliverables vs. week elapsed);
//     the design's sample blockers are not reproduced as data.
//   - Cadence + weekly review persist via /spinout-lab/studio-ops. LOCKING the
//     cadence is what records the optional Week-2 `studio_ops_cadence_set`
//     milestone (server-side) — merely opening the page records nothing.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarCheck,
  Check,
  Circle,
  Download,
  Link2,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { spinoutLab } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { useSpinoutLabState } from '../hooks/useSpinoutLabState';
import { reportError } from '../lib/log';
import {
  sprintPosition,
  buildCommitments,
  executionHealth,
  deriveBlockers,
  mustHitList,
} from '../lib/spinout/studioOps';
import { TOOL_INFO, WEEK_DEFS, milestoneKeySet } from './SpinoutLabWorkspace';
import LabPageHeader, { labBtn, labChip, LAB_ICON_SIZE } from '../components/spinout/LabPageHeader';

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm';
const INPUT = 'w-full h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 text-[12.5px] text-gray-900 dark:text-gray-50';

// Cadence tag chips (Set / Proposed / Optional) — Set is the committed state.
const TAG_CHIP = {
  Set: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  Proposed: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
  Optional: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500',
};
const SEV_CHIP = {
  High: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
  Medium: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  Low: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
};
const DAY_OPTS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const REVIEW_ROWS = [
  { field: 'shipped', label: 'What shipped', hint: 'Wins that are live — a page published, interviews logged.' },
  { field: 'slipped', label: 'What slipped', hint: 'What moved and to when.' },
  { field: 'changed', label: 'What changed', hint: 'New risks, decisions, or scope changes.' },
  { field: 'next', label: 'Rolls into next week', hint: 'The carry-over that opens next week’s focus.' },
];

export default function SpinoutLabStudioOpsPage() {
  const { user } = useAuth();
  const { state, loading: stateLoading, error: stateError, refresh } = useSpinoutLabState();

  // Server-stored half of the page (cadence + review).
  const [ops, setOps] = useState(null);
  const [opsError, setOpsError] = useState(false);
  const [cadenceDraft, setCadenceDraft] = useState(null); // non-null = editing
  const [reviewDraft, setReviewDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState('');
  const [copied, setCopied] = useState(false);

  const loadOps = useCallback(async () => {
    try {
      const data = await spinoutLab.studioOps();
      setOps(data);
      setOpsError(false);
      setReviewDraft((d) => (d == null ? { ...data.review } : d));
    } catch (e) {
      reportError('SpinoutLabStudioOpsPage:load', e);
      setOpsError(true);
    }
  }, []);
  useEffect(() => { loadOps(); }, [loadOps]);

  const position = useMemo(() => sprintPosition(state), [state]);
  const weekDef = useMemo(
    () => WEEK_DEFS.find((w) => w.num === position.week) || WEEK_DEFS[0],
    [position.week],
  );
  const doneKeys = useMemo(() => milestoneKeySet(state?.milestones), [state]);
  const firstName = (user?.name || '').trim().split(/\s+/)[0] || 'You';

  const commitments = useMemo(
    () => buildCommitments({ weekDef, doneKeys, toolInfo: TOOL_INFO, ownerName: firstName }),
    [weekDef, doneKeys, firstName],
  );
  const blockers = useMemo(
    () => deriveBlockers({
      weekDef, doneKeys, position, cohortTiming: state?.cohort_timing, toolInfo: TOOL_INFO,
    }),
    [weekDef, doneKeys, position, state],
  );
  const health = useMemo(() => executionHealth(commitments, blockers), [commitments, blockers]);
  const mustHit = useMemo(() => mustHitList(weekDef, doneKeys), [weekDef, doneKeys]);

  // ---- actions ------------------------------------------------------------

  const saveCadence = async ({ lock = false } = {}) => {
    const items = cadenceDraft ?? ops?.cadence ?? [];
    setSaving(true);
    try {
      const data = await spinoutLab.saveStudioOpsCadence(items, { lock });
      setOps(data);
      setCadenceDraft(null);
      if (lock) {
        setFlash('Cadence locked — this rhythm is your commitment for the week.');
        // The lock recorded `studio_ops_cadence_set` server-side; poke the Lab
        // state listeners so the workspace checklist reflects it immediately.
        try { window.dispatchEvent(new Event('spinout-lab:advanced')); } catch { /* SSR */ }
        refresh();
      } else {
        setFlash('Cadence saved.');
      }
      setTimeout(() => setFlash(''), 4000);
    } catch (e) {
      reportError('SpinoutLabStudioOpsPage:saveCadence', e);
      setFlash(e?.message || 'Couldn’t save the cadence.');
      setTimeout(() => setFlash(''), 4000);
    } finally {
      setSaving(false);
    }
  };

  const saveReview = async ({ complete = false } = {}) => {
    setSaving(true);
    try {
      const data = await spinoutLab.saveStudioOpsReview(reviewDraft ?? {}, { complete });
      setOps(data);
      setReviewDraft({ ...data.review });
      setFlash(complete ? 'Weekly review completed.' : 'Review draft saved.');
      setTimeout(() => setFlash(''), 4000);
    } catch (e) {
      reportError('SpinoutLabStudioOpsPage:saveReview', e);
      setFlash(e?.message || 'Couldn’t save the review.');
      setTimeout(() => setFlash(''), 4000);
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the button simply doesn't flip */ }
  };

  // Plain-text week summary, matching the 83(b)/Cap-Table export convention.
  const exportWeek = () => {
    const cadence = ops?.cadence || [];
    const review = ops?.review || {};
    const lines = [
      `Studio Ops — ${position.label}`,
      `Objective: ${weekDef.summary}`,
      `Execution health: ${health.label} (${health.note})`,
      '',
      'CADENCE' + (ops?.cadence_locked ? ' (locked)' : ''),
      ...cadence.map((c) => `  ${c.day} ${c.time || '--:--'}  ${c.name} — ${c.owner} [${c.tag}]${c.agenda ? ` · ${c.agenda}` : ''}`),
      '',
      `EXECUTION TRACKER (${health.done} of ${health.total} done)`,
      ...commitments.map((c) => `  [${c.done ? 'x' : ' '}] ${c.title} — ${c.module} · due ${c.due}${c.optional ? ' (bonus)' : ''}`),
      '',
      'BLOCKERS & RISKS',
      ...(blockers.length
        ? blockers.map((b) => `  [${b.severity}] ${b.title} — ${b.recommended}`)
        : ['  None this week.']),
      '',
      `WEEKLY REVIEW${ops?.review_completed ? ' (completed)' : ''}`,
      ...REVIEW_ROWS.map((r) => `  ${r.label}: ${review[r.field] || '—'}`),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `studio-ops-week-${position.week}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- guards (same ladder as the sibling Lab tool pages) -----------------

  if (stateLoading && !state) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="studio-ops-loading">
        <Loader2 className="animate-spin text-violet-600 dark:text-violet-400" size={28} />
      </div>
    );
  }
  if (stateError && !state) {
    return (
      <div className="max-w-lg mx-auto text-center py-24 px-6" data-testid="studio-ops-error">
        <div className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">Couldn&rsquo;t load Studio Ops</div>
        <button type="button" data-testid="button-retry-studio-ops" onClick={() => { refresh(); loadOps(); }} className="h-10 px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold mt-2">Retry</button>
      </div>
    );
  }
  const isAdmin = user?.role === 'admin';
  if (state && !state.active && !state.is_incorporated && !isAdmin) {
    return (
      <div className="max-w-lg mx-auto text-center py-24 px-6" data-testid="studio-ops-inactive">
        <div className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">Spin-Out Lab isn&rsquo;t active on this account</div>
        <Link to="/spinout-lab" className="inline-flex h-10 items-center px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold mt-3">Go to Spin-Out Lab</Link>
      </div>
    );
  }

  const cadence = cadenceDraft ?? ops?.cadence ?? [];
  const editingCadence = cadenceDraft != null;
  const locked = Boolean(ops?.cadence_locked);
  const reviewDone = Boolean(ops?.review_completed);
  const reviewValue = reviewDraft ?? ops?.review ?? {};
  const reviewHasText = REVIEW_ROWS.some((r) => (reviewValue[r.field] || '').trim());

  const setDraftRow = (idx, patch) => {
    setCadenceDraft((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6" data-testid="page-spinout-studio-ops">
      <LabPageHeader
        className="mb-5"
        icon={CalendarCheck}
        title="Studio Ops"
        status="Active"
        subtitle="Weekly cadence and accountability — the operating rhythm that keeps commitments, blockers, and closeout visible across the founding team."
        weekChip={position.day ? position.label : `Week ${position.week}`}
        actions={(
          <>
            <button type="button" data-testid="button-share-studio-ops" onClick={copyLink} className={labBtn('secondary')}>
              {copied ? <Check size={LAB_ICON_SIZE} className="text-emerald-500" /> : <Link2 size={LAB_ICON_SIZE} />} {copied ? 'Copied' : 'Copy link'}
            </button>
            <button type="button" data-testid="button-export-studio-ops" onClick={exportWeek} className={labBtn('secondary')}>
              <Download size={LAB_ICON_SIZE} /> Export
            </button>
          </>
        )}
      />

      {flash && (
        <div className="mb-4 rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/30 px-4 py-2.5 text-[12.5px] font-medium text-violet-800 dark:text-violet-200" data-testid="studio-ops-flash">
          {flash}
        </div>
      )}

      {/* WEEKLY FOCUS — objective + must-hits, with health & lock at right */}
      <div className="rounded-2xl border border-violet-200/80 dark:border-violet-800/60 bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/40 dark:to-gray-900 p-5 sm:p-6 mb-5" data-testid="studio-ops-focus">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex-1 min-w-[240px]">
            <div className="text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300 mb-1.5">
              Weekly focus · {position.day ? position.label : `Week ${position.week} · ${weekDef.name}`}
            </div>
            <div className="text-[19px] font-extrabold tracking-[-0.01em] leading-snug text-gray-900 dark:text-gray-50 mb-3.5 max-w-2xl" data-testid="studio-ops-objective">
              {weekDef.summary}
            </div>
            <div className="flex flex-col gap-2">
              {mustHit.map((m) => (
                <div key={m.id} className="flex items-center gap-2.5" data-testid={`must-hit-${m.id}`}>
                  {m.done
                    ? <span className="w-4 h-4 flex-none rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center"><Check size={11} /></span>
                    : <Circle size={16} className="flex-none text-gray-300 dark:text-gray-600" />}
                  <span className={`text-[13px] ${m.done ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-700 dark:text-gray-300'}`}>{m.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2.5 w-full sm:w-56">
            <div className="rounded-xl border border-violet-100 dark:border-violet-900/60 bg-white dark:bg-gray-900 px-4 py-3.5" data-testid="studio-ops-health">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Execution health</span>
                <span className={labChip(health.tone)}>{health.label}</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-1.5">
                <div
                  className={`h-full rounded-full ${health.atRisk ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${health.pct}%` }}
                />
              </div>
              <div className="text-[11.5px] text-gray-500 dark:text-gray-400">{health.note}</div>
            </div>
            <div className="rounded-xl border border-violet-100 dark:border-violet-900/60 bg-white dark:bg-gray-900 px-4 py-3 flex items-center justify-between" data-testid="studio-ops-cadence-lock">
              <span className="text-[12.5px] font-semibold text-gray-700 dark:text-gray-300">Cadence lock</span>
              <span className={labChip(locked ? 'active' : 'warn')}>{locked ? 'Locked' : 'Not locked'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* CADENCE */}
        <div className={CARD} data-testid="studio-ops-cadence">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className={LBL}>Cadence</div>
            <div className="flex items-center gap-2">
              {!editingCadence && (
                <button
                  type="button"
                  data-testid="button-edit-cadence"
                  onClick={() => setCadenceDraft(cadence.map((r) => ({ ...r })))}
                  className={labBtn('ghost', 'h-8 px-2.5')}
                >
                  <Pencil size={13} /> Customize
                </button>
              )}
              {!locked && !editingCadence && (
                <button
                  type="button"
                  data-testid="button-lock-cadence"
                  disabled={saving || opsError}
                  onClick={() => saveCadence({ lock: true })}
                  className={labBtn('primary', 'h-8 px-3')}
                >
                  <Lock size={12} /> Lock cadence
                </button>
              )}
              {locked && !editingCadence && (
                <span className={labChip('active')}>Cadence locked</span>
              )}
            </div>
          </div>
          {!locked && !editingCadence && (
            <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-1">
              Locking sets this rhythm as your commitment for the week and records the Week-2 deliverable.
            </p>
          )}

          {opsError && (
            <div className="py-6 text-center text-[12.5px] text-gray-500 dark:text-gray-400" data-testid="studio-ops-cadence-error">
              Couldn&rsquo;t load your cadence.{' '}
              <button type="button" onClick={loadOps} className="font-semibold text-violet-600 dark:text-violet-400">Retry</button>
            </div>
          )}

          {!opsError && cadence.map((c, i) => (
            <div key={c.id || i} className="py-3 border-t border-gray-100 dark:border-gray-800" data-testid={`cadence-row-${i}`}>
              {editingCadence ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select value={c.day} onChange={(e) => setDraftRow(i, { day: e.target.value })} className={`${INPUT} w-20`} aria-label="Day">
                    {DAY_OPTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <input value={c.time} onChange={(e) => setDraftRow(i, { time: e.target.value })} placeholder="HH:MM" className={`${INPUT} w-20`} aria-label="Time" />
                  <input value={c.name} onChange={(e) => setDraftRow(i, { name: e.target.value })} placeholder="Meeting" className={`${INPUT} flex-1 min-w-[140px]`} aria-label="Name" />
                  <input value={c.owner} onChange={(e) => setDraftRow(i, { owner: e.target.value })} placeholder="Who" className={`${INPUT} w-32`} aria-label="Attendees" />
                  <input value={c.agenda} onChange={(e) => setDraftRow(i, { agenda: e.target.value })} placeholder="Agenda" className={`${INPUT} w-full`} aria-label="Agenda" />
                  <button type="button" aria-label="Remove" onClick={() => setCadenceDraft((rows) => rows.filter((_, j) => j !== i))} className="text-gray-400 hover:text-rose-500 p-1">
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="w-10 flex-none text-[12px] font-bold text-violet-700 dark:text-violet-400 tabular-nums">{c.day}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-gray-800 dark:text-gray-100">{c.name}</div>
                      <div className="text-[11.5px] text-gray-400 dark:text-gray-500">{c.time || '—'} · {c.owner}</div>
                    </div>
                    <span className={`text-[10.5px] font-semibold rounded-md px-2 py-0.5 ${TAG_CHIP[c.tag] || TAG_CHIP.Proposed}`}>{c.tag}</span>
                  </div>
                  {c.agenda && <div className="mt-1.5 ml-[52px] text-[11.5px] leading-relaxed text-gray-500 dark:text-gray-400">{c.agenda}</div>}
                </>
              )}
            </div>
          ))}

          {editingCadence && (
            <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="button-add-cadence-row"
                onClick={() => setCadenceDraft((rows) => [...rows, { id: `new-${rows.length}`, day: 'Mon', time: '', name: '', owner: 'Both founders', agenda: '', tag: 'Proposed' }])}
                className={labBtn('ghost', 'h-8 px-2.5')}
              >
                <Plus size={13} /> Add slot
              </button>
              <div className="flex-1" />
              <button type="button" data-testid="button-cancel-cadence" onClick={() => setCadenceDraft(null)} className={labBtn('secondary', 'h-8 px-3')}>
                <X size={12} /> Cancel
              </button>
              <button type="button" data-testid="button-save-cadence" disabled={saving} onClick={() => saveCadence()} className={labBtn('primary', 'h-8 px-3')}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
              </button>
            </div>
          )}
        </div>

        {/* EXECUTION TRACKER */}
        <div className={CARD} data-testid="studio-ops-tracker">
          <div className="flex items-center justify-between mb-1">
            <div className={LBL}>Execution tracker</div>
            <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500" data-testid="tracker-count">
              {health.done} done · {health.total} total
            </span>
          </div>
          <div className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-1.5">
            Commitments pulled from your Week {position.week} deliverables — completing them in their module checks them off here.
          </div>
          {commitments.map((c) => (
            <div key={c.id} className="py-3 border-t border-gray-100 dark:border-gray-800" data-testid={`commitment-${c.id}`}>
              <div className="flex items-start gap-2.5">
                {c.done
                  ? <span className="w-[18px] h-[18px] flex-none mt-0.5 rounded-[5px] bg-emerald-500 text-white flex items-center justify-center"><Check size={12} /></span>
                  : <span className="w-[18px] h-[18px] flex-none mt-0.5 rounded-[5px] border-[1.5px] border-gray-300 dark:border-gray-600" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[13px] font-semibold leading-snug ${c.done ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-800 dark:text-gray-100'}`}>{c.title}</span>
                    <span className={labChip(c.done ? 'active' : 'muted')}>{c.status}</span>
                    {c.optional && <span className={labChip('muted')}>Bonus</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {c.to ? (
                      <Link to={c.to} className="text-[10.5px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/40 rounded-md px-1.5 py-0.5 hover:bg-violet-100 dark:hover:bg-violet-900/60">
                        {c.module}
                      </Link>
                    ) : (
                      <span className="text-[10.5px] font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/40 rounded-md px-1.5 py-0.5">{c.module}</span>
                    )}
                    <span className="text-[11px] text-gray-400 dark:text-gray-500">{c.owner} · due {c.due}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start mt-5">
        {/* BLOCKERS & RISKS */}
        <div className={CARD} data-testid="studio-ops-blockers">
          <div className={`${LBL} mb-3`}>Blockers &amp; risks</div>
          {blockers.length === 0 ? (
            <div className="py-3 border-t border-gray-100 dark:border-gray-800 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-400" data-testid="no-blockers">
              No active blockers this week.
            </div>
          ) : blockers.map((b) => (
            <div key={b.id} className="py-3 border-t border-gray-100 dark:border-gray-800" data-testid={`blocker-${b.id}`}>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-[13px] font-bold text-gray-800 dark:text-gray-100">{b.title}</span>
                <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${SEV_CHIP[b.severity] || SEV_CHIP.Low}`}>{b.severity}</span>
                <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">{b.type}</span>
              </div>
              <div className="text-[11.5px] leading-relaxed text-gray-500 dark:text-gray-400">
                {b.recommended}
                {b.to && <> <Link to={b.to} className="font-semibold text-violet-600 dark:text-violet-400">Open it →</Link></>}
              </div>
              {b.escalate && (
                <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mt-1">
                  ↑ Worth raising at your next <Link to="/spinout-lab/office-hours" className="underline underline-offset-2">Office Hours</Link> session
                </div>
              )}
            </div>
          ))}
        </div>

        {/* WEEKLY REVIEW · CLOSEOUT */}
        <div className={CARD} data-testid="studio-ops-review">
          <div className="flex items-center justify-between mb-3">
            <div className={LBL}>Weekly review · closeout</div>
            <span className={labChip(reviewDone ? 'active' : 'warn')} data-testid="review-status">{reviewDone ? 'Completed' : 'Open'}</span>
          </div>
          {REVIEW_ROWS.map((r) => (
            <div key={r.field} className="py-2.5 border-t border-gray-100 dark:border-gray-800">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">{r.label}</div>
              <textarea
                rows={2}
                value={reviewValue[r.field] || ''}
                onChange={(e) => setReviewDraft((d) => ({ ...(d ?? ops?.review ?? {}), [r.field]: e.target.value }))}
                placeholder={r.hint}
                data-testid={`review-${r.field}`}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-200 placeholder:text-gray-300 dark:placeholder:text-gray-600 resize-y"
              />
            </div>
          ))}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              data-testid="button-save-review"
              disabled={saving || opsError}
              onClick={() => saveReview()}
              className={labBtn('secondary', 'flex-none')}
            >
              Save draft
            </button>
            <button
              type="button"
              data-testid="button-complete-review"
              disabled={saving || opsError || reviewDone || !reviewHasText}
              title={!reviewHasText && !reviewDone ? 'Write at least one line first' : undefined}
              onClick={() => saveReview({ complete: true })}
              className={labBtn('primary', 'flex-1')}
            >
              {reviewDone ? 'Review completed' : 'Complete weekly review'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
