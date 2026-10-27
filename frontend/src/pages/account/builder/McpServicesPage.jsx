import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Sheet from '../../../ui/Sheet.jsx';
import { CopyUrl } from '../AssistantsGroup';
import { assistantsApi } from '../../../lib/api/assistants.js';
import { developerKeysApi } from '../../../lib/api/developerKeys.js';
import { connectorsApi } from '../../../lib/api/connectors.js';
import { useEscapeClose } from '../../../components/useEscapeClose';
import {
  CONNECT_ELSEWHERE, EXPLORER_SERVICES, LAB_NOTE, LIMITS_FOOT, NOTHING_TO_APPROVE, NOT_YOURS, NO_CALLERS, SERVER_WORDS,
  SERVICES_EMPTY, SERVICES_SHOWN, SERVICE_FILTERS, SERVICE_TOOLS_WAIT, SUPER_ADMIN_KEYS,
  assistantRow, audienceOf, checkStrip, filterServices, keysSummary, limitRows, readOf, serverState, serviceRows,
} from './mcpServicesModel';

/**
 * #2479 — Account › Builder › MCP and services: MCPX1 (Founder), MCPX6
 * (Investor, Advisor, Operating Partner, Admin), MCPX7 (Explorer, Super
 * Admin), MCPX8–MCPX10 (empty, loading, error and switched off), the service
 * drawer (MCPX3) and the assistant drawer (MCPX5), and the phone (MCPX12),
 * whose tabs `BuilderSection` draws.
 *
 * Each card reads on its own, so one failed read costs that card only. The
 * tools card waits for D846's tool read (`Wait` in `BuilderSection`); nothing
 * here draws a tool, a price or a limit the Worker did not send. Connecting,
 * disconnecting and every key action stay on their own pages: this page links.
 *
 * `api` is the reads, so a test can stand in for each.
 */

export const MCP_API = {
  grants: () => assistantsApi.grants(),
  revoke: (id) => assistantsApi.revoke(id),
  keys: () => developerKeysApi.list(),
  limits: () => developerKeysApi.limits(),
  connections: () => connectorsApi.list(),
  catalogue: () => connectorsApi.available(),
  health: () => connectorsApi.health(),
};

const CARD = 'rounded-axal-lg border border-axal-hairline bg-white p-5 dark:border-gray-700 dark:bg-gray-900';
const H3 = 'm-0 text-[15px] font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const MONO = 'font-mono tabular-nums';
const LINK = 'text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300';
const PILL = {
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  amber: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  destructive: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  muted: 'border-axal-hairline bg-white text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
};
const SQUARE = { ok: 'bg-emerald-600 border-emerald-600', degraded: 'bg-amber-400 border-amber-400', failing: 'bg-red-600 border-red-600', unchecked: 'border-dashed border-gray-400 bg-transparent' };

function Pill({ tone = 'muted', children, testid }) {
  return <span className={`inline-flex w-fit items-center rounded-axal-pill border px-2 py-0.5 text-[11.5px] font-bold ${PILL[tone] || PILL.muted}`} data-testid={testid}>{children}</span>;
}

function Reading({ testid }) {
  return <div className="flex flex-col gap-2" data-testid={testid}><span className={`text-[12.5px] ${MUTED}`}>Reading…</span><span className="h-4 w-2/3 animate-pulse rounded bg-axal-ground dark:bg-gray-800" /></div>;
}

function Failed({ what, onRetry, testid }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-red-700 dark:text-red-300" data-testid={testid}>
      <span>{what} could not be read. That is not the same as having none.</span>
      {onRetry && <button type="button" className="inline-flex min-h-[44px] items-center font-bold underline" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** One read, its state and Try again. */
function useRead(fn) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: 'loading', data: null });
    Promise.resolve().then(fn).then((value) => { if (live) setState(readOf({ ok: true, value })); }, (error) => { if (live) setState(readOf({ ok: false, error })); });
    return () => { live = false; };
  }, [fn, round]);
  return [state, useCallback(() => setRound((n) => n + 1), []), setState];
}

