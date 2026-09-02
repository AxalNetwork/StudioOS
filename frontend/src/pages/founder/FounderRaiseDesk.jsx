import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowUpRight, ChevronRight, FileText, Folder, Landmark, Scale, Sparkles, Target } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderRaiseDesk.css';

// Six labels, six routes. This was a six-deep ternary chain ending in an
// `<a href="#raise-…">` fallback no label could reach — every branch already
// resolved to a Link, so the anchor was dead code the shape still advertised.
const SECTIONS = [
  ['Status', 'status'], ['Pitch', 'pitch'], ['Capital', 'capital'],
  ['Legal', 'legal'], ['Data room', 'data-room'], ['Liquidity', 'liquidity'],
];

const asList = (value, key) => Array.isArray(value) ? value : (Array.isArray(value?.[key]) ? value[key] : []);
const clean = (value) => String(value || '').trim();
const money = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
  ? 'Not recorded'
  : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
const date = (value) => {
  if (!value) return 'Not recorded';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};
const status = (value) => clean(value).replace(/[_-]/g, ' ') || 'Not recorded';

export default function FounderRaiseDesk() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const seed = location.state?.founderRaiseSeed;
  const [projects, setProjects] = useState(() => seed?.projects || []);
  const [projectId, setProjectId] = useState(() => Number(searchParams.get('project_id')) || seed?.projectId || null);
  const [records, setRecords] = useState(() => seed?.records || {});
  const [loading, setLoading] = useState(!seed);
  const [projectError, setProjectError] = useState('');
  const [errors, setErrors] = useState({});
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true); setProjectError('');
    api.listProjects().then((response) => {
      if (!alive) return;
      const list = asList(response, 'items');
      const requested = Number(searchParams.get('project_id'));
      const selected = list.find((item) => Number(item.id) === requested) || list.find((item) => Number(item.id) === Number(projectId)) || list[0];
      setProjects(list); setProjectId(selected?.id || (requested || null));
      if (!selected && requested) setProjects([{ id: requested, name: `Startup #${requested}` }]);
    }).catch((error) => {
      if (!alive) return;
      const requested = Number(searchParams.get('project_id'));
      if (requested) { setProjects([{ id: requested, name: `Startup #${requested}` }]); setProjectId(requested); }
      setProjectError(error?.message || 'The project list is unavailable.');
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reload]);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const project = projects.find((item) => Number(item.id) === Number(projectId));
    setSearchParams((previous) => { const next = new URLSearchParams(previous); next.set('project_id', String(projectId)); return next; }, { replace: true });
    setLoading(true); setErrors({});
    const calls = {
      round: api.raiseRound(projectId),
      prospects: api.raiseProspects(projectId),
      legal: api.listDocuments(projectId),
      deck: api.deckListVersions(projectId),
      room: project?.uid ? api.dataRoom(project.uid) : Promise.reject(new Error('Project room identifier is unavailable.')),
    };
    Promise.allSettled(Object.entries(calls).map(async ([key, request]) => [key, await request])).then((results) => {
      if (!alive) return;
      const next = {}; const nextErrors = {};
      results.forEach((result, index) => {
        const key = Object.keys(calls)[index];
        if (result.status === 'fulfilled') next[key] = result.value[1];
        else nextErrors[key] = result.reason?.message || 'Unavailable';
      });
      setRecords(next); setErrors(nextErrors);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId, projects, reload, setSearchParams]);

  const project = projects.find((item) => Number(item.id) === Number(projectId));
  const data = useMemo(() => {
    const prospects = asList(records.prospects, 'items');
    const docs = asList(records.legal, 'documents');
    const versions = asList(records.deck, 'versions');
    const room = records.room || {};
    return { prospects, docs, versions, room, roundInfo: records.round || { round: null, raised: 0, committed_count: 0 } };
  }, [records]);
  const query = projectId ? `?project_id=${projectId}` : '';
  const state = { founderRaiseSeed: { projects, projectId, records } };

  return <main className="raise-desk" data-testid="founder-raise-desk">
    <section className="raise-canvas">
      <div className="raise-main">
        <header className="raise-hero">
          <div className="raise-eyebrow">Founder / Raise</div>
          <div className="raise-heading"><div><h1>Get capital, stay legal</h1><p>Pitch, capital planning, legal readiness, data room, and liquidity in one fundraising workspace.</p></div>
            {projects.length > 1 && <select data-testid="select-raise-project" value={projectId || ''} onChange={(event) => setProjectId(Number(event.target.value))}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
          </div>
          <nav className="raise-anchors" aria-label="Raise desk sections">{SECTIONS.map(([label, slug]) => <Link data-testid={`link-raise-anchor-${slug}`} to={`/raise/${slug}${query}`} key={label}>{label}</Link>)}</nav>
        </header>
        {(projectError || Object.keys(errors).length > 0) && <div className="raise-error" data-testid="status-raise-partial"><AlertCircle size={16} /><span>{projectError || 'Some selected-project records are unavailable.'}</span><button data-testid="button-retry-raise" type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></div>}
        <RaiseSections loading={loading} project={project} data={data} errors={errors} query={query} state={state} />
      </div>
      <WorkerRail
        workspace="Raise"
        className="raise-rail"
        stance="Manual raise view"
        note="This surface reads selected-project records only. It does not generate, score, or change fundraising materials."
        coverage={[
          `${data.prospects.length} prospect${data.prospects.length === 1 ? '' : 's'} · ${data.docs.length} legal doc${data.docs.length === 1 ? '' : 's'}`,
          `${data.versions.length} deck version${data.versions.length === 1 ? '' : 's'} · ${asList(data.room, 'files').length} data-room file${asList(data.room, 'files').length === 1 ? '' : 's'}`,
        ]}
        action={<Link data-testid="link-rail-open-raise-workspace" to={`/raise/pitch?mode=workspace${query ? `&${query.slice(1)}` : ''}`} state={state}>Open pitch workspace <ArrowUpRight size={13} /></Link>}
      />
    </section>
  </main>;
}

