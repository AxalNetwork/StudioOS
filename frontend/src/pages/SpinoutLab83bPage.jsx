// Spin-Out Lab "83(b) Election Tracker" — /spinout-lab/83b.
//
// Replaces the old /incorporate/83b tracker index. 83(b) is a Week 4
// ("Incorporate & Capital") deliverable and was the ONLY tool in TOOL_INFO
// pointing outside /spinout-lab/*, so the page now lives with its siblings
// and uses the Lab shell (LabBackLink → workspace, not "Back to Incorporate").
//
// Data is the real tracker from GET /legal/83b/trackers (worker
// services/section83b.ts). That DTO supplies grant_date, deadline_date,
// days_left, overdue, status, mailed_at, election_doc_id, receipt_doc_id and
// a six-item checklist. The founder's share count comes from the cap-table
// scenario, matched on taxpayer name — the same pairing SpinoutLabCapTablePage
// already loads together.
//
// The design handoff (83b-Election-Tracker.dc.html) is a scenario mock: it
// ships a clickable Safe/Due soon/Critical/Filed/Overdue/Not-required switcher
// plus invented content (NovaCraft AI, "Maya Reyes · legal ops", tracking
// number 9405 5118 9956 2201, a nine-step checklist, five proof rows).
//
// What is NOT reproduced, and why:
//   - The scenario switcher is DERIVED here, not clickable. days_left and
//     status already determine the state, so a control that repaints the page
//     as "Filed · complete" or "3 days left" would misstate a STATUTORY tax
//     deadline the founder is reading to decide when to mail. The chips render
//     as a state indicator with the live one active.
//   - Operator assist (a named legal-ops contact and follow-up dates) has no
//     data source. Omitted rather than invented.
//   - Tracking number and company-acknowledgment date are not columns on
//     section_83b_trackers; those rows read "Not recorded" instead of a
//     plausible-looking number.
//   - The checklist is the server's six real items, not the design's nine.
//
// Same rule the Customer Discovery page documents: derive honestly from real
// records, or show an explicit empty state.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Calendar,
  Check,
  Download,
  FileText,
  Loader2,
  Upload,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { reportError } from '../lib/log';
import { markMilestone } from '../lib/spinoutLabHooks';
import LabBackLink from '../components/spinout/LabBackLink';
import LabPageIcon from '../components/spinout/LabPageIcon';
import { pickLabProject } from './SpinoutLabStartupPage';

const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const CARD = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl';

/** The design's six scenarios, in the order its chip row draws them. */
const SCENARIOS = [
  { k: 'safe', label: 'Safe' },
  { k: 'due', label: 'Due soon' },
  { k: 'crit', label: 'Critical' },
  { k: 'filed', label: 'Filed' },
  { k: 'overdue', label: 'Overdue' },
  { k: 'none', label: 'Not required' },
];

/**
 * Which scenario the tracker is actually in.
 *
 * `none` is only ever reached by having no tracker at all — we never infer
 * "no election required" from equity data, because getting that wrong costs
 * the founder the election entirely.
 */
export function scenarioFor(tracker) {
  if (!tracker) return 'none';
  const status = String(tracker.status || '').toLowerCase();
  if (status === 'mailed' || status === 'confirmed') return 'filed';
  if (tracker.overdue) return 'overdue';
  const d = Number(tracker.days_left);
  if (!Number.isFinite(d)) return 'safe';
  if (d <= 3) return 'crit';
  if (d <= 14) return 'due';
  return 'safe';
}

