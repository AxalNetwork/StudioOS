import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import HeldAccounts from './HeldAccounts';
import { teamForward } from './accountsAddress';

/**
 * D941 (#2746) — `/admin/accounts`: the Admin's Accounts page; a Super Admin,
 * whose Team lived here, is forwarded to `/admin/hq-team` with Team's moved
 * notice (`accountsAddress.js`).
 */
export default function AccountsAddress({ superAdmin }) {
  const { search, hash } = useLocation();
  if (superAdmin) return <Navigate to={teamForward(search, hash)} replace />;
  return <HeldAccounts />;
}
