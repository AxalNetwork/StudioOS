// Spin-Out Lab — Revenue (Week 3 tool page).
//
// Design handoff: attached_assets/Revenue.dc_*.html (same file ships in the
// StudioOS repo under spin-out-lab-pipeline/project). The design's fabricated
// content — per-customer entry ledger, "verified revenue %", proof vault
// documents, revenue-mix confidence bars, investor-preview toggle — has NO
// backend in either runtime and is intentionally NOT reproduced. Everything
// here is live data:
//   - Revenue log: real `metrics_snapshots` (both runtimes) with source
//     badges (stripe/manual), manual logging, and deletion.
//   - Stripe sync: Worker-only POST /progress/metrics/:id/import-stripe.
//     ONLY a 404 means "not in this environment" (dev) — other failures
//     (stripe_not_connected, sync errors) are shown honestly.
//   - Traction proof: the project's structured proof fields (revenue, mrr,
//     paying_customers, first_payment_date, paid_pilot_status,
//     growth_signals), editable through the real project update route
//     (dev DTO gained Worker parity for these fields in this change).
//   - Deck-ready traction: a sentence assembled ONLY from stored fields,
//     shown only when real numbers exist.

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, DollarSign, Loader2, Lock, AlertTriangle, Plus, RefreshCw,
  Trash2, X, FileText, Gauge, Presentation, CreditCard, ClipboardEdit,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { pickLabProject } from './SpinoutLabStartupPage';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const INPUT = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-[13px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-teal-500/40';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

export const PPS_LABELS = {
  paid: 'Paid customers',
  pilot_paid: 'Paid pilot',
  pilot_signed: 'Pilot signed',
  pre_revenue: 'Pre-revenue',
};

export function fmtMoney(v) {
  const n = num(v);
  if (n === null) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 });
}

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

// Deck-ready traction sentence from REAL stored fields only. Returns null
// when there is nothing real to say.
export function tractionLine(project, latestMrr) {
  if (!project) return null;
  const parts = [];
  const rev = num(project.revenue);
  const mrr = num(latestMrr ?? project.mrr);
  const customers = num(project.paying_customers);
  if (rev > 0) parts.push(`${fmtMoney(rev)} revenue to date`);
  if (mrr > 0) parts.push(`${fmtMoney(mrr)} MRR`);
  if (customers > 0) parts.push(`${customers} paying customer${customers === 1 ? '' : 's'}`);
  if (!parts.length) return null;
  return parts.join(' · ');
}

