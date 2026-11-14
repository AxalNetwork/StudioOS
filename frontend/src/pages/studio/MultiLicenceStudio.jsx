/**
 * D4474 (#4474, part 3 of #3704) — `/studio` FOR A MEMBER WHO HOLDS MORE THAN ONE LICENCE.
 *
 * Studio is shared by every licence, so the sidebar lists it once (D4473).
 * This page draws one block per held licence, in licence order Founder,
 * Investor, Advisor, Operating Partner, titled with the licence's name. Each
 * block lazy-loads that licence's existing Studio home (`../StudioHomesLazy`,
 * #4622), unforked, with `embedded`: the home then leaves out only the chrome
 * that assumes it owns the page (its "Studio" h1, the founder's phone bar).
 * The page's own h1 is "Studio".
 *
 * There is no licence switcher and no "active" licence here (#3704, rules 1
 * and 6). Each block has its own boundary and loading state (`LicenceBlocks`),
 * so one licence's failure never blanks the others. No block mounts an
 * AIRail: the page keeps the one rail the shell draws for `/studio`.
 *
 * WITH ONE HELD LICENCE it is `Dashboard`, exactly as today, with no block
 * chrome. `App.jsx` routes here only when two or more are held and the
 * session is the member's own: an admin, a "View as" preview, an
 * impersonation and an exploring account keep `Dashboard`.
 *
 * THE READS. Each home reads its own sources (#4622). The Investor home is
 * also handed the dashboard summary and the deal lifecycle, which `Dashboard`
 * reads for it on a single-licence Studio; here they are read once, only when
 * Investor is held, through the same client methods. The summary is asked for
 * with the investor lens (`?licence=investor`, D4623 part 2), so a held
 * Investor licence that is not the primary one gets the investor figures the
 * Worker computes for a primary investor. A figure the summary
 * does not carry is drawn by the home as "Not recorded", never 0. A summary
 * read that fails is said in fixed words, never the error's message.
 */
import React, { lazy, useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { orderedLicences } from '../../lib/licenceSidebar.js';
import { studioBlocks } from '../../lib/multiLicencePages.js';
import { FounderStudioHome, InvestorStudioHome, AdvisorStudioHome, PartnerStudioHome } from '../StudioHomesLazy';
import ProductTour from '../../components/ProductTour';
import ProductTestingStudio from '../testing/member/ProductTestingStudioLazy';
import MyTasks from '../work/MyTasks.jsx';
import LicenceBlocks from './LicenceBlocks';

const Dashboard = lazy(() => import('../Dashboard'));

/** The fixed words for a dashboard summary that could not be read. */
export const SUMMARY_UNREADABLE = 'The deal-flow summary could not be read. The other Investor Studio sources are below.';

/** Each licence's home. A test hands in its own. */
export const STUDIO_HOMES = Object.freeze({
  founder: FounderStudioHome,
  investor: InvestorStudioHome,
  advisor: AdvisorStudioHome,
  partner: PartnerStudioHome,
});

/**
 * The dashboard summary and deal lifecycle for the Investor block: `undefined`
 * while they load, `null` when the read failed, the payload when it answered.
 */
function useInvestorContext(enabled) {
  const [dashboard, setDashboard] = useState(undefined);
  const [lifecycle, setLifecycle] = useState(undefined);
  const readDashboard = useCallback(() => {
    setDashboard(undefined);
    // D4623 part 2: the investor lens, so a held Investor licence that is not the primary one gets its own figures.
    api.getDashboard(false, 'investor')
      .then((d) => setDashboard(d || null))
      .catch((e) => { reportError('MultiLicenceStudio:dashboard', e); setDashboard(null); });
  }, []);
  const readLifecycle = useCallback(() => {
    setLifecycle(undefined);
    api.investorLifecycle()
      .then((d) => setLifecycle(d || null))
      .catch((e) => { reportError('MultiLicenceStudio:investorLifecycle', e); setLifecycle(null); });
  }, []);
  useEffect(() => {
    if (!enabled) return;
    readDashboard();
    readLifecycle();
  }, [enabled, readDashboard, readLifecycle]);
  return { dashboard, lifecycle, readDashboard, readLifecycle };
}

export default function MultiLicenceStudio({ licences, activeRole, authUser, homes = STUDIO_HOMES, single = Dashboard }) {
  const held = orderedLicences(licences, activeRole);
  if (held.length < 2) {
    const Single = single;
    return <Single activeRole={activeRole} authUser={authUser} />;
  }
  return <BlockStudio held={held} user={authUser} homes={homes} />;
}

function BlockStudio({ held, user, homes }) {
  const investor = useInvestorContext(held.includes('investor'));
  // Once per page, as `Dashboard` does: the first-login tour and Product testing are the member's, not a licence's.
  const [tourEnabled, setTourEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.getOnboardingChecklist()
      .then((d) => { if (!cancelled && d && !d?.meta?.tour_seen_at) setTourEnabled(true); })
      .catch(() => { /* the tour is skipped when its read fails */ });
    return () => { cancelled = true; };
  }, []);

  const render = (block) => {
    const Home = homes[block.key];
    if (block.key === 'founder') {
      return (
        <div className="space-y-6">
          <Home user={user} embedded />
          {/* D1614 W8 (#3994): every task given to me, across my Teams, as on a Founder's single Studio. */}
          <MyTasks licence="founder" testId="studio-my-tasks" />
        </div>
      );
    }
    if (block.key === 'investor') {
      // D4815 (#4815): the investor's My tasks moved here from /deals. It is the
      // same list as the Founder block's (every task given to me, across my
      // Teams), so it is drawn once: here only when Founder is not held.
      return (
        <div className="space-y-6">
          <Home
            user={user}
            embedded
            previewing={false}
            dashboard={investor.dashboard}
            lifecycle={investor.lifecycle}
            dashboardUnavailable={investor.dashboard === null ? SUMMARY_UNREADABLE : ''}
            onRetryDashboard={investor.readDashboard}
            onRetryLifecycle={investor.readLifecycle}
          />
          {!held.includes('founder') && <MyTasks licence="investor" testId="studio-investor-my-tasks" />}
        </div>
      );
    }
    return <Home user={user} embedded previewing={false} />;
  };

  return (
    <div className="space-y-6" data-testid="multi-licence-studio">
      <h1 className="text-[24px] font-extrabold tracking-tight text-gray-900 dark:text-gray-100" data-testid="text-multi-licence-studio-title">Studio</h1>
      <ProductTour enabled={tourEnabled} onDone={() => setTourEnabled(false)} />
      <LicenceBlocks blocks={studioBlocks(held)} render={render} testId="multi-licence-studio-blocks" />
      <ProductTestingStudio user={user} />
    </div>
  );
}
