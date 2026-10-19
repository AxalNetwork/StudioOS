import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { channelsApi } from '../../lib/api/channels.js';
import { Pill } from '../../ui';
import { BTN } from './AccountCenter';
import {
  WAY_B, WHATSAPP_ENTRY_CONSENT, WHATSAPP_ENTRY_LIMIT, WHATSAPP_ENTRY_STEPS, WHATSAPP_PAGE_HREF,
  axalContact, captureLine, lastUsedLine, waitingCaptures, wayBRefusal, wayBState,
} from './whatsappWayB';

/**
 * D754 way B (#1939, task fb) — "Send recordings from your WhatsApp" on
 * WhatsApp's page, drawn in `WhatsAppPageBody`'s `wayB` slot, and the "From
 * WhatsApp" entry in Record a Session. The member's own WhatsApp is linked
 * through Axal's number with a one-time code (wb1, `/channels/whatsapp/link`):
 * WhatsApp sends `LINK <code>`, then the member confirms the masked number
 * here. The rules and words are `whatsappWayB.js`.
 *
 * While Axal's number is not set up, every wb1 route answers 503 and the
 * section is not drawn; a Super Admin sees the setting names, never a value.
 */

const TONE = 'rounded-axal-sm border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const SMALL = 'rounded-md border border-axal-hairline px-2.5 py-1 text-[12px] font-bold text-axal-ink hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const NOTE = 'text-[12px] leading-snug text-axal-muted dark:text-gray-400';
const ALERT = 'text-[12px] text-red-700 dark:text-red-300';

/** `GET /channels/whatsapp/link`, read once and again on `reload`. */
export function useWhatsAppLink(api = channelsApi, { enabled = true } = {}) {
  const [read, setRead] = useState({ status: 'loading' });
  const reload = useCallback(() => {
    if (!enabled) return Promise.resolve();
    return Promise.resolve().then(() => api.whatsappLinkView())
      .then((view) => setRead({ status: 'ready', view: view || {} }))
      .catch((error) => setRead({ status: 'error', error }));
  }, [api, enabled]);
  useEffect(() => { reload(); }, [reload]);
  return { read, reload };
}

