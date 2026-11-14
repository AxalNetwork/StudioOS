/**
 * D5157 (#5157) — the Research Project workspace (`/research/projects/:uid`,
 * `/research/projects/:uid/evidence`), to RS-02 A · Overview and B · Evidence
 * in `design/incoming/Research v2 Page.dc.html`.
 *
 * WHAT IS BUILT HERE. The project bar (title, status, last saved, sources),
 * the five tabs, the Overview (objective, scope and exclusions with Edit; the
 * question; progress as a fraction of what is stored; the Ask history kept
 * with the project) and the Evidence table (index state and "In Ask" apart,
 * passages used, where each source came from), Add evidence from the Library,
 * and Archive through Scope → Review → Result.
 *
 * Part 2 (D5157-p2): the Findings tab (`/research/projects/:uid/findings`,
 * `ProjectFindings.jsx`) and the Overview's Most recent findings, both from
 * one read of the findings store.
 *
 * Part 3 (D5157-p3): the Comparisons tab (`/research/projects/:uid/comparisons`,
 * `ProjectComparisons.jsx`): the project's companies and funds and its
 * comparisons, and the bar's Compare, which opens it.
 *
 * Part 4 (D5157-p4): the Brief tab reads and saves the member's eight sections.
 * Key questions are not stored, so no "2 of 5" is drawn.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Pill } from '../../ui';
import { Unrecorded } from '../../ui/Honesty';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import ActionDialog, { BTN_DANGER, BTN_PLAIN, BTN_PRIMARY, ScopeBox } from '../hq/security/ActionDialog.jsx';
import { api } from '../../lib/api';
import { researchProjectsApi } from '../../lib/api/researchProjects.js';
import { shortDate } from './researchHome.js';
import { NOT_RECORDED } from './researchStates.js';
import { useProjectRead } from './MyResearch.jsx';
import { ProjectFindings, RecentFindingsCard } from './ProjectFindings.jsx';
import { researchProjectFindingsApi } from '../../lib/api/researchProjectFindings.js';
import { findingsBadge } from './researchFindings.js';
import { ProjectComparisons } from './ProjectComparisons.jsx';
import ProjectBrief from './ProjectBrief.jsx';
import { researchProjectBriefsApi } from '../../lib/api/researchProjectBriefs.js';
import { researchProjectComparisonsApi } from '../../lib/api/researchProjectComparisons.js';
import { comparisonsBadge } from './researchComparisons.js';
import {
  LIMITS, NOT_STORED, PROJECT_TABS, archiveScope, draftBody, draftErrors, evidenceRows, progressFractions, statusOf,
} from './researchProjects.js';

const CARD = 'flex flex-col gap-3 rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900';
const SECONDARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 sm:min-h-[32px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const INPUT = 'w-full rounded-md border border-axal-hairline bg-white px-2.5 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const H2 = 'text-[14px] font-extrabold text-axal-ink dark:text-white';
const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const mark = (s) => <><span aria-hidden="true">{s.glyph}</span> {s.label}</>;

function Tabs({ uid, current, evidenceCount, findingsCount, comparisonsCount }) {
  return (
    <nav aria-label="Project" className="flex flex-wrap gap-1 border-b border-axal-hairline dark:border-gray-800" data-testid="project-tabs">
      {PROJECT_TABS.map((t) => {
        const base = 'inline-flex min-h-[44px] items-center gap-1.5 px-3 text-[13px] font-bold sm:min-h-[36px]';
        const count = t.slug === 'evidence' ? evidenceCount : t.slug === 'findings' ? findingsCount : t.slug === 'comparisons' ? comparisonsCount : null;
        const badge = count != null ? <span className="rounded-full bg-axal-ground px-1.5 text-[11px] dark:bg-gray-800" data-testid={`project-tab-count-${t.slug}`}>{count}</span> : null;
        if (!t.built) {
          return <span key={t.slug} aria-disabled="true" title={NOT_STORED.tab} className={`${base} cursor-not-allowed text-axal-faint dark:text-gray-600`} data-testid={`project-tab-${t.slug}`}>{t.label}</span>;
        }
        const on = t.slug === current;
        const to = `/research/projects/${encodeURIComponent(uid)}${t.slug === 'overview' ? '' : `/${t.slug}`}`;
        return (
          <Link key={t.slug} to={to} aria-current={on ? 'page' : undefined} data-testid={`project-tab-${t.slug}`}
            className={`${base} -mb-px border-b-2 ${on ? 'border-violet-700 text-violet-800 dark:border-violet-400 dark:text-violet-200' : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-white'}`}>
            {t.label}{badge}
          </Link>
        );
      })}
    </nav>
  );
}

function EditProject({ item, onSaved, onCancel }) {
  const [draft, setDraft] = useState({
    title: item.title || '', question: item.question || '', objective: item.objective || '', scope: item.scope || '', exclusions: item.exclusions || '',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const set = (name) => (e) => setDraft((d) => ({ ...d, [name]: e.target.value }));
  const save = async (e) => {
    e?.preventDefault?.();
    const found = draftErrors(draft);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(null);
    try {
      await researchProjectsApi.update(item.uid, draftBody(draft));
      onSaved();
    } catch (err) {
      setFailure(`${err?.message || 'Could not be saved.'} Nothing was changed.`);
    } finally { setBusy(false); }
  };
  const field = (name, label, rows) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={`ep-${name}`} className="text-[12.5px] font-bold text-axal-ink dark:text-white">{label}</label>
      {rows
        ? <textarea id={`ep-${name}`} rows={rows} value={draft[name]} onChange={set(name)} maxLength={LIMITS[name]} className={INPUT} data-testid={`input-edit-${name}`} aria-invalid={errors[name] ? 'true' : undefined} />
        : <input id={`ep-${name}`} value={draft[name]} onChange={set(name)} maxLength={LIMITS[name]} className={INPUT} data-testid={`input-edit-${name}`} aria-invalid={errors[name] ? 'true' : undefined} />}
      {errors[name] ? <span role="alert" className="text-[12px] font-semibold text-red-700 dark:text-red-300">{errors[name]}</span> : null}
    </div>
  );
  return (
    <form onSubmit={save} className="flex flex-col gap-3" data-testid="form-edit-project">
      {field('title', 'Title')}
      {field('question', 'Question', 2)}
      {field('objective', 'Objective', 3)}
      {field('scope', 'Scope', 2)}
      {field('exclusions', 'Excluded', 2)}
      {failure ? <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">{failure}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={SECONDARY} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className={BTN_PRIMARY} disabled={busy} data-testid="button-save-project">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

/** A stored text, or Not recorded — never an empty line. */
const Text = ({ value, testid }) => (value ? <span data-testid={testid}>{value}</span> : <span data-testid={testid}><Unrecorded /></span>);

