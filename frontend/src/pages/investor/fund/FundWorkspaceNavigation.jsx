import React from 'react';
import { useLocation } from 'react-router-dom';

export const FUND_SECTION_HASHES = [
  '#overview', '#my-commitment', '#documents', '#reports', '#fund', '#apply',
  '#my-notices', '#subscription-booklet',
];

/**
 * `onboardingFirst` (D6130 part 2): an applicant's links put Apply and
 * onboarding before Fund and terms, in the order the page draws the sections.
 */
export default function FundWorkspaceNavigation({ hasPosition, showReports, onboardingFirst = false }) {
  const { hash } = useLocation();
  const fund = ['#fund', 'Fund and terms'];
  const apply = ['#apply', 'Apply and onboarding'];
  const links = [
    ['#overview', 'Overview'],
    ...(hasPosition ? [['#my-commitment', 'My commitment'], ['#documents', 'Documents']] : []),
    ...(onboardingFirst ? [apply] : []),
    ...(showReports && !onboardingFirst ? [['#reports', 'Reports']] : []),
    fund,
    ...(showReports && onboardingFirst ? [['#reports', 'Reports']] : []),
    ...(onboardingFirst ? [] : [apply]),
  ];

  return (
    <nav aria-label="Fund workspace sections" className="flex max-w-full flex-wrap gap-2 border-b border-gray-200 pb-3 dark:border-gray-800">
      {links.map(([href, label]) => (
        <a
          key={href}
          href={href}
          aria-current={(hash || '#overview') === href ? 'location' : undefined}
          className="rounded-full border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-600 aria-[current=location]:border-violet-600 aria-[current=location]:text-violet-700 dark:border-gray-700 dark:text-gray-200 dark:aria-[current=location]:text-violet-300"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
