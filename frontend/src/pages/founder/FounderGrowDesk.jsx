import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, BriefcaseBusiness, ChevronRight, CircleDot, Handshake, Rocket, Sparkles, Target, Users } from 'lucide-react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { api, jobs as jobsApi } from '../../lib/api';
import { WorkerRail } from '../../ui';
import ZoneDraft from '../../workspaces/ZoneDraft';
import useAssistMode from '../../hooks/useAssistMode';
import { zonePillClass } from './deskZoneNav';
import './founderGrowDesk.css';

// Seven labels, seven routes — A5's `anchG`, in its order. This was a
// seven-deep ternary chain ending in an `<a href="#a5-…">` fallback that no
// label could reach, and it listed Customers before Talent where the artboard
// does not.
const SECTIONS = [
  ['Focus', 'focus'], ['Talent', 'talent'], ['Customers', 'customers'],
  ['Partnerships', 'partnerships'], ['Capital match', 'capital-match'],
  ['Brand', 'brand'], ['Launch', 'launch'],
];

/**
 * EVERY CARD LINKS TO THE GROW PAGE IT SUMMARISES, and none of them did.
 *
 * The chip row above has pointed at `/grow/<slug>` since these seven pages were
 * built. The CARDS underneath — the summaries of those same seven pages — went
 * somewhere else entirely: Customers to `/build/discovery`, Talent to
 * `/build/team?mode=workspace`, Brand to `/spinout-lab/brand`, Capital match to
 * `/raise/capital/pipeline`, Partnerships and Launch both to `/comarketing`,
 * and Focus to `/build/metrics`. Six of the seven left the bucket, two of them
 * landed on the same page as each other, and the `mode=workspace` one is read
 * by `App.jsx` and rendered as the shared workspace rather than as a page at
 * all. A reader could summarise their own Grow pages here and reach not one of
 * them.
 *
 * Taken from the same list the chips use, so a slug cannot drift between the
 * row and the card that names it.
 */
const GROW_PAGES = Object.fromEntries(SECTIONS.map(([label, slug]) => [slug, `/grow/${slug}`]));

/**
 * The customer funnel, WITH THE STAGES THE STORE ACTUALLY RECORDS.
 *
 * A5 draws five tiles — Contacted, Replied, Demo, Trial, Paid. `crm_status` is
 * `new | invited | followed_up | promoted` (`routes/progress.ts`), and the
 * fifth of the artboard's stages has no analogue at all: nothing anywhere
 * records that a customer started paying. Drawing five headings over four
 * stores' worth of data would put people in stages this product cannot place
 * them in, so the row is the four that exist.
 */
const CRM_STAGES = [
  ['new', 'Captured'], ['invited', 'Invited'], ['followed_up', 'Followed up'], ['promoted', 'Interviewed'],
];

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
/**
 * The window `/grow/launch` reads the calendar over, kept identical here.
 *
 * A year either side: the artboard's launch card names the month of what is
 * coming, and a card that summarised a narrower window than the page it links
 * to would show a founder fewer entries here than there.
 */
