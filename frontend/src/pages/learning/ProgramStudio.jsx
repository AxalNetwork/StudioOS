import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { RailFrame, WorkerRail } from '../../ui';
import ProgramsTable from './ProgramsTable';
import ProgramDetail, { ProgramFields } from './ProgramDetail';
import { LearningHeader, SectionCard } from './LearningStates';
import { PRIMARY } from './studioParts';
import { STATUS_NOTICE } from './studioActions';
import { Refused } from './LearningPrograms';
import { movedContent, readStatus, splitEnrolments, withContent, withoutContent } from './programModel';
import {
  assignAdmin, createProgram, enrolMember, findUsers, readContentChoices, readStudioProgram, readStudioPrograms, saveContents,
  saveProgram, setProgramEnrolment, setProgramStatus, unassignAdmin, unenrolMember,
} from './programReads';
import useLearningRead from './useLearningRead';

/**
 * The Super Admin's regional programs (D562 stage 3, on D558's
 * `routes/admin_learning_programs.ts`, every route `requireSuperAdmin`):
 * `/learning/studio/programs`, every program with "New program"
 * (`?new=program`, so the form can be linked to and the back button closes
 * it), and `/learning/studio/programs/:program`, one program's fields, status,
 * content, assigned admins and members.
 *
 * Every write goes through `run`: it shows the route's refusal in the route's
 * own words beside what was being changed, and draws the program the route
 * answered rather than what was sent. Every removal asks first
 * (`ProgramDetail`).
 */

