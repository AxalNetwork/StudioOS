/** D4829: Practice v2 PX-00/PX-10 cockpit over the existing, independently readable Practice stores. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, CircleCheck, Clock3 } from 'lucide-react';
import { api } from '../../../lib/api';
import PracticeSetup from './PracticeSetup.jsx';
import ClientSheet from './ClientSheet';
import SourceState from './SourceState';
import { readEveryPage } from './everyPage';
import { cockpitModel } from './practiceCockpit';
import './practiceCockpit.css';

const listRead = method => readEveryPage(async page => {
  const data = await method(page);
  if (!Array.isArray(data?.items)) throw new Error('Practice list unreadable');
  return data;
});
export function cockpitReads(client = api) {
  return {
    bookings: () => listRead(page => client.listMyAdvisorBookings(undefined, page)),
    engagements: () => listRead(page => client.listMyAdvisorEngagements(page)),
    deliverables: () => listRead(page => client.listMyAdvisorDeliverables(page)),
    ledger: async () => { const d = await client.getMyAdvisorLedger(); if (!d?.totals || !d?.states) throw new Error('Ledger unreadable'); return d; },
    availability: async () => { const d = await client.getMyAdvisorAvailability(); if (!d || typeof d !== 'object') throw new Error('Timezone unreadable'); return d; },
  };
}
export function PracticeCockpit({ sources, onRetry, now = Date.now() }) {
  const model = cockpitModel(sources, now), [client, setClient] = useState(null);
  const unread = model.sources.filter(s => s.state === 'unreadable');
  const loading = model.sources.filter(s => s.state === 'loading');
  return <div className="practice-cockpit" data-testid="practice-cockpit">
    <div className="pc-actions"><Link className="pc-button" to="/practice/sessions#booking-links">Share booking link</Link><Link className="pc-button pc-primary" to="/practice/engagements?new=1">New engagement</Link></div>
    <section className="pc-card" aria-labelledby="pc-attention"><header><h2 id="pc-attention">Needs attention</h2><span>{model.queue.length ? `${model.queue.length} recorded items` : loading.length ? 'Reading sources…' : unread.length ? 'Sources unavailable' : model.sources.some(s => s.partial) ? 'Partial view' : 'No recorded items'}{unread.length ? ` · ${unread.length} sources unreadable` : ''}</span></header>
      <ol className="pc-attention">{model.queue.map(row => <li key={row.key}><span className={`pc-mark ${['renewals','money'].includes(row.key) ? 'pc-warn' : ''}`}>{['renewals','money'].includes(row.key) ? <CircleAlert size={16} /> : <Clock3 size={16} />}</span><Link className="pc-attention-main" to={row.to}><b>{row.title}</b><span> · {row.detail}</span></Link><Link className="pc-button" to={row.to}>{row.action}</Link></li>)}</ol>
      {loading.map(s => <SourceState key={s.key} kind="loading" source={s.label} />)}
      {unread.map(s => <SourceState key={s.key} kind="unreadable" source={s.label} onRetry={() => onRetry(s.key)} />)}
      {model.sources.filter(s => s.partial).map(s => <p className="pc-muted" key={s.key}>{s.label}: {s.partial} <Link to={s.to}>Open zone</Link></p>)}
      {!model.queue.length && !loading.length && !unread.length && !model.sources.some(s => s.partial) && <p className="pc-empty"><CircleCheck size={18} /> Nothing needs attention in your recorded practice. <Link to="/practice/opportunities">Open Opportunities</Link></p>}
    </section>
    <section className="pc-card" aria-labelledby="pc-today"><header><h2 id="pc-today">Today{model.day ? ` · ${model.day}` : ''}</h2><Link to="/practice/sessions">Sessions →</Link></header>
      <ol className="pc-today">{model.today.map(row => <li key={row.key}><time>{row.time}</time><Link className="pc-client-name" to={row.to}>{row.client}</Link><span>{row.title}</span><span className="pc-state">{row.state}</span><Link className="pc-button" to={row.to}>Open</Link></li>)}</ol>
      {model.sources.filter(s => ['bookings', 'engagements', 'deliverables', 'availability'].includes(s.key) && s.state !== 'read').map(s => <SourceState key={s.key} kind={s.state === 'loading' ? 'loading' : 'unreadable'} source={s.label} onRetry={() => onRetry(s.key)} />)}
      {!model.today.length && model.timeZone && ['bookings', 'engagements', 'deliverables', 'availability'].every(k => sources[k]?.state === 'read') && <p className="pc-muted">No activity for today in the loaded records.</p>}
      <p className="pc-basis">{model.timeZone ? `Times shown in ${model.timeZone}${sources.availability?.data?.timezone ? '' : ' · timezone not recorded; using UTC'}.` : 'Practice timezone could not be read.'}</p>
    </section>
    <section aria-labelledby="pc-health"><h2 id="pc-health">Practice health</h2><div className="pc-health">{model.health.map(h => <article key={h.key} className="pc-metric"><Link to={h.to}>{h.title}</Link>{h.state === 'read' ? <><b>{h.value}</b><p>{h.basis}</p></> : <SourceState source={h.title} kind={h.state === 'loading' ? 'loading' : 'unreadable'} onRetry={() => onRetry(h.source)} />}</article>)}</div></section>
    <section aria-labelledby="pc-clients"><h2 id="pc-clients">Recent clients</h2><div className="pc-clients">{model.clients.map(c => <button type="button" className="pc-client" key={c.id} onClick={() => setClient(c)}><span className="pc-avatar" aria-hidden="true">{c.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span><span><b>{c.name}</b><small>{c.engagement}</small><small>{c.next}</small><strong>{c.relationship}</strong></span></button>)}</div>{!model.clients.length && <p className="pc-muted">{['bookings', 'engagements', 'deliverables'].some(k => sources[k]?.state !== 'read') ? 'Client sources are still loading or could not be read.' : 'No clients with linked accounts are recorded yet.'}</p>}</section>
    <details className="pc-provenance"><summary>Where these figures come from</summary><p>Requests and confirmed sessions come from bookings. Engagements use their recorded contract state. Delivery counts versions with a sent date, never completed sessions. Money is the recorded ledger, in USD, across all time; collected means marked collected. Missing prices are excluded from money totals and noted in their basis. Clients are joined by account, never by name. Partial list reads are labeled.</p><nav aria-label="Practice zones">{['opportunities', 'engagements', 'sessions', 'delivery', 'earnings'].map(zone => <Link key={zone} to={`/practice/${zone}`}>{zone[0].toUpperCase() + zone.slice(1)}</Link>)}</nav></details>
    {client && <ClientSheet clientUserId={client.id} clientName={client.name} onClose={() => setClient(null)} now={now} />}
  </div>;
}
export default function PracticeOverview() {
  const [sources, setSources] = useState({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const mounted = useRef(false), generations = useRef({});
  const load = useCallback(async key => {
    const generation = (generations.current[key] || 0) + 1; generations.current[key] = generation;
    setSources(s => ({ ...s, [key]: { state: 'loading' } }));
    try {
      const data = await cockpitReads()[key]();
      if (mounted.current && generations.current[key] === generation) setSources(s => ({ ...s, [key]: { state: 'read', data } }));
    } catch {
      if (mounted.current && generations.current[key] === generation) setSources(s => ({ ...s, [key]: { state: 'unreadable' } }));
    }
  }, []);
  useEffect(() => { mounted.current = true; Object.keys(cockpitReads()).forEach(load); return () => { mounted.current = false; }; }, [load]);
  return <PracticeSetup fallback={<PracticeCockpit sources={sources} onRetry={load} now={now} />} />;
}
