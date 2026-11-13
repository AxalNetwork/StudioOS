import React, { useEffect, useState } from 'react';
import { contractsApi } from '../../../lib/api/contracts';
import { reportError } from '../../../lib/log';
import { Recorded, Missing, button, input, card, Pagination } from './parts';
import { AGREEMENT_SORT_OPTIONS, AGREEMENT_STATUS_FILTERS, agreementRowSemantics } from '../../../lib/contractLifecycle';
import { attentionLabel } from './contractMetrics';
import { InconsistencyFlag, LifecycleBadge } from './LifecycleBadge';
import { Link } from 'react-router-dom';
import AgreementFilterRow from './AgreementFilterRow';
import {
  NEVER_SENT_LABEL, activeAgreementChips, agreementContextLine, agreementTemplateLine, documentLink, hasNoEnvelope, isNeverSent,
  legalStateWord, withoutAgreementFilters,
} from '../../../lib/contractAgreements';

const linkClass = 'font-semibold text-violet-700 underline decoration-transparent hover:decoration-current dark:text-violet-300';

/**
 * D5050 (#5050) part 2, board CT-18: a licence agreement's context on its row without opening it: the object
 * tag, then territory · licence · Axal VC package · program; the template it was made from (a source, never a
 * state); and Open licence, Open Program access, Open package context and View / download agreement. A link the
 * platform has no page for says Not recorded with the Worker's reason. A version with no envelope opens on its
 * licence, never as a document, and says why.
 */
export function AgreementContextCell({ agreement, row = null }) {
  if (!agreement) return null;
  const links = agreement.links || {};
  const doc = row ? documentLink(row) : null;
  const isPackage = !!agreement.package_key || agreement.agreement_type === 'package';
  return <div className="mt-1 space-y-1 text-[12px]" data-testid="agreement-context">
    <p className="flex flex-wrap items-center gap-1.5 text-axal-muted">
      <span className="rounded border border-axal-hairline px-1.5 font-mono text-[9.5px] font-bold uppercase tracking-wider dark:border-gray-700">Agreement</span>
      <span data-testid="agreement-context-line">{agreementContextLine(agreement) || <Missing reason={agreement.licence_reason || 'No licence is recorded for this agreement.'} />}</span></p>
    <p className="font-mono text-[10px] text-axal-faint" data-testid="agreement-template-line">From template {agreementTemplateLine(agreement)}</p>
    <p className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12px]">
      {links.licence ? <Link className={linkClass} to={links.licence}>Open licence ›</Link> : <Missing reason={agreement.licence_reason || 'No licence is recorded for this agreement.'} />}
      {links.program_access && <Link className={linkClass} to={links.program_access}>Open Program access ›</Link>}
      {isPackage && (links.package
        ? <Link className={linkClass} to={links.package}>Open package context ›</Link>
        : <span data-testid="agreement-package-link"><span className="text-axal-muted">Open package context: </span><Missing reason={links.package_reason} /></span>)}
      {doc && <Link className={linkClass} to={doc.to} data-testid="agreement-document-link">{doc.label} ›</Link>}
    </p>
    {!agreement.document_available && <p className="text-[11.5px] text-axal-muted" data-testid="agreement-document-reason">{agreement.document_reason}</p>}
  </div>;
}

/** CT-19: the never-sent version's pill: dashed, never the executed seal and never a template's outline. */
export function NeverSentPill() {
  return <span data-testid="agreement-never-sent" className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-axal-hairline bg-white px-2 py-0.5 text-[11px] font-semibold text-axal-ink dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200">
    <span aria-hidden="true">○</span>{NEVER_SENT_LABEL}</span>;
}

/** CT-18: the legal-state word beside the lifecycle pill. The legal document's state, never the grant's. */
export function LegalStateWord({ agreement }) {
  const word = legalStateWord(agreement);
  if (!word) return null;
  return <p className="mt-1 text-[11.5px] text-axal-muted" data-testid="agreement-legal-state">legal state · <b className="text-axal-ink dark:text-gray-100">{word}</b>{agreement.is_current ? '' : ' · history'}</p>;
}

