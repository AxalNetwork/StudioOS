/**
 * D1315 (#2418) — Account › Builder, the pane: its eyebrow trail, its h2, the
 * page's own line, and each page's blocks. A block whose read has landed draws
 * it (the MCP server's address, the connected assistants); every other block
 * says "Not read here yet" and names the task that builds it. Never sample data.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AssistantsSection, CopyUrl } from '../AssistantsGroup';
import { assistantsApi } from '../../../lib/api/assistants.js';
import { BUILDER_LINES, BUILDER_PAGES, BUILDER_WORDS, builderPathFor, builderTrailFor } from './builderModel';
import ApiKeysPage from './ApiKeysPage';
import { activeSupportSession } from '../../../lib/supportSession';
import { useViewMode } from '../../../contexts/ViewModeContext';
import { useAuth } from '../../../hooks/useAuthSync';

const CARD = 'rounded-axal-lg border border-axal-hairline bg-white p-5 dark:border-gray-700 dark:bg-gray-900';
const H3 = 'm-0 text-[15px] font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'font-mono text-[10.5px] font-medium uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const NOT_YET = 'Not read here yet';
export const MOVED_KEY = 'axal.builder.assistantsMoved.dismissed';

/** Each waiting block: what it will draw, and the task that builds it. */
export const WAITS = Object.freeze({
  tools: 'The tools on axal.vc/mcp, who can call them and what each may do. #2479 draws them from the tool read (D846).',
  limits: 'The server’s own limits per connection and per call. #2479 draws them from the overview read (D1316, #3474).',
  services: 'The services behind your tools and how each is doing. #2479 draws them from the connector reads and their health (D848).',
  usage: 'Requests and AI tokens by day, where the tokens went, and your limits and alerts. #2481 draws them from GET /api/developer/usage.',
  activity: 'Every call your keys and assistants made, with its outcome. #2481 draws it from GET /api/developer/usage/events.',
  assistant: 'One assistant: where it signs in from, what it may do, its companies and its recent calls. #2479 draws it (MCPX5).',
  service: 'One service: its connection, its health and its last checks. #2479 draws it (MCPX3).',
  request: 'One request: its tool, company, outcome and cost. #2481 draws it (APIU4).',
});

export function Wait({ id, title }) {
  return (
    <section className={`${CARD} flex flex-col gap-2`} data-testid={`builder-wait-${id}`}>
      {title && <h3 className={H3}>{title}</h3>}
      <span className="w-fit rounded-axal-pill border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-axal-muted dark:border-gray-600 dark:text-gray-400">{NOT_YET}</span>
      <p className={`m-0 text-[12.5px] ${MUTED}`}>{WAITS[id]}</p>
    </section>
  );
}

const DRAWER_TITLES = { assistant: 'AI assistant', service: 'Service', request: 'Request' };
const BACK = { assistant: 'MCP and services', service: 'MCP and services', request: 'Activity' };

/** The once-per-member notice that AI assistants left Connectors (DEV14, MCPX13). */
function MovedNotice({ storage }) {
  const read = () => { try { return storage?.getItem(MOVED_KEY) === '1'; } catch { return false; } };
  const [gone, setGone] = useState(read);
  if (gone) return null;
  const dismiss = () => { try { storage?.setItem(MOVED_KEY, '1'); } catch { /* the notice still closes */ } setGone(true); };
  return (
    <div role="status" className="flex items-center gap-2.5 rounded-axal-md border border-axal-lavender-edge bg-axal-lavender px-3 py-2 text-[13px] text-axal-ink dark:border-violet-800 dark:bg-violet-950/40 dark:text-gray-100" data-testid="builder-moved-notice">
      <span className="flex-1">{BUILDER_WORDS.movedNotice}</span>
      <button type="button" onClick={dismiss} className="inline-flex min-h-[44px] items-center rounded-axal-sm px-2 text-[12px] font-semibold text-axal-violet hover:underline dark:text-violet-300">Dismiss</button>
    </div>
  );
}

/**
 * The Connectors hand-off (DEV14, MCPX13): where the AI assistants group was,
 * one compact card that counts the connected assistants and opens Builder. The
 * count is today's grants read; a failed or switched-off read draws no number.
 */
