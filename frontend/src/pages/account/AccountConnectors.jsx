import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { connectorsApi } from '../../lib/api/connectors';
import { BrandIcon, PhoneBar, PhoneRows, Pill, Unrecorded, Unreadable, VerifiedBadge, usePhoneWidth } from '../../ui';
import { BTN, INPUT } from './AccountCenter';
import { Banner, Group, useConnectors } from './ConnectorSheet';
import Lightbox from '../../ui/Lightbox';
import { AssistantsSection } from './AssistantsGroup';
import { ChannelsSection } from './ChannelsGroup';
import {
  MOVED_SEEN_KEY, YOURS_FILTERS, YOURS_SORTS, cardAction, cardPill, companiesLabel, connectorPagePath,
  discoverSections, doesLabel, isEntityRow, isPersonalMercury, keysHref, lastSyncLabel, matchesQuery, oauthReturn, pageOf, stripReturn, yoursFeedsLabel, yoursRows,
  SUGGESTED,
} from './connectorsModel';
import { ACCOUNT_PHONE_COPY, ACCOUNT_PHONE_PAGES } from './accountPhone';
import { hubSearchFor, hubTabFor } from './connectorPageModel';
import { NO_FILTER, activeFilters, discoverFacets, discoverGrid, filterCatalogue, isVerified, makerLine, topSlice } from './discoverModel';
import { ActiveFilters, ConnectorFilterMenu } from './ConnectorFilterMenu';
import { FUND_ADMIN_GROUP, isMercurySearch, notOfferedSentence } from './mercuryModel';
import { useAuth } from '../../hooks/useAuthSync';
import { branchOfUser, isSuperAdminUser } from '../../lib/shellRole';

/**
 * D651 (#1463) — the Account center's Connectors section, `/account/connectors`,
 * drawn to `Connectors Page.dc.html` (`yours`, `yoursEmpty`, `discover`,
 * `discoverCat`, `add`, `moved`, `request`, `loading`, `unreadable`,
 * `noresults`) with the connector sheet from `ConnectorSheet.jsx`.
 *
 * Connectors replace Integrations (D649). `/integrations` and
 * `/account/integrations` land here with their query, because every
 * provider's sign-in still returns to `/integrations?…`. D753 (#1876): a
 * return naming a connector goes on to that connector's own page
 * (`ConnectorPage.jsx`), and every card, row and phone row links its page;
 * nothing here opens a right sheet but the request form (until F8). The tab
 * lives in the address (`?tab=discover`). Discover's filter is D753 F6's menu
 * (`ConnectorFilterMenu.jsx`), with every count from `discoverModel.js`.
 *
 * D751 (#1881): a connector Axal holds no OAuth client for reads "Not set up
 * here" with no +, on the card and the phone row alike, and a Super Admin
 * also gets "Add its keys in Integration keys" (`keysHref`).
 *
 * A CONNECTOR BELONGS TO THE MEMBER, and serves the companies its sheet
 * ticks. Two reads are the active company's: "Suggested for you" (its empty
 * modules) and the teammate notice in the connect flow.
 */

const TONE_CLS = 'rounded-axal-sm border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
// The house input without its full width, for the two selects beside the search.
const SELECT = INPUT.replace('w-full ', 'w-auto ');

function NR({ reason, children = 'Not recorded' }) {
  return <Unrecorded reason={reason}>{children}</Unrecorded>;
}

const NOT_IN_REGISTRY = 'This connector is not in the connector registry, which is where this is described.';
const NO_COMPANIES = 'Your companies could not be read.';

/** The once-only notice: shown on the first arrival from an old address, then remembered. */
export function useMovedNotice(location) {
  const [show] = useState(() => {
    if (!location.state?.connectorsMoved) return false;
    try {
      if (window.localStorage.getItem(MOVED_SEEN_KEY)) return false;
      window.localStorage.setItem(MOVED_SEEN_KEY, '1');
    } catch { /* storage blocked: the notice shows, and may show again */ }
    return true;
  });
  return show;
}

