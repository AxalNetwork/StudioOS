import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const AdminProgramPage = lazy(() => import('../pages/admin/programs/ProgramPage'));

/** D5890 — shell sections for the built-in Investor cohort access program. */
export default function adminProgramsInvestorCohortsRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/programs/investor-cohorts/how-it-runs" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/investor-cohorts/availability" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/investor-cohorts/participation" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/investor-cohorts/settings" element={guard(['admin'], <AdminProgramPage />)} />
    </>
  );
}
