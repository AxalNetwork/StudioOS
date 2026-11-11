import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState, RailFrame } from '../../ui';
import ProgramsTable from './ProgramsTable';
import ProgramLearnersTable, { LearnerRecord, ReadOnlyStrip } from './ProgramLearnersTable';
import { LearningEmpty, LearningHeader, SectionCard } from './LearningStates';
import { learnerFor, readStatus } from './programModel';
import { readAssignedPrograms, readProgramLearner, readProgramLearners } from './programReads';
import useLearningRead from './useLearningRead';

/**
 * The assigned admin's program pages (D562 stage 3, on D558's read-only
 * routes in `routes/learning_programs.ts`): `/learning/programs`, the
 * programs a Super Admin assigned to them, and `/learning/programs/:program`,
 * each enrolled member against the program's content, with one member's
 * record beside it (`?learner=<uid>`, so a record can be linked to).
 *
 * READ-ONLY. Nothing on these pages writes, and nothing here calls a write:
 * content and enrolment are the Super Admin's, in the studio. The route
 * admits an admin assigned to the program and the Super Admin; anyone else
 * gets its refusal, which the page shows in the route's own words.
 */

const LEARNING = { to: '/learning', label: 'Learning' };
const PROGRAMS = { to: '/learning/programs', label: 'Programs' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A route's refusal, in its own words: not a failed read, and not an empty one. */
export function Refused({ refusal, cta, testid = 'learning-refused' }) {
  return (
    <EmptyState
      size="sm"
      title="Not open to you"
      body={refusal?.message || 'The route refused this read.'}
      cta={cta}
      data-testid={testid}
    />
  );
}

// ── /learning/programs ────────────────────────────────────────────────────

/** The assigned programs, from `GET /api/learning/programs/mine`. */
export function AssignedProgramsView({ state, onRetry }) {
  if (state.status === 'ready' && state.refused) {
    return <SectionCard title="Assigned to you" testid="programs-assigned"><Refused refusal={state.refused} cta={{ label: 'Back to Learning', to: '/learning' }} /></SectionCard>;
  }
  return <ProgramsTable scope="assigned" status={readStatus(state)} programs={state.status === 'ready' ? state.programs : []} onRetry={onRetry} />;
}

export function ProgramsPage({ sub }) {
  const [state, retry] = useLearningRead(readAssignedPrograms, [], { scope: 'assigned-programs' });
  return (
    <RailFrame data-testid="learning-programs">
      <div className="space-y-4">
        <LearningHeader title="Programs" sub={sub} back={LEARNING} />
        <AssignedProgramsView state={state} onRetry={retry} />
      </div>
    </RailFrame>
  );
}

// ── /learning/programs/:program ───────────────────────────────────────────

/**
 * The learners view, drawn from the two reads' states:
 *
 *   state        `readProgramLearners`: { program, contents, learners }, a
 *                refusal, "missing" (a 404) or a failed read
 *   learnerState `readProgramLearner` for the chosen member: { contents,
 *                learner }, "missing" ("No such learner in this program."),
 *                or idle when nobody is chosen
 *   selectedUid, learnerHref(uid)
 */
export function ProgramLearnersView({ state, learnerState = { status: 'idle' }, selectedUid = '', learnerHref, onRetry, onRetryLearner }) {
  if (state.status === 'ready' && state.refused) {
    return <SectionCard title="Program" testid="program-learners"><Refused refusal={state.refused} cta={{ label: 'Programs', to: '/learning/programs' }} /></SectionCard>;
  }
  if (state.status === 'missing') {
    return (
      <SectionCard title="Program" testid="program-learners">
        <LearningEmpty title="No such program" body={state.message || 'No such program.'} cta={{ label: 'Programs', to: '/learning/programs' }} />
      </SectionCard>
    );
  }
  const ready = state.status === 'ready';
  let record;
  if (!selectedUid) {
    record = <LearnerRecord status="ready" learner={null} />;
  } else if (learnerState.status === 'missing' || (learnerState.status === 'ready' && learnerState.refused)) {
    record = <LearnerRecord status="ready" learner={null} notFound={learnerState.message || learnerState.refused?.message || 'No such learner in this program.'} />;
  } else {
    record = (
      <LearnerRecord
        status={readStatus(learnerState)}
        learner={learnerState.status === 'ready' ? learnerState.learner : null}
        contents={learnerState.status === 'ready' ? learnerState.contents : []}
        onRetry={onRetryLearner}
      />
    );
  }
  return (
    <>
      <ReadOnlyStrip programName={ready ? state.program?.name : null} />
      <div className="grid min-w-0 grid-cols-1 gap-4 [&>*]:min-w-0 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <ProgramLearnersTable
          status={readStatus(state)}
          program={ready ? state.program : null}
          contents={ready ? state.contents : []}
          learners={ready ? state.learners : []}
          selectedUid={selectedUid}
          learnerHref={learnerHref}
          onRetry={onRetry}
        />
        {record}
      </div>
    </>
  );
}

/** What the rail says the learners view loaded: only what the read returned. */
export function learnersCoverage(state) {
  if (state.status !== 'ready' || state.refused) return [];
  return [`${plural(state.learners.length, 'member')} and ${plural(state.contents.length, 'content item')} in “${state.program.name}”`];
}

export function ProgramPage({ uid }) {
  const [params] = useSearchParams();
  const selected = params.get('learner') || '';
  const [state, retry] = useLearningRead(() => readProgramLearners(uid), [uid], { scope: 'program-learners' });
  const [learnerRead, retryLearner] = useLearningRead(() => readProgramLearner(uid, selected), [uid, selected],
    { enabled: Boolean(selected), scope: 'program-learner' });
  const program = state.status === 'ready' && !state.refused ? state.program : null;
  return (
    <RailFrame data-testid="learning-program">
      <div className="space-y-4">
        <LearningHeader
          eyebrow={program?.region ? `Learning · ${program.region}` : 'Learning'}
          title={program?.name || 'Program'}
          sub="Enrolled members against the program’s content. Nothing here can be changed."
          back={PROGRAMS}
        />
        <ProgramLearnersView
          state={state}
          learnerState={learnerFor(learnerRead, selected)}
          selectedUid={selected}
          learnerHref={(u) => `/learning/programs/${encodeURIComponent(uid)}?learner=${encodeURIComponent(u)}`}
          onRetry={retry}
          onRetryLearner={retryLearner}
        />
      </div>
    </RailFrame>
  );
}
