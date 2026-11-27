import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const AdminProgramPage = lazy(() => import('../pages/admin/programs/ProgramPage'));

/**
 * D5313 (#5313) — Perks in the generic program shell (PG03a): the three core sections it gained, Availability &
 * grants, Participation and Settings. They open the same `ProgramPage` as Perks' four addresses in `App.jsx`
 * (Overview, How it runs, Queue, Activity), under `guard(['admin'])` and never `hqOnly`. Until now these three
 * addresses fell through to the registry-backed `/admin/programs/:key/…` routes and drew the generic page; the
 * literal routes rank above those, so every Perks address is one page with one tab strip.
 */
export default function adminProgramsPerksRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/programs/perks/availability" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/perks/participation" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/perks/settings" element={guard(['admin'], <AdminProgramPage />)} />
    </>
  );
}
