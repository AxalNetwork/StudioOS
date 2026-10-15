import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { connectorsApi } from '../../lib/api/connectors';
import { BrandIcon, PhoneBar, PhoneRows, Pill, Unrecorded, Unreadable, usePhoneWidth } from '../../ui';
import { BTN, INPUT } from './AccountCenter';
import { Banner, ConnectorPanel, Group, Sheet, openingView, useConnectors } from './ConnectorSheet';
import { AssistantsSection } from './AssistantsGroup';
import { ChannelsSection } from './ChannelsGroup';
import {
  MOVED_SEEN_KEY, YOURS_FILTERS, YOURS_SORTS, cardAction, cardPill, companiesLabel, discoverChips,
  discoverSections, doesLabel, feedsLabel, lastSyncLabel, matchesQuery, oauthReturn, pageOf, stripReturn, yoursRows,
  SUGGESTED,
} from './connectorsModel';
import { ACCOUNT_PHONE_COPY, ACCOUNT_PHONE_PAGES } from './accountPhone';

/**
 * D651 (#1463) — the Account center's Connectors section, `/account/connectors`,
 * drawn to `Connectors Page.dc.html` (`yours`, `yoursEmpty`, `discover`,
 * `discoverCat`, `add`, `moved`, `request`, `loading`, `unreadable`,
 * `noresults`) with the connector sheet from `ConnectorSheet.jsx`.
 *
 * Connectors replace Integrations (D649). `/integrations` and
 * `/account/integrations` land here with their query, because every
 * provider's sign-in still returns to `/integrations?…`; this section reads
 * that query, opens the connector's sheet on what happened, and strips it.
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
function useMovedNotice(location) {
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

export function YoursTable({ rows, onOpen }) {
  return (
    <div className={`${TONE_CLS} overflow-hidden`} data-testid="connectors-yours">
      <div role="row" className="hidden grid-cols-[minmax(0,1.5fr)_100px_80px_minmax(0,1.3fr)_80px_110px_140px] gap-2.5 border-b border-axal-hairline bg-axal-ground px-4 py-2 font-mono text-[10.5px] font-semibold uppercase tracking-[.06em] text-axal-muted md:grid dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-400">
        <span>Connector</span><span>Category</span><span>Does</span><span>Feeds</span><span>Companies</span><span>Last sync</span><span>Status</span>
      </div>
      {rows.map(({ p, status }) => (
        <button key={p.key} type="button" onClick={() => onOpen(p)} data-testid={`connector-row-${p.key}`}
          className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-b border-axal-hairline px-4 py-2.5 text-left text-[13px] last:border-b-0 hover:bg-axal-ground/60 md:grid-cols-[minmax(0,1.5fr)_100px_80px_minmax(0,1.3fr)_80px_110px_140px] dark:border-gray-800 dark:hover:bg-gray-800/40 ${status.why ? 'bg-amber-50/40 dark:bg-amber-950/10' : ''}`}>
          <span className="flex min-w-0 items-center gap-2.5">
            <BrandIcon provider={p.key} name={p.display_name} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-bold text-axal-ink dark:text-gray-100">{p.display_name}</span>
              <span className="truncate text-[11.5px] text-axal-muted dark:text-gray-400">by {p.by}</span>
            </span>
          </span>
          <span className="hidden text-axal-muted md:block dark:text-gray-400">{p.category || <NR />}</span>
          <span className="hidden text-axal-muted md:block dark:text-gray-400">{doesLabel(p) || <NR reason={NOT_IN_REGISTRY} />}</span>
          <span className="hidden truncate text-axal-ink md:block dark:text-gray-300">{feedsLabel(p) || <NR reason={NOT_IN_REGISTRY} />}</span>
          <span className="hidden font-mono text-[12px] text-axal-muted md:block dark:text-gray-400">{p.connection?.first_party ? 'You' : companiesLabel(p.connection) || <NR reason={NO_COMPANIES} />}</span>
          <span className="hidden font-mono text-[12px] text-axal-muted md:block dark:text-gray-400">{lastSyncLabel(p.connection)}</span>
          <span className="flex flex-col items-start gap-0.5">
            <Pill tone={status.tone}>{status.label}</Pill>
            {status.why && <span className="text-[11px] text-amber-800 dark:text-amber-300">{status.why}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function ConnectorCard({ p, onOpen, onNotify, onUnnotify, busy }) {
  const act = cardAction(p);
  const pill = cardPill(p);
  let button = null;
  if (act === 'add') button = <button type="button" aria-label={`Connect ${p.display_name}`} onClick={() => onOpen(p)} className="grid h-[26px] w-[26px] place-items-center rounded-full border border-axal-hairline font-bold text-axal-ink hover:border-axal-violet/50 dark:border-gray-700 dark:text-gray-100"><Plus size={14} /></button>;
  if (act === 'connected') button = <button type="button" aria-label={`${p.display_name} is connected`} onClick={() => onOpen(p)} className="grid h-[26px] w-[26px] place-items-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><Check size={14} /></button>;
  if (act === 'notify') button = <button type="button" disabled={busy} onClick={() => onNotify(p)} className={BTN.link}>Notify me</button>;
  if (act === 'joined') button = <button type="button" disabled={busy} onClick={() => onUnnotify(p)} className={BTN.link} title="Click to stop the notice">We&apos;ll tell you</button>;
  if (act === 'unavailable') button = <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{p.unreadable ? 'Status unreadable' : 'Not set up here'}</span>;
  return (
    <div className={`${TONE_CLS} relative flex flex-col gap-2 p-3.5`} data-testid={`connector-card-${p.key}`} data-action={act}>
      <div className="flex items-start justify-between"><BrandIcon provider={p.key} name={p.display_name} />{button}</div>
      <span className="flex items-center gap-1.5 text-sm font-bold text-axal-ink dark:text-gray-100">
        {p.display_name}
        {p.verified && <span role="img" title="Built and verified by Axal" aria-label="Verified by Axal" className="grid h-3.5 w-3.5 place-items-center rounded-full bg-axal-violet text-[9px] text-white">✓</span>}
      </span>
      <span className="text-[12.5px] leading-snug text-axal-ink/80 dark:text-gray-300">{p.description}</span>
      <div className="mt-auto flex items-center justify-between gap-1.5">
        <span className="text-[11.5px] text-axal-muted dark:text-gray-400">by {p.by}</span>
        {pill && <Pill tone={pill.tone}>{pill.label}</Pill>}
      </div>
      {p.why && <span className="text-[11.5px] leading-snug text-axal-violet-deep dark:text-violet-300">{p.why}</span>}
    </div>
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
    <div className={`${TONE_CLS} flex flex-col gap-2 p-3.5`} data-testid="connector-card-telegram">
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
    <Sheet eyebrow="Connector" title="Request a connector" sub="Tell us which tool you need." onClose={onClose} data-testid="connector-sheet-request"
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
    </Sheet>
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
      <button type="button" className={BTN.primary} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="button-connectors-add">Add <ChevronDown size={13} /></button>
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
  return <ConnectorsView data={data} phone={phone} />;
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
export function yoursGroup({ data, rows, paged, setPage = () => {}, onOpen, label = ACCOUNT_PHONE_PAGES.connectors.sections[0], now = Date.now() }) {
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
    description: [status.why, feedsLabel(p), lastSyncLabel(p.connection, now)].filter(Boolean).join(' · '),
    pill: { label: status.label, tone: status.tone },
    onClick: () => onOpen(p),
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
export function suggestedGroup({ data, q = '', label = ACCOUNT_PHONE_PAGES.connectors.sections[1], onOpen, onNotify, onBrowse }) {
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
    return {
      key: p.key,
      icon: <BrandIcon provider={p.key} name={p.display_name} />,
      title: p.display_name,
      description: p.why || p.description,
      pill: cardPill(p) || actionPill(p, act),
      onClick: act === 'notify' ? () => onNotify(p, true) : act === 'joined' ? () => onNotify(p, false) : () => onOpen(p),
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
export function ConnectorsView({ data, initialTab = 'yours', initialChip = 'All', initialQuery = '', phone = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const moved = useMovedNotice(location);
  const [tab, setTab] = useState(initialTab);
  const [q, setQ] = useState(initialQuery);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [chip, setChip] = useState(initialChip);
  const [sheet, setSheet] = useState(null); // { key, view, ret }
  const [requesting, setRequesting] = useState(null);
  const [waitBusy, setWaitBusy] = useState(false);
  const [waitError, setWaitError] = useState('');

  // A return from a provider's sign-in: open its sheet on what happened, and
  // strip the query so a reload does not replay it.
  const [ret] = useState(() => oauthReturn(location.search));
  useEffect(() => {
    if (!ret) return;
    setSheet({ key: ret.key, view: ret.view, ret });
    navigate({ pathname: location.pathname, search: stripReturn(location.search, ret.strip), hash: location.hash }, { replace: true, state: location.state });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => yoursRows(data.catalogue, { q, filter, sort }), [data.catalogue, q, filter, sort]);
  const paged = pageOf(rows, page);
  const sections = useMemo(() => discoverSections(data.catalogue, chip, { q, suggestions: data.suggestions ?? null }), [data.catalogue, chip, q, data.suggestions]);
  const chips = useMemo(() => discoverChips(data.catalogue), [data.catalogue]);
  const anyConnected = data.catalogue.some((p) => p.connection);
  // One search rule (`matchesQuery`) for the lists and for "No connector
  // called…": on Yours the question is your connectors, on Discover the catalogue.
  const anyMatch = data.catalogue.some((p) => (tab === 'yours' ? !!p.connection : true) && matchesQuery(p, q));
  // A sign-in's return opens a sheet only for a connector the catalogue holds:
  // a crafted link naming anything else opens nothing.
  const sheetP = sheet && (data.catalogue.find((p) => p.key === sheet.key) || null);

  const open = (p) => setSheet({ key: p.key, view: openingView(p), ret: {} });
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
  const discover = (
    <>
      <div className="flex gap-1.5 overflow-x-auto pb-1 md:flex-wrap" role="tablist" aria-label="Categories" data-testid="connectors-chips">
        {chips.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={c === chip} onClick={() => setChip(c)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[12px] font-semibold ${c === chip ? 'border-axal-violet/30 bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300' : 'border-axal-hairline bg-white text-axal-ink/80 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}>
            {c}
          </button>
        ))}
      </div>
      {waitError && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300">{waitError}</p>}
      {sections.map((s) => (
        <section key={s.title} className="flex flex-col gap-2.5" data-testid={`connectors-section-${s.title}`}>
          <h3 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">{s.title} {Array.isArray(s.cards) && <span className="font-mono text-[12px] font-medium text-axal-muted dark:text-gray-400">{s.cards.length}</span>}</h3>
          {s.cards === null && (
            <div className={`${TONE_CLS} p-4 text-[13px]`} data-testid="connectors-suggestions-none">
              <NR reason={data.suggestionsNote || 'Suggestions could not be read.'} /> <span className="text-axal-muted dark:text-gray-400">· {data.suggestionsNote || 'Suggestions could not be read.'}</span>
            </div>
          )}
          {Array.isArray(s.cards) && !s.cards.length && <p className="text-[13px] text-axal-muted dark:text-gray-400">{s.title === 'Suggested for you' ? 'Nothing to suggest: every module a connector could feed already has data.' : 'No connector here yet.'}</p>}
          {Array.isArray(s.cards) && s.cards.length > 0 && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {s.cards.map((p) => <ConnectorCard key={p.key} p={p} onOpen={open} onNotify={(x) => notify(x, true)} onUnnotify={(x) => notify(x, false)} busy={waitBusy} />)}
            </div>
          )}
        </section>
      ))}
      {chip === 'All' && (
        <section className="flex flex-col gap-2.5">
          <h3 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Community</h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3"><TelegramCard /></div>
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
        No connector called &lsquo;{q.trim()}&rsquo;. <button type="button" className={`${BTN.link} font-bold`} onClick={() => setRequesting(q.trim())}>Request it.</button>
      </div>
    );
  } else if (tab === 'yours') {
    if (data.itemsFailed) {
      content = <div className={`${TONE_CLS} p-4`}><Unreadable what="Your connections" claim="This is not a claim that you have none." onRetry={data.reload} /></div>;
    } else if (!anyConnected) {
      content = (
        <div className={`${TONE_CLS} flex flex-col items-start gap-2.5 px-5 py-7`} data-testid="connectors-yours-empty">
          <span className="text-sm leading-relaxed text-axal-ink/80 dark:text-gray-300">No connectors yet. Connect Stripe to see your revenue, or your calendar to book interviews.</span>
          <button type="button" className={BTN.primary} onClick={() => setTab('discover')}>Browse connectors</button>
        </div>
      );
    } else {
      content = (
        <>
          <YoursTable rows={paged.rows} onOpen={open} />
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
    ? () => { setChip('All'); document.getElementById('connectors-discover')?.scrollIntoView?.({ block: 'start' }); }
    : () => { setTab('discover'); setChip('All'); };
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <input type="search" aria-label="Search connectors" placeholder="Search connectors…" className={`${INPUT} min-w-[200px] flex-1`} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="input-connectors-search" />
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
      <AddMenu onBrowse={browse} onRequest={() => setRequesting('')} />
    </div>
  );
  const extras = (
    <>
      {/* D684 (#1578): business Telegram and WhatsApp, Zoom and Google Meet, on
          both tabs. Zoom and Google connect through this page's own sheet. */}
      <ChannelsSection catalogue={data.catalogue} onOpenConnector={(key) => { const p = data.catalogue.find((x) => x.key === key); if (p) open(p); }} />

      {/* D668 (#1498): AI assistants that use StudioOS (D665), on both tabs. */}
      <AssistantsSection />

      {sheet && sheetP && (
        <ConnectorPanel
          key={`${sheet.key}:${sheetP.connection ? 'c' : 'n'}`}
          p={sheetP}
          view={sheet.view}
          ret={sheet.ret || {}}
          setView={(view) => setSheet((s) => ({ ...s, view, ret: {} }))}
          onChanged={data.reload}
          onClose={() => setSheet(null)}
        />
      )}
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
              yoursGroup({ data, rows, paged, setPage, onOpen: open, label: page.sections[0] }),
              suggestedGroup({ data, q, label: page.sections[1], onOpen: open, onNotify: notify, onBrowse: browse }),
            ]} />
          </div>
        </div>
        {movedNote}
        <section id="connectors-discover" className="flex scroll-mt-24 flex-col gap-2.5" data-testid="connectors-phone-discover">
          <h2 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Discover</h2>
          {toolbar}
          {(data.status === 'ready' || data.catalogue.length > 0) && (q.trim() && !data.catalogue.some((p) => matchesQuery(p, q))
            ? <div className={`${TONE_CLS} p-5 text-[13px] text-axal-ink dark:text-gray-200`} data-testid="connectors-noresults">
                No connector called &lsquo;{q.trim()}&rsquo;. <button type="button" className={`${BTN.link} font-bold`} onClick={() => setRequesting(q.trim())}>Request it.</button>
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
        <div className="flex rounded-[10px] border border-axal-hairline bg-white p-[3px] dark:border-gray-700 dark:bg-gray-900" role="tablist" aria-label="Connectors">
          {[['yours', 'Yours'], ['discover', 'Discover']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setPage(1); }} data-testid={`tab-connectors-${id}`}
              className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold ${tab === id ? 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300' : 'text-axal-muted dark:text-gray-400'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {movedNote}

      {toolbar}

      {content}

      {extras}
    </div>
  );
}

