import React, { useState } from 'react';
import './memberTrust.css';
import DsrOutcomeNotice from '../../components/DsrOutcomeNotice';
import Lightbox from '../../ui/Lightbox';
import { api } from '../../lib/api';
import { BTN, useAccountRead } from '../account/AccountCenter';
import { CARD, LINK, SUB } from './MemberOverview';
import { day } from './memberTrustModel';

function ReadState({ read, what, children }) {
  if (read.status === 'loading') return <p className={SUB}>Reading {what}…</p>;
  if (read.status === 'unreadable') return <p role="alert" className={SUB}>Unreadable. {what} could not be read. <button className={LINK} onClick={read.reload}>Try again</button></p>;
  return children;
}
export default function MemberData({ role }) {
  const settings = useAccountRead(api.getSettings);
  const privacy = useAccountRead(api.getPrivacySettings);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const open = (kind) => { setError(''); setDialog(kind); };
  const close = () => { if (!busy) setDialog(null); };
  async function confirm() {
    setBusy(true); setError(''); setNotice('');
    try {
      if (dialog === 'download') {
        const blob = await api.exportMyData();
        const url = URL.createObjectURL(blob);
        try { const link = document.createElement('a'); link.href = url; link.download = 'axal-account-data.json'; document.body.appendChild(link); link.click(); link.remove(); }
        finally { URL.revokeObjectURL(url); }
        setNotice('Your data download is ready.');
      } else {
        if (dialog === 'delete') await api.requestAccountDeletion(); else await api.cancelAccountDeletion();
        setNotice(dialog === 'delete' ? 'Your deletion request is recorded. This does not mean your account has been deleted.' : 'Your deletion request is cancelled.');
        // The server's timestamp is the after-state; never invent one locally.
        settings.reload();
      }
      setDialog(null);
    } catch { setError('This action could not be completed. Try again.'); }
    finally { setBusy(false); }
  }
  const requested = settings.data?.deletion_requested_at;
  const deletionKnown = settings.data != null && Object.hasOwn(settings.data, 'deletion_requested_at');
  return <div className="space-y-4" data-testid="trust-your-data">
    {notice && <p role="status" className={SUB}>{notice}</p>}
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <section className={CARD}><h2 className="font-bold">Download your data</h2><p className={SUB}>Download the recorded account export as a JSON file.</p><button type="button" className={LINK} onClick={() => open('download')}>Download</button></section>
      <section className={CARD}><h2 className="font-bold">Delete your account</h2><ReadState read={settings} what="Your account’s deletion state"><p className={SUB}>{requested ? `Deletion requested ${day(requested)}.` : deletionKnown ? 'No open deletion request is recorded.' : 'Not recorded: the deletion state was not returned.'}</p>{deletionKnown && <button type="button" className={requested ? LINK : BTN.danger} onClick={() => open(requested ? 'cancel' : 'delete')}>{requested ? 'Cancel request' : 'Ask to delete'}</button>}<p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Deletion is reviewed by the team. A request does not mean your account is deleted.</p>{!requested && <DsrOutcomeNotice outcome={settings.data?.dsr_outcome} />}</ReadState></section>
      <section className={CARD}><h2 className="font-bold">Matching</h2><ReadState read={privacy} what="Your matching consent"><p className={SUB}>{typeof privacy.data?.matching_opt_in === 'boolean' ? privacy.data.matching_opt_in ? 'You opted into matching.' : 'You have not opted into matching.' : 'Not recorded: no matching consent value was returned.'}</p></ReadState><a className={LINK} href="/account/privacy">Change in Settings › Privacy</a></section>
      <section className={CARD}><h2 className="font-bold">Who at Axal VC looked at your identity record</h2><p className={SUB}>Not recorded here: the member view log is not available on this page.</p></section>
      <section className={CARD}><h2 className="font-bold">Apps and keys with access to your account</h2><p className={SUB}>Manage connected assistants, your API keys and their access in Builder (D1315).</p><a className={LINK} href="/account/builder">Open Account › Builder</a><a className={`${LINK} ml-4`} href="/account/connectors">Open Connectors</a></section>
    </div>
    {dialog && <div className="member-trust-lightbox"><Lightbox label={dialog === 'download' ? 'Download your data' : dialog === 'delete' ? 'Request account deletion' : 'Cancel deletion request'} onClose={close}><div className="space-y-5 p-6 sm:w-[480px]"><h2 className="text-lg font-bold">{dialog === 'download' ? 'Download your data' : dialog === 'delete' ? 'Request account deletion' : 'Cancel deletion request'}</h2><p className={SUB}>{dialog === 'download' ? 'This downloads your account’s recorded data as JSON. It does not change your account.' : dialog === 'delete' ? 'This records a deletion request for team review. The team will reach out within 7 days. It also revokes connected AI assistants. Your account is not immediately deleted.' : 'This withdraws the open deletion request. It does not restore revoked assistant connections.'}</p>{error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}<div className="flex flex-wrap justify-end gap-3"><button className={BTN.ghost} disabled={busy} onClick={close}>Back</button><button className={dialog === 'delete' ? BTN.dangerSolid : BTN.primary} disabled={busy} onClick={confirm}>{busy ? 'Working…' : dialog === 'download' ? 'Confirm download' : dialog === 'delete' ? 'Confirm deletion request' : 'Confirm cancellation'}</button></div></div></Lightbox></div>}
  </div>;
}
