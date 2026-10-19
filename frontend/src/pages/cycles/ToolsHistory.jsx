import { Link, useLocation } from 'react-router-dom';
import { Cell } from './CycleModulePage';
import { feedsOf, repositoriesText, syncLineView } from './codeSystem';

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
 */
export default function ToolsHistory({ tools }) {
  // A row's Open is Connect a tool over this page: `under` is where closing it returns (#1597).
  const location = useLocation();
  if (!tools || typeof tools !== 'object') return null;
  const under = { under: `${location.pathname}${location.search}` };
  const cols = Array.isArray(tools.cols) ? tools.cols.filter((c) => c && c.key) : [];
  const rows = Array.isArray(tools.rows) ? tools.rows : [];
  return (
    <section id="tools" className="flex min-w-0 scroll-mt-4 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-tools" aria-labelledby="tools-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="tools-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">Tools</h2>
        {tools.state === 'ok' && Number.isSafeInteger(tools.total) && <span className="text-[11px] text-axal-faint dark:text-gray-500">{tools.total === 1 ? '1 tool' : `${tools.total} tools`}</span>}
      </div>
      <CodeSystem code={tools.code} linkState={under} />
      {tools.state === 'not_recorded'
        ? <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="tools-not-recorded">{tools.reason || 'Not recorded'}</p>
        : rows.length === 0
          ? <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="tools-none">No tool is connected for this company yet.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead><tr>{cols.map((c) => <th key={c.key} scope="col" className="whitespace-nowrap border-b border-axal-hairline px-2 py-1.5 text-[10.5px] font-bold uppercase tracking-axal-label text-axal-muted dark:border-gray-800 dark:text-gray-400">{c.label}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id ?? i} className="border-b border-axal-ground last:border-b-0 dark:border-gray-800" data-testid={`tools-row-${i}`}>
                      {cols.map((c, j) => <td key={c.key} className="px-2 py-1.5 align-top"><Cell cell={r.cells?.[c.key]} first={j === 0} linkState={under} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      <SyncLines syncs={tools.syncs} />
      {tools.note && <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="tools-note">{tools.note}</p>}
    </section>
  );
}

const SUB = 'm-0 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
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
            <p className={LINE} data-testid="tools-code-feeds">
              Feeds: {feeds.length === 0 ? 'Nothing has arrived in this project yet' : feeds.map((f, j) => (
                <span key={f.label}>{j > 0 && ' · '}{f.href ? <Link to={f.href} className="hover:underline">{f.text}</Link> : f.text}</span>
              ))}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** D782: each GitHub sync as a line, newest first. */
function SyncLines({ syncs }) {
  if (!syncs || typeof syncs !== 'object' || syncs.state === 'not_recorded') return null;
  const rows = Array.isArray(syncs.rows) ? syncs.rows : [];
  return (
    <div className="flex flex-col gap-1.5" data-testid="tools-syncs">
      <h3 className={SUB}>Syncs</h3>
      {syncs.state === 'unreadable' || rows.length === 0
        ? <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="tools-syncs-none">{syncs.reason || 'No sync yet.'}</p>
        : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {rows.map((line, i) => {
              const v = syncLineView(line);
              return (
                <li key={line?.id ?? i} className="flex flex-col border-b border-axal-ground pb-1 last:border-b-0 dark:border-gray-800" data-testid={`tools-sync-${i}`}>
                  <span className="text-[11px] text-axal-faint dark:text-gray-500">{v.at || 'Not recorded'} · {line?.provider || 'GitHub'} · {v.state}</span>
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
