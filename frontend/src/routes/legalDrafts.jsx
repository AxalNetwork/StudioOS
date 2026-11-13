import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const TermsV2DraftPage = lazy(() => import('../pages/TermsV2DraftPage'));
const PrivacyV2DraftPage = lazy(() => import('../pages/PrivacyV2DraftPage'));

/**
 * `/terms/v2-draft` and `/privacy/v2-draft` — #4565. The proposed v2 legal texts, for
 * counsel's review, beside the published `/terms` and `/privacy`, which they do not
 * replace until counsel approves them. Public, unlinked and `noindex, nofollow`.
 */
export default function legalDraftsRoutes() {
  return (
    <>
      <Route path="/terms/v2-draft" element={<TermsV2DraftPage />} />
      <Route path="/privacy/v2-draft" element={<PrivacyV2DraftPage />} />
    </>
  );
}
