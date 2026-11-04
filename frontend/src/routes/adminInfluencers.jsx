import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const AdminProgramPage = lazy(() => import('../pages/admin/programs/ProgramPage'));

/**
 * `/admin/programs/influencer` and its seven tabs — D4298 (#4298, D4289 P9,
 * IN11). The page is the Programs board's `ProgramPage`, as its sibling
 * program pages in `App.jsx` are, under `guard(['admin'])` and never `hqOnly`
 * (which is the Super Admin's alone): an HQ admin reads the page with its money
 * as "HQ reads", and the Worker's `requireHqAdmin` refuses a branch admin.
 */
export default function adminInfluencersRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/programs/influencer" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/influencer/how-it-runs" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/influencer/applications" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/influencer/influencers" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/influencer/offers" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/influencer/payouts" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/influencer/activity" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/influencer/settings" element={guard(['admin'], <AdminProgramPage />)} />
    </>
  );
}
