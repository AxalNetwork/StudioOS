import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const AdminProgramPage = lazy(() => import('../pages/admin/programs/ProgramPage'));

/**
 * D5894 (#5894) — Product testing in the generic program shell (PG03a): Overview, Playbook, Availability & grants,
 * Participation, History and Settings, each a literal route onto the same `ProgramPage` under `guard(['admin'])` and
 * never `hqOnly`, since an Admin may read the registry row. Until now these addresses fell through to the
 * registry-backed `/admin/programs/:key/…` routes; the literal routes rank above those. The HQ page keeps its home
 * and its three `hqOnly` lines in `App.jsx` (`/admin/platform/product-testing`, `/:tab`, `/programs/:uid`), which the
 * shell's Applications module opens (the owner's answer B, 2026-11-27): nothing here redirects.
 */
export default function adminProgramsProductTestingRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/programs/product-testing" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/product-testing/how-it-runs" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/product-testing/availability" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/product-testing/participation" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/product-testing/activity" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/product-testing/settings" element={guard(['admin'], <AdminProgramPage />)} />
    </>
  );
}
