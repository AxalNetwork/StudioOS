import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldAlert, Plus, RefreshCw, Search, ExternalLink } from 'lucide-react';
import { dd } from '../lib/api';
import { reportError } from '../lib/log';
import { useToast } from '../components/useToast';
import { useEscapeClose } from '../components/useEscapeClose';

const BAND_STYLES = {
  green: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  yellow: 'bg-amber-100 text-amber-700 border-amber-200',
  amber: 'bg-orange-100 text-orange-700 border-orange-200',
  red: 'bg-red-100 text-red-700 border-red-200',
};
const STATUS_STYLES = {
  open: 'bg-sky-50 text-sky-700',
  in_review: 'bg-violet-50 text-violet-700',
  completed: 'bg-emerald-50 text-emerald-700',
  archived: 'bg-gray-50 text-gray-500',
};

export default function AdminDueDiligencePage() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [filter, setFilter] = useState({ status: '', risk_band: '', subject_type: '' });
  const [search, setSearch] = useState('');
  const [openModal, setOpenModal] = useState(false);
  const { toast, push } = useToast();
  const location = useLocation();
  // Task #83 — the same page is mounted at both /admin/due-diligence (admin) and
  // /due-diligence (investor). Derive the base so internal links stay on the
  // caller's surface and investors never get bounced through an /admin URL.
  const base = location.pathname.startsWith('/admin') ? '/admin/due-diligence' : '/due-diligence';

  const load = async () => {
    setLoading(true);
    setUnavailable(false);
    try {
      const res = await dd.listCases(filter);
      setCases(res.items || []);
    } catch (e) {
      // The DD case store is worker-only (D1); in the dev FastAPI backend the
      // endpoint 404s. Surface the same "unavailable in dev" banner the other
      // store-backed admin panels use instead of a scary error toast.
      if (e?.status === 404) {
        setUnavailable(true);
        setCases([]);
      } else {
        reportError('AdminDueDiligencePage:list', e);
        push(e.message || 'Failed to load cases', 'error');
      }
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter.status, filter.risk_band, filter.subject_type]);

  const filtered = useMemo(() => {
    if (!search.trim()) return cases;
    const q = search.toLowerCase();
    return cases.filter(c => (c.subject_label || '').toLowerCase().includes(q) || (c.uid || '').includes(q));
  }, [cases, search]);

  const counts = useMemo(() => ({
    total: cases.length,
    red: cases.filter(c => c.risk_band === 'red').length,
    amber: cases.filter(c => c.risk_band === 'amber').length,
    open: cases.filter(c => c.status === 'open' || c.status === 'in_review').length,
  }), [cases]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <ShieldAlert size={24} className="text-violet-600" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Due Diligence</h1>
      </div>
      <p className="text-gray-600 dark:text-gray-400 mb-6">Open and track DD cases on startups, founders, advisors, investors, and partners.</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          ['Total', counts.total, 'text-gray-700'],
          ['Red flags', counts.red, 'text-red-600'],
          ['Amber', counts.amber, 'text-orange-600'],
          ['Active', counts.open, 'text-violet-600'],
        ].map(([label, n, color]) => (
          <div key={label} className="px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <div className={`text-2xl font-bold ${color}`}>{n}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">{label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search subject or case ID…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800" />
        </div>
        <select value={filter.subject_type} onChange={(e) => setFilter(f => ({ ...f, subject_type: e.target.value }))}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
          <option value="">All subject types</option>
          <option value="project">Startup</option>
          <option value="founder">Founder</option>
          <option value="advisor">Advisor</option>
          <option value="investor">Investor</option>
          <option value="partner">Partner</option>
        </select>
        <select value={filter.status} onChange={(e) => setFilter(f => ({ ...f, status: e.target.value }))}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_review">In review</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
        <select value={filter.risk_band} onChange={(e) => setFilter(f => ({ ...f, risk_band: e.target.value }))}
          className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
          <option value="">All risk bands</option>
          <option value="green">Green</option>
          <option value="yellow">Yellow</option>
          <option value="amber">Amber</option>
          <option value="red">Red</option>
        </select>
        <button onClick={load} className="p-2 text-gray-600 hover:text-violet-600" title="Refresh"><RefreshCw size={16} /></button>
        <button onClick={() => setOpenModal(true)}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700">
          <Plus size={14} /> New case
        </button>
      </div>

      {unavailable && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 text-sm rounded-xl px-4 py-3 mb-4 flex items-start gap-2">
          <ShieldAlert size={16} className="mt-0.5 flex-shrink-0" />
          <div>Due diligence cases are managed by the production worker and aren't available in this development environment. Deploy the worker to open and track cases.</div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-500 text-sm">Loading…</div>
        ) : unavailable ? (
          <div className="p-10 text-center text-gray-400 text-sm">Case list is unavailable in this environment.</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-500 text-sm">No cases match the current filters.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
                <th className="text-left px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs font-medium">Subject</th>
                <th className="text-left px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs font-medium">Type</th>
                <th className="text-center px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs font-medium">Status</th>
                <th className="text-center px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs font-medium">Risk</th>
                <th className="text-center px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs font-medium">Score</th>
                <th className="text-left px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs font-medium">Opened</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700/40 hover:bg-violet-50/40 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                    <Link to={`${base}/${c.uid}`} className="hover:text-violet-600">{c.subject_label}</Link>
                    <div className="text-[11px] text-gray-400 font-mono">{c.uid.slice(0, 12)}…</div>
                  </td>
                  <td className="px-4 py-3 capitalize text-gray-700 dark:text-gray-300">{c.subject_type}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[c.status] || STATUS_STYLES.open}`}>{c.status}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {c.risk_band ? (
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border ${BAND_STYLES[c.risk_band]}`}>{c.risk_band.toUpperCase()}</span>
                    ) : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs">
                    {c.risk_score != null ? Math.round(c.risk_score * 100) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`${base}/${c.uid}`} className="text-violet-600 hover:underline text-xs inline-flex items-center gap-1">
                      Open <ExternalLink size={11} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openModal && <NewCaseModal onClose={() => setOpenModal(false)} onCreated={() => { setOpenModal(false); load(); push('Case opened', 'success'); }} />}
      {toast}
    </div>
  );
}

