import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Unrecorded } from '../../ui';
import { byPosition } from './learningModel';
import { LearningEmpty, LearningLoading, LearningUnreadable, RouteUnreadable, SectionCard } from './LearningStates';
import { ErrorLine, PRIMARY } from './studioParts';
import {
  UNAVAILABLE_LINE, completionCell, entryFor, programProgress, progressLine, subjectKindLabel,
} from './programModel';
import { enrolSelf, readMyPrograms, readOpenPrograms } from './programReads';
import useLearningRead from './useLearningRead';

const isLoading = (state) => !state || state.status === 'loading' || state.status === 'idle';

const STATUS_TONE = { ok: 'text-emerald-700 dark:text-emerald-300', warn: 'text-axal-amber-deep dark:text-amber-300', info: 'text-axal-violet-deep dark:text-violet-300' };

/** One content row of a program, as its member sees it: where it opens, and where they stand on it. */
function ContentRow({ content, completion }) {
  const unavailable = content.status !== 'published' ? (UNAVAILABLE_LINE[content.status] || 'Not available') : null;
  const cell = completionCell(entryFor(completion, content));
  const title = content.title || (content.status === 'missing' ? 'No longer exists' : 'Untitled');
  return (
    <li className="flex items-baseline justify-between gap-2 text-[12.5px]" data-testid={`my-program-content-${content.subject_uid}`}>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="flex-none text-[10px] font-extrabold uppercase tracking-axal-label text-axal-faint dark:text-gray-500">{subjectKindLabel(content.subject_kind)}</span>
        {!unavailable && content.href
          ? <Link to={content.href} className="min-w-0 truncate font-medium text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300">{title}</Link>
          : <span className="min-w-0 truncate text-axal-muted dark:text-gray-400">{title}</span>}
      </span>
      <span className={`flex-none tabular-nums ${STATUS_TONE[cell.tone] || 'text-axal-muted dark:text-gray-400'}`}>
        {unavailable || cell.tone === 'absent' ? <Unrecorded>{unavailable || cell.label}</Unrecorded> : cell.label}
      </span>
    </li>
  );
}

