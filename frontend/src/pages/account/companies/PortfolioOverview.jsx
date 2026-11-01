import React from 'react';
import { Link } from 'react-router-dom';
import { Pill } from '../../../ui';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT } from '../../team/teamUi.jsx';
import {
  ACTIVE_HERE, canCreate, companyPathFor, companySettingsPathFor, incorporatePath, portfolioSections, projectPagePath,
} from './companiesModel';
import { CARD, CompanyMark, EYEBROW, Fact, Failed, INK, LINK, MUTED, ProjectMark, Reading, SlugChip, TypeBadge } from './portfolioUi.jsx';

/**
 * D1413 (#3696, PF1, PF7a–c2, PF7d) — Portfolio's overview: every company as
 * a card with its projects nested beneath, then the standalone projects, then
 * seats on projects in companies you are not in.
 *
 * READS, all made by the pane (`CompaniesProjects`), never here:
 *   `GET /api/account/companies` (D1136, D1412)  the cards: status, legal
 *                                                 line, location, team
 *   `GET /api/account/projects`  (D1136)          the projects, owned or seated
 *   `GET /api/account/switcher`  (D1415 part 2)   the addresses (slug chips);
 *                                                 a chip is not drawn without it
 * Never `GET /api/projects`, the every-venture read.
 *
 * A failed companies read is "Your companies could not be read" alone; a
 * failed projects read is "Its projects could not be read" under each card,
 * while the cards still draw (pf7c2).
 */

function ProjectRow({ p }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-800" data-testid={`portfolio-project-${p.id}`}>
      <ProjectMark name={p.name} size={28} />
      <Link to={projectPagePath(p.id)} className={`text-[13.5px] font-bold ${INK} hover:underline`}>{p.name}</Link>
      <TypeBadge kind="project" />
      <SlugChip path={p.path} />
      <span className={MUTED}>{p.stage || <Fact fact={{ kind: 'none' }} />}</span>
      <span className="ml-auto w-[96px] text-right font-mono text-[12px] text-axal-muted dark:text-gray-400" data-testid={`portfolio-project-team-${p.id}`}>
        {p.teamUnread ? 'Team could not be read' : p.team != null ? `Team ${p.team}` : <Fact fact={{ kind: 'none' }} />}
      </span>
      <Link to={projectPagePath(p.id)} className={LINK}>Open</Link>
    </li>
  );
}

function CompanyCard({ c, onAddProject, onRetry, profile, counts }) {
  const projects = c.projects;
  return (
    <article className={`${CARD} flex flex-col gap-3 !px-0 !pb-0 ${c.active ? 'ring-[3px] ring-axal-lavender dark:ring-violet-950/50' : ''}`} data-testid="company-card" data-uid={c.uid}>
      <div className="flex flex-wrap items-start gap-3 px-[18px]">
        <CompanyMark name={c.name} size={40} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <Link to={companyPathFor(c.uid)} className={`text-[16px] font-extrabold tracking-[-.01em] ${INK} hover:underline`} data-testid={`company-name-${c.uid}`}>{c.name}</Link>
            <TypeBadge kind="company" />
            {c.status ? <Pill tone={c.status.tone} data-testid="company-status">{c.status.label}</Pill> : null}
            {c.statusUnread ? <span className={MUTED} data-testid="company-status-unread">Status could not be read</span> : null}
            <SlugChip path={c.path} />
            {c.active ? <Pill tone="info" data-testid="company-active">{ACTIVE_HERE}</Pill> : null}
          </span>
          <span className={MUTED}>{c.role}</span>
        </div>
        <span className="flex items-center gap-2">
          <Link className={BTN_TEXT} to={companySettingsPathFor(c.uid)} data-testid={`company-settings-${c.uid}`}>Settings</Link>
          <Link className={BTN_SECONDARY} to={companyPathFor(c.uid)} data-testid={`company-open-${c.uid}`}>Open company</Link>
        </span>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 px-[18px] md:grid-cols-4" data-testid="company-facts">
        {[['Jurisdiction', c.jurisdiction], ['Entity type', c.entityType], ['Team', c.team], ['Location', c.location]].map(([k, f]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <dt className={EYEBROW}>{k}</dt>
            <dd className={`m-0 text-[13px] ${INK}`} data-testid={`company-fact-${k.toLowerCase().replace(/\s+/g, '-')}`}><Fact fact={f} /></dd>
          </div>
        ))}
      </dl>
      {counts ? <p className={`m-0 px-[18px] ${MUTED}`} data-testid="company-extra">{counts}</p> : null}
      <div className="rounded-b-axal-lg border-t border-axal-hairline bg-axal-ground/60 px-[18px] py-3 dark:border-gray-800 dark:bg-gray-950/40" data-testid="company-projects">
        <div className="flex items-center justify-between gap-2">
          <span className={EYEBROW}>Projects in this company{projects.available ? ` · ${projects.value.length}` : ''}</span>
          {canCreate(profile) ? <button type="button" className={BTN_TEXT} onClick={() => onAddProject(c)} data-testid={`company-add-project-${c.uid}`}>+ Add project</button> : null}
        </div>
        {!projects.available ? <div className="mt-2"><Failed what="Its projects" onRetry={onRetry} testId="company-projects-unread" /></div>
          : projects.value.length
            ? <ul className="m-0 mt-1 list-none p-0">{projects.value.map((p) => <ProjectRow key={p.id} p={p} />)}</ul>
            : <p className={`m-0 mt-1 ${MUTED}`} data-testid="company-projects-none">No projects yet.</p>}
      </div>
    </article>
  );
}

