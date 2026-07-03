// Task #68 — Public Job Board: applicant's own applications tracker.
// gray palette, useToast, no nav wrapper. Reads jobsApi.myApplications (which
// also best-effort links pre-registration applications to the caller by email).
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, ExternalLink } from 'lucide-react';
import { jobs as jobsApi } from '../../lib/api';
import { useToast } from '../../components/useToast';

const APP_STATUS_STYLES = {
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  reviewing: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  accepted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

export default function MyApplicationsPage() {
  const { toast, showToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await jobsApi.myApplications();
      setRows(Array.isArray(res?.applications) ? res.applications : []);
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not load your applications.' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      {toast ? (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${toast.kind === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
          {toast.msg}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">My applications</h1>
        <Link to="/jobs" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          Browse open roles →
        </Link>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400 py-12 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Briefcase size={32} className="mx-auto mb-3 opacity-50" />
          <p className="font-medium">You haven't applied to any roles yet</p>
          <p className="text-sm mt-1">
            <Link to="/jobs" className="text-blue-600 dark:text-blue-400 hover:underline">Browse the job board</Link> to find your next role.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((app) => (
            <li
              key={app.id}
              className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{app.job?.title || 'Role'}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    {app.job?.project_name ? <span>{app.job.project_name}</span> : null}
                    <span>Applied {fmtDate(app.created_at)}</span>
                  </div>
                </div>
                <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${APP_STATUS_STYLES[app.status] || APP_STATUS_STYLES.submitted}`}>
                  {app.status}
                </span>
              </div>
              {app.job?.slug && app.job?.status === 'published' ? (
                <Link
                  to={`/jobs/${app.job.slug}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <ExternalLink size={14} /> View role
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
