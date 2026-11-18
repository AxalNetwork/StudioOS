import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const AdminProgramPage = lazy(() => import('../pages/admin/programs/ProgramPage'));

/**
 * D5895 (#5895) — AI-native Venture in the generic program shell (PG03a): the five core sections it gained beside
 * its Overview, Playbook, Availability & grants, Participation, History and Settings. They open the same
 * `ProgramPage` as `/admin/programs/ai-native-venture` in `App.jsx`, under `guard(['admin'])` and never `hqOnly`.
 * Until now these addresses fell through to the registry-backed `/admin/programs/:key/…` routes and drew the generic
 * page; the literal routes rank above those, so every AI-native Venture address is one page with one tab strip.
 */
export default function adminProgramsAiNativeRoutes({ guard }) {
  return (
    <>
      <Route path="/admin/programs/ai-native-venture/how-it-runs" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/ai-native-venture/availability" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/ai-native-venture/participation" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/ai-native-venture/activity" element={guard(['admin'], <AdminProgramPage />)} />
      <Route path="/admin/programs/ai-native-venture/settings" element={guard(['admin'], <AdminProgramPage />)} />
    </>
  );
}
