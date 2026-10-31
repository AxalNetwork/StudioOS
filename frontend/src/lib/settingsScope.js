/**
 * D1497 (#3727, canvas TM1e–TM1i) — who governs a Team page, and what the
 * sidebar's bottom block reads.
 *
 * THE OWNER RULE (2026-10-31, #3697). A company is a legal entity and governs
 * every project under it: its editors (Owner, Admin, Founder, the primary
 * admin, and an Axal VC admin) manage those projects' teams and agents. A
 * standalone project governs itself, its Owner manages it, and it has no Legal
 * entry anywhere, because it is not a legal entity.
 *
 * THREE SCOPES, decided here and nowhere else:
 *   company          a company's own Team                   "Company settings"
 *   company_project  a project whose `company_id` is set     "Company settings"
 *   project          a project under no company              "Project settings"
 *
 * Today the scope is DERIVED from reads that exist: the device's active
 * company (the switcher's `/company/memberships`) and a project's own
 * `company_id` (`GET /projects/:id`, with the company's uid and name from
 * `GET /account/projects`). #3697 part 2 adds `GET /api/account/settings-scope`;
 * `fromSettingsScope` already maps its documented answer onto the same shape.
 *
 * THE SEAM. `readSettingsScope` is the one place that read is swapped in. It
 * answers `{ available: false }` today, so every caller falls back to
 * `scopeFor`. When `lib/api/accountPortfolio.js` lands, its body becomes
 * `accountPortfolioApi.settingsScope({ company, project }).then(fromSettingsScope)`
 * and nothing else changes. No client method is added before its route
 * exists (the drift test).
 *
 * The Team page, Project settings and the project page (`ProjectDetail`)
 * publish the scope they drew (`usePublishScope`), so the sidebar draws the
 * same block the page is about; with none of them in view the block follows
 * the active company alone.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { accountPortfolioApi } from './api/accountPortfolio.js';

export const COMPANY_SETTINGS = 'Company settings';
export const PROJECT_SETTINGS = 'Project settings';

const enc = encodeURIComponent;
export const companyTeamPath = (uid) => `/account/companies/${enc(uid)}/settings/team`;
export const companySettingsPath = (uid) => `/account/companies/${enc(uid)}/settings`;
export const companyProjectTeamPath = (uid, id) => `/account/companies/${enc(uid)}/settings/projects/${enc(id)}/team`;
export const projectTeamPath = (id) => `/projects/${enc(id)}/settings/team`;
export const projectSettingsPath = (id) => `/projects/${enc(id)}/settings`;
export const PROJECTS_PATH = '/account/companies/projects';
export const BILLING_PATH = '/account/billing';

const nameOf = (v, fallback) => String(v || '').trim() || fallback;

/**
 * The scope of a Team page or of the sidebar, from what is known.
 *
 * `company` is `{ uid, name }` (or the switcher's row, `company_name`);
 * `project` is `{ id, name, company: { uid, name } | null }`. A project wins
 * over a company: on a project's page the project's own company governs,
 * whichever company is active on this device.
 *
 * Returns null when there is neither, so the caller draws "Companies and
 * projects" alone.
 */
