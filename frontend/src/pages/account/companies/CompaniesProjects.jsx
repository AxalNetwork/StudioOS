import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getActiveCompanyId } from '../../../lib/api';
import { Unreadable } from '../../../ui';
import { ACTIVE_HERE, LINE, TABS, TITLE, WAITS, companyCards, projectGroups } from './companiesModel';

/**
 * D1134 (#2422) — Account › Companies and projects. Companies from the
 * switcher's own read; a founder's ventures grouped by company; invitations
 * and other profiles' ventures say what they wait for. Read-only: every write
 * stays where it is today until D1134's parts land (`companiesModel.js`).
 */

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const PILL = 'w-fit rounded-full border px-2 py-0.5 text-[10.5px] font-bold';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';

function useRead(load, enabled, reload) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', data: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setState({ status: 'loading', data: null });
    Promise.resolve().then(load)
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch(() => { if (alive) setState({ status: 'error', data: null }); });
    return () => { alive = false; };
  }, [load, enabled, reload]);
  return state;
}

const readCompanies = () => api.listMyCompanies();
const readProjects = () => api.listProjects();

function Skeleton({ testId }) {
  return <div className="h-20 w-full animate-pulse rounded-xl bg-axal-ground dark:bg-gray-800" aria-hidden="true" data-testid={testId} />;
}

function Wait({ text, testId }) {
  return <p className={`m-0 rounded-xl border border-dashed border-axal-hairline px-4 py-3 text-[12.5px] ${MUTED}`} data-testid={testId}>{text}</p>;
}

function Companies({ read, retry }) {
  if (read.status === 'loading') return <Skeleton testId="companies-loading" />;
  if (read.status === 'error') return <div data-testid="companies-unreadable"><Unreadable what="Your companies" claim="This is not a claim that you belong to none." onRetry={retry} /></div>;
  const cards = companyCards(read.data, getActiveCompanyId());
  if (!cards.length) return <p className={`m-0 text-[13px] ${MUTED}`} data-testid="companies-none">You do not belong to a company yet. The sidebar switcher can add one.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {cards.map((c) => (
        <section key={c.uid || c.id} className={`${CARD} flex flex-col gap-1.5 px-4 py-3`} data-testid="company-card">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`m-0 text-[15px] font-extrabold ${INK}`}>{c.name}</h3>
            {c.active && <span className={`${PILL} border-violet-300 text-axal-violet dark:border-violet-700 dark:text-violet-300`} data-testid="company-active">{ACTIVE_HERE}</span>}
            {c.primary && <span className={`${PILL} border-axal-hairline ${MUTED}`}>Primary admin</span>}
          </div>
          <p className={`m-0 text-[12.5px] ${INK}`}>Your role: {c.role}{c.stage ? ` · Stage: ${c.stage}` : ''}</p>
          <p className={`m-0 text-[12px] ${MUTED}`}>
            {c.members == null ? 'Members: not read' : `${c.members} member${c.members === 1 ? '' : 's'}`} · {c.cycles}{c.lastOpened ? ` · last opened ${c.lastOpened}` : ''}
          </p>
        </section>
      ))}
      <p className={`m-0 text-[12px] md:col-span-2 ${MUTED}`} data-testid="companies-manage-note">
        {WAITS.manage} <Link className={LINK} to="/company-settings">Company Settings</Link>
      </p>
    </div>
  );
}

function Projects({ founder, projects, companies, retry }) {
  if (!founder) return <Wait text={WAITS.projects} testId="projects-wait" />;
  if (projects.status === 'loading' || companies.status === 'loading') return <Skeleton testId="projects-loading" />;
  if (projects.status === 'error') return <div data-testid="projects-unreadable"><Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={retry} /></div>;
  const groups = projectGroups(projects.data, companies.status === 'ready' ? companies.data : []);
  if (!groups.length) return <p className={`m-0 text-[13px] ${MUTED}`} data-testid="projects-none">No ventures yet.</p>;
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <section key={g.key} className={`${CARD} px-4 py-3`} data-testid="project-group">
          <h3 className={`m-0 mb-2 text-[13.5px] font-extrabold ${INK}`}>{g.title}</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {g.rows.map((r) => (
              <li key={r.id} className={`text-[12.5px] ${INK}`} data-testid="project-row">
                {r.name} <span className={MUTED}>· {r.stage}{r.week ? ` · ${r.week.replace('_', ' ')}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function CompaniesProjects({ role }) {
  const [tab, setTab] = useState('companies');
  const [reload, setReload] = useState(0);
  const retry = useCallback(() => setReload((n) => n + 1), []);
  const founder = String(role || '').toLowerCase() === 'founder';
  const companies = useRead(readCompanies, true, reload);
  const projects = useRead(readProjects, founder && tab === 'projects', reload);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="companies-projects">
      <header className="flex flex-col gap-1">
        <h2 className={`m-0 text-[18px] font-extrabold tracking-[-.015em] ${INK}`}>{TITLE}</h2>
        <p className={`m-0 text-[12.5px] ${MUTED}`}>{LINE}</p>
      </header>
      <div className="flex gap-1 border-b border-axal-hairline dark:border-gray-700" role="tablist" aria-label={TITLE} data-testid="companies-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} onClick={() => setTab(t.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] ${t.id === tab
              ? 'border-axal-violet font-extrabold text-axal-ink dark:border-violet-400 dark:text-gray-100'
              : 'border-transparent font-semibold text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}
            data-testid={`companies-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'companies' && <Companies read={companies} retry={retry} />}
      {tab === 'projects' && <Projects founder={founder} projects={projects} companies={companies} retry={retry} />}
      {tab === 'invitations' && <Wait text={WAITS.invitations} testId="invitations-wait" />}
    </div>
  );
}
