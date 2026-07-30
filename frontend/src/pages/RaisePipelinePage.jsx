import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, RefreshCw, Plus, Upload, X, Pencil, Megaphone, ExternalLink,
  CalendarDays, Target, CircleDollarSign, Users,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuthSync';
import { api } from '../lib/api';

// Raise Pipeline v1 — active-round header, add/import investors, drag-between-
// stages kanban, prospect drawer linked to the underlying Contacts-hub record,
// and investor updates. Prospects also arrive via the Contacts hub promote
// flow (POST /api/contacts/:uid/promote).
const STAGES = ['to_contact', 'contacted', 'meeting', 'diligence', 'committed', 'passed'];
const STAGE_LABEL = {
  to_contact: 'To contact',
  contacted: 'Contacted',
  meeting: 'Meeting',
  diligence: 'Diligence',
  committed: 'Committed',
  passed: 'Passed',
};
const STAGE_DOT = {
  to_contact: 'bg-gray-400 dark:bg-gray-500',
  contacted: 'bg-blue-500',
  meeting: 'bg-amber-500',
  diligence: 'bg-violet-500',
  committed: 'bg-emerald-500',
  passed: 'bg-gray-300 dark:bg-gray-600',
};

const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500';
const labelCls = 'block text-xs text-gray-500 dark:text-gray-400 mb-1';
const btnPrimary = 'inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm';
const btnGhost = 'inline-flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50';

function fmtMoney(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1,
  }).format(Number(n));
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Small quote-aware CSV parser — handles quoted fields, "" escapes, CRLF.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

