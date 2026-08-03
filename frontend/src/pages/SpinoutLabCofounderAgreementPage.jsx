// Spin-Out Lab — Co-founder Agreement (Week 4 tool page).
//
// Design handoff: attached_assets/Co-founder_Agreement.dc_*.html (same file in
// the StudioOS repo under spin-out-lab-pipeline/project). Mapping to REAL
// surfaces only:
//   - Clause-by-clause builder: every editable clause is a real input of the
//     dev generator POST /legal/cofounder-agreement (equity, vesting +
//     acceleration, IP exclusions, roles/decisions, commitment,
//     confidentiality years, unanimous matters, governing law, dispute
//     resolution). Template-fixed clauses (departure & repurchase, 83(b)
//     section) are shown read-only and labeled "template default".
//   - "From Cap Table" prefill is real: founder names + relative split come
//     from the project's saved cap-table scenario.
//   - Existing agreements: GET /legal/documents (parity in both runtimes,
//     template_name === 'cofounder_agreement') with their REAL status
//     (generated/signed). Execution happens in Legal & Capital — linked, not
//     faked here.
//   - Omitted (no backend): share/export/copy-link/investor-preview,
//     plain-English toggle, accept/needs-review clause workflow states,
//     signature gating console, solo-founder declaration (the generator
//     requires 2+ founders — the page says so honestly).
//   - The generator is dev-only (no Worker route). The page catches the
//     404/405 at generate time and shows an environment banner; detection of
//     existing documents works everywhere.

import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, FileSignature, Loader2, Lock, AlertTriangle, FileText, Plus, X,
  CheckCircle2, ExternalLink, Sparkles, ScrollText, Users,
} from 'lucide-react';
import { api, spinoutLab } from '../lib/api';
import { markMilestone } from '../lib/spinoutLabHooks';
import { pickLabProject } from './SpinoutLabStartupPage';

const CARD = 'rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5';
const LBL = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500';
const INPUT = 'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-[12.5px] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500/40';
const CRIT = <span className="text-[9px] font-extrabold uppercase tracking-wider text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/40 rounded px-1.5 py-0.5">Critical</span>;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const DEFAULT_UNANIMOUS = [
  'Sale or merger of the Company',
  'Issuance of new equity above 10% dilution',
  'Removal of a founder',
  'Material change to this Agreement',
];

const ACCELERATION = [
  { v: 'none', label: 'None', desc: 'No acceleration on a change of control.' },
  { v: 'single_trigger', label: 'Single-trigger', desc: '100% vests on a change of control.' },
  { v: 'double_trigger', label: 'Double-trigger', desc: 'Vests only if terminated without cause within 12 months of a change of control.' },
];

const DISPUTE = [
  { v: 'Mediation followed by binding arbitration.', label: 'Mediation first', desc: 'Founders must attempt non-binding mediation before arbitration — preserves the relationship and is faster to invoke.' },
  { v: 'Binding arbitration.', label: 'Binding arbitration', desc: 'Disputes go straight to binding arbitration at the venue below.' },
];

/** Relative founder split from a cap-table scenario's founder shares. */
export function capTableSplit(scenarioInputs) {
  const founders = Array.isArray(scenarioInputs?.founders) ? scenarioInputs.founders.filter((f) => f?.name && num(f.shares) > 0) : [];
  const total = founders.reduce((a, f) => a + Number(f.shares), 0);
  if (!founders.length || total <= 0) return [];
  return founders.map((f) => ({ name: String(f.name), equity_pct: Math.round((Number(f.shares) / total) * 10000) / 100 }));
}

function SourceTag({ children }) {
  return <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 shrink-0">{children}</span>;
}

function Clause({ title, critical, source, children, testid }) {
  return (
    <div className="border-t border-gray-100 dark:border-gray-800 py-4 first:border-t-0 first:pt-0" data-testid={testid}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[12.5px] font-bold text-gray-900 dark:text-gray-50">{title}</span>
        {critical && CRIT}
        {source && <SourceTag>{source}</SourceTag>}
      </div>
      {children}
    </div>
  );
}

export default function SpinoutLabCofounderAgreementPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [state, setState] = useState(null);
  const [user, setUser] = useState(null);
  const [project, setProject] = useState(null);
  const [docs, setDocs] = useState([]); // existing cofounder_agreement documents
  const [fromCapTable, setFromCapTable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [envUnavailable, setEnvUnavailable] = useState(false);
  const [generated, setGenerated] = useState(null); // last generation result
  const [showBuilder, setShowBuilder] = useState(false);

  // Builder state — mirrors the generator's request model.
  const [companyName, setCompanyName] = useState('');
  const [founders, setFounders] = useState([]);
  const [vestingYears, setVestingYears] = useState(4);
  const [cliffMonths, setCliffMonths] = useState(12);
  const [cliffPct, setCliffPct] = useState(25);
  const [acceleration, setAcceleration] = useState('single_trigger');
  const [ipExclusions, setIpExclusions] = useState('');
  const [decisionDayToDay, setDecisionDayToDay] = useState('the CEO');
  const [decisionThreshold, setDecisionThreshold] = useState('majority');
  const [unanimousMatters, setUnanimousMatters] = useState([...DEFAULT_UNANIMOUS]);
  const [deadlock, setDeadlock] = useState(DISPUTE[0].v);
  const [commitment, setCommitment] = useState('full-time');
  const [confidentialityYears, setConfidentialityYears] = useState(3);
  const [governingLaw, setGoverningLaw] = useState('Delaware, USA');
  const [arbitrationVenue, setArbitrationVenue] = useState('Wilmington, Delaware');

  const canEdit = !!(user && project && Number(user.founder_id) === Number(project.founder_id));

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
          setCompanyName(proj.name || '');
          const [docRes, capRes] = await Promise.allSettled([
            api.listDocuments(proj.id),
            api.getCapTableByProject(proj.id),
          ]);
          if (dead) return;
          const all = docRes.status === 'fulfilled' ? (Array.isArray(docRes.value) ? docRes.value : []) : [];
          const mine = all.filter((d) => d.template_name === 'cofounder_agreement');
          setDocs(mine);
          setShowBuilder(mine.length === 0);
          // Real prefill: relative founder split from the saved cap table.
          const split = capRes.status === 'fulfilled' ? capTableSplit(capRes.value?.scenario?.inputs) : [];
          if (split.length) {
            setFounders(split.map((f, i) => ({ name: f.name, email: '', role: i === 0 ? 'CEO' : i === 1 ? 'CTO' : '', equity_pct: f.equity_pct, start_date: '' })));
            setFromCapTable(true);
          } else {
            setFounders([
              { name: '', email: '', role: 'CEO', equity_pct: 50, start_date: '' },
              { name: '', email: '', role: 'CTO', equity_pct: 50, start_date: '' },
            ]);
          }
        }
        if (!dead) setStatus('ready');
      } catch (e) {
        console.error('[spinout-cofounder]', e);
        if (!dead) setStatus('error');
      }
    })();
    return () => { dead = true; };
  }, []);

  const totalEquity = useMemo(() => founders.reduce((a, f) => a + (Number(f.equity_pct) || 0), 0), [founders]);
  const namedFounders = founders.filter((f) => f.name.trim());
  const canGenerate = canEdit && companyName.trim() && namedFounders.length >= 2 && founders.every((f) => f.name.trim()) && totalEquity <= 100.001;

  const updateFounder = (i, patch) => setFounders(founders.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const generate = async () => {
    if (busy || !canGenerate) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.legalCofounderAgreement({
        project_id: project.id,
        company_name: companyName.trim(),
        founders: founders.map((f) => ({
          name: f.name.trim(),
          email: f.email.trim() || null,
          role: f.role.trim() || null,
          equity_pct: Number(f.equity_pct) || 0,
          start_date: f.start_date || null,
        })),
        vesting_years: Number(vestingYears) || 4,
        cliff_months: Number(cliffMonths) || 0,
        cliff_pct: Number(cliffPct) || 0,
        acceleration,
        ip_exclusions: ipExclusions.trim() || null,
        decision_day_to_day: decisionDayToDay,
        decision_threshold: decisionThreshold,
        unanimous_matters: unanimousMatters.filter((m) => m.trim()),
        deadlock_clause: deadlock,
        commitment_level: commitment,
        confidentiality_years: Number(confidentialityYears) || 3,
        governing_law: governingLaw,
        arbitration_venue: arbitrationVenue,
      });
      setGenerated(r?.document || r);
      setShowBuilder(false);
      try {
        const all = await api.listDocuments(project.id);
        setDocs((Array.isArray(all) ? all : []).filter((d) => d.template_name === 'cofounder_agreement'));
      } catch { /* list refresh is best-effort */ }
    } catch (e) {
      console.error('[spinout-cofounder:generate]', e);
      if (e?.status === 404 || e?.status === 405) setEnvUnavailable(true);
      else setError(e?.data?.detail || e?.message || 'Could not generate the agreement.');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="cofounder-loading">
        <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="cofounder-error">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Couldn't load the Co-founder Agreement</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">Reload the page to try again.</p>
      </div>
    );
  }
  const isAdmin = user?.role === 'admin';
  if (!state?.active && !isAdmin) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="cofounder-inactive">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Spin-Out Lab is not active</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The Co-founder Agreement workspace is part of the Spin-Out Lab program.{' '}
          <Link to="/spinout-lab" className="text-violet-600 hover:underline">Go to the Lab</Link>
        </p>
      </div>
    );
  }
  if (!isAdmin && !(state?.unlocked_features || []).includes('cofounder-agreement')) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="cofounder-locked">
        <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">Co-founder Agreement unlocks in Week 4</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Finish your current week's deliverables to unlock founder legal paperwork.
        </p>
        <Link to="/spinout-lab" className="text-sm font-semibold text-violet-600 hover:underline">Back to Workspace</Link>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center" data-testid="cofounder-no-project">
        <FileText className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50 mb-1">No startup record yet</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Create your startup in{' '}
          <Link to="/spinout-lab/startup" className="text-violet-600 hover:underline">Startups</Link>{' '}
          first — the agreement belongs to it.
        </p>
      </div>
    );
  }

  const week = num(user?.spinout_lab_week) || state?.week || 4;
  const latest = docs[0] || null;

  // W4 deliverable — fires only when a cofounder agreement doc is actually
  // signed (signatures happen in Legal & Capital; this page observes status).
  useEffect(() => {
    if (docs.some((d) => String(d.status || '').toLowerCase() === 'signed')) {
      markMilestone(user, 'cofounder_agreement_signed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, user?.id]);

  return (
    <div className="max-w-[1100px] mx-auto px-4 py-6 space-y-5" data-testid="page-spinout-cofounder">
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
          <FileSignature size={16} className="text-violet-500" />
          <h1 className="text-[17px] font-extrabold tracking-tight text-gray-900 dark:text-gray-50">Co-founder Agreement</h1>
          <span className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Active</span>
        </div>
        <span className="ml-auto text-[11px] font-semibold text-gray-400 dark:text-gray-500">Unlocked · Wk {week}</span>
      </div>
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400 -mt-2">
        Draft and generate the founding team agreement — equity, vesting, IP, roles, and departure — as a real legal document on your startup.
      </p>

      {envUnavailable && (
        <div className={`${CARD} !p-3 flex items-center gap-3`} data-testid="banner-env-unavailable">
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
          <p className="text-[12px] text-gray-600 dark:text-gray-300">
            Agreement generation isn't available in this environment. Your existing documents above are unaffected.
          </p>
        </div>
      )}

      {/* Generated success */}
      {generated && (
        <div className={`${CARD} flex items-center gap-3`} data-testid="card-generated">
          <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
            <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-300" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold text-gray-900 dark:text-gray-50">{generated.title || 'Agreement generated'}</div>
            <div className="text-[11px] text-gray-400">Stored in your startup's legal documents — signatures happen there.</div>
          </div>
          <Link to="/legal-capital" className="text-[11.5px] font-bold text-violet-600 hover:underline shrink-0 inline-flex items-center gap-1">
            Open in Legal & Capital <ExternalLink size={10} />
          </Link>
        </div>
      )}

      {/* Existing agreements — real documents with real status */}
      {docs.length > 0 && (
        <div className={CARD} data-testid="card-existing">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">Execution status</div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500">Generated versions of this agreement and where they stand</div>
            </div>
            <Link to="/legal-capital" className="text-[11.5px] font-bold text-violet-600 hover:underline inline-flex items-center gap-1">
              Sign in Legal & Capital <ExternalLink size={10} />
            </Link>
          </div>
          <div className="space-y-2">
            {docs.map((d, i) => {
              const signed = String(d.status || '').toLowerCase() === 'signed';
              return (
                <div key={d.id || i} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 dark:border-gray-800 px-3 py-2.5" data-testid={`doc-${i}`}>
                  <ScrollText size={14} className="text-gray-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-bold text-gray-900 dark:text-gray-50 truncate">{d.title}</div>
                    <div className="text-[10.5px] text-gray-400">
                      {fmtDate(d.created_at)}
                      {signed && d.signed_by ? ` · signed by ${d.signed_by}` : ''}
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ${signed ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`} data-testid={`doc-status-${i}`}>
                    {signed ? 'Signed' : 'Awaiting signature'}
                  </span>
                </div>
              );
            })}
          </div>
          {!showBuilder && canEdit && (
            <button type="button" onClick={() => setShowBuilder(true)} data-testid="button-new-version" className="mt-3 text-[11.5px] font-bold text-violet-600 hover:underline inline-flex items-center gap-1">
              <Plus size={11} /> Draft a new version
            </button>
          )}
        </div>
      )}

      {/* Builder */}
      {showBuilder && (
        <>
          {/* Critical terms snapshot — live from the builder inputs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="snapshot">
            <div className={`${CARD} !p-3.5`}>
              <div className={LBL}>Equity split</div>
              <div className="text-[14px] font-extrabold tabular-nums text-gray-900 dark:text-gray-50 mt-0.5" data-testid="snap-equity">
                {namedFounders.length >= 2 ? namedFounders.map((f) => Number(f.equity_pct).toLocaleString(undefined, { maximumFractionDigits: 1 })).join(' / ') : '—'}
              </div>
              <div className="text-[10px] text-gray-400">{fromCapTable ? 'from Cap Table' : 'manual'}</div>
            </div>
            <div className={`${CARD} !p-3.5`}>
              <div className={LBL}>Vesting</div>
              <div className="text-[14px] font-extrabold tabular-nums text-gray-900 dark:text-gray-50 mt-0.5" data-testid="snap-vesting">{vestingYears}yr / {cliffMonths}mo cliff</div>
              <div className="text-[10px] text-gray-400">{ACCELERATION.find((a) => a.v === acceleration)?.label} acceleration</div>
            </div>
            <div className={`${CARD} !p-3.5`}>
              <div className={LBL}>Governing law</div>
              <div className="text-[14px] font-extrabold text-gray-900 dark:text-gray-50 mt-0.5 truncate" data-testid="snap-law">{governingLaw || '—'}</div>
              <div className="text-[10px] text-gray-400">arbitration: {arbitrationVenue || '—'}</div>
            </div>
            <div className={`${CARD} !p-3.5`}>
              <div className={LBL}>Founders</div>
              <div className="text-[14px] font-extrabold tabular-nums text-gray-900 dark:text-gray-50 mt-0.5" data-testid="snap-founders">{namedFounders.length}</div>
              <div className="text-[10px] text-gray-400">{namedFounders.length < 2 ? 'agreement needs 2+' : `equity total ${totalEquity.toFixed(1)}%`}</div>
            </div>
          </div>

          {namedFounders.length < 2 && (
            <div className={`${CARD} !p-3 flex items-center gap-3`} data-testid="banner-solo">
              <Users size={14} className="text-violet-500 shrink-0" />
              <p className="text-[12px] text-gray-600 dark:text-gray-300 flex-1">
                A co-founder agreement needs at least two named founders — there's no solo declaration document.
                Still searching? Use <Link to="/cofounder" className="text-violet-600 hover:underline">Co-founder Match</Link>.
              </p>
            </div>
          )}

          <div className={CARD} data-testid="card-builder">
            <div className="mb-4">
              <div className="text-[13.5px] font-bold text-gray-900 dark:text-gray-50">Clause-by-clause builder</div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500">
                Prefilled from your Cap Table where possible — every clause below is written into the generated document.
              </div>
            </div>

            <Clause title="Company" testid="clause-company">
              <input type="text" className={`${INPUT} max-w-sm`} value={companyName} onChange={(e) => setCompanyName(e.target.value)} disabled={!canEdit} placeholder="e.g. NovaCraft AI, Inc." data-testid="input-company" />
            </Clause>

            <Clause title="Equity split" critical source={fromCapTable ? 'from Cap Table' : 'manual entry'} testid="clause-equity">
              <div className="space-y-2">
                {founders.map((f, i) => (
                  <div key={i} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-center" data-testid={`founder-row-${i}`}>
                    <input type="text" className={`${INPUT} col-span-2 md:col-span-3`} value={f.name} onChange={(e) => updateFounder(i, { name: e.target.value })} disabled={!canEdit} placeholder="Full name" data-testid={`input-founder-name-${i}`} />
                    <input type="email" className={`${INPUT} col-span-2 md:col-span-3`} value={f.email} onChange={(e) => updateFounder(i, { email: e.target.value })} disabled={!canEdit} placeholder="Email (optional)" />
                    <input type="text" className={`${INPUT} col-span-1 md:col-span-2`} value={f.role} onChange={(e) => updateFounder(i, { role: e.target.value })} disabled={!canEdit} placeholder="Role" data-testid={`input-founder-role-${i}`} />
                    <div className="col-span-1 md:col-span-2 flex items-center gap-1">
                      <input type="number" min="0" max="100" step="0.1" className={`${INPUT} text-right`} value={f.equity_pct} onChange={(e) => updateFounder(i, { equity_pct: e.target.value })} disabled={!canEdit} data-testid={`input-founder-equity-${i}`} />
                      <span className="text-[11px] text-gray-400">%</span>
                    </div>
                    <div className="col-span-2 md:col-span-2 flex items-center gap-2">
                      <input type="date" className={`${INPUT} !text-[11px]`} value={f.start_date} onChange={(e) => updateFounder(i, { start_date: e.target.value })} disabled={!canEdit} />
                      {canEdit && founders.length > 1 && (
                        <button type="button" onClick={() => setFounders(founders.filter((_, fi) => fi !== i))} className="text-gray-300 hover:text-rose-500 shrink-0" aria-label="Remove founder" data-testid={`button-remove-founder-${i}`}>
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-2">
                {canEdit && (
                  <button type="button" onClick={() => setFounders([...founders, { name: '', email: '', role: '', equity_pct: 0, start_date: '' }])} data-testid="button-add-founder" className="text-[11.5px] font-bold text-violet-600 hover:underline inline-flex items-center gap-1">
                    <Plus size={11} /> Add founder
                  </button>
                )}
                <span className={`text-[11px] font-semibold ${totalEquity > 100.001 ? 'text-rose-600' : 'text-gray-400'}`} data-testid="text-equity-total">
                  Total {totalEquity.toFixed(2)}%{totalEquity > 100.001 ? ' — must be ≤ 100%' : ''}
                </span>
              </div>
            </Clause>

            <Clause title="Vesting schedule" critical source="written into §2" testid="clause-vesting">
              <div className="flex flex-wrap items-end gap-4">
                {[
                  { label: 'Years', val: vestingYears, set: setVestingYears, min: 1, max: 10 },
                  { label: 'Cliff (months)', val: cliffMonths, set: setCliffMonths, min: 0, max: 48 },
                  { label: 'Cliff vest %', val: cliffPct, set: setCliffPct, min: 0, max: 100 },
                ].map((f) => (
                  <label key={f.label} className="block">
                    <span className={LBL}>{f.label}</span>
                    <input type="number" min={f.min} max={f.max} className={`${INPUT} !w-24 text-right`} value={f.val} onChange={(e) => f.set(e.target.value)} disabled={!canEdit} data-testid={`input-${f.label.replace(/[^a-z]/gi, '').toLowerCase()}`} />
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
                {ACCELERATION.map((o) => (
                  <button key={o.v} type="button" onClick={() => canEdit && setAcceleration(o.v)} data-testid={`accel-${o.v}`}
                    className={`text-left p-2.5 rounded-xl border-2 transition ${acceleration === o.v ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20' : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'}`}>
                    <div className="text-[12px] font-bold text-gray-900 dark:text-gray-50">{o.label}</div>
                    <div className="text-[10.5px] text-gray-500 dark:text-gray-400 mt-0.5">{o.desc}</div>
                  </button>
                ))}
              </div>
            </Clause>

            <Clause title="IP assignment" critical source="written into §3" testid="clause-ip">
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-2">
                All prior and future IP related to the business is assigned to the entity; each founder signs a standard PIIA. List exclusions below.
              </p>
              <textarea rows={2} className={INPUT} value={ipExclusions} onChange={(e) => setIpExclusions(e.target.value)} disabled={!canEdit} placeholder="Pre-existing IP to exclude (optional) — e.g. a patent held by a founder, unrelated to the Company." data-testid="input-ip-exclusions" />
            </Clause>

            <Clause title="Founder roles & authority" source="written into §§4–5" testid="clause-roles">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block">
                  <span className={LBL}>Day-to-day decisions by</span>
                  <input type="text" className={INPUT} value={decisionDayToDay} onChange={(e) => setDecisionDayToDay(e.target.value)} disabled={!canEdit} data-testid="input-daytoday" />
                </label>
                <label className="block">
                  <span className={LBL}>Strategic decision threshold</span>
                  <select className={INPUT} value={decisionThreshold} onChange={(e) => setDecisionThreshold(e.target.value)} disabled={!canEdit} data-testid="select-threshold">
                    <option value="majority">Majority</option>
                    <option value="supermajority">Supermajority (66%)</option>
                    <option value="unanimous">Unanimous</option>
                  </select>
                </label>
              </div>
              <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2">Per-founder titles come from the equity table above.</p>
            </Clause>

            <Clause title="Commitment & compensation" source="written into §6" testid="clause-commitment">
              <div className="flex items-center gap-2">
                {['full-time', 'part-time'].map((v) => (
                  <button key={v} type="button" onClick={() => canEdit && setCommitment(v)} data-testid={`commit-${v}`}
                    className={`text-[11.5px] font-bold rounded-full px-3 py-1.5 ${commitment === v ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                    {v === 'full-time' ? 'Full-time' : 'Part-time'}
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2">Cash compensation terms aren't part of this template — add them by amendment once you have payroll.</p>
            </Clause>

            <Clause title="Departure & repurchase" critical source="template default" testid="clause-departure">
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400">
                Standard clause (§7): unvested shares return on departure; the Company may repurchase vested shares per the template's buyout terms. Review the exact language in the generated document.
              </p>
            </Clause>

            <Clause title="Confidentiality & non-compete" source="written into §8" testid="clause-confidentiality">
              <div className="flex items-center gap-2">
                <input type="number" min="1" max="10" className={`${INPUT} !w-20 text-right`} value={confidentialityYears} onChange={(e) => setConfidentialityYears(e.target.value)} disabled={!canEdit} data-testid="input-confidentiality-years" />
                <span className="text-[12px] text-gray-500 dark:text-gray-400">years of confidentiality, surviving termination</span>
              </div>
            </Clause>

            <Clause title="Section 83(b)" source="template default" testid="clause-83b">
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400">
                The template (§9) obligates each founder to file their 83(b) election within 30 days of stock purchase — track filings on the{' '}
                <Link to="/spinout-lab/captable" className="text-violet-600 hover:underline">Cap Table</Link>.
              </p>
            </Clause>

            <Clause title="Amendment mechanics" source="written into §4" testid="clause-amendment">
              <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-2">Matters requiring unanimous founder consent:</p>
              <div className="space-y-1.5">
                {unanimousMatters.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="text" className={INPUT} value={m} onChange={(e) => setUnanimousMatters(unanimousMatters.map((x, xi) => (xi === i ? e.target.value : x)))} disabled={!canEdit} data-testid={`input-unanimous-${i}`} />
                    {canEdit && (
                      <button type="button" onClick={() => setUnanimousMatters(unanimousMatters.filter((_, xi) => xi !== i))} className="text-gray-300 hover:text-rose-500 shrink-0" aria-label="Remove matter">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {canEdit && (
                <button type="button" onClick={() => setUnanimousMatters([...unanimousMatters, ''])} data-testid="button-add-matter" className="mt-2 text-[11.5px] font-bold text-violet-600 hover:underline inline-flex items-center gap-1">
                  <Plus size={11} /> Add matter
                </button>
              )}
            </Clause>

            <Clause title="Dispute resolution" source="written into §10" testid="clause-dispute">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {DISPUTE.map((o) => (
                  <button key={o.v} type="button" onClick={() => canEdit && setDeadlock(o.v)} data-testid={`dispute-${o.label.toLowerCase().replace(/\s/g, '-')}`}
                    className={`text-left p-2.5 rounded-xl border-2 transition ${deadlock === o.v ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20' : 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'}`}>
                    <div className="text-[12px] font-bold text-gray-900 dark:text-gray-50">{o.label}</div>
                    <div className="text-[10.5px] text-gray-500 dark:text-gray-400 mt-0.5">{o.desc}</div>
                  </button>
                ))}
              </div>
            </Clause>

            <Clause title="Governing law & execution" critical source="written into §10" testid="clause-law">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block">
                  <span className={LBL}>Governing law</span>
                  <input type="text" className={INPUT} value={governingLaw} onChange={(e) => setGoverningLaw(e.target.value)} disabled={!canEdit} data-testid="input-law" />
                </label>
                <label className="block">
                  <span className={LBL}>Arbitration venue</span>
                  <input type="text" className={INPUT} value={arbitrationVenue} onChange={(e) => setArbitrationVenue(e.target.value)} disabled={!canEdit} data-testid="input-venue" />
                </label>
              </div>
              <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2">
                The document generates with wet-ink signature blocks; e-signature happens in Legal & Capital, not here.
              </p>
            </Clause>

            {error && <div className="text-[12px] text-rose-600 dark:text-rose-400 mt-3" data-testid="text-error">{String(error)}</div>}

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              <p className="text-[10.5px] text-gray-400 dark:text-gray-500">
                Generates a real document on your startup — nothing here is stored until then.
              </p>
              <button
                type="button"
                onClick={generate}
                disabled={!canGenerate || busy}
                data-testid="button-generate"
                className="text-[12px] font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg px-4 py-2 disabled:opacity-40 inline-flex items-center gap-1.5"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Generate agreement
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
