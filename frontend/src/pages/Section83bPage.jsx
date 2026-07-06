import React, { useEffect, useMemo, useState } from 'react';
import PageExplainer from '../components/PageExplainer';
import { useNavigate } from 'react-router-dom';
import {
  Calendar, Clock, Mail, Upload, CheckCircle2, AlertTriangle, FileText,
  Plus, Loader2, ArrowLeft, ShieldAlert, ListChecks, X,
} from 'lucide-react';
import { api } from '../lib/api';

// Task #31 — 83(b) tracker.
//
// 83(b) elections must be mailed to the IRS within 30 days of grant. Missing
// the deadline converts the grant to ordinary income at vest, which is a
// painful avoidable disaster. This page lists trackers with a live countdown,
// the IRS-mailing checklist, certified-mail receipt upload, and creates a
// notification ping for the deadline.

function CountdownPill({ days, status }) {
  if (status === 'mailed' || status === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800">
        <CheckCircle2 size={12} /> {status === 'confirmed' ? 'Confirmed' : 'Mailed'}
      </span>
    );
  }
  if (days < 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-800">
        <ShieldAlert size={12} /> {Math.abs(days)} day{Math.abs(days) === 1 ? '' : 's'} overdue
      </span>
    );
  }
  if (days <= 7) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-900">
        <Clock size={12} /> {days} day{days === 1 ? '' : 's'} left
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-violet-100 text-violet-800">
      <Clock size={12} /> {days} days left
    </span>
  );
}

