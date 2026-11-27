import React, { lazy } from 'react';
import { Navigate, Route, useLocation, useParams } from 'react-router-dom';

const TeamAgentsPage = lazy(() => import('../pages/team/TeamAgentsPage'));
const ProjectSettingsPage = lazy(() => import('../pages/team/ProjectSettingsPage'));
// D1614 (#3968): a project's Work, and a company's compliance tasks.
const WorkPage = lazy(() => import('../pages/work/WorkPage'));
const CompliancePage = lazy(() => import('../pages/work/CompliancePage'));
// #5964 (D5963): a company extension of an Axal skill, compared with the Axal version it was built on.
const SkillComparePage = lazy(() => import('../pages/team/SkillComparePage.jsx'));

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
function CompanyWorkRedirect() {
  const { uid } = useParams();
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  params.set('tab', 'tasks');
  return <Navigate replace to={`/account/companies/${encodeURIComponent(uid)}/settings/team?${params}${hash}`} />;
}

export default function teamRoutes({ guard, labRoles }) {
  return (
    <>
      <Route path="/account/companies/:uid/work" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <CompanyWorkRedirect />)} />
      <Route path="/account/companies/:uid/settings/team" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <TeamAgentsPage form="company" />)} />
      {/* #5964 (owner Q1 option A): Compare with Axal is its own page. The Worker's read gate decides who sees it
          (the company's members and HQ's admins; another company gets "There is no such skill"). */}
      <Route path="/account/companies/:uid/settings/team/skills/:skillUid/base" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <SkillComparePage />)} />
      <Route path="/account/companies/:uid/settings/projects/:id/team" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <TeamAgentsPage form="company_project" />)} />
      <Route path="/projects/:id/settings/team" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), <TeamAgentsPage form="project" />)} />
      <Route path="/projects/:id/settings" element={guard(labRoles(['admin', 'founder', 'partner', 'investor']), <ProjectSettingsPage />)} />
      {/* D1614 (#3968): only projects have Work; a company has compliance tasks. */}
      {/* #4735: an advisor holding a seat on the project reads its Work: the Worker's read rule (`canRead`) admits every
          accepted project member, and My tasks and the Calendar link such an advisor here. The Worker decides the rest. */}
      <Route path="/projects/:id/work" element={guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor']), <WorkPage />)} />
      <Route path="/account/companies/:uid/settings/compliance" element={guard(['admin', 'founder', 'partner', 'investor', 'advisor'], <CompliancePage />)} />
    </>
  );
}
