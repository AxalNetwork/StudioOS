// Spin-Out Lab "Compliance" — /spinout-lab/compliance.
//
// A Week 4 ("Incorporate & Capital") readiness dashboard: it does not own any
// record, it orchestrates the tools that do. Every category maps to a real
// WEEK_DEFS week-4 deliverable and its real milestone key, so an item ticks
// here only when the founder actually completed it in the source tool.
//
// IMPORTANT — this does NOT replace /compliance.
//
// /compliance is the platform-wide Compliance Calendar (Task #32): recurring
// post-incorporation obligations (annual report, franchise tax, registered
// agent, board meetings) with T-30/14/7/1 reminder pings fired by
// services/compliance_reminders.py, its own complianceList/Create/Update API,
// and its own FastAPI router. It sits in the investor/portfolio sidebar
// alongside Liquidity and Trust Center, and the worker's advisor deep-links
// (`/compliance?task=<id>`), the assistant nav entry and the reminder emails
// all point at it. Redirecting it here would break all of those for
// investors, partners and post-graduation founders.
//
// So this follows the precedent TOOL_INFO already sets for Market Intel —
// "Lab-facing market page …; the platform-wide investor/partner MI dashboard
// stays at /market-intel" — a Lab-facing page at /spinout-lab/compliance,
// with the platform calendar left where it is.
//
// From the design handoff (Compliance.dc.html), NOT reproduced:
//   - The Not-started/Formation-started/In-progress/One-blocker/
//     Graduation-ready switcher is DERIVED from real milestone counts, not
//     clickable. Same reasoning as the 83(b) tracker: this page states
//     whether a founder is clear for graduation and diligence, and a control
//     that repaints it "Graduation-ready" would be a false all-clear.
//   - Invented content is dropped: NovaCraft AI, the "Maya Reyes · legal ops"
//     operator, DocuSign entries, and the fabricated 24-item catalogue.
//     Categories come from WEEK_DEFS; documents from GET /legal/documents.
//   - Activity is built from real timestamps (document created_at, the 83(b)
//     tracker's mailed_at) rather than a scripted feed.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ShieldCheck, Upload } from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { reportError } from '../lib/log';
import LabBackLink from '../components/spinout/LabBackLink';
import LabPageIcon from '../components/spinout/LabPageIcon';
import { pickLabProject } from './SpinoutLabStartupPage';
import { TOOL_INFO, WEEK_DEFS, milestoneKeySet } from './SpinoutLabWorkspace';

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl';

/** Design's five scenarios, derived from real completion rather than clicked. */
const SCENARIOS = [
  { k: 'notstarted', label: 'Not started' },
  { k: 'early', label: 'Formation started' },
  { k: 'progress', label: 'In progress' },
  { k: 'blocked', label: 'One blocker' },
  { k: 'complete', label: 'Graduation-ready' },
];

export function scenarioFrom(done, total, atRisk) {
  if (total > 0 && done === total) return 'complete';
  if (done === 0) return 'notstarted';
  if (total - done === 1) return 'blocked';
  if (atRisk > 0) return 'progress';
  return done <= 2 ? 'early' : 'progress';
}

