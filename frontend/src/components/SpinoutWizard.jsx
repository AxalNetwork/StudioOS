import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, Circle, Loader2, FileText, PieChart, Building2, Rocket, Sparkles, AlertTriangle, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';

const STEPS = [
  { id: 'ip_transfer', label: 'IP Licensing & Transfer', icon: FileText },
  { id: 'equity_allocate', label: 'Equity Allocation', icon: PieChart },
  { id: 'stripe_atlas', label: 'Stripe Atlas Incorporation', icon: Building2 },
  { id: 'go_independent', label: 'Go Independent', icon: Rocket },
];

const STATUS_TO_STEP = { pending: 0, ip_transferred: 1, equity_allocated: 2, incorporated: 3, independent: 4 };

export default function SpinoutWizard({ deal, onClose, onComplete }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [allocation, setAllocation] = useState({ studio_pct: 15, founders_pct: 70, option_pool_pct: 13, advisors_pct: 2 });
  const [aiRecommended, setAiRecommended] = useState(false);

  const reload = async () => {
    try {
      const s = await api.spinoutStatus(deal.id);
      setStatus(s);
      if (s.subsidiary?.equity_allocation_json && Object.keys(s.subsidiary.equity_allocation_json).length) {
        setAllocation(s.subsidiary.equity_allocation_json);
      }
    } catch (e) { setErr(e.message); }
  };

  useEffect(() => { reload(); }, [deal.id]);

  const init = async () => {
    setBusy(true); setErr('');
    try { await api.spinoutExecute({ deal_id: deal.id, force: true }); await reload(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const stepIp = async () => {
    setBusy(true); setErr('');
    try { await api.spinoutIpTransfer({ deal_id: deal.id }); await reload(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const askAI = async () => {
    setBusy(true); setErr(''); setAiRecommended(false);
    try { const r = await api.spinoutEquity({ deal_id: deal.id }); setAllocation(r.allocation); setAiRecommended(true); await reload(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const saveEquity = async () => {
    setBusy(true); setErr('');
    try { await api.spinoutEquity({ deal_id: deal.id, allocation }); await reload(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const stepAtlas = async () => {
    setBusy(true); setErr('');
    try { await api.spinoutAtlas({ deal_id: deal.id }); await reload(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const stepIndependent = async () => {
    setBusy(true); setErr('');
    try { await api.spinoutGoIndependent({ deal_id: deal.id }); await reload(); onComplete?.(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const iterate = async () => {
    if (!confirm('Take the "Continue / Iterate" path? This skips spin-out and returns the deal to MVP stage.')) return;
    setBusy(true); setErr('');
    try { await api.spinoutIterate({ deal_id: deal.id }); onClose?.(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const sub = status?.subsidiary;
  const currentStep = STATUS_TO_STEP[status?.status || 'pending'] || 0;
  const total = (allocation.studio_pct || 0) + (allocation.founders_pct || 0) + (allocation.option_pool_pct || 0) + (allocation.advisors_pct || 0);

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2"><Rocket size={18} className="text-violet-600" /> Spin-Out Wizard</h2>
            <p className="text-xs text-gray-500">{deal.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={18} /></button>
        </div>

        {/* Stepper */}
        <div className="px-6 pt-4">
          <div className="flex items-center justify-between mb-6">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = i < currentStep;
              const active = i === currentStep;
              return (
                <React.Fragment key={s.id}>
                  <div className="flex flex-col items-center text-center w-24">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center mb-1 ${done ? 'bg-emerald-500 text-white' : active ? 'bg-violet-600 text-white ring-4 ring-violet-100' : 'bg-gray-100 text-gray-400'}`}>
                      {done ? <CheckCircle2 size={18} /> : <Icon size={16} />}
                    </div>
                    <div className={`text-[10px] leading-tight ${done || active ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>{s.label}</div>
                  </div>
                  {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mt-[-20px] ${i < currentStep ? 'bg-emerald-500' : 'bg-gray-200'}`} />}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {err && <div className="mx-6 mb-3 bg-red-50 border border-red-200 text-red-700 rounded p-2 text-xs flex items-center gap-2"><AlertTriangle size={14} />{err}</div>}

        <div className="px-6 pb-6 space-y-3">
          {!sub ? (
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-6 text-center">
              <p className="text-sm text-violet-900 mb-3">Initialize spin-out for <b>{deal.name}</b>. This creates the subsidiary record and unlocks the wizard.</p>
              <div className="flex justify-center gap-2">
                <button onClick={init} disabled={busy} className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2">
                  {busy ? <Loader2 className="animate-spin" size={14} /> : <Rocket size={14} />} Initialize
                </button>
                <button onClick={iterate} disabled={busy} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm px-4 py-2 rounded-lg">Continue / Iterate (skip spin-out)</button>
              </div>
            </div>
          ) : (
            <>
              {/* Step 1: IP */}
              <StepCard title="IP Licensing & Transfer" done={!!sub.ip_license_doc_id} active={currentStep === 0}>
                {sub.ip_license_doc_id ? (
                  <p className="text-xs text-emerald-700">IP License generated and signed (doc #{sub.ip_license_doc_id}).</p>
                ) : (
                  <>
                    <p className="text-xs text-gray-700 mb-3">Generates the IP Assignment & License Agreement transferring the project's IP from Axal Holding to the new subsidiary.</p>
                    <button onClick={stepIp} disabled={busy} className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-3 py-2 rounded flex items-center gap-1">
                      {busy ? <Loader2 className="animate-spin" size={12} /> : <FileText size={12} />} Execute IP Transfer
                    </button>
                  </>
                )}
              </StepCard>

              {/* Step 2: Equity */}
              <StepCard title="Equity Allocation" done={currentStep > 1} active={currentStep === 1}>
                <div className="flex items-center gap-2 mb-3">
                  <button onClick={askAI} disabled={busy} className="bg-violet-100 hover:bg-violet-200 text-violet-700 text-xs font-medium px-2 py-1 rounded flex items-center gap-1">
                    {busy ? <Loader2 className="animate-spin" size={11} /> : <Sparkles size={11} />} AI Recommend
                  </button>
                  {aiRecommended && <span className="text-[10px] text-emerald-600">✓ AI-recommended</span>}
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {[
                    { k: 'studio_pct', label: 'Studio (Axal)', range: '5-30%' },
                    { k: 'founders_pct', label: 'Founders', range: '50-85%' },
                    { k: 'option_pool_pct', label: 'Option Pool', range: '5-20%' },
                    { k: 'advisors_pct', label: 'Advisors', range: '0-5%' },
                  ].map(f => (
                    <div key={f.k}>
                      <label className="text-[10px] uppercase text-gray-500 block">{f.label} <span className="text-gray-400 normal-case">({f.range})</span></label>
                      <input type="number" step="0.5" min="0" max="100" value={allocation[f.k] || 0}
                        onChange={e => setAllocation({...allocation, [f.k]: parseFloat(e.target.value) || 0})}
                        disabled={currentStep > 1}
                        className="w-full bg-gray-50 border border-gray-300 rounded px-2 py-1 text-sm focus:border-violet-500 disabled:opacity-60" />
                    </div>
                  ))}
                </div>
                <div className={`text-xs mb-3 ${Math.abs(total - 100) < 0.5 ? 'text-emerald-600' : 'text-amber-600'}`}>Total: {total.toFixed(1)}% {Math.abs(total - 100) < 0.5 ? '✓' : '(must equal 100)'}</div>
                {currentStep === 1 && (
                  <button onClick={saveEquity} disabled={busy} className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-3 py-2 rounded flex items-center gap-1">
                    {busy ? <Loader2 className="animate-spin" size={12} /> : <PieChart size={12} />} Save Allocation
                  </button>
                )}
              </StepCard>

              {/* Step 3: Atlas */}
              <StepCard title="Stripe Atlas Incorporation" done={currentStep > 2} active={currentStep === 2}>
                {sub.stripe_atlas_id ? (
                  <div className="text-xs text-gray-700 space-y-1">
                    <div>Atlas ID: <code className="bg-gray-100 px-1 rounded">{sub.stripe_atlas_id}</code></div>
                    <div>EIN: <code className="bg-gray-100 px-1 rounded">{sub.ein || 'Pending'}</code></div>
                    <div className="text-emerald-600">✓ Incorporated</div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-gray-700 mb-3">Initiates Delaware C-Corp incorporation through Stripe Atlas. Returns Atlas ID and assigns EIN.</p>
                    <button onClick={stepAtlas} disabled={busy || currentStep < 2} className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm px-3 py-2 rounded flex items-center gap-1">
                      {busy ? <Loader2 className="animate-spin" size={12} /> : <Building2 size={12} />} Start Incorporation
                    </button>
                  </>
                )}
              </StepCard>

              {/* Step 4: Independent */}
              <StepCard title="Go Independent" done={status?.status === 'independent'} active={currentStep === 3}>
                {status?.status === 'independent' ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded p-3">
                    <div className="font-semibold text-emerald-900 text-sm flex items-center gap-1"><CheckCircle2 size={14} /> Now an independent company</div>
                    {sub.post_spinout_dashboard_url && <a href={sub.post_spinout_dashboard_url} className="text-xs text-violet-600 hover:underline">Open independent dashboard <ArrowRight size={10} className="inline" /></a>}
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-gray-700 mb-3">Final step: enables independent scaling, removes from main pipeline, and provisions a post-spinout dashboard.</p>
                    <button onClick={stepIndependent} disabled={busy || currentStep < 3} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded flex items-center gap-1">
                      {busy ? <Loader2 className="animate-spin" size={12} /> : <Rocket size={12} />} Go Independent
                    </button>
                  </>
                )}
              </StepCard>

              {/* Audit trail */}
              {status?.events?.length > 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <div className="text-xs font-semibold text-gray-700 mb-2">Audit Trail</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {status.events.map(e => (
                      <div key={e.id} className="text-[10px] text-gray-600 flex items-center gap-2">
                        <span className="bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-mono">{e.event_type}</span>
                        <span>{new Date(e.created_at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StepCard({ title, done, active, children }) {
  return (
    <div className={`border rounded-xl p-4 ${done ? 'bg-emerald-50/50 border-emerald-200' : active ? 'bg-violet-50/50 border-violet-300' : 'bg-white border-gray-200 opacity-60'}`}>
      <div className="flex items-center gap-2 mb-2">
        {done ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Circle size={14} className={active ? 'text-violet-600' : 'text-gray-400'} />}
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      {children}
    </div>
  );
}
