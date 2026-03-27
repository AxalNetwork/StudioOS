import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Target, ChevronDown, ChevronUp, Play, FileText } from 'lucide-react';

const defaultForm = {
  tam: 500000000, market_urgency: 7, market_trend: 4,
  team_expertise: 6, team_execution: 7, team_network: 3,
  mvp_time_days: 30, product_complexity: 2, product_dependencies: 1,
  cost_to_mvp: 50000, time_to_revenue_months: 6, burn_risk: 1,
  fit_alignment: 8, fit_synergy: 4,
  distribution_channels: 4, distribution_virality: 3,
  ai_adjustment: 0,
};

function ScoreBar({ label, value, max, color = 'violet' }) {
  const pct = Math.round((value / max) * 100);
  const colors = { violet: 'bg-violet-500', emerald: 'bg-emerald-500', blue: 'bg-blue-500', amber: 'bg-amber-500' };
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300">{value}/{max}</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${colors[color] || colors.violet} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ScoringPage() {
  const [queue, setQueue] = useState([]);
  const [form, setForm] = useState(defaultForm);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);

  useEffect(() => {
    api.scoringQueue().then(setQueue).catch(() => {});
  }, []);

  const runScore = async () => {
    setLoading(true);
    try {
      const data = { ...form };
      if (selectedProject) data.project_id = selectedProject;
      const res = await api.scoreStartup(data);
      setResult(res);
    } catch (e) {
      alert(e.message);
    }
    setLoading(false);
  };

  const generateMemo = async () => {
    if (!selectedProject) return alert('Select a project first');
    try {
      const memo = await api.generateDealMemo(selectedProject);
      alert(`Deal Memo generated! Decision: ${memo.decision}`);
    } catch (e) {
      alert(e.message);
    }
  };

  const setField = (key, val) => setForm(f => ({ ...f, [key]: parseFloat(val) || 0 }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Diligence & Scoring Engine</h1>
        <p className="text-sm text-gray-400">100-Point Startup Scoring Algorithm — The Brain</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Target size={16} className="text-violet-400" />
              <h2 className="font-semibold text-white text-sm">Score Input</h2>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1">Link to Project (optional)</label>
              <select
                value={selectedProject || ''}
                onChange={e => setSelectedProject(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="">Standalone scoring</option>
                {queue.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <Section title="A. Market (25 pts)">
              <Field label="TAM (USD)" value={form.tam} onChange={v => setField('tam', v)} />
              <Field label="Urgency (0-10)" value={form.market_urgency} onChange={v => setField('market_urgency', v)} max={10} />
              <Field label="Trend momentum (0-5)" value={form.market_trend} onChange={v => setField('market_trend', v)} max={5} />
            </Section>

            <Section title="B. Founder / Team (20 pts)">
              <Field label="Domain expertise (0-8)" value={form.team_expertise} onChange={v => setField('team_expertise', v)} max={8} />
              <Field label="Execution speed (0-8)" value={form.team_execution} onChange={v => setField('team_execution', v)} max={8} />
              <Field label="Network leverage (0-4)" value={form.team_network} onChange={v => setField('team_network', v)} max={4} />
            </Section>

            <Section title="C. Product Feasibility (15 pts)">
              <Field label="MVP build time (days)" value={form.mvp_time_days} onChange={v => setField('mvp_time_days', v)} />
              <Field label="Complexity (0-5, lower=better)" value={form.product_complexity} onChange={v => setField('product_complexity', v)} max={5} />
              <Field label="Dependency risk (0-3)" value={form.product_dependencies} onChange={v => setField('product_dependencies', v)} max={3} />
            </Section>

            <Section title="D. Capital Efficiency (15 pts)">
              <Field label="Cost to MVP (USD)" value={form.cost_to_mvp} onChange={v => setField('cost_to_mvp', v)} />
              <Field label="Time to revenue (months)" value={form.time_to_revenue_months} onChange={v => setField('time_to_revenue_months', v)} />
              <Field label="Burn risk (0-3)" value={form.burn_risk} onChange={v => setField('burn_risk', v)} max={3} />
            </Section>

            <Section title="E. Strategic Fit (15 pts)">
              <Field label="Alignment (0-10)" value={form.fit_alignment} onChange={v => setField('fit_alignment', v)} max={10} />
              <Field label="Partner synergy (0-5)" value={form.fit_synergy} onChange={v => setField('fit_synergy', v)} max={5} />
            </Section>

            <Section title="F. Distribution (10 pts)">
              <Field label="Channels (0-5)" value={form.distribution_channels} onChange={v => setField('distribution_channels', v)} max={5} />
              <Field label="Virality (0-5)" value={form.distribution_virality} onChange={v => setField('distribution_virality', v)} max={5} />
            </Section>

            <Section title="AI Bonus Layer">
              <Field label="AI adjustment (-5 to +5)" value={form.ai_adjustment} onChange={v => setField('ai_adjustment', v)} />
            </Section>

            <div className="flex gap-3 mt-6">
              <button onClick={runScore} disabled={loading} className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                <Play size={14} /> {loading ? 'Scoring...' : 'Run Full Score'}
              </button>
              {selectedProject && result && (
                <button onClick={generateMemo} className="flex items-center gap-2 px-5 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors">
                  <FileText size={14} /> Generate Deal Memo
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {result ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="text-center mb-6">
                <div className={`text-5xl font-bold ${
                  result.tier === 'TIER_1' ? 'text-emerald-400' :
                  result.tier === 'TIER_2' ? 'text-blue-400' : 'text-red-400'
                }`}>{result.total_score}</div>
                <div className="text-xs text-gray-400 mt-1">/ 100</div>
                <div className={`mt-2 inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                  result.tier === 'TIER_1' ? 'bg-emerald-500/20 text-emerald-400' :
                  result.tier === 'TIER_2' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'
                }`}>{result.tier_label}</div>
              </div>

              <ScoreBar label="Market" value={result.breakdown.market.total} max={25} color="violet" />
              <ScoreBar label="Team" value={result.breakdown.team.total} max={20} color="emerald" />
              <ScoreBar label="Product" value={result.breakdown.product.total} max={15} color="blue" />
              <ScoreBar label="Capital" value={result.breakdown.capital.total} max={15} color="amber" />
              <ScoreBar label="Fit" value={result.breakdown.fit.total} max={15} color="violet" />
              <ScoreBar label="Distribution" value={result.breakdown.distribution.total} max={10} color="emerald" />
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
              <Target size={40} className="text-gray-700 mx-auto mb-3" />
              <p className="text-sm text-gray-500">Run a score to see results</p>
            </div>
          )}

          {queue.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="font-semibold text-white text-sm mb-3">Scoring Queue</h3>
              <div className="space-y-2">
                {queue.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProject(p.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedProject === p.id ? 'bg-violet-500/20 text-violet-300' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-gray-500">{p.sector}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-4">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full text-left text-sm font-medium text-gray-300 mb-2">
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {title}
      </button>
      {open && <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pl-5">{children}</div>}
    </div>
  );
}

function Field({ label, value, onChange, max }) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        max={max}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-violet-500 focus:outline-none"
      />
    </div>
  );
}
