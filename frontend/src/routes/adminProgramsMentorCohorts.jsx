import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const MentorCohortAccess = lazy(() => import('../pages/admin/programs/MentorCohortAccess'));

export default function adminProgramsMentorCohortsRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/programs/mentor-cohorts/availability" element={guard(['admin'], <MentorCohortAccess />)} />
      <Route path="/admin/programs/mentor-cohorts/participation" element={guard(['admin'], <MentorCohortAccess />)} />
      <Route path="/admin/programs/mentor-cohorts/settings" element={guard(['admin'], <MentorCohortAccess />)} />
    </>
  );
}
