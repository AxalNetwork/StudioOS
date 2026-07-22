// Task #13 — MVP Scope prioritization (Spin-Out Lab · Roadmap module).
// Value-ranked planning: each feature is rated by added value (High/Medium/Low)
// and effort (S/M/L/XL); the scope tier and cycle assignment are DERIVED from
// value — priority is derived, not chosen. High → Core / active cycle,
// Medium → v2 / next-cycle candidate, Low → out of scope / deferred.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, ListChecks, Loader2, Plus, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';

const VALUE_OPTS = ['High', 'Medium', 'Low'];
const EFFORT_OPTS = ['S', 'M', 'L', 'XL'];
const STATUS_OPTS = ['Backlog', 'In Progress', 'Review', 'Done', 'Blocked'];

const VALUE_BADGE = {
  High: 'bg-emerald-100 text-emerald-700',
  Medium: 'bg-amber-100 text-amber-700',
  Low: 'bg-gray-100 text-gray-500',
};
const TIER_BADGE = {
  Core: 'bg-violet-100 text-violet-700',
  v2: 'bg-blue-100 text-blue-700',
  'Out of scope': 'bg-gray-100 text-gray-500',
};
const STATUS_BADGE = {
  Done: 'bg-emerald-100 text-emerald-700',
  'In Progress': 'bg-amber-100 text-amber-700',
  Review: 'bg-blue-100 text-blue-700',
  Backlog: 'bg-gray-100 text-gray-600',
  Blocked: 'bg-rose-100 text-rose-700',
};

const GROUPS = [
  { value: 'High', dot: 'bg-emerald-500', label: 'Core · active cycle', sub: 'High value — feeds the current MVP build loop' },
  { value: 'Medium', dot: 'bg-blue-500', label: 'v2 · next cycle', sub: 'Medium value — candidates for the next cycle' },
  { value: 'Low', dot: 'bg-gray-400', label: 'Out of scope', sub: 'Low value — deferred from the MVP' },
];

const EMPTY_FORM = { title: '', added_value: 'High', effort: 'S', priority_reason: '' };

