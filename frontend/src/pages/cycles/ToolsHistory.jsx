import { Link, useLocation } from 'react-router-dom';
import { Cell } from './CycleModulePage';
import { accountOnlyText, bindingView, feedsOf, repositoriesText, syncLineView } from './codeSystem';
import { usePhoneWidth } from '../../ui/phone/usePhoneWidth.js';
import { cellView } from './cycleModel';

/**
 * D686 §5.4 (#1597) — Operating systems' Tools section (`id="tools"`), the
 * Build history D686 §3.2 item 2 names: every connection enabled for the
 * project's company, from the module read's `parts.tools` (S18-B, #1613).
 * Each row opens its tool in Connect a tool (`/build/connect?tool=<key>`).
 *
 * A project with no company has no Tools: the Worker says so (`not_recorded`
 * with its reason) and this prints it. Google Calendar and Microsoft 365 are
 * personal and listed only in Connect a tool; the Worker's note says so.
 *
 * D782 (#2113): above the table, GitHub as the Code system (`tools.code`):
 * its repositories, last sync and what it fed, labelled as coming from the
 * connection. Below it, each sync as a line (`tools.syncs`).
 *
 * D5078 (#5078, Build v2 BD12): every tool that feeds Build, connected or not.
 * The Worker sends each row's action by its state (Manage, Reconnect for its
 * owner only, Connect) and why it is not connected (`reason`), and the tools
 * the company has not connected (`not_connected`) with what each would feed.
 * The sync lines are every tool's, the latest 20, and the heading says so. On a
 * phone (`phone`, or the phone width) each tool is a card, never a table
 * scrolled sideways.
 *
 * D8774 (#8774): each Code system also says what it is to THIS venture
 * (`binding`): its state word, the last successful read of the venture (date,
 * source, repositories), Stale with its age, and what will feed after a sync.
 * Its counts are headed "Feeds" only while every scope holds, else "Arrived
 * earlier". With no GitHub on for the company, the viewer's own account
 * connection is named as account-only (`tools.code.account`).
 */