function CreateModal({ open, onClose, projects: parentProjects, onCreated }) {
  const [projectId, setProjectId] = useState('');
  const [taxpayer, setTaxpayer] = useState('');
  const [grantDate, setGrantDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [localProjects, setLocalProjects] = useState([]);

  // Fallback: if the parent's project list didn't load (e.g. transient
  // network blip on first render), fetch it ourselves when the modal opens
  // so the user is never stuck with an empty dropdown.
  const projects = parentProjects.length ? parentProjects : localProjects;
  useEffect(() => {
    if (open && parentProjects.length === 0 && localProjects.length === 0) {
      api.listProjects().then((p) => {
        setLocalProjects(Array.isArray(p) ? p : (p?.projects || []));
      }).catch(() => {});
    }
  }, [open, parentProjects.length, localProjects.length]);

  useEffect(() => {
    if (open && projects.length && !projectId) setProjectId(String(projects[0].id));
  }, [open, projects, projectId]);

  if (!open) return null;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.legal83bCreate({
        project_id: Number(projectId),
        taxpayer_name: taxpayer.trim(),
        grant_date: grantDate,
      });
      onCreated(r.tracker);
      onClose();
    } catch (e) {
      setError(e?.message || 'Failed to create tracker');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 dark:bg-gray-900">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">New 83(b) tracker</h3>
            <p className="text-xs text-gray-500 mt-1">We'll compute the 30-day deadline and send a reminder.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <div className="text-xs font-semibold text-gray-700 mb-1 dark:text-gray-300">Startup</div>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm">
              <option value="">Select…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-xs font-semibold text-gray-700 mb-1 dark:text-gray-300">Taxpayer name (on the election)</div>
            <input value={taxpayer} onChange={(e) => setTaxpayer(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm" placeholder="Jane Q. Doe" />
          </label>
          <label className="block">
            <div className="text-xs font-semibold text-gray-700 mb-1 dark:text-gray-300">Grant date</div>
            <input type="date" value={grantDate} onChange={(e) => setGrantDate(e.target.value)}
              className="w-full border rounded-md px-3 py-2 text-sm" />
            <div className="text-[11px] text-gray-500 mt-1">Deadline = grant date + 30 calendar days.</div>
          </label>
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 inline-flex items-center gap-1">
              <AlertTriangle size={12} /> {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={busy || !projectId || !taxpayer.trim()}
            className="px-4 py-1.5 text-sm font-semibold rounded-md bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white inline-flex items-center gap-1">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create tracker
          </button>
        </div>
      </div>
    </div>
  );
}

function TrackerCard({ tracker, onChange }) {
  const [busy, setBusy] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const fileInputId = `file-${tracker.id}`;

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await api.legal83bUploadReceipt(tracker.id, file);
      onChange(r.tracker);
    } catch (e) {
      alert(e?.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const markMailed = async () => {
    setBusy(true);
    try {
      const r = await api.legal83bUpdate(tracker.id, {
        mailed_at: new Date().toISOString(),
        status: 'mailed',
      });
      onChange(r.tracker);
    } catch (e) { alert(e?.message || 'Failed'); } finally { setBusy(false); }
  };

  const markConfirmed = async () => {
    setBusy(true);
    try {
      const r = await api.legal83bUpdate(tracker.id, { status: 'confirmed' });
      onChange(r.tracker);
    } catch (e) { alert(e?.message || 'Failed'); } finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-gray-900 truncate dark:text-gray-100">{tracker.taxpayer_name}</h3>
            <CountdownPill days={tracker.days_left} status={tracker.status} />
          </div>
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1"><Calendar size={12} /> Grant {tracker.grant_date}</span>
            <span className="inline-flex items-center gap-1"><Mail size={12} /> Deadline {tracker.deadline_date}</span>
          </div>
        </div>
        {tracker.election_doc_id && (
          <a href={`/legal-capital`} className="text-xs text-violet-700 hover:text-violet-900 inline-flex items-center gap-1 shrink-0">
            <FileText size={12} /> Election doc
          </a>
        )}
      </div>

      <div>
        <button onClick={() => setShowSteps((s) => !s)}
          className="text-xs font-semibold text-gray-700 hover:text-gray-900 inline-flex items-center gap-1 dark:text-gray-300">
          <ListChecks size={14} /> {showSteps ? 'Hide' : 'Show'} IRS mailing checklist
        </button>
        {showSteps && (
          <ol className="mt-2 list-decimal pl-5 text-xs text-gray-700 space-y-1 dark:text-gray-300">
            {tracker.irs_mailing_steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {tracker.checklist.map((c) => (
          <div key={c.key} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded-md ${
            c.done ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-50 text-gray-600'
          }`}>
            {c.done ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Clock size={14} className="text-gray-400" />}
            <span>{c.label}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-2 border-t">
        <input id={fileInputId} type="file" className="hidden"
          accept="image/*,application/pdf"
          onChange={(e) => upload(e.target.files?.[0])} />
        <label htmlFor={fileInputId}
          className="px-3 py-1.5 text-xs font-semibold rounded-md border bg-white hover:bg-gray-50 cursor-pointer inline-flex items-center gap-1 dark:bg-gray-900">
          <Upload size={12} /> {tracker.receipt_doc_id ? 'Replace receipt' : 'Upload PS Form 3800 receipt'}
        </label>
        {!tracker.mailed_at && (
          <button onClick={markMailed} disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-violet-600 hover:bg-violet-700 text-white inline-flex items-center gap-1">
            <Mail size={12} /> Mark mailed today
          </button>
        )}
        {tracker.mailed_at && tracker.status !== 'confirmed' && (
          <button onClick={markConfirmed} disabled={busy}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1">
            <CheckCircle2 size={12} /> Mark confirmed (green card received)
          </button>
        )}
        {busy && <Loader2 size={14} className="animate-spin text-gray-400" />}
      </div>
    </div>
  );
}

export default function Section83bPage({ embedded = false }) {
  const navigate = useNavigate();
  const [trackers, setTrackers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true); setError(null);
    // Load in parallel but tolerate either failing — projects is only used
    // by the create modal, trackers by the list. A 5xx on one shouldn't
    // wipe the other.
    const [tr, pr] = await Promise.allSettled([api.legal83bList(), api.listProjects()]);
    if (tr.status === 'fulfilled') setTrackers(tr.value.trackers || []);
    else {
      // 404 = trackers route missing on this deployment (stale worker). The
      // empty-state card already covers "No 83(b) trackers yet" — don't
      // double up with a raw red banner above it.
      const reason = tr.reason;
      const msg = (reason?.message || '').toLowerCase();
      if (reason?.status === 404 || msg === 'not found') setTrackers([]);
      else setError(reason?.message || 'Failed to load trackers');
    }
    if (pr.status === 'fulfilled') {
      const p = pr.value;
      setProjects(Array.isArray(p) ? p : (p?.projects || []));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const onCreated = (t) => setTrackers((prev) => [t, ...prev.filter((x) => x.id !== t.id)]);
  const onChange = (t) => setTrackers((prev) => prev.map((x) => x.id === t.id ? t : x));

  const summary = useMemo(() => {
    const open = trackers.filter((t) => t.status === 'pending');
    const overdue = open.filter((t) => t.days_left < 0).length;
    const urgent = open.filter((t) => t.days_left >= 0 && t.days_left <= 7).length;
    return { open: open.length, overdue, urgent, mailed: trackers.filter((t) => t.status !== 'pending').length };
  }, [trackers]);

  return (
    <div className={embedded ? 'max-w-5xl mx-auto' : 'max-w-5xl mx-auto p-6'}>
      <div className="mb-6 flex items-start justify-between gap-4">
        {!embedded && (
          <div>
            <button onClick={() => navigate('/incorporate')}
              className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1 mb-1">
              <ArrowLeft size={12} /> Back to Incorporate
            </button>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">83(b) Election Tracker</h1>
            <PageExplainer pageKey="section_83b" />
            <p className="text-sm text-gray-600 mt-1">
              30-day countdown, IRS mailing checklist, and certified-mail receipt upload.
            </p>
          </div>
        )}
        <button onClick={() => setShowNew(true)}
          className="px-4 py-2 text-sm font-semibold rounded-md bg-violet-600 hover:bg-violet-700 text-white inline-flex items-center gap-1 shrink-0">
          <Plus size={14} /> New tracker
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-lg border p-3 dark:bg-gray-900">
          <div className="text-xs text-gray-500">Open</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{summary.open}</div>
        </div>
        <div className="bg-white rounded-lg border p-3 dark:bg-gray-900">
          <div className="text-xs text-gray-500">≤ 7 days</div>
          <div className="text-2xl font-bold text-amber-700">{summary.urgent}</div>
        </div>
        <div className="bg-white rounded-lg border p-3 dark:bg-gray-900">
          <div className="text-xs text-gray-500">Overdue</div>
          <div className="text-2xl font-bold text-red-700">{summary.overdue}</div>
        </div>
        <div className="bg-white rounded-lg border p-3 dark:bg-gray-900">
          <div className="text-xs text-gray-500">Mailed / confirmed</div>
          <div className="text-2xl font-bold text-emerald-700">{summary.mailed}</div>
        </div>
      </div>

      {loading && (
        <div className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      )}
      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3 inline-flex items-center gap-2 mb-4">
          <AlertTriangle size={14} /> {error}
        </div>
      )}
      {!loading && trackers.length === 0 && (
        <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-10 text-center dark:bg-gray-900 dark:border-gray-800">
          <Calendar size={28} className="mx-auto text-gray-400 mb-2" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">No 83(b) trackers yet</h3>
          <p className="text-sm text-gray-600 mt-1 max-w-md mx-auto">
            Create a tracker the day stock is granted to a founder. We'll generate the election,
            compute the 30-day deadline, and ping you before it closes.
          </p>
          <button onClick={() => setShowNew(true)}
            className="mt-4 px-4 py-2 text-sm font-semibold rounded-md bg-violet-600 hover:bg-violet-700 text-white inline-flex items-center gap-1">
            <Plus size={14} /> Start a tracker
          </button>
        </div>
      )}

      <div className="space-y-4">
        {trackers.map((t) => <TrackerCard key={t.id} tracker={t} onChange={onChange} />)}
      </div>

      <CreateModal open={showNew} onClose={() => setShowNew(false)} projects={projects} onCreated={onCreated} />
    </div>
  );
}
