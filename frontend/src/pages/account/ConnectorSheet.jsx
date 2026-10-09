import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useEscapeClose } from '../../components/useEscapeClose';
import { safeWriteJSON } from '../../lib/storage';
import { PENDING_LINKEDIN_IMPORT_KEY } from '../../lib/linkedinCsv';
import { Pill, Unrecorded, Unreadable } from '../../ui';
import { BTN, INPUT, LoadingRows } from './AccountCenter';
import { HubspotConfigModal, LinkedInCsvImportModal, SalesforceConfigModal } from './connectorTools';
import {
  TIER_LABEL, agoLabel, authKind, buildCatalogue, companiesLabel, connectFailure, connectionStatus,
  disconnectNote, feedsLabel, flowBanner, lastSyncLabel,
} from './connectorsModel';

/**
 * D651 (#1463) — the connector sheet and the connect flow, drawn to the
 * `connector` action of `Cycle Action.dc.html` (`stripe`, `hubspot`, `pre`,
 * `signin`, `key`, `connected`, `cancelled`, `refused`, `badkey`,
 * `overreach`, `pro`, `request`). The Connectors page and Build's "Connect a
 * tool" open the same panel, so a connector connects one way from either.
 *
 * Every write goes through the `/api/integrations` methods the retired
 * Integrations page used, or through the first-party calendar and LinkedIn
 * routes for those three connectors.
 */

