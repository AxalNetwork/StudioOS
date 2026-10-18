import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, X } from 'lucide-react';
import { api } from '../../lib/api';
import { connectorsApi } from '../../lib/api/connectors';
import { useEscapeClose } from '../../components/useEscapeClose';
import { safeWriteJSON } from '../../lib/storage';
import { PENDING_LINKEDIN_IMPORT_KEY } from '../../lib/linkedinCsv';
import { BrandIcon, Pill, Unrecorded, Unreadable } from '../../ui';
import { BTN, INPUT, LoadingRows } from './AccountCenter';
import { HubspotConfigModal, LinkedInCsvImportModal, SalesforceConfigModal } from './connectorTools';
import GithubSyncSheet from './GithubSyncSheet';
import { MercuryEntityPanel } from './MercurySheet';
import { successBanner } from './githubSync';
import {
  TIER_LABEL, agoLabel, authKind, buildCatalogue, companiesLabel, connectFailure, connectionStatus,
  disconnectNote, feedsLabel, flowBanner, lastSyncLabel, moduleLabel,
  keepBuildProject, coreSystemOffer, isEntityRow,
  FREE_KEEPS_CONNECTORS,
} from './connectorsModel';
import { cyclesWrite } from '../../lib/api/cycles';

/**
 * D651 (#1463) — the connector sheet and the connect flow, drawn to the
 * `connector` action of `Cycle Action.dc.html` (`stripe`, `hubspot`, `pre`,
 * `signin`, `key`, `connected`, `cancelled`, `refused`, `badkey`,
 * `overreach`, `pro`, `request`). The Connectors page and Build's "Connect a
 * tool" open the same panel, so a connector connects one way from either.
 *
 * Every registry read and write goes through `/api/connectors`
 * (`lib/api/connectors.js`, D650); the three first-party connectors keep
 * their own calendar and LinkedIn routes.
 */

/**
 * Why "Suggested for you" shows nothing: the suggestions are the active
 * company's, so a member with no company chosen has none to read.
 */
export function suggestionsNote(e) {
  if (e?.status === 400 || e?.code === 'active_company_required') return 'Choose a company in the sidebar to see what its empty modules could be fed by.';
  return 'Suggestions could not be read.';
}

/**
 * The read every connectors surface shares: catalogue, connections, waitlist,
 * the first-party three, the member's companies and the active company's
 * suggestions. A 403 on the catalogue is the Worker refusing this role, and
 * reads as `forbidden` with the Worker's own sentence: retrying cannot help.
 */
export function useConnectors({ companyId = null } = {}) {
  const [state, setState] = useState({ status: 'loading', message: '', providers: [], items: null, waitlist: [], firstParty: {}, itemsFailed: false, companies: null, suggestions: null, suggestionsNote: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => (s.status === 'ready' ? s : { ...s, status: 'loading' }));
    const soft = (p) => p.then((v) => v, () => null);
    const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
    Promise.all([
      connectorsApi.available(),
      soft(connectorsApi.list()),
      soft(connectorsApi.waitlist()),
      soft(api.googleCalStatus()),
      soft(api.microsoftCalStatus()),
      soft(api.linkedinStatus()),
      soft(api.listMyCompanies()),
      settle(connectorsApi.suggestions(companyId ? { companyId } : undefined)),
    ]).then(([av, mine, wl, google, microsoft, linkedin, companies, sug]) => {
      if (!live) return;
      setState({
        status: 'ready',
        message: '',
        providers: av?.providers || av?.items || [],
        items: mine ? mine.items || [] : null,
        itemsFailed: !mine,
        waitlist: wl?.items || [],
        firstParty: { google, microsoft, linkedin },
        companies: Array.isArray(companies) ? companies : null,
        suggestions: sug.ok ? (sug.v?.items || []) : null,
        suggestionsNote: sug.ok ? '' : suggestionsNote(sug.e),
      });
    }, (e) => {
      if (live) setState((s) => ({ ...s, status: e?.status === 403 ? 'forbidden' : 'unreadable', message: e?.message || '' }));
    });
    return () => { live = false; };
  }, [attempt, companyId]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const catalogue = state.status === 'ready'
    ? buildCatalogue({ providers: state.providers, items: state.items || [], waitlist: state.waitlist, firstParty: state.firstParty, companies: state.companies })
    : [];
  return { ...state, catalogue, reload };
}

/**
 * Where a panel is drawn (D686 §5.4). Build's "Connect a tool" draws every
 * view inside ONE `<Lightbox size="tall">` (`ConnectToolSheet.jsx`), so a view
 * swap never remounts the frame or pulls focus back to the CTA. Inside it a
 * `Sheet` is only its header, body and footer: no overlay, no dialog role, no
 * Escape of its own (the lightbox's), and its × is `onDismiss`, which closes
 * the whole lightbox, while the panel's own `onClose` steps back to the list.
 * With no frame, a `Sheet` is the Connectors page's side sheet, as before.
 */
export const SheetFrame = createContext(null);

