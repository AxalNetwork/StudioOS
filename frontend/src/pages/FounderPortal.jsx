import React, { useState } from 'react';
import { api } from '../lib/api';
import { Rocket, CheckCircle, XCircle, AlertTriangle, ArrowRight, ChevronDown } from 'lucide-react';

function ModernSelect({ value, onChange, children, ...props }) {
  return (
    <div className="relative">
      <select value={value} onChange={onChange} {...props}
        className="w-full bg-white text-gray-900 border border-gray-300 rounded-lg px-4 py-2.5 text-sm appearance-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all cursor-pointer hover:border-gray-400">
        {children}
      </select>
      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
    </div>
  );
}

const SECTORS = ['AI/Infrastructure', 'Blockchain/DeFi', 'Data/Analytics', 'FinTech', 'HealthTech', 'CleanTech', 'EdTech', 'SaaS', 'Other'];

export default function FounderPortal() {
  const [form, setForm] = useState({
    name: '', description: '', sector: '', founder_name: '', founder_email: '',
    problem_statement: '', solution: '', why_now: '', tam: '', sam: '',
    cost_to_mvp: '', funding_needed: '', use_of_funds: '',
    market_urgency: 5, market_trend: 3, team_expertise: 5, team_execution: 5,
    team_network: 2, mvp_time_days: 60, product_complexity: 3, product_dependencies: 2,
    time_to_revenue_months: 12, burn_risk: 2, fit_alignment: 5, fit_synergy: 3,
    distribution_channels: 3, distribution_virality: 3,
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);

  const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    if (!form.name || !form.founder_name || !form.founder_email) return;
    setLoading(true);
    try {
      const payload = {
        ...form,
        tam: form.tam ? parseFloat(form.tam) : null,
        sam: form.sam ? parseFloat(form.sam) : null,
        cost_to_mvp: form.cost_to_mvp ? parseFloat(form.cost_to_mvp) : null,
        funding_needed: form.funding_needed ? parseFloat(form.funding_needed) : null,
      };
      const res = await api.founderSubmit(payload);
      setResult(res);
      setStep(3);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const tierColors = {
    TIER_1: 'text-green-400',
    TIER_2: 'text-yellow-400',
    REJECT: 'text-red-400',
  };
  const tierIcons = {
    TIER_1: CheckCircle,
    TIER_2: AlertTriangle,
    REJECT: XCircle,
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Founder Portal</h1>
      <p className="text-gray-600 mb-6">Submit your startup for evaluation — get scored instantly</p>

      <div className="flex gap-2 mb-8">
        {[1, 2, 3].map(s => (
          <div key={s} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${step >= s ? 'bg-violet-600 text-gray-900' : 'bg-gray-50 text-gray-500'}`}>
            {s === 1 && 'Startup Info'}
            {s === 2 && 'Scoring Inputs'}
            {s === 3 && 'Results'}
            {s < 3 && <ArrowRight size={14} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">About Your Startup</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Startup Name *</label>
              <input className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm" value={form.name} onChange={e => handleChange('name', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1 font-medium">Sector</label>
              <ModernSelect value={form.sector} onChange={e => handleChange('sector', e.target.value)}>
                <option value="">Select sector</option>
                {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
              </ModernSelect>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Your Name *</label>
              <input className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm" value={form.founder_name} onChange={e => handleChange('founder_name', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Your Email *</label>
              <input type="email" className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm" value={form.founder_email} onChange={e => handleChange('founder_email', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Description</label>
            <textarea className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm h-20" value={form.description} onChange={e => handleChange('description', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Problem Statement</label>
              <textarea className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm h-20" value={form.problem_statement} onChange={e => handleChange('problem_statement', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Solution</label>
              <textarea className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm h-20" value={form.solution} onChange={e => handleChange('solution', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Why Now?</label>
            <textarea className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm h-16" value={form.why_now} onChange={e => handleChange('why_now', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">TAM ($)</label>
              <input type="number" className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm" value={form.tam} onChange={e => handleChange('tam', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">SAM ($)</label>
              <input type="number" className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm" value={form.sam} onChange={e => handleChange('sam', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Cost to MVP ($)</label>
              <input type="number" className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm" value={form.cost_to_mvp} onChange={e => handleChange('cost_to_mvp', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Funding Needed ($)</label>
              <input type="number" className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm" value={form.funding_needed} onChange={e => handleChange('funding_needed', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Use of Funds</label>
            <textarea className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm h-16" value={form.use_of_funds} onChange={e => handleChange('use_of_funds', e.target.value)} />
          </div>
          <button onClick={() => setStep(2)} disabled={!form.name || !form.founder_name || !form.founder_email} className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-gray-900 rounded-lg text-sm font-medium">
            Next: Scoring Inputs
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">Scoring Parameters</h2>
          <p className="text-sm text-gray-600">These values are used to auto-score your startup across 6 categories.</p>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-violet-600">Market (25 pts)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SliderInput label="Market Urgency" value={form.market_urgency} max={10} onChange={v => handleChange('market_urgency', v)} />
              <SliderInput label="Market Trend" value={form.market_trend} max={5} onChange={v => handleChange('market_trend', v)} />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-blue-400">Team (20 pts)</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SliderInput label="Expertise" value={form.team_expertise} max={8} onChange={v => handleChange('team_expertise', v)} />
              <SliderInput label="Execution" value={form.team_execution} max={8} onChange={v => handleChange('team_execution', v)} />
              <SliderInput label="Network" value={form.team_network} max={4} onChange={v => handleChange('team_network', v)} />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-amber-400">Product (15 pts)</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">MVP Time (days)</label>
                <input type="number" className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm" value={form.mvp_time_days} onChange={e => handleChange('mvp_time_days', parseFloat(e.target.value) || 0)} />
              </div>
              <SliderInput label="Complexity" value={form.product_complexity} max={5} onChange={v => handleChange('product_complexity', v)} />
              <SliderInput label="Dependencies" value={form.product_dependencies} max={3} onChange={v => handleChange('product_dependencies', v)} />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-green-400">Capital (15 pts)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Time to Revenue (months)</label>
                <input type="number" className="w-full bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-gray-900 text-sm" value={form.time_to_revenue_months} onChange={e => handleChange('time_to_revenue_months', parseFloat(e.target.value) || 0)} />
              </div>
              <SliderInput label="Burn Risk" value={form.burn_risk} max={3} onChange={v => handleChange('burn_risk', v)} />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-pink-400">Fit & Distribution (25 pts)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SliderInput label="Alignment" value={form.fit_alignment} max={10} onChange={v => handleChange('fit_alignment', v)} />
              <SliderInput label="Synergy" value={form.fit_synergy} max={5} onChange={v => handleChange('fit_synergy', v)} />
              <SliderInput label="Channels" value={form.distribution_channels} max={5} onChange={v => handleChange('distribution_channels', v)} />
              <SliderInput label="Virality" value={form.distribution_virality} max={5} onChange={v => handleChange('distribution_virality', v)} />
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="px-6 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-900 rounded-lg text-sm font-medium">
              Back
            </button>
            <button onClick={handleSubmit} disabled={loading} className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-gray-900 rounded-lg text-sm font-medium flex items-center gap-2">
              <Rocket size={16} />
              {loading ? 'Submitting & Scoring...' : 'Submit & Auto-Score'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center gap-4 mb-6">
              {React.createElement(tierIcons[result.score?.tier] || AlertTriangle, {
                size: 40,
                className: tierColors[result.score?.tier] || 'text-gray-600'
              })}
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{result.project?.name}</h2>
                <p className={`text-lg font-medium ${tierColors[result.score?.tier]}`}>
                  {result.score?.tier_label}
                </p>
              </div>
              <div className="ml-auto text-right">
                <div className="text-4xl font-bold text-gray-900">{result.score?.total_score}</div>
                <div className="text-sm text-gray-600">/ 100</div>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Auto Decision</h3>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><span className="text-gray-500">Status:</span> <span className="text-gray-900 capitalize">{result.auto_decision?.status?.replace('_', ' ')}</span></div>
                <div><span className="text-gray-500">Stage:</span> <span className="text-gray-900 capitalize">{result.auto_decision?.stage}</span></div>
                <div><span className="text-gray-500">Tier:</span> <span className={tierColors[result.auto_decision?.tier]}>{result.auto_decision?.tier}</span></div>
              </div>
            </div>

            {result.score?.breakdown && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(result.score.breakdown).map(([cat, data]) => (
                  <div key={cat} className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-600 capitalize mb-1">{cat}</div>
                    <div className="text-lg font-bold text-gray-900">{data.total}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => { setResult(null); setStep(1); setForm(prev => ({ ...prev, name: '', description: '', problem_statement: '', solution: '' })); }} className="px-6 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-900 rounded-lg text-sm font-medium">
            Submit Another Startup
          </button>
        </div>
      )}
    </div>
  );
}

function SliderInput({ label, value, max, onChange }) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">{label}: {value}/{max}</label>
      <input type="range" min={0} max={max} step={0.5} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="w-full accent-violet-500" />
    </div>
  );
}
