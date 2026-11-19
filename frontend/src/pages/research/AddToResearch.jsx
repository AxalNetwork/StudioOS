/**
 * D5157 part 3 (#5157) — Add to research and Compare, from Companies and Funds
 * (RS-04 A and B, RS-05 A and B in `design/incoming/Research v2 Page.dc.html`).
 *
 * The same picker also links an Ask answer to a project (D5157 part 5).
 * It names what will be added, lets the member pick
 * one of their active Research Projects or start a new one, and then either
 * keeps the companies or funds in that project (Add to research) or opens a
 * comparison of them there (Compare). The answer is said in the panel, with a
 * link into the project; nothing is added until the member presses the button.
 *
 * D7177 (#7177, canvas D7043 board RS-15 B) — THE COMPARE SHEET. The
 * companies in column order, an existing project or a new one (made in the
 * same save as the comparison, both or neither), and a title generated from
 * the names within 160 characters. The sheet mints one request id when it
 * opens and every attempt from it sends that id, so a repeat cannot make a
 * second comparison. The words follow the Worker's answer: saving; saved, with
 * a link to the comparison; refused before any write; a rollback the Worker
 * confirmed; or an outcome it could not give, with Check save status (a read)
 * and no retry until that read says it is safe. "Nothing was added" appears
 * only after a refusal before any write or a confirmed rollback, and the
 * directory's selection is kept after any failure.
 *
 * HONEST STATES. The project list is loading, unreadable (with Retry, and no
 * button that could add to a project it cannot see) or read.
 *
 * The panel is the shared `Sheet`: a side panel on a desktop, a bottom sheet on
 * a phone, with focus returned to the button that opened it.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Sheet from '../../ui/Sheet.jsx';
import { BTN_PRIMARY } from '../hq/security/ActionDialog.jsx';
import { researchProjectsApi } from '../../lib/api/researchProjects.js';
import { researchProjectComparisonsApi } from '../../lib/api/researchProjectComparisons.js';
import { NewResearchForm, useProjectRead } from './MyResearch.jsx';
import { KIND_WORDS, addOutcome, comparisonError } from './researchComparisons.js';
import {
  COMPARE_MAX, OUTCOME_COPY, TITLE_MAX, generatedTitle, newRequestId, refusedBeforeWrite, rolledBackSentence, saveOutcome, savedSentence, statusView,
} from './comparisonSave.js';

const SECONDARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 sm:min-h-[32px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const INPUT = 'w-full rounded-md border border-axal-hairline bg-white px-2.5 py-2 text-[13px] text-axal-ink disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';
const LABEL = 'text-[12.5px] font-bold text-axal-ink dark:text-white';
const LINK_BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 text-[12.5px] font-bold sm:min-h-[32px]';

/** The most a comparison holds; the Worker refuses more. */
export const COMPARE_LIMIT = COMPARE_MAX;

/** Each outcome's frame, keyed to the canvas's state chips. */
const TONE = {
  saving: 'border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20',
  ok: 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20',
  saved: 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20',
  refused: 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900',
  rolled_back: 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900',
  not_found: 'border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900',
  unknown: 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/20',
  unreadable: 'border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20',
};

/** One outcome panel: its state chip, its heading, what happened and what can be done. */
function Outcome({ kind, chip, head, body, role, children, testId = 'add-to-research-result' }) {
  return (
    <section role={role} className={`flex flex-col gap-1.5 rounded-lg border p-3 ${TONE[kind] || TONE.refused}`} data-testid={testId} data-outcome={kind}>
      <span className="text-[11px] font-extrabold uppercase tracking-wide text-axal-muted dark:text-gray-400">{chip}</span>
      <b className="text-[13.5px] text-axal-ink dark:text-white">{head}</b>
      {body ? <p className="text-[12.5px] text-axal-ink dark:text-gray-200">{body}</p> : null}
      {children ? <div className="mt-1 flex flex-wrap gap-2">{children}</div> : null}
    </section>
  );
}

const comparisonHref = (projectUid, comparisonUid) => `/research/projects/${encodeURIComponent(projectUid)}/comparisons${comparisonUid ? `#comparison-${encodeURIComponent(comparisonUid)}` : ''}`;