/** Card 1, "axal.vc/mcp". */
function EndpointCard({ server, keys, copy }) {
  const k = keysSummary(keys);
  return (
    <section className={`${CARD} flex flex-col gap-3`} data-testid="mcp-endpoint">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={H3}>axal.vc/mcp</h3>
        {server !== 'loading' && <Pill tone={server === 'off' ? 'muted' : 'positive'} testid="mcp-server-state">{server === 'off' ? SERVER_WORDS.off : SERVER_WORDS.on}</Pill>}
      </div>
      <CopyUrl copy={copy} />
      {server === 'off' ? (
        <p className={`m-0 text-[13px] ${MUTED}`} data-testid="mcp-server-off">{SERVER_WORDS.offLine}</p>
      ) : (
        <>
          <span className="font-mono text-[10.5px] font-medium uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">How a caller signs in</span>
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-200">{SERVER_WORDS.assistantSignIn}</p>
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-200" data-testid="mcp-key-row">
            {k.state === 'ready' ? <>API key: a script sends <code className={`${MONO} text-[12px]`}>Authorization: Bearer axk_…</code> with a key you create. <span className={MONO}>{k.active}</span> active · <Link to="/account/builder/keys" className={LINK}>Manage API keys →</Link></>
              : k.state === 'loading' ? <span className={MUTED}>Reading your API keys…</span> : <span className={MUTED}>{k.line}</span>}
          </p>
          <p className={`m-0 text-[12.5px] ${MUTED}`}>{SERVER_WORDS.checkedLine}</p>
        </>
      )}
    </section>
  );
}

