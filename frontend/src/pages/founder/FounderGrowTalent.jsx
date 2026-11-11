import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, BriefcaseBusiness, ChevronRight, RefreshCw, Sparkles, UserRound, Users } from 'lucide-react';
import { api, jobs as jobsApi } from '../../lib/api';
import { growTalentApi } from '../../lib/api/growTalent';
import RankByFit from '../../ui/RankByFit';
import { applyRank } from '../../lib/rankByFit';
import { text, titleCase } from '../../lib/absence';
import { WorkerRail } from '../../ui';
import './founderGrowDesk.css';
import './founderGrowTalent.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { founderZoneFilters } from '../../workspaces/founderZoneFilters';
import { LensLink } from '../../workspaces/lens';

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const dateLabel = (value) => {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};
const projectMatch = (job, project) => project && String(job?.project_id ?? '') === String(project.id);
const shortStatus = (status) => titleCase(status) || 'Stage not recorded';
const shortlisted = (application) => ['shortlisted', 'interview', 'offer', 'hired'].includes(String(application?.status || '').toLowerCase());

/**
 * #3938 GR4 (D1478 part 9): the posting "Rank by fit" ranks, one at a time — the
 * role picked in the toolbar, or the only linked one. The route reads a posting
 * that is not a draft; a draft, or "All" with several roles, has no press.
 */
export function rankPosting(jobs, view) {
  const list = Array.isArray(jobs) ? jobs : [];
  const job = list.find((j) => String(j.id) === String(view)) || (view === 'all' && list.length === 1 ? list[0] : null);
  if (!job) return { job: null, why: list.length ? 'Pick a role to rank its applicants.' : null };
  if (String(job.status || '').toLowerCase() === 'draft') return { job: null, why: 'A draft role has no applicants to rank yet.' };
  return { job, why: null };
}

