import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowUpRight, Network, PanelRight, UsersRound } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import './founderNetworkDesk.css';

export const listFrom = (value, key) => Array.isArray(value) ? value : (Array.isArray(value?.[key]) ? value[key] : []);
export const normalizeRelationships = (value) => listFrom(value, 'items');
export const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const text = (value) => String(value || '').trim();
const date = (value) => {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Not recorded'
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
};
const statusLabel = (value) => text(value).replace(/[_-]/g, ' ') || 'Not recorded';

export default function FounderNetworkDesk() {
  const location = useLocation();
  const seed = location.state?.founderNetworkSeed;
  const [records, setRecords] = useState(() => seed?.records || {});
  const [loading, setLoading] = useState(!seed);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    const sources = { contacts: api.contactsList(), relationships: api.partnerRelationships(), introductions: api.introPropositions(), summary: api.partnerSummary() };
    Promise.allSettled(Object.entries(sources).map(async ([key, request]) => [key, await request])).then((results) => {
      if (!live) return;
      const next = {}; const failed = [];
      results.forEach((result, index) => {
        const key = Object.keys(sources)[index];
        if (result.status === 'fulfilled') next[key] = result.value[1]; else failed.push(key);
      });
      if (Object.keys(next).length) setRecords((previous) => ({ ...previous, ...next }));
      if (failed.length) setError('Some relationship records are temporarily unavailable. Stored results remain visible.');
    }).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [retry]);

  const data = useMemo(() => ({
    contacts: listFrom(records.contacts, 'items'),
    relationships: normalizeRelationships(records.relationships),
    propositions: listFrom(records.introductions, 'propositions'),
    summary: records.summary || {},
  }), [records]);
  const initialLoading = loading && !Object.keys(records).length;
  const state = { founderNetworkSeed: { records } };
  return <main className="a6-network" data-testid="founder-network-desk"><div className="a6-canvas"><div className="a6-main">
    <header className="a6-hero"><span>Founder / Network</span><h1>Work my relationships</h1><p>Who you know, what you last said, and the introductions recorded across your network.</p>
      <nav aria-label="Network desk sections"><Link data-testid="link-network-relationships-anchor" to="/network/relationships">Relationships</Link><Link data-testid="link-network-introductions-anchor" to="/network/introductions">Introductions</Link><Link data-testid="link-network-organizations-anchor" to="/network/organizations">Organizations</Link></nav>
    </header>
    {error && <div className="a6-error" data-testid="status-network-partial"><AlertCircle size={15} />{error}<button data-testid="button-retry-network" type="button" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}
    <NetworkSections data={data} loading={initialLoading} state={state} />
  </div><NetworkRail data={data} /></div></main>;
}