function RaiseSections({ loading, project, data, errors, query, state }) {
  const { roundInfo, prospects, docs, versions, room } = data;
  const round = roundInfo.round;
  const target = round?.target_amount;
  const raised = roundInfo.raised;
  const coverage = target != null && Number(target) > 0 && Number.isFinite(Number(raised)) ? Math.min(100, Math.round(Number(raised) / Number(target) * 100)) : null;
  const files = asList(room, 'files'); const folders = asList(room, 'folders'); const grants = asList(room, 'grants');
  return <div className="raise-sections">
    <section className="raise-status-card" id="raise-status"><Head icon={Target} title="Round status" meta={loading ? 'Reading source records' : (round?.name || 'No round recorded')} />
      {loading ? <Skeleton rows={2} /> : !project ? <Empty icon={Target} title="No startup is available to this view yet." body="Select or create a startup to see its raise records." /> : errors.round && errors.prospects ? <Unavailable /> : <><div className="status-grid"><Metric label="Raised (committed)" value={money(raised)} /><Metric label="Target" value={money(target)} /><Metric label="Close date" value={date(round?.close_date)} /><Metric label="Prospects" value={`${prospects.length} stored`} /></div>{coverage !== null && <div className="raise-progress"><i style={{ width: `${coverage}%` }} /><span>{coverage}% of target from committed amount</span></div>}{round?.notes && <p className="round-notes">{round.notes}</p>}<p className="source-note">{round ? 'Round fields and prospect count are selected-project records.' : 'No round is recorded for this startup.'}</p></>}
    </section>
    <div className="raise-pair">
      <section className="raise-card" id="raise-capital"><Head icon={Landmark} title="Capital · dilution" meta="Selected-project round" />{loading ? <Skeleton rows={3} /> : errors.round ? <Unavailable /> : <><div className="capital-figures"><Metric label="Round target" value={money(target)} /><Metric label="Committed" value={money(raised)} /><Metric label="Prospect coverage" value={`${prospects.length} stored`} /></div><p className="source-note">No dilution calculation is shown because no current response provides one.</p><DeskLink testid="link-open-capital" to={`/raise/capital${query}`} state={state}>Open capital planner</DeskLink></>}</section>
      <section className="raise-card" id="raise-legal"><Head icon={Scale} title="Legal engine" meta={loading ? 'Reading documents' : `${docs.length} stored document${docs.length === 1 ? '' : 's'}`} />{loading ? <Skeleton rows={3} /> : errors.legal ? <Unavailable /> : <><div className="legal-list">{docs.slice(0, 4).map((doc, index) => <div key={doc.id || index}><FileText size={14} /><span>{clean(doc.title || doc.name || doc.doc_type) || 'Untitled document'}</span><small>{status(doc.status)}</small></div>)}{!docs.length && <Empty icon={FileText} title="No legal documents are recorded." body="Stored legal documents appear here." />}</div><p className="source-note">Clause analysis and term-sheet warnings: Not recorded.</p><DeskLink testid="link-open-legal" to={`/raise/legal${query}`} state={state}>Open legal collection</DeskLink></>}</section>
    </div>
    <section className="raise-card" id="raise-data-room"><Head icon={Folder} title="Data room" meta={loading ? 'Reading room' : `${files.length} files · ${folders.length} folders · ${grants.length} grants`} />{loading ? <Skeleton rows={3} /> : errors.room ? <Unavailable /> : <><div className="artifact-grid">{[...folders.map((item) => ({ ...item, kind: 'Folder' })), ...files.map((item) => ({ ...item, kind: 'File' }))].slice(0, 8).map((item, index) => <article key={item.uid || index}><span>{item.kind}</span><strong>{clean(item.name) || 'Unnamed artifact'}</strong><small>{status(item.visibility)}</small></article>)}{!files.length && !folders.length && <Empty icon={Folder} title="No artifacts are recorded in this room." body="This workspace does not create placeholders." />}</div><DeskLink testid="link-open-data-room" to={`/raise/data-room${query}`} state={state}>Open data room</DeskLink></>}</section>
    <section className="raise-card" id="raise-pitch"><Head icon={Sparkles} title="Pitch" meta={loading ? 'Reading versions' : `${versions.length} stored version${versions.length === 1 ? '' : 's'}`} />{loading ? <Skeleton rows={2} /> : errors.deck ? <Unavailable /> : <><div className="deck-list">{versions.slice(0, 4).map((deck, index) => <div key={deck.id || index}><strong>{clean(deck.name || deck.title) || `Version ${deck.version ?? index + 1}`}</strong><span>{Array.isArray(deck.slides) ? `${deck.slides.length} slides` : 'Slide count not recorded'}</span><small>{status(deck.status || deck.updated_at || deck.created_at)}</small></div>)}{!versions.length && <Empty icon={Sparkles} title="No deck version is recorded." body="Create or edit a deck in the detailed workspace." />}</div><DeskLink testid="link-open-pitch-workspace" to={`/raise/pitch?mode=workspace${project ? `&project_id=${project.id}` : ''}`} state={state}>Open pitch workspace</DeskLink></>}</section>
    <section className="raise-card exits" id="raise-liquidity"><Head icon={Landmark} title="Liquidity & exits" meta="Not recorded" /><p>No project-linked exit model or secondary is recorded. This desk does not fabricate a waterfall.</p><DeskLink testid="link-open-liquidity" to="/liquidity" state={state}>Open liquidity workspace</DeskLink></section>
  </div>;
}
function Head({ icon: Icon, title, meta }) { return <div className="raise-head"><div><Icon size={16} /><h2>{title}</h2></div><span>{meta}</span></div>; }
function Metric({ label, value }) { return <div className="raise-metric"><span>{label}</span><strong>{value}</strong></div>; }
function Skeleton({ rows }) { return <div className="raise-skeleton">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>; }
function Unavailable() { return <div className="raise-unavailable">This selected-project record is unavailable. Retry when the source is reachable.</div>; }
function Empty({ icon: Icon, title, body }) { return <div className="raise-empty"><Icon size={19} /><div><strong>{title}</strong><p>{body}</p></div></div>; }
function DeskLink({ to, state, testid, children }) { return <Link data-testid={testid} className="raise-link" to={to} state={state}>{children}<ChevronRight size={14} /></Link>; }
