import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Landmark, RefreshCw, Search } from 'lucide-react';
import { api } from '../../lib/api';
import './investorResearchWorkspace.css';

const arrayOf = (value, keys = []) => Array.isArray(value) ? value : keys.reduce((found, key) => found.length ? found : (Array.isArray(value?.[key]) ? value[key] : []), []);
const stamp = (value) => { if (!value) return 'Freshness not supplied'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Freshness not supplied' : `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`; };

function Skeleton() { return <div className="ir-skeleton" data-testid="research-loading-skeleton">{[0, 1, 2].map((row) => <i key={row} />)}</div>; }

export default function InvestorResearchWorkspace() {
  const [question, setQuestion] = useState('What evidence is available for this market?');
  const [submitted, setSubmitted] = useState(false);
  const [data, setData] = useState(null);
  const [errors, setErrors] = useState({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setRefreshing(refresh);
    const results = await Promise.allSettled([
      api.miSectorCompass(), api.studioBenchmarks(), api.miSources(), api.privateRounds(),
      api.listProjects(), api.miWatchlistList(),
    ]);
    const keys = ['compass', 'benchmarks', 'sources', 'rounds', 'projects', 'watchlist'];
    const next = {}; const nextErrors = {};
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') next[keys[index]] = result.value;
      else nextErrors[keys[index]] = 'Unavailable right now.';
    });
    setData(next); setErrors(nextErrors); setRefreshing(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const sources = useMemo(() => arrayOf(data?.sources, ['sources', 'items', 'data']), [data]);
  const rounds = useMemo(() => arrayOf(data?.rounds, ['rounds', 'items', 'data']), [data]);
  const projects = useMemo(() => arrayOf(data?.projects, ['projects', 'items', 'data']), [data]);
  const compass = useMemo(() => arrayOf(data?.compass, ['sectors', 'items', 'data']), [data]);
  const watchlist = useMemo(() => arrayOf(data?.watchlist, ['rows', 'watchlist', 'items', 'data']), [data]);
  const lastUpdated = data?.sources?.updated_at
    || data?.sources?.computed_at
    || data?.compass?.updated_at
    || data?.compass?.computed_at
    || data?.benchmarks?.updated_at
    || data?.benchmarks?.computed_at
    || null;
  const totalSources = sources.length;

  return <main className="investor-research-workspace" data-testid="investor-research-workspace">
    <div className="ir-layout">
      <section className="ir-main">
        <header className="ir-hero">
          <h1 data-testid="heading-investor-research">Go deep before money moves</h1>
          <p>The page opens as a question. Evidence remains attached to its source, permission, freshness, and uncertainty.</p>
          <form className="ir-question" id="research-ask" onSubmit={(event) => { event.preventDefault(); setSubmitted(true); }} data-testid="form-research-question">
            <Search size={15} aria-hidden="true" />
            <input value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="Research question" data-testid="input-research-question" />
            <button className="ir-button" type="submit" data-testid="button-submit-research-question">Find evidence</button>
          </form>
          <nav className="ir-anchors" aria-label="Research sections">
            <a href="#research-ask" data-testid="link-research-ask">Ask</a><a href="#research-evidence" data-testid="link-research-evidence">Diligence</a><a href="#research-benchmarks" data-testid="link-research-benchmarks">Benchmarking</a><a href="#research-markets" data-testid="link-research-markets">Markets</a><a href="#research-library" data-testid="link-research-library">Library</a>
          </nav>
        </header>

        {submitted && <section className="ir-card">
          <div className="ir-head"><h2>Question desk</h2><span data-testid="text-research-question-state">{question.trim() ? 'Question ready for evidence review' : 'Enter a question to orient the evidence'}</span></div>
          <div className="ir-answer unavailable" data-testid="status-research-answer-unavailable"><div className="ir-answer-top"><b className="ir-label">Sourced answer</b><small>Automated run unavailable</small></div><p>There is no scoped research-chat service on this route. Review the available source library and market records below; no answer has been generated.</p></div>
        </section>}

        <section className="ir-card" id="research-evidence">
          <div className="ir-head"><h2>Diligence pull</h2><span>{data ? `${totalSources} source records available` : 'Loading available evidence'}</span></div>
          {errors.sources ? <div className="ir-alert" data-testid="status-research-sources-error"><AlertCircle size={14} />Source library is unavailable. Other research areas may still be usable.</div> : data === null ? <Skeleton /> : <><div className="ir-seam" data-testid="panel-research-provenance"><b>Source and permission boundary</b><br />Only provenance and access fields supplied by the source service are shown. Founder-shared or private labels appear only when explicitly returned.</div>
            <div className="ir-answer" data-testid="panel-research-evidence-summary"><div className="ir-answer-top"><b className="ir-label">Evidence index</b><small>{stamp(lastUpdated)}</small></div><p>{totalSources ? `${totalSources} returned records can be inspected in the library. This workspace does not infer missing permissions, freshness, or supporting claims.` : 'No source records are currently available for a sourced answer.'}</p></div></>}
        </section>

        <section className="ir-card ir-economics" id="research-library">
          <div><div className="ir-head"><h2>Source library — reuse before re-reading</h2><span>{stamp(lastUpdated)}</span></div><p>Availability is a research property, not a promise. Returned source records retain the service state supplied by the catalog.</p>
            {errors.sources ? <div className="ir-source-empty">Source catalog unavailable.</div> : data === null ? <Skeleton /> : sources.length === 0 ? <div className="ir-source-empty">No registered source records are available.</div> : <div className="ir-source-list" data-testid="list-research-sources">{sources.map((source) => <div className="ir-source-row" key={source.key || source.display_name}><strong>{source.display_name || source.key || 'Registered source'}</strong><span className="ir-source-flags"><i className={source.live ? 'live' : ''}>{source.live ? 'Live' : 'Not live'}</i><i className={source.paid ? 'paid' : ''}>{source.paid ? 'Paid' : 'Unpaid'}</i></span><small>{stamp(source.updated_at || source.computed_at)}</small></div>)}</div>}
          </div>
          <div className="ir-ledger" data-testid="panel-research-freshness"><b>Availability ledger</b><div><span>Source records</span><strong>{data ? totalSources : 'Loading'}</strong></div><div><span>Market compass</span><strong>{errors.compass ? 'Unavailable' : data ? compass.length : 'Loading'}</strong></div><div><span>Private rounds</span><strong>{errors.rounds ? 'Unavailable' : data ? rounds.length : 'Loading'}</strong></div></div>
        </section>

        <div className="ir-lower">
          <section className="ir-mini" id="research-benchmarks"><h2>Fund &amp; manager benchmarking</h2><p>Operating benchmark fields are displayed only when the benchmark contract returns them.</p><span data-testid="text-research-benchmark-status">{errors.benchmarks ? 'Benchmark service unavailable' : data?.benchmarks ? 'Benchmark record available for review' : 'Benchmark record not available'}</span></section>
          <section className="ir-mini" id="research-markets"><h2>Market deep-dives</h2><p>Saved briefs and market records retain their source and freshness rather than becoming an inferred conviction score.</p><span data-testid="text-research-market-status">{errors.compass && errors.watchlist ? 'Market compass and saved list unavailable' : errors.compass ? `Market compass unavailable · ${watchlist.length} saved` : errors.watchlist ? `${compass.length} sector records · saved list unavailable` : data ? `${compass.length} sector records · ${watchlist.length} saved` : 'Loading sector records'}</span></section>
          <section className="ir-mini" id="research-companies"><h2>Company profiles</h2><p>Comparable context comes from the existing project and private-round services; no company identity is inferred.</p><span data-testid="text-research-company-status">{errors.projects ? 'Project context unavailable' : data ? `${projects.length} project records` : 'Loading project context'}</span></section>
        </div>
      </section>
      <aside className="ir-rail" aria-label="Worker AI Research">
        <div className="ir-rail-label">Worker AI · Research <button type="button" className="ir-refresh" onClick={() => load(true)} disabled={refreshing} aria-label="Refresh research workspace" data-testid="button-refresh-investor-research"><RefreshCw size={13} className={refreshing ? 'ir-spin' : ''} /></button></div>
        <section><h2>Manual by default</h2><p>Tables, sources, and evidence records remain useful without an automated research run.</p></section>
        <section className="ir-advisor"><h2>Advisor fills the blanks</h2><p>Guidance can point to available evidence. It does not invent a sourced answer, change a deal, or claim access to a data room.</p></section>
        <section className="ir-boundary"><h2>Permission &amp; freshness</h2><p>Use only records whose source and permission are explicit. Re-check dated evidence before relying on it in diligence.</p></section>
        <section><h2>Privacy boundary</h2><p>Private or founder-shared evidence is labeled only when the returned record provides that provenance.</p></section>
        <footer><Landmark size={12} />Research respects the access and source metadata supplied by each service.</footer>
      </aside>
    </div>
  </main>;
}