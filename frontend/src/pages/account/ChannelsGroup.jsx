import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { channelsApi } from '../../lib/api/channels.js';
import { Pill, Unreadable } from '../../ui';
import { BTN } from './AccountCenter';
import {
  CARD_TITLE, CHANNELS_HREF, INBOX_HREF, MEETING_NOTES, PROVIDER_LABEL, TELEGRAM_LIMITS, WHATSAPP_CALLS, WHATSAPP_NOTES,
  channelCard, disconnectNote, meetingCard, pendingLabel, pendingTotal, readOverview, telegramLinkView,
  telegramSteps, testOutcome, whatsappSignupConfig,
} from './channelsModel';
import { SignupError, loadFacebookSdk, runEmbeddedSignup } from './whatsappSignup';

/**
 * D684 (#1575, S02 #1578) — Connectors' "Customer conversations" group: a
 * card each for Telegram Business, WhatsApp Business, Zoom and Google Meet.
 * Every member can connect them here; an interview's Connect panel draws the
 * same Telegram and WhatsApp cards (`TelegramChannelCard`,
 * `WhatsAppChannelCard`) to connect in place.
 *
 * Customer chats arrive as conversations waiting in `/validate/inbox`;
 * nothing reaches an interview until the member assigns it. Zoom and Meet
 * calls are scheduled from an interview, and their transcripts come in after.
 *
 * The rules (states, words, the Telegram link, WhatsApp's signup config) are
 * `channelsModel.js`; Meta's Embedded Signup is `whatsappSignup.js`.
 */

const TONE = 'rounded-axal-sm border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const SMALL = 'rounded-md border border-axal-hairline px-2.5 py-1 text-[12px] font-bold text-axal-ink hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const NOTE = 'text-[12px] leading-snug text-axal-muted dark:text-gray-400';

