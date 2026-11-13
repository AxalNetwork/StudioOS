/**
 * D5157 part 3 (#5157) — Add to research and Compare, from Companies and Funds
 * (RS-04 A and B, RS-05 A and B in `design/incoming/Research v2 Page.dc.html`).
 *
 * One panel for both acts. It names what will be added, lets the member pick
 * one of their active Research Projects or start a new one, and then either
 * keeps the companies or funds in that project (Add to research) or opens a
 * comparison of them there (Compare). The answer is said in the panel, with a
 * link into the project; nothing is added until the member presses the button.
 *
 * HONEST STATES. The project list is loading, unreadable (with Retry, and no
 * button that could add to a project it cannot see) or read. A refusal is said
 * in words, and "Nothing was added" follows every failure.
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

const SECONDARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 sm:min-h-[32px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const INPUT = 'w-full rounded-md border border-axal-hairline bg-white px-2.5 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const MUTED = 'text-[12.5px] text-axal-muted dark:text-gray-400';

/** The most a comparison holds; the Worker refuses more. */
export const COMPARE_LIMIT = 6;

/**
 * `kind` is company or fund; `items` are `{ uid, name }`; `mode` is add or
 * compare. `onDone` hears the outcome, `{ projectUid, comparisonUid? }`.
 */
export default function AddToResearch({ kind, items, mode = 'add', onClose, onDone, returnFocusTo }) {
  const words = KIND_WORDS[kind] || KIND_WORDS.company;
  const compare = mode === 'compare';
  const [read, retry] = useProjectRead(() => researchProjectsApi.list('active'), 'active');
  const [target, setTarget] = useState(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const names = items.map((x) => x.name);
  const choices = read.status === 'ok' ? (read.value?.items || []).filter((p) => p && p.uid && p.status !== 'archived') : [];
  const tooMany = compare && items.length > COMPARE_LIMIT;

  const run = async (project) => {
    setBusy(true);
    setResult(null);
    try {
      if (compare) {
        const body = { kind, uids: items.map((x) => x.uid) };
        if (title.trim()) body.title = title.trim();
        const res = await researchProjectComparisonsApi.create(project.uid, body);
        setResult({ ok: true, project, comparisonUid: res?.item?.uid || null, text: `Comparison “${res?.item?.title || title.trim() || names.join(' · ')}” is in “${project.title}”.` });
        onDone?.({ projectUid: project.uid, comparisonUid: res?.item?.uid || null });
      } else {
        const res = await researchProjectComparisonsApi.addSubjects(project.uid, kind, items.map((x) => x.uid));
        setResult({ ok: true, project, text: addOutcome(names, project.title, res) });
        onDone?.({ projectUid: project.uid });
      }
    } catch (err) {
      setResult({ ok: false, text: `${comparisonError(err, 'It could not be added.')} Nothing was added.` });
    } finally { setBusy(false); }
  };
  const submit = (e) => {
    e?.preventDefault?.();
    const project = choices.find((p) => p.uid === target);
    if (project && !tooMany) run(project);
  };

  const heading = !compare ? 'Add to research' : items.length === 1 ? `Compare ${names[0]}` : `Compare ${items.length} ${words.many}`;
  return (
    <Sheet label={heading} eyebrow={compare ? 'Compare' : 'Add to research'} title={heading} onClose={onClose} phone="sheet" width={480}
      testId="add-to-research" returnFocusTo={returnFocusTo}>
      <div className="flex flex-col gap-3 px-5 pb-5 pt-1" data-testid="add-to-research-body">
        <p className={MUTED} data-testid="add-to-research-items">{names.join(', ')}</p>
        {tooMany ? <p role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="add-to-research-too-many">A comparison holds at most {COMPARE_LIMIT} {words.many}. Select fewer.</p> : null}
        {result ? (
          <div role={result.ok ? 'status' : 'alert'} className={`text-[13px] font-semibold ${result.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`} data-testid="add-to-research-result">
            <p>{result.text}</p>
            {result.ok ? (
              <Link className="mt-1 inline-block text-violet-700 underline dark:text-violet-300" data-testid="add-to-research-open"
                to={`/research/projects/${encodeURIComponent(result.project.uid)}/comparisons`}>
                {compare ? 'Open the comparison →' : 'Open the project →'}
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
                <legend className="mb-1 text-[12.5px] font-bold text-axal-ink dark:text-white">{compare ? 'Compare them in' : 'Add to'}</legend>
                {!choices.length ? <p className={MUTED} data-testid="add-to-research-none">You have no active research project yet. Start one below.</p> : null}
                {choices.map((p) => (
                  <label key={p.uid} className="flex min-h-[44px] items-center gap-2 rounded-lg border border-axal-hairline px-3 text-[13px] text-axal-ink sm:min-h-[36px] dark:border-gray-700 dark:text-gray-100">
                    <input type="radio" name="research-target" value={p.uid} checked={target === p.uid} onChange={() => setTarget(p.uid)} data-testid={`research-target-${p.uid}`} />
                    <span className="min-w-0 truncate">{p.title}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {compare ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="cmp-title" className="text-[12.5px] font-bold text-axal-ink dark:text-white">Title <span className="font-normal text-axal-muted dark:text-gray-400">· optional — the names are used if you leave it empty</span></label>
                <input id="cmp-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} className={INPUT} placeholder={names.join(' · ')} data-testid="input-comparison-title" />
              </div>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <button type="button" className={SECONDARY} onClick={() => setCreating(true)} disabled={busy || read.status !== 'ok'} data-testid="button-add-to-new-research">New research project</button>
              <button type="submit" className={BTN_PRIMARY} disabled={busy || !target || tooMany || read.status !== 'ok'} data-testid="button-add-to-research-confirm">
                {busy ? (compare ? 'Creating…' : 'Adding…') : compare ? 'Create comparison' : 'Add to project'}
              </button>
            </div>
          </form>
        ) : null}
        <p className="text-[11.5px] text-axal-faint dark:text-gray-500">
          {compare
            ? 'A comparison shows each value with its source and date. Missing values say Not recorded and never count as zero. Nothing is scored.'
            : `The project keeps the ${items.length === 1 ? words.one : words.many} by name; the values are read from the directory each time, with their source and date.`}
        </p>
      </div>
    </Sheet>
  );
}
