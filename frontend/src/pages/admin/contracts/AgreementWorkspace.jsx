import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../lib/api';
import { contractsApi } from '../../../lib/api/contracts';
import { agreementRowSemantics } from '../../../lib/contractLifecycle';
import { FileRows, EVENT_NAMES } from './AgreementDetail';
import { InconsistencyFlag, LifecycleBadge } from './LifecycleBadge';
import { Missing, ReadState, Recorded, button, card, date, downloadPdf, useRead } from './parts';

/**
 * D4811 (#4811) part 14 — one agreement's workspace (board CT-07 "Document
 * workspace"), at `/admin/contracts/agreements/doc/:uid`: Overview · Document
 * · Versions · Legal Review · Activity · Related. Read from the routes the
 * quick panel reads (`GET /api/admin/contracts/:uid`, `/history`,
 * `/signed-pdf`, `/files`); resend and void stay in the panel, which the
 * header opens. Nothing here writes. An unknown is "Not recorded", never
 * blank or 0.
 */

export const AGREEMENT_TABS = Object.freeze([
  ['overview', 'Overview'], ['document', 'Document'], ['versions', 'Versions'],
  ['review', 'Legal Review'], ['activity', 'Activity'], ['related', 'Related'],
]);

const PROVIDERS = { native: 'Native', docusign: 'DocuSign' };
export const providerLabel = (p) => PROVIDERS[p] || null;

/**
 * The Activity tab's events, oldest first: each signing event and each void,
 * as `{ key, what, at }` (`at` null when the event has no recorded time).
 */
export function activityRows(history) {
  if (!history) return [];
  const events = (history.timeline || []).map((e, i) => ({ key: `e${i}`, what: EVENT_NAMES[e.action] || e.action, at: e.ts || null }));
  const voids = (history.voids || []).map((v, i) => ({ key: `v${i}`, what: v.reason ? `Voided · ${v.reason}` : 'Voided', at: v.ts || null }));
  const time = (r) => (r.at == null ? Number.POSITIVE_INFINITY : Date.parse(String(r.at).replace(' ', 'T')));
  return [...events, ...voids].sort((a, b) => time(a) - time(b));
}

/** Where the quick panel opens this agreement (resend and void live there). */
export const panelHref = (uid) => `/admin/contracts?agreement=${encodeURIComponent(uid)}`;

