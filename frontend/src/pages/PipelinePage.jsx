import React, { useEffect, useState } from 'react';
import { Layers, Plus, Loader2, Sparkles, X, Zap, TrendingUp, CheckCircle2, RotateCcw, AlertTriangle, Activity, Target } from 'lucide-react';
import { api } from '../lib/api';
import SpinoutWizard from '../components/SpinoutWizard';

const STAGES = [
  { id: 'idea', label: 'Idea', color: 'bg-gray-100 text-gray-700', border: 'border-gray-300' },
  { id: 'mvp_dev', label: 'MVP Dev', color: 'bg-blue-100 text-blue-700', border: 'border-blue-300' },
  { id: 'traction_review', label: 'Traction Review', color: 'bg-amber-100 text-amber-700', border: 'border-amber-300' },
  { id: 'decision_gate', label: 'Decision Gate', color: 'bg-violet-100 text-violet-700', border: 'border-violet-300' },
  { id: 'spinout_ready', label: 'Spin-Out Ready', color: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-300' },
  { id: 'iterate', label: 'Iterate', color: 'bg-orange-100 text-orange-700', border: 'border-orange-300' },
];

export default function PipelinePage() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [me, setMe] = useState(null);
  const [spinoutDeal, setSpinoutDeal] = useState(null);

  const reload = async () => { setLoading(true); try { setDeals(await api.pipelineActive()); } finally { setLoading(false); } };
  useEffect(() => { (async () => { try { setMe(await api.getCurrentUser()); } catch {} reload(); })(); }, []);

  const canEdit = me && (me.role === 'admin' || me.role === 'partner');
  const grouped = STAGES.reduce((acc, s) => ({ ...acc, [s.id]: [] }), {});
  for (const d of deals) (grouped[d.pipeline_stage] || grouped.idea).push(d);

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Layers className="text-violet-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Pipeline Board</h1>
            <p className="text-sm text-gray-600">Parallel MVP development with AI-driven decision gates.</p>
          </div>
        </div>
        {canEdit && (
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-3 py-2 rounded-lg">
            <Plus size={14} /> New Pipeline Project
          </button>
        )}
      </div>

      {loading ? <Loading text="Loading pipeline…" /> : (
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-3 min-w-max">
            {STAGES.map(stage => (
              <div key={stage.id} className="w-72 flex-shrink-0">
                <div className={`px-3 py-2 rounded-t-lg ${stage.color} font-semibold text-sm flex items-center justify-between border ${stage.border} border-b-0`}>
                  <span>{stage.label}</span>
                  <span className="bg-white/70 text-xs px-2 py-0.5 rounded-full">{grouped[stage.id].length}</span>
                </div>
                <div className={`bg-gray-50 border ${stage.border} border-t-0 rounded-b-lg min-h-[400px] p-2 space-y-2`}>
                  {grouped[stage.id].length === 0 ? (
                    <div className="text-xs text-gray-400 text-center py-8">Empty</div>
                  ) : grouped[stage.id].map(d => <DealCard key={d.id} deal={d} onOpen={() => setOpenId(d.id)} onSpinout={() => setSpinoutDeal(d)} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {openId && <DealDrawer dealId={openId} canEdit={canEdit} onClose={() => setOpenId(null)} onChanged={reload} />}
      {creating && <CreateModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />}
      {spinoutDeal && <SpinoutWizard deal={spinoutDeal} onClose={() => { setSpinoutDeal(null); reload(); }} onComplete={reload} />}
    </div>
  );
}

function DealCard({ deal, onOpen, onSpinout }) {
  const tot = deal.task_counts.todo + deal.task_counts.in_progress + deal.task_counts.done;
  const pct = tot ? Math.round((deal.task_counts.done / tot) * 100) : 0;
  const traction = deal.latest_metrics?.traction_score;
  const gate = deal.latest_gate;
  return (
    <div onClick={onOpen} className="bg-white border border-gray-200 rounded-lg p-3 cursor-pointer hover:border-violet-400 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="font-semibold text-sm text-gray-900 truncate flex-1">{deal.name}</div>
        {traction != null && <ScorePill score={traction} small />}
      </div>
      {deal.sector && <div className="text-[10px] text-gray-500 mb-2">{deal.sector}</div>}
      {tot > 0 && (
        <div className="mb-2">
          <div className="flex justify-between text-[10px] text-gray-500 mb-1"><span>Tasks {deal.task_counts.done}/{tot}</span><span>{pct}%</span></div>
          <div className="bg-gray-100 rounded-full h-1 overflow-hidden"><div className="h-full bg-violet-500" style={{width: `${pct}%`}} /></div>
        </div>
      )}
      {deal.latest_metrics?.key_metrics && Object.keys(deal.latest_metrics.key_metrics).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {Object.entries(deal.latest_metrics.key_metrics).slice(0, 3).map(([k, v]) => (
            <span key={k} className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">{k}: {String(v)}</span>
          ))}
        </div>
      )}
      {gate && (
        <div className={`text-[10px] px-2 py-1 rounded flex items-center gap-1 ${
          gate.final_decision === 'passed' ? 'bg-emerald-50 text-emerald-700' :
          gate.final_decision === 'iterate' ? 'bg-orange-50 text-orange-700' :
          gate.final_decision === 'failed' ? 'bg-red-50 text-red-700' :
          'bg-violet-50 text-violet-700'
        }`}>
          <Sparkles size={10} /> AI: {(gate.ai_recommendation || '').replace('_', ' ')}
          {gate.final_decision && <span className="ml-auto font-bold">→ {gate.final_decision}</span>}
        </div>
      )}
      {deal.pipeline_stage === 'spinout_ready' && onSpinout && (
        <button onClick={(e) => { e.stopPropagation(); onSpinout(); }} className="mt-2 w-full bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold py-1.5 rounded flex items-center justify-center gap-1">
          🚀 Execute Spin-Out
        </button>
      )}
    </div>
  );
}

function DealDrawer({ dealId, canEdit, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => { setLoading(true); try { setData(await api.pipelineDealDetail(dealId)); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [dealId]);

  const triggerReview = async () => {
    setBusy(true); setErr('');
    try { await api.pipelineTriggerReview(dealId); await load(); onChanged?.(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const advance = async (stage) => {
    setBusy(true); setErr('');
    try { await api.pipelineAdvance(dealId, stage); await load(); onChanged?.(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const decide = async (gateId, decision) => {
    setBusy(true); setErr('');
    try { await api.pipelineDecide(gateId, decision); await load(); onChanged?.(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="text-lg font-semibold truncate">{data?.project?.name || 'Loading…'}</h2>
          <div className="flex items-center gap-2">
            {canEdit && <button onClick={triggerReview} disabled={busy} className="flex items-center gap-1 text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-3 py-1.5 rounded">
              {busy ? <Loader2 className="animate-spin" size={12} /> : <Sparkles size={12} />} Trigger AI Review
            </button>}
            <button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={18} /></button>
          </div>
        </div>

        {loading || !data ? <Loading text="" /> : (
          <div className="p-6">
            {err && <div className="bg-red-50 border border-red-200 text-red-700 rounded p-2 text-xs mb-3">{err}</div>}

            <div className="flex gap-1 mb-4 border-b border-gray-200">
              {[{id:'overview',label:'Overview',icon:Activity},{id:'tasks',label:`MVP Tasks (${data.tasks.length})`,icon:Target},{id:'metrics',label:`Metrics (${data.metrics.length})`,icon:TrendingUp},{id:'gates',label:`Gates (${data.gates.length})`,icon:Sparkles}].map(t => {
                const Icon = t.icon;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`flex items-center gap-1 px-3 py-2 text-xs font-medium border-b-2 -mb-px ${tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
                    <Icon size={12} /> {t.label}
                  </button>
                );
              })}
            </div>

            {tab === 'overview' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <KV k="Current Stage" v={STAGES.find(s => s.id === data.current_stage)?.label || data.current_stage} />
                  <KV k="Sector" v={data.project.sector || '—'} />
                  <KV k="Score" v={data.project.score != null ? `${data.project.score}/100` : '—'} />
                  <KV k="Status" v={data.project.status} />
                </div>
                {canEdit && (
                  <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
                    <div className="text-xs font-semibold text-violet-700 mb-2">Advance to Stage:</div>
                    <div className="flex flex-wrap gap-1">
                      {STAGES.filter(s => s.id !== data.current_stage).map(s => (
                        <button key={s.id} onClick={() => advance(s.id)} disabled={busy} className={`text-[10px] font-medium px-2 py-1 rounded ${s.color} hover:opacity-80 disabled:opacity-50`}>{s.label}</button>
                      ))}
                    </div>
                  </div>
                )}
                {data.project.problem_statement && (
                  <div><div className="text-xs font-semibold text-gray-700 mb-1">Problem</div><p className="text-xs text-gray-700">{data.project.problem_statement}</p></div>
                )}
                {data.project.solution && (
                  <div><div className="text-xs font-semibold text-gray-700 mb-1">Solution</div><p className="text-xs text-gray-700">{data.project.solution}</p></div>
                )}
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-2">Stage Timeline</div>
                  <div className="space-y-1">
                    {data.stages.map(s => (
                      <div key={s.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-100 last:border-0">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${STAGES.find(st => st.id === s.stage_name)?.color || 'bg-gray-100 text-gray-700'}`}>{s.stage_name}</span>
                        <span className="text-gray-500">{s.status === 'active' ? '🟢 active' : new Date(s.end_date || s.start_date).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'tasks' && <TasksTab data={data} canEdit={canEdit} dealId={dealId} reload={load} />}
            {tab === 'metrics' && <MetricsTab data={data} canEdit={canEdit} dealId={dealId} reload={load} />}
            {tab === 'gates' && <GatesTab data={data} canEdit={canEdit} onDecide={decide} busy={busy} />}
          </div>
        )}
      </div>
    </div>
  );
}

function TasksTab({ data, canEdit, dealId, reload }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', description: '' });
  const cols = { todo: data.tasks.filter(t => t.status === 'todo'), in_progress: data.tasks.filter(t => t.status === 'in_progress'), done: data.tasks.filter(t => t.status === 'done') };
  const addTask = async () => {
    if (!form.title) return;
    await api.pipelineCreateTask({ deal_id: dealId, ...form });
    setForm({ title: '', description: '' }); setAdding(false); reload();
  };
  const updateStatus = async (id, status) => { await api.pipelineUpdateTask(id, { status }); reload(); };
  return (
    <div>
      {canEdit && (adding ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3 space-y-2">
          <input placeholder="Task title" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className={inputCls} />
          <textarea rows={2} placeholder="Description (optional)" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className={inputCls} />
          <div className="flex gap-2"><button onClick={addTask} className="bg-violet-600 hover:bg-violet-700 text-white text-xs px-3 py-1.5 rounded">Add</button><button onClick={() => setAdding(false)} className="text-xs text-gray-700 px-2 py-1.5">Cancel</button></div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mb-3 text-xs flex items-center gap-1 bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded"><Plus size={12} /> Add Task</button>
      ))}
      <div className="grid grid-cols-3 gap-3">
        {Object.entries(cols).map(([s, list]) => (
          <div key={s}>
            <div className="text-xs font-semibold text-gray-700 mb-2 uppercase">{s.replace('_', ' ')} ({list.length})</div>
            <div className="space-y-2">
              {list.map(t => (
                <div key={t.id} className="bg-white border border-gray-200 rounded p-2 text-xs">
                  <div className="flex items-start gap-1">
                    {t.ai_generated && <Sparkles size={10} className="text-violet-500 flex-shrink-0 mt-0.5" />}
                    <div className="font-medium text-gray-900 flex-1">{t.title}</div>
                  </div>
                  {t.description && <p className="text-gray-600 mt-1">{t.description}</p>}
                  {canEdit && (
                    <select value={t.status} onChange={e => updateStatus(t.id, e.target.value)} className="mt-2 text-[10px] bg-gray-50 border border-gray-200 rounded px-1 py-0.5 w-full">
                      <option value="todo">todo</option><option value="in_progress">in progress</option><option value="done">done</option>
                    </select>
                  )}
                </div>
              ))}
              {list.length === 0 && <div className="text-[10px] text-gray-400 text-center py-3">Empty</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricsTab({ data, canEdit, dealId, reload }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ users: '', revenue: '', engagement: '', growth: '' });
  const submit = async () => {
    const km = {};
    for (const k of ['users', 'revenue', 'engagement', 'growth']) {
      const v = parseFloat(form[k]); if (!isNaN(v)) km[k] = v;
    }
    if (!Object.keys(km).length) return;
    await api.pipelineSnapshot({ deal_id: dealId, key_metrics: km });
    setForm({ users: '', revenue: '', engagement: '', growth: '' }); setAdding(false); reload();
  };
  const series = data.metrics.slice().reverse();
  const max = Math.max(1, ...series.map(s => s.traction_score || 0));
  return (
    <div>
      {canEdit && (adding ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Users / MAU"><input type="number" value={form.users} onChange={e => setForm({...form, users: e.target.value})} className={inputCls} /></Field>
            <Field label="Revenue / MRR ($)"><input type="number" value={form.revenue} onChange={e => setForm({...form, revenue: e.target.value})} className={inputCls} /></Field>
            <Field label="Engagement (0-100)"><input type="number" value={form.engagement} onChange={e => setForm({...form, engagement: e.target.value})} className={inputCls} /></Field>
            <Field label="Growth Rate (%)"><input type="number" value={form.growth} onChange={e => setForm({...form, growth: e.target.value})} className={inputCls} /></Field>
          </div>
          <div className="flex gap-2 mt-2"><button onClick={submit} className="bg-violet-600 hover:bg-violet-700 text-white text-xs px-3 py-1.5 rounded">Capture Snapshot</button><button onClick={() => setAdding(false)} className="text-xs text-gray-700 px-2 py-1.5">Cancel</button></div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mb-3 text-xs flex items-center gap-1 bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded"><Plus size={12} /> Record Metrics</button>
      ))}

      {series.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3">
          <div className="text-xs font-semibold text-gray-700 mb-2">Traction Score History</div>
          <div className="flex items-end gap-1 h-24 bg-gray-50 rounded p-2">
            {series.map((s, i) => (
              <div key={i} className="flex-1 bg-violet-500 rounded-sm hover:bg-violet-700 transition-colors" style={{height: `${Math.max(2, ((s.traction_score || 0) / max) * 100)}%`}} title={`${new Date(s.snapshot_date).toLocaleDateString()}: ${s.traction_score}`} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {data.metrics.length === 0 ? <Empty text="No snapshots yet." /> : data.metrics.map(m => (
          <div key={m.id} className="bg-white border border-gray-200 rounded p-2 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-500">{new Date(m.snapshot_date).toLocaleString()}</span>
              <ScorePill score={m.traction_score} small />
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(m.key_metrics).map(([k, v]) => <span key={k} className="bg-gray-100 px-1.5 py-0.5 rounded">{k}: {String(v)}</span>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GatesTab({ data, canEdit, onDecide, busy }) {
  if (data.gates.length === 0) return <Empty text="No decision gates triggered yet. Capture metrics, then click 'Trigger AI Review'." />;
  return (
    <div className="space-y-3">
      {data.gates.map(g => (
        <div key={g.id} className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="text-xs text-gray-500">{new Date(g.created_at).toLocaleString()}</div>
              <div className="font-semibold text-sm flex items-center gap-2 mt-1">
                <Sparkles size={14} className="text-violet-500" /> AI: <span className="uppercase text-violet-700">{(g.ai_recommendation || '').replace('_', ' ')}</span>
              </div>
            </div>
            <span className={`text-[10px] px-2 py-1 rounded font-medium ${
              g.status === 'pending' ? 'bg-amber-100 text-amber-700' :
              g.status === 'passed' ? 'bg-emerald-100 text-emerald-700' :
              g.status === 'failed' ? 'bg-red-100 text-red-700' :
              'bg-orange-100 text-orange-700'
            }`}>{g.status.toUpperCase()}</span>
          </div>
          {g.ai_explanation && <p className="text-xs text-gray-700 italic bg-violet-50 border border-violet-100 rounded p-2 mb-3">{g.ai_explanation}</p>}
          {g.status === 'pending' && canEdit && (
            <div className="flex gap-2">
              <button onClick={() => onDecide(g.id, 'passed')} disabled={busy} className="flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-3 py-1.5 rounded"><CheckCircle2 size={12} /> Spin-Out</button>
              <button onClick={() => onDecide(g.id, 'iterate')} disabled={busy} className="flex items-center gap-1 text-xs bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white px-3 py-1.5 rounded"><RotateCcw size={12} /> Iterate</button>
              <button onClick={() => onDecide(g.id, 'failed')} disabled={busy} className="flex items-center gap-1 text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded"><AlertTriangle size={12} /> Kill</button>
            </div>
          )}
          {g.final_decision && <div className="text-xs text-gray-700 mt-2">Final decision: <span className="font-bold uppercase">{g.final_decision}</span></div>}
        </div>
      ))}
    </div>
  );
}

function CreateModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', sector: '', description: '', problem_statement: '', solution: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!form.name) { setErr('Name required'); return; }
    setBusy(true); setErr('');
    try { await api.pipelineCreateProject(form); onCreated(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between"><h2 className="text-lg font-semibold">New Pipeline Project</h2><button onClick={onClose} className="text-gray-500 hover:text-gray-900"><X size={18} /></button></div>
        <div className="p-6 space-y-3">
          <Field label="Name *"><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className={inputCls} /></Field>
          <Field label="Sector"><input value={form.sector} onChange={e => setForm({...form, sector: e.target.value})} className={inputCls} placeholder="fintech / saas / health / etc." /></Field>
          <Field label="Description"><textarea rows={2} value={form.description} onChange={e => setForm({...form, description: e.target.value})} className={inputCls} /></Field>
          <Field label="Problem"><textarea rows={2} value={form.problem_statement} onChange={e => setForm({...form, problem_statement: e.target.value})} className={inputCls} /></Field>
          <Field label="Solution"><textarea rows={2} value={form.solution} onChange={e => setForm({...form, solution: e.target.value})} className={inputCls} /></Field>
          {err && <div className="text-xs text-red-600">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="text-sm text-gray-700 hover:bg-gray-100 px-4 py-2 rounded-lg">Cancel</button>
            <button onClick={submit} disabled={busy} className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg">
              {busy ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />} Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-violet-500 focus:outline-none';
function Field({ label, children }) { return <div><label className="text-xs text-gray-700 font-medium block mb-1">{label}</label>{children}</div>; }
function KV({ k, v }) { return <div className="bg-gray-50 rounded-lg p-2"><div className="text-[10px] uppercase text-gray-500">{k}</div><div className="text-sm font-medium text-gray-900 truncate">{String(v)}</div></div>; }
function Empty({ text }) { return <div className="text-xs text-gray-500 py-6 text-center">{text}</div>; }
function Loading({ text }) { return <div className="flex items-center gap-2 text-sm text-gray-500 py-12 justify-center"><Loader2 className="animate-spin" size={16} /> {text}</div>; }
function ScorePill({ score, small }) {
  const c = score >= 70 ? 'bg-emerald-100 text-emerald-700' : score >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600';
  return <span className={`${small ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'} font-bold rounded ${c}`}>{Math.round(score)}</span>;
}