function StandaloneCard({ p }) {
  return (
    <article className={`${CARD} flex flex-col gap-2`} data-testid={`standalone-${p.id}`}>
      <span className="flex flex-wrap items-center gap-2">
        <ProjectMark name={p.name} size={36} />
        <Link to={projectPagePath(p.id)} className={`text-[14.5px] font-extrabold ${INK} hover:underline`}>{p.name}</Link>
        <TypeBadge kind="project" />
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <SlugChip path={p.path} />
        <span className={MUTED}>{p.stage || 'Stage not recorded'}</span>
        <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{p.teamUnread ? 'Team could not be read' : p.team != null ? `Team ${p.team}` : 'Team not recorded'}</span>
        <Pill tone="neutral" data-testid="not-a-company">Not a company yet</Pill>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <Link to={projectPagePath(p.id)} className={BTN_SECONDARY} data-testid={`standalone-open-${p.id}`}>Open project</Link>
        {p.owner ? <Link to={incorporatePath(p.id)} className={BTN_TEXT} data-testid={`standalone-incorporate-${p.id}`}>Make it a company</Link> : null}
      </span>
    </article>
  );
}

export default function PortfolioOverview({ companies, projects, switcher, activeUid, profile, onNew, retry, extraFor = null }) {
  if (companies.status === 'loading' && !companies.data) {
    return (
      <div className="flex flex-col gap-3" data-testid="portfolio-loading">
        <span className={EYEBROW}>Companies</span>
        <div className={CARD}><Reading /></div>
        <div className={CARD}><Reading lines={2} /></div>
        <span className={EYEBROW}>Standalone projects</span>
        <div className={CARD}><Reading lines={2} /></div>
      </div>
    );
  }
  if (companies.status === 'error') return <Failed what="Your companies" onRetry={retry} testId="companies-unreadable" />;
  const sections = portfolioSections(companies.data, projects.status === 'ready' ? projects.data : null, {
    activeUid, switcher: switcher.status === 'ready' ? switcher.data : null,
  });
  const projectsLoading = projects.status === 'loading' && !projects.data;
  const nothing = !sections.companies.length && sections.standalone.available && !sections.standalone.value.length
    && sections.seats.available && !sections.seats.value.length;
  if (nothing) {
    return (
      <div className={`${CARD} flex flex-col items-center gap-3 border-dashed px-6 py-10 text-center`} data-testid="portfolio-empty">
        <span className="flex gap-2"><CompanyMark name="+" size={36} /><ProjectMark name="+" size={36} /></span>
        <h3 className={`m-0 text-[15px] font-extrabold ${INK}`}>No company or project yet</h3>
        <p className={`m-0 max-w-[460px] ${MUTED}`}>Create a company for a legal entity, or a project to start working before you incorporate. You can move a project into a company later.</p>
        {canCreate(profile) ? (
          <span className="flex flex-wrap justify-center gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => onNew('project')} data-testid="portfolio-empty-project">New project</button>
            <button type="button" className={BTN_PRIMARY} onClick={() => onNew('company')} data-testid="portfolio-empty-company">New company</button>
          </span>
        ) : null}
      </div>
    );
  }
  const loadingProjects = projectsLoading ? { available: false, loading: true } : null;
  return (
    <div className="flex flex-col gap-3" data-testid="portfolio-overview">
      <span className={EYEBROW} data-testid="portfolio-companies-count">Companies · {sections.companies.length}</span>
      {sections.companies.length ? sections.companies.map((c) => (
        <CompanyCard key={c.uid} c={loadingProjects ? { ...c, projects: { available: true, value: [] } } : c} profile={profile}
          onAddProject={(co) => onNew('project', co)} onRetry={retry} counts={extraFor ? extraFor(c.uid) : null} />
      )) : (
        <div className={`${CARD} flex flex-wrap items-center justify-between gap-2`} data-testid="companies-none">
          <span className={MUTED}>{profile === 'hq' ? 'You belong to no company. HQ work does not need one.' : 'You don’t belong to a company yet. A company is a legal entity; create one, or accept an invitation.'}</span>
          {canCreate(profile) && profile !== 'hq' ? <button type="button" className={BTN_SECONDARY} onClick={() => onNew('company')} data-testid="companies-none-new">New company</button> : null}
        </div>
      )}
      <span className={EYEBROW} data-testid="portfolio-standalone-count">Standalone projects{sections.standalone.available ? ` · ${sections.standalone.value.length}` : ''}</span>
      {projectsLoading ? <div className={CARD}><Reading lines={2} /></div>
        : !sections.standalone.available ? <Failed what="Your standalone projects" onRetry={retry} testId="standalone-unread" />
          : sections.standalone.value.length
            ? <div className="grid gap-3 md:grid-cols-2">{sections.standalone.value.map((p) => <StandaloneCard key={p.id} p={p} />)}</div>
            : <p className={`m-0 ${MUTED}`} data-testid="standalone-none">No standalone project.</p>}
      {sections.seats.available && sections.seats.value.length ? (
        <>
          <span className={EYEBROW}>Seats on other ventures · {sections.seats.value.length}</span>
          <ul className={`${CARD} m-0 list-none`} data-testid="portfolio-seats">
            {sections.seats.value.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-800" data-testid={`seat-${p.id}`}>
                <ProjectMark name={p.name} size={28} />
                <Link to={projectPagePath(p.id)} className={`text-[13.5px] font-bold ${INK} hover:underline`}>{p.name}</Link>
                <span className={MUTED}>{p.companyName ? `in ${p.companyName} · ` : ''}your seat: {p.seat}</span>
              </li>
            ))}
            <li className={`pt-2 ${MUTED}`}>Each belongs to its owner’s company.</li>
          </ul>
        </>
      ) : null}
    </div>
  );
}