/** A side sheet, 480px from the right and the full width on a phone; inside a `SheetFrame`, the frame's content. */
export function Sheet({ eyebrow, title, sub, onClose, children, footer, provider = null, providerName = '', 'data-testid': testId }) {
  const frame = useContext(SheetFrame);
  // A dialog opened inside the sheet (a tool's settings) is a nested Lightbox
  // on the same Escape stack: one key press closes one layer.
  useEscapeClose(frame ? null : onClose);
  const head = (
    <div className="flex items-start justify-between gap-3 border-b border-axal-hairline px-5 py-4 dark:border-gray-800">
      <div className="min-w-0">
        {eyebrow && <div className="text-[10.5px] font-bold uppercase tracking-axal-label text-axal-violet-deep dark:text-violet-300">{eyebrow}</div>}
        {/* D687: the service's mark before the title it names (24px, the canvas rail size). */}
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">{provider && <BrandIcon provider={provider} name={providerName} size={24} />}{title}</h2>
        {sub && <p className="mt-0.5 text-[12.5px] leading-snug text-axal-muted dark:text-gray-400">{sub}</p>}
      </div>
      <button type="button" onClick={frame ? frame.onDismiss : onClose} aria-label="Close" data-testid="sheet-close" className="rounded p-1 text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100"><X size={18} /></button>
    </div>
  );
  const foot = footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-axal-hairline px-5 py-3 dark:border-gray-800">{footer}</div>;
  if (frame) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid={testId} data-layout="lightbox">
        {head}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">{children}</div>
        {foot}
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <button type="button" aria-label="Close" className="absolute inset-0 h-full w-full cursor-default bg-black/30" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-axal-hairline bg-white shadow-2xl sm:w-[480px] dark:border-gray-800 dark:bg-gray-900">
        {head}
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">{children}</div>
        {foot}
      </div>
    </div>
  );
}

const BANNER = {
  warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  danger: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  neutral: 'border-axal-hairline bg-axal-ground text-axal-ink dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200',
};

export function Banner({ tone = 'neutral', children, 'data-testid': testId }) {
  if (!children) return null;
  return <div role={tone === 'danger' ? 'alert' : undefined} data-testid={testId} className={`mx-5 mt-3 rounded-axal-sm border px-3 py-2 text-[12.5px] leading-relaxed ${BANNER[tone]}`}>{children}</div>;
}

export function Group({ label, children }) {
  return (
    <section className="mx-5 mt-4">
      <h3 className="mb-1 text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400">{label}</h3>
      <div className="divide-y divide-axal-hairline rounded-axal-sm border border-axal-hairline dark:divide-gray-800 dark:border-gray-800">{children}</div>
    </section>
  );
}

export function Row({ a, b, pill, action, tone, icon = null }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon}
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{a}</div>
          {b && <div className={`text-[12px] ${tone === 'danger' ? 'text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`}>{b}</div>}
        </div>
      </div>
      {(pill || action) && <div className="flex shrink-0 items-center gap-2">{pill}{action}</div>}
    </div>
  );
}