/** RS-15 B: the Compare sheet's body, from the form to the outcome. */
function CompareSheet({ kind, items, read, retry, choices, onClose, onDone, onSaving }) {
  const words = KIND_WORDS[kind] || KIND_WORDS.company;
  const names = items.map((x) => x.name);
  const [requestId] = useState(newRequestId);
  const [target, setTarget] = useState(null);
  const [draft, setDraft] = useState({ question: '', projectTitle: '' });
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState('form');
  const [outcome, setOutcome] = useState(null);
  const [status, setStatus] = useState(null);
  const tooMany = items.length > COMPARE_MAX;
  const creating = target === 'new';
  const project = choices.find((p) => p.uid === target) || null;
  const generated = generatedTitle(names);
  const shown = title.trim() || generated;
  const ready = !tooMany && read.status === 'ok' && (project || (creating && draft.question.trim()));

  const save = async () => {
    if (!ready) return;
    setPhase('saving');
    onSaving?.(true);
    setStatus(null);
    const body = { kind, uids: items.map((x) => x.uid), request_id: requestId };
    if (title.trim()) body.title = title.trim();
    try {
      const res = creating
        ? await researchProjectComparisonsApi.createWithProject({ ...body, project: { question: draft.question.trim(), ...(draft.projectTitle.trim() ? { title: draft.projectTitle.trim() } : {}) } })
        : await researchProjectComparisonsApi.create(project.uid, body);
      const o = saveOutcome({ res });
      setOutcome({ ...o, res });
      if (o.kind === 'ok') onDone?.({ projectUid: res.project?.uid, comparisonUid: res.item?.uid });
    } catch (err) {
      setOutcome({ ...saveOutcome({ err }), err });
    } finally { setPhase('outcome'); onSaving?.(false); }
  };
  const check = async () => {
    setPhase('checking');
    try {
      setStatus(statusView({ res: await researchProjectComparisonsApi.saveStatus(requestId) }));
    } catch (err) {
      setStatus(statusView({ err }));
    } finally { setPhase('outcome'); }
  };
  const back = () => { setOutcome(null); setStatus(null); setPhase('form'); };
  const submit = (e) => { e?.preventDefault?.(); save(); };
  const locked = phase !== 'form';
  const projectTitle = creating ? (draft.projectTitle.trim() || draft.question.trim()) : project?.title;
  const openProject = project ? (
    <Link className={`${SECONDARY}`} to={`/research/projects/${encodeURIComponent(project.uid)}/comparisons`} data-testid="link-outcome-project">Open the project</Link>
  ) : null;

  let panel = null;
  if (phase === 'saving') panel = <Outcome kind="saving" {...OUTCOME_COPY.saving} />;
  else if (phase === 'checking') panel = <Outcome kind="saving" chip="Checking" head="Reading the save status…" body="Looking for this request’s comparison. This is a read; it never writes." role="status" testId="add-to-research-status" />;
  else if (status) {
    panel = (
      <Outcome kind={status.kind} chip={status.chip} head={status.head} body={status.body} role={status.kind === 'saved' ? 'status' : 'alert'} testId="add-to-research-status">
        {status.kind === 'saved' ? <Link className={`${LINK_BTN} bg-violet-700 text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500`} to={comparisonHref(status.res.project?.uid, status.res.item?.uid)} data-testid="add-to-research-open">Open the comparison →</Link> : null}
        {status.kind === 'not_found' ? <button type="button" className={BTN_PRIMARY} onClick={save} data-testid="button-outcome-retry">Try again</button> : null}
        {status.kind === 'unreadable' ? <button type="button" className={BTN_PRIMARY} onClick={check} data-testid="button-outcome-check">Check again</button> : null}
      </Outcome>
    );
  } else if (outcome) {
    const copy = OUTCOME_COPY[outcome.kind];
    if (outcome.kind === 'ok') {
      panel = (
        <Outcome kind="ok" chip={copy.chip} head={copy.head} body={savedSentence(outcome.res)} role={copy.role}>
          <Link className={`${LINK_BTN} bg-violet-700 text-white hover:bg-violet-800 dark:bg-violet-600 dark:hover:bg-violet-500`} to={comparisonHref(outcome.res.project?.uid, outcome.res.item?.uid)} data-testid="add-to-research-open">Open the comparison →</Link>
          <button type="button" className={SECONDARY} onClick={onClose} data-testid="button-outcome-done">Done</button>
        </Outcome>
      );
    } else if (outcome.kind === 'refused') {
      panel = (
        <Outcome kind="refused" chip={copy.chip} head={copy.head} role={copy.role}
          body={`${comparisonError(outcome.err, 'The Worker refused the request before writing anything.')} Your ${items.length} ${words.many} stay selected.`}>
          <button type="button" className={SECONDARY} onClick={back} data-testid="button-outcome-back">Choose another project</button>
        </Outcome>
      );
    } else if (outcome.kind === 'rolled_back') {
      panel = (
        <Outcome kind="rolled_back" chip={copy.chip} head={copy.head} body={rolledBackSentence(projectTitle, items.length)} role={copy.role}>
          <button type="button" className={BTN_PRIMARY} onClick={save} data-testid="button-outcome-retry">Try again</button>
        </Outcome>
      );
    } else {
      panel = (
        <Outcome kind="unknown" chip={copy.chip} head={copy.head} body={copy.body} role={copy.role}>
          <button type="button" className={BTN_PRIMARY} onClick={check} data-testid="button-outcome-check">Check save status</button>
          {openProject}
        </Outcome>
      );
    }
  }
  const settled = outcome?.kind === 'ok' || status?.kind === 'saved';

  return (
    <div className="flex flex-col gap-3" data-testid="compare-sheet">
      <div>
        <div className={`${LABEL} flex items-baseline justify-between`}>
          <span>{words.title}, in column order</span>
          <span className="font-mono text-[11.5px] font-semibold text-axal-muted dark:text-gray-400">{items.length} of {COMPARE_MAX}</span>
        </div>
        <ol className="mt-1.5 flex flex-col gap-1 text-[13px] text-axal-ink dark:text-gray-100" data-testid="add-to-research-items">
          {items.map((x, i) => (
            <li key={x.uid} className="flex items-center gap-2"><span className="w-4 text-right font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{i + 1}</span><span className="min-w-0 truncate">{x.name}</span></li>
          ))}
        </ol>
      </div>
      {tooMany ? <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="add-to-research-too-many">A comparison holds at most {COMPARE_MAX} {words.many}. Remove {items.length - COMPARE_MAX} to compare.</p> : null}
      {panel}
      {!settled ? (
        <form onSubmit={submit} className="flex flex-col gap-3" data-testid="form-add-to-research">
          <fieldset disabled={locked} className="flex flex-col gap-3">
            {read.status === 'loading' ? <p className={MUTED} role="status">Reading your research projects…</p> : null}
            {read.status === 'failed' || read.status === 'not_found' ? (
              <p className={MUTED} role="status" data-testid="add-to-research-unreadable">
                Unavailable: your research projects could not be read, so nothing can be added yet.{' '}
                <button type="button" className="underline" onClick={retry} data-testid="button-add-to-research-retry">Retry</button>
              </p>
            ) : null}
            {read.status === 'ok' ? (
              <fieldset className="flex flex-col gap-1.5">
                <legend className={`mb-1 ${LABEL}`}>Compare them in</legend>
                {!choices.length ? <p className={MUTED} data-testid="add-to-research-none">You have no active research project yet. Start one below.</p> : null}
                {choices.map((p) => (
                  <label key={p.uid} className="flex min-h-[44px] items-center gap-2 rounded-lg border border-axal-hairline px-3 text-[13px] text-axal-ink sm:min-h-[36px] dark:border-gray-700 dark:text-gray-100">
                    <input type="radio" name="research-target" value={p.uid} checked={target === p.uid} onChange={() => setTarget(p.uid)} data-testid={`research-target-${p.uid}`} />
                    <span className="min-w-0 truncate">{p.title}</span>
                  </label>
                ))}
                <label className="flex min-h-[44px] items-center gap-2 rounded-lg border border-axal-hairline px-3 text-[13px] text-axal-ink sm:min-h-[36px] dark:border-gray-700 dark:text-gray-100">
                  <input type="radio" name="research-target" value="new" checked={creating} disabled={tooMany} onChange={() => setTarget('new')}
                    aria-describedby={tooMany ? 'cmp-new-why' : undefined} data-testid="research-target-new" />
                  <span className="min-w-0"><b className="block">New research project</b>
                    <small id="cmp-new-why" className={MUTED}>{tooMany ? `Not while more than ${COMPARE_MAX} are selected` : 'Created in the same save as the comparison: both or neither'}</small></span>
                </label>
              </fieldset>
            ) : null}
            {creating ? (
              <div className="flex flex-col gap-2 rounded-lg border border-axal-hairline p-3 dark:border-gray-700" data-testid="compare-new-project">
                <label htmlFor="cmp-np-question" className={LABEL}>What would you like to investigate? <span className="font-normal text-axal-muted dark:text-gray-400">· required</span></label>
                <textarea id="cmp-np-question" rows={2} value={draft.question} maxLength={1000} onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))} className={INPUT} data-testid="input-compare-project-question" />
                <label htmlFor="cmp-np-title" className={LABEL}>New project title <span className="font-normal text-axal-muted dark:text-gray-400">· optional — the question is used if you leave it empty</span></label>
                <input id="cmp-np-title" value={draft.projectTitle} maxLength={TITLE_MAX} onChange={(e) => setDraft((d) => ({ ...d, projectTitle: e.target.value }))} className={INPUT} data-testid="input-compare-project-title" />
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <label htmlFor="cmp-title" className={LABEL}>Title <span className="font-normal text-axal-muted dark:text-gray-400">· optional — the names are used if you leave it empty</span></label>
              <input id="cmp-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX} className={INPUT} placeholder={generated} aria-describedby="cmp-title-count" data-testid="input-comparison-title" />
              <div id="cmp-title-count" className={`flex justify-between gap-2 text-[11.5px] ${shown.length >= TITLE_MAX ? 'font-semibold text-amber-800 dark:text-amber-300' : 'text-axal-muted dark:text-gray-400'}`} data-testid="comparison-title-count">
                <span>{title.trim() ? (shown.length >= TITLE_MAX ? `At the limit: the field takes no more than ${TITLE_MAX} characters` : 'Your title') : 'Generated from the names, cut at a whole name'}</span>
                <span className="font-mono">{shown.length} / {TITLE_MAX}</span>
              </div>
            </div>
          </fieldset>
          {phase === 'form' && !outcome ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className={SECONDARY} onClick={onClose}>Cancel</button>
              <button type="submit" className={BTN_PRIMARY} disabled={!ready} data-testid="button-add-to-research-confirm">
                {creating ? 'Create project and comparison' : 'Create comparison'}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}
      <p className="text-[11.5px] text-axal-faint dark:text-gray-500">If the save fails, the selection and title stay as they are.</p>
    </div>
  );
}

/**
 * `kind` is company or fund; `items` are `{ uid, name }`; `mode` is add or
 * compare. `onDone` hears the outcome, `{ projectUid, comparisonUid? }`.
 */
export default function AddToResearch({ kind, items, mode = 'add', onClose, onDone, returnFocusTo }) {
  const answer = kind === 'answer';
  const words = KIND_WORDS[kind] || KIND_WORDS.company;
  const compare = mode === 'compare';
  const [read, retry] = useProjectRead(() => researchProjectsApi.list('active'), 'active');
  const [target, setTarget] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const names = items.map((x) => x.name);
  const choices = read.status === 'ok' ? (read.value?.items || []).filter((p) => p && p.uid && p.status !== 'archived') : [];

  const run = async (project) => {
    setBusy(true);
    setResult(null);
    try {
      if (answer) {
        await researchProjectsApi.link(project.uid, 'answers', items[0].uid);
        setResult({ ok: true, project, text: `Answer saved to “${project.title}”.` });
      } else {
        const res = await researchProjectComparisonsApi.addSubjects(project.uid, kind, items.map((x) => x.uid));
        setResult({ ok: true, project, text: addOutcome(names, project.title, res) });
      }
      onDone?.({ projectUid: project.uid });
    } catch (err) {
      // D7177: "Nothing was added" only when the Worker refused before writing.
      const said = comparisonError(err, 'It could not be added.');
      setResult(refusedBeforeWrite(err)
        ? { ok: false, text: `${said} Nothing was added.` }
        : { ok: false, project, text: `${said} It may have been added in part; open the project to check before trying again.` });
    } finally { setBusy(false); }
  };
  const submit = (e) => {
    e?.preventDefault?.();
    const project = choices.find((p) => p.uid === target);
    if (project) run(project);
  };

  const heading = answer ? 'Save to project' : !compare ? 'Add to research' : items.length === 1 ? `Compare ${names[0]}` : `Compare ${items.length} ${words.many}`;
  return (
    // Escape and the scrim do not close the sheet while a save is in flight.
    <Sheet label={heading} eyebrow={compare ? 'Compare' : 'Add to research'} title={heading} onClose={() => { if (!saving) onClose?.(); }} phone="sheet" width={480}
      testId="add-to-research" returnFocusTo={returnFocusTo}>
      <div className="flex flex-col gap-3 px-5 pb-5 pt-1" data-testid="add-to-research-body">
        {compare ? (
          <CompareSheet kind={kind} items={items} read={read} retry={retry} choices={choices} onClose={onClose} onDone={onDone} onSaving={setSaving} />
        ) : (
          <>
            <p className={MUTED} data-testid="add-to-research-items">{names.join(', ')}</p>
            {result ? (
              <div role={result.ok ? 'status' : 'alert'} className={`text-[13px] font-semibold ${result.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`} data-testid="add-to-research-result">
                <p>{result.text}</p>
                {result.project ? (
                  <Link className="mt-1 inline-block text-violet-700 underline dark:text-violet-300" data-testid="add-to-research-open"
                    to={`/research/projects/${encodeURIComponent(result.project.uid)}${answer ? '' : '/comparisons'}`}>
                    Open the project →
                  </Link>
                ) : null}
              </div>
            ) : null}
            {!result?.ok && creating ? (
              <NewResearchForm onCancel={() => setCreating(false)} onCreated={(item) => { setCreating(false); if (item?.uid) run(item); }} />
            ) : null}
            {!result?.ok && !creating ? (
              <form onSubmit={submit} className="flex flex-col gap-3" data-testid="form-add-to-research">
                {read.status === 'loading' ? <p className={MUTED} role="status">Reading your research projects…</p> : null}
                {read.status === 'failed' || read.status === 'not_found' ? (
                  <p className={MUTED} role="status" data-testid="add-to-research-unreadable">
                    Unavailable: your research projects could not be read, so nothing can be added yet.{' '}
                    <button type="button" className="underline" onClick={retry} data-testid="button-add-to-research-retry">Retry</button>
                  </p>
                ) : null}
                {read.status === 'ok' ? (
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className={`mb-1 ${LABEL}`}>Add to</legend>
                    {!choices.length ? <p className={MUTED} data-testid="add-to-research-none">You have no active research project yet. Start one below.</p> : null}
                    {choices.map((p) => (
                      <label key={p.uid} className="flex min-h-[44px] items-center gap-2 rounded-lg border border-axal-hairline px-3 text-[13px] text-axal-ink sm:min-h-[36px] dark:border-gray-700 dark:text-gray-100">
                        <input type="radio" name="research-target" value={p.uid} checked={target === p.uid} onChange={() => setTarget(p.uid)} data-testid={`research-target-${p.uid}`} />
                        <span className="min-w-0 truncate">{p.title}</span>
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                  <button type="button" className={SECONDARY} onClick={() => setCreating(true)} disabled={busy || read.status !== 'ok'} data-testid="button-add-to-new-research">New research project</button>
                  <button type="submit" className={BTN_PRIMARY} disabled={busy || !target || read.status !== 'ok'} data-testid="button-add-to-research-confirm">
                    {busy ? (answer ? 'Saving…' : 'Adding…') : answer ? 'Save answer' : 'Add to project'}
                  </button>
                </div>
              </form>
            ) : null}
          </>
        )}
        <p className="text-[11.5px] text-axal-faint dark:text-gray-500">
          {answer ? 'The project keeps a link to this Ask answer and its recorded citations.' : compare
            ? 'A comparison shows each value with its source and date. Missing values say Not recorded and never count as zero. Nothing is scored.'
            : `The project keeps the ${items.length === 1 ? words.one : words.many} by name; the values are read from the directory each time, with their source and date.`}
        </p>
      </div>
    </Sheet>
  );
}
