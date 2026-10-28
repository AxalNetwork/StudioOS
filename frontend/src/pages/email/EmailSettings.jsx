/**
 * D1344 — Email › Settings (EM7): the member's mailboxes (check again,
 * disconnect behind a confirmation), and the sent log, 20 a page, each row
 * with what it quoted. Signature and the default reads are not drawn: nothing
 * on the Worker stores them yet; the reads are chosen per email in the panel
 * beside it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Lightbox from '../../ui/Lightbox';
import { Unreadable } from '../../ui';
import { mailApi } from '../../lib/api/mail.js';
import { mailboxLine, pageLabel, quotedLine } from './emailModel.js';
import { BODY, BTN, CARD, DANGER, ERROR, EYEBROW, H3, MUTED } from './emailParts.jsx';
import ConnectPanel from './ConnectPanel.jsx';

export default function EmailSettings({ api = mailApi }) {
  const [accounts, setAccounts] = useState(null);
  const [providers, setProviders] = useState({});
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState(null);
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [leaving, setLeaving] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setFailed(false);
    api.accounts().then((r) => { setAccounts(r?.accounts ?? []); setProviders(r?.providers ?? {}); }).catch(() => setFailed(true));
  }, [api]);
  useEffect(load, [load]);
  useEffect(() => { setSent(null); api.sent(page).then(setSent).catch(() => setSent(false)); }, [api, page, tick]);

  const check = async (a) => {
    setError(null);
    try { const r = await api.verifyAccount(a.uid); setAccounts((xs) => xs.map((x) => (x.uid === a.uid ? r.account : x))); }
    catch (e) { setError(e?.message || 'The mailbox could not be checked. Try again.'); }
  };
  const disconnect = async () => {
    setError(null);
    try { await api.disconnect(leaving.uid); setLeaving(null); load(); }
    catch (e) { setLeaving(null); setError(e?.message || 'The mailbox could not be disconnected. Try again.'); }
  };

  return <div className="flex flex-col gap-4" data-testid="email-settings">
    <div className="flex flex-col gap-1"><span className={EYEBROW}>Email › Settings</span>
      <h1 className="m-0 text-[24px] font-extrabold text-axal-ink dark:text-gray-100">Email settings</h1>
      <Link to="/email" className="w-fit text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300">‹ Back to Email</Link></div>
    {error && <p className={ERROR} role="alert">{error}</p>}

    <section className={CARD}>
      <h3 className={H3}>Mailboxes</h3>
      {failed ? <Unreadable what="Unreadable: your mailboxes" claim="Retry to read them." onRetry={load} />
        : accounts === null ? <p className={`mt-2 ${MUTED}`}>Reading your mailboxes…</p>
        : accounts.length === 0 ? <p className={`mt-2 ${BODY}`}>No mailbox connected yet.</p>
        : <ul className="mt-2 flex flex-col divide-y divide-axal-hairline dark:divide-gray-700">{accounts.map((a) => <li key={a.uid} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="mailbox-row">
            <span className="flex flex-col"><span className={BODY}>{mailboxLine(a)}</span>
              <span className={`text-[12px] ${a.status === 'active' ? MUTED : 'text-red-700 dark:text-red-300'}`}>{a.status === 'active' ? `Connected ${String(a.created_at ?? '').slice(0, 10) || 'on a day not recorded'}` : (a.last_error || 'This mailbox needs connecting again.')}</span></span>
            <span className="flex gap-2"><button type="button" className={BTN} onClick={() => check(a)}>Check again</button>
              <button type="button" className={DANGER} onClick={() => setLeaving(a)}>Disconnect</button></span>
          </li>)}</ul>}
    </section>

    {accounts !== null && !failed && <ConnectPanel providers={providers} onConnected={load} api={api} />}

    <section className={CARD} data-testid="sent-log">
      <div className="flex items-center justify-between gap-2"><h3 className={H3}>Sent log</h3>
        {sent && <span className={`text-[12px] ${MUTED}`}>{pageLabel(sent.page, sent.per_page, sent.total)}</span>}</div>
      {sent === false ? <Unreadable what="Unreadable: your sent log" claim="Retry to read it." onRetry={() => setTick((t) => t + 1)} />
        : sent === null ? <p className={`mt-2 ${MUTED}`}>Reading the sent log…</p>
        : sent.items.length === 0 ? <p className={`mt-2 ${BODY}`}>Nothing sent yet.</p>
        : <ul className="mt-2 flex flex-col divide-y divide-axal-hairline dark:divide-gray-700">{sent.items.map((r) => <li key={r.uid} className="flex flex-col gap-0.5 py-2" data-testid="sent-row">
            <span className={BODY}><span className="font-mono text-[12px]">{String(r.sent_at ?? r.created_at ?? '').slice(0, 16).replace('T', ' · ')}</span> · {r.to} · {r.subject}</span>
            <span className={`text-[12px] ${r.status === 'failed' ? 'text-red-700 dark:text-red-300' : MUTED}`}>{r.status === 'failed' ? `Not sent: ${r.error || 'the mail server refused it.'}` : quotedLine(r)}</span>
          </li>)}</ul>}
      {sent && sent.total > sent.per_page && <div className="mt-2 flex gap-2">
        <button type="button" className={BTN} disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
        <button type="button" className={BTN} disabled={page * sent.per_page >= sent.total} onClick={() => setPage(page + 1)}>Older</button></div>}
    </section>

    {leaving && <Lightbox title={`Disconnect ${leaving.address}?`} label="Disconnect mailbox" onClose={() => setLeaving(null)} width={480} testId="mailbox-disconnect"
      footer={<div className="flex justify-end gap-2"><button type="button" className={BTN} onClick={() => setLeaving(null)}>Cancel</button>
        <button type="button" className={DANGER} onClick={disconnect}>Disconnect</button></div>}>
      <p className={BODY}>Axal VC stops sending from this address at once. You keep the sent log and your drafts. Nothing is deleted from your mailbox.</p>
    </Lightbox>}
  </div>;
}
