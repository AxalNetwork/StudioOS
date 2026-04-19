import React, { useEffect, useState } from 'react';
import { Brain, Send, DollarSign, BarChart3, CheckCircle, AlertTriangle, XCircle, Info, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';

function ModernSelect({ value, onChange, children, ...props }) {
  return (
    <div className="relative">
      <select value={value} onChange={onChange} {...props}
        className="w-full bg-white text-gray-900 border border-gray-300 rounded-xl px-4 py-2.5 pr-10 text-sm appearance-none shadow-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all cursor-pointer hover:border-gray-400 hover:shadow-md">
        {children}
      </select>
      <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
  );
}

export default function AdvisoryPage() {
  const [tab, setTab] = useState('advisor');
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">AI Advisory Suite</h1>
      <p className="text-sm text-gray-600 mb-6">Strategy, financial planning, and automated diligence</p>

      <div className="flex gap-1 mb-6">
        {[
          { key: 'advisor', label: 'AI Advisor', icon: Brain },
          { key: 'financial', label: 'Financial Planner', icon: DollarSign },
          { key: 'diligence', label: 'Diligence Checker', icon: BarChart3 },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
              tab === t.key ? 'bg-violet-600 text-white' : 'bg-gray-50 text-gray-600 hover:text-gray-900'
            }`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'advisor' && <AdvisorTab projects={projects} />}
      {tab === 'financial' && <FinancialTab projects={projects} />}
      {tab === 'diligence' && <DiligenceTab projects={projects} />}
    </div>
  );
}

function AdvisorTab({ projects }) {
  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState('general');
  const [projectId, setProjectId] = useState('');
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);

  const ask = async () => {
    if (!question.trim()) return;
    setLoading(true);
    try {
      const res = await api.askAdvisory({
        question, category,
        project_id: projectId ? parseInt(projectId) : null,
      });
      setResponse(res);
      setHistory(prev => [{ q: question, a: res.advice, category, ts: new Date() }, ...prev]);
      setQuestion('');
    } catch (e) {
      alert(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Brain size={16} className="text-violet-600" /> Ask the AI Advisor
          </h3>
          <div className="flex gap-3 mb-3">
            <ModernSelect value={category} onChange={e => setCategory(e.target.value)}>
              <option value="general">General Strategy</option>
              <option value="gtm">Go-to-Market</option>
              <option value="fundraising">Fundraising</option>
              <option value="product">Product</option>
              <option value="team">Team Building</option>
            </ModernSelect>
            <ModernSelect value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">No project context</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </ModernSelect>
          </div>
          <div className="flex gap-2">
            <input value={question} onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ask()}
              placeholder="Ask anything about strategy, GTM, fundraising..."
              className="flex-1 bg-gray-50 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-900 placeholder-gray-500" />
            <button onClick={ask} disabled={loading || !question.trim()}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg text-sm text-white font-medium flex items-center gap-2 transition-colors">
              <Send size={14} /> {loading ? 'Thinking...' : 'Ask'}
            </button>
          </div>
        </div>

        {response && (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Brain size={14} className="text-violet-600" />
              <span className="text-xs text-gray-600">{response.ai_generated ? 'AI-Powered' : 'Template'} Response</span>
              {response.project_name && <span className="text-xs text-violet-600">| {response.project_name}</span>}
            </div>
            <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{response.advice}</div>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 h-fit">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Query History</h3>
        {history.length === 0 ? (
          <p className="text-xs text-gray-500">No queries yet. Ask a question to get started.</p>
        ) : (
          <div className="space-y-3">
            {history.slice(0, 8).map((h, i) => (
              <div key={i} className="border-b border-gray-200 pb-2">
                <div className="text-xs text-gray-600 mb-1">{h.category}</div>
                <div className="text-xs text-gray-900 font-medium truncate">{h.q}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{h.ts.toLocaleTimeString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FinancialTab({ projects }) {
  const [form, setForm] = useState({
    project_id: '', monthly_burn: 15000, current_cash: 200000, revenue_monthly: 0,
    revenue_growth_pct: 10, funding_needed: 500000, team_size: 3, planned_hires: 2, avg_salary: 80000,
  });
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const payload = { ...form, project_id: form.project_id ? parseInt(form.project_id) : null };
      const res = await api.financialPlan(payload);
      setPlan(res);
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const f = (key) => ({ value: form[key], onChange: e => setForm(f => ({ ...f, [key]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value })) });

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Financial Parameters</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-gray-600">Project</label>
            <div className="mt-1">
              <ModernSelect {...f('project_id')}>
                <option value="">Standalone</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </ModernSelect>
            </div>
          </div>
          {[
            ['monthly_burn', 'Monthly Burn ($)', 'number'],
            ['current_cash', 'Current Cash ($)', 'number'],
            ['revenue_monthly', 'Monthly Revenue ($)', 'number'],
            ['revenue_growth_pct', 'Revenue Growth (%)', 'number'],
            ['funding_needed', 'Funding Needed ($)', 'number'],
            ['team_size', 'Team Size', 'number'],
            ['planned_hires', 'Planned Hires', 'number'],
            ['avg_salary', 'Avg Salary ($)', 'number'],
          ].map(([key, label, type]) => (
            <div key={key}>
              <label className="text-xs text-gray-600">{label}</label>
              <input type={type} {...f(key)} className="w-full mt-1 bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900" />
            </div>
          ))}
        </div>
            <button onClick={generate} disabled={loading}
              className="mt-4 w-full px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg text-sm text-white font-medium transition-colors">
          {loading ? 'Generating...' : 'Generate Financial Plan'}
        </button>
      </div>

      <div>
        {plan && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Monthly Burn" value={`$${plan.summary.net_monthly_burn.toLocaleString()}`}
                status={plan.summary.runway_status} />
              <MetricCard label="Runway" value={`${plan.summary.runway_months} mo`}
                status={plan.summary.runway_status} />
              <MetricCard label="Breakeven" value={plan.summary.breakeven_month ? `Month ${plan.summary.breakeven_month}` : 'Not in forecast'}
                status={plan.summary.breakeven_month ? 'Healthy' : 'Warning'} />
              <MetricCard label="Total Monthly Cost" value={`$${plan.summary.total_monthly_cost.toLocaleString()}`}
                status="info" />
            </div>

            {plan.recommendations.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Recommendations</h3>
                <ul className="space-y-2">
                  {plan.recommendations.map((r, i) => (
                    <li key={i} className="text-xs text-gray-700 flex items-start gap-2">
                      <AlertTriangle size={12} className="text-yellow-400 mt-0.5 shrink-0" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">18-Month Projection</h3>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {plan.projections.map(p => (
                  <div key={p.month} className="flex items-center gap-2 text-xs">
                    <span className="w-8 text-gray-500">M{p.month}</span>
                    <div className="flex-1 bg-gray-50 rounded-full h-2 overflow-hidden">
                      <div className={`h-full rounded-full ${p.cash_balance > 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(Math.max((p.cash_balance / (form.current_cash || 1)) * 100, 0), 100)}%` }} />
                    </div>
                    <span className={`w-24 text-right ${p.cash_balance > 0 ? 'text-gray-700' : 'text-red-400'}`}>
                      ${Math.round(p.cash_balance).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DiligenceTab({ projects }) {
  const [projectId, setProjectId] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const runCheck = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await api.runDiligence({ project_id: parseInt(projectId) });
      setReport(res);
    } catch (e) { alert(e.message); }
    setLoading(false);
  };

  const statusIcon = (s) => {
    if (s === 'pass') return <CheckCircle size={14} className="text-emerald-400" />;
    if (s === 'warning') return <AlertTriangle size={14} className="text-yellow-400" />;
    if (s === 'missing') return <XCircle size={14} className="text-red-400" />;
    return <Info size={14} className="text-blue-400" />;
  };

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Automated Diligence Check</h3>
        <div className="flex gap-3">
          <div className="flex-1">
            <ModernSelect value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">Select a project...</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </ModernSelect>
          </div>
          <button onClick={runCheck} disabled={loading || !projectId}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg text-sm text-white font-medium transition-colors whitespace-nowrap">
            {loading ? 'Running...' : 'Run Diligence'}
          </button>
        </div>
      </div>

      {report && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{report.project_name}</h3>
                <p className="text-xs text-gray-600">{report.recommendation}</p>
              </div>
              <span className={`text-sm px-3 py-1 rounded-full font-medium ${
                report.overall_status === 'pass' ? 'bg-emerald-100 text-emerald-700' :
                report.overall_status === 'conditional' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-red-100 text-red-700'
              }`}>{report.overall_status.toUpperCase()}</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xl font-bold text-emerald-400">{report.summary.pass}</div>
                <div className="text-[10px] text-gray-500">PASS</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xl font-bold text-yellow-400">{report.summary.warning}</div>
                <div className="text-[10px] text-gray-500">WARNING</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-xl font-bold text-red-400">{report.summary.missing}</div>
                <div className="text-[10px] text-gray-500">MISSING</div>
              </div>
            </div>
          </div>

          {['Scoring', 'Legal', 'Team', 'Financial'].map(cat => {
            const items = report.checks.filter(c => c.category === cat);
            if (items.length === 0) return null;
            return (
              <div key={cat} className="bg-white border border-gray-200 rounded-xl p-5">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">{cat} Checks</h4>
                <div className="space-y-2">
                  {items.map((c, i) => (
                    <div key={i} className="flex items-start gap-3 px-3 py-2 bg-gray-50 rounded-lg">
                      {statusIcon(c.status)}
                      <div className="flex-1">
                        <div className="text-xs text-gray-900 font-medium">{c.item}</div>
                        <div className="text-[11px] text-gray-600">{c.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, status }) {
  const colors = {
    Healthy: 'border-emerald-500/30 text-emerald-400',
    Warning: 'border-yellow-500/30 text-yellow-400',
    Critical: 'border-red-500/30 text-red-400',
    info: 'border-gray-700 text-gray-700',
  };
  return (
    <div className={`bg-white border rounded-xl p-4 ${colors[status] || colors.info}`}>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
    </div>
  );
}
