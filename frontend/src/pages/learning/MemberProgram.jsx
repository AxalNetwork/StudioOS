import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { RailFrame, Unrecorded } from '../../ui';
import { byPosition } from './learningModel';
import { LearningEmpty, LearningHeader, LearningLoading, LearningUnreadable, SectionCard } from './LearningStates';
import { ErrorLine, PRIMARY } from './studioParts';
import {
  UNAVAILABLE_LINE, completionCell, continueTarget, enrolmentCopy, entryFor, programProgress, progressLine, subjectKindLabel,
} from './programModel';
import { enrolSelf, readMemberProgram } from './programReads';
import { homeRefusal } from './LearningHomeActions';
import useLearningRead from './useLearningRead';

/**
 * D3726 (#3726) LR13 — one program as its member sees it, at
 * `/learning/my-programs/:program`: the curriculum in order with where they
 * stand on each item, the overall count, "Continue" to the first item not
 * done, and how they came to be in it. A program open to self-enrolment that
 * they are not in yet draws LR13b: the same curriculum, "Join to start" on
 * each row, and "Join".
 *
 * One read, `GET /api/learning/programs/:uid` (D558), which already answers
 * a member: the program, its contents described, `enrolled`, and their
 * completion when enrolled. A program they may not see is that route's 404,
 * drawn as "No such program". Progress is counted over what a member can
 * open (`programProgress`); nothing started reads "None of 5 complete yet",
 * never 0%.
 */

const LEARNING = { to: '/learning', label: 'Learning' };

function CurriculumRow({ content, completion, enrolled }) {
  const unavailable = content.status !== 'published' ? (UNAVAILABLE_LINE[content.status] || 'Not available') : null;
  const cell = enrolled ? completionCell(entryFor(completion, content)) : null;
  const title = content.title || (content.status === 'missing' ? 'No longer exists' : 'Untitled');
  let right;
  if (unavailable) right = <Unrecorded>{unavailable}</Unrecorded>;
  else if (!enrolled) right = <span className="text-axal-faint dark:text-gray-500">Join to start</span>;
  else right = cell.tone === 'absent' ? <Unrecorded>{cell.label}</Unrecorded> : cell.label;
  return (
    <li className="flex items-baseline justify-between gap-3 py-2 text-[13px]" data-testid={`member-program-content-${content.subject_uid}`}>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="w-16 flex-none text-[10px] font-extrabold uppercase tracking-axal-label text-axal-faint dark:text-gray-500">{subjectKindLabel(content.subject_kind)}</span>
        {!unavailable && content.href
          ? <Link to={content.href} className="min-w-0 truncate font-medium text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300">{title}</Link>
          : <span className="min-w-0 truncate text-axal-muted dark:text-gray-400">{title}</span>}
      </span>
      <span className="flex-none text-[12px] tabular-nums text-axal-muted dark:text-gray-400">{right}</span>
    </li>
  );
}

/** The page drawn from its read, so every state renders without a fetch. */
export function MemberProgramView({ state, onRetry, onJoin, joining = false, joinError = '' }) {
  if (state.status === 'missing') {
    return (
      <SectionCard title="Not available" testid="member-program">
        <LearningEmpty title="No such program." body="It does not exist, it is not published, or it is not open to you." cta={{ label: 'Back to Learning', to: '/learning' }} />
      </SectionCard>
    );
  }
  if (state.status === 'unreadable') return <LearningUnreadable what="This program" claim="This is not a claim that it holds nothing." onRetry={onRetry} />;
  if (state.status !== 'ready') return <LearningLoading rows={5} what="the program" />;
  const { program, enrolled, completion } = state;
  const contents = byPosition(state.contents);
  const progress = enrolled ? programProgress(contents, completion) : null;
  const next = enrolled ? continueTarget(contents, completion) : null;
  const copy = enrolmentCopy(program, { enrolled, enrolled_at: state.enrolled_at });
  const joinable = !enrolled && program.enrolment === 'open';
  const width = progress?.total ? Math.round((100 * progress.done) / progress.total) : 0;
  return (
    <div className="space-y-4" data-testid="member-program">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[12.5px] text-axal-muted dark:text-gray-400">
          {program.region || <Unrecorded>Region not recorded</Unrecorded>}
          {program.description ? ` · ${program.description}` : ''}
        </p>
        {next && <Link to={next.href} className={PRIMARY} data-testid="member-program-continue">Continue</Link>}
        {joinable && (
          <button type="button" className={PRIMARY} onClick={onJoin} disabled={!onJoin || joining} data-testid="member-program-join">
            {joining ? 'Joining…' : 'Join'}
          </button>
        )}
      </div>
      <ErrorLine error={joinError} testid="member-program-join-error" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <SectionCard title="Curriculum" meta={enrolled ? 'Your progress on each item.' : null} testid="member-program-curriculum">
          {contents.length
            ? <ol className="divide-y divide-axal-hairline dark:divide-gray-800">{contents.map((c) => <CurriculumRow key={`${c.subject_kind}:${c.subject_uid}`} content={c} completion={completion} enrolled={enrolled} />)}</ol>
            : <LearningEmpty title="Nothing in this program yet" body="A Super Admin adds courses, videos, readings, exercises and exams to it." />}
        </SectionCard>
        <div className="space-y-4">
          <SectionCard title="Overall progress" testid="member-program-progress">
            {!enrolled && <p className="text-[12.5px] text-axal-muted dark:text-gray-400">You are not in this program yet.</p>}
            {enrolled && !progress && <p className="text-[12.5px]"><Unrecorded reason="The program route sent no completion for you.">Your progress is not recorded.</Unrecorded></p>}
            {enrolled && progress && (
              <>
                {progress.total > 0 && (
                  <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-axal-ground dark:bg-gray-800" aria-hidden="true">
                    <div className="h-full rounded-full bg-axal-lavender-edge dark:bg-violet-500" style={{ width: `${width}%` }} />
                  </div>
                )}
                <p className="text-[12.5px] tabular-nums text-axal-muted dark:text-gray-400" data-testid="member-program-progress-line">{progressLine(progress)}</p>
              </>
            )}
          </SectionCard>
          <SectionCard title="Enrolment" testid="member-program-enrolment">
            <p className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{copy.title}</p>
            <p className="mt-1 text-[12.5px] text-axal-muted dark:text-gray-400">{copy.date ? <>{copy.beforeDate}<time dateTime={copy.dateTime} className="font-mono tabular-nums">{copy.date}</time>.</> : copy.line}</p>
            <p className="mt-1 text-[11.5px] text-axal-faint dark:text-gray-500">{copy.none}</p>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

export default function MemberProgramPage({ uid }) {
  const [state, retry] = useLearningRead(() => readMemberProgram(uid), [uid], { scope: 'member-program' });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const onJoin = async () => {
    setJoining(true);
    setJoinError('');
    try {
      await enrolSelf(uid);
      retry();
    } catch (err) {
      // #4742 — a route refusal only, never a transport/internal Error.message (MyPrograms.jsx's homeRefusal).
      setJoinError(homeRefusal(err, 'You could not be enrolled. Try again.'));
    } finally {
      setJoining(false);
    }
  };
  const program = state.status === 'ready' ? state.program : null;
  return (
    <RailFrame data-testid="learning-my-program">
      <div className="space-y-4">
        <LearningHeader eyebrow="Learning · Program" title={program?.name || 'Program'} back={LEARNING} />
        <MemberProgramView state={state} onRetry={retry} onJoin={onJoin} joining={joining} joinError={joinError} />
      </div>
    </RailFrame>
  );
}
