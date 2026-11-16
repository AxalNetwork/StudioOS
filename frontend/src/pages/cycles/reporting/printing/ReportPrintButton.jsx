/** Print the reader's frozen sent report through the native PDF dialog (#6094). */
import React, { useState } from 'react';
import { printReport } from './reportPrint.js';

export default function ReportPrintButton({ report, company, reader = report?.view !== 'team', className }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  if (report?.status !== 'sent' || !report.sent_at) return null;
  const run = async () => {
    setBusy(true); setError(false);
    try { await printReport(report, { company, reader }); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" className={className} disabled={busy} onClick={run} data-testid="report-print">
      {busy ? 'Preparing print…' : 'Print or save as PDF'}
    </button>
    {error ? <p role="alert" className="text-[12.5px] text-amber-800 dark:text-amber-200">The print copy could not be prepared. Your sent report is unchanged. Try again.</p> : null}
  </>;
}
