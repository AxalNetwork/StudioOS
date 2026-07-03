// Task #68 — Public Job Board: founder's posted roles.
// Mirrors MyEventsPage (hosting tab): gray palette, useToast, no nav wrapper
// (rendered inside ProtectedLayout). Links out to the applicant-facing
// "My applications" tracker at /my/applications.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Briefcase, MapPin, Globe, Users, Settings, Pencil, FileText } from 'lucide-react';
import { jobs as jobsApi } from '../../lib/api';
import { useToast } from '../../components/useToast';

const JOB_STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  pending_review: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  closed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};
const JOB_STATUS_LABELS = {
  draft: 'Draft', pending_review: 'In review', published: 'Published', rejected: 'Needs changes', closed: 'Closed',
};
const EMPLOYMENT_LABELS = {
  full_time: 'Full-time', part_time: 'Part-time', intern: 'Internship', contract: 'Contract',
};

export default function MyJobsPage() {
  const { toast, showToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await jobsApi.mine();
      setRows(Array.isArray(res?.jobs) ? res.jobs : []);
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not load your roles.' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      {toast ? (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${toast.kind === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
          {toast.msg}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Roles you've posted</h1>
          <Link to="/my/applications" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            Track my applications →
          </Link>
        </div>
        <Link
          to="/jobs/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          <Plus size={16} /> New role
        </Link>
      </div>

      {loading ? (
        <div className="text-gray-500 dark:text-gray-400 py-12 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Briefcase size={32} className="mx-auto mb-3 opacity-50" />
          <p className="font-medium">You haven't posted any roles yet</p>
          <p className="text-sm mt-1">Create a role and submit it for review to publish it on the job board.</p>
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
                    <span className="inline-flex items-center gap-1"><Users size={13} /> {job.application_count ?? 0} applicant{(job.application_count ?? 0) === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <span className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${JOB_STATUS_STYLES[job.status] || JOB_STATUS_STYLES.draft}`}>
                  {JOB_STATUS_LABELS[job.status] || job.status}
                </span>
              </div>
              {job.status === 'rejected' && job.review_notes ? (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">Reviewer note: {job.review_notes}</p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to={`/jobs/${job.id}/edit`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Pencil size={14} /> Edit
                </Link>
                <Link
                  to={`/jobs/${job.id}/manage`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Settings size={14} /> Manage applicants
                </Link>
                {job.status === 'published' ? (
                  <Link
                    to={`/jobs/${job.slug}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <FileText size={14} /> View live
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
