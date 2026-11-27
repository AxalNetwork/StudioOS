import React from 'react';
import { AlertTriangle, RefreshCcw, LifeBuoy } from 'lucide-react';

/**
 * Task #3 (IC) — Inline error state for failed fetches. Replaces the
 * `console.error → generic toast` anti-pattern: pages call this from
 * their catch block with the failure message + a retry handler, and the
 * user sees an inline panel with retry + a support deep-link rather
 * than a transient toast that disappears.
 *
 *   <ErrorState
 *     message="Couldn't load projects (404)"
 *     onRetry={load}
 *     supportTopic="projects"
 *   />
 *
 * `supportTopic` is appended to the support contact URL so the support
 * channel can pre-categorise the report. Hit target is ≥44×44px and
 * the live region is `assertive` so SRs announce the failure.
 */
export default function ErrorState({
  message,
  onRetry,
  supportTopic,
  className = '',
  'data-testid': testId,
}) {
  const supportHref = supportTopic
    ? `/support?topic=${encodeURIComponent(supportTopic)}`
    : '/support';
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid={testId || 'error-state'}
      className={`flex flex-col items-center justify-center text-center border border-red-200 dark:border-red-900/50 rounded-xl bg-red-50/70 dark:bg-red-950/30 py-10 px-5 ${className}`}
    >
      <div className="mb-3 inline-flex items-center justify-center w-11 h-11 rounded-full bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-300">
        <AlertTriangle size={20} aria-hidden="true" />
      </div>
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1.5">
        Something went wrong
      </h2>
      <p className="text-sm text-gray-700 dark:text-gray-300 max-w-md mb-5 leading-relaxed">
        {message || 'We couldn\'t complete that request. Try again, or reach out to support if the problem persists.'}
      </p>
      <div className="flex flex-col sm:flex-row items-center gap-2.5">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:bg-gray-800 dark:hover:bg-white transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
          >
            <RefreshCcw size={15} aria-hidden="true" />
            Try again
          </button>
        )}
        <a
          href={supportHref}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
        >
          <LifeBuoy size={15} aria-hidden="true" />
          Contact support
        </a>
      </div>
    </div>
  );
}