export default function MvpScopePanel({ projectId }) {
  const [features, setFeatures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const r = await api.listMvpFeatures(projectId);
      setFeatures(r.features || []);
    } catch (e) {
      reportError('mvp-scope:list', e);
      setError(e?.message || 'Could not load MVP priorities');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => {
    const by = (v) => features.filter((f) => f.added_value === v).length;
    return [
      { v: features.length, l: 'Features in scope review', cls: 'bg-gray-50 border-gray-200 text-gray-900' },
      { v: by('High'), l: 'Core — active cycle', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
      { v: by('Medium'), l: 'v2 — next cycle candidates', cls: 'bg-blue-50 border-blue-200 text-blue-700' },
      { v: by('Low'), l: 'Deferred from MVP', cls: 'bg-gray-50 border-gray-200 text-gray-500' },
    ];
  }, [features]);

  const highCount = summary[1].v;

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setModalOpen(true);
  }
  function openEdit(f) {
    setForm({
      title: f.title,
      added_value: f.added_value,
      effort: f.effort,
      priority_reason: f.priority_reason || '',
      delivery_status: f.delivery_status,
      sort_order: f.sort_order,
    });
    setEditingId(f.id);
    setModalOpen(true);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      if (editingId) await api.updateMvpFeature(editingId, form);
      else await api.createMvpFeature(projectId, form);
      setModalOpen(false);
      await load();
    } catch (e) {
      reportError('mvp-scope:save', e);
      setError(e?.message || 'Could not save feature');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(f, delivery_status) {
    try {
      await api.updateMvpFeature(f.id, {
        title: f.title,
        added_value: f.added_value,
        effort: f.effort,
        priority_reason: f.priority_reason,
        delivery_status,
        sort_order: f.sort_order,
      });
      setFeatures((prev) => prev.map((x) => (x.id === f.id ? { ...x, delivery_status } : x)));
    } catch (e) {
      reportError('mvp-scope:status', e);
      setError(e?.message || 'Could not update status');
    }
  }

  async function remove(id) {
    if (!confirm('Remove this feature from the MVP scope?')) return;
    try {
      await api.deleteMvpFeature(id);
      setFeatures((prev) => prev.filter((f) => f.id !== id));
    } catch (e) {
      reportError('mvp-scope:delete', e);
      setError(e?.message || 'Could not delete feature');
    }
  }

  if (!projectId) return null;

  return (
    <section
      aria-label="MVP Scope prioritization"
      className="bg-white border border-gray-200 rounded-2xl p-5 dark:bg-gray-900 dark:border-gray-800"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900 dark:text-gray-100">
          MVP priorities · <span className="text-violet-600">value-ranked planning</span>
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-medium text-gray-400">Value sets priority · top items feed the active cycle</span>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-full px-3 py-1.5"
          >
            <Plus size={12} /> Add feature
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-sm my-3">
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />{error}
        </div>
      )}

      {/* planning summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
        {summary.map((m) => (
          <div key={m.l} className={`border rounded-xl px-4 py-3 ${m.cls}`}>
            <div className="text-xl font-extrabold tabular-nums">{m.v}</div>
            <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">{m.l}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-500 text-sm">
          <Loader2 className="animate-spin mr-2" size={16} /> Loading MVP priorities…
        </div>
      ) : features.length === 0 ? (
        <div className="border border-dashed border-gray-300 rounded-xl p-8 text-center dark:border-gray-700">
          <ListChecks size={28} className="mx-auto text-gray-400 mb-2" />
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">No features ranked yet</div>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            Add each candidate MVP feature and rate its value — priority is derived automatically, so
            scope debates become value debates.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {GROUPS.map((g) => {
            const items = features.filter((f) => f.added_value === g.value);
            if (items.length === 0) return null;
            return (
              <div key={g.value}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full ${g.dot}`} />
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-700 dark:text-gray-300">{g.label}</span>
                  <span className="text-[11px] text-gray-400">{g.sub}</span>
                </div>
                <div className="space-y-2">
                  {items.map((f) => (
                    <div
                      key={f.id}
                      className={`border rounded-xl px-4 py-3 ${f.added_value === 'High' ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-white'} dark:bg-gray-900 dark:border-gray-800`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{f.title}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${TIER_BADGE[f.scope_tier] || 'bg-gray-100 text-gray-500'}`}>{f.scope_tier}</span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${VALUE_BADGE[f.added_value]}`}>{f.added_value} value</span>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">Effort {f.effort}</span>
                          </div>
                          {f.priority_reason && (
                            <p className="text-xs text-gray-600 mt-1 leading-relaxed dark:text-gray-400">{f.priority_reason}</p>
                          )}
                          <div className={`text-[11px] mt-1 font-medium ${f.added_value === 'High' ? 'text-emerald-700' : 'text-gray-400'}`}>
                            {f.cycle_assigned}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <select
                            value={f.delivery_status}
                            onChange={(e) => setStatus(f, e.target.value)}
                            aria-label={`Delivery status for ${f.title}`}
                            className={`text-[11px] font-semibold rounded-md border-0 px-1.5 py-1 cursor-pointer ${STATUS_BADGE[f.delivery_status] || 'bg-gray-100 text-gray-600'}`}
                          >
                            {STATUS_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <button onClick={() => openEdit(f)} className="text-xs text-violet-600 hover:underline">Edit</button>
                          <button onClick={() => remove(f.id)} aria-label={`Delete ${f.title}`} className="text-gray-400 hover:text-rose-600 p-0.5">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* roadmap → cycle handoff */}
      <div className="mt-5 border border-violet-200 bg-violet-50/60 rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap dark:bg-violet-950/30 dark:border-violet-900">
        <div className="flex items-center gap-2 text-xs text-violet-800 dark:text-violet-300">
          <ArrowRight size={14} className="flex-shrink-0" />
          <span>
            <span className="font-semibold">Roadmap → cycle handoff:</span>{' '}
            {highCount > 0
              ? `${highCount} high-value ${highCount === 1 ? 'priority feeds' : 'priorities feed'} the active MVP build cycle.`
              : 'Rate features High value to pull them into the active MVP build cycle.'}
          </span>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">
          High → active cycle · Medium → next · Low → deferred
        </span>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 pt-16 overflow-y-auto" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {editingId ? 'Edit MVP feature' : 'Add MVP feature'}
                </h3>
                <p className="text-[11px] text-gray-400 mt-0.5">Rate its value and effort — priority is derived, not chosen</p>
              </div>
              <button onClick={() => setModalOpen(false)} aria-label="Close" className="text-gray-500 hover:text-gray-700"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">Feature title</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Bulk export"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm dark:border-gray-700"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">Added value</label>
                <div className="flex gap-2">
                  {VALUE_OPTS.map((v) => (
                    <button
                      key={v}
                      onClick={() => setForm({ ...form, added_value: v })}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${
                        form.added_value === v
                          ? 'bg-violet-600 border-violet-600 text-white'
                          : 'bg-white border-gray-300 text-gray-600 hover:border-violet-300 dark:bg-gray-900 dark:border-gray-700'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">Effort</label>
                <div className="flex gap-2">
                  {EFFORT_OPTS.map((v) => (
                    <button
                      key={v}
                      onClick={() => setForm({ ...form, effort: v })}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${
                        form.effort === v
                          ? 'bg-violet-600 border-violet-600 text-white'
                          : 'bg-white border-gray-300 text-gray-600 hover:border-violet-300 dark:bg-gray-900 dark:border-gray-700'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-gray-500 block mb-1">Priority reason</label>
                <textarea
                  rows={2}
                  value={form.priority_reason}
                  onChange={(e) => setForm({ ...form, priority_reason: e.target.value })}
                  placeholder="Why does this matter now?"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-y dark:border-gray-700"
                />
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                High value → active cycle · Medium → next cycle · Low → v2 / out of scope. Applied
                automatically based on your rating.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-gray-800">
              <button onClick={() => setModalOpen(false)} className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 dark:border-gray-700">Cancel</button>
              <button
                onClick={save}
                disabled={!form.title.trim() || saving}
                className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white rounded-lg flex items-center gap-2"
              >
                {saving && <Loader2 className="animate-spin" size={13} />}
                {editingId ? 'Save changes' : 'Add to priorities'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
