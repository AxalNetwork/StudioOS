// Spin-Out Lab "Customer Discovery" tool page — structured interview evidence,
// per the design handoff (attached_assets/Customer_Discovery.dc_*.html / repo
// spin-out-lab-pipeline/project). Every number renders from live data:
// interviews (GET /progress/discovery/:pid), the inbound waitlist CRM
// (GET /progress/discovery/:pid/waitlist) and curated pain groups
// (GET /progress/pain-groups/:pid). The design's mock content (fake ICP
// percentages, willingness-to-pay, fabricated leads) is NOT reproduced —
// sections that have no real data source are derived honestly from the
// interview log (hypothesis validation, working definition, themes) or show
// explicit empty states.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Circle,
  FileText,
  Loader2,
  MessagesSquare,
  Quote,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { reportError } from '../lib/log';
import { markMilestone } from '../lib/spinoutLabHooks';
import { pickLabProject } from './SpinoutLabStartupPage';

const MIN_INTERVIEWS = 3; // program gate — week 1 requires 3 logged interviews

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm';

function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function initialsOf(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
}

const CRM_CHIP = {
  new: { label: 'New', cls: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' },
  invited: { label: 'Invited', cls: 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300' },
  followed_up: { label: 'Followed up', cls: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
  promoted: { label: 'Converted', cls: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' },
};

const isFromLeads = (iv) => (iv.notes || '').startsWith('Promoted from waitlist');

export default function SpinoutLabDiscoveryPage() {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [project, setProject] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [signups, setSignups] = useState([]);
  const [painData, setPainData] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [logFilter, setLogFilter] = useState('all');
  const [busyLead, setBusyLead] = useState(null);
  const [leadMsg, setLeadMsg] = useState(null);

  const loadProjectData = useCallback(async (pid) => {
    const [ivs, wl, pg] = await Promise.all([
      api.listInterviews(pid).catch(() => []),
      api.listWaitlistCustomers(pid).catch(() => ({ signups: [] })),
      api.painGroups(pid).catch(() => null),
    ]);
    setInterviews(Array.isArray(ivs) ? ivs : ivs?.interviews || []);
    setSignups(wl?.signups || []);
    setPainData(pg);
  }, []);

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    Promise.all([spinoutLab.state(), api.listProjects().catch(() => [])])
      .then(async ([s, projects]) => {
        if (!alive) return;
        setState(s);
        const p = pickLabProject(projects, user);
        setProject(p);
        if (p) await loadProjectData(p.id);
        if (alive) setStatus('ready');
      })
      .catch((e) => {
        if (!alive) return;
        reportError('SpinoutLabDiscoveryPage:load', e);
        setStatus('error');
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const derived = useMemo(() => {
    const ivs = interviews.map((iv) => ({
      ...iv,
      _pains: parseArr(iv.pains ?? iv.pains_json),
      _hyps: parseArr(iv.hypotheses ?? iv.hypotheses_json),
    }));

    let hypTotal = 0;
    let hypValidated = 0;
    let hypInvalidated = 0;
    ivs.forEach((iv) => iv._hyps.forEach((h) => {
      hypTotal += 1;
      if (h.status === 'validated') hypValidated += 1;
      if (h.status === 'invalidated') hypInvalidated += 1;
    }));
    const hypInconclusive = hypTotal - hypValidated - hypInvalidated;

    // Pain ranking — curated groups first, then ungrouped phrases (both
    // real). Zero-count entries (e.g. an empty curated group) never rank:
    // they'd otherwise inflate readiness and the working definition.
    const painRows = [
      ...(painData?.groups || []).map((g) => ({
        title: g.title,
        count: Number(g.count ?? (g.aliases || []).reduce((a, x) => a + Number(x.count || 0), 0)) || 0,
        grouped: true,
      })),
      ...(painData?.ungrouped || []).map((u) => ({ title: u.display_phrase, count: Number(u.count) || 0 })),
    ].filter((p) => p.count > 0).sort((a, b) => b.count - a.count);
    const distinctPains = painRows.length ||
      new Set(ivs.flatMap((iv) => iv._pains.map((p) => String(p).trim().toLowerCase()).filter(Boolean))).size;

    // Funnel — every stage is a concrete, checkable definition.
    const contacted = signups.filter((s) => s.crm_status && s.crm_status !== 'new').length;
    const painConfirmed = ivs.filter((iv) => iv._pains.length > 0).length;
    const solutionFit = ivs.filter((iv) => iv._hyps.some((h) => h.status === 'validated')).length;
    const reached = signups.length + ivs.length;
    const funnel = [
      { label: 'Reached', sub: 'Leads + interviews', n: reached },
      { label: 'Engaged', sub: 'Contacted or interviewed', n: contacted + ivs.length },
      { label: 'Pain confirmed', sub: 'Interviews with a logged pain', n: painConfirmed },
      { label: 'Solution-fit', sub: 'A hypothesis validated', n: solutionFit },
    ].map((f) => ({ ...f, pct: reached ? Math.round((f.n / reached) * 100) : 0 }));

    // Working definition — derived live from the interview log.
    const roleCounts = new Map();
    ivs.forEach((iv) => {
      const r = (iv.interviewee_role || '').trim();
      if (r) roleCounts.set(r, (roleCounts.get(r) || 0) + 1);
    });
    const topRole = [...roleCounts.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    const topPain = painRows[0] || null;

    const notesCount = ivs.filter((iv) => (iv.notes || '').trim().length > 0).length;

    const readiness = [
      { label: `Minimum ${MIN_INTERVIEWS} interviews logged`, ok: ivs.length >= MIN_INTERVIEWS },
      { label: 'Top 3 pain points identified', ok: distinctPains >= 3 },
      { label: 'Notes attached to every interview', ok: ivs.length > 0 && notesCount === ivs.length },
      { label: 'At least one hypothesis validated', ok: hypValidated > 0 },
    ];

    return {
      ivs, hypTotal, hypValidated, hypInvalidated, hypInconclusive,
      painRows, distinctPains, funnel, topRole, topPain, notesCount, readiness,
    };
  }, [interviews, signups, painData]);

  // W1 deliverable — the ICP working definition is real once it is fully
  // derivable: 3+ interviews with a leading segment and a primary pain.
  useEffect(() => {
    if (!state?.active) return;
    if (derived.ivs?.length >= 3 && derived.topRole && derived.topPain) {
      markMilestone(user, 'icp_defined');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.active, derived.ivs?.length, derived.topRole, derived.topPain]);

  const leadAction = async (signup, kind) => {
    if (!project) return;
    setBusyLead(signup.id);
    setLeadMsg(null);
    try {
      if (kind === 'promote') {
        await api.promoteWaitlistCustomer(project.id, signup.id);
        // Derive milestone ordinals from the FRESH server count (not the
        // stale interviews state — concurrent promotes would double-mark one
        // ordinal and skip another) and only mark keys not already done.
        const fresh = await api.listInterviews(project.id).catch(() => []);
        const n = Array.isArray(fresh) ? fresh.length : (fresh?.interviews || []).length;
        const done = new Set((state?.milestones || []).map((m) => m?.key ?? m));
        for (let k = 1; k <= Math.min(n, 5); k += 1) {
          const key = `customer_interview_logged_${k}`;
          if (!done.has(key)) await markMilestone(user, key);
        }
        spinoutLab.state().then(setState).catch(() => {});
        setLeadMsg({ kind: 'ok', text: `${signup.name || signup.email} converted to an interview.` });
      } else if (kind === 'invite') {
        await api.inviteWaitlistCustomer(project.id, signup.id);
        setLeadMsg({ kind: 'ok', text: `Invitation sent to ${signup.email}.` });
      } else {
        await api.followUpWaitlistCustomer(project.id, signup.id);
        // W2 deliverable — the 3rd real follow-up marks the map as done.
        const followed = (signups || []).filter(
          (s) => s.status === 'followed_up' && s.id !== signup.id,
        ).length + 1;
        if (followed >= 3) await markMilestone(user, 'discovery_followups_mapped');
        setLeadMsg({ kind: 'ok', text: `Follow-up sent to ${signup.email}.` });
      }
      await loadProjectData(project.id);
    } catch (e) {
      reportError(`SpinoutLabDiscoveryPage:${kind}`, e);
      setLeadMsg({ kind: 'error', text: `Couldn't ${kind === 'promote' ? 'convert' : kind === 'invite' ? 'invite' : 'follow up with'} ${signup.email}. Try again.` });
    } finally {
      setBusyLead(null);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-24" data-testid="discovery-loading">
        <Loader2 className="animate-spin text-violet-600 dark:text-violet-400" size={28} />
      </div>
    );
  }

  if (status === 'error' || !state) {
    return (
      <div className="max-w-lg mx-auto text-center py-24 px-6" data-testid="discovery-error">
        <div className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">Couldn&rsquo;t load Customer Discovery</div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Check your connection and try again.</p>
        <button type="button" data-testid="button-retry-discovery" onClick={() => window.location.reload()} className="h-10 px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
          Retry
        </button>
      </div>
    );
  }

  if (!state.active && !state.is_incorporated) {
    return (
      <div className="max-w-lg mx-auto text-center py-24 px-6" data-testid="discovery-inactive">
        <div className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-2">Spin-Out Lab isn&rsquo;t active on this account</div>
        <Link to="/spinout-lab" className="inline-flex h-10 items-center px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold mt-3">
          Go to Spin-Out Lab
        </Link>
      </div>
    );
  }

  const week = state.is_incorporated ? 4 : Math.min(4, Math.max(1, Number(state.week) || 1));
  const deckUnlocked = state.is_incorporated || week >= 2;
  const {
    ivs, hypTotal, hypValidated, hypInvalidated, hypInconclusive,
    painRows, distinctPains, funnel, topRole, topPain, notesCount, readiness,
  } = derived;
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.n));
  const logRows = ivs.filter((iv) => {
    if (logFilter === 'manual') return !isFromLeads(iv);
    if (logFilter === 'leads') return isFromLeads(iv);
    return true;
  });
  const readyCount = readiness.filter((r) => r.ok).length;
  const logTool = project ? `/build/discovery?project_id=${project.id}` : '/build/discovery';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6" data-testid="page-spinout-discovery">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <Link to="/spinout-lab" data-testid="link-back-to-workspace" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-violet-700 dark:hover:text-violet-300 mb-2">
            <ArrowLeft size={14} /> Back to Workspace
          </Link>
          <div className="flex items-center gap-2.5 flex-wrap">
            <MessagesSquare size={18} className="text-violet-600 dark:text-violet-400" />
            <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Customer Discovery</h1>
            <span className="text-[10.5px] font-bold rounded-full px-2.5 py-0.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">Active</span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Structured interview evidence — pain points, hypotheses, and deck-ready quotes.</p>
        </div>
        <Link to={logTool} data-testid="link-log-interview" className="h-9 px-4 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold inline-flex items-center gap-1.5">
          Log interview <ArrowRight size={14} />
        </Link>
      </div>

      {!project ? (
        <div className={`${CARD} text-center py-10`} data-testid="discovery-no-project">
          <div className="text-base font-bold text-gray-900 dark:text-gray-50">Create your startup record first</div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-4">Interviews attach to your company record — create it, then start logging.</p>
          <Link to="/projects" className="inline-flex h-10 items-center px-5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold">
            Create your startup record
          </Link>
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
            {[
              { label: 'Interviews logged', value: ivs.length, testid: 'kpi-interviews' },
              { label: 'Distinct pains', value: distinctPains, testid: 'kpi-pains' },
              { label: 'Hypotheses validated', value: `${hypValidated} of ${hypTotal}`, testid: 'kpi-hypotheses' },
              { label: 'Minimum interviews', value: `${Math.min(ivs.length, MIN_INTERVIEWS)} of ${MIN_INTERVIEWS}`, ok: ivs.length >= MIN_INTERVIEWS, testid: 'kpi-minimum' },
            ].map((k) => (
              <div key={k.label} data-testid={k.testid} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-4 py-3.5 shadow-sm">
                <div className={`text-xl font-extrabold tracking-tight ${k.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-gray-50'}`}>{k.value}</div>
                <div className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 mt-0.5">{k.label}</div>
                {k.ok !== undefined && (
                  <div className="h-1 rounded-full bg-gray-100 dark:bg-gray-800 mt-2 overflow-hidden">
                    <div className={`h-full rounded-full ${k.ok ? 'bg-emerald-500' : 'bg-violet-600'}`} style={{ width: `${Math.min(100, Math.round((ivs.length / MIN_INTERVIEWS) * 100))}%` }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-5 items-start">
            {/* LEFT column */}
            <div className="flex flex-col gap-5 min-w-0">
              {/* Funnel */}
              <div className={CARD} data-testid="discovery-funnel">
                <div className={`${LBL} mb-4`}>Discovery funnel · leads → solution-fit</div>
                {funnel[0].n === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">No contacts yet — log an interview or publish a landing page to start the funnel.</p>
                ) : (
                  <div className="grid grid-cols-4 gap-2.5 items-end">
                    {funnel.map((f, i) => (
                      <div key={f.label} className="min-w-0">
                        <div className="text-sm font-bold text-gray-900 dark:text-gray-50 text-center mb-1.5">{f.n}</div>
                        <div
                          className={`rounded-lg ${i === 0 ? 'bg-violet-600' : i === 1 ? 'bg-violet-500/80' : i === 2 ? 'bg-violet-400/70' : 'bg-violet-300/70 dark:bg-violet-500/40'}`}
                          style={{ height: `${Math.max(14, Math.round((f.n / maxFunnel) * 88))}px` }}
                        />
                        <div className="text-[10.5px] font-semibold text-gray-600 dark:text-gray-300 text-center mt-1.5 truncate" title={f.sub}>{f.label}</div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 text-center">{f.pct}%</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pain point validation */}
              <div className={CARD} data-testid="discovery-pains">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <div className={LBL}>Pain point validation</div>
                  <Link to={logTool} className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 whitespace-nowrap">Curate groups →</Link>
                </div>
                <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-3.5">Ranked by mentions — the top pain anchors the deck&rsquo;s Problem slide.</p>
                {painRows.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">No pains logged yet — every interview should capture at least one.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {painRows.slice(0, 5).map((p, i) => {
                      const total = Math.max(1, painData?.interview_total ?? ivs.length);
                      return (
                        <div key={p.title} data-testid={`pain-row-${i}`}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`w-5 h-5 flex-none rounded-md text-[10.5px] font-bold flex items-center justify-center ${i === 0 ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>{i + 1}</span>
                            <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-50">{p.title}</span>
                            {i === 0 && <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">Deck anchor</span>}
                            {p.grouped && <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">Grouped</span>}
                            <span className="ml-auto text-[11.5px] font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">{p.count} of {total}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 mt-1.5 overflow-hidden">
                            <div className={`h-full rounded-full ${i === 0 ? 'bg-violet-600' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, Math.round((p.count / total) * 100))}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Inbound leads */}
              <div className={CARD} data-testid="discovery-leads">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
                  <div className={LBL}>Inbound leads · Brand &amp; Pages</div>
                  <Link to="/spinout-lab/brand" className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 whitespace-nowrap">Open landing pages →</Link>
                </div>
                <p className="text-[11.5px] text-gray-400 dark:text-gray-500 mb-3.5">Customer-intent signups from your landing pages route here for interviews.</p>
                {leadMsg && (
                  <div data-testid="lead-action-message" className={`text-[11.5px] rounded-lg px-3 py-2 mb-3 ${leadMsg.kind === 'ok' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
                    {leadMsg.text}
                  </div>
                )}
                {signups.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">No inbound leads yet — publish a landing page with a waitlist to collect them.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {signups.map((s) => {
                      const chip = CRM_CHIP[s.crm_status] || CRM_CHIP.new;
                      const busy = busyLead === s.id;
                      const converted = s.crm_status === 'promoted';
                      return (
                        <div key={s.id} data-testid={`lead-${s.id}`} className="border border-gray-100 dark:border-gray-800 rounded-xl p-3.5">
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 flex-none rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[11px] font-bold flex items-center justify-center">
                              {initialsOf(s.name || s.email)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[13px] font-bold text-gray-900 dark:text-gray-50">{s.name || s.email}</span>
                                <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${chip.cls}`}>{chip.label}</span>
                              </div>
                              <div className="text-[11.5px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                                {[s.email, s.source, timeAgo(s.created_at)].filter(Boolean).join(' · ')}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 mt-2.5 flex-wrap">
                            <button
                              type="button"
                              data-testid={`button-convert-${s.id}`}
                              disabled={busy || converted}
                              onClick={() => leadAction(s, 'promote')}
                              className="h-7 px-3 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                            >
                              {busy ? <Loader2 size={11} className="animate-spin" /> : null}
                              {converted ? 'Converted' : 'Convert to interview'}
                            </button>
                            <button
                              type="button"
                              data-testid={`button-invite-${s.id}`}
                              disabled={busy || converted}
                              onClick={() => leadAction(s, 'invite')}
                              className="h-7 px-3 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Invite
                            </button>
                            <button
                              type="button"
                              data-testid={`button-followup-${s.id}`}
                              disabled={busy || converted}
                              onClick={() => leadAction(s, 'follow-up')}
                              className="h-7 px-3 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              Follow-up
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Interview log */}
              <div className={CARD} data-testid="discovery-log">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3.5">
                  <div className={LBL}>Interview log · {ivs.length} of &ge;{MIN_INTERVIEWS} done</div>
                  <div className="flex gap-1">
                    {[['all', 'All'], ['manual', 'Manual'], ['leads', 'Brand & Pages']].map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        data-testid={`filter-log-${v}`}
                        onClick={() => setLogFilter(v)}
                        className={`h-7 px-3 rounded-full text-[11px] font-semibold ${logFilter === v ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {logRows.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center">
                    {ivs.length === 0 ? 'No interviews yet — log your first to start building evidence.' : 'No interviews match this filter.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px]">
                      <thead>
                        <tr className="text-left">
                          {['Contact', 'Hypotheses', 'Top pain', 'Source', ''].map((h) => (
                            <th key={h} className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 pb-2 pr-3">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {logRows.map((iv) => {
                          const v = iv._hyps.filter((h) => h.status === 'validated').length;
                          return (
                            <tr key={iv.id} data-testid={`interview-row-${iv.id}`} className="border-t border-gray-100 dark:border-gray-800">
                              <td className="py-2.5 pr-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-7 h-7 flex-none rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 text-[10px] font-bold flex items-center justify-center">
                                    {initialsOf(iv.interviewee_name)}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50 truncate">{iv.interviewee_name}</div>
                                    <div className="text-[10.5px] text-gray-400 dark:text-gray-500 truncate">
                                      {[iv.interviewee_role, shortDate(iv.interview_date)].filter(Boolean).join(' · ')}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 pr-3">
                                {iv._hyps.length > 0 ? (
                                  <span className={`text-[11px] font-semibold ${v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>{v} of {iv._hyps.length} validated</span>
                                ) : <span className="text-[11px] text-gray-300 dark:text-gray-600">—</span>}
                              </td>
                              <td className="py-2.5 pr-3">
                                {iv._pains[0] ? (
                                  <span className="text-[10.5px] font-semibold rounded-md px-2 py-0.5 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-100 dark:border-violet-800">{iv._pains[0]}</span>
                                ) : <span className="text-[11px] text-gray-300 dark:text-gray-600">—</span>}
                              </td>
                              <td className="py-2.5 pr-3 text-[11.5px] text-gray-500 dark:text-gray-400 whitespace-nowrap">{isFromLeads(iv) ? 'Brand & Pages' : 'Manual'}</td>
                              <td className="py-2.5 text-right">
                                {(iv.notes || '').trim() && !isFromLeads(iv) ? (
                                  <span title={iv.notes}><Quote size={13} className="text-violet-400 dark:text-violet-500 inline" /></span>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT column */}
            <div className="flex flex-col gap-5 min-w-0">
              {/* Hypothesis validation */}
              <div className={CARD} data-testid="discovery-hypotheses">
                <div className={`${LBL} mb-3.5`}>Hypothesis validation</div>
                {hypTotal === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-2 text-center">No hypotheses logged yet — attach them to interviews.</p>
                ) : (
                  <>
                    <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 mb-3">
                      <div className="bg-emerald-500" style={{ width: `${(hypValidated / hypTotal) * 100}%` }} />
                      <div className="bg-amber-400" style={{ width: `${(hypInconclusive / hypTotal) * 100}%` }} />
                      <div className="bg-red-400" style={{ width: `${(hypInvalidated / hypTotal) * 100}%` }} />
                    </div>
                    {[
                      ['Validated', hypValidated, 'bg-emerald-500'],
                      ['Inconclusive', hypInconclusive, 'bg-amber-400'],
                      ['Invalidated', hypInvalidated, 'bg-red-400'],
                    ].map(([label, n, dot]) => (
                      <div key={label} className="flex items-center gap-2 py-1">
                        <span className={`w-2 h-2 rounded-full ${dot}`} />
                        <span className="text-[12px] text-gray-600 dark:text-gray-300 flex-1">{label}</span>
                        <span className="text-[12px] font-bold text-gray-900 dark:text-gray-50">{hypTotal ? Math.round((n / hypTotal) * 100) : 0}%</span>
                      </div>
                    ))}
                    {ivs.length >= MIN_INTERVIEWS && hypValidated > 0 && (
                      <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/40 rounded-lg px-3 py-2 mt-2.5 text-[11.5px] text-emerald-800 dark:text-emerald-300">
                        Confidence: building — {ivs.length} interviews logged with validated evidence.
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Working definition — derived */}
              <div className={CARD} data-testid="discovery-icp">
                <div className={`${LBL} mb-3.5`}>ICP · working definition</div>
                {ivs.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-2 text-center">Derived from your interview log once interviews are in.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">Segment · most interviewed</div>
                      <div className="text-[13px] font-semibold text-gray-900 dark:text-gray-50 mt-0.5">
                        {topRole ? `${topRole[0]} (${topRole[1]} of ${ivs.length})` : 'Roles not recorded yet'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">Primary pain</div>
                      <div className="text-[13px] font-semibold text-gray-900 dark:text-gray-50 mt-0.5">{topPain ? topPain.title : 'No pains logged yet'}</div>
                    </div>
                    <p className="text-[10.5px] text-gray-400 dark:text-gray-500">Derived live from your logged interviews — refine it by logging more.</p>
                  </div>
                )}
              </div>

              {/* Recurring themes */}
              <div className={CARD} data-testid="discovery-themes">
                <div className={`${LBL} mb-3`}>Recurring themes</div>
                {painRows.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">Themes surface as pains repeat across interviews.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {painRows.slice(0, 6).map((p) => (
                      <span key={p.title} className="text-[11px] font-semibold rounded-md px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                        {p.title} <span className="text-gray-400 dark:text-gray-500">{p.count}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Data room */}
              <div className={CARD} data-testid="discovery-dataroom">
                <div className={`${LBL} mb-3`}>Data room · discovery evidence</div>
                {[
                  { name: 'Interview notes', meta: `${notesCount} of ${ivs.length} interviews`, ok: ivs.length > 0 && notesCount === ivs.length },
                  { name: 'Inbound lead evidence', meta: `${signups.length} submissions`, ok: signups.length > 0 },
                  { name: 'Pain groups curated', meta: `${(painData?.groups || []).length} groups`, ok: (painData?.groups || []).length > 0 },
                ].map((d) => (
                  <div key={d.name} className="flex items-center gap-2.5 py-2 border-t border-gray-100 dark:border-gray-800 first:border-t-0">
                    <FileText size={14} className={d.ok ? 'text-violet-600 dark:text-violet-400 flex-none' : 'text-gray-300 dark:text-gray-600 flex-none'} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-gray-800 dark:text-gray-100">{d.name}</div>
                      <div className="text-[10.5px] text-gray-400 dark:text-gray-500">{d.meta}</div>
                    </div>
                    <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${d.ok ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'}`}>
                      {d.ok ? 'Ready' : 'Pending'}
                    </span>
                  </div>
                ))}
                {ivs.length > 0 && notesCount < ivs.length && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/40 rounded-lg px-3 py-2 mt-2.5 text-[11px] text-amber-800 dark:text-amber-300" data-testid="dataroom-notes-warning">
                    {ivs.length - notesCount} of {ivs.length} interviews have no attached notes. Add notes to strengthen the evidence.
                  </div>
                )}
              </div>

              {/* Deck readiness */}
              <div className={CARD} data-testid="discovery-deck-readiness">
                <div className={`${LBL} mb-3`}>Deck readiness · {readyCount} of {readiness.length}</div>
                <div className="flex flex-col gap-2">
                  {readiness.map((r) => (
                    <div key={r.label} className="flex items-center gap-2.5">
                      {r.ok
                        ? <span className="w-4 h-4 flex-none rounded-full bg-emerald-500 text-white flex items-center justify-center"><Check size={10} /></span>
                        : <Circle size={15} className="text-gray-300 dark:text-gray-600 flex-none" />}
                      <span className={`text-[12px] ${r.ok ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500'}`}>{r.label}</span>
                    </div>
                  ))}
                </div>
                {deckUnlocked ? (
                  <Link
                    to="/build/deck"
                    data-testid="link-open-deck"
                    className="mt-3.5 h-9 w-full rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    Open Pitch Deck Builder <ArrowRight size={13} />
                  </Link>
                ) : (
                  <span
                    data-testid="deck-locked-note"
                    aria-disabled="true"
                    className="mt-3.5 h-9 w-full rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-xs font-semibold inline-flex items-center justify-center select-none"
                  >
                    Pitch deck unlocks in Week 2
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
