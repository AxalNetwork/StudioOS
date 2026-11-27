import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { heldAccountsForward } from './accountsAddress';

/**
 * D941 (#2746): `/admin/held/accounts` is the Accounts page's old address;
 * it forwards to `/admin/accounts`, keeping the query and hash. Its own file,
 * as `HeldInsightsRedirect` is, so a redirect does not import the page.
 */
export default function HeldAccountsRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={heldAccountsForward(search, hash)} replace />;
}