export function YoursTable({ rows, role = null }) {
  return (
    <div className={`${TONE_CLS} overflow-hidden`} data-testid="connectors-yours">
      <div role="row" className="hidden grid-cols-[minmax(0,1.5fr)_100px_80px_minmax(0,1.3fr)_80px_110px_140px] gap-2.5 border-b border-axal-hairline bg-axal-ground px-4 py-2 font-mono text-[10.5px] font-semibold uppercase tracking-[.06em] text-axal-muted md:grid dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-400">
        <span>Connector</span><span>Category</span><span>Does</span><span>Feeds</span><span>Companies</span><span>Last sync</span><span>Status</span>
      </div>
      {rows.map(({ p, status }) => (
        <Link key={p.key} to={connectorPagePath(p.key)} state={{ connectorsTab: 'yours' }} data-testid={`connector-row-${p.key}`}
          className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-b border-axal-hairline px-4 py-2.5 text-left text-[13px] last:border-b-0 hover:bg-axal-ground/60 md:grid-cols-[minmax(0,1.5fr)_100px_80px_minmax(0,1.3fr)_80px_110px_140px] dark:border-gray-800 dark:hover:bg-gray-800/40 ${status.why ? 'bg-amber-50/40 dark:bg-amber-950/10' : ''}`}>
          <span className="flex min-w-0 items-center gap-2.5">
            <BrandIcon provider={p.key} name={p.display_name} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-bold text-axal-ink dark:text-gray-100">{p.display_name}</span>
              {makerLine(p) && <span className="truncate text-[11.5px] text-axal-muted dark:text-gray-400">{makerLine(p)}</span>}
            </span>
          </span>
          <span className="hidden text-axal-muted md:block dark:text-gray-400">{p.category || <NR />}</span>
          <span className="hidden text-axal-muted md:block dark:text-gray-400">{doesLabel(p) || <NR reason={NOT_IN_REGISTRY} />}</span>
          <span className="hidden truncate text-axal-ink md:block dark:text-gray-300">{yoursFeedsLabel(p, role) || <NR reason={NOT_IN_REGISTRY} />}</span>
          <span className="hidden font-mono text-[12px] text-axal-muted md:block dark:text-gray-400">{p.connection?.first_party || isPersonalMercury(p) ? 'You' : companiesLabel(p.connection) || <NR reason={NO_COMPANIES} />}</span>
          <span className="hidden font-mono text-[12px] text-axal-muted md:block dark:text-gray-400">{lastSyncLabel(p.connection)}</span>
          <span className="flex flex-col items-start gap-0.5">
            <Pill tone={status.tone}>{status.label}</Pill>
            {status.why && <span className="text-[11px] text-amber-800 dark:text-amber-300">{status.why}</span>}
          </span>
        </Link>
      ))}
    </div>
  );
}

/**
 * #1780 decision 2 — the "Fund administration" group: one Mercury card for the
 * four Axal entities' connections, drawn only when the catalogue holds the
 * entity row (the Worker serves it to an admin on HQ alone). The card opens
 * Mercury's page (D753 F5, #1991), whose mount is the one audited read; the
 * group itself reads nothing.
 */
export function FundAdminSection({ catalogue }) {
  const p = (catalogue || []).find((x) => isEntityRow(x));
  if (!p) return null;
  return (
    <section className="flex min-w-0 flex-col gap-2.5" data-testid="fund-admin-group" aria-label={FUND_ADMIN_GROUP.title}>
      <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">{FUND_ADMIN_GROUP.title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="fund-admin-mercury">
        <ConnectorCard p={p} />
      </div>
    </section>
  );
}

/**
 * D753 F6 decision 9: a Discover card is a link to its connector's page. One
 * stretched link on the name covers the card, so "+" opens the page and never
 * starts a sign-in from the grid. The corner tiles are decoration (the link
 * says the state); Notify me and the badge are lifted above the link layer.
 */
export function ConnectorCard({ p, onNotify, onUnnotify, busy, keysHref: keys = null }) {
  const act = cardAction(p);
  const pill = cardPill(p);
  const to = connectorPagePath(p.key);
  const state = { connectorsTab: 'discover' };
  const maker = makerLine(p);
  let corner = null;
  if (act === 'add') corner = <span aria-hidden="true" className="grid h-[26px] w-[26px] place-items-center rounded-[8px] border border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100"><Plus size={14} /></span>;
  if (act === 'connected') corner = <span aria-hidden="true" className="grid h-[26px] w-[26px] place-items-center rounded-[8px] bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><Check size={14} /></span>;
  if (act === 'notify') corner = <button type="button" disabled={busy} onClick={() => onNotify(p)} className={`${BTN.link} relative z-10 max-sm:inline-flex max-sm:min-h-[44px] max-sm:items-center`}>Notify me</button>;
  if (act === 'joined') corner = <button type="button" disabled={busy} onClick={() => onUnnotify(p)} className={`${BTN.link} relative z-10`} title="Click to stop the notice">We&apos;ll tell you</button>;
  if (act === 'unavailable') corner = <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{p.unreadable ? 'Status unreadable' : 'Not set up here'}</span>;
  // D715: the Axal entities' Mercury opens its page, whatever else the row says.
  if (act === 'entity') corner = <span aria-hidden="true" className={BTN.link}>Open</span>;
  return (
    <article className={`${TONE_CLS} relative flex h-full flex-col gap-2 p-3.5 focus-within:ring-2 focus-within:ring-axal-violet/40`} data-testid={`connector-card-${p.key}`} data-action={act}>
      <div className="flex items-start justify-between"><BrandIcon provider={p.key} name={p.display_name} />{corner}</div>
      <h4 className="flex items-center gap-1.5 text-sm font-bold text-axal-ink dark:text-gray-100">
        <Link to={to} state={state} data-testid={`connector-open-${p.key}`} className="after:absolute after:inset-0 after:rounded-axal-sm focus:outline-none focus-visible:underline">
          {p.display_name}{act === 'connected' && <span className="sr-only"> · Connected</span>}
        </Link>
        {isVerified(p) && <span className="relative z-10"><VerifiedBadge on={p.verified_on} /></span>}
      </h4>
      <span className="line-clamp-2 text-[12.5px] leading-snug text-axal-ink/80 dark:text-gray-300">{p.tagline || p.description}</span>
      <div className="mt-auto flex items-center justify-between gap-1.5">
        {maker ? <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{maker}</span> : <span />}
        {pill && <Pill tone={pill.tone}>{pill.label}</Pill>}
        {/* #1780 decision 2: the entity row's badge, from the row the catalogue serves; drawing it reads nothing. */}
        {act === 'entity' && <span data-testid="connector-entity-badge"><Pill tone="info">{FUND_ADMIN_GROUP.badge}</Pill></span>}
      </div>
      {p.why && <span className="text-[11.5px] leading-snug text-axal-violet-deep dark:text-violet-300">{p.why}</span>}
      {keys && <Link to={keys} className={`${BTN.link} relative z-10 self-start text-[11.5px]`} data-testid={`connector-keys-link-${p.key}`}>Add its keys in Integration keys</Link>}
    </article>
  );
}

function TelegramCard() {
  const [channels, setChannels] = useState(null);
  const [state, setState] = useState({ requested: false, error: '' });
  useEffect(() => {
    let live = true;
    api.telegramJoinChannels().then((r) => { if (live) setChannels(r || { channels: [] }); }, () => { if (live) setChannels({ channels: [], failed: true }); });
    return () => { live = false; };
  }, []);
  const def = (channels?.channels || []).find((c) => c.slug === channels?.default_slug) || (channels?.channels || [])[0];
  const request = async () => {
    setState({ requested: false, error: '' });
    try {
      await api.telegramJoinRequest({ channel_slug: def.slug });
      setState({ requested: true, error: '' });
    } catch (e) {
      setState({ requested: false, error: e?.code === 'slack_webhook_unconfigured' ? "The studio's Slack inbox is not set up on this deployment yet. Ask an admin directly." : (e?.message || 'The request could not be sent.') });
    }
  };
  return (
    <div className={`${TONE_CLS} flex flex-col gap-2 p-3.5`} data-testid="connector-community-telegram">
      <span className="flex items-center gap-2.5">
        <BrandIcon provider="telegram" name="Telegram" />
        <span className="text-sm font-bold text-axal-ink dark:text-gray-100">Telegram · Axal VC channels</span>
      </span>
      <span className="text-[12.5px] leading-snug text-axal-ink/80 dark:text-gray-300">
        Ask for the invite link to your role&apos;s private channel{def ? <> (<b>{def.label}</b>)</> : ''}. An admin sends it to you.
      </span>
      {state.error && <span role="alert" className="text-[12px] text-red-700 dark:text-red-300">{state.error}</span>}
      <div className="mt-auto">
        {state.requested
          ? <span className="text-[12px] text-emerald-700 dark:text-emerald-300">Requested. An admin will message you the link.</span>
          : <button type="button" className={BTN.ghost} disabled={!def} onClick={request} title={def ? undefined : 'No channel is open to your role.'}>Request to join</button>}
      </div>
    </div>
  );
}

/**
 * "Request a connector": stored by `POST /requests` against the active
 * company, where the studio reads it. Both fields are required, as the
 * Worker requires them.
 */
export function RequestSheet({ onClose, tool: initial = '' }) {
  const [tool, setTool] = useState(initial);
  const [use, setUse] = useState('');
  const [state, setState] = useState({ busy: false, sent: false, error: '' });
  const ready = tool.trim().length > 0 && tool.trim().length <= 120 && use.trim().length > 0 && use.trim().length <= 1000;
  const send = async () => {
    setState({ busy: true, sent: false, error: '' });
    try {
      await connectorsApi.sendRequest(tool.trim(), use.trim());
      setState({ busy: false, sent: true, error: '' });
    } catch (e) {
      setState({
        busy: false, sent: false,
        error: e?.code === 'active_company_required'
          ? 'Choose a company in the sidebar first: a request is kept for a company.'
          : (e?.message || 'The request could not be sent.'),
      });
    }
  };
  return (
    // D753 F3 (#1956): a centred dialog, as the Settings tools are; the hub's Add menu and a page's "Request it." open the same one.
    <Lightbox label="Request a connector" eyebrow="Connector" title="Request a connector" sub="Tell us which tool you need." onClose={onClose} width={512} testId="connector-sheet-request"
      footer={state.sent
        ? <button type="button" className={BTN.primary} onClick={onClose}>Done</button>
        : <><button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button><button type="button" className={BTN.primary} disabled={!ready || state.busy} onClick={send} data-testid="button-send-request">{state.busy ? 'Sending…' : 'Send request'}</button></>}>
      <Group label="Request">
        <div className="space-y-1 px-3 py-2">
          <label htmlFor="request-tool" className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">Tool name</label>
          <input id="request-tool" className={INPUT} value={tool} onChange={(e) => setTool(e.target.value)} />
        </div>
        <div className="space-y-1 px-3 py-2">
          <label htmlFor="request-use" className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">What you would use it for</label>
          <textarea id="request-use" rows={3} className={INPUT} value={use} onChange={(e) => setUse(e.target.value)} />
        </div>
      </Group>
      {state.sent && <Banner tone="ok" data-testid="request-sent">Requested. The studio reads every request; nothing is promised about when a connector ships.</Banner>}
      {state.error && <Banner tone="danger" data-testid="request-error">{state.error}</Banner>}
    </Lightbox>
  );
}

export function AddMenu({ onBrowse, onRequest, initialOpen = false }) {
  const [open, setOpen] = useState(initialOpen);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  const item = 'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-axal-ink hover:bg-axal-ground disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-100 dark:hover:bg-gray-800';
  return (
    <div className="relative" ref={ref}>
      <button type="button" className={BTN.primary} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="button-connectors-add"><Plus size={13} aria-hidden="true" />Add <ChevronDown size={13} /></button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-20 flex w-60 flex-col rounded-xl border border-axal-hairline bg-white p-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-900" data-testid="connectors-add-menu">
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onBrowse(); }}>Browse connectors</button>
          <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); onRequest(); }}>Request a connector</button>
          <button type="button" role="menuitem" className={item} disabled title="The Worker has no MCP client yet.">
            Add a custom connector
            <span className="flex gap-1"><span className="rounded-full bg-axal-violet px-1.5 py-0.5 text-[9.5px] font-bold text-white">PRO</span><span className="rounded-full border border-dashed border-axal-hairline px-1.5 py-0.5 text-[9.5px] font-semibold text-axal-muted">Coming soon</span></span>
          </button>
        </div>
      )}
    </div>
  );
}

export default function ConnectorsSection() {
  const data = useConnectors();
  const phone = usePhoneWidth();
  const user = useAuth()?.user ?? null;
  // Decision 10's branch sentence: an admin on a branch. It chooses words only; the Worker serves the rows.
  const branchAdmin = user?.role === 'admin' && !!branchOfUser(user);
  // D751 (#1881): only a Super Admin can save a connector's keys, so only one is shown the way there.
  return <ConnectorsView data={data} phone={phone} branchAdmin={branchAdmin} role={user?.role ?? null} onBranch={!!branchOfUser(user)} superAdmin={isSuperAdminUser(user)} />;
}

// ---------------------------------------------------------------------------
// D700 (#1662) — A3m, the section on a phone
// ---------------------------------------------------------------------------

/** What a suggestion's row shows when its card carries no pill: the card's corner action, as a word. */
function actionPill(p, act) {
  if (act === 'add') return { label: '+', tone: 'info' };
  if (act === 'connected') return { label: 'Connected', tone: 'ok' };
  if (act === 'notify') return { label: 'Notify me', tone: 'info' };
  if (act === 'joined') return { label: "We'll tell you", tone: 'neutral' };
  if (act === 'entity') return { label: 'Open', tone: 'info' };
  return { label: p.unreadable ? 'Status unreadable' : 'Not set up here', tone: 'neutral' };
}

/** The catalogue's state, said once, where a section cannot draw rows. */
function catalogueNote(data) {
  if (data.status === 'loading' && !data.catalogue.length) return <span data-testid="connectors-loading">Loading connectors…</span>;
  if (data.status === 'forbidden') return <span data-testid="connectors-forbidden">{data.message || 'Your role cannot manage connectors.'}</span>;
  if (data.status === 'unreadable') return <Unreadable what="The catalogue" claim="This is not a claim that you have no connectors." onRetry={data.reload} />;
  return null;
}

/**
 * A3m's Yours: one row per connection, led by its brand mark. The description
 * is what it feeds and its last sync, with the reason first when it needs
 * attention; the pill is its status; the section's action is the count line.
 */
export function yoursGroup({ data, rows, paged, setPage = () => {}, label = ACCOUNT_PHONE_PAGES.connectors.sections[0], now = Date.now(), role = null }) {
  const group = { label, rows: [], testid: 'connectors-phone-yours' };
  const pending = catalogueNote(data);
  if (pending) return { ...group, note: pending };
  if (data.itemsFailed) return { ...group, note: <Unreadable what="Your connections" claim="This is not a claim that you have none." onRetry={data.reload} /> };
  if (!data.catalogue.some((p) => p.connection)) {
    return { ...group, note: <span data-testid="connectors-yours-empty">No connectors yet. Connect Stripe to see your revenue, or your calendar to book interviews.</span> };
  }
  if (!rows.length) return { ...group, note: 'None of your connectors matches this search.' };
  group.rows = paged.rows.map(({ p, status }) => ({
    key: p.key,
    icon: <BrandIcon provider={p.key} name={p.display_name} />,
    title: p.display_name,
    description: [status.why, yoursFeedsLabel(p, role), lastSyncLabel(p.connection, now)].filter(Boolean).join(' · '),
    pill: { label: status.label, tone: status.tone },
    to: connectorPagePath(p.key),
    testid: `connector-row-${p.key}`,
  }));
  group.action = (
    <span className="flex items-center gap-2" data-testid="connectors-count">
      {paged.pages > 1 && <button type="button" aria-label="Previous page" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)} className="disabled:opacity-40">‹</button>}
      {paged.count}
      {paged.pages > 1 && <button type="button" aria-label="Next page" disabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)} className="disabled:opacity-40">›</button>}
    </span>
  );
  return group;
}

/**
 * A3m's Suggested for you: the active company's suggestions, as Discover
 * builds them, each with its card's pill or corner action. The read is the
 * active company's, made without a company parameter, as on desktop.
 */
export function suggestedGroup({ data, q = '', label = ACCOUNT_PHONE_PAGES.connectors.sections[1], onNotify, onBrowse, superAdmin = false }) {
  const group = { label, rows: [], testid: 'connectors-phone-suggested' };
  const pending = catalogueNote(data);
  if (pending) return { ...group, note: data.status === 'loading' ? 'Loading suggestions…' : null };
  group.cta = { label: ACCOUNT_PHONE_COPY.browseConnectors, onClick: onBrowse, testid: 'connectors-phone-browse' };
  const [section] = discoverSections(data.catalogue, SUGGESTED, { q, suggestions: data.suggestions ?? null });
  if (section.cards === null) {
    const why = data.suggestionsNote || 'Suggestions could not be read.';
    return { ...group, note: <span data-testid="connectors-suggestions-none"><NR reason={why} /> · {why}</span> };
  }
  if (!section.cards.length) return { ...group, note: 'Nothing to suggest: every module a connector could feed already has data.' };
  group.rows = section.cards.map((p) => {
    const act = cardAction(p);
    // D751 (#1881): a row that cannot be connected says so first, as its card does, not "Beta".
    const pill = act === 'unavailable' ? actionPill(p, act) : cardPill(p) || actionPill(p, act);
    const keys = keysHref(p, { superAdmin });
    return {
      key: p.key,
      icon: <BrandIcon provider={p.key} name={p.display_name} />,
      title: p.display_name,
      description: keys ? 'Add its keys in Integration keys.' : p.why || p.description,
      pill,
      ...(keys ? { to: keys } : act === 'notify' ? { onClick: () => onNotify(p, true) } : act === 'joined' ? { onClick: () => onNotify(p, false) } : { to: connectorPagePath(p.key) }),
      testid: `connector-suggested-${p.key}`,
    };
  });
  return group;
}

/** A3m — Connectors on a phone, given the `useConnectors()` read. */
export function ConnectorsPhoneView(props) {
  return <ConnectorsView {...props} phone />;
}

/** The section, drawn from one `useConnectors()` read; exported so a test can hand it each state. */
export function ConnectorsView({ data, initialTab = 'yours', initialFilter = NO_FILTER, initialQuery = '', phone = false, branchAdmin = false, role = null, onBranch = false, superAdmin = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const moved = useMovedNotice(location);
  // D753 — the tab is in the address: `?tab=discover`, else Yours (or the test's `initialTab`).
  const [tab, setTab] = useState(() => hubTabFor(location.search, initialTab));
  const [q, setQ] = useState(initialQuery);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(initialFilter);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setShowAll(false); }, [sel, q]);
  const [requesting, setRequesting] = useState(null);
  const [waitBusy, setWaitBusy] = useState(false);
  const [waitError, setWaitError] = useState('');

  // A return from a provider's sign-in (a bookmarked `/account/connectors?oauth=…`):
  // D753 sends it on to its connector's page, which says what happened.
  const [ret] = useState(() => oauthReturn(location.search));
  useEffect(() => {
    if (!ret) return;
    // Mercury has no sign-in: a return naming it is crafted, and must not cause the entity sheet's audited read (D715).
    if (ret.key === 'mercury') {
      navigate({ pathname: location.pathname, search: stripReturn(location.search, ret.strip), hash: location.hash }, { replace: true, state: location.state });
    } else {
      navigate({ pathname: connectorPagePath(ret.key), search: location.search, hash: location.hash }, { replace: true, state: location.state });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseTab = (t) => {
    setTab(t);
    navigate({ pathname: location.pathname, search: hubSearchFor(location.search, t), hash: location.hash }, { replace: true, state: location.state });
  };

  const rows = useMemo(() => yoursRows(data.catalogue, { q, filter, sort }), [data.catalogue, q, filter, sort]);
  const paged = pageOf(rows, page);
  // D753 F6: the menu's counts and the grid's cards both come from `filterCatalogue`, so they cannot differ.
  const facets = useMemo(() => discoverFacets(data.catalogue, data.suggestions ?? null, {
    q, ...sel, categoryOrder: data.categoryOrder ?? null, connectionsRead: !data.itemsFailed, suggestionsNote: data.suggestionsNote || '',
  }), [data.catalogue, data.suggestions, data.categoryOrder, data.itemsFailed, data.suggestionsNote, q, sel]);
  const sections = useMemo(() => discoverGrid(data.catalogue, { q, ...sel, suggestions: data.suggestions ?? null, phone }), [data.catalogue, data.suggestions, q, sel, phone]);
  const shown = useMemo(() => filterCatalogue(data.catalogue, { q, ...sel, suggestions: data.suggestions ?? null }).length, [data.catalogue, data.suggestions, q, sel]);
  const chips = activeFilters(sel, facets);
  const clearChip = (group) => setSel(group === 'all' ? NO_FILTER : { ...sel, [group]: 'all' });
  const noFilter = sel.where === 'all' && sel.type === 'all';
  const anyConnected = data.catalogue.some((p) => p.connection);
  // One search rule (`matchesQuery`) for the lists and for "No connector
  // called…": on Yours the question is your connectors, on Discover the catalogue.
  // #1780 decision 2: the Fund administration group draws the entity row on both tabs, so Yours' search counts it too.
  const anyMatch = data.catalogue.some((p) => (tab === 'yours' ? !!p.connection || isEntityRow(p) : true) && matchesQuery(p, q));
  // D715 decision 10: a search for Mercury when the Worker serves this profile no Mercury row says why, and offers no request.
  const mercuryWithheld = isMercurySearch(q) && !data.catalogue.some((p) => p.key === 'mercury');
  const notOffered = <span data-testid="connectors-mercury-not-offered">{notOfferedSentence({ branchAdmin, role, onBranch })}</span>;

  const notify = async (p, join) => {
    setWaitBusy(true); setWaitError('');
    try {
      if (join) await connectorsApi.notifyMe(p.key);
      else await connectorsApi.stopNotify(p.key);
      data.reload();
    } catch (e) { setWaitError(e?.message || 'That could not be saved.'); }
    finally { setWaitBusy(false); }
  };

  // Discover: the desktop's second tab, and on a phone the list kept below A3m's sections.
  const cardOf = (p) => <ConnectorCard key={p.key} p={p} onNotify={(x) => notify(x, true)} onUnnotify={(x) => notify(x, false)} busy={waitBusy} keysHref={keysHref(p, { superAdmin })} />;
  const discover = (
    <>
      {waitError && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{waitError}</p>}
      {sections.map((s) => {
        const top = s.id === 'top';
        const slice = top ? topSlice(s.cards) : { cards: s.cards, more: 0 };
        const cards = top && showAll ? s.cards : slice.cards;
        const gridId = `connectors-grid-${s.id}`;
        return (
          <section key={s.id} className="flex flex-col gap-2.5" data-testid={`connectors-section-${s.title}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-[15px] font-bold text-axal-ink dark:text-gray-100">{s.title} {Array.isArray(s.cards) && <Pill tone="neutral">{s.cards.length}</Pill>}</h3>
              {top && slice.more > 0 && (
                <button type="button" className={BTN.link} aria-expanded={showAll} aria-controls={gridId} onClick={() => setShowAll((v) => !v)} data-testid="button-connectors-show-all">
                  {showAll ? 'Show fewer' : 'Show all →'}
                </button>
              )}
            </div>
            {s.cards === null && (
              <div className={`${TONE_CLS} p-4 text-[13px]`} data-testid="connectors-suggestions-none">
                <NR reason={data.suggestionsNote || 'Suggestions could not be read.'} /> <span className="text-axal-muted dark:text-gray-400">· {data.suggestionsNote || 'Suggestions could not be read.'}</span>
              </div>
            )}
            {Array.isArray(s.cards) && !s.cards.length && (
              sel.type === 'suggested' && !q.trim()
                ? <p className="text-[13px] text-axal-muted dark:text-gray-400">Nothing to suggest: every module a connector could feed already has data.</p>
                : !noFilter && q.trim()
                  ? <p className="text-[13px] text-axal-muted dark:text-gray-400" data-testid="connectors-choice-empty">No {s.title} connector matches &lsquo;{q.trim()}&rsquo;. <button type="button" className={`${BTN.link} font-bold`} onClick={() => setSel(NO_FILTER)}>Clear filters</button></p>
                  : <p className="text-[13px] text-axal-muted dark:text-gray-400">No connector here yet.</p>
            )}
            {Array.isArray(s.cards) && s.cards.length > 0 && (
              <div id={gridId} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">{cards.map(cardOf)}</div>
            )}
          </section>
        );
      })}
      {noFilter && (
        <section className="flex flex-col gap-2.5">
          <h3 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Community</h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"><TelegramCard /></div>
        </section>
      )}
    </>
  );

  let content;
  if (data.status === 'loading' && !data.catalogue.length) {
    content = <div className={`${TONE_CLS} p-6 text-[13px] text-axal-muted dark:text-gray-400`} data-testid="connectors-loading">Loading connectors…</div>;
  } else if (data.status === 'forbidden') {
    content = (
      <div className={`${TONE_CLS} p-4 text-[13px] text-axal-ink dark:text-gray-200`} data-testid="connectors-forbidden">
        {data.message || 'Your role cannot manage connectors.'}
      </div>
    );
  } else if (data.status === 'unreadable') {
    content = (
      <div className="rounded-axal-sm border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30" data-testid="connectors-unreadable">
        <Unreadable what="The catalogue" claim="This is not a claim that you have no connectors." onRetry={data.reload} />
      </div>
    );
  } else if (q.trim() && !anyMatch && !(tab === 'yours' && data.itemsFailed)) {
    content = (
      <div className={`${TONE_CLS} p-5 text-[13px] text-axal-ink dark:text-gray-200`} data-testid="connectors-noresults">
        {mercuryWithheld ? notOffered : <>No connector called &lsquo;{q.trim()}&rsquo;. <button type="button" className={`${BTN.link} font-bold`} onClick={() => setRequesting(q.trim())}>Request it.</button></>}
      </div>
    );
  } else if (tab === 'yours') {
    if (data.itemsFailed) {
      content = <div className={`${TONE_CLS} p-4`}><Unreadable what="Your connections" claim="This is not a claim that you have none." onRetry={data.reload} /></div>;
    } else if (!anyConnected) {
      content = (
        <div className={`${TONE_CLS} flex flex-col items-start gap-2.5 px-5 py-7`} data-testid="connectors-yours-empty">
          <span className="text-sm leading-relaxed text-axal-ink/80 dark:text-gray-300">No connectors yet. Connect Stripe to see your revenue, or your calendar to book interviews.</span>
          <button type="button" className={BTN.primary} onClick={() => chooseTab('discover')}>Browse connectors</button>
        </div>
      );
    } else {
      content = (
        <>
          <YoursTable rows={paged.rows} role={role} />
          <div className="flex items-center justify-between px-1 font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid="connectors-count">
            <span>{paged.count}</span>
            <span className="flex items-center gap-2">
              <button type="button" aria-label="Previous page" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)} className="disabled:opacity-40">‹</button>
              {paged.page}
              <button type="button" aria-label="Next page" disabled={paged.page >= paged.pages} onClick={() => setPage(paged.page + 1)} className="disabled:opacity-40">›</button>
            </span>
          </div>
        </>
      );
    }
  } else {
    content = discover;
  }

  const movedNote = moved && <div className="rounded-[10px] border border-axal-violet/25 bg-axal-lavender px-3.5 py-2.5 text-[13px] text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-200" data-testid="connectors-moved">Integrations are now Connectors.</div>;
  // On a phone Discover is not a tab: it is kept below A3m's sections, and
  // "Browse connectors" scrolls to it in place.
  const browse = phone
    ? () => { setSel(NO_FILTER); document.getElementById('connectors-discover')?.scrollIntoView?.({ block: 'start' }); }
    : () => { chooseTab('discover'); setSel(NO_FILTER); };
  const tabs = (
    <div className="flex rounded-[10px] border border-axal-hairline bg-white p-[3px] dark:border-gray-700 dark:bg-gray-900" role="tablist" aria-label="Connectors">
      {[['yours', 'Yours'], ['discover', 'Discover']].map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { chooseTab(id); setPage(1); }} data-testid={`tab-connectors-${id}`}
          className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold ${tab === id ? 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`}>
          {label}
        </button>
      ))}
    </div>
  );
  const onDiscover = phone || tab === 'discover';
  const toolbar = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!phone && tabs}
        <input type="search" aria-label="Search connectors" placeholder="Search connectors…" className={`${INPUT} min-w-[180px] flex-1`} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="input-connectors-search" />
        {tab === 'yours' && (
          <>
            <select aria-label="Filter" className={SELECT} value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
              {YOURS_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            <select aria-label="Sort" className={SELECT} value={sort} onChange={(e) => setSort(e.target.value)}>
              {YOURS_SORTS.map((s) => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
            </select>
          </>
        )}
        {onDiscover && <ConnectorFilterMenu facets={facets} value={sel} onChange={setSel} phone={phone} shown={shown} />}
        <AddMenu onBrowse={browse} onRequest={() => setRequesting('')} />
      </div>
      {onDiscover && <ActiveFilters chips={chips} onClear={clearChip} />}
    </div>
  );
  const extras = (
    <>
      {/* #1780 decision 2: the Axal entities' Mercury, on both tabs and on a phone. */}
      <FundAdminSection catalogue={data.catalogue} />

      {/* D684 (#1578): business Telegram and WhatsApp, Zoom and Google Meet, on
          both tabs. Zoom and Google connect on their own pages (D753). */}
      <ChannelsSection catalogue={data.catalogue} onOpenConnector={(key) => { if (data.catalogue.some((x) => x.key === key)) navigate(connectorPagePath(key)); }} />

      {/* D668 (#1498): AI assistants that use StudioOS (D665), on both tabs. */}
      <AssistantsSection />

      {requesting !== null && <RequestSheet tool={requesting} onClose={() => setRequesting(null)} />}
    </>
  );

  if (phone) {
    const page = ACCOUNT_PHONE_PAGES.connectors;
    return (
      <div className="flex min-w-0 flex-col gap-3.5" data-testid="connectors-section" data-phone="true">
        <div className="-mx-[22px]">
          <PhoneBar back={{ label: 'Back' }} title={page.title} sub={page.sub} eadwynLabel={page.title} />
          <div className="pt-[18px]">
            <PhoneRows groups={[
              yoursGroup({ data, rows, paged, setPage, label: page.sections[0], role }),
              suggestedGroup({ data, q, label: page.sections[1], onNotify: notify, onBrowse: browse, superAdmin }),
            ]} />
          </div>
        </div>
        {movedNote}
        <section id="connectors-discover" className="flex scroll-mt-24 flex-col gap-2.5" data-testid="connectors-phone-discover">
          <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Discover</h2>
          {toolbar}
          {(data.status === 'ready' || data.catalogue.length > 0) && (q.trim() && !data.catalogue.some((p) => matchesQuery(p, q))
            ? <div className={`${TONE_CLS} p-5 text-[13px] text-axal-ink dark:text-gray-200`} data-testid="connectors-noresults">
                {mercuryWithheld ? notOffered : <>No connector called &lsquo;{q.trim()}&rsquo;. <button type="button" className={`${BTN.link} font-bold`} onClick={() => setRequesting(q.trim())}>Request it.</button></>}
              </div>
            : discover)}
        </section>
        {extras}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3.5" data-testid="connectors-section" data-tab={tab}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">Connectors</h2>
          <p className="mt-1 text-[13.5px] text-axal-muted dark:text-gray-400">Bring your tools into StudioOS, and send your work back to them.</p>
        </div>
      </div>

      {movedNote}

      {toolbar}

      {content}

      {extras}
    </div>
  );
}

