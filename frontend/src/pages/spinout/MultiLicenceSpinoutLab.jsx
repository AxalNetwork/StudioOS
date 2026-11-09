/**
 * D4474 (#4474, part 3 of #3704) — `/spinout-lab` FOR A MEMBER WHO HOLDS MORE THAN ONE LICENCE.
 *
 * Spin-Out Lab is shared, so the sidebar lists it once (D4473). Today one
 * path serves two pages: the founder Lab (`SpinoutLabPage`) to a Founder, an
 * Advisor and an Operating Partner, and the Fund I sales page
 * (`SpinoutLabInvestorPage`) to an Investor. This page draws each as a block,
 * in licence order (`spinoutBlocks`):
 *
 *   - THE LAB BLOCK, once, when Founder, Advisor or Operating Partner is held,
 *     titled with the licences it serves ("Founder", "Advisor · Operating
 *     Partner"), at the place of the first of them;
 *   - THE INVESTOR BLOCK when Investor is held.
 *
 * `SpinoutLabPage` reads founder-scoped Lab state on mount, so it is mounted
 * only inside the Lab block: a member without a Lab licence never fires that
 * request. Both pages stay lazy, so neither chunk is fetched for a member who
 * has no block for it. Each block has its own boundary and loading state
 * (`../studio/LicenceBlocks`). No block header switches licence (#3704, rules
 * 1 and 6), and the page adds no AIRail.
 *
 * WITH ONE HELD LICENCE it is exactly today's page, with no block chrome.
 */
import React, { lazy } from 'react';
import { orderedLicences } from '../../lib/licenceSidebar.js';
import { spinoutBlocks } from '../../lib/multiLicencePages.js';
import LicenceBlocks from '../studio/LicenceBlocks';

/** The two pages a block can draw. A test hands in its own. */
export const SPINOUT_PAGES = Object.freeze({
  lab: lazy(() => import('../SpinoutLabPage')),
  investor: lazy(() => import('../SpinoutLabInvestorPage')),
});

export default function MultiLicenceSpinoutLab({ licences, activeRole, pages = SPINOUT_PAGES }) {
  const held = orderedLicences(licences, activeRole);
  if (held.length < 2) {
    // Today's page, as the route drew it for one role.
    const Page = held[0] === 'investor' ? pages.investor : pages.lab;
    return <Page />;
  }
  const render = (block) => {
    const Page = pages[block.key];
    return <Page />;
  };
  return (
    <div className="space-y-6" data-testid="multi-licence-spinout-lab">
      <LicenceBlocks blocks={spinoutBlocks(held)} render={render} testId="multi-licence-spinout-lab-blocks" />
    </div>
  );
}
