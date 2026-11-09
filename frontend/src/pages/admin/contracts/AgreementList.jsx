import React from 'react';
import { contractsApi } from '../../../lib/api/contracts';
import { ReadState, useRead, Recorded, Missing, button, input, card, Pagination } from './parts';
import { agreementRowSemantics } from '../../../lib/contractLifecycle';
import { attentionLabel } from './contractMetrics';
import { InconsistencyFlag, LifecycleBadge } from './LifecycleBadge';
import { Link } from 'react-router-dom';
import {
  AGREEMENT_TYPE_OPTIONS, LEGAL_STATUS_OPTIONS, PACKAGE_OPTIONS, PROGRAM_OPTIONS, agreementContextLine, agreementTemplateLine,
} from '../../../lib/contractAgreements';

/**
 * D5050 (#5050): a licence agreement's context on its row — type, licence, territory, program or package,
 * template — its legal state (the document's, not the grant's), and where to open it. A draft has no
 * envelope, so it opens on its licence, never as a signed document.
 */
export function AgreementContextCell({ agreement }) {
  if (!agreement) return null;
  const links = agreement.links || {};
  return <div className="mt-1 space-y-0.5" data-testid="agreement-context">
    <p className="text-axal-ink dark:text-gray-100">{agreementContextLine(agreement)}</p>
    <p className="font-mono text-[10px] text-axal-faint">{agreementTemplateLine(agreement)}</p>
    <p data-testid="agreement-legal-state"><span className="font-semibold">{agreement.legal_status_label}</span>{agreement.is_current ? '' : ' · history'}</p>
    <p className="flex flex-wrap gap-x-3">
      <Link className="underline" to={links.licence}>Open licence</Link>
      {links.program_access && <Link className="underline" to={links.program_access}>Open Program access</Link>}
      {agreement.agreement_type === 'package' && (links.package
        ? <Link className="underline" to={links.package}>Open package</Link>
        : <Missing reason={links.package_reason} />)}
      {!agreement.document_available && <span className="text-axal-muted" data-testid="agreement-document-reason">{agreement.document_reason}</span>}
    </p>
  </div>;
}

/**
 * D4811 (board CT02): a row says what state it is in. A missing signature date
 * on an unsigned agreement is expected and not flagged; a missing company link
 * reads "Unlinked recipient" (no link flow exists yet, so no repair action);
 * the one amber warning is a contradiction.
 */
export function AgreementCells({ row }) {
  const m = agreementRowSemantics(row);
  return <>
    <td className="p-3">{m.company.unlinked
      ? <span data-testid="agreement-unlinked" className="text-axal-muted">{m.company.label}</span>
      : m.company.name}<p><Recorded value={row.recipient_name || row.recipient_email} reason="No recipient in this store." /></p></td>
    <td className="p-3"><div data-testid="agreement-state-line">{m.line}</div>
      {m.sentMissing && <Missing reason="No send event." />}
      {m.days != null && <div className="font-mono text-axal-muted">{m.days} days to sign</div>}</td>
    <td className="p-3"><Recorded value={row.provider === 'native' ? 'Native' : row.provider === 'docusign' ? 'DocuSign' : null} reason="No provider recorded." /></td>
    <td className="p-3">{m.warning
      ? <InconsistencyFlag text={m.warning} />
      : <LifecycleBadge badge={m.badge} />}
      {row.raw_status === 'viewed' && <p className="mt-1 font-mono">Viewed</p>}{row.raw_status === 'rejected' && <p className="mt-1 font-mono">Declined</p>}{row.void_reason && <p className="mt-1 text-axal-muted">{row.void_reason}</p>}</td>
  </>;
}

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
      {/* D5050: licence agreements by type, legal state, licence, program and package. */}
      <label>Agreement type<select className={input} value={filters.agreement_type || ''} onChange={e => set('agreement_type', e.target.value)}>{AGREEMENT_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Legal state<select className={input} value={filters.agreement_status || ''} onChange={e => set('agreement_status', e.target.value)}>{LEGAL_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Licence<input className={input} value={filters.licence || ''} maxLength={64} onChange={e => set('licence', e.target.value.trim())} placeholder="Reference or uid" /></label>
      <label>Program<select className={input} value={filters.program || ''} onChange={e => set('program', e.target.value)}>{PROGRAM_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Package<select className={input} value={filters.package || ''} onChange={e => set('package', e.target.value)}>{PACKAGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Sort<select className={input} value={`${filters.sort || 'sent_at'}:${filters.direction || 'desc'}`} onChange={e => { const [sort, direction] = e.target.value.split(':'); onFilters({ ...filters, sort, direction, offset: 0 }); }}>{[['sent_at:desc', 'Sent, newest'], ['sent_at:asc', 'Sent, oldest'], ['title:asc', 'Title'], ['recipient:asc', 'Recipient'], ['signed_at:desc', 'Signed, newest'], ['days_to_sign:asc', 'Days to sign']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="button" className={button} onClick={() => onFilters({})}>Clear filters</button></div>
    {filters.template && <p className="px-3">Template: {filters.template}</p>}
    {/* D4811 part 3: a metric strip cell's records, named, with a way back to all agreements. */}
    {attentionLabel(filters.attention) && <p role="status" className="flex flex-wrap items-center gap-2 px-3 text-[12.5px]" data-testid="agreement-attention-filter">Showing: <b>{attentionLabel(filters.attention)}</b>
      <button type="button" className={button} onClick={() => onFilters({ ...filters, attention: '', offset: 0 })}>Show all agreements</button></p>}
    <ReadState read={read} what="Agreements">{read.data && <>
      {!read.data.items.length ? <p className="p-6">No agreement matches these filters. Use New envelope to send an agreement.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[840px] text-left text-xs"><thead className="border-y border-axal-hairline text-axal-muted"><tr>{['Agreement · store', 'Company · recipient', 'Where it stands', 'Provider', 'Lifecycle'].map(label => <th className="p-3 font-semibold" key={label}>{label}</th>)}</tr></thead><tbody>{read.data.items.map(row => <tr key={`${row.source}:${row.id}`} className="border-b border-axal-hairline align-top">
        <td className="p-3">{['licence_agreement', 'licence_contract'].includes(row.source)
          ? <span className="font-semibold">{row.title}</span>
          : <button type="button" className="text-left font-semibold underline decoration-transparent hover:decoration-current" onClick={() => onOpen(row.uid)}>{row.title}</button>}<p className="text-axal-muted">{row.doc_type_label || row.doc_type}</p><span className="font-mono text-[10px] text-axal-faint">{row.source}</span><AgreementContextCell agreement={row.agreement} /></td>
        <AgreementCells row={row} />
      </tr>)}</tbody></table></div>}
      <Pagination data={read.data} offset={offset} onPage={value => onFilters({ ...filters, offset: value })} />
    </>}</ReadState>
  </section>;
}
