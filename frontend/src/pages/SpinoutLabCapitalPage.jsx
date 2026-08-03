// Spin-Out Lab — Capital (Week 4 tool page).
//
// Design handoff: attached_assets/Capital.dc_*.html (same file ships in the
// StudioOS repo under spin-out-lab-pipeline/project). Mapping to REAL
// surfaces only:
//   - Round + investor pipeline + investor updates: the Worker's raise
//     endpoints (/api/contacts/raise-round|raise-prospects|raise-updates) —
//     the same backbone the founder Capital workspace (/raise/capital) uses.
//     They are Worker-only: a 404 here means "not in this dev environment"
//     and renders one honest unavailable state, never fake data. Committed
//     total comes from the server (SUM over committed prospects); the
//     soft-circled figure is explicitly labeled as derived client-side from
//     meeting/diligence stages.
//   - Data room readiness: computed from live data in the real tools (deck
//     milestone, use-of-funds fields, cap-table scenario, scoring snapshots,
//     discovery interviews, OKRs, revenue proof, incorporation state) — no
//     stored "readiness" exists, so the score is derived and says so.
//   - Omitted (no backend): warm-intro probabilities, conviction scores,
//     next-best-action suggestions, SAFE generator, pitch-feedback objection
//     counts, instrument/valuation-cap/discount/MFN round terms,
//     share/export/copy-link, investor preview, weighted forecasts.

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Banknote, Loader2, Lock, AlertTriangle, FileText, Plus,
  CheckCircle2, MinusCircle, XCircle, HelpCircle, Send, X,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { pickLabProject } from './SpinoutLabStartupPage';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const INPUT = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-[13px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export function fmtAmt(v) {
  const n = num(v);
  if (n === null || n <= 0) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

export const STAGE_LABELS = {
  to_contact: 'To contact',
  contacted: 'Contacted',
  meeting: 'Meeting',
  diligence: 'Diligence',
  committed: 'Committed',
  passed: 'Passed',
};
const STAGE_BADGE = {
  to_contact: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  contacted: 'bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  meeting: 'bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  diligence: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  committed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  passed: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300',
};

// Data-room readiness statuses. 'unknown' (the check itself failed) is shown
// honestly and excluded from the score rather than counted as missing.
const STATUS_META = {
  ready: { label: 'Ready', cls: 'text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2 },
  partial: { label: 'Partial', cls: 'text-amber-600 dark:text-amber-400', Icon: MinusCircle },
  missing: { label: 'Missing', cls: 'text-rose-600 dark:text-rose-400', Icon: XCircle },
  unknown: { label: "Couldn't check", cls: 'text-gray-400', Icon: HelpCircle },
};

export function readinessScore(rows) {
  const scored = rows.filter((r) => r.status !== 'unknown');
  if (!scored.length) return null;
  const pts = scored.reduce((a, r) => a + (r.status === 'ready' ? 1 : r.status === 'partial' ? 0.5 : 0), 0);
  return Math.round((pts / scored.length) * 100);
}

export default function SpinoutLabCapitalPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [state, setState] = useState(null);
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  // Raise data — null until loaded; 'unavailable' when the Worker-only
  // endpoints 404 in this environment; {failed:true} on real errors.
  const [raise, setRaise] = useState(null);
  const [prospects, setProspects] = useState([]);
  const [stages, setStages] = useState(Object.keys(STAGE_LABELS));
  const [updates, setUpdates] = useState([]);
  const [dataroom, setDataroom] = useState([]);
  // Round editor
  const [roundForm, setRoundForm] = useState(null); // null = closed
  const [roundBusy, setRoundBusy] = useState(false);
  const [roundError, setRoundError] = useState('');
  // Prospect add form
  const [addForm, setAddForm] = useState(null);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState('');
  // Update compose
  const [composeForm, setComposeForm] = useState(null);
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeError, setComposeError] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [stageBusy, setStageBusy] = useState(null);

  const canEdit = !!(user && project && Number(user.founder_id) === Number(project.founder_id));

  const loadRaise = async (projectId) => {
    try {
      const [round, pros, ups] = await Promise.all([
        api.raiseRound(projectId),
        api.raiseProspects(projectId),
        api.raiseUpdates(projectId),
      ]);
      setRaise(round || { round: null, raised: 0, committed_count: 0 });
      setProspects(Array.isArray(pros?.items) ? pros.items : []);
      if (Array.isArray(pros?.stages) && pros.stages.length) setStages(pros.stages);
      setUpdates(Array.isArray(ups?.items) ? ups.items : []);
    } catch (e) {
      console.error('[spinout-capital:raise]', e);
      // ONLY 404 = capability not present in this environment (dev FastAPI
      // has no raise routes — the pipeline lives on the Worker).
      setRaise(e?.status === 404 ? 'unavailable' : { failed: true });
    }
  };

  const buildDataroom = async (proj, st) => {
    const msDone = (key) => (st?.milestones || []).some((m) => m.key === key && m.completed_at);
    // Independent detectors; each failure degrades to 'unknown' honestly.
    const [capRes, scoreRes, intRes, okrRes] = await Promise.allSettled([
      api.getCapTableByProject(proj.id),
      api.getScores(proj.id),
      api.listInterviews(proj.id),
      api.listOkrs(proj.id),
    ]);
    const rows = [];
    rows.push({
      key: 'deck', name: 'Pitch deck', source: 'Pitch Deck Builder', to: '/raise/pitch',
      status: msDone('pitch_deck_drafted') ? 'ready' : 'missing',
      hint: msDone('pitch_deck_drafted') ? null : 'Draft your deck in the Pitch Deck Builder.',
    });
    const hasAlloc = String(proj.use_of_funds || '').trim().startsWith('[');
    const hasRaiseTarget = num(proj.funding_needed) > 0;
    rows.push({
      key: 'financials', name: 'Financials · Use of Funds', source: 'Use of Funds', to: '/spinout-lab/use-of-funds',
      status: hasAlloc && hasRaiseTarget ? 'ready' : hasAlloc || hasRaiseTarget ? 'partial' : 'missing',
      hint: hasAlloc && hasRaiseTarget ? null : 'Set a raise target and a 100% allocation.',
    });
    rows.push({
      key: 'captable', name: 'Cap table', source: 'Cap Table', to: '/spinout-lab/captable',
      status: capRes.status === 'fulfilled' ? (capRes.value?.scenario ? 'ready' : 'missing') : 'unknown',
      hint: capRes.status === 'fulfilled' && !capRes.value?.scenario ? 'Initialize founder stock & vesting.' : null,
    });
    const scores = scoreRes.status === 'fulfilled'
      ? (Array.isArray(scoreRes.value?.scores) ? scoreRes.value.scores : Array.isArray(scoreRes.value) ? scoreRes.value : [])
      : null;
    rows.push({
      key: 'scoring', name: 'Scoring report', source: 'Scoring Engine', to: '/spinout-lab/scoring',
      status: scores === null ? 'unknown' : scores.length ? 'ready' : 'missing',
      hint: scores !== null && !scores.length ? 'Run your venture-readiness score.' : null,
    });
    const interviews = intRes.status === 'fulfilled'
      ? (Array.isArray(intRes.value) ? intRes.value : intRes.value?.interviews || [])
      : null;
    rows.push({
      key: 'discovery', name: 'Customer evidence', source: 'Customer Discovery', to: '/spinout-lab/discovery',
      status: interviews === null ? 'unknown' : interviews.length >= 3 ? 'ready' : interviews.length ? 'partial' : 'missing',
      hint: interviews !== null && interviews.length < 3 ? `${interviews.length}/3 interviews logged.` : null,
    });
    const okrs = okrRes.status === 'fulfilled'
      ? (Array.isArray(okrRes.value) ? okrRes.value : okrRes.value?.okrs || [])
      : null;
    rows.push({
      key: 'roadmap', name: 'Product roadmap', source: 'Roadmap', to: '/spinout-lab/roadmap',
      status: okrs === null ? 'unknown' : okrs.length ? 'ready' : 'missing',
      hint: okrs !== null && !okrs.length ? 'Create your OKRs.' : null,
    });
    const hasTraction = num(proj.revenue) > 0 || num(proj.mrr) > 0 || num(proj.paying_customers) > 0;
    rows.push({
      key: 'traction', name: 'Traction proof', source: 'Revenue', to: '/spinout-lab/revenue',
      status: hasTraction ? 'ready' : 'missing',
      hint: hasTraction ? null : 'Log revenue or update your proof fields.',
    });
    rows.push({
      key: 'incorporation', name: 'Incorporation docs', source: 'Incorporate', to: '/incorporate',
      status: st?.is_incorporated || msDone('incorporation_completed') ? 'ready' : 'missing',
      hint: st?.is_incorporated || msDone('incorporation_completed') ? null : 'Entity formation pending.',
    });
    setDataroom(rows);
  };

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [st, me, projects] = await Promise.all([
          spinoutLab.state(),
          api.getMe(),
          api.listProjects().catch(() => []),
        ]);
        if (dead) return;
        setState(st);
        setUser(me);
        const proj = pickLabProject(projects, me);
        setProject(proj || null);
        if (proj) {
          await Promise.all([loadRaise(proj.id), buildDataroom(proj, st)]);
        }
        if (!dead) setStatus('ready');
      } catch (e) {
        console.error('[spinout-capital]', e);
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, []);

  const raiseAvailable = raise && raise !== 'unavailable' && !raise.failed;
  const round = raiseAvailable ? raise.round : null;
  const committed = raiseAvailable ? num(raise.raised) || 0 : 0;
  const target = num(round?.target_amount);
  // Derived client-side — labeled as such in the UI.
  const softCircled = useMemo(
    () => prospects.filter((p) => p.stage === 'meeting' || p.stage === 'diligence')
      .reduce((a, p) => a + (num(p.amount) || 0), 0),
    [prospects],
  );
  const remaining = target !== null ? Math.max(0, target - committed) : null;
  const visibleProspects = stageFilter === 'all' ? prospects : prospects.filter((p) => p.stage === stageFilter);
  const stageCounts = useMemo(() => {
    const c = {};
    for (const p of prospects) c[p.stage] = (c[p.stage] || 0) + 1;
    return c;
  }, [prospects]);
  const score = readinessScore(dataroom);
  const blocking = dataroom.filter((r) => r.status === 'missing');

  // W4 deliverables, observed from real data:
  // - intros: 3+ prospects that progressed past cold outreach.
  // - data room: 8+ artifacts fully ready in the derived readiness check.
  useEffect(() => {
    if (status !== 'ready') return;
    const progressed = prospects.filter((p) => ['intro', 'meeting', 'diligence', 'committed'].includes(p.stage)).length;
    if (progressed >= 3) markMilestone(user, 'investor_intros_secured');
    if (dataroom.filter((r) => r.status === 'ready').length >= 8) markMilestone(user, 'data_room_built');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, prospects, dataroom]);

  const saveRound = async () => {
    if (roundBusy) return;
    setRoundBusy(true);
    setRoundError('');
    try {
      await api.raiseRoundSave({
        project_id: project.id,
        name: roundForm.name || null,
        target_amount: roundForm.target_amount === '' ? null : Number(roundForm.target_amount),
        close_date: roundForm.close_date || null,
        notes: roundForm.notes || null,
      });
      // W4 deliverable — the ask is locked once a real target amount is saved.
      if (roundForm.target_amount !== '' && Number(roundForm.target_amount) > 0) {
        markMilestone(user, 'fundraise_ask_locked');
      }
      await loadRaise(project.id);
      setRoundForm(null);
    } catch (e) {
      console.error('[spinout-capital:round]', e);
      setRoundError(e?.data?.detail || e?.message || 'Could not save the round.');
    } finally {
      setRoundBusy(false);
    }
  };

  const addProspect = async () => {
    if (addBusy) return;
    setAddBusy(true);
    setAddError('');
    try {
      await api.raiseProspectCreate({
        project_id: project.id,
        name: addForm.name || null,
        email: addForm.email || null,
        firm: addForm.firm || null,
        amount: addForm.amount === '' ? null : Number(addForm.amount),
      });
      await loadRaise(project.id);
      setAddForm(null);
    } catch (e) {
      console.error('[spinout-capital:add]', e);
      setAddError(e?.data?.detail || e?.message || 'Could not add the prospect.');
    } finally {
      setAddBusy(false);
    }
  };

  const setStage = async (p, stage) => {
    if (stageBusy) return;
    setStageBusy(p.id);
    try {
      await api.raiseProspectUpdate(p.id, { stage });
      await loadRaise(project.id);
    } catch (e) {
      console.error('[spinout-capital:stage]', e);
    } finally {
      setStageBusy(null);
    }
  };

  const sendUpdate = async () => {
    if (composeBusy) return;
    setComposeBusy(true);
    setComposeError('');
    try {
      await api.raiseUpdateCreate({ project_id: project.id, subject: composeForm.subject, body: composeForm.body || null });
      await loadRaise(project.id);
      setComposeForm(null);
    } catch (e) {
      console.error('[spinout-capital:update]', e);
      setComposeError(e?.data?.detail || e?.message || 'Could not record the update.');
    } finally {
      setComposeBusy(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="capital-loading">
        <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="capital-error">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Couldn't load Capital</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Reload the page to try again.</p>
      </div>
    );
  }
  const isAdmin = user?.role === 'admin';
  if (!state?.active && !isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="capital-inactive">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Spin-Out Lab is not active</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The Capital workspace is part of the Spin-Out Lab program.{' '}
          <Link to="/spinout-lab" className="text-violet-600 hover:underline">Go to the Lab</Link>
        </p>
      </div>
    );
  }
  if (!isAdmin && !(state?.unlocked_features || []).includes('capital')) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="capital-locked">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Capital unlocks in Week 4</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Finish your current week's deliverables to unlock the raise workspace.
        </p>
        <Link to="/spinout-lab" className="text-sm font-semibold text-violet-600 hover:underline">Back to Workspace</Link>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="capital-no-project">
        <FileText className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">No startup record yet</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Create your startup in{' '}
          <Link to="/spinout-lab/startup" className="text-violet-600 hover:underline">Startups</Link>{' '}
          first — the raise is run against it.
        </p>
      </div>
    );
  }

  const week = num(user?.spinout_lab_week) || state?.week || 4;

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6 space-y-5" data-testid="page-spinout-capital">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/spinout-lab')}
          data-testid="button-back-workspace"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeft size={14} /> Back to Workspace
        </button>
        <div className="flex items-center gap-2">
          <Banknote size={16} className="text-violet-500" />
          <h1 className="text-[17px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Capital</h1>
          <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Active</span>
        </div>
        <span className="ml-auto text-[11px] font-semibold text-gray-400 dark:text-gray-500">Unlocked · Wk {week}</span>
      </div>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 -mt-2">
        Run your fundraise from first signal to first close — round, investor pipeline, and data room in one place.
      </p>

      {/* Raise unavailable / failed */}
      {raise === 'unavailable' && (
        <div className={`${CARD} !p-4`} data-testid="raise-unavailable">
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            <span className="font-bold text-gray-700 dark:text-gray-200">Round &amp; investor pipeline are unavailable in this environment.</span>{' '}
            They run on the deployed backend — open the published app to manage your raise. The data-room readiness below is live.
          </p>
        </div>
      )}
      {raise?.failed && (
        <div className={`${CARD} !p-4`} data-testid="raise-failed">
          <p className="text-[12px] text-amber-600 dark:text-amber-400">Couldn't load your raise pipeline right now — reload to retry. Data-room readiness below is unaffected.</p>
        </div>
      )}

      {/* Stats bar */}
      {raiseAvailable && (
        <div className={`${CARD} !p-4`} data-testid="card-raise-stats">
          {round ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div data-testid="stat-target">
                  <div className={LBL}>Target raise</div>
                  <div className="text-[17px] font-extrabold text-gray-900 dark:text-gray-50 tabular-nums">{fmtAmt(target)}</div>
                  {round.close_date && <div className="text-[10px] text-gray-400">target close {fmtDate(round.close_date)}</div>}
                </div>
                <div data-testid="stat-committed">
                  <div className={LBL}>Committed</div>
                  <div className="text-[17px] font-extrabold text-violet-700 dark:text-violet-300 tabular-nums">{committed > 0 ? fmtAmt(committed) : '$0'}</div>
                  <div className="text-[10px] text-gray-400">{raise.committed_count} committed prospect{raise.committed_count === 1 ? '' : 's'}</div>
                </div>
                <div data-testid="stat-soft">
                  <div className={LBL}>Soft-circled</div>
                  <div className="text-[17px] font-extrabold text-amber-600 dark:text-amber-400 tabular-nums">{softCircled > 0 ? fmtAmt(softCircled) : '$0'}</div>
                  <div className="text-[10px] text-gray-400">check sizes at meeting/diligence</div>
                </div>
                <div data-testid="stat-remaining">
                  <div className={LBL}>Remaining</div>
                  <div className="text-[17px] font-extrabold text-gray-900 dark:text-gray-50 tabular-nums">{remaining !== null ? fmtAmt(remaining) : '—'}</div>
                  <div className="text-[10px] text-gray-400">to target</div>
                </div>
              </div>
              {target > 0 && (
                <div className="relative h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden" data-testid="raise-progress">
                  <div className="absolute inset-y-0 left-0 bg-amber-300 dark:bg-amber-500/60" style={{ width: `${Math.min(100, ((committed + softCircled) / target) * 100)}%` }} />
                  <div className="absolute inset-y-0 left-0 bg-violet-600" style={{ width: `${Math.min(100, (committed / target) * 100)}%` }} />
                </div>
              )}
              <div className="flex items-center justify-between mt-2">
                <div className="text-[10px] text-gray-400">Committed (solid) · soft-circled (light) · target {fmtAmt(target)}</div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => { setRoundForm({ name: round.name || '', target_amount: round.target_amount ?? '', close_date: round.close_date || '', notes: round.notes || '' }); setRoundError(''); }}
                    data-testid="button-edit-round"
                    className="text-[11.5px] font-bold text-violet-600 hover:underline"
                  >
                    Edit round
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3" data-testid="no-round">
              <p className="text-[12.5px] text-gray-500 dark:text-gray-400">
                No active round yet — set your target and close date to start tracking the raise.
              </p>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setRoundForm({
                      name: '',
                      // Prefill from the real Use-of-Funds raise target when set.
                      target_amount: num(project.funding_needed) > 0 ? project.funding_needed : '',
                      close_date: '',
                      notes: '',
                    });
                    setRoundError('');
                  }}
                  data-testid="button-create-round"
                  className="text-[11.5px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-1.5"
                >
                  Set up the round
                </button>
              )}
            </div>
          )}
          <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2">
            Instrument terms (SAFE cap, discount, pro-rata) aren't tracked here — model the raise in{' '}
            <Link to="/spinout-lab/use-of-funds" className="text-violet-600 hover:underline">Use of Funds</Link>{' '}
            and your <Link to="/spinout-lab/captable" className="text-violet-600 hover:underline">Cap Table</Link>.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 items-start">
        {/* Left: pipeline + data room */}
        <div className="space-y-4">
          {raiseAvailable && (
            <div className={CARD} data-testid="card-pipeline">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div>
                  <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">Investor pipeline</div>
                  <div className="text-[11px] text-gray-400 dark:text-gray-500">{prospects.length} prospect{prospects.length === 1 ? '' : 's'} · committed total comes from this pipeline</div>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => { setAddForm({ name: '', email: '', firm: '', amount: '' }); setAddError(''); }}
                    data-testid="button-add-prospect"
                    className="ml-auto text-[11.5px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-1.5 inline-flex items-center gap-1"
                  >
                    <Plus size={12} /> Add prospect
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1 mb-3">
                <button
                  type="button" onClick={() => setStageFilter('all')} data-testid="filter-all"
                  className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${stageFilter === 'all' ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
                >
                  All {prospects.length}
                </button>
                {stages.map((s) => (
                  <button
                    key={s} type="button" onClick={() => setStageFilter(s)} data-testid={`filter-${s}`}
                    className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${stageFilter === s ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
                  >
                    {STAGE_LABELS[s] || s} {stageCounts[s] || 0}
                  </button>
                ))}
              </div>
              {visibleProspects.length === 0 ? (
                <div className="text-center py-8" data-testid="pipeline-empty">
                  <Banknote className="w-7 h-7 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <div className="text-[13px] font-bold text-gray-900 dark:text-gray-50 mb-1">
                    {stageFilter === 'all' ? 'No investor prospects yet' : 'No prospects at this stage'}
                  </div>
                  <p className="text-[11.5px] text-gray-500 dark:text-gray-400">
                    {stageFilter === 'all' ? 'Add the investors you plan to approach — real names only.' : 'Try another stage filter.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {visibleProspects.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 dark:border-gray-800 px-3 py-2.5" data-testid={`prospect-${p.id}`}>
                      <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 flex items-center justify-center text-[11px] font-extrabold shrink-0">
                        {(p.name || p.firm || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-bold text-gray-900 dark:text-gray-50 truncate">
                          {p.name || '—'}{p.firm ? <span className="text-gray-400 font-normal"> · {p.firm}</span> : null}
                        </div>
                        <div className="text-[10.5px] text-gray-400">
                          {num(p.amount) ? `${fmtAmt(p.amount)} check · ` : ''}updated {fmtDate(p.updated_at)}
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ${STAGE_BADGE[p.stage] || STAGE_BADGE.to_contact}`}>
                        {STAGE_LABELS[p.stage] || p.stage}
                      </span>
                      {canEdit && (
                        <select
                          value={p.stage}
                          onChange={(e) => setStage(p, e.target.value)}
                          disabled={stageBusy === p.id}
                          data-testid={`select-stage-${p.id}`}
                          className="text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 py-1 text-gray-700 dark:text-gray-200"
                        >
                          {stages.map((s) => <option key={s} value={s}>{STAGE_LABELS[s] || s}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Data room — works in every environment */}
          <div className={CARD} data-testid="card-dataroom">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">Data room · investor-ready diligence</div>
              {score !== null && (
                <div className="text-[13px] font-extrabold tabular-nums" data-testid="text-readiness-score">
                  <span className={score >= 70 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>{score}</span>
                  <span className="text-gray-400 font-semibold text-[11px]"> / 100 readiness</span>
                </div>
              )}
            </div>
            <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-3">
              Derived live from what actually exists in each tool — nothing is uploaded here.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className={LBL}>
                    <th className="py-1.5 pr-3 font-bold">Section</th>
                    <th className="py-1.5 pr-3 font-bold">Source</th>
                    <th className="py-1.5 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dataroom.map((r) => {
                    const meta = STATUS_META[r.status];
                    return (
                      <tr key={r.key} className="border-t border-gray-100 dark:border-gray-800" data-testid={`dataroom-${r.key}`}>
                        <td className="py-2 pr-3">
                          <Link to={r.to} className="text-[12px] font-semibold text-gray-900 dark:text-gray-50 hover:text-violet-600">{r.name}</Link>
                          {r.hint && <div className="text-[10px] text-gray-400">{r.hint}</div>}
                        </td>
                        <td className="py-2 pr-3 text-[11.5px] text-gray-500 dark:text-gray-400">{r.source}</td>
                        <td className="py-2">
                          <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${meta.cls}`}>
                            <meta.Icon size={12} /> {meta.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {blocking.length > 0 && (
              <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 px-3 py-2.5 mt-3" data-testid="dataroom-blocking">
                <p className="text-[11.5px] text-amber-800 dark:text-amber-300">
                  <span className="font-bold">Blocking investor readiness:</span>{' '}
                  {blocking.map((r) => r.name).join(', ')} — open each section above to fill the gap.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right: investor updates */}
        <div className="space-y-4">
          {raiseAvailable && (
            <div className={CARD} data-testid="card-updates">
              <div className="flex items-center justify-between mb-1">
                <div className={LBL}>Investor updates</div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => { setComposeForm({ subject: '', body: '' }); setComposeError(''); }}
                    data-testid="button-compose-update"
                    className="text-[11.5px] font-bold text-violet-600 hover:underline inline-flex items-center gap-1"
                  >
                    <Send size={11} /> Record update
                  </button>
                )}
              </div>
              <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mb-3">
                Logged to the pipeline and each prospect's timeline — not emailed.
              </p>
              {updates.length === 0 ? (
                <p className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="updates-empty">
                  No investor updates recorded yet.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {updates.map((u) => (
                    <div key={u.uid || u.id} className="border-t border-gray-100 dark:border-gray-800 pt-2 first:border-t-0 first:pt-0" data-testid={`update-${u.id}`}>
                      <div className="text-[12px] font-bold text-gray-900 dark:text-gray-50">{u.subject}</div>
                      {u.body && <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-2">{u.body}</p>}
                      <div className="text-[10px] text-gray-400 mt-0.5">{fmtDate(u.created_at)} · {u.recipients_count} recipient{u.recipients_count === 1 ? '' : 's'} on the pipeline</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={CARD} data-testid="card-feeds-into">
            <div className={`${LBL} mb-3`}>Works with</div>
            <div className="space-y-2 text-[12px]">
              <Link to="/spinout-lab/use-of-funds" className="block font-semibold text-gray-700 dark:text-gray-200 hover:text-violet-600" data-testid="link-uof">
                Use of Funds <span className="text-gray-400 font-normal">· raise target & allocation</span>
              </Link>
              <Link to="/raise/pitch" className="block font-semibold text-gray-700 dark:text-gray-200 hover:text-violet-600" data-testid="link-deck">
                Pitch Deck Builder <span className="text-gray-400 font-normal">· what investors see first</span>
              </Link>
              <Link to="/spinout-lab/captable" className="block font-semibold text-gray-700 dark:text-gray-200 hover:text-violet-600" data-testid="link-captable">
                Cap Table <span className="text-gray-400 font-normal">· ownership after the round</span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {(roundForm || addForm || composeForm) && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => { setRoundForm(null); setAddForm(null); setComposeForm(null); }}>
          <div className={`${CARD} w-full max-w-md`} onClick={(e) => e.stopPropagation()} data-testid={roundForm ? 'modal-round' : addForm ? 'modal-add' : 'modal-compose'}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">
                {roundForm ? (round ? 'Edit the round' : 'Set up the round') : addForm ? 'Add an investor prospect' : 'Record an investor update'}
              </div>
              <button type="button" onClick={() => { setRoundForm(null); setAddForm(null); setComposeForm(null); }} data-testid="button-close-modal" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={16} />
              </button>
            </div>

            {roundForm && (
              <div className="space-y-3">
                <label className="block">
                  <span className={LBL}>Round name</span>
                  <input type="text" maxLength={200} className={INPUT} value={roundForm.name} onChange={(e) => setRoundForm({ ...roundForm, name: e.target.value })} placeholder="e.g. Pre-seed" data-testid="input-round-name" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={LBL}>Target (USD)</span>
                    <input type="number" min="0" step="1000" className={INPUT} value={roundForm.target_amount} onChange={(e) => setRoundForm({ ...roundForm, target_amount: e.target.value })} placeholder="1000000" data-testid="input-round-target" />
                  </label>
                  <label className="block">
                    <span className={LBL}>Target close</span>
                    <input type="date" className={INPUT} value={roundForm.close_date} onChange={(e) => setRoundForm({ ...roundForm, close_date: e.target.value })} data-testid="input-round-close" />
                  </label>
                </div>
                <label className="block">
                  <span className={LBL}>Notes</span>
                  <textarea rows={2} maxLength={4000} className={INPUT} value={roundForm.notes} onChange={(e) => setRoundForm({ ...roundForm, notes: e.target.value })} data-testid="input-round-notes" />
                </label>
                {roundError && <div className="text-[11.5px] text-rose-600 dark:text-rose-400" data-testid="round-error">{String(roundError)}</div>}
                <button type="button" onClick={saveRound} disabled={roundBusy} data-testid="button-save-round" className="w-full text-[12px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-2 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
                  {roundBusy && <Loader2 size={12} className="animate-spin" />} Save round
                </button>
              </div>
            )}

            {addForm && (
              <div className="space-y-3">
                <label className="block">
                  <span className={LBL}>Name</span>
                  <input type="text" maxLength={200} className={INPUT} value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} placeholder="Investor name" data-testid="input-prospect-name" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={LBL}>Email</span>
                    <input type="email" className={INPUT} value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} placeholder="optional" data-testid="input-prospect-email" />
                  </label>
                  <label className="block">
                    <span className={LBL}>Firm</span>
                    <input type="text" maxLength={200} className={INPUT} value={addForm.firm} onChange={(e) => setAddForm({ ...addForm, firm: e.target.value })} placeholder="optional" data-testid="input-prospect-firm" />
                  </label>
                </div>
                <label className="block">
                  <span className={LBL}>Expected check (USD)</span>
                  <input type="number" min="0" step="1000" className={INPUT} value={addForm.amount} onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })} placeholder="optional" data-testid="input-prospect-amount" />
                </label>
                {addError && <div className="text-[11.5px] text-rose-600 dark:text-rose-400" data-testid="add-error">{String(addError)}</div>}
                <button type="button" onClick={addProspect} disabled={addBusy || (!addForm.name.trim() && !addForm.email.trim())} data-testid="button-save-prospect" className="w-full text-[12px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-2 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
                  {addBusy && <Loader2 size={12} className="animate-spin" />} Add prospect
                </button>
              </div>
            )}

            {composeForm && (
              <div className="space-y-3">
                <label className="block">
                  <span className={LBL}>Subject</span>
                  <input type="text" maxLength={200} className={INPUT} value={composeForm.subject} onChange={(e) => setComposeForm({ ...composeForm, subject: e.target.value })} placeholder="e.g. July progress update" data-testid="input-update-subject" />
                </label>
                <label className="block">
                  <span className={LBL}>Body</span>
                  <textarea rows={4} maxLength={10000} className={INPUT} value={composeForm.body} onChange={(e) => setComposeForm({ ...composeForm, body: e.target.value })} data-testid="input-update-body" />
                </label>
                <p className="text-[10.5px] text-gray-400 dark:text-gray-500">
                  Recorded on the pipeline and each linked prospect's timeline. It is not emailed.
                </p>
                {composeError && <div className="text-[11.5px] text-rose-600 dark:text-rose-400" data-testid="compose-error">{String(composeError)}</div>}
                <button type="button" onClick={sendUpdate} disabled={composeBusy || !composeForm.subject.trim()} data-testid="button-save-update" className="w-full text-[12px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-3 py-2 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
                  {composeBusy && <Loader2 size={12} className="animate-spin" />} Record update
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
