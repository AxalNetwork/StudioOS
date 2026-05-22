import React, { useEffect, useMemo, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { reportError } from '../lib/log';
import { useNavigate } from 'react-router-dom';
import {
  Users, ScrollText, Scale, Briefcase, ShieldCheck, ArrowRight, ArrowLeft,
  Trash2, Plus, CheckCircle2, AlertTriangle, Loader2, Sparkles,
} from 'lucide-react';
import { api } from '../lib/api';

// Task #31 — Co-founder agreement wizard.
//
// Five steps:
//   1. Project + founders (name/email/role/equity/start date)
//   2. Vesting (years, cliff, acceleration)
//   3. IP assignment (exclusions)
//   4. Decision rights & exit/buyout
//   5. Review + generate → calls /legal/cofounder-agreement
//
// Auth: gated by guard(['admin','founder','partner']) in App.jsx. Backend
// additionally requires admin/partner OR the founder owning the project.

const STEPS = [
  { id: 'founders', label: 'Founders & equity', icon: Users },
  { id: 'vesting', label: 'Vesting', icon: ScrollText },
  { id: 'ip', label: 'IP assignment', icon: ShieldCheck },
  { id: 'decisions', label: 'Decisions & exit', icon: Scale },
  { id: 'review', label: 'Review & generate', icon: CheckCircle2 },
];

const DEFAULT_UNANIMOUS = [
  'Sale or merger of the Company',
  'Issuance of new equity above 10% dilution',
  'Removal of a founder',
  'Material change to this Agreement',
];

function Stepper({ current }) {
  return (
    <div className="flex items-center justify-between mb-8">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={s.id}>
            <div className="flex flex-col items-center text-center min-w-0">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-1 transition-colors ${
                done ? 'bg-emerald-500 text-white' :
                active ? 'bg-violet-600 text-white ring-4 ring-violet-100' :
                'bg-gray-100 text-gray-400'
              }`}>
                {done ? <CheckCircle2 size={18} /> : <Icon size={18} />}
              </div>
              <div className={`text-[11px] leading-tight max-w-[90px] ${done || active ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                {s.label}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-1 mx-2 rounded ${done ? 'bg-emerald-400' : 'bg-gray-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function NumberField({ label, value, onChange, min = 0, max = 100, step = 1, suffix }) {
  return (
    <label className="block">
      <div className="text-xs font-semibold text-gray-700 mb-1">{label}</div>
      <div className="flex items-center">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        {suffix && <span className="ml-2 text-xs text-gray-500">{suffix}</span>}
      </div>
    </label>
  );
}

export default function CofounderAgreementPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [founders, setFounders] = useState([
    { name: '', email: '', role: 'CEO', equity_pct: 50, start_date: '' },
    { name: '', email: '', role: 'CTO', equity_pct: 50, start_date: '' },
  ]);
  const [vestingYears, setVestingYears] = useState(4);
  const [cliffMonths, setCliffMonths] = useState(12);
  const [cliffPct, setCliffPct] = useState(25);
  const [acceleration, setAcceleration] = useState('single_trigger');
  const [ipExclusions, setIpExclusions] = useState('');
  const [decisionDayToDay, setDecisionDayToDay] = useState('the CEO');
  const [decisionThreshold, setDecisionThreshold] = useState('majority');
  const [unanimousMatters, setUnanimousMatters] = useState([...DEFAULT_UNANIMOUS]);
  const [deadlockClause, setDeadlockClause] = useState('');
  const [commitmentLevel, setCommitmentLevel] = useState('full-time');
  const [governingLaw, setGoverningLaw] = useState('Delaware, USA');
  const [arbitrationVenue, setArbitrationVenue] = useState('Wilmington, Delaware');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.listProjects().then((p) => {
      const list = Array.isArray(p) ? p : (p?.projects || []);
      setProjects(list);
      if (list.length && !projectId) {
        setProjectId(String(list[0].id));
        if (!companyName) setCompanyName(list[0].name || '');
      }
    }).catch((e) => { reportError('CofounderAgreementPage:loadProjects', e); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalEquity = useMemo(
    () => founders.reduce((s, f) => s + (Number(f.equity_pct) || 0), 0),
    [founders]
  );

  const addFounder = () => setFounders([...founders, { name: '', email: '', role: '', equity_pct: 0, start_date: '' }]);
  const removeFounder = (i) => setFounders(founders.filter((_, idx) => idx !== i));
  const updateFounder = (i, patch) => setFounders(founders.map((f, idx) => idx === i ? { ...f, ...patch } : f));

  const canNext = () => {
    if (step === 0) return projectId && companyName.trim() && founders.length >= 2 && founders.every((f) => f.name.trim()) && totalEquity <= 100.001;
    return true;
  };

  const submit = async () => {
    setSubmitting(true); setError(null);
    try {
      const payload = {
        project_id: Number(projectId),
        company_name: companyName.trim(),
        founders: founders.map((f) => ({
          name: f.name.trim(),
          email: f.email.trim() || null,
          role: f.role.trim() || null,
          equity_pct: Number(f.equity_pct) || 0,
          start_date: f.start_date || null,
        })),
        vesting_years: Number(vestingYears),
        cliff_months: Number(cliffMonths),
        cliff_pct: Number(cliffPct),
        acceleration,
        ip_exclusions: ipExclusions.trim() || null,
        decision_day_to_day: decisionDayToDay,
        decision_threshold: decisionThreshold,
        unanimous_matters: unanimousMatters,
        deadlock_clause: deadlockClause.trim() || null,
        commitment_level: commitmentLevel,
        governing_law: governingLaw,
        arbitration_venue: arbitrationVenue,
      };
      const r = await api.legalCofounderAgreement(payload);
      setResult(r);
      setStep(STEPS.length);
    } catch (e) {
      setError(e?.message || 'Failed to generate agreement');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-violet-700 mb-1">
          <Briefcase size={18} />
          <span className="text-xs font-semibold uppercase tracking-wide">Incorporate</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Co-Founder Agreement</h1>
        <PageExplainer pageKey="cofounder_agreement" />
        <p className="text-sm text-gray-600 mt-1">
          Standardise the founder paperwork: vesting cliffs, IP assignment, decision rights, and exit/buyout.
        </p>
      </div>

      {step < STEPS.length && <Stepper current={step} />}

      {step === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <div className="text-xs font-semibold text-gray-700 mb-1">Project</div>
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  const p = projects.find((x) => String(x.id) === e.target.value);
                  if (p && !companyName) setCompanyName(p.name || '');
                }}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="text-xs font-semibold text-gray-700 mb-1">Company name</div>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. NewCo, Inc."
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-gray-900">Founders ({founders.length})</div>
              <div className={`text-xs font-semibold ${totalEquity > 100 ? 'text-red-600' : 'text-gray-600'}`}>
                Total equity: {totalEquity.toFixed(2)}%
              </div>
            </div>
            <div className="space-y-2">
              {founders.map((f, i) => (
                <div key={i} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end p-3 bg-gray-50 rounded-lg">
                  <div className="col-span-2 md:col-span-3">
                    <div className="text-[11px] font-semibold text-gray-600 mb-1">Name</div>
                    <input value={f.name} onChange={(e) => updateFounder(i, { name: e.target.value })}
                      className="w-full border rounded-md px-2 py-1.5 text-sm" placeholder="Jane Doe" />
                  </div>
                  <div className="col-span-2 md:col-span-3">
                    <div className="text-[11px] font-semibold text-gray-600 mb-1">Email</div>
                    <input value={f.email} onChange={(e) => updateFounder(i, { email: e.target.value })}
                      className="w-full border rounded-md px-2 py-1.5 text-sm" placeholder="jane@example.com" />
                  </div>
                  <div className="col-span-1 md:col-span-2">
                    <div className="text-[11px] font-semibold text-gray-600 mb-1">Role</div>
                    <input value={f.role} onChange={(e) => updateFounder(i, { role: e.target.value })}
                      className="w-full border rounded-md px-2 py-1.5 text-sm" placeholder="CEO" />
                  </div>
                  <div className="col-span-1 md:col-span-2">
                    <div className="text-[11px] font-semibold text-gray-600 mb-1">Equity %</div>
                    <input type="number" value={f.equity_pct} min={0} max={100} step={0.01}
                      onChange={(e) => updateFounder(i, { equity_pct: Number(e.target.value) })}
                      className="w-full border rounded-md px-2 py-1.5 text-sm" />
                  </div>
                  <div className="col-span-1 md:col-span-1">
                    <div className="text-[11px] font-semibold text-gray-600 mb-1">Start</div>
                    <input type="date" value={f.start_date}
                      onChange={(e) => updateFounder(i, { start_date: e.target.value })}
                      className="w-full border rounded-md px-1 py-1.5 text-xs" />
                  </div>
                  <div className="col-span-1 md:col-span-1 flex justify-end">
                    {founders.length > 2 && (
                      <button onClick={() => removeFounder(i)}
                        className="text-gray-400 hover:text-red-600 p-2" title="Remove">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addFounder}
              className="mt-2 text-sm text-violet-700 hover:text-violet-900 inline-flex items-center gap-1">
              <Plus size={14} /> Add founder
            </button>
            {totalEquity > 100 && (
              <div className="mt-2 text-xs text-red-700 inline-flex items-center gap-1">
                <AlertTriangle size={14} /> Total equity exceeds 100%.
              </div>
            )}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <NumberField label="Vesting period" value={vestingYears} onChange={setVestingYears} min={1} max={10} suffix="years" />
            <NumberField label="Cliff" value={cliffMonths} onChange={setCliffMonths} min={0} max={48} suffix="months" />
            <NumberField label="Cliff vest %" value={cliffPct} onChange={setCliffPct} min={0} max={100} suffix="%" />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-700 mb-2">Acceleration on Change of Control</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {[
                { v: 'none', label: 'None', desc: 'No acceleration.' },
                { v: 'single_trigger', label: 'Single-trigger', desc: '100% vests on Change of Control.' },
                { v: 'double_trigger', label: 'Double-trigger', desc: 'Vests if terminated without cause within 12 months of CoC.' },
              ].map((o) => (
                <button key={o.v} onClick={() => setAcceleration(o.v)}
                  className={`text-left p-3 rounded-lg border-2 transition ${
                    acceleration === o.v ? 'border-violet-600 bg-violet-50' : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <div className="text-sm font-semibold text-gray-900">{o.label}</div>
                  <div className="text-xs text-gray-600 mt-1">{o.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div className="text-sm text-gray-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <strong>Default:</strong> all IP created by each founder (before that's related to the
            Company's business, or during) is assigned to the Company. Each founder will sign a
            standard PIIA. List any prior inventions you want to <em>exclude</em> below.
          </div>
          <label className="block">
            <div className="text-xs font-semibold text-gray-700 mb-1">Pre-existing IP exclusions</div>
            <textarea value={ipExclusions} onChange={(e) => setIpExclusions(e.target.value)}
              rows={5} className="w-full border rounded-md px-3 py-2 text-sm font-mono"
              placeholder="e.g. Patent US 10,123,456 — held by founder Jane Doe, unrelated to Company business." />
          </label>
        </div>
      )}

      {step === 3 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <div className="text-xs font-semibold text-gray-700 mb-1">Day-to-day decisions made by</div>
              <input value={decisionDayToDay} onChange={(e) => setDecisionDayToDay(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <div className="text-xs font-semibold text-gray-700 mb-1">Strategic decision threshold</div>
              <select value={decisionThreshold} onChange={(e) => setDecisionThreshold(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm">
                <option value="majority">Majority</option>
                <option value="supermajority">Supermajority (66%)</option>
                <option value="unanimous">Unanimous</option>
              </select>
            </label>
            <label className="block">
              <div className="text-xs font-semibold text-gray-700 mb-1">Commitment level</div>
              <select value={commitmentLevel} onChange={(e) => setCommitmentLevel(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm">
                <option value="full-time">Full-time</option>
                <option value="part-time">Part-time</option>
              </select>
            </label>
            <label className="block">
              <div className="text-xs font-semibold text-gray-700 mb-1">Deadlock clause</div>
              <input value={deadlockClause} onChange={(e) => setDeadlockClause(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
                placeholder="Mediation followed by binding arbitration." />
            </label>
            <label className="block">
              <div className="text-xs font-semibold text-gray-700 mb-1">Governing law</div>
              <input value={governingLaw} onChange={(e) => setGoverningLaw(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <div className="text-xs font-semibold text-gray-700 mb-1">Arbitration venue</div>
              <input value={arbitrationVenue} onChange={(e) => setArbitrationVenue(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm" />
            </label>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-700 mb-2">Matters requiring unanimous founder consent</div>
            <div className="space-y-2">
              {unanimousMatters.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={m} onChange={(e) => {
                    const c = [...unanimousMatters]; c[i] = e.target.value; setUnanimousMatters(c);
                  }} className="flex-1 border rounded-md px-2 py-1.5 text-sm" />
                  <button onClick={() => setUnanimousMatters(unanimousMatters.filter((_, idx) => idx !== i))}
                    className="text-gray-400 hover:text-red-600 p-1.5"><Trash2 size={14} /></button>
                </div>
              ))}
              <button onClick={() => setUnanimousMatters([...unanimousMatters, ''])}
                className="text-sm text-violet-700 hover:text-violet-900 inline-flex items-center gap-1">
                <Plus size={14} /> Add matter
              </button>
            </div>
          </div>
          <div className="text-xs text-gray-500">
            Exit & buyout terms (right of first refusal, vested-share repurchase, for-cause forfeiture)
            are included with sensible defaults — review the generated document for the exact language.
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Review</h3>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div><dt className="text-gray-500 inline">Company:</dt> <dd className="inline font-medium">{companyName}</dd></div>
            <div><dt className="text-gray-500 inline">Founders:</dt> <dd className="inline font-medium">{founders.length} ({totalEquity.toFixed(2)}%)</dd></div>
            <div><dt className="text-gray-500 inline">Vesting:</dt> <dd className="inline font-medium">{vestingYears}y / {cliffMonths}mo cliff @ {cliffPct}%</dd></div>
            <div><dt className="text-gray-500 inline">Acceleration:</dt> <dd className="inline font-medium">{acceleration.replace('_', '-')}</dd></div>
            <div><dt className="text-gray-500 inline">Decisions:</dt> <dd className="inline font-medium">{decisionThreshold} • day-to-day by {decisionDayToDay}</dd></div>
            <div><dt className="text-gray-500 inline">Commitment:</dt> <dd className="inline font-medium">{commitmentLevel}</dd></div>
            <div className="md:col-span-2"><dt className="text-gray-500 inline">Unanimous matters:</dt> <dd className="inline">{unanimousMatters.length}</dd></div>
          </dl>
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 inline-flex items-center gap-2">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>
      )}

      {step === STEPS.length && result && (
        <div className="bg-white rounded-xl border border-emerald-200 p-6 text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 size={28} className="text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Agreement generated</h2>
          <p className="text-sm text-gray-600 mt-1">
            <strong>{result.document.title}</strong> is now in your project's legal documents.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button onClick={() => navigate('/legal-capital')}
              className="px-4 py-2 text-sm font-semibold rounded-md bg-violet-600 hover:bg-violet-700 text-white">
              Open in Legal & Capital
            </button>
            <button onClick={() => { setStep(0); setResult(null); }}
              className="px-4 py-2 text-sm font-semibold rounded-md border hover:bg-gray-50">
              Generate another
            </button>
          </div>
        </div>
      )}

      {step < STEPS.length && (
        <div className="flex items-center justify-between mt-6">
          <button onClick={() => step === 0 ? navigate('/incorporate') : setStep(step - 1)}
            className="px-4 py-2 text-sm font-semibold rounded-md border hover:bg-gray-50 inline-flex items-center gap-1">
            <ArrowLeft size={14} /> {step === 0 ? 'Back to Incorporate' : 'Back'}
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={() => setStep(step + 1)} disabled={!canNext()}
              className="px-4 py-2 text-sm font-semibold rounded-md bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white inline-flex items-center gap-1">
              Next <ArrowRight size={14} />
            </button>
          ) : (
            <button onClick={submit} disabled={submitting || !canNext()}
              className="px-5 py-2 text-sm font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white inline-flex items-center gap-2">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate agreement
            </button>
          )}
        </div>
      )}
    </div>
  );
}