// Map a parsed CSV into prospect rows via a header line (name/email/firm/amount/notes).
export function csvToProspects(rows) {
  if (rows.length === 0) return { error: 'The file is empty' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (names) => header.findIndex((h) => names.includes(h));
  const iName = idx(['name', 'investor', 'investor name', 'full name']);
  const iEmail = idx(['email', 'e-mail', 'email address']);
  const iFirm = idx(['firm', 'fund', 'company', 'organization']);
  const iAmount = idx(['amount', 'check size', 'check', 'commitment']);
  const iNotes = idx(['notes', 'note', 'context']);
  if (iName === -1 && iEmail === -1) return { error: 'Need a "name" or "email" column in the header row' };
  const out = [];
  for (const r of rows.slice(1)) {
    const amountRaw = iAmount >= 0 ? String(r[iAmount] || '').replace(/[$,\s]/g, '') : '';
    out.push({
      name: iName >= 0 ? (r[iName] || '').trim() : '',
      email: iEmail >= 0 ? (r[iEmail] || '').trim() : '',
      firm: iFirm >= 0 ? (r[iFirm] || '').trim() : '',
      amount: amountRaw !== '' && !Number.isNaN(Number(amountRaw)) ? Number(amountRaw) : undefined,
      notes: iNotes >= 0 ? (r[iNotes] || '').trim() : '',
    });
  }
  return { rows: out.filter((p) => p.name || p.email) };
}

export default function RaisePipelinePage({ embedded = false }) {
  useAuth();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [roundInfo, setRoundInfo] = useState({ round: null, raised: 0, committed_count: 0 });
  const [items, setItems] = useState([]);
  const [stages, setStages] = useState(STAGES);
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showRoundEdit, setShowRoundEdit] = useState(false);
  const [drawerId, setDrawerId] = useState(null);

  useEffect(() => {
    api.listProjects()
      .then((list) => {
        const safe = list || [];
        setProjects(safe);
        if (safe.length > 0) setProjectId(safe[0].id);
        else setLoading(false);
      })
      .catch((e) => { setErr(e.message || 'Failed to load projects'); setLoading(false); });
  }, []);

  const load = (pid = projectId) => {
    if (!pid) return;
    setLoading(true); setErr(null);
    Promise.all([
      api.raiseProspects(pid),
      api.raiseRound(pid).catch((e) => { setErr(e?.message || 'Failed to load round details'); return { round: null, raised: 0, committed_count: 0 }; }),
      api.raiseUpdates(pid).catch((e) => { setErr(e?.message || 'Failed to load investor updates'); return { items: [] }; }),
    ])
      .then(([pr, rd, up]) => {
        setItems(pr?.items || []);
        setStages(pr?.stages?.length ? pr.stages : STAGES);
        setRoundInfo(rd || { round: null, raised: 0, committed_count: 0 });
        setUpdates(up?.items || []);
      })
      .catch((e) => setErr(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(projectId); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshRound = (pid = projectId) => {
    if (!pid) return;
    api.raiseRound(pid).then(setRoundInfo).catch((e) => setErr(e?.message || 'Failed to refresh round details'));
  };

  const update = async (id, patch) => {
    setBusyId(id); setErr(null);
    try {
      const updated = await api.raiseProspectUpdate(id, patch);
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...updated } : it)));
      if (patch.stage !== undefined || patch.amount !== undefined) refreshRound();
      return updated;
    } catch (e) {
      setErr(e.message || 'Failed to save');
      return null;
    } finally { setBusyId(null); }
  };

  const onDrop = (e, stage) => {
    e.preventDefault();
    setDragOverStage(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (!id) return;
    const it = items.find((x) => x.id === id);
    if (it && it.stage !== stage) update(id, { stage });
  };

  const byStage = useMemo(() => {
    const m = {};
    for (const s of stages) m[s] = [];
    for (const it of items) (m[it.stage] || (m[it.stage] = [])).push(it);
    return m;
  }, [items, stages]);

  const drawerProspect = drawerId ? items.find((x) => x.id === drawerId) : null;

  return (
    <div className={embedded ? '' : 'max-w-7xl mx-auto'}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <TrendingUp size={22} /> Raise Pipeline
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Track your round, move investors through stages, and keep them updated.
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {projects.length > 1 && (
            <select value={projectId || ''} onChange={(e) => setProjectId(Number(e.target.value))}
              className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-transparent text-sm text-gray-900 dark:text-gray-100">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button onClick={() => setShowAdd(true)} disabled={!projectId} className={btnPrimary}>
            <Plus size={14} /> Add investor
          </button>
          <button onClick={() => setShowImport(true)} disabled={!projectId} className={btnGhost}>
            <Upload size={14} /> Import CSV
          </button>
          <button onClick={() => load()} disabled={loading || !projectId} className={btnGhost} aria-label="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {err && <div className="mb-4 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{err}</div>}

      {!projectId && !loading ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-12 text-center border border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
          You need a project before you can run a raise pipeline.
        </div>
      ) : (
        <>
          <RoundHeader info={roundInfo} prospectCount={items.length} onEdit={() => setShowRoundEdit(true)} />

          {loading ? (
            <div className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">Loading…</div>
          ) : (
            <div className="overflow-x-auto pb-2 -mx-1 px-1">
              <div className="flex gap-3 min-w-max items-start">
                {stages.map((s) => (
                  <div key={s}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverStage(s); }}
                    onDragLeave={() => setDragOverStage((cur) => (cur === s ? null : cur))}
                    onDrop={(e) => onDrop(e, s)}
                    className={`w-60 shrink-0 rounded-xl border p-2 transition-colors ${
                      dragOverStage === s
                        ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/60 dark:bg-emerald-900/20'
                        : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60'
                    }`}>
                    <div className="flex items-center justify-between px-1.5 py-1 mb-1.5">
                      <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                        <span className={`w-2 h-2 rounded-full ${STAGE_DOT[s] || 'bg-gray-400'}`} />
                        {STAGE_LABEL[s] || s}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{(byStage[s] || []).length}</span>
                    </div>
                    <div className="space-y-2 min-h-[3rem]">
                      {(byStage[s] || []).map((it) => (
                        <button key={it.id} type="button" draggable
                          onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(it.id)); e.dataTransfer.effectAllowed = 'move'; }}
                          onClick={() => setDrawerId(it.id)}
                          className={`w-full text-left bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-2.5 shadow-sm hover:border-emerald-300 dark:hover:border-emerald-700 cursor-grab active:cursor-grabbing ${busyId === it.id ? 'opacity-50' : ''}`}>
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{it.name || it.email}</div>
                          {it.firm && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{it.firm}</div>}
                          {it.amount != null && (
                            <div className="mt-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">{fmtMoney(it.amount)}</div>
                          )}
                        </button>
                      ))}
                      {(byStage[s] || []).length === 0 && (
                        <div className="text-[11px] text-gray-400 dark:text-gray-600 text-center py-3 select-none">Drop here</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <UpdatesPanel projectId={projectId} updates={updates}
            onPosted={(u) => setUpdates((prev) => [u, ...prev])} />
        </>
      )}

      {showAdd && projectId && (
        <AddInvestorModal projectId={projectId} stages={stages} onClose={() => setShowAdd(false)}
          onCreated={(p) => { setItems((prev) => [p, ...prev]); setShowAdd(false); refreshRound(); }} />
      )}
      {showImport && projectId && (
        <ImportCsvModal projectId={projectId} onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); load(); }} />
      )}
      {showRoundEdit && projectId && (
        <RoundEditModal projectId={projectId} round={roundInfo.round} onClose={() => setShowRoundEdit(false)}
          onSaved={(r) => { setRoundInfo((prev) => ({ ...prev, round: r })); setShowRoundEdit(false); }} />
      )}
      {drawerProspect && (
        <ProspectDrawer prospect={drawerProspect} stages={stages} busy={busyId === drawerProspect.id}
          onSave={update} onClose={() => setDrawerId(null)} />
      )}
    </div>
  );
}

