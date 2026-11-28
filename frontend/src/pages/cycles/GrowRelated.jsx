/**
 * D4866 (#4866, GR-02, GR-10, GR-16): Grow's utility and contextual navigation.
 *
 * `GrowRelated` is the overview's "For this job" list (`growRelatedModel.js`): a labelled navigation landmark
 * whose links follow the founder's current task, Perks last and plain. Below 640px it is one link per row at
 * 44px, so a phone reads it top to bottom with no horizontal scanning; from 640px the links wrap as chips.
 *
 * `GrowReportingLink` is Reporting as a utility, outside the operating areas' tabs: one link with the
 * venture kept, `aria-current="page"` on Reporting itself. The Grow header, Distribution's header and Grow's
 * phone module pages draw it, so Reporting is one step from every Grow surface.
 */
import { Link } from 'react-router-dom';
import { reportingHref } from './growOverviewModel';
import { growRelated } from './growRelatedModel';

export const REPORTING_LINK = 'inline-flex min-h-[44px] items-center rounded-[9px] border border-axal-hairline px-3 py-2 text-[12px] font-bold text-axal-violet-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-gray-700 dark:text-violet-300';

export function GrowReportingLink({ search = '', current = false, className = REPORTING_LINK, testId = 'grow-reporting-utility' }) {
  return (
    <Link className={className} to={reportingHref(search)} aria-label="Reporting utility" aria-current={current ? 'page' : undefined} data-testid={testId}>
      Reporting
    </Link>
  );
}

export default function GrowRelated({ attention, search = '' }) {
  const { task, name, links } = growRelated(attention, search);
  return (
    <nav aria-labelledby="grow-related-title" className="order-5 flex min-w-0 flex-col gap-2" data-testid="grow-related" data-task={task}>
      <h2 id="grow-related-title" className="m-0 font-mono text-[10px] font-bold uppercase tracking-wide text-axal-muted dark:text-gray-400">
        For this job<span className="normal-case tracking-normal"> · {name}</span>
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 sm:flex-row sm:flex-wrap">
        {links.map((l) => (
          <li key={l.key} className="min-w-0">
            <Link to={l.href} data-testid={`grow-related-${l.key}`}
              className="flex min-h-[44px] w-full min-w-0 flex-wrap items-center gap-x-1.5 rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[12px] font-semibold text-axal-ink hover:border-axal-lavender-edge focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 sm:w-auto dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-violet-800">
              <span>{l.label}</span>
              {l.why ? <small className="text-[11px] font-medium text-axal-muted dark:text-gray-400">{l.why}</small> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