export function scopeFor({ company = null, project = null, projects = null } = {}) {
  if (project && project.id != null) {
    const parent = project.company || null;
    if (parent && !parent.uid) {
      // Its `company_id` is set, but this account cannot name that company (it
      // is not a member): still governed by a company, never "standalone".
      const p = { id: project.id, name: nameOf(project.name, 'This project') };
      const c = { uid: null, name: nameOf(parent.name, 'its company') };
      return {
        kind: 'company_project', label: COMPANY_SETTINGS, eyebrow: `Project · in ${c.name}`, company: c, project: p,
        team: projectTeamPath(p.id), entries: [{ key: 'team', label: 'Team', path: projectTeamPath(p.id) }],
      };
    }
    if (parent) {
      const c = { uid: parent.uid, name: nameOf(parent.name || parent.company_name, 'This company') };
      return {
        kind: 'company_project',
        label: COMPANY_SETTINGS,
        eyebrow: `Project · in ${c.name}`,
        company: c,
        project: { id: project.id, name: nameOf(project.name, 'This project') },
        team: companyProjectTeamPath(c.uid, project.id),
        entries: companyEntries(c, { id: project.id, name: nameOf(project.name, 'This project') }, projects),
      };
    }
    const p = { id: project.id, name: nameOf(project.name, 'This project') };
    return {
      kind: 'project',
      label: PROJECT_SETTINGS,
      eyebrow: 'Project',
      company: null,
      project: p,
      team: projectTeamPath(p.id),
      entries: [
        { key: 'team', label: 'Team', path: projectTeamPath(p.id) },
        { key: 'project', label: PROJECT_SETTINGS, path: projectSettingsPath(p.id), sub: 'General', children: [
          { key: 'general', label: 'General', path: projectSettingsPath(p.id) },
        ] },
      ],
    };
  }
  if (company && company.uid) {
    const c = { uid: company.uid, name: nameOf(company.name || company.company_name, 'This company') };
    return {
      kind: 'company',
      label: COMPANY_SETTINGS,
      eyebrow: COMPANY_SETTINGS,
      company: c,
      project: null,
      team: companyTeamPath(c.uid),
      entries: companyEntries(c, null, projects),
    };
  }
  return null;
}

/**
 * A company's block: Team · Company settings (General, Legal) · Projects.
 * Legal is the company's legal page (#3697 part 1, D1415), which is not on
 * this base yet: the entry is drawn, without an address, and says so.
 *
 * Projects lists every project of the company when a read named them
 * (`GET /api/account/projects`, filtered to this company), each linking to its
 * Team; the project in view also shows its Team and Settings. Without that
 * read, only the project in view is listed, never an invented "none".
 *
 * `activeOnly` marks the entries whose page reads only the company active on
 * this device (`CompanySettingsAt`): the sidebar draws them off, with that
 * reason, for any other company.
 */
function companyEntries(c, project, projects) {
  const listed = Array.isArray(projects) ? projects.filter((p) => p && p.id != null) : null;
  const rows = (listed || (project ? [project] : [])).map((p) => {
    const here = project && String(p.id) === String(project.id);
    return here
      ? { key: `project-${p.id}`, label: nameOf(p.name, 'This project'), path: null, children: [
        { key: 'project-team', label: 'Team', path: companyProjectTeamPath(c.uid, p.id) },
        { key: 'project-settings', label: 'Settings', path: projectSettingsPath(p.id) },
      ] }
      : { key: `project-${p.id}`, label: nameOf(p.name, 'A project'), path: companyProjectTeamPath(c.uid, p.id) };
  });
  return [
    { key: 'team', label: 'Team', path: companyTeamPath(c.uid) },
    { key: 'company', label: COMPANY_SETTINGS, path: companySettingsPath(c.uid), activeOnly: true, sub: 'General · Legal', children: [
      { key: 'general', label: 'General', path: companySettingsPath(c.uid), activeOnly: true },
      { key: 'legal', label: 'Legal', path: null, reason: 'The company’s Legal page is not open yet.' },
    ] },
    { key: 'projects', label: 'Projects', path: PROJECTS_PATH, count: listed ? listed.length : null, children: rows },
  ];
}

/**
 * The company a project sits under, from what this account can read: the
 * `GET /api/account/projects` row (`company_uid`, `company_name`), else the
 * switcher's companies by `company_id`. A `company_id` this account cannot
 * name is `{ uid: null, name: null }` (still governed, never "standalone");
 * no `company_id` is null.
 */
export function projectCompany(project, { row = null, companies = [] } = {}) {
  if (project?.company_id == null) return null;
  if (row?.company_uid) return { uid: row.company_uid, name: row.company_name || null };
  const byId = (companies || []).find((c) => Number(c.id) === Number(project.company_id));
  return byId ? { uid: byId.uid, name: byId.company_name || byId.name || null } : { uid: null, name: null };
}

