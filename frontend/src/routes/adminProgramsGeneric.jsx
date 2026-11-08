import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const GenericProgramPage = lazy(() => import('../pages/admin/programs/GenericProgramPage'));
const ProposalReviewPage = lazy(() => import('../pages/admin/programs/ProposalReviewPage'));

/**
 * D4808 (#4808) — the generic, registry-backed program page and a proposal's review.
 *
 * `/admin/programs/:key` (with `/how-it-runs` and `/activity`) draws any program the registry holds, so a program an
 * approval or New program made needs no route of its own. React Router ranks the literal addresses `App.jsx` and the
 * sibling modules register (`/admin/programs/perks`, `/propose`, `/proposals`, …) above these, so the nine keep their
 * pages and only a key nobody wrote a route for lands here. `/admin/programs/proposals/:uid` is a proposal's review,
 * before Decide. Both sit under `guard(['admin'])` and never `hqOnly`: the Worker's own gates decide who may read what.
 */
export default function adminProgramsGenericRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/programs/proposals/:uid" element={guard(['admin'], <ProposalReviewPage />)} />
      <Route path="/admin/programs/:key" element={guard(['admin'], <GenericProgramPage />)} />
      <Route path="/admin/programs/:key/how-it-runs" element={guard(['admin'], <GenericProgramPage />)} />
      <Route path="/admin/programs/:key/activity" element={guard(['admin'], <GenericProgramPage />)} />
    </>
  );
}
