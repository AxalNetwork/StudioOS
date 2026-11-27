/**
 * D8730 (#8730) — the pieces an HQ-held Founder or Exploring preview draws:
 * the notice above the page, the Example and Withheld chips, and Eadwyn's
 * interview as examples with the operator's own conversation withheld and the
 * composer off (`Studio Home Previews Page.dc.html`, SPV01, SPV10, SPV30).
 *
 * Nothing here reads or writes the operator's interview. The one read is the
 * role's example questions (`GET /api/advisor/preview-examples`), which carries
 * prompts and options only.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Lock } from 'lucide-react';
import { StateChip } from '../ui/Honesty';
import { useViewMode } from '../contexts/ViewModeContext';
import { advisorPreviewApi } from '../lib/api/advisorPreview';
import { reportError } from '../lib/log';
import { STUDIO_CHAT_ANCHOR } from './advisor/interviewCompleteRow';
import { FOUNDER_PREVIEW, PREVIEW_COPY, PREVIEW_NOTES, examplesOf, pageName, sectionLabel, viewAsPath } from './rolePreviewModel';

/** Example: a dashed violet border and the word (SPV40: the shape carries it). */
export function ExampleChip({ children = 'Example', className = '' }) {
  return (
    <span className={`inline-flex items-center rounded-full border-[1.5px] border-dashed border-violet-400 px-2 py-px text-[11px] font-bold text-violet-700 dark:border-violet-500/70 dark:text-violet-300 ${className}`.trim()} data-preview-chip="example">
      {children}
    </span>
  );
}

/** Withheld: a lock and the word. */
export function WithheldChip({ children = PREVIEW_COPY.withheld }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-2 py-px text-[11px] font-bold text-gray-700 dark:border-gray-600 dark:text-gray-300" data-preview-chip="withheld">
      <Lock size={10} aria-hidden="true" />{children}
    </span>
  );
}

export function NotApplicableChip({ children = PREVIEW_COPY.notApplicable }) {
  return <StateChip kind="not_applicable" label={children} />;
}

/** The line above a previewed page (the AdvisorPreviewNotice pattern), with View As as the way to a person. */
export function RolePreviewNotice({ role }) {
  const note = PREVIEW_NOTES[role];
  const mode = useViewMode();
  const navigate = useNavigate();
  if (!note) return null;
  const toTeam = () => {
    mode?.exitPreview?.();
    navigate(viewAsPath(mode?.superAdmin));
  };
  return (
    <section
      className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] border border-dashed border-axal-hairline bg-axal-ground px-3 py-2 text-[12px] leading-relaxed text-axal-muted dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400"
      aria-label={note.label}
      data-testid={`role-preview-notice-${role}`}
    >
      <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint dark:text-gray-500">
        <Eye size={12} aria-hidden="true" /> {note.label}
      </span>
      <span>{note.text}</span>
      <button type="button" onClick={toTeam} className="min-h-11 font-bold text-violet-700 underline sm:min-h-0 dark:text-violet-300" data-testid="role-preview-view-as">
        {note.viewAs} →
      </button>
    </section>
  );
}