function Overview({ data, archived, onSaved, findings, retryFindings }) {
  const item = data.item;
  const [editing, setEditing] = useState(false);
  const progress = progressFractions(data);
  const answers = Array.isArray(data.answers) ? data.answers : [];
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <section className={`${CARD} lg:col-span-7`} data-testid="project-objective">
        <div className="flex items-center justify-between gap-2">
          <h2 className={H2}>Objective</h2>
          {!archived && !editing ? <button type="button" className={SECONDARY} onClick={() => setEditing(true)} data-testid="button-edit-project">Edit</button> : null}
        </div>
        {editing ? <EditProject item={item} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved(); }} /> : (
          <>
            <p className="text-[13.5px] leading-relaxed text-axal-ink dark:text-gray-100"><Text value={item.objective} testid="project-objective-text" /></p>
            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
              <dt className="font-bold text-axal-muted dark:text-gray-400">Question</dt><dd className="text-axal-ink dark:text-gray-100">{item.question}</dd>
              <dt className="font-bold text-axal-muted dark:text-gray-400">Scope</dt><dd className="text-axal-ink dark:text-gray-100"><Text value={item.scope} testid="project-scope" /></dd>
              <dt className="font-bold text-axal-muted dark:text-gray-400">Excluded</dt><dd className="text-axal-ink dark:text-gray-100"><Text value={item.exclusions} testid="project-exclusions" /></dd>
            </dl>
          </>
        )}
      </section>
      <section className={`${CARD} lg:col-span-5`} data-testid="project-progress">
        <h2 className={H2}>Progress</h2>
        <div>
          <b className="text-[22px] font-extrabold text-axal-ink dark:text-white" data-testid="project-progress-answerable">{progress.answerable.n} <span className="text-[14px] font-bold text-axal-muted dark:text-gray-400">of {progress.answerable.of}</span></b>
          <p className={MUTED}>evidence sources answerable in Ask</p>
        </div>
        <div>
          <b className="text-[13px] text-axal-ink dark:text-white">Key questions answered</b>
          <p className={MUTED}><Unrecorded /> · {progress.keyQuestions.reason}</p>
        </div>
      </section>
      <section className={`${CARD} lg:col-span-7`} data-testid="project-ask">
        <div className="flex items-center justify-between gap-2">
          <h2 className={H2}>Ask history in this project</h2>
          <Link className="text-[12.5px] font-bold text-violet-700 dark:text-violet-300" to="/research/ask">Ask →</Link>
        </div>
        {answers.length ? (
          <ul className="flex flex-col gap-2">
            {answers.slice(0, 5).map((a) => (
              <li key={a.uid} className="flex items-start justify-between gap-2 text-[12.5px]">
                <span className="text-axal-ink dark:text-gray-100">{a.question}</span>
                <span className="shrink-0 text-axal-faint dark:text-gray-500">{shortDate(a.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className={MUTED} data-testid="project-ask-empty">No Ask session or answer is kept with this project yet.</p>}
      </section>
      <RecentFindingsCard projectUid={item.uid} read={findings} retry={retryFindings} className="lg:col-span-5" />
    </div>
  );
}

function AddEvidence({ uid, inProject, onAdded, onClose }) {
  const [docs, retryDocs] = useProjectRead(() => api.research.documents(), 'docs');
  const [cols, retryCols] = useProjectRead(() => api.research.collections(), 'cols');
  const [busy, setBusy] = useState(null);
  const [failure, setFailure] = useState(null);
  const add = async (kind, target, label) => {
    setBusy(target);
    setFailure(null);
    try {
      await researchProjectsApi.link(uid, kind, target);
      onAdded();
    } catch (err) {
      setFailure(`${label} could not be added. ${err?.message || ''}`.trim());
    } finally { setBusy(null); }
  };
  const ownDocs = (docs.value?.items || []).filter((d) => d.source !== 'client' && !inProject.has(d.uid));
  const collections = cols.value?.items || [];
  return (
    <section className={CARD} data-testid="add-evidence" aria-labelledby="ae-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ae-heading" className={H2}>Add evidence from your Library</h2>
        <button type="button" className={SECONDARY} onClick={onClose}>Done</button>
      </div>
      {failure ? <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">{failure}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-[12.5px] font-bold text-axal-ink dark:text-white">Documents</h3>
          {docs.status === 'loading' ? <p className={MUTED} role="status">Reading your Library…</p> : null}
          {docs.status === 'failed' ? <p className={MUTED} role="status">Your Library could not be read. <button type="button" className="underline" onClick={retryDocs}>Retry</button></p> : null}
          {docs.status === 'ok' && !ownDocs.length ? <p className={MUTED} data-testid="add-evidence-none">Every document in your Library is already in this project, or the Library is empty. <Link className="underline" to="/research/library">Open Library</Link></p> : null}
          <ul className="flex flex-col gap-1.5">
            {ownDocs.map((d) => (
              <li key={d.uid} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="min-w-0 truncate text-axal-ink dark:text-gray-100">{d.title}</span>
                <button type="button" className={SECONDARY} disabled={busy === d.uid} onClick={() => add('documents', d.uid, `“${d.title}”`)} data-testid={`button-add-doc-${d.uid}`}>Add</button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-[12.5px] font-bold text-axal-ink dark:text-white">Collections</h3>
          {cols.status === 'failed' ? <p className={MUTED} role="status">Your collections could not be read. <button type="button" className="underline" onClick={retryCols}>Retry</button></p> : null}
          {cols.status === 'ok' && !collections.length ? <p className={MUTED}>You have no collections. Group documents in the Library to add them together.</p> : null}
          <ul className="flex flex-col gap-1.5">
            {collections.map((col) => (
              <li key={col.uid} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="min-w-0 truncate text-axal-ink dark:text-gray-100">{col.name} <span className="text-axal-faint dark:text-gray-500">· {(col.document_uids || []).length} documents</span></span>
                <button type="button" className={SECONDARY} disabled={busy === col.uid} onClick={() => add('collections', col.uid, `“${col.name}”`)} data-testid={`button-add-col-${col.uid}`}>Add</button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Evidence({ data, archived, adding, setAdding, onChanged }) {
  const rows = evidenceRows(data);
  const [failure, setFailure] = useState(null);
  const inProject = useMemo(() => new Set(rows.filter((r) => r.direct).map((r) => r.uid)), [rows]);
  const remove = async (r) => {
    setFailure(null);
    try {
      await researchProjectsApi.unlink(data.item.uid, 'documents', r.uid);
      onChanged();
    } catch (err) {
      setFailure(`“${r.title}” could not be removed. ${err?.message || ''}`.trim());
    }
  };
  const unattributed = Number(data.passages_unattributed || 0);
  return (
    <div className="flex flex-col gap-4">
      {adding && !archived ? <AddEvidence uid={data.item.uid} inProject={inProject} onAdded={onChanged} onClose={() => setAdding(false)} /> : null}
      {failure ? <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">{failure}</p> : null}
      {!rows.length ? (
        <section className={CARD} data-testid="evidence-empty">
          <strong className="text-axal-ink dark:text-white">No evidence yet</strong>
          <p className={MUTED}>Add documents or collections from your Library. Ask can cite a source once it is indexed.</p>
        </section>
      ) : (
        <>
          <section className={`${CARD} hidden !p-0 sm:flex`} data-testid="evidence-table">
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-[11px] uppercase tracking-wide text-axal-muted dark:text-gray-400">
                <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Year</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2">Index</th><th className="px-3 py-2">In Ask</th><th className="px-3 py-2 text-right">Passages used</th><th className="px-3 py-2"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.uid} className="border-t border-axal-hairline align-top dark:border-gray-800" data-testid={`evidence-row-${r.uid}`}>
                    <td className="px-3 py-2 text-axal-muted dark:text-gray-400">{r.n}</td>
                    <td className="px-3 py-2"><b className="text-axal-ink dark:text-white">{r.title}</b><small className="block text-axal-muted dark:text-gray-400">{r.origin}</small></td>
                    <td className="px-3 py-2">{r.year ?? <Unrecorded />}</td>
                    <td className="px-3 py-2 capitalize">{r.kind ?? <Unrecorded />}</td>
                    <td className="px-3 py-2">You</td>
                    <td className="px-3 py-2"><Pill tone={r.index.tone} className="!text-[10.5px]">{mark(r.index)}</Pill>{r.note ? <small className="block text-axal-muted dark:text-gray-400">{r.note} · <Link className="underline" to="/research/library">Open Library</Link></small> : null}</td>
                    <td className="px-3 py-2"><Pill tone={r.answer.tone} className="!text-[10.5px]">{mark(r.answer)}</Pill></td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.passages ?? NOT_RECORDED}</td>
                    <td className="px-3 py-2 text-right">{r.direct && !archived ? <button type="button" className="text-[12px] font-bold text-axal-muted underline hover:text-axal-ink dark:text-gray-400 dark:hover:text-white" onClick={() => remove(r)} data-testid={`button-remove-${r.uid}`}>Remove</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {/* Phone (RS-10C's pattern): each source is a card with both states. */}
          <ul className="flex flex-col gap-2 sm:hidden" data-testid="evidence-cards">
            {rows.map((r) => (
              <li key={r.uid} className={CARD}>
                <b className="text-axal-ink dark:text-white">{r.title}</b>
                <span className={MUTED}>{r.origin}</span>
                <span className="flex flex-wrap gap-1.5"><Pill tone={r.index.tone} className="!text-[10.5px]">{mark(r.index)}</Pill><Pill tone={r.answer.tone} className="!text-[10.5px]">{mark(r.answer)}</Pill></span>
                <span className={MUTED}>Passages used: {r.passages ?? NOT_RECORDED}</span>
                {r.direct && !archived ? <button type="button" className={SECONDARY} onClick={() => remove(r)}>Remove from project</button> : null}
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-axal-faint dark:text-gray-500">
            Removing a source takes it out of this project only; it stays in your Library. A source added through a collection leaves with the collection.
            {unattributed ? ` ${unattributed} cited ${unattributed === 1 ? 'passage was' : 'passages were'} recorded without its document, so ${unattributed === 1 ? 'it is' : 'they are'} not counted against a source.` : ''}
          </p>
        </>
      )}
    </div>
  );
}

/** Archive: Scope → Review → Result, in the page (never `window.confirm`). */
function ArchiveDialog({ data, onClose, onArchived }) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const run = async () => {
    setBusy(true);
    try {
      await researchProjectsApi.archive(data.item.uid);
      setResult({ ok: true });
    } catch (err) {
      setResult({ ok: false, message: err?.message || 'The project could not be archived.' });
    } finally { setBusy(false); setStep(3); }
  };
  const footer = step === 1 ? [
    <button key="c" type="button" className={BTN_PLAIN} onClick={onClose}>Cancel</button>,
    <button key="n" type="button" className={BTN_PRIMARY} onClick={() => setStep(2)} data-testid="button-archive-review">Review</button>,
  ] : step === 2 ? [
    <button key="b" type="button" className={BTN_PLAIN} onClick={() => setStep(1)} disabled={busy}>Back</button>,
    <button key="a" type="button" className={BTN_DANGER} onClick={run} disabled={busy} data-testid="button-archive-confirm">{busy ? 'Archiving…' : 'Archive project'}</button>,
  ] : [
    result?.ok
      ? <button key="d" type="button" className={BTN_PRIMARY} onClick={onArchived} data-testid="button-archive-done">Back to My Research</button>
      : <button key="d" type="button" className={BTN_PLAIN} onClick={onClose}>Close</button>,
  ];
  return (
    <ActionDialog id="archive-project" title={`Archive “${data.item.title}”`} step={step} busy={busy} onClose={onClose} footer={footer} testid="dialog-archive-project">
      {step === 1 ? <ScopeBox title="What archiving does" items={archiveScope(data)} testid="archive-scope" /> : null}
      {step === 2 ? <p className="text-[13px] text-axal-ink dark:text-gray-100" data-testid="archive-review">Archive “{data.item.title}”? It stops appearing in your active research and can no longer be edited until you restore it.</p> : null}
      {step === 3 ? (
        result?.ok
          ? <p role="status" className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid="archive-result">Archived. It is under My Research › Archived, and Restore brings it back.</p>
          : <p role="alert" className="text-[13px] font-semibold text-red-700 dark:text-red-300" data-testid="archive-result">{result?.message} Nothing was archived.</p>
      ) : null}
    </ActionDialog>
  );
}

export default function ResearchProject({ role = 'founder', tab = 'overview' }) {
  const { uid } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);
  const [read, retry] = useProjectRead(() => researchProjectsApi.read(uid), `${uid}:${version}`);
  // Part 2: the findings are read once for the tab, its badge and the Overview card.
  const [findings, retryFindings] = useProjectRead(() => researchProjectFindingsApi.list(uid), `${uid}:${version}`);
  // Part 3: the comparisons are read once for the tab and its badge.
  const [compared, retryCompared] = useProjectRead(() => researchProjectComparisonsApi.list(uid), `${uid}:${version}`);
  const [brief, retryBrief] = useProjectRead(() => researchProjectBriefsApi.read(uid), `${uid}:${version}`);
  const [adding, setAdding] = useState(() => new URLSearchParams(location.search).get('add') === '1');
  const [archiving, setArchiving] = useState(false);
  const [restoreFailure, setRestoreFailure] = useState(null);
  const opener = useRef(null);
  const reload = () => setVersion((n) => n + 1);
  const data = read.status === 'ok' ? read.value : null;
  const item = data?.item || null;
  const archived = item?.status === 'archived';
  const status = statusOf(item);

  const restore = async () => {
    setRestoreFailure(null);
    try { await researchProjectsApi.restore(item.uid); reload(); } catch (err) { setRestoreFailure(err?.message || 'Could not be restored.'); }
  };
  const addEvidence = () => {
    setAdding(true);
    if (tab !== 'evidence') navigate(`/research/projects/${encodeURIComponent(uid)}/evidence`);
  };

  return (
    <WorkspaceShell role={role} title={item?.title || 'Research project'} activeSlug="projects" ask={null}
      primary={item && !archived ? { label: 'Add evidence', onClick: addEvidence, testid: 'button-add-evidence' } : null}>
      <div className="flex flex-col gap-4" data-testid="research-project">
        {read.status === 'loading' && !data ? <p className={MUTED} role="status">Reading the project…</p> : null}
        {read.status === 'not_found' ? (
          <section className={CARD} data-testid="project-not-found">
            <strong className="text-axal-ink dark:text-white">No such project</strong>
            <p className={MUTED}>This project does not exist, or it is not yours. <Link className="underline" to="/research/projects">My Research</Link></p>
          </section>
        ) : null}
        {read.status === 'failed' ? (
          <section className={CARD} role="status" data-testid="project-unreadable">
            <strong className="text-axal-ink dark:text-white">Could not be read</strong>
            <p className={MUTED}>This project could not be read just now. Nothing about it has changed.</p>
            <button type="button" className={`${SECONDARY} self-start`} onClick={retry} data-testid="button-project-retry">Retry</button>
          </section>
        ) : null}
        {item ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="project-meta">
                <Pill tone={status.tone} className="!text-[10.5px]">{status.label}</Pill>
                <span>Saved {shortDate(item.updated_at)}</span>
                <span>{(data.evidence || []).length} {(data.evidence || []).length === 1 ? 'source' : 'sources'}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {/* RS-02's bar: Compare opens the Comparisons tab, where a comparison is made. */}
                {tab !== 'comparisons' ? <Link className={SECONDARY} to={`/research/projects/${encodeURIComponent(item.uid)}/comparisons`} data-testid="button-project-compare">Compare</Link> : null}
                {archived
                  ? <button type="button" className={SECONDARY} onClick={restore} data-testid="button-restore-project">Restore</button>
                  : <button type="button" ref={opener} className={SECONDARY} onClick={() => setArchiving(true)} data-testid="button-archive-project">Archive</button>}
              </div>
            </div>
            {archived ? <p role="status" className="rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] text-axal-muted dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300" data-testid="project-archived-note">Archived {shortDate(item.archived_at)}. This project is read-only until you restore it.</p> : null}
            {restoreFailure ? <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300">{restoreFailure}</p> : null}
            <Tabs uid={item.uid} current={tab} evidenceCount={(data.evidence || []).length} findingsCount={findingsBadge(findings)} comparisonsCount={comparisonsBadge(compared)} />
            {tab === 'evidence' ? <Evidence data={data} archived={archived} adding={adding} setAdding={setAdding} onChanged={reload} /> : null}
            {tab === 'findings' ? <ProjectFindings projectUid={item.uid} read={findings} retry={retryFindings} archived={archived} onChanged={reload} /> : null}
            {tab === 'comparisons' ? <ProjectComparisons projectUid={item.uid} read={compared} retry={retryCompared} archived={archived} onChanged={reload} /> : null}
            {tab === 'brief' ? <ProjectBrief uid={item.uid} read={brief} retry={retryBrief} archived={archived} /> : null}
            {tab === 'overview' ? <Overview data={data} archived={archived} onSaved={reload} findings={findings} retryFindings={retryFindings} /> : null}
            {archiving ? <ArchiveDialog data={data} onClose={() => setArchiving(false)} onArchived={() => navigate('/research/projects')} /> : null}
          </>
        ) : null}
      </div>
    </WorkspaceShell>
  );
}

export { Overview as ProjectOverview, Evidence as ProjectEvidence, ArchiveDialog };
