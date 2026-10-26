import { useState } from 'react';
import { ChartTable } from '../../../ui/Charts';
import { BTN } from '../../account/AccountCenter';
import { Panel } from './parts';

/**
 * D1163 — a chart in a Panel with "View as table" (every chart has one), its
 * one-sentence summary on a `role="img"` wrapper, as NAV & performance draws
 * its charts (D1164).
 */
export function ChartBlock({ title, note, alt, table, foot, testId, children }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Panel label={title} testId={testId}
      aside={<button type="button" className={BTN.link} onClick={() => setAsTable((v) => !v)} data-testid={`${testId}-toggle`}>{asTable ? 'View as chart' : 'View as table'}</button>}>
      <div className="flex flex-col gap-2 px-4 py-3 sm:px-5">
        {note && <p className="m-0 text-[12.5px] text-zinc-700 dark:text-gray-200" data-testid={`${testId}-note`}>{note}</p>}
        {asTable
          ? <div data-testid={`${testId}-table`}><ChartTable chart={{ table }} caption={title} /></div>
          : <div role="img" aria-label={alt}>{children}</div>}
        {foot && <p className="m-0 text-[11.5px] text-axal-muted dark:text-gray-400">{foot}</p>}
      </div>
    </Panel>
  );
}
