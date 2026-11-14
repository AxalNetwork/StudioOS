// D6078 (CRL16a): the Capital relationships actions in the founder's More menu.
import { useRef } from 'react';
import { exportView } from '../../../lib/csvExport.js';

export default function CapRelExportMenu({ zone, csv, onOther, otherLabel, otherTestId, buttonClass }) {
  const details = useRef(null);
  const trigger = useRef(null);
  function run(action) {
    details.current.open = false;
    trigger.current.focus();
    action();
  }

  return (
    <details ref={details} className="relative">
      <summary ref={trigger} aria-label="More" className={`${buttonClass} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>⋯</summary>
      <div className="absolute right-0 z-20 mt-1 flex min-w-max flex-col gap-1 rounded-lg border border-axal-hairline bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
        <button type="button" className={buttonClass} onClick={() => run(onOther)} data-testid={otherTestId}>{otherLabel}</button>
        <button type="button" className={buttonClass} disabled={!csv?.rows.length} data-testid={`caprel-${zone}-export`}
          onClick={() => run(() => exportView({ scope: 'capital-relationships', zone, ...csv }))}>Export this view</button>
      </div>
    </details>
  );
}
