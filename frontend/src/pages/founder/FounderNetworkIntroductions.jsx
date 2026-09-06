import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ChevronRight, RefreshCw, UsersRound } from 'lucide-react';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import './founderNetworkRelationships.css';
import './founderNetworkIntroductions.css';
import ZoneActions from '../../workspaces/ZoneActions';
import { founderZoneActions } from '../../workspaces/founderZoneActions';

const list = (value, ...keys) => {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
};
const text = (value, fallback = 'Not recorded') => String(value ?? '').trim() || fallback;
const pretty = (value) => text(value).replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const direction = (row) => String(row.direction || '').toLowerCase() === 'incoming' ? 'Asked' : 'Offered';
const isStalled = (row) => String(row.status || '').toLowerCase() === 'expired';
const isLanded = (row) => ['accepted', 'connected'].includes(String(row.status || '').toLowerCase());
// `/introductions/propositions` names the other side `target`; the older
// shapes named it counterpart/initiator/recipient. Read all of them so the
// name renders instead of falling through to 'Counterpart not recorded'.
const counterpart = (row) => row.counterpart
  || (row.direction === 'incoming' ? row.initiator : row.recipient)
  || row.target
  || {};
const introductionLabel = (row) => {
  const name = text(counterpart(row).name, 'Counterpart not recorded');
  return direction(row) === 'Asked' ? `${name} → you` : `you → ${name}`;
};
const outcome = (row) => {
  const status = String(row.status || '').toLowerCase();
  if (status === 'connected') return 'Both sides connected. No downstream outcome is recorded.';
  if (status === 'accepted') return 'Acceptance recorded; connection is not yet recorded.';
  if (status === 'declined') return 'Declined. No downstream outcome is recorded.';
  if (status === 'expired') return 'Expired without an accepted connection.';
  if (['pending', 'invited', 'viewed'].includes(status)) return 'In motion. No downstream outcome is recorded.';
  return 'No downstream outcome is recorded.';
};
const stateLabel = (row) => {
  const status = String(row.status || '').toLowerCase();
  if (status === 'connected') return 'Connected';
  if (status === 'expired') return 'Stalled';
  if (['pending', 'invited', 'viewed'].includes(status)) return 'In motion';
  return pretty(status, 'Not recorded');
};