const calendarWindow = () => {
  const now = new Date();
  const from = new Date(now); from.setFullYear(from.getFullYear() - 1);
  const to = new Date(now); to.setFullYear(to.getFullYear() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
};
const text = (value) => String(value || '').trim();
const linked = (row, project) => {
  if (!project || !row) return false;
  const numericMatch = [row.project_id, row.projectId].some((value) => value != null && String(value) === String(project.id));
  const uidMatch = project.uid && [row.project_uid, row.projectUid].some((value) => value != null && String(value) === String(project.uid));
  return numericMatch || uidMatch;
};
const title = (row, fallback) => text(row?.title || row?.name || row?.label || row?.metric_name) || fallback;
/**
 * The name of a metric the summary could not compute.
 *
 * `summary.unavailable` is `[{ metric, reason }]` — the worker returns the
 * REASON on purpose, so a blank KPI tells a founder which input it needs rather
 * than reading as a zero or a bug (`services/saasMetrics.ts`). This desk used to
 * `join(', ')` that array of objects straight into a sentence, which rendered
 * "Derived summary unavailable: [object Object], [object Object], …" — five of
 * them on a startup with no snapshot, throwing away the one thing the field
 * exists to carry. `MetricsPage` had it right and this follows it.
 */
const metricName = (item) => text(typeof item === 'string' ? item : item?.metric).replace(/_/g, ' ') || 'an unnamed metric';
const dateLabel = (value) => {
  const parsed = new Date(`${String(value || '').slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? 'Not recorded' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(parsed);
};

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
  const [fillsOn] = useAssistMode('Grow');

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
      // A5's launch calendar. `/grow/launch` has read this since it was built;
      // the desk summarised the same zone off co-marketing attributions alone,
      // so a founder whose launches were on the calendar saw an empty card.
      events: api.listCalendarEvents(calendarWindow()),
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
      // Applicant counts per live role. A5's "1 role live · 14 applicants" is
      // backed by `jobsApi.applications`, which `/grow/talent` already calls
      // and this desk did not — so the card said "Applicant total: Not
      // recorded" over a number the API returns.
      const mine = list(next.jobs, 'jobs').filter((row) => linked(row, selectedProject));
      const counts = await Promise.allSettled(mine.map((role) => jobsApi.applications(role.id)));
      next.applicants = counts.map((item, index) => ({
        id: mine[index]?.id,
        // A failed read is not zero applicants: it is an unknown, and a card
        // that prints 0 tells a founder nobody applied.
        count: item.status === 'fulfilled' ? list(item.value, 'applications').length : null,
      }));
      if (alive) { setRecords(next); setError(failures.length ? 'Some selected-project sources are unavailable.' : ''); }
    }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [projectId, reload, setParams]);

  const project = projects.find((item) => Number(item.id) === Number(projectId));
  const data = useMemo(() => {
    const customers = list(records.customers, 'signups');
    const jobs = list(records.jobs, 'jobs').filter((row) => linked(row, project));
    const applicants = records.applicants || [];
    const known = applicants.filter((row) => row.count !== null);
    return {
      snapshots: list(records.snapshots, 'snapshots'), customers,
      jobs,
      liveRoles: jobs.filter((row) => text(row.status) === 'published' || text(row.status) === 'open'),
      applicants,
      applicantTotal: known.length === applicants.length && applicants.length
        ? known.reduce((sum, row) => sum + row.count, 0)
        : null,
      funnel: CRM_STAGES.map(([key, label]) => ({
        key, label, count: customers.filter((row) => (text(row.crm_status) || 'new') === key).length,
      })),
      pages: list(records.pages, 'pages'), brandWaitlist: list(records.brandWaitlist, 'signups'),
      prospects: list(records.prospects, 'items'), pitches: list(records.pitches, 'items').filter((row) => linked(row, project)),
      attributions: records.attributions || [], summary: records.summary || {}, landing: records.landing || {},
      events: list(records.events, 'items', 'events').filter((row) => linked(row, project)),
    };
  }, [project, records]);
  const query = projectId ? `?project_id=${projectId}` : '';
  const state = { founderGrowSeed: { projects, projectId, records } };
  return <main className="a5-grow" data-testid="founder-grow-desk"><div className="a5-grow-canvas"><div className="a5-grow-main">
     <header className="a5-grow-hero"><div><h1>Get customers, people, reach</h1><p>One metric owns the month. Everything below is a lever on it.</p></div>
      {projects.length > 1 && <select data-testid="select-grow-project" value={projectId || ''} onChange={(event) => setProjectId(Number(event.target.value))}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
     <nav aria-label="Grow desk sections">{SECTIONS.map(([label, slug]) => <NavLink data-testid={`link-grow-anchor-${slug}`} to={`/grow/${slug}${query}`} key={label} className={zonePillClass}>{label}</NavLink>)}</nav>
    </header>
    {error && <div className="a5-grow-error" data-testid="status-grow-partial"><AlertCircle size={15} />{error}<button data-testid="button-retry-grow" type="button" onClick={() => setReload((count) => count + 1)}>Retry</button></div>}
    <GrowSections data={data} project={project} loading={loading} query={query} state={state} projectId={projectId} fillsOn={fillsOn} />
  </div><WorkerRail
    workspace="Grow"
    className="a5-rail"
    stance="Read-only source coverage"
    note="This rail summarizes records already stored for the selected startup. It takes no action."
    coverage={[
      `${data.snapshots.length} metric snapshot${data.snapshots.length === 1 ? '' : 's'}`,
      `${data.customers.length} customer record${data.customers.length === 1 ? '' : 's'}`,
      `${data.jobs.length} linked role${data.jobs.length === 1 ? '' : 's'}`,
      `${data.pages.length} brand page${data.pages.length === 1 ? '' : 's'}`,
      `${data.pitches.length} partnership record${data.pitches.length === 1 ? '' : 's'} · ${data.events.length} calendar entr${data.events.length === 1 ? 'y' : 'ies'}`,
    ]}
  /></div></main>;
}

function GrowSections({ data, project, loading, query, state, projectId, fillsOn }) {
  const focus = data.snapshots[0];
  const unavailable = Array.isArray(data.summary?.unavailable) ? data.summary.unavailable : [];
  const bandOn = fillsOn && Boolean(projectId);
  const scope = String(projectId || '');
  return <div className="a5-sections">
    <section className="a5-focus" id="a5-focus"><Head icon={Target} title="This month's focus" meta={project?.name || 'Selected startup'} />{loading ? <Skeleton rows={2} /> : !project ? <Empty icon={Target} title="No startup is available." body="Select a startup to read its operating records." /> : <>
      <div className="a5-focus-head">
        <div><strong>{focus ? 'Latest stored metric snapshot' : 'No monthly metric recorded'}</strong><p>Everything else this month is subordinate to this number.</p></div>
        <div className="a5-focus-stats">
          <Stat label="Leads captured" value={`${data.customers.length + data.brandWaitlist.length}`} />
          <Stat label="Trial → paid" value="Not recorded" note="No paid state is recorded against a customer" />
          <Stat label="Open roles" value={`${data.liveRoles.length}`} />
        </div>
      </div>
      <div className="a5-focus-numbers"><span>{focus?.snapshot_date ? `Snapshot date ${focus.snapshot_date}` : 'Snapshot date not recorded'}</span><span>Target not recorded</span></div>
      <p>{focus ? 'Open Focus to inspect the stored snapshot fields.' : 'No metric snapshot is recorded for this startup.'}{unavailable.length ? ` ${unavailable.length} derived metric${unavailable.length === 1 ? '' : 's'} cannot be computed yet: ${unavailable.map(metricName).join(', ')}.` : ''}</p>
      {unavailable.length ? <ul className="a5-unavailable" data-testid="list-grow-unavailable">{unavailable.map((item) => <li key={item.metric || String(item)}><b>{metricName(item)}</b> — {text(item?.reason) || 'No reason recorded.'}</li>)}</ul> : null}
      <DeskLink testid="link-open-grow-focus" to={`${GROW_PAGES.focus}${query}`} state={state}>Open focus</DeskLink></>}</section>
    <div className="a5-pair">
      <Card id="talent" icon={BriefcaseBusiness} title="Talent" meta={`${data.liveRoles.length} role${data.liveRoles.length === 1 ? '' : 's'} live · ${data.applicantTotal === null ? 'applicant count unavailable' : `${data.applicantTotal} applicant${data.applicantTotal === 1 ? '' : 's'}`}`} loading={loading}>
        {bandOn ? <ZoneDraft
          surface="grow/talent"
          scopeKey={scope}
          accent="violet"
          label="Match · why this one"
          run="Rank the applicants"
          accept="Keep this ranking"
          empty="Nothing proposed yet. Eadwyn will rank your applicants and give reasons for the top one — each a receipt you can open and check in their own application."
          nothingToDraft="No live role has an applicant yet."
          foot="A reading only. Nothing here moves an application to a screen."
        /> : null}
        <Rows rows={data.jobs} empty="No roles explicitly linked to this startup are recorded." />
        <DeskLink testid="link-open-grow-talent" to={`${GROW_PAGES.talent}${query}`} state={state}>Open talent</DeskLink></Card>
      <Card id="customers" icon={Users} title="Customers" meta={`Pipeline · ${data.customers.length} recorded`} loading={loading}>
        {bandOn ? <ZoneDraft
          surface="grow/customers"
          scopeKey={scope}
          accent="violet"
          label="Proposal · outreach sequence"
          run="Draft a sequence"
          accept="Accept sequence"
          empty="Nothing proposed yet. Eadwyn will draft a sequence for the signups who have gone furthest without converting, opening each touch on a pain you have actually recorded."
          nothingToDraft="No customer signup is recorded for this startup yet."
          foot="Each opener quotes a pain from your own map, or says none fits."
        /> : null}
        <div className="a5-funnel" data-testid="chart-grow-funnel">{data.funnel.map((stage) => <div key={stage.key}><strong>{stage.count}</strong><span>{stage.label}</span></div>)}</div>
        <p className="a5-note">Four stages, because four are recorded. A demo, a trial and a paid plan are not states a customer record can be in.</p>
        <DeskLink testid="link-open-grow-customers" to={`${GROW_PAGES.customers}${query}`} state={state}>Open customers</DeskLink></Card>
    </div>
    <Card id="brand" icon={Sparkles} title="Brand & landing" meta={`${data.pages.length} page${data.pages.length === 1 ? '' : 's'} live · ${data.brandWaitlist.length} lead${data.brandWaitlist.length === 1 ? '' : 's'} captured`} loading={loading} wide><div className="a5-brand-status"><b>{text(data.landing?.headline || data.landing?.name) || 'Landing record not recorded'}</b><span>{data.brandWaitlist.length} brand waitlist record{data.brandWaitlist.length === 1 ? '' : 's'}</span></div><Rows rows={data.pages} empty="No brand pages are recorded for this startup." /><p className="a5-note">Hero imagery is not generated here and cannot be: no image model is wired into this build, so there is nothing to iterate variants with.</p><DeskLink testid="link-open-grow-brand" to={`${GROW_PAGES.brand}${query}`} state={state}>Open brand</DeskLink></Card>
    <Card id="capital-match" icon={CircleDot} title="Capital match" meta={`${data.prospects.length} stored prospect${data.prospects.length === 1 ? '' : 's'}`} loading={loading} wide><Rows rows={data.prospects} empty="No stored investor prospects are recorded for this startup." /><p className="a5-note">Stored prospects only. This desk does not claim scored matches: no reranker runs here, so no fit score, no reason and no warm path is shown. Acting on any of these hands off to Raise; this zone only lists.</p><DeskLink testid="link-open-grow-capital" to={`${GROW_PAGES['capital-match']}${query}`} state={state}>Open capital match</DeskLink></Card>
    <div className="a5-pair"><Card id="partnerships" icon={Handshake} title="Partnerships" meta={`${data.pitches.length} in motion`} loading={loading}><Rows rows={data.pitches} empty="No project-linked partnership records are recorded." /><DeskLink testid="link-open-grow-partnerships" to={`${GROW_PAGES.partnerships}${query}`} state={state}>Open partnerships</DeskLink></Card>
      <Card id="launch" icon={Rocket} title="Launch calendar" meta={launchLabel(data.events)} loading={loading}><div className="a5-launches">{data.events.slice(0, 5).map((event, index) => <div key={event.id || event.uid || index}><b>{title(event, 'Untitled entry')}</b><span>{dateLabel(event.start_at)}</span></div>)}{!data.events.length && <p className="a5-empty">No calendar entry is linked to this startup.</p>}</div><p className="a5-note">{data.attributions.length ? `${data.attributions.length} co-marketing attribution record${data.attributions.length === 1 ? '' : 's'} is also stored.` : 'Launch entries come from the calendar; co-marketing attributions are counted separately and there are none.'}</p><DeskLink testid="link-open-grow-launch" to={`${GROW_PAGES.launch}${query}`} state={state}>Open launch</DeskLink></Card></div>
  </div>;
}

/** A5's `Sep` — the month the next linked entry falls in, or nothing to name. */
function launchLabel(events) {
  const next = events
    .map((event) => Date.parse(String(event.start_at || '')))
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => a - b)[0];
  if (next == null) return 'No dated entry';
  return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(next));
}
function Card({ id, icon, title: heading, meta, loading, children, wide }) { return <section className={`a5-card${wide ? ' a5-wide' : ''}`} id={`a5-${id}`}><Head icon={icon} title={heading} meta={meta} />{loading ? <Skeleton rows={2} /> : children}</section>; }
function Head({ icon: Icon, title: heading, meta }) { return <div className="a5-head"><div><Icon size={15} /><h2>{heading}</h2></div><span>{meta}</span></div>; }
function Stat({ label, value, note }) { return <div className="a5-stat"><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</div>; }
function Rows({ rows, empty }) { return rows.length ? <div className="a5-rows">{rows.slice(0, 4).map((row, index) => <div key={row.id || row.uid || index}><b>{title(row, 'Untitled record')}</b><span>{text(row.status || row.stage || row.created_at || row.updated_at) || 'Not recorded'}</span></div>)}</div> : <p className="a5-empty">{empty}</p>; }
function Skeleton({ rows }) { return <div className="a5-skeleton">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>; }
function Empty({ icon: Icon, title: heading, body }) { return <div className="a5-empty"><Icon size={18} /><div><b>{heading}</b><p>{body}</p></div></div>; }
function DeskLink({ to, state, testid, children }) { return <Link data-testid={testid} className="a5-link" to={to} state={state}>{children}<ChevronRight size={14} /></Link>; }