export default function SpinoutLabRevenuePage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [state, setState] = useState(null);
  const [user, setUser] = useState(null);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [project, setProject] = useState(null);
  const [snapshots, setSnapshots] = useState(null); // [] | {failed}
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(null); // 'snapshot' | 'proof' | null
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [stripeState, setStripeState] = useState({ busy: false, unavailable: false, error: '', done: null });
  const [deleteBusy, setDeleteBusy] = useState(null);
  // Snapshot form
  const [sf, setSf] = useState({ snapshot_date: new Date().toISOString().slice(0, 10), mrr: '', active_users: '', new_users: '', notes: '' });
  // Proof form
  const [pf, setPf] = useState({ revenue: '', mrr: '', paying_customers: '', first_payment_date: '', paid_pilot_status: '', growth_signals: '' });

  const canEdit = !!(user && project && Number(user.founder_id) === Number(project.founder_id));

  const loadSnapshots = async (projectId) => {
    try {
      const res = await api.listMetricsSnapshots(projectId);
      const rows = Array.isArray(res?.snapshots) ? res.snapshots : Array.isArray(res?.items) ? res.items : [];
      setSnapshots(rows);
    } catch (e) {
      console.error('[spinout-revenue:snapshots]', e);
      setSnapshots({ failed: true });
    }
  };

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [st, me, projects] = await Promise.all([
          spinoutLab.state().catch(() => null),
          api.getMe(),
          api.listProjects().catch(() => []),
        ]);
        if (dead) return;
        setState(st);
        setUser(me);
        const proj = pickLabProject(projects, me);
        setProject(proj || null);
        if (proj) {
          setPf({
            revenue: proj.revenue ?? '',
            mrr: proj.mrr ?? '',
            paying_customers: proj.paying_customers ?? '',
            first_payment_date: proj.first_payment_date ? String(proj.first_payment_date).slice(0, 10) : '',
            paid_pilot_status: proj.paid_pilot_status || '',
            growth_signals: proj.growth_signals || '',
          });
          await loadSnapshots(proj.id);
        } else {
          setSnapshots([]);
        }
        if (!dead) setStatus('ready');
      } catch (e) {
        console.error('[spinout-revenue]', e);
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, []);

  const rows = Array.isArray(snapshots) ? snapshots : [];
  const sorted = useMemo(
    () => [...rows].sort((a, b) => String(b.snapshot_date || '').localeCompare(String(a.snapshot_date || ''))),
    [rows],
  );
  const visible = filter === 'all' ? sorted : sorted.filter((s) => (filter === 'stripe' ? s.source === 'stripe' : s.source !== 'stripe'));
  const latest = sorted[0] || null;
  const lastStripe = sorted.find((s) => s.source === 'stripe') || null;

  const trend = useMemo(() => {
    const chron = [...sorted].reverse().slice(-8);
    const max = Math.max(1, ...chron.map((s) => num(s.mrr) || 0));
    return { bars: chron, max };
  }, [sorted]);

  const refreshProject = async () => {
    const projects = await api.listProjects().catch(() => null);
    if (Array.isArray(projects)) {
      const proj = pickLabProject(projects, user);
      if (proj) setProject(proj);
    }
  };

  const saveSnapshot = async () => {
    if (busy) return;
    setBusy(true);
    setFormError('');
    try {
      const body = { snapshot_date: sf.snapshot_date };
      if (sf.mrr !== '') body.mrr = Number(sf.mrr);
      if (sf.active_users !== '') body.active_users = Number(sf.active_users);
      if (sf.new_users !== '') body.new_users = Number(sf.new_users);
      if (sf.notes.trim()) body.notes = sf.notes.trim();
      await api.createMetricsSnapshot(project.id, body);
      await loadSnapshots(project.id);
      setModal(null);
      setSf({ snapshot_date: new Date().toISOString().slice(0, 10), mrr: '', active_users: '', new_users: '', notes: '' });
    } catch (e) {
      console.error('[spinout-revenue:save-snapshot]', e);
      setFormError(e?.data?.detail?.error || e?.data?.detail || e?.message || 'Could not save the snapshot.');
    } finally {
      setBusy(false);
    }
  };

  const saveProof = async () => {
    if (busy) return;
    setBusy(true);
    setFormError('');
    try {
      const body = {
        revenue: pf.revenue === '' ? null : Number(pf.revenue),
        mrr: pf.mrr === '' ? null : Number(pf.mrr),
        paying_customers: pf.paying_customers === '' ? null : Number(pf.paying_customers),
        first_payment_date: pf.first_payment_date || null,
        paid_pilot_status: pf.paid_pilot_status || null,
        growth_signals: pf.growth_signals.trim() || null,
      };
      await api.updateProject(project.id, body);
      await refreshProject();
      // W3 deliverable — real traction proof is now on the record.
      if (body.revenue != null || body.mrr != null || body.paying_customers != null || body.paid_pilot_status || body.growth_signals) {
        markMilestone(user, 'revenue_proof_added');
      }
      setModal(null);
    } catch (e) {
      console.error('[spinout-revenue:save-proof]', e);
      setFormError(e?.data?.detail?.error || e?.data?.detail || e?.message || 'Could not save traction proof.');
    } finally {
      setBusy(false);
    }
  };

  const syncStripe = async () => {
    if (stripeState.busy || stripeState.unavailable) return;
    setStripeState((s) => ({ ...s, busy: true, error: '', done: null }));
    try {
      const res = await api.importMetricsFromStripe(project.id);
      await loadSnapshots(project.id);
      setStripeState({ busy: false, unavailable: false, error: '', done: res || {} });
      // W3 deliverable — Stripe-synced metrics count as real revenue proof.
      markMilestone(user, 'revenue_proof_added');
    } catch (e) {
      console.error('[spinout-revenue:stripe]', e);
      if (e?.status === 404) {
        // ONLY 404 = capability not present in this environment (dev).
        setStripeState({ busy: false, unavailable: true, error: '', done: null });
      } else {
        // Error code lives in different spots per runtime: the dev FastAPI
        // wrapper nests it as error.error_code / error.details.code (api.js
        // hands us the `error` object as e.data); the Worker returns a flat
        // `{error: 'stripe_not_connected'}` string.
        const code = e?.data?.error_code || e?.data?.details?.code || e?.data?.code
          || (typeof e?.data?.error === 'string' ? e.data.error : '')
          || e?.data?.detail?.error || (typeof e?.data?.detail === 'string' ? e.data.detail : '') || '';
        const msg = code === 'stripe_not_connected'
          ? 'No Stripe account connected for your user yet.'
          : code === 'stripe_no_data'
            ? 'Stripe returned no billing data to import.'
            : 'Stripe sync failed — try again later.';
        setStripeState({ busy: false, unavailable: false, error: msg, done: null });
      }
    }
  };

  const deleteSnapshot = async (id) => {
    if (deleteBusy) return;
    setDeleteBusy(id);
    try {
      await api.deleteMetricsSnapshot(id);
      await loadSnapshots(project.id);
    } catch (e) {
      console.error('[spinout-revenue:delete]', e);
    } finally {
      setDeleteBusy(null);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="revenue-loading">
        <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="revenue-error">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Couldn't load Revenue</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Reload the page to try again.</p>
      </div>
    );
  }
  const isAdmin = user?.role === 'admin';
  if (!state?.active && !isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="revenue-inactive">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Spin-Out Lab is not active</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Revenue capture is part of the Spin-Out Lab program.{' '}
          <Link to="/spinout-lab" className="text-teal-600 hover:underline">Go to the Lab</Link>
        </p>
      </div>
    );
  }
  if (!isAdmin && !(state?.unlocked_features || []).includes('revenue')) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="revenue-locked">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Revenue unlocks in Week 3</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Finish your current week's deliverables to unlock revenue capture.
        </p>
        <Link to="/spinout-lab" className="text-sm font-semibold text-teal-600 hover:underline">Back to Workspace</Link>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="revenue-no-project">
        <FileText className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">No startup record yet</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Create your startup in{' '}
          <Link to="/spinout-lab/startup" className="text-teal-600 hover:underline">Startups</Link>{' '}
          first — revenue is logged against it.
        </p>
      </div>
    );
  }

  const week = num(user?.spinout_lab_week) || state?.week || 3;
  const line = tractionLine(project, latest?.mrr);

  const kpis = [
    { key: 'revenue', label: 'Revenue to date', value: fmtMoney(project.revenue), sub: 'self-reported, lifetime' },
    { key: 'mrr', label: 'MRR', value: fmtMoney(latest?.mrr ?? project.mrr), sub: latest?.mrr != null ? `latest snapshot · ${fmtDate(latest.snapshot_date)}` : 'from traction proof' },
    { key: 'customers', label: 'Paying customers', value: num(project.paying_customers) ?? '—', sub: project.first_payment_date ? `first payment ${fmtDate(project.first_payment_date)}` : 'no first payment date yet' },
    { key: 'snapshots', label: 'Metric snapshots', value: rows.length, sub: `${rows.filter((s) => s.source === 'stripe').length} Stripe-synced` },
    { key: 'stripe', label: 'Last synced (Stripe)', value: lastStripe ? fmtDate(lastStripe.snapshot_date) : 'Never', sub: lastStripe ? 'auto-imported' : 'sync below when connected' },
  ];

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6 space-y-5" data-testid="page-spinout-revenue">
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
          <DollarSign size={16} className="text-teal-500" />
          <h1 className="text-[17px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Revenue</h1>
          <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Active</span>
        </div>
        <span className="ml-auto text-[11px] font-semibold text-gray-400 dark:text-gray-500">Unlocked · Wk {week}</span>
        {canEdit && (
          <button
            type="button"
            data-testid="button-copy-revenue-summary"
            onClick={async () => {
              const text = [
                `Revenue summary — ${project.name || 'startup'}`,
                `Traction: ${line}`,
                project.revenue != null ? `Revenue to date: ${fmtMoney(project.revenue)}` : null,
                (latest?.mrr ?? project.mrr) != null ? `MRR: ${fmtMoney(latest?.mrr ?? project.mrr)}` : null,
                num(project.paying_customers) != null ? `Paying customers: ${num(project.paying_customers)}` : null,
                project.first_payment_date ? `First payment: ${fmtDate(project.first_payment_date)}` : null,
                rows.length ? `Metric snapshots: ${rows.length} (${rows.filter((s) => s.source === 'stripe').length} Stripe-synced)` : null,
                project.growth_signals ? `Growth signals: ${project.growth_signals}` : null,
              ].filter(Boolean).join('\n');
              try {
                await navigator.clipboard.writeText(text);
                setSummaryCopied(true);
                setTimeout(() => setSummaryCopied(false), 2000);
                // W3 deliverable — an investor-ready summary was generated
                // from the real numbers on record.
                markMilestone(user, 'revenue_summary_generated');
              } catch (e) { console.error('[spinout-revenue:summary]', e); }
            }}
            className="h-8 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-900/30 text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <FileText size={13} /> {summaryCopied ? 'Copied' : 'Copy investor summary'}
          </button>
        )}
      </div>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 -mt-2">
        Capture real revenue and build investor-ready proof of traction.
      </p>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.key} className={`${CARD} !p-4`} data-testid={`kpi-${k.key}`}>
            <div className="text-[17px] font-extrabold text-gray-900 dark:text-gray-50 tabular-nums truncate">{k.value}</div>
            <div className="text-[11px] font-bold text-gray-600 dark:text-gray-300 mt-0.5">{k.label}</div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Add a revenue source */}
      <div>
        <div className={`${LBL} mb-2`}>Add a revenue source</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className={`${CARD} !p-4`} data-testid="source-stripe">
            <div className="flex items-center justify-between mb-1">
              <CreditCard size={16} className="text-teal-500" />
              {stripeState.unavailable ? (
                <span className="text-[10px] font-bold text-gray-400" data-testid="stripe-unavailable">Unavailable in this environment</span>
              ) : stripeState.done ? (
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400" data-testid="stripe-done">Synced</span>
              ) : null}
            </div>
            <div className="text-[13px] font-bold text-gray-900 dark:text-gray-50">Sync from Stripe</div>
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-2.5">
              Import MRR and paying customers from your startup's connected Stripe account. Synced snapshots are tagged automatically.
            </p>
            <button
              type="button"
              onClick={syncStripe}
              disabled={stripeState.busy || stripeState.unavailable || !canEdit}
              data-testid="button-sync-stripe"
              className="text-[11.5px] font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              {stripeState.busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync now
            </button>
            {stripeState.error && <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-2" data-testid="stripe-error">{stripeState.error}</div>}
          </div>

          <div className={`${CARD} !p-4`} data-testid="source-manual">
            <Plus size={16} className="text-teal-500 mb-1" />
            <div className="text-[13px] font-bold text-gray-900 dark:text-gray-50">Log a metrics snapshot</div>
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-2.5">
              Record MRR and user counts as of a date. Manual snapshots are marked as such until Stripe verifies them.
            </p>
            <button
              type="button"
              onClick={() => { setModal('snapshot'); setFormError(''); }}
              disabled={!canEdit}
              data-testid="button-open-snapshot"
              className="text-[11.5px] font-bold text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 rounded-lg px-3 py-1.5 hover:bg-teal-50 dark:hover:bg-teal-900/30 disabled:opacity-40"
            >
              Log snapshot
            </button>
          </div>

          <div className={`${CARD} !p-4`} data-testid="source-proof">
            <ClipboardEdit size={16} className="text-teal-500 mb-1" />
            <div className="text-[13px] font-bold text-gray-900 dark:text-gray-50">Update traction proof</div>
            <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-2.5">
              Lifetime revenue, paying customers, first payment date, and pilot status — the fields your deck and scoring read.
            </p>
            <button
              type="button"
              onClick={() => { setModal('proof'); setFormError(''); }}
              disabled={!canEdit}
              data-testid="button-open-proof"
              className="text-[11.5px] font-bold text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 rounded-lg px-3 py-1.5 hover:bg-teal-50 dark:hover:bg-teal-900/30 disabled:opacity-40"
            >
              Edit proof fields
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 items-start">
        {/* Left: log + trend */}
        <div className="space-y-4">
          <div className={CARD} data-testid="card-revenue-log">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div>
                <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">Revenue log</div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500">Metric snapshots with their source — Stripe-synced or manual.</div>
              </div>
              <div className="ml-auto flex gap-1">
                {[['all', 'All'], ['stripe', 'Stripe-synced'], ['manual', 'Manual']].map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilter(k)}
                    data-testid={`filter-${k}`}
                    className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${filter === k ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {snapshots?.failed ? (
              <div className="text-[12.5px] text-amber-600 dark:text-amber-400 py-6 text-center" data-testid="log-error">
                Couldn't load your revenue log right now.
              </div>
            ) : visible.length === 0 ? (
              <div className="text-center py-8" data-testid="log-empty">
                <DollarSign className="w-7 h-7 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <div className="text-[13px] font-bold text-gray-900 dark:text-gray-50 mb-1">
                  {filter === 'all' ? 'No revenue logged yet' : 'Nothing matches this filter'}
                </div>
                <p className="text-[11.5px] text-gray-500 dark:text-gray-400">
                  {filter === 'all' ? 'Log your first metrics snapshot above — real numbers only.' : 'Try another source filter.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className={LBL}>
                      <th className="py-1.5 pr-3 font-bold">Date</th>
                      <th className="py-1.5 pr-3 font-bold">MRR</th>
                      <th className="py-1.5 pr-3 font-bold">ARR</th>
                      <th className="py-1.5 pr-3 font-bold">Active users</th>
                      <th className="py-1.5 pr-3 font-bold">Source</th>
                      <th className="py-1.5 pr-3 font-bold">Notes</th>
                      <th className="py-1.5 font-bold" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((s) => (
                      <tr key={s.id} className="border-t border-gray-100 dark:border-gray-800" data-testid={`log-row-${s.id}`}>
                        <td className="py-2 pr-3 text-[12px] font-semibold text-gray-900 dark:text-gray-50 whitespace-nowrap">{fmtDate(s.snapshot_date)}</td>
                        <td className="py-2 pr-3 text-[12px] tabular-nums text-gray-700 dark:text-gray-200">{fmtMoney(s.mrr)}</td>
                        <td className="py-2 pr-3 text-[12px] tabular-nums text-gray-500 dark:text-gray-400">{fmtMoney(s.arr)}</td>
                        <td className="py-2 pr-3 text-[12px] tabular-nums text-gray-500 dark:text-gray-400">{num(s.active_users) ?? '—'}</td>
                        <td className="py-2 pr-3">
                          <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ${s.source === 'stripe' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                            {s.source === 'stripe' ? 'Synced · Stripe' : 'Manual'}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-[11.5px] text-gray-500 dark:text-gray-400 max-w-[160px] truncate">{s.notes || '—'}</td>
                        <td className="py-2 text-right">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => deleteSnapshot(s.id)}
                              disabled={deleteBusy === s.id}
                              data-testid={`button-delete-${s.id}`}
                              className="text-gray-300 hover:text-rose-500 dark:text-gray-600 dark:hover:text-rose-400 disabled:opacity-40"
                              title="Delete snapshot"
                            >
                              {deleteBusy === s.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={CARD} data-testid="card-trend">
            <div className={`${LBL} mb-3`}>MRR trend</div>
            {trend.bars.length < 2 ? (
              <div className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="trend-empty">
                Log at least two snapshots to see a trend.
              </div>
            ) : (
              <div className="flex items-end gap-3 h-28" data-testid="trend-bars">
                {trend.bars.map((s) => {
                  const v = num(s.mrr) || 0;
                  return (
                    <div key={s.id} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <div className="text-[9.5px] tabular-nums text-gray-400">{v ? `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}` : '—'}</div>
                      <div
                        className={`w-full max-w-[38px] rounded-t-md ${s.source === 'stripe' ? 'bg-emerald-400 dark:bg-emerald-500' : 'bg-teal-300 dark:bg-teal-600'}`}
                        style={{ height: `${Math.max(4, (v / trend.max) * 80)}px` }}
                      />
                      <div className="text-[9.5px] text-gray-400 truncate w-full text-center">
                        {new Date(s.snapshot_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {trend.bars.length >= 2 && (
              <div className="flex gap-3 mt-2 text-[10px] text-gray-400">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" /> Stripe-synced</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-teal-300 dark:bg-teal-600 inline-block" /> Manual</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: traction proof + deck-ready + feeds into */}
        <div className="space-y-4">
          <div className={CARD} data-testid="card-traction-proof">
            <div className={`${LBL} mb-3`}>Traction proof</div>
            <div className="space-y-2 text-[12px]">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Stage</span>
                {project.paid_pilot_status ? (
                  <span className="font-bold text-teal-700 dark:text-teal-300" data-testid="proof-stage">{PPS_LABELS[project.paid_pilot_status] || project.paid_pilot_status}</span>
                ) : (
                  <span className="text-gray-400" data-testid="proof-stage-empty">not set</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Revenue to date</span>
                <span className="font-bold text-gray-900 dark:text-gray-50 tabular-nums">{fmtMoney(project.revenue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Paying customers</span>
                <span className="font-bold text-gray-900 dark:text-gray-50 tabular-nums">{num(project.paying_customers) ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">First payment</span>
                <span className="font-bold text-gray-900 dark:text-gray-50">{fmtDate(project.first_payment_date)}</span>
              </div>
            </div>
            {project.growth_signals && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                <div className={`${LBL} mb-1`}>Growth signals</div>
                <p className="text-[11.5px] text-gray-600 dark:text-gray-300" data-testid="proof-growth-signals">{project.growth_signals}</p>
              </div>
            )}
          </div>

          <div
            className={`rounded-2xl p-5 ${line ? 'bg-teal-700 dark:bg-teal-800 text-white' : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700'}`}
            data-testid="card-deck-ready"
          >
            <div className={`text-[11px] font-bold uppercase tracking-wider mb-2 ${line ? 'text-teal-200' : 'text-gray-400 dark:text-gray-500'}`}>
              Deck-ready traction
            </div>
            {line ? (
              <>
                <div className="text-[14px] font-extrabold mb-3" data-testid="text-traction-line">{line}</div>
                <Link
                  to="/build/deck"
                  data-testid="link-open-deck"
                  className="inline-block text-[11.5px] font-bold bg-white dark:bg-gray-100 text-teal-800 rounded-lg px-3 py-1.5 hover:bg-teal-50"
                >
                  Open Pitch Deck Builder
                </Link>
              </>
            ) : (
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400" data-testid="deck-ready-empty">
                Nothing to put on the traction slide yet — log real revenue or update your proof fields first.
              </p>
            )}
          </div>

          <div className={CARD} data-testid="card-feeds-into">
            <div className={`${LBL} mb-3`}>Feeds into</div>
            <div className="space-y-2">
              <Link to="/build/deck" className="flex items-center gap-2 text-[12px] font-semibold text-gray-700 dark:text-gray-200 hover:text-teal-600" data-testid="feeds-deck">
                <Presentation size={13} className="text-teal-500" /> Pitch Deck Builder <span className="text-gray-400 font-normal">· traction slide</span>
              </Link>
              <Link to="/spinout-lab/scoring" className="flex items-center gap-2 text-[12px] font-semibold text-gray-700 dark:text-gray-200 hover:text-teal-600" data-testid="feeds-scoring">
                <Gauge size={13} className="text-teal-500" /> Scoring Engine <span className="text-gray-400 font-normal">· traction dimension</span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div className={`${CARD} w-full max-w-md`} onClick={(e) => e.stopPropagation()} data-testid={`modal-${modal}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">
                {modal === 'snapshot' ? 'Log a metrics snapshot' : 'Update traction proof'}
              </div>
              <button type="button" onClick={() => setModal(null)} data-testid="button-close-modal" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <X size={16} />
              </button>
            </div>

            {modal === 'snapshot' ? (
              <div className="space-y-3">
                <label className="block">
                  <span className={LBL}>Snapshot date</span>
                  <input type="date" className={INPUT} value={sf.snapshot_date} onChange={(e) => setSf({ ...sf, snapshot_date: e.target.value })} data-testid="input-snapshot-date" />
                </label>
                <label className="block">
                  <span className={LBL}>MRR (USD)</span>
                  <input type="number" min="0" className={INPUT} value={sf.mrr} onChange={(e) => setSf({ ...sf, mrr: e.target.value })} placeholder="0" data-testid="input-snapshot-mrr" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={LBL}>Active users</span>
                    <input type="number" min="0" className={INPUT} value={sf.active_users} onChange={(e) => setSf({ ...sf, active_users: e.target.value })} placeholder="—" data-testid="input-snapshot-users" />
                  </label>
                  <label className="block">
                    <span className={LBL}>New users</span>
                    <input type="number" min="0" className={INPUT} value={sf.new_users} onChange={(e) => setSf({ ...sf, new_users: e.target.value })} placeholder="—" data-testid="input-snapshot-new-users" />
                  </label>
                </div>
                <label className="block">
                  <span className={LBL}>Notes</span>
                  <input type="text" maxLength={300} className={INPUT} value={sf.notes} onChange={(e) => setSf({ ...sf, notes: e.target.value })} placeholder="e.g. first paid pilot converted" data-testid="input-snapshot-notes" />
                </label>
                <p className="text-[10.5px] text-amber-600 dark:text-amber-400">
                  Grants, investment capital, and non-operating cash are not customer revenue — they distort traction.
                </p>
                {formError && <div className="text-[11.5px] text-rose-600 dark:text-rose-400" data-testid="form-error">{String(formError)}</div>}
                <button
                  type="button"
                  onClick={saveSnapshot}
                  disabled={busy || !sf.snapshot_date}
                  data-testid="button-save-snapshot"
                  className="w-full text-[12px] font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3 py-2 disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                >
                  {busy && <Loader2 size={12} className="animate-spin" />} Save snapshot
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={LBL}>Revenue to date (USD)</span>
                    <input type="number" min="0" className={INPUT} value={pf.revenue} onChange={(e) => setPf({ ...pf, revenue: e.target.value })} placeholder="0" data-testid="input-proof-revenue" />
                  </label>
                  <label className="block">
                    <span className={LBL}>MRR (USD)</span>
                    <input type="number" min="0" className={INPUT} value={pf.mrr} onChange={(e) => setPf({ ...pf, mrr: e.target.value })} placeholder="0" data-testid="input-proof-mrr" />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className={LBL}>Paying customers</span>
                    <input type="number" min="0" className={INPUT} value={pf.paying_customers} onChange={(e) => setPf({ ...pf, paying_customers: e.target.value })} placeholder="0" data-testid="input-proof-customers" />
                  </label>
                  <label className="block">
                    <span className={LBL}>First payment date</span>
                    <input type="date" className={INPUT} value={pf.first_payment_date} onChange={(e) => setPf({ ...pf, first_payment_date: e.target.value })} data-testid="input-proof-first-payment" />
                  </label>
                </div>
                <label className="block">
                  <span className={LBL}>Stage</span>
                  <select className={INPUT} value={pf.paid_pilot_status} onChange={(e) => setPf({ ...pf, paid_pilot_status: e.target.value })} data-testid="select-proof-stage">
                    <option value="">Not set</option>
                    <option value="pre_revenue">Pre-revenue</option>
                    <option value="pilot_signed">Pilot signed</option>
                    <option value="pilot_paid">Paid pilot</option>
                    <option value="paid">Paid customers</option>
                  </select>
                </label>
                <label className="block">
                  <span className={LBL}>Growth signals</span>
                  <textarea rows={2} maxLength={500} className={INPUT} value={pf.growth_signals} onChange={(e) => setPf({ ...pf, growth_signals: e.target.value })} placeholder="e.g. 2 pilots converted from discovery interviews" data-testid="input-proof-growth" />
                </label>
                {formError && <div className="text-[11.5px] text-rose-600 dark:text-rose-400" data-testid="form-error">{String(formError)}</div>}
                <button
                  type="button"
                  onClick={saveProof}
                  disabled={busy}
                  data-testid="button-save-proof"
                  className="w-full text-[12px] font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3 py-2 disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
                >
                  {busy && <Loader2 size={12} className="animate-spin" />} Save proof fields
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
