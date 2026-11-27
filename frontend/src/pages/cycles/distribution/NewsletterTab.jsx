/**
 * D4495 (#4495, DS6, MK6b): Distribution's Newsletter tab in its not-connected state, the only state
 * there is until the Beehiiv connector (#2407, owner answer G) exists. It makes no API call: no lists,
 * no editor and no subscribers are drawn, so none can be invented. Axal's own house newsletter (D810,
 * `/api/newsletter`) is never used for a founder.
 */
import React from 'react';
import { useDistributionLayout } from './useDistributionLayout.js';

export const NEWSLETTER_COPY = Object.freeze({
  title: 'Connect Beehiiv to send your newsletter.',
  body: 'Your subscribers stay in your Beehiiv account.',
  connect: 'Connect Beehiiv',
  reason: 'Not offered yet',
  results: 'Results',
  resultsFooter: 'Recorded after the first send.',
});
/** DS6's three results, each Not recorded until the provider reports a send. Never a 0. */
export const NEWSLETTER_METRICS = Object.freeze(['Opens', 'Clicks', 'Unsubscribes']);

export default function NewsletterTab() {
  const { phone, tablet } = useDistributionLayout();
  return (
    <div className={`grid min-w-0 gap-4 ${phone || tablet ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_300px]'}`} data-testid="distribution-newsletter">
      <section className="ds-card min-w-0 dark:border-gray-700 dark:bg-gray-900" aria-labelledby="newsletter-connect-title" data-testid="newsletter-not-connected">
        <h2 id="newsletter-connect-title" className="text-base font-bold dark:text-gray-100">{NEWSLETTER_COPY.title}</h2>
        <p className="mt-1 text-sm text-axal-muted dark:text-gray-400">{NEWSLETTER_COPY.body}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="ds-primary min-h-[44px] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-600" disabled aria-describedby="newsletter-connect-reason" data-testid="newsletter-connect">{NEWSLETTER_COPY.connect}</button>
          <span id="newsletter-connect-reason" className="text-sm text-axal-muted dark:text-gray-400" data-testid="newsletter-connect-reason">{NEWSLETTER_COPY.reason}</span>
        </div>
      </section>
      <section className="ds-card min-w-0 dark:border-gray-700 dark:bg-gray-900" aria-labelledby="newsletter-results-title" data-testid="newsletter-results">
        <h2 id="newsletter-results-title" className="text-base font-bold dark:text-gray-100">{NEWSLETTER_COPY.results}</h2>
        <dl className="mt-3 grid grid-cols-3 gap-3">
          {NEWSLETTER_METRICS.map((label) => (
            <div key={label} className="min-w-0" data-testid={`newsletter-metric-${label.toLowerCase()}`}>
              <dt className="text-xs text-axal-muted dark:text-gray-400">{label}</dt>
              <dd className="ds-not-recorded m-0 mt-1 dark:text-gray-400">Not recorded</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-axal-muted dark:text-gray-400">{NEWSLETTER_COPY.resultsFooter}</p>
      </section>
    </div>
  );
}