export default function AgreementWorkspace({ uid }) {
  const [tab, setTab] = useState('overview');
  const detail = useRead(() => api.adminGetContract(uid), [uid]);
  const history = useRead(() => contractsApi.history(uid), [uid]);
  const pdf = useRead(() => contractsApi.signedPdf(uid), [uid]);
  const files = useRead(() => contractsApi.files(uid), [uid]);
  const row = detail.data;
  const m = row ? agreementRowSemantics(row) : null;
  return <section className="space-y-3" data-testid="agreement-workspace">
    <nav aria-label="Breadcrumb" className="text-[11px] text-axal-muted"><Link to="/admin/contracts" className="underline">Contracts</Link> › <Link to="/admin/contracts" className="underline">Agreements</Link>{row ? ` › ${row.doc_type_label || row.doc_type || 'Agreement'}` : ''}</nav>
    <ReadState read={detail} what="Agreement">{row && <>
      <header className={`${card} flex flex-wrap items-start justify-between gap-3 p-4`}>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-axal-faint"><span className="rounded border border-axal-hairline px-1">Agreement</span> <span className="font-mono normal-case">{row.source}</span></p>
          <h2 className="text-xl font-extrabold">{row.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px]">{m.warning ? <InconsistencyFlag text={m.warning} /> : <LifecycleBadge badge={m.badge} />}{m.line && m.line !== m.badge?.label && <span>{m.line}</span>}</p>
        </div>
        <Link to={panelHref(uid)} className={button}>Resend or void in the panel</Link>
      </header>
      <div role="tablist" aria-label="Agreement workspace" className="flex gap-1 overflow-x-auto border-b border-axal-hairline">
        {AGREEMENT_TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`min-h-[44px] whitespace-nowrap px-3 text-[12.5px] font-semibold ${tab === k ? 'border-b-2 border-violet-600 text-axal-ink dark:text-white' : 'text-axal-muted'}`}>{label}</button>)}
      </div>
      <div role="tabpanel" className={`${card} space-y-2 p-4 text-[12.5px]`} data-testid={`agreement-tab-${tab}`}>
        {tab === 'overview' && <dl className="grid gap-2 sm:grid-cols-2">
          <Fact label="Document type"><Recorded value={row.doc_type_label || row.doc_type} reason="No document type is recorded." /></Fact>
          <Fact label="Where it stands">{m.warning || m.line || <Missing reason="This store records no state." />}</Fact>
          <Fact label="Company">{m.company.name || <span className="text-axal-muted">{m.company.label}</span>}</Fact>
          <Fact label="Recipient"><Recorded value={row.recipient_name || row.recipient_email} reason="No recipient is recorded in this store." /></Fact>
          <Fact label="Provider"><Recorded value={providerLabel(row.provider)} reason="No provider is recorded." /></Fact>
          <Fact label="Sent"><Recorded value={date(row.sent_at)} reason="No send is recorded." /></Fact>
          <Fact label="Signed"><Recorded value={date(row.signed_at)} reason="No signature date is recorded." /></Fact>
          <Fact label="Last legal review"><Missing reason="An agreement is not reviewed on its own: counsel reviews the template it was issued from (its Legal Review tab)." /></Fact>
        </dl>}
        {tab === 'document' && <ReadState read={pdf} what="Signed PDF">{pdf.data && (pdf.data.available
          ? <div className="space-y-2"><p className="font-mono text-xs break-all">SHA-256: {pdf.data.sha256}</p>
            <button type="button" className={button} onClick={() => downloadPdf(pdf.data.pdf_base64, 'signed-agreement.pdf')}>Download signed PDF</button></div>
          : <Missing reason={pdf.data.reason} />)}</ReadState>}
        {tab === 'versions' && <>
          <p className="text-axal-muted">An agreement is issued once, from one template version. These are the files recorded for it: the renderings and the signed copies.</p>
          <ReadState read={files} what="Recorded files">{files.data && (files.data.files?.length ? <FileRows files={files.data.files} /> : <Missing reason={files.data.reason || 'No rendered file is recorded for this agreement.'} />)}</ReadState>
        </>}
        {tab === 'review' && <Missing reason="An agreement is not reviewed on its own. Counsel reviews the template it was issued from, and the governance records; open the template's Legal Review tab from Related." />}
        {tab === 'activity' && <ReadState read={history} what="Signing history">{history.data && (activityRows(history.data).length
          ? <ol className="space-y-1">{activityRows(history.data).map((r) => <li key={r.key}>{r.what} · <Recorded value={date(r.at)} reason="This event has no recorded time." /></li>)}</ol>
          : <Missing reason={history.data.reason || 'No signing events were recorded.'} />)}</ReadState>}
        {tab === 'related' && <dl className="space-y-2">
          <Fact label="Made from">{row.doc_type ? <Link to="/admin/contracts?tab=templates" className="underline">{row.doc_type_label || row.doc_type} in Templates</Link> : <Missing reason="No template is recorded." />}</Fact>
          <Fact label="Company">{m.company.name || <span className="text-axal-muted">{m.company.label}</span>}</Fact>
          <Fact label="Governance records citing it"><Missing reason="Governance links name templates and records, not agreements (part 8)." /></Fact>
        </dl>}
      </div>
    </>}</ReadState>
  </section>;
}

function Fact({ label, children }) {
  return <div><dt className="text-[10px] font-bold uppercase tracking-widest text-axal-faint">{label}</dt><dd>{children}</dd></div>;
}
