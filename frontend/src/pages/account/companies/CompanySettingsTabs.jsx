import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { teamsApi } from '../../../lib/api/teams';
import { companyActionsApi } from '../../../lib/api/companyActions.js';
import { companyProjectTeamPath, companyTeamPath, scopeFor, usePublishScope } from '../../../lib/settingsScope.js';
import { ActionDialog } from './LifecycleDialogs.jsx';
import { moveOutCopy } from '../../team/teamModel.js';
import { BTN_DANGER, BTN_TEXT } from '../../team/teamUi.jsx';
import SkillsLink from '../../team/SkillsLink.jsx';
import * as portfolio from './portfolioAdapter.js';
import {
  companyLegalPath, companyProjectsPath, companySettingsPathFor, legalFacts, stageWord, valueFact,
} from './companiesModel';
import { CompanyMark, EYEBROW, Fact, FactList, Failed, INK, LINK, MUTED, NotYours, PCard, ProjectMark, Reading } from './portfolioUi.jsx';
import LegalSheet from './LegalSheet.jsx';
import ComplianceCard from '../../work/ComplianceCard.jsx';

/**
 * D1413 (#3696, PF6a, PF6c, PF8a) — Company settings, by tab, under
 * `/account/portfolio/<uid>/settings`:
 *
 *   General   `…/settings`           one form (`CompanyGeneralForm`, D4152)
 *   Legal     `…/settings/legal`     the legal facts (D1415, D1593) and
 *                                    "Edit legal facts" (`LegalSheet`)
 *   Projects  `…/settings/projects[/<id>]`  each project's settings inside the
 *                                    company: name, address, stage, Team,
 *                                    Agents, and "Move out of the company"
 *
 * Billing is not a tab: it is per account, in the Account menu (D4152). Team is
 * the first tab and opens the company's Team page (D1497).
 * A standalone project has no Legal anywhere: its settings are Project
 * settings › General (`/projects/<id>/settings`, Team's D1497).
 *
 * The company's projects are the settings scope's (`GET
 * /api/account/settings-scope`, D1415 part 2), every project of the company,
 * not only the ones you sit on. Each block fails alone.
 */

function useBlock(load, tick) {
  const [s, set] = useState({ status: 'loading', value: null });
  useEffect(() => {
    let alive = true;
    set((x) => ({ status: 'loading', value: x.value }));
    Promise.resolve().then(load).then((out) => {
      if (!alive) return;
      set(out && out.available ? { status: 'ready', value: out.value } : { status: out?.notFound ? 'notFound' : 'error', value: null, out });
    });
    return () => { alive = false; };
  }, [load, tick]);
  return s;
}

/**
 * D4152 (#4152 §4, ST2) — the settings page's one header: the company's mark,
 * its name and a small "Settings" eyebrow, and the four tabs every tab shows,
 * Team · General · Legal · Projects. No ID, no internal path, no banner.
 * Team opens the company's Team page (D1497); the other three are this page.
 */
