// Task #68 — Public Job Board: create / edit a role.
// Mirrors EventEditorPage: gray palette, useToast, no nav wrapper. Draft roles
// are edited freely; "Submit for review" sends them to the admin publish queue.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import { jobs as jobsApi, api } from '../../lib/api';
import { useToast } from '../../components/useToast';

const EMPLOYMENT_TYPES = [
  { id: 'full_time', label: 'Full-time' },
  { id: 'part_time', label: 'Part-time' },
  { id: 'intern', label: 'Internship' },
  { id: 'contract', label: 'Contract' },
];
const SENIORITIES = [
  { id: 'intern', label: 'Intern' },
  { id: 'junior', label: 'Junior' },
  { id: 'mid', label: 'Mid-level' },
  { id: 'senior', label: 'Senior' },
  { id: 'lead', label: 'Lead' },
  { id: 'executive', label: 'Executive' },
];
const JOB_STATUS_LABELS = {
  draft: 'Draft', pending_review: 'In review', published: 'Published', rejected: 'Needs changes', closed: 'Closed',
};

const EMPTY = {
  title: '', employment_type: 'full_time', seniority: 'mid', location_text: '',
  remote: false, summary: '', description: '', project_id: '',
};

export default function JobEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, showToast } = useToast();
  const isEdit = Boolean(id);

  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState('draft');
  const [reviewNotes, setReviewNotes] = useState('');
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    // Best-effort project list for the optional "post against a startup" picker.
    api.listProjects().then((res) => {
      const list = Array.isArray(res) ? res : (res?.projects || []);
      setProjects(list);
    }).catch(() => setProjects([]));

    if (!isEdit) return;
    setLoading(true);
    try {
      const res = await jobsApi.get(id);
      const j = res?.job;
      if (j) {
        setForm({
          title: j.title || '',
          employment_type: j.employment_type || 'full_time',
          seniority: j.seniority || 'mid',
          location_text: j.location_text || '',
          remote: !!j.remote,
          summary: j.summary || '',
          description: j.description || '',
          project_id: j.project_id != null ? String(j.project_id) : '',
        });
        setStatus(j.status || 'draft');
        setReviewNotes(j.review_notes || '');
      }
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not load this role.' });
    } finally {
      setLoading(false);
    }
  }, [id, isEdit, showToast]);

  useEffect(() => { load(); }, [load]);

  const buildPayload = () => ({
    title: form.title.trim(),
    employment_type: form.employment_type,
    seniority: form.seniority,
    location_text: form.location_text.trim() || null,
    remote: form.remote,
    summary: form.summary.trim() || null,
    description: form.description.trim() || null,
    project_id: form.project_id ? Number(form.project_id) : null,
  });

  // Returns the posting id on success, or null on failure.
  const persist = async () => {
    if (!form.title.trim()) {
      showToast({ kind: 'error', msg: 'A role title is required.' });
      return null;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      if (isEdit) {
        await jobsApi.update(id, payload);
        return id;
      }
      const res = await jobsApi.create(payload);
      return res?.job?.id ?? null;
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not save this role.' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const onSave = async () => {
    const savedId = await persist();
    if (savedId) {
      showToast({ kind: 'success', msg: 'Role saved.' });
      navigate('/my/jobs');
    }
  };

  const onSubmitReview = async () => {
    const savedId = await persist();
    if (!savedId) return;
    try {
      await jobsApi.submitReview(savedId);
      showToast({ kind: 'success', msg: 'Role submitted for review.' });
      navigate('/my/jobs');
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not submit for review.' });
    }
  };

  const canSubmitForReview = !isEdit || status === 'draft' || status === 'rejected';

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 text-gray-500">Loading…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      {toast ? (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${toast.kind === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
          {toast.msg}
        </div>
      ) : null}

      <button onClick={() => navigate('/my/jobs')} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 mb-4">
        <ArrowLeft size={16} /> Back to my roles
      </button>

      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{isEdit ? 'Edit role' : 'New role'}</h1>
        {isEdit ? (
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{JOB_STATUS_LABELS[status] || status}</span>
        ) : null}
      </div>

      {status === 'rejected' && reviewNotes ? (
        <div className="mb-6 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          <span className="font-medium">Reviewer note:</span> {reviewNotes}
        </div>
      ) : null}

      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Role title <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder="e.g. Founding Engineer"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Employment type</label>
            <select
              value={form.employment_type}
              onChange={(e) => setField('employment_type', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {EMPLOYMENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Seniority</label>
            <select
              value={form.seniority}
              onChange={(e) => setField('seniority', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {SENIORITIES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location</label>
            <input
              type="text"
              value={form.location_text}
              onChange={(e) => setField('location_text', e.target.value)}
              placeholder="e.g. San Francisco, CA"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <label className="flex items-center gap-2 mt-7 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={form.remote}
              onChange={(e) => setField('remote', e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-700 text-blue-600 focus:ring-blue-500"
            />
            Remote friendly
          </label>
        </div>

        {projects.length > 0 ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Startup (optional)</label>
            <select
              value={form.project_id}
              onChange={(e) => setField('project_id', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— None —</option>
              {projects.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
          </div>
        ) : null}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Summary</label>
          <input
            type="text"
            value={form.summary}
            onChange={(e) => setField('summary', e.target.value)}
            placeholder="One-line pitch shown on the job board"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
          <textarea
            rows={10}
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
            placeholder="Responsibilities, requirements, what you're looking for…"
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null} Save draft
          </button>
          {canSubmitForReview ? (
            <button
              onClick={onSubmitReview}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Send size={16} /> Submit for review
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
