import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const AdminProgramPage = lazy(() => import('../pages/admin/programs/ProgramPage'));

/**
 * D5888 (#5888) — Referral partners in the generic program shell (PG03a): the three core sections it gained,
 * Availability & grants, Participation and Settings. They open the same `ProgramPage` as its four addresses in
 * `App.jsx` (Overview, How it runs, Queue, Activity), under `guard(['admin'])` and never `hqOnly`. Until now these
 * three addresses fell through to the registry-backed `/admin/programs/:key/…` routes and drew the generic page; the
 * literal routes rank above those, so every Referral partners address is one page with one tab strip.
 */
export default function adminProgramsReferralPartnersRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/programs/referral-partners/availability" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/referral-partners/participation" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/referral-partners/settings" element={guard(['admin'], <AdminProgramPage />)} />
    </>
  );
}
