import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { channelsApi } from '../../lib/api/channels.js';
import { BrandIcon, Pill, Unreadable } from '../../ui';
import { BTN } from './AccountCenter';
import {
  CARD_TITLE, CHANNELS_HREF, INBOX_HREF, MEETING_NOTES, PROVIDER_LABEL, TELEGRAM_LIMITS, WHATSAPP_CALLS, WHATSAPP_NOTES,
  WHATSAPP_PAGE, WHATSAPP_SIGNUP_NOT_CONFIGURED, whatsappPageState,
  channelCard, disconnectNote, meetingCard, pendingLabel, pendingTotal, readOverview, telegramLinkView,
  telegramSteps, testOutcome, whatsappSignupConfig,
  telegramClaimView, telegramConfirmRefusal,
} from './channelsModel';
import { SignupError, loadFacebookSdk, runEmbeddedSignup } from './whatsappSignup';
import { connectorPagePath } from './connectorsModel';

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
 *
 * D753 C1 (#1958): on the hub, the Telegram and WhatsApp cards' titles link
 * to their own pages (`/account/connectors/telegram`, `/whatsapp`), which
 * mount the same cards in the connector page frame (`ChannelPage.jsx`). An
 * interview's Connect panel passes no `pageHref`, so its cards stay inline.
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

function CardFrame({ card, pageHref = null, children }) {
  return (
    <article className={`${TONE} flex min-w-0 flex-col gap-2.5 p-4`} data-testid={`channel-card-${card.provider}`} data-state={card.state}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* D687: Google Meet draws its own mark, though it connects through the Google connection. */}
          <BrandIcon provider={card.provider} name={CARD_TITLE[card.provider]} />
          <div className="min-w-0">
            <h4 className="text-[14px] font-bold text-axal-ink dark:text-gray-100">
              {pageHref
                ? <Link to={pageHref} className="hover:underline" data-testid={`channel-page-link-${card.provider}`}>{CARD_TITLE[card.provider]}</Link>
                : CARD_TITLE[card.provider]}
            </h4>
            {card.account && <p className="truncate text-[12px] text-axal-muted dark:text-gray-400" data-testid={`channel-account-${card.provider}`}>{card.account}</p>}
          </div>
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

/**
 * The claimed Telegram account, waiting on both owners (#1625, migration 458):
 * its name and @username exactly as Telegram sent them, where each half
 * stands, and Confirm, Axal's half. Confirm re-reads the overview whatever
 * the answer; a refusal is a sentence, never a code.
 */
export function TelegramClaim({ view, api = channelsApi, onChanged, onAgain, busyAgain = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const confirm = async () => {
    setBusy(true); setError(''); setDone(false);
    try {
      const r = await api.confirmTelegram(view.uid);
      if (r?.linked === true) setDone(true);
    } catch (e) {
      setError(telegramConfirmRefusal(e));
    } finally {
      setBusy(false);
      onChanged?.();
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700" data-testid="telegram-claim">
      <p className="text-[12.5px] text-axal-ink dark:text-gray-100">
        <span className="font-semibold">Claimed by </span>
        {view.who ? <span data-testid="telegram-claim-who">{view.who}</span> : <span className={NOTE}>a Telegram account whose name could not be read</span>}
      </p>
      <p className={NOTE} data-testid="telegram-claim-state">{view.sentence}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-axal-ink/90 dark:text-gray-300" data-testid="telegram-claim-steps">
        {view.steps.map((st) => <li key={st.label}>{`${st.done ? '✓' : '○'} ${st.label}`}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        {view.canConfirm && <button type="button" className={BTN.primary} disabled={busy} onClick={confirm} data-testid="button-telegram-confirm">{busy ? 'Confirming…' : 'Confirm'}</button>}
        {view.stale && onAgain && <button type="button" className={BTN.primary} disabled={busyAgain} onClick={onAgain} data-testid="button-telegram-new-link">Make a new link</button>}
      </div>
      {done && <p role="status" className="text-[12px] text-emerald-700 dark:text-emerald-300" data-testid="telegram-claim-linked">Telegram is linked.</p>}
      {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid="telegram-claim-error">{error}</p>}
    </div>
  );
}

export function TelegramChannelCard({ card, claim = null, pending = null, api = channelsApi, onChanged, initialLink = null, now, pageHref = null }) {
  // A claim still open is drawn whatever the card says (a re-link while
  // connected); an expired or cancelled one only while nothing is connected.
  const view = telegramClaimView(claim);
  const claimed = view && (!view.stale || card.state === 'not_connected') ? view : null;
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
    // A new code replaces the last claim: the overview is read again so the old one goes.
    try { setLink(await api.linkTelegram()); onChanged?.(); }
    catch (e) { setError(e?.message || 'Axal could not make a Telegram link. Try again in a minute.'); }
    finally { setBusy(false); }
  };
  return (
    <CardFrame card={card} pageHref={pageHref}>
      {claimed && <TelegramClaim view={claimed} api={api} onChanged={onChanged} onAgain={() => { setLink(null); makeLink(); }} busyAgain={busy} />}
      {card.state === 'not_connected' && !link && !claimed && (
        <button type="button" className={`${BTN.primary} self-start`} disabled={busy} onClick={makeLink} data-testid="button-link-telegram">{busy ? 'Making a link…' : 'Link Telegram'}</button>
      )}
      {card.state === 'not_connected' && link && !claimed && <TelegramLinkSteps link={link} now={now} onCheck={onChanged} onAgain={makeLink} />}
      {card.state === 'linked' && (
        <>
          <ol className="list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed text-axal-ink/90 dark:text-gray-300">
            {telegramSteps(null).slice(2).map((s) => <li key={s}>{s}</li>)}
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
 * It never redirects (D754 §11: an exception to D753, like Mercury's token
 * form). Shared by the hub card and WhatsApp's page, so the flow is one copy.
 */
export function useWhatsAppSignup({ overview, api = channelsApi, onChanged, sdk = SDK }) {
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
  const label = { loading: 'Opening Meta…', signing: 'Finish in Meta’s window…', connecting: 'Connecting…', ready: 'Continue with Facebook' }[phase] || WHATSAPP_PAGE.connect;
  return { config, phase, busy, label, outcome, start };
}

/** The Connect button, with the step after Meta's SDK has loaded. */
export function WhatsAppConnectButton({ signup, testId = 'button-connect-whatsapp' }) {
  return (
    <>
      <button type="button" className={BTN.primary} disabled={!signup.config || signup.busy} onClick={signup.start} data-testid={testId}>{signup.label}</button>
      {signup.phase === 'ready' && <p className={NOTE}>Meta’s window opens next. Log in with the Facebook account that manages your business.</p>}
    </>
  );
}

function WhatsAppNotes() {
  return (
    <ul className="space-y-0.5 text-[12px] leading-snug text-axal-ink/80 dark:text-gray-300">
      {WHATSAPP_NOTES.map((s) => <li key={s}>{s}</li>)}
    </ul>
  );
}

function WhatsAppCallsLine({ calls }) {
  return <p className="text-[11.5px] font-semibold text-axal-muted dark:text-gray-400" data-testid="whatsapp-calls">{calls || `${WHATSAPP_CALLS}.`} WhatsApp calls do not reach Axal; record a call with the in-app recorder instead.</p>;
}

export function WhatsAppChannelCard({ card, overview, pending = null, api = channelsApi, onChanged, sdk = SDK, pageHref = null }) {
  const signup = useWhatsAppSignup({ overview, api, onChanged, sdk });
  return (
    <CardFrame card={card} pageHref={pageHref}>
      {card.state === 'not_connected' && (
        <div className="flex flex-col items-start gap-1.5">
          <WhatsAppConnectButton signup={signup} />
          {!signup.config && <p className={NOTE} data-testid="whatsapp-not-configured">{WHATSAPP_SIGNUP_NOT_CONFIGURED}</p>}
          <WhatsAppNotes />
        </div>
      )}
      {(card.state === 'connected' || card.state === 'problem') && (
        <>
          <PendingLink n={pending} />
          <ConnectedActions provider="whatsapp" api={api} onChanged={onChanged} />
        </>
      )}
      <Outcome outcome={signup.outcome} />
      <WhatsAppCallsLine calls={card.calls} />
    </CardFrame>
  );
}

/**
 * D754 f1 (#1959) — WhatsApp's own page body, at `/account/connectors/whatsapp`
 * in D753's frame (`ChannelPage.jsx`): way A, "Your business number", in every
 * D754 §11 state (`whatsappPageState`), with the card's own parts: Connect
 * (Meta's popup), `PendingLink`, `ConnectedActions` and the calls line. The
 * page draws `view.notices` in its notice region and the band's Connect from
 * the same `signup`. Way B ("Send recordings from your WhatsApp") is #1939's,
 * drawn in `wayB`.
 */
export function WhatsAppPageBody({ view, signup, pending = null, api = channelsApi, onChanged, wayB = null }) {
  const pill = { unreadable: 'Status unreadable', unavailable: 'Not available yet', off_with_connection: 'Needs attention', signup_not_configured: 'Not set up yet', not_connected: 'Not connected', connected: 'Connected', needs_attention: 'Needs attention' }[view.state];
  const tone = view.state === 'connected' ? 'ok' : view.state === 'needs_attention' || view.state === 'off_with_connection' ? 'warn' : 'neutral';
  const hasConnection = view.state === 'connected' || view.state === 'needs_attention' || view.state === 'off_with_connection';
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="whatsapp-page-body" data-state={view.state}>
      <article className={`${TONE} flex min-w-0 flex-col gap-2.5 p-4`} data-testid="whatsapp-way-a">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{WHATSAPP_PAGE.heading}</h3>
            {view.account && <p className="truncate text-[12px] text-axal-muted dark:text-gray-400" data-testid="channel-account-whatsapp">{view.account}</p>}
          </div>
          <Pill tone={tone}>{pill}</Pill>
        </div>
        {view.why && <p className={`text-[12.5px] leading-snug ${tone === 'warn' ? 'text-amber-800 dark:text-amber-300' : 'text-axal-ink/80 dark:text-gray-300'}`} data-testid="whatsapp-why">{view.why}</p>}
        {view.state === 'unreadable' && onChanged && <button type="button" className={`${BTN.ghost} self-start`} onClick={onChanged}>Retry</button>}
        {view.canConnect && (
          <div className="flex flex-col items-start gap-1.5">
            <WhatsAppConnectButton signup={signup} />
            {view.state === 'not_connected' && <WhatsAppNotes />}
          </div>
        )}
        {hasConnection && (
          <>
            {view.state === 'connected' && <PendingLink n={pending} />}
            <ConnectedActions provider="whatsapp" api={api} onChanged={onChanged} />
          </>
        )}
        <Outcome outcome={signup.outcome} />
        <WhatsAppCallsLine calls={view.calls} />
      </article>
      {wayB && <div data-testid="whatsapp-way-b">{wayB}</div>}
    </div>
  );
}

/** The view and the signup flow for WhatsApp's page, from one overview read. */
export function useWhatsAppPage({ overview, user, api = channelsApi, onChanged, sdk = SDK }) {
  const view = whatsappPageState(overview, user);
  const signup = useWhatsAppSignup({ overview, api, onChanged, sdk });
  return { view, signup };
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
          <TelegramChannelCard card={channelCard('telegram', overview)} claim={overview.telegramLink ?? null} pending={overview.pending?.telegram ?? null} api={api} onChanged={onChanged} pageHref={connectorPagePath('telegram')} />
          <WhatsAppChannelCard card={channelCard('whatsapp', overview)} overview={overview} pending={overview.pending?.whatsapp ?? null} api={api} onChanged={onChanged} sdk={sdk} pageHref={connectorPagePath('whatsapp')} />
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