export default function ToolsHistory({ tools, phone: phoneProp }) {
  // A row's action is Connect a tool over this page: `under` is where closing it returns (#1597).
  const location = useLocation();
  const phoneWidth = usePhoneWidth();
  const phone = phoneProp ?? phoneWidth;
  if (!tools || typeof tools !== 'object') return null;
  const under = { under: `${location.pathname}${location.search}` };
  const cols = Array.isArray(tools.cols) ? tools.cols.filter((c) => c && c.key) : [];
  const connected = Array.isArray(tools.rows) ? tools.rows : [];
  const missing = Array.isArray(tools.not_connected) ? tools.not_connected : [];
  const rows = [...connected, ...missing];
  return (
    <section id="tools" className="flex min-w-0 scroll-mt-4 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-tools" aria-labelledby="tools-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="tools-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">Tools</h2>
        {tools.state === 'ok' && Number.isSafeInteger(tools.total) && <span className="text-[11px] text-axal-faint dark:text-gray-500" data-testid="tools-count">{tools.total === 1 ? '1 tool connected' : `${tools.total} tools connected`}{missing.length ? ` · ${missing.length} not connected` : ''}</span>}
      </div>
      <CodeSystem code={tools.code} linkState={under} />
      {accountOnlyText(tools.code) && <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="tools-code-account">{accountOnlyText(tools.code)}</p>}
      {tools.state === 'not_recorded'
        ? <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="tools-not-recorded">{tools.reason || 'Not recorded'}</p>
        : (
          <>
            {connected.length === 0 && <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="tools-none">No tool is connected for this company yet.</p>}
            {rows.length > 0 && (phone ? <ToolCards cols={cols} rows={rows} linkState={under} /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead><tr>{cols.map((c) => <th key={c.key} scope="col" className="whitespace-nowrap border-b border-axal-hairline px-2 py-1.5 text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:border-gray-800 dark:text-gray-400">{c.label}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.id ?? i} className={`border-b border-axal-ground last:border-b-0 dark:border-gray-800 ${r.keys?.state === 'failing' ? 'bg-red-50/60 dark:bg-red-950/20' : ''}`.trim()} data-testid={`tools-row-${i}`} data-state={r.keys?.state}>
                        {cols.map((c, j) => <td key={c.key} className="px-2 py-1.5 align-top"><Cell cell={r.cells?.[c.key]} first={j === 0} linkState={under} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </>
        )}
      <SyncLines syncs={tools.syncs} />
      {tools.note && <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="tools-note">{tools.note}</p>}
    </section>
  );
}

const SUB = 'm-0 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';

/** D5078 (BD12 on a phone): one card per tool, its action a full-width target of at least 44px. */
function ToolCards({ cols, rows, linkState }) {
  const label = (key) => cols.find((c) => c.key === key)?.label || key;
  const facts = ['category', 'feeds', 'last_sync', 'failed_at', 'owner', 'reason'];
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="tools-cards">
      {rows.map((r, i) => {
        const action = cellView(r.cells?.action);
        return (
          <li key={r.id ?? i} className={`flex min-w-0 flex-col gap-1.5 rounded-lg border px-3 py-2.5 ${r.keys?.state === 'failing' ? 'border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20' : 'border-axal-hairline dark:border-gray-800'}`} data-testid={`tools-card-${i}`} data-state={r.keys?.state}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <b className="text-[13.5px] text-axal-ink dark:text-gray-100"><Cell cell={r.cells?.tool} plain first /></b>
              <span className="text-[12px]"><Cell cell={r.cells?.state} plain /></span>
            </div>
            <dl className="m-0 grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[12px]">
              {facts.filter((k) => r.cells?.[k] != null && r.cells[k] !== '').map((k) => (
                <div key={k} className="contents"><dt className="text-axal-muted dark:text-gray-400">{label(k)}</dt><dd className="m-0 min-w-0 break-words"><Cell cell={r.cells[k]} linkState={linkState} /></dd></div>
              ))}
            </dl>
            {action.href && (
              <Link to={action.href} state={linkState} data-testid={`tools-card-action-${i}`}
                className="flex min-h-[44px] items-center justify-center rounded-[10px] border border-axal-hairline bg-white px-3 text-[13px] font-bold text-axal-violet-deep hover:bg-axal-lavender dark:border-gray-700 dark:bg-gray-900 dark:text-violet-300 dark:hover:bg-violet-900/30">{action.text}</Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
const LINE = 'm-0 text-[12px] text-axal-ink/80 dark:text-gray-300';

/** D782: GitHub as the Code system, one block per connection. Nothing when the read carries no `code`. */
function CodeSystem({ code, linkState }) {
  if (!code || typeof code !== 'object' || code.state === 'not_recorded') return null;
  const systems = Array.isArray(code.systems) ? code.systems : [];
  if (!systems.length) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="tools-code">
      <h3 className={SUB}>Code system</h3>
      {systems.map((sys, i) => {
        const feeds = feedsOf(sys);
        const bound = bindingView(sys);
        const open = sys.action && typeof sys.action.href === 'string' && sys.action.href.startsWith('/') ? sys.action : null;
        return (
          <div key={i} className="flex flex-col gap-1 rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800" data-testid={`tools-code-${i}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100">{sys.system || 'Code'} · {sys.provider || 'GitHub'} · {sys.state || 'Not recorded'}</p>
              {open && <Link to={open.href} state={linkState} className="text-[12px] font-bold text-axal-violet hover:underline dark:text-violet-300">{open.text || 'Open'}</Link>}
            </div>
            {sys.source_label && <p className="m-0 text-[11px] text-axal-faint dark:text-gray-500" data-testid="tools-code-source">{sys.source_label}{sys.owner ? ` · ${sys.owner}` : ''}</p>}
            <p className={LINE} data-testid="tools-code-repositories">Repositories: {repositoriesText(sys)}</p>
            <p className={LINE}>Last sync: {sys.last_sync || 'Not yet'}{sys.failed_at ? ` · failed at ${sys.failed_at}` : ''}</p>
            {bound && (
              <div className="flex flex-col gap-0.5" data-testid="tools-code-binding" data-binding={bound.state}>
                <p className={LINE}><b data-testid="tools-code-binding-word">{bound.word}</b>{bound.reason ? ` · ${bound.reason}` : ''}</p>
                <p className={LINE} data-testid="tools-code-last-read">{bound.lastRead}</p>
                {bound.stale && <p className="m-0 text-[12px] text-amber-800 dark:text-amber-300" data-testid="tools-code-stale">{bound.stale}</p>}
                {bound.after && <p className={LINE} data-testid="tools-code-after">{bound.after}</p>}
              </div>
            )}
            {sys.reason && <p className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="tools-code-reason">{sys.reason}</p>}
            <p className={LINE} data-testid="tools-code-feeds">
              {bound ? bound.feedsHeading : 'Feeds'}: {feeds.length === 0 ? 'Nothing has arrived in this project yet' : feeds.map((f, j) => (
                <span key={f.label}>{j > 0 && ' · '}{f.href ? <Link to={f.href} className="hover:underline">{f.text}</Link> : f.text}</span>
              ))}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** D782: each sync as a line, newest first. D5078: every tool's, and the heading says how many it keeps. */
function SyncLines({ syncs }) {
  if (!syncs || typeof syncs !== 'object' || syncs.state === 'not_recorded') return null;
  const rows = Array.isArray(syncs.rows) ? syncs.rows : [];
  return (
    <div className="flex flex-col gap-1.5" data-testid="tools-syncs">
      <h3 className={SUB} data-testid="tools-syncs-title">{syncs.label ? `Sync history · ${String(syncs.label).toLowerCase()}` : 'Sync history'}</h3>
      {syncs.state === 'unreadable' || rows.length === 0
        ? <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="tools-syncs-none">{syncs.reason || 'No sync yet.'}</p>
        : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {rows.map((line, i) => {
              const v = syncLineView(line);
              return (
                <li key={line?.id ?? i} className="flex flex-col border-b border-axal-ground pb-1 last:border-b-0 dark:border-gray-800" data-testid={`tools-sync-${i}`}>
                  <span className="text-[11px] text-axal-faint dark:text-gray-500">{v.at || 'Not recorded'} · {line?.provider || 'Unknown tool'} · {v.state}</span>
                  <span className={v.failed ? 'text-[12px] text-red-700 dark:text-red-300' : LINE}>{v.text}</span>
                  {v.repositories && <span className="text-[11px] text-axal-muted dark:text-gray-400">{v.repositories}</span>}
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
