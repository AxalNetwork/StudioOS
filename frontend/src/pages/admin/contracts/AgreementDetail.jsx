import React, { useState } from 'react';
import { api } from '../../../lib/api';
import { contractsApi } from '../../../lib/api/contracts';
import { reportError } from '../../../lib/log';
import { ReadState, useRead, SidePanel, Recorded, Missing, button, input, date, downloadPdf } from './parts';
import useRecordCrumb from '../useRecordCrumb';

const FILE_KINDS = { signed_copy: 'Signed copy', docx_export: 'Word export', docusign_source: 'DocuSign source', docusign_signed: 'DocuSign signed copy' };
const RENDERERS = { browser_run: 'Browser Run', pdf_lib: 'Fallback', docx: 'Word', docusign: 'DocuSign' };
const sizeOf = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** D711 — one row per recorded file: kind, signer, renderer, size, date and hash prefix. */
export function FileRows({ files }) {
  if (!files?.length) return null;
  return <ul className="space-y-1 text-xs">{files.map((f, i) => <li key={i}>
    {FILE_KINDS[f.kind] || f.kind}{f.signer ? ` · Signer ${f.signer}` : ''} · {RENDERERS[f.renderer] || f.renderer} · {sizeOf(f.bytes)} · {date(f.created_at)} · <span className="font-mono">{String(f.sha256 || '').slice(0, 12)}</span>{f.stored ? '' : ' · not stored'}
  </li>)}</ul>;
}

const eventNames = { email_sent: 'Sent', provider_sent: 'Sent through DocuSign', email_resent: 'Sent again', envelope_created: 'Created', envelope_viewed: 'Viewed', envelope_signed: 'Signed', envelope_rejected: 'Declined', reminder_sent: 'Reminder sent', email_failed: 'Invitation failed' };
export default function AgreementDetail({ uid, onClose, onChanged }) {
  const detail = useRead(() => api.adminGetContract(uid), [uid]);
  const history = useRead(() => contractsApi.history(uid), [uid]);
  const pdf = useRead(() => contractsApi.signedPdf(uid), [uid]);
  const files = useRead(() => contractsApi.files(uid), [uid]);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function act(action) {
    setBusy(true); setMessage('');
    try {
      const result = action === 'resend' ? await api.adminResendContract(uid) : await api.adminVoidContractWithReason(uid, reason.trim());
      setMessage(action === 'void' ? 'Envelope voided. The reason is recorded.' : result.email_sent === false ? 'The invitation could not be sent. Try again.' : 'Resend completed.');
      setVoiding(false); detail.retry(); history.retry(); onChanged();
    } catch (e) { reportError('contracts:action', e); setMessage('The action could not be confirmed. Reload this agreement before retrying.'); }
    finally { setBusy(false); }
  }
  const row = detail.data;
  // D775 (#2101): the open agreement is the rail's record once it is read.
  useRecordCrumb(row?.title || null, 'agreement', uid);
  return <SidePanel title={row?.title || 'Agreement'} onClose={onClose}>
    <ReadState read={detail} what="Agreement">{row && <><p>{row.doc_type_label || row.doc_type} · <span className="font-mono">{row.source}</span> · {row.provider || 'Not recorded'}</p><p>{row.status}</p>
      <h3 className="font-bold">Parties</h3><p>Company: <Recorded value={row.project_name} reason="This agreement has no recorded company link." /></p>
      <p>Recipient: <Recorded value={row.recipient_name || row.recipient_email} reason="No recipient is recorded in this store." /></p>
      <ReadState read={history} what="Signing history">{history.data && <>
        <p>Sender: <Recorded value={history.data.sender?.name || history.data.sender?.email} reason="The sender account is not recorded in this store." /></p>
        {history.data.parties.length ? history.data.parties.map((party, i) => <div key={i}><Recorded value={party.name || party.email} reason="The signer name was not recorded." /> · {party.email}<p>Signed: <Recorded value={date(party.signed_at)} reason="No signature date has been recorded." /> · IP: <Recorded value={party.signer_ip} reason="The signer IP was not recorded." /></p></div>) : <Missing reason={history.data.reason || 'No signer parties were recorded.'} />}
        <h3 className="font-bold">Timeline</h3>{history.data.timeline.length ? history.data.timeline.map((event, i) => <p key={i}>{eventNames[event.action] || event.action} · <Recorded value={date(event.ts)} reason="This event has no recorded time." /></p>) : <Missing reason={history.data.reason || 'No signing events were recorded.'} />}
        {history.data.voids?.map((event, i) => <p key={i}>Voided · {date(event.ts)} · {event.reason}</p>)}
      </>}</ReadState>
      <h3 className="font-bold">Signed PDF</h3><ReadState read={pdf} what="Signed PDF">{pdf.data && (pdf.data.available ? <div><p className="font-mono break-all text-xs">SHA-256: {pdf.data.sha256}</p><button type="button" className={button} onClick={() => downloadPdf(pdf.data.pdf_base64, 'signed-agreement.pdf')}>Download signed PDF</button></div> : <Missing reason={pdf.data.reason} />)}</ReadState>
      <ReadState read={files} what="Recorded files">{files.data && (files.data.files?.length ? <FileRows files={files.data.files} /> : <Missing reason={files.data.reason || 'No rendered file is recorded for this envelope.'} />)}</ReadState>
      {row.void_reason && <p>Void reason: {row.void_reason}</p>}
      <div className="flex gap-2">{row.can_resend && <button type="button" className={button} disabled={busy} onClick={() => act('resend')}>Resend</button>}
        {['documents', 'esign'].includes(row.source) && !['signed', 'void'].includes(row.status) && <button type="button" className={button} disabled={busy} onClick={() => setVoiding(true)}>Void…</button>}</div>
      {voiding && <div className="space-y-2"><label>Reason for voiding<textarea className={input} value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} /></label><p>Use at least five characters. This reason is recorded with the agreement. The recipient can no longer sign.</p><button type="button" className={button} disabled={reason.trim().length < 5 || busy} onClick={() => act('void')}>Confirm void</button><button type="button" className={button} onClick={() => setVoiding(false)}>Cancel</button></div>}
    </>}</ReadState>{message && <p role="status">{message}</p>}
  </SidePanel>;
}
