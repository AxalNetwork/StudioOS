import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Card, Pill, StateChip, Unrecorded, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import { competitorReviewApi } from '../../lib/api/competitorReview.js';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import { StatedLimit } from '../advisor/expertise/kit';
import { download, fetchExport, loadExport } from '../../components/CompetitorAnalysis';
import ExportPreview from './ExportPreview.jsx';
import { useEscapeClose } from '../../components/useEscapeClose.js';
import { PhoneSheet, SheetRow } from '../../ui/phone/PhoneSheet.jsx';
import {
  analysisTiles, candidateSupport, classificationWord, failedReads, featureGrid, findingsOf, inputsRow, landscapeRead,
  notesWithRead, reviseHref, runStartedAt, runSteps, signalColumns, sourceFetched,
} from './companyAnalysisRead';
import { EvidenceChip, SubjectBar, useSubjectRecord } from './AnalysisSubject.jsx';
import {
  FIELD_WORD, GENERATED_SECTIONS, ORIGIN_WORD, PROPOSAL_FIELDS, changesText, competitorsAfter, contentCounts,
  defaultSelection, dirtyFields, draftFrom, exportFilename, exportProblem, mergeDraft, outputFrom, proposalText, reviewCounts,
} from './companyAnalysisDraft';
import { companyHref } from '../../lib/companyDirectoryView.js';
import { useRailOption } from '../../ui/railCrumbs';
import { railPressHeaders } from '../../lib/railPage.js';
import { createRecordGate, recordKey, sameRecord } from './recordGate.js';
import { useLeaveGuard } from '../../lib/leaveGuard.js';
import { backToResults } from './companyDirectoryState.js';

/**
 * `/research/companies/:id` — one saved competitor analysis (canvas 90eb4cf2),
 * rebuilt to the saved-analyses canvas (D7042, boards RS-14 A2 to G; D7176).
 *
 * IT REPLACES `/build/competitors?id=` FOR FOUNDERS (D313). That route opened
 * the same analysis inside `CompetitorAnalysis`'s in-place panel; this page is
 * the canvas's reading of it, and the old route now redirects here. The
 * component stays: the startup page embeds it, and the Companies zone lists
 * saved analyses through it and links each one here.
 *
 * THREE STATES, THREE SHAPES (`companyAnalysisRead.js`): a failed read draws
 * no tiles, a failed run draws Not recorded tiles and withholds the body, and
 * a finished run draws its numbers — 0 included, because a run that found
 * nothing is a fact.
 *
 * NO ACTION ERASES THE DRAFT (D7176). Every answer is merged into the draft
 * (`companyAnalysisDraft.js`): a field the person changed keeps their text.
 * Refresh fetches the stored sources again and nothing else; a rerun opens a
 * review and replaces nothing until Accept; export writes the SAVED version,
 * and asks first when the draft is dirty. Each failure keeps the dossier open
 * with Retry.
 *
 * SAVE SENDS THE TITLE AND THE OUTPUT. Candidate edits use the one-company
 * route, which preserves evidence and changes only permitted fields. D7814
 * also makes list saves update those fields in place, retaining candidate
 * identities and their scores, pricing, sources and signals.
 * Each save names the version it was made on; an older one answers 409.
 *
 * THE LANDSCAPE READ IS A RESTATEMENT, NOT A MODEL, as the canvas draws it:
 * it repeats the summary, the companies and the source kinds already on the
 * page, and Accept appends it to your notes.
 *
 * D7175 (#7175, canvas D7041, boards RS-13 B1–B5, C1–C3): the subject bar and
 * the evidence status sit under the title; findings cite the sources they
 * were read from, Interpretation is kept apart, the run's next steps are
 * Suggested research questions, the subject is listed as excluded, and each
 * Direct or Adjacent shows its reason and its sources, read or Unavailable.
 * Insufficient evidence, No candidates and Sources unavailable each have
 * their own shape. Preview Markdown, in the Export menu, shows the saved
 * version's file before it is downloaded.
 *
 * D7175 part 2 (`D7175-p2.md`): the preview has Markdown and JSON tabs
 * (`ExportPreview.jsx`) and returns focus to what opened it; the competitor
 * table has the canvas's columns (Company, Classification, Why · support,
 * Sources, Relevance) and the inputs row a Region; loading draws the tiles
 * with skeleton values; a running analysis says when it started
 * (`created_at`); "What the run did" prints each step's time when the run
 * recorded it (`output.run_steps`); and a run opened from setup lands focus
 * on the page's h1.
 */

const STATUS_TONE = { complete: 'ok', running: 'info', error: 'danger', draft: 'neutral' };
const eyebrow = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';
const th = 'pb-2 text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint';
const inputClass = 'w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] text-axal-ink '
  + 'placeholder:text-axal-faint focus:border-violet-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const primaryBtn = 'min-h-[32px] rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-800 '
  + 'disabled:cursor-not-allowed disabled:bg-violet-200 disabled:text-violet-800 dark:bg-violet-500 dark:hover:bg-violet-400 dark:disabled:bg-violet-950 dark:disabled:text-violet-300';
const ghostBtn = 'min-h-[32px] rounded-lg border border-axal-hairline px-3 py-1.5 text-[12px] font-semibold text-axal-ink hover:bg-axal-ground '
  + 'disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800';
const alertBox = 'flex items-start gap-3 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-axal-ink '
  + 'dark:border-red-900 dark:bg-red-950/40 dark:text-gray-100';
const okBox = 'flex items-start gap-3 rounded-[10px] border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-axal-ink '
  + 'dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-gray-100';

const EMPTY_MANUAL = { name: '', url: '', summary: '', category: 'direct', crawl: true };
const citeChip = 'inline-flex min-w-[22px] items-center justify-center rounded-md border border-violet-200 bg-violet-50 px-1 font-mono text-[10.5px] font-bold text-violet-800 hover:underline dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200';

/** One source as a chip: its number and kind when read, Unavailable with its status when not (RS-13 B1, B2). */
function SourceChip({ chip }) {
  if (!chip.ok) return <StateChip kind="unavailable" label={chip.label} title={chip.url} />;
  return (
    <a href={chip.url} target="_blank" rel="noreferrer" aria-label={`Source ${chip.n}, ${chip.label}`}
      className="inline-flex items-center gap-1 rounded-full border border-axal-hairline px-2 text-[11px] font-semibold leading-[1.6] text-axal-ink hover:border-violet-400 dark:border-gray-700 dark:text-gray-100">
      <span className="font-mono text-violet-700 dark:text-violet-300">{chip.n}</span>{chip.label}
    </a>
  );
}

/** One finding: its tag, its words and the sources it cites, or "No source in this run". */
function FindingRow({ f, urlOf }) {
  return (
    <li className="flex flex-col gap-1 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-800 sm:flex-row sm:items-start sm:gap-3">
      <span className="flex shrink-0 flex-wrap items-center gap-1.5 sm:w-44">
        <span className="text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint">
          {f.kind === 'interpretation' ? 'Interpretation' : f.noSource ? 'Run statement' : 'Source fact'}
        </span>
        {f.noSource ? <StateChip kind="partial" label="No source in this run" /> : null}
      </span>
      <span className="flex-1 text-[12.5px] leading-relaxed text-axal-ink dark:text-gray-100">{f.text}</span>
      <span className="flex shrink-0 flex-wrap gap-1">
        {f.cites.map((n) => (
          <a key={n} href={urlOf(n)} target="_blank" rel="noreferrer" aria-label={`Source ${n}`} className={citeChip}>{n}</a>
        ))}
      </span>
    </li>
  );
}
/**
 * Focus the page's h1 (RS-13 C4). The shell draws one h1 per page (D593); it
 * is made focusable for this, and only this, move.
 */
export function focusPageHeading(doc = typeof document === 'undefined' ? null : document) {
  const h = doc?.querySelector?.('h1');
  if (!h) return false;
  h.setAttribute?.('tabindex', '-1');
  h.focus?.();
  return true;
}
const stamp = (v) => {
  if (!v) return null;
  const s = String(v);
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(t.getTime()) ? null : t;
};
const day = (v) => {
  const t = stamp(v);
  return t ? t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : (v ? String(v) : null);
};
const dayTime = (v) => {
  const t = stamp(v);
  return t ? `${t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} ${t.toTimeString().slice(0, 5)}` : null;
};
const clock = (v) => stamp(v)?.toTimeString().slice(0, 5) || null;
/** A proposed competitor's relevance as the review words it; a blank score is left out, never 0. */
const relevanceOf = (s) => (s == null ? null : `relevance ${s} / 100`);

