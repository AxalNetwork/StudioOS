// #4622 (Studio audit 4/5): the five Studio homes behind lazy boundaries.
// Dashboard.jsx imported all five statically, so a founder fetched the investor, advisor, partner and
// admin homes (and what they import) before anything drew, and an investor fetched the founder's.
// Dashboard now imports these wrappers: same names, same props, and only the home the view needs is
// fetched, with a skeleton in the home's place while its chunk loads. The skeleton is per home, so one
// slow chunk holds back only itself.
//
// A chunk that fails to load throws inside the route tree; RouteErrorBoundary and main.jsx's
// `vite:preloadError` handler recover it as they do any lazy route (lib/chunkLoadError.js), the same
// recovery D4574 relies on for the Product testing section.
import React, { Suspense, lazy } from 'react';

const Founder = lazy(() => import('./founder/FounderStudioHome'));
const Investor = lazy(() => import('./investor/InvestorStudioHome'));
const Advisor = lazy(() => import('./advisor/AdvisorStudioHome'));
const Partner = lazy(() => import('./partner/PartnerStudioHome'));
const Admin = lazy(() => import('./admin/AdminStudioHome'));

function Holding({ role }) {
  return (
    <div
      data-testid="studio-home-loading"
      data-role={role}
      aria-hidden="true"
      className="min-h-[240px] animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800"
    />
  );
}

const wrap = (role, Home) => function StudioHome(props) {
  return <Suspense fallback={<Holding role={role} />}><Home {...props} /></Suspense>;
};

export const FounderStudioHome = wrap('founder', Founder);
export const InvestorStudioHome = wrap('investor', Investor);
export const AdvisorStudioHome = wrap('advisor', Advisor);
export const PartnerStudioHome = wrap('partner', Partner);
export const AdminStudioHome = wrap('admin', Admin);