export function SettingsHead({ uid, name, tab }) {
  // #4964: these are links between pages, so they are a labelled navigation whose current page is
  // `aria-current="page"`, not an ARIA tablist (which promises arrow-key tabs and panels it never had).
  const linkCls = (on) => `whitespace-nowrap border-b-2 px-1 pb-2 text-[13.5px] font-semibold ${on ? 'border-axal-violet text-axal-ink dark:border-violet-400 dark:text-gray-100' : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`;
  const items = [
    ['team', 'Team', companyTeamPath(uid)],
    ['general', 'General', companySettingsPathFor(uid)],
    ['legal', 'Legal', companyLegalPath(uid)],
    ['projects', 'Projects', companyProjectsPath(uid)],
  ];
  return (
    <header className="flex flex-col gap-3" data-testid="company-settings-head">
      <span className="flex flex-wrap items-center gap-3">
        <CompanyMark name={name} size={36} />
        <span className="flex min-w-0 flex-col">
          <span className={EYEBROW}>Settings</span>
          <h1 className={`m-0 text-[24px] font-extrabold tracking-[-.02em] ${INK}`}>{name || 'Company settings'}</h1>
        </span>
      </span>
      <nav aria-label="Company settings" data-testid="company-settings-tabs">
        <ul className="m-0 flex list-none gap-5 overflow-x-auto border-b border-axal-hairline p-0 dark:border-gray-700">
          {items.map(([key, label, to]) => (
            <li key={key}>
              <Link to={to} aria-current={tab === key ? 'page' : undefined} className={`inline-block ${linkCls(tab === key)}`} data-testid={`company-settings-link-${key}`}>{label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

function LegalTab({ uid, name }) {
  const [tick, setTick] = useState(0);
  const reread = useCallback(() => setTick((n) => n + 1), []);
  const load = useCallback(() => portfolio.legal(uid), [uid]);
  const legal = useBlock(load, tick);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  if (legal.status === 'loading' && !legal.value) return <PCard title="Legal facts"><Reading /></PCard>;
  if (legal.status !== 'ready') return <PCard title="Legal facts" testId="company-legal-tab"><Failed what="Legal facts" onRetry={reread} testId="company-legal-tab-unread" /></PCard>;
  const l = legal.value;
  const facts = legalFacts(l);
  return (
    <>
      {notice ? <p role="status" className={`m-0 rounded-axal-md bg-axal-ground px-3 py-2 text-[12.5px] ${INK} dark:bg-gray-800`}>{notice}</p> : null}
      <PCard title="Legal facts" testId="company-legal-tab"
        aside={l.can_edit ? <button type="button" className={BTN_TEXT} onClick={() => setEditing(true)} data-testid="company-legal-tab-edit">Edit</button> : null}>
        <FactList testId="company-legal-tab-facts" rows={[
          ['Legal name', <Fact key="n" fact={facts.legalName} />],
          ['Entity type', <Fact key="t" fact={facts.entityType} />],
          ['Jurisdiction', <Fact key="j" fact={facts.jurisdiction} />],
          ['Registration number', <Fact key="r" fact={facts.registrationNumber} mono />],
          ['Tax ID', <Fact key="x" fact={facts.taxId} mono />],
          ['Registered address', <Fact key="a" fact={facts.registeredAddress} />],
          ['Registered agent', <Fact key="g" fact={facts.registeredAgent} />],
          ['Mailing address', <Fact key="m" fact={facts.mailingAddress} />],
          ['Incorporation date', <Fact key="d" fact={facts.incorporationDate} mono />],
          ['Officers and directors', <Fact key="o" fact={facts.officers} />],
        ]} />
        {l.archived ? <p className={`m-0 mt-3 ${MUTED}`} data-testid="company-legal-archived">This company is archived. The primary admin can restore it.</p>
          : !l.can_edit ? <p className={`m-0 mt-3 ${MUTED}`} data-testid="company-legal-read-only">Only an admin of {name || 'this company'} can change this.</p> : null}
      </PCard>
      {editing ? (
        <LegalSheet uid={uid} companyName={name} legal={l} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setNotice('The legal facts are saved.'); reread(); }} />
      ) : null}
    </>
  );
}

function ProjectSettingsCard({ uid, companyName, child, onMoved }) {
  const id = child.id;
  const [tick, setTick] = useState(0);
  const reread = useCallback(() => setTick((n) => n + 1), []);
  const loadProject = useCallback(() => portfolio.through(() => api.getProject(id)), [id]);
  const loadMembers = useCallback(() => portfolio.through(() => teamsApi.listProjectMembers(id)), [id]);
  const loadAgents = useCallback(() => portfolio.projectAgents(id), [id]);
  const project = useBlock(loadProject, tick);
  const members = useBlock(loadMembers, tick);
  const agents = useBlock(loadAgents, tick);
  const [moving, setMoving] = useState(false);
  const team = members.status === 'ready' && Array.isArray(members.value?.members) ? members.value.members.length : null;
  const manage = members.status === 'ready' && !!members.value?.can_manage;
  const canEdit = members.status === 'ready' && !!members.value?.can_edit;
  const readOnlyReason = members.status === 'ready' ? members.value?.write_reason : null;
  const teamTo = companyProjectTeamPath(uid, id);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <PCard title={`${child.name} · settings`} testId="company-project-settings"
        aside={canEdit ? <Link to={`/projects/${encodeURIComponent(id)}`} className={LINK} data-testid="company-project-edit">Edit</Link> : null}>
        {project.status === 'loading' && !project.value ? <Reading /> : project.status !== 'ready' ? <Failed what="This project" onRetry={reread} testId="company-project-unread" /> : (
          <FactList testId="company-project-facts" rows={[
            ['Name', <Fact key="n" fact={valueFact(project.value.name)} />],
            ['Address', <Fact key="s" fact={valueFact(child.path)} mono />],
            ['Stage', <Fact key="st" fact={valueFact(stageWord(project.value.stage))} />],
            ['Team', members.status === 'loading' ? <span key="t" className={MUTED}>Reading…</span>
              : team == null ? <span key="t" className={MUTED} data-testid="company-project-team-unread">The team could not be read · <button type="button" className={LINK} onClick={reread}>Try again</button></span>
                : <span key="t">{team} {team === 1 ? 'person' : 'people'} · <Link to={teamTo} className={LINK}>Open Team</Link></span>],
            ['Agents', agents.status === 'loading' ? <span key="a" className={MUTED}>Reading…</span>
              : agents.status === 'ready' ? <span key="a" data-testid="company-project-agents">{agents.value} · <Link to={teamTo} className={LINK}>Open Team</Link> · <SkillsLink scope={{ kind: 'company_project', company: { uid }, project: { id } }} className={LINK} testId="company-project-skills-link" /></span>
                : agents.out?.unreadable ? <span key="a" className={MUTED} data-testid="company-project-agents-unread">Agents could not be read · <button type="button" className={LINK} onClick={reread}>Try again</button></span>
                  : <span key="a" className={MUTED} data-testid="company-project-agents-off">{agents.out?.reason || 'AI agents aren’t switched on yet.'}</span>],
          ]} />
        )}
        {members.status === 'ready' && !canEdit ? <p className={`m-0 mt-3 ${MUTED}`} data-testid="company-project-read-only">{readOnlyReason === 'support_session'
          ? 'A support session can read this project but cannot change it.'
          : readOnlyReason === 'hq_access' ? 'HQ reads this project. Its company members make the changes here.'
            : 'Only an authorised project editor can change this project.'}</p> : null}
      </PCard>
      {manage ? (
        <PCard title="Move" testId="company-project-move">
          <p className={`m-0 ${MUTED}`}>Moving {child.name} out of {companyName} makes it a standalone project. It no longer shows under {companyName}.</p>
          <button type="button" className={`mt-3 ${BTN_DANGER}`} onClick={() => setMoving(true)} data-testid="company-project-move-out">Move out of the company</button>
        </PCard>
      ) : null}
      {moving ? (
        <ActionDialog copy={moveOutCopy(child.name, companyName)} testId="move-out-dialog"
          run={() => companyActionsApi.moveProject(id, { company_id: null })} onClose={() => setMoving(false)}
          onDone={() => { setMoving(false); onMoved(`${child.name} is now a standalone project.`); }} />
      ) : null}
    </div>
  );
}

/**
 * #4964: the address names the record. No id redirects (explicitly, replacing the history entry) to the first
 * project's own address; an id the company does not hold is `notFound`, never another project's settings under it.
 */
export function chooseProject(children, projectId) {
  const asked = projectId == null || projectId === '' ? null : String(projectId);
  if (asked == null) return { asked, chosen: null, redirectTo: children.length ? children[0].id : null, notFound: false };
  const chosen = children.find((c) => c.id === asked) || null;
  return { asked, chosen, redirectTo: null, notFound: !chosen };
}

function ProjectsTab({ uid, name, projectId }) {
  const [tick, setTick] = useState(0);
  const reread = useCallback(() => setTick((n) => n + 1), []);
  const load = useCallback(() => portfolio.settingsScope({ company: uid }), [uid]);
  const scope = useBlock(load, tick);
  const [notice, setNotice] = useState('');
  const navigate = useNavigate();
  if (scope.status === 'loading' && !scope.value) return <PCard title="Projects"><Reading /></PCard>;
  const tab = scope.status === 'ready' ? (scope.value.tabs || []).find((t) => t.key === 'projects') : null;
  if (!tab || tab.available === false) return <PCard title="Projects" testId="company-projects-tab"><Failed what="The company’s projects" onRetry={reread} testId="company-projects-tab-unread" /></PCard>;
  const children = (tab.children || []).map((c) => ({ id: String(c.key).replace(/^projects:/, ''), name: c.label, path: String(c.path || '').replace(/\/settings\/general$/, '') || null }));
  const { asked, chosen, redirectTo } = chooseProject(children, projectId);
  if (redirectTo) return <Navigate replace to={companyProjectsPath(uid, redirectTo)} />;
  return (
    <div className="flex flex-col gap-3" data-testid="company-projects-tab">
      {notice ? <p role="status" className={`m-0 rounded-axal-md bg-axal-ground px-3 py-2 text-[12.5px] ${INK} dark:bg-gray-800`}>{notice}</p> : null}
      {!children.length ? <p className={`m-0 ${MUTED}`} data-testid="company-projects-tab-none">No project sits in {name || 'this company'} yet.</p> : (
        <div className="flex flex-col gap-4 md:flex-row">
          <nav aria-label="Projects" className="flex w-full shrink-0 flex-col gap-1 rounded-axal-lg border border-axal-hairline bg-white p-2 md:w-[240px] dark:border-gray-700 dark:bg-gray-900">
            {children.map((c) => (
              <NavLink key={c.id} to={companyProjectsPath(uid, c.id)} aria-current={chosen?.id === c.id ? 'page' : undefined}
                className={`flex flex-col rounded-axal-md px-2.5 py-2 ${chosen?.id === c.id ? 'bg-axal-lavender dark:bg-violet-900/30' : 'hover:bg-axal-ground dark:hover:bg-gray-800'}`} data-testid={`company-projects-nav-${c.id}`}>
                <span className="flex items-center gap-2"><ProjectMark name={c.name} size={22} /><b className={`text-[13px] ${INK}`}>{c.name}</b></span>
                {c.path ? <span className="font-mono text-[11px] text-axal-muted dark:text-gray-400">{c.path}</span> : null}
              </NavLink>
            ))}
          </nav>
          {chosen ? <ProjectSettingsCard key={chosen.id} uid={uid} companyName={name} child={chosen} onMoved={(m) => { setNotice(m); reread(); navigate(companyProjectsPath(uid), { replace: true }); }} />
            : asked != null ? (
              <PCard title="Project not found" testId="company-project-not-found">
                <p className={`m-0 ${MUTED}`}>{name || 'This company'} has no project at this address. It may have moved out of the company or been removed. Choose a project from the list.</p>
              </PCard>
            ) : null}
        </div>
      )}
    </div>
  );
}

/** The Legal and Projects tabs' page. General is `CompanySettingsAt`, which draws the same head. */
export default function CompanySettingsTabs({ tab }) {
  const { uid, id } = useParams();
  const load = useCallback(() => portfolio.through(() => teamsApi.getCompany(uid)), [uid]);
  const [tick, setTick] = useState(0);
  const reread = useCallback(() => setTick((n) => n + 1), []);
  const detail = useBlock(load, tick);
  const name = String(detail.value?.company_name || '').trim();
  usePublishScope(detail.status === 'ready' ? scopeFor({ company: { uid, name } }) : null);
  if (detail.status === 'notFound') {
    return <NotYours />;
  }
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 pb-8 pt-6 md:px-7" data-testid={`company-settings-${tab}`}>
      <SettingsHead uid={uid} name={name} tab={tab} />
      {detail.status === 'error' ? <Failed what="This company" onRetry={reread} testId="company-settings-unread" /> : null}
      {/* D1614 (#3976): the company's compliance tasks sit under Legal, a block that fails alone. */}
      {tab === 'legal' ? <><LegalTab uid={uid} name={name} /><ComplianceCard uid={uid} /></> : null}
      {tab === 'projects' ? <ProjectsTab uid={uid} name={name} projectId={id} /> : null}
    </div>
  );
}