function RoundHeader({ info, prospectCount, onEdit }) {
  const { round, raised, committed_count: committed } = info;
  const target = round?.target_amount != null ? Number(round.target_amount) : null;
  const pct = target && target > 0 ? Math.min(100, Math.round((Number(raised) / target) * 100)) : null;
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1"><CircleDollarSign size={12} /> Raised (committed)</div>
            <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{fmtMoney(raised)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1"><Target size={12} /> Target</div>
            <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{fmtMoney(target)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1"><CalendarDays size={12} /> Close date</div>
            <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{fmtDate(round?.close_date)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1"><Users size={12} /> Investors</div>
            <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {prospectCount}<span className="text-sm font-normal text-gray-500 dark:text-gray-400"> · {committed} committed</span>
            </div>
          </div>
        </div>
        <button onClick={onEdit} className={btnGhost}>
          <Pencil size={14} /> {round ? 'Edit round' : 'Set up round'}
        </button>
      </div>
      {round?.name && <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">{round.name}</div>}
      {pct !== null && (
        <div className="mt-3">
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{pct}% of target committed</div>
        </div>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 dark:bg-black/60" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function RoundEditModal({ projectId, round, onClose, onSaved }) {
  const [name, setName] = useState(round?.name || '');
  const [target, setTarget] = useState(round?.target_amount != null ? String(round.target_amount) : '');
  const [close, setClose] = useState(round?.close_date || '');
  const [notes, setNotes] = useState(round?.notes || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const cleaned = target.replace(/[$,\s]/g, '');
      const saved = await api.raiseRoundSave({
        project_id: projectId,
        name: name || null,
        target_amount: cleaned !== '' ? Number(cleaned) : null,
        close_date: close || null,
        notes: notes || null,
      });
      onSaved(saved);
    } catch (e) { setErr(e.message || 'Failed to save round'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={round ? 'Edit round' : 'Set up your round'} onClose={onClose}>
      {err && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{err}</div>}
      <div className="space-y-3">
        <div>
          <label className={labelCls}>Round name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Seed" className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Target amount (USD)</label>
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 1500000" inputMode="decimal" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Close date</label>
            <input type="date" value={close} onChange={(e) => setClose(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Terms, instrument, context…" className={inputCls} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Save round'}</button>
        </div>
      </div>
    </Modal>
  );
}

function AddInvestorModal({ projectId, stages, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [firm, setFirm] = useState('');
  const [amount, setAmount] = useState('');
  const [stage, setStage] = useState('to_contact');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const cleaned = amount.replace(/[$,\s]/g, '');
      const p = await api.raiseProspectCreate({
        project_id: projectId,
        name: name || undefined,
        email: email || undefined,
        firm: firm || undefined,
        amount: cleaned !== '' ? Number(cleaned) : undefined,
        stage,
        notes: notes || undefined,
      });
      onCreated(p);
    } catch (e) { setErr(e.message || 'Failed to add investor'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Add investor" onClose={onClose}>
      {err && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{err}</div>}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@fund.vc" className={inputCls} />
          </div>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
          With an email, the investor is also added to your Contacts hub.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Firm</label>
            <input value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="e.g. Sequoia" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Check size (USD)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 100000" inputMode="decimal" className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Stage</label>
          <select value={stage} onChange={(e) => setStage(e.target.value)} className={inputCls}>
            {stages.map((s) => <option key={s} value={s}>{STAGE_LABEL[s] || s}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Context, intro path…" className={inputCls} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy || (!name && !email)} className={btnPrimary}>{busy ? 'Adding…' : 'Add investor'}</button>
        </div>
      </div>
    </Modal>
  );
}

function ImportCsvModal({ projectId, onClose, onDone }) {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [parseErr, setParseErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const onFile = (f) => {
    if (!f) return;
    setFileName(f.name); setParseErr(null); setRows(null); setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = csvToProspects(parseCsv(String(reader.result || '')));
      if (parsed.error) setParseErr(parsed.error);
      else if (!parsed.rows.length) setParseErr('No usable rows found (each row needs a name or email)');
      else if (parsed.rows.length > 200) setParseErr('Too many rows — import at most 200 at a time');
      else setRows(parsed.rows);
    };
    reader.onerror = () => setParseErr('Could not read the file');
    reader.readAsText(f);
  };

  const doImport = async () => {
    if (!rows) return;
    setBusy(true); setParseErr(null);
    try {
      // The API caps each request at 50 rows — chunk sequentially.
      let created = 0;
      const skipped = [];
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        const res = await api.raiseProspectsImport({ project_id: projectId, rows: chunk });
        created += res.created || 0;
        for (const s of res.skipped || []) skipped.push({ row: i + s.row, reason: s.reason });
      }
      setResult({ created, skipped });
    } catch (e) { setParseErr(e.message || 'Import failed'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Import investors from CSV" onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Upload a CSV with a header row. Recognized columns: <code className="text-xs">name</code>, <code className="text-xs">email</code>, <code className="text-xs">firm</code>, <code className="text-xs">amount</code>, <code className="text-xs">notes</code>.
          Rows with an email are also added to your Contacts hub; duplicates already in the pipeline are skipped.
        </p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()} className={btnGhost}>
          <Upload size={14} /> {fileName || 'Choose CSV file'}
        </button>
        {parseErr && <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{parseErr}</div>}
        {rows && !result && (
          <div className="text-sm text-gray-700 dark:text-gray-300">
            Ready to import <span className="font-semibold">{rows.length}</span> investor{rows.length === 1 ? '' : 's'}.
          </div>
        )}
        {result && (
          <div className="text-sm space-y-1">
            <div className="text-emerald-700 dark:text-emerald-400 font-medium">Imported {result.created} investor{result.created === 1 ? '' : 's'}.</div>
            {result.skipped.length > 0 && (
              <div className="text-gray-600 dark:text-gray-400">
                Skipped {result.skipped.length}:
                <ul className="list-disc ml-5 mt-1 max-h-32 overflow-y-auto">
                  {result.skipped.map((s, i) => <li key={i}>Row {s.row}: {s.reason}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          {result ? (
            <button onClick={onDone} className={btnPrimary}>Done</button>
          ) : (
            <>
              <button onClick={onClose} className={btnGhost}>Cancel</button>
              <button onClick={doImport} disabled={!rows || busy} className={btnPrimary}>
                {busy ? 'Importing…' : 'Import'}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ProspectDrawer({ prospect, stages, busy, onSave, onClose }) {
  const [detail, setDetail] = useState(null);
  const [firm, setFirm] = useState(prospect.firm || '');
  const [amount, setAmount] = useState(prospect.amount != null ? String(prospect.amount) : '');
  const [notes, setNotes] = useState(prospect.notes || '');
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    setDetail(null); setErr(null);
    setFirm(prospect.firm || '');
    setAmount(prospect.amount != null ? String(prospect.amount) : '');
    setNotes(prospect.notes || '');
    api.raiseProspectGet(prospect.id)
      .then((d) => { if (alive) setDetail(d); })
      .catch((e) => { if (alive) setErr(e.message || 'Failed to load details'); });
    return () => { alive = false; };
  }, [prospect.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cleanedAmount = amount.replace(/[$,\s]/g, '');
  const dirty = (firm || '') !== (prospect.firm || '')
    || (notes || '') !== (prospect.notes || '')
    || (cleanedAmount !== '' ? Number(cleanedAmount) : null) !== (prospect.amount != null ? Number(prospect.amount) : null);

  const save = async () => {
    setErr(null);
    const ok = await onSave(prospect.id, {
      firm,
      notes,
      amount: cleanedAmount !== '' ? Number(cleanedAmount) : null,
    });
    if (!ok) setErr('Failed to save');
  };

  const contact = detail?.contact;

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 dark:bg-black/50" />
      <div onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shadow-2xl overflow-y-auto">
        <div className="flex items-start justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">{prospect.name || prospect.email}</div>
            {prospect.email && <div className="text-sm text-gray-500 dark:text-gray-400 truncate">{prospect.email}</div>}
          </div>
          <button onClick={onClose} className="p-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {err && <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{err}</div>}

          <div>
            <label className={labelCls}>Stage</label>
            <select value={prospect.stage} disabled={busy}
              onChange={(e) => onSave(prospect.id, { stage: e.target.value })}
              className={inputCls}>
              {stages.map((s) => <option key={s} value={s}>{STAGE_LABEL[s] || s}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Firm</label>
              <input value={firm} onChange={(e) => setFirm(e.target.value)} placeholder="e.g. Sequoia" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Check size (USD)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 100000" inputMode="decimal" className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Context, next step…" className={inputCls} />
          </div>

          {dirty && (
            <div className="flex justify-end">
              <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Save changes'}</button>
            </div>
          )}

          <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Contact record</div>
            {detail === null && !err ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">Loading…</div>
            ) : contact ? (
              <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800 rounded-lg p-3 text-sm">
                <div className="font-medium text-gray-900 dark:text-gray-100">{contact.name || contact.email}</div>
                <div className="text-gray-500 dark:text-gray-400">{contact.email}</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Status: {contact.status || '—'} · Source: {contact.source || '—'}
                  {contact.last_activity_at && <> · Last activity {new Date(contact.last_activity_at).toLocaleDateString()}</>}
                </div>
                <Link to="/network?tab=contacts"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 hover:underline">
                  Open in Contacts hub <ExternalLink size={12} />
                </Link>
              </div>
            ) : (
              <div className="text-sm text-gray-500 dark:text-gray-400">
                No linked contact — this prospect was added without an email.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function UpdatesPanel({ projectId, updates, onPosted }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);

  const post = async () => {
    setBusy(true); setErr(null);
    try {
      const u = await api.raiseUpdateCreate({ project_id: projectId, subject, body: body || undefined });
      onPosted(u);
      setSubject(''); setBody(''); setOpen(false);
    } catch (e) { setErr(e.message || 'Failed to post update'); }
    finally { setBusy(false); }
  };

  return (
    <div className="mt-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Megaphone size={16} /> Investor updates
        </h2>
        {!open && (
          <button onClick={() => setOpen(true)} className={btnGhost}><Plus size={14} /> New update</button>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Updates are recorded here and on each investor's contact timeline — they are not emailed.
      </p>

      {open && (
        <div className="mb-4 space-y-3 border border-gray-200 dark:border-gray-800 rounded-lg p-3 bg-gray-50 dark:bg-gray-800/40">
          {err && <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">{err}</div>}
          <div>
            <label className={labelCls}>Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. March progress update" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Update</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4}
              placeholder="Metrics, wins, asks…" className={inputCls} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setOpen(false); setErr(null); }} className={btnGhost}>Cancel</button>
            <button onClick={post} disabled={busy || !subject.trim()} className={btnPrimary}>
              {busy ? 'Posting…' : 'Post update'}
            </button>
          </div>
        </div>
      )}

      {updates.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
          No updates yet. Keep investors in the loop as your raise progresses.
        </div>
      ) : (
        <ul className="space-y-3">
          {updates.map((u) => (
            <li key={u.id} className="border border-gray-200 dark:border-gray-800 rounded-lg p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{u.subject}</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
                  {u.created_at ? new Date(u.created_at).toLocaleDateString() : ''}
                </div>
              </div>
              {u.body && <div className="mt-1 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{u.body}</div>}
              <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Recorded for {u.recipients_count ?? 0} active prospect{(u.recipients_count ?? 0) === 1 ? '' : 's'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
