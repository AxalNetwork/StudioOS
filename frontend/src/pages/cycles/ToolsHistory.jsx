import { Cell } from './CycleModulePage';

/**
 * D686 §5.4 (#1597) — Operating systems' Tools section (`id="tools"`), the
 * Build history D686 §3.2 item 2 names: every connection enabled for the
 * project's company, from the module read's `parts.tools` (S18-B, #1613).
 * Each row opens its tool in Connect a tool (`/build/connect?tool=<key>`).
 *
 * A project with no company has no Tools: the Worker says so (`not_recorded`
 * with its reason) and this prints it. Google Calendar and Microsoft 365 are
 * personal and listed only in Connect a tool; the Worker's note says so.
 */
export default function ToolsHistory({ tools }) {
  if (!tools || typeof tools !== 'object') return null;
  const cols = Array.isArray(tools.cols) ? tools.cols.filter((c) => c && c.key) : [];
  const rows = Array.isArray(tools.rows) ? tools.rows : [];
  return (
    <section id="tools" className="flex min-w-0 scroll-mt-4 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid="cycle-part-tools" aria-labelledby="tools-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id="tools-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">Tools</h2>
        {tools.state === 'ok' && Number.isSafeInteger(tools.total) && <span className="text-[11px] text-axal-faint dark:text-gray-500">{tools.total === 1 ? '1 tool' : `${tools.total} tools`}</span>}
      </div>
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
                      {cols.map((c, j) => <td key={c.key} className="px-2 py-1.5 align-top"><Cell cell={r.cells?.[c.key]} first={j === 0} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      {tools.note && <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="tools-note">{tools.note}</p>}
    </section>
  );
}
