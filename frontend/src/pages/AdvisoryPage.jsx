import React, { useEffect, useState } from 'react';
import { Brain, Send, DollarSign, BarChart3, CheckCircle, AlertTriangle, XCircle, Info, ChevronDown, Users, Inbox, Mail, MailX, Archive, RotateCcw, Pencil, X, ArrowUpRight, Building2 } from 'lucide-react';
import { api } from '../lib/api';

// lucide-react in this repo predates the `Linkedin` glyph, so we ship a tiny
// inline SVG (same approach as JobManagePage.jsx / IntegrationsPage.jsx).
const Linkedin = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.024-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.049c.476-.9 1.637-1.85 3.37-1.85 3.602 0 4.268 2.37 4.268 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.778 13.019H3.555V9h3.56v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
);

function ModernSelect({ value, onChange, children, ...props }) {
  return (
    <div className="relative">
      <select value={value} onChange={onChange} {...props}
        className="w-full bg-white text-gray-900 border border-gray-300 rounded-xl px-4 py-2.5 pr-10 text-sm appearance-none shadow-sm focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 focus:outline-none transition-all cursor-pointer hover:border-gray-400 hover:shadow-md dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700">
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
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Advisory Suite</h1>
      <p className="text-sm text-gray-600 mb-6">Strategy, financial planning, diligence, and your advisor directory</p>

      <div className="flex gap-1 mb-6 flex-wrap">
        {[
          { key: 'advisor', label: 'AI Advisor', icon: Brain },
          { key: 'financial', label: 'Financial Planner', icon: DollarSign },
          { key: 'diligence', label: 'Diligence Checker', icon: BarChart3 },
          { key: 'directory', label: 'Advisors', icon: Users },
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
      {tab === 'directory' && <AdvisorsTab projects={projects} />}
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
        <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2 dark:text-gray-100">
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
              <option value="">No startup context</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </ModernSelect>
          </div>
          <div className="flex gap-2">
            <input value={question} onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && ask()}
              placeholder="Ask anything about strategy, GTM, fundraising..."
              className="flex-1 bg-gray-50 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-900 placeholder-gray-500 dark:text-gray-100" />
            <button onClick={ask} disabled={loading || !question.trim()}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg text-sm text-white font-medium flex items-center gap-2 transition-colors">
              <Send size={14} /> {loading ? 'Thinking...' : 'Ask'}
            </button>
          </div>
        </div>

        {response && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
            <div className="flex items-center gap-2 mb-3">
              <Brain size={14} className="text-violet-600" />
              <span className="text-xs text-gray-600">{response.ai_generated ? 'AI-Powered' : 'Template'} Response</span>
              {response.project_name && <span className="text-xs text-violet-600">| {response.project_name}</span>}
            </div>
            <div className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{response.advice}</div>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 h-fit dark:bg-gray-900 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">Query History</h3>
        {history.length === 0 ? (
          <p className="text-xs text-gray-500">No queries yet. Ask a question to get started.</p>
        ) : (
          <div className="space-y-3">
            {history.slice(0, 8).map((h, i) => (
              <div key={i} className="border-b border-gray-200 pb-2 dark:border-gray-800">
                <div className="text-xs text-gray-600 mb-1">{h.category}</div>
                <div className="text-xs text-gray-900 font-medium truncate dark:text-gray-100">{h.q}</div>
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
      <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 dark:text-gray-100">Financial Parameters</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-gray-600">Startup</label>
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
              <input type={type} {...f(key)} className="w-full mt-1 bg-gray-50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100" />
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
              <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
                <h3 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">Recommendations</h3>
                <ul className="space-y-2">
                  {plan.recommendations.map((r, i) => (
                    <li key={i} className="text-xs text-gray-700 flex items-start gap-2 dark:text-gray-300">
                      <AlertTriangle size={12} className="text-yellow-400 mt-0.5 shrink-0" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">18-Month Projection</h3>
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
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 dark:bg-gray-900 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">Automated Diligence Check</h3>
        <div className="flex gap-3">
          <div className="flex-1">
            <ModernSelect value={projectId} onChange={e => setProjectId(e.target.value)}>
              <option value="">Select a startup...</option>
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
          <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{report.project_name}</h3>
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
              <div key={cat} className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
                <h4 className="text-sm font-semibold text-gray-900 mb-3 dark:text-gray-100">{cat} Checks</h4>
                <div className="space-y-2">
                  {items.map((c, i) => (
                    <div key={i} className="flex items-start gap-3 px-3 py-2 bg-gray-50 rounded-lg">
                      {statusIcon(c.status)}
                      <div className="flex-1">
                        <div className="text-xs text-gray-900 font-medium dark:text-gray-100">{c.item}</div>
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

function AdvisorsTab({ projects }) {
  const [advisors, setAdvisors] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [dir, contacts] = await Promise.all([
        api.advisorProfilesList(),
        api.contactsList({ audience: 'advisor' }).catch(() => ({ items: [] })),
      ]);
      setAdvisors(dir.items || []);
      setWaitlist((contacts.items || []).filter(c => !c.promoted_ref_id));
    } catch (e) {
      setNotice({ type: 'error', msg: e.message });
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const promote = async (uid) => {
    setBusy(true);
    try {
      const res = await api.contactPromote(uid);
      if (res && res.email_error) setNotice({ type: 'warn', msg: `Advisor added, but the invite email failed: ${res.email_error}` });
      else setNotice({ type: 'success', msg: 'Advisor promoted to your directory and invited by email.' });
      await load();
    } catch (e) { setNotice({ type: 'error', msg: e.message }); }
    setBusy(false);
  };

  const toggleArchive = async (a) => {
    setBusy(true);
    try {
      await (a.status === 'archived' ? api.advisorProfileRestore(a.id) : api.advisorProfileArchive(a.id));
      await load();
    } catch (e) { setNotice({ type: 'error', msg: e.message }); }
    setBusy(false);
  };

  const active = advisors.filter(a => a.status !== 'archived');
  const archived = advisors.filter(a => a.status === 'archived');

  return (
    <div className="space-y-6">
      {notice && (
        <div className={`text-sm rounded-lg px-4 py-2 flex items-center justify-between ${
          notice.type === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
            : notice.type === 'warn' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
          <span>{notice.msg}</span>
          <button onClick={() => setNotice(null)} className="opacity-70 hover:opacity-100"><X size={14} /></button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800">
        <div className="flex items-center gap-2 mb-3">
          <Inbox size={16} className="text-violet-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">From your waitlist</h3>
          <span className="text-xs text-gray-500">{waitlist.length} waiting</span>
        </div>
        {waitlist.length === 0 ? (
          <p className="text-xs text-gray-500">No advisor contacts waiting. Advisor sign-ups from your landing pages appear here to promote into the directory.</p>
        ) : (
          <div className="space-y-2">
            {waitlist.map(c => (
              <div key={c.uid} className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-800/60 rounded-lg">
                <div className="min-w-0">
                  <div className="text-sm text-gray-900 dark:text-gray-100 font-medium truncate">{c.name || c.email}</div>
                  <div className="text-[11px] text-gray-500 truncate">{c.email}</div>
                </div>
                <button onClick={() => promote(c.uid)} disabled={busy}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium">
                  <ArrowUpRight size={13} /> Promote
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users size={16} className="text-violet-600" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Advisor directory</h3>
          <span className="text-xs text-gray-500">{active.length} active</span>
        </div>
        {loading ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : active.length === 0 ? (
          <p className="text-xs text-gray-500">No advisors yet. Promote a waitlist contact above to start building your directory.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {active.map(a => (
              <AdvisorCard key={a.id} advisor={a} busy={busy} onEdit={() => setEditing(a)} onArchive={() => toggleArchive(a)} />
            ))}
          </div>
        )}
      </div>

      {archived.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 mb-3">Archived ({archived.length})</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {archived.map(a => (
              <AdvisorCard key={a.id} advisor={a} busy={busy} onEdit={() => setEditing(a)} onArchive={() => toggleArchive(a)} />
            ))}
          </div>
        </div>
      )}

      {editing && (
        <AdvisorEditDrawer advisor={editing} projects={projects}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          setNotice={setNotice} />
      )}
    </div>
  );
}

function AdvisorCard({ advisor, busy, onEdit, onArchive }) {
  const a = advisor;
  const archived = a.status === 'archived';
  const chips = (arr, cls) => (arr || []).slice(0, 6).map((s, i) => (
    <span key={i} className={`inline-block text-[10px] px-2 py-0.5 rounded-full ${cls}`}>{s}</span>
  ));
  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-5 dark:bg-gray-900 dark:border-gray-800 ${archived ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{a.name}</div>
          <div className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
            {a.email ? (<><Mail size={11} /> {a.email}</>) : (<><MailX size={11} /> Email hidden</>)}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} disabled={busy} title="Edit"
            className="p-1.5 rounded-lg text-gray-500 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 disabled:opacity-50"><Pencil size={14} /></button>
          <button onClick={onArchive} disabled={busy} title={archived ? 'Restore' : 'Archive'}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50">
            {archived ? <RotateCcw size={14} /> : <Archive size={14} />}
          </button>
        </div>
      </div>
      {a.bio && <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 line-clamp-3">{a.bio}</p>}
      {(a.expertise?.length > 0 || a.sectors?.length > 0) && (
        <div className="flex flex-wrap gap-1 mb-2">
          {chips(a.expertise, 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300')}
          {chips(a.sectors, 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')}
        </div>
      )}
      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
        {typeof a.hourly_rate === 'number' && <span>${a.hourly_rate}/hr</span>}
        {a.linkedin_url && <a href={a.linkedin_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet-600 hover:underline"><Linkedin size={11} /> LinkedIn</a>}
      </div>
      {a.assignments?.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Advising</div>
          <div className="flex flex-wrap gap-1">
            {a.assignments.map(as => (
              <span key={as.project_id} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <Building2 size={10} /> {as.name || `#${as.project_id}`}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AdvisorEditDrawer({ advisor, projects, onClose, onSaved, setNotice }) {
  const [form, setForm] = useState({
    name: advisor.name || '',
    bio: advisor.bio || '',
    sectors: (advisor.sectors || []).join(', '),
    expertise: (advisor.expertise || []).join(', '),
    linkedin_url: advisor.linkedin_url || '',
    hourly_rate: advisor.hourly_rate ?? '',
  });
  const [assigned, setAssigned] = useState(() => new Set((advisor.assignments || []).map(a => a.project_id)));
  const [saving, setSaving] = useState(false);

  const toList = (s) => s.split(',').map(x => x.trim()).filter(Boolean);
  const field = (key) => ({ value: form[key], onChange: (e) => setForm(f => ({ ...f, [key]: e.target.value })) });
  const toggle = (pid) => setAssigned(prev => {
    const n = new Set(prev);
    if (n.has(pid)) n.delete(pid); else n.add(pid);
    return n;
  });

  const save = async () => {
    if (!form.name.trim()) { setNotice({ type: 'error', msg: 'Name is required.' }); return; }
    setSaving(true);
    try {
      await api.advisorProfileUpdate(advisor.id, {
        name: form.name.trim(),
        bio: form.bio,
        sectors: toList(form.sectors),
        expertise: toList(form.expertise),
        linkedin_url: form.linkedin_url,
        hourly_rate: form.hourly_rate === '' ? null : Number(form.hourly_rate),
      });
      await api.advisorProfileAssign(advisor.id, Array.from(assigned));
      setNotice({ type: 'success', msg: 'Advisor updated.' });
      onSaved();
    } catch (e) { setNotice({ type: 'error', msg: e.message }); }
    setSaving(false);
  };

  const inputCls = 'w-full mt-1 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-violet-500 focus:outline-none';

  return (
    <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 h-full p-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Edit advisor</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><X size={18} /></button>
        </div>
        {advisor.email_hidden && (
          <p className="text-[11px] text-gray-500 mb-4 flex items-center gap-1"><MailX size={11} /> Email hidden — this advisor did not arrive through a trusted pipeline.</p>
        )}
        <div className="space-y-3 mt-3">
          <div>
            <label className="text-xs text-gray-600 dark:text-gray-400">Name</label>
            <input {...field('name')} className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-gray-600 dark:text-gray-400">Bio</label>
            <textarea {...field('bio')} rows={3} className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-gray-600 dark:text-gray-400">Expertise <span className="text-gray-400">(comma-separated)</span></label>
            <input {...field('expertise')} placeholder="Fundraising, GTM, Hiring" className={inputCls} />
          </div>
          <div>
            <label className="text-xs text-gray-600 dark:text-gray-400">Sectors <span className="text-gray-400">(comma-separated)</span></label>
            <input {...field('sectors')} placeholder="Fintech, SaaS" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400">LinkedIn URL</label>
              <input {...field('linkedin_url')} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400">Hourly rate ($)</label>
              <input type="number" min="0" {...field('hourly_rate')} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 dark:text-gray-400 mb-1 block">Advising which startups</label>
            {projects.length === 0 ? (
              <p className="text-[11px] text-gray-500">No startups yet.</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded-lg p-2">
                {projects.map(p => (
                  <label key={p.id} className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200 px-2 py-1 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                    <input type="checkbox" checked={assigned.has(p.id)} onChange={() => toggle(p.id)} className="accent-violet-600" />
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button onClick={save} disabled={saving}
            className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm">Cancel</button>
        </div>
      </div>
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