function Bubble({ label, prompt, options = [] }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden="true" className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full bg-violet-600 text-[11px] font-extrabold text-white">E</span>
      <div className="min-w-0 rounded-xl border-[1.5px] border-dashed border-violet-300 bg-white px-3 py-2 dark:border-violet-500/50 dark:bg-gray-900">
        <p className="text-[10.5px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">{label}</p>
        <p className="mt-0.5 text-[13.5px] text-gray-900 dark:text-gray-100">{prompt}</p>
        {options.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Answers offered">
            {options.map((o) => (
              <li key={o} className="rounded-full border border-axal-hairline px-2.5 py-1 text-[12px] text-gray-700 dark:border-gray-700 dark:text-gray-300">{o}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** The operator's own conversation, withheld (no read is needed to say so). */
export function HeldHqLine() {
  return (
    <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="role-preview-held-hq">
      <WithheldChip />{PREVIEW_COPY.heldHq}
    </p>
  );
}

/** The composer, off: focusable, `aria-disabled`, with its reason read after it (SPV40). */
function OffComposer() {
  return (
    <div className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-800" data-testid="role-preview-composer">
      <label htmlFor="role-preview-answer" className="text-[11px] font-bold uppercase tracking-wide text-axal-faint dark:text-gray-500">{PREVIEW_COPY.composerLabel}</label>
      <div className="mt-1 flex gap-2">
        <textarea
          id="role-preview-answer"
          rows={1}
          readOnly
          aria-disabled="true"
          aria-describedby="role-preview-answer-why"
          placeholder={PREVIEW_COPY.composerOff}
          className="min-h-11 flex-1 resize-none rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[13px] text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
        />
        <button type="button" aria-disabled="true" aria-describedby="role-preview-answer-why" onClick={(e) => e.preventDefault()} className="min-h-11 cursor-not-allowed rounded-lg bg-gray-200 px-4 text-[13px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-500">
          Send
        </button>
      </div>
      <p id="role-preview-answer-why" className="mt-1.5 text-[11.5px] text-axal-muted dark:text-gray-400">{PREVIEW_COPY.composerWhy}</p>
    </div>
  );
}

/**
 * Eadwyn's interview in a preview. `role` is 'founder' or 'exploring';
 * `track` is the Exploring example's role, or null for "No role chosen".
 * `nextUp` draws the founder's Next up as examples, with links to founder pages.
 */
export function RolePreviewInterview({ role, track = null, nextUp = false, heading }) {
  const [read, setRead] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setRead({ status: 'loading' });
    advisorPreviewApi.examples(role, track)
      .then((value) => { if (alive) setRead({ status: 'ok', value }); })
      .catch((e) => { reportError('RolePreviewInterview:examples', e); if (alive) setRead({ status: 'error' }); });
    return () => { alive = false; };
  }, [role, track, attempt]);

  const view = examplesOf(read);
  const founder = role === 'founder';
  const bubbleLabel = (q, i) => {
    if (founder) return `${FOUNDER_PREVIEW.bubblePrefix} · ${sectionLabel(q.section)}`;
    if (!track) return 'Example · role question';
    const of = view.total ? ` of ${view.total}` : '';
    return i === 0 ? `Example · ${track} discovery · 1${of}` : `Example · ${i + 1}${of}`;
  };
  const examplesLabel = founder ? FOUNDER_PREVIEW.examplesLabel : `Example · ${track ? `${track} discovery questions` : 'the first question'}`;

  return (
    <section id={STUDIO_CHAT_ANCHOR} className="rounded-xl border border-axal-hairline bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40" aria-labelledby="role-preview-interview-h" data-testid="role-preview-interview" data-role={role}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-violet-600 text-[12px] font-extrabold text-white">E</span>
        <h2 id="role-preview-interview-h" className="text-[15px] font-extrabold tracking-tight">{heading || (founder ? FOUNDER_PREVIEW.heading : 'Eadwyn')}</h2>
        <ExampleChip>{founder ? 'Example interview' : 'Example'}</ExampleChip>
      </div>
      <HeldHqLine />
      <div className="mt-3" aria-busy={view.state === 'loading' ? 'true' : undefined}>
        {view.state === 'loading' && <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="role-preview-examples-loading"><span className="sr-only">{PREVIEW_COPY.loadingExamples}</span><span aria-hidden="true">…</span></p>}
        {view.state === 'unavailable' && (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="role-preview-examples-unavailable">
            <StateChip kind="unavailable" />
            <span>{PREVIEW_COPY.examplesUnavailable}</span>
            <button type="button" onClick={retry} className="min-h-11 font-bold text-violet-700 hover:underline dark:text-violet-300">Retry</button>
          </div>
        )}
        {view.state === 'empty' && <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="role-preview-examples-empty">{PREVIEW_COPY.examplesEmpty}</p>}
        {view.state === 'ready' && (
          <div data-testid="role-preview-examples">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-axal-faint dark:text-gray-500">{examplesLabel}</p>
            <ol className="flex flex-col gap-2.5">
              {view.examples.map((q, i) => <Bubble key={q.id} label={bubbleLabel(q, i)} prompt={q.prompt} options={q.options} />)}
            </ol>
            <p className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">
              <StateChip kind="not_applicable" label={PREVIEW_COPY.noAnswers} />
              {founder ? FOUNDER_PREVIEW.answersLine : 'A visitor’s answers appear here. A preview draws none.'}
            </p>
          </div>
        )}
      </div>
      <OffComposer />
      {nextUp && view.state === 'ready' && view.nextUp.length > 0 && (
        <div className="mt-4" data-testid="role-preview-next-up">
          <h3 className="flex items-center gap-2 text-[13px] font-extrabold">{FOUNDER_PREVIEW.nextUpLabel}<span className="rounded-full bg-axal-ground px-1.5 text-[11px] text-axal-muted dark:bg-gray-800 dark:text-gray-400">{view.nextUp.length}</span></h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {view.nextUp.map((q) => (
              <li key={q.id} className="rounded-lg border border-axal-hairline p-3 dark:border-gray-700">
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-axal-faint dark:text-gray-500">{q.to ? pageName(q.to) : sectionLabel(q.section)} <ExampleChip /></p>
                <p className="mt-1 text-[13px] text-gray-900 dark:text-gray-100">{q.prompt}</p>
                {q.to && <Link to={q.to} className="mt-1.5 inline-flex min-h-11 items-center text-[12px] font-bold text-violet-700 hover:underline sm:min-h-0 dark:text-violet-300">Open {pageName(q.to)} →</Link>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-axal-muted dark:text-gray-400">{FOUNDER_PREVIEW.nextUpLine}</p>
        </div>
      )}
    </section>
  );
}
