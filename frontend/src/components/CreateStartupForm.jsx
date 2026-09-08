/**
 * Creating a startup, lifted out of `ProjectsPage` so `/projects` could retire.
 *
 * WHY THIS FILE EXISTS. Task #101 asked for `/projects` to be removed. It was
 * also the ONLY caller of `api.createProject` anywhere in `frontend/src`, so
 * deleting the page would have deleted the only way to create a startup — with
 * ten empty states across the app still saying "Create one →" and a Command
 * Palette entry called "Create startup" pointing at it. Nothing in CI would
 * have caught that: `check-api-drift.mjs` reads api.js -> worker and never the
 * other way, so an api.js method with no caller is invisible to it.
 *
 * So this follows the `/office-hours` retirement (task #8, UNRESOLVED_ITEMS U4):
 * move the unique capability first, then retire the route. The form is moved
 * VERBATIM rather than rewritten — three of its behaviours are load-bearing and
 * each was learned from a bug:
 *
 *   1. `refresh({ force: true })` after a successful create. The worker's
 *      `resolveFounderIdForCreate` may have just back-filled `users.founder_id`
 *      for a first-time founder; without bypassing `useAuthSync`'s 5-minute
 *      throttle, the founder cannot see edit or delete on the startup they just
 *      made.
 *   2. `markMilestone(user, 'project_created')`, which is what advances the
 *      Spin-out Lab week.
 *   3. The founder name/email inputs appear only for admin and partner. For a
 *      founder or investor the worker forces `founder_id` from the JWT, so the
 *      fields would be inputs that cannot affect the result.
 *
 * `Input` and `PitchInput` came with it: they were local to `ProjectsPage` and
 * `PitchInput` carries the pitch-copy length meter, which is not decoration —
 * it is the guidance that keeps a problem statement inside the length the deck
 * templates read.
 */
import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import SectorSelect from './SectorSelect';
import { api } from '../lib/api';
import { safeReadJSON } from '../lib/storage';
import { useAuth } from '../hooks/useAuthSync';
import { markMilestone } from '../lib/spinoutLabHooks';
import { getPitchCopyLengthStatus } from '../lib/pitchCopyLength';
import { useToast } from './useToast';

const EMPTY = {
  name: '', description: '', sector: '', founder_email: '',
  founder_name: '', problem_statement: '', solution: '',
};

function Input({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs text-gray-600 mb-1">{label}</label>
      <input
        type="text" value={value} onChange={e => onChange(e.target.value)}
        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:text-gray-100"
      />
    </div>
  );
}

function PitchInput({ label, fieldType, value, onChange }) {
  const status = getPitchCopyLengthStatus(value, fieldType);
  const toneColors = {
    neutral: { bar: 'bg-gray-300 dark:bg-gray-600', text: 'text-gray-500 dark:text-gray-400' },
    amber:   { bar: 'bg-amber-500',                 text: 'text-amber-600 dark:text-amber-400' },
    green:   { bar: 'bg-emerald-500',               text: 'text-emerald-600 dark:text-emerald-400' },
    red:     { bar: 'bg-red-500',                   text: 'text-red-600 dark:text-red-400' },
  };
  const c = toneColors[status.tone] || toneColors.neutral;
  return (
    <div>
      <label className="block text-xs text-gray-600 mb-1">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:text-gray-100"
      />
      <div className="mt-1.5">
        <div className="h-1 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div className={`h-full ${c.bar} transition-all duration-200`} style={{ width: `${status.progressPercent}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px]">
          <span className={c.text}>{status.label}</span>
          <span className="text-gray-400 dark:text-gray-500 font-mono">{status.wordCount} {status.wordCount === 1 ? 'word' : 'words'}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * `open` / `onOpenChange` are controlled by the host so a deep link can open
 * the form. `/projects?new=1` was how the Command Palette's "Create startup"
 * worked, and that entry now points at `/build?new=1` instead — a redirect
 * cannot carry a query string, so the destination has to honour it itself.
 */
export default function CreateStartupForm({ open, onOpenChange, onCreated }) {
  const { user, refresh } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const { toast, showToast } = useToast();

  const currentUser = user || safeReadJSON('user', null);
  const canPickFounder = currentUser?.role === 'admin' || currentUser?.role === 'partner';

  const submit = async () => {
    if (!form.name.trim()) {
      showToast({ kind: 'error', msg: 'Startup name is required' });
      return;
    }
    setSubmitting(true);
    try {
      await api.createProject({ ...form, name: form.name.trim() });
      onOpenChange(false);
      setForm(EMPTY);
      // See docblock (1): the worker may have just back-filled users.founder_id,
      // and the 5-minute /auth/me throttle would hide it until the next reload.
      try { if (typeof refresh === 'function') await refresh({ force: true }); } catch {}
      if (typeof onCreated === 'function') onCreated();
      showToast({ kind: 'success', msg: 'Startup created' });
      await markMilestone(currentUser, 'project_created');
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Failed to create startup' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        <button
          data-testid="button-new-startup"
          onClick={() => onOpenChange(!open)}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium text-white transition-colors"
        >
          <Plus size={14} /> New Startup
        </button>
      </div>

      {open && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 dark:bg-gray-900 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 text-sm mb-4 dark:text-gray-100">Add New Startup</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Input label="Startup Name" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
            <SectorSelect value={form.sector} onChange={v => setForm(f => ({ ...f, sector: v }))} />
            {canPickFounder && (
              <>
                <Input label="Founder Name" value={form.founder_name} onChange={v => setForm(f => ({ ...f, founder_name: v }))} />
                <Input label="Founder Email" value={form.founder_email} onChange={v => setForm(f => ({ ...f, founder_email: v }))} />
              </>
            )}
            <div className="md:col-span-2">
              <Input label="Description" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} />
            </div>
            <PitchInput label="Problem Statement" fieldType="problem" value={form.problem_statement} onChange={v => setForm(f => ({ ...f, problem_statement: v }))} />
            <PitchInput label="Solution" fieldType="solution" value={form.solution} onChange={v => setForm(f => ({ ...f, solution: v }))} />
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={submit} disabled={submitting} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium transition-colors">{submitting ? 'Creating…' : 'Create'}</button>
            <button onClick={() => onOpenChange(false)} disabled={submitting} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm text-gray-900 disabled:opacity-50 dark:text-gray-100">Cancel</button>
          </div>
        </div>
      )}
      {/* `useToast` returns a PAYLOAD (`{ kind, msg }`), not an element — a
          bare `{toast}` would try to render a plain object as a React child.
          This renderer came across with the form for the same reason the rest
          of it did. */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${
          toast.kind === 'error' ? 'bg-red-600' : 'bg-violet-600'
        }`} role="status">
          {toast.msg || (typeof toast === 'string' ? toast : '')}
        </div>
      )}
    </>
  );
}