function NewCaseModal({ onClose, onCreated }) {
  useEscapeClose(onClose);
  const [form, setForm] = useState({
    subject_type: 'project', subject_id: '', subject_label: '',
    subject_email: '', subject_legal_name: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.subject_id || !form.subject_label) { setErr('Subject ID and label are required.'); return; }
    setBusy(true);
    try {
      await dd.openCase({ ...form, subject_id: Number(form.subject_id) });
      onCreated();
    } catch (e) { setErr(e.message || 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full p-6 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Open new DD case</h3>
        <div className="space-y-3 text-sm">
          <label className="block">
            <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Subject type</div>
            <select value={form.subject_type} onChange={(e) => setForm(f => ({ ...f, subject_type: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900">
              <option value="project">Startup</option><option value="founder">Founder</option>
              <option value="advisor">Advisor</option><option value="investor">Investor</option>
              <option value="partner">Partner</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Subject ID</div>
              <input value={form.subject_id} onChange={(e) => setForm(f => ({ ...f, subject_id: e.target.value }))}
                placeholder="e.g. 42" className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900" />
            </label>
            <label className="block">
              <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Display label</div>
              <input value={form.subject_label} onChange={(e) => setForm(f => ({ ...f, subject_label: e.target.value }))}
                placeholder="Acme Robotics" className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900" />
            </label>
          </div>
          <label className="block">
            <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Subject email (encrypted at rest)</div>
            <input type="email" value={form.subject_email} onChange={(e) => setForm(f => ({ ...f, subject_email: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900" />
          </label>
          <label className="block">
            <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Legal name (encrypted at rest)</div>
            <input value={form.subject_legal_name} onChange={(e) => setForm(f => ({ ...f, subject_legal_name: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900" />
          </label>
          <label className="block">
            <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Analyst notes</div>
            <textarea rows={3} value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900" />
          </label>
          {err && <div className="text-xs text-red-600">{err}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">Cancel</button>
          <button type="submit" disabled={busy}
            className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:opacity-60">
            {busy ? 'Opening…' : 'Open case'}
          </button>
        </div>
      </form>
    </div>
  );
}
