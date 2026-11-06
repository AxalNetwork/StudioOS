import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const ContractsDesk = lazy(() => import('../pages/admin/contracts/ContractsDesk'));

/**
 * `/admin/contracts/governance` — D4563 (#4563), HQ › Contracts › Corporate
 * Governance: the desk's tab after Templates, at its own address. HQ only;
 * every route behind it re-checks (`requireHqAuthoring`, and the Super Admin
 * for a confidential document or the ownership metadata).
 */
export default function adminGovernanceRoutes({ guard, hqOnly }) {
  return (
    <>
      <Route path="/admin/contracts/governance" element={guard(['admin'], hqOnly(<ContractsDesk section="governance" />))} />
    </>
  );
}
