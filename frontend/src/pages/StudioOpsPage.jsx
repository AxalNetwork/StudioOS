import React, { useEffect, useState } from 'react';
import { Briefcase, DollarSign, Users, Scale, ShieldCheck, Plus, Loader2, Brain, X, ChevronRight, Sparkles, RefreshCw, Zap } from 'lucide-react';
import { api } from '../lib/api';

const TYPE_META = {
  strategic:   { label: 'Strategic', icon: Briefcase, color: 'violet',  bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700' },
  finance:     { label: 'Finance',   icon: DollarSign, color: 'emerald', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
  hr:          { label: 'HR',        icon: Users,     color: 'sky',     bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700' },
  legal:       { label: 'Legal',     icon: Scale,     color: 'amber',   bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700' },
  compliance:  { label: 'Compliance', icon: ShieldCheck, color: 'rose', bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700' },
};
const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'];

export default function StudioOpsPage() {
  const [tab, setTab] = useState('kanban');
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [openWfId, setOpenWfId] = useState(null);
  const [showQuickActions, setShowQuickActions] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [wfs, st] = await Promise.all([api.studioOpsWorkflows(), api.studioOpsStats()]);
      setWorkflows(wfs); setStats(st);
    } finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, []);

  const grouped = TASK_STATUSES.reduce((acc, s) => (acc[s] = 0, acc), {});
  Object.values(TYPE_META).forEach(() => {});

  const byType = {};
  for (const t of Object.keys(TYPE_META)) byType[t] = [];
  for (const wf of workflows) if (byType[wf.type]) byType[wf.type].push(wf);

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Briefcase className="text-violet-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Studio Ops</h1>
            <p className="text-sm text-gray-600">Strategic oversight, finance, HR, legal & compliance workflows.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-sm text-gray-700 px-3 py-2 rounded-lg">
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={() => setShowQuickActions(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-3 py-2 rounded-lg">
            <Zap size={14} /> Quick Action
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="My Open Tasks" value={stats.my_open_tasks} icon={Users} />
          <Stat label="Active Workflows" value={(stats.workflows_by_type || []).filter(r => r.status === 'active').reduce((a, b) => a + b.n, 0)} icon={Briefcase} />
          <Stat label="Tasks Done" value={(stats.tasks_by_status || []).find(r => r.status === 'done')?.n || 0} icon={ShieldCheck} />
          <Stat label="AI Calls (24h)" value={stats.ai_calls_today} icon={Brain} />
        </div>
      )}

      <div className="border-b border-gray-200 mb-6 flex gap-1 flex-wrap">
        {[
          { id: 'kanban', label: 'Kanban Board' },
          { id: 'strategic', label: 'Strategic Oversight' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}>{t.label}</button>
        ))}
      </div>

      {loading && <div className="flex items-center gap-2 text-sm text-gray-500 py-12 justify-center"><Loader2 className="animate-spin" size={16} /> Loading…</div>}

      {!loading && tab === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          {Object.entries(TYPE_META).map(([type, meta]) => {
            const Icon = meta.icon;
            const items = byType[type] || [];
            return (
              <div key={type} className={`${meta.bg} ${meta.border} border rounded-xl p-3 min-h-[300px]`}>
                <div className={`flex items-center justify-between mb-3 ${meta.text}`}>
                  <div className="flex items-center gap-2"><Icon size={16} /><span className="font-semibold text-sm">{meta.label}</span></div>
                  <span className="text-xs bg-white/70 px-2 py-0.5 rounded-full">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.length === 0 && <div className="text-xs text-gray-500 italic text-center py-4">No workflows</div>}
                  {items.map(wf => <WorkflowCard key={wf.id} wf={wf} onOpen={() => setOpenWfId(wf.id)} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && tab === 'strategic' && <StrategicReview />}

      {openWfId && <WorkflowDrawer id={openWfId} onClose={() => setOpenWfId(null)} onChanged={reload} />}
      {showQuickActions && <QuickActionsModal onClose={() => setShowQuickActions(false)} onCreated={() => { setShowQuickActions(false); reload(); }} />}
    </div>
  );
}

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center"><Icon size={18} /></div>
      <div>
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-xl font-bold text-gray-900">{value ?? 0}</div>
      </div>
    </div>
  );
}

function WorkflowCard({ wf, onOpen }) {
  const tc = wf.task_counts || {};
  const total = (tc.todo || 0) + (tc.in_progress || 0) + (tc.review || 0) + (tc.done || 0);
  const pct = total ? Math.round(((tc.done || 0) / total) * 100) : 0;
  return (
    <div onClick={onOpen} className="bg-white rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow border border-white">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="font-medium text-sm text-gray-900 line-clamp-2">{wf.title}</div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${wf.status === 'active' ? 'bg-emerald-100 text-emerald-700' : wf.status === 'completed' ? 'bg-gray-200 text-gray-600' : 'bg-gray-100 text-gray-500'}`}>{wf.status}</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-2">
        <span>{tc.done || 0}/{total} done</span>
        {wf.project_id && <span>• Project #{wf.project_id}</span>}
      </div>
      <div className="bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div className="h-full bg-violet-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function WorkflowDrawer({ id, onClose, onChanged }) {
  const [wf, setWf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState('');

  const load = async () => {
    setLoading(true);
    try { setWf(await api.studioOpsWorkflow(id)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  const updateTask = async (taskId, patch) => {
    await api.studioOpsUpdateTask(taskId, patch);
    await load(); onChanged?.();
  };
  const aiAssist = async (kind) => {
    setAiBusy(true); setAiResult('');
    try {
      const ctx = `Workflow: ${wf.title} (${wf.type}). Description: ${wf.description || ''}. Project: ${wf.project?.name || 'none'}.`;
      const r = await api.studioOpsAiAssist({ kind, context: ctx, workflow_id: wf.id });
      setAiResult(r.result);
    } catch (e) { setAiResult('Error: ' + e.message); }
    finally { setAiBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold text-gray-900">{wf?.title || 'Loading…'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={18} /></button>
        </div>

        {loading || !wf ? (
          <div className="p-8 text-center text-sm text-gray-500"><Loader2 className="animate-spin inline" size={16} /></div>
        ) : (
          <div className="p-6 space-y-5">
            <div className="text-sm text-gray-700">{wf.description}</div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="bg-gray-100 px-2 py-1 rounded">{wf.type}</span>
              <span className="bg-gray-100 px-2 py-1 rounded">{wf.status}</span>
              {wf.project && <span className="bg-violet-100 text-violet-700 px-2 py-1 rounded">Project: {wf.project.name}</span>}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Tasks ({wf.tasks?.length || 0})</h3>
              <div className="space-y-2">
                {(wf.tasks || []).map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${t.status === 'done' ? 'line-through text-gray-500' : 'text-gray-900'}`}>{t.title}</div>
                      {t.description && <div className="text-xs text-gray-600 mt-0.5">{t.description}</div>}
                    </div>
                    <select value={t.status} onChange={e => updateTask(t.id, { status: e.target.value })}
                      className="text-xs bg-white border border-gray-300 rounded px-2 py-1">
                      {TASK_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-200 pt-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2"><Brain size={14} className="text-violet-500" /> AI Assistant</h3>
              <div className="flex flex-wrap gap-2 mb-3">
                <button onClick={() => aiAssist('checklist')} disabled={aiBusy} className="text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-1.5 rounded">Generate Checklist</button>
                <button onClick={() => aiAssist('summary')} disabled={aiBusy} className="text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-1.5 rounded">Summarize</button>
                <button onClick={() => aiAssist('task_description')} disabled={aiBusy} className="text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-1.5 rounded">Suggest Task</button>
              </div>
              {aiBusy && <div className="text-xs text-gray-500 flex items-center gap-1"><Loader2 className="animate-spin" size={12} /> Thinking…</div>}
              {aiResult && (
                <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">{aiResult}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StrategicReview() {
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState([]);
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { (async () => { try { setProjects(await api.listProjects()); } catch {} })(); }, []);

  const run = async () => {
    if (!projectId) return;
    setLoading(true); setError(''); setReview(null);
    try { setReview(await api.studioOpsStrategicReview(projectId)); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2"><Sparkles size={16} className="text-violet-500" /> Strategic Review</h2>
      <p className="text-xs text-gray-600 mb-4">AI-powered metrics summary + continue / iterate / spin-out / kill recommendation.</p>

      <div className="flex gap-2 mb-4">
        <select value={projectId} onChange={e => setProjectId(e.target.value)}
          className="flex-1 bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
          <option value="">Select a project…</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.status})</option>)}
        </select>
        <button onClick={run} disabled={!projectId || loading}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
          {loading ? <Loader2 className="animate-spin" size={14} /> : <Brain size={14} />}
          Run Review
        </button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">{error}</div>}

      {review && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <KV k="Sector" v={review.metrics.sector} />
            <KV k="Stage" v={review.metrics.stage} />
            <KV k="Score" v={review.metrics.score ?? 'N/A'} />
            <KV k="Tier" v={review.metrics.tier ?? 'unscored'} />
          </div>
          <div className="bg-violet-50 border border-violet-200 rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wide text-violet-600 font-semibold mb-1">Recommendation (rule-based)</div>
            <div className="text-2xl font-bold text-violet-900">{review.rule_recommendation}</div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wide text-gray-600 font-semibold mb-2 flex items-center gap-1"><Brain size={11} /> AI Analysis</div>
            <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{review.ai_summary}</div>
            <div className="text-[10px] text-gray-400 mt-2">Model: {review.model}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div className="bg-gray-50 rounded-lg p-2">
      <div className="text-[10px] uppercase text-gray-500">{k}</div>
      <div className="text-sm font-medium text-gray-900 truncate">{String(v)}</div>
    </div>
  );
}

function QuickActionsModal({ onClose, onCreated }) {
  const [templates, setTemplates] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tplKey, setTplKey] = useState('');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [t, p] = await Promise.all([api.studioOpsTemplates(), api.listProjects().catch(() => [])]);
        setTemplates(t); setProjects(p);
      } catch {}
    })();
  }, []);

  const submit = async () => {
    if (!tplKey) { setErr('Pick a template'); return; }
    setBusy(true); setErr('');
    try { await api.studioOpsExecuteTemplate({ template_key: tplKey, project_id: projectId || null }); onCreated(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Quick Action — Run Template</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs text-gray-700 font-medium block mb-2">Template</label>
            <div className="space-y-1 max-h-72 overflow-y-auto border border-gray-200 rounded-lg p-2">
              {templates.map(t => (
                <label key={t.key} className={`flex items-start gap-2 p-2 rounded cursor-pointer ${tplKey === t.key ? 'bg-violet-50' : 'hover:bg-gray-50'}`}>
                  <input type="radio" checked={tplKey === t.key} onChange={() => setTplKey(t.key)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900">{t.title} <span className="text-[10px] text-gray-500 ml-1">{t.type}</span></div>
                    <div className="text-xs text-gray-600">{t.description}</div>
                  </div>
                  <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded">{t.task_count} tasks</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-700 font-medium block mb-1">Link to Project (optional)</label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)}
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:outline-none">
              <option value="">— None —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {err && <div className="text-xs text-red-600">{err}</div>}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm text-gray-700 hover:bg-gray-100 px-4 py-2 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={busy || !tplKey} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {busy ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
            Create Workflow
          </button>
        </div>
      </div>
    </div>
  );
}