/** The projects of one company, from `GET /api/account/projects`'s rows; null when that read did not answer. */
export function projectsOfCompany(rows, uid) {
  if (!Array.isArray(rows) || !uid) return null;
  return rows.filter((p) => p.company_uid === uid).map((p) => ({ id: p.id, name: p.name }));
}

/** Every label a scope's block draws, depth first, for tests and the phone drawer. */
export function entryLabels(scope) {
  const out = [];
  const walk = (list) => { for (const e of list || []) { out.push(e.label); walk(e.children); } };
  walk(scope?.entries);
  return out;
}

/**
 * #3697 part 2's documented answer to `GET /api/account/settings-scope`,
 * `{ scope: 'company'|'project'|'company_project', label, company, project,
 * company_editors?, my_authority? }`, as the same shape `scopeFor` returns.
 * The derivation stays the one source of the entries, so the answer and the
 * guess can never draw two different blocks; the answer adds what only the
 * Worker knows (`company_editors`, `my_authority`), each as a block.
 */
export function fromSettingsScope(answer) {
  if (!answer || typeof answer !== 'object') return null;
  const company = answer.company && answer.company.uid ? { uid: answer.company.uid, name: answer.company.name } : null;
  const project = answer.project && answer.project.id != null
    ? { id: answer.project.id, name: answer.project.name, company: answer.scope === 'company_project' ? company : null }
    : null;
  const scope = scopeFor({ company: answer.scope === 'company' ? company : null, project: answer.scope === 'company' ? null : project });
  if (!scope) return null;
  return {
    ...scope,
    companyEditors: Array.isArray(answer.company_editors)
      ? { available: true, value: answer.company_editors.map((e) => ({ uid: e.uid ?? null, name: e.name, role: e.role_in_company ?? e.role ?? null })) }
      : { available: false },
    myAuthority: answer.my_authority ?? null,
  };
}

/**
 * `GET /api/account/settings-scope` (#3697 part 2, D1415), read through
 * `accountPortfolioApi.settingsScope` and turned into the same shape
 * `scopeFor` returns. With no company and no project there is nothing to ask
 * (the Worker refuses that with `scope_missing`), and a failed read is
 * reported as unavailable so the caller keeps deriving the scope itself.
 */
export async function readSettingsScope({ company, project, api = accountPortfolioApi } = {}) {
  if (!company && project == null) {
    return { available: false, reason: 'Name a company, a project, or both.' };
  }
  try {
    const value = fromSettingsScope(await api.settingsScope({ company, project }));
    return value ? { available: true, value } : { available: false, reason: 'The settings scope could not be read.' };
  } catch {
    return { available: false, reason: 'The settings scope could not be read.' };
  }
}

// ---------------------------------------------------------------- the scope in view

let inView = null;
const listeners = new Set();
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const current = () => inView;

/** The Team page says which scope it is drawing; null clears it. */
export function publishScope(scope) {
  inView = scope || null;
  for (const fn of listeners) fn();
}

/** A stable key for a scope, so a page republishes only when what it draws changed. */
export function scopeKey(scope) {
  if (!scope) return '';
  return JSON.stringify([scope.kind, scope.company?.uid, scope.company?.name, scope.project?.id, scope.project?.name, entryLabels(scope)]);
}

/**
 * A page says which scope it is drawing while it is mounted. Pass null while
 * the page is still reading (or refused), so the sidebar never draws a guess.
 */
export function usePublishScope(scope) {
  const latest = useRef(scope);
  latest.current = scope;
  const key = scopeKey(scope);
  useEffect(() => {
    if (!latest.current) return undefined;
    publishScope(latest.current);
    return () => publishScope(null);
  }, [key]);
}

/** The scope the sidebar draws: the page's when one is in view, else the active company's. */
export function useScopeInView(activeCompany) {
  const published = useSyncExternalStore(subscribe, current, current);
  return published || scopeFor({ company: activeCompany || null });
}
