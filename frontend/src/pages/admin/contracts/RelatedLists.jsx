import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { ReadState, useRead, Recorded, button, input, card, date, Pagination } from './parts';
import SettlementsDesk from './SettlementsDesk';

export default function RelatedLists({ kind, onOpen, superAdmin = false }) {
  const nda = kind === 'ndas';
  const [settling, setSettling] = useState(null); // D713: the deal whose settlements are open
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const read = useRead(() => nda ? api.adminListPairwiseNdas({ q, status, intermediary: filter, offset, limit: 25 }) : api.adminListPartnerDeals({ q, status, deal_type: filter, offset, limit: 25 }), [nda, q, status, filter, offset]);
  const change = (setter, value) => { setter(value); setOffset(0); };
  return <section className={card}><div className="flex flex-wrap gap-2 p-3"><label className="flex-1">Search<input className={input} value={q} maxLength={200} onChange={e => change(setQ, e.target.value)} placeholder={nda ? 'Founder or investor…' : 'Partner…'} /></label>
    <label>Status<input className={input} placeholder="Any status" value={status} onChange={e => change(setStatus, e.target.value)} /></label>
    <label>{nda ? 'Introduced by' : 'Deal type'}<input className={input} placeholder={nda ? 'Any introducer' : 'Any type'} value={filter} onChange={e => change(setFilter, e.target.value)} /></label>
    <button type="button" className={button} onClick={() => { setQ(''); setStatus(''); setFilter(''); setOffset(0); }}>Clear filters</button></div>
    <ReadState read={read} what={nda ? 'NDAs' : 'Partner deals'}>{read.data && <>
      {!read.data.items.length ? <p className="p-6">{nda ? 'No NDA matches these filters. One is created when a founder and an investor are introduced.' : 'No partner deal matches these filters.'}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="border-y border-axal-hairline"><tr>{(nda ? ['Founder', 'Investor', 'Introduced by', 'Status', 'Valid until', 'Last activity', 'Envelope'] : ['Partner', 'Type', 'Term', 'Granted plans', 'Redemptions', 'Status', 'Settlements']).map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{read.data.items.map(row => <tr className="border-b border-axal-hairline align-top" key={row.id}>
        {nda ? <><td className="p-3"><Recorded value={row.party_a_name || row.party_a_email} reason="Party A has no recorded name." /></td><td className="p-3"><Recorded value={row.party_b_name || row.party_b_email} reason="Party B has no recorded name." /></td><td className="p-3"><Recorded value={row.intermediary} reason="The introduction source was not recorded." /></td><td className="p-3">{row.status}</td><td className="p-3"><Recorded value={date(row.valid_until)} reason="This NDA has no recorded end date." /></td><td className="p-3"><Recorded value={date(row.updated_at)} reason="No activity date was recorded." /></td><td className="p-3">{row.nda_envelope_uuid ? <button type="button" className={button} onClick={() => onOpen(row.nda_envelope_uuid)}>Open envelope</button> : <Recorded value={null} reason="No envelope is linked." />}</td></>
          : <><td className="p-3"><Recorded value={row.partner_name || row.partner_email} reason="No partner name was recorded." /></td><td className="p-3">{row.deal_type}</td><td className="p-3"><Recorded value={row.term_months != null ? `${row.term_months} months` : null} reason="This deal was granted without a recorded term." /></td><td className="p-3"><Recorded value={row.granted_tiers} reason="No granted plan was recorded." /></td><td className="p-3"><Recorded value={row.redemption_count} reason="Redemptions could not be counted." /></td><td className="p-3">{row.status}</td><td className="p-3"><button type="button" className={button} onClick={() => setSettling(row)} data-testid={`partner-deal-settlements-${row.id}`}>Settlements</button></td></>}
      </tr>)}</tbody></table></div>}
      <Pagination data={read.data} offset={offset} onPage={setOffset} />
    </>}</ReadState>
    {settling && <SettlementsDesk deal={settling} superAdmin={superAdmin} onClose={() => setSettling(null)} />}</section>;
}
