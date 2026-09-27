import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Unreadable, WorkerRail } from '../../ui';
import ZoneNav from '../../workspaces/ZoneNav';
import { bucketForPath } from '../../workspaces/shellConfig';
import './investorResearchWorkspace.css';

const arrayOf = (value, keys = []) => Array.isArray(value) ? value : keys.reduce((found, key) => found.length ? found : (Array.isArray(value?.[key]) ? value[key] : []), []);
const stamp = (value) => { if (!value) return 'Freshness not supplied'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Freshness not supplied' : `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`; };

function Skeleton() { return <div className="ir-skeleton" data-testid="research-loading-skeleton">{[0, 1, 2].map((row) => <i key={row} />)}</div>; }

export default function InvestorResearchWorkspace() {
  const [question, setQuestion] = useState('What evidence is available for this market?');
  // The desk below is the compressed IR1 question box, and it is WIRED:
  // `asked` holds what POST /research/ask returned, in the three shapes that
  // route answers (see AskAnswer). Nothing runs until the button is pressed —
  // a visit spends nothing.
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState(null);
  const [askError, setAskError] = useState('');
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

  /**
   * ASK RUNS ON THE PRESS, NEVER ON THE PAGE. The box used to set a flag and
   * show a panel claiming there is no scoped research-chat service on this
   * route. There is one — POST /research/ask, open to every signed-in user —
   * and the desk now submits to it: the same thread /research/ask shows, so
   * the answer is there to follow up on. The question joins the caller's own
   * session (the worker falls back to the most recent one), and the answer
   * comes back with its citations, or with the route's own reason for not
   * answering.
   */
  const runAsk = useCallback(async () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true); setAskError('');
    try {
      setAsked(await api.research.ask(q));
    } catch (cause) {
      setAsked(null);
      setAskError(cause?.message || 'That question could not be answered right now.');
    } finally { setAsking(false); }
  }, [question, asking]);

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
          <form className="ir-question" id="research-ask" onSubmit={(event) => { event.preventDefault(); runAsk(); }} data-testid="form-research-question">
            <Search size={15} aria-hidden="true" />
            <input value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="Research question" data-testid="input-research-question" maxLength={1000} />
            <button className="ir-button" type="submit" disabled={asking || !question.trim()} data-testid="button-submit-research-question">{asking ? 'Asking…' : 'Find evidence'}</button>
          </form>
          {/* Five real links. These were `href="#research-ask"` and four more —
              anchors onto this page, while /research/ask and its four siblings
              are registered routes nothing linked. */}
          <ZoneNav bucket={bucketForPath('investor', '/research')} role="investor" activeSlug={null} className="mt-2.5" />
        </header>

        {(asking || asked || askError) && <section className="ir-card">
          <div className="ir-head"><h2>Question desk</h2><span data-testid="text-research-question-state">{asking ? 'Asking your research library' : askError ? 'The question could not be asked' : asked?.reason === 'answered' ? 'Answered from your research library' : asked?.reason === 'no_source' ? 'No source cleared the bar' : 'No answer could be written'}</span></div>
          <AskAnswer asked={asked} error={askError} asking={asking} onRetry={runAsk} />
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
          ['General-knowledge answers', 'The question desk answers only from documents you have added to your own research library, with citations. When nothing there is close enough it says so — it does not answer from general knowledge, the web, or company databases.'],
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

/**
 * What POST /research/ask said, in the three shapes it says it.
 *
 * `no_source` has two meanings the route keeps apart on purpose — an empty
 * library and a library with nothing on this — and `indexed_documents` is how
 * the desk tells them apart. `model_unavailable` still carries the passages it
 * found, so they are listed rather than hidden. A question the library cannot
 * answer never reaches the model and is charged nothing; the charge shown is
 * the route's own receipt, never an estimate typed here.
 */
function AskAnswer({ asked, error, asking, onRetry }) {
  if (error) {
    return <Unreadable what="The answer" claim="That is a failed read, not a claim that no answer exists." onRetry={onRetry} />;
  }
  if (asking) {
    return <div className="ir-answer unavailable" data-testid="status-research-answer-asking"><div className="ir-answer-top"><b className="ir-label">Sourced answer</b><small>Reading your library</small></div><p>Your research library is being searched. An answer is written only when a passage in it clears the bar, and is cited to that passage.</p></div>;
  }
  if (!asked) return null;
  const citations = Array.isArray(asked.citations) ? asked.citations : [];
  const said = asked.reason === 'answered' ? asked.answer
    : asked.reason === 'no_source'
      ? (Number(asked.indexed_documents) === 0
        ? 'Your research library holds no indexed document yet, so there is nothing to answer from. Add a document on the Library page and it becomes answerable here.'
        : 'Nothing in your research library answers this question closely enough to cite. The desk does not answer from general knowledge.')
      : 'Relevant passages were found and are listed below, but no answer could be written from them just now. Adding documents will not help with that.';
  return <div className={asked.reason === 'answered' ? 'ir-answer' : 'ir-answer unavailable'} data-testid="card-research-answer">
    <div className="ir-answer-top"><b className="ir-label">Sourced answer</b><small>{Number.isFinite(Number(asked.cost_usd)) ? `Charged $${Number(asked.cost_usd).toFixed(4)}` : 'Charge not recorded'}</small></div>
    <p>{said}</p>
    {citations.length ? <ol>{citations.map((citation, index) => <li key={`${citation.title}-${index}`}>{citation.title || 'Untitled document'}{Number.isFinite(Number(citation.chunk)) ? ` · passage ${Number(citation.chunk) + 1}` : ''}</li>)}</ol> : null}
    <p><Link to="/research/ask" data-testid="link-research-ask-thread">Continue in Ask</Link> — the question and its answer are on your thread there.</p>
  </div>;
}