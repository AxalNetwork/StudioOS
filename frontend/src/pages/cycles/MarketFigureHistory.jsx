/**
 * D6011 (#6011) — Market intelligence's History part, under the chart: every
 * change to the total, serviceable and obtainable market, newest first, with
 * its value, source, who set it and when. It reads nothing: the rows are the
 * module read's `parts.market_history` (`services/marketFigures.ts`).
 *
 * Absent (an older read, or records that could not be read) draws nothing;
 * null is a History that could not be read and says so; an empty list says
 * no change has been recorded yet, since figures saved before D6011 have none.
 */
import { usdShort } from './adapters/validate.js';

const FIGURE_NAME = { tam: 'Total addressable', sam: 'Serviceable', som: 'Obtainable' };
const METHOD_NAME = { typed: 'Typed', top_down: 'Top-down', bottom_up: 'Bottom-up', document: 'From a document' };

/** One History row in words. Pure, so the test reads it without a DOM. */
export function historyLine(r) {
  const figure = FIGURE_NAME[r?.figure] || 'Figure';
  const value = typeof r?.value === 'number' && Number.isFinite(r.value) ? usdShort(r.value) : 'Cleared';
  const how = METHOD_NAME[r?.method] || 'Not recorded';
  const source = typeof r?.source_title === 'string' && r.source_title.trim() ? r.source_title.trim() : 'No source named';
  const who = typeof r?.set_by_name === 'string' && r.set_by_name.trim() ? r.set_by_name.trim() : 'Not recorded';
  const when = typeof r?.set_at === 'string' && r.set_at ? r.set_at.slice(0, 10) : 'Not recorded';
  return { figure, value, how, source, sourceUrl: /^https?:\/\//i.test(String(r?.source_url || '')) ? r.source_url : null, who, when };
}

export default function MarketFigureHistory({ part }) {
  if (part === undefined) return null;
  return (
    <section className="mt-4" aria-labelledby="market-history-title" data-testid="market-history">
      <h3 id="market-history-title" className="m-0 mb-2 text-[13px] font-bold text-axal-ink dark:text-gray-100">History</h3>
      {part === null ? (
        <p role="alert" className="m-0 text-[12.5px] text-red-700 dark:text-red-400" data-testid="market-history-unreadable">
          Unreadable: the history of these figures could not be read just now.
        </p>
      ) : !Array.isArray(part?.rows) || part.rows.length === 0 ? (
        <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="market-history-empty">
          No change recorded yet. A figure saved before sources were kept has no history.
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {part.rows.map((r) => {
            const l = historyLine(r);
            return (
              <li key={r.id} className="border-t border-axal-hairline py-2 text-[12.5px] dark:border-gray-800" data-testid="market-history-row">
                <div className="font-semibold text-axal-ink dark:text-gray-100">{l.figure} · {l.value}</div>
                <div className="text-axal-muted dark:text-gray-400">
                  {r.sizing_version != null ? `Version ${r.sizing_version} · ` : ''}{l.how} · {l.sourceUrl
                    ? <a href={l.sourceUrl} target="_blank" rel="noreferrer noopener" className="underline">{l.source}</a>
                    : l.source} · {l.who} · {l.when}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