function NetworkSections({ data, loading, state }) {
  const pending = data.propositions.filter((item) => text(item.status).toLowerCase() === 'pending');
  return <div className="a6-sections">
    <section className="a6-card a6-relationships" id="a6-relationships"><Head title="Relationships" meta={countText(data.relationships.length, 'explicit relationship')} />
      {loading ? <Skeleton rows={4} /> : <><div className="a6-table a6-relation-head"><span>Person</span><span>Context</span><span>Strength</span><span>Last touch</span></div>
        {data.relationships.map((row, index) => <div className="a6-table a6-relationship-row" key={row.id || index} data-testid={`row-partner-relationship-${row.id || index}`}><strong>{text(row.other?.name) || 'Name not recorded'}<small>Partner relationship</small></strong><span>{text(row.relationship_type) || 'Not recorded'}</span><span>{finite(row.strength_score) ? String(row.strength_score) : 'Not recorded'}</span><span>{text(row.last_activity_at || row.last_touch_at) || 'Not recorded'}</span></div>)}
        {data.contacts.map((row, index) => <div className="a6-table a6-relationship-row" key={row.id || row.email || index} data-testid={`row-authorized-contact-${row.id || index}`}><strong>{text(row.name) || text(row.email) || 'Name not recorded'}<small>Authorized contact</small></strong><span>{text(row.audience || row.routed_to || row.source) || 'Not recorded'}</span><span>Not scored</span><span>{date(row.last_activity_at)}</span></div>)}
        {!data.relationships.length && !data.contacts.length && <Empty title="No relationship records are available." body="Partner relationships and authorized contacts will appear here as separate record types." />}
        <DeskLink testid="link-open-network-relationships" to="/network?mode=workspace&tab=relationships" state={state}>Open relationships</DeskLink></>}
    </section>
    <div className="a6-pair"><section className="a6-card" id="a6-introductions"><Head title="Introductions" meta={countText(data.propositions.length, 'proposition')} />
      {loading ? <Skeleton rows={2} /> : <Propositions rows={data.propositions} empty="No introduction propositions are recorded." />}
      <DeskLink testid="link-open-network-introductions" to="/network?mode=workspace&tab=introductions" state={state}>Open introductions</DeskLink>
    </section><section className="a6-card" id="a6-pairings"><Head title="Who should meet whom" meta="Recorded suggestions" />
      {loading ? <Skeleton rows={2} /> : pending.length ? <Propositions rows={pending} /> : <Empty title="No pairwise recommendations recorded." body="Available data can suggest a connection between you and a target, not between two third parties." />}
      <DeskLink testid="link-open-network-contacts" to="/network?mode=workspace&tab=contacts" state={state}>Open contacts</DeskLink>
    </section></div>
    <section className="a6-card a6-organizations" id="a6-organizations"><Head title="Organizations" meta="People-first lens" /><Empty title="Not recorded" body="Organizations remain a lens over people. No relationship-backed organization rollup is available, and email domains are not inferred." /></section>
  </div>;
}

function Propositions({ rows, empty }) { return rows.length ? <div className="a6-propositions">{rows.slice(0, 3).map((row, index) => <article key={row.uid || index} data-testid={`card-intro-${row.uid || index}`}><div><strong>{text(row.target?.name) || 'Target not recorded'}</strong><span>{statusLabel(row.status)}</span></div><p>{listFrom(row.breakdown?.reasons || row, 'reasons').map(text).filter(Boolean).slice(0, 2).join(' · ') || 'Reason not recorded'}</p></article>)}</div> : <Empty title={empty} body="" />; }
function Head({ title, meta }) { return <div className="a6-head"><h2>{title}</h2><span>{meta}</span></div>; }
function Empty({ title, body }) { return <div className="a6-empty"><Network size={17} /><div><strong>{title}</strong>{body && <p>{body}</p>}</div></div>; }
function Skeleton({ rows }) { return <div className="a6-skeleton">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>; }
function DeskLink({ to, state, testid, children }) { return <Link data-testid={testid} className="a6-link" to={to} state={state}>{children}<ArrowUpRight size={13} /></Link>; }
function countText(n, noun) { return `${n} ${noun}${n === 1 ? '' : 's'}`; }
function NetworkRail({ data }) { const counts = [data.relationships.length, data.contacts.length, data.propositions.length]; const sourceCount = data.summary?.relationships_count ?? data.summary?.relationship_count; return <aside className="a6-rail"><div className="a6-rail-title"><span>Worker AI · Network</span><PanelRight size={14} /></div><div><b>Read-only coverage</b><p>This view summarizes stored relationship records. It does not draft outreach, send messages, or change records.</p></div><div><span>Recorded sources</span><strong>{counts[0]} explicit partner relationships</strong><strong>{counts[1]} authorized contacts</strong><strong>{counts[2]} introduction propositions</strong></div><div><span>Summary</span><p>{finite(sourceCount) ? `${sourceCount} relationships reported by source.` : 'Aggregate relationship count not recorded.'}</p></div><footer><UsersRound size={13} /> Read-only network coverage</footer></aside>; }