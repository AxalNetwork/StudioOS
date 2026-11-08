// D4665 (#4665) — a send whose outcome the mail server left unknown. The member looks in their Sent folder
// and says which; until they do, nothing else is sent from this composer.
import { BODY, BTN, EYEBROW, MUTED } from './emailParts.jsx';
import { UNSURE_LINE } from './sendOperation.js';

export default function SendUncertain({ busy, onArrived, onNotArrived, testId }) {
  return (
    <div className="flex flex-col gap-2 rounded-axal-md border border-amber-300 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950/30" role="alert" data-testid={testId}>
      <span className={EYEBROW}>Not confirmed</span>
      <p className={`text-[13px] ${BODY}`}>{UNSURE_LINE}</p>
      <p className={`text-[12px] ${MUTED}`}>Sending again before you know could deliver it twice.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN} disabled={busy} onClick={onArrived} data-testid={`${testId}-arrived`}>It arrived</button>
        <button type="button" className={BTN} disabled={busy} onClick={onNotArrived} data-testid={`${testId}-not-arrived`}>It did not arrive</button>
      </div>
    </div>
  );
}