/** DEV4's question, in the page's own dialog: what Revoke changes, then Revoke or Keep. */
function RevokeDialog({ row, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEscapeClose(onCancel);
  const go = async () => {
    setBusy(true); setError('');
    try { await onConfirm(); } catch (e) { setError(e?.message || 'The connection could not be revoked. Nothing changed.'); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" data-testid="mcp-revoke-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="mcp-revoke-title" className="flex w-full max-w-[440px] flex-col gap-3 rounded-t-[16px] bg-white p-5 dark:bg-gray-900 sm:rounded-[16px]" data-testid="mcp-revoke-dialog">
        <h2 id="mcp-revoke-title" className="m-0 text-[16px] font-extrabold text-axal-ink dark:text-gray-100">Revoke {row.host || 'this assistant'}?</h2>
        <p className={`m-0 text-[13px] ${MUTED}`}>Revoke now? It stops at once. The assistant can no longer call StudioOS for {row.companiesLine}.</p>
        {error && <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="inline-flex min-h-[44px] items-center rounded-[9px] border border-axal-hairline px-3.5 text-[13px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100" onClick={onCancel}>Keep</button>
          <button type="button" className="inline-flex min-h-[44px] items-center rounded-[9px] bg-red-700 px-3.5 text-[13px] font-bold text-white disabled:opacity-50" disabled={busy} onClick={go} data-testid="mcp-revoke-yes">{busy ? 'Revoking…' : 'Revoke'}</button>
        </div>
      </div>
    </div>
  );
}

/** Card 2, "Who can call for you". */
function CallersCard({ grants, keys, audience, onRetry, onRevoke }) {
  const [asking, setAsking] = useState(null);
  const rows = grants.status === 'ready' ? (Array.isArray(grants.data?.grants) ? grants.data.grants : []).map(assistantRow) : [];
  const k = keysSummary(keys);
  const noOne = grants.status === 'ready' && !rows.length && (k.state !== 'ready' || k.active === 0);
  if (audience.kind !== 'owner' && grants.status === 'ready' && !rows.length) {
    return (
      <section className={`${CARD} flex flex-col gap-2`} data-testid="mcp-nothing-to-approve">
        <h3 className={H3}>Nothing to approve yet</h3>
        <p className={`m-0 text-[13px] ${MUTED}`}>{NOTHING_TO_APPROVE}</p>
      </section>
    );
  }
  return (
    <section className={`${CARD} flex flex-col gap-3`} data-testid="mcp-callers">
      <h3 className={H3}>Who can call for you</h3>
      {grants.status === 'loading' ? <Reading testid="mcp-callers-loading" />
        : grants.status === 'unreadable' || grants.status === 'refused' ? <Failed what="Your connections" onRetry={onRetry} testid="mcp-callers-unreadable" />
          : noOne ? (
            <div className="flex flex-col gap-1.5" data-testid="mcp-callers-empty">
              <p className="m-0 text-[13px] text-axal-ink dark:text-gray-200">{NO_CALLERS}</p>
              <span className={`text-[12.5px] ${MUTED}`}>Copy the address into your assistant, above, or <Link to="/account/builder/keys" className={LINK}>Create an API key ›</Link></span>
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800" data-testid="mcp-assistants">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-[12.5px]" data-testid={`mcp-assistant-${r.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`${MONO} text-[13px] font-semibold text-axal-ink dark:text-gray-100`}>{r.host || 'Host not recorded'}</span>
                      <Pill tone="amber">{r.recognition}</Pill>
                    </div>
                    <div className={MUTED}>{r.calledItself ? `Calls itself “${r.calledItself}” · ` : ''}{r.companiesLine}</div>
                    <div className={`${MONO} ${MUTED}`}>{r.connected ? `Connected ${r.connected}` : 'Connected: not recorded'} · <span data-testid={`mcp-assistant-last-${r.id}`}>{r.lastCallLine}</span></div>
                  </div>
                  <Link to={`/account/builder/assistants/${encodeURIComponent(r.id)}`} className={`inline-flex min-h-[44px] items-center ${LINK}`}>Open ›</Link>
                  <button type="button" className="inline-flex min-h-[44px] items-center rounded-md border border-axal-hairline px-2.5 text-[12px] font-bold text-axal-ink dark:border-gray-700 dark:text-gray-100" onClick={() => setAsking(r)} data-testid={`mcp-revoke-${r.id}`}>Revoke</button>
                </li>
              ))}
            </ul>
          )}
      {k.state === 'ready' && (
        <p className="m-0 flex flex-wrap items-center gap-2 border-t border-axal-hairline pt-2.5 text-[12.5px] text-axal-ink dark:border-gray-800 dark:text-gray-200" data-testid="mcp-keys-line">
          <span>API keys · <span className={MONO}>{k.line}</span></span><Link to="/account/builder/keys" className={LINK}>Open API keys →</Link>
        </p>
      )}
      {asking && <RevokeDialog row={asking} onCancel={() => setAsking(null)} onConfirm={async () => { await onRevoke(asking.id); setAsking(null); }} />}
    </section>
  );
}

/** Card 4, "Services behind your tools", and MCPX2's full list behind "See all services". */
function ServicesCard({ rows, connections, audience, onRetry, testid = 'mcp-services' }) {
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  if (audience.kind === 'explorer' || connections.status === 'refused') {
    return (
      <section className={`${CARD} flex flex-col gap-2`} data-testid="mcp-services-explorer">
        <h3 className={H3}>Services behind your tools</h3>
        <p className={`m-0 text-[13px] ${MUTED}`}>{EXPLORER_SERVICES}</p>
        <Link to="/onboarding" className={LINK}>Set up your profile</Link>
      </section>
    );
  }
  const shown = all ? filterServices(rows, { q, filter }) : rows.slice(0, SERVICES_SHOWN);
  return (
    <section className={`${CARD} flex flex-col gap-3`} data-testid={testid}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={H3}>{all ? 'Services' : 'Services behind your tools'}</h3>
        {all && <button type="button" className={`inline-flex min-h-[44px] items-center ${LINK}`} onClick={() => setAll(false)}>‹ MCP and services</button>}
      </div>
      {connections.status === 'loading' ? <Reading testid="mcp-services-loading" />
        : connections.status !== 'ready' ? <Failed what="Your services" onRetry={onRetry} testid="mcp-services-unreadable" />
          : !rows.length ? (
            <p className="m-0 text-[13px] text-axal-ink dark:text-gray-200" data-testid="mcp-services-empty">{SERVICES_EMPTY} <Link to="/account/connectors" className={LINK}>Browse connectors ›</Link></p>
          ) : (
            <>
              {all && (
                <div className="flex flex-col gap-2">
                  <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search services" placeholder="Search services"
                    className="min-h-[40px] rounded-[7px] border border-axal-hairline bg-white px-3 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" data-testid="mcp-services-search" />
                  <div className="flex flex-wrap gap-[7px]" role="group" aria-label="Filter services">
                    {SERVICE_FILTERS.map((f) => <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} data-testid={`mcp-services-filter-${f.key}`}
                      className={`inline-flex min-h-[44px] items-center rounded-axal-pill border px-3 text-[12.5px] font-semibold ${filter === f.key ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep' : 'border-axal-hairline text-axal-ink dark:border-gray-700 dark:text-gray-100'}`}>{f.label}</button>)}
                  </div>
                  <p className={`m-0 text-[12.5px] ${MUTED}`}>{CONNECT_ELSEWHERE}</p>
                </div>
              )}
              <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800" data-testid="mcp-service-rows">
                {shown.map((r) => (
                  <li key={r.uid} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-[12.5px]" data-testid={`mcp-service-${r.key}`}>
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-[7px] bg-axal-ground text-[12px] font-bold text-axal-ink dark:bg-gray-800 dark:text-gray-100" aria-hidden="true">{r.name.charAt(0).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-axal-ink dark:text-gray-100">{r.name}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={r.state.tone}>{r.state.label}{r.state.why ? ` · ${r.state.why}` : ''}</Pill>
                        <Pill tone={r.health.tone} testid={`mcp-service-health-${r.key}`}>{r.health.label}</Pill>
                        {r.checked && <span className={`${MONO} ${MUTED}`}>{r.checked}</span>}
                      </div>
                    </div>
                    <span className={`${MONO} ${MUTED}`}>{r.companies == null ? 'Companies not recorded' : r.companies === 0 ? 'No company' : `${r.companies} ${r.companies === 1 ? 'company' : 'companies'}`}</span>
                    <Link to={r.drawer} className={`inline-flex min-h-[44px] items-center ${LINK}`}>Open ›</Link>
                  </li>
                ))}
              </ul>
              {all && !shown.length && <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="mcp-services-none-match">No service matches.</p>}
              {!all && rows.length > 0 && <button type="button" className={`inline-flex min-h-[44px] w-fit items-center ${LINK}`} onClick={() => setAll(true)} data-testid="mcp-services-all">See all services ›</button>}
            </>
          )}
    </section>
  );
}

/** Card 5, "Limits". */
function LimitsCard({ limits, onRetry }) {
  const rows = limitRows(limits);
  return (
    <section className={`${CARD} flex flex-col gap-2`} data-testid="mcp-limits">
      <h3 className={H3}>Limits</h3>
      {limits.status === 'loading' ? <Reading testid="mcp-limits-loading" />
        : !rows ? <Failed what="Your limits" onRetry={onRetry} testid="mcp-limits-unreadable" />
          : (
            <dl className="m-0 flex flex-col gap-1.5">
              {rows.map((r) => (
                <div key={r.key} className="flex flex-wrap justify-between gap-2 text-[13px]" data-testid={`mcp-limit-${r.key}`}>
                  <dt className="text-axal-ink dark:text-gray-200">{r.label}</dt>
                  <dd className={`m-0 ${r.value ? `${MONO} text-axal-ink dark:text-gray-100` : MUTED}`}>
                    {r.value || r.reason}{r.link && <> · <Link to={r.link.to} className={LINK}>{r.link.label}</Link></>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
      <p className={`m-0 text-[12.5px] ${MUTED}`}>{LIMITS_FOOT}</p>
    </section>
  );
}

/**
 * D1331, D1317: a drawer is the shared right Sheet over MCP and services, 560px
 * (a full screen on the phone), with focus moved in and Escape to close.
 * Closing returns to the page's address.
 */
function Drawer({ title, back = '/account/builder', children, testid }) {
  const navigate = useNavigate();
  const kind = testid === 'mcp-service-drawer' ? 'service' : 'assistant';
  return (
    <Sheet eyebrow={`Builder › ${kind === 'service' ? 'MCP and services' : 'AI assistants'}`} title={title} width={560}
      testId={`builder-drawer-${kind}`} onClose={() => navigate(back)}>
      <div className="flex flex-col gap-3 p-5" data-testid={testid}>{children}</div>
    </Sheet>
  );
}

/** MCPX3, /account/builder/services/[key]. */
function ServiceDrawer({ keyName, rows, connections, onRetry }) {
  if (connections.status === 'loading') return <Drawer title="Service" testid="mcp-service-drawer"><Reading testid="mcp-service-drawer-loading" /></Drawer>;
  if (connections.status !== 'ready') return <Drawer title="Service" testid="mcp-service-drawer"><Failed what="This service" onRetry={onRetry} testid="mcp-service-drawer-unreadable" /></Drawer>;
  const r = rows.find((x) => x.key === keyName);
  if (!r) {
    return (
      <Drawer title="Service" testid="mcp-service-drawer">
        <p className="m-0 text-[13px] text-axal-ink dark:text-gray-200" data-testid="mcp-service-not-yours">{NOT_YOURS.service}</p>
        <Link to="/account/builder" className={LINK}>Back to MCP and services</Link>
      </Drawer>
    );
  }
  const strip = checkStrip(r.checks);
  return (
    <Drawer title={r.name} testid="mcp-service-drawer">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={H3}>{r.name}</h3>
        <Pill tone={r.state.tone}>{r.state.label}</Pill>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">Health</span>
        <div className="flex flex-wrap items-center gap-2"><Pill tone={r.health.tone} testid="mcp-drawer-health">{r.health.label}</Pill>{r.checked && <span className={`${MONO} text-[12px] ${MUTED}`}>{r.checked}</span>}</div>
        <ol className="m-0 flex list-none gap-1 p-0" aria-label="The last ten checks, oldest first" data-testid="mcp-check-strip">
          {strip.cells.map((c, i) => <li key={i} title={c.label} aria-label={c.label} className={`h-4 w-4 rounded-[3px] border ${SQUARE[c.key] || SQUARE.unchecked}`} data-state={c.key} />)}
        </ol>
        <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="mcp-check-line">{strip.line}</p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">Tools it gives axal.vc/mcp</span>
        <p className={`m-0 text-[12.5px] ${MUTED}`}>{SERVICE_TOOLS_WAIT}</p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">Permissions it holds at {r.name}</span>
        {r.scopes?.length ? <div className="flex flex-wrap gap-[7px]">{r.scopes.map((s) => <code key={s} className={`${MONO} rounded-axal-pill border border-axal-hairline px-2 py-0.5 text-[11.5px] dark:border-gray-700`}>{s}</code>)}</div>
          : <p className={`m-0 text-[12.5px] ${MUTED}`}>Not recorded</p>}
      </div>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>{r.companies == null ? 'Companies: not recorded' : `Switched on for ${r.companies} ${r.companies === 1 ? 'company' : 'companies'}`}</p>
      <p className={`m-0 text-[12.5px] ${MONO} ${MUTED}`}>{r.lastSync ? `Last sync ${r.lastSync}` : 'Last sync: not recorded'}</p>
      {r.lastError && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" data-testid="mcp-drawer-error">{r.lastError}</p>}
      <Link to={r.page} className="inline-flex min-h-[44px] w-fit items-center rounded-[9px] bg-axal-violet px-3.5 text-[13px] font-bold text-white hover:bg-axal-violet-deep" data-testid="mcp-fix-on-page">Fix on its page ›</Link>
    </Drawer>
  );
}

/** MCPX5, /account/builder/assistants/[id]: DEV3's drawer from the grants read. */
function AssistantDrawer({ id, grants, onRetry, onRevoke }) {
  const [asking, setAsking] = useState(false);
  if (grants.status === 'loading') return <Drawer title="AI assistant" testid="mcp-assistant-drawer"><Reading testid="mcp-assistant-drawer-loading" /></Drawer>;
  if (grants.status !== 'ready') return <Drawer title="AI assistant" testid="mcp-assistant-drawer"><Failed what="This connection" onRetry={onRetry} testid="mcp-assistant-drawer-unreadable" /></Drawer>;
  const g = (Array.isArray(grants.data?.grants) ? grants.data.grants : []).find((x) => String(x?.id) === String(id));
  if (!g) {
    return (
      <Drawer title="AI assistant" testid="mcp-assistant-drawer">
        <p className="m-0 text-[13px] text-axal-ink dark:text-gray-200" data-testid="mcp-assistant-not-yours">{NOT_YOURS.assistant}</p>
        <Link to="/account/builder" className={LINK}>Back to MCP and services</Link>
      </Drawer>
    );
  }
  const r = assistantRow(g);
  return (
    <Drawer title="AI assistant" testid="mcp-assistant-drawer">
      <div className="flex flex-wrap items-center gap-2"><h3 className={`${H3} ${MONO}`}>{r.host || 'Host not recorded'}</h3><Pill tone="amber">{r.recognition}</Pill></div>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>Signs in from <span className={MONO}>{r.host || 'a host not recorded'}</span>{r.calledItself ? ` · calls itself “${r.calledItself}”` : ''}</p>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">Companies</span>
        {r.companies.length ? <ul className="m-0 list-none p-0 text-[13px] text-axal-ink dark:text-gray-200">{r.companies.map((c) => <li key={c}>{c}</li>)}</ul> : <p className={`m-0 text-[12.5px] ${MUTED}`}>No company recorded</p>}
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">What it may do</span>
        {r.permissions ? <div className="flex flex-wrap gap-[7px]">{r.permissions.map((s) => <code key={s} className={`${MONO} rounded-axal-pill border border-axal-hairline px-2 py-0.5 text-[11.5px] dark:border-gray-700`}>{s}</code>)}</div>
          : <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="mcp-assistant-permissions-wait">Its permissions are not on the grants read yet (being built).</p>}
        <p className={`m-0 text-[12.5px] ${MUTED}`}>It cannot change a module, delete anything, or see other companies.</p>
      </div>
      <p className={`m-0 text-[12.5px] ${MONO} ${MUTED}`}>{r.connected ? `Connected ${r.connected}` : 'Connected: not recorded'} · {r.lastCallLine}</p>
      <button type="button" className="inline-flex min-h-[44px] w-fit items-center rounded-[9px] border border-red-300 px-3.5 text-[13px] font-bold text-red-700 dark:border-red-800 dark:text-red-300" onClick={() => setAsking(true)} data-testid="mcp-drawer-revoke">Revoke</button>
      {asking && <RevokeDialog row={r} onCancel={() => setAsking(false)} onConfirm={async () => { await onRevoke(r.id); setAsking(false); }} />}
    </Drawer>
  );
}

/**
 * The page and its two drawers. `view` is `builderViewFor`'s; `tools` is the
 * waiting tools block `BuilderSection` passes in, in Card 3's place.
 */
export default function McpServicesPage({ view, role, user, api = MCP_API, tools = null, copy }) {
  const [grants, retryGrants, setGrants] = useRead(api.grants);
  const [keys] = useRead(api.keys);
  const [limits, retryLimits] = useRead(api.limits);
  const [connections, retryConnections] = useRead(api.connections);
  const [catalogue] = useRead(api.catalogue);
  const [health] = useRead(api.health);
  const audience = audienceOf(role, user);
  const server = serverState(grants);
  const rows = serviceRows({ connections, catalogue, health });
  const revoke = async (id) => {
    await api.revoke(id);
    setGrants((g) => ({ ...g, data: { ...g.data, grants: (g.data?.grants || []).filter((x) => String(x?.id) !== String(id)) } }));
  };

  // D1317: the page stays drawn; a drawer's address opens it over the page.
  const drawer = view?.drawer?.kind === 'service' ? <ServiceDrawer keyName={view.drawer.id} rows={rows} connections={connections} onRetry={retryConnections} />
    : view?.drawer?.kind === 'assistant' ? <AssistantDrawer id={view.drawer.id} grants={grants} onRetry={retryGrants} onRevoke={revoke} /> : null;

  return (
    <div className="flex flex-col gap-[14px]" data-testid="mcp-services-page" data-audience={audience.kind}>
      {drawer}
      {audience.lab && <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="mcp-lab-note">{LAB_NOTE}</p>}
      <EndpointCard server={server} keys={keys} copy={copy} />
      {server === 'off' ? null : (
        <>
          <CallersCard grants={grants} keys={keys} audience={audience} onRetry={retryGrants} onRevoke={revoke} />
          {tools}
        </>
      )}
      <ServicesCard rows={rows} connections={connections} audience={audience} onRetry={retryConnections} />
      <LimitsCard limits={limits} onRetry={retryLimits} />
      {audience.superAdmin && (
        <p className={`m-0 text-[12.5px] ${MUTED}`} data-testid="mcp-super-admin-keys">{SUPER_ADMIN_KEYS} <Link to="/admin/integration-keys" className={LINK}>Open Integration keys ›</Link></p>
      )}
    </div>
  );
}
