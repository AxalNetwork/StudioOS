import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { connectorsApi } from '../../lib/api/connectors';
import { BrandIcon, PhoneBar, Unrecorded, Unreadable, usePhoneWidth } from '../../ui';
import { BTN } from './AccountCenter';
import { ConnectorPanel, PermissionsGroup, SheetFrame, UsesGroups, openingView, useConnectors } from './ConnectorSheet';
import { RequestSheet, useMovedNotice } from './AccountConnectors';
import { cardAction, isEntityRow, stripReturn } from './connectorsModel';
import { backHrefFor, detailsRows, interimMode, pageEntry, pageReturn, pageTitle } from './connectorPageModel';
import { isChannelKey } from './channelPageModel';
import ChannelPage from './ChannelPage';
import { notOfferedSentence } from './mercuryModel';
import { useAuth } from '../../hooks/useAuthSync';
import { branchOfUser } from '../../lib/shellRole';

/**
 * D753 (#1876, F1) — a connector's own page, `/account/connectors/<key>`,
 * inside the Account center. The owner's ask (2026-10-18): every connector has
 * a page with a description, not a right sidebar. This task frames it from
 * Claude's own connector directory (screenshot C): the back link, the header
 * band (tile, name, tagline), a notice region, About and Details.
 *
 * NOTHING IS LOST WHILE THE WORK MOVES (decision 7). Until F2 to F5 replace
 * it, today's `ConnectorPanel` is mounted inline in "Connect and manage",
 * through `SheetFrame`'s `page` layout: in the page's flow, no overlay, no
 * dialog role, no × and no Escape of its own. Closing returns the region to
 * its opening view; it never leaves the page (decision 9).
 *
 * A SIGN-IN COMES BACK HERE (decision 6). `connectorsRedirect` sends a return
 * naming this key to this page; the page reads it only when it names its own
 * key (never Mercury's, D715 decision 3), opens the panel on what happened,
 * and strips the query.
 *
 * The name is the page's one `<h1>` (decision 10): on desktop `SettingsPage`
 * draws no "Account" heading here, and on a phone `PhoneBar` draws it.
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
  return <ConnectorPageView data={data} connectorKey={connectorKey} phone={phone} branchAdmin={branchAdmin} />;
}

/** The page, drawn from one `useConnectors()` read; exported so a test can hand it each state. */
export function ConnectorPageView({ data, connectorKey, phone = false, branchAdmin = false }) {
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
    <div className="flex min-w-0 flex-col gap-4" data-testid="connector-page" data-state="ready" data-key={p.key}>
      {back}
      <header data-testid="connector-page-band" className="flex min-w-0 items-center gap-4 rounded-axal-sm bg-axal-ground p-5 dark:bg-gray-800/60">
        <BrandIcon provider={p.key} name={p.display_name} size={phone ? 48 : 56} />
        <div className="min-w-0">
          {!phone && <h1 className="text-2xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">{p.display_name}</h1>}
          {p.description && <p className="mt-0.5 min-w-0 break-words text-[13.5px] leading-snug text-axal-muted dark:text-gray-400">{p.description}</p>}
        </div>
        {/* F2 adds the band's action on this side. */}
      </header>

      {moved && (
        <div data-testid="connector-page-notices">
          <div className="rounded-[10px] border border-axal-violet/25 bg-axal-lavender px-3.5 py-2.5 text-[13px] text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-200" data-testid="connectors-moved">Integrations are now Connectors.</div>
        </div>
      )}

      <ConnectRegion p={p} ret={returned?.ret || null} onChanged={data.reload} />
      <About p={p} />
      <Details p={p} />
    </div>
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
      {requesting && (
        <SheetFrame.Provider value={{ layout: 'page', onDismiss: () => setRequesting(false) }}>
          <RequestSheet tool={connectorKey} onClose={() => setRequesting(false)} />
        </SheetFrame.Provider>
      )}
    </>
  );
}

/**
 * "Connect and manage" (decisions 7 to 9): today's panel, inline, until F2
 * to F5; a waitlist connector's button; or an unavailable one's words. The
 * panel's view resets when the connection appears or goes (the `key`).
 */
function ConnectRegion({ p, ret, onChanged }) {
  const mode = interimMode(p, ret);
  return (
    <section aria-label="Connect and manage" data-testid="connector-page-connect" data-mode={mode}>
      {mode === 'panel' && <InlinePanel key={`${p.key}:${p.connection ? 'c' : 'n'}`} p={p} ret={ret} onChanged={onChanged} />}
      {mode === 'waitlist' && <Waitlist p={p} onChanged={onChanged} />}
      {mode === 'unavailable' && (
        <div className={BOX} data-testid="connector-page-unavailable">{p.unreadable ? 'Status unreadable' : 'Not set up here'}</div>
      )}
    </section>
  );
}

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
        eyebrow={isEntityRow(p) ? 'Fund administration' : 'Connect and manage'}
      />
    </SheetFrame.Provider>
  );
}

/** A Coming soon connector: Notify me, or We'll tell you, as its card offers. */
function Waitlist({ p, onChanged }) {
  const joined = cardAction(p) === 'joined';
  const [state, setState] = useState({ busy: false, error: '' });
  const act = async () => {
    setState({ busy: true, error: '' });
    try {
      if (joined) await connectorsApi.stopNotify(p.key);
      else await connectorsApi.notifyMe(p.key);
      onChanged?.();
      setState({ busy: false, error: '' });
    } catch (e) { setState({ busy: false, error: e?.message || 'That could not be saved.' }); }
  };
  return (
    <div className={BOX} data-testid="connector-page-waitlist">
      <span className="mr-2 text-axal-muted dark:text-gray-400">Coming soon.</span>
      <button type="button" disabled={state.busy} onClick={act} className={BTN.link} title={joined ? 'Click to stop the notice' : undefined}>
        {joined ? 'We’ll tell you' : 'Notify me'}
      </button>
      {state.error && <p role="alert" className="mt-2 text-[12px] text-red-700 dark:text-red-300">{state.error}</p>}
    </div>
  );
}

/** About: what it reads and sends, and what it may do, from today's fields. It makes no read. */
function About({ p }) {
  // Mercury's own groups read its status on mount, so they stay in the inline panel (F5 lays out its About).
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
