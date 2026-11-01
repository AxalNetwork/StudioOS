import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill } from '../../../ui';
import { api } from '../../../lib/api';
import { teamsApi } from '../../../lib/api/teams';
import { useActiveCompany } from '../../../contexts/ActiveCompanyContext';
import { projectSettingsPath, projectTeamPath, companyProjectTeamPath, scopeFor, usePublishScope } from '../../../lib/settingsScope.js';
import { MoveUnderSheet } from '../../team/ProjectSettingsPage.jsx';
import { managedNote } from '../../team/teamModel.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT } from '../../team/teamUi.jsx';
import { through } from './portfolioAdapter.js';
import {
  BASE_PATH, companyPathFor, companyProjectsPath, day, incorporatePath, jurisdictionName, legalFormWord, seatWord, stageWord, valueFact,
} from './companiesModel';
import { CompanyMark, Fact, FactList, Failed, INK, LINK, MUTED, PCard, ProjectMark, Reading, SlugChip, TypeBadge } from './portfolioUi.jsx';

/**
 * D1413 (#3696, PF3a, PF3b) — a project's page, at
 * `/account/portfolio/projects/<id>`.
 *
 *   PF3a  linked to a company: the company's card (name, address, its legal
 *         form and jurisdiction from D1412's summary) with Open company, and
 *         who governs the project in Team's words (`managedNote`, D1497);
 *   PF3b  not a company yet: "Make it a company" opens Incorporate with the
 *         project prefilled (D1414, `/incorporate?project=<id>`), and "Or
 *         move it under an existing company" is Team's Move sheet (D1137).
 *
 * READS: `GET /api/projects/:id` (facts; a project you cannot see reads "This
 * project is not yours to open"), `GET /api/projects/:id/members` (team and
 * who may manage), and the pane's D1136 and D1415 reads for its company and
 * address. People appear by name, never by email.
 */

function useBlock(load, tick) {
  const [s, set] = useState({ status: 'loading', value: null });
  useEffect(() => {
    let alive = true;
    set((x) => ({ status: 'loading', value: x.value }));
    Promise.resolve().then(load).then((out) => {
      if (!alive) return;
      set(out && out.available ? { status: 'ready', value: out.value } : { status: out?.notFound || out?.refused ? 'notFound' : 'error', value: null });
    });
    return () => { alive = false; };
  }, [load, tick]);
  return s;
}