export default function FounderGrowTalent() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [project, setProject] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [view, setView] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // GR4: one posting's ranking `{ postingId, answer }`, a view only; a new read or another role puts the list back.
  const [rank, setRank] = useState(null);

  async function load() {
    setRank(null);
    setLoading(true); setError('');
    try {
      let available = [];
      try { available = list(await api.listProjects(), 'items', 'projects'); } catch (cause) {
        if (!requestedId) throw cause;
        setError('The startup list is unavailable; talent records are still being checked.');
      }
      const selected = available.find((item) => String(item.id) === requestedId) || available[0] || (requestedId ? { id: Number(requestedId), name: 'Selected project', unavailable_name: true } : null);
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
  const filtered = useMemo(() => {
    if (view === 'shortlisted') return applications.filter(shortlisted);
    if (view !== 'all') return applications.filter((application) => String(application.job?.id) === String(view));
    return applications;
  }, [applications, view]);
  const target = rankPosting(jobs, view);
  const live = rank && target.job && String(rank.postingId) === String(target.job.id) ? rank : null;
  const ranked = live ? applyRank(filtered, (a) => a.id, live.answer) : null;
  const visible = ranked ? ranked.list : filtered;
  useEffect(() => { setRank(null); }, [view]);
  const applicantCount = applications.length;
  const shortlistCount = applications.filter(shortlisted).length;
  const selectedJob = jobs.find((job) => String(job.id) === String(view)) || jobs[0];
  const nav = [['Focus', `/grow/focus${query}`], ['Talent', `/grow/talent${query}`], ['Customers', `/grow/customers${query}`], ['Partnerships', `/grow/partnerships${query}`], ['Brand', `/build/brand${query}`], ['Launch', `/grow/launch${query}`]];

  return <main className="a5-grow fg-talent" data-testid="founder-grow-talent"><div className="a5-grow-canvas"><div className="a5-grow-main">
    <header className="a5-grow-hero"><div className="fg-talent-crumb"><Link to={`/grow/focus${query}`}><ArrowLeft size={13} /> Grow</Link><span>‹</span><b>Talent</b></div><div><h1>Talent</h1><p>Roles, ranked candidates, job posts and applications.</p></div><nav aria-label="Grow sections">{nav.map(([label, to]) => <LensLink data-testid={`link-grow-talent-${label.toLowerCase().replace(' ', '-')}`} key={label} to={to} className={label === 'Talent' ? 'is-active' : ''}>{label}</LensLink>)}</nav>
    <ZoneToolbar
              filters={founderZoneFilters('grow/talent', { value: view, onChange: setView, dynamic: { roles: jobs.slice(0, 3).map((job) => ({ key: String(job.id), label: text(job.title, 'Untitled role') })) } })}
              actions={founderZoneActions('grow/talent', { query, view: { scope: project?.name, header: ['Candidate', 'Applied', 'Status'], rows: visible, cells: (r) => [r.name || r.member?.name, r.created_at, r.status] } })}
            /></header>
    {error && <div className="a5-grow-error" data-testid="status-grow-talent-partial"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {loading ? <TalentSkeleton /> : !project ? <EmptyTalent /> : <TalentContent project={project} jobs={jobs} applications={applications} visible={visible} selectedJob={target.job || selectedJob} selectedJobId={selectedJobId} view={view} setView={setView} query={query} applicantCount={applicantCount} shortlistCount={shortlistCount} error={error}
      rank={{ target, ranked, total: filtered.length, run: () => growTalentApi.rank(String(project.id), target.job.id), onRanked: (answer) => setRank(answer ? { postingId: target.job.id, answer } : null) }} />}
  </div><TalentRail project={project} jobs={jobs} applications={applications} error={error} /></div></main>;
}

function TalentContent({ project, jobs, applications, visible, selectedJob, selectedJobId, view, setView, query, applicantCount, shortlistCount, error, rank = null }) {
  return <div className="a5-sections"><div className="fg-talent-context"><div><span>Selected startup</span><strong data-testid="text-grow-talent-project">{text(project.name)}</strong></div><div><span>Talent source</span><strong>{error ? 'Unavailable' : jobs.length ? 'Stored job postings' : 'No linked roles'}</strong></div></div>
        {/* Its tabs are the zone header's now. The canvas's Backend and GTM are
        sample role names, so the chips there are the roles actually linked
        to this startup — and when none is, that is what the row says. */}
    <div className="fg-talent-tabs"><div className="fg-talent-actions"><Link to={`/build/team?mode=workspace&project_id=${project.id}`} data-testid="link-open-grow-talent-workspace"><BriefcaseBusiness size={13} /> Open workspace</Link></div></div>
    <div className="fg-talent-stats"><Stat label="Applicants" value={error ? 'Unavailable' : applicantCount} note={error ? 'Applicant source unavailable' : `across ${jobs.length} linked role${jobs.length === 1 ? '' : 's'}`} muted={Boolean(error)} /><Stat label="Shortlisted" value={error ? 'Unavailable' : shortlistCount} note={error ? 'Applicant source unavailable' : applications.length ? `${Math.round((shortlistCount / applications.length) * 100)}% of applicants` : 'No applicants recorded'} muted={Boolean(error)} /><Stat label="Time to screen" value="Unavailable" note="No screening-event source connected" muted /><Stat label="Reserved" value="Unavailable" note="No project equity-reservation source connected" muted /></div>
    <section className="a5-card fg-talent-table"><Head icon={Users} title={`Ranked candidates · ${text(selectedJob?.title, 'selected role')}`} meta="The score always says why" />
      {/* #3938 GR4: Eadwyn ranks this role's applicants by meaning and writes one line each; nothing changes an application. */}
      {rank && jobs.length > 0 && applications.length > 0 && !error ? (rank.target.job
        ? <div className="fg-talent-rank"><RankByFit run={rank.run} onRanked={rank.onRanked} ranked={rank.ranked ? rank.ranked.ranked : null} total={rank.total} label="Anything to weigh? (optional)" testid="grow-talent-rank" /></div>
        : rank.target.why ? <p className="fg-talent-rank-why" data-testid="grow-talent-rank-why">{rank.target.why}</p> : null) : null}
      {!jobs.length ? <EmptyTable error={error} /> : <CandidateTable rows={visible} ranked={rank?.ranked} />}</section>
    <section className="a5-focus fg-talent-read"><div className="a5-head"><div><Sparkles size={15} /><h2>Read the match honestly</h2></div><span>Source-derived</span></div><p>{error ? 'The selected-project talent source is unavailable, so FG2 cannot determine whether roles or applications exist. Candidate ranking, screening time, and reserved shares remain unavailable.' : selectedJob ? `The current role is ${text(selectedJob.title)}. Candidate fit scores and rank explanations are ${visible.length ? 'not recorded by the source' : 'not available because no candidates are returned'}; FG2 does not score people from application text.` : 'No role is linked to this startup, so candidate ranking, screening time, and reserved shares remain unavailable.'}</p><Link className="a5-link" to={`/build/team?mode=workspace&project_id=${project.id}`}>Open talent workspace <ChevronRight size={14} /></Link></section>
  </div>;
}
function CandidateTable({ rows, ranked = null }) {
  if (!rows.length) return <EmptyTable />;
  // GR4: a ranked row reads its place and Eadwyn's line; an unranked one keeps "Not scored", never an invented reason.
  const place = (index) => (ranked && index < ranked.ranked ? `#${index + 1} by fit` : 'Not scored');
  const why = (row) => (ranked && ranked.lineFor(row)) || 'No fit rationale recorded.';
  return <div className="fg-talent-table-wrap"><table><thead><tr><th>Candidate</th><th>Fit</th><th>Stage</th><th>Why this rank</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index} data-testid={`grow-talent-row-${row.id ?? index}`}><td><strong>{text(row.name || row.member?.name, 'Candidate name not recorded')}</strong><small>{row.created_at ? `Applied ${dateLabel(row.created_at)}` : 'Application date not recorded'}</small></td><td><span className="fg-talent-pill">{place(index)}</span></td><td><span className="fg-talent-pill is-stage">{shortStatus(row.status)}</span></td><td className="fg-talent-reason">{why(row)}</td></tr>)}</tbody></table></div>;
}
function EmptyTable({ error }) { return <div className="a5-empty"><UserRound size={18} /><div><b>{error ? 'Talent source unavailable.' : 'No selected-project applicants are recorded.'}</b><p>FG2 does not infer candidates, scores, screening times, or role reservations.</p></div></div>; }
function Head({ icon: Icon, title, meta }) { return <div className="a5-head"><div><Icon size={15} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Stat({ label, value, note, muted }) { return <div className={`fg-talent-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function TalentRail({ project, jobs, applications, error }) {
  return <WorkerRail
    workspace="Grow"
    className="a5-rail"
    stance="Read-only matching"
    note="This rail summarizes stored roles and applications. Candidates are ranked only when you press Rank by fit, as a view; nothing here rejects an applicant or sends email."
    coverage={[!project ? 'No project selected' : error ? 'Role source unavailable' : `${jobs.length} linked role${jobs.length === 1 ? '' : 's'}`, !project || error ? 'Applicant source unavailable' : `${applications.length} application${applications.length === 1 ? '' : 's'}`]}
    unavailable={[['Fit scoring', 'No match score or rationale source is connected.'], ['Screening analytics', 'No screening-event or reservation source is connected.']]}
    footer="Read-only summary · no automated actions"
  />;
}
function TalentSkeleton() { return <div className="a5-skeleton" data-testid="status-grow-talent-loading"><i /><i /><div><i /><i /><i /></div></div>; }
function EmptyTalent() { return <div className="a5-empty fg-talent-empty"><Users size={20} /><div><b>No startup is available.</b><p>Talent is scoped to an authenticated startup and its stored roles.</p></div></div>; }