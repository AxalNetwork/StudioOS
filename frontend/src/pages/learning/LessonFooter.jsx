/** D4478: one lesson footer and accessible completion control, including the 44px phone bar. */
import React, { useId } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import { lessonPositionLine, markCompleteReason } from './lessonFooterModel';

export function MarkCompleteButton({ completed = false, marking = false, hasBody = true, onMarkComplete }) {
  const reasonId = useId();
  const reason = markCompleteReason({ marking, hasBody, hasHandler: typeof onMarkComplete === 'function' });
  if (completed && hasBody && !marking) return <span className="inline-flex min-h-11 items-center gap-1 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300" data-testid="text-lesson-completed"><Check size={14} aria-hidden="true" />Completed</span>;
  return <>
    <button type="button" onClick={onMarkComplete} disabled={Boolean(reason)} title={reason || undefined} aria-describedby={reason ? reasonId : undefined}
      className="lesson-complete inline-flex min-h-11 items-center justify-center gap-1.5 rounded-axal-sm bg-axal-violet px-3 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-400 dark:text-gray-950 dark:hover:bg-violet-300" data-testid="button-mark-complete">
      {marking ? <><LoaderCircle size={14} className="animate-spin" aria-hidden="true" />Saving…</> : <><Check size={14} aria-hidden="true" />Mark complete</>}
    </button>
    {reason && <span id={reasonId} className="sr-only">{reason}</span>}
  </>;
}

function LessonStep({ step, dir }) {
  const previous = dir === 'prev';
  const Icon = previous ? ChevronLeft : ChevronRight;
  const body = <>{previous && <Icon size={16} aria-hidden="true" />}<span className="hidden sm:inline">{previous ? 'Previous' : 'Next'}</span>{!previous && <Icon size={16} aria-hidden="true" />}</>;
  const props = { 'aria-label': previous ? 'Previous lesson' : 'Next lesson', className: 'lesson-step inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-axal-sm border border-axal-hairline px-2.5 text-[12.5px] font-medium text-axal-ink dark:border-gray-700 dark:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50' };
  return step?.href
    ? <Link {...props} to={step.href} title={step.title || undefined} data-testid={`link-lesson-${dir}`}>{body}</Link>
    : <button {...props} type="button" disabled aria-disabled="true">{body}</button>;
}

export default function LessonFooter({ index, total, moduleTitle, prev, next, navigation = true, ...complete }) {
  const position = lessonPositionLine({ index, total, moduleTitle });
  return <div className="lesson-footer flex items-center gap-2 rounded-axal-lg border border-axal-hairline bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900" data-testid="lesson-footer">
    {navigation && <LessonStep step={prev} dir="prev" />}
    <div className="hidden min-w-0 flex-1 text-center text-[12.5px] text-axal-muted dark:text-gray-400 sm:block" aria-live="polite" data-testid="lesson-position">
      {complete.marking ? <span className="inline-flex items-center gap-1.5"><LoaderCircle size={14} className="animate-spin" aria-hidden="true" />Saving…</span> : position}
    </div>
    <MarkCompleteButton {...complete} />
    {navigation && <LessonStep step={next} dir="next" />}
  </div>;
}
