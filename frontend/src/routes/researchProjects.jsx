import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const MyResearch = lazy(() => import('../pages/research/MyResearch'));
const ResearchProject = lazy(() => import('../pages/research/ResearchProject'));

/**
 * D5157 (#5157) — My Research and the Research Project workspace. A new area,
 * so its routes live here (D528) rather than in `App.jsx`.
 *
 * THE GATE. Only the founder shell lists My Research (`shellConfig.js`), the
 * shell the Research v2 canvas draws, so the routes admit the founder and an
 * admin: a licence whose shell has no such zone would be shown another zone's
 * body (`route_role_zone_contract.test.mjs`). The Worker store itself is
 * owner-scoped for any signed-in member, so opening My Research to the other
 * licences is a shell change, not a store change. The research role is the
 * one `App.jsx` gives the other `/research/*` pages: an admin browses as a
 * founder.
 */
export default function researchProjectsRoutes({ guard, labRoles, effectiveRole }) {
  const researchRole = (!effectiveRole || effectiveRole === 'admin') ? 'founder' : effectiveRole;
  return (
    <>
      <Route path="/research/projects" element={guard(labRoles(['admin', 'founder']), <MyResearch role={researchRole} />)} />
      <Route path="/research/projects/:uid" element={guard(labRoles(['admin', 'founder']), <ResearchProject role={researchRole} tab="overview" />)} />
      <Route path="/research/projects/:uid/evidence" element={guard(labRoles(['admin', 'founder']), <ResearchProject role={researchRole} tab="evidence" />)} />
    </>
  );
}
