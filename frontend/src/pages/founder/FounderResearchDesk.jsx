import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowUpRight, Landmark, Radar, RefreshCw, Search } from 'lucide-react';
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Unreadable, WorkerRail } from '../../ui';
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
  // The last answer asked from this desk: `{ question, answer, reason,
  // citations, cost_usd, indexed_documents }` as `/research/ask` returns it.
  const [asked, setAsked] = useState(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const [loading, setLoading] = useState(!seed);
  const [error, setError] = useState('');
  // WHICH sources failed, not just THAT some did. Task #107's batch: every card
  // below printed "Source unavailable" whenever its key was absent from
  // `records`, and a key is absent both while the request is in flight and
  // after it fails. So a healthy page said "Source unavailable" on every card
  // until the fetch resolved, and a store holding 196,956 rows said it too.
  // Three states, three sentences.
  const [failedKeys, setFailedKeys] = useState(() => new Set());
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    const calls = {
      pulse: api.marketPulse(), rounds: api.privateRounds(),
      sources: api.miSources(), signals: api.signals.list({ mode: 'founder' }),
      signalSources: api.signals.sources(), companies: api.listCompanies({ limit: 12 }),
      projects: api.listProjects(),
      // A7's Funds and Library cards read the Research bucket's own stores
      // (migrations 216 and 213), owner-scoped by the worker.
      funds: api.research.funds(), library: api.research.documents(),
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
      setFailedKeys(new Set(failed));
      setError(failed.length ? 'Some evidence sources are temporarily unavailable. Stored results remain visible.' : '');
    }).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [retry]);

  useEffect(() => {
    if (!projectId) return;
    setParams((previous) => { const next = new URLSearchParams(previous); next.set('project_id', String(projectId)); return next; }, { replace: true });
  }, [projectId, setParams]);

  /**
   * ASK RUNS ON THE PRESS, NEVER ON THE PAGE. The question box used to stay
   * local ("Questions remain local here"), while `/research/ask` (migration
   * 213) answered from the founder's own library with citations. The desk now
   * submits to that route — the same thread `/research/ask` shows, so the
   * answer is there to follow up on — and prints what came back: the answer
   * with its numbered sources, or the route's own reason for not answering.
   * Nothing is asked until the founder presses Ask; a visit spends nothing.
   */
  const ask = async (event) => {
    event.preventDefault();
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true); setAskError('');
    try {
      setAsked(await api.research.ask(q));
    } catch (cause) {
      setAsked(null);
      setAskError(cause?.message || 'That question could not be answered right now.');
    } finally { setAsking(false); }
  };

  const data = useMemo(() => {
    const pulse = records.pulse || {};
    const headlines = asList(pulse, 'headlines');
    const signals = asList(records.signals, 'signals').length ? asList(records.signals, 'signals') : asList(records.signals, 'items');
    const markets = asList(pulse, 'signals');
    const rounds = asList(records.rounds, 'rounds');
    const companies = asList(records.companies, 'companies').length ? asList(records.companies, 'companies') : asList(records.companies, 'items');
    const library = asList(records.library, 'items');
    const funds = records.funds || null;
    const marketSources = asList(records.sources, 'sources').length ? asList(records.sources, 'sources') : asList(records.sources, 'items');
    const signalSources = asList(records.signalSources, 'sources').length ? asList(records.signalSources, 'sources') : asList(records.signalSources, 'items');
    return { pulse, headlines, signals, markets, rounds, companies, library, funds, sources: [...marketSources, ...signalSources] };
  }, [records]);
  const selectedProject = projects.find((item) => Number(item.id) === Number(projectId));
  const state = { founderResearchSeed: { records, projects, projectId } };
  const brief = data.headlines[0] || data.signals[0] || data.markets[0];
  const briefRecord = brief && typeof brief === 'object' ? brief : {};
  const briefTitle = firstText(typeof brief === 'string' ? brief : null, briefRecord.title, briefRecord.name, briefRecord.headline, briefRecord.sector,
    Object.hasOwn(records, 'pulse') || Object.hasOwn(records, 'signals')
      ? 'No market evidence is stored for this view yet'
      : failedKeys.has('pulse') ? 'The market source is unavailable' : 'Loading\u2026');
  const briefBody = firstText(briefRecord.summary, briefRecord.description, briefRecord.reasoning, briefRecord.technographic_signal, 'The approved market sources have not returned a brief for this view.');
  const freshness = firstText(data.pulse.updated_at, records.pulse?.updated_at);
  const cached = data.pulse.headlines_cached ?? data.pulse.cached;
  const query = projectId ? `?project_id=${projectId}` : '';
  /**
   * The meta line for one source, distinguishing the three states it can be in.
   *
   * Loaded is the only one that can quote a number, and it quotes ZERO happily:
   * an empty store is a fact about the store, not about the connection. The
   * other two are different failures with different fixes, and conflating them
   * is what made three live Research zones read as unbuilt.
   */
  const sourceMeta = (key, whenLoaded) => {
    if (Object.hasOwn(records, key)) return whenLoaded;
    if (failedKeys.has(key)) return 'Source unavailable';
    return 'Loading\u2026';
  };
  const pulseLoaded = Object.hasOwn(records, 'pulse');
  const roundsLoaded = Object.hasOwn(records, 'rounds');
  const companiesLoaded = Object.hasOwn(records, 'companies');
  const signalsLoaded = Object.hasOwn(records, 'signals');

  return <main className="a7-research" data-testid="founder-research-desk">
    <div className="a7-canvas">
      <div className="a7-main">
        <header className="a7-hero"><h1>Go deep on a market or company</h1><p>The page opens as a question, not a menu.</p>
          <form className="a7-question" onSubmit={ask}><Search size={16} /><input data-testid="input-research-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question about a market or company" maxLength={1000} /><button type="submit" data-testid="button-research-ask" disabled={asking || !question.trim()}>{asking ? 'Asking…' : 'Ask'}</button></form>
          <div className="a7-honesty">Eadwyn answers only from the documents in your research library, and cites each one. Every question joins your thread on the Ask page.</div>
          <AskResult asked={asked} error={askError} />
          <nav className="a7-anchors" aria-label="Research sections">{SECTIONS.map(([label, to], index) => <NavLink data-testid={`link-research-anchor-${index}`} key={label} to={`${to}${query}`} state={state} className={zonePillClass}>{label}</NavLink>)}</nav>
        </header>
        {error && <div className="a7-error" data-testid="status-research-partial"><AlertCircle size={15} />{error}<button data-testid="button-retry-research" type="button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={13} />Retry</button></div>}
        <section className="a7-card a7-brief" id="a7-ask"><SectionHead title="Sourced brief" meta={freshness ? `Updated ${prettyDate(freshness)}` : 'Stored market evidence'} />
          {loading && !brief ? <Skeleton /> : <><div className="a7-source-label"><Radar size={13} /> Stored market evidence</div><h2 data-testid="text-research-brief-title">{briefTitle}</h2><p data-testid="text-research-brief-summary">{briefBody}</p><div className="a7-citations">{firstText(briefRecord.source, briefRecord.publisher, data.sources[0]?.name, 'Source not recorded')} <span>{prettyDate(firstText(briefRecord.published, briefRecord.date, briefRecord.updated_at))}</span>{firstText(briefRecord.link, briefRecord.url, briefRecord.source_url) && <a href={firstText(briefRecord.link, briefRecord.url, briefRecord.source_url)} target="_blank" rel="noreferrer">Open source <ArrowUpRight size={12} /></a>}</div></>}
        </section>
        <section className="a7-card a7-mint" id="a7-markets"><SectionHead title="Source freshness & cache" meta="Read-only source status" /><div className="a7-cache-grid"><div><strong>{cached === true ? 'Cached input available' : cached === false ? 'Freshness flag: not cached' : 'Cache state not recorded'}</strong><p>Only returned source flags are shown here. No research run, model, rate, token, or savings estimate is inferred.</p></div><div className="a7-cache-facts"><span>Last returned update <b>{freshness ? prettyDate(freshness) : 'Not recorded'}</b></span><span>Headline cache <b>{cached === true ? 'Yes' : cached === false ? 'No' : 'Not recorded'}</b></span></div></div></section>
        <section className="a7-card" id="a7-funds"><SectionHead title="Fund research" meta={sourceMeta('funds', `${data.funds?.researched_count ?? 0} researched`)} /><FundResearch funds={data.funds} failed={failedKeys.has('funds')} onRetry={() => setRetry((value) => value + 1)} /><Link className="a7-link" data-testid="link-open-research-funds" to={`/research/funds${query}`} state={state}>Open funds <ArrowUpRight size={13} /></Link></section>
        <div className="a7-bottom">
          <section className="a7-card"><SectionHead title="Market deep-dives" meta={pulseLoaded || roundsLoaded
            ? `${data.markets.length + data.rounds.length} stored market records`
            : sourceMeta('pulse', '')} /><p>Market signals and private-round records available for deeper inspection.</p><Link className="a7-link" data-testid="link-open-research-markets" to={`/research/markets${query}`} state={state}>Open markets <ArrowUpRight size={13} /></Link></section>
          <section className="a7-card" id="a7-companies"><SectionHead title="Company profiles" meta={sourceMeta('companies', `${data.companies.length} returned`)} /><p>{data.companies.length ? 'Company records are available from the company directory.' : companiesLoaded ? 'No company records are available from the approved source.' : 'The company source is temporarily unavailable.'}</p><Link className="a7-link" to="/build/competitors" state={state}>Open competitor analysis <ArrowUpRight size={13} /></Link></section>
          <section className="a7-card" id="a7-library"><SectionHead title="Document library" meta={sourceMeta('library', `${data.library.length} document${data.library.length === 1 ? '' : 's'}`)} /><p data-testid="text-research-library">{libraryLine(records.library, failedKeys.has('library'))}</p><Link className="a7-link" data-testid="link-open-research-library" to={`/research/library${query}`} state={state}>Open library <ArrowUpRight size={13} /></Link></section>
        </div>
      </div>
      <WorkerRail
        workspace="Research"
        className="a7-rail"
        stance="Read-only source coverage"
        note="This rail reports coverage for stored records. A question runs only when you press Ask, and is answered from your own library."
        coverage={[
          data.sources.length ? `${data.sources.length} source records` : 'Source list not recorded',
          sourceMeta('pulse', `${data.headlines.length} stored headlines`),
          signalsLoaded ? `${data.signals.length} stored signals` : 'Signals unavailable',
          `Selected startup · ${selectedProject?.name || (projectId ? `Startup #${projectId}` : 'Not selected')}`,
        ]}
        footer="Manual view · no automated actions"
      />
    </div>
  </main>;
}

