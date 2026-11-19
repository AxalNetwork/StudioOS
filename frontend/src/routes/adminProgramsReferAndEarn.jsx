import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const ReferAndEarn = lazy(() => import('../pages/admin/programs/ReferAndEarn'));

export default function adminProgramsReferAndEarnRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/programs/refer-and-earn/availability" element={guard(['admin'], <ReferAndEarn />)} />
      <Route path="/admin/programs/refer-and-earn/participation" element={guard(['admin'], <ReferAndEarn />)} />
    </>
  );
}
