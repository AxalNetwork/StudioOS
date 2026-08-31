import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BriefcaseBusiness, ChevronRight, CircleDot, Handshake, PanelRight, Rocket, Sparkles, Target, Users } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, jobs as jobsApi } from '../../lib/api';
import './founderGrowDesk.css';

const list = (value, key) => Array.isArray(value) ? value : (Array.isArray(value?.[key]) ? value[key] : []);
const text = (value) => String(value || '').trim();
const linked = (row, project) => {
  if (!project || !row) return false;
  const numericMatch = [row.project_id, row.projectId].some((value) => value != null && String(value) === String(project.id));
  const uidMatch = project.uid && [row.project_uid, row.projectUid].some((value) => value != null && String(value) === String(project.uid));
  return numericMatch || uidMatch;
};
const title = (row, fallback) => text(row?.title || row?.name || row?.label || row?.metric_name) || fallback;

export default function FounderGrowDesk() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const seed = location.state?.founderGrowSeed;
  const [projects, setProjects] = useState(() => seed?.projects || []);
  const [projectId, setProjectId] = useState(() => Number(params.get('project_id')) || seed?.projectId || null);
  const [records, setRecords] = useState(() => seed?.records || {});
  const [loading, setLoading] = useState(!seed);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    api.listProjects().then((response) => {
      if (!alive) return;
      const items = list(response, 'items'); const requested = Number(params.get('project_id'));
      const selected = items.find((item) => Number(item.id) === requested) || items.find((item) => Number(item.id) === Number(projectId)) || items[0];
      setProjects(selected ? items : (requested ? [{ id: requested, name: `Startup #${requested}` }] : items));
      setProjectId(selected?.id || requested || null);
    }).catch((reason) => {
      if (!alive) return;
      const requested = Number(params.get('project_id'));
      if (requested) { setProjects([{ id: requested, name: `Startup #${requested}` }]); setProjectId(requested); }
      setError(reason?.message || 'The startup list is unavailable.');
    }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [reload]);

  useEffect(() => {
    if (!projectId) return undefined;
    let alive = true; setLoading(true);
    setParams((previous) => { const next = new URLSearchParams(previous); next.set('project_id', String(projectId)); return next; }, { replace: true });
    const calls = {
      snapshots: api.listMetricsSnapshots(projectId), summary: api.metricsSummary(projectId),
      customers: api.listWaitlistCustomers(projectId), jobs: jobsApi.mine(), landing: api.brandGetLanding(projectId),
      pages: api.brandListPages(projectId), brandWaitlist: api.brandListWaitlist(projectId), prospects: api.raiseProspects(projectId),
      pitches: api.listMyCoMarketingPitches(),
    };
    Promise.allSettled(Object.entries(calls).map(async ([key, request]) => [key, await request])).then(async (results) => {
      if (!alive) return;
      const next = {}; const failures = [];
      results.forEach((result, index) => {
        const key = Object.keys(calls)[index];
        if (result.status === 'fulfilled') next[key] = result.value[1]; else failures.push(key);
      });
      const selectedProject = projects.find((item) => Number(item.id) === Number(projectId));
      const pitches = list(next.pitches, 'items').filter((row) => linked(row, selectedProject));
      if (pitches.length) {
        const attributionResults = await Promise.allSettled(pitches.map((pitch) => api.listMyCoMarketingAttributions(pitch.uid || pitch.id)));
        next.attributions = attributionResults.filter((item) => item.status === 'fulfilled').flatMap((item) => list(item.value, 'items')).filter((row) => linked(row, selectedProject));
      } else next.attributions = [];
      if (alive) { setRecords(next); setError(failures.length ? 'Some selected-project sources are unavailable.' : ''); }
    }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [projectId, reload, setParams]);

  const project = projects.find((item) => Number(item.id) === Number(projectId));
  const data = useMemo(() => ({
    snapshots: list(records.snapshots, 'snapshots'), customers: list(records.customers, 'signups'),
    jobs: list(records.jobs, 'jobs').filter((row) => linked(row, project)),
    pages: list(records.pages, 'pages'), brandWaitlist: list(records.brandWaitlist, 'signups'),
    prospects: list(records.prospects, 'items'), pitches: list(records.pitches, 'items').filter((row) => linked(row, project)),
    attributions: records.attributions || [], summary: records.summary || {}, landing: records.landing || {},
  }), [project, records]);
  const query = projectId ? `?project_id=${projectId}` : '';
  const state = { founderGrowSeed: { projects, projectId, records } };
  return <main className="a5-grow" data-testid="founder-grow-desk"><div className="a5-grow-canvas"><div className="a5-grow-main">
    <header className="a5-grow-hero"><span>Founder / Grow</span><div><h1>Get customers, people, reach</h1><p>One metric organizes the work around your startup this month.</p></div>
      {projects.length > 1 && <select data-testid="select-grow-project" value={projectId || ''} onChange={(event) => setProjectId(Number(event.target.value))}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <nav aria-label="Grow desk sections">{['Focus', 'Customers', 'Talent', 'Brand', 'Capital match', 'Partnerships', 'Launch'].map((item) => <a data-testid={`link-grow-anchor-${item.toLowerCase().replace(' ', '-')}`} href={`#a5-${item.toLowerCase().replace(' ', '-')}`} key={item}>{item}</a>)}</nav>
    </header>
    {error && <div className="a5-grow-error" data-testid="status-grow-partial"><AlertCircle size={15} />{error}<button data-testid="button-retry-grow" type="button" onClick={() => setReload((count) => count + 1)}>Retry</button></div>}
    <GrowSections data={data} project={project} loading={loading} query={query} state={state} />
  </div><GrowRail data={data} /></div></main>;
}

function GrowSections({ data, project, loading, query, state }) {
  const focus = data.snapshots[0];
  const unavailable = Array.isArray(data.summary?.unavailable) ? data.summary.unavailable : [];
  return <div className="a5-sections">
    <section className="a5-focus" id="a5-focus"><Head icon={Target} title="This month's focus" meta={project?.name || 'Selected startup'} />{loading ? <Skeleton rows={2} /> : !project ? <Empty icon={Target} title="No startup is available." body="Select a startup to read its operating records." /> : <><strong>{focus ? 'Latest stored metric snapshot' : 'No monthly metric recorded'}</strong><div className="a5-focus-numbers"><span>{focus?.snapshot_date ? `Snapshot date ${focus.snapshot_date}` : 'Snapshot date not recorded'}</span><span>Target not recorded</span></div><p>{focus ? 'Open Metrics to inspect the stored snapshot fields.' : 'No metric snapshot is recorded for this startup.'}{unavailable.length ? ` Derived summary unavailable: ${unavailable.join(', ')}.` : ''}</p><DeskLink testid="link-open-grow-focus" to={`/build/metrics${query}`} state={state}>Open metrics</DeskLink></>}</section>
    <div className="a5-pair"><Card id="customers" icon={Users} title="Customers" meta={`${data.customers.length} discovery records`} loading={loading}><Rows rows={data.customers} empty="No selected-project customer records are recorded." /><DeskLink testid="link-open-grow-customers" to={`/build/discovery${query}`} state={state}>Open customer discovery</DeskLink></Card>
      <Card id="talent" icon={BriefcaseBusiness} title="Talent" meta={`${data.jobs.length} linked role${data.jobs.length === 1 ? '' : 's'}`} loading={loading}><Rows rows={data.jobs} empty="No roles explicitly linked to this startup are recorded." /><p className="a5-note">Applicant total: Not recorded.</p><DeskLink testid="link-open-grow-talent" to={`/build/team?mode=workspace&project_id=${project?.id || ''}`} state={state}>Open talent workspace</DeskLink></Card></div>
    <Card id="brand" icon={Sparkles} title="Brand & landing" meta={`${data.pages.length} stored page${data.pages.length === 1 ? '' : 's'}`} loading={loading} wide><div className="a5-brand-status"><b>{text(data.landing?.headline || data.landing?.name) || 'Landing record not recorded'}</b><span>{data.brandWaitlist.length} brand waitlist record{data.brandWaitlist.length === 1 ? '' : 's'}</span></div><Rows rows={data.pages} empty="No brand pages are recorded for this startup." /><DeskLink testid="link-open-grow-brand" to={`/spinout-lab/brand${query}`} state={state}>Open brand workspace</DeskLink></Card>
    <Card id="capital-match" icon={CircleDot} title="Capital match" meta={`${data.prospects.length} stored prospect${data.prospects.length === 1 ? '' : 's'}`} loading={loading} wide><Rows rows={data.prospects} empty="No stored investor prospects are recorded for this startup." /><p className="a5-note">Stored prospects only. This desk does not claim scored matches.</p><DeskLink testid="link-open-grow-capital" to={`/raise/capital/pipeline${query}`} state={state}>Open capital pipeline</DeskLink></Card>
    <div className="a5-pair"><Card id="partnerships" icon={Handshake} title="Partnerships" meta={`${data.pitches.length} linked record${data.pitches.length === 1 ? '' : 's'}`} loading={loading}><Rows rows={data.pitches} empty="No project-linked partnership records are recorded." /><DeskLink testid="link-open-grow-partnerships" to={`/comarketing${query}`} state={state}>Open partnerships</DeskLink></Card>
      <Card id="launch" icon={Rocket} title="Launch calendar" meta={`${data.attributions.length} linked record${data.attributions.length === 1 ? '' : 's'}`} loading={loading}><Rows rows={data.attributions} empty="No project-linked launch records are recorded." /><DeskLink testid="link-open-grow-launch" to={`/comarketing${query}`} state={state}>Open co-marketing</DeskLink></Card></div>
  </div>;
}
function Card({ id, icon, title: heading, meta, loading, children, wide }) { return <section className={`a5-card${wide ? ' a5-wide' : ''}`} id={`a5-${id}`}><Head icon={icon} title={heading} meta={meta} />{loading ? <Skeleton rows={2} /> : children}</section>; }
function Head({ icon: Icon, title: heading, meta }) { return <div className="a5-head"><div><Icon size={15} /><h2>{heading}</h2></div><span>{meta}</span></div>; }
function Rows({ rows, empty }) { return rows.length ? <div className="a5-rows">{rows.slice(0, 4).map((row, index) => <div key={row.id || row.uid || index}><b>{title(row, 'Untitled record')}</b><span>{text(row.status || row.stage || row.created_at || row.updated_at) || 'Not recorded'}</span></div>)}</div> : <p className="a5-empty">{empty}</p>; }
function Skeleton({ rows }) { return <div className="a5-skeleton">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>; }
function Empty({ icon: Icon, title: heading, body }) { return <div className="a5-empty"><Icon size={18} /><div><b>{heading}</b><p>{body}</p></div></div>; }
function DeskLink({ to, state, testid, children }) { return <Link data-testid={testid} className="a5-link" to={to} state={state}>{children}<ChevronRight size={14} /></Link>; }
function GrowRail({ data }) { return <aside className="a5-rail"><div className="a5-rail-title"><span>Worker AI · Grow</span><PanelRight size={14} /></div><div><b>Read-only source coverage</b><p>This rail summarizes records already stored for the selected startup. It takes no action.</p></div><div><span>Coverage</span><strong>{data.snapshots.length} metric snapshots</strong><strong>{data.customers.length} customer records</strong><strong>{data.jobs.length} linked roles</strong><strong>{data.pages.length} brand pages</strong></div><div><span>Outside work</span><p>{data.pitches.length} partnership records · {data.attributions.length} launch records</p></div><footer>Read-only summary · no automated actions</footer></aside>; }