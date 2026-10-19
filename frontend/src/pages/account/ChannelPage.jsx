import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { channelsApi } from '../../lib/api/channels.js';
import { BrandIcon, PhoneBar, Unrecorded, Unreadable, usePhoneWidth } from '../../ui';
import { BTN } from './AccountCenter';
import { SheetFrame } from './ConnectorSheet';
import { RequestSheet, useMovedNotice } from './AccountConnectors';
import { TelegramChannelCard, WhatsAppChannelCard, useChannelsOverview } from './ChannelsGroup';
import { CARD_TITLE, channelCard } from './channelsModel';
import { CHANNEL_PAGE_TEXT, channelDetailsRows, channelEntry, channelPageTitle } from './channelPageModel';
import { backHrefFor } from './connectorPageModel';

/**
 * D753 (#1958, task C1) — WhatsApp Business and Telegram Business on their own
 * pages, `/account/connectors/whatsapp` and `/account/connectors/telegram`, in
 * the frame every connector's page has (`ConnectorPage.jsx`): the back link,
 * the band (mark, name, tagline), the notice region, "Connect and manage",
 * About and Details.
 *
 * The channels are not registry rows, so this page reads `GET /api/channels`
 * (`useChannelsOverview`) and never the connectors catalogue. "Connect and
 * manage" mounts today's card, `WhatsAppChannelCard` or `TelegramChannelCard`,
 * whose `ConnectedActions` are its Manage; D754 f1 and D756's page task draw
 * the cards' own states in this frame.
 */

const BOX = 'rounded-axal-sm border border-axal-hairline bg-white p-5 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200';
const H2 = 'text-[15px] font-bold text-axal-ink dark:text-gray-100';

export default function ChannelPage({ channelKey }) {
  const channels = useChannelsOverview();
  const phone = usePhoneWidth();
  return <ChannelPageView channels={channels} channelKey={channelKey} phone={phone} />;
}

/** The page, drawn from one `useChannelsOverview()` read; exported so a test can hand it each state. */
export function ChannelPageView({ channels, channelKey, phone = false, api = channelsApi, sdk }) {
  const location = useLocation();
  const moved = useMovedNotice(location);
  const entry = channelEntry({ channels, key: channelKey });
  const ready = entry.state === 'ready';
  const name = ready ? CARD_TITLE[channelKey] : 'Connectors';

  const title = channelPageTitle(entry);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [title]);

  const back = phone
    ? (
      <div className="-mx-[22px]">
        <PhoneBar back={{ label: 'Connectors', to: '/account/connectors' }} title={name} eadwynLabel={name} />
      </div>
    )
    : <Link to={backHrefFor(location.state)} className={`${BTN.link} self-start text-[13px]`} data-testid="connector-page-back">← Connectors</Link>;

  if (!ready) {
    return (
      <div className="flex min-w-0 flex-col gap-3.5" data-testid="connector-page" data-state={entry.state} data-channel="true">
        {back}
        <NotReady state={entry.state} channelKey={channelKey} onRetry={channels?.reload} />
      </div>
    );
  }

  const overview = channels.overview;
  const text = CHANNEL_PAGE_TEXT[channelKey];
  const card = channelCard(channelKey, overview);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="connector-page" data-state="ready" data-key={channelKey} data-channel="true">
      {back}
      <header data-testid="connector-page-band" className="flex min-w-0 items-center gap-4 rounded-axal-sm bg-axal-ground p-5 dark:bg-gray-800/60">
        <BrandIcon provider={channelKey} name={CARD_TITLE[channelKey]} size={phone ? 48 : 56} />
        <div className="min-w-0">
          {!phone && <h1 className="text-2xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">{CARD_TITLE[channelKey]}</h1>}
          <p className="mt-0.5 min-w-0 break-words text-[13.5px] leading-snug text-axal-muted dark:text-gray-400" data-testid="connector-page-tagline">{text.tagline}</p>
        </div>
      </header>

      {moved && (
        <div data-testid="connector-page-notices">
          <div className="rounded-[10px] border border-axal-violet/25 bg-axal-lavender px-3.5 py-2.5 text-[13px] text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-200" data-testid="connectors-moved">Integrations are now Connectors.</div>
        </div>
      )}

      <section aria-label="Connect and manage" data-testid="connector-page-connect" data-mode="channel">
        {channelKey === 'whatsapp'
          ? <WhatsAppChannelCard card={card} overview={overview} pending={overview.pending?.whatsapp ?? null} api={api} onChanged={channels.reload} sdk={sdk} />
          : <TelegramChannelCard card={card} claim={overview.telegramLink ?? null} pending={overview.pending?.telegram ?? null} api={api} onChanged={channels.reload} />}
      </section>

      <section data-testid="connector-page-about" className="flex min-w-0 flex-col gap-2">
        <h2 className={H2}>About</h2>
        {text.about.map((para) => <p key={para} className="text-[13px] leading-relaxed text-axal-ink/90 dark:text-gray-300">{para}</p>)}
      </section>

      <section data-testid="connector-page-details" className="flex min-w-0 flex-col gap-2">
        <h2 className={H2}>Details</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {channelDetailsRows(channelKey, overview).map((r) => (
            <div key={r.label} className="min-w-0">
              <dt className="text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400">{r.label}</dt>
              <dd className="min-w-0 break-words text-[13px] text-axal-ink dark:text-gray-200">
                {r.value === null
                  ? <Unrecorded reason={r.reason}>Not recorded</Unrecorded>
                  : r.href
                    ? <a href={r.href} target="_blank" rel="noopener noreferrer" className={BTN.link}>Documentation ↗</a>
                    : r.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/** Loading, unreadable, or a channel `GET /api/channels` does not report. */
function NotReady({ state, channelKey, onRetry }) {
  const [requesting, setRequesting] = useState(false);
  if (state === 'loading') return <div className={`${BOX} text-axal-muted dark:text-gray-400`} data-testid="connector-page-loading">Loading connector…</div>;
  if (state === 'unreadable') {
    return <div className={BOX} data-testid="connector-page-unreadable"><Unreadable what="Your connection" claim="This is not a claim that you have none." onRetry={onRetry} /></div>;
  }
  return (
    <>
      <div className={BOX} data-testid="connector-page-unknown">
        No connector called &ldquo;{channelKey}&rdquo;.{' '}
        <button type="button" className={`${BTN.link} font-bold`} onClick={() => setRequesting(true)} data-testid="connector-page-request">Request it.</button>
      </div>
      {requesting && (
        <SheetFrame.Provider value={{ layout: 'page', onDismiss: () => setRequesting(false) }}>
          <RequestSheet tool={channelKey} onClose={() => setRequesting(false)} />
        </SheetFrame.Provider>
      )}
    </>
  );
}
