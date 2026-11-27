import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { connectorsCustomApi } from '../../lib/api/connectorsCustom';
import { Pill, Unreadable } from '../../ui';
import Lightbox from '../../ui/Lightbox';
import { BTN, INPUT } from './AccountCenter';
import { Banner, Group } from './ConnectorSheet';
import { FREE_KEEPS_CONNECTORS, TIER_LABEL } from './connectorsModel';
import {
  approvedLabel, customState, healthLine, safeAuthorizeUrl, serverName, serverStatus, showCustomGroup, toolRow,
} from './customConnectorsModel';

/**
 * #9113 (g38) — "Add a custom connector", board C26 of `Connectors · Boards.dc.html`
 * (the `custom` sheet of `Cycle Action.dc.html`), on D852's Worker routes.
 * The rules are `customConnectorsModel.js`; the client is `lib/api/connectorsCustom.js`.
 *
 * Built behind the Worker's `CUSTOM_MCP_ENABLED`, which is off: while it is
 * off, `list()` answers 404 and nothing here is drawn but the Add menu's
 * disabled entry, as on main. Turning it on is the owner's call (D852, #2404),
 * still open.
 *
 * A form opens as a lightbox (D753), as "Request a connector" does.
 */

/** The page's one `list()` read, and its re-read after every change. */
export function useCustomServers({ skip = false } = {}) {
  const [custom, setCustom] = useState(() => customState(undefined));
  const reload = useCallback(async () => {
    if (skip) return;
    try {
      const res = await connectorsCustomApi.list();
      setCustom(customState(res));
    } catch (e) {
      setCustom((prev) => customState(null, { error: e, previous: prev }));
    }
  }, [skip]);
  useEffect(() => { reload(); }, [reload]);
  return { custom, reload };
}

/**
 * The form's submit: `start(url)`, then the server's sign-in. A refusal is the
 * Worker's own sentence (`custom_mcp_host_private` and the rest); the page
 * writes none of its own. Returns `{ error }` when nothing was opened.
 */
export async function startCustom(url, { api = connectorsCustomApi, assign = (u) => window.location.assign(u) } = {}) {
  try {
    const out = await api.start(url.trim());
    const to = safeAuthorizeUrl(out?.authorize_url);
    if (!to) return { error: 'That server did not describe how to sign in to it, so nothing was connected.' };
    assign(to);
    return { error: '' };
  } catch (e) {
    return { error: e?.message || 'That server could not be reached. Try again in a minute.', code: e?.code || null };
  }
}

/** C26: one field, the server's https address. The Worker discovers its sign-in. */
export function CustomConnectorLightbox({ onClose, initialUrl = '', initialError = '', submit = startCustom }) {
  const [url, setUrl] = useState(initialUrl);
  const [state, setState] = useState({ busy: false, error: initialError });
  const ready = /^https:\/\/\S+$/i.test(url.trim()) && url.trim().length <= 2048;
  const send = async () => {
    setState({ busy: true, error: '' });
    const out = await submit(url);
    // A sign-in opened leaves the page; the button stays disabled until it does.
    setState({ busy: !out?.error, error: out?.error || '' });
  };
  return (
    <Lightbox label="Add a custom connector" eyebrow="Connector" title="Add a custom connector" sub="For teams with their own tools. Pro." onClose={onClose} width={512} testId="connector-sheet-custom"
      footer={<><button type="button" className={BTN.ghost} onClick={onClose}>Cancel</button><button type="button" className={BTN.primary} disabled={!ready || state.busy} onClick={send} data-testid="button-add-custom">{state.busy ? 'Adding…' : 'Add connector'}</button></>}>
      <Group label="MCP server">
        <div className="space-y-1 px-3 py-2">
          <label htmlFor="custom-url" className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">Server URL</label>
          <input id="custom-url" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://…" className={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} data-testid="input-custom-url" />
          <p className="text-[11.5px] text-axal-muted dark:text-gray-400">Next, you sign in to the server. Then you choose which of its read-only tools Eadwyn may use.</p>
        </div>
      </Group>
      {state.error && <Banner tone="danger" data-testid="custom-error">{state.error}</Banner>}
      <p className="mx-5 mb-4 mt-3 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="custom-foot">Eadwyn only uses it in a conversation when you switch it on.</p>
    </Lightbox>
  );
}