const STUDIO = { to: '/learning/studio', label: 'Learning studio' };
const PROGRAMS = { to: '/learning/studio/programs', label: 'Regional programs' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function StudioRail({ coverage }) {
  return (
    <WorkerRail
      workspace="Learning studio"
      role="super_admin"
      stance="Authoring view"
      note="Eadwyn reads back what this page has loaded. It does not publish, assign, enrol or edit anything: every write here is the Super Admin’s own."
      coverage={coverage}
    />
  );
}

// ── /learning/studio/programs ─────────────────────────────────────────────

/** The create form, opened by `?new=program`. */
export function NewProgramCard({ onCreate, busy, error }) {
  return (
    <SectionCard title="New program" meta="created as a draft" testid="program-new">
      <ProgramFields program={null} onSubmit={onCreate} busy={busy} error={error} />
      <p className="mt-3 text-[12px]">
        <Link to="/learning/studio/programs" className="font-semibold text-axal-violet-deep underline hover:text-axal-violet dark:text-violet-300" data-testid="link-program-new-cancel">
          Cancel
        </Link>
      </p>
    </SectionCard>
  );
}

/** Every program, from `GET /api/admin/learning/programs`; the create form above it when it is open. */
export function StudioProgramsView({ state, creating = false, onCreate, busy = false, error = '', onRetry }) {
  if (state.status === 'ready' && state.refused) {
    return <SectionCard title="Programs" testid="programs-studio"><Refused refusal={state.refused} cta={STUDIO} /></SectionCard>;
  }
  return (
    <>
      {creating && <NewProgramCard onCreate={onCreate} busy={busy} error={error} />}
      <ProgramsTable scope="studio" status={readStatus(state)} programs={state.status === 'ready' ? state.programs : []} onRetry={onRetry} />
    </>
  );
}

export function StudioProgramsPage({ sub }) {
  const [params] = useSearchParams();
  const creating = params.get('new') === 'program';
  const navigate = useNavigate();
  const [state, retry] = useLearningRead(readStudioPrograms, [], { scope: 'studio-programs' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const onCreate = async (form) => {
    setBusy(true);
    setError('');
    try {
      const created = await createProgram(form);
      navigate(`/learning/studio/programs/${encodeURIComponent(created.program.uid)}`);
    } catch (err) {
      setError(err?.message || 'The program could not be created.');
    } finally {
      setBusy(false);
    }
  };
  const coverage = state.status === 'ready' && !state.refused ? [`${plural(state.programs.length, 'program')}, drafts and archived included`] : [];
  return (
    <RailFrame rail={<StudioRail coverage={coverage} />} data-testid="learning-studio-programs">
      <div className="space-y-4">
        <LearningHeader
          title="Regional programs"
          sub={sub}
          back={STUDIO}
          action={creating ? null : <Link to="/learning/studio/programs?new=program" className={PRIMARY} data-testid="link-program-new">New program</Link>}
        />
        <StudioProgramsView state={state} creating={creating} onCreate={onCreate} busy={busy} error={error} onRetry={retry} />
      </div>
    </RailFrame>
  );
}

// ── /learning/studio/programs/:program ────────────────────────────────────

/** One program, drawn from its read and the studio's last word: a refusal (`{ where, message }`) or a notice. */
export function StudioProgramView({ state, choices, handlers, busy = false, said = null, onRetry }) {
  if (state.status === 'ready' && state.refused) {
    return <SectionCard title="Program" testid="program-detail"><Refused refusal={state.refused} cta={PROGRAMS} /></SectionCard>;
  }
  const ready = state.status === 'ready';
  return (
    <ProgramDetail
      status={readStatus(state)}
      program={ready ? state.program : null}
      contents={ready ? state.contents : []}
      admins={ready ? state.admins : []}
      enrolments={ready ? state.enrolments : []}
      choices={choices}
      handlers={handlers}
      busy={busy}
      error={said?.error || null}
      notice={said?.notice || ''}
      onRetry={onRetry}
    />
  );
}

/** What the rail says the program page loaded. */
export function programCoverage(state) {
  if (state.status !== 'ready' || state.refused) return [];
  const { active } = splitEnrolments(state.enrolments);
  return [`“${state.program.name}”: ${plural(state.contents.length, 'content item')}, ${plural(state.admins.length, 'assigned admin')}, ${plural(active.length, 'member')}`];
}

/**
 * The handlers `ProgramDetail` calls, each a write through `run`. The content
 * list is always sent whole and in order, as `PUT …/contents` takes it,
 * built from the program as last stored.
 */
export function programHandlers({ uid, current, run, setWantChoices }) {
  const contents = current?.contents || [];
  return {
    onSave: (form) => run('fields', () => saveProgram(uid, form), 'Saved.'),
    onStatus: (action) => run('fields', () => setProgramStatus(uid, action), STATUS_NOTICE[action]),
    onSetOpen: (open) => run('enrolments', () => setProgramEnrolment(uid, open)),
    onAddContent: (kind, subjectUid) => run('contents', () => saveContents(uid, withContent(contents, kind, subjectUid))),
    onRemoveContent: (kind, subjectUid) => run('contents', () => saveContents(uid, withoutContent(contents, kind, subjectUid))),
    onMoveContent: (kind, subjectUid, step) => {
      const order = movedContent(contents, kind, subjectUid, step);
      return order ? run('contents', () => saveContents(uid, order)) : Promise.resolve(false);
    },
    onAssign: (userUid) => run('admins', () => assignAdmin(uid, userUid)),
    onUnassign: (userUid) => run('admins', () => unassignAdmin(uid, userUid)),
    onEnrol: (userUid) => run('enrolments', () => enrolMember(uid, userUid)),
    onUnenrol: (userUid) => run('enrolments', () => unenrolMember(uid, userUid)),
    onFindUsers: findUsers,
    onWantChoices: () => setWantChoices(true),
  };
}

export function StudioProgramPage({ uid, sub }) {
  const [state, retry, setState] = useLearningRead(() => readStudioProgram(uid), [uid], { scope: 'studio-program' });
  const [wantChoices, setWantChoices] = useState(false);
  const [choices] = useLearningRead(readContentChoices, [], { enabled: wantChoices, scope: 'program-choices' });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);
  /** One write. Resolves true when the route accepted it; its refusal is shown where it was made. */
  const run = async (where, write, notice = '') => {
    setBusy(true);
    setSaid(null);
    try {
      const detail = await write();
      setState({ status: 'ready', ...detail });
      if (notice) setSaid({ notice });
      return true;
    } catch (err) {
      setSaid({ error: { where, message: err?.message || 'The studio could not save that.' } });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const current = state.status === 'ready' && !state.refused ? state : null;
  const handlers = programHandlers({ uid, current, run, setWantChoices });
  return (
    <RailFrame rail={<StudioRail coverage={programCoverage(state)} />} data-testid="learning-studio-program">
      <div className="space-y-4">
        <LearningHeader
          title={current?.program.name || 'Program'}
          sub={current?.program.region ? `${current.program.region} · ${sub}` : sub}
          back={PROGRAMS}
        />
        <StudioProgramView state={state} choices={choices} handlers={handlers} busy={busy} said={said} onRetry={retry} />
      </div>
    </RailFrame>
  );
}
