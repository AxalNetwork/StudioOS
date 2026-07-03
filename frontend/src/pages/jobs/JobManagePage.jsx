// Task #68 — Public Job Board: manage a role's applicants.
// Mirrors EventManagePage: gray palette, useToast, no nav wrapper. The ONLY
// applicant-PII surface. Resumes are fetched via an on-demand one-time signed
// download URL (jobsApi.resume → { url, expires_at }) — never inlined.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, Download, Mail, Linkedin, Link2, Loader2, Users, Send, XCircle, CheckCircle2,
} from 'lucide-react';
import { jobs as jobsApi } from '../../lib/api';
import { useToast } from '../../components/useToast';

const JOB_STATUS_LABELS = {
  draft: 'Draft', pending_review: 'In review', published: 'Published', rejected: 'Needs changes', closed: 'Closed',
};
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

export default function JobManagePage() {
  const { id } = useParams();
  const { toast, showToast } = useToast();
  const [job, setJob] = useState(null);
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await jobsApi.applications(id);
      setJob(res?.job || null);
      setApplications(Array.isArray(res?.applications) ? res.applications : []);
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not load applicants.' });
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => { load(); }, [load]);

  const downloadResume = async (appId) => {
    setDownloadingId(appId);
    try {
      const res = await jobsApi.resume(id, appId);
      if (res?.url) {
        window.open(res.url, '_blank', 'noopener');
      } else {
        showToast({ kind: 'error', msg: 'Resume is unavailable.' });
      }
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not fetch the resume.' });
    } finally {
      setDownloadingId(null);
    }
  };

  const submitForReview = async () => {
    setBusy(true);
    try {
      await jobsApi.submitReview(id);
      showToast({ kind: 'success', msg: 'Role submitted for review.' });
      await load();
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not submit for review.' });
    } finally {
      setBusy(false);
    }
  };

  const closeRole = async () => {
    setBusy(true);
    try {
      await jobsApi.close(id);
      showToast({ kind: 'success', msg: 'Role closed.' });
      await load();
    } catch (e) {
      showToast({ kind: 'error', msg: e?.message || 'Could not close the role.' });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 text-gray-500">Loading…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      {toast ? (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${toast.kind === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
          {toast.msg}
        </div>
      ) : null}

      <Link to="/my/jobs" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 mb-4">
        <ArrowLeft size={16} /> Back to my roles
      </Link>

      {job ? (
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{job.title}</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {JOB_STATUS_LABELS[job.status] || job.status} · {applications.length} applicant{applications.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to={`/jobs/${job.id}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Edit
            </Link>
            {(job.status === 'draft' || job.status === 'rejected') ? (
              <button
                onClick={submitForReview}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                <Send size={14} /> Submit for review
              </button>
            ) : null}
            {job.status !== 'closed' ? (
              <button
                onClick={closeRole}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
              >
                <XCircle size={14} /> Close role
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {applications.length === 0 ? (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <Users size={32} className="mx-auto mb-3 opacity-50" />
          <p className="font-medium">No applications yet</p>
          <p className="text-sm mt-1">Applicants will appear here once your role is live and people apply.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {applications.map((app) => (
            <li
              key={app.id}
              className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100">{app.name || app.email}</h3>
                    {app.member ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                        <CheckCircle2 size={12} /> Member
                      </span>
                    ) : null}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${APP_STATUS_STYLES[app.status] || APP_STATUS_STYLES.submitted}`}>
                      {app.status}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <a href={`mailto:${app.email}`} className="inline-flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400">
                      <Mail size={13} /> {app.email}
                    </a>
                    {app.linkedin_url ? (
                      <a href={app.linkedin_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400">
                        <Linkedin size={13} /> LinkedIn
                      </a>
                    ) : null}
                    {app.portfolio_url ? (
                      <a href={app.portfolio_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400">
                        <Link2 size={13} /> Portfolio
                      </a>
                    ) : null}
                    <span>Applied {fmtDate(app.created_at)}</span>
                  </div>
                </div>
                {app.has_resume ? (
                  <button
                    onClick={() => downloadResume(app.id)}
                    disabled={downloadingId === app.id}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                  >
                    {downloadingId === app.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    Resume
                  </button>
                ) : null}
              </div>
              {app.cover_note ? (
                <p className="mt-3 text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap border-t border-gray-100 dark:border-gray-800 pt-3">
                  {app.cover_note}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