export function Steps({ names, at }) {
  return (
    <ol className="mx-5 mt-3 flex flex-wrap gap-1.5" aria-label="Steps">
      {names.map((t, i) => (
        <li key={t} aria-current={i === at ? 'step' : undefined}
          className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${i === at ? 'bg-axal-violet text-white' : i < at ? 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/30 dark:text-violet-300' : 'border border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`}>
          {i + 1} · {t}
        </li>
      ))}
    </ol>
  );
}

const NR_REGISTRY = 'This connector is not in the connector registry, which is where what it does is described.';

/** What a connector pulls in and sends out, from the registry's `pulls`/`sends`; its capabilities otherwise. */
function UsesGroups({ p, read = 'What it pulls in', write = 'What it sends out' }) {
  if (Array.isArray(p.pulls) || Array.isArray(p.sends)) {
    return (
      <>
        <Group label={read}>
          {(p.pulls || []).length
            ? p.pulls.map((x) => <Row key={x.what} a={x.what} b={x.module ? `→ ${moduleLabel(p, x.module)}` : null} />)
            : <Row a="Nothing" b={`${p.display_name} only sends out.`} />}
        </Group>
        <Group label={write}>
          {(p.sends || []).length
            ? p.sends.map((x) => <Row key={x.what} a={x.what} b={x.target ? `→ ${x.target}` : null}
              pill={<Pill tone={x.default_mode === 'ask' ? 'info' : 'neutral'}>{x.default_mode === 'ask' ? 'Asks first' : 'Automatic'}</Pill>} />)
            : <Row a="Nothing" b={`${p.display_name} only pulls in.`} />}
        </Group>
      </>
    );
  }
  return (
    <Group label="What it does">
      {(p.capabilities || []).length
        ? p.capabilities.map((c) => <Row key={c} a={c} />)
        : <Row a={<Unrecorded reason={NR_REGISTRY} />} />}
      <Row a="Which modules it fills" b={<Unrecorded reason={NR_REGISTRY} />} />
    </Group>
  );
}

function PermissionsGroup({ p }) {
  return (
    <Group label="Permissions">
      {Array.isArray(p.permissions) && p.permissions.length
        ? p.permissions.map((s) => <Row key={s} a={s} pill={<Pill tone="ok">Granted</Pill>} />)
        : <Row a={<Unrecorded reason={NR_REGISTRY}>Not recorded in plain words</Unrecorded>} b="The provider's own sign-in screen lists what it grants." />}
    </Group>
  );
}

/**
 * The companies a connection feeds. Ticking one sends the whole new set to
 * `PUT /:uid/companies`; the Worker checks each is the member's own and
 * answers with the set it stored, which is what the boxes then show.
 */
export function CompaniesGroup({ conn, onChanged }) {
  const label = companiesLabel(conn);
  const [ids, setIds] = useState(() => (Array.isArray(conn?.companies) ? conn.companies.filter((c) => c.enabled).map((c) => c.company_id) : []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (conn?.first_party) {
    return <Group label="Companies"><Row a="Your account" b={`${conn.provider_key === 'linkedin' ? 'LinkedIn' : 'This calendar'} connects to you, not to a company.`} /></Group>;
  }
  const toggle = async (id, on) => {
    const next = on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id);
    setSaving(true); setError('');
    try {
      const r = await connectorsApi.setCompanies(conn.uid, next);
      setIds(Array.isArray(r?.company_ids) ? r.company_ids.map(Number) : next);
      onChanged?.();
    } catch (e) {
      setError(e?.message || 'The companies could not be saved.');
    } finally { setSaving(false); }
  };
  return (
    <Group label="Companies">
      {label === null
        ? <Row a={<Unrecorded reason="Your companies could not be read, so which of them this connection feeds is not shown.">Not recorded</Unrecorded>} />
        : !conn.companies.length
          ? <Row a="No company" b="You belong to no company, so this connection feeds only your own account." />
          : conn.companies.map((c) => (
            <label key={c.company_id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
              <span className="font-semibold text-axal-ink dark:text-gray-100">{c.name || `Company ${c.company_id}`}</span>
              <input type="checkbox" checked={ids.includes(c.company_id)} disabled={saving} onChange={(e) => toggle(c.company_id, e.target.checked)}
                aria-label={`${conn.display_name || 'This connection'} feeds ${c.name || `company ${c.company_id}`}`} data-testid={`connector-company-${c.company_id}`} />
            </label>
          ))}
      {error && <Row a={<span role="alert" className="text-red-700 dark:text-red-300">{error}</span>} />}
    </Group>
  );
}

/**
 * What a connection has delivered to each module it feeds, from
 * `GET /:uid/fed`. A connector that does not record its deliveries says so,
 * per module, in the Worker's words.
 */
/**
 * "Now fed by": per module, the items that landed in it (`linked`, D686 §5.4;
 * `count` also holds what arrived with no store to land in), and an Open link
 * to the module when the Worker gives its `href`, carrying the project.
 */
export function moduleHref(href, projectId) {
  if (typeof href !== 'string' || !/^\/(?!\/)/.test(href)) return null;
  if (projectId == null || /[?&]project_id=/.test(href)) return href;
  return `${href}${href.includes('?') ? '&' : '?'}project_id=${encodeURIComponent(projectId)}`;
}

export function FedGroup({ conn, name, projectId = null, onOpen }) {
  const [state, setState] = useState({ status: 'loading', modules: [], message: '' });
  const uid = conn?.uid;
  useEffect(() => {
    if (!uid) return undefined;
    let live = true;
    connectorsApi.fed(uid).then(
      (r) => { if (live) setState({ status: 'ready', modules: r?.modules || [], message: '' }); },
      (e) => { if (live) setState({ status: 'unreadable', modules: [], message: e?.message || '' }); },
    );
    return () => { live = false; };
  }, [uid]);
  if (!uid) return null;
  return (
    <Group label={`Now fed by ${name}`}>
      {state.status === 'loading' && <div className="px-3 py-2"><LoadingRows lines={2} /></div>}
      {state.status === 'unreadable' && <div className="px-3 py-2"><Unreadable what="What it delivered" claim="This is not a claim that nothing arrived." /></div>}
      {state.status === 'ready' && !state.modules.length && <Row a="No module" b={`${name} feeds no StudioOS module.`} />}
      {state.status === 'ready' && state.modules.map((m) => {
        const n = m.linked ?? null;
        const href = moduleHref(m.href, projectId);
        return (
          <Row key={m.module} a={m.label || m.module}
            b={n == null ? <Unrecorded reason={m.reason || 'Not recorded'}>Not recorded</Unrecorded> : m.reason || null}
            pill={n == null ? null : <Pill tone={n ? 'ok' : 'neutral'}>{`${n} ${n === 1 ? 'item' : 'items'}`}</Pill>}
            action={href ? <Link className={BTN.link} to={href} onClick={() => onOpen?.()} data-testid={`fed-open-${m.module}`}>Open</Link> : null} />
        );
      })}
    </Group>
  );
}

const FREQ = { live: 'Live', hourly: 'Hourly', daily: 'Daily', manual: 'Manual' };

/** How often a connection syncs. A registry connection with none chosen syncs on every run, which is `live`. */
function syncFrequencyLabel(conn) {
  const f = conn?.config?.sync_frequency;
  if (Object.hasOwn(FREQ, String(f))) return FREQ[f];
  if (conn?.uid && f == null) return 'Live (the default)';
  return <Unrecorded reason={conn?.first_party ? 'This connection syncs on its own route\'s schedule, which StudioOS does not record.' : 'The stored setting is not one StudioOS knows.'}>Not recorded</Unrecorded>;
}

function ActivityGroup({ conn }) {
  const [state, setState] = useState({ status: 'loading', items: [], message: '', limit: 10 });
  const read = useCallback((limit) => {
    setState((s) => ({ ...s, status: 'loading', limit }));
    connectorsApi.logs(conn.uid, { limit }).then(
      (r) => setState({ status: 'ready', items: r?.items || [], message: '', limit }),
      (e) => setState({ status: 'unreadable', items: [], message: e?.message || '', limit }),
    );
  }, [conn.uid]);
  useEffect(() => { read(10); }, [read]);
  return (
    <Group label="Activity">
      {state.status === 'loading' && <div className="px-3 py-2"><LoadingRows lines={2} /></div>}
      {state.status === 'unreadable' && <div className="px-3 py-2"><Unreadable what="The activity log" claim="This is not a claim that nothing happened." onRetry={() => read(state.limit)} /></div>}
      {state.status === 'ready' && !state.items.length && <Row a="Nothing yet" b="No sync, push or change has been logged for this connection." />}
      {state.status === 'ready' && state.items.map((l) => (
        <Row key={l.id} a={whenLabel(l.created_at)} b={l.response_summary || l.event_type} tone={l.status === 'error' ? 'danger' : undefined}
          pill={<Pill tone={l.status === 'error' ? 'danger' : 'ok'}>{l.status === 'error' ? 'Failed' : 'OK'}</Pill>} />
      ))}
      {state.status === 'ready' && state.items.length >= state.limit && state.limit < 100 && (
        <div className="px-3 py-2"><button type="button" className={BTN.link} onClick={() => read(100)}>Show more</button></div>
      )}
    </Group>
  );
}

function whenLabel(iso) {
  const t = Date.parse(/[zZ]$/.test(iso || '') ? iso : `${String(iso || '').replace(' ', 'T')}Z`);
  if (!Number.isFinite(t)) return 'Not recorded';
  const d = new Date(t);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/** Google, Microsoft or LinkedIn's own sign-in; it returns to `returnTo` (Build's lightbox, or the Connectors page). */
export async function startFirstParty(key, returnTo = 'integrations', client = api, projectId = null) {
  const return_to = returnTo === 'build' ? 'build' : 'integrations';
  // From Build, the venture rides in the signed state, so the return names it on any host (#1597).
  const id = Number(projectId);
  const venture = return_to === 'build' && Number.isSafeInteger(id) && id > 0 ? { project_id: id } : {};
  if (key === 'google') {
    const r = await client.googleCalConnect({ return_to, ...venture });
    return r?.redirect_url || r?.auth_url;
  }
  if (key === 'microsoft') {
    const r = await client.microsoftCalConnect({ return_to, ...venture });
    return r?.redirect_url || r?.auth_url || r?.authorize_url;
  }
  const r = await client.linkedinOAuthStart({ return_to, ...venture });
  return r?.authorize_url;
}

/** Disconnect a connector through its own route: the first-party three, or the registry's. */
export async function disconnect(p) {
  if (p.key === 'google') return api.googleCalDisconnect();
  if (p.key === 'microsoft') return api.microsoftCalDisconnect();
  if (p.key === 'linkedin') return api.linkedinDisconnect();
  return connectorsApi.disconnect(p.connection.uid);
}

/**
 * The key field's label. Crunchbase checks every key it is given with a live
 * search and refuses a blank one, so replacing it always takes a new key.
 */
function keyLabel(p, updating) {
  if (p.key === 'crunchbase') return updating ? 'New Crunchbase user key' : 'Crunchbase user key';
  if (p.key === 'hubspot') return 'Private App access token';
  if (p.auth_type === 'oauth2') return 'Personal access token';
  return updating ? 'New API key (leave blank to keep the current one)' : 'API key';
}

/**
 * The panel inside the sheet. `view` is the canvas's view name; `detail` is
 * the connector sheet itself (`stripe`, `hubspot` on the canvas). The parent
 * owns `view` so a return from a provider's sign-in can open the panel on
 * `connected` or `refused` directly.
 */
export function ConnectorPanel({ p, view, setView, ret = {}, onChanged, onClose, eyebrow = 'Connector', back, projectId = null, companyId = null, companyName = null, returnTo = null, companyNote = null, companyState = null, blocked = false }) {
  // In Build's lightbox, finishing (Done, an Open link, See plans, Report)
  // closes the whole lightbox; `onClose` steps back to the list (D686 §5.4).
  const dismiss = useContext(SheetFrame)?.onDismiss || onClose;
  // Build acts for its project's company (D686 §5.4); elsewhere, the active one.
  const opts = companyId ? { companyId } : undefined;
  const navigate = useNavigate();
  const conn = p.connection;
  const status = connectionStatus(conn, p);
  const kind = authKind(p);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [configText, setConfigText] = useState(conn?.config && !conn.first_party ? JSON.stringify(conn.config, null, 2) : '');
  const [advanced, setAdvanced] = useState(false);
  const [sfSandbox, setSfSandbox] = useState(false);
  const [dsDemo, setDsDemo] = useState(true);
  const [tool, setTool] = useState(null);
  // A teammate who already connected this provider for the active company
  // (`GET /:key`): read once, when the flow starts on a registry connector.
  const [teammate, setTeammate] = useState(null);
  const [ownChosen, setOwnChosen] = useState(false);
  // From Build, a project whose company this member cannot connect for (D686 §5.4): no flow starts, whatever path opened the panel.
  const askTeammate = !blocked && view === 'pre' && !conn && !p.first_party && !!p.key;
  useEffect(() => {
    if (!askTeammate) return undefined;
    let live = true;
    connectorsApi.teammate(p.key, opts).then((r) => { if (live) setTeammate(r?.teammate || null); }, () => { if (live) setTeammate(null); });
    return () => { live = false; };
    // `opts` is derived from companyId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askTeammate, p.key, companyId]);
  // From Build, the success view offers "Use as your <kind>" when the Worker
  // says exactly one unmapped core system fits this connection (D686 §5.4).
  const [useAs, setUseAs] = useState(null); // { offer, state: 'idle'|'saving'|'done'|'error', text }
  const askUseAs = view === 'connected' && returnTo === 'build' && !!projectId && !!conn;
  useEffect(() => {
    if (!askUseAs) return undefined;
    let live = true;
    cyclesWrite.build.systemChoices(projectId).then(
      (r) => { const offer = coreSystemOffer(r, p, conn); if (live) setUseAs(offer ? { offer, state: 'idle', text: '' } : null); },
      () => { if (live) setUseAs(null); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askUseAs, projectId, p.key, conn?.uid]);
  const applyUseAs = async () => {
    const { offer } = useAs;
    setUseAs((u) => ({ ...u, state: 'saving', text: '' }));
    try {
      await cyclesWrite.build.system(projectId, offer.kind, offer.body);
      setUseAs((u) => ({ ...u, state: 'done', text: `${p.display_name} is now your ${offer.label}.` }));
      onChanged?.();
    } catch (e) {
      setUseAs((u) => ({ ...u, state: 'error', text: e?.message || `${p.display_name} could not be set as your ${offer.label}.` }));
    }
  };
  const updating = !!conn && view === 'key';
  const name = p.display_name;
  const keySteps = ['What it uses', kind === 'key' || kind === 'token_first' ? 'Key' : 'Sign in', 'Connected'];

  const go = (v) => { setMessage(''); setView(v); };
  const syncView = view === 'sync' && p.key === 'github' && !!conn?.uid;

  const startOauth = async () => {
    if (blocked) return;
    setBusy(true); setMessage('');
    setView('signin');
    try {
      let url;
      // From Build, the sign-in comes back to /build/connect: the venture is kept for it (D686 §5.4).
      if (returnTo === 'build') keepBuildProject(projectId);
      if (kind === 'first_party') {
        url = await startFirstParty(p.key, returnTo || 'integrations', api, projectId);
      } else {
        const params = returnTo === 'build' ? { return_to: 'build', ...(Number(projectId) > 0 ? { project_id: String(Number(projectId)) } : {}) } : {};
        if (p.key === 'salesforce') params.sandbox = sfSandbox ? '1' : '';
        // Always demo=0|1: a missing query makes the Worker default to demo.
        if (p.key === 'docusign') params.demo = dsDemo ? '1' : '0';
        const r = await connectorsApi.oauthStart(p.key, params, opts);
        url = r?.authorize_url;
      }
      if (!url) throw Object.assign(new Error(`${name} did not return a sign-in address.`), { status: 0 });
      window.location.assign(url);
    } catch (e) {
      setBusy(false);
      setMessage(e?.message || '');
      setView(connectFailure(e, { ...p, auth_type: 'oauth2', supports_pat: false }));
    }
  };

  const submitKey = async (e) => {
    e?.preventDefault?.();
    if (blocked) return;
    setMessage('');
    let config;
    if (configText.trim()) {
      try { config = JSON.parse(configText); } catch { setMessage('Settings must be valid JSON.'); return; }
    }
    setBusy(true);
    try {
      await connectorsApi.connect({ provider_key: p.key, display_name: conn?.display_name || name, api_key: apiKey || undefined, webhook_secret: webhookSecret || undefined, config }, opts);
      setApiKey(''); setWebhookSecret('');
      setView('connected');
      onChanged?.();
    } catch (err) {
      setMessage(err?.message || '');
      setView(connectFailure(err, p));
    } finally { setBusy(false); }
  };

  const syncNow = async () => {
    setSyncing(true); setSyncNote('');
    // The Worker's own words for what the sync did, when it says (#1597).
    try { const r = await connectorsApi.sync(conn.uid, opts); setSyncNote(successBanner(p.key, r) || 'Synced.'); onChanged?.(); }
    catch (e) { setSyncNote(e?.message || 'The sync failed.'); }
    finally { setSyncing(false); }
  };

  const doDisconnect = async () => {
    setBusy(true); setMessage('');
    try { await disconnect(p); onChanged?.(); onClose?.(); }
    catch (e) { setMessage(e?.message || 'The connector could not be disconnected.'); }
    finally { setBusy(false); setConfirming(false); }
  };

  const onCsvImported = (rows) => {
    safeWriteJSON(PENDING_LINKEDIN_IMPORT_KEY, { rows, at: Date.now() });
    setTool(null);
    navigate('/refer');
  };

  const backBtn = back ? <button type="button" className={BTN.ghost} onClick={back}>Back</button> : null;
  let sub = '';
  let banner = null;
  let body = null;
  let footer = null;
  let title = name;

  if (view === 'detail' && conn) {
    sub = `by ${p.by || name} · ${status.label}${p.verified ? ' · Verified by Axal' : ''}${conn.external_account_name ? ` · ${conn.external_account_name}` : ''}`;
    if (status.why) {
      const when = agoLabel(conn.last_synced_at);
      banner = <Banner tone="warn" data-testid="connector-attention">{status.why}. {when ? `The last good sync was ${when}.` : 'Nothing has synced yet.'}{conn.last_error && !conn.last_error.startsWith('rate_limited') ? ` ${name} said: ${conn.last_error}` : ''}</Banner>;
    }
    body = (
      <>
        <UsesGroups p={p} />
        <PermissionsGroup p={p} />
        <CompaniesGroup conn={conn} onChanged={onChanged} />
        <FedGroup conn={conn} name={name} projectId={projectId} onOpen={dismiss} />
        {p.key === 'github' && conn.uid && (
          <Group label="Repositories">
            <Row a="What StudioOS reads" b="Choose the repositories, and sync them." action={<button type="button" className={BTN.link} onClick={() => go('sync')} data-testid="button-choose-repositories">Choose</button>} />
          </Group>
        )}
        <Group label="Sync">
          <Row a="How often" b={syncFrequencyLabel(conn)} />
          <Row a="Last sync" b={syncNote || lastSyncLabel(conn)}
            action={conn.uid ? <button type="button" className={BTN.link} disabled={syncing} onClick={syncNow} data-testid="button-sync-now">{syncing ? 'Syncing…' : 'Sync now'}</button> : null} />
        </Group>
        {(p.key === 'hubspot' || p.key === 'salesforce' || p.key === 'linkedin' || (conn.uid && kind !== 'oauth')) && (
          <Group label="Settings">
            {p.key === 'hubspot' && <Row a="Pipeline" b={conn.config?.pipeline_label || 'Default pipeline'} action={<button type="button" className={BTN.link} onClick={() => setTool('hubspot')}>Change</button>} />}
            {p.key === 'salesforce' && <Row a="Stages and fields" b={conn.config?.is_sandbox ? 'Sandbox' : 'Production'} action={<button type="button" className={BTN.link} onClick={() => setTool('salesforce')}>Change</button>} />}
            {p.key === 'linkedin' && <Row a="Your connections" b="Import Connections.csv for referrals." action={<button type="button" className={BTN.link} onClick={() => setTool('csv')}>Import</button>} />}
            {conn.uid && kind !== 'oauth' && <Row a={kind === 'key' ? 'API key' : 'Access token'} b={conn.api_key_preview ? `Ends ${conn.api_key_preview}` : 'Stored encrypted'} action={<button type="button" className={BTN.link} onClick={() => go('key')}>Replace</button>} />}
          </Group>
        )}
        {conn.uid
          ? <ActivityGroup conn={conn} />
          : <Group label="Activity"><Row a={<Unrecorded reason={`${name} keeps no activity log in StudioOS.`}>Not recorded</Unrecorded>} /></Group>}
        {message && <Banner tone="danger">{message}</Banner>}
      </>
    );
    footer = confirming ? (
      <>
        <span className="mr-auto text-[12px] text-axal-muted dark:text-gray-400">Disconnect {name}? {disconnectNote(p)}</span>
        <button type="button" className={BTN.ghost} onClick={() => setConfirming(false)}>Keep it</button>
        <button type="button" className={BTN.dangerSolid} disabled={busy} onClick={doDisconnect} data-testid="button-confirm-disconnect">{busy ? 'Disconnecting…' : 'Disconnect'}</button>
      </>
    ) : (
      <>
        {backBtn}
        <span className="mr-auto text-[11.5px] text-axal-muted dark:text-gray-400">On disconnect: {disconnectNote(p)}</span>
        {status.why && <button type="button" className={BTN.primary} onClick={() => go('pre')}>Reconnect</button>}
        <button type="button" className={BTN.danger} onClick={() => setConfirming(true)} data-testid="button-disconnect">Disconnect</button>
      </>
    );
  } else if (view === 'pro') {
    sub = `by ${p.by || name}${p.status === 'beta' ? ' · Beta' : ''}`;
    banner = <Banner tone="neutral" data-testid="connector-pro">{`${name} is part of the ${TIER_LABEL[p.tier] || 'paid'} plan. ${FREE_KEEPS_CONNECTORS}${message ? ` ${message}` : ''}`}</Banner>;
    body = <UsesGroups p={p} />;
    footer = <>{backBtn}<button type="button" className={BTN.ghost} onClick={onClose}>Close</button><Link className={BTN.primary} to="/account/billing" onClick={dismiss}>See plans</Link></>;
  } else if (view === 'pre' && teammate && !ownChosen) {
    title = `Connect ${name}`;
    banner = <Banner tone="neutral" data-testid="connector-teammate">{`${teammate.name || 'A teammate'} already connected ${name} for ${companyName || 'your active company'}. Use theirs, or connect your own.`}</Banner>;
    footer = (
      <>
        {backBtn}
        <button type="button" className={BTN.ghost} onClick={() => setOwnChosen(true)} data-testid="button-connect-own">Connect my own</button>
        <button type="button" className={BTN.primary} onClick={onClose} data-testid="button-use-theirs">Use theirs</button>
      </>
    );
  } else if (view === 'pre') {
    title = `Connect ${name}`;
    sub = 'Before you sign in, here is what StudioOS will do.';
    body = (
      <>
        <Steps names={keySteps} at={0} />
        <UsesGroups p={p} read="It will read" write="It will write" />
        <Group label="It will serve">
          <Row a={p.first_party ? 'Your account' : (companyName || 'Your active company')} b={p.first_party ? 'It connects to you, not to a company.' : 'Once connected, choose the other companies it feeds from its sheet.'} />
        </Group>
        {p.key === 'salesforce' && (
          <Group label="Org type">
            <label className="flex items-center gap-2 px-3 py-2 text-[13px]"><input type="radio" name="sf_env" checked={!sfSandbox} onChange={() => setSfSandbox(false)} /> Production</label>
            <label className="flex items-center gap-2 px-3 py-2 text-[13px]"><input type="radio" name="sf_env" checked={sfSandbox} onChange={() => setSfSandbox(true)} /> Sandbox</label>
          </Group>
        )}
        {p.key === 'docusign' && (
          <Group label="Account">
            <div data-testid="docusign-env-picker">
              <label className="flex items-center gap-2 px-3 py-2 text-[13px]"><input type="radio" name="ds_env" checked={!dsDemo} onChange={() => setDsDemo(false)} /> Production</label>
              <label className="flex items-center gap-2 px-3 py-2 text-[13px]"><input type="radio" name="ds_env" checked={dsDemo} onChange={() => setDsDemo(true)} /> Demo</label>
            </div>
          </Group>
        )}
        {p.supports_pat && kind === 'oauth' && (
          <p className="mx-5 mt-3 text-[12px] text-axal-muted dark:text-gray-400">
            Your workspace blocks outside apps? <button type="button" className={BTN.link} onClick={() => go('key')}>Use a personal access token instead</button>
          </p>
        )}
      </>
    );
    const cont = kind === 'key' || kind === 'token_first'
      ? <button type="button" className={BTN.primary} onClick={() => go('key')} data-testid="button-connect-continue">Continue</button>
      : <button type="button" className={BTN.primary} disabled={busy} onClick={startOauth} data-testid="button-connect-continue">Continue to {name}</button>;
    footer = <>{backBtn}<button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button>{cont}</>;
  } else if (view === 'signin') {
    title = `Sign in to ${name}`;
    sub = `${name} is opening. StudioOS never sees your password.`;
    body = <><Steps names={keySteps} at={1} /><div className="mx-5 mt-4"><LoadingRows lines={2} /></div></>;
  } else if (view === 'key' || view === 'badkey') {
    title = updating ? `Replace the ${kind === 'key' ? 'key' : 'token'} for ${name}` : `Connect ${name}`;
    sub = kind === 'token_first' ? `${name} connects with a Private App access token while its public app waits on Marketplace review.` : 'This connector uses a key you paste here.';
    if (view === 'badkey') banner = <Banner tone="danger" data-testid="connector-badkey">{flowBanner('badkey', name)}{message ? ` ${message}` : ''}</Banner>;
    body = (
      <form id="connector-key-form" onSubmit={submitKey}>
        {!updating && <Steps names={keySteps} at={1} />}
        {p.key === 'crunchbase' && !updating && (
          <Banner tone="neutral">
            <span className="font-semibold">Crunchbase Basic user key.</span> Create one at data.crunchbase.com → API and paste the user_key below. Connect runs a live search to check it before saving. Daily Basic quota is 200 calls.
          </Banner>
        )}
        {p.key === 'hubspot' && !updating && (
          <Banner tone="neutral">
            In HubSpot: Settings → Integrations → Private Apps → Create private app. It needs crm.objects.deals.read and write, and crm.objects.contacts.read.
          </Banner>
        )}
        <div className="mx-5 mt-4 space-y-1">
          <label htmlFor="connector-key" className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">{keyLabel(p, updating)}</label>
          <input id="connector-key" type="password" autoComplete="off" className={INPUT} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder={conn?.api_key_preview ? `Ends ${conn.api_key_preview}` : ''} required={!updating || p.key === 'crunchbase'}
            data-testid={p.key === 'crunchbase' ? 'crunchbase-user-key' : 'connector-key'} />
          <p className="text-[11.5px] text-axal-muted dark:text-gray-400">
            Stored encrypted. StudioOS never shows it again.
            {p.docs_url && <> <a className={BTN.link} href={p.docs_url} target="_blank" rel="noreferrer">Where to find it <ExternalLink size={11} className="inline" /></a></>}
          </p>
        </div>
        {kind === 'token_first' && !updating && (
          <p className="mx-5 mt-3 text-[12px] text-axal-muted dark:text-gray-400">
            Your portal is cleared for HubSpot's public app? <button type="button" className={BTN.link} onClick={startOauth}>Connect with OAuth instead</button>
          </p>
        )}
        <div className="mx-5 mt-4">
          <button type="button" className={BTN.link} onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>{advanced ? 'Hide advanced' : 'Advanced'}</button>
          {advanced && (
            <div className="mt-2 space-y-3">
              <div className="space-y-1">
                <label htmlFor="connector-webhook" className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">Webhook secret (optional)</label>
                <input id="connector-webhook" type="password" className={INPUT} value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder={conn?.has_webhook_secret ? '••••••••' : ''} />
                <p className="text-[11.5px] text-axal-muted dark:text-gray-400">Webhooks sent to /api/integrations/webhook/{p.key}/&lt;uid&gt; are checked against this secret (HMAC-SHA256 in the X-Axal-Signature header, or the signature the provider adds). Without one, the connection takes no webhooks and updates when it syncs. HubSpot checks its own signature and needs none.</p>
              </div>
              <div className="space-y-1">
                <label htmlFor="connector-config" className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">Settings (JSON, optional)</label>
                <textarea id="connector-config" rows={4} className={`${INPUT} font-mono text-xs`} value={configText} onChange={(e) => setConfigText(e.target.value)} />
              </div>
            </div>
          )}
        </div>
        {message && view !== 'badkey' && <Banner tone="danger">{message}</Banner>}
      </form>
    );
    footer = <>{backBtn}<button type="button" className={BTN.ghost} onClick={() => (conn ? go('detail') : onClose?.())}>Cancel</button><button type="submit" form="connector-key-form" className={BTN.primary} disabled={busy} data-testid="button-connect-key">{busy ? 'Connecting…' : updating ? 'Replace' : 'Connect'}</button></>;
  } else if (view === 'connected') {
    title = `${name} is connected`;
    if (ret.banner) banner = <Banner tone="warn">{ret.banner}</Banner>;
    const feeds = feedsLabel(p);
    body = (
      <>
        <Steps names={keySteps} at={2} />
        {conn?.uid
          ? <FedGroup conn={conn} name={name} projectId={projectId} onOpen={dismiss} />
          : (
            <Group label={`Now fed by ${name}`}>
              {feeds
                ? feeds.split(', ').map((f) => <Row key={f} a={f} />)
                : <Row a={<Unrecorded reason={NR_REGISTRY}>Not recorded</Unrecorded>} b="The first sync runs in the background. Its items appear in the modules it fills." />}
            </Group>
          )}
        {useAs && (
          <Group label="Core systems">
            <Row
              a={`Your ${useAs.offer.label}`}
              b={useAs.text || `Operating systems has no ${useAs.offer.label} yet.`}
              tone={useAs.state === 'error' ? 'danger' : undefined}
              action={useAs.state === 'done' ? null : (
                <button type="button" className={BTN.primary} disabled={useAs.state === 'saving'} onClick={applyUseAs} data-testid={`button-use-as-${useAs.offer.kind}`}>
                  {useAs.state === 'saving' ? 'Saving…' : `Use as your ${useAs.offer.label}`}
                </button>
              )}
            />
          </Group>
        )}
      </>
    );
    footer = <button type="button" className={BTN.primary} onClick={() => { onChanged?.(); dismiss?.(); }} data-testid="button-connected-done">Done</button>;
  } else if (view === 'cancelled' || view === 'refused' || view === 'overreach') {
    title = `Connect ${name}`;
    banner = <Banner tone={view === 'cancelled' ? 'neutral' : 'danger'} data-testid={`connector-${view}`}>{flowBanner(view, name, ret)}{message && view === 'refused' && !ret.reason ? ` ${message}` : ''}</Banner>;
    body = <Steps names={keySteps} at={1} />;
    footer = (
      <>
        {backBtn}
        {view === 'overreach'
          ? <Link className={BTN.ghost} to="/help" onClick={dismiss}>Report</Link>
          : <button type="button" className={BTN.ghost} onClick={onClose}>Close</button>}
        <button type="button" className={BTN.primary} onClick={() => go('pre')}>Try again</button>
      </>
    );
  } else {
    body = <div className="mx-5 mt-4"><Unrecorded reason="This connector is not connected.">Not connected</Unrecorded></div>;
    footer = <button type="button" className={BTN.primary} onClick={() => go(p.locked ? 'pro' : 'pre')}>Connect</button>;
  }

  // D715 (#1780): the Axal entities' Mercury is its own sheet, never this flow. Its one
  // audited read happens there, on open; nothing above fetches for it (`openingView` is `entity`).
  if (isEntityRow(p)) return <MercuryEntityPanel p={p} onClose={onClose} eyebrow={eyebrow} />;

  // GitHub's choice of repositories is its own sheet (D686 §5.4).
  if (syncView) {
    return <GithubSyncSheet p={p} conn={conn} projectId={projectId} companyId={companyId} eyebrow={eyebrow} onClose={onClose} onChanged={onChanged} back={() => go('detail')} />;
  }

  // Build's company banner shows in every view of the frame; a blocked project offers no step that connects.
  if (blocked && CONNECT_VIEWS.has(view)) {
    footer = <>{backBtn}<button type="button" className={BTN.ghost} onClick={onClose} data-testid="button-blocked-close">Close</button></>;
  }
  const note = companyNote ? <Banner tone="warn" data-testid={`connect-tool-company-${companyState || 'note'}`}>{companyNote}</Banner> : null;

  return (
    <Sheet eyebrow={eyebrow} title={title} sub={sub} onClose={onClose} footer={footer} provider={p.key} providerName={p.display_name} data-testid={`connector-sheet-${view === 'pre' && teammate && !ownChosen ? 'teammate' : view}`}>
      {note}
      {banner}
      {body}
      {tool === 'hubspot' && <HubspotConfigModal integration={conn} onClose={() => setTool(null)} onSaved={() => { setTool(null); onChanged?.(); }} />}
      {tool === 'salesforce' && <SalesforceConfigModal integration={conn} onClose={() => setTool(null)} onSaved={() => { setTool(null); onChanged?.(); }} />}
      {tool === 'csv' && <LinkedInCsvImportModal onClose={() => setTool(null)} onImported={onCsvImported} />}
    </Sheet>
  );
}

/** The flow's views that connect something: none of them may act for a company the member cannot connect for. */
const CONNECT_VIEWS = new Set(['pre', 'signin', 'key', 'badkey', 'cancelled', 'refused', 'overreach']);

/** The view a click on a connector opens: its sheet when connected, the plan when locked, else the flow's first step. */
export function openingView(p) {
  // The entity row opens the entity sheet, so the `pre` view's teammate read never fires for it (D715).
  if (isEntityRow(p)) return 'entity';
  if (p.connection) return 'detail';
  if (p.locked) return 'pro';
  return 'pre';
}