const HERO_TONE = {
  notstarted: { chip: 'Not started', wrap: 'bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-800', chipCls: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300', ring: 'border-gray-400 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900' },
  early: { chip: 'In progress', wrap: 'bg-violet-50/40 dark:bg-violet-950/20 border-violet-200 dark:border-violet-900/50', chipCls: 'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300', ring: 'border-violet-600 text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40' },
  progress: { chip: 'At risk', wrap: 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50', chipCls: 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300', ring: 'border-amber-600 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40' },
  blocked: { chip: 'Needs review', chipCls: 'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300', wrap: 'bg-violet-50/40 dark:bg-violet-950/20 border-violet-200 dark:border-violet-900/50', ring: 'border-violet-600 text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40' },
  complete: { chip: 'Graduation-ready', wrap: 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50', chipCls: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300', ring: 'border-emerald-600 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' },
};

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SpinoutLabCompliancePage() {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [project, setProject] = useState(null);
  const [tracker, setTracker] = useState(null);
  const [docs, setDocs] = useState([]);
  const [status, setStatus] = useState('loading');
  const [filter, setFilter] = useState('all'); // all | open | blocking
  const [openCats, setOpenCats] = useState({});

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [s, projects] = await Promise.all([
        spinoutLab.state().catch(() => null),
        api.listProjects().catch(() => []),
      ]);
      setState(s);
      const p = pickLabProject(projects, user);
      setProject(p);
      if (p) {
        const [tr, dl] = await Promise.all([
          api.legal83bList(p.id).catch(() => []),
          api.listDocuments(p.id).catch(() => []),
        ]);
        const list = Array.isArray(tr) ? tr : tr?.trackers || [];
        setTracker(list[0] || null);
        setDocs(Array.isArray(dl) ? dl : dl?.documents || []);
      }
      setStatus('ready');
    } catch (e) {
      reportError(e, { where: 'SpinoutLabCompliancePage.load' });
      setStatus('error');
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const doneKeys = useMemo(() => milestoneKeySet(state?.milestones), [state]);

  // Categories ARE the real Week 4 deliverables, grouped by their source tool.
  const categories = useMemo(() => {
    const week4 = WEEK_DEFS.find((w) => w.num === 4);
    const byTool = new Map();
    for (const d of week4?.deliverables || []) {
      const tool = d.tool || 'other';
      if (!byTool.has(tool)) byTool.set(tool, []);
      byTool.get(tool).push({
        label: d.label,
        keys: d.keys || [],
        done: (d.keys || []).some((k) => doneKeys.has(k)),
        optional: Boolean(d.optional),
      });
    }
    return [...byTool.entries()].map(([tool, items]) => {
      const info = TOOL_INFO[tool] || { label: tool, to: '/spinout-lab' };
      const done = items.filter((i) => i.done).length;
      return {
        key: tool, name: info.label, to: info.to, icon: info.icon,
        items, done, total: items.length,
        pct: items.length ? Math.round((done / items.length) * 100) : 0,
        status: done === items.length ? 'Complete' : done === 0 ? 'Not started' : 'In progress',
      };
    });
  }, [doneKeys]);

  const totals = useMemo(() => {
    const total = categories.reduce((a, c) => a + c.total, 0);
    const done = categories.reduce((a, c) => a + c.done, 0);
    return { total, done, open: total - done, catsDone: categories.filter((c) => c.status === 'Complete').length };
  }, [categories]);

  // The only REAL deadline in this set is the 83(b) window. Everything else is
  // milestone completion with no date attached, so no date is invented.
  const daysLeft = Number(tracker?.days_left);
  const filed83b = ['mailed', 'confirmed'].includes(String(tracker?.status || '').toLowerCase());
  const atRisk = tracker && !filed83b && Number.isFinite(daysLeft) && daysLeft <= 14 ? 1 : 0;
  const scen = scenarioFrom(totals.done, totals.total, atRisk);
  const tone = HERO_TONE[scen];
  const pct = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;

  const deadlines = useMemo(() => {
    const out = [];
    if (tracker) {
      const s = filed83b ? 'Safe' : tracker.overdue ? 'Overdue' : daysLeft <= 3 ? 'Critical' : daysLeft <= 14 ? 'Due soon' : 'Safe';
      out.push({
        title: '83(b) election',
        due: filed83b ? `Filed ${fmtDate(tracker.mailed_at)}` : `${fmtDate(tracker.deadline_date)}${Number.isFinite(daysLeft) ? ` · ${Math.abs(daysLeft)} days` : ''}`,
        state: s,
        note: filed83b ? 'Proof on record in the Lab tracker.' : 'Hard IRS deadline. No extensions available.',
      });
    } else {
      out.push({ title: '83(b) election', due: 'Opens on stock transfer', state: 'Blocked', note: 'Start a tracker on the day stock is issued.' });
    }
    out.push({
      title: 'Formation completion',
      due: doneKeys.has('incorporation_completed') ? 'Completed' : 'Not complete',
      state: doneKeys.has('incorporation_completed') ? 'Safe' : 'Blocked',
      note: doneKeys.has('incorporation_completed') ? 'Entity formation milestone recorded.' : 'Formation gates every other category.',
    });
    out.push({
      title: 'Agreement signatures',
      due: doneKeys.has('cofounder_agreement_signed') ? 'Signed' : 'Outstanding',
      state: doneKeys.has('cofounder_agreement_signed') ? 'Safe' : 'Due soon',
      note: doneKeys.has('cofounder_agreement_signed') ? 'Founder terms executed.' : 'Unsigned founder terms are a standard diligence flag.',
    });
    out.push({
      title: 'Compliance record',
      due: `${docs.length} document${docs.length === 1 ? '' : 's'} on file`,
      state: docs.length > 0 ? 'Safe' : 'Due soon',
      note: docs.length > 0 ? 'Archived and visible in diligence.' : 'No documents generated or uploaded yet.',
    });
    return out;
  }, [tracker, filed83b, daysLeft, doneKeys, docs]);

  const DL_TONE = {
    Safe: 'text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20',
    'Due soon': 'text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20',
    Critical: 'text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-950/20',
    Overdue: 'text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/50 bg-rose-50/50 dark:bg-rose-950/20',
    Blocked: 'text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40',
  };
  const DOT = { Safe: 'bg-emerald-600', 'Due soon': 'bg-amber-500', Critical: 'bg-rose-600', Overdue: 'bg-rose-600', Blocked: 'bg-gray-400' };

  // Blockers are simply the incomplete required deliverables, in week order.
  const blockers = useMemo(
    () => categories.flatMap((c) => c.items.filter((i) => !i.done && !i.optional).map((i) => ({ ...i, cat: c }))),
    [categories],
  );

  const gates = useMemo(() => {
    const grad = categories.flatMap((c) => c.items).filter((i) => !i.optional);
    const gradDone = grad.filter((i) => i.done).length;
    const invKeys = ['founder_stock_issued', 'section83b_filed', 'cofounder_agreement_signed'];
    const invItems = categories.flatMap((c) => c.items).filter((i) => i.keys.some((k) => invKeys.includes(k)));
    const invDone = invItems.filter((i) => i.done).length;
    return [
      {
        name: 'Graduation readiness', done: gradDone, total: grad.length,
        body: 'Graduation review verifies formation, equity, 83(b), and founder agreements are all executed and archived.',
        remaining: grad.filter((i) => !i.done).slice(0, 4).map((i) => i.label),
      },
      {
        name: 'Investor diligence readiness', done: invDone, total: invItems.length,
        body: 'Investors check the cap table, 83(b) proof, and founder agreements first. Close these before partner introductions.',
        remaining: invItems.filter((i) => !i.done).slice(0, 4).map((i) => i.label),
      },
    ];
  }, [categories]);

  // Activity from real timestamps only — documents and the 83(b) mailing.
  const activity = useMemo(() => {
    const rows = docs.slice(0, 8).map((d) => ({
      text: d.title || d.doc_type || 'Document',
      meta: `${(d.doc_type || 'document').replace(/_/g, ' ')} · ${fmtDate(d.created_at)}`,
      at: d.created_at,
    }));
    if (tracker?.mailed_at) {
      rows.push({ text: '83(b) election marked filed', meta: `83(b) tracker · ${fmtDate(tracker.mailed_at)}`, at: tracker.mailed_at });
    }
    return rows.filter((r) => r.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8);
  }, [docs, tracker]);

  if (status === 'loading') {
    return (
      <div className="max-w-[1200px] mx-auto px-4 py-6" data-testid="page-spinout-compliance">
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={15} className="animate-spin" /> Loading compliance…</div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6 space-y-5" data-testid="page-spinout-compliance">
      <div className="h-[3px] rounded-b-[3px] bg-violet-600 dark:bg-violet-500" aria-hidden="true" />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <LabBackLink />
          <LabPageIcon icon={ShieldCheck} />
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Compliance</h1>
              <span className="text-[10.5px] font-bold rounded-full px-2.5 py-0.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">Active</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Company formation, founder paperwork, filing deadlines, and investor-readiness requirements.
            </p>
          </div>
        </div>
      </div>

      {/* Derived state band (see file header for why it is not clickable). */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className={LBL}>State</span>
        <div className="flex gap-1.5 flex-wrap" role="status" aria-label="Compliance state">
          {SCENARIOS.map((s) => (
            <span
              key={s.k} data-testid={`chip-compliance-${s.k}`} aria-current={s.k === scen ? 'true' : undefined}
              className={`px-3 py-1 rounded-full text-[11.5px] font-semibold border ${
                s.k === scen
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                  : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-600'
              }`}
            >
              {s.label}
            </span>
          ))}
        </div>
        <div className="ml-auto flex gap-2 flex-wrap">
          <Link to="/spinout-lab/capital" data-testid="link-data-room" className="h-9 px-3.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-xs font-semibold inline-flex items-center gap-1.5">
            <Upload size={13} /> Open data room
          </Link>
        </div>
      </div>

      {!project ? (
        <div className={`${CARD} p-8 text-center`} data-testid="compliance-no-project">
          <div className="text-base font-bold text-gray-900 dark:text-gray-50">Create your company record first</div>
          <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1.5">Compliance tracks the Week 4 deliverables against your project.</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className={`border rounded-2xl p-6 ${tone.wrap}`} data-testid="card-compliance-hero">
            <div className="flex items-center justify-between gap-7 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${tone.chipCls}`}>{tone.chip}</span>
                  <span className="text-[12px] text-gray-500 dark:text-gray-400">
                    {[project?.name, state?.cohort && `Cohort ${state.cohort}`, 'Week 4 · Incorporate & Capital'].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="text-[19px] font-bold tracking-tight leading-snug text-gray-900 dark:text-gray-50 max-w-2xl">
                  {totals.done === totals.total
                    ? 'Compliance is complete. You are ready for graduation review.'
                    : totals.done === 0
                      ? 'Week 4 compliance has not started yet.'
                      : `${totals.open} of ${totals.total} compliance deliverable${totals.open === 1 ? ' is' : 's are'} still open.`}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 max-w-2xl">
                  {[
                    { k: 'Items complete', v: `${totals.done} / ${totals.total}` },
                    { k: 'Open items', v: String(totals.open) },
                    { k: 'At risk', v: String(atRisk) },
                    { k: 'Categories done', v: `${totals.catsDone} / ${categories.length}` },
                  ].map((s) => (
                    <div key={s.k} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3.5 py-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{s.k}</div>
                      <div className="text-[17px] font-bold tabular-nums mt-1 text-gray-900 dark:text-gray-50">{s.v}</div>
                    </div>
                  ))}
                </div>
                {blockers[0] && (
                  <div className="flex items-center gap-3 mt-4 px-3.5 py-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl max-w-2xl">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex-none">Next action</span>
                    <span className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50 flex-1 min-w-0">{blockers[0].label}</span>
                    <Link to={blockers[0].cat.to} className="flex-none px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[11.5px] font-semibold text-gray-600 dark:text-gray-300">
                      Open {blockers[0].cat.name}
                    </Link>
                  </div>
                )}
              </div>
              <div className="flex-none text-center">
                <div className={`w-[132px] h-[132px] rounded-full border-2 flex flex-col items-center justify-center ${tone.ring}`}>
                  <div className="text-[34px] font-bold leading-none tabular-nums tracking-tight">{pct}%</div>
                  <div className="text-[10px] font-bold uppercase tracking-widest mt-1.5 opacity-90">complete</div>
                </div>
              </div>
            </div>
          </div>

          {/* Deadlines & risk */}
          <div>
            <div className={`${LBL} mb-3`}>Deadlines &amp; risk</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {deadlines.map((d) => (
                <div key={d.title} className={`border rounded-xl p-4 ${DL_TONE[d.state]}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-[7px] h-[7px] rounded-full flex-none ${DOT[d.state]}`} />
                    <span className="text-[9.5px] font-bold uppercase tracking-wider">{d.state}</span>
                  </div>
                  <div className="text-[13px] font-semibold text-gray-900 dark:text-gray-50 leading-snug">{d.title}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 tabular-nums">{d.due}</div>
                  <div className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed mt-2">{d.note}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-5 items-start">
            <div className="flex flex-col gap-5 min-w-0">
              {/* Checklist */}
              <div>
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <div className={LBL}>Compliance checklist</div>
                  <div className="flex gap-1.5">
                    {[{ k: 'all', l: 'All' }, { k: 'open', l: 'Open only' }, { k: 'blocking', l: 'Blocking' }].map((f) => (
                      <button
                        key={f.k} type="button" onClick={() => setFilter(f.k)} data-testid={`filter-${f.k}`}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                          filter === f.k ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                            : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {f.l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  {categories.map((c) => {
                    let shown = c.items;
                    if (filter === 'open') shown = shown.filter((i) => !i.done);
                    if (filter === 'blocking') shown = shown.filter((i) => !i.done && !i.optional);
                    const open = openCats[c.key] ?? shown.some((i) => !i.done);
                    return (
                      <div key={c.key} className={`${CARD} overflow-hidden`}>
                        <button
                          type="button" onClick={() => setOpenCats((s) => ({ ...s, [c.key]: !open }))}
                          data-testid={`cat-${c.key}`}
                          className="w-full flex items-center gap-3 px-4 py-4 text-left"
                        >
                          <LabPageIcon icon={c.icon} className="!w-[30px] !h-[30px]" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2 flex-wrap">
                              <span className="text-[14px] font-bold text-gray-900 dark:text-gray-50">{c.name}</span>
                              <span className={`text-[10.5px] font-bold rounded-full px-2 py-0.5 ${
                                c.status === 'Complete' ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                                  : c.status === 'Not started' ? 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                                    : 'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300'
                              }`}
                              >
                                {c.status}
                              </span>
                            </span>
                            <span className="block text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5">
                              {c.done === c.total ? 'All items complete.' : `${c.total - c.done} remaining · source: ${c.name}`}
                            </span>
                          </span>
                          <span className="flex-none flex items-center gap-3">
                            <span className="text-[11.5px] text-gray-500 tabular-nums">{c.done} of {c.total}</span>
                            <span className="w-16 h-[5px] bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                              <span className={`block h-full ${c.done === c.total ? 'bg-emerald-600' : 'bg-violet-600'}`} style={{ width: `${c.pct}%` }} />
                            </span>
                            <span className="text-gray-400 text-[12px]">{open ? '▲' : '▼'}</span>
                          </span>
                        </button>
                        {open && shown.length > 0 && (
                          <div>
                            {shown.map((i) => (
                              <div key={i.label} className="flex items-start gap-3 px-4 py-3.5 border-t border-gray-50 dark:border-gray-800/60">
                                <span className={`flex-none w-[19px] h-[19px] rounded-md flex items-center justify-center text-[11px] font-extrabold text-white border-[1.5px] ${
                                  i.done ? 'bg-emerald-600 border-emerald-600' : 'bg-transparent border-gray-300 dark:border-gray-700'
                                }`}
                                >
                                  {i.done ? '✓' : ''}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className={`block text-[13.5px] font-semibold ${i.done ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-gray-50'}`}>
                                    {i.label}{i.optional && <span className="ml-2 text-[10.5px] font-normal text-gray-400">optional</span>}
                                  </span>
                                </span>
                                <Link to={c.to} className="flex-none px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[11.5px] font-semibold text-gray-600 dark:text-gray-300">
                                  Open
                                </Link>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* What's missing */}
              <div>
                <div className={`${LBL} mb-3`}>What&apos;s missing</div>
                {blockers.length === 0 ? (
                  <div className="bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 rounded-2xl p-5 flex items-center gap-3.5">
                    <span className="w-[34px] h-[34px] rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-extrabold flex-none">✓</span>
                    <div>
                      <div className="text-[14px] font-bold text-gray-900 dark:text-gray-50">No open blockers.</div>
                      <div className="text-[12.5px] text-gray-600 dark:text-gray-300 mt-0.5">Every Week 4 compliance deliverable is complete.</div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {blockers.slice(0, 5).map((b) => (
                      <div key={b.label} className={`${CARD} p-4 flex items-start gap-3`}>
                        <span className="flex-none w-[26px] h-[26px] rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center font-extrabold text-[13px]">!</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50 leading-snug">{b.label}</div>
                          <div className="text-[12px] text-gray-500 dark:text-gray-400 mt-1">Owned by {b.cat.name}.</div>
                        </div>
                        <Link to={b.cat.to} className="flex-none px-3 py-1.5 rounded-lg border border-violet-300 dark:border-violet-800 text-[12px] font-bold text-violet-700 dark:text-violet-300">
                          Open
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Linked tools */}
              <div>
                <div className={`${LBL} mb-3`}>Source of truth · linked tools</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {categories.map((c) => (
                    <Link key={c.key} to={c.to} className={`${CARD} p-4 block hover:border-violet-200 dark:hover:border-violet-800 transition-colors`}>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[13px] font-bold text-gray-900 dark:text-gray-50">{c.name}</span>
                        <span className={`text-[10.5px] font-bold rounded-full px-2 py-0.5 ${
                          c.status === 'Complete' ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                            : c.status === 'Not started' ? 'bg-gray-100 dark:bg-gray-800 text-gray-500'
                              : 'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300'
                        }`}
                        >
                          {c.status}
                        </span>
                      </div>
                      <div className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed">{TOOL_INFO[c.key]?.desc || ''}</div>
                      <div className="text-[11.5px] font-semibold text-violet-700 dark:text-violet-300 mt-2.5">Open →</div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {/* Right rail */}
            <div className="flex flex-col gap-5 min-w-0">
              <div>
                <div className={`${LBL} mb-3`}>Readiness gates</div>
                <div className="flex flex-col gap-3">
                  {gates.map((g) => {
                    const gp = g.total ? Math.round((g.done / g.total) * 100) : 0;
                    return (
                      <div key={g.name} className={`${CARD} p-5`}>
                        <div className="flex items-center justify-between gap-2.5 mb-3">
                          <span className="text-[13px] font-bold text-gray-900 dark:text-gray-50">{g.name}</span>
                          <span className={`text-[10.5px] font-bold rounded-full px-2 py-0.5 ${
                            gp === 100 ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                          }`}
                          >
                            {gp === 100 ? 'Ready' : gp === 0 ? 'Not ready' : 'In progress'}
                          </span>
                        </div>
                        <div className="h-[5px] bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mb-3">
                          <div className={`h-full ${gp === 100 ? 'bg-emerald-600' : 'bg-violet-600'}`} style={{ width: `${gp}%` }} />
                        </div>
                        <p className="text-[12.5px] text-gray-600 dark:text-gray-300 leading-relaxed">{g.body}</p>
                        {g.remaining.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-50 dark:border-gray-800">
                            <div className={`${LBL} mb-2`}>Remaining</div>
                            <div className="flex flex-col gap-1.5">
                              {g.remaining.map((r) => (
                                <div key={r} className="flex gap-2 text-[12px] text-gray-600 dark:text-gray-300 leading-snug">
                                  <span className="text-gray-400 flex-none">·</span><span>{r}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className={`${LBL} mb-3`}>Compliance record</div>
                <div className={`${CARD} p-4`}>
                  <div className="flex items-center justify-between gap-2.5 pb-3 border-b border-gray-50 dark:border-gray-800 mb-3">
                    <span className="text-[12px] text-gray-500 dark:text-gray-400">Documents on file</span>
                    <span className="text-[12px] font-bold tabular-nums text-gray-900 dark:text-gray-50">{docs.length}</span>
                  </div>
                  {docs.length === 0 ? (
                    <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed">
                      No documents yet. They appear here as each tool generates or you upload them.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      {docs.slice(0, 10).map((d) => (
                        <div key={d.id} className="flex items-center gap-2.5">
                          <span className="w-[26px] h-[26px] rounded-lg flex-none flex items-center justify-center text-[11px] font-extrabold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">✓</span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50 leading-tight truncate">{d.title || d.doc_type}</div>
                            <div className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-0.5">{fmtDate(d.created_at)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className={`${LBL} mb-3`}>Activity</div>
                <div className={`${CARD} p-4`}>
                  {activity.length === 0 ? (
                    <p className="text-[12px] text-gray-500 dark:text-gray-400">Nothing recorded yet.</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {activity.map((a) => (
                        <div key={`${a.text}-${a.at}`} className="flex gap-3">
                          <span className="w-2 h-2 rounded-full bg-emerald-600 flex-none mt-1.5" />
                          <div className="min-w-0">
                            <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50 leading-snug">{a.text}</div>
                            <div className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-0.5">{a.meta}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
