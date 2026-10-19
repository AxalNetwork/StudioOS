import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { connectorsApi } from '../../lib/api/connectors';
import { ChevronDown, Info } from 'lucide-react';
import { BrandIcon, PhoneBar, Pill, Unrecorded, Unreadable, usePhoneWidth } from '../../ui';
import { BTN } from './AccountCenter';
import {
  ActivityGroup, CompaniesGroup, ConnectorPanel, FedGroup, Group, KeyFields, PermissionsGroup, Row, SettingsGroup, SheetFrame, ToolModals,
  UsesGroups, openingView, useConnectors,
} from './ConnectorSheet';
import Lightbox from '../../ui/Lightbox';
import { useConnectFlow } from './useConnectFlow';
import { RequestSheet, useMovedNotice } from './AccountConnectors';
import { connectionStatus, disconnectNote, isEntityRow, isPersonalMercury, keysHref, lastSyncLabel, moduleLabel, stripReturn } from './connectorsModel';
import {
  DETAIL_MISSING, backHrefFor, bodyDetailsRows, detailsRows, headerTagline, interimPanel, keyHelpOf, keyPath, manageItems, modeLabel, pageAction,
  pageChoices, pageEntry, pageNotice, pageReturn, pageTitle, toolGroups,
} from './connectorPageModel';
import { isChannelKey } from './channelPageModel';
import ChannelPage from './ChannelPage';
import { MEMBER_REPLACE, notOfferedSentence } from './mercuryModel';
import { MercuryEntityPageBody, MercuryLandsGroup, MercuryReadsGroup, MercuryUsesGroups } from './MercurySheet';
import { useAuth } from '../../hooks/useAuthSync';
import { branchOfUser, isSuperAdminUser } from '../../lib/shellRole';
import { ZOOM_DISCONNECT_NOTE, ZOOM_SECTIONS, zoomHowItWorks, zoomNotices } from '../../lib/validateSourceWording';

/**
 * D753 (#1876, F1) — a connector's own page, `/account/connectors/<key>`,
 * inside the Account center. The owner's ask (2026-10-18): every connector has
 * a page with a description, not a right sidebar. This task frames it from
 * Claude's own connector directory (screenshot C): the back link, the header
 * band (tile, name, tagline), a notice region, About and Details.
 *
 * CONNECT FROM THE PAGE (#1908, F2; decision 6). The band carries one action
 * (`pageAction`): "Connect to Axal VC" sends the browser to the service, or
 * opens the key form inline under the band, through `useConnectFlow`, the
 * same code as the side sheet and Build's lightbox. Its other ways in are on
 * the split chevron (`pageChoices`). The notice region draws one notice at a
 * time (`pageNotice`).
 *
 * YOUR CONNECTION (#1956, F3; decision 3, item 4). A connected row draws its
 * account, status, last sync and Sync now, then Companies, Now fed by,
 * Settings and Activity (the sheet's own groups, shared), and the band adds
 * "Manage ▾" (`manageItems`): Sync now, Replace key or Reconnect, and
 * Disconnect, which asks first in a centred dialog.
 *
 * NOTHING IS LOST WHILE THE WORK MOVES (decision 7). Until F4 takes it
 * over, today's `ConnectorPanel` stays inline only for GitHub's repositories
 * (`interimPanel`), through `SheetFrame`'s `page` layout: in the
 * page's flow, no overlay, no dialog role, no × and no Escape of its own.
 *
 * A SIGN-IN COMES BACK HERE (decision 6). `connectorsRedirect` sends a return
 * naming this key to this page; the page reads it only when it names its own
 * key (never Mercury's, D715 decision 3), says what happened in the notice
 * region, and strips the query.
 *
 * The name is the page's one `<h1>` (decision 10): on desktop `SettingsPage`
 * draws no "Account" heading here, and on a phone `PhoneBar` draws it.
 *
 * THE BODY (#1955, F7). Handed `body` (`{ state, connector }`, the Worker's
 * description of the connector, D753 decision 4(b)), the page draws About,
 * Tools, Prompts, the trust notice and Details from it (`ConnectorBody`), and
 * the header's line becomes its tagline. Without `body` it draws F1's About
 * and Details from the catalogue row.
 *
 * MERCURY (#1991, F5). The Axal entities' row (`isEntityRow`, an admin on HQ)
 * draws `MercuryEntityPageBody` in "Connect and manage": the entity
 * connections, what they feed, Open Banking and the audit foot, with the one
 * audited read on mount and no header action. A member's own Mercury draws
 * its groups (what it is for, where it lands, what it reads) above the token
 * form until it is connected, then in "Your connection" with Manage's Sync
 * now, Replace token and Disconnect: no interim panel, no sign-in redirect.
 *
 * THE READ (#1955, part 2). Handed `readPage` (`connectorsApi.page`), the view
 * reads `GET /api/connectors/directory/<page_key>` once the connector is known,
 * and again only on Retry. Only `{ ok: true, connector }` fills the body;
 * anything else is unreadable, section by section, while the band and Connect
 * keep working from the catalogue.
 */

