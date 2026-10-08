import React from 'react';
import { contractsApi } from '../../../lib/api/contracts';
import { ReadState, useRead, Recorded, button, input, card, date, Pagination } from './parts';

export const agreementStatus = row => row.status === 'signed' ? 'Signed' : row.status === 'void' ? 'Voided' : ['sent', 'generated'].includes(row.status) ? 'Awaiting signature' : 'Draft';
export default function AgreementList({ filters, onFilters, onOpen, revision }) {
  const offset = Number(filters.offset || 0);
  const read = useRead(() => contractsApi.agreements({ ...filters, limit: 25, offset }), [JSON.stringify(filters), revision]);
  const set = (key, value) => onFilters({ ...filters, [key]: value, offset: 0 });
  return <section className={card}>
    <div className="flex flex-wrap gap-2 border-b border-axal-hairline p-3">{[['All', ''], ['Awaiting signature', 'awaiting_signature'], ['Signed', 'signed'], ['Voided', 'void']].map(([label, value]) => <button key={label} type="button" className={`${button} ${filters.status === value || (!filters.status && !value) ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`} aria-pressed={(filters.status || '') === value} onClick={() => set('status', value)}>{label}</button>)}</div>
    <div className="flex flex-wrap gap-2 p-3"><label className="min-w-48 flex-1">Search<input className={input} placeholder="Title, recipient, company, template…" maxLength={200} value={filters.q || ''} onChange={e => set('q', e.target.value)} /></label>
      <label>Document type<input className={input} value={filters.doc_type || ''} onChange={e => set('doc_type', e.target.value)} placeholder="Any type" /></label>
      <label>Party<select className={input} value={filters.party_role || ''} onChange={e => set('party_role', e.target.value)}>{[['', 'Any party'], ['founder', 'Founder'], ['investor', 'Investor'], ['advisor', 'Advisor'], ['partner', 'Partner'], ['axal', 'Axal']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Provider<select className={input} value={filters.provider || ''} onChange={e => set('provider', e.target.value)}><option value="">Any provider</option><option value="native">Native</option><option value="docusign">DocuSign</option></select></label>
      <label>Sort<select className={input} value={`${filters.sort || 'sent_at'}:${filters.direction || 'desc'}`} onChange={e => { const [sort, direction] = e.target.value.split(':'); onFilters({ ...filters, sort, direction, offset: 0 }); }}>{[['sent_at:desc', 'Sent, newest'], ['sent_at:asc', 'Sent, oldest'], ['title:asc', 'Title'], ['recipient:asc', 'Recipient'], ['signed_at:desc', 'Signed, newest'], ['days_to_sign:asc', 'Days to sign']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="button" className={button} onClick={() => onFilters({})}>Clear filters</button></div>
    {filters.template && <p className="px-3">Template: {filters.template}</p>}
    <ReadState read={read} what="Agreements">{read.data && <>
      {!read.data.items.length ? <p className="p-6">No agreement matches these filters. Use New envelope to send an agreement.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[840px] text-left text-xs"><thead className="border-y border-axal-hairline text-axal-muted"><tr>{['Agreement · store', 'Company · recipient', 'Sent · signed · days', 'Provider', 'Status'].map(label => <th className="p-3 font-semibold" key={label}>{label}</th>)}</tr></thead><tbody>{read.data.items.map(row => <tr key={`${row.source}:${row.id}`} className="border-b border-axal-hairline align-top">
        <td className="p-3"><button type="button" className="text-left font-semibold underline decoration-transparent hover:decoration-current" onClick={() => onOpen(row.uid)}>{row.title}</button><p className="text-axal-muted">{row.doc_type_label || row.doc_type}</p><span className="font-mono text-[10px] text-axal-faint">{row.source}</span></td>
        <td className="p-3"><Recorded value={row.project_name} reason="No company link." /><p><Recorded value={row.recipient_name || row.recipient_email} reason="No recipient in this store." /></p></td>
        <td className="p-3 font-mono"><div>Sent: <Recorded value={date(row.sent_at)} reason="No send event." /></div><div>Signed: <Recorded value={date(row.signed_at)} reason="No signature date." /></div><div>Days: <Recorded value={row.days_to_sign} reason="Both dates are needed." /></div></td>
        <td className="p-3"><Recorded value={row.provider === 'native' ? 'Native' : row.provider === 'docusign' ? 'DocuSign' : null} reason="No provider recorded." /></td>
        <td className="p-3"><span className="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-800">{agreementStatus(row)}</span>{row.raw_status === 'viewed' && <p className="mt-1 font-mono">Viewed</p>}{row.raw_status === 'rejected' && <p className="mt-1 font-mono">Declined</p>}{row.void_reason && <p className="mt-1 text-axal-muted">{row.void_reason}</p>}</td>
      </tr>)}</tbody></table></div>}
      <Pagination data={read.data} offset={offset} onPage={value => onFilters({ ...filters, offset: value })} />
    </>}</ReadState>
  </section>;
}