/** `GET /api/channels`, read and normalised; `reload` reads it again and keeps the last answer on screen meanwhile. */
export function useChannelsOverview(api = channelsApi) {
  const [state, setState] = useState({ status: 'loading', overview: null });
  const load = useCallback(() => {
    api.overview().then(
      (r) => { const overview = readOverview(r); setState({ status: overview ? 'ready' : 'unreadable', overview }); },
      () => setState({ status: 'unreadable', overview: null }),
    );
  }, [api]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

function Outcome({ outcome }) {
  if (!outcome?.text) return null;
  const bad = outcome.tone === 'error';
  return <p role={bad ? 'alert' : 'status'} className={`text-[12px] ${bad ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{outcome.text}</p>;
}

function CardFrame({ card, children }) {
  return (
    <article className={`${TONE} flex min-w-0 flex-col gap-2.5 p-4`} data-testid={`channel-card-${card.provider}`} data-state={card.state}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{CARD_TITLE[card.provider]}</h4>
          {card.account && <p className="truncate text-[12px] text-axal-muted dark:text-gray-400" data-testid={`channel-account-${card.provider}`}>{card.account}</p>}
        </div>
        <Pill tone={card.tone}>{card.label}</Pill>
      </div>
      {card.why && <p className={`text-[12.5px] leading-snug ${card.state === 'problem' ? 'text-amber-800 dark:text-amber-300' : 'text-axal-ink/80 dark:text-gray-300'}`}>{card.why}</p>}
      {card.note && <p className={NOTE}>{card.note}</p>}
      {children}
    </article>
  );
}

function PendingLink({ n }) {
  const label = pendingLabel(n);
  if (!label) return null;
  return <Link to={INBOX_HREF} className={BTN.link} data-testid="channel-pending-link">{label} · Open the inbox</Link>;
}

/** Send test and Disconnect, on a connected messaging card. Disconnect asks first. */
export function ConnectedActions({ provider, api = channelsApi, onChanged, initialConfirming = false }) {
  const [confirming, setConfirming] = useState(initialConfirming);
  const [busy, setBusy] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const name = PROVIDER_LABEL[provider];
  const test = async () => {
    setBusy('test'); setOutcome(null);
    try { const r = await api.test(provider); setOutcome({ tone: 'ok', text: testOutcome(provider, r) }); }
    catch (e) { setOutcome({ tone: 'error', text: e?.message || 'The test could not be sent. Try again in a minute.' }); }
    finally { setBusy(null); }
  };
  const disconnect = async () => {
    setBusy('disconnect'); setOutcome(null);
    try { await api.disconnect(provider); setConfirming(false); onChanged?.(); }
    catch (e) { setOutcome({ tone: 'error', text: e?.message || `${name} could not be disconnected. Try again.` }); }
    finally { setBusy(null); }
  };
  return (
    <div className="flex flex-col gap-1.5">
      {confirming ? (
        <div className="flex flex-col gap-1.5" data-testid={`channel-disconnect-confirm-${provider}`}>
          <p className={NOTE}>Disconnect {name}? {disconnectNote(provider)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN.dangerSolid} disabled={busy === 'disconnect'} onClick={disconnect} data-testid={`button-channel-disconnect-yes-${provider}`}>{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}</button>
            <button type="button" className={BTN.ghost} onClick={() => setConfirming(false)}>Keep</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN.ghost} disabled={!!busy} onClick={test} data-testid={`button-channel-test-${provider}`}>{busy === 'test' ? 'Testing…' : provider === 'whatsapp' ? 'Test the connection' : 'Send test'}</button>
          <button type="button" className={BTN.danger} onClick={() => setConfirming(true)} data-testid={`button-channel-disconnect-${provider}`}>Disconnect</button>
        </div>
      )}
      <Outcome outcome={outcome} />
    </div>
  );
}

/** The step after "Link Telegram": the link to open, when it stops working, and what to do in Telegram. */
export function TelegramLinkSteps({ link, now = Date.now(), onCheck, onAgain, copy = (t) => navigator.clipboard?.writeText(t) }) {
  const [copied, setCopied] = useState(false);
  const view = telegramLinkView(link, now);
  if (!view.href) return <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">Axal could not make a Telegram link. Try again.</p>;
  if (view.expired) {
    return (
      <div className="flex flex-col items-start gap-1.5" data-testid="telegram-link-expired">
        <p className={NOTE}>That link has expired. Make a new one.</p>
        <button type="button" className={BTN.primary} onClick={onAgain}>Make a new link</button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="telegram-link">
      <div className="flex flex-wrap items-center gap-2">
        <a href={view.href} target="_blank" rel="noopener noreferrer" className={BTN.primary} data-testid="link-open-telegram">Open Telegram</a>
        <button type="button" className={SMALL} onClick={async () => { try { await copy(view.href); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'Copied' : 'Copy link for your phone'}</button>
      </div>
      {view.expires && <p className={NOTE} data-testid="telegram-link-expires">{view.expires}</p>}
      <ol className="list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed text-axal-ink/90 dark:text-gray-300">
        {telegramSteps(view.bot).map((s) => <li key={s}>{s}</li>)}
      </ol>
      {onCheck && <button type="button" className={`${SMALL} self-start`} onClick={onCheck} data-testid="button-telegram-check">I’ve done this. Check again</button>}
    </div>
  );
}

export function TelegramChannelCard({ card, pending = null, api = channelsApi, onChanged, initialLink = null, now }) {
  const [link, setLink] = useState(initialLink);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Back from Telegram: read the connection again when the tab regains focus.
  useEffect(() => {
    if (!link || typeof window === 'undefined' || !onChanged) return undefined;
    const on = () => onChanged();
    window.addEventListener('focus', on);
    return () => window.removeEventListener('focus', on);
  }, [link, onChanged]);
  const makeLink = async () => {
    setBusy(true); setError('');
    try { setLink(await api.linkTelegram()); }
    catch (e) { setError(e?.message || 'Axal could not make a Telegram link. Try again in a minute.'); }
    finally { setBusy(false); }
  };
  return (
    <CardFrame card={card}>
      {card.state === 'not_connected' && !link && (
        <button type="button" className={`${BTN.primary} self-start`} disabled={busy} onClick={makeLink} data-testid="button-link-telegram">{busy ? 'Making a link…' : 'Link Telegram'}</button>
      )}
      {card.state === 'not_connected' && link && <TelegramLinkSteps link={link} now={now} onCheck={onChanged} onAgain={makeLink} />}
      {card.state === 'linked' && (
        <>
          <ol className="list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed text-axal-ink/90 dark:text-gray-300">
            {telegramSteps(null).slice(1).map((s) => <li key={s}>{s}</li>)}
          </ol>
          {onChanged && <button type="button" className={`${SMALL} self-start`} onClick={onChanged} data-testid="button-telegram-check">I’ve done this. Check again</button>}
        </>
      )}
      {(card.state === 'connected' || card.state === 'linked' || card.state === 'problem') && (
        <>
          <PendingLink n={pending} />
          <ConnectedActions provider="telegram" api={api} onChanged={onChanged} />
        </>
      )}
      {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{error}</p>}
      <ul className="space-y-0.5 text-[11.5px] leading-snug text-axal-muted dark:text-gray-400" data-testid="telegram-limits">
        {TELEGRAM_LIMITS.map((s) => <li key={s}>{s}</li>)}
      </ul>
    </CardFrame>
  );
}

const SDK = { load: loadFacebookSdk, run: runEmbeddedSignup };

/**
 * "Connect WhatsApp Business": Meta's SDK loads on this click and no earlier.
 * Meta's window must open straight from a click, or the browser blocks it, so
 * a first load ends on "Continue with Facebook" and that second click opens it.
 */
export function WhatsAppChannelCard({ card, overview, pending = null, api = channelsApi, onChanged, sdk = SDK }) {
  const config = whatsappSignupConfig(overview);
  const fb = useRef(null);
  const [phase, setPhase] = useState('idle'); // idle | loading | ready | signing | connecting
  const [outcome, setOutcome] = useState(null);

  const sign = () => {
    setPhase('signing'); setOutcome(null);
    sdk.run({ FB: fb.current, configId: config.configId })
      .then(async (result) => {
        setPhase('connecting');
        await api.connectWhatsApp(result);
        setPhase('idle');
        setOutcome({ tone: 'ok', text: 'WhatsApp Business is connected.' });
        onChanged?.();
      })
      .catch((e) => {
        setPhase(fb.current ? 'ready' : 'idle');
        setOutcome({ tone: 'error', text: e instanceof SignupError ? e.message : (e?.message || 'WhatsApp could not be connected. Nothing was saved. Try again.') });
      });
  };
  const start = async () => {
    if (!config) return;
    if (fb.current) { sign(); return; }
    setPhase('loading'); setOutcome(null);
    try {
      fb.current = await sdk.load({ appId: config.appId, ...(config.version ? { version: config.version } : {}) });
      setPhase('ready');
    } catch (e) {
      setPhase('idle');
      setOutcome({ tone: 'error', text: e?.message || 'Meta’s sign-up window could not load. Try again.' });
    }
  };

  const busy = phase === 'loading' || phase === 'signing' || phase === 'connecting';
  const label = { loading: 'Opening Meta…', signing: 'Finish in Meta’s window…', connecting: 'Connecting…', ready: 'Continue with Facebook' }[phase] || 'Connect WhatsApp Business';
  return (
    <CardFrame card={card}>
      {card.state === 'not_connected' && (
        <div className="flex flex-col items-start gap-1.5">
          <button type="button" className={BTN.primary} disabled={!config || busy} onClick={start} data-testid="button-connect-whatsapp">{label}</button>
          {!config && <p className={NOTE} data-testid="whatsapp-not-configured">Not set up yet: Meta’s sign-up is not configured on Axal.</p>}
          {phase === 'ready' && <p className={NOTE}>Meta’s window opens next. Log in with the Facebook account that manages your business.</p>}
          <ul className="space-y-0.5 text-[12px] leading-snug text-axal-ink/80 dark:text-gray-300">
            {WHATSAPP_NOTES.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
      )}
      {(card.state === 'connected' || card.state === 'problem') && (
        <>
          <PendingLink n={pending} />
          <ConnectedActions provider="whatsapp" api={api} onChanged={onChanged} />
        </>
      )}
      <Outcome outcome={outcome} />
      <p className="text-[11.5px] font-semibold text-axal-muted dark:text-gray-400" data-testid="whatsapp-calls">{card.calls || `${WHATSAPP_CALLS}.`} WhatsApp calls do not reach Axal; record a call with the in-app recorder instead.</p>
    </CardFrame>
  );
}

/** Zoom and Google Meet: connected through the existing connector sheet, scheduled from an interview. */
export function MeetingChannelCard({ card, onOpenConnector }) {
  const name = PROVIDER_LABEL[card.provider];
  const via = card.provider === 'google_meet' ? 'Google Calendar' : 'Zoom';
  return (
    <CardFrame card={card}>
      {card.state === 'not_connected' && card.connectorKey && (
        onOpenConnector
          ? <button type="button" className={`${BTN.primary} self-start`} onClick={() => onOpenConnector(card.connectorKey)} data-testid={`button-connect-${card.provider}`}>Connect {via}</button>
          : <Link to={CHANNELS_HREF} className={`${BTN.primary} self-start`}>Connect {via} in Connectors</Link>
      )}
      {(card.state === 'connected' || card.state === 'problem') && card.connectorKey && onOpenConnector && (
        <button type="button" className={`${BTN.ghost} self-start`} onClick={() => onOpenConnector(card.connectorKey)} data-testid={`button-manage-${card.provider}`}>{`Manage or disconnect ${via}`}</button>
      )}
      <p className={NOTE}>{MEETING_NOTES[card.provider]}</p>
      {card.state === 'connected' && <p className={NOTE}>Test it by scheduling a {name} call from an interview.</p>}
    </CardFrame>
  );
}

/** The group, drawn from one read; exported so a test can hand it each state. */
export function ChannelsGroup({ status, overview, catalogue = [], api = channelsApi, onChanged, onOpenConnector, sdk }) {
  const total = pendingTotal(overview);
  return (
    <section className="flex min-w-0 flex-col gap-3" id="interview-channels" data-testid="connectors-section-Customer conversations">
      <div>
        <h3 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Customer conversations</h3>
        <p className="text-[13px] text-axal-muted dark:text-gray-400">Bring chats from your business Telegram and WhatsApp, and the transcripts of Zoom and Google Meet calls you schedule, into Validate › Interviews. Chats wait in your inbox until you assign each one to an interview; nothing is added on its own.</p>
        {total ? <p className="mt-1"><PendingLink n={total} /></p> : null}
      </div>
      {status === 'loading' && !overview && <div className={`${TONE} p-4 text-[13px] text-axal-muted dark:text-gray-400`}>Reading your connections…</div>}
      {!overview && status !== 'loading' && (
        <div className={`${TONE} p-4`} data-testid="channels-unreadable"><Unreadable what="Your customer conversation connections" claim="This is not a claim that you have none." onRetry={onChanged} /></div>
      )}
      {overview && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <TelegramChannelCard card={channelCard('telegram', overview)} pending={overview.pending?.telegram ?? null} api={api} onChanged={onChanged} />
          <WhatsAppChannelCard card={channelCard('whatsapp', overview)} overview={overview} pending={overview.pending?.whatsapp ?? null} api={api} onChanged={onChanged} sdk={sdk} />
          <MeetingChannelCard card={meetingCard('zoom', overview, catalogue)} onOpenConnector={onOpenConnector} />
          <MeetingChannelCard card={meetingCard('google_meet', overview, catalogue)} onOpenConnector={onOpenConnector} />
        </div>
      )}
    </section>
  );
}

/** Mounted on Connectors: reads `GET /api/channels` and hands the catalogue's Zoom and Google entries on. */
export function ChannelsSection({ catalogue, onOpenConnector, api = channelsApi }) {
  const { status, overview, reload } = useChannelsOverview(api);
  return <ChannelsGroup status={status} overview={overview} catalogue={catalogue} api={api} onChanged={reload} onOpenConnector={onOpenConnector} />;
}

export default ChannelsGroup;
