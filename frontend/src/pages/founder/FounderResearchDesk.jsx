import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowUpRight, Landmark, Radar, RefreshCw, Search } from 'lucide-react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import { zonePillClass } from './deskZoneNav';
import './founderResearchDesk.css';

export const asList = (value, key) => Array.isArray(value) ? value : (Array.isArray(value?.[key]) ? value[key] : []);
const firstText = (...values) => values.find((value) => value !== null && value !== undefined && String(value).trim() !== '');
const prettyDate = (value) => {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

// The row navigates. These five were `#a7-ask` … `#a7-library`, in-page
// anchors — and two of them, `#a7-companies` and `#a7-library`, named sections
// that did not exist on the page, so they scrolled nowhere at all. Each now
// opens the Research zone it names.
const SECTIONS = [
  ['Ask', '/research/ask'],
  ['Markets', '/research/markets'],
  ['Companies', '/research/companies'],
  ['Funds', '/research/funds'],
  ['Library', '/research/library'],
];

export default function FounderResearchDesk() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const seed = location.state?.founderResearchSeed;
  const requestedId = Number(params.get('project_id')) || null;
  const [records, setRecords] = useState(() => seed?.records || {});
  const [projects, setProjects] = useState(() => seed?.projects || []);
  const [projectId, setProjectId] = useState(() => requestedId || seed?.projectId || null);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(!seed);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    const calls = {
      pulse: api.marketPulse(), rounds: api.privateRounds(),
      sources: api.miSources(), signals: api.signals.list({ mode: 'founder' }),
      signalSources: api.signals.sources(), companies: api.listCompanies({ limit: 12 }),
      projects: api.listProjects(),
    };
    Promise.allSettled(Object.entries(calls).map(async ([key, request]) => [key, await request])).then((results) => {
      if (!alive) return;
      const next = {}; const failed = [];
      results.forEach((result, index) => {
        const key = Object.keys(calls)[index];
        if (result.status === 'fulfilled') next[key] = result.value[1]; else failed.push(key);
      });
      if (next.projects !== undefined) {
        const list = asList(next.projects, 'projects').length ? asList(next.projects, 'projects') : asList(next.projects, 'items').length ? asList(next.projects, 'items') : asList(next.projects);
        const selected = list.find((item) => Number(item.id) === requestedId) || list.find((item) => Number(item.id) === Number(projectId)) || list[0];
        setProjects(list);
        if (selected) setProjectId(selected.id);
        else if (requestedId) { setProjects([{ id: requestedId, name: `Startup #${requestedId}` }]); setProjectId(requestedId); }
      } else if (requestedId) {
        setProjects([{ id: requestedId, name: `Startup #${requestedId}` }]); setProjectId(requestedId);
      }
      if (Object.keys(next).length) setRecords((previous) => ({ ...previous, ...next }));
      setError(failed.length ? 'Some evidence sources are temporarily unavailable. Stored results remain visible.' : '');
    }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [retry]);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    api.listDocuments(projectId).then((value) => alive && setRecords((previous) => ({ ...previous, documents: value })))
      .catch(() => alive && setError('Some evidence sources are temporarily unavailable. Stored results remain visible.'));
    setParams((previous) => { const next = new URLSearchParams(previous); next.set('project_id', String(projectId)); return next; }, { replace: true });
    return () => { alive = false; };
  }, [projectId, setParams]);

  const data = useMemo(() => {
    const pulse = records.pulse || {};
    const headlines = asList(pulse, 'headlines');
    const signals = asList(records.signals, 'signals').length ? asList(records.signals, 'signals') : asList(records.signals, 'items');
    const markets = asList(pulse, 'signals');
    const rounds = asList(records.rounds, 'rounds');
    const companies = asList(records.companies, 'companies').length ? asList(records.companies, 'companies') : asList(records.companies, 'items');
    const docs = asList(records.documents, 'documents').length ? asList(records.documents, 'documents') : asList(records.documents, 'items');
    const marketSources = asList(records.sources, 'sources').length ? asList(records.sources, 'sources') : asList(records.sources, 'items');
    const signalSources = asList(records.signalSources, 'sources').length ? asList(records.signalSources, 'sources') : asList(records.signalSources, 'items');
    return { pulse, headlines, signals, markets, rounds, companies, docs, sources: [...marketSources, ...signalSources] };
  }, [records]);
  const selectedProject = projects.find((item) => Number(item.id) === Number(projectId));
  const state = { founderResearchSeed: { records, projects, projectId } };
  const brief = data.headlines[0] || data.signals[0] || data.markets[0];
  const briefRecord = brief && typeof brief === 'object' ? brief : {};
  const briefTitle = firstText(typeof brief === 'string' ? brief : null, briefRecord.title, briefRecord.name, briefRecord.headline, briefRecord.sector, 'No stored market evidence is available');
  const briefBody = firstText(briefRecord.summary, briefRecord.description, briefRecord.reasoning, briefRecord.technographic_signal, 'The approved market sources have not returned a brief for this view.');
  const freshness = firstText(data.pulse.updated_at, records.pulse?.updated_at);
  const cached = data.pulse.headlines_cached ?? data.pulse.cached;
  const query = projectId ? `?project_id=${projectId}` : '';
  const pulseLoaded = Object.hasOwn(records, 'pulse');
  const roundsLoaded = Object.hasOwn(records, 'rounds');
  const companiesLoaded = Object.hasOwn(records, 'companies');
  const documentsLoaded = Object.hasOwn(records, 'documents');
  const signalsLoaded = Object.hasOwn(records, 'signals');

  return <main className="a7-research" data-testid="founder-research-desk">
    <div className="a7-canvas">
      <div className="a7-main">
        <header className="a7-hero"><div className="a7-kicker">Founder / Research</div><h1>Go deep on a market or company</h1><p>The page opens as a question, not a menu.</p>
          <div className="a7-question"><Search size={16} /><input data-testid="input-research-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question about a market or company" /><Link data-testid="link-explore-evidence" to="/signals?mode=workspace" state={state}>Open signals <ArrowUpRight size={14} /></Link></div>
          <div className="a7-honesty">Question-based briefs are not connected in this overview. Questions remain local here; open Signals to inspect stored evidence.</div>
          <nav className="a7-anchors" aria-label="Research sections">{SECTIONS.map(([label, to], index) => <NavLink data-testid={`link-research-anchor-${index}`} key={label} to={`${to}${query}`} state={state} className={zonePillClass}>{label}</NavLink>)}</nav>
        </header>
        {error && <div className="a7-error" data-testid="status-research-partial"><AlertCircle size={15} />{error}<button data-testid="button-retry-research" type="button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={13} />Retry</button></div>}
        <section className="a7-card a7-brief" id="a7-ask"><SectionHead title="Sourced brief" meta={freshness ? `Updated ${prettyDate(freshness)}` : 'Stored market evidence'} />
          {loading && !brief ? <Skeleton /> : <><div className="a7-source-label"><Radar size={13} /> Stored market evidence</div><h2 data-testid="text-research-brief-title">{briefTitle}</h2><p data-testid="text-research-brief-summary">{briefBody}</p><div className="a7-citations">{firstText(briefRecord.source, briefRecord.publisher, data.sources[0]?.name, 'Source not recorded')} <span>{prettyDate(firstText(briefRecord.published, briefRecord.date, briefRecord.updated_at))}</span>{firstText(briefRecord.link, briefRecord.url, briefRecord.source_url) && <a href={firstText(briefRecord.link, briefRecord.url, briefRecord.source_url)} target="_blank" rel="noreferrer">Open source <ArrowUpRight size={12} /></a>}</div></>}
        </section>
        <section className="a7-card a7-mint" id="a7-markets"><SectionHead title="Source freshness & cache" meta="Read-only source status" /><div className="a7-cache-grid"><div><strong>{cached === true ? 'Cached input available' : cached === false ? 'Freshness flag: not cached' : 'Cache state not recorded'}</strong><p>Only returned source flags are shown here. No research run, model, rate, token, or savings estimate is inferred.</p></div><div className="a7-cache-facts"><span>Last returned update <b>{freshness ? prettyDate(freshness) : 'Not recorded'}</b></span><span>Headline cache <b>{cached === true ? 'Yes' : cached === false ? 'No' : 'Not recorded'}</b></span></div></div></section>
        <section className="a7-card" id="a7-funds"><SectionHead title="Fund research" meta="Founder-accessible external research" /><div className="a7-unavailable"><Landmark size={19} /><div><strong>Not recorded / unavailable</strong><p>No founder-accessible external fund-research contract exists here. Operational fund records are not shown.</p></div></div><Link className="a7-link" to="/raise/capital/pipeline" state={state}>Open capital pipeline <ArrowUpRight size={13} /></Link></section>
        <div className="a7-bottom">
          <section className="a7-card"><SectionHead title="Market deep-dives" meta={pulseLoaded || roundsLoaded ? `${data.markets.length + data.rounds.length} stored market records` : 'Source unavailable'} /><p>Market signals and private-round records available for deeper inspection.</p><Link className="a7-link" to="/market-intel" state={state}>Open market intelligence <ArrowUpRight size={13} /></Link></section>
          <section className="a7-card" id="a7-companies"><SectionHead title="Company profiles" meta={companiesLoaded ? `${data.companies.length} returned` : 'Source unavailable'} /><p>{data.companies.length ? 'Company records are available from the company directory.' : companiesLoaded ? 'No company records are available from the approved source.' : 'The company source is temporarily unavailable.'}</p><Link className="a7-link" to="/build/competitors" state={state}>Open competitor analysis <ArrowUpRight size={13} /></Link></section>
          <section className="a7-card" id="a7-library"><SectionHead title="Document library" meta={documentsLoaded ? `${data.docs.length} stored document${data.docs.length === 1 ? '' : 's'}` : projectId ? 'Source unavailable' : 'Startup not selected'} /><p>{selectedProject ? `Legal documents for ${selectedProject.name || `Startup #${projectId}`}.` : 'Select a startup to read its legal documents.'}</p><Link className="a7-link" to={`/raise/data-room${query}`} state={state}>Open data room <ArrowUpRight size={13} /></Link></section>
        </div>
      </div>
      <WorkerRail
        workspace="Research"
        className="a7-rail"
        stance="Read-only source coverage"
        note="This rail reports manual coverage for stored records. It does not run research, answer questions, or take actions."
        coverage={[
          data.sources.length ? `${data.sources.length} source records` : 'Source list not recorded',
          pulseLoaded ? `${data.headlines.length} stored headlines` : 'Headlines unavailable',
          signalsLoaded ? `${data.signals.length} stored signals` : 'Signals unavailable',
          `Selected startup · ${selectedProject?.name || (projectId ? `Startup #${projectId}` : 'Not selected')}`,
        ]}
        footer="Manual view · no automated actions"
      />
    </div>
  </main>;
}

function SectionHead({ title, meta }) { return <div className="a7-head"><h2>{title}</h2><span>{meta}</span></div>; }
function Skeleton() { return <div className="a7-skeleton"><i /><i /><i /></div>; }