export function BuilderHandoff({ api = assistantsApi }) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    let live = true;
    api.grants().then((r) => { if (live) setCount(Array.isArray(r?.grants) ? r.grants.length : null); }, () => { if (live) setCount(null); });
    return () => { live = false; };
  }, [api]);
  return (
    <section id="ai-assistants" className={`${CARD} flex flex-wrap items-center gap-3`} data-testid="builder-handoff">
      <div className="min-w-0 flex-1">
        <h3 className={H3}>{BUILDER_WORDS.handoffTitle}</h3>
        <p className={`m-0 text-[12.5px] ${MUTED}`}>{BUILDER_WORDS.handoffLine}</p>
        {count != null && <p className="m-0 mt-1 font-mono text-[12px] tabular-nums text-axal-ink dark:text-gray-100" data-testid="builder-handoff-count">{count} connected</p>}
      </div>
      <Link to={builderPathFor({ page: 'services' })} className="inline-flex min-h-[44px] items-center rounded-axal-md border border-axal-hairline bg-white px-3.5 text-[13px] font-semibold text-axal-ink hover:border-axal-violet dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">{BUILDER_WORDS.openBuilder}</Link>
    </section>
  );
}

/** API keys (D1317, #2480) with who is reading: a support or view-as session reads only, and the profile picks APIK9's card. */
function KeysPage({ drawerUid }) {
  const { user } = useAuth() || {};
  const view = useViewMode();
  const support = !!activeSupportSession() || !!view?.isImpersonating;
  const role = user?.role === 'exploring' ? 'explorer' : Number(user?.is_super_admin) === 1 ? 'super_admin' : user?.role ?? null;
  return <ApiKeysPage drawerUid={drawerUid} support={support} who={user?.name || null} role={role} />;
}

function ServicesPage() {
  return (
    <>
      <section className={`${CARD} flex flex-col gap-2`} data-testid="builder-mcp-server">
        <h3 className={H3}>StudioOS MCP server</h3>
        <CopyUrl />
        <p className={`m-0 text-[12.5px] ${MUTED}`}>Add this address to your assistant, sign in, and choose which companies it may reach. Nothing is pasted as a key.</p>
      </section>
      {/* The connected assistants and their setup: today's read and Revoke, moved here from Connectors. */}
      <div className={CARD} data-testid="builder-assistants"><AssistantsSection /></div>
      <Wait id="tools" title="Who can call for you · Tools on axal.vc/mcp" />
      <Wait id="limits" title="Limits" />
      <Wait id="services" title="Services behind your tools" />
    </>
  );
}

/**
 * The pane for one view (`builderViewFor`). `storage` holds the notice's
 * dismissal; the tests pass a fake, the page passes `window.localStorage`.
 */
export default function BuilderSection({ view = { page: 'services', drawer: null }, storage = typeof window !== 'undefined' ? window.localStorage : null }) {
  const { page, drawer } = view;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="account-builder" data-page={page}>
      <header className="flex flex-col gap-1">
        <span className={EYEBROW} data-testid="builder-trail">{builderTrailFor(view)}</span>
        <h2 className="m-0 text-[18px] font-extrabold tracking-axal-heading text-axal-ink dark:text-gray-100">{BUILDER_WORDS.title}</h2>
        <p className={`m-0 text-[13px] ${MUTED}`}>{BUILDER_LINES[page]}</p>
      </header>
      {/* Below lg the section column is gone, so the four pages are tabs (MCPX12, APIK16, APIU8). */}
      <nav aria-label="Builder" className="flex gap-2 overflow-x-auto lg:hidden" data-testid="builder-tabs">
        {BUILDER_PAGES.map((p) => (
          <Link key={p.id} to={p.path} aria-current={p.id === page ? 'page' : undefined}
            className={`inline-flex min-h-[44px] flex-none items-center rounded-axal-pill border px-3 text-[13px] font-semibold ${p.id === page ? 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep' : 'border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'}`}>{p.label}</Link>
        ))}
      </nav>
      {page === 'services' && !drawer && <MovedNotice storage={storage} />}
      {page === 'keys' ? (
        <KeysPage drawerUid={drawer?.kind === 'key' ? drawer.id : null} />
      ) : drawer ? (
        <section className={`${CARD} flex flex-col gap-2`} data-testid={`builder-drawer-${drawer.kind}`}>
          <Link to={builderPathFor({ page })} className="w-fit text-[12.5px] font-semibold text-axal-violet hover:underline dark:text-violet-300">‹ {BACK[drawer.kind]}</Link>
          <Wait id={drawer.kind} title={DRAWER_TITLES[drawer.kind]} />
        </section>
      ) : (
        <>
          {page === 'services' && <ServicesPage />}
          {page === 'usage' && <Wait id="usage" title="Requests and AI tokens by day" />}
          {page === 'activity' && <Wait id="activity" title="Calls by day" />}
        </>
      )}
    </div>
  );
}
