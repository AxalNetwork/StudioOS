import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Sheet, Unrecorded } from '../../ui';
import { api } from '../../lib/api';
import { accountCompaniesApi } from '../../lib/api/accountCompanies.js';
import { companyActionsApi } from '../../lib/api/companyActions.js';
import { teamsApi } from '../../lib/api/teams.js';
import { reportError } from '../../lib/log';
import { useActiveCompany } from '../../contexts/ActiveCompanyContext';
import { projectCompany, projectsOfCompany, scopeFor, usePublishScope } from '../../lib/settingsScope.js';
import { ActionDialog } from '../account/companies/LifecycleDialogs.jsx';
import { day, incorporatePath, lifecycleRefusal, stageWord } from '../account/companies/companiesModel.js';
import { BTN_PRIMARY, BTN_SECONDARY, BTN_TEXT, EYEBROW, MUTED, TeamCard } from './teamUi.jsx';
import { initials, moveOutCopy, moveTarget, moveUnderLines } from './teamModel.js';

/**
 * D1497 (#3727, TM1g2, TM1h) — Project settings › General, at
 * `/projects/:id/settings`: the project's name and details, and the company it
 * sits under.
 *
 * A standalone project is not a legal entity and governs itself: it offers
 * "Move under a company", a Sheet listing your companies, where only a
 * company you edit can take it in. A project in a company offers "Move out"
 * (TM1h). Both write `POST /api/projects/:id/move` (D1137), which only the
 * project's manager may call; for anyone else the buttons are not drawn. The
 * confirm says only what the Worker does today (`moveUnderLines`).
 *
 * There is no Legal entry here, or anywhere for a standalone project.
 *
 * Until the project is read, the page names no scope: the Company card says
 * "Reading…" (a project under a company is never first called standalone),
 * `data-scope` is "loading", and the sidebar is not told a scope.
 */

