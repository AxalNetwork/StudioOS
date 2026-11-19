import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const AdminLab = lazy(() => import('../pages/admin/lab/AdminLab'));

/**
 * D5893 (#5893) — Spin-Out Lab in the generic program shell (PG03a): the two core sections it gained, Availability &
 * grants and Participation. They open the same `AdminLab` as the Lab's thirteen addresses in `App.jsx`, under
 * `guard(['admin'])` and never `hqOnly`. Until now these two fell through to the registry-backed
 * `/admin/programs/:key/…` routes and drew the generic page; the literal routes rank above those, so every Lab
 * address is one page with one tab strip. The Lab's own `/settings` stays in `App.jsx`.
 *
 * No `onImpersonate` here: `routeTools` does not carry `App.jsx`'s `handleImpersonate` (D528 pins its shape), and
 * neither section draws a door that opens a founder's workspace. Participants, Cohorts and Applications, which do,
 * keep their `App.jsx` lines and the prop (D5893).
 */
export default function adminProgramsSpinoutLabRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/programs/spinout-lab/availability" element={guard(['admin'], <AdminLab />)} />
      <Route path="/admin/programs/spinout-lab/participation" element={guard(['admin'], <AdminLab />)} />
    </>
  );
}
