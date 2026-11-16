import { Link } from 'react-router-dom';
import { dueChips, openLine, rangeLine, toggleDue } from './durableModel.js';

/**
 * D6122 (#6122, GR-21, GR-27a) — Grow › Company's due strip, above the obligations: Overdue,
 * Next 30 days, Next 90 days and Later, each a toggle button (aria-pressed) that filters the
 * table by `due_window`, with its count from the read (`parts.due_counts`, over every
 * obligation whatever the filter). Overdue carries its word and a glyph, never colour alone.
 * Under it, the second editor of the same rows: Calendar → Compliance.
 *
 * A read without counts draws no strip, never four zeros.
 */
const CHIP = 'flex min-h-[44px] min-w-0 flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors';
const IDLE = 'border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const ON = 'border-violet-500 bg-violet-50 text-violet-900 dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-100';
const ALARM = 'border-red-200 bg-red-50 text-red-900 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100 dark:hover:bg-red-950/60';

export default function DurableDueStrip({ counts, on, query, onQuery, search = '' }) {
  const active = query?.filter?.due_window || '';
  const chips = dueChips(counts, active);
  const range = rangeLine(on);
  const line = openLine(counts);
  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-testid="grow-company-due">
      {range && <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="grow-company-range">{range}</p>}
      {chips && (
        <div role="group" aria-label="Due" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {chips.map((c) => (
            <button key={c.key} type="button" aria-pressed={c.pressed}
              className={`${CHIP} ${c.pressed ? ON : c.alarm ? ALARM : IDLE}`}
              onClick={() => onQuery?.(toggleDue(query, c.key))} data-testid={`grow-company-due-${c.key}`}>
              <b className="text-[18px] font-extrabold leading-none tracking-[-.02em]">{c.count}</b>
              <span className="text-[12px] font-semibold">{c.alarm ? '⚠ ' : ''}{c.label}</span>
            </button>
          ))}
        </div>
      )}
      {line && <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="grow-company-open">{line}</p>}
      <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400" data-testid="grow-company-second-editor">
        These obligations are also edited in{' '}
        <Link to={`/calendar${search ? `${search}&` : '?'}layer=compliance`} className="font-semibold text-violet-700 hover:underline dark:text-violet-300">Calendar → Compliance</Link>.
        {' '}Both write the same records.
      </p>
    </div>
  );
}
