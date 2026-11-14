import React from 'react';
import { Link } from 'react-router-dom';
import { planHref, ventureSearch } from './buildPlanModel';

/**
 * D4602 (#4602, BD2, BD14m B, BD16) — Build's phone tabs: Overview · Plan ·
 * Progress, each a literal link (routes, not ARIA tabs) with
 * `aria-current="page"` on the one open, 44px tall, so the Build Plan is one
 * tap from the phone overview. Each carries the selected venture
 * (`?project_id=`); Plan and Progress keep a one-claim plan's scope where the
 * address has one (`planHref`).
 *
 * BD2 also draws a Tools tab. Build › Tools is #6029's entry (BD23), which
 * waits on #5078, so it is not drawn here; the phone index's Tools row is
 * unchanged.
 */
export const BUILD_PHONE_TABS = [
  { id: 'overview', label: 'Overview', href: (search) => `/build${ventureSearch(search)}` },
  { id: 'plan', label: 'Plan', href: (search) => planHref('plan', search) },
  { id: 'progress', label: 'Progress', href: (search) => planHref('progress', search) },
];

export default function BuildPhoneNav({ active, search = '' }) {
  return (
    <nav aria-label="Build" className="-mx-1 flex gap-1 overflow-x-auto border-b border-axal-hairline dark:border-gray-700" data-testid="build-phone-tabs">
      {BUILD_PHONE_TABS.map((t) => (
        <Link key={t.id} to={t.href(search)} aria-current={t.id === active ? 'page' : undefined}
          className={`-mb-px flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-2.5 text-[13px] ${t.id === active
            ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
            : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
          data-testid={`build-phone-tab-${t.id}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
