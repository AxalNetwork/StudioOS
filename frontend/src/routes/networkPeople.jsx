import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const NetworkWorkspace = lazy(() => import('../workspaces/NetworkWorkspace'));

/**
 * Network › People (D9025, #9025): the shared directory of people, the fifth Network link (D7676 Q1,
 * owner answer A on #7675). Both addresses render the Network workspace on its People zone, the same
 * element, so opening and closing a person's sheet keeps the list, its search and its page.
 *
 * THE GATE is the other Network zones' (`/network/relationships` in `App.jsx`): every licence that opens
 * Network. The Worker answers what each member may read; an operator's view of the directory is the
 * member read, since `networkRole` sends admin to the founder shell as the other zones do.
 */
export default function networkPeopleRoutes({ guard, effectiveRole }) {
  const networkRole = (!effectiveRole || effectiveRole === 'admin') ? 'founder' : effectiveRole;
  return (
    <>
      <Route path="/network/people" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <NetworkWorkspace role={networkRole} />)} />
      <Route path="/network/people/:uid" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <NetworkWorkspace role={networkRole} />)} />
    </>
  );
}
