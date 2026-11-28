import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const NetworkWorkspace = lazy(() => import('../workspaces/NetworkWorkspace'));

/**
 * Network › Organizations, one organization in the shared directory (D9071, #9071, D7680): its people first,
 * then its identity and mandate. `/network/organizations/:uid/people/:personUid` is the same page with a
 * person's sheet open (the People sheet, D9025, with the organization as context). Both render the Network
 * workspace on its Organizations zone, the same element, so the page stays mounted as the sheet opens and closes.
 *
 * THE GATE is `/network/organizations`'s in `App.jsx`: every licence that opens Network. The Worker answers
 * what each member may read.
 */
export default function networkOrganizationsRoutes({ guard, effectiveRole }) {
  const networkRole = (!effectiveRole || effectiveRole === 'admin') ? 'founder' : effectiveRole;
  return (
    <>
      <Route path="/network/organizations/:uid" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <NetworkWorkspace role={networkRole} />)} />
      <Route path="/network/organizations/:uid/people/:personUid" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <NetworkWorkspace role={networkRole} />)} />
    </>
  );
}
