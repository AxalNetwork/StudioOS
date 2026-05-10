import React, { useEffect, useMemo, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Globe2, CheckCircle2, Circle, Loader2, ArrowRight, ArrowLeft,
  AlertTriangle, ExternalLink, FileText, Sparkles, Scale, DollarSign, Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';

// Task #30 — Jurisdiction wizard + incorporation flow.
//
// Four steps:
//   1. Goal questionnaire           → recommends a jurisdiction
//   2. Compare jurisdictions table  → user confirms a choice
//   3. Confirm + company name + project picker
//   4. Submit → Delaware C-Corp deep-links to Stripe Atlas; others
//      generate the doc set and surface in /legal.
//
// Auth: gated by RequireAuth in App.jsx. Backend route additionally
// permits founders-of-project, partners, investors, and admins.

const STEPS = [
  { id: 'goals', label: 'Tell us your goals', icon: Sparkles },
  { id: 'compare', label: 'Compare jurisdictions', icon: Globe2 },
  { id: 'confirm', label: 'Company details', icon: Building2 },
  { id: 'done', label: 'Done', icon: CheckCircle2 },
];

function recommend(answers) {
  // Tiny rules engine — favours fundraising-friendly jurisdictions when
  // the founder plans to raise institutional capital.
  if (answers.raisingVc === 'yes_us') return 'us_de_ccorp';
  if (answers.raisingVc === 'yes_eu') return 'uk_ltd';
  if (answers.region === 'apac') return 'sg_pte';
  if (answers.minimalCost === 'yes' && answers.raisingVc !== 'yes_us') return 'ee_oy';
  if (answers.entityPref === 'llc') return 'us_de_llc';
  return 'us_de_ccorp';
}

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
              <div className={`flex-1 h-0.5 mt-[-20px] mx-2 ${i < current ? 'bg-emerald-500' : 'bg-gray-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function ChoiceCard({ active, label, hint, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left border rounded-lg p-3 transition-colors ${
        active
          ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-100'
          : 'border-gray-200 hover:border-gray-300 bg-white'
      }`}
    >
      <div className="text-sm font-medium text-gray-900">{label}</div>
      {hint && <div className="text-xs text-gray-500 mt-0.5">{hint}</div>}
    </button>
  );
}

function GoalsStep({ answers, setAnswers }) {
  const set = (k, v) => setAnswers((a) => ({ ...a, [k]: v }));
  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2">
          Are you raising venture capital?
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <ChoiceCard active={answers.raisingVc === 'yes_us'} label="Yes — US investors" hint="Sand Hill, Tier-1 funds" onClick={() => set('raisingVc', 'yes_us')} />
          <ChoiceCard active={answers.raisingVc === 'yes_eu'} label="Yes — EU / UK investors" hint="SEIS/EIS angels, EU funds" onClick={() => set('raisingVc', 'yes_eu')} />
          <ChoiceCard active={answers.raisingVc === 'no'} label="Bootstrapping" hint="Cash-flow, no VC" onClick={() => set('raisingVc', 'no')} />
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2">
          Where will most of your customers be?
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ChoiceCard active={answers.region === 'us'} label="United States" onClick={() => set('region', 'us')} />
          <ChoiceCard active={answers.region === 'eu'} label="Europe / UK" onClick={() => set('region', 'eu')} />
          <ChoiceCard active={answers.region === 'apac'} label="Asia-Pacific" onClick={() => set('region', 'apac')} />
          <ChoiceCard active={answers.region === 'global'} label="Global / remote" onClick={() => set('region', 'global')} />
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2">
          Optimise for minimum incorporation cost?
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ChoiceCard active={answers.minimalCost === 'yes'} label="Yes — under $500" hint="Lean / pre-revenue" onClick={() => set('minimalCost', 'yes')} />
          <ChoiceCard active={answers.minimalCost === 'no'} label="No — pick the right tool" hint="Best fit, not cheapest" onClick={() => set('minimalCost', 'no')} />
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-gray-900 mb-2">
          Strong preference on entity type?
        </div>
        <div className="grid grid-cols-3 gap-2">
          <ChoiceCard active={answers.entityPref === 'corp'} label="Corporation" hint="Stock, options, VC" onClick={() => set('entityPref', 'corp')} />
          <ChoiceCard active={answers.entityPref === 'llc'} label="LLC / Pass-through" hint="Simple, tax-flexible" onClick={() => set('entityPref', 'llc')} />
          <ChoiceCard active={answers.entityPref === 'either'} label="No preference" onClick={() => set('entityPref', 'either')} />
        </div>
      </div>
    </div>
  );
}

