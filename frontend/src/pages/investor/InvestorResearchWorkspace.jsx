import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
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
          {/* Five real links. These were `href="#research-ask"` and four more —
              anchors onto this page, while /research/ask and its four siblings
              are registered routes nothing linked. */}
          <ZoneNav bucket={bucketForPath('investor', '/research')} role="investor" activeSlug={null} className="mt-2.5" />
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
      <WorkerRail
        workspace="Research"
        role="investor"
        className="ir-rail"
        stance="Manual by default"
        note="Tables, sources and evidence records remain useful without an automated research run. Nothing here invents a sourced answer, changes a deal, or claims access to a data room."
        coverage={[
          errors.sources ? 'Source library unavailable'
            : data ? `${totalSources} source record${totalSources === 1 ? '' : 's'} readable` : 'Reading the source library',
        ]}
        coverageNote="Use only records whose source and permission are explicit. Re-check dated evidence before relying on it in diligence."
        unavailable={[
          ['Sourced answers', 'There is no scoped research-chat service on this route. The question desk states that rather than answering from general knowledge.'],
          ['Inferred provenance', 'Private or founder-shared evidence is labelled only when the returned record supplies that provenance.'],
        ]}
        action={(
          <button type="button" onClick={() => load(true)} disabled={refreshing} data-testid="button-refresh-investor-research">
            <RefreshCw size={13} className={refreshing ? 'ir-spin' : ''} /> Refresh evidence
          </button>
        )}
      />
    </div>
  </main>;
}