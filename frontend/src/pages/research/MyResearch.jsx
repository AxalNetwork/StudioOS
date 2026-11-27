/**
 * D5157 (#5157) — My Research (`/research/projects`): the caller's Research
 * Projects, a New research form, and the canvas's empty state (RS-11 "No
 * research projects"). Cards follow RS-01's project card
 * (`design/incoming/Research v2 Page.dc.html`, `pcard`).
 *
 * HONEST STATES. The list is loading, unreadable (with Retry, never an empty
 * list) or read. Evidence counts are counts of stored links, so "No evidence
 * yet" is a recorded zero. The canvas's progress bar is the share of key
 * questions answered, which is not stored, so no bar is drawn.
 *
 * ARCHIVED projects sit under their own tab. Restore is not destructive and
 * runs on press; archiving happens in the project, through Scope → Review →
 * Result.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Pill } from '../../ui';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import { researchProjectsApi } from '../../lib/api/researchProjects.js';
import { shortDate } from './researchHome.js';
import { LIMITS, draftBody, draftErrors, newFromSearch, projectList } from './researchProjects.js';

const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-violet-700 px-4 text-[13px] font-bold text-white hover:bg-violet-800 disabled:opacity-50 sm:min-h-[36px] dark:bg-violet-600 dark:hover:bg-violet-700';
const SECONDARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[13px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 sm:min-h-[36px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const CARD = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const INPUT = 'w-full rounded-md border border-axal-hairline bg-white px-2.5 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

/** One read with its own status and retry; `key` re-reads. */
export function useProjectRead(fetcher, key) {
  const ref = useRef(fetcher);
  ref.current = fetcher;
  const [read, setRead] = useState({ status: 'loading', value: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setRead((r) => ({ status: 'loading', value: r.value }));
    ref.current().then(
      (value) => { if (live) setRead({ status: 'ok', value }); },
      (e) => { if (live) setRead({ status: e?.status === 404 ? 'not_found' : 'failed', value: null }); },
    );
    return () => { live = false; };
  }, [key, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [read, retry];
}

function Field({ id, label, hint, error, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12.5px] font-bold text-axal-ink dark:text-white">{label}{hint ? <span className="font-normal text-axal-muted dark:text-gray-400"> · {hint}</span> : null}</label>
      {children}
      {error ? <span id={`${id}-error`} role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-300">{error}</span> : null}
    </div>
  );
}

/** The New research form: the question first; the title defaults to it. */
export function NewResearchForm({ initialQuestion = '', onCreated, onCancel }) {
  const [draft, setDraft] = useState({ question: initialQuestion, title: '', objective: '', scope: '', exclusions: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const set = (name) => (e) => setDraft((d) => ({ ...d, [name]: e.target.value }));
  const submit = async (e) => {
    e?.preventDefault?.();
    const found = draftErrors(draft, { creating: true });
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(null);
    try {
      const res = await researchProjectsApi.create(draftBody(draft, { creating: true }));
      onCreated?.(res?.item);
    } catch (err) {
      setFailure(err?.message || 'The project could not be created.');
    } finally {
      setBusy(false);
    }
  };
  const area = (name, rows, label, hint) => (
    <Field id={`np-${name}`} label={label} hint={hint} error={errors[name]}>
      <textarea id={`np-${name}`} rows={rows} value={draft[name]} onChange={set(name)} maxLength={LIMITS[name]} className={INPUT}
        aria-invalid={errors[name] ? 'true' : undefined} aria-describedby={errors[name] ? `np-${name}-error` : undefined} data-testid={`input-project-${name}`} />
    </Field>
  );
  return (
    <form className={CARD} onSubmit={submit} data-testid="form-new-research" aria-labelledby="np-heading">
      <h2 id="np-heading" className="text-[15px] font-extrabold text-axal-ink dark:text-white">New research</h2>
      {area('question', 2, 'What would you like to investigate?', 'required')}
      <Field id="np-title" label="Title" hint="optional — the question is used if you leave it empty" error={errors.title}>
        <input id="np-title" value={draft.title} onChange={set('title')} maxLength={LIMITS.title} className={INPUT} data-testid="input-project-title" />
      </Field>
      {area('objective', 2, 'Objective', 'optional')}
      <div className="grid gap-3 sm:grid-cols-2">
        {area('scope', 2, 'Scope', 'optional')}
        {area('exclusions', 2, 'Excluded', 'optional')}
      </div>
      {failure ? <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="status-project-create-failed">{failure} Nothing was created.</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? <button type="button" className={SECONDARY} onClick={onCancel} disabled={busy}>Cancel</button> : null}
        <button type="submit" className={PRIMARY} disabled={busy} data-testid="button-create-project">{busy ? 'Creating…' : 'Create project'}</button>
      </div>
    </form>
  );
}

function ProjectCard({ card, onRestore, restoring }) {
  return (
    <article className={CARD} data-testid={`project-card-${card.uid}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[14.5px] font-extrabold leading-snug text-axal-ink dark:text-white">{card.title}</h3>
        <Pill tone={card.status.tone} className="shrink-0 !text-[10.5px]">{card.status.label}</Pill>
      </div>
      {card.question && card.question !== card.title ? <p className="text-[12.5px] text-axal-muted dark:text-gray-400">{card.question}</p> : null}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-axal-muted dark:text-gray-400">
        <span data-testid={`project-evidence-${card.uid}`}>{card.evidence}</span>
        <span>{card.ask}</span>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-axal-faint dark:text-gray-500">{card.archived ? `Archived ${shortDate(card.archivedAt)}` : `Updated ${shortDate(card.updated)}`}</span>
        {card.archived
          ? <button type="button" className={SECONDARY} onClick={() => onRestore(card)} disabled={restoring} data-testid={`button-restore-${card.uid}`}>{restoring ? 'Restoring…' : 'Restore'}</button>
          : <Link className="text-[12.5px] font-bold text-violet-700 hover:text-violet-900 dark:text-violet-300" to={card.to} data-testid={`link-project-${card.uid}`}>Continue →</Link>}
      </div>
    </article>
  );
}

export default function MyResearch({ role = 'founder' }) {
  const location = useLocation();
  const navigate = useNavigate();
  const wanted = newFromSearch(location.search);
  const [creating, setCreating] = useState(wanted.open);
  const [tab, setTab] = useState('active');
  const [restoring, setRestoring] = useState(null);
  const [notice, setNotice] = useState(null);
  const [read, retry] = useProjectRead(() => researchProjectsApi.list(tab), tab);
  const list = projectList(read);

  const created = (item) => {
    if (item?.uid) navigate(`/research/projects/${encodeURIComponent(item.uid)}`);
  };
  const restore = async (card) => {
    setRestoring(card.uid);
    setNotice(null);
    try {
      await researchProjectsApi.restore(card.uid);
      setNotice({ ok: true, text: `“${card.title}” is back in your active research.` });
      retry();
    } catch (err) {
      setNotice({ ok: false, text: `“${card.title}” could not be restored. ${err?.message || ''}`.trim() });
    } finally {
      setRestoring(null);
    }
  };

  const tabs = [['active', 'Active'], ['archived', list.state === 'ok' && list.archivedCount ? `Archived · ${list.archivedCount}` : 'Archived']];
  return (
    <WorkspaceShell role={role} title="My Research" activeSlug="projects" ask={null}
      primary={creating ? null : { label: 'New research', onClick: () => setCreating(true), testid: 'button-new-research-project' }}>
      <div className="flex flex-col gap-4" data-testid="my-research">
        <p className="text-[13.5px] text-axal-muted dark:text-gray-400">Each project keeps one question together with its evidence and your Ask history.</p>
        {creating ? <NewResearchForm initialQuestion={wanted.question} onCreated={created} onCancel={() => setCreating(false)} /> : null}
        <div role="tablist" aria-label="Project status" className="flex gap-2">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={`tab-projects-${key}`}
              className={`min-h-[44px] rounded-lg px-3 text-[12.5px] font-bold sm:min-h-[32px] ${tab === key ? 'bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200' : 'text-axal-muted hover:bg-axal-ground dark:text-gray-400 dark:hover:bg-gray-800'}`}>{label}</button>
          ))}
        </div>
        {notice ? <p role="status" className={`text-[12.5px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`} data-testid="status-projects-notice">{notice.text}</p> : null}
        {list.state === 'loading' ? <p className="text-[12.5px] text-axal-muted dark:text-gray-400" role="status">Reading your research…</p> : null}
        {list.state === 'unreadable' || list.state === 'not_found' ? (
          <div role="status" className={CARD} data-testid="projects-unreadable">
            <strong className="text-axal-ink dark:text-white">Could not be read</strong>
            <p className="text-[12.5px] text-axal-muted dark:text-gray-400">Your research projects could not be read just now. That is not the same as having none.</p>
            <button type="button" className={SECONDARY} onClick={retry} data-testid="button-projects-retry">Retry</button>
          </div>
        ) : null}
        {list.state === 'ok' && !list.cards.length ? (
          tab === 'active' ? (
            <div className={CARD} data-testid="projects-empty">
              <strong className="text-[15px] text-axal-ink dark:text-white">No research yet</strong>
              <p className="text-[13px] text-axal-muted dark:text-gray-400">Start with a question; a project keeps your evidence and findings together.</p>
              {creating ? null : <button type="button" className={`${PRIMARY} self-start`} onClick={() => setCreating(true)} data-testid="button-empty-new-research">New research</button>}
            </div>
          ) : <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="projects-archived-empty">No archived projects.</p>
        ) : null}
        {list.state === 'ok' && list.cards.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.cards.map((card) => <ProjectCard key={card.uid} card={card} onRestore={restore} restoring={restoring === card.uid} />)}
          </div>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}
