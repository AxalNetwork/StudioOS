// Task #68 — Public Job Board: public feed (no auth).
// Mirrors PublicEventsPage: slate palette, pt-16, PublicNav + PublicFooter,
// violet accents. Lists admin-approved published roles with light filtering.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, MapPin, Globe, Search, Loader2, AlertTriangle } from 'lucide-react';
import PublicNav from '../../components/PublicNav';
import PublicFooter from '../../components/PublicFooter';
import { jobsPublic } from '../../lib/api';
import { reportError } from '../../lib/log';

const EMPLOYMENT_LABELS = {
  full_time: 'Full-time', part_time: 'Part-time', intern: 'Internship', contract: 'Contract',
};
const SENIORITY_LABELS = {
  intern: 'Intern', junior: 'Junior', mid: 'Mid-level', senior: 'Senior', lead: 'Lead', executive: 'Executive',
};

export default function PublicJobsPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [seniority, setSeniority] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await jobsPublic.list({
          q: q.trim() || undefined,
          employment_type: employmentType || undefined,
          seniority: seniority || undefined,
          remote: remoteOnly || undefined,
        });
        if (!cancelled) setJobs(Array.isArray(res?.jobs) ? res.jobs : []);
      } catch (e) {
        if (!cancelled) {
          setError('Could not load open roles. Please try again.');
          reportError(e, { where: 'PublicJobsPage.load' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    // Debounce the free-text search; filters apply immediately.
    const t = setTimeout(load, q ? 300 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, employmentType, seniority, remoteOnly]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col pt-16">
      <PublicNav />
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-10">
        <header className="mb-8">
          <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400 mb-2">
            <Briefcase size={20} />
            <span className="text-sm font-semibold uppercase tracking-wide">Job Board</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Open roles across the studio</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400 max-w-2xl">
            Founders in the Axal network are hiring. Browse open roles and apply directly —
            no account required.
          </p>
        </header>

        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search roles"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <select
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">All types</option>
            {Object.entries(EMPLOYMENT_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <select
            value={seniority}
            onChange={(e) => setSeniority(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">All levels</option>
            {Object.entries(SENIORITY_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={remoteOnly}
              onChange={(e) => setRemoteOnly(e.target.checked)}
              className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
            />
            <span>Remote only</span>
          </label>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-500">
            <Loader2 className="animate-spin mr-2" size={20} /> Loading roles…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-4 py-3">
            <AlertTriangle size={18} /> {error}
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-20 text-slate-500 dark:text-slate-400">
            <Briefcase size={32} className="mx-auto mb-3 opacity-50" />
            <p className="font-medium">No open roles right now</p>
            <p className="text-sm mt-1">Check back soon — new roles are posted regularly.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  to={`/jobs/${job.slug}`}
                  className="block rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 hover:border-violet-400 dark:hover:border-violet-500 hover:shadow-sm transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {job.title}
                      </h2>
                      {job.startup_name ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{job.startup_name}</p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                      {EMPLOYMENT_LABELS[job.employment_type] || job.employment_type}
                    </span>
                  </div>
                  {job.summary ? (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{job.summary}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    {job.seniority ? (
                      <span>{SENIORITY_LABELS[job.seniority] || job.seniority}</span>
                    ) : null}
                    {job.remote ? (
                      <span className="inline-flex items-center gap-1"><Globe size={13} /> Remote</span>
                    ) : job.location_text ? (
                      <span className="inline-flex items-center gap-1"><MapPin size={13} /> {job.location_text}</span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
