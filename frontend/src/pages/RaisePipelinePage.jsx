import React, { useEffect, useState } from 'react';
import { TrendingUp, RefreshCw, Save } from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';

// Investor raise pipeline — the downstream home for investor contacts promoted
// from the Contacts hub (POST /api/contacts/:uid/promote). Each promoted
// investor becomes a raise_prospects row the founder moves through the stages.
const STAGES = ['to_contact', 'contacted', 'meeting', 'diligence', 'committed', 'passed'];
const STAGE_LABEL = {
  to_contact: 'To contact',
  contacted: 'Contacted',
  meeting: 'Meeting',
  diligence: 'Diligence',
  committed: 'Committed',
  passed: 'Passed',
};
const STAGE_BADGE = {
  to_contact: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  contacted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  meeting: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  diligence: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  committed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  passed: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
};

export default function RaisePipelinePage({ embedded = false }) {
  useAuth();
  const [items, setItems] = useState([]);
  const [stages, setStages] = useState(STAGES);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    api.raiseProspects()
      .then((res) => { setItems(res?.items || []); setStages(res?.stages?.length ? res.stages : STAGES); })
      .catch((e) => setErr(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const update = async (id, patch) => {
    setBusyId(id); setErr(null);
    try {
      const updated = await api.raiseProspectUpdate(id, patch);
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...updated } : it)));
    } catch (e) { setErr(e.message || 'Failed to save'); }
    finally { setBusyId(null); }
  };

  const counts = stages.reduce((acc, s) => { acc[s] = items.filter((it) => it.stage === s).length; return acc; }, {});

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <TrendingUp size={22} /> Raise Pipeline
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Investor contacts promoted from your Contacts hub — move each prospect through the raise stages.
            </p>
          </div>
        )}
        <button onClick={load} disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {err && <div className="mb-4 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{err}</div>}

      <div className="flex flex-wrap gap-2 mb-4">
        {stages.map((s) => (
          <span key={s} className={`px-2.5 py-1 rounded-full text-xs font-medium ${STAGE_BADGE[s] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
            {STAGE_LABEL[s] || s}: {counts[s] || 0}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-12 text-center border border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
          No investor prospects yet. Promote an investor contact from the Contacts hub to start your raise pipeline.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <ProspectCard key={it.id} prospect={it} stages={stages} busy={busyId === it.id} onSave={update} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProspectCard({ prospect, stages, busy, onSave }) {
  const [firm, setFirm] = useState(prospect.firm || '');
  const [notes, setNotes] = useState(prospect.notes || '');
  const dirty = (firm || '') !== (prospect.firm || '') || (notes || '') !== (prospect.notes || '');

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{prospect.name || prospect.email}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400 truncate">{prospect.email}</div>
        </div>
        <select value={prospect.stage} disabled={busy}
          onChange={(e) => onSave(prospect.id, { stage: e.target.value })}
          className="shrink-0 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm text-gray-900 dark:text-gray-100">
          {stages.map((s) => <option key={s} value={s}>{STAGE_LABEL[s] || s}</option>)}
        </select>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Firm</label>
          <input value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="e.g. Sequoia"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm text-gray-900 dark:text-gray-100" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Context, next step…"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm text-gray-900 dark:text-gray-100" />
        </div>
      </div>

      {dirty && (
        <div className="mt-3 flex justify-end">
          <button onClick={() => onSave(prospect.id, { firm, notes })} disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm">
            <Save size={14} /> Save
          </button>
        </div>
      )}
    </div>
  );
}
