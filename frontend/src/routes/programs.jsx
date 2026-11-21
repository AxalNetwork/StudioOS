import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const ProgramsIndexPage = lazy(() => import('../pages/programs/ProgramsIndexPage'));
const ProgramKeyPage = lazy(() => import('../pages/programs/ProgramKeyPage'));

/**
 * `/programs` and `/programs/:key` — D6966 (#6966, PGS08): the public Programs index and a
 * program's shareable address, which resolves to its presentation or says the programme is not
 * found. Public: no guard, refreshable signed out (`isPublicPath` lists the prefix). A program is
 * added by its map entry under `frontend/src/pages/programs/catalog/`, never by a route here.
 */
export default function programsRoutes() {
  return (
    <>
      <Route path="/programs" element={<ProgramsIndexPage />} />
      <Route path="/programs/:key" element={<ProgramKeyPage />} />
    </>
  );
}