const TONE = {
  safe: { chip: 'Safe · on track', wrap: 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50', chipCls: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300', ring: 'border-emerald-600 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40', bar: 'bg-violet-600' },
  due: { chip: 'Due soon · act this week', wrap: 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50', chipCls: 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300', ring: 'border-amber-600 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40', bar: 'bg-violet-600' },
  crit: { chip: 'Critical · file immediately', wrap: 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50', chipCls: 'bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300', ring: 'border-rose-600 text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40', bar: 'bg-amber-500' },
  filed: { chip: 'Filed · complete', wrap: 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50', chipCls: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300', ring: 'border-emerald-600 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40', bar: 'bg-emerald-600' },
  overdue: { chip: 'Overdue · escalate', wrap: 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50', chipCls: 'bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300', ring: 'border-rose-600 text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40', bar: 'bg-rose-600' },
  none: { chip: 'No tracker yet', wrap: 'bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-gray-800', chipCls: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300', ring: 'border-gray-400 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900', bar: 'bg-gray-300' },
};

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Design's six timeline steps, each backed by a real checklist key or field. */
function timelineFor(tracker, checklist) {
  const done = (k) => Boolean(checklist.find((c) => c.key === k)?.done);
  const status = String(tracker?.status || '').toLowerCase();
  const steps = [
    { label: 'Stock transferred', date: fmtDate(tracker?.grant_date), state: tracker?.grant_date ? 'done' : 'todo' },
    { label: 'Filing prepared', date: done('draft') ? 'Prepared' : '—', state: done('draft') ? 'done' : 'active' },
    {
      label: 'Filed with IRS',
      date: tracker?.mailed_at ? fmtDate(tracker.mailed_at) : `Due ${fmtDate(tracker?.deadline_date)}`,
      state: done('mail') ? 'done' : tracker?.overdue ? 'miss' : 'active',
    },
    { label: 'Personal copy stored', date: done('personal_records') ? 'Stored' : '—', state: done('personal_records') ? 'done' : 'todo' },
    { label: 'Company copy delivered', date: done('copy_company') ? 'Delivered' : '—', state: done('copy_company') ? 'done' : 'todo' },
    { label: 'Tax-return copy', date: status === 'confirmed' ? 'With next return' : '—', state: status === 'confirmed' ? 'active' : 'todo' },
  ];
  return steps;
}

const STEP_WORD = { done: 'Complete', active: 'In progress', todo: 'Pending', miss: 'Missed' };
const STEP_TONE = {
  done: 'text-emerald-700 dark:text-emerald-400',
  active: 'text-violet-700 dark:text-violet-400',
  todo: 'text-gray-400 dark:text-gray-500',
  miss: 'text-rose-700 dark:text-rose-400',
};
const STEP_DOT = {
  done: 'bg-emerald-600', active: 'bg-violet-600', todo: 'bg-gray-300 dark:bg-gray-700', miss: 'bg-rose-600',
};

/** Legal guidance per state. Generic education, not per-founder claims. */
const RISK = {
  safe: { label: 'What happens if you miss it', title: 'The 30-day deadline is strict and generally cannot be extended.', points: ['Missing it usually forfeits the ability to make the election at all.', 'Each vesting tranche would then be taxed at its value on the vest date, not at grant.', 'The postmark date controls, so mailing early is the safe play.'] },
  due: { label: 'What happens if you miss it', title: 'The 30-day deadline is strict and generally cannot be extended.', points: ['Missing it usually forfeits the ability to make the election at all.', 'Each vesting tranche would then be taxed at its value on the vest date, not at grant.', 'The postmark date controls, so mailing today still counts as timely.'] },
  crit: { label: 'Critical', title: 'Your filing window closes within days. Mail the election now.', points: ['Send by USPS Certified Mail today and keep the PS Form 3800 receipt.', 'The postmark, not the IRS receipt date, establishes timely filing.', 'Contact your program operator immediately if anything is blocking you.'] },
  filed: { label: 'On record', title: 'Filed within the window. Keep the evidence permanently.', points: ['Retain your copy indefinitely — it may be requested at a financing or exit.', 'Attach a copy to your personal tax return for the year of the grant.', 'If share details change, reissue the record rather than editing the filed copy.'] },
  overdue: { label: 'Overdue', title: 'The filing window has closed. Treat this as urgent.', points: ['If the election was mailed before the deadline, the postmark may still establish timely filing — upload proof now.', 'Without a timely election, future vesting is generally taxed as it vests, at the value on each vesting date.', 'Contact your tax advisor and program operator today to review your options.'] },
  none: { label: 'Context', title: 'The election only matters for equity that can still be forfeited.', points: ['A 30-day window opens on the date restricted stock is transferred to you.', 'Start a tracker on the grant date so the deadline is computed for you.', 'Confirm with counsel before treating an election as unnecessary.'] },
};

const CONNECTIONS = [
  { tool: 'Incorporate', to: '/spinout-lab/incorporate', rel: 'Supplies the stock transfer date that starts your 30-day window.' },
  { tool: 'Cap Table', to: '/spinout-lab/captable', rel: 'Supplies share count, grant-date value, and vesting terms.' },
  { tool: 'Co-founder Agreement', to: '/spinout-lab/cofounder-agreement', rel: 'Repurchase and vesting language must match the election.' },
  { tool: 'Capital · Data room', to: '/spinout-lab/capital', rel: 'Receives the filed election and proof as diligence artifacts.' },
];

export default function SpinoutLab83bPage() {
  const { user } = useAuth();
  const [trackers, setTrackers] = useState([]);
  const [project, setProject] = useState(null);
  const [capTable, setCapTable] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [activeId, setActiveId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [grantDate, setGrantDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const projects = await api.listProjects().catch(() => []);
      const p = pickLabProject(projects, user);
      setProject(p);
      const [tr, ct] = await Promise.all([
        api.legal83bList(p?.id).catch(() => []),
        p ? api.getCapTableByProject(p.id).catch(() => null) : Promise.resolve(null),
      ]);
      const list = Array.isArray(tr) ? tr : tr?.trackers || [];
      setTrackers(list);
      setCapTable(ct);
      setActiveId((cur) => cur ?? list[0]?.id ?? null);
      setStatus('ready');
    } catch (e) {
      reportError(e, { where: 'SpinoutLab83bPage.load' });
      setStatus('error');
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const tracker = useMemo(
    () => trackers.find((t) => t.id === activeId) || trackers[0] || null,
    [trackers, activeId],
  );
  const scen = scenarioFor(tracker);
  const tone = TONE[scen];
  const checklist = tracker?.checklist || [];
  const timeline = useMemo(() => timelineFor(tracker, checklist), [tracker, checklist]);

  // Founder share count from the cap-table scenario, matched on the taxpayer
  // name the tracker was created with. No match → "—", never a placeholder.
  const shares = useMemo(() => {
    const founders = capTable?.inputs?.founders || capTable?.founders || [];
    const want = String(tracker?.taxpayer_name || '').trim().toLowerCase();
    const hit = founders.find((f) => String(f?.name || '').trim().toLowerCase() === want);
    const n = Number(hit?.shares);
    return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('en-US')} restricted` : '—';
  }, [capTable, tracker]);

  const daysLeft = Number(tracker?.days_left);
  const countNum = scen === 'filed' ? '✓' : Number.isFinite(daysLeft) ? String(daysLeft) : '—';
  const countLabel = scen === 'filed' ? 'filed' : scen === 'overdue' ? 'days past due' : 'days left';

  // 30-day window consumed. Clamped so an overdue tracker still fills the rail.
  const pct = useMemo(() => {
    if (!tracker || !Number.isFinite(daysLeft)) return 0;
    return Math.max(0, Math.min(100, Math.round(((30 - daysLeft) / 30) * 100)));
  }, [tracker, daysLeft]);

  const proofs = useMemo(() => ([
    { name: 'Signed 83(b) election', have: tracker?.election_doc_id != null, meta: tracker?.election_doc_id != null ? 'On file' : 'Not generated' },
    { name: 'Certified-mail receipt', have: tracker?.receipt_doc_id != null, meta: tracker?.receipt_doc_id != null ? 'On file' : 'Awaiting mailing' },
    { name: 'Company acknowledgment', have: String(tracker?.status || '') === 'confirmed', meta: String(tracker?.status || '') === 'confirmed' ? 'Confirmed' : 'Pending' },
  ]), [tracker]);
  const proofHave = proofs.filter((p) => p.have).length;

  const act = async (fn, where) => {
    setBusy(true); setErr('');
    try { await fn(); await load(); } catch (e) {
      reportError(e, { where }); setErr(e?.message || 'Action failed.');
    } finally { setBusy(false); }
  };

  const markMailed = () => act(async () => {
    await api.legal83bUpdate(tracker.id, { mailed_at: new Date().toISOString(), status: 'mailed' });
    await markMilestone(user, 'section83b_filed');
  }, 'SpinoutLab83bPage.markMailed');

  const uploadReceipt = (file) => act(
    () => api.legal83bUploadReceipt(tracker.id, file),
    'SpinoutLab83bPage.uploadReceipt',
  );

  // The election statement is generated server-side when the tracker is
  // created (POST /83b/trackers writes a `section_83b` document and stores
  // its id). There is no template endpoint to link at, so this pulls the
  // real document and saves it — nothing is fabricated client-side.
  const downloadElection = async () => {
    if (!tracker?.election_doc_id) return;
    setBusy(true); setErr('');
    try {
      const doc = await api.getDocument(tracker.election_doc_id);
      const body = doc?.content ?? doc?.body ?? '';
      if (!body) throw new Error('The election document is empty.');
      const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `83b-election-${String(tracker.taxpayer_name || 'founder').replace(/\s+/g, '-').toLowerCase()}.txt`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      reportError(e, { where: 'SpinoutLab83bPage.downloadElection' });
      setErr(e?.message || 'Could not download the election.');
    } finally {
      setBusy(false);
    }
  };

  const createTracker = () => act(async () => {
    if (!project) throw new Error('Create your company record first.');
    await api.legal83bCreate({
      project_id: Number(project.id),
      taxpayer_name: (user?.name || user?.display_name || '').trim() || 'Founder',
      grant_date: grantDate,
    });
    setCreating(false);
  }, 'SpinoutLab83bPage.create');

  if (status === 'loading') {
    return (
      <div className="max-w-[1200px] mx-auto px-4 py-6" data-testid="page-spinout-83b">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={15} className="animate-spin" /> Loading your 83(b) tracker…
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6 space-y-5" data-testid="page-spinout-83b">
      {/* Header — Lab shell, back to WORKSPACE (not Incorporate). */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <LabBackLink />
          <LabPageIcon icon={FileText} />
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              
              <h1 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-gray-50">83(b) Election Tracker</h1>
              <span className="text-[10.5px] font-bold rounded-full px-2.5 py-0.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                {tracker ? 'Active' : 'Not started'}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Track your 83(b) filing deadline, documents, and proof of submission.
            </p>
          </div>
        </div>
      </div>

      {/* State band. The design ships these as a clickable scenario switcher;
          here the live state is derived and the others are inert, because
          repainting a statutory deadline on click would be misinformation. */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className={LBL}>State</span>
        <div className="flex gap-1.5 flex-wrap" role="status" aria-label="Filing state">
          {SCENARIOS.map((s) => {
            const on = s.k === scen;
            return (
              <span
                key={s.k}
                data-testid={`chip-scenario-${s.k}`}
                aria-current={on ? 'true' : undefined}
                className={`px-3 py-1 rounded-full text-[11.5px] font-semibold border ${
                  on
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                    : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-600'
                }`}
              >
                {s.label}{on && Number.isFinite(daysLeft) && scen !== 'filed' ? ` · ${Math.abs(daysLeft)}d` : ''}
              </span>
            );
          })}
        </div>
        {tracker && (
          <div className="ml-auto flex gap-2 flex-wrap">
            <label className="h-9 px-3.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer">
              <Upload size={13} /> Upload proof
              <input
                type="file" className="hidden" data-testid="input-upload-proof"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadReceipt(f); e.target.value = ''; }}
              />
            </label>
            <button
              type="button" onClick={downloadElection}
              disabled={busy || tracker.election_doc_id == null}
              title={tracker.election_doc_id == null ? 'The election is generated when the tracker is created' : undefined}
              data-testid="button-download-election"
              className="h-9 px-3.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={13} /> Download election
            </button>
            <button
              type="button" onClick={markMailed} disabled={busy || checklist.find((c) => c.key === 'mail')?.done}
              data-testid="button-mark-filed"
              className="h-9 px-4 rounded-lg bg-violet-600 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {busy && <Loader2 size={13} className="animate-spin" />} Mark as filed
            </button>
          </div>
        )}
      </div>

      {err && (
        <p role="alert" data-testid="text-83b-error" className="text-[12.5px] font-semibold text-rose-600 dark:text-rose-400">{err}</p>
      )}

      {/* No tracker yet — honest empty state, plus the real create flow. */}
      {!tracker ? (
        <div className={`${CARD} p-8 text-center`} data-testid="empty-83b">
          <Calendar size={26} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <div className="text-base font-bold text-gray-900 dark:text-gray-50">No 83(b) tracker yet</div>
          <p className="text-[13px] text-gray-500 dark:text-gray-400 mt-1.5 max-w-md mx-auto leading-relaxed">
            Start a tracker on the day stock is transferred to you. We compute the 30-day
            deadline from that date and keep the filing checklist and proof in one place.
          </p>
          {creating ? (
            <div className="mt-5 inline-flex items-end gap-2 flex-wrap justify-center">
              <div className="text-left">
                <label htmlFor="grant-date" className={`${LBL} block mb-1`}>Stock transfer date</label>
                <input
                  id="grant-date" type="date" value={grantDate} data-testid="input-grant-date"
                  onChange={(e) => setGrantDate(e.target.value)}
                  className="h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 text-[13px] text-gray-800 dark:text-gray-100"
                />
              </div>
              <button
                type="button" onClick={createTracker} disabled={busy || !project} data-testid="button-create-tracker"
                className="h-9 px-4 rounded-lg bg-violet-600 text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {busy && <Loader2 size={13} className="animate-spin" />} Create tracker
              </button>
            </div>
          ) : (
            <button
              type="button" onClick={() => setCreating(true)} data-testid="button-start-tracker"
              className="mt-5 h-9 px-4 rounded-lg bg-violet-600 text-white text-xs font-bold"
            >
              + Start a tracker
            </button>
          )}
          {!project && (
            <p className="text-[12px] text-amber-700 dark:text-amber-400 mt-3">
              Create your company record first — the tracker attaches to a project.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Hero */}
          <div className={`border rounded-2xl p-6 ${tone.wrap}`} data-testid="card-83b-hero">
            <div className="flex items-center justify-between gap-7 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${tone.chipCls}`}>{tone.chip}</span>
                  <span className="text-[12px] text-gray-500 dark:text-gray-400">
                    {[project?.name, tracker.taxpayer_name].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="text-[19px] font-bold tracking-tight leading-snug text-gray-900 dark:text-gray-50 max-w-2xl">
                  {scen === 'filed'
                    ? 'Your 83(b) election is recorded as filed.'
                    : scen === 'overdue'
                      ? 'The 30-day filing window has closed without a recorded filing.'
                      : `You have ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} remaining to file your 83(b) election.`}
                </div>
                <p className="text-[13px] text-gray-600 dark:text-gray-300 leading-relaxed mt-2 max-w-xl">
                  {scen === 'filed'
                    ? 'Keep the receipt and a personal copy permanently, and attach a copy to your next personal tax return.'
                    : scen === 'overdue'
                      ? 'If you mailed the election before the deadline, upload the receipt now — the postmark may still establish timely filing. Otherwise contact counsel today.'
                      : 'Mail the election to the IRS by certified mail, then upload the receipt here. The postmark date is what establishes timely filing.'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5 max-w-xl">
                  {[
                    { k: 'Stock transferred', v: fmtDate(tracker.grant_date) },
                    { k: 'Filing deadline', v: fmtDate(tracker.deadline_date) },
                    { k: 'Shares', v: shares },
                  ].map((f) => (
                    <div key={f.k} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-3.5 py-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{f.k}</div>
                      <div className="text-[14.5px] font-semibold tabular-nums mt-1 text-gray-900 dark:text-gray-50">{f.v}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-none text-center">
                <div className={`w-[132px] h-[132px] rounded-full border-2 flex flex-col items-center justify-center ${tone.ring}`}>
                  <div className="text-[40px] font-bold leading-none tabular-nums tracking-tight">{countNum}</div>
                  <div className="text-[10.5px] font-bold uppercase tracking-widest mt-1.5 opacity-90">{countLabel}</div>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 max-w-[170px] leading-relaxed mx-auto">
                  Deadline {fmtDate(tracker.deadline_date)}. Mail early — the postmark date governs.
                </p>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div>
            <div className={`${LBL} mb-3`}>Filing timeline · 30-day window</div>
            <div className={`${CARD} p-5`}>
              <div className="relative h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full mb-1">
                <div className={`absolute left-0 top-0 bottom-0 rounded-full ${tone.bar}`} style={{ width: `${pct}%` }} />
                <div className="absolute right-0 -top-[5px] w-0.5 h-4 bg-rose-600 rounded" />
              </div>
              <div className="flex justify-between text-[10.5px] text-gray-400 dark:text-gray-500 mb-5">
                <span>Day 0 · stock transferred</span>
                <span className="text-rose-700 dark:text-rose-400 font-semibold">Day 30 · IRS deadline</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {timeline.map((s) => (
                  <div
                    key={s.label}
                    className={`p-3.5 rounded-xl border ${
                      s.state === 'active' ? 'border-violet-200 dark:border-violet-900/60 bg-violet-50/60 dark:bg-violet-950/20'
                        : s.state === 'miss' ? 'border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20'
                          : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`w-4 h-4 rounded-full flex-none flex items-center justify-center text-white text-[9.5px] font-extrabold ${STEP_DOT[s.state]}`}>
                        {s.state === 'done' ? '✓' : s.state === 'miss' ? '!' : ''}
                      </span>
                      <span className={`text-[9.5px] font-bold uppercase tracking-wider ${STEP_TONE[s.state]}`}>{STEP_WORD[s.state]}</span>
                    </div>
                    <div className="text-[12.5px] font-semibold leading-snug text-gray-900 dark:text-gray-50">{s.label}</div>
                    <div className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-1 tabular-nums">{s.date}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-5 items-start">
            <div className="flex flex-col gap-5 min-w-0">
              {/* Checklist — the server's six real items. */}
              <div>
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <div className={LBL}>Filing checklist</div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[11.5px] text-gray-500 dark:text-gray-400 tabular-nums">
                      {checklist.filter((c) => c.done).length} of {checklist.length} complete
                    </span>
                    <div className="w-[90px] h-[5px] bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-600"
                        style={{ width: `${checklist.length ? Math.round((checklist.filter((c) => c.done).length / checklist.length) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className={`${CARD} overflow-hidden`}>
                  {checklist.map((c) => (
                    <div key={c.key} className="flex items-start gap-3 px-4 py-3.5 border-b border-gray-50 dark:border-gray-800/60 last:border-0">
                      <span className={`flex-none w-[19px] h-[19px] rounded-md flex items-center justify-center text-[11px] font-extrabold text-white border-[1.5px] ${
                        c.done ? 'bg-emerald-600 border-emerald-600' : 'bg-transparent border-gray-300 dark:border-gray-700'
                      }`}
                      >
                        {c.done ? '✓' : ''}
                      </span>
                      <div className={`text-[13.5px] font-semibold ${c.done ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-900 dark:text-gray-50'}`}>
                        {c.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Submission record. Fields with no column read "Not recorded". */}
              <div>
                <div className={`${LBL} mb-3`}>Filing method &amp; submission record</div>
                <div className={`${CARD} p-5`}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      { k: 'Submitted', v: tracker.mailed_at ? fmtDate(tracker.mailed_at) : 'Not sent' },
                      { k: 'Proof uploaded', v: tracker.receipt_doc_id != null ? 'Yes' : 'Pending' },
                      { k: 'Company acknowledged', v: String(tracker.status) === 'confirmed' ? 'Confirmed' : 'Pending' },
                      { k: 'Tracking number', v: 'Not recorded' },
                    ].map((m) => (
                      <div key={m.k} className="flex items-center justify-between gap-2.5 px-3.5 py-3 bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 rounded-xl">
                        <span className="text-[11.5px] text-gray-500 dark:text-gray-400">{m.k}</span>
                        <span className="text-[11.5px] font-semibold tabular-nums text-gray-900 dark:text-gray-50">{m.v}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed mt-3.5">
                    Certified mail with return receipt gives you a dated postmark — the strongest evidence of timely filing.
                  </p>
                </div>
              </div>

              {/* IRS mailing steps — server copy, kept in lockstep with FastAPI. */}
              {Array.isArray(tracker.irs_mailing_steps) && tracker.irs_mailing_steps.length > 0 && (
                <div>
                  <div className={`${LBL} mb-3`}>How to mail it</div>
                  <ol className={`${CARD} p-5 list-decimal pl-9 space-y-2`}>
                    {tracker.irs_mailing_steps.map((s) => (
                      <li key={s} className="text-[12.5px] text-gray-600 dark:text-gray-300 leading-relaxed">{s}</li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Risk */}
              <div className={`border rounded-2xl p-5 ${tone.wrap}`}>
                <div className="flex items-center gap-2 mb-2.5">
                  <AlertCircle size={16} className={STEP_TONE[scen === 'filed' ? 'done' : scen === 'overdue' || scen === 'crit' ? 'miss' : 'active']} />
                  <div className={`text-[11px] font-bold uppercase tracking-wider ${STEP_TONE[scen === 'filed' ? 'done' : scen === 'overdue' || scen === 'crit' ? 'miss' : 'active']}`}>
                    {RISK[scen].label}
                  </div>
                </div>
                <div className="text-[13px] font-semibold leading-snug text-gray-900 dark:text-gray-50">{RISK[scen].title}</div>
                <div className="flex flex-col gap-1.5 mt-2.5">
                  {RISK[scen].points.map((p) => (
                    <div key={p} className="flex gap-2 text-[12.5px] text-gray-600 dark:text-gray-300 leading-relaxed">
                      <span className="flex-none text-gray-400">·</span><span>{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right rail */}
            <div className="flex flex-col gap-5 min-w-0">
              <div>
                <div className={`${LBL} mb-3`}>Compliance proof</div>
                <div className={`${CARD} p-4`}>
                  <div className="flex items-center justify-between gap-2.5 pb-3 border-b border-gray-50 dark:border-gray-800 mb-3">
                    <span className="text-[12px] text-gray-500 dark:text-gray-400">Evidence coverage</span>
                    <span className={`text-[12px] font-bold tabular-nums ${proofHave === proofs.length ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                      {proofHave} of {proofs.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {proofs.map((p) => (
                      <div key={p.name} className="flex items-center gap-2.5">
                        <span className={`w-[26px] h-[26px] rounded-lg flex-none flex items-center justify-center text-[11px] font-extrabold ${
                          p.have ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                        }`}
                        >
                          {p.have ? <Check size={12} /> : '·'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-50 leading-tight">{p.name}</div>
                          <div className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-0.5">{p.meta}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div className={`${LBL} mb-3`}>Connected workflow</div>
                <div className={`${CARD} p-4`}>
                  <div className="flex flex-col gap-3">
                    {CONNECTIONS.map((c) => (
                      <div key={c.tool} className="flex items-start gap-2.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-600 mt-1.5 flex-none" />
                        <div className="min-w-0">
                          <Link to={c.to} className="text-[12.5px] font-semibold text-violet-700 dark:text-violet-300">{c.tool}</Link>
                          <div className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed mt-0.5">{c.rel}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-4 pt-3 border-t border-gray-50 dark:border-gray-800 text-[11.5px] text-gray-600 dark:text-gray-300 leading-relaxed">
                    {scen === 'filed'
                      ? 'Week 4 compliance deliverable complete.'
                      : 'Completing this tracker clears “File 83(b) election” in your Week 4 deliverables.'}
                  </p>
                </div>
              </div>

              {trackers.length > 1 && (
                <div>
                  <div className={`${LBL} mb-3`}>Other founders</div>
                  <div className={`${CARD} p-2`}>
                    {trackers.map((t) => (
                      <button
                        key={t.id} type="button" onClick={() => setActiveId(t.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-[12.5px] font-semibold ${
                          t.id === tracker.id ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300' : 'text-gray-600 dark:text-gray-300'
                        }`}
                      >
                        {t.taxpayer_name}
                        <span className="ml-2 text-[11px] font-normal text-gray-400">{fmtDate(t.deadline_date)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
