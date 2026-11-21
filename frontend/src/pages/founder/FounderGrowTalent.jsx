import { growPeriod, growTabs, reportingHref } from '../cycles/growOverviewModel';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, BriefcaseBusiness, RefreshCw, UserRound, Users } from 'lucide-react';
import { cyclesApi } from '../../lib/api/cycles';
import { canonicalVentureSearch, resolveVenture, ventureRef } from '../cycles/ventureQuery.js';
import RailFrame from '../../ui/RailFrame';
import { api, jobs as jobsApi } from '../../lib/api';
import { growTalentApi } from '../../lib/api/growTalent';
import RankByFit from '../../ui/RankByFit';
import { applyRank } from '../../lib/rankByFit';
import { text, titleCase } from '../../lib/absence';
import { Unrecorded, WorkerRail } from '../../ui';
import './founderGrowDesk.css';
import './founderGrowTalent.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { founderZoneFilters } from '../../workspaces/founderZoneFilters';
import { LensLink } from '../../workspaces/lens';
import GrowOverviewLink from './GrowOverviewLink';

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
const stageOf = (application) => application?.stage ?? application?.status;
const shortlisted = (application) => ['shortlisted', 'interview', 'offer', 'hired'].includes(String(stageOf(application) || '').toLowerCase());

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
  const location = useLocation();
  const navigate = useNavigate();
  const requested = ventureRef(location.search);
  const requestedId = requested?.id ?? requested?.uid ?? null;
  const [read, setRead] = useState(null);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState('all');
  const [rank, setRank] = useState(null);
  const current = read?.requestedId === requestedId || (requested?.id != null && read?.project?.id === requested.id)
    ? read : null;
  const { project = null, jobs = [], applications = [], error = '' } = current || {};
  const loading = !current;
  const retry = () => setReload((n) => n + 1);

  useEffect(() => {
    let alive = true;
    setRank(null);
    setView('all');
    const finish = (answer) => { if (alive) setRead({ requestedId, ...answer }); };
    async function load() {
      let available;
      try {
        available = list(await api.listProjects(), 'items', 'projects');
      } catch {
        finish({ error: 'The startup list is unavailable.' });
        return;
      }
      if (!alive) return;
      const selected = requested ? resolveVenture(available, requested)?.project : available[0];
      if (!selected) {
        finish({ error: requested ? 'This venture is unavailable.' : '' });
        return;
      }
      try {
        const linkedJobs = list(await jobsApi.mine(), 'jobs').filter((job) => projectMatch(job, selected));
        const results = await Promise.allSettled(linkedJobs.map((job) => jobsApi.applications(job.id)));
        const loaded = results.flatMap((result, i) => result.status === 'fulfilled'
          ? list(result.value, 'applications').map((application) => ({ ...application, job: linkedJobs[i] })) : []);
        finish({ project: selected, jobs: linkedJobs, applications: loaded,
          error: results.some((result) => result.status === 'rejected') ? 'Some applicant sources are unavailable.' : '' });
      } catch {
        finish({ project: selected, error: 'The applicant source is unavailable.' });
      }
    }
    load();
    return () => { alive = false; };
  // The normalized numeric ID or UID is the read identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedId, reload]);

  useEffect(() => {
    if (!project?.id || (requested?.id === project.id && !requested.legacy)) return;
    navigate({ pathname: location.pathname, search: canonicalVentureSearch(location.search, project.id), hash: location.hash }, { replace: true });
  }, [project?.id, requested?.id, requested?.legacy, location, navigate]);

  const query = project?.id ? `?project_id=${project.id}` : '';
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
  const selectedJob = jobs.find((job) => String(job.id) === String(view)) || jobs[0];
  const nav = growTabs(query, 'talent').map((tab) => [tab.name, tab.href]);

  return <RailFrame className="a5-grow fg-talent" data-testid="founder-grow-talent"
    rail={<TalentRail project={project} jobs={jobs} applications={applications} error={error} />}>
    <main className="a5-grow-main">
    <header className="a5-grow-hero"><div className="fg-talent-crumb"><GrowOverviewLink /><span>‹</span><b>Talent</b></div><div><h1>Talent</h1><p>The team you have, the plan, and the roles you’re filling.</p>{project && <Link className="a5-link" to={`/grow/team-expansion/new${query}`} data-testid="link-grow-talent-roles">Open a role</Link>}</div><nav aria-label="Grow sections">{nav.map(([label, to]) => <LensLink data-testid={`link-grow-talent-${label.toLowerCase().replace(' ', '-')}`} key={label} to={to} className={label === 'Talent' ? 'is-active' : ''}>{label}</LensLink>)}</nav><nav aria-label="Grow utilities"><LensLink to={reportingHref(query)}>Reporting</LensLink></nav>
    <ZoneToolbar
              filters={founderZoneFilters('grow/talent', { value: view, onChange: setView, dynamic: { roles: jobs.slice(0, 3).map((job) => ({ key: String(job.id), label: text(job.title, 'Untitled role') })) } })}
              actions={founderZoneActions('grow/talent', { query, view: { scope: project?.name, header: ['Candidate', 'Applied', 'Status'], rows: visible, cells: (r) => [r.name || r.member?.name, r.created_at, stageOf(r)] } })}
            /></header>
    {error && <div className="a5-grow-error" role="status" data-testid="status-grow-talent-partial"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={retry}><RefreshCw size={13} /> Retry</button></div>}
    {loading ? <TalentSkeleton /> : !project ? (error ? null : <EmptyTalent />) : <>
      <TalentRoles key={project.id} projectId={project.id} query={query} />
      <TalentContent project={project} jobs={jobs} applications={applications} visible={visible} selectedJob={target.job || selectedJob} error={error}
      rank={{ target, ranked, total: filtered.length, run: () => growTalentApi.rank(String(project.id), target.job.id), onRanked: (answer) => setRank(answer ? { postingId: target.job.id, answer } : null) }} /></>}
    </main></RailFrame>;
}

function TalentRoles({ projectId, query }) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [read, setRead] = useState(null);
  useEffect(() => {
    let alive = true;
    setRead(null);
    cyclesApi.module('grow', projectId, 'team-expansion', { page }).then((result) => {
      if (alive) setRead(result);
    }).catch(() => { if (alive) setRead({}); });
    return () => { alive = false; };
  }, [projectId, page, retry]);

  if (!read) return <p className="a5-note" role="status">Loading roles and hiring plan…</p>;
  const summary = read.card?.series?.talent;
  const plan = summary?.plan;
  const records = read.records;
  const hasMore = records && records.page * records.page_size < records.total;
  const unavailable = <span role="status">Unavailable</span>;
  return <div className="a5-sections">
    <section className="grid gap-3 sm:grid-cols-3" aria-label="Talent figures">
      <Stat label="Headcount" value={summary ? summary.headcount ?? <Unrecorded /> : unavailable}
        note={<>Team roster{read.card?.as_of && ` · as of ${read.card.as_of}`}<br />
          Hiring plan · {summary ? plan ? `${plan.target} by ${growPeriod(plan.period)}` : summary.plan_reason || <Unrecorded /> : unavailable}</>} />
      <Stat label="Open roles" value={summary ? summary.open_roles ?? <Unrecorded /> : unavailable} note="Job postings · open or published" />
      <Stat label="Offers out" value={summary ? summary.offers ?? <Unrecorded /> : unavailable} note="Applications · recorded offer stage on listed roles" />
    </section>
    <section className="a5-card min-w-0" aria-label="Roles">
      <Head icon={BriefcaseBusiness} title="Roles" meta="Job postings and applications" />
      {!records ? <p role="status">Roles unavailable.</p>
        : records.rows.length === 0 ? <p>No roles recorded for this venture.</p>
        : <div className="fg-talent-table-wrap"><table aria-label="Roles for this venture">
          <thead><tr><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Applicants</th><th scope="col">Stage</th><th scope="col">Record</th></tr></thead>
          <tbody>{records.rows.map((role) => <tr key={role.id}>
            <th scope="row">{role.title || <Unrecorded />}</th><td>{shortStatus(role.status)}</td>
            <td>{role.applicants ?? <Unrecorded />}</td>
            <td>{role.in_offer ? `${role.in_offer} in offer` : role.in_interview ? `${role.in_interview} in interview` : 'No interviews or offers'}</td>
            <td><Link className="a5-link" to={`/grow/team-expansion/${encodeURIComponent(role.id)}${query}`} aria-label={`Open ${role.title || 'role record'}`}>Open</Link></td>
          </tr>)}</tbody>
        </table></div>}
      <div className="flex flex-wrap items-center gap-3">
        <Link className="a5-link" to={`/build/team?mode=workspace&project_id=${projectId}`} data-testid="link-open-grow-talent-workspace">Open roster and hiring plan</Link>
        {(!summary || !records) && <button type="button" className="a5-link" onClick={() => setRetry((n) => n + 1)}>Retry roles and hiring plan</button>}
        {page > 1 && <button type="button" className="a5-link" onClick={() => setPage((n) => n - 1)}>Previous roles</button>}
        {hasMore && <button type="button" className="a5-link" onClick={() => setPage((n) => n + 1)}>Next roles</button>}
      </div>
    </section>
  </div>;
}

