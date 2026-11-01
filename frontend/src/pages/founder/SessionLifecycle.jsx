/**
 * D1455 (#3710, `Interview Record Page.dc.html` REC1, REC2, REC6): the session
 * page's one status and its one failure panel. The words and the steps are
 * `sessionLifecycle.js`'s; this file only draws them.
 */
import { Link } from 'react-router-dom';
import { stepLine } from './sessionLifecycle.js';

const DOT = {
  done: 'border-emerald-700 bg-emerald-700 text-white dark:border-emerald-500 dark:bg-emerald-600',
  current: 'border-violet-700 bg-violet-700 text-white dark:border-violet-400 dark:bg-violet-600',
  failed: 'border-red-700 bg-red-700 text-white dark:border-red-400 dark:bg-red-600',
  todo: 'border-axal-hairline bg-white text-axal-muted dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
};
const LABEL = { done: 'text-axal-ink dark:text-gray-200', current: 'font-bold text-violet-700 dark:text-violet-300', failed: 'font-bold text-red-700 dark:text-red-300', todo: 'text-axal-muted dark:text-gray-400' };

function Steps({ view }) {
  return <ol className="m-0 flex list-none flex-col gap-2 p-0 lg:flex-row lg:gap-0" data-testid="session-steps">
    {view.steps.map((s, i) => (
      <li key={s.key} className="flex min-w-0 flex-1 items-center gap-2 lg:flex-col lg:items-start" data-step={s.key} data-state={s.state}
        aria-current={s.state === 'current' ? 'step' : undefined}>
        <div className="flex w-full items-center">
          <span className={`grid h-6 w-6 flex-none place-items-center rounded-full border text-[11px] font-bold ${DOT[s.state]}`} aria-hidden="true">
            {s.state === 'done' ? '✓' : s.state === 'failed' ? '!' : i + 1}
          </span>
          {i < view.steps.length - 1 && <span className={`mx-1 hidden h-px flex-1 lg:block ${s.state === 'done' ? 'bg-emerald-700 dark:bg-emerald-500' : 'bg-axal-hairline dark:bg-gray-700'}`} aria-hidden="true" />}
        </div>
        <span className={`text-[12px] ${LABEL[s.state]}`}>{s.label}{s.state === 'failed' ? ' · failed' : ''}</span>
      </li>
    ))}
  </ol>;
}

/** REC1: the stepper; REC6 on a phone: collapsed to "n of m · step", expandable. */
export function SessionStepper({ view }) {
  if (!view) return null;
  return <section className="rounded-2xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-950" data-testid="session-lifecycle"
    data-current={view.current || ''} data-failed={view.failed ? (view.failedAt || 'unrecorded') : ''}>
    <h2 className="sr-only">Status</h2>
    {view.unreadable && <p role="status" className="m-0 mb-2 text-[13px] font-semibold text-axal-muted dark:text-gray-400" data-testid="session-lifecycle-unreadable">Unreadable: this session’s status could not be read. That does not mean it is ready.</p>}
    <details className="lg:hidden" data-testid="session-steps-phone">
      <summary className="flex min-h-[44px] cursor-pointer items-center text-[13px] font-bold text-axal-ink dark:text-gray-100">{stepLine(view)}</summary>
      <div className="mt-2"><Steps view={view} /></div>
    </details>
    <div className="hidden lg:block"><Steps view={view} /></div>
  </section>;
}

const BTN = 'inline-flex min-h-[36px] items-center justify-center rounded-[9px] px-3.5 text-[12.5px] font-bold max-lg:min-h-[44px]';

/**
 * REC2: one panel per failure, in place of the bot card's red line and the
 * separate "Processing stopped" card. Try again runs the processing again
 * (`POST /sessions/:id/process`) for a processing failure; for a bot failure
 * it opens Record a session for the same interview, a fresh session (Q3 A:
 * the Worker refuses a second dispatch on one session, `session_in_use`).
 * "See details" holds the codes and times, for support.
 */
export function SessionFailure({ failure, details = [], onRetry, retrying = false, retryHref = null, error = null }) {
  if (!failure) return null;
  return <section role="alert" className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-[13px] dark:border-red-900 dark:bg-red-950/30" data-testid="session-failure" data-retry={failure.retry}>
    <p className="m-0 font-bold text-red-800 dark:text-red-200">{failure.title}</p>
    {failure.causes.length > 0 && <div>
      <p className="m-0 text-[12px] font-semibold text-axal-ink dark:text-gray-200">Likely causes</p>
      <ul className="m-0 mt-1 list-disc pl-5 text-axal-ink dark:text-gray-200" data-testid="session-failure-causes">{failure.causes.map((c) => <li key={c}>{c}</li>)}</ul>
    </div>}
    <div className="flex flex-wrap items-center gap-2">
      {failure.retry === 'process'
        ? <button type="button" onClick={onRetry} disabled={retrying} className={`${BTN} bg-violet-700 text-white disabled:opacity-50 dark:bg-violet-600`} data-testid="session-failure-retry">{retrying ? 'Trying again…' : 'Try again'}</button>
        : retryHref && <Link to={retryHref} className={`${BTN} bg-violet-700 text-white dark:bg-violet-600`} data-testid="session-failure-retry">Try again with a new session</Link>}
      {failure.retry === 'process' && retryHref && <Link to={retryHref} className={`${BTN} border border-axal-hairline bg-white text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100`} data-testid="session-failure-import">Import the recording or transcript instead</Link>}
    </div>
    {failure.retry !== 'process' && retryHref && <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">Record a session also takes the call’s recording or transcript, if you have it.</p>}
    {error && <p className="m-0 font-semibold text-red-700 dark:text-red-300" data-testid="session-failure-error">{error}</p>}
    {details.length > 0 && <details data-testid="session-failure-details">
      <summary className="cursor-pointer text-[12px] font-semibold text-axal-muted dark:text-gray-400">See details</summary>
      <dl className="m-0 mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11.5px] text-axal-muted dark:text-gray-400">
        {details.map(([k, v]) => <div key={k} className="contents"><dt>{k}</dt><dd className="m-0 break-all">{v}</dd></div>)}
      </dl>
    </details>}
  </section>;
}
