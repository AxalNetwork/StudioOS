import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowUpRight, Network } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { api } from '../../lib/api';
import { WorkerRail } from '../../ui';
import { COLD_AFTER_DAYS, daysSince, isCold, organizationOf } from '../../lib/networkBook';
import { zonePillClass } from './deskZoneNav';
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
/**
 * A6's three zones, in the chip row's order, and the one list the cards take
 * their handoffs from — so a card cannot hand off to a page the row does not
 * name (`founder_overview_subpage_links`).
 */
const SECTIONS = [
  ['Relationships', '/network/relationships'],
  ['Introductions', '/network/introductions'],
  ['Organizations', '/network/organizations'],
];
const ZONE = Object.fromEntries(SECTIONS.map(([label, to]) => [label, to]));
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
    <header className="a6-hero"><h1>Work my relationships</h1><p>Who you know, what you last said, and the introductions recorded across your network.</p>
      <nav aria-label="Network desk sections">{SECTIONS.map(([label, to]) => <NavLink data-testid={`link-network-${label.toLowerCase()}-anchor`} key={label} to={to} className={zonePillClass}>{label}</NavLink>)}</nav>
    </header>
    {error && <div className="a6-error" data-testid="status-network-partial"><AlertCircle size={15} />{error}<button data-testid="button-retry-network" type="button" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}
    <NetworkSections data={data} loading={initialLoading} state={state} />
  </div><WorkerRail
    workspace="Network"
    className="a6-rail"
    stance="Read-only coverage"
    note="This view summarizes stored relationship records. It does not draft outreach, send messages, or change records."
    coverage={[
      `${data.relationships.length} explicit partner relationship${data.relationships.length === 1 ? '' : 's'}`,
      `${data.contacts.length} authorized contact${data.contacts.length === 1 ? '' : 's'}`,
      `${data.propositions.length} introduction proposition${data.propositions.length === 1 ? '' : 's'}`,
      finite(data.summary?.relationships_count ?? data.summary?.relationship_count)
        ? `${data.summary?.relationships_count ?? data.summary?.relationship_count} relationships reported by source`
        : 'Aggregate relationship count not recorded',
    ]}
    footer="Read-only network coverage"
  /></div></main>;
}

/**
 * THE DESK HANDS OFF TO THE THREE ZONES IT SUMMARISES.
 *
 * Every card used to link to `/network?mode=workspace&tab=…`, the legacy
 * NetworkPage, while `/network/relationships`, `/network/introductions` and
 * `/network/organizations` sat one pill away. A summary that sends a reader to
 * a different page from the one it summarises is the defect
 * `founder_overview_subpage_links` exists to catch, and this desk is on its
 * list now (D421).
 *
 * GOING COLD IS THE ZONE'S OWN FLAG, from `lib/networkBook.js`: the desk and
 * `/network/relationships` read one definition of "more than 60 days since the
 * last recorded activity", so the two cannot disagree about one contact.
 */
function organizationRollup(contacts) {
  const map = new Map();
  contacts.forEach((row) => {
    const name = organizationOf(row);
    if (!name) return;
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(row);
  });
  return [...map.entries()]
    .map(([name, people]) => ({ name, people, dormant: people.every((row) => isCold(row)) }))
    .sort((a, b) => b.people.length - a.people.length || a.name.localeCompare(b.name));
}
function touchCell(value) {
  const cold = isCold({ last_activity_at: value });
  const days = daysSince(value);
  return <span className={cold ? 'is-cold' : undefined} data-testid={cold ? 'text-going-cold' : undefined}>{days === null ? 'Not recorded' : cold ? `${days} days · going cold` : date(value)}</span>;
}

