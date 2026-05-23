import React, { useEffect, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';
import { reportError } from '../lib/log';

// Task #14 — Customer Discovery now persists via the worker's
// /api/progress/discovery API instead of localStorage. Interviews are
// stored against the user's first project; the first three successful
// saves still fire the `customer_interview_logged_1|_2|_3` Spin-Out Lab
// milestones (Task #13). Admins / founders without a project see a
// friendly empty state telling them to create one first.
export default function CustomerDiscoveryPage() {
  const { user } = useAuth();
  const [projectId, setProjectId] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [form, setForm] = useState({ title: '', contact: '', notes: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = (await api.listProjects()) || [];
        if (cancelled) return;
        if (list.length === 0) {
          setProjectId(null);
          setInterviews([]);
          setLoading(false);
          return;
        }
        const pid = list[0].id;
        setProjectId(pid);
        const res = await api.listInterviews(pid);
        if (cancelled) return;
        setInterviews(res?.interviews || []);
      } catch (e) {
        if (cancelled) return;
        const msg = (e?.message || '').toLowerCase();
        if (e?.status === 404 || msg.includes('not found')) {
          setProjectId(null);
          setInterviews([]);
        } else {
          setError(e.message || 'Failed to load interviews.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const onSave = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !projectId) return;
    setSaving(true);
    setError(null);
    try {
      // Map this page's lightweight fields onto the worker's interview
      // schema: `title` -> interviewee_name, `contact` -> interviewee_role,
      // free-form `notes` -> notes. Hypotheses/pains stay empty here — the
      // richer DiscoveryPage covers that.
      const payload = {
        interviewee_name: form.title.trim(),
        interviewee_role: form.contact.trim() || null,
        notes: form.notes.trim(),
      };
      const created = await api.createInterview(projectId, payload);
      const next = [created, ...interviews];
      setInterviews(next);
      setForm({ title: '', contact: '', notes: '' });

      // Fire the milestone for the N-th save (N = 1..3).
      const n = next.length;
      if (n >= 1 && n <= 3) {
        await markMilestone(user, `customer_interview_logged_${n}`);
      }
    } catch (err) {
      reportError('CustomerDiscoveryPage:create', err);
      setError(err?.message || 'Failed to save interview.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id) => {
    const prev = interviews;
    setInterviews(interviews.filter((i) => i.id !== id));
    try {
      await api.deleteInterview(id);
    } catch (err) {
      reportError('CustomerDiscoveryPage:delete', err);
      setError(err?.message || 'Failed to delete interview.');
      setInterviews(prev);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2 dark:text-gray-100">
          <MessageSquare className="text-violet-600" size={22} /> Customer Discovery
        </h1>
        <PageExplainer pageKey="customer_discovery" />
        <p className="text-sm text-gray-600 mt-1">
          Log your customer conversations as you go. Three logged interviews
          unlocks the next week of the Spin-Out Lab.
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
          {error}
        </div>
      )}

      {!loading && !projectId ? (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-600 dark:bg-gray-900 dark:border-gray-800">
          You need a project before you can log interviews. Create one from
          your dashboard, then come back here.
        </div>
      ) : (
        <>
          <form onSubmit={onSave} className="bg-white border border-gray-200 rounded-xl p-5 mb-6 space-y-3 dark:bg-gray-900 dark:border-gray-800">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Title</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Convo with VP Eng @ Acme"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Contact</label>
              <input
                value={form.contact}
                onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
                placeholder="Name, role, company, email…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1 dark:text-gray-300">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={4}
                placeholder="What did they say? Pains, current workflow, willingness to pay…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:border-gray-800"
              />
            </div>
            <button
              type="submit"
              disabled={saving || loading || !form.title.trim() || !projectId}
              className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
            >
              <Plus size={14} /> {saving ? 'Saving…' : 'Log interview'}
            </button>
          </form>

          <div className="bg-white border border-gray-200 rounded-xl dark:bg-gray-900 dark:border-gray-800">
            <div className="px-5 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:text-gray-100">
              Logged interviews ({interviews.length})
            </div>
            {loading ? (
              <div className="px-5 py-10 text-center text-sm text-gray-500">Loading…</div>
            ) : interviews.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-500">
                No interviews yet — log your first one above.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {interviews.map((i) => (
                  <li key={i.id} className="px-5 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{i.interviewee_name}</div>
                      {i.interviewee_role && (
                        <div className="text-xs text-gray-500 mt-0.5">{i.interviewee_role}</div>
                      )}
                      {i.notes && (
                        <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{i.notes}</div>
                      )}
                      <div className="text-[11px] text-gray-400 mt-1">
                        {i.created_at ? new Date(i.created_at).toLocaleString() : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => onDelete(i.id)}
                      className="text-gray-400 hover:text-rose-600 p-1"
                      aria-label="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
