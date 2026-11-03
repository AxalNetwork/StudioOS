import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const AdminProgramPage = lazy(() => import('../pages/admin/programs/ProgramPage'));

/**
 * `/admin/programs/influencer` and its seven tabs — D4298 (#4298, D4289 P9,
 * IN11). The page is the Programs board's `ProgramPage`, as its sibling
 * program pages in `App.jsx` are; the program runs at HQ, so a branch admin
 * is turned away (`hqOnly`), as the Worker's `requireHqAdmin` does.
 */
export default function adminInfluencersRoutes({ guard, hqOnly }) {
  return (
    <>
      <Route path="/admin/programs/influencer" element={guard(['admin'], hqOnly(<AdminProgramPage />))} />
      <Route path="/admin/programs/influencer/how-it-runs" element={guard(['admin'], hqOnly(<AdminProgramPage />))} />
      <Route path="/admin/programs/influencer/applications" element={guard(['admin'], hqOnly(<AdminProgramPage />))} />
      <Route path="/admin/programs/influencer/influencers" element={guard(['admin'], hqOnly(<AdminProgramPage />))} />
      <Route path="/admin/programs/influencer/offers" element={guard(['admin'], hqOnly(<AdminProgramPage />))} />
      <Route path="/admin/programs/influencer/payouts" element={guard(['admin'], hqOnly(<AdminProgramPage />))} />
      <Route path="/admin/programs/influencer/activity" element={guard(['admin'], hqOnly(<AdminProgramPage />))} />
      <Route path="/admin/programs/influencer/settings" element={guard(['admin'], hqOnly(<AdminProgramPage />))} />
    </>
  );
}
