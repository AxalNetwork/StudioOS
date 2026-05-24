import React, { useState, useEffect, useMemo } from 'react';
import PageExplainer from '../components/PageExplainer';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2, MessageSquare, CheckCircle2, XCircle, HelpCircle, AlertCircle, Save, X, FolderPlus, Star } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';

const STATUSES = [
  { value: 'validated', label: 'Validated', icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { value: 'invalidated', label: 'Invalidated', icon: XCircle, tone: 'text-rose-600 bg-rose-50 border-rose-200' },
  { value: 'inconclusive', label: 'Inconclusive', icon: HelpCircle, tone: 'text-gray-600 bg-gray-50 border-gray-200' },
];

function emptyInterview() {
  return {
    interviewee_name: '',
    interviewee_role: '',
    interview_date: new Date().toISOString().slice(0, 10),
    notes: '',
    hypotheses: [{ hypothesis: '', status: 'inconclusive', evidence: '' }],
    pains: [],
    featured: false,
  };
}

export default function DiscoveryPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [signals, setSignals] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);
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
          if (fromQuery) setSearchParams({}, { replace: true });
          setProjectId(safeList[0].id);
        }
      } catch (e) {
        // Defensive 404 — backend may return "Not found" when the user has
        // no project scope yet. Treat as the same "no projects" empty state
        // rendered below; don't surface a raw red banner.
        const msg = (e?.message || '').toLowerCase();
        if (e?.status === 404 || msg.includes('not found')) {
          setProjects([]);
        } else {
          setError(e.message || 'Failed to load projects.');
        }
      }
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
    setLoading(true);
    setError(null);
    try {
      const [r1, r2] = await Promise.all([
        api.listInterviews(projectId),
        api.getProgressSignals(projectId),
      ]);
      setInterviews(r1.interviews || []);
      setSignals(r2);
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg.includes('not found')) {
        setInterviews([]);
        setSignals(null);
        setError(`Project #${projectId} is no longer available. Pick another project from the dropdown.`);
      } else {
        setError(e.message || 'Failed to load discovery data.');
      }
    }
    finally { setLoading(false); }
  }

  async function handleSave() {
    try {
      const payload = {
        ...editing,
        hypotheses: editing.hypotheses.filter((h) => (h.hypothesis || '').trim()),
        pains: editing.pains.filter((p) => (p || '').trim()),
      };
      const isCreate = !editing.id;
      const priorCount = interviews.length;
      if (editing.id) await api.updateInterview(editing.id, payload);
      else await api.createInterview(projectId, payload);
      setEditing(null);
      await refresh();
      // Spin-Out Lab W1 — fire `customer_interview_logged_{1,2,3}` for the
      // first three interviews on this project. priorCount was captured
      // pre-refresh; +1 is the ordinal of the just-created row. Worker
      // dedups milestone keys, so re-firing is harmless. The hook is
      // wrapped in its own try/catch so a milestone-write failure never
      // surfaces as "Failed to save interview" after a successful save.
      if (isCreate) {
        const n = priorCount + 1;
        if (n >= 1 && n <= 3) {
          try {
            await markMilestone(user, `customer_interview_logged_${n}`);
          } catch {
            // markMilestone is already best-effort, but defend against
            // any future change to its contract.
          }
        }
      }
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg.includes('not found')) {
        setError(`Can't save: project #${projectId} or this interview is no longer available. Refresh and try again.`);
      } else {
        setError(e.message || 'Failed to save interview.');
      }
    }
  }

  // Task #18 — toggle the "star for Demo Day deck" flag straight from
  // the card. We send the full interview payload because the PUT
  // endpoint expects the standard create/update shape; the worker
  // preserves any field we omit. Optimistic update so the star feels
  // instant even if the round-trip is slow.
  async function handleToggleFeatured(interview) {
    const next = !interview.featured;
    setInterviews((prev) => prev.map((it) => (it.id === interview.id ? { ...it, featured: next } : it)));
    try {
      await api.updateInterview(interview.id, {
        interviewee_name: interview.interviewee_name,
        interviewee_role: interview.interviewee_role || '',
        interview_date: interview.interview_date,
        notes: interview.notes || '',
        hypotheses: interview.hypotheses || [],
        pains: interview.pains || [],
        featured: next,
      });
    } catch (e) {
      // Revert optimistic update on failure.
      setInterviews((prev) => prev.map((it) => (it.id === interview.id ? { ...it, featured: !next } : it)));
      setError(e.message || 'Failed to update interview.');
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this interview?')) return;
    try {
      await api.deleteInterview(id);
      await refresh();
    } catch (e) {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg.includes('not found')) {
        // Already gone — refresh to drop it from the list, no banner needed.
        await refresh();
      } else {
        setError(e.message || 'Failed to delete interview.');
      }
    }
  }

  const stats = useMemo(() => {
    let v = 0, inv = 0, h = 0;
    for (const i of interviews) {
      for (const x of (i.hypotheses || [])) {
        h += 1;
        if (x.status === 'validated') v += 1;
        if (x.status === 'invalidated') inv += 1;
      }
    }
    return { interviews: interviews.length, hypotheses: h, validated: v, invalidated: inv };
  }, [interviews]);

  const hasProjects = projects.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Customer Discovery</h1>
        <PageExplainer pageKey="customer_discovery" />
          <p className="text-sm text-gray-500 mt-1">Mom-Test interview log. Each validated hypothesis lifts the traction signals score.</p>
        </div>
        <div className="flex gap-2">
          <select
            value={projectId || ''}
            onChange={(e) => setProjectId(parseInt(e.target.value, 10))}
            disabled={!hasProjects}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900"
          >
            {!hasProjects && <option value="">No projects available</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button
            onClick={() => setEditing(emptyInterview())}
            disabled={!projectId}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:hover:bg-violet-600"
          >
            <Plus size={14} /> Log interview
          </button>
        </div>
      </div>

      {error && <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3 text-sm"><AlertCircle size={16} className="mt-0.5" />{error}</div>}

      {!hasProjects && (
        <div className="bg-white border border-dashed border-gray-300 rounded-xl p-10 text-center dark:bg-gray-900 dark:border-gray-700">
          <FolderPlus size={32} className="mx-auto text-gray-400 mb-3" />
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">No projects yet</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            Customer discovery is scoped to a project. Create or join one first, then log Mom-Test interviews to start validating hypotheses.
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Interviews" value={stats.interviews} />
        <Stat label="Hypotheses tested" value={stats.hypotheses} />
        <Stat label="Validated" value={stats.validated} tone="emerald" />
        <Stat label="Signals score" value={signals ? `${signals.factors.signals.points} / ${signals.factors.signals.max}` : '—'} sub="Feeds traction" tone="violet" />
      </div>
      )}

      {hasProjects && loading && <div className="text-sm text-gray-500">Loading…</div>}

      {hasProjects && (
      <div className="space-y-3">
        {interviews.length === 0 && !loading && (
          <div className="bg-white border border-dashed border-gray-300 rounded-xl p-8 text-center text-gray-500 text-sm dark:bg-gray-900 dark:border-gray-700">
            <MessageSquare size={28} className="mx-auto text-gray-300 mb-2" />
            No interviews yet. Log your first one to start building validated hypotheses.
          </div>
        )}
        {interviews.map((i) => (
          <div key={i.id} className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{i.interviewee_name}</span>
                  {i.interviewee_role && <span className="text-gray-500">· {i.interviewee_role}</span>}
                  <span className="text-xs text-gray-400">· {i.interview_date}</span>
                </div>
                {i.notes && <p className="text-sm text-gray-600 mt-1 whitespace-pre-line line-clamp-3">{i.notes}</p>}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleToggleFeatured(i)}
                  title={i.featured ? 'Starred for Demo Day deck — click to unstar' : 'Star this quote for the Demo Day deck'}
                  aria-label={i.featured ? 'Unstar interview for Demo Day deck' : 'Star interview for Demo Day deck'}
                  aria-pressed={!!i.featured}
                  className={`p-1 rounded ${i.featured ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-amber-500'}`}
                >
                  <Star size={16} fill={i.featured ? 'currentColor' : 'none'} />
                </button>
                <button onClick={() => setEditing(i)} className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 dark:border-gray-800">Edit</button>
                <button onClick={() => handleDelete(i.id)} className="text-rose-500 hover:text-rose-700 p-1"><Trash2 size={14} /></button>
              </div>
            </div>
            {(i.hypotheses || []).length > 0 && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {i.hypotheses.map((h, idx) => {
                  const meta = STATUSES.find((s) => s.value === h.status) || STATUSES[2];
                  const Icon = meta.icon;
                  return (
                    <div key={idx} className={`border rounded-lg p-2 text-xs ${meta.tone}`}>
                      <div className="flex items-center gap-1.5 font-medium"><Icon size={12} /> {meta.label}</div>
                      <div className="text-gray-700 mt-1 dark:text-gray-300">{h.hypothesis}</div>
                      {h.evidence && <div className="text-gray-500 mt-1 italic">“{h.evidence}”</div>}
                    </div>
                  );
                })}
              </div>
            )}
            {(i.pains || []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {i.pains.map((p, idx) => <span key={idx} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">Pain: {p}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>
      )}

      {editing && <InterviewModal value={editing} onChange={setEditing} onSave={handleSave} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Stat({ label, value, sub, tone = 'gray' }) {
  const tones = { gray: 'text-gray-900', emerald: 'text-emerald-600', violet: 'text-violet-600' };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 dark:bg-gray-900 dark:border-gray-800">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

function InterviewModal({ value, onChange, onSave, onClose }) {
  function setH(idx, patch) {
    const next = [...value.hypotheses];
    next[idx] = { ...next[idx], ...patch };
    onChange({ ...value, hypotheses: next });
  }
  function addH() {
    onChange({ ...value, hypotheses: [...value.hypotheses, { hypothesis: '', status: 'inconclusive', evidence: '' }] });
  }
  function removeH(idx) {
    onChange({ ...value, hypotheses: value.hypotheses.filter((_, i) => i !== idx) });
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{value.id ? 'Edit interview' : 'Log new interview'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Interviewee name">
              <input value={value.interviewee_name} onChange={(e) => onChange({ ...value, interviewee_name: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
            </Field>
            <Field label="Role / context">
              <input value={value.interviewee_role || ''} onChange={(e) => onChange({ ...value, interviewee_role: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
            </Field>
            <Field label="Date">
              <input type="date" value={value.interview_date} onChange={(e) => onChange({ ...value, interview_date: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
            </Field>
            <Field label="Pain points (comma-separated)">
              <input value={(value.pains || []).join(', ')} onChange={(e) => onChange({ ...value, pains: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm dark:border-gray-700" />
            </Field>
          </div>
          <Field label="Notes (Mom-Test style — what they did, not what they say they'd do)">
            <textarea rows={4} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm dark:border-gray-700" />
          </Field>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase tracking-wide text-gray-500">Hypotheses</label>
              <button onClick={addH} className="text-xs text-violet-600 hover:text-violet-700 font-medium flex items-center gap-1"><Plus size={12} /> Add</button>
            </div>
            <div className="space-y-2">
              {value.hypotheses.map((h, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-2 dark:border-gray-800">
                  <div className="flex items-center gap-2">
                    <input placeholder="We believe that…" value={h.hypothesis} onChange={(e) => setH(idx, { hypothesis: e.target.value })} className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-sm dark:border-gray-700" />
                    <select value={h.status} onChange={(e) => setH(idx, { status: e.target.value })} className="border border-gray-300 rounded-md px-2 py-1 text-sm dark:border-gray-700">
                      {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    <button onClick={() => removeH(idx)} className="text-rose-500 hover:text-rose-700 p-1"><Trash2 size={14} /></button>
                  </div>
                  <input placeholder="Evidence / direct quote" value={h.evidence || ''} onChange={(e) => setH(idx, { evidence: e.target.value })} className="w-full border border-gray-200 rounded-md px-2 py-1 text-xs italic dark:border-gray-800" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 sticky bottom-0 bg-white dark:border-gray-800 dark:bg-gray-900">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 dark:border-gray-700">Cancel</button>
          <button onClick={onSave} disabled={!value.interviewee_name.trim()} className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-2"><Save size={14} /> Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}
