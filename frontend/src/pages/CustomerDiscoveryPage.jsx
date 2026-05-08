import React, { useState } from 'react';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { safeReadJSON, safeWriteJSON } from '../lib/storage';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';

// Task #13 — Minimal Customer Discovery surface for the Spin-Out Lab.
//
// Server-backed customer discovery already exists for funded projects
// (DiscoveryPage / /api/progress/discovery). This page is the lightweight
// pre-incorporation entry point used during Week 1 of the Spin-Out Lab
// where the user may not yet have a project record. Interviews are stored
// in localStorage under `customer_interviews`. The first three saves fire
// the `customer_interview_logged_1|_2|_3` Lab milestones.
export default function CustomerDiscoveryPage() {
  const { user } = useAuth();
  const [interviews, setInterviews] = useState(() =>
    safeReadJSON('customer_interviews', []) || []
  );
  const [form, setForm] = useState({ title: '', contact: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const onSave = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    const entry = {
      id: Date.now(),
      title: form.title.trim(),
      contact: form.contact.trim(),
      notes: form.notes.trim(),
      created_at: new Date().toISOString(),
    };
    const next = [entry, ...interviews];
    setInterviews(next);
    safeWriteJSON('customer_interviews', next);
    setForm({ title: '', contact: '', notes: '' });

    // Fire the milestone for the N-th save (N = 1..3).
    const n = next.length;
    if (n >= 1 && n <= 3) {
      await markMilestone(user, `customer_interview_logged_${n}`);
    }
    setSaving(false);
  };

  const onDelete = (id) => {
    const next = interviews.filter((i) => i.id !== id);
    setInterviews(next);
    safeWriteJSON('customer_interviews', next);
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <MessageSquare className="text-violet-600" size={22} /> Customer Discovery
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Log your customer conversations as you go. Three logged interviews
          unlocks the next week of the Spin-Out Lab.
        </p>
      </div>

      <form onSubmit={onSave} className="bg-white border border-gray-200 rounded-xl p-5 mb-6 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Convo with VP Eng @ Acme"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Contact</label>
          <input
            value={form.contact}
            onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
            placeholder="Name, role, company, email…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={4}
            placeholder="What did they say? Pains, current workflow, willingness to pay…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={saving || !form.title.trim()}
          className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
        >
          <Plus size={14} /> Log interview
        </button>
      </form>

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="px-5 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900">
          Logged interviews ({interviews.length})
        </div>
        {interviews.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-500">
            No interviews yet — log your first one above.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {interviews.map((i) => (
              <li key={i.id} className="px-5 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">{i.title}</div>
                  {i.contact && <div className="text-xs text-gray-500 mt-0.5">{i.contact}</div>}
                  {i.notes && <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{i.notes}</div>}
                  <div className="text-[11px] text-gray-400 mt-1">
                    {new Date(i.created_at).toLocaleString()}
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
    </div>
  );
}