/** The section on WhatsApp's page, in every way-B state for this viewer. */
export function WhatsAppWayBSection({ read, user = null, api = channelsApi, onChanged, initialCode = null, now }) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const view = wayBState(read, { user, code, now: now ?? Date.now() });
  // Back from WhatsApp: read the link again when the tab regains focus.
  useEffect(() => {
    if (view.state !== 'linking' || typeof window === 'undefined' || !onChanged) return undefined;
    const on = () => onChanged();
    window.addEventListener('focus', on);
    return () => window.removeEventListener('focus', on);
  }, [view.state, onChanged]);
  const act = async (which, run, fallback) => {
    setBusy(which); setError(''); setDone('');
    try { return await run(); }
    catch (e) { setError(wayBRefusal(e, fallback)); return null; }
    finally { setBusy(''); onChanged?.(); }
  };
  const makeCode = () => act('link', async () => setCode(await api.whatsappLink()), 'Axal could not make a code. Try again in a minute.');
  const confirm = () => act('confirm', async () => {
    const r = await api.confirmWhatsAppLink(view.uid);
    if (r?.linked === true) { setCode(null); setDone('Your WhatsApp is linked.'); }
  }, 'Axal could not confirm this number. Try again in a minute.');
  const unlink = () => act('unlink', async () => {
    const r = await api.unlinkWhatsApp();
    setCode(null);
    if (r?.unlinked) setDone('Your WhatsApp is unlinked. Axal no longer saves what it sends.');
  }, 'Axal could not unlink your WhatsApp. Try again in a minute.');

  if (view.state === 'loading') return null;
  if (view.state === 'hidden') {
    return view.notice
      ? <p className="rounded-[10px] border border-amber-300/60 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200" data-testid="way-b-unset">{view.notice}</p>
      : null;
  }
  const pill = { unreadable: 'Status unreadable', not_linked: 'Not linked', linking: 'Waiting for WhatsApp', confirm: 'Confirm your number', linked: 'Linked' }[view.state];
  return (
    <article className={`${TONE} flex min-w-0 flex-col gap-2.5 p-4`} data-testid="way-b" data-state={view.state}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{WAY_B.heading}</h3>
          {view.state === 'linked' && view.number && <p className="truncate text-[12px] text-axal-muted dark:text-gray-400" data-testid="way-b-number">{view.number}</p>}
        </div>
        <Pill tone={view.state === 'linked' ? 'ok' : 'neutral'}>{pill}</Pill>
      </div>
      {view.state === 'unreadable' && (
        <>
          <p className="text-[12.5px] leading-snug text-axal-ink/80 dark:text-gray-300" data-testid="way-b-why">{view.why}</p>
          {onChanged && <button type="button" className={`${BTN.ghost} self-start`} onClick={onChanged}>Retry</button>}
        </>
      )}
      {view.state === 'not_linked' && (
        <>
          <p className="text-[12.5px] leading-snug text-axal-ink/80 dark:text-gray-300">{WAY_B.intro}</p>
          {view.why && <p className={NOTE} data-testid="way-b-why">{view.why}</p>}
          <button type="button" className={`${BTN.primary} self-start`} disabled={busy === 'link'} onClick={makeCode} data-testid="button-way-b-link">{busy === 'link' ? 'Making a code…' : WAY_B.link}</button>
        </>
      )}
      {view.state === 'linking' && (
        <div className="flex flex-col gap-2" data-testid="way-b-code">
          <p className="text-[12.5px] text-axal-ink dark:text-gray-100">
            Send this code to Axal on WhatsApp: <code className="break-all font-mono text-[12px]" data-testid="way-b-code-text">{`LINK ${view.code}`}</code>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <a href={view.href} target="_blank" rel="noopener noreferrer" className={BTN.primary} data-testid="link-way-b-open">{WAY_B.open}</a>
            {onChanged && <button type="button" className={SMALL} onClick={onChanged} data-testid="button-way-b-check">I’ve sent it. Check again</button>}
          </div>
          <p className={NOTE} data-testid="way-b-expires">{view.expires}</p>
        </div>
      )}
      {view.state === 'confirm' && (
        <div className="flex flex-col gap-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700" data-testid="way-b-confirm">
          <p className="text-[12.5px] text-axal-ink dark:text-gray-100" data-testid="way-b-confirm-question">{`Is ${view.number} your number?`}</p>
          <button type="button" className={`${BTN.primary} self-start`} disabled={busy === 'confirm'} onClick={confirm} data-testid="button-way-b-confirm">{busy === 'confirm' ? 'Confirming…' : WAY_B.confirm}</button>
        </div>
      )}
      {view.state === 'linked' && (
        <>
          <p className={NOTE} data-testid="way-b-last">{lastUsedLine(view.lastUsedAt)}</p>
          <p className={NOTE} data-testid="way-b-sends">{WAY_B.sends}</p>
          <WaitingCaptures api={api} />
          <button type="button" className={`${SMALL} self-start`} disabled={busy === 'unlink'} onClick={unlink} data-testid="button-way-b-unlink">{busy === 'unlink' ? 'Unlinking…' : WAY_B.unlink}</button>
        </>
      )}
      {done && <p role="status" className="text-[12px] text-emerald-700 dark:text-emerald-300" data-testid="way-b-done">{done}</p>}
      {error && <p role="alert" className={ALERT} data-testid="way-b-error">{error}</p>}
    </article>
  );
}

/**
 * #1939 step 3: the recordings a linked member forwarded that still wait for
 * consent (wb2's `GET /channels/whatsapp/captures`), each with **Agreed
 * beforehand**. A waiting capture has no session yet (it gets one when it is
 * imported), so it is answered here. A read that fails draws nothing: the
 * chat's own Yes still works.
 */
