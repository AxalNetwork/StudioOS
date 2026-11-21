/**
 * D6208 (#6208, canvas PF-01 header "Export ▾", PF-09 "Export failure"): the
 * Portfolio header's Export, over rows the page already holds.
 *
 * Each choice is `{ key, label, zone, plan }`, where `plan` is a model
 * builder's answer (`companyExportOf`, `quarterExportOf`, `cohortExportOf`):
 * `{ header, rows }` to write, or `{ reason }` when there is nothing loaded.
 * A choice with a reason is disabled and says why, on hover and to a screen
 * reader; it never writes a header-only file. The file is written by
 * `exportView` (`lib/csvExport.js`) and nothing else, so its escaping and
 * name are every other zone export's.
 *
 * One choice is a plain button; more open a short menu. When the browser
 * refuses the file, the control says "Export failed. Nothing was downloaded."
 * with Try again, as PF-09 draws it, and never claims a download that did not
 * happen.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, CircleAlert, Download } from 'lucide-react';
import { exportView } from '../../lib/csvExport';

/** Write one plan. True only when the browser was handed the file. */
export function runExport(choice) {
  const plan = choice?.plan;
  if (!plan || plan.reason || !Array.isArray(plan.rows) || plan.rows.length === 0) return false;
  try {
    return exportView({ scope: 'portfolio', zone: choice.zone, header: plan.header, rows: plan.rows }) === true;
  } catch {
    return false;
  }
}

export default function PortfolioExport({ choices, testid = 'button-portfolio-export' }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(null);
  const box = useRef(null);
  const id = useId();
  const menu = choices.length > 1;

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const away = (e) => { if (box.current && typeof box.current.contains === 'function' && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const run = (choice) => {
    setOpen(false);
    setFailed(runExport(choice) ? null : choice.key);
  };
  // Try again writes what the page holds now, not what it held when it failed.
  const failedChoice = failed ? choices.find((c) => c.key === failed) || null : null;

  const item = (choice, cls) => {
    const reason = choice.plan?.reason || null;
    const why = `${id}-${choice.key}-why`;
    return (
      <span key={choice.key} className="pf-export-item">
        <button
          type="button"
          className={cls}
          role={menu ? 'menuitem' : undefined}
          disabled={Boolean(reason)}
          title={reason || undefined}
          aria-describedby={reason ? why : undefined}
          onClick={() => run(choice)}
          data-testid={menu ? `${testid}-${choice.key}` : testid}
        >
          {menu ? null : <Download size={13} aria-hidden="true" />}{choice.label}
        </button>
        {reason ? <span id={why} className="pf-sr" data-testid={`${menu ? `${testid}-${choice.key}` : testid}-reason`}>{reason}</span> : null}
      </span>
    );
  };

  return (
    <div className="pf-export" ref={box} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      {menu ? (
        <>
          <button type="button" className="pf-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={`${id}-menu`} onClick={() => setOpen((v) => !v)} data-testid={testid}>
            <Download size={13} aria-hidden="true" />Export <ChevronDown size={13} aria-hidden="true" />
          </button>
          {open ? (
            <div className="pf-export-menu" role="menu" id={`${id}-menu`} aria-label="Export" data-testid={`${testid}-menu`}>
              {choices.map((c) => item(c, 'pf-export-choice'))}
            </div>
          ) : null}
        </>
      ) : item(choices[0], 'pf-btn')}
      {failedChoice ? (
        <div className="pf-failure pf-export-failed" role="alert" data-testid={`${testid}-failed`}>
          <CircleAlert size={14} aria-hidden="true" />
          <span><b>Export failed.</b> Nothing was downloaded{menu ? ` (${failedChoice.label.toLowerCase()})` : ''}.</span>
          <button type="button" onClick={() => run(failedChoice)} data-testid={`${testid}-retry`}>Try again</button>
        </div>
      ) : null}
    </div>
  );
}