function CompareStep({ jurisdictions, recommendedId, selectedId, setSelectedId }) {
  if (!jurisdictions || jurisdictions.length === 0) {
    // Bootstrap fetch returned 404 (or empty) for legalJurisdictions. Render
    // a friendly empty state instead of letting the user step forward into
    // an unfillable confirm screen.
    return (
      <div className="py-10 text-center">
        <div className="text-base font-semibold text-gray-900 mb-1">Jurisdiction options aren't available right now</div>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Please refresh in a moment, or contact support if this keeps happening. The wizard needs the jurisdiction list to recommend and prepare your founder document set.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="text-sm text-gray-600 mb-4">
        Based on your answers we recommend{' '}
        <span className="font-semibold text-violet-700">
          {jurisdictions.find((j) => j.id === recommendedId)?.label || '—'}
        </span>
        . Compare and pick what fits.
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {jurisdictions.map((j) => {
          const active = selectedId === j.id;
          const recommended = j.id === recommendedId;
          return (
            <button
              key={j.id}
              type="button"
              onClick={() => setSelectedId(j.id)}
              className={`text-left border rounded-xl p-4 transition-colors ${
                active
                  ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-100'
                  : 'border-gray-200 hover:border-gray-300 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="text-base font-semibold text-gray-900 flex items-center gap-2">
                    {j.label}
                    {recommended && (
                      <span className="text-[10px] uppercase tracking-wide bg-violet-600 text-white px-1.5 py-0.5 rounded">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">{j.country} · {j.entity_type}</div>
                </div>
                {active && <CheckCircle2 size={18} className="text-violet-600 flex-shrink-0" />}
              </div>
              <div className="text-xs text-gray-700 leading-snug mb-3">{j.summary}</div>
              <div className="grid grid-cols-3 gap-2 text-[11px] text-gray-700 mb-3">
                <div className="flex items-center gap-1">
                  <DollarSign size={12} className="text-gray-400" />
                  ${j.est_cost_usd[0]}–${j.est_cost_usd[1]}
                </div>
                <div className="flex items-center gap-1">
                  <Clock size={12} className="text-gray-400" />
                  {j.time_to_form_days[0]}–{j.time_to_form_days[1]} d
                </div>
                <div className={`flex items-center gap-1 ${j.fundraising_friendly ? 'text-emerald-700' : 'text-gray-500'}`}>
                  <Sparkles size={12} />
                  {j.fundraising_friendly ? 'VC-friendly' : 'Limited VC'}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold mb-1">Pros</div>
                  <ul className="text-[11px] text-gray-700 space-y-0.5 list-disc pl-4">
                    {j.pros.slice(0, 2).map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-amber-700 font-semibold mb-1">Cons</div>
                  <ul className="text-[11px] text-gray-700 space-y-0.5 list-disc pl-4">
                    {j.cons.slice(0, 2).map((p) => <li key={p}>{p}</li>)}
                  </ul>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 text-[11px] text-gray-600">
                <span className="font-semibold text-gray-700">Tax: </span>{j.tax_summary}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConfirmStep({ jurisdiction, projects, form, setForm }) {
  if (!jurisdiction) {
    // Defensive — Next button on step 1 is gated on selectedId + a populated
    // jurisdictions list, so this branch should be unreachable. If we still
    // get here (e.g. selected id was for a jurisdiction that's since been
    // removed from the catalog), render a friendly empty state instead of
    // a blank page.
    return (
      <div className="py-10 text-center">
        <div className="text-base font-semibold text-gray-900 mb-1">No jurisdiction selected</div>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Go back to the previous step and pick a jurisdiction. If the list looks empty, refresh the page in a moment.
        </p>
      </div>
    );
  }
  const isDeCorp = jurisdiction.atlas_supported;
  return (
    <div className="space-y-5">
      <div className="bg-violet-50 border border-violet-200 rounded-lg p-4">
        <div className="text-sm font-semibold text-violet-900 mb-1 flex items-center gap-2">
          <Globe2 size={16} /> Selected: {jurisdiction.label}
        </div>
        <div className="text-xs text-violet-800">
          {isDeCorp
            ? "After you submit, we'll hand you off to Stripe Atlas to complete filing. Your founder document set will be generated and surface in Legal."
            : `After you submit, we'll generate the ${jurisdiction.label} document set into Legal. Filing on the official portal is a manual next step.`}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1">Company name (legal)</label>
        <input
          value={form.company_name}
          onChange={(e) => setForm({ ...form, company_name: e.target.value })}
          placeholder={jurisdiction.id === 'sg_pte' ? 'e.g. Acme Pte. Ltd.' :
                       jurisdiction.id === 'uk_ltd' ? 'e.g. Acme Limited' :
                       jurisdiction.id === 'ee_oy' ? 'e.g. Acme OÜ' : 'e.g. Acme, Inc.'}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-700 mb-1">Link to project</label>
        <select
          value={form.project_id || ''}
          onChange={(e) => setForm({ ...form, project_id: e.target.value ? Number(e.target.value) : null })}
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="">Select a project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <div className="text-[11px] text-gray-500 mt-1">
          Generated documents will appear under this project on the Legal page.
        </div>
      </div>

      {jurisdiction.id === 'us_de_ccorp' && (
        <details className="border border-gray-200 rounded-lg">
          <summary className="px-3 py-2 text-xs font-semibold text-gray-700 cursor-pointer">
            Optional: registered-agent details (used in Certificate of Incorporation draft)
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-2">
            <input
              value={form.registered_agent_name}
              onChange={(e) => setForm({ ...form, registered_agent_name: e.target.value })}
              placeholder="Registered agent name (e.g. Harvard Business Services)"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
            <input
              value={form.registered_agent_address}
              onChange={(e) => setForm({ ...form, registered_agent_address: e.target.value })}
              placeholder="Registered agent address (e.g. 16192 Coastal Hwy, Lewes, DE 19958)"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
        </details>
      )}
    </div>
  );
}

function DoneStep({ result, navigate }) {
  if (!result) return null;
  const docs = result.documents || [];
  const handoff = result.handoff || {};
  return (
    <div className="space-y-5">
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start gap-3">
        <CheckCircle2 className="text-emerald-600 flex-shrink-0 mt-0.5" size={20} />
        <div>
          <div className="text-sm font-semibold text-emerald-900">
            {result.entity?.reused ? 'Documents refreshed' : `${result.entity?.name} set up in ${result.jurisdiction?.label}`}
          </div>
          <div className="text-xs text-emerald-800 mt-0.5">
            {docs.length} document{docs.length === 1 ? '' : 's'} generated and attached to your project.
          </div>
        </div>
      </div>

      {handoff.type === 'stripe_atlas' && handoff.url && (
        <a
          href={handoff.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block bg-violet-600 hover:bg-violet-700 text-white rounded-lg p-4 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold flex items-center gap-2">
                Continue on Stripe Atlas
                <ExternalLink size={14} />
              </div>
              <div className="text-xs opacity-90 mt-0.5">{handoff.summary}</div>
            </div>
            <ArrowRight size={20} />
          </div>
        </a>
      )}

      {handoff.type === 'documents_only' && (handoff.next_steps || []).length > 0 && (
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Next steps</div>
          <ul className="text-sm text-gray-800 space-y-1.5 list-decimal pl-5">
            {handoff.next_steps.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
      )}

      <div>
        <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Generated documents</div>
        <ul className="space-y-1">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-sm text-gray-800">
              <FileText size={14} className="text-violet-600" />
              <span>{d.title}</span>
              {d.reused && <span className="text-[10px] text-gray-500 uppercase tracking-wide">existing</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={() => navigate('/legal')}
          className="bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-md inline-flex items-center gap-1.5"
        >
          Open Legal <ArrowRight size={14} />
        </button>
        <button
          onClick={() => navigate('/incorporate')}
          className="text-sm text-gray-700 hover:text-gray-900 px-3 py-2"
        >
          Incorporate another
        </button>
      </div>
    </div>
  );
}

export default function IncorporatePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const [answers, setAnswers] = useState({
    raisingVc: '', region: '', minimalCost: '', entityPref: '',
  });
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({
    company_name: '',
    project_id: null,
    registered_agent_name: '',
    registered_agent_address: '',
  });

  useEffect(() => {
    let cancelled = false;
    // Fetch jurisdictions and projects INDEPENDENTLY. A 404 on one used to
    // blank both via Promise.all + shared catch, which surfaced a raw "Not
    // found" banner over an otherwise renderable wizard (the original bug
    // in the screenshot was triggered by listProjects() 404 for users with
    // no project scope yet). Each fetch now has its own defensive 404
    // handler so the other still populates and the wizard remains usable.
    const isNotFound = (e) => {
      const msg = (e?.message || '').toLowerCase();
      return e?.status === 404 || msg.includes('not found');
    };
    (async () => {
      const [jRes, pRes] = await Promise.allSettled([
        api.legalJurisdictions(),
        api.listProjects(),
      ]);
      if (cancelled) return;

      if (jRes.status === 'fulfilled') {
        setJurisdictions(jRes.value?.jurisdictions || []);
      } else if (!isNotFound(jRes.reason)) {
        setErr(jRes.reason?.message || 'Failed to load jurisdictions.');
      } // 404 → leave jurisdictions empty; render handles the empty state.

      if (pRes.status === 'fulfilled') {
        const list = pRes.value;
        setProjects(list?.projects || list || []);
      } else if (!isNotFound(pRes.reason)) {
        // Only surface a non-404 projects error if jurisdictions also failed
        // (otherwise the user can still browse jurisdictions and a banner
        // about projects would be confusing context).
        if (jRes.status !== 'fulfilled') {
          setErr(pRes.reason?.message || 'Failed to load projects.');
        }
      } // 404 → leave projects empty; submit step shows a clear reason.

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const recommendedId = useMemo(() => recommend(answers), [answers]);

  // Auto-select the recommendation when entering the compare step.
  useEffect(() => {
    if (step === 1 && !selectedId && recommendedId) setSelectedId(recommendedId);
  }, [step, recommendedId, selectedId]);

  const selected = jurisdictions.find((j) => j.id === selectedId) || null;
  const goalsAnswered = answers.raisingVc && answers.region && answers.minimalCost && answers.entityPref;

  const submit = async () => {
    if (!form.company_name.trim()) { setErr('Enter a company name to continue.'); return; }
    if (!form.project_id) { setErr('Select a project to attach the documents to.'); return; }
    if (!selectedId) { setErr('Pick a jurisdiction.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await api.legalIncorporateWizard({
        project_id: form.project_id,
        jurisdiction_id: selectedId,
        company_name: form.company_name.trim(),
        registered_agent_name: form.registered_agent_name || null,
        registered_agent_address: form.registered_agent_address || null,
      });
      setResult(res);
      setStep(3);
      // Spin-Out Lab — Week 4 final milestone (auto-exits the Lab).
      await markMilestone(user, 'incorporation_completed');
    } catch (e) {
      const status = e?.status;
      const msg = (e?.message || '').toLowerCase();
      if (status === 404 || msg.includes('not found')) {
        setErr("The selected project or jurisdiction is no longer available. Please refresh and try again.");
      } else if (status === 401 || status === 403) {
        setErr('Your session expired or you do not have access to this project. Please sign in again.');
      } else {
        setErr('Submission failed. Please retry in a moment, or contact support if it persists.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-wide text-violet-600 font-semibold flex items-center gap-1.5 mb-1">
          <Scale size={14} /> Jurisdiction Wizard
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Incorporate your company</h1>
        <PageExplainer pageKey="incorporate" />
        <p className="text-sm text-gray-600 mt-1">
          Pick the right jurisdiction in five questions. We'll prep the founder document set and
          hand you off to a filing partner where one is supported.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <Stepper current={step} />

        {err && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded p-2 text-sm flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-gray-500 flex items-center justify-center gap-2">
            <Loader2 className="animate-spin" size={16} /> Loading…
          </div>
        ) : (
          <>
            {step === 0 && <GoalsStep answers={answers} setAnswers={setAnswers} />}
            {step === 1 && (
              <CompareStep
                jurisdictions={jurisdictions}
                recommendedId={recommendedId}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
              />
            )}
            {step === 2 && (
              <ConfirmStep
                jurisdiction={selected}
                projects={projects}
                form={form}
                setForm={setForm}
              />
            )}
            {step === 3 && <DoneStep result={result} navigate={navigate} />}
          </>
        )}

        {step < 3 && !loading && (
          <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-between">
            <button
              onClick={() => { setErr(''); setStep((s) => Math.max(0, s - 1)); }}
              disabled={step === 0}
              className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-30"
            >
              <ArrowLeft size={14} /> Back
            </button>
            {step < 2 ? (
              <button
                onClick={() => { setErr(''); setStep((s) => s + 1); }}
                disabled={(step === 0 && !goalsAnswered) || (step === 1 && (!selectedId || jurisdictions.length === 0))}
                className="inline-flex items-center gap-1 bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50"
              >
                Next <ArrowRight size={14} />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={busy}
                className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm px-4 py-2 rounded-md disabled:opacity-50"
              >
                {busy ? <Loader2 className="animate-spin" size={14} /> : <Building2 size={14} />}
                {busy ? 'Working…' : 'Generate documents'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