const BOX = 'rounded-axal-sm border border-axal-hairline bg-white p-5 text-[13px] text-axal-ink dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200';
const H2 = 'text-[15px] font-bold text-axal-ink dark:text-gray-100';

export default function ConnectorPage({ connectorKey }) {
  // C1: a channel's page reads GET /api/channels, never the catalogue.
  if (isChannelKey(connectorKey)) return <ChannelPage channelKey={connectorKey} />;
  return <CataloguePage connectorKey={connectorKey} />;
}

function CataloguePage({ connectorKey }) {
  const data = useConnectors();
  const phone = usePhoneWidth();
  const user = useAuth()?.user ?? null;
  // Decision 3's not-offered words for an admin on a branch, computed as the hub does.
  const branchAdmin = user?.role === 'admin' && !!branchOfUser(user);
  return <ConnectorPageView data={data} connectorKey={connectorKey} phone={phone} branchAdmin={branchAdmin} readPage={connectorsApi.page} />;
}

/** The page, drawn from one `useConnectors()` read; exported so a test can hand it each state. */
export function ConnectorPageView({ data, connectorKey, phone = false, branchAdmin = false, body = null, onBodyRetry, readPage = null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const entry = pageEntry({ data, key: connectorKey });
  const p = entry.state === 'ready' ? entry.p : null;
  const name = p?.display_name || 'Connectors';
  const moved = useMovedNotice(location);

  // The sign-in return, read once at mount, then stripped from the address.
  // An alias page reads nothing: the redirect carries the query to the real key's page.
  const [returned] = useState(() => (entry.state === 'alias' ? null : pageReturn(location.search, connectorKey)));
  useEffect(() => {
    if (!returned) return;
    navigate({ pathname: location.pathname, search: stripReturn(location.search, returned.strip), hash: location.hash }, { replace: true, state: location.state });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The tab's title, restored on leaving. Not `usePageMeta`: it fires the public pageview beacon.
  const title = pageTitle(entry);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [title]);

  const read = usePageRead(readPage, body ? null : p?.page_key || p?.key || null);
  const shownBody = body || read.body;
  const retryBody = body ? onBodyRetry : read.retry;

  if (entry.state === 'alias') {
    return <Navigate to={{ pathname: entry.to, search: location.search, hash: location.hash }} state={location.state} replace />;
  }

  const back = phone
    ? (
      <div className="-mx-[22px]">
        <PhoneBar back={{ label: 'Connectors', to: '/account/connectors' }} title={name} eadwynLabel={name} />
      </div>
    )
    : <Link to={backHrefFor(location.state)} className={`${BTN.link} self-start text-[13px]`} data-testid="connector-page-back">← Connectors</Link>;

  if (!p) {
    return (
      <div className="flex min-w-0 flex-col gap-3.5" data-testid="connector-page" data-state={entry.state}>
        {back}
        <NotReady entry={entry} connectorKey={connectorKey} data={data} branchAdmin={branchAdmin} />
      </div>
    );
  }

  return (
    <ReadyPage key={p.key} p={p} back={back} phone={phone} ret={returned?.ret || null} moved={moved} onChanged={data.reload} connector={shownBody?.state === 'ready' ? shownBody.connector : null}>
      {p.key === 'zoom' && <ZoomValidate p={p} />}
      {shownBody
        ? <ConnectorBody state={shownBody.state} connector={shownBody.connector} p={p} onRetry={retryBody} />
        : (
          <>
            <About p={p} />
            <Details p={p} />
          </>
        )}
    </ReadyPage>
  );
}

/**
 * The page once its connector is known: the band and its one action, the
 * notice, the inline key form, the connected half, then `children` (the body).
 */
function ReadyPage({ p, back, phone, ret, moved, onChanged, children, connector = null }) {
  const auth = useAuth();
  const superAdmin = isSuperAdminUser(auth?.user);
  // A return opens on what happened; GitHub's lands on choosing its repositories (the connected half).
  const [view, setView] = useState(() => (ret ? ret.view : 'idle'));
  const [flowRet, setFlowRet] = useState(ret || {});
  const setFlowView = (v) => { setFlowRet({}); setView(v); };
  const flow = useConnectFlow(p, { setView: setFlowView, onChanged });
  const name = p.display_name;
  const action = pageAction(p, { view });
  const tagline = headerTagline(p, connector);
  const notice = pageNotice({ view, ret: flowRet, message: flow.message, name, moved });
  // Connect by key, Reconnect by key, or Manage's Replace key on a connected row.
  const keyOpen = (view === 'key' || view === 'badkey') && ['key', 'oauth', 'reconnect', 'status'].includes(action.kind);
  // D753 F5 (#1991): the Axal entities' Mercury is drawn on the page itself, never the interim panel.
  const entity = isEntityRow(p);
  // F1's panel stays only where F4 (GitHub) takes it over; every other connection is "Your connection".
  const panelShown = interimPanel(p, view);
  const role = auth?.user?.role ?? null;
  // A member's own Mercury says what it is for above the token form, as the sheet's first step did; the band connects.
  const memberMercury = isPersonalMercury(p) && !p.connection && !panelShown;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="connector-page" data-state="ready" data-key={p.key}>
      {back}
      <header data-testid="connector-page-band" className="flex min-w-0 flex-wrap items-center gap-4 rounded-axal-sm bg-axal-ground p-5 dark:bg-gray-800/60">
        <BrandIcon provider={p.key} name={p.display_name} size={phone ? 48 : 56} />
        <div className="min-w-0 flex-1">
          {!phone && <h1 className="text-2xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">{p.display_name}</h1>}
          {tagline && <p className="mt-0.5 min-w-0 break-words text-[13.5px] leading-snug text-axal-muted dark:text-gray-400" data-testid="connector-page-tagline">{tagline}</p>}
        </div>
        <BandAction p={p} action={action} flow={flow} phone={phone} superAdmin={superAdmin} onChanged={onChanged} manage={panelShown || entity ? [] : manageItems(p)} />
      </header>

      {notice && (
        <div data-testid="connector-page-notices">
          <Notice notice={notice} name={name} adminHref={superAdmin ? flow.adminHref : null} />
        </div>
      )}

      {entity && (
        <section aria-label="Connect and manage" data-testid="connector-page-connect" data-mode="entity">
          <MercuryEntityPageBody p={p} />
        </section>
      )}
      {(keyOpen || panelShown || memberMercury) && (
        <section aria-label="Connect and manage" data-testid="connector-page-connect" data-mode={keyOpen ? 'key' : panelShown ? 'panel' : 'mercury'}>
          {memberMercury && (
            <div className="-mx-5">
              <MercuryUsesGroups role={role} />
              <MercuryLandsGroup role={role} />
              <MercuryReadsGroup />
            </div>
          )}
          {keyOpen && <InlineKeyForm p={p} flow={flow} view={view} connector={connector} />}
          {!keyOpen && panelShown && <InlinePanel key={`${p.key}:${p.connection ? 'c' : 'n'}`} p={p} ret={view === 'sync' ? { view: 'sync' } : null} onChanged={onChanged} />}
        </section>
      )}
      {p.connection && !panelShown && !entity && <YourConnection p={p} flow={flow} role={role} onChanged={onChanged} />}
      {flow.confirming && (
        <Lightbox label={`Disconnect ${name}?`} title={`Disconnect ${name}?`} onClose={() => flow.setConfirming(false)} width={440} testId="connector-page-disconnect-dialog"
          footer={(
            <>
              <button type="button" className={BTN.ghost} onClick={() => flow.setConfirming(false)}>Cancel</button>
              <button type="button" className={BTN.dangerSolid} disabled={flow.busy} onClick={flow.doDisconnect} data-testid="connector-page-confirm-disconnect">{flow.busy ? 'Disconnecting…' : 'Disconnect'}</button>
            </>
          )}>
          <p className="px-5 py-4 text-[13px] text-axal-ink dark:text-gray-200" data-testid="connector-page-disconnect-note">{disconnectNote(p, role)}</p>
          {flow.message && <p role="alert" className="px-5 pb-4 text-[12.5px] text-red-700 dark:text-red-300">{flow.message}</p>}
        </Lightbox>
      )}
      {children}
    </div>
  );
}

const ACCOUNT_MISSING = 'The service did not name the account this connection signed in as.';

/**
 * "Your connection" (decision 3, item 4): the first row, a slot for the
 * provider's own section, then the sheet's Companies, Now fed by, Settings
 * and Activity groups, which Build's lightbox draws too.
 *
 * A member's own Mercury (#1991, F5) is drawn as its sheet's connected view
 * was (D715 decision 8): its section is what StudioOS uses it for, where it
 * lands and what it reads, in place of Companies; Now fed by is a founder's
 * only; and the attention line says how to fix it, never the raw error.
 */
function YourConnection({ p, flow, role = null, onChanged }) {
  const conn = p.connection;
  const status = connectionStatus(conn, p);
  const mercury = isPersonalMercury(p);
  return (
    <section data-testid="connector-page-connection" className="flex min-w-0 flex-col gap-2">
      <h2 className={H2}>Your connection</h2>
      <div data-testid="connector-page-connection-row" className={`${BOX} flex flex-wrap items-center gap-x-5 gap-y-2`}>
        <div className="min-w-0">
          <div className="text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400">Account</div>
          <div className="min-w-0 break-words" data-testid="connector-page-account">
            {conn.external_account_name || <Unrecorded reason={ACCOUNT_MISSING}>Not recorded</Unrecorded>}
          </div>
        </div>
        <Pill tone={status.tone}>{status.label}</Pill>
        <div className="min-w-0">
          <div className="text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400">Last sync</div>
          <div data-testid="connector-page-last-sync">{flow.syncNote || lastSyncLabel(conn)}</div>
        </div>
        {conn.uid && (
          <button type="button" className={`${BTN.ghost} sm:ml-auto`} disabled={flow.syncing} onClick={flow.syncNow} data-testid="connector-page-sync">
            {flow.syncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}
        {status.why && <p className="w-full text-[12.5px] text-amber-800 dark:text-amber-200" data-testid="connector-page-attention">{mercury ? `${status.why}. ${MEMBER_REPLACE}` : `${status.why}.`}</p>}
      </div>
      {/* The provider's own section goes here: GitHub's repositories (F4), Mercury (F5, below), the channel cards (C1). */}
      <div className="-mx-5">
        {mercury ? (
          <div data-testid="connector-page-mercury">
            <MercuryUsesGroups role={role} />
            <MercuryLandsGroup role={role} />
            <MercuryReadsGroup />
          </div>
        ) : <CompaniesGroup conn={conn} onChanged={onChanged} />}
        {/* Decision 8: a partner's Mercury feeds no module. */}
        {(!mercury || role === 'founder') && <FedGroup conn={conn} name={p.display_name} />}
        <SettingsGroup p={p} onTool={flow.setTool} onReplace={() => flow.go('key')} />
        {conn.uid
          ? <ActivityGroup conn={conn} />
          : <Group label="Activity"><Row a={<Unrecorded reason={`${p.display_name} keeps no activity log in StudioOS.`}>Not recorded</Unrecorded>} /></Group>}
      </div>
      <ToolModals conn={conn} flow={flow} onChanged={onChanged} />
    </section>
  );
}

/**
 * D757 §2.12 (#1929): what Zoom feeds and needs, in D757's words, from the
 * catalogue row's `suggests`, `distribution` and `configured` (#1922, D751),
 * so it draws with or without F7's body. No Used by links: every profile sees
 * this page, and Validate is the founder's (validateSourceWording.js).
 */
export function ZoomValidate({ p }) {
  const notices = zoomNotices(p);
  return (
    <section data-testid="connector-page-validate" className="flex min-w-0 flex-col gap-3">
      {notices.map((n) => (
        <div key={n.key} role="note" data-testid={`zoom-notice-${n.key}`} className="flex items-start gap-2 rounded-axal-sm border border-axal-hairline bg-axal-ground px-3.5 py-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-axal-muted dark:text-gray-400" aria-hidden="true" />
          <span className="min-w-0">{n.text}</span>
        </div>
      ))}
      {(p?.connection || p?.already_connected === true) && <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="zoom-disconnect-note">{ZOOM_DISCONNECT_NOTE}</p>}
      <div className="min-w-0" data-testid="zoom-how">
        <h2 className={H2}>How it works</h2>
        <ol className="mt-1 list-decimal pl-5 text-[13px] leading-relaxed text-axal-ink dark:text-gray-200">
          {zoomHowItWorks(p?.suggests).map((t) => <li key={t}>{t}</li>)}
        </ol>
      </div>
      {ZOOM_SECTIONS.map((x) => (
        <div key={x.key} className="min-w-0" data-testid={`zoom-${x.key}`}>
          <h2 className={H2}>{x.title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-axal-ink dark:text-gray-200">{x.text}</p>
        </div>
      ))}
    </section>
  );
}

/** Loading, forbidden, unreadable, not offered, or a key the catalogue does not hold. */
function NotReady({ entry, connectorKey, data, branchAdmin }) {
  const [requesting, setRequesting] = useState(false);
  if (entry.state === 'loading') return <div className={`${BOX} text-axal-muted dark:text-gray-400`} data-testid="connector-page-loading">Loading connector…</div>;
  if (entry.state === 'forbidden') return <div className={BOX} data-testid="connector-page-forbidden">{entry.message}</div>;
  if (entry.state === 'unreadable') {
    return <div className={BOX} data-testid="connector-page-unreadable"><Unreadable what="The connector" claim="This is not a claim that it does not exist." onRetry={data.reload} /></div>;
  }
  if (entry.state === 'not_offered') return <div className={BOX} data-testid="connector-page-not-offered">{notOfferedSentence({ branchAdmin })}</div>;
  return (
    <>
      <div className={BOX} data-testid="connector-page-unknown">
        No connector called &ldquo;{connectorKey}&rdquo;.{' '}
        <button type="button" className={`${BTN.link} font-bold`} onClick={() => setRequesting(true)} data-testid="connector-page-request">Request it.</button>
      </div>
      {requesting && <RequestSheet tool={connectorKey} onClose={() => setRequesting(false)} />}
    </>
  );
}

const NOTICE_CLS = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  danger: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  neutral: 'border-axal-hairline bg-axal-ground text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200',
  info: 'border-axal-violet/25 bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-200',
};

/** The notice region's one notice (`pageNotice`), with the way forward a view offers. */
function Notice({ notice, name, adminHref }) {
  const testid = notice.kind === 'moved' ? 'connectors-moved' : 'connector-page-notice';
  return (
    <div role={notice.tone === 'danger' ? 'alert' : undefined} data-testid={testid} data-kind={notice.kind}
      className={`rounded-[10px] border px-3.5 py-2.5 text-[13px] ${NOTICE_CLS[notice.tone] || NOTICE_CLS.neutral}`}>
      {notice.text}
      {notice.kind === 'unconfigured' && adminHref && (
        <> <Link to={adminHref} className={BTN.link} data-testid="connector-unconfigured-admin-link">Set up {name} in Integration keys</Link></>
      )}
      {notice.kind === 'overreach' && <> <Link to="/help" className={BTN.link}>Report it</Link></>}
    </div>
  );
}

/**
 * The band's one action (`pageAction`, decision 6), and its split chevron:
 * a menu on desktop, radios and links on a phone.
 */
function BandAction({ p, action, flow, phone, superAdmin, onChanged, manage = [] }) {
  const choices = pageChoices(p);
  const connects = action.kind === 'oauth' || action.kind === 'key' || action.kind === 'starting';
  const hasChoices = connects && (choices.env || choices.alt.length > 0);
  const press = () => {
    if (action.kind === 'oauth' || (action.kind === 'reconnect' && action.via === 'oauth')) flow.startOauth();
    else flow.go('key');
  };
  if (action.kind === 'none') return null;
  if (action.kind === 'status') {
    return (
      <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end" data-testid="connector-page-action" data-kind="status">
        <div className="flex items-center gap-2">
          <Pill tone={action.pill.tone}>{action.pill.label}</Pill>
          {manage.length > 0 && !phone && <ManageMenu p={p} items={manage} flow={flow} />}
        </div>
        {manage.length > 0 && phone && <ManageRows p={p} items={manage} flow={flow} />}
      </div>
    );
  }
  if (action.kind === 'waitlist') return <WaitlistAction p={p} action={action} onChanged={onChanged} />;
  if (action.kind === 'plan') {
    return (
      <div className="flex items-center gap-2" data-testid="connector-page-action" data-kind="plan">
        <Pill tone="info">{action.pill}</Pill>
        <Link to={action.to} className={BTN.primary} data-testid="connector-page-plans">{action.label}</Link>
      </div>
    );
  }
  if (action.kind === 'unavailable') {
    const keys = keysHref(p, { superAdmin });
    return (
      <div className="flex min-w-0 flex-col items-start gap-1.5 sm:items-end" data-testid="connector-page-action" data-kind="unavailable">
        <button type="button" className={BTN.primary} disabled aria-describedby={`${p.key}-unavailable-note`} data-testid="connector-page-unavailable">{action.label}</button>
        <p id={`${p.key}-unavailable-note`} className="max-w-[18rem] text-[12px] text-axal-muted dark:text-gray-400 sm:text-right">{action.note}</p>
        {keys && <Link to={keys} className={`${BTN.link} text-[12px]`} data-testid={`connector-keys-link-${p.key}`}>Add its keys in Integration keys</Link>}
      </div>
    );
  }
  const starting = action.kind === 'starting';
  return (
    <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end" data-testid="connector-page-action" data-kind={action.kind}>
      <div className="flex items-stretch">
        {action.kind === 'reconnect' && <span className="mr-2 self-center"><Pill tone={action.pill.tone}>{action.pill.label}</Pill></span>}
        <button
          type="button"
          className={`${BTN.primary}${hasChoices && !phone ? ' rounded-r-none' : ''}`}
          disabled={starting || flow.busy}
          aria-busy={starting ? 'true' : undefined}
          aria-label={action.aria}
          onClick={press}
          data-testid="connector-page-connect-button"
        >
          {action.label}
        </button>
        {hasChoices && !phone && <ChoicesMenu p={p} choices={choices} flow={flow} disabled={starting} />}
        {action.kind === 'reconnect' && manage.length > 0 && !phone && <span className="ml-2"><ManageMenu p={p} items={manage} flow={flow} /></span>}
      </div>
      {hasChoices && phone && <ChoicesInline p={p} choices={choices} flow={flow} />}
      {action.kind === 'reconnect' && manage.length > 0 && phone && <ManageRows p={p} items={manage} flow={flow} />}
    </div>
  );
}

/** What a Manage item does, through the flow. */
function manageAct(p, flow, id) {
  if (id === 'sync') return flow.syncNow();
  if (id === 'replace') return flow.go('key');
  if (id === 'reconnect') return keyPath(p) ? flow.go('key') : flow.startOauth();
  return flow.setConfirming(true);
}

/** "Manage ▾" on desktop: a menu of `manageItems`. */
function ManageMenu({ p, items, flow }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener?.('mousedown', away);
    document.addEventListener?.('keydown', esc);
    return () => { document.removeEventListener?.('mousedown', away); document.removeEventListener?.('keydown', esc); };
  }, [open]);
  return (
    <div className="relative" ref={wrap}>
      <button type="button" className={BTN.ghost} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="connector-page-manage">
        Manage <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label={`Manage ${p.display_name}`} data-testid="connector-page-manage-menu"
          className="absolute right-0 z-20 mt-1 min-w-[12rem] rounded-axal-sm border border-axal-hairline bg-white py-1 text-[13px] shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {items.map((it) => (
            <button key={it.id} type="button" role="menuitem" data-testid={`connector-page-manage-${it.id}`}
              className={`flex w-full px-3 py-1.5 text-left hover:bg-axal-ground dark:hover:bg-gray-800${it.id === 'disconnect' ? ' text-red-700 dark:text-red-300' : ''}`}
              onClick={() => { setOpen(false); manageAct(p, flow, it.id); }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Manage on a phone: the same items as action rows under the band. */
function ManageRows({ p, items, flow }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="connector-page-manage-rows">
      {items.map((it) => (
        <button key={it.id} type="button" className={it.id === 'disconnect' ? BTN.danger : BTN.ghost} onClick={() => manageAct(p, flow, it.id)} data-testid={`connector-page-manage-${it.id}`}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Pick an account kind on the flow, or take the other way in. */
function useChoices(p, flow) {
  const envValue = p.key === 'salesforce' ? (flow.sfSandbox ? 'sandbox' : 'production') : p.key === 'docusign' ? (flow.dsDemo ? 'demo' : 'production') : null;
  const pickEnv = (v) => {
    if (p.key === 'salesforce') flow.setSfSandbox(v === 'sandbox');
    if (p.key === 'docusign') flow.setDsDemo(v === 'demo');
  };
  const takeAlt = (id) => (id === 'pat' ? flow.go('key') : flow.startOauth());
  return { envValue, pickEnv, takeAlt };
}

function ChoicesMenu({ p, choices, flow, disabled }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const { envValue, pickEnv, takeAlt } = useChoices(p, flow);
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener?.('mousedown', away);
    document.addEventListener?.('keydown', esc);
    return () => { document.removeEventListener?.('mousedown', away); document.removeEventListener?.('keydown', esc); };
  }, [open]);
  return (
    <div className="relative" ref={wrap}>
      <button type="button" className={`${BTN.primary} rounded-l-none border-l border-white/30 px-2`} disabled={disabled}
        aria-haspopup="menu" aria-expanded={open} aria-label={`More ways to connect ${p.display_name}`} onClick={() => setOpen((v) => !v)} data-testid="connector-page-choices">
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label={`Ways to connect ${p.display_name}`} data-testid="connector-page-choices-menu"
          className="absolute right-0 z-20 mt-1 min-w-[14rem] rounded-axal-sm border border-axal-hairline bg-white py-1 text-[13px] shadow-lg dark:border-gray-700 dark:bg-gray-900">
          {choices.env && (
            <>
              <div className="px-3 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400">{choices.env.label}</div>
              {choices.env.options.map((o) => (
                <button key={o.value} type="button" role="menuitemradio" aria-checked={envValue === o.value} data-testid={`connector-page-env-${o.value}`}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-axal-ground dark:hover:bg-gray-800" onClick={() => { pickEnv(o.value); setOpen(false); }}>
                  <span aria-hidden="true" className="w-3">{envValue === o.value ? '✓' : ''}</span>{o.label}
                </button>
              ))}
            </>
          )}
          {choices.alt.map((a) => (
            <button key={a.id} type="button" role="menuitem" data-testid={`connector-page-alt-${a.id}`}
              className="flex w-full px-3 py-1.5 text-left hover:bg-axal-ground dark:hover:bg-gray-800" onClick={() => { setOpen(false); takeAlt(a.id); }}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChoicesInline({ p, choices, flow }) {
  const { envValue, pickEnv, takeAlt } = useChoices(p, flow);
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-[13px]" data-testid="connector-page-choices-inline">
      {choices.env && (
        <fieldset className="flex flex-wrap gap-3">
          <legend className="sr-only">{choices.env.label}</legend>
          {choices.env.options.map((o) => (
            <label key={o.value} className="flex items-center gap-1.5">
              <input type="radio" name={choices.env.name} checked={envValue === o.value} onChange={() => pickEnv(o.value)} data-testid={`connector-page-env-${o.value}`} /> {o.label}
            </label>
          ))}
        </fieldset>
      )}
      {choices.alt.map((a) => (
        <button key={a.id} type="button" className={`${BTN.link} self-start`} onClick={() => takeAlt(a.id)} data-testid={`connector-page-alt-${a.id}`}>{a.label}</button>
      ))}
    </div>
  );
}

/** The key form, inline under the band, posting through the flow's `submitKey`. */
function InlineKeyForm({ p, flow, view, connector }) {
  const updating = !!p.connection;
  const name = p.display_name;
  return (
    <form id="connector-page-key-form" onSubmit={flow.submitKey} data-testid="connector-page-key-form"
      className="rounded-axal-sm border border-axal-hairline bg-white pb-4 dark:border-gray-800 dark:bg-gray-900">
      <h2 className={`${H2} mx-5 mt-4`}>{updating ? `Replace the key for ${name}` : `Connect ${name} with a key`}</h2>
      <KeyFields p={p} flow={flow} updating={updating} keyHelp={keyHelpOf(connector, p)} />
      {flow.message && view !== 'badkey' && <p role="alert" className="mx-5 mt-3 text-[12.5px] text-red-700 dark:text-red-300">{flow.message}</p>}
      <div className="mx-5 mt-4 flex justify-end gap-2">
        <button type="button" className={BTN.ghost} onClick={() => flow.go('idle')}>Cancel</button>
        <button type="submit" className={BTN.primary} disabled={flow.busy} data-testid="connector-page-key-submit">{flow.busy ? 'Connecting…' : updating ? 'Replace' : 'Connect'}</button>
      </div>
    </form>
  );
}

/** The connected half of today's panel, inline, until F3 to F5 (decision 7). */
function InlinePanel({ p, ret, onChanged }) {
  const [state, setState] = useState(() => ({ view: ret ? ret.view : openingView(p), ret: ret || {} }));
  const reset = () => setState({ view: openingView(p), ret: {} });
  const frame = useMemo(() => ({ layout: 'page', onDismiss: reset }), [p.key, p.connection]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SheetFrame.Provider value={frame}>
      <ConnectorPanel
        p={p}
        view={state.view}
        ret={state.ret}
        setView={(view) => setState({ view, ret: {} })}
        onChanged={onChanged}
        onClose={reset}
        eyebrow="Connect and manage"
      />
    </SheetFrame.Provider>
  );
}

/** A Coming soon connector: Notify me, or We'll tell you, as its card offers. */
function WaitlistAction({ p, action, onChanged }) {
  const [state, setState] = useState({ busy: false, error: '' });
  const act = async () => {
    setState({ busy: true, error: '' });
    try {
      if (action.joined) await connectorsApi.stopNotify(p.key);
      else await connectorsApi.notifyMe(p.key);
      onChanged?.();
      setState({ busy: false, error: '' });
    } catch (e) { setState({ busy: false, error: e?.message || 'That could not be saved.' }); }
  };
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 sm:items-end" data-testid="connector-page-waitlist">
      <span className="text-[12px] text-axal-muted dark:text-gray-400">Coming soon</span>
      <button type="button" disabled={state.busy} onClick={act} className={action.joined ? BTN.ghost : BTN.primary} title={action.joined ? 'Click to stop the notice' : undefined}>
        {action.label}
      </button>
      {state.error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{state.error}</p>}
    </div>
  );
}

/** About: what it reads and sends, and what it may do, from today's fields. It makes no read. */
function About({ p }) {
  // Mercury's own groups read its status on mount, so they are drawn once: above the token form, then in Your connection.
  const mercury = p.key === 'mercury';
  return (
    <section data-testid="connector-page-about" className="flex min-w-0 flex-col">
      <h2 className={H2}>About</h2>
      <div className="-mx-5">
        {!mercury && <UsesGroups p={p} />}
        <PermissionsGroup p={p} />
      </div>
    </section>
  );
}

function Details({ p }) {
  const rows = detailsRows(p);
  return (
    <section data-testid="connector-page-details" className="flex min-w-0 flex-col gap-2">
      <h2 className={H2}>Details</h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {rows.map((r) => (
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
  );
}

// ---------- The body (#1955, F7) -------------------------------------------

/**
 * The page's own read: once per key, again on `retry`. `body` is null while
 * there is nothing to read (no `readPage`, or no key yet).
 */
function usePageRead(readPage, key) {
  const [attempt, setAttempt] = useState(0);
  const [got, setGot] = useState({ key: null, state: 'loading', connector: null });
  useEffect(() => {
    if (!readPage || !key) return undefined;
    let live = true;
    setGot({ key, state: 'loading', connector: null });
    Promise.resolve()
      .then(() => readPage(key))
      .then((r) => {
        if (!live) return;
        const ok = r?.ok === true && r.connector && typeof r.connector === 'object';
        setGot({ key, state: ok ? 'ready' : 'unreadable', connector: ok ? r.connector : null });
      }, () => { if (live) setGot({ key, state: 'unreadable', connector: null }); });
    return () => { live = false; };
  }, [readPage, key, attempt]);
  if (!readPage || !key) return { body: null, retry: undefined };
  return { body: got.key === key ? got : { key, state: 'loading', connector: null }, retry: () => setAttempt((n) => n + 1) };
}

const CHIP = 'rounded-full border border-axal-hairline bg-axal-ground px-2.5 py-1 text-[12px] text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200';
const TOOL = 'min-w-0 break-words rounded-axal-sm border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200';
const LABEL = 'text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const missing = <Unrecorded reason={DETAIL_MISSING}>Not recorded</Unrecorded>;

/**
 * About, Tools, Prompts, the trust notice, a divider and Details (D753
 * decision 3, items 5 to 10), from the Worker's `connector`. `state` is
 * `ready`, `loading` or `unreadable`; an unreadable read gives each section
 * its own Retry, and the rest of the page keeps working from the catalogue.
 */
export function ConnectorBody({ state = 'ready', connector, p, onRetry }) {
  const c = state === 'ready' && connector && typeof connector === 'object' ? connector : null;
  const name = c?.display_name || p?.display_name || 'this connector';
  const hold = c ? null : <BodyHold state={state} onRetry={onRetry} />;
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="connector-page-body" data-state={c ? 'ready' : state}>
      <section data-testid="connector-page-about" className="flex min-w-0 flex-col gap-3">
        <h2 className={H2}>About</h2>
        {hold || <BodyAbout c={c} />}
      </section>
      <section data-testid="connector-page-tools" className="flex min-w-0 flex-col gap-2">
        <h2 className={H2}>Tools</h2>
        {hold || <BodyTools tools={c.tools} name={name} />}
      </section>
      {c && Array.isArray(c.prompts) && c.prompts.length > 0 && (
        <section data-testid="connector-page-prompts" className="flex min-w-0 flex-col gap-2">
          <h2 className={H2}>Prompts</h2>
          <ul className="flex flex-wrap gap-2">
            {c.prompts.filter((x) => x && typeof x.ask === 'string').map((x) => <li key={x.name || x.ask} className={CHIP}>{x.ask}</li>)}
          </ul>
        </section>
      )}
      {c && (
        <div role="note" data-testid="connector-page-trust" className="flex items-start gap-2 rounded-axal-sm border border-axal-hairline bg-axal-ground px-3.5 py-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-axal-muted dark:text-gray-400" aria-hidden="true" />
          <span className="min-w-0">{typeof c.trust?.sentence === 'string' && c.trust.sentence ? c.trust.sentence : missing}</span>
        </div>
      )}
      <hr className="border-axal-hairline dark:border-gray-800" />
      <section data-testid="connector-page-details" className="flex min-w-0 flex-col gap-2">
        <h2 className={H2}>Details</h2>
        {hold || <BodyDetails c={c} p={p} />}
      </section>
    </div>
  );
}

function BodyHold({ state, onRetry }) {
  if (state === 'loading') return <p className="text-[13px] text-axal-muted dark:text-gray-400">Loading…</p>;
  return <Unreadable what="This connector’s description" claim="" onRetry={onRetry} />;
}

function BodyAbout({ c }) {
  const paras = Array.isArray(c.long_description) ? c.long_description.filter((x) => typeof x === 'string' && x) : [];
  const uses = (label, list, b) => (
    <div className="min-w-0">
      <h3 className={`${LABEL} mb-1`}>{label}</h3>
      {!Array.isArray(list)
        ? <p className="text-[13px]">{missing}</p>
        : list.length
          ? (
            <ul className="flex flex-col gap-1">
              {list.map((x) => (
                <li key={`${x.what}:${b(x) || ''}`} className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-axal-ink dark:text-gray-200">
                  <span>{x.what}</span>
                  {b(x) && <span className="text-[12px] text-axal-muted dark:text-gray-400">→ {b(x)}</span>}
                  <span className="text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">{modeLabel(x)}</span>
                </li>
              ))}
            </ul>
          )
          : <p className="text-[13px] text-axal-muted dark:text-gray-400">Nothing</p>}
    </div>
  );
  return (
    <>
      {paras.length
        ? paras.map((t, i) => <p key={i} className="text-[13.5px] leading-relaxed text-axal-ink dark:text-gray-200">{t}</p>)
        : <p className="text-[13px]">{missing}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {uses('It reads', c.pulls, (x) => (x.module ? moduleLabel(c, x.module) : null))}
        {uses('It writes', c.sends, (x) => x.target || null)}
      </div>
      <div className="min-w-0">
        <h3 className={`${LABEL} mb-1`}>What Axal VC can access</h3>
        {Array.isArray(c.permissions) && c.permissions.length
          ? <ul className="list-disc pl-5 text-[13px] text-axal-ink dark:text-gray-200">{c.permissions.map((x) => <li key={x}>{x}</li>)}</ul>
          : <p className="text-[13px]">{missing}</p>}
      </div>
    </>
  );
}

function BodyTools({ tools, name }) {
  const groups = toolGroups(tools);
  if (!groups.length) return <p className="text-[13px] text-axal-muted dark:text-gray-400">Axal VC has no tools for {name} yet.</p>;
  return groups.map((g) => (
    <div key={g.access} className="min-w-0">
      <h3 className={`${LABEL} mb-1.5`}>{g.label}</h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {g.tools.map((t) => <ToolChip key={t.name || t.label} tool={t} />)}
      </ul>
    </div>
  ));
}

function ToolChip({ tool }) {
  const id = useId();
  const what = typeof tool.what === 'string' && tool.what ? tool.what : null;
  return (
    <li className={TOOL} aria-describedby={what ? id : undefined} title={what || undefined}>
      {tool.label}
      {what && <span id={id} hidden>{what}</span>}
    </li>
  );
}

function BodyDetails({ c, p }) {
  const rows = bodyDetailsRows(c, p);
  const ext = (href, label) => (
    <a key={href} href={href} target="_blank" rel="noopener noreferrer" className={BTN.link}>
      {label} ↗<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <dt className={LABEL}>{r.label}</dt>
          <dd className="min-w-0 break-words text-[13px] text-axal-ink dark:text-gray-200">
            {r.value === null
              ? <Unrecorded reason={r.reason}>Not recorded</Unrecorded>
              : r.kind === 'links'
                ? <span className="flex flex-wrap gap-x-3">{r.links.map((l) => ext(l.href, l.label))}</span>
                : r.kind === 'chip'
                  ? <span className={CHIP}>{r.value}</span>
                  : r.kind === 'mono'
                    ? <span className="break-all font-mono text-[12px]">{r.value}</span>
                    : r.href ? ext(r.href, r.value) : r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