/**
 * What `/research/ask` said, in the three shapes it says it.
 *
 * `no_source` has two meanings the route keeps apart on purpose — an empty
 * library and a library with nothing on this — and `indexed_documents` is how
 * the page tells them apart. `model_unavailable` still carries the passages it
 * found, so they are listed rather than hidden.
 */
function AskResult({ asked, error }) {
  if (error) return <p className="a7-answer is-error" role="alert" data-testid="status-research-ask-error">{error}</p>;
  if (!asked) return null;
  const citations = Array.isArray(asked.citations) ? asked.citations : [];
  const said = asked.reason === 'answered' ? asked.answer
    : asked.reason === 'no_source' ? (Number(asked.indexed_documents) === 0 ? 'Your research library holds no indexed document yet, so there is nothing to answer from.' : 'Nothing in your research library answers this question closely enough to cite.')
      : 'The passages below were found, but no answer could be written from them just now.';
  return <div className="a7-answer" data-testid="card-research-answer">
    <p>{said}</p>
    {citations.length ? <ol>{citations.map((c, index) => <li key={`${c.title}-${index}`}>{c.title || 'Untitled document'}{Number.isFinite(Number(c.chunk)) ? <span> · passage {Number(c.chunk) + 1}</span> : null}</li>)}</ol> : null}
    <div className="a7-answer-foot">{Number.isFinite(Number(asked.cost_usd)) ? <span>Cost ${Number(asked.cost_usd).toFixed(4)}</span> : null}<Link data-testid="link-research-ask-thread" to="/research/ask">Continue in Ask <ArrowUpRight size={12} /></Link></div>
  </div>;
}
/**
 * A7's fund research, from `research_funds` (migration 216). The counts are
 * the route's own, so this card and `/research/funds` cannot disagree; the
 * cheque overlap is null — not zero — when no raise target is recorded, and
 * the route's sentence says why.
 */
