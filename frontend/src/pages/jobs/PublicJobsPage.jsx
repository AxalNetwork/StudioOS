/**
 * `/jobs` — Jobs, built to the owner's canvas (D679, #1553;
 * `design/canvases/integrated/Axal VC Website.dc.html`, JOBS).
 *
 * The rows are the public job feed (`GET /api/public/jobs`): roles a founder
 * posted against their company and an admin approved. The canvas's filter
 * pills (Engineering, Go-to-market, Operations) name a field no posting has;
 * the pills here are the posting's own `employment_type`, and the search,
 * level and remote filters this page already had stay beside them.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, Search } from 'lucide-react';
import SitePage from '../../components/site/SitePage';
import NetworkSubNav from '../../components/site/NetworkSubNav';
import { EmptyNote, FilterPills } from '../../components/site/SiteBlocks';
import { jobsPublic } from '../../lib/api';
import { reportError } from '../../lib/log';
import {
  JOBS_COPY, JOB_TYPE_FILTERS, EMPLOYMENT_LABELS, SENIORITY_LABELS, avatarTone, companyInitials, jobGeo,
} from '../../lib/siteNetwork2';
import '../site/network2.css';

/** Where "Post a role" goes: the job editor, behind sign-in (the founder workspace's own "Post a role"). */
export const POST_ROLE_HREF = '/jobs/new';

/** One role, as the canvas's row: initials, title, company, type, place, View role. */
export function JobRow({ job }) {
  const initials = companyInitials(job.startup_name);
  const line = [job.startup_name, SENIORITY_LABELS[job.seniority]].filter(Boolean).join(' · ');
  const geo = jobGeo(job);
  return (
    <Link to={`/jobs/${job.slug}`} className="ax-n2-row">
      <span className="ax-avatar ax-n2-av" aria-hidden="true" style={{ background: avatarTone(job.startup_name || job.title) }}>
        {initials || <Briefcase size={16} />}
      </span>
      <div className="ax-n2-main">
        <h2 className="ax-n2-row-t">{job.title}</h2>
        {line && <p className="ax-n2-row-d">{line}</p>}
      </div>
      <div className="ax-n2-side">
        <span className="ax-chip ax-chip-quiet">{EMPLOYMENT_LABELS[job.employment_type] || job.employment_type}</span>
        {geo && <span className="ax-n2-geo">{geo}</span>}
        <span className="ax-n2-row-cta">View role</span>
      </div>
    </Link>
  );
}

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
          reportError('PublicJobsPage:load', e);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    // Debounce the free-text search; filters apply immediately.
    const t = setTimeout(load, q ? 300 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, employmentType, seniority, remoteOnly]);

  const hasFilters = q || employmentType || seniority || remoteOnly;

  return (
    <SitePage title={JOBS_COPY.title}>
      <NetworkSubNav />
      <div className="ax-wrap ax-n2-page">
        <header>
          <div className="ax-lbl-q">{JOBS_COPY.eyebrow}</div>
          <h1 className="ax-n2-h1">{JOBS_COPY.title}</h1>
          <p className="ax-n2-lede">{JOBS_COPY.lede}</p>
        </header>

        <div style={{ marginTop: 30 }}>
          <FilterPills label="Job type" options={JOB_TYPE_FILTERS} value={employmentType} onChange={setEmploymentType} />
          <div className="ax-n2-tools">
            <label className="ax-n2-search" style={{ position: 'relative', display: 'flex' }}>
              <span className="sr-only">Search roles</span>
              <Search size={15} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ax-faint)' }} />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search roles, companies or cities"
                className="ax-n2-input"
                style={{ width: '100%', paddingLeft: 34 }}
              />
            </label>
            <select
              value={seniority}
              onChange={(e) => setSeniority(e.target.value)}
              className="ax-n2-select"
              aria-label="Level"
            >
              <option value="">All levels</option>
              {Object.entries(SENIORITY_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
            <label className="ax-n2-check">
              <input
                type="checkbox"
                checked={remoteOnly}
                onChange={(e) => setRemoteOnly(e.target.checked)}
              />
              <span>Remote only</span>
            </label>
          </div>
        </div>

        {loading ? (
          <EmptyNote>Loading roles…</EmptyNote>
        ) : error ? (
          <p role="alert" className="ax-n2-alert">{error}</p>
        ) : jobs.length === 0 ? (
          <EmptyNote>{hasFilters ? 'No open roles match these filters.' : 'No open roles right now.'}</EmptyNote>
        ) : (
          <ul className="ax-n2-list">
            {jobs.map((job) => <li key={job.id}><JobRow job={job} /></li>)}
          </ul>
        )}

        <section className="ax-n2-band" aria-labelledby="ax-n2-post">
          <div>
            <h2 id="ax-n2-post" className="ax-n2-band-t">{JOBS_COPY.bandTitle}</h2>
            <p className="ax-n2-band-d">{JOBS_COPY.bandCopy}</p>
          </div>
          <Link to={POST_ROLE_HREF} className="ax-btn ax-btn-md ax-btn-primary">Post a role →</Link>
        </section>
      </div>
    </SitePage>
  );
}
