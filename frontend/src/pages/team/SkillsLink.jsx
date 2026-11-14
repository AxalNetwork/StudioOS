import React from 'react';
import { Link } from 'react-router-dom';
import { safeReadJSON } from '../../lib/storage';
import { BTN_TEXT } from './teamUi.jsx';
import { canOpenTeam } from './teamModel.js';

/**
 * #4363 — the one-click way to a scope's Team › Skills tab, drawn wherever a
 * company's or a project's team or agents are shown (the agents card, an
 * agent's Skills and values, and the Team entries of the company and project
 * pages). Before it, a company's own skills were reached only through
 * Settings › Team and then the Skills tab. HQ keeps its own Skills library
 * tab (`/hq/ai-agents/skills`) and draws no such link.
 *
 * Each form's address is a literal `to`, one per Team route in
 * `routes/team.jsx`, so a reader (and the reachability walk) sees the door:
 *
 *   company           /account/companies/:uid/settings/team?tab=skills
 *   company_project   /account/companies/:uid/settings/projects/:id/team?tab=skills
 *   project           /projects/:id/settings/team?tab=skills
 *
 * A project under a company this account cannot name (no `uid`) links the
 * project form, which forwards to the right one with its `?tab=` kept. The
 * link is drawn only for a viewer the route admits (`canOpenTeam`), so it is
 * never a door onto "You can't see this".
 */
export default function SkillsLink({ scope, user, className = BTN_TEXT, testId = 'skills-link', children = 'Skills' }) {
  const uid = scope?.company?.uid;
  const id = scope?.project?.id;
  // The form whose route the click opens: a company project without a uid goes through the project form's guard.
  const form = scope?.kind === 'company_project' && !uid ? 'project' : scope?.kind;
  const who = user === undefined ? safeReadJSON('user', {}) || {} : user;
  if (!form || !canOpenTeam(who, form)) return null;
  if (form === 'company') {
    return uid ? <Link to={`/account/companies/${encodeURIComponent(uid)}/settings/team?tab=skills`} className={className} data-testid={testId}>{children}</Link> : null;
  }
  if (id == null) return null;
  if (form === 'company_project') {
    return <Link to={`/account/companies/${encodeURIComponent(uid)}/settings/projects/${encodeURIComponent(id)}/team?tab=skills`} className={className} data-testid={testId}>{children}</Link>;
  }
  return <Link to={`/projects/${encodeURIComponent(id)}/settings/team?tab=skills`} className={className} data-testid={testId}>{children}</Link>;
}
