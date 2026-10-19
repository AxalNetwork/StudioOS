import { useEffect, useId, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { connectorsApi } from '../../lib/api/connectors';
import { Info } from 'lucide-react';
import { BrandIcon, PhoneBar, Unrecorded, Unreadable, usePhoneWidth } from '../../ui';
import { BTN } from './AccountCenter';
import { ConnectorPanel, PermissionsGroup, SheetFrame, UsesGroups, openingView, useConnectors } from './ConnectorSheet';
import { RequestSheet, useMovedNotice } from './AccountConnectors';
import { cardAction, isEntityRow, moduleLabel, stripReturn } from './connectorsModel';
import {
  DETAIL_MISSING, backHrefFor, bodyDetailsRows, detailsRows, headerTagline, interimMode, modeLabel, pageEntry, pageLanding, pageTitle, toolGroups,
} from './connectorPageModel';
import { isChannelKey } from './channelPageModel';
import ChannelPage from './ChannelPage';
import GithubRepositoriesSection, { REPOSITORIES_ID } from './GithubRepositoriesSection';
import { notOfferedSentence } from './mercuryModel';
import { MercuryEntityPageBody } from './MercurySheet';
import { useAuth } from '../../hooks/useAuthSync';
import { branchOfUser } from '../../lib/shellRole';
import { ZOOM_DISCONNECT_NOTE, ZOOM_SECTIONS, usedByLinks, zoomHowItWorks, zoomNotices } from '../../lib/validateSourceWording';

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
 * GITHUB'S REPOSITORIES (#1957, F4). GitHub's page draws its repositories as
 * its own Repositories section (`GithubRepositoriesSection`), beside "Connect
 * and manage", never the panel's sync view. Its sign-in and the GitHub App's
 * Setup URL land on that section (`pageLanding`); the Setup URL's
 * `installation_id` and `setup_action` are stripped and never drawn.
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
 * audited read on mount and no header action. A member's own Mercury stays in
 * the interim panel until F3 (#1956) draws "Your connection".
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
  // GitHub's return lands on its Repositories section, with the App's Setup URL query stripped too (#1957).
  const [returned] = useState(() => (entry.state === 'alias' ? null : pageLanding(location.search, connectorKey)));
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

  const tagline = headerTagline(p, shownBody?.state === 'ready' ? shownBody.connector : null);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="connector-page" data-state="ready" data-key={p.key}>
      {back}
      <header data-testid="connector-page-band" className="flex min-w-0 items-center gap-4 rounded-axal-sm bg-axal-ground p-5 dark:bg-gray-800/60">
        <BrandIcon provider={p.key} name={p.display_name} size={phone ? 48 : 56} />
        <div className="min-w-0">
          {!phone && <h1 className="text-2xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">{p.display_name}</h1>}
          {tagline && <p className="mt-0.5 min-w-0 break-words text-[13.5px] leading-snug text-axal-muted dark:text-gray-400" data-testid="connector-page-tagline">{tagline}</p>}
        </div>
        {/* F2 adds the band's action on this side. */}
      </header>

      {moved && (
        <div data-testid="connector-page-notices">
          <div className="rounded-[10px] border border-axal-violet/25 bg-axal-lavender px-3.5 py-2.5 text-[13px] text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-200" data-testid="connectors-moved">Integrations are now Connectors.</div>
        </div>
      )}

      <ConnectRegion p={p} ret={returned?.ret || null} onChanged={data.reload} />
      {p.key === 'github' && <GithubRepositoriesSection p={p} focus={!!returned?.repositories} onChanged={data.reload} />}
      {p.key === 'zoom' && <ZoomValidate p={p} />}
      {shownBody
        ? <ConnectorBody state={shownBody.state} connector={shownBody.connector} p={p} onRetry={retryBody} />
        : (
          <>
            <About p={p} />
            <Details p={p} />
          </>
        )}
    </div>
  );
}

/**
 * D757 §2.12 (#1929): what Zoom feeds and needs, in D757's words, from the
 * catalogue row's `used_by`, `suggests`, `distribution` and `configured`
 * (#1922, D751), so it draws with or without F7's body.
 */
export function ZoomValidate({ p }) {
  const notices = zoomNotices(p);
  const usedBy = usedByLinks(p?.used_by);
  return (
    <section data-testid="connector-page-validate" className="flex min-w-0 flex-col gap-3">
      {notices.map((n) => (
        <div key={n.key} role="note" data-testid={`zoom-notice-${n.key}`} className="flex items-start gap-2 rounded-axal-sm border border-axal-hairline bg-axal-ground px-3.5 py-2.5 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-axal-muted dark:text-gray-400" aria-hidden="true" />
          <span className="min-w-0">{n.text}</span>
        </div>
      ))}
      {(p?.connection || p?.already_connected === true) && <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="zoom-disconnect-note">{ZOOM_DISCONNECT_NOTE}</p>}
      {usedBy.length > 0 && (
        <div className="min-w-0" data-testid="zoom-used-by">
          <h2 className={H2}>Used by</h2>
          <ul className="mt-1 flex flex-wrap gap-2">
            {usedBy.map((u) => <li key={u.href}><Link to={u.href} className={`${BTN.link} text-[13px]`}>{u.label}</Link></li>)}
          </ul>
        </div>
      )}
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
  // D753 F5 (#1991): the Axal entities' Mercury is drawn on the page itself, never
  // the interim panel. A sign-in return never names Mercury (`pageReturn`).
  if (isEntityRow(p)) {
    return (
      <section aria-label="Connect and manage" data-testid="connector-page-connect" data-mode="entity">
        <MercuryEntityPageBody p={p} />
      </section>
    );
  }
  // A member's own Mercury stays in the interim panel until F3 (#1956) gives the page "Your connection".
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
        // D753 F4 (#1957): GitHub's repositories are the page's own section, never the sync view.
        setView={(view) => (p.key === 'github' && view === 'sync' ? toRepositories() : setState({ view, ret: {} }))}
        onChanged={onChanged}
        onClose={reset}
        eyebrow="Connect and manage"
      />
    </SheetFrame.Provider>
  );
}

/** The Repositories section's heading takes focus, which scrolls it into view. */
function toRepositories() {
  if (typeof document === 'undefined') return;
  document.getElementById(REPOSITORIES_ID)?.querySelector?.('h2')?.focus?.();
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