function FundResearch({ funds, failed, onRetry }) {
  if (failed) return <Unreadable what="Your fund research" claim="This is not a sign that no fund is researched." onRetry={onRetry} />;
  if (!funds) return <Skeleton />;
  if (!Number(funds.researched_count)) return <div className="a7-unavailable"><Landmark size={19} /><div><strong>No fund is researched yet</strong><p>Add the funds you are considering on the Funds page, with their cheque range, stage fit and path in.</p></div></div>;
  return <div className="a7-fund-stats" data-testid="stats-research-funds">
    <div><strong>{funds.right_stage_count}</strong><span>At the right stage</span></div>
    <div><strong>{funds.warm_path_count}</strong><span>With a warm path</span></div>
    <div><strong>{funds.cheque_overlap_count == null ? 'Not recorded' : funds.cheque_overlap_count}</strong><span>Cheque fits the raise</span></div>
    <div><strong>{funds.passed_count}</strong><span>Passed</span></div>
    {funds.cheque_overlap_count == null && funds.cheque_overlap_note ? <p>{funds.cheque_overlap_note}</p> : null}
  </div>;
}
function libraryLine(library, failed) {
  if (failed) return 'Your research library could not be read.';
  if (!library) return 'Reading your research library…';
  const indexed = Number(library.indexed) || 0;
  const pending = Number(library.not_indexed) || 0;
  if (!indexed && !pending) return 'No document is in your research library yet. Ask answers only from what is here.';
  return `${indexed} indexed and answerable in Ask${pending ? ` · ${pending} not indexed yet` : ''}.`;
}
function SectionHead({ title, meta }) { return <div className="a7-head"><h2>{title}</h2><span>{meta}</span></div>; }
function Skeleton() { return <div className="a7-skeleton"><i /><i /><i /></div>; }