export default function FounderNetworkIntroductions({ embedded = false }) {
  const [params] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const load = async () => {
    setStatus('loading'); setError('');
    try {
      const result = await api.networkIntroductionsList();
      setRows(list(result, 'propositions', 'items', 'introductions'));
      setStatus('ready');
    } catch (cause) {
      setRows([]);
      setError(cause?.message || 'The introductions ledger could not be loaded.');
      setStatus('error');
    }
  };
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => rows.filter((row) => {
    if (filter === 'asked') return direction(row) === 'Asked';
    if (filter === 'offered') return direction(row) === 'Offered';
    if (filter === 'stalled') return isStalled(row);
    return true;
  }), [rows, filter]);
  const landed = rows.filter(isLanded).length;
  const given = rows.filter((row) => direction(row) === 'Offered').length;
  const received = rows.filter((row) => direction(row) === 'Asked').length;
  const stalled = rows.filter(isStalled).length;
  const projectId = params.get('project_id');
  const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  const workspace = `/network?mode=workspace&tab=introductions${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ''}`;

  return <main className={`fn-rel fn-intro${embedded ? ' is-embedded' : ''}`} data-testid="founder-network-introductions"><div className="fn-rel-shell"><section className="fn-rel-main">
    {!embedded && <header className="fn-rel-header"><div className="fn-rel-crumb"><Link to={`/network${query}`}><ArrowLeft size={13} /> Network</Link><span>‹</span><strong>Introductions</strong></div><div className="fn-rel-title-row"><div><h1>Introductions</h1><p>Asks and offers ledger with privacy-filtered counterpart and state records.</p></div></div><nav aria-label="Network sections"><Link to={`/network/relationships${query}`}>Relationships</Link><Link className="is-active" to={`/network/introductions${query}`}>Introductions</Link><Link to={`/network/organizations${query}`}>Organizations</Link></nav></header>}
    {/* Outside the header on purpose. These three zones only ever render
        through NetworkWorkspace, which passes `embedded` and draws the crumb,
        heading and zone nav itself — so everything inside that guard is dead
        on the route a founder actually opens. The actions row placed in there
        rendered nowhere, which a source test cannot see and a browser found.

        `scope: null` because this page never resolves a project RECORD — it
        has the id from the URL and nothing else — so the export filename
        carries the zone and the row count without a venture name. Naming a
        variable that does not exist here is not a build error in a module;
        it is a ReferenceError that blanks the whole page at render. */}
    <ZoneActions className="mt-3" items={founderZoneActions('network/introductions', { query, view: { scope: null, header: ['Introduction', 'Counterpart company', 'Counterpart role', 'Direction', 'State'], rows: visible, cells: (r) => [introductionLabel(r), counterpart(r).company, counterpart(r).role, direction(r), stateLabel(r)] } })} />
    {status === 'error' && <div className="fn-rel-alert" data-testid="status-network-introductions-error"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={load}><RefreshCw size={13} /> Retry</button></div>}
    {status === 'loading' && <IntroductionSkeleton />}
    {status === 'ready' && <><div className="fn-intro-context"><div><span>Ledger scope</span><strong>Introductions where you are a participant</strong><small>Contact details remain privacy-filtered until connected</small></div><div><span>Source</span><strong>Secure introductions</strong><small>Direction and state are stored on each record</small></div></div>
      <div className="fn-rel-tabs"><div><button className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>All</button><button className={filter === 'asked' ? 'is-active' : ''} onClick={() => setFilter('asked')}>Asked</button><button className={filter === 'offered' ? 'is-active' : ''} onClick={() => setFilter('offered')}>Offered</button><button className={filter === 'stalled' ? 'is-active' : ''} onClick={() => setFilter('stalled')}>Stalled</button></div><Link data-testid="link-open-network-introductions-workspace" to={workspace}>Open introductions <ChevronRight size={13} /></Link></div>
      <div className="fn-rel-stats"><Stat label="Tracked" value={rows.length} note="Both stored directions" /><Stat label="Landed" value={landed} note="Accepted or connected" /><Stat label="Given / received" value={`${given} / ${received}`} note={given > received ? 'More offered than asked' : given < received ? 'More asked than offered' : 'Directions are even'} /><Stat label="Stalled" value={stalled} note="Explicitly expired records" /></div>
      <section className="fn-rel-card"><div className="fn-rel-card-head"><div><UsersRound size={16} /><h2>Introduction ledger</h2></div><span>Direction and state are stored · outcome is not inferred</span></div><IntroductionTable rows={visible} filter={filter} /><p className="fn-rel-note">“Asked” and “Offered” are viewer-relative directions returned by the secure ledger. Only explicitly expired records are counted as stalled; pending age is not treated as proof that an introduction died.</p></section>
      <section className="fn-rel-card fn-rel-unavailable"><div className="fn-rel-card-head"><div><AlertCircle size={16} /><h2>Introduction context</h2></div><span>Partially unavailable</span></div><strong>Connector and downstream outcomes are not recorded.</strong><p>The source proves who participated, direction, acceptance state, and connection state. It does not identify who carried the introduction or whether a call, hire, referral, or other real-world outcome followed.</p></section>
    </>}
  </section>{!embedded && <IntroductionRail rows={rows} landed={landed} stalled={stalled} error={error} />}</div></main>;
}

function IntroductionTable({ rows, filter }) {
  if (!rows.length) return <div className="fn-rel-empty"><UsersRound size={18} /><div><strong>{filter === 'all' ? 'No introduction records are available.' : `No ${filter} introductions are recorded.`}</strong><p>This filter contains no stored ledger entries.</p></div></div>;
  return <div className="fn-rel-table-wrap"><table><thead><tr><th>Introduction</th><th>Direction</th><th>State</th><th>Via</th><th>Outcome</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || row.uid || index} data-testid={`row-network-introduction-${row.id || index}`}><td><strong>{introductionLabel(row)}</strong><small>{text(counterpart(row).company, text(counterpart(row).role, 'Counterpart context not recorded'))}</small></td><td>{direction(row)}</td><td><span className={`intro-${String(row.status || 'unknown').toLowerCase()}`}>{stateLabel(row)}</span></td><td>Not recorded</td><td className="fn-intro-outcome">{outcome(row)}</td></tr>)}</tbody></table></div>;
}
function Stat({ label, value, note }) { return <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function IntroductionRail({ rows, landed, stalled, error }) {
  return <WorkerRail
    workspace="Network"
    className="fn-rel-rail"
    stance="Read-only introduction ledger"
    note="This view does not request, offer, accept, decline, message, export, or draft introductions."
    coverage={[error ? 'Source unavailable' : `${rows.length} tracked introduction${rows.length === 1 ? '' : 's'}`]}
    coverageNote={error ? 'The secure introductions source could not be read.' : `${landed} accepted or connected · ${stalled} explicitly stalled.`}
    unavailable={[['Double-opt-in draft', 'No AI writing or send action is enabled.'], ['Downstream outcome', 'The ledger does not record calls, hires, or referrals.']]}
    footer="Read-only summary · no automated actions"
  />;
}
function IntroductionSkeleton() { return <div className="fn-rel-loading"><i /><i /><div><i /><i /><i /><i /></div></div>; }