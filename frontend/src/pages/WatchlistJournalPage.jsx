import React, { useEffect, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { safeReadJSON } from '../lib/storage';
import { useAuth } from '../hooks/useAuthSync';
import {
  Bookmark, BookOpen, Compass, Plus, Trash2, RefreshCw, X, Award, AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { api } from '../lib/api';

const TABS = [
  { key: 'watchlist',     label: 'Watchlist',      icon: Bookmark },
  { key: 'journal',       label: 'Decision Journal', icon: BookOpen },
  { key: 'antiportfolio', label: 'Anti-Portfolio', icon: Compass },
];

const CONVICTION_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const STATUS_STYLES = {
  watching:  'bg-blue-50 text-blue-700 border-blue-200',
  converted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  passed_on: 'bg-rose-50 text-rose-700 border-rose-200',
  archived:  'bg-slate-100 text-slate-600 border-slate-200',
};

const DECISION_STYLES = {
  invest: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pass:   'bg-rose-50 text-rose-700 border-rose-200',
  defer:  'bg-amber-50 text-amber-700 border-amber-200',
};

const OUTCOME_STYLES = {
  pending:      'bg-slate-100 text-slate-600 border-slate-200',
  hit:          'bg-emerald-50 text-emerald-700 border-emerald-200',
  miss:         'bg-rose-50 text-rose-700 border-rose-200',
  partial:      'bg-amber-50 text-amber-700 border-amber-200',
  inconclusive: 'bg-slate-100 text-slate-600 border-slate-200',
};

const VERDICT_STYLES = {
  vindicated: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircle2, label: 'Vindicated' },
  regret:     { bg: 'bg-rose-50',    text: 'text-rose-700',    icon: AlertTriangle, label: 'Regret' },
  open:       { bg: 'bg-slate-100',  text: 'text-slate-600',   icon: Compass, label: 'Open' },
};

function Pill({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border ${className}`}>
      {children}
    </span>
  );
}

function Section({ title, children, action }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm dark:bg-gray-900">
      <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// =====================================================================
// Watchlist tab
// =====================================================================
function WatchlistTab({ canSeeAll }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('');
  const [owner, setOwner] = useState('me');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.watchlistList({ status: filter || undefined, owner })
      .then((res) => {
        const items = Array.isArray(res?.items) ? res.items : [];
        const counts = res?.counts && typeof res.counts === 'object' ? res.counts : items.reduce((acc, it) => {
          const k = it?.status || 'watching';
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {});
        setData({ ...res, items, counts });
      })
      .catch((e) => {
        const msg = (e?.message || '').toLowerCase();
        if (e?.status === 404 || msg === 'not found') setData({ counts: {}, items: [] });
        else setErr(e.message || 'Failed to load');
      });
  };
  useEffect(load, [filter, owner]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCreate = async (form) => {
    setBusy(true); setErr(null);
    try {
      await api.watchlistCreate(form);
      setCreating(false);
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const onDelete = async (uid) => {
    if (!window.confirm('Remove this watchlist item?')) return;
    await api.watchlistDelete(uid);
    load();
  };

  const onMark = async (uid, status, passed_reason) => {
    await api.watchlistUpdate(uid, { status, passed_reason });
    load();
  };

  const onConvert = async (uid) => {
    if (!window.confirm('Convert to a Deal in the pipeline?')) return;
    await api.watchlistConvert(uid, {});
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 text-sm">
          <option value="">All statuses</option>
          <option value="watching">Watching</option>
          <option value="converted">Converted</option>
          <option value="passed_on">Passed on</option>
          <option value="archived">Archived</option>
        </select>
        {canSeeAll && (
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 text-sm">
            <option value="me">My items</option>
            <option value="all">All users (admin)</option>
          </select>
        )}
        <div className="flex-1" />
        <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1 bg-purple-600 text-white px-3 py-1.5 rounded text-sm hover:bg-purple-700">
          <Plus className="w-4 h-4" /> Add to watchlist
        </button>
      </div>

      {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded p-3">{err}</div>}

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(data.counts).map(([k, v]) => (
            <div key={k} className="bg-white rounded-lg border border-slate-200 p-3 dark:bg-gray-900">
              <div className="text-xs text-slate-500 capitalize">{k.replace('_', ' ')}</div>
              <div className="text-2xl font-semibold text-slate-900">{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden dark:bg-gray-900">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2">Target</th>
              <th className="px-4 py-2">Conviction</th>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Updated</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {(data?.items || []).map((it) => (
              <tr key={it.uid} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">
                    {it.project ? it.project.name : (it.external_name || '—')}
                  </div>
                  <div className="text-xs text-slate-500">
                    {it.project ? `${it.project.sector || ''} · ${it.project.stage || ''}` : it.external_url || ''}
                  </div>
                  {it.thesis && <div className="text-xs text-slate-600 mt-1 line-clamp-2">{it.thesis}</div>}
                </td>
                <td className="px-4 py-3 capitalize">{it.conviction}</td>
                <td className="px-4 py-3 text-xs text-slate-600">{it.source || '—'}</td>
                <td className="px-4 py-3">
                  <Pill className={STATUS_STYLES[it.status] || STATUS_STYLES.watching}>{(it.status || 'watching').replace('_', ' ')}</Pill>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{it.updated_at ? new Date(it.updated_at).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {it.project && it.status === 'watching' && (
                      <button onClick={() => onConvert(it.uid)} title="Convert to deal" className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
                        Convert
                      </button>
                    )}
                    {it.status !== 'passed_on' && (
                      <button onClick={() => {
                        const reason = window.prompt('Why are you passing on this?');
                        if (reason !== null) onMark(it.uid, 'passed_on', reason);
                      }} className="text-xs px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100">
                        Pass
                      </button>
                    )}
                    <button onClick={() => onDelete(it.uid)} className="text-slate-400 hover:text-rose-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                No watchlist items yet. Add deals you're tracking but haven't pulled into the pipeline.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Add to watchlist">
        <WatchlistForm onSubmit={onCreate} busy={busy} />
      </Modal>
    </div>
  );
}

function WatchlistForm({ onSubmit, busy }) {
  const [form, setForm] = useState({
    external_name: '', external_url: '', project_uid: '',
    sector: '', stage: '', thesis: '',
    conviction: 'medium', source: '', tags: '',
  });
  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-3 text-sm">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Startup UID (in-system)</label>
        <input value={form.project_uid} onChange={(e) => upd('project_uid', e.target.value)}
               className="w-full border border-slate-300 rounded px-2 py-1.5" placeholder="optional — leave blank for external" />
      </div>
      <div className="text-xs text-slate-500 -mt-1">— or external prospect —</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">External name</label>
          <input value={form.external_name} onChange={(e) => upd('external_name', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">URL</label>
          <input value={form.external_url} onChange={(e) => upd('external_url', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Sector</label>
          <input value={form.sector} onChange={(e) => upd('sector', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Stage</label>
          <input value={form.stage} onChange={(e) => upd('stage', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Conviction</label>
          <select value={form.conviction} onChange={(e) => upd('conviction', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5">
            {CONVICTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Source</label>
          <input value={form.source} onChange={(e) => upd('source', e.target.value)} placeholder="referral, inbound, conf…" className="w-full border border-slate-300 rounded px-2 py-1.5" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Thesis / why you're watching</label>
        <textarea value={form.thesis} onChange={(e) => upd('thesis', e.target.value)} rows={3} className="w-full border border-slate-300 rounded px-2 py-1.5" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Tags (comma separated)</label>
        <input value={form.tags} onChange={(e) => upd('tags', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5" />
      </div>
      <button disabled={busy} type="submit" className="w-full bg-purple-600 text-white rounded py-2 text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
        {busy ? 'Saving…' : 'Add to watchlist'}
      </button>
    </form>
  );
}

// =====================================================================
// Journal tab
// =====================================================================
function JournalTab({ canSeeAll }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [decision, setDecision] = useState('');
  const [outcome, setOutcome] = useState('');
  const [owner, setOwner] = useState('me');
  const [creating, setCreating] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.journalList({
      decision: decision || undefined,
      outcome_status: outcome || undefined,
      owner,
    })
      .then((res) => {
        const items = Array.isArray(res?.items) ? res.items : [];
        const counts_by_decision = res?.counts_by_decision && typeof res.counts_by_decision === 'object'
          ? res.counts_by_decision
          : items.reduce((acc, it) => {
              const k = it?.decision || 'invest';
              acc[k] = (acc[k] || 0) + 1;
              return acc;
            }, {});
        setData({ ...res, items, counts_by_decision });
      })
      .catch((e) => {
        const msg = (e?.message || '').toLowerCase();
        if (e?.status === 404 || msg === 'not found') setData({ counts_by_decision: {}, items: [] });
        else setErr(e.message || 'Failed to load');
      });
  };
  useEffect(load, [decision, outcome, owner]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCreate = async (form) => {
    setBusy(true); setErr(null);
    try {
      await api.journalCreate(form);
      setCreating(false);
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const onRecordOutcome = async (form) => {
    setBusy(true); setErr(null);
    try {
      await api.journalRecordOutcome(outcomeFor.uid, form);
      setOutcomeFor(null);
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const onDelete = async (uid) => {
    if (!window.confirm('Delete this journal entry?')) return;
    await api.journalDelete(uid);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={decision} onChange={(e) => setDecision(e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 text-sm">
          <option value="">All decisions</option>
          <option value="invest">Invest</option>
          <option value="pass">Pass</option>
          <option value="defer">Defer</option>
        </select>
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 text-sm">
          <option value="">All outcomes</option>
          <option value="pending">Pending</option>
          <option value="hit">Hit</option>
          <option value="miss">Miss</option>
          <option value="partial">Partial</option>
          <option value="inconclusive">Inconclusive</option>
        </select>
        {canSeeAll && (
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 text-sm">
            <option value="me">My entries</option>
            <option value="all">All users (admin)</option>
          </select>
        )}
        <div className="flex-1" />
        <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1 bg-purple-600 text-white px-3 py-1.5 rounded text-sm hover:bg-purple-700">
          <Plus className="w-4 h-4" /> New entry
        </button>
      </div>

      {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded p-3">{err}</div>}

      {data && (
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(data.counts_by_decision).map(([k, v]) => (
            <div key={k} className="bg-white rounded-lg border border-slate-200 p-3 dark:bg-gray-900">
              <div className="text-xs text-slate-500 capitalize">{k}</div>
              <div className="text-2xl font-semibold text-slate-900">{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {(data?.items || []).map((e) => (
          <div key={e.uid} className="bg-white rounded-lg border border-slate-200 p-4 dark:bg-gray-900">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Pill className={DECISION_STYLES[e.decision]}>{e.decision}</Pill>
                  <Pill className={OUTCOME_STYLES[e.outcome_status]}>outcome: {e.outcome_status}</Pill>
                  <span className="text-xs text-slate-500">conviction {e.conviction}/5</span>
                  <span className="text-xs text-slate-500">· {new Date(e.decided_at).toLocaleDateString()}</span>
                </div>
                <div className="text-sm font-medium text-slate-900">
                  {e.project ? e.project.name : (e.watchlist?.external_name || 'Untitled')}
                </div>
                <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{e.thesis}</p>
                {e.key_risks && (
                  <div className="text-xs text-slate-500 mt-2"><strong>Risks:</strong> {e.key_risks}</div>
                )}
                {(e.expected_multiple || e.expected_timeline_months) && (
                  <div className="text-xs text-slate-500 mt-1">
                    <strong>Expected:</strong>{' '}
                    {e.expected_multiple ? `${e.expected_multiple}x` : ''}
                    {e.expected_multiple && e.expected_timeline_months ? ' over ' : ''}
                    {e.expected_timeline_months ? `${e.expected_timeline_months}mo` : ''}
                  </div>
                )}
                {e.outcome_notes && (
                  <div className="text-xs text-slate-600 mt-2 p-2 bg-slate-50 rounded border border-slate-200">
                    <strong>Outcome:</strong> {e.outcome_notes}
                    {e.outcome_actual_multiple !== null && e.outcome_actual_multiple !== undefined && (
                      <> · <strong>{e.outcome_actual_multiple}x</strong></>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <button onClick={() => setOutcomeFor(e)} className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-50">
                  Record outcome
                </button>
                <button onClick={() => onDelete(e.uid)} className="text-slate-400 hover:text-rose-600 self-end">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {data && data.items.length === 0 && (
          <div className="text-center text-slate-500 text-sm p-8 bg-white rounded-lg border border-slate-200 dark:bg-gray-900">
            No journal entries yet. Write your thesis BEFORE the vote so future-you can grade past calls.
          </div>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New journal entry">
        <JournalForm onSubmit={onCreate} busy={busy} />
      </Modal>
      <Modal open={!!outcomeFor} onClose={() => setOutcomeFor(null)} title={`Record outcome — ${outcomeFor?.project?.name || ''}`}>
        <OutcomeForm onSubmit={onRecordOutcome} busy={busy} />
      </Modal>
    </div>
  );
}

function JournalForm({ onSubmit, busy }) {
  const [form, setForm] = useState({
    project_uid: '', watchlist_uid: '',
    decision: 'invest', conviction: 3,
    thesis: '', key_risks: '', expected_outcome: '',
    expected_multiple: '', expected_timeline_months: '',
    tags: '',
  });
  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const payload = { ...form };
      if (!payload.expected_multiple) delete payload.expected_multiple;
      if (!payload.expected_timeline_months) delete payload.expected_timeline_months;
      if (!payload.watchlist_uid) delete payload.watchlist_uid;
      if (!payload.project_uid) delete payload.project_uid;
      onSubmit(payload);
    }} className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Startup UID</label>
          <input value={form.project_uid} onChange={(e) => upd('project_uid', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">…or Watchlist UID</label>
          <input value={form.watchlist_uid} onChange={(e) => upd('watchlist_uid', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Decision</label>
          <select value={form.decision} onChange={(e) => upd('decision', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5">
            <option value="invest">Invest</option>
            <option value="pass">Pass</option>
            <option value="defer">Defer</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Conviction (1-5)</label>
          <input type="number" min={1} max={5} value={form.conviction} onChange={(e) => upd('conviction', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Expected multiple (x)</label>
          <input type="number" step="0.1" value={form.expected_multiple} onChange={(e) => upd('expected_multiple', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Expected timeline (mo)</label>
          <input type="number" value={form.expected_timeline_months} onChange={(e) => upd('expected_timeline_months', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Thesis (required, min 10 chars)</label>
        <textarea value={form.thesis} onChange={(e) => upd('thesis', e.target.value)} rows={4} required className="w-full border border-slate-300 rounded px-2 py-1.5" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Key risks</label>
        <textarea value={form.key_risks} onChange={(e) => upd('key_risks', e.target.value)} rows={2} className="w-full border border-slate-300 rounded px-2 py-1.5" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Expected outcome</label>
        <textarea value={form.expected_outcome} onChange={(e) => upd('expected_outcome', e.target.value)} rows={2} className="w-full border border-slate-300 rounded px-2 py-1.5" />
      </div>
      <button disabled={busy} type="submit" className="w-full bg-purple-600 text-white rounded py-2 text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
        {busy ? 'Saving…' : 'Save entry'}
      </button>
    </form>
  );
}

function OutcomeForm({ onSubmit, busy }) {
  const [form, setForm] = useState({ outcome_status: 'hit', outcome_notes: '', outcome_actual_multiple: '' });
  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const p = { ...form };
      if (!p.outcome_actual_multiple) delete p.outcome_actual_multiple;
      onSubmit(p);
    }} className="space-y-3 text-sm">
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Outcome</label>
        <select value={form.outcome_status} onChange={(e) => upd('outcome_status', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5">
          <option value="hit">Hit</option>
          <option value="miss">Miss</option>
          <option value="partial">Partial</option>
          <option value="inconclusive">Inconclusive</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Actual multiple (x)</label>
        <input type="number" step="0.1" value={form.outcome_actual_multiple} onChange={(e) => upd('outcome_actual_multiple', e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5" />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
        <textarea value={form.outcome_notes} onChange={(e) => upd('outcome_notes', e.target.value)} rows={3} className="w-full border border-slate-300 rounded px-2 py-1.5" />
      </div>
      <button disabled={busy} type="submit" className="w-full bg-purple-600 text-white rounded py-2 text-sm font-medium hover:bg-purple-700 disabled:opacity-50">
        {busy ? 'Saving…' : 'Record outcome'}
      </button>
    </form>
  );
}

// =====================================================================
// Anti-portfolio tab
// =====================================================================
function AntiPortfolioTab({ canSeeAll }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [owner, setOwner] = useState('me');
  const load = () => {
    api.antiportfolio(owner).then((res) => {
      const rows = Array.isArray(res?.rows) ? res.rows
        : Array.isArray(res?.items) ? res.items
        : [];
      const counts = res?.counts && typeof res.counts === 'object' ? res.counts : rows.reduce((acc, r) => {
        const k = r?.verdict || 'open';
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
      const total_passes = typeof res?.total_passes === 'number' ? res.total_passes : rows.length;
      const decided = (counts.vindicated || 0) + (counts.regret || 0);
      const regret_rate = typeof res?.regret_rate === 'number'
        ? res.regret_rate
        : (decided > 0 ? Math.round(((counts.regret || 0) / decided) * 100) : 0);
      setData({
        ...res,
        rows,
        counts,
        total_passes,
        regret_rate,
        biggest_regret: res?.biggest_regret || null,
      });
    }).catch((e) => {
      const msg = (e?.message || '').toLowerCase();
      if (e?.status === 404 || msg === 'not found') {
        setData({ total_passes: 0, counts: {}, regret_rate: 0, rows: [], biggest_regret: null });
      } else {
        setErr(e.message || 'Failed');
      }
    });
  };
  useEffect(load, [owner]); // eslint-disable-line

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {canSeeAll && (
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="border border-slate-300 rounded px-3 py-1.5 text-sm">
            <option value="me">Mine</option>
            <option value="all">Firm-wide (admin)</option>
          </select>
        )}
        <button onClick={load} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded p-3">{err}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white rounded-lg border border-slate-200 p-4 dark:bg-gray-900">
              <div className="text-xs text-slate-500">Total passes</div>
              <div className="text-2xl font-semibold text-slate-900">{data.total_passes}</div>
            </div>
            <div className="bg-emerald-50 rounded-lg border border-emerald-200 p-4">
              <div className="text-xs text-emerald-700">Vindicated</div>
              <div className="text-2xl font-semibold text-emerald-900">{data.counts.vindicated || 0}</div>
            </div>
            <div className="bg-rose-50 rounded-lg border border-rose-200 p-4">
              <div className="text-xs text-rose-700">Regret</div>
              <div className="text-2xl font-semibold text-rose-900">{data.counts.regret || 0}</div>
            </div>
            <div className="bg-amber-50 rounded-lg border border-amber-200 p-4">
              <div className="text-xs text-amber-700">Regret rate</div>
              <div className="text-2xl font-semibold text-amber-900">{data.regret_rate}%</div>
            </div>
          </div>

          {data.biggest_regret && (
            <Section title="Biggest regret" action={<Pill className={VERDICT_STYLES.regret.bg + ' ' + VERDICT_STYLES.regret.text + ' border-rose-200'}>Regret</Pill>}>
              <div className="text-sm font-medium text-slate-900">{data.biggest_regret.project?.name}</div>
              <div className="text-xs text-slate-500">
                Now: {data.biggest_regret.project?.status} · score {data.biggest_regret.project?.latest_score?.toFixed?.(0) ?? '—'} · health {data.biggest_regret.project?.latest_health_badge || '—'}
              </div>
              <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{data.biggest_regret.thesis}</p>
            </Section>
          )}

          <div className="space-y-2">
            {data.rows.map((r) => {
              const v = VERDICT_STYLES[r.verdict] || VERDICT_STYLES.open;
              const Icon = v.icon;
              return (
                <div key={r.uid} className="bg-white rounded-lg border border-slate-200 p-4 dark:bg-gray-900">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${v.bg} ${v.text}`}>
                          <Icon className="w-3 h-3" /> {v.label}
                        </span>
                        <span className="text-xs text-slate-500">{r.kind}</span>
                        <span className="text-xs text-slate-500">· {new Date(r.decided_at).toLocaleDateString()}</span>
                      </div>
                      <div className="text-sm font-medium text-slate-900">
                        {r.project?.name || r.external_name || 'Untitled'}
                      </div>
                      {r.thesis && <p className="text-sm text-slate-700 mt-1 line-clamp-3">{r.thesis}</p>}
                      {r.passed_reason && <p className="text-xs text-slate-500 mt-1">Pass reason: {r.passed_reason}</p>}
                      {r.project && (
                        <div className="text-xs text-slate-500 mt-2">
                          Today: {r.project.status} · score {r.project.latest_score?.toFixed?.(0) ?? '—'} · health {r.project.latest_health_badge || '—'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {data.rows.length === 0 && (
              <div className="text-center text-slate-500 text-sm p-8 bg-white rounded-lg border border-slate-200 dark:bg-gray-900">
                No passed deals yet. Once you record a pass decision in the journal (or mark a watchlist item passed-on), it shows up here.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// =====================================================================
// Page
// =====================================================================
export default function WatchlistJournalPage() {
  const [tab, setTab] = useState('watchlist');
  // Task #18 — `canSeeAll` gates an admin-only view of every user's
  // watchlist (security-adjacent), so we prefer the live AuthProvider
  // role over the cached localStorage user. localStorage is only used
  // as a first-paint fallback while the auth context is still hydrating.
  const { role: liveRole } = useAuth();
  const role = liveRole || (() => {
    try { return safeReadJSON('user', {}).role || ''; }
    catch { return ''; }
  })();
  const canSeeAll = role === 'admin';

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
          <Award className="w-5 h-5 text-purple-600" />
          Watchlist & Decision Journal
        </h1>
        <PageExplainer pageKey="watchlist" />
        <p className="text-sm text-slate-500">Track deals you almost did. Write your thesis before the vote. Look back honestly.</p>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200 mb-5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px ${active ? 'border-purple-600 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'watchlist' && <WatchlistTab canSeeAll={canSeeAll} />}
      {tab === 'journal' && <JournalTab canSeeAll={canSeeAll} />}
      {tab === 'antiportfolio' && <AntiPortfolioTab canSeeAll={canSeeAll} />}
    </div>
  );
}