/** The lifecycle pill a row draws: the never-sent pill, a contradiction, or its lifecycle badge. */
function RowLifecycle({ row, m }) {
  if (isNeverSent(row)) return <NeverSentPill />;
  return m.warning ? <InconsistencyFlag text={m.warning} /> : <LifecycleBadge badge={m.badge} />;
}

/**
 * D4811 (board CT02): a row says what state it is in. A missing signature date
 * on an unsigned agreement is expected and not flagged; a missing company link
 * reads "Unlinked recipient", with a quiet dashed Link repair where the page
 * passes `onLink` (part 11; only stores that can carry a company); the one
 * amber warning is a contradiction. D5050 part 2: a licence agreement adds its
 * legal-state word under the pill (CT-18), and a version with no envelope says
 * "No envelope" where the provider would be (CT-19).
 */
export function AgreementCells({ row, onLink = null }) {
  const m = agreementRowSemantics(row);
  return <>
    <td className="p-3">{m.company.unlinked
      ? <span className="flex flex-wrap items-center gap-1"><span data-testid="agreement-unlinked" className="text-axal-muted">{m.company.label}</span>
        {onLink && <button type="button" data-testid={`agreement-link-${row.uid}`} onClick={() => onLink(row)} aria-label={`Link the recipient of ${row.title} to a company`}
          className="min-h-[44px] rounded border border-dashed border-violet-400 px-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300 md:min-h-0">⚭ Link</button>}</span>
      : m.company.none ? <span className="text-axal-muted">{m.company.label}</span> : m.company.name}<p><Recorded value={row.recipient_name || row.recipient_email} reason="No recipient in this store." /></p></td>
    <td className="p-3"><div data-testid="agreement-state-line">{m.line}</div>
      {m.sentMissing && <Missing reason="No send event." />}
      {m.days != null && <div className="font-mono text-axal-muted">{m.days} days to sign</div>}</td>
    <td className="p-3">{hasNoEnvelope(row)
      ? <span data-testid="agreement-no-envelope" className="whitespace-nowrap rounded border border-dashed border-axal-hairline px-1.5 font-mono text-[9.5px] font-bold uppercase tracking-wider text-axal-muted dark:border-gray-600">No envelope</span>
      : <Recorded value={row.provider === 'native' ? 'Native' : row.provider === 'docusign' ? 'DocuSign' : null} reason="No provider recorded." />}</td>
    <td className="p-3"><RowLifecycle row={row} m={m} />
      <LegalStateWord agreement={row.agreement} />
      {row.raw_status === 'viewed' && <p className="mt-1 font-mono">Viewed</p>}{row.raw_status === 'rejected' && <p className="mt-1 font-mono">Declined</p>}{row.void_reason && <p className="mt-1 text-axal-muted">{row.void_reason}</p>}</td>
  </>;
}

/** A row's title: a button that opens the envelope's panel, or plain text for a version with no envelope (CT-19). */
function Title({ row, onOpen }) {
  return ['licence_agreement', 'licence_contract'].includes(row.source)
    ? <span className="font-semibold">{row.title}</span>
    : <button type="button" className="text-left font-semibold underline decoration-transparent hover:decoration-current" onClick={() => onOpen(row.uid)}>{row.title}</button>;
}