/** A founder below the plan (402): the plan's upsell, as a Pro connector's `pro` view says it. */
export function CustomUpsellLightbox({ onClose, message = '' }) {
  return (
    <Lightbox label="Add a custom connector" eyebrow="Connector" title="Add a custom connector" sub="For teams with their own tools. Pro." onClose={onClose} width={512} testId="connector-sheet-custom-pro"
      footer={<><button type="button" className={BTN.ghost} onClick={onClose}>Close</button><Link className={BTN.primary} to="/account/billing" onClick={onClose}>See plans</Link></>}>
      <Banner tone="neutral" data-testid="custom-pro">{`Custom connectors are part of the ${TIER_LABEL.growth} plan. ${FREE_KEEPS_CONNECTORS}${message ? ` ${message}` : ''}`}</Banner>
      <div className="h-4" />
    </Lightbox>
  );
}

/**
 * The Tools view, drawn from one read: `{ state: 'loading' | 'ready' | 'unreadable', tools, message }`.
 * A description is the server's own words: untrusted, so it is plain text, never HTML.
 */
export function CustomToolsList({ read, onToggle, busy = '' }) {
  if (!read || read.state === 'loading') return <p className="px-3 py-2 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="custom-tools-loading">Loading its tools…</p>;
  if (read.state === 'unreadable') return <div className="px-3 py-2" data-testid="custom-tools-unreadable"><Unreadable what="This server’s tools" claim={read.message || 'This is not a claim that it lists none.'} /></div>;
  if (!read.tools.length) return <p className="px-3 py-2 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="custom-tools-empty">This server lists no tools.</p>;
  return (
    <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="custom-tools">
      {read.tools.map((t) => {
        const row = toolRow(t);
        const on = row.approved && !row.changed;
        return (
          <li key={t.name} className="flex flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-start sm:justify-between" data-testid={`custom-tool-${t.name}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="break-all font-mono text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{t.name}</span>
                {row.changed && <Pill tone="warn">Changed since you approved it</Pill>}
                {!row.can && <Pill tone="neutral">Writes</Pill>}
              </div>
              {t.description
                ? <p className="mt-0.5 break-words text-[12px] text-axal-ink/80 dark:text-gray-300"><span className="text-axal-muted dark:text-gray-400">The server’s own words: </span><span data-testid="custom-tool-description">{String(t.description)}</span></p>
                : <p className="mt-0.5 text-[12px] text-axal-muted dark:text-gray-400">The server gives no description.</p>}
              {!row.can && <p className="mt-0.5 text-[11.5px] text-axal-muted dark:text-gray-400">{row.note}</p>}
            </div>
            {row.can && (
              <button type="button" role="switch" aria-checked={on} aria-label={`${on ? 'Withdraw' : 'Approve'} ${t.name}`} disabled={!!busy} onClick={() => onToggle?.(t, !on)}
                className={`${on ? BTN.ghost : BTN.primary} shrink-0`} data-testid={`custom-tool-toggle-${t.name}`}>
                {busy === t.name ? 'Saving…' : on ? 'Withdraw' : row.changed ? 'Approve again' : 'Approve'}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CustomTools({ uid, onChanged }) {
  const [read, setRead] = useState({ state: 'loading', tools: [], message: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const out = await connectorsCustomApi.tools(uid);
      setRead({ state: 'ready', tools: Array.isArray(out?.tools) ? out.tools : [], message: '' });
    } catch (e) {
      setRead({ state: 'unreadable', tools: [], message: e?.message || '' });
    }
  }, [uid]);
  useEffect(() => { load(); }, [load]);
  const toggle = async (t, approve) => {
    setBusy(t.name); setError('');
    try {
      if (approve) await connectorsCustomApi.approveTool(uid, t.name);
      else await connectorsCustomApi.withdrawTool(uid, t.name);
      await load();
      onChanged?.();
    } catch (e) { setError(e?.message || 'That could not be saved.'); }
    finally { setBusy(''); }
  };
  return (
    <div className="border-t border-axal-hairline dark:border-gray-800">
      {error && <p role="alert" className="px-3 pt-2 text-[12px] text-red-700 dark:text-red-300">{error}</p>}
      <CustomToolsList read={read} onToggle={toggle} busy={busy} />
    </div>
  );
}

/** One server: its host, status, last error and approved count, with Check, Tools and Remove. */
export function CustomServerRow({ server, onChanged, initialTools = false }) {
  const [tools, setTools] = useState(initialTools);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState('');
  const [line, setLine] = useState(null);
  const status = serverStatus(server);
  const name = serverName(server);
  const check = async () => {
    setBusy('check'); setLine(null);
    try {
      setLine(healthLine(await connectorsCustomApi.health(server.uid)));
      onChanged?.();
    } catch (e) { setLine({ tone: 'danger', text: e?.message || 'This server could not be checked.' }); }
    finally { setBusy(''); }
  };
  // Removing never waits on the list: `DELETE /:uid` answers with the flag off too.
  const remove = async () => {
    setBusy('remove'); setLine(null);
    try {
      await connectorsCustomApi.revoke(server.uid);
      setConfirming(false);
      onChanged?.();
    } catch (e) { setLine({ tone: 'danger', text: e?.message || 'This server could not be removed.' }); }
    finally { setBusy(''); }
  };
  return (
    <div data-testid={`custom-server-${server.uid}`}>
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="break-all text-[13px] font-bold text-axal-ink dark:text-gray-100">{name}</span>
            <Pill tone={status.tone}>{status.label}</Pill>
          </div>
          <p className="text-[11.5px] text-axal-muted dark:text-gray-400">{approvedLabel(server)}{status.why ? ` · ${status.why}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={BTN.ghost} disabled={!!busy} onClick={check} data-testid={`button-custom-check-${server.uid}`}>{busy === 'check' ? 'Checking…' : 'Check'}</button>
          <button type="button" className={BTN.ghost} aria-expanded={tools} onClick={() => setTools((v) => !v)} data-testid={`button-custom-tools-${server.uid}`}>Tools</button>
          {!confirming && <button type="button" className={BTN.danger} disabled={!!busy} onClick={() => setConfirming(true)} data-testid={`button-custom-remove-${server.uid}`}>Remove</button>}
        </div>
      </div>
      {confirming && (
        <div className="mx-3 mb-2.5 flex flex-col gap-2 rounded-axal-sm border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800 sm:flex-row sm:items-center sm:justify-between dark:border-red-900 dark:bg-red-950/30 dark:text-red-200" data-testid={`custom-remove-confirm-${server.uid}`}>
          <span>Remove {name}? Eadwyn stops using its tools, and its sign-in is deleted here.</span>
          <span className="flex gap-1.5">
            <button type="button" className={BTN.ghost} disabled={busy === 'remove'} onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className={BTN.dangerSolid} disabled={busy === 'remove'} onClick={remove} data-testid={`button-custom-remove-confirm-${server.uid}`}>{busy === 'remove' ? 'Removing…' : 'Remove'}</button>
          </span>
        </div>
      )}
      {line && <p role={line.tone === 'danger' ? 'alert' : 'status'} className={`px-3 pb-2 text-[12px] ${line.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : line.tone === 'warn' ? 'text-amber-800 dark:text-amber-300' : 'text-red-700 dark:text-red-300'}`}>{line.text}</p>}
      {tools && <CustomTools uid={server.uid} onChanged={onChanged} />}
    </div>
  );
}

/** Under Yours: the member's own MCP servers, drawn only once `list()` has read some, or failed. */
export function CustomServersGroup({ custom, onChanged }) {
  if (!showCustomGroup(custom)) return null;
  return (
    <section className="flex flex-col gap-1.5" data-testid="custom-servers">
      <h3 className="text-[15px] font-bold text-axal-ink dark:text-gray-100">Custom servers</h3>
      <div className="divide-y divide-axal-hairline rounded-axal-sm border border-axal-hairline bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
        {custom.state === 'unreadable' && (
          <div className="px-3 py-2.5" data-testid="custom-servers-unreadable">
            <Unreadable what="Your custom servers" claim={custom.servers.length ? 'The servers below are the last ones read.' : 'This is not a claim that you have none.'} onRetry={onChanged} />
          </div>
        )}
        {custom.servers.map((s) => <CustomServerRow key={s.uid} server={s} onChanged={onChanged} />)}
      </div>
    </section>
  );
}
