import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const AdminProgramPage = lazy(() => import('../pages/admin/programs/ProgramPage'));

/**
 * D5887 (#5887) — Learning in the generic program shell (PG03a): the three core sections it gained, Availability &
 * grants, Participation and Settings. They open the same `ProgramPage` as Learning's four addresses in `App.jsx`
 * (Overview, How it runs, People, Activity), under `guard(['admin'])` and never `hqOnly`. Until now these three
 * addresses fell through to the registry-backed `/admin/programs/:key/…` routes and drew the generic page; the
 * literal routes rank above those, so every Learning address is one page with one tab strip.
 */
export default function adminProgramsLearningRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/programs/learning/availability" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/learning/participation" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/learning/settings" element={guard(['admin'], <AdminProgramPage />)} />
    </>
  );
}