export function WaitingCaptures({ api = channelsApi, initial = null }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const reload = useCallback(() => Promise.resolve().then(() => api.whatsappCaptures())
    .then((r) => setItems(waitingCaptures(r?.items)))
    .catch(() => setItems([])), [api]);
  useEffect(() => { if (initial == null) reload(); }, [reload, initial]);
  const agree = async (uid) => {
    setBusy(uid); setError('');
    try { await api.agreeCapture(uid); }
    catch (e) { setError(wayBRefusal(e, 'Axal could not record that. Answer in the WhatsApp chat instead.')); }
    finally { setBusy(''); await reload(); }
  };
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-axal-hairline p-3 dark:border-gray-700" data-testid="way-b-waiting">
      <p className="text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{WAY_B.waiting}</p>
      <ul className="flex flex-col gap-1.5">
        {items.map((c) => (
          <li key={c.uid} className="flex flex-wrap items-center justify-between gap-2" data-testid={`way-b-capture-${c.uid}`}>
            <span className={NOTE}>{captureLine(c)}</span>
            <button type="button" className={SMALL} disabled={busy === c.uid} onClick={() => agree(c.uid)} data-testid={`button-way-b-agreed-${c.uid}`}>
              {busy === c.uid ? 'Saving…' : WAY_B.agreed}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className={ALERT} data-testid="way-b-waiting-error">{error}</p>}
    </div>
  );
}

/** WhatsApp's page mounts this: its own read of the link, and the section. */
export function WhatsAppWayB({ user = null, api = channelsApi }) {
  const { read, reload } = useWhatsAppLink(api);
  return <WhatsAppWayBSection read={read} user={user} api={api} onChanged={reload} />;
}

/**
 * Record a Session's "From WhatsApp", beside "From an AI assistant": fb's
 * three steps, the 5 MB limit, the consent line, and Axal's number with
 * **Open WhatsApp** (#1939: `axal_number` and `axal_link`). `read` is the same
 * link read; while Axal's number is not set up the entry says so and offers nothing.
 */
export function WhatsAppEntry({ read }) {
  const view = wayBState(read);
  const contact = read?.status === 'ready' ? axalContact(read.view) : null;
  if (view.state === 'loading') return <section className="border-b border-axal-hairline px-5 py-4 dark:border-gray-800" data-testid="whatsapp-entry" data-state="loading"><p className="m-0 text-[12px] text-axal-faint">Reading your WhatsApp link…</p></section>;
  return (
    <section className="border-b border-axal-hairline px-5 py-4 dark:border-gray-800" data-testid="whatsapp-entry" data-state={view.state}>
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-axal-faint">From WhatsApp</h3>
      {view.state === 'hidden'
        ? <p className="m-0 text-[12.5px] text-gray-700 dark:text-gray-300" data-testid="whatsapp-entry-off">Sending recordings from WhatsApp is not available yet.</p>
        : (
          <>
            <ol className="list-decimal space-y-1 pl-4 text-[12.5px] text-gray-700 dark:text-gray-300">
              {WHATSAPP_ENTRY_STEPS.map((s) => <li key={s}>{s}</li>)}
            </ol>
            <p className="mt-2 text-[12px] text-gray-700 dark:text-gray-300" data-testid="whatsapp-entry-limit">{WHATSAPP_ENTRY_LIMIT}</p>
            <p className="mt-1 text-[12px] font-semibold text-amber-800 dark:text-amber-300" data-testid="whatsapp-entry-consent">{WHATSAPP_ENTRY_CONSENT}</p>
            {contact && (
              <p className="mt-2 text-[12px] text-gray-700 dark:text-gray-300" data-testid="whatsapp-entry-number">
                Axal’s number: <span className="font-semibold tabular-nums">{contact.number}</span>
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {contact && <a href={contact.href} target="_blank" rel="noopener noreferrer" className="rounded-md border border-gray-200 px-3 py-1.5 text-[12px] font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800" data-testid="link-whatsapp-entry-open">{WAY_B.open}</a>}
              {view.state === 'linked'
                ? <span className="text-[12px] text-gray-700 dark:text-gray-300" data-testid="whatsapp-entry-linked">{view.number ? `Linked: ${view.number}` : 'Your WhatsApp is linked.'}</span>
                : <Link to={WHATSAPP_PAGE_HREF} className="rounded-md bg-violet-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-800" data-testid="link-whatsapp-page">{WAY_B.link}</Link>}
            </div>
          </>
        )}
    </section>
  );
}

export default WhatsAppWayB;