function NetworkSections({ data, loading, state }) {
  const pending = data.propositions.filter((item) => text(item.status).toLowerCase() === 'pending');
  const cold = [...data.relationships.map((row) => ({ last_activity_at: row.last_activity_at || row.last_touch_at })), ...data.contacts].filter((row) => isCold(row)).length;
  const organizations = organizationRollup(data.contacts);
  return <div className="a6-sections">
    <section className="a6-card a6-relationships" id="a6-relationships"><Head title="Relationships" meta={`${countText(data.relationships.length + data.contacts.length, 'relationship')} · ${cold} going cold`} />
      {loading ? <Skeleton rows={4} /> : <><div className="a6-table a6-relation-head"><span>Person</span><span>Context</span><span>Strength</span><span>Last touch</span></div>
        {data.relationships.map((row, index) => <div className="a6-table a6-relationship-row" key={row.id || index} data-testid={`row-partner-relationship-${row.id || index}`}><strong>{text(row.other?.name) || 'Name not recorded'}<small>Partner relationship</small></strong><span>{text(row.relationship_type) || 'Not recorded'}</span><span>{finite(row.strength_score) ? String(row.strength_score) : 'Not recorded'}</span>{touchCell(row.last_activity_at || row.last_touch_at)}</div>)}
        {data.contacts.map((row, index) => <div className="a6-table a6-relationship-row" key={row.id || row.email || index} data-testid={`row-authorized-contact-${row.id || index}`}><strong>{text(row.name) || text(row.email) || 'Name not recorded'}<small>Authorized contact</small></strong><span>{text(row.audience || row.routed_to || row.source) || 'Not recorded'}</span><span>Not scored</span>{touchCell(row.last_activity_at)}</div>)}
        {!data.relationships.length && !data.contacts.length && <Empty title="No relationship records are available." body="Partner relationships and authorized contacts will appear here as separate record types." />}
        <p className="a6-note">Going cold means more than {COLD_AFTER_DAYS} days since the last recorded activity. Strength, notes and reminders are not recorded against a contact, so none is shown.</p>
        <DeskLink testid="link-open-network-relationships" to={ZONE.Relationships} state={state}>Open relationships</DeskLink></>}
    </section>
    <div className="a6-pair"><section className="a6-card" id="a6-introductions"><Head title="Introductions" meta={countText(data.propositions.length, 'proposition')} />
      {loading ? <Skeleton rows={2} /> : <Propositions rows={data.propositions} empty="No introduction propositions are recorded." />}
      <DeskLink testid="link-open-network-introductions" to={ZONE.Introductions} state={state}>Open introductions</DeskLink>
    </section><section className="a6-card" id="a6-pairings"><Head title="Who should meet whom" meta="Recorded suggestions" />
      {loading ? <Skeleton rows={2} /> : pending.length ? <Propositions rows={pending} /> : <Empty title="No pairwise suggestion is recorded." body="Available data can suggest a connection between you and a target, not between two third parties." />}
      <DeskLink testid="link-open-network-pairings" to={ZONE.Introductions} state={state}>Open introductions</DeskLink>
    </section></div>
    <section className="a6-card a6-organizations" id="a6-organizations"><Head title="Organizations" meta={`People-first lens · ${countText(organizations.length, 'organization')}`} />
      {loading ? <Skeleton rows={2} /> : organizations.length ? <div className="a6-orgs" data-testid="list-network-organizations">{organizations.slice(0, 4).map((group) => <article key={group.name}><strong>{group.name}</strong><span>{countText(group.people.length, 'person', 'people')}</span><small className={group.dormant ? 'is-cold' : undefined}>{group.dormant ? 'Everyone here is going cold' : 'Recently in touch'}</small></article>)}</div> : <Empty title="No organization is recorded on a contact." body="Organizations are grouped only from the organization a contact records; email domains are not inferred." />}
      <DeskLink testid="link-open-network-organizations" to={ZONE.Organizations} state={state}>Open organizations</DeskLink></section>
  </div>;
}

function Propositions({ rows, empty }) { return rows.length ? <div className="a6-propositions">{rows.slice(0, 3).map((row, index) => <article key={row.uid || index} data-testid={`card-intro-${row.uid || index}`}><div><strong>{text(row.target?.name) || 'Target not recorded'}</strong><span>{statusLabel(row.status)}</span></div><p>{listFrom(row.breakdown?.reasons || row, 'reasons').map(text).filter(Boolean).slice(0, 2).join(' · ') || 'Reason not recorded'}</p></article>)}</div> : <Empty title={empty} body="" />; }
function Head({ title, meta }) { return <div className="a6-head"><h2>{title}</h2><span>{meta}</span></div>; }
function Empty({ title, body }) { return <div className="a6-empty"><Network size={17} /><div><strong>{title}</strong>{body && <p>{body}</p>}</div></div>; }
function Skeleton({ rows }) { return <div className="a6-skeleton">{Array.from({ length: rows }, (_, index) => <i key={index} />)}</div>; }
function DeskLink({ to, state, testid, children }) { return <Link data-testid={testid} className="a6-link" to={to} state={state}>{children}<ArrowUpRight size={13} /></Link>; }
function countText(n, noun, plural = `${noun}s`) { return `${n} ${n === 1 ? noun : plural}`; }