/** CT-20 (phone): a row as a card, its title, context, lifecycle with the legal-state word, and its links. */
function AgreementCard({ row, onOpen }) {
  const m = agreementRowSemantics(row);
  return <li className="space-y-1.5 rounded-xl border border-axal-hairline bg-white p-3 dark:border-gray-700 dark:bg-gray-900" data-testid="agreement-card">
    <div className="text-[13.5px]"><Title row={row} onOpen={onOpen} /></div>
    <p className="text-[12px] text-axal-muted">{row.agreement?.agreement_type_label || row.doc_type_label || row.doc_type}</p>
    {row.agreement ? <AgreementContextCell agreement={row.agreement} row={row} /> : <p className="text-[12px]">{m.line}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2"><RowLifecycle row={row} m={m} /><LegalStateWord agreement={row.agreement} /></div>
  </li>;
}

/** The agreements read, keeping why it failed: a refusal and a filter the Worker does not know are not "Unavailable". */
function useAgreements(load, key) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ loading: true, data: null, error: null, at: null });
  useEffect(() => {
    let active = true;
    setState({ loading: true, data: null, error: null, at: null });
    Promise.resolve().then(load).then((data) => { if (active) setState({ loading: false, data, error: null, at: null }); },
      (e) => {
        reportError('contracts:read', e);
        if (active) setState({ loading: false, data: null, error: e || new Error('unreadable'), at: new Date() });
      });
    return () => { active = false; };
  // The caller passes the primitive key that defines this read.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

const stateCard = 'space-y-1.5 p-6';
const stateTag = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold';
const clock = (at) => (at ? at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : null);

/**
 * CT-20: the list's states. None names the filters that matched nothing and says the read succeeded; a
 * refusal says who may see it; a filter the Worker does not know names it; anything else is Unavailable with
 * Retry, and the list is never drawn as empty.
 */
function ListState({ read, filters, onFilters }) {
  if (read.loading) return <p role="status" className="p-6">Loading agreements…</p>;
  const e = read.error;
  if (e && (e.status === 401 || e.status === 403)) return <div role="alert" className={stateCard} data-testid="agreements-refused">
    <span className={`${stateTag} border-axal-hairline`}>Refused</span><p className="font-bold">You can’t view these agreements</p>
    <p className="text-axal-muted">{e.message || 'Contracts is restricted to administrators.'}</p></div>;
  if (e && e.status === 400) return <div role="alert" className={stateCard} data-testid="agreements-invalid-filter">
    <span className={`${stateTag} border-axal-hairline`}>Refused</span><p className="font-bold">Contracts doesn’t know one of these filter values</p>
    <p className="text-axal-muted">{e.message}</p>
    <button type="button" className={button} onClick={() => onFilters(withoutAgreementFilters(filters))}>Clear filters</button></div>;
  if (e) return <div role="alert" className={stateCard} data-testid="agreements-unavailable">
    <span className={`${stateTag} border-dashed border-axal-hairline`}>Unavailable</span><p className="font-bold">Agreements couldn’t be read</p>
    <p className="text-axal-muted">Contracts didn’t answer{read.at ? ` at ${clock(read.at)}` : ''}. The list is never shown as empty.</p>
    <button type="button" className={`${button} bg-violet-600 text-white`} onClick={read.retry}>Retry</button></div>;
  return null;
}

/** Whether a person narrowed the list: search, status, a metric cell or any CT-17 filter. */
const narrowed = (f) => ['q', 'status', 'doc_type', 'party_role', 'provider', 'attention', 'signed_recent'].some((k) => f[k]) || activeAgreementChips(f).length > 0;

export default function AgreementList({ filters, onFilters, onOpen, revision, onLink = null }) {
  const offset = Number(filters.offset || 0);
  const read = useAgreements(() => contractsApi.agreements({ ...filters, limit: 25, offset }), `${JSON.stringify(filters)}|${revision}`);
  const set = (key, value) => onFilters({ ...filters, [key]: value, offset: 0 });
  const chips = activeAgreementChips(filters);
  // D4811 part 23: the status chips and the sort read the shared lists, so the chip says Executed as the strip does;
  // the value sent stays `signed` (and `signed_at`), so an existing ?status=signed link still opens the same rows.
  return <section className={card}>
    <div className="flex flex-wrap gap-2 border-b border-axal-hairline p-3">{AGREEMENT_STATUS_FILTERS.map(([label, value]) => <button key={label} type="button" className={`${button} ${filters.status === value || (!filters.status && !value) ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`} aria-pressed={(filters.status || '') === value} onClick={() => set('status', value)}>{label}</button>)}</div>
    <div className="flex flex-wrap gap-2 p-3"><label className="min-w-48 flex-1">Search<input className={input} placeholder="Title, recipient, company, template…" maxLength={200} value={filters.q || ''} onChange={e => set('q', e.target.value)} /></label>
      <label>Document type<input className={input} value={filters.doc_type || ''} onChange={e => set('doc_type', e.target.value)} placeholder="Any type" /></label>
      <label>Party<select className={input} value={filters.party_role || ''} onChange={e => set('party_role', e.target.value)}>{[['', 'Any party'], ['founder', 'Founder'], ['investor', 'Investor'], ['advisor', 'Advisor'], ['partner', 'Partner'], ['axal', 'Axal']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Provider<select className={input} value={filters.provider || ''} onChange={e => set('provider', e.target.value)}><option value="">Any provider</option><option value="native">Native</option><option value="docusign">DocuSign</option></select></label>
      <label>Sort<select className={input} value={`${filters.sort || 'sent_at'}:${filters.direction || 'desc'}`} onChange={e => { const [sort, direction] = e.target.value.split(':'); onFilters({ ...filters, sort, direction, offset: 0 }); }}>{AGREEMENT_SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="button" className={button} onClick={() => onFilters({})}>Clear filters</button></div>
    {/* D5050 part 2 (CT-17): the licence, package and program agreement filters, and the active ones as chips. */}
    <div className="px-3 pb-3"><AgreementFilterRow filters={filters} onFilters={onFilters} total={read.data ? read.data.total : null} /></div>
    {/* D4811 part 3: a metric strip cell's records, named, with a way back to all agreements. */}
    {attentionLabel(filters.attention) && <p role="status" className="flex flex-wrap items-center gap-2 px-3 text-[12.5px]" data-testid="agreement-attention-filter">Showing: <b>{attentionLabel(filters.attention)}</b>
      <button type="button" className={button} onClick={() => onFilters({ ...filters, attention: '', offset: 0 })}>Show all agreements</button></p>}
    {read.loading || read.error ? <ListState read={read} filters={filters} onFilters={onFilters} /> : read.data && <>
      {!read.data.items.length ? (narrowed(filters)
        ? <div className={stateCard} data-testid="agreements-none"><span className={`${stateTag} border-axal-hairline`}>None</span><p className="font-bold">No agreements match these filters</p>
          <p className="text-axal-muted">{chips.length ? `${chips.map((c) => c.label).join(' · ')}. ` : ''}Read succeeded.</p>
          <button type="button" className={button} onClick={() => onFilters({})}>Clear filters</button></div>
        : <p className="p-6" data-testid="agreements-none">No agreements are recorded yet. Use New envelope to send an agreement.</p>)
        : <>
          <ul className="space-y-2 p-3 md:hidden" data-testid="agreement-cards">{read.data.items.map(row => <AgreementCard key={`${row.source}:${row.id}:${row.uid}`} row={row} onOpen={onOpen} />)}</ul>
          <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[840px] text-left text-xs"><thead className="border-y border-axal-hairline text-axal-muted"><tr>{['Agreement · store', 'Company · recipient', 'Where it stands', 'Provider', 'Lifecycle · legal state'].map(label => <th className="p-3 font-semibold" key={label}>{label}</th>)}</tr></thead><tbody>{read.data.items.map(row => <tr key={`${row.source}:${row.id}:${row.uid}`} className="border-b border-axal-hairline align-top">
            <td className="p-3"><Title row={row} onOpen={onOpen} /><p className="text-axal-muted">{row.agreement?.agreement_type_label || row.doc_type_label || row.doc_type}</p><span className="font-mono text-[10px] text-axal-faint">{row.source}</span><AgreementContextCell agreement={row.agreement} row={row} /></td>
            <AgreementCells row={row} onLink={onLink} />
          </tr>)}</tbody></table></div></>}
      <Pagination data={read.data} offset={offset} onPage={value => onFilters({ ...filters, offset: value })} />
    </>}
  </section>;
}