/** The read every connectors surface shares: catalogue, connections, waitlist and the first-party three. */
export function useConnectors() {
  const [state, setState] = useState({ status: 'loading', message: '', providers: [], items: null, waitlist: [], firstParty: {}, itemsFailed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => (s.status === 'ready' ? s : { ...s, status: 'loading' }));
    const soft = (p) => p.then((v) => v, () => null);
    Promise.all([
      api.integrationsAvailable(),
      soft(api.integrationsList()),
      soft(api.integrationsWaitlist()),
      soft(api.googleCalStatus()),
      soft(api.microsoftCalStatus()),
      soft(api.linkedinStatus()),
    ]).then(([av, mine, wl, google, microsoft, linkedin]) => {
      if (!live) return;
      setState({
        status: 'ready',
        message: '',
        providers: av?.providers || av?.items || [],
        items: mine ? mine.items || [] : null,
        itemsFailed: !mine,
        waitlist: wl?.items || [],
        firstParty: { google, microsoft, linkedin },
      });
    }, (e) => {
      if (live) setState((s) => ({ ...s, status: 'unreadable', message: e?.message || '' }));
    });
    return () => { live = false; };
  }, [attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const catalogue = state.status === 'ready'
    ? buildCatalogue({ providers: state.providers, items: state.items || [], waitlist: state.waitlist, firstParty: state.firstParty })
    : [];
  return { ...state, catalogue, reload };
}

/** A side sheet, 480px from the right and the full width on a phone. */
export function Sheet({ eyebrow, title, sub, onClose, children, footer, 'data-testid': testId }) {
  useEscapeClose(onClose);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <button type="button" aria-label="Close" className="absolute inset-0 h-full w-full cursor-default bg-black/30" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-axal-hairline bg-white shadow-2xl sm:w-[480px] dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3 border-b border-axal-hairline px-5 py-4 dark:border-gray-800">
          <div className="min-w-0">
            {eyebrow && <div className="text-[10.5px] font-bold uppercase tracking-axal-label text-axal-violet-deep dark:text-violet-300">{eyebrow}</div>}
            <h2 className="text-lg font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">{title}</h2>
            {sub && <p className="mt-0.5 text-[12.5px] leading-snug text-axal-muted dark:text-gray-400">{sub}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-axal-hairline px-5 py-3 dark:border-gray-800">{footer}</div>}
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

export function Row({ a, b, pill, action, tone }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{a}</div>
        {b && <div className={`text-[12px] ${tone === 'danger' ? 'text-red-700 dark:text-red-300' : 'text-axal-muted dark:text-gray-400'}`}>{b}</div>}
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

const NR_REGISTRY = 'The connector registry does not say this yet; it arrives with the connectors service (D650).';

/** What a connector pulls in and sends out, from D650's `pulls`/`sends`; its capabilities meanwhile. */
function UsesGroups({ p, read = 'What it pulls in', write = 'What it sends out' }) {
  if (Array.isArray(p.pulls) || Array.isArray(p.sends)) {
    return (
      <>
        <Group label={read}>
          {(p.pulls || []).length
            ? p.pulls.map((x) => <Row key={x.what} a={x.what} b={x.module ? `→ ${x.module}` : null} />)
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

function CompaniesGroup({ conn }) {
  const label = companiesLabel(conn);
  return (
    <Group label="Companies">
      {label === null
        ? <Row a={<Unrecorded reason="Per-company scope arrives with the connectors service (D650).">Not recorded</Unrecorded>} b="This connection belongs to your account. Choosing which companies it serves is not built yet." />
        : conn.companies.map((c) => (
          <label key={c.company_id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
            <span className="font-semibold text-axal-ink dark:text-gray-100">{c.name || `Company ${c.company_id}`}</span>
            <input type="checkbox" checked={c.enabled !== false} disabled readOnly title="Changing the companies waits on its route." />
          </label>
        ))}
    </Group>
  );
}

const FREQ = { live: 'Live', hourly: 'Hourly', daily: 'Daily', manual: 'Manual' };

function ActivityGroup({ conn }) {
  const [state, setState] = useState({ status: 'loading', items: [], message: '', limit: 10 });
  const read = useCallback((limit) => {
    setState((s) => ({ ...s, status: 'loading', limit }));
    api.integrationsLogs(conn.uid, { limit }).then(
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

async function startFirstParty(key) {
  if (key === 'google') {
    const r = await api.googleCalConnect({ return_to: 'integrations' });
    return r?.redirect_url || r?.auth_url;
  }
  if (key === 'microsoft') {
    const r = await api.microsoftCalConnect({ return_to: 'integrations' });
    return r?.redirect_url || r?.auth_url || r?.authorize_url;
  }
  const r = await api.linkedinOAuthStart({ return_to: 'integrations' });
  return r?.authorize_url;
}

async function disconnect(p) {
  if (p.key === 'google') return api.googleCalDisconnect();
  if (p.key === 'microsoft') return api.microsoftCalDisconnect();
  if (p.key === 'linkedin') return api.linkedinDisconnect();
  return api.integrationsDisconnect(p.connection.uid);
}

function keyLabel(p, updating) {
  if (p.key === 'crunchbase') return updating ? 'New Crunchbase user key (leave blank to keep the current one)' : 'Crunchbase user key';
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
export function ConnectorPanel({ p, view, setView, ret = {}, onChanged, onClose, eyebrow = 'Connector', back }) {
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
  const updating = !!conn && view === 'key';
  const name = p.display_name;
  const keySteps = ['What it uses', kind === 'key' || kind === 'token_first' ? 'Key' : 'Sign in', 'Connected'];

  const go = (v) => { setMessage(''); setView(v); };

  const startOauth = async () => {
    setBusy(true); setMessage('');
    setView('signin');
    try {
      let url;
      if (kind === 'first_party') {
        url = await startFirstParty(p.key);
      } else {
        const params = {};
        if (p.key === 'salesforce') params.sandbox = sfSandbox ? '1' : '';
        // Always demo=0|1: a missing query makes the Worker default to demo.
        if (p.key === 'docusign') params.demo = dsDemo ? '1' : '0';
        const r = await api.integrationsOauthStart(p.key, params);
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
    setMessage('');
    let config;
    if (configText.trim()) {
      try { config = JSON.parse(configText); } catch { setMessage('Settings must be valid JSON.'); return; }
    }
    setBusy(true);
    try {
      await api.integrationsConnect({ provider_key: p.key, display_name: conn?.display_name || name, api_key: apiKey || undefined, webhook_secret: webhookSecret || undefined, config });
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
    try { await api.integrationsSync(conn.uid); setSyncNote('Synced.'); onChanged?.(); }
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
        <CompaniesGroup conn={conn} />
        <Group label="Sync">
          <Row a="How often" b={(Object.hasOwn(FREQ, String(conn.config?.sync_frequency)) && FREQ[conn.config.sync_frequency]) || <Unrecorded reason="The sync schedule is set by StudioOS until the connectors service (D650) lets you choose it.">Not recorded</Unrecorded>} />
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
    banner = <Banner tone="neutral" data-testid="connector-pro">{name} is part of the {TIER_LABEL[p.tier] || 'paid'} plan.{message ? ` ${message}` : ''}</Banner>;
    body = <UsesGroups p={p} />;
    footer = <>{backBtn}<button type="button" className={BTN.ghost} onClick={onClose}>Close</button><Link className={BTN.primary} to="/account/billing" onClick={onClose}>See plans</Link></>;
  } else if (view === 'pre') {
    title = `Connect ${name}`;
    sub = 'Before you sign in, here is what StudioOS will do.';
    body = (
      <>
        <Steps names={keySteps} at={0} />
        <UsesGroups p={p} read="It will read" write="It will write" />
        <Group label="It will serve">
          <Row a="Your account" b={<Unrecorded reason="Per-company scope arrives with the connectors service (D650).">Which companies: not recorded</Unrecorded>} />
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
            placeholder={conn?.api_key_preview ? `Ends ${conn.api_key_preview}` : ''} required={!updating}
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
                <p className="text-[11.5px] text-axal-muted dark:text-gray-400">Checks incoming webhooks at /api/integrations/webhook/{p.key}/&lt;uid&gt; with HMAC-SHA256 in the X-Axal-Signature header.</p>
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
        <Group label={`Now fed by ${name}`}>
          {feeds
            ? feeds.split(', ').map((f) => <Row key={f} a={f} />)
            : <Row a={<Unrecorded reason="What each connector fills, and how much arrived, is counted once the connectors service (D650, D655) reports it.">Not recorded</Unrecorded>} b="The first sync runs in the background. Its items appear in the modules it fills." />}
        </Group>
      </>
    );
    footer = <button type="button" className={BTN.primary} onClick={() => { onChanged?.(); onClose?.(); }} data-testid="button-connected-done">Done</button>;
  } else if (view === 'cancelled' || view === 'refused' || view === 'overreach') {
    title = `Connect ${name}`;
    banner = <Banner tone={view === 'cancelled' ? 'neutral' : 'danger'} data-testid={`connector-${view}`}>{flowBanner(view, name, ret)}{message && view === 'refused' && !ret.reason ? ` ${message}` : ''}</Banner>;
    body = <Steps names={keySteps} at={1} />;
    footer = (
      <>
        {backBtn}
        {view === 'overreach'
          ? <Link className={BTN.ghost} to="/help" onClick={onClose}>Report</Link>
          : <button type="button" className={BTN.ghost} onClick={onClose}>Close</button>}
        <button type="button" className={BTN.primary} onClick={() => go('pre')}>Try again</button>
      </>
    );
  } else {
    body = <div className="mx-5 mt-4"><Unrecorded reason="This connector is not connected.">Not connected</Unrecorded></div>;
    footer = <button type="button" className={BTN.primary} onClick={() => go(p.locked ? 'pro' : 'pre')}>Connect</button>;
  }

  return (
    <Sheet eyebrow={eyebrow} title={title} sub={sub} onClose={onClose} footer={footer} data-testid={`connector-sheet-${view}`}>
      {banner}
      {body}
      {tool === 'hubspot' && <HubspotConfigModal integration={conn} onClose={() => setTool(null)} onSaved={() => { setTool(null); onChanged?.(); }} />}
      {tool === 'salesforce' && <SalesforceConfigModal integration={conn} onClose={() => setTool(null)} onSaved={() => { setTool(null); onChanged?.(); }} />}
      {tool === 'csv' && <LinkedInCsvImportModal onClose={() => setTool(null)} onImported={onCsvImported} />}
    </Sheet>
  );
}

/** The view a click on a connector opens: its sheet when connected, the plan when locked, else the flow's first step. */
export function openingView(p) {
  if (p.connection) return 'detail';
  if (p.locked) return 'pro';
  return 'pre';
}
