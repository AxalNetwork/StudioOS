import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Clock3, FileText, LockKeyhole, RefreshCw, ShieldCheck, Sparkles, Waves } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderRaiseCapital.css';
import './founderRaiseLiquidity.css';
import ZoneToolbar from '../../workspaces/ZoneToolbar';
import { founderZoneActions } from '../../workspaces/founderZoneActions';
import { founderZoneFilters } from '../../workspaces/founderZoneFilters';

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const text = (value, fallback = 'Not recorded') => String(value ?? '').trim() || fallback;
const money = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Not recorded';
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (Math.abs(amount) >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
};
const pct = (value) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : 'Not recorded';

export default function FounderRaiseLiquidity() {
  const [params, setParams] = useSearchParams();
  const requestedId = params.get('project_id');
  const [project, setProject] = useState(null);
  const [scenario, setScenario] = useState(null);
  // `GET /liquidity/my-portfolio` is `requireAuth` ONLY, so a founder may call it,
  // and it returns `my_listings` and `exit_history` — the two sources this page
  // used to say were "not connected". Its failure is kept SEPARATE from the cap
  // table's: one source being down must not blank the other's view.
  const [portfolio, setPortfolio] = useState(null);
  const [portfolioError, setPortfolioError] = useState('');
  const [view, setView] = useState('waterfall');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setError('');
    try {
      const available = list(await api.listProjects(), 'items', 'projects');
      const selected = available.find((item) => String(item.id) === requestedId) || available[0] || null;
      setProject(selected);
      if (!selected) { setScenario(null); return; }
      if (String(selected.id) !== requestedId) {
        setParams((old) => { const next = new URLSearchParams(old); next.set('project_id', String(selected.id)); return next; }, { replace: true });
      }
      try {
        const response = await api.getCapTableByProject(selected.id);
        setScenario(response?.scenario || null);
      } catch (cause) {
        setScenario(null);
        setError(cause?.message || 'The capital ledger is unavailable.');
      }
      try {
        setPortfolio(await api.liquidityMyPortfolio());
        setPortfolioError('');
      } catch (cause) {
        setPortfolio(null);
        setPortfolioError(cause?.message || 'The liquidity ledger is unavailable.');
      }
    } catch (cause) {
      setProject(null); setScenario(null); setPortfolio(null); setError(cause?.message || 'The project source is unavailable.');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [requestedId]);

  const result = scenario?.result || null;
  const rounds = list(result?.rounds);
  const finalLedger = rounds.at(-1)?.ledger || result?.founding || [];
  const waterfall = result?.waterfall;
  const preferenceOverhang = useMemo(() => rounds.reduce((sum, round) => {
    const meta = round?.round_meta || {};
    return sum + Number(meta.investment || 0) + Object.values(meta.safe_preferences || {}).reduce((inner, value) => inner + Number(value || 0), 0);
  }, 0), [rounds]);
  const query = project?.id ? `?project_id=${project.id}` : '';

  return <main className="fr-capital fr-liquidity" data-testid="founder-raise-liquidity"><div className="fr-capital-shell"><section className="fr-capital-main">
    <header className="fr-capital-header"><div className="fr-capital-crumb"><Link to={`/raise/status${query}`}><ArrowLeft size={13} /> Raise</Link><span>/</span><strong>Liquidity</strong></div><div className="fr-capital-title-row"><div><h1>Liquidity &amp; exits</h1><p className="fr-capital-subtitle">Secondaries, ROFR, tender state and the exit waterfall.</p></div></div><nav className="fr-capital-zone-nav" aria-label="Raise sections"><Link to={`/raise/status${query}`}>Status</Link><Link to={`/raise/pitch${query}`}>Pitch</Link><Link to={`/raise/capital${query}`}>Capital</Link><Link to={`/raise/legal${query}`}>Legal</Link><Link to={`/raise/data-room${query}`}>Data room</Link><Link to={`/raise/liquidity${query}`} className="is-active">Liquidity</Link></nav>
    <ZoneToolbar
              filters={founderZoneFilters('raise/liquidity', { value: view, onChange: setView })}
              actions={founderZoneActions('raise/liquidity', { query, view: { scope: project?.name, header: ['Holder', 'Type', 'Ownership %', 'Preference', 'Payout', 'Source'], rows: waterfall?.rows || [], cells: (r) => [r.holder, r.type, r.pct, r.preference, r.payout, r.source] } })}
            /></header>
    {error && <div className="fr-capital-alert" role="alert"><AlertCircle size={16} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {loading ? <div className="fr-capital-loading"><i /><i /><div><i /><i /><i /></div></div> : !project ? <EmptyState /> : <LiquidityContent project={project} result={result} scenario={scenario} rounds={rounds} finalLedger={finalLedger} waterfall={waterfall} preferenceOverhang={preferenceOverhang} view={view} setView={setView} error={error} portfolio={portfolio} portfolioError={portfolioError} />}
  </section><PageRail project={project} result={result} error={error} /></div></main>;
}

function LiquidityContent({ project, result, scenario, rounds, finalLedger, waterfall, preferenceOverhang, view, setView, error, portfolio, portfolioError }) {
  // EVERY ONE OF THESE WAS THE STRING 'Unavailable'. All three are answerable
  // from `my-portfolio`, which this page can call and never did.
  const listings = list(portfolio?.my_listings);
  const history = list(portfolio?.exit_history);
  // "Open" is the listing's own word: `secondary_listings.status` is
  // open | matched | sold | cancelled, and only the first is still live.
  const openEvents = portfolioError ? 'Unavailable' : listings.filter((l) => String(l.status || '').toLowerCase() === 'open').length;
  // A restriction here is a ROFR notice served on the company for one listing.
  // Counting LISTINGS rather than notices would count a holder twice for one sale.
  const restricted = listings.filter((l) => l.rofr && (l.rofr.notice_date || l.rofr.window_days));
  const restrictions = portfolioError ? 'Unavailable' : restricted.length;
  // The window is a CONTRACT TERM stored per notice, not a platform default — the
  // table's own comment says 30 days is common but "a term of the specific
  // agreement". So it is reported only when every notice agrees, and named as a
  // range when they do not, rather than averaged into a number nobody agreed to.
  const windows = [...new Set(restricted.map((l) => Number(l.rofr?.window_days)).filter((n) => Number.isFinite(n) && n > 0))];
  const rofr = portfolioError ? 'Unavailable'
    : windows.length === 0 ? 'None served'
      : windows.length === 1 ? `${windows[0]} days`
        : `${Math.min(...windows)}–${Math.max(...windows)} days`;
  return <div className="fr-capital-content"><div className="fr-capital-context"><div><span className="fr-capital-label">Selected startup</span><strong data-testid="text-liquidity-project">{text(project.name)}</strong><span>{text(project.sector, 'Sector not recorded')}</span></div><div className="fr-capital-context-right"><span className="fr-capital-label">Ledger source</span><strong>{result ? text(scenario?.name, 'Canonical cap table') : 'Capital ledger unavailable'}</strong><span>{result ? 'Project-scoped cap-table result' : 'No waterfall values inferred'}</span></div></div>
    <div className="fr-capital-stat-strip"><Stat label="Open events" value={openEvents} note={portfolioError ? 'Liquidity ledger unavailable' : `${listings.length} listing${listings.length === 1 ? '' : 's'} on record`} muted={portfolioError || !listings.length} /><Stat label="Transfer restrictions" value={restrictions} note={portfolioError ? 'Liquidity ledger unavailable' : restricted.length ? 'ROFR notices served on the company' : 'No notice served'} muted={portfolioError || !restricted.length} /><Stat label="ROFR window" value={rofr} note={portfolioError ? 'Liquidity ledger unavailable' : 'Stored per notice, never assumed'} muted={portfolioError || !windows.length} /><Stat label="Preference overhang" value={result && preferenceOverhang ? money(preferenceOverhang) : 'Unavailable'} note={result && preferenceOverhang ? 'Derived from stored SAFE and round investments' : 'No preference source returned'} muted={!result || !preferenceOverhang} /></div>
    <section className="fr-capital-card fr-capital-ledger"><div className="fr-capital-card-head"><div><Waves size={16} /><h2>{view === 'waterfall' ? 'Exit waterfall' : view === 'history' ? 'Liquidity history' : view === 'tender' ? 'Tender state' : 'Transfer restrictions'}</h2></div><span>{view === 'waterfall' ? 'Derived from the capital ledger' : 'Read-only source view'}</span></div>{/* THE IN-BODY FILTER ROW IS GONE. It repeated the zone header's chips with four
    HARDCODED labels, so it drew `Tender` as selectable while the registry refused
    it, and would have kept drawing the old four after this change. One filter row,
    owned by the registry — the doubled chrome #37 and #40 removed elsewhere. */}
{/* AND THE ONE BUTTON BESIDE THE LABEL IS GONE TOO (#177, swept with #181).
    It was an "Open workspace" link to `/liquidity` — a surface already carried
    by the sidebar ("Liquidity & Exits") and by the Raise workspace tab row, so
    the body was a third handle on it and the only one that read as an action of
    this zone. The user's words on the identical control in Grow · Brand were
    "Open workspace has nothing to do there". The "Read-only ledger" label stays:
    it states what this view is, which is the opposite of deflecting from it. */}
<div className="fr-capital-toolbar"><div className="fr-capital-actions"><span><ShieldCheck size={13} /> Read-only ledger</span></div></div>{view === 'waterfall' ? <Waterfall waterfall={waterfall} rounds={rounds} finalLedger={finalLedger} error={error} /> : view === 'restrictions' ? <Restrictions listings={listings} error={portfolioError} /> : view === 'history' ? <History events={history} error={portfolioError} /> : <TenderUnavailable />}</section>
    <div className="fr-capital-lower-grid"><section className="fr-capital-card"><div className="fr-capital-card-head"><div><LockKeyhole size={16} /><h2>Restriction coverage</h2></div><span>{portfolioError ? 'Source unavailable' : `${restricted.length} notice${restricted.length === 1 ? '' : 's'}`}</span></div>
      {/* TWO OF THESE FOUR ARE NOW ANSWERABLE AND TWO ARE STILL NOT, which is why
          they no longer share one sentence. `secondary_rofr_notices` carries
          `company_elected` and `investors_elected` as share counts; board approval
          and lockup live in a Bylaws or SAFE clause and nothing parses those. */}
      <Coverage label="Company ROFR" value={portfolioError ? 'Unavailable' : restricted.length ? `${restricted.reduce((n, l) => n + Number(l.rofr?.company_elected || 0), 0).toLocaleString()} shares elected` : 'No notice served'} />
      <Coverage label="Investor ROFR" value={portfolioError ? 'Unavailable' : restricted.length ? `${restricted.reduce((n, l) => n + Number(l.rofr?.investors_elected || 0), 0).toLocaleString()} shares elected` : 'No notice served'} />
      <Coverage label="Board approval" value="No source" />
      <Coverage label="Lockup" value="No source" />
      <p className="fr-capital-note">ROFR elections come from the notice served on each listing. Board approval and lockup are clauses in the Bylaws or the SAFE, and nothing here reads those documents — so they are marked as having no source rather than as not recorded.</p></section><section className="fr-capital-card"><div className="fr-capital-card-head"><div><FileText size={16} /><h2>Capital basis</h2></div><span>{result ? 'Stored result' : 'Unavailable'}</span></div><Coverage label="Completed rounds" value={result ? rounds.length : 'Unavailable'} /><Coverage label="Ledger holders" value={result ? finalLedger.length : 'Unavailable'} /><Coverage label="Shares outstanding" value={result?.totals?.shares_outstanding ? Number(result.totals.shares_outstanding).toLocaleString() : 'Not recorded'} /><p className="fr-capital-note">{result ? 'Waterfall values are only shown when the stored scenario includes one.' : 'No cap-table result was returned for this startup.'}</p></section></div>
    <section className="fr-capital-card fr-capital-waterfall"><div className="fr-capital-card-head"><div><Sparkles size={16} /><h2>Read-only assumptions</h2></div><span>Source-derived</span></div><div className="fr-capital-unavailable"><Sparkles size={17} /><div><strong>{result ? 'No restriction summary is generated here.' : 'No capital ledger is available.'}</strong><p>This collection does not save a restriction summary, create a tender, or mutate ROFR state. Modelling an exit is the zone header&rsquo;s <b>Model an exit</b> action, which opens the capital model.</p></div></div></section>
  </div>;
}
function Waterfall({ waterfall, rounds, finalLedger, error }) {
  if (!waterfall) return <div className="fr-capital-inline-empty"><Waves size={18} /><div><strong>{error ? 'Exit waterfall source unavailable.' : 'No exit waterfall is recorded.'}</strong><p>{rounds.length ? 'The stored cap-table result has no exit value, so no payout values are inferred.' : 'A stored cap-table result is required before an exit waterfall can be shown.'}</p></div></div>;
  return <div className="fr-capital-table-wrap"><table className="fr-room-matrix"><thead><tr><th>Holder</th><th>Type</th><th>Ownership</th><th>Preference</th><th>Payout</th><th>Source</th></tr></thead><tbody>{list(waterfall.rows).map((row, index) => <tr key={`${row.holder}-${index}`}><td><strong>{text(row.holder, 'Holder not recorded')}</strong></td><td>{text(row.type)}</td><td>{pct(row.pct)}</td><td>{money(row.preference)}</td><td>{money(row.payout)}</td><td>{text(row.source)}</td></tr>)}</tbody><tfoot><tr><td colSpan="3"><strong>Exit {money(waterfall.exit_value)}</strong></td><td>{money(waterfall.totals?.preference_paid)}</td><td>{money(waterfall.totals?.total_distributed)}</td><td>Recorded result</td></tr></tfoot></table><p className="fr-capital-note">{list(waterfall.assumptions).join(' ') || 'Assumptions not recorded.'}</p></div>;
}
/**
 * The holder-side listings and whether each is clear to transfer.
 *
 * `rofr` is whatever `my-portfolio` attached to the listing. A listing with no
 * notice served is NOT clear — `secondary_rofr_notices`'s own comment says a NULL
 * `notice_date` "reads as 'not_started' and therefore NOT clear to transfer" — so
 * the absence of a notice is reported as an unanswered question rather than as a
 * green light.
 */
function Restrictions({ listings, error }) {
  if (error) return <div className="fr-capital-inline-empty" data-testid="restrictions-error"><Clock3 size={18} /><div><strong>The liquidity ledger is unavailable.</strong><p>No restriction state is inferred from the capital ledger in its place.</p></div></div>;
  if (!listings.length) return <div className="fr-capital-inline-empty" data-testid="restrictions-empty"><LockKeyhole size={18} /><div><strong>No secondary listing is on record.</strong><p>Transfer restrictions are recorded against a listing, so there is nothing to be restricted yet.</p></div></div>;
  return <div className="fr-capital-table-wrap"><table className="fr-room-matrix" data-testid="table-restrictions"><thead><tr><th>Listing</th><th>Shares</th><th>Status</th><th>Notice served</th><th>Window</th><th>Clear to transfer</th></tr></thead><tbody>{listings.map((l) => {
    const notice = l.rofr || {};
    const served = text(notice.notice_date, '');
    const waived = Number(notice.waived || 0) === 1;
    return <tr key={l.id} data-testid={`row-restriction-${l.id}`}>
      <td><strong>{text(l.notes, `Listing #${l.id}`)}</strong><small>{text(l.created_at, 'Created date not recorded')}</small></td>
      <td>{Number.isFinite(Number(l.shares)) ? Number(l.shares).toLocaleString() : 'Not recorded'}</td>
      <td>{text(l.status)}</td>
      <td>{served || 'Not served'}</td>
      <td>{Number.isFinite(Number(notice.window_days)) && Number(notice.window_days) > 0 ? `${notice.window_days} days` : 'Not recorded'}</td>
      <td>{waived ? 'Waived' : served ? 'Window running' : 'Not yet — no notice served'}</td>
    </tr>;
  })}</tbody></table><p className="fr-capital-note">A window is the term stored on that notice, never a platform default. A listing with no notice served is not clear to transfer; it is unasked.</p></div>;
}

/** Liquidity events touching this holder's listings, newest first. */
function History({ events, error }) {
  if (error) return <div className="fr-capital-inline-empty" data-testid="history-error"><Clock3 size={18} /><div><strong>The liquidity ledger is unavailable.</strong><p>No past event is reconstructed from the capital ledger in its place.</p></div></div>;
  if (!events.length) return <div className="fr-capital-inline-empty" data-testid="history-empty"><Clock3 size={18} /><div><strong>No liquidity event has touched this holding.</strong><p>Events appear here once a listing is matched or executed. Nothing is inferred from the cap table&apos;s rounds.</p></div></div>;
  return <div className="fr-capital-table-wrap"><table className="fr-room-matrix" data-testid="table-history"><thead><tr><th>Event</th><th>Status</th><th>Shares</th><th>Valuation</th><th>Executed</th></tr></thead><tbody>{events.map((e) => <tr key={e.id} data-testid={`row-history-${e.id}`}>
    <td><strong>{text(e.event_type).replace(/_/g, ' ')}</strong><small>{text(e.created_at, 'Created date not recorded')}</small></td>
    <td>{text(e.status)}</td>
    <td>{Number.isFinite(Number(e.shares_offered)) ? Number(e.shares_offered).toLocaleString() : 'Not recorded'}</td>
    {/* `_cents` on the wire, and it says so rather than dividing silently. */}
    <td>{Number.isFinite(Number(e.valuation_cents)) && Number(e.valuation_cents) > 0 ? money(Number(e.valuation_cents) / 100) : 'Not recorded'}</td>
    <td>{text(e.executed_at, 'Not executed')}</td>
  </tr>)}</tbody></table><p className="fr-capital-note">Events are those touching a listing on this holding. Valuations are stored in cents and shown converted.</p></div>;
}

/** The one of the three that genuinely has nothing behind it. */
function TenderUnavailable() {
  return <div className="fr-capital-inline-empty" data-testid="tender-unavailable"><Clock3 size={18} /><div>
    <strong>No tender offer is recorded, and none can be.</strong>
    <p>A tender is the company offering to buy shares back. What is stored is the other side of the table — `secondary_listings` is one holder offering to sell. Calling a seller&apos;s listing a tender would misname who is doing the buying, so this view stays empty until an offer made by the company is recorded somewhere.</p>
  </div></div>;
}
function Stat({ label, value, note, muted }) { return <div className={`fr-capital-stat ${muted ? 'is-muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function Coverage({ label, value }) { return <div className="fr-capital-coverage-row"><span>{label}</span><strong>{value}</strong></div>; }
function PageRail({ project, result, error }) {
  return <WorkerRail
    workspace="Raise"
    className="fr-capital-rail"
    stance="Inherited from Raise"
    note="This page reads the selected project and its stored capital result. It does not model an exit or propose legal terms."
    coverage={[project ? (result ? 'Capital ledger connected' : 'Capital ledger unavailable') : 'No project selected']}
    coverageNote={error ? 'Some project-scoped sources could not be read.' : result ? 'Preference exposure and any stored waterfall are visible.' : 'No payout values are inferred.'}
    unavailable={[
      // Corrected with the store. The old pair implied nothing about restrictions
      // was readable; ROFR notices are, and are now on the page. What is still
      // absent is the CLAUSE-level reading — board approval and lockup sit in
      // documents nothing here parses.
      ['Clause-level restrictions', 'Board approval and lockup are Bylaws or SAFE clauses, and no document is parsed for them.'],
      ['Exit model', 'No scenario input or AI proposal is accepted from this read-only collection.'],
    ]}
    footer="Read-only ledger · source records only"
  />;
}
function EmptyState() { return <div className="fr-capital-empty"><Waves size={24} /><h2>No startup is available</h2><p>This liquidity collection is scoped to authenticated startup records.</p><Link to="/raise/status">Back to raise</Link></div>; }