// Task #68 — Public Job Board: admin review queue.
// Mirrors AdminEventsPage. NOTE: the admin/jobs routes are worker-only; the dev
// FastAPI backend does not implement them, so this page 404s in local dev.
// gray palette, useToast, no nav wrapper (rendered inside the admin layout).
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, MapPin, Globe, Users, CheckCircle2, XCircle, EyeOff, Loader2 } from 'lucide-react';
import { adminJobs } from '../../lib/api';
import { useToast } from '../../components/useToast';

const STATUS_TABS = [
  { id: 'pending_review', label: 'In review' },
  { id: 'published', label: 'Published' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'draft', label: 'Draft' },
  { id: 'closed', label: 'Closed' },
  { id: '', label: 'All' },
];
const JOB_STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  pending_review: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  closed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};
const EMPLOYMENT_LABELS = {
  full_time: 'Full-time', part_time: 'Part-time', intern: 'Internship', contract: 'Contract',
};

export default function AdminJobsPage() {
  const { toast, showToast } = useToast();
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminJobs.list({ status: statusFilter || undefined });
      setRows(Array.isArray(res?.jobs) ? res.jobs : []);
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not load roles.' });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, showToast]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, id, okMsg) => {
    setBusyId(id);
    try {
      await fn();
      showToast({ kind: 'success', msg: okMsg });
      await load();
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Action failed.' });
    } finally {
      setBusyId(null);
    }
  };

  const approve = (id) => act(() => adminJobs.approve(id), id, 'Role approved and published.');
  const unpublish = (id) => act(() => adminJobs.unpublish(id), id, 'Role unpublished.');
  const reject = (id) => {
    const reason = window.prompt('Reason for rejection (optional):') ?? '';
    return act(() => adminJobs.reject(id, reason || null), id, 'Role rejected.');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      {toast ? (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${toast.kind === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
          {toast.msg}
        </div>
      ) : null}

      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Job board review</h1>

      <div className="flex flex-wrap gap-2 mb-6">
        {STATUS_TABS.map((t) => (
          <button
            key={t.id || 'all'}
            onClick={() => setStatusFilter(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              statusFilter === t.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400 py-12 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Briefcase size={32} className="mx-auto mb-3 opacity-50" />
          <p className="font-medium">Nothing here</p>
          <p className="text-sm mt-1">No roles match this filter.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((job) => (
            <li
              key={job.id}
              className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{job.title}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    {job.startup_name ? <span>{job.startup_name}</span> : null}
                    <span>{EMPLOYMENT_LABELS[job.employment_type] || job.employment_type}</span>
                    {job.remote ? (
                      <span className="inline-flex items-center gap-1"><Globe size={13} /> Remote</span>
                    ) : job.location_text ? (
                      <span className="inline-flex items-center gap-1"><MapPin size={13} /> {job.location_text}</span>
                    ) : null}
                    <span className="inline-flex items-center gap-1"><Users size={13} /> {job.application_count ?? 0}</span>
                  </div>
                </div>
                <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${JOB_STATUS_STYLES[job.status] || JOB_STATUS_STYLES.draft}`}>
                  {job.status}
                </span>
              </div>
              {job.summary ? (
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{job.summary}</p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {job.slug && job.status === 'published' ? (
                  <Link
                    to={`/jobs/${job.slug}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    View live
                  </Link>
                ) : null}
                {job.status !== 'published' ? (
                  <button
                    onClick={() => approve(job.id)}
                    disabled={busyId === job.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busyId === job.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve
                  </button>
                ) : null}
                {job.status === 'pending_review' ? (
                  <button
                    onClick={() => reject(job.id)}
                    disabled={busyId === job.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                  >
                    <XCircle size={14} /> Reject
                  </button>
                ) : null}
                {job.status === 'published' ? (
                  <button
                    onClick={() => unpublish(job.id)}
                    disabled={busyId === job.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                  >
                    <EyeOff size={14} /> Unpublish
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