function TalentContent({ project, jobs, applications, visible, selectedJob, error, rank }) {
  return <div className="a5-sections">
    <p className="a5-note" data-testid="text-grow-talent-project">{text(project.name)}</p>
    <section className="a5-card fg-talent-table"><Head icon={Users} title={`Applicants${selectedJob ? ` · ${text(selectedJob.title)}` : ''}`} meta="Job applications" />
      {/* #3938 GR4: Eadwyn ranks this role's applicants by meaning and writes one line each; nothing changes an application. */}
      {rank && jobs.length > 0 && applications.length > 0 && !error ? (rank.target.job
        ? <div className="fg-talent-rank"><RankByFit run={rank.run} onRanked={rank.onRanked} ranked={rank.ranked ? rank.ranked.ranked : null} total={rank.total} label="Anything to weigh? (optional)" testid="grow-talent-rank" /></div>
        : rank.target.why ? <p className="fg-talent-rank-why" data-testid="grow-talent-rank-why">{rank.target.why}</p> : null) : null}
      {!visible.length ? <EmptyTable error={error} /> : <CandidateTable rows={visible} ranked={rank?.ranked} />}
      {selectedJob && <Link className="a5-link" to={`/jobs/${encodeURIComponent(selectedJob.id)}/manage`}>Manage applicants for {selectedJob.title}</Link>}</section>

  </div>;
}
function CandidateTable({ rows, ranked = null }) {
  if (!rows.length) return <EmptyTable />;
  // GR4: a ranked row reads its place and Eadwyn's line; an unranked one keeps "Not scored", never an invented reason.
  const place = (index) => (ranked && index < ranked.ranked ? `#${index + 1} by fit` : 'Not scored');
  const why = (row) => (ranked && ranked.lineFor(row)) || 'No fit rationale recorded.';
  return <div className="fg-talent-table-wrap"><table><thead><tr><th>Candidate</th><th>Fit</th><th>Stage</th><th>Why this rank</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index} data-testid={`grow-talent-row-${row.id ?? index}`}><td><strong>{text(row.name || row.member?.name, 'Candidate name not recorded')}</strong><small>{row.created_at ? `Applied ${dateLabel(row.created_at)}` : 'Application date not recorded'}</small></td><td><span className="fg-talent-pill">{place(index)}</span></td><td><span className="fg-talent-pill is-stage">{shortStatus(stageOf(row))}</span></td><td className="fg-talent-reason">{why(row)}</td></tr>)}</tbody></table></div>;
}
function EmptyTable({ error }) { return <div className="a5-empty"><UserRound size={18} /><b>{error ? 'Applications unavailable.' : 'No applicants match this view.'}</b></div>; }
function Head({ icon: Icon, title, meta }) { return <div className="a5-head"><div><Icon size={15} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Stat({ label, value, note }) { return <div className="fg-talent-stat"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function TalentRail({ project, jobs, applications, error }) {
  return <WorkerRail
    workspace="Grow"
    stance="Read-only matching"
    note="This rail summarizes stored roles and applications. Candidates are ranked only when you press Rank by fit, as a view; nothing here rejects an applicant or sends email."
    coverage={[!project ? 'No project selected' : error ? 'Role source unavailable' : `${jobs.length} linked role${jobs.length === 1 ? '' : 's'}`, !project || error ? 'Applicant source unavailable' : `${applications.length} application${applications.length === 1 ? '' : 's'}`]}
    unavailable={[['Fit scoring', 'No match score or rationale source is connected.'], ['Screening analytics', 'No screening-event or reservation source is connected.']]}
    footer="Read-only summary · no automated actions"
  />;
}
function TalentSkeleton() { return <div className="a5-skeleton" role="status" aria-label="Loading Talent" data-testid="status-grow-talent-loading"><i /><i /><div><i /><i /><i /></div></div>; }
function EmptyTalent() { return <div className="a5-empty fg-talent-empty"><Users size={20} /><div><b>No startup is available.</b><p>Talent is scoped to an authenticated startup and its stored roles.</p></div></div>; }
