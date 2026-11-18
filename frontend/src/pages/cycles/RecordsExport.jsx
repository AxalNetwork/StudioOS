// D6043 (#6043) — Export: the records list as a CSV file, beside the table's Add, from the 'few' stage on.
import { useState } from 'react';

/**
 * `onExport()` returns a promise; while it runs the button says so, and a
 * refusal (the Worker's 413 past its row cap, a 403) is its own sentence
 * under the button, never a file holding the error.
 */
export default function RecordsExport({ onExport, phone = false }) {
  const [state, setState] = useState({ busy: false, error: '' });
  const run = async () => {
    setState({ busy: true, error: '' });
    try { await onExport(); setState((s) => ({ ...s, busy: false })); }
    catch (e) { setState({ busy: false, error: e?.message || 'Export failed. Try again.' }); }
  };
  const className = phone
    ? 'inline-flex min-h-[44px] w-full items-center justify-center rounded-[10px] border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800'
    : 'whitespace-nowrap rounded-[9px] border border-axal-hairline bg-white px-3.5 py-2 text-[12.5px] font-semibold text-axal-ink hover:bg-axal-ground disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
  return (
    <span className={phone ? 'flex flex-col gap-1.5' : 'inline-flex flex-col items-end gap-1'}>
      <button type="button" onClick={run} disabled={state.busy} aria-busy={state.busy || undefined} className={className} data-testid="records-export">
        {state.busy ? 'Exporting…' : 'Export CSV'}
      </button>
      {state.error && <span role="alert" className="max-w-[40ch] text-[12px] text-red-700 dark:text-red-300" data-testid="records-export-error">{state.error}</span>}
    </span>
  );
}