export default function ProjectPage({ id, projects = null, summary = null, paths = null }) {
  const { companies } = useActiveCompany();
  const [tick, setTick] = useState(0);
  const reread = useCallback(() => setTick((n) => n + 1), []);
  const loadProject = useCallback(() => through(() => api.getProject(id)), [id]);
  const loadMembers = useCallback(() => through(() => teamsApi.listProjectMembers(id)), [id]);
  const project = useBlock(loadProject, tick);
  const members = useBlock(loadMembers, tick);
  const [moving, setMoving] = useState(false);
  const [notice, setNotice] = useState('');

  const p = project.value;
  const row = (projects?.projects || []).find((x) => String(x.id) === String(id)) || null;
  const inCompany = p ? p.company_id != null : row ? !!row.company_uid : null;
  const company = inCompany ? { uid: row?.company_uid || null, name: row?.company_name || null } : null;
  const summaryRow = company?.uid ? (summary?.companies || []).find((c) => c.uid === company.uid) || null : null;
  const name = String(p?.name || row?.name || '').trim() || 'This project';
  const ready = project.status === 'ready';
  const scope = scopeFor({ project: { id, name, company } });
  usePublishScope(ready ? scope : null);

  if (project.status === 'notFound') {
    return (
      <div className="flex flex-col gap-3" data-testid="project-not-yours">
        <Link to={BASE_PATH} className={LINK}>‹ Portfolio</Link>
        <p className={`m-0 text-[14px] font-bold ${INK}`}>This project is not yours to open.</p>
        <Link to={BASE_PATH} className={BTN_SECONDARY}>Back to Portfolio</Link>
      </div>
    );
  }

  const manage = members.status === 'ready' && !!members.value?.can_manage;
  const owner = members.status === 'ready' && members.value?.my_role === 'owner';
  const settingsTo = company?.uid ? companyProjectsPath(company.uid, id) : projectSettingsPath(id);
  const teamTo = company?.uid ? companyProjectTeamPath(company.uid, id) : projectTeamPath(id);
  const legal = summaryRow?.legal?.available ? summaryRow.legal.value : null;
  const team = members.status === 'ready' && Array.isArray(members.value?.members) ? members.value.members : null;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="project-page" data-scope={ready ? scope.kind : 'loading'}>
      <Link to={BASE_PATH} className={`w-fit ${LINK}`}>‹ Portfolio</Link>
      <header className="flex flex-wrap items-start gap-3">
        <ProjectMark name={name} size={44} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className={`m-0 text-[22px] font-extrabold tracking-[-.02em] ${INK}`} data-testid="project-page-name">{name}</h2>
          <span className="flex flex-wrap items-center gap-2"><TypeBadge kind="project" /><SlugChip path={paths?.get?.(`p-${id}`) || null} /></span>
        </div>
        <Link to={settingsTo} className={BTN_SECONDARY} data-testid="project-page-settings">Project settings</Link>
      </header>
      {notice ? <p role="status" className={`m-0 rounded-axal-md bg-axal-ground px-3 py-2 text-[12.5px] ${INK} dark:bg-gray-800`}>{notice}</p> : null}

      {!ready ? <PCard title="Company"><Reading lines={2} /></PCard> : inCompany ? (
        <PCard title="Linked company" testId="project-linked-company">
          <div className="flex flex-wrap items-center gap-3 rounded-axal-md border border-violet-200 bg-axal-lavender px-3 py-3 dark:border-violet-800 dark:bg-violet-900/20">
            <CompanyMark name={company.name || '?'} size={36} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                {company.uid ? <Link to={companyPathFor(company.uid)} className={`text-[14px] font-extrabold ${INK} hover:underline`}>{company.name || 'Its company'}</Link> : <b className={INK}>{company.name || 'A company you are not in'}</b>}
                <TypeBadge kind="company" />
                <SlugChip path={company.uid ? paths?.get?.(company.uid) || null : null} />
              </span>
              {legal ? <span className={MUTED} data-testid="project-company-legal">{[jurisdictionName(legal.jurisdiction), legalFormWord(legal.legal_form)].filter(Boolean).join(' · ') || 'Legal facts not recorded'}</span> : null}
            </span>
            {company.uid ? <Link to={companyPathFor(company.uid)} className={LINK} data-testid="project-open-company">Open company</Link> : null}
          </div>
          <p className={`m-0 mt-2 ${MUTED}`} data-testid="project-managed">{managedNote(company.name || 'its company')}</p>
        </PCard>
      ) : (
        <PCard title="Company" testId="project-not-a-company">
          <div className="flex flex-col gap-2 rounded-axal-md border border-dashed border-axal-hairline bg-axal-ground/60 px-4 py-4 dark:border-gray-700 dark:bg-gray-950/40">
            <b className={`text-[14px] ${INK}`}>Not a company yet</b>
            <p className={`m-0 ${MUTED}`}>{name} is a standalone project. It is not a legal entity. Make it a company when you are ready to incorporate.</p>
            {owner ? (
              <>
                <Link to={incorporatePath(id)} className={`w-fit ${BTN_PRIMARY}`} aria-describedby="inc-note" data-testid="project-make-company">Make it a company</Link>
                <p id="inc-note" className={`m-0 ${MUTED}`}>Opens Incorporate with {name} filled in. Nothing is filed until you submit there.</p>
              </>
            ) : null}
            {manage ? <button type="button" className={`w-fit ${BTN_TEXT}`} onClick={() => setMoving(true)} data-testid="project-move-under">Or move it under an existing company</button> : null}
          </div>
        </PCard>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <PCard title="Project details" testId="project-details" aside={<Link to={`/projects/${encodeURIComponent(id)}`} className={LINK}>Edit</Link>}>
          {!ready ? (project.status === 'error' ? <Failed what="This project" onRetry={reread} testId="project-unread" /> : <Reading />) : (
            <FactList testId="project-facts" rows={[
              ['Name', <Fact key="n" fact={valueFact(p.name)} />],
              ['Address', <Fact key="s" fact={valueFact(paths?.get?.(`p-${id}`) || null)} mono />],
              ['Stage', <Fact key="st" fact={valueFact(stageWord(p.stage))} />],
              ['Sector', <Fact key="se" fact={valueFact(p.sector)} />],
              ['Created', <Fact key="c" fact={valueFact(day(p.created_at))} mono />],
              ['Location', <Fact key="l" fact={valueFact(p.hq)} />],
            ]} />
          )}
        </PCard>
        <PCard title="Team" count={team ? team.length : null} testId="project-team" aside={<Link to={teamTo} className={LINK}>Open Team</Link>}>
          {members.status === 'loading' && !members.value ? <Reading lines={2} />
            : !team ? <Failed what="The team" onRetry={reread} testId="project-team-unread" />
              : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {team.map((m) => (
                    <li key={m.user_id} className="flex items-center gap-2" data-testid="project-member">
                      <span className={`text-[13px] font-semibold ${INK}`}>{String(m.name || '').trim() || 'Name not recorded'}</span>
                      <Pill tone="neutral">{seatWord(m.role)}</Pill>
                    </li>
                  ))}
                </ul>
              )}
        </PCard>
      </div>

      {moving ? (
        <MoveUnderSheet project={{ id, name }} companies={companies} onClose={() => setMoving(false)}
          onDone={(c) => { setMoving(false); setNotice(`${name} is now under ${c.name}.`); reread(); }} />
      ) : null}
    </div>
  );
}
