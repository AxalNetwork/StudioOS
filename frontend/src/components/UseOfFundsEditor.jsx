import React, { useEffect, useState } from 'react';
import { Loader2, Check, PieChart } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import {
  FundAllocator, allocToValues, valuesToUseOfFunds, fundsTotal, fundsValid,
} from './FundAllocator';

/**
 * Task #8 — deck-side editor for THE ASK "Use of Funds" allocation.
 *
 * Founders set the allocation once at intake; this lets them
 * revise it afterwards from the Pitch Deck builder. It loads the project's
 * current allocation, prefills the shared allocator, and saves via
 * PUT /api/projects/:id (validated server-side to total exactly 100% or
 * cleared). Because THE ASK slide — both the live print/share preview and the
 * PPTX export — derives its funds from the project at fetch time, persisting
 * here keeps the deck in lockstep. onSaved() lets the parent refresh its
 * live deck data so the in-builder previews update immediately.
 */
export default function UseOfFundsEditor({ projectId, onSaved }) {
  const [values, setValues] = useState([0, 0, 0, 0, 0]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true;
    setLoading(true); setError(''); setSaved(false);
    api.getProject(projectId)
      .then((p) => { if (alive) setValues(allocToValues(p?.use_of_funds)); })
      .catch((e) => {
        if (!alive) return;
        setError(e?.message || 'Failed to load allocation');
        reportError('UseOfFundsEditor:load', e);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  const onChange = (i, value) => {
    setSaved(false);
    setValues((prev) => {
      const next = [...prev];
      next[i] = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
      return next;
    });
  };

  const total = fundsTotal(values);
  const valid = fundsValid(values);

  const onSave = async () => {
    if (!projectId || !valid || saving) return;
    setSaving(true); setError('');
    try {
      await api.updateProject(projectId, { use_of_funds: valuesToUseOfFunds(values) });
      setSaved(true);
      if (onSaved) onSaved();
    } catch (e) {
      setError(e?.message || 'Save failed');
      reportError('UseOfFundsEditor:save', e);
    } finally { setSaving(false); }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg border dark:border-slate-800 p-3" data-card>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2 flex items-center gap-1">
        <PieChart className="w-3 h-3" /> THE ASK — Use of Funds
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400 py-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading allocation…
        </div>
      ) : (
        <>
          <FundAllocator values={values} total={total} valid={valid} onChange={onChange} />
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
          <button
            onClick={onSave}
            disabled={!valid || saving}
            className="w-full mt-3 px-2 py-1.5 text-sm bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : saved
                ? <><Check className="w-4 h-4" /> Saved</>
                : 'Save allocation'}
          </button>
          <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-2">
            Updates THE ASK slide in your deck preview and PowerPoint export.
          </p>
        </>
      )}
    </div>
  );
}