/** The four kinds of content in a dossier (RS-14 A2), plus the edited mark on generated text. */
const KIND = {
  gen: ['Generated by the run', 'border-dashed border-violet-300 text-violet-800 dark:border-violet-700 dark:text-violet-300'],
  you: ['Yours', 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200'],
  man: ['Attached by you', 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200'],
  fet: ['Fetched', 'border-gray-300 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'],
  ed: ['Edited by you', 'border-violet-400 text-violet-800 dark:border-violet-600 dark:text-violet-200'],
};
function KindTag({ kind, children }) {
  const [word, cls] = KIND[kind];
  return (
    <span data-kind={kind} className={`inline-flex items-center rounded-md border px-1.5 py-px text-[10.5px] font-bold leading-[1.6] ${cls}`}>
      {children || word}
    </span>
  );
}

/** Saved, Unsaved changes, Saving and Save failed (RS-14 A2 B). A failure is an alert; the rest are polite. */
function SaveStatus({ state, version, savedAt, fields }) {
  const words = { ok: 'Saved', dirty: 'Unsaved changes', busy: 'Saving…', fail: 'Save failed' };
  const tone = {
    ok: 'text-emerald-700 dark:text-emerald-300',
    dirty: 'text-amber-800 dark:text-amber-300',
    busy: 'text-axal-muted',
    fail: 'text-red-700 dark:text-red-300',
  };
  const sub = state === 'ok' ? `v${version}${savedAt ? ` · ${savedAt}` : ''}` : state === 'dirty' ? fields.join(', ') : '';
  return (
    <span role={state === 'fail' ? 'alert' : 'status'} data-save-state={state} className={`text-[12px] font-bold ${tone[state]}`}>
      {words[state]}
      {sub ? <small className="ml-1.5 font-mono text-[11px] font-medium text-axal-muted">{sub}</small> : null}
    </span>
  );
}

function Tile({ k, v, sub, nr }) {
  return (
    <Card>
      <div className={eyebrow}>{k}</div>
      {nr
        ? <div className="mt-2"><Unrecorded /></div>
        : <div className="mt-1.5 font-mono text-[20px] font-bold tracking-tight text-axal-ink dark:text-gray-100">{v}</div>}
      <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">{sub}</p>
    </Card>
  );
}

/** One editable text field with its kind tags, and Not recorded under it while it is empty. */
function TextSection({ title, tags, value, onChange, placeholder, emptyReason, rows = 3, dirty }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12.5px] font-bold">{title}</span>
        {tags}
        {dirty ? <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300">· not saved</span> : null}
      </div>
      <textarea
        aria-label={title}
        className={`${inputClass} mt-1.5`}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {!String(value || '').trim() && (
        <p className="mt-1.5 text-[11.5px] text-axal-muted"><Unrecorded /> <span className="ml-1">{emptyReason}</span></p>
      )}
    </div>
  );
}

/** A failure that keeps the dossier open: what failed, what is unchanged, and Retry. */
function FailAlert({ title, children, actions, alertRef, testId }) {
  return (
    <div ref={alertRef} role="alert" tabIndex={-1} className={alertBox} data-testid={testId}>
      <span aria-hidden="true" className="mt-0.5 grid h-[18px] w-[18px] flex-none place-items-center rounded-full bg-red-700 text-[11px] font-extrabold text-white dark:bg-red-400 dark:text-gray-950">!</span>
      <div className="min-w-0 flex-1">
        <b className="block">{title}</b>
        {children}
        {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** A result, said once in a polite region. */
function OkNote({ title, children, noteRef, testId }) {
  return (
    <div ref={noteRef} role="status" tabIndex={-1} className={okBox} data-testid={testId}>
      <span aria-hidden="true" className="mt-0.5 grid h-[18px] w-[18px] flex-none place-items-center rounded-full bg-emerald-700 text-[11px] font-extrabold text-white dark:bg-emerald-400 dark:text-gray-950">✓</span>
      <div className="min-w-0 flex-1"><b className="block">{title}</b>{children}</div>
    </div>
  );
}

/** "Export with unsaved changes?" (RS-14 C1 B, E F). Save, then export is the default (owner answer A). */
function ExportDecision({ format, version, fields, draftTitle, onCancel, onExportSaved, onSaveThenExport }) {
  const primary = useRef(null);
  useEscapeClose(onCancel);
  useEffect(() => { primary.current?.focus?.(); }, []);
  const label = format === 'md' ? 'Markdown' : 'JSON';
  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="absolute inset-0 bg-[rgba(24,24,27,.42)] dark:bg-[rgba(3,7,18,.66)]" onClick={onCancel} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-labelledby="export-decision-title" data-testid="export-decision"
        className="absolute inset-x-0 bottom-0 rounded-t-[20px] border border-axal-hairline bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-950 md:inset-x-auto md:bottom-auto md:left-1/2 md:top-24 md:w-[540px] md:-translate-x-1/2 md:rounded-2xl">
        <h2 id="export-decision-title" className="text-[18px] font-extrabold tracking-tight">Export with unsaved changes?</h2>
        <p className="mt-1.5 text-[12.5px] text-axal-muted">{`The export writes the saved version. These changes are not in it yet (${label}):`}</p>
        <ul className="mt-2 space-y-1 text-[12.5px]">
          {fields.map((f) => (
            <li key={f} className="flex flex-wrap items-center gap-1.5">
              <KindTag kind="you" />
              <span>{f === 'title' ? `Title: “${draftTitle}”` : `${FIELD_WORD[f][0].toUpperCase()}${FIELD_WORD[f].slice(1)}: changed`}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <button type="button" className={`${ghostBtn} min-h-[44px] md:min-h-[32px]`} onClick={onCancel}>Cancel</button>
          <button type="button" className={`${ghostBtn} min-h-[44px] md:min-h-[32px]`} onClick={onExportSaved}>{`Export saved version ${version}`}</button>
          <button type="button" ref={primary} className={`${primaryBtn} min-h-[44px] md:min-h-[32px]`} onClick={onSaveThenExport}>
            {`Save, then export version ${version + 1}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CompanyAnalysis({ role = 'founder' }) {
  const { id } = useParams();
  const location = useLocation();
  const [analysis, setAnalysis] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | missing | unreadable
  const [draft, setDraft] = useState(null); // DRAFT_FIELDS as strings (companyAnalysisDraft.js)
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [manual, setManual] = useState(EMPTY_MANUAL);
  // D7176: the save line, the one failure on screen, the one result, the open review.
  const [saveError, setSaveError] = useState(null); // { text, conflict }
  const [failure, setFailure] = useState(null); // { kind: refresh | rerun | export, title, text, format }
  const [result, setResult] = useState(null); // { kind, title, text }
  const [refreshed, setRefreshed] = useState(null); // { at, byId }
  const [proposal, setProposal] = useState(null);
  const [selection, setSelection] = useState(null);
  const [reviewError, setReviewError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [decision, setDecision] = useState(null); // export format awaiting the dirty-draft decision
  const [sheetOpen, setSheetOpen] = useState(false);
  // D771 (#2097): `busy` names the run at the model, so the rail names that option; an Add runs one only with a site to crawl.
  // D7652: Refresh sources runs no model (D7176), so it names no option.
  useRailOption(busy === 'rerun' ? 'analyse:again' : null, 'Re-run');
  useRailOption(busy === 'add' && manual.crawl && manual.url.trim() ? 'extract:candidate' : null, 'Add');
  const [preview, setPreview] = useState('');
  // D7175: the subject's directory record, read for the subject bar.
  const { read: subjectRead, retry: retrySubject } = useSubjectRecord(analysis?.subject_uid || null);
  // RS-13 B5: the saved version's file, Markdown or JSON, shown before it is downloaded (D7175 part 2).
  const [filePreview, setFilePreview] = useState(null); // 'md' | 'json' | null
  const addNameRef = useRef(null);

  // Focus targets (RS-14 G): each control a sheet, dialog, retry or result returns focus to.
  const saveRef = useRef(null);
  const refreshRef = useRef(null);
  const rerunRef = useRef(null);
  const exportRef = useRef(null);
  const actionsRef = useRef(null);
  const menuRef = useRef(null);
  const failRef = useRef(null);
  const resultRef = useRef(null);
  const exportOpener = useRef(null);

  const take = useCallback((full) => {
    setAnalysis(full);
    setDraft(draftFrom(full));
  }, []);

  /** An action's answer, merged: the record is the server's, the draft keeps what the person changed. */
  const mergeIn = useCallback((before, full) => {
    if (!full || !sameRecord(recordKey(before?.id), recordKey(full.id))) throw new Error('The analysis response belongs to another record.');
    setAnalysis(full);
    setDraft((d) => mergeDraft(d, before, full));
  }, []);

  // D4607: the record this page loaded, by its route identity. Writes go to
  // it, and only while it is still the one the route names.
  const routeKey = recordKey(id);
  const routeIdentity = useRef(routeKey);
  routeIdentity.current = routeKey;
  const [loadedKey, setLoadedKey] = useState(null);
  const gate = useRef(null);
  if (!gate.current) gate.current = createRecordGate();
  useEffect(() => () => gate.current.invalidate(), []);
  const readTicket = () => {
    const key = routeKey;
    const fresh = gate.current.begin();
    return () => fresh() && sameRecord(key, routeIdentity.current);
  };

  const load = useCallback(async () => {
    const fresh = gate.current.begin();
    const key = recordKey(id);
    setState('loading');
    // The previous record's editor goes with it: nothing of A stays on B's
    // page while B loads, so nothing of A can be saved to B.
    setAnalysis(null);
    setDraft(null);
    setLoadedKey(null);
    try {
      const full = await api.competitors.get(id);
      if (!fresh() || !sameRecord(key, routeIdentity.current)) return;
      if (!sameRecord(recordKey(full?.id), key)) throw new Error('The analysis response belongs to another record.');
      take(full);
      setLoadedKey(key);
      setState('ready');
    } catch (e) {
      if (!fresh()) return;
      setAnalysis(null);
      // D278 — branch on the code; the route answers `not_found` for an id
      // that is not the caller's and for one that does not exist alike.
      setState(e?.status === 404 || e?.code === 'not_found' ? 'missing' : 'unreadable');
    }
  }, [id, take]);
  useEffect(() => { load(); }, [load]);
  const current = sameRecord(loadedKey, routeKey);

  // D778 part 9 (#2103): a press answers only the analysis it was pressed on.
  // Opening another analysis (or leaving) moves this on; a press that comes
  // back after that is dropped with its result, its notice and its busy state.
  const runFor = useRef(0);
  // D4607: and the notice, the preview and the Add form belong to the record they were made on.
  useEffect(() => {
    runFor.current += 1; setBusy(''); setNotice(null); setPreview(''); setManual(EMPTY_MANUAL);
    setSaveError(null); setFailure(null); setResult(null); setRefreshed(null);
    setProposal(null); setSelection(null); setReviewError(''); setMenuOpen(false); setDecision(null); setSheetOpen(false);
    setFilePreview(null);
  }, [id]);
  useEffect(() => () => { runFor.current += 1; }, []);

  // A rerun pressed in the Companies workspace panel opens here with its proposal (D7176),
  // once: a later read of the same page does not reopen a review the person cancelled.
  const handedOpened = useRef(null);
  useEffect(() => {
    const handed = location.state?.rerunProposal;
    if (state === 'ready' && current && handed?.proposal_id && !proposal && handedOpened.current !== handed.proposal_id) {
      handedOpened.current = handed.proposal_id;
      setProposal(handed);
      setSelection(defaultSelection(handed));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, current, location.state]);

  // D7175 part 2 (RS-13 C4): a run started on setup opens here with focus on
  // the results h1 (the shell's one h1, D593), once per arrival.
  const focusedFor = useRef(null);
  useEffect(() => {
    if (state !== 'ready' || !current || !location.state?.focusResults || focusedFor.current === location.key) return;
    focusedFor.current = location.key;
    setTimeout(() => focusPageHeading(), 0);
  }, [state, current, location.state, location.key]);

  /** The row-level actions (Add, Remove, category, Accept the read): their answer merges into the draft. */
  const run = async (key, fn, ok) => {
    if (!current || !analysis) return;
    const fresh = readTicket();
    const mine = ++runFor.current;
    const before = analysis;
    setBusy(key);
    setNotice(null);
    try {
      const full = await fn();
      if (runFor.current !== mine || !fresh()) return;
      if (full) mergeIn(before, full);
      if (ok) setNotice({ ok: true, text: ok });
    } catch (e) {
      if (runFor.current === mine && fresh()) setNotice({ ok: false, text: e?.message || 'That did not go through.' });
    } finally {
      if (runFor.current === mine && fresh()) setBusy('');
    }
  };

  const out = analysis?.output || {};
  const version = Number(analysis?.version) || 1;
  const changed = dirtyFields(draft, analysis);
  const dirty = changed.length > 0;
  const saveState = busy === 'save' ? 'busy' : saveError ? 'fail' : dirty ? 'dirty' : 'ok';
  const status = analysis?.status || 'draft';
  const running = status === 'running';
  const errored = status === 'error';
  const acting = busy !== '';

  // D7814: one shared guard covers links, navigate, Back/Forward and reload.
  useLeaveGuard(dirty && current);

  // Title and output only — see the docblock on why the candidate set never
  // travels with a save. Bound to the loaded record: the id it was read with,
  // and only while the route still names it (D4607). Resolves to the saved
  // record, or null when the save failed (the draft stays, editable).
  const save = async () => {
    if (!current || !draft || !analysis) return null;
    const target = JSON.parse(loadedKey)[0];
    const fresh = readTicket();
    const mine = ++runFor.current;
    const before = analysis;
    setBusy('save');
    setSaveError(null);
    setNotice(null);
    try {
      const full = await api.competitors.save(target, { title: draft.title.trim().slice(0, 200), output: outputFrom(draft, analysis), base_version: analysis.version });
      if (runFor.current !== mine || !fresh()) return null;
      mergeIn(before, full);
      return full;
    } catch (e) {
      if (runFor.current !== mine || !fresh()) return null;
      const conflict = e?.status === 409 ? Number(e?.data?.current_version) || null : null;
      setSaveError({ text: e?.message || 'The server did not answer.', conflict });
      return null;
    } finally {
      if (runFor.current === mine && fresh()) setBusy('');
    }
  };

  /** Load the version on record after a 409, keeping every field the person changed. */
  const loadLatest = async () => {
    if (!current || !analysis) return;
    const fresh = readTicket();
    const target = analysis.id;
    const before = analysis;
    try {
      const full = await api.competitors.get(target);
      if (!fresh() || recordKey(full?.id) !== recordKey(target)) return;
      mergeIn(before, full);
      setSaveError(null);
    } catch (e) {
      if (!fresh()) return;
      setSaveError((s) => ({ ...(s || {}), text: e?.message || 'The saved version could not be read.' }));
    }
  };

  const copyChanges = async () => {
    const text = changesText(draft, analysis);
    try { await navigator.clipboard.writeText(text); setNotice({ ok: true, text: 'Your unsaved changes are on the clipboard.' }); } catch { setNotice({ ok: false, text: 'The clipboard could not be written. Your changes are still in the fields.' }); }
  };

  const focusLater = (ref) => setTimeout(() => ref.current?.focus?.(), 0);

  // Refresh sources (RS-14 B1): the stored sources only; the draft stays as typed.
  const refresh = async () => {
    const fresh = readTicket();
    const mine = ++runFor.current;
    const before = analysis;
    setBusy('refresh');
    setFailure(null);
    setResult(null);
    try {
      const full = await api.competitors.refresh(analysis.id);
      if (runFor.current !== mine || !fresh()) return;
      mergeIn(before, full);
      const r = full?.refresh || {};
      const byId = Object.fromEntries((r.results || []).map((x) => [x.id, x]));
      setRefreshed({ at: r.at, byId });
      const failed = Number(r.not_fetched) || 0;
      setResult({
        kind: 'refresh',
        title: `Sources refreshed${r.at ? ` · ${dayTime(r.at)}` : ''}`,
        text: `${r.checked ?? 0} checked · ${r.fetched ?? 0} fetched again`
          + (failed ? ` · ${failed} not fetched, ${failed === 1 ? 'its copy' : 'their copies'} and ${failed === 1 ? 'date' : 'dates'} kept` : '')
          + `. The competitor list and all your text are unchanged${dirty ? '; your unsaved changes are still in the draft' : ''}.`,
      });
      refreshRef.current?.focus?.();
    } catch (e) {
      if (runFor.current !== mine || !fresh()) return;
      setFailure({ kind: 'refresh', title: 'Refresh failed. Nothing changed.', text: `${e?.message || 'The server did not answer.'} Every source below is the copy from its last fetch, with its date. Your draft is as you left it.` });
      focusLater(failRef);
    } finally {
      if (runFor.current === mine && fresh()) setBusy('');
    }
  };

  // Rerun discovery (RS-14 B2): a proposal to review; nothing is replaced.
  const rerun = async (inputs) => {
    const fresh = readTicket();
    const mine = ++runFor.current;
    setBusy('rerun');
    setFailure(null);
    setResult(null);
    try {
      const p = await api.competitors.rerun(analysis.id, { inputs: inputs || analysis.inputs, keep_manual: true }, railPressHeaders('analyse:again'));
      if (runFor.current !== mine || !fresh()) return;
      if (!p?.proposal_id) throw new Error('The rerun did not return a review.');
      setProposal(p);
      setSelection(defaultSelection(p));
      setReviewError('');
    } catch (e) {
      if (runFor.current !== mine || !fresh()) return;
      setFailure({ kind: 'rerun', title: 'Rerun failed. Nothing was replaced.', text: `${e?.message || 'The server did not answer.'} Your draft is as you left it.` });
      focusLater(failRef);
    } finally {
      if (runFor.current === mine && fresh()) setBusy('');
    }
  };

  const cancelReview = () => {
    setProposal(null);
    setSelection(null);
    setReviewError('');
    setResult({ kind: 'rerun', title: 'Rerun discarded.', text: 'Your draft is as you left it. The proposal is dropped; nothing was written.' });
    focusLater(rerunRef);
  };

  const acceptReview = async () => {
    if (!proposal || !selection) return;
    const fresh = readTicket();
    const mine = ++runFor.current;
    const before = analysis;
    setBusy('apply');
    setReviewError('');
    try {
      const full = await competitorReviewApi.apply(analysis.id, proposal.base_version, {
        proposal_id: proposal.proposal_id,
        add: [...selection.add], remove: [...selection.remove], output: [...selection.output],
      });
      if (runFor.current !== mine || !fresh()) return;
      mergeIn(before, full);
      const a = full?.applied || {};
      const n = (a.added || 0) + (a.removed || 0) + (a.rewritten || 0);
      setProposal(null);
      setSelection(null);
      setResult({
        kind: 'rerun',
        title: `${n} ${n === 1 ? 'change' : 'changes'} applied · saved as version ${full?.version ?? ''}`,
        text: `${dayTime(full?.updated_at) || ''}${dayTime(full?.updated_at) ? '. ' : ''}Competitors: ${(full?.candidates || []).length}.`
          + (dirtyFields(draft, before).length ? ' Your unsaved changes are still a draft: accepting wrote only the ticked changes.' : ''),
      });
      focusLater(resultRef);
    } catch (e) {
      if (runFor.current !== mine || !fresh()) return;
      setReviewError(e?.message || 'The selected changes were not applied.');
    } finally {
      if (runFor.current === mine && fresh()) setBusy('');
    }
  };

  // Export (RS-14 C1): the saved version, checked before anything is downloaded.
  // The preview (RS-13 B5, D7175 part 2) reads through `loadExport` on its own; see `openPreview`.
  const doExport = async (format, at = version, opener = exportOpener.current) => {
    const fresh = readTicket();
    const mine = ++runFor.current;
    setBusy('export');
    setFailure(null);
    setResult(null);
    try {
      const got = await fetchExport(`${api.competitors.exportUrl(analysis.id, format)}&version=${encodeURIComponent(at)}`);
      if (runFor.current !== mine || !fresh()) return;
      const problem = exportProblem(got.status, got.type, format);
      const label = format === 'md' ? 'Markdown' : 'JSON';
      if (problem) {
        setFailure({
          kind: 'export',
          format,
          title: problem.kind === 'status'
            ? `${label} export failed. Nothing was downloaded.`
            : `The export did not return ${label}. Nothing was downloaded.`,
          text: problem.kind === 'status'
            ? `The server answered ${problem.status}. Your dossier is open and unchanged.`
            : `The server answered ${problem.status} with ${problem.type}. Your dossier is open and unchanged.`,
        });
        focusLater(failRef);
        return;
      }
      const v = got.version || at;
      const name = exportFilename(id, v, format);
      download(name, got.text, format === 'md' ? 'text/markdown' : 'application/json');
      setResult({ kind: 'export', title: `Downloaded version ${v}`, text: name });
      (opener || exportRef.current)?.focus?.();
    } catch (e) {
      if (runFor.current !== mine || !fresh()) return;
      setFailure({ kind: 'export', format, title: `${format === 'md' ? 'Markdown' : 'JSON'} export failed. Nothing was downloaded.`, text: `${e?.message || 'The server did not answer.'} Your dossier is open and unchanged.` });
      focusLater(failRef);
    } finally {
      if (runFor.current === mine && fresh()) setBusy('');
    }
  };

  const startExport = (format, opener) => {
    setMenuOpen(false);
    setSheetOpen(false);
    exportOpener.current = opener || exportRef.current;
    if (dirty) setDecision(format);
    else doExport(format, version, exportOpener.current);
  };
  // Preview shows the saved version, so unsaved changes need no decision first.
  // D7175 part 2 (RS-13 B5): Markdown and JSON tabs, each read and checked as a
  // download is; closing it returns focus to Export (or Actions ⋯ on a phone).
  const openPreview = (opener, format = 'md') => {
    setMenuOpen(false);
    setSheetOpen(false);
    setFailure(null);
    setResult(null);
    exportOpener.current = opener || exportRef.current;
    setFilePreview(format);
  };
  const loadPreview = async (format) => {
    const got = await loadExport(`${api.competitors.exportUrl(analysis.id, format)}&version=${encodeURIComponent(version)}`, format);
    const v = got.version || version;
    return { text: got.text, version: v, name: exportFilename(id, v, format) };
  };
  const closePreview = () => { setFilePreview(null); focusLater(exportOpener); };
  const downloadPreview = ({ format, text, name, version: v }) => {
    download(name, text, format === 'md' ? 'text/markdown' : 'application/json');
    setResult({ kind: 'export', title: `Downloaded version ${v}`, text: name });
    closePreview();
  };
  const closeDecision = () => { setDecision(null); focusLater(exportOpener); };
  const exportSaved = () => { const f = decision; setDecision(null); doExport(f, version, exportOpener.current); };
  const saveThenExport = async () => {
    const f = decision;
    setDecision(null);
    const saved = await save();
    if (saved) doExport(f, Number(saved.version) || version + 1, exportOpener.current);
    else focusLater(saveRef);
  };

  // The Export menu: arrow keys move, Escape closes and returns focus to Export.
  useEscapeClose(() => { setMenuOpen(false); focusLater(exportRef); }, { active: menuOpen });
  useEffect(() => { if (menuOpen) menuRef.current?.querySelector?.('[role="menuitem"]')?.focus?.(); }, [menuOpen]);
  const menuKeys = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll?.('[role="menuitem"]') || [])];
    const at = items.indexOf(document.activeElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus?.();
  };
  // The review: Escape is Cancel.
  useEscapeClose(cancelReview, { active: !!proposal && !decision });

  const tiles = analysisTiles(analysis, { readFailed: state === 'unreadable' });
  const inputs = inputsRow(analysis?.inputs);
  const grid = featureGrid(out);
  const signals = signalColumns(out);
  const read = landscapeRead(analysis);
  const candidates = analysis?.candidates || [];
  const allSources = analysis?.sources || [];
  // D7175: what each finding and each competitor rests on.
  const fetchedList = allSources.filter(sourceFetched);
  const urlOf = (n) => fetchedList[n - 1]?.url || undefined;
  const findings = findingsOf(out, allSources);
  const failed = failedReads(allSources);
  const evidence = analysis?.evidence || null;
  const insufficient = evidence?.status === 'insufficient';
  const excluded = Array.isArray(out.excluded) ? out.excluded : [];
  const focusAdd = () => addNameRef.current?.focus();
  // D7175: with no source, no summary, gap or wedge is stated (RS-13 B3); the
  // run's next steps are Suggested research questions, drawn apart below.
  const generatedShown = GENERATED_SECTIONS.filter(([f]) => f !== 'next_actions' && !insufficient);
  // D7175 part 2 (RS-13 B1): what each competitor row rests on, read once per row.
  const supportBy = useMemo(() => Object.fromEntries((analysis?.candidates || []).map((c) => [c.id, candidateSupport(c, analysis?.sources || [])])), [analysis]);
  const attachedTo = (cid) => (sourcesBy[cid] || []).some((s) => s.origin === 'manual');
  const sourcesBy = useMemo(() => {
    const m = {};
    for (const s of analysis?.sources || []) {
      if (!sourceFetched(s) && s.origin !== 'manual') continue;
      (m[s.candidate_id] = m[s.candidate_id] || []).push(s);
    }
    return m;
  }, [analysis]);
  const nameOf = useMemo(() => Object.fromEntries(candidates.map((c) => [c.id, c.name])), [candidates]);
  const counts = contentCounts(analysis);
  const edited = analysis?.sections_edited || {};
  const savedAt = clock(analysis?.updated_at);
  const set = (f) => (v) => setDraft((d) => ({ ...d, [f]: v }));

  const exportItems = (
    <>
      <button type="button" role="menuitem" className="flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-semibold hover:bg-axal-ground focus:bg-axal-ground dark:hover:bg-gray-800 dark:focus:bg-gray-800"
        onClick={() => startExport('md')}>
        Markdown (.md)<small className="font-mono text-[11px] font-medium text-axal-muted">{`saved version ${version} · ${dayTime(analysis?.updated_at) || 'date not recorded'}`}</small>
      </button>
      <button type="button" role="menuitem" className="flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-semibold hover:bg-axal-ground focus:bg-axal-ground dark:hover:bg-gray-800 dark:focus:bg-gray-800"
        onClick={() => startExport('json')}>
        JSON<small className="font-mono text-[11px] font-medium text-axal-muted">{`saved version ${version} · ${dayTime(analysis?.updated_at) || 'date not recorded'}`}</small>
      </button>
      <button type="button" role="menuitem" className="flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-semibold hover:bg-axal-ground focus:bg-axal-ground dark:hover:bg-gray-800 dark:focus:bg-gray-800"
        onClick={() => openPreview()}>
        Preview the file<small className="font-mono text-[11px] font-medium text-axal-muted">{`Markdown or JSON for saved version ${version}, before it is downloaded`}</small>
      </button>
    </>
  );

  const review = proposal && selection ? (() => {
    const counted = reviewCounts(proposal, selection);
    const toggle = (group, key) => setSelection((s) => {
      const next = { ...s, [group]: new Set(s[group]) };
      if (next[group].has(key)) next[group].delete(key); else next[group].add(key);
      return next;
    });
    const adds = proposal.candidates?.add || [];
    const removes = proposal.candidates?.remove || [];
    const fields = PROPOSAL_FIELDS.filter(([f]) => proposal.output?.[f]);
    const box = 'grid grid-cols-[20px_74px_minmax(0,1fr)] items-start gap-2.5 border-b border-axal-hairline px-3 py-2.5 text-[12.5px] last:border-b-0 dark:border-gray-800';
    return (
      <section data-testid="rerun-review" aria-labelledby="rerun-review-title" className="space-y-3">
        <div>
          <h2 id="rerun-review-title" className="text-[20px] font-extrabold tracking-tight">Review the rerun</h2>
          <p className="mt-1 text-[12.5px] text-axal-muted">
            {`Discovery ran again against saved version ${proposal.base_version}. Nothing has changed yet. Pick what to take.`}
          </p>
        </div>
        {reviewError && <FailAlert title="Nothing was applied." testId="rerun-review-error">{reviewError}</FailAlert>}
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <Card padding="none">
              <h3 className="flex items-baseline justify-between gap-2 border-b border-axal-hairline px-3 py-2.5 text-[13px] font-extrabold dark:border-gray-800">
                Competitors <span className="font-mono text-[11px] font-medium text-axal-muted">{`${adds.length} ${adds.length === 1 ? 'addition' : 'additions'} · ${removes.length} ${removes.length === 1 ? 'removal' : 'removals'}`}</span>
              </h3>
              {!adds.length && !removes.length && <p className="px-3 py-2.5 text-[12.5px] text-axal-muted">The run found the same competitors.</p>}
              {adds.map((c) => (
                <label key={c.id} className={box}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-700" checked={selection.add.has(c.id)} onChange={() => toggle('add', c.id)} aria-label={`Add ${c.name}`} />
                  <span className="font-bold text-emerald-700 dark:text-emerald-300">+ Add</span>
                  <span className="min-w-0"><b>{c.name}</b> <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">New in rerun</span>
                    <small className="block text-axal-muted">{[c.domain, c.category === 'adjacent' ? 'Adjacent' : 'Direct', relevanceOf(c.relevance_score), c.summary].filter(Boolean).join(' · ')}</small>
                  </span>
                </label>
              ))}
              {removes.map((c) => (
                <label key={c.id} className={box}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-700" checked={selection.remove.has(c.id)} onChange={() => toggle('remove', c.id)} aria-label={`Remove ${c.name}`} />
                  <span className="font-bold text-red-700 dark:text-red-300">− Remove</span>
                  <span className="min-w-0"><b>{c.name}</b>
                    <small className="block text-axal-muted">Not returned by this run. Its sources and the category you set stay if you leave this unticked.</small>
                  </span>
                </label>
              ))}
            </Card>
            <Card padding="none">
              <h3 className="flex items-baseline justify-between gap-2 border-b border-axal-hairline px-3 py-2.5 text-[13px] font-extrabold dark:border-gray-800">
                Generated text <span className="font-mono text-[11px] font-medium text-axal-muted">{`${fields.filter(([f]) => proposal.output[f].changed).length} rewrites`}</span>
              </h3>
              {fields.map(([f, label]) => {
                const item = proposal.output[f];
                if (!item.changed) {
                  return (
                    <div key={f} className={`${box} opacity-70`}>
                      <span />
                      <span className="text-axal-muted">Unchanged</span>
                      <span><b>{label}</b><small className="block text-axal-muted">The run returned the same text.</small></span>
                    </div>
                  );
                }
                return (
                  <label key={f} className={box}>
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-violet-700" checked={selection.output.has(f)} onChange={() => toggle('output', f)} aria-label={`Rewrite ${label}`} />
                    <span className="font-bold text-violet-700 dark:text-violet-300">Rewrite</span>
                    <span className="min-w-0 space-y-1">
                      <span className="flex flex-wrap items-center gap-1.5"><b>{label}</b>{item.edited_at ? <KindTag kind="ed">{`Edited by you ${day(item.edited_at) || ''}`.trim()}</KindTag> : null}</span>
                      <span className="block whitespace-pre-line"><span className="mr-1.5 font-mono text-[10px] font-bold uppercase text-axal-muted">{item.edited_at ? 'Now · yours' : 'Now'}</span>{proposalText(item.now) || <Unrecorded />}</span>
                      <span className="block whitespace-pre-line"><span className="mr-1.5 font-mono text-[10px] font-bold uppercase text-axal-muted">Proposed</span>{proposalText(item.proposed) || <Unrecorded />}</span>
                      {item.edited_at ? <small className="block text-axal-muted">{`Taking this replaces your edit. Your text stays in version ${proposal.base_version}.`}</small> : null}
                    </span>
                  </label>
                );
              })}
            </Card>
            <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-axal-hairline bg-white px-3 py-2.5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
              <span role="status" className="min-w-[200px] flex-1 text-[12.5px]">
                <b className="font-mono">{counted.selected}</b> of <b className="font-mono">{counted.total}</b> changes selected · competitors would be <b className="font-mono">{competitorsAfter(analysis, selection)}</b>
              </span>
              <span className="flex flex-wrap gap-2">
                <button type="button" className={`${ghostBtn} min-h-[44px] md:min-h-[32px]`} onClick={cancelReview} disabled={busy === 'apply'}>Cancel · keep my draft</button>
                <button type="button" className={`${primaryBtn} min-h-[44px] md:min-h-[32px]`} onClick={acceptReview} disabled={busy === 'apply' || counted.selected === 0}>
                  {busy === 'apply' ? 'Applying…' : `Accept ${counted.selected} selected ${counted.selected === 1 ? 'change' : 'changes'}`}
                </button>
              </span>
            </div>
          </div>
          <Card variant="dashed" data-testid="rerun-review-kept">
            <b className="text-[13px]">Not part of this review</b>
            <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">A rerun never proposes changes to these. They stay whatever you choose.</p>
            <ul className="mt-2 space-y-1.5 text-[12.5px]">
              <li className="flex flex-wrap items-center gap-1.5"><KindTag kind="you" />Title<span className="ml-auto text-[11px] text-axal-muted">{changed.includes('title') ? 'draft not saved' : `v${version}`}</span></li>
              <li className="flex flex-wrap items-center gap-1.5"><KindTag kind="you" />Conclusion<span className="ml-auto text-[11px] text-axal-muted">{changed.includes('conclusion') ? 'draft not saved' : `v${version}`}</span></li>
              <li className="flex flex-wrap items-center gap-1.5"><KindTag kind="you" />Notes<span className="ml-auto text-[11px] text-axal-muted">{changed.includes('notes') ? 'draft not saved' : `v${version}`}</span></li>
              {(proposal.kept?.manual_candidates || []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-1.5"><KindTag kind="man" />{c.name}<span className="ml-auto text-[11px] text-axal-muted">competitor</span></li>
              ))}
              {(proposal.kept?.manual_sources || []).map((u) => (
                <li key={u} className="flex flex-wrap items-center gap-1.5 break-all"><KindTag kind="man" />{u}<span className="ml-auto text-[11px] text-axal-muted">source</span></li>
              ))}
            </ul>
          </Card>
        </div>
      </section>
    );
  })() : null;

  return (
    <WorkspaceShell
      role={role}
      title={analysis?.title || 'Competitor analysis'}
      activeSlug="companies"
      rail={(
        <WorkerRail
          workspace="Research"
          role="founder"
          stance="This page maps the players a run returned or you named, with the URLs behind them"
          note="Refresh sources fetches the stored sources again; your text and the list stay. Rerun discovery shows every proposed change, and nothing is replaced until you accept. Export writes the saved version. Nothing here is a relationship, a headcount or a comparable."
          coverage={[analysis
            ? `${analysis.title || 'Untitled'}: ${candidates.length} ${candidates.length === 1 ? 'competitor' : 'competitors'}, ${allSources.length} ${allSources.length === 1 ? 'source' : 'sources'}`
            : 'One saved competitor analysis']}
          unavailable={[
            ['A client', 'An analysis is stored against the person who ran it and carries no company.'],
            ['An invented company', 'The run lists only what it fetched or what you added.'],
          ]}
        />
      )}
    >
      <div data-testid="company-analysis" className="space-y-3 pb-20 md:pb-0">
        <Link to={backToResults(typeof sessionStorage === 'undefined' ? null : sessionStorage).href} className="text-[12px] font-semibold text-violet-700 underline dark:text-violet-300">
          ‹ Companies
        </Link>

        <Card variant="sunken" padding="md" data-testid="analysis-scope-band">
          <p className="max-w-3xl text-[12px] leading-relaxed text-axal-muted">
            These analyses are yours, not a client’s. An analysis is stored against the person who ran it and
            carries no company, so there is no client to switch between.
          </p>
        </Card>

        {/* D7175 part 2 (RS-13 B4): loading keeps the tile labels and draws their values as skeletons, never 0. */}
        {state === 'loading' && (
          <div aria-busy="true" data-testid="analysis-loading" className="space-y-3">
            <p className="text-[12.5px] text-axal-muted" role="status">Loading this analysis.</p>
            <div aria-hidden="true" className="h-[86px] rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="h-5 w-6/12 rounded bg-gray-200 dark:bg-gray-800" />
              <div className="mt-3 h-3 w-4/12 rounded bg-gray-200 dark:bg-gray-800" />
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="analysis-loading-tiles">
              {['Competitors', 'Direct', 'Adjacent', 'Sources fetched'].map((k) => (
                <Card key={k}>
                  <div className={eyebrow}>{k}</div>
                  <div aria-hidden="true" className="mt-2.5 h-5 w-10 rounded bg-gray-200 dark:bg-gray-800" />
                  <div aria-hidden="true" className="mt-2 h-2.5 w-8/12 rounded bg-gray-200 dark:bg-gray-800" />
                </Card>
              ))}
            </div>
          </div>
        )}

        {state === 'unreadable' && (
          <Card variant="dashed" padding="lg" data-testid="analysis-read-failed">
            <StateChip kind="unavailable" />
            <h2 className="mt-1.5 text-sm font-extrabold tracking-tight">Your saved analyses could not be read.</h2>
            <p className="mt-1.5 max-w-2xl text-[12.5px] text-axal-muted">
              A failed read is not an empty list — nothing here is drawn as 0 until the store answers.
            </p>
            <button type="button" className={`${ghostBtn} mt-3`} onClick={load}>Try again</button>
          </Card>
        )}

        {state === 'missing' && (
          <Card padding="lg">
            <StateChip kind="refused" label="Not on your list" />
            <h1 className="mt-1.5 text-[15px] font-extrabold tracking-tight">This analysis is not on your list.</h1>
            <p className="mt-1.5 text-[12.5px] text-axal-muted">An analysis belongs to the person who ran it.</p>
            <Link to={backToResults(typeof sessionStorage === 'undefined' ? null : sessionStorage).href} className={`${ghostBtn} mt-3 inline-block`}>‹ Companies</Link>
          </Card>
        )}

        {state === 'ready' && current && analysis && draft && (
          <>
            {notice && (
              <p role="status" className={`text-[12px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                {notice.text}
              </p>
            )}

            <Card data-testid="analysis-header">
              <label className="block">
                <span className={`${eyebrow} flex flex-wrap items-center gap-1.5`}>
                  Title · editable, max 200 <KindTag kind="you" />
                  {changed.includes('title') ? <b className="font-sans text-[11px] normal-case tracking-normal text-amber-800 dark:text-amber-300">· not saved</b> : null}
                </span>
                <input
                  aria-label="Analysis title"
                  maxLength={200}
                  className="mt-1 w-full border-b border-transparent bg-transparent text-2xl font-extrabold tracking-tight text-axal-ink hover:border-axal-hairline focus:border-violet-500 focus:outline-none dark:text-gray-100"
                  value={draft.title}
                  onChange={(e) => set('title')(e.target.value)}
                />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-axal-muted">
                <Pill tone="neutral">{analysis.mode}</Pill>
                <Pill tone={STATUS_TONE[status] || 'neutral'}>{status}</Pill>
                <span className="font-mono">{`Saved version ${version} · ${dayTime(analysis.updated_at) || `updated ${day(analysis.updated_at) || 'date not recorded'}`}`}</span>
                {analysis.edited ? <span className="font-semibold text-violet-700 dark:text-violet-300">· edited since last run</span> : null}
              </div>

              {/* Phone (RS-14 E B): the save line sits under the title; Save itself is in the bottom bar. */}
              <div className="mt-2 md:hidden" data-testid="analysis-phone-save-line">
                <SaveStatus state={saveState} version={version} savedAt={savedAt} fields={changed.map((f) => FIELD_WORD[f])} />
              </div>
              {/* Desktop and tablet (RS-14 A2, D): Save, its status, then the three actions with their hints. */}
              <div className="mt-3 hidden flex-wrap items-center gap-2 md:flex" data-testid="analysis-actions">
                <button type="button" ref={saveRef} className={dirty || saveError ? primaryBtn : ghostBtn} onClick={save} disabled={!dirty || acting}>
                  {busy === 'save' ? 'Saving…' : saveError ? 'Retry save' : 'Save'}
                </button>
                <SaveStatus state={saveState} version={version} savedAt={savedAt} fields={changed.map((f) => FIELD_WORD[f])} />
                <span aria-hidden="true" className="mx-1 h-5 w-px bg-axal-hairline dark:bg-gray-800" />
                <button type="button" ref={refreshRef} className={ghostBtn} disabled={acting || running || !!proposal} onClick={refresh}>
                  {busy === 'refresh' ? 'Refreshing sources…' : 'Refresh sources'}
                </button>
                <button type="button" ref={rerunRef} className={ghostBtn} disabled={acting || running || !!proposal} onClick={() => rerun()}>
                  {busy === 'rerun' ? 'Running discovery…' : 'Rerun discovery'}
                </button>
                <div className="relative">
                  <button type="button" ref={exportRef} className={ghostBtn} aria-haspopup="menu" aria-expanded={menuOpen ? 'true' : 'false'}
                    disabled={acting || !!proposal} onClick={() => setMenuOpen((o) => !o)}>
                    Export ▾
                  </button>
                  {menuOpen && (
                    <div ref={menuRef} role="menu" aria-label="Export" onKeyDown={menuKeys} data-testid="export-menu"
                      className="absolute left-0 top-10 z-20 w-[280px] rounded-[10px] border border-axal-hairline bg-white p-1.5 shadow-lg dark:border-gray-800 dark:bg-gray-950">
                      {exportItems}
                      <p className="border-t border-axal-hairline px-2.5 pt-1.5 text-[11px] text-axal-muted dark:border-gray-800">Exports write the saved version. Unsaved edits are never exported.</p>
                    </div>
                  )}
                </div>
              </div>
              {!proposal && (
                <div className="mt-2.5 hidden gap-4 text-[12px] leading-relaxed text-axal-muted md:grid md:grid-cols-2" data-testid="analysis-action-hints">
                  <span><b className="text-axal-ink dark:text-gray-100">Refresh sources</b>{` fetches the ${allSources.length} ${allSources.length === 1 ? 'source' : 'sources'} of these ${candidates.length} ${candidates.length === 1 ? 'competitor' : 'competitors'} again. Your text, your edits and the list stay as they are.`}</span>
                  <span><b className="text-axal-ink dark:text-gray-100">Rerun discovery</b> searches again. You review every proposed addition, removal and rewrite before anything is replaced.</span>
                </div>
              )}
              {busy === 'refresh' && <p role="status" className="mt-2 text-[12px] text-axal-muted">{`Fetching ${allSources.length} ${allSources.length === 1 ? 'source' : 'sources'}. Your text stays editable.`}</p>}

              {saveError && (
                <div className="mt-3">
                  <FailAlert title={saveError.conflict ? 'Not saved: this analysis changed since you opened it.' : 'Save failed. Nothing was saved.'} testId="save-failed"
                    actions={(
                      <>
                        {saveError.conflict
                          ? <button type="button" className={primaryBtn} onClick={loadLatest}>{`Load version ${saveError.conflict}, keep my changes`}</button>
                          : <button type="button" className={primaryBtn} onClick={save}>Retry save</button>}
                        <button type="button" className={ghostBtn} onClick={copyChanges}>Copy my changes</button>
                      </>
                    )}>
                    {`${saveError.text} Your changes are still here, exactly as typed. Saved version ${version} is unchanged.`}
                  </FailAlert>
                </div>
              )}
            </Card>

            <SubjectBar uid={analysis.subject_uid || null} read={subjectRead} onRetry={retrySubject} evidence={evidence} running={running}
              startedAt={clock(runStartedAt(analysis))} />

            {filePreview && (
              <ExportPreview initialFormat={filePreview} load={loadPreview} onDownload={downloadPreview} onClose={closePreview}
                evidence={<EvidenceChip evidence={evidence} short />}
                note={dirty ? 'Exports write the saved version. Your unsaved changes are not in this file.' : null} />
            )}

            {!running && !errored && failed.length > 0 && evidence?.status !== 'unavailable' && (
              <div data-testid="analysis-partial-bar" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-900 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200">
                <StateChip kind="partial" />
                <span>{`${fetchedList.length} of ${allSources.length} sources fetched`}</span>
                <StateChip kind="unavailable" label={`${failed.length} Unavailable`} />
                <span className="min-w-0 truncate">{failed.map((f) => f.url).join(', ')}</span>
                <button type="button" className={`${ghostBtn} min-h-[44px] sm:min-h-0`} disabled={acting || !!proposal} onClick={refresh}>
                  {busy === 'refresh' ? 'Refreshing…' : `Retry the ${failed.length === 1 ? 'read' : `${failed.length} reads`}`}
                </button>
              </div>
            )}

            {failure && (
              <FailAlert alertRef={failRef} title={failure.title} testId={`${failure.kind}-failed`}
                actions={(
                  <>
                    {failure.kind === 'refresh' && <button type="button" className={ghostBtn} onClick={refresh} disabled={acting}>Retry refresh</button>}
                    {failure.kind === 'rerun' && (
                      <>
                        <button type="button" className={ghostBtn} onClick={() => rerun()} disabled={acting}>Retry rerun</button>
                        <button type="button" className={ghostBtn} disabled={acting}
                          onClick={() => rerun({ ...(analysis.inputs || {}), depth: 'quick' })}>Quick scan</button>
                      </>
                    )}
                    {failure.kind === 'export' && (
                      <>
                        <button type="button" className={ghostBtn} onClick={() => doExport(failure.format, version, exportOpener.current)} disabled={acting}>Retry export</button>
                        <button type="button" className={ghostBtn} onClick={() => { setFailure(null); focusLater(exportOpener); }}>Dismiss</button>
                      </>
                    )}
                  </>
                )}>
                {failure.text}
              </FailAlert>
            )}
            {result && (
              <OkNote noteRef={resultRef} title={result.title} testId={`${result.kind}-result`}>
                <span className={result.kind === 'export' ? 'font-mono text-[11.5px]' : ''}>{result.text}</span>
              </OkNote>
            )}

            {review}

            {!proposal && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="analysis-inputs">
                  {inputs.map((i) => (
                    <div key={i.k} className="rounded-lg border border-axal-hairline px-3 py-2 dark:border-gray-800">
                      <div className={eyebrow}>{i.k}</div>
                      <div className="mt-1 text-[12px] text-axal-ink dark:text-gray-100">{i.nr ? <Unrecorded /> : i.v}</div>
                    </div>
                  ))}
                </div>

                {running && (
                  <Card variant="dashed" padding="lg" data-testid="analysis-running">
                    <p className="text-[13px] font-bold">Discovering candidates, crawling public sites…</p>
                    {runStartedAt(analysis) ? <p className="mt-1 font-mono text-[12px] text-axal-muted">{`Started ${dayTime(runStartedAt(analysis))}`}</p> : null}
                    <p className="mt-1 text-[12px] text-axal-muted">Nothing is listed until the run returns. No names appear while it is working.</p>
                  </Card>
                )}

                {tiles && (
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {tiles.map((t) => <Tile key={t.k} {...t} />)}
                  </div>
                )}

                {errored && (
                  <Card padding="lg" className="border-red-200 dark:border-red-900" data-testid="analysis-errored">
                    <p className="text-[13px] font-bold text-red-700 dark:text-red-300">The analysis pipeline failed. Try again or reduce depth.</p>
                    <p className="mt-1 text-[12px] text-axal-muted">A failed run is not an empty landscape. Nothing was discovered, so nothing is listed.</p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" className={primaryBtn} disabled={acting} onClick={() => rerun()}>
                        Rerun discovery
                      </button>
                      <button type="button" className={ghostBtn} disabled={acting}
                        onClick={() => rerun({ ...(analysis.inputs || {}), depth: 'quick' })}>
                        Quick scan
                      </button>
                    </div>
                  </Card>
                )}

                {!running && !errored && (
                  <>
                    {insufficient && (
                      <Card padding="lg" data-testid="analysis-insufficient" className="border-[1.5px] border-dashed border-amber-400 dark:border-amber-500/60">
                        <EvidenceChip evidence={evidence} />
                        <h2 className="mt-2 text-[15px] font-extrabold tracking-tight">
                          {candidates.length ? 'This run read no sources' : 'This run found no companies and read no sources'}
                        </h2>
                        <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
                          {candidates.length
                            ? 'No company in this run has a site that was read. With no source, the run states no market gaps, no competitor classifications and no wedge. '
                            : 'The search finished without an error and returned nothing for this market. With no source, the run states no market gaps, no competitor classifications and no wedge. '}
                          Add a company you know with its website, or revise the market, customer or region and run again.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button type="button" className={`${primaryBtn} min-h-[44px] sm:min-h-0`} onClick={focusAdd}>Add a source</button>
                          <Link to={reviseHref(analysis)} className={`${ghostBtn} inline-flex min-h-[44px] items-center sm:min-h-0`}>Revise the search</Link>
                        </div>
                        {/* D7175 part 2 (RS-13 B3): each step with the time the run recorded for it. */}
                        {(() => {
                          const did = runSteps(analysis);
                          return (
                            <div className="mt-3 border-t border-axal-hairline pt-2.5 text-[11.5px] text-axal-muted dark:border-gray-800" data-testid="analysis-run-steps">
                              <div className={eyebrow}>What the run did</div>
                              <ul className="mt-1 space-y-0.5">
                                {did.lines.map((l) => (
                                  <li key={l.k} className="flex gap-2">
                                    {did.timed ? <span className="w-11 shrink-0 font-mono text-axal-ink dark:text-gray-100">{clock(l.at) || '—'}</span> : null}
                                    <span>{l.text}</span>
                                  </li>
                                ))}
                              </ul>
                              {!did.timed && (
                                <p className="mt-1"><Unrecorded /> <span className="ml-1">step times: this run is older than the record of them</span></p>
                              )}
                            </div>
                          );
                        })()}
                      </Card>
                    )}

                    {evidence?.status === 'no_candidates' && (
                      <Card padding="lg" data-testid="analysis-no-candidates">
                        <EvidenceChip evidence={evidence} />
                        <p className="mt-2 text-[12.5px] text-axal-muted">The search ran and returned no companies. No read failed.</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link to={reviseHref(analysis)} className={`${ghostBtn} inline-flex min-h-[44px] items-center sm:min-h-0`}>Revise the search</Link>
                          <button type="button" className={`${ghostBtn} min-h-[44px] sm:min-h-0`} onClick={focusAdd}>Add a company</button>
                        </div>
                      </Card>
                    )}

                    {evidence?.status === 'unavailable' && (
                      <Card padding="lg" data-testid="analysis-sources-unavailable">
                        <StateChip kind="unavailable" label="Sources unavailable" />
                        <p className="mt-2 text-[12.5px] text-axal-muted">
                          {`${candidates.length} ${candidates.length === 1 ? 'company' : 'companies'} found; ${failed.length} of ${allSources.length} site reads failed. Classifications are drawn unconfirmed. This is not a search that found nothing.`}
                        </p>
                        <button type="button" className={`${ghostBtn} mt-3 min-h-[44px] sm:min-h-0`} disabled={acting} onClick={refresh}>
                          {busy === 'refresh' ? 'Refreshing…' : 'Retry · Refresh sources'}
                        </button>
                      </Card>
                    )}
                  </>
                )}

                {/* The four kinds of content (RS-14 A2). */}
                <div role="list" aria-label="What this dossier holds" data-testid="analysis-legend"
                  className="grid gap-2 rounded-xl border border-axal-hairline bg-white p-3 text-[12px] dark:border-gray-800 dark:bg-gray-900 sm:grid-cols-2 lg:grid-cols-4">
                  <div role="listitem"><KindTag kind="gen" /><small className="mt-1 block text-axal-muted">{`${counts.generated} ${counts.generated === 1 ? 'section' : 'sections'} from the run. Editable; an edit is marked.`}</small></div>
                  <div role="listitem"><KindTag kind="you" /><small className="mt-1 block text-axal-muted">Title, conclusion and notes. A refresh or rerun never writes these.</small></div>
                  <div role="listitem"><KindTag kind="man" /><small className="mt-1 block text-axal-muted">{`${counts.manualCandidates} ${counts.manualCandidates === 1 ? 'competitor' : 'competitors'} and ${counts.manualSources} ${counts.manualSources === 1 ? 'source' : 'sources'} you added by hand. Kept by refresh and rerun.`}</small></div>
                  <div role="listitem"><KindTag kind="fet" /><small className="mt-1 block text-axal-muted">{`${counts.fetched} ${counts.fetched === 1 ? 'page' : 'pages'} the run or a crawl fetched, each with its date.`}</small></div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <Card data-testid="analysis-yours">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 className="text-[15px] font-extrabold tracking-tight">Your conclusion and notes</h2>
                      <span className="font-mono text-[11px] text-axal-muted">never written by a run</span>
                    </div>
                    <div className="mt-3 space-y-3">
                      <TextSection title="Conclusion" tags={<KindTag kind="you" />} value={draft.conclusion} rows={3}
                        placeholder="What you conclude from this landscape…" emptyReason="yours to write"
                        dirty={changed.includes('conclusion')} onChange={set('conclusion')} />
                      <TextSection title="Notes" tags={<KindTag kind="you" />} value={draft.notes} placeholder="Your own conclusions…"
                        emptyReason="yours to write" dirty={changed.includes('notes')} onChange={set('notes')} />
                    </div>
                  </Card>

                  {!running && !errored && generatedShown.length > 0 && (
                    <Card data-testid="analysis-generated">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h2 className="text-[15px] font-extrabold tracking-tight">Generated by the run</h2>
                        <span className="font-mono text-[11px] text-axal-muted">editable</span>
                      </div>
                      <div className="mt-3 space-y-3">
                        {generatedShown.map(([f, title]) => (
                          <TextSection key={f} title={title}
                            tags={(
                              <>
                                <KindTag kind="gen">Generated</KindTag>
                                {edited[f] ? <KindTag kind="ed">{`Edited by you ${day(edited[f]) || ''}`.trim()}</KindTag> : null}
                              </>
                            )}
                            value={draft[f]} rows={f === 'wedge' ? 2 : 3} dirty={changed.includes(f)} onChange={set(f)}
                            placeholder={f === 'market_summary' ? 'What this landscape looks like, in your words…' : f === 'wedge' ? undefined : 'One per line'}
                            emptyReason={f === 'market_summary' ? 'the run returned no summary, and none is generated to fill the box' : f === 'wedge' ? 'the run returned none with a source' : 'the run listed none with a source'} />
                        ))}
                      </div>
                    </Card>
                  )}
                </div>

                {!running && !errored && (
                  <>
                    {!insufficient && (
                      <Card data-testid="analysis-findings">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className={eyebrow}>Findings</span>
                          <span className="text-[11px] text-axal-muted">
                            {findings.facts.length
                              ? `${findings.facts.filter((f) => !f.noSource).length} with a source · ${findings.facts.filter((f) => f.noSource).length} without`
                              : 'Facts read from fetched pages · each cites its source'}
                          </span>
                        </div>
                        {findings.facts.length ? (
                          <ul className="mt-1.5">{findings.facts.map((f, i) => <FindingRow key={i} f={f} urlOf={urlOf} />)}</ul>
                        ) : (
                          <p className="mt-1.5 text-[11.5px] text-axal-muted"><Unrecorded /> <span className="ml-1">this run stored no findings with their sources</span></p>
                        )}
                        {findings.interpretation.length > 0 && (
                          <div className="mt-3 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-1 dark:border-gray-800 dark:bg-gray-950">
                            <div className={`${eyebrow} pt-2`}>Interpretation, kept apart from the facts</div>
                            <ul>{findings.interpretation.map((f, i) => <FindingRow key={i} f={f} urlOf={urlOf} />)}</ul>
                          </div>
                        )}
                      </Card>
                    )}

                    <div data-testid="analysis-questions" className="rounded-[14px] border-[1.5px] border-dashed border-axal-hairline bg-white px-4 py-3.5 dark:border-gray-700 dark:bg-gray-900">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[13px] font-extrabold tracking-tight">Suggested research questions</span>
                        <span className="text-[11px] text-axal-muted">Questions, not findings · they never run on their own</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <KindTag kind="gen">Generated</KindTag>
                        {edited.next_actions ? <KindTag kind="ed">{`Edited by you ${day(edited.next_actions) || ''}`.trim()}</KindTag> : null}
                        {changed.includes('next_actions') ? <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300">· not saved</span> : null}
                      </div>
                      <textarea aria-label="Suggested research questions" className={`${inputClass} mt-2`} rows={3}
                        value={draft.next_actions} placeholder="One per line"
                        onChange={(e) => set('next_actions')(e.target.value)} />
                      <p className="mt-1.5 text-[11.5px] text-axal-muted">
                        {draft.next_actions.trim()
                          ? 'From the run’s next steps, and any statement no source in the run supports. Add a source to answer one.'
                          : <><Unrecorded /> <span className="ml-1">the run listed none</span></>}
                      </p>
                    </div>

                    {excluded.length > 0 && (
                      <p data-testid="analysis-excluded" className="text-[12px] text-axal-muted">
                        <span className="font-semibold text-axal-ink dark:text-gray-100">Excluded from candidates</span>{' '}
                        {excluded.map((x) => `${x.name}${x.domain ? ` · ${x.domain}` : ''}`).join(', ')} — the subject.
                      </p>
                    )}

                    <Card data-testid="analysis-competitors">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={eyebrow}>Competitors</span>
                        <span className="text-[11px] text-axal-muted">{`${candidates.length} ${candidates.length === 1 ? 'competitor' : 'competitors'}`}</span>
                      </div>
                      {analysis?.directory_match === 'unreadable' && candidates.length ? (
                        <p className="mt-1 text-[11px] text-axal-muted">Directory profiles: Unreadable. The company directory could not be read, so no competitor links to one.</p>
                      ) : null}
                      {candidates.length ? (
                        <>
                        {/* D7175 (RS-13 C1, C2): cards in place of the table below 1024px. */}
                        <ul className="mt-2.5 space-y-2 lg:hidden" data-testid="analysis-competitor-cards">
                          {candidates.map((c) => {
                            const sup = candidateSupport(c, allSources);
                            return (
                              <li key={c.id} className="rounded-xl border border-axal-hairline p-3 dark:border-gray-800">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                  <Link to={`/research/companies/${encodeURIComponent(id)}/${encodeURIComponent(c.id)}`}
                                    className="text-[13px] font-bold text-violet-700 hover:underline dark:text-violet-300">{c.name}</Link>
                                  <span className="text-[11px] font-semibold text-axal-muted">{classificationWord(c, sup)}</span>
                                </div>
                                <div className="text-[11px] text-axal-muted">
                                  {c.domain || 'Website: Not recorded'} · {ORIGIN_WORD[c.origin] || ORIGIN_WORD.known}
                                  {c.relevance_score == null ? '' : ` · relevance ${c.relevance_score}`}
                                </div>
                                {c.summary ? <p className="mt-1.5 text-[12px] text-axal-ink dark:text-gray-100">{c.summary}</p> : null}
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {sup.chips.length ? sup.chips.map((x, i) => <SourceChip key={i} chip={x} />)
                                    : <StateChip kind="not_applicable" label={sup.notAttempted ? 'Not attempted · no website' : 'No source read'} />}
                                  {allSources.some((s) => s.candidate_id === c.id && s.origin === 'manual') ? <KindTag kind="man">attached</KindTag> : null}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                  <select aria-label={`Classification for ${c.name}`}
                                    className="min-h-[44px] rounded-md border border-axal-hairline bg-white px-2 text-[12px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                                    value={c.category === 'adjacent' ? 'adjacent' : 'direct'} disabled={busy !== ''}
                                    onChange={(e) => run('category', () => api.competitors.candidateUpdate(analysis.id, c.id, { category: e.target.value }))}>
                                    <option value="direct">Direct</option>
                                    <option value="adjacent">Adjacent</option>
                                  </select>
                                  <button type="button" className="min-h-[44px] px-2 text-[12px] font-semibold text-red-700 hover:underline disabled:opacity-50 dark:text-red-300"
                                    disabled={busy !== ''} onClick={() => run('remove', () => api.competitors.removeCandidate(analysis.id, c.id))}>
                                    {`Remove ${c.name}`}
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                        <div className="mt-2.5 hidden overflow-x-auto lg:block">
                          <table className="w-full min-w-[760px] text-left text-[12px]">
                            <caption className="sr-only">Classification and the evidence behind it · the subject is excluded</caption>
                            <thead>
                              {/* D7175 part 2 (RS-13 B1): the canvas's five columns; Remove stays as the row's action. */}
                              <tr>
                                {['Company', 'Classification', 'Why · support', 'Sources'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}
                                <th scope="col" className={`${th} text-right`}>Relevance</th>
                                <th scope="col" className={th}><span className="sr-only">Remove</span></th>
                              </tr>
                            </thead>
                            <tbody>
                              {candidates.map((c) => (
                                <tr key={c.id} data-testid={`competitor-row-${c.id}`} className={`border-t border-axal-hairline align-top dark:border-gray-800 ${c.origin === 'manual' ? 'bg-violet-50/60 dark:bg-violet-950/20' : ''}`}>
                                  <td className="py-2.5 pr-2">
                                    <Link
                                      to={`/research/companies/${encodeURIComponent(id)}/${encodeURIComponent(c.id)}`}
                                      className="font-bold text-violet-700 hover:underline dark:text-violet-300"
                                    >
                                      {c.name}
                                    </Link>
                                    <div className="text-[11px] text-axal-muted">
                                      {c.domain || 'Website: Not recorded'} · {ORIGIN_WORD[c.origin] || ORIGIN_WORD.known}
                                    </div>
                                    {/* D593 (the C0 board): the directory profile, only when exactly
                                        one directory company has this site or this name. A name
                                        with no profile gets no link. */}
                                    {c.directory_uid ? (
                                      <Link to={companyHref(c.directory_uid)} data-testid={`competitor-directory-${c.id}`}
                                        className="mt-0.5 inline-block text-[11px] font-semibold text-violet-700 hover:underline dark:text-violet-300">
                                        Directory profile →
                                      </Link>
                                    ) : null}
                                  </td>
                                  <td className="py-2.5 pr-2">
                                    <select
                                      aria-label={`Classification for ${c.name}`}
                                      className="rounded-md border border-axal-hairline bg-white px-1.5 py-1 text-[11.5px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                                      value={c.category === 'adjacent' ? 'adjacent' : 'direct'}
                                      disabled={busy !== ''}
                                      onChange={(e) => run('category', () => api.competitors.candidateUpdate(analysis.id, c.id, { category: e.target.value }))}
                                    >
                                      <option value="direct">Direct</option>
                                      <option value="adjacent">Adjacent</option>
                                    </select>
                                    {supportBy[c.id].unconfirmed
                                      ? <div className="mt-1 text-[10.5px] font-semibold text-amber-800 dark:text-amber-300">unconfirmed · no source read</div>
                                      : null}
                                  </td>
                                  <td className="max-w-[340px] py-2.5 pr-2">
                                    <span className="text-axal-ink dark:text-gray-100">{c.summary || <Unrecorded />}</span>
                                    <small className="mt-0.5 block text-[11px] text-axal-muted">
                                      {supportBy[c.id].tried
                                        ? `Read from ${supportBy[c.id].fetched} of ${supportBy[c.id].tried} ${supportBy[c.id].tried === 1 ? 'source' : 'sources'}`
                                        : <StateChip kind="not_applicable" label={supportBy[c.id].notAttempted ? 'Not attempted · no website' : 'No source read'} />}
                                    </small>
                                  </td>
                                  <td className="py-2.5 pr-2">
                                    {supportBy[c.id].chips.length || attachedTo(c.id)
                                      ? (
                                        <span className="flex flex-wrap gap-1">
                                          {supportBy[c.id].chips.map((x, i) => <SourceChip key={i} chip={x} />)}
                                          {attachedTo(c.id) ? <KindTag kind="man">attached</KindTag> : null}
                                        </span>
                                      )
                                      : <span className="text-[11px] text-axal-muted">none attempted</span>}
                                  </td>
                                  <td className="py-2.5 pr-2 text-right font-mono">
                                    {c.relevance_score == null ? <Unrecorded /> : `${c.relevance_score} / 100`}
                                  </td>
                                  <td className="py-2.5">
                                    <button type="button" className="text-[11.5px] font-semibold text-red-700 hover:underline disabled:opacity-50 dark:text-red-300"
                                      disabled={busy !== ''}
                                      onClick={() => run('remove', () => api.competitors.removeCandidate(analysis.id, c.id))}>
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        </>
                      ) : (
                        <div className="mt-2.5 rounded-xl border-[1.5px] border-dashed border-axal-hairline p-4 dark:border-gray-700">
                          <p className="text-[13px] font-extrabold">No competitors yet</p>
                          <p className="mt-1 text-[12px] text-axal-muted">Add one manually or re-run. The product will not invent a top-10.</p>
                        </div>
                      )}

                      <div className="mt-3 rounded-xl border border-dashed border-axal-hairline p-3 dark:border-gray-700" data-testid="analysis-add">
                        <div className={eyebrow}>Add competitor</div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
                          <input ref={addNameRef} aria-label="Name" className={inputClass} placeholder="Name *" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
                          <input aria-label="Website" className={inputClass} placeholder="https://" value={manual.url} onChange={(e) => setManual({ ...manual, url: e.target.value })} />
                          <input aria-label="Summary" className={inputClass} placeholder="Summary" value={manual.summary} onChange={(e) => setManual({ ...manual, summary: e.target.value })} />
                          <select aria-label="Category" className={inputClass} value={manual.category} onChange={(e) => setManual({ ...manual, category: e.target.value })}>
                            <option value="direct">Direct</option>
                            <option value="adjacent">Adjacent</option>
                          </select>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <label className="inline-flex items-center gap-1.5 text-[12px] text-axal-muted">
                            <input type="checkbox" checked={manual.crawl} onChange={(e) => setManual({ ...manual, crawl: e.target.checked })} />
                            Crawl site
                          </label>
                          <button type="button" className={primaryBtn} disabled={!manual.name.trim() || busy !== ''}
                            onClick={() => run('add', async () => {
                              const full = await api.competitors.addCandidate(analysis.id, { ...manual, name: manual.name.trim() }, railPressHeaders('extract:candidate'));
                              setManual(EMPTY_MANUAL);
                              return full;
                            })}>
                            {busy === 'add' ? 'Adding…' : 'Add'}
                          </button>
                          <span className="text-[11px] text-axal-muted">
                            Origin becomes manual, and the row takes the next position — it is appended, not stacked on the first.
                          </span>
                        </div>
                      </div>
                    </Card>

                    {/* Evidence (RS-14 A2, B1): every source, how it got here and when it was fetched. */}
                    <Card data-testid="analysis-evidence">
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <h2 className="text-[15px] font-extrabold tracking-tight">Evidence</h2>
                        <span className="font-mono text-[11px] text-axal-muted">{`${allSources.length} ${allSources.length === 1 ? 'source' : 'sources'} · ${counts.fetched} fetched · ${counts.manualSources} attached by you`}</span>
                      </div>
                      {allSources.length ? (
                        <div className="mt-2.5 overflow-x-auto">
                          <table className="w-full min-w-[680px] text-left text-[12px]">
                            <thead>
                              <tr>{['Source', 'Competitor', 'How it got here', 'Fetched', refreshed ? 'This refresh' : 'State'].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
                            </thead>
                            <tbody>
                              {allSources.map((s) => {
                                const r = refreshed?.byId?.[s.id];
                                const failedRefresh = failure?.kind === 'refresh';
                                return (
                                  <tr key={s.id} className={`border-t border-axal-hairline align-top dark:border-gray-800 ${s.origin === 'manual' ? 'bg-violet-50/60 dark:bg-violet-950/20' : ''}`}>
                                    <td className="py-2 pr-2"><b className="break-all">{s.title || s.url}</b><small className="block break-all text-axal-muted">{s.url}{s.kind ? ` · ${s.kind}` : ''}</small></td>
                                    <td className="py-2 pr-2">{nameOf[s.candidate_id] || <Unrecorded />}</td>
                                    <td className="py-2 pr-2">{s.origin === 'manual' ? <KindTag kind="man" /> : <KindTag kind="fet" />}</td>
                                    <td className="py-2 pr-2 font-mono">{dayTime(s.fetched_at) || <Unrecorded />}</td>
                                    <td className="py-2">
                                      {r ? (r.ok
                                        ? <span className="font-semibold text-emerald-700 dark:text-emerald-300">Fetched again</span>
                                        : (
                                          <span className="flex flex-wrap items-center gap-1">
                                            <span className="font-semibold text-red-700 dark:text-red-300">{`Not fetched${r.status ? ` · ${r.status}` : ''}`}</span>
                                            <StateChip kind="stale" lastGood={s.fetched_at} />
                                          </span>
                                        ))
                                        : failedRefresh ? <StateChip kind="stale" lastGood={s.fetched_at} />
                                          : sourceFetched(s) ? <span className="font-semibold text-emerald-700 dark:text-emerald-300">Fetched</span>
                                            : <span className="font-semibold text-red-700 dark:text-red-300">{`Not fetched${s.status ? ` · ${s.status}` : ''}`}</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="mt-2 text-[12px] text-axal-muted">No source is recorded for this analysis yet.</p>
                      )}
                    </Card>

                    {grid && (
                      <Card data-testid="analysis-features">
                        <div className={eyebrow}>Feature comparison</div>
                        <div className="mt-2.5 overflow-x-auto">
                          <table className="w-full text-left text-[12px]">
                            <thead><tr><th className={th}>Feature</th>{grid.head.map((h, i) => <th key={`${h}-${i}`} className={th}>{h}</th>)}</tr></thead>
                            <tbody>
                              {grid.rows.map((r, ri) => (
                                <tr key={`${r.feature}-${ri}`} className="border-t border-axal-hairline dark:border-gray-800">
                                  <td className="py-2 pr-3 font-semibold">{r.feature}</td>
                                  {r.cells.map((v, ci) => <td key={ci} className="py-2 pr-3 text-axal-muted">{v === null ? <Unrecorded /> : v}</td>)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    )}

                    {signals.length > 0 && (
                      <div className="grid gap-3 md:grid-cols-2">
                        {signals.map((col) => (
                          <Card key={col.k}>
                            <div className={eyebrow}>{col.k}</div>
                            <ul className="mt-2 space-y-1.5 text-[12px]">
                              {col.lines.map((l, i) => (
                                <li key={i} className="text-axal-muted"><span className="font-semibold text-axal-ink dark:text-gray-100">{l.who}:</span> {l.text}</li>
                              ))}
                            </ul>
                          </Card>
                        ))}
                      </div>
                    )}

                    <div data-testid="analysis-draft" className="rounded-[14px] border border-violet-200 bg-violet-50 px-4 py-3.5 dark:border-violet-900 dark:bg-violet-950/40">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-violet-700 px-2 py-0.5 text-[10px] font-extrabold tracking-[.06em] text-white">ZONEDRAFT</span>
                        <span className="text-[13px] font-extrabold tracking-tight">Analysis · landscape read</span>
                      </div>
                      <p className="mt-2 text-[12px] leading-relaxed text-axal-ink dark:text-gray-100">
                        {read
                          ? 'Restates only what is on this page: the market summary, the companies and their summaries, and the source kinds already fetched. It will not invent a wedge, a price, or a company.'
                          : 'Add a competitor or a summary first.'}
                      </p>
                      {preview && (
                        <textarea aria-label="Landscape read" className={`${inputClass} mt-2`} rows={5} value={preview}
                          onChange={(e) => setPreview(e.target.value)} />
                      )}
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <button type="button" className={primaryBtn} disabled={!read || busy !== ''} onClick={() => setPreview(read)}>Draft</button>
                        <button type="button" className={ghostBtn} disabled={!preview.trim() || dirty || busy !== ''}
                          onClick={() => run('accept', async () => {
                            const notes = notesWithRead(out.notes, preview.trim());
                            const full = await api.competitors.save(analysis.id, { output: { ...out, notes }, base_version: analysis.version });
                            setPreview('');
                            return full;
                          }, 'Written into your notes.')}>
                          Accept
                        </button>
                        <button type="button" className="px-1.5 py-1.5 text-[12px] font-semibold text-axal-muted disabled:opacity-40"
                          disabled={!preview} onClick={() => setPreview('')}>
                          Discard
                        </button>
                        <span className="text-[11px] text-axal-muted sm:ml-auto">
                          {dirty && preview ? 'Save your edits first — Accept writes the saved notes. ' : ''}
                          Accept writes your notes. It does not add competitors.
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* Phone (RS-14 E): a bottom bar with Save and Actions ⋯; the actions live in a sheet. */}
            {/* The review carries its own sticky Cancel and Accept, so the bar steps aside while it is open (RS-14 E D). */}
            {!proposal && (
            <div className="fixed inset-x-0 bottom-[var(--mobile-tabbar-h,0px)] z-30 flex gap-2 border-t border-axal-hairline bg-white px-4 py-2.5 dark:border-gray-800 dark:bg-gray-950 md:hidden" data-testid="analysis-phone-bar">
              <button type="button" className={`${dirty || saveError ? primaryBtn : ghostBtn} min-h-[48px] flex-1`} onClick={save} disabled={!dirty || acting}>
                {busy === 'save' ? 'Saving…' : saveError ? 'Retry save' : dirty ? 'Save' : 'Saved'}
              </button>
              <button type="button" ref={actionsRef} className={`${ghostBtn} min-h-[48px] flex-1`} aria-haspopup="dialog" aria-expanded={sheetOpen ? 'true' : 'false'}
                disabled={acting || !!proposal} onClick={() => setSheetOpen(true)}>
                Actions ⋯
              </button>
            </div>
            )}
            {sheetOpen && (
              <PhoneSheet title="Actions" onClose={() => setSheetOpen(false)} opener={actionsRef}>
                <p className="-mt-1 mb-1 text-[12px] text-axal-muted">{`Saved version ${version}${dirty ? ' · you have unsaved changes' : ''}`}</p>
                <SheetRow title="Refresh sources" description={`Fetches the ${allSources.length} ${allSources.length === 1 ? 'source' : 'sources'} again. Your text and the list stay.`}
                  onClick={() => { setSheetOpen(false); refresh(); }} />
                <SheetRow title="Rerun discovery" description="Searches again. You review every change before anything is replaced."
                  onClick={() => { setSheetOpen(false); rerun(); }} />
                <SheetRow title="Export Markdown" description={`Saved version ${version}.${dirty ? ' Asks first, because you have unsaved changes.' : ''}`}
                  onClick={() => startExport('md', actionsRef.current)} />
                <SheetRow title="Export JSON" description={`Saved version ${version}.${dirty ? ' Asks first.' : ''}`}
                  onClick={() => startExport('json', actionsRef.current)} />
                <SheetRow title="Preview the file" description={`Markdown or JSON for saved version ${version}, before it is downloaded.`}
                  onClick={() => openPreview(actionsRef.current)} />
                <button type="button" className={`${ghostBtn} mt-3 min-h-[48px] w-full`} onClick={() => setSheetOpen(false)}>Close</button>
              </PhoneSheet>
            )}
            {decision && (
              <ExportDecision format={decision} version={version} fields={changed} draftTitle={draft.title}
                onCancel={closeDecision} onExportSaved={exportSaved} onSaveThenExport={saveThenExport} />
            )}
          </>
        )}

        <StatedLimit title="What this page will not do">
          An analysis maps players you named or that a run returned, with the URLs that fed them. Direct and
          adjacent are filed per competitor. Nothing here is a relationship, a headcount, or a comparable.
          A rerun replaces nothing until you accept its changes, and never touches your title, conclusion, notes
          or anything you added by hand. Export writes the saved version.
        </StatedLimit>
      </div>
    </WorkspaceShell>
  );
}
