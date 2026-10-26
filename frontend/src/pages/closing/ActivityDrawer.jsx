/**
 * D1219 (#3216) — CP15, a closing's activity: `closing_events` (D1215),
 * append-only, newest first, filtered by step, exported as CSV from the rows
 * drawn. The log holds no amount, name or account number, so an actor is an
 * account number and a line is "a line".
 */
import { useState } from 'react';
import { Lightbox } from '../../ui';
import { BTN } from '../account/AccountCenter';
import { DESK_WAITS, STEPS, activityCsv, filterActivity } from './deskModel';

const when = (at) => (at ? String(at).replace('T', ' ').slice(0, 16) : 'Time not recorded');

export function ActivityRow({ r, big = false }) {
  return (
    <li className="flex flex-col gap-0.5 border-t border-gray-100 py-2 text-[12.5px] first:border-t-0 dark:border-gray-800" data-testid={`closing-activity-row-${r.key}`}>
      <span><b>{r.actor ? `Account #${r.actor}` : 'Account not recorded'}</b> · {r.words}</span>
      <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{when(r.at)}{r.source ? ` · ${r.source}` : ''}{big && r.step ? ` · Step ${r.step} · ${STEPS[r.step - 1]}` : ''}</span>
    </li>
  );
}

function download(text, name) {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function ActivityDrawer({ title, rows, onClose }) {
  const [step, setStep] = useState(0);
  const shown = filterActivity(rows, step);
  const pill = (n, label) => (
    <button key={n} type="button" aria-pressed={step === n} onClick={() => setStep(n)} data-testid={`closing-activity-step-${n}`}
      className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold ${step === n ? 'border-violet-500 bg-violet-50 text-violet-800 dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-200' : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}>{label}</button>
  );
  return (
    <Lightbox label="Activity" eyebrow={title} title="Activity" sub={DESK_WAITS.actor} testId="closing-activity-drawer" onClose={onClose} width={600}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by step">{pill(0, 'All')}{STEPS.map((s, i) => pill(i + 1, `${i + 1} ${s}`))}</div>
        {shown.length === 0
          ? <p className="m-0 text-[12.5px] text-gray-600 dark:text-gray-400" data-testid="closing-activity-empty">{step ? 'Nothing recorded at this step yet.' : 'Nothing recorded on this closing yet.'}</p>
          : <ul className="m-0 flex list-none flex-col p-0" data-testid="closing-activity-list">{shown.map((r) => <ActivityRow key={r.key} r={r} big />)}</ul>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-axal-hairline px-5 py-3 dark:border-gray-800">
        <span className="mr-auto text-[12px] text-gray-600 dark:text-gray-400">Append-only. Nothing here can be edited or removed.</span>
        <button type="button" className={BTN.ghost} disabled={shown.length === 0} onClick={() => download(activityCsv(shown), 'closing-activity.csv')} data-testid="closing-activity-csv">Export CSV</button>
      </div>
    </Lightbox>
  );
}
