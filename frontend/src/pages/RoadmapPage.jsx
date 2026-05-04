import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, AlertCircle, Save, X, Target, ArrowRight, FolderPlus } from 'lucide-react';
import { api } from '../lib/api';

const COLUMNS = [
  { key: 'now', label: 'Now', tone: 'border-violet-300 bg-violet-50' },
  { key: 'next', label: 'Next', tone: 'border-blue-300 bg-blue-50' },
  { key: 'later', label: 'Later', tone: 'border-gray-300 bg-gray-50' },
  { key: 'done', label: 'Done', tone: 'border-emerald-300 bg-emerald-50' },
];

function emptyOkr() {
  return {
    objective: '',
    key_results: [{ text: '', target: '', current: '', unit: '' }],
    kanban_status: 'now',
    quarter: '',
    sort_order: 0,
  };
}

export default function RoadmapPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [okrs, setOkrs] = useState([]);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listProjects();
        const safeList = list || [];
        setProjects(safeList);
        const fromQuery = parseInt(searchParams.get('project_id'), 10);
        if (fromQuery && safeList.find((p) => p.id === fromQuery)) {
          setProjectId(fromQuery);
        } else if (safeList.length > 0) {
          // Stale ?project_id in URL — silently fall back to the first
          // available project rather than splashing a 404 banner.
          if (fromQuery) setSearchParams({}, { replace: true });
          setProjectId(safeList[0].id);
        }
      } catch (e) { setError(e.message); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setSearchParams({ project_id: String(projectId) }, { replace: true });
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function refresh() {
    if (!projectId) return;
    try {
      setError(null);
      const r = await api.listOkrs(projectId);
      setOkrs(r.okrs || []);
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg.includes('not found')) {
        setOkrs([]);
        setError(`Project #${projectId} is no longer available. Pick another project from the dropdown.`);
      } else {
        setError(e.message || 'Failed to load roadmap.');
      }
    }
  }

  async function handleSave() {
    try {
      const payload = {
        ...editing,
        key_results: (editing.key_results || []).filter((kr) => kr.text.trim()).map((kr) => ({
          text: kr.text,
          target: kr.target === '' || kr.target === null ? null : Number(kr.target),
          current: kr.current === '' || kr.current === null ? null : Number(kr.current),
          unit: kr.unit || null,
        })),
        sort_order: editing.sort_order || 0,
      };
      if (editing.id) await api.updateOkr(editing.id, payload);
      else await api.createOkr(projectId, payload);
      setEditing(null);
      await refresh();
    } catch (e) { setError(e.message); }
  }

  async function handleMove(okr, status) {
    try {
      await api.moveOkr(okr.id, status, okr.sort_order || 0);
      await refresh();
    } catch (e) { setError(e.message); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this OKR?')) return;
    try {
      await api.deleteOkr(id);
      await refresh();
    } catch (e) { setError(e.message); }
  }

  function nextColumn(status) {
    const order = ['now', 'next', 'later', 'done'];
    const i = order.indexOf(status);
    return i < order.length - 1 ? order[i + 1] : null;
  }

  const hasProjects = projects.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Roadmap</h1>
          <p className="text-sm text-gray-500 mt-1">Now / Next / Later kanban with OKR-style key results.</p>
        </div>
        <div className="flex gap-2">
          <select
            value={projectId || ''}
            onChange={(e) => setProjectId(parseInt(e.target.value, 10))}
            disabled={!hasProjects}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400"
          >
            {!hasProjects && <option value="">No projects available</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            onClick={() => setEditing(emptyOkr())}
            disabled={!projectId}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:hover:bg-violet-600"
          >
            <Plus size={14} /> Add OKR
          </button>
        </div>
      </div>

      {error && <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm"><AlertCircle size={16} className="mt-0.5" />{error}</div>}

      {!hasProjects && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center">
          <FolderPlus size={32} className="mx-auto text-gray-400 mb-3" />
          <h2 className="text-base font-semibold text-gray-900">No projects yet</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            The roadmap is scoped to a project. Create or join one first, then come back here to plan OKRs across Now / Next / Later.
          </p>
          <Link
            to="/projects"
            className="inline-flex items-center gap-2 mt-4 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 text-sm font-medium"
          >
            <Plus size={14} /> Go to Projects
          </Link>
        </div>
      )}

      {hasProjects && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const items = okrs.filter((o) => o.kanban_status === col.key);
          return (
            <div key={col.key} className={`rounded-xl border-2 border-dashed ${col.tone} p-3 min-h-[200px]`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">{col.label}</h3>
                <span className="text-xs text-gray-500">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.length === 0 && <div className="text-xs text-gray-400 italic text-center py-4">No items</div>}
                {items.map((o) => {
                  const next = nextColumn(o.kanban_status);
                  return (
                    <div key={o.id} className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-1.5">
                            <Target size={13} className="text-violet-500 mt-0.5 flex-shrink-0" />
                            <span className="text-sm font-medium text-gray-900 break-words">{o.objective}</span>
                          </div>
                          {o.quarter && <div className="text-[10px] text-gray-400 mt-1 ml-5">{o.quarter}</div>}
                        </div>
                        <button onClick={() => handleDelete(o.id)} className="text-gray-400 hover:text-rose-600 p-0.5"><Trash2 size={12} /></button>
                      </div>
                      {(o.key_results || []).length > 0 && (
                        <ul className="mt-2 ml-5 space-y-1">
                          {o.key_results.map((kr, idx) => {
                            let pct = null;
                            if (kr.target && Number(kr.target) !== 0 && kr.current !== null && kr.current !== undefined) {
                              pct = Math.max(0, Math.min(1, Number(kr.current) / Number(kr.target)));
                            }
                            return (
                              <li key={idx} className="text-xs text-gray-600">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">{kr.text}</span>
                                  {kr.target !== null && kr.target !== undefined && (
                                    <span className="text-gray-400 tabular-nums whitespace-nowrap">
                                      {kr.current ?? 0} / {kr.target} {kr.unit || ''}
                                    </span>
                                  )}
                                </div>
                                {pct !== null && (
                                  <div className="h-1 bg-gray-100 rounded-full mt-0.5 overflow-hidden">
                                    <div className="h-full bg-violet-500" style={{ width: `${pct * 100}%` }} />
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {o.progress !== null && (
                        <div className="text-[10px] text-gray-400 mt-2 ml-5">Overall {Math.round(o.progress * 100)}%</div>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-1">
                        <button onClick={() => setEditing(o)} className="text-xs text-violet-600 hover:underline">Edit</button>
                        {next && (
                          <button onClick={() => handleMove(o, next)} className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1">
                            Move to {next} <ArrowRight size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {editing && <OkrModal value={editing} onChange={setEditing} onSave={handleSave} onClose={() => setEditing(null)} />}
    </div>
  );
}

function OkrModal({ value, onChange, onSave, onClose }) {
  function setKR(idx, patch) {
    const next = [...value.key_results];
    next[idx] = { ...next[idx], ...patch };
    onChange({ ...value, key_results: next });
  }
  function addKR() {
    onChange({ ...value, key_results: [...value.key_results, { text: '', target: '', current: '', unit: '' }] });
  }
  function removeKR(idx) {
    onChange({ ...value, key_results: value.key_results.filter((_, i) => i !== idx) });
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white">
          <h2 className="text-base font-semibold text-gray-900">{value.id ? 'Edit OKR' : 'New OKR'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">Objective</label>
            <textarea rows={2} value={value.objective} onChange={(e) => onChange({ ...value, objective: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" placeholder="What we want to achieve" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">Column</label>
              <select value={value.kanban_status} onChange={(e) => onChange({ ...value, kanban_status: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm">
                {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">Quarter (optional)</label>
              <input value={value.quarter || ''} onChange={(e) => onChange({ ...value, quarter: e.target.value })} placeholder="2026-Q2" className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase tracking-wide text-gray-500">Key results</label>
              <button onClick={addKR} className="text-xs text-violet-600 hover:text-violet-700 font-medium flex items-center gap-1"><Plus size={12} /> Add</button>
            </div>
            <div className="space-y-2">
              {value.key_results.map((kr, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input placeholder="Measurable result" value={kr.text} onChange={(e) => setKR(idx, { text: e.target.value })} className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm" />
                    <button onClick={() => removeKR(idx)} className="text-rose-500 hover:text-rose-700 p-1"><Trash2 size={14} /></button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input type="number" placeholder="Current" value={kr.current ?? ''} onChange={(e) => setKR(idx, { current: e.target.value })} className="border border-gray-200 rounded-md px-2 py-1 text-xs" />
                    <input type="number" placeholder="Target" value={kr.target ?? ''} onChange={(e) => setKR(idx, { target: e.target.value })} className="border border-gray-200 rounded-md px-2 py-1 text-xs" />
                    <input placeholder="Unit (e.g. users)" value={kr.unit || ''} onChange={(e) => setKR(idx, { unit: e.target.value })} className="border border-gray-200 rounded-md px-2 py-1 text-xs" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={onSave} disabled={!value.objective.trim()} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-2"><Save size={14} /> Save</button>
        </div>
      </div>
    </div>
  );
}