/** One program the member is in: its name and region, how far they are through it, and what it holds. */
function EnrolledProgram({ row, onRetry }) {
  const { program, detail } = row;
  const contents = detail.status === 'ready' ? byPosition(detail.contents) : [];
  const progress = detail.status === 'ready' ? programProgress(contents, detail.completion) : null;
  const width = progress?.total ? Math.round((100 * progress.done) / progress.total) : 0;
  return (
    <li className="space-y-1.5 py-3 first:pt-0" data-testid={`my-program-${program.uid}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{program.name || 'Untitled program'}</span>
        <span className="flex-none text-[11.5px] text-axal-faint dark:text-gray-500">{program.region || <Unrecorded>Region not recorded</Unrecorded>}</span>
      </div>
      {detail.status === 'unreadable' && (
        <RouteUnreadable reason="Your progress in this program could not be read, so this is not a claim that you have done nothing in it." onRetry={onRetry} testid="my-program-unreadable" />
      )}
      {detail.status === 'missing' && (
        <p className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="my-program-missing">This program is no longer open to you.</p>
      )}
      {detail.status === 'ready' && progress && (
        <>
          {progress.total > 0 && (
            <div className="h-1.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" aria-hidden="true">
              <div className="h-full rounded-full bg-axal-lavender-edge dark:bg-violet-500" style={{ width: `${width}%` }} />
            </div>
          )}
          <p className="text-[11.5px] tabular-nums text-axal-muted dark:text-gray-400" data-testid="my-program-progress">{progressLine(progress)}</p>
        </>
      )}
      {detail.status === 'ready' && !progress && (
        <p className="text-[11.5px] text-axal-muted dark:text-gray-400" data-testid="my-program-progress">
          <Unrecorded reason="The program route sent no completion for you.">Your progress is not recorded.</Unrecorded>
        </p>
      )}
      {detail.status === 'ready' && contents.length > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer font-semibold text-axal-violet-deep hover:text-axal-violet dark:text-violet-300" data-testid="my-program-contents-toggle">
            What it holds · {contents.length}
          </summary>
          <ol className="mt-2 space-y-1.5" data-testid="my-program-contents">
            {contents.map((c) => <ContentRow key={`${c.subject_kind}:${c.subject_uid}`} content={c} completion={detail.completion} />)}
          </ol>
        </details>
      )}
    </li>
  );
}

/** A published program open to self-enrolment, with "Join" and the route's refusal beside it. */
function OpenProgram({ program, onEnrol, enrolling, error }) {
  return (
    <li className="space-y-1 py-2.5 first:pt-0" data-testid={`open-program-${program.uid}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-axal-ink dark:text-gray-100">{program.name || 'Untitled program'}</span>
          <span className="block text-[11.5px] text-axal-faint dark:text-gray-500">{program.region || <Unrecorded>Region not recorded</Unrecorded>}</span>
        </span>
        <button
          type="button" className={PRIMARY} onClick={() => onEnrol(program.uid)} disabled={!onEnrol || Boolean(enrolling)}
          data-testid={`button-join-${program.uid}`}
        >
          {enrolling === program.uid ? 'Joining…' : 'Join'}
        </button>
      </div>
      {program.description && <p className="line-clamp-2 text-[12px] text-axal-muted dark:text-gray-400">{program.description}</p>}
      <ErrorLine error={error} testid={`join-error-${program.uid}`} />
    </li>
  );
}

/**
 * The home's "My programs" (D562 stage 3, on D558's member routes), drawn
 * from props so every state renders without a fetch; `MyPrograms` below owns
 * the reads.
 *
 *   enrolled   `readMyPrograms`'s state: `rows: [{ program, detail }]`, where
 *              `detail` is the program's own read, `{ status: 'ready',
 *              contents, completion }`, or `unreadable` or `missing`
 *   open       `readOpenPrograms`'s state: `programs`, the published programs
 *              open to self-enrolment, each with `enrolled`
 *   onEnrol(uid), enrolling (the uid being joined), said ({ uid, message }:
 *   the route's refusal, beside the program it was for), onRetry { enrolled, open }
 *
 * PROGRESS IS COUNTED OVER WHAT A MEMBER CAN OPEN (`programProgress`): the
 * program's published content, each done when the route says so (a course or
 * item completed, an exercise accepted, an exam passed). Nothing started reads
 * "None of 5 complete yet", never 0%. A program whose own read failed says so
 * on its row; the rest still draw.
 */
export function MyProgramsSection({ enrolled, open, onEnrol, enrolling = null, said = null, onRetry = {} }) {
  const rows = enrolled?.status === 'ready' ? enrolled.rows || [] : [];
  const joinable = open?.status === 'ready' ? (open.programs || []).filter((p) => !p.enrolled) : [];
  let body;
  if (isLoading(enrolled)) body = <LearningLoading rows={2} what="your programs" />;
  else if (enrolled.status !== 'ready') body = <LearningUnreadable what="Your programs" claim="This is not a claim that you are in none." onRetry={onRetry.enrolled} />;
  else if (!rows.length) body = <LearningEmpty title="You are in no program yet" body="A program gathers courses, videos, readings, exercises and exams for a region or a cohort." />;
  else {
    body = (
      <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="list-my-programs">
        {rows.map((row) => <EnrolledProgram key={row.program.uid} row={row} onRetry={onRetry.enrolled} />)}
      </ul>
    );
  }
  return (
    <SectionCard title="My programs" meta={rows.length ? `${rows.length}` : null} testid="section-programs">
      {body}
      {isLoading(open) && enrolled?.status === 'ready' && <div className="mt-3"><LearningLoading rows={1} what="the programs open to you" /></div>}
      {open?.status === 'unreadable' && (
        <div className="mt-3">
          <RouteUnreadable reason="The programs open to self-enrolment could not be read, so this is not a claim that there are none." onRetry={onRetry.open} testid="open-programs-unreadable" />
        </div>
      )}
      {joinable.length > 0 && (
        <div className="mt-3 border-t border-axal-hairline pt-3 dark:border-gray-800" data-testid="list-open-programs">
          <h3 className="text-[12.5px] font-bold text-axal-ink dark:text-gray-100">Open to join</h3>
          <p className="mb-2 text-[11.5px] text-axal-faint dark:text-gray-500">You can join these yourself. Only a Super Admin can take you out of a program.</p>
          <ul className="divide-y divide-axal-hairline dark:divide-gray-800">
            {joinable.map((p) => (
              <OpenProgram key={p.uid} program={p} onEnrol={onEnrol} enrolling={enrolling} error={said?.uid === p.uid ? said.message : ''} />
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[11.5px] text-axal-faint dark:text-gray-500">Most programs are by invitation: a Super Admin enrols their members.</p>
    </SectionCard>
  );
}

/** The reads and the one write behind the section, for a home that keeps its view pure. */
export function useMyPrograms(enabled = true) {
  const [enrolled, retryEnrolled] = useLearningRead(readMyPrograms, [], { enabled, scope: 'my-programs' });
  const [open, retryOpen] = useLearningRead(readOpenPrograms, [], { enabled, scope: 'open-programs' });
  const [enrolling, setEnrolling] = useState(null);
  const [said, setSaid] = useState(null);
  const onEnrol = async (uid) => {
    setEnrolling(uid);
    setSaid(null);
    try {
      await enrolSelf(uid);
      // The program moves from "Open to join" to the member's own list, read again from the routes.
      retryEnrolled();
      retryOpen();
    } catch (err) {
      setSaid({ uid, message: err?.message || 'You could not be enrolled.' });
    } finally {
      setEnrolling(null);
    }
  };
  return { enrolled, open, onEnrol, enrolling, said, onRetry: { enrolled: retryEnrolled, open: retryOpen } };
}

/**
 * The section with its reads, for the home to mount where "My programs" sits.
 * `enabled` is false for a profile the coming-soon gate holds, which then
 * reads nothing.
 */
export default function MyPrograms({ enabled = true }) {
  return <MyProgramsSection {...useMyPrograms(enabled)} />;
}