export function MoveUnderSheet({ project, companies, onClose, onDone }) {
  const options = (companies || []).map(moveTarget);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const chosen = options.find((o) => o.uid === pick);
  const go = async () => {
    if (!chosen?.editor || busy) return;
    setBusy(true); setRefusal('');
    try { await companyActionsApi.moveProject(project.id, { company_id: Number(chosen.id) }); onDone(chosen); } catch (e) { reportError('team:move-under', e); setRefusal(lifecycleRefusal(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title="Move under a company" sub={`${project.name} · standalone project`} width={520} onClose={onClose} testId="move-under-sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} disabled={!chosen?.editor || busy} onClick={go} data-testid="move-under-confirm">{chosen ? `Move under ${chosen.name}` : 'Move'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-5">
        {options.length ? (
          <div role="radiogroup" aria-label="Company" className="flex flex-col gap-1.5">
            {options.map((o) => (
              <label key={o.uid} aria-disabled={!o.editor || undefined}
                className={`flex min-h-[52px] items-center gap-3 rounded-axal-md border px-3 py-2 ${pick === o.uid ? 'border-axal-violet bg-axal-lavender dark:border-violet-500 dark:bg-violet-900/30' : 'border-axal-hairline dark:border-gray-700'} ${o.editor ? 'cursor-pointer' : 'cursor-not-allowed opacity-55'}`}
                data-testid={`move-under-${o.uid}`}>
                <input type="radio" name="company" disabled={!o.editor} checked={pick === o.uid} onChange={() => setPick(o.uid)} className="accent-violet-600" />
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-axal-sm bg-axal-ground font-mono text-[11px] font-bold text-axal-ink dark:bg-gray-800 dark:text-gray-100">{initials(o.name)}</span>
                <span className="min-w-0"><b className="block text-[13.5px] text-axal-ink dark:text-gray-100">{o.name}</b><span className={MUTED}>{o.line}</span></span>
              </label>
            ))}
          </div>
        ) : <p className={`m-0 ${MUTED}`}>You belong to no company yet. Create one from the company switcher.</p>}
        {chosen?.editor ? (
          <div className="rounded-axal-md bg-axal-lavender px-3 py-2.5 dark:bg-violet-900/20" data-testid="move-under-note">
            {moveUnderLines(chosen.name).map((l) => <p key={l} className="m-0 text-[12.5px] text-axal-ink dark:text-gray-100">{l}</p>)}
          </div>
        ) : null}
        {refusal ? <p role="alert" className="m-0 text-[12.5px] text-axal-destructive dark:text-red-300">{refusal}</p> : null}
      </div>
    </Sheet>
  );
}

export default function ProjectSettingsPage() {
  const { id } = useParams();
  const { companies } = useActiveCompany();
  const [state, setState] = useState({ status: 'loading' });
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState('');
  const known = useRef(companies);
  known.current = companies;
  const load = useCallback(async () => {
    try {
      const [project, members, mine] = await Promise.all([
        api.getProject(id), teamsApi.listProjectMembers(id).catch(() => null), accountCompaniesApi.projects().catch(() => null),
      ]);
      const row = (mine?.projects || []).find((p) => String(p.id) === String(id));
      const company = projectCompany(project, { row, companies: known.current });
      setState({ status: 'ready', project, manage: !!members?.can_manage, company, projects: projectsOfCompany(mine?.projects, company?.uid) });
    } catch (e) {
      setState({ status: 'error', error: e });
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const p = state.project;
  const ready = state.status === 'ready';
  const scope = scopeFor({ project: { id, name: p?.name, company: state.company }, projects: state.projects });
  usePublishScope(ready ? scope : null);

  if (state.status === 'error') {
    return <div className="p-6"><p className={MUTED} role="alert">This project could not be read. {state.error?.status === 403 ? 'Only its members see its settings.' : 'Try again.'}</p></div>;
  }
  const name = scope.project.name;
  return (
    <div className="flex flex-col gap-[18px] px-4 pb-8 pt-6 md:px-7" data-testid="project-settings" data-scope={ready ? scope.kind : 'loading'}>
      <header>
        <p className={`m-0 ${EYEBROW}`}>Project settings</p>
        <h1 className="m-0 text-[26px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">General</h1>
        <p className={`m-0 ${MUTED}`}>The name and details of {name}.</p>
      </header>
      {notice ? <p role="status" className="m-0 rounded-axal-md bg-axal-ink px-4 py-2.5 text-[13px] font-semibold text-white dark:bg-gray-100 dark:text-gray-900">✓ {notice}</p> : null}
      <TeamCard title="General" testId="project-settings-general">
        {state.status === 'loading' ? <p className={MUTED}>Reading…</p> : (
          <dl className="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
            <dt className="font-mono text-[12px] text-axal-muted dark:text-gray-400">Project name</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{p?.name || <Unrecorded />}</dd>
            <dt className="font-mono text-[12px] text-axal-muted dark:text-gray-400">Stage</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{stageWord(p?.stage) || <Unrecorded />}</dd>
            <dt className="font-mono text-[12px] text-axal-muted dark:text-gray-400">Sector</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{p?.sector || <Unrecorded />}</dd>
            <dt className="font-mono text-[12px] text-axal-muted dark:text-gray-400">Created</dt><dd className="m-0 text-axal-ink dark:text-gray-100">{day(p?.created_at) || <Unrecorded />}</dd>
          </dl>
        )}
        <Link to={`/projects/${encodeURIComponent(id)}`} className={`mt-3 ${BTN_TEXT}`}>Edit on the project page</Link>
      </TeamCard>
      <TeamCard title="Company" testId="project-settings-company">
        {!ready ? <p className={MUTED} data-testid="project-settings-company-reading">Reading…</p> : scope.kind === 'project' ? (
          <>
            <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="project-settings-standalone">{name} is a standalone project. It is not a legal entity, and it governs itself. Its Owner manages its team and agents.</p>
            {/* D1413 (#3696, PF6b): Make it a company opens Incorporate with this project (D1414); or move it under one you belong to. */}
            {state.manage ? (
              <span className="mt-3 flex flex-wrap gap-2">
                <Link to={incorporatePath(id)} className={BTN_PRIMARY} data-testid="project-settings-incorporate">Make it a company</Link>
                <button type="button" className={BTN_SECONDARY} onClick={() => setOpen('under')} data-testid="move-under-open">Move under a company</button>
              </span>
            ) : null}
          </>
        ) : scope.kind === 'company_project' ? (
          <>
            <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{name} sits under {scope.company.name}, a legal entity that governs it.</p>
            {state.manage ? <button type="button" className={`mt-3 ${BTN_SECONDARY}`} onClick={() => setOpen('out')} data-testid="move-out-open">Move out of {scope.company.name}</button> : null}
          </>
        ) : null}
      </TeamCard>
      {open === 'under' ? (
        <MoveUnderSheet project={{ id, name }} companies={companies} onClose={() => setOpen(null)}
          onDone={(c) => { setOpen(null); setNotice(`${name} is now under ${c.name}.`); load(); }} />
      ) : null}
      {open === 'out' ? (
        <ActionDialog copy={moveOutCopy(name, scope.company.name)} testId="move-out-dialog"
          run={() => companyActionsApi.moveProject(id, { company_id: null })} onClose={() => setOpen(null)}
          onDone={() => { setOpen(null); setNotice(`${name} is now a standalone project.`); load(); }} />
      ) : null}
    </div>
  );
}
