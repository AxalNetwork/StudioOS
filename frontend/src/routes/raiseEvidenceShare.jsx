/**
 * D6864 (#6864, canvas D6054): Raise evidence shared outside Axal. Shared links is a page of Raise › Evidence
 * (`RaiseEvidence.jsx` draws it from the address, founders only); the reader's pack is public: no sign-in, the token
 * in the address is the capability, and the Worker refuses an expired, used-up or revoked link.
 */
import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const RaiseEvidence = lazy(() => import('../pages/cycles/evidence/RaiseEvidence'));
const EvidencePackPage = lazy(() => import('../pages/share/EvidencePackPage'));

export default function raiseEvidenceShareRoutes({ guard, labRoles }) {
  return (
    <>
      <Route path="/raise/evidence/shared" element={guard(labRoles(['admin', 'founder']), <RaiseEvidence />)} />
      <Route path="/share/evidence/:token" element={<EvidencePackPage />} />
    </>
  );
}
