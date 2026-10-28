/**
 * D1344 — Connect your mailbox (EM1), the consent sheet before Google or
 * Microsoft (EM1b, without "Save drafts to your Gmail drafts": D1347 §3), the
 * IMAP and SMTP form, and the outcome the OAuth callback returns to
 * (`?mail=connected|declined|expired|failed`, EM1c and EM1d).
 *
 * A card is drawn only for a provider `GET /api/mail/accounts` offers. The MCP
 * card sends the member to their custom connectors: a send tool is chosen
 * there (D1343).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../ui/Sheet';
import { mailApi } from '../../lib/api/mail.js';
import { offeredProviders } from './emailModel.js';
import { BODY, BTN, CARD, ERROR, EYEBROW, H3, INPUT, MUTED, PRIMARY } from './emailParts.jsx';

const OUTCOME = {
  connected: { ok: true, title: 'Your mailbox is connected', line: 'Email now sends from your own address, only when you press Send.' },
  declined: { ok: false, title: 'The connection was refused', line: 'You declined access on the provider’s screen, so nothing was connected. Axal VC can’t send from that mailbox until you allow it.' },
  expired: { ok: false, title: 'The sign-in took too long', line: 'The sign-in link expired before you finished. Nothing was connected. Try again.' },
  failed: { ok: false, title: 'The mailbox could not be connected', line: 'Nothing was connected. Try again, or choose another mailbox.' },
};

const CONSENT = {
  gmail: { name: 'Gmail', can: ['Send email you have approved, from your Gmail address.'], cannot: ['Read your inbox or any email you didn’t send from here.', 'Send anything without your press.'], next: 'Next, Google asks you to confirm.' },
  outlook: { name: 'Outlook', can: ['Send email you have approved, from your Outlook address.', 'Show replies from the people you write to here, if you allow it.'], cannot: ['Read any other conversation.', 'Send anything without your press.'], next: 'Next, Microsoft asks you to confirm.' },
};

export function ConnectOutcome({ outcome }) {
  const o = OUTCOME[outcome];
  if (!o) return null;
  return <div className={CARD} role="status" data-testid="mail-outcome">
    <span className={`inline-flex rounded-axal-pill border px-2 py-0.5 text-[11px] font-bold ${o.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'}`}>{o.ok ? 'Connected' : 'Not connected'}</span>
    <h3 className={`mt-2 ${H3}`}>{o.title}</h3>
    <p className={`mt-1 ${BODY}`}>{o.line}</p>
  </div>;
}

export default function ConnectPanel({ providers, onConnected, api = mailApi }) {
  const [consent, setConsent] = useState(null);
  const [imap, setImap] = useState(false);
  const cards = offeredProviders(providers);
  return <section className={CARD} data-testid="mail-connect">
    <h3 className={H3}>Connect your mailbox</h3>
    <p className={`mt-1 ${BODY}`}>Email sends from your own address. Axal VC never sends anything until you press Send, and you can disconnect at any time.</p>
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {cards.map((p) => <div key={p.key} className="flex flex-col gap-1 rounded-axal-md border border-axal-hairline p-3 dark:border-gray-700" data-testid={`mail-provider-${p.key}`}>
        <span className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{p.name}</span>
        <span className={BODY}>{p.can}</span>
        <span className={`text-[12.5px] ${MUTED}`}>{p.cannot}</span>
        <span className={EYEBROW}>{p.how}</span>
        {p.key === 'mcp'
          ? <Link to="/connectors" className={`mt-1 w-fit ${BTN}`}>Choose a send tool</Link>
          : <button type="button" className={`mt-1 w-fit ${BTN}`} onClick={() => (p.key === 'imap' ? setImap(true) : setConsent(p.key))}>Connect</button>}
      </div>)}
    </div>
    {consent && <ConsentSheet provider={consent} onClose={() => setConsent(null)} api={api} />}
    {imap && <ImapSheet onClose={() => setImap(false)} onConnected={(a) => { setImap(false); onConnected?.(a); }} api={api} />}
  </section>;
}

function ConsentSheet({ provider, onClose, api }) {
  const c = CONSENT[provider];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    setBusy(true); setError(null);
    try { const r = await api.connect(provider); if (r?.authorize_url) window.location.assign(r.authorize_url); }
    catch (e) { setError(e?.message || 'The sign-in could not start. Try again.'); setBusy(false); }
  };
  return <Sheet title={`Connect ${c.name}`} sub={`What Axal VC can do with ${c.name}`} onClose={onClose} width={560} testId="mail-consent"
    footer={<div className="flex justify-end gap-2"><button type="button" className={BTN} onClick={onClose}>Cancel</button>
      <button type="button" className={PRIMARY} disabled={busy} onClick={go}>Continue to {provider === 'gmail' ? 'Google' : 'Microsoft'}</button></div>}>
    <div className="flex flex-col gap-3">
      <section><span className={EYEBROW}>Axal VC will be able to</span><ul className={`mt-1 list-disc pl-5 ${BODY}`}>{c.can.map((t) => <li key={t}>{t}</li>)}</ul></section>
      <section><span className={EYEBROW}>Axal VC will not</span><ul className={`mt-1 list-disc pl-5 ${BODY}`}>{c.cannot.map((t) => <li key={t}>{t}</li>)}</ul></section>
      <p className={`text-[12.5px] ${MUTED}`}>{c.next} You can disconnect in Email settings at any time.</p>
      {error && <p className={ERROR} role="alert">{error}</p>}
    </div>
  </Sheet>;
}

const BLANK = { address: '', display_name: '', username: '', password: '', smtp_host: '', smtp_port: '465', smtp_tls: 'tls', imap_host: '', imap_port: '993', imap_tls: 'tls' };

function ImapSheet({ onClose, onConnected, api }) {
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.connectImap({ ...f, smtp_port: Number(f.smtp_port), imap_port: Number(f.imap_port), display_name: f.display_name || undefined });
      onConnected?.(r?.account ?? null);
    } catch (e) { setError(e?.message || 'Your mail server refused the sign-in. Use an app password from your provider, not your main password.'); }
    finally { setBusy(false); setF((x) => ({ ...x, password: '' })); }
  };
  const field = (k, label, type = 'text') => <label className="flex flex-col gap-1" key={k}><span className={EYEBROW}>{label}</span>
    <input className={INPUT} type={type} value={f[k]} onChange={set(k)} autoComplete={type === 'password' ? 'off' : undefined} /></label>;
  return <Sheet title="Connect another mailbox" sub="IMAP and SMTP, with an app password" onClose={onClose} width={560} testId="mail-imap"
    footer={<div className="flex justify-end gap-2"><button type="button" className={BTN} onClick={onClose}>Cancel</button>
      <button type="button" className={PRIMARY} disabled={busy || !f.address || !f.username || !f.password || !f.smtp_host || !f.imap_host} onClick={save}>Check and connect</button></div>}>
    <div className="flex flex-col gap-3">
      <p className={`text-[12.5px] ${MUTED}`}>Axal VC checks the sign-in on both servers and sends nothing. Use an app password from your provider, never your main password. Port 25 is refused.</p>
      {field('address', 'Address you send from', 'email')}{field('display_name', 'Name shown to recipients (optional)')}
      {field('username', 'Username')}{field('password', 'App password', 'password')}
      <div className="grid grid-cols-2 gap-2">{field('smtp_host', 'SMTP server')}{field('smtp_port', 'SMTP port', 'number')}</div>
      <div className="grid grid-cols-2 gap-2">{field('imap_host', 'IMAP server')}{field('imap_port', 'IMAP port', 'number')}</div>
      {error && <p className={ERROR} role="alert">{error}</p>}
    </div>
  </Sheet>;
}
