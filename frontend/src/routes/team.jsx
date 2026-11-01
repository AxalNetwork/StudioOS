import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const TeamAgentsPage = lazy(() => import('../pages/team/TeamAgentsPage'));
const ProjectSettingsPage = lazy(() => import('../pages/team/ProjectSettingsPage'));

/**
 * Team (D1497, #3727): the people and AI agents working on a company or a
 * project, and a project's own settings. A new area, so its routes live here
 * (D528).
 *
 * THREE FORMS OF ONE PAGE. A company's Team sits under its settings; a
 * project inside a company is reached from Company settings › Projects; a
 * standalone project's Team sits under Project settings. The page decides the
 * scope from the project's own `company_id` and forwards a wrong address to
 * the right form, so the two project routes never draw different pages.
 *
 * THE GATES are the reads': the two company forms admit every profile that
 * may open a company's settings (admin, founder, partner, investor and
 * advisor, as `/account/companies/:uid/settings` does) and answer "You're not
 * a member" from the Worker's 404; the standalone project's Team and Project
 * settings admit exactly the profiles `/projects/:id` admits (admin, founder,
 * partner and investor, through `labRoles`; an advisor profile is not among
 * them), and the members read decides the rest. None is wrapped in a rail
 * shell (owner question T1 on #3727).
 */
export default function teamRoutes({ guard, labRoles }) {
  return (
    <>
      <Route path="/account/companies/:uid/settings/team" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <TeamAgentsPage form="company" />)} />
      <Route path="/account/companies/:uid/settings/projects/:id/team" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <TeamAgentsPage form="company_project" />)} />
      <Route path="/projects/:id/settings/team" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), <TeamAgentsPage form="project" />)} />
      <Route path="/projects/:id/settings" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), <ProjectSettingsPage />)} />
    </>
  );
}
