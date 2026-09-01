import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BriefcaseBusiness, ChevronRight, Filter, RefreshCw, Sparkles, UserRound, Users } from 'lucide-react';
import { api, jobs as jobsApi } from '../../lib/api';
import './founderGrowDesk.css';
import './founderGrowTalent.css';

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const text = (value, fallback = 'Not recorded') => String(value ?? '').trim() || fallback;
const dateLabel = (value) => {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};
const projectMatch = (job, project) => project && String(job?.project_id ?? '') === String(project.id);
const shortStatus = (status) => text(status, 'Stage not recorded').replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const shortlisted = (application) => ['shortlisted', 'interview', 'offer', 'hired'].includes(String(application?.status || '').toLowerCase());

export default function FounderGrowTalent() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [view, setView] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      let available = [];
      try { available = list(await api.listProjects(), 'items', 'projects'); } catch (cause) {
        if (!requestedId) throw cause;
        setError('The startup list is unavailable; talent records are still being checked.');
      }
      const selected = available.find((item) => String(item.id) === requestedId) || available[0] || (requestedId ? { id: Number(requestedId), name: 'Selected project', unavailable_name: true } : null);
      setProjects(available.length ? available : selected ? [selected] : []);
      setProject(selected);
      if (!selected) { setJobs([]); setApplications([]); return; }
      if (String(selected.id) !== requestedId) {
        setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(selected.id)); return next; }, { replace: true });
      }
      try {
        const response = await jobsApi.mine();
        const linkedJobs = list(response, 'jobs').filter((job) => projectMatch(job, selected));
        setJobs(linkedJobs);
        const applicationResults = await Promise.allSettled(linkedJobs.map((job) => jobsApi.applications(job.id)));
        const loaded = applicationResults.flatMap((result) => result.status === 'fulfilled' ? list(result.value, 'applications') : []);
        setApplications(loaded.map((application) => ({ ...application, job: linkedJobs.find((job) => String(job.id) === String(application.posting_id)) || null })));
        if (applicationResults.some((result) => result.status === 'rejected')) setError('Some selected-project applicant sources are unavailable.');
      } catch (cause) {
        setJobs([]); setApplications([]); setError(cause?.message || 'The talent source is unavailable.');
      }
    } catch (cause) {
      setProject(null); setJobs([]); setApplications([]); setError(cause?.message || 'The project source is unavailable.');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [requestedId]);

  const query = project?.id ? `?project_id=${project.id}` : '';
  const selectedJobId = jobs[0]?.id;
  const visible = useMemo(() => {
    if (view === 'shortlisted') return applications.filter(shortlisted);
    if (view !== 'all') return applications.filter((application) => String(application.job?.id) === String(view));
    return applications;
  }, [applications, view]);
  const applicantCount = applications.length;
  const shortlistCount = applications.filter(shortlisted).length;
  const selectedJob = jobs.find((job) => String(job.id) === String(view)) || jobs[0];
  const nav = [['Focus', `/grow/focus${query}`], ['Talent', `/grow/talent${query}`], ['Customers', `/grow/customers${query}`], ['Partnerships', `/grow/partnerships${query}`], ['Capital match', `/grow/capital-match${query}`], ['Brand', `/grow/brand${query}`], ['Launch', `/grow/launch${query}`]];

  return <main className="a5-grow fg-talent" data-testid="founder-grow-talent"><div className="a5-grow-canvas"><div className="a5-grow-main">
    <header className="a5-grow-hero"><div className="fg-talent-crumb"><Link to={`/grow/focus${query}`}><ArrowLeft size={13} /> Grow</Link><span>‹</span><b>Talent</b></div><span>Founder / Grow</span><div><h1>Talent</h1><p>Roles, ranked candidates, job posts and applications.</p></div>{projects.length > 1 && <label className="fg-talent-picker"><span>Startup</span><select data-testid="select-grow-talent-project" value={project?.id || ''} onChange={(event) => { const next = new URLSearchParams(params); next.set('project_id', event.target.value); setParams(next); }}><option value="" disabled>Select a startup</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<nav aria-label="Grow sections">{nav.map(([label, to]) => <Link data-testid={`link-grow-talent-${label.toLowerCase().replace(' ', '-')}`} key={label} to={to} className={label === 'Talent' ? 'is-active' : ''}>{label}</Link>)}</nav></header>
    {error && <div className="a5-grow-error" data-testid="status-grow-talent-partial"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {loading ? <TalentSkeleton /> : !project ? <EmptyTalent /> : <TalentContent project={project} jobs={jobs} applications={applications} visible={visible} selectedJob={selectedJob} selectedJobId={selectedJobId} view={view} setView={setView} query={query} applicantCount={applicantCount} shortlistCount={shortlistCount} error={error} />}
  </div><TalentRail project={project} jobs={jobs} applications={applications} error={error} /></div></main>;
}

function TalentContent({ project, jobs, applications, visible, selectedJob, selectedJobId, view, setView, query, applicantCount, shortlistCount, error }) {
  return <div className="a5-sections"><div className="fg-talent-context"><div><span>Selected startup</span><strong data-testid="text-grow-talent-project">{text(project.name)}</strong></div><div><span>Talent source</span><strong>{error ? 'Unavailable' : jobs.length ? 'Stored job postings' : 'No linked roles'}</strong></div></div>
    <div className="fg-talent-tabs"><div>{[['all', 'All roles'], ...jobs.slice(0, 3).map((job) => [String(job.id), text(job.title, 'Untitled role')]), ['shortlisted', 'Shortlisted']].map(([key, label]) => <button type="button" className={view === key ? 'is-active' : ''} key={key} onClick={() => setView(key)}>{label}</button>)}</div><div className="fg-talent-actions"><Link to={`/build/team?mode=workspace&project_id=${project.id}`} data-testid="link-open-grow-talent-workspace"><BriefcaseBusiness size={13} /> Open workspace</Link></div></div>
    <div className="fg-talent-stats"><Stat label="Applicants" value={error ? 'Unavailable' : applicantCount} note={error ? 'Applicant source unavailable' : `across ${jobs.length} linked role${jobs.length === 1 ? '' : 's'}`} muted={Boolean(error)} /><Stat label="Shortlisted" value={error ? 'Unavailable' : shortlistCount} note={error ? 'Applicant source unavailable' : applications.length ? `${Math.round((shortlistCount / applications.length) * 100)}% of applicants` : 'No applicants recorded'} muted={Boolean(error)} /><Stat label="Time to screen" value="Unavailable" note="No screening-event source connected" muted /><Stat label="Reserved" value="Unavailable" note="No project equity-reservation source connected" muted /></div>
    <section className="a5-card fg-talent-table"><Head icon={Users} title={`Ranked candidates · ${text(selectedJob?.title, 'selected role')}`} meta="The score always says why" />{!jobs.length ? <EmptyTable error={error} /> : <CandidateTable rows={visible} />}</section>
    <section className="a5-focus fg-talent-read"><div className="a5-head"><div><Sparkles size={15} /><h2>Read the match honestly</h2></div><span>Source-derived</span></div><p>{error ? 'The selected-project talent source is unavailable, so FG2 cannot determine whether roles or applications exist. Candidate ranking, screening time, and reserved shares remain unavailable.' : selectedJob ? `The current role is ${text(selectedJob.title)}. Candidate fit scores and rank explanations are ${visible.length ? 'not recorded by the source' : 'not available because no candidates are returned'}; FG2 does not score people from application text.` : 'No role is linked to this startup, so candidate ranking, screening time, and reserved shares remain unavailable.'}</p><Link className="a5-link" to={`/build/team?mode=workspace&project_id=${project.id}`}>Open talent workspace <ChevronRight size={14} /></Link></section>
  </div>;
}
function CandidateTable({ rows }) {
  if (!rows.length) return <EmptyTable />;
  return <div className="fg-talent-table-wrap"><table><thead><tr><th>Candidate</th><th>Fit</th><th>Stage</th><th>Why this rank</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}><td><strong>{text(row.name || row.member?.name, 'Candidate name not recorded')}</strong><small>{row.created_at ? `Applied ${dateLabel(row.created_at)}` : 'Application date not recorded'}</small></td><td><span className="fg-talent-pill">Not scored</span></td><td><span className="fg-talent-pill is-stage">{shortStatus(row.status)}</span></td><td className="fg-talent-reason">No fit rationale recorded.</td></tr>)}</tbody></table></div>;
}
function EmptyTable({ error }) { return <div className="a5-empty"><UserRound size={18} /><div><b>{error ? 'Talent source unavailable.' : 'No selected-project applicants are recorded.'}</b><p>FG2 does not infer candidates, scores, screening times, or role reservations.</p></div></div>; }
function Head({ icon: Icon, title, meta }) { return <div className="a5-head"><div><Icon size={15} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Stat({ label, value, note, muted }) { return <div className={`fg-talent-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function TalentRail({ project, jobs, applications, error }) { return <aside className="a5-rail"><div className="a5-rail-title"><span>Worker AI · Grow</span><Sparkles size={14} /></div><div className="fg-talent-rail-callout"><b>Read-only matching</b><p>This rail summarizes stored roles and applications. It does not rank candidates, reject applicants, or send email.</p></div><div><span>Coverage</span><strong>{!project ? 'No project selected' : error ? 'Role source unavailable' : `${jobs.length} linked role${jobs.length === 1 ? '' : 's'}`}</strong><strong>{!project || error ? 'Applicant source unavailable' : `${applications.length} application${applications.length === 1 ? '' : 's'}`}</strong></div><div className="fg-talent-rail-muted"><span>Unavailable here</span><strong>Fit scoring</strong><p>No match score or rationale source is connected.</p><strong>Screening analytics</strong><p>No screening-event or reservation source is connected.</p></div><footer>Read-only summary · no automated actions</footer></aside>; }
function TalentSkeleton() { return <div className="a5-skeleton" data-testid="status-grow-talent-loading"><i /><i /><div><i /><i /><i /></div></div>; }
function EmptyTalent() { return <div className="a5-empty fg-talent-empty"><Users size={20} /><div><b>No startup is available.</b><p>Talent is scoped to an authenticated startup and its stored roles.</p></div></div>; }