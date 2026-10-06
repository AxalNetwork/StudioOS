import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, Unrecorded } from '../../ui';
import { titleCase } from '../../lib/absence';
import { LearningLoading, SectionCard, stateBlock } from './LearningStates';
import { ConfirmRow, DANGER, ErrorLine, Field, INPUT, MoveButtons, PRIMARY, SECONDARY, StatusActions } from './studioParts';
import { CONTENT_STATUS_TONE, NOT_LIVE, byPosition, formatDay } from './learningModel';
import {
  CONTENT_KINDS, ENROLLED_BY, USER_SEARCH_LIMIT, contentChoices, programForm, splitEnrolments, subjectKindLabel,
} from './programModel';

/**
 * A program's own fields: name, region and description, and, for a new
 * program, whether members may join it themselves. The studio's list uses it
 * to create a program; the program page, to edit one.
 *
 *   program   the stored program, or null to create one
 *   onSubmit(form), busy, error (the route's own words), notice
 */
export function ProgramFields({ program, onSubmit, busy = false, error = '', notice = '' }) {
  const [form, setForm] = useState(() => programForm(program));
  const ids = useId();
  const id = (name) => `${ids}-${name}`;
  const set = (name) => (event) => setForm((f) => ({ ...f, [name]: event.target.value }));
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}
      data-testid="form-program"
    >
      <Field id={id('name')} label="Name">
        <input id={id('name')} className={INPUT} value={form.name} onChange={set('name')} data-testid="input-program-name" />
      </Field>
      <Field id={id('region')} label="Region" hint="Free text, such as Nordics or a branch code.">
        <input id={id('region')} className={INPUT} value={form.region} onChange={set('region')} data-testid="input-program-region" />
      </Field>
      <Field id={id('description')} label="Description" full>
        <textarea id={id('description')} rows={3} className={INPUT} value={form.description} onChange={set('description')} data-testid="input-program-description" />
      </Field>
      {!program && (
        <Field id={id('enrolment')} label="Enrolment" hint="Change it later on the program’s members card." full>
          <select id={id('enrolment')} className={INPUT} value={form.enrolment} onChange={set('enrolment')} data-testid="select-program-enrolment">
            <option value="invite">By invitation: a Super Admin enrols each member</option>
            <option value="open">Open: members can also join it themselves</option>
          </select>
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" className={PRIMARY} disabled={busy || !onSubmit} data-testid="button-program-save">
          {busy ? 'Saving…' : program ? 'Save program' : 'Create draft'}
        </button>
        {notice && <span className="text-[12.5px] text-emerald-700 dark:text-emerald-300" role="status">{notice}</span>}
      </div>
      <div className="sm:col-span-2"><ErrorLine error={error} testid="program-fields-error" /></div>
    </form>
  );
}

/**
 * One regional program, for the Super Admin: its fields and status, its
 * content in order, its assigned admins and its members (D562; D558's
 * `routes/admin_learning_programs.ts`). Every write answers with the whole
 * program, which replaces what is drawn, so what is on screen is what is
 * stored.
 *
 * Props, in the route's shape (`GET /api/admin/learning/programs/:uid`):
 *   status      'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   program     `programView`: { uid, name, region, description,
 *               enrolment: 'invite' | 'open', status, … }
 *   contents    [{ subject_kind, subject_uid, position, title, status, href }]
 *   admins      [{ uid, name, assigned_at }]
 *   enrolments  [{ uid, name, status: 'active' | 'removed', enrolled_at,
 *               updated_at, enrolled_by: 'self' | 'super_admin' }], removed rows kept
 *   choices     what content can be added: `{ status, byKind: { course: {
 *               status, rows }, … } }`, read when the picker first opens
 *   handlers    { onSave(form), onStatus(action), onSetOpen(open),
 *               onAddContent(kind, uid), onRemoveContent(kind, uid),
 *               onMoveContent(kind, uid, step), onAssign(userUid),
 *               onUnassign(userUid), onEnrol(userUid), onUnenrol(userUid),
 *               onFindUsers(q), onWantChoices() }; the writes resolve true
 *               once the route accepted them
 *   busy, error ({ where, message }: the route's own words), notice
 *
 * EVERY REMOVAL ASKS FIRST: a content row, an assigned admin, a member. People
 * are named by name and uid, never an email. A member's progress is the
 * read-only view's (`/learning/programs/:uid`), which this page links to.
 */
export default function ProgramDetail({
  status, program, contents, admins, enrolments, choices, handlers = {}, busy = false, error = null, notice = '',
  reason = NOT_LIVE.programs, onRetry,
}) {
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the program',
    claim: 'This is not a claim that the program is empty.',
    isEmpty: !program,
    empty: { title: 'No such program', body: 'No program has that address.', cta: { label: 'Regional programs', to: '/learning/studio/programs' } },
  });
  if (block) return <SectionCard title="Program" testid="program-detail">{block}</SectionCard>;
  const said = (where) => (error?.where === where ? error.message : '');
  return (
    <div className="space-y-4" data-testid="program-detail">
      <SectionCard title="Program" meta={`uid ${program.uid}`} testid="program-fields">
        <div className="mb-4">
          <StatusActions status={program.status} what="program" onStatus={handlers.onStatus} busy={busy || !handlers.onStatus} />
        </div>
        <ProgramFields key={program.uid} program={program} onSubmit={handlers.onSave} busy={busy} error={said('fields')} notice={notice} />
      </SectionCard>
      <div className="grid gap-4 lg:grid-cols-3">
        <ContentCard contents={contents} choices={choices} handlers={handlers} busy={busy} error={said('contents')} />
        <AdminsCard admins={admins} handlers={handlers} busy={busy} error={said('admins')} />
        <MembersCard program={program} enrolments={enrolments} handlers={handlers} busy={busy} error={said('enrolments')} />
      </div>
    </div>
  );
}

// ── Content, in order ───────────────────────────────────────────────────────

function ContentCard({ contents, choices, handlers, busy, error }) {
  const items = byPosition(contents);
  const [adding, setAdding] = useState(false);
  const open = () => { setAdding(true); handlers.onWantChoices?.(); };
  return (
    <SectionCard title="Content, in order" meta={`${items.length}`} testid="program-contents">
      <ErrorLine error={error} testid="program-contents-error" />
      {items.length === 0 ? (
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400">No content in this program yet.</p>
      ) : (
        <ol className="space-y-2">
          {items.map((c, i) => (
            <ContentLine key={`${c.subject_kind}:${c.subject_uid}`} content={c} index={i} count={items.length} handlers={handlers} busy={busy} />
          ))}
        </ol>
      )}
      <div className="mt-3">
        {adding ? (
          <ContentPicker
            choices={choices} held={items} busy={busy}
            onAdd={(kind, uid) => handlers.onAddContent(kind, uid).then((ok) => { if (ok) setAdding(false); })}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button type="button" className={SECONDARY} onClick={open} disabled={busy || !handlers.onAddContent} data-testid="button-program-add-content">Add content</button>
        )}
      </div>
    </SectionCard>
  );
}

function ContentLine({ content, index, count, handlers, busy }) {
  const [confirming, setConfirming] = useState(false);
  const title = content.title || (content.status === 'missing' ? 'No longer exists' : 'Untitled');
  return (
    <li className="space-y-1.5" data-testid={`program-content-${content.subject_kind}-${content.subject_uid}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Pill tone="info">{subjectKindLabel(content.subject_kind)}</Pill>
          <span className="min-w-0 truncate font-medium text-axal-ink dark:text-gray-100">{title}</span>
          {content.status !== 'published' && (
            <Pill tone={CONTENT_STATUS_TONE[content.status] || 'neutral'}>{content.status === 'missing' ? 'Missing' : titleCase(content.status) || 'Status not recorded'}</Pill>
          )}
        </span>
        <span className="flex flex-wrap gap-1">
          {handlers.onMoveContent && (
            <MoveButtons index={index} count={count} label="content" busy={busy} onMove={(step) => handlers.onMoveContent(content.subject_kind, content.subject_uid, step)} />
          )}
          <button
            type="button" className={DANGER} onClick={() => setConfirming(true)} disabled={busy || !handlers.onRemoveContent}
            data-testid={`button-remove-content-${content.subject_uid}`}
          >
            Remove
          </button>
        </span>
      </div>
      {confirming && (
        <ConfirmRow
          text={`Remove “${title}” from this program? If it is program-only, the program’s members lose it at once. It stays in the studio.`}
          action="Remove"
          busy={busy}
          onConfirm={() => { setConfirming(false); handlers.onRemoveContent(content.subject_kind, content.subject_uid); }}
          onCancel={() => setConfirming(false)}
          testid={`program-confirm-content-${content.subject_uid}`}
        />
      )}
    </li>
  );
}

/**
 * Add one subject: its kind, then one of the studio's own rows of that kind
 * that the program does not hold yet. A webinar is drawn disabled: the
 * contents route refuses one until webinars are a program store.
 */
export function ContentPicker({ choices, held, onAdd, onCancel, busy, initialKind = 'course' }) {
  const [kind, setKind] = useState(initialKind);
  const [uid, setUid] = useState('');
  const ids = useId();
  const id = (name) => `${ids}-${name}`;
  const list = choices?.status === 'ready' ? choices.byKind?.[kind] : null;
  const options = list?.status === 'ready' ? contentChoices(list.rows, kind, held) : [];
  let picker;
  if (!choices || choices.status === 'loading' || choices.status === 'idle') picker = <LearningLoading rows={1} what="the content you can add" />;
  else if (choices.status !== 'ready') picker = <ErrorLine error={choices.message || 'The content lists could not be read.'} testid="program-choices-error" />;
  else if (list?.status !== 'ready') picker = <ErrorLine error={list?.message || 'This list could not be read.'} testid="program-choices-error" />;
  else if (!options.length) picker = <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="program-choices-empty">Nothing of this kind is left to add.</p>;
  else {
    picker = (
      <select id={id('subject')} className={INPUT} value={uid} onChange={(e) => setUid(e.target.value)} data-testid="select-program-subject">
        <option value="">Choose one</option>
        {options.map((o) => <option key={o.uid} value={o.uid}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <form
      className="grid gap-2 rounded-axal-md bg-axal-ground p-3 dark:bg-gray-950/40"
      onSubmit={(event) => { event.preventDefault(); if (uid) onAdd(kind, uid); }}
      data-testid="form-program-content"
    >
      <Field id={id('kind')} label="Kind">
        <select id={id('kind')} className={INPUT} value={kind} onChange={(e) => { setKind(e.target.value); setUid(''); }} data-testid="select-program-kind">
          {CONTENT_KINDS.map((k) => <option key={k} value={k}>{subjectKindLabel(k)}</option>)}
          <option value="webinar" disabled>Webinar (not a program content yet)</option>
        </select>
      </Field>
      <Field id={id('subject')} label={subjectKindLabel(kind)}>{picker}</Field>
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY} disabled={busy || !uid} data-testid="button-program-content-add">Add</button>
        <button type="button" className={SECONDARY} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ── People: the search both "Assign" and "Enrol" use ────────────────────────

/**
 * Find a person by name or email through the console's user search, and pick
 * one. `adminsOnly` lists admins alone, because the route assigns nobody
 * else. The search runs on "Find", from two characters, as the route requires.
 */
export function PeopleSearch({ onFind, onPick, adminsOnly = false, taken = [], takenLabel, actionLabel, onCancel, busy }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ status: 'idle' });
  const ids = useId();
  const search = async (event) => {
    event.preventDefault();
    const asked = q.trim();
    setFound({ status: 'loading' });
    try {
      setFound({ status: 'ready', q: asked, rows: await onFind(asked) });
    } catch (err) {
      setFound({ status: 'unreadable', message: err?.message || 'The search could not be run.' });
    }
  };
  return (
    <div className="space-y-2 rounded-axal-md bg-axal-ground p-3 dark:bg-gray-950/40" data-testid={`people-search-${adminsOnly ? 'admins' : 'members'}`}>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={search}>
        <label htmlFor={`${ids}-q`} className="sr-only">Name or email</label>
        <input id={`${ids}-q`} className={INPUT} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" data-testid="input-people-search" />
        <button type="submit" className={SECONDARY} disabled={q.trim().length < 2 || found.status === 'loading'} data-testid="button-people-search">Find</button>
        <button type="button" className={SECONDARY} onClick={onCancel}>Cancel</button>
      </form>
      <PeopleResults found={found} adminsOnly={adminsOnly} taken={taken} takenLabel={takenLabel} actionLabel={actionLabel} onPick={onPick} busy={busy} />
    </div>
  );
}

/**
 * What one search found: a name, a role and a uid for each person, never an
 * email, and a button to pick them unless they already hold the place.
 *
 *   found  { status: 'idle' | 'loading' | 'unreadable' (message) | 'ready', q, rows }
 */
export function PeopleResults({ found, adminsOnly = false, taken = [], takenLabel, actionLabel, onPick, busy }) {
  const all = found.status === 'ready' ? found.rows : [];
  const rows = adminsOnly ? all.filter((u) => u.role === 'admin') : all;
  return (
    <>
      {found.status === 'loading' && <LearningLoading rows={1} what="the people who match" />}
      {found.status === 'unreadable' && <ErrorLine error={found.message} testid="people-search-error" />}
      {found.status === 'ready' && (
        rows.length === 0 ? (
          <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="people-search-empty">
            {adminsOnly && all.length ? `No admin matches “${found.q}”. Only an admin can be assigned.` : `Nobody matches “${found.q}”.`}
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid="people-search-results">
            {rows.map((u) => {
              const already = taken.includes(u.uid);
              return (
                <li key={u.uid} className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]" data-testid={`person-${u.uid}`}>
                  <span className="min-w-0 text-axal-ink dark:text-gray-100">
                    <span className="font-medium">{u.name || <Unrecorded>Name not recorded</Unrecorded>}</span>
                    <span className="text-axal-faint dark:text-gray-500"> · {u.role ? titleCase(u.role) : 'role not recorded'} · {u.uid}{u.active ? '' : ' · inactive'}</span>
                  </span>
                  <button type="button" className={PRIMARY} disabled={busy || already} onClick={() => onPick(u.uid)} data-testid={`button-pick-${u.uid}`}>
                    {already ? takenLabel : actionLabel}
                  </button>
                </li>
              );
            })}
          </ul>
        )
      )}
      {found.status === 'ready' && all.length >= USER_SEARCH_LIMIT && (
        <p className="text-[11.5px] text-axal-faint dark:text-gray-500">The first {USER_SEARCH_LIMIT} matches. Type more of the name to narrow it.</p>
      )}
      {adminsOnly && found.status === 'ready' && rows.length > 0 && rows.length < all.length && (
        <p className="text-[11.5px] text-axal-faint dark:text-gray-500">Only admins are listed: only an admin can be assigned.</p>
      )}
    </>
  );
}

/** A person's row with a removal that asks first. */
function PersonLine({ name, detail, confirmText, confirmAction, onRemove, busy, testid }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="space-y-1.5" data-testid={testid}>
      <div className="flex items-center justify-between gap-2 text-[12.5px]">
        <span className="min-w-0 text-axal-ink dark:text-gray-100">
          <span className="font-medium">{name || <Unrecorded>Name not recorded</Unrecorded>}</span>
          {detail && <span className="text-axal-faint dark:text-gray-500"> · {detail}</span>}
        </span>
        <button type="button" className={DANGER} onClick={() => setConfirming(true)} disabled={busy || !onRemove} data-testid={`${testid}-remove`}>Remove</button>
      </div>
      {confirming && (
        <ConfirmRow
          text={confirmText}
          action={confirmAction}
          busy={busy}
          onConfirm={() => { setConfirming(false); onRemove(); }}
          onCancel={() => setConfirming(false)}
          testid={`${testid}-confirm`}
        />
      )}
    </li>
  );
}

// ── Assigned admins ─────────────────────────────────────────────────────────

function AdminsCard({ admins, handlers, busy, error }) {
  const rows = admins || [];
  const [assigning, setAssigning] = useState(false);
  return (
    <SectionCard title="Assigned admins" meta={`${rows.length}`} testid="program-admins">
      <ErrorLine error={error} testid="program-admins-error" />
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400">No admin assigned yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <PersonLine
              key={a.uid}
              name={a.name}
              detail={a.assigned_at ? `since ${formatDay(a.assigned_at)}` : null}
              confirmText={`Unassign ${a.name || 'this admin'}? They stop seeing this program’s members at once.`}
              confirmAction="Unassign"
              onRemove={handlers.onUnassign && (() => handlers.onUnassign(a.uid))}
              busy={busy}
              testid={`program-admin-${a.uid}`}
            />
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11.5px] leading-relaxed text-axal-faint dark:text-gray-500">
        Admins see this program’s content and each member’s completion. They author nothing.
      </p>
      <div className="mt-2">
        {assigning ? (
          <PeopleSearch
            adminsOnly onFind={handlers.onFindUsers} taken={rows.map((a) => a.uid)} takenLabel="Assigned" actionLabel="Assign" busy={busy}
            onPick={(uid) => handlers.onAssign(uid).then((ok) => { if (ok) setAssigning(false); })}
            onCancel={() => setAssigning(false)}
          />
        ) : (
          <button type="button" className={SECONDARY} onClick={() => setAssigning(true)} disabled={busy || !handlers.onAssign || !handlers.onFindUsers} data-testid="button-program-assign">Assign</button>
        )}
      </div>
    </SectionCard>
  );
}

// ── Members ─────────────────────────────────────────────────────────────────

function MembersCard({ program, enrolments, handlers, busy, error }) {
  const { active, removed } = splitEnrolments(enrolments);
  const [enrolling, setEnrolling] = useState(false);
  const switchLabel = useId();
  const open = program.enrolment === 'open';
  const known = program.enrolment === 'open' || program.enrolment === 'invite';
  return (
    <SectionCard title="Members" meta={`${active.length}`} testid="program-members">
      <ErrorLine error={error} testid="program-members-error" />
      <div className="mb-3 flex items-center justify-between gap-2 text-[12.5px]">
        <span className="text-axal-muted dark:text-gray-400" id={switchLabel}>Open to self-enrolment</span>
        {known ? (
          <button
            type="button" role="switch" aria-checked={open} aria-labelledby={switchLabel}
            onClick={() => handlers.onSetOpen(!open)} disabled={busy || !handlers.onSetOpen}
            className={`relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${open ? 'bg-axal-violet' : 'bg-gray-300 dark:bg-gray-600'}`}
            data-testid="switch-program-open"
          >
            <span aria-hidden="true" className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform dark:bg-gray-100 ${open ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        ) : <Unrecorded>not recorded</Unrecorded>}
      </div>
      {active.length === 0 ? (
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400">No member enrolled yet.</p>
      ) : (
        <ul className="space-y-2">
          {active.map((m) => (
            <PersonLine
              key={m.uid}
              name={m.name}
              detail={[ENROLLED_BY[m.enrolled_by], formatDay(m.enrolled_at)].filter(Boolean).join(', ')}
              confirmText={`Remove ${m.name || 'this member'} from this program? They lose its program-only content at once and cannot rejoin by themselves. The record of their enrolment stays.`}
              confirmAction="Remove member"
              onRemove={handlers.onUnenrol && (() => handlers.onUnenrol(m.uid))}
              busy={busy}
              testid={`program-member-${m.uid}`}
            />
          ))}
        </ul>
      )}
      {removed.length > 0 && (
        <details className="mt-3 text-[12.5px]" data-testid="program-members-removed">
          <summary className="cursor-pointer text-axal-muted dark:text-gray-400">Removed · {removed.length}</summary>
          <ul className="mt-2 space-y-1.5">
            {removed.map((m) => (
              <li key={m.uid} className="flex items-center justify-between gap-2" data-testid={`program-removed-${m.uid}`}>
                <span className="min-w-0 text-axal-ink dark:text-gray-100">
                  {m.name || <Unrecorded>Name not recorded</Unrecorded>}
                  <span className="text-axal-faint dark:text-gray-500"> · removed {formatDay(m.updated_at) || 'on a date not recorded'}</span>
                </span>
                <button type="button" className={SECONDARY} onClick={() => handlers.onEnrol(m.uid)} disabled={busy || !handlers.onEnrol}>Enrol again</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {program.uid && (
        <p className="mt-3 text-[12px]">
          <Link to={`/learning/programs/${encodeURIComponent(program.uid)}`} className="font-semibold text-axal-violet-deep underline hover:text-axal-violet dark:text-violet-300" data-testid="link-program-progress">
            Each member’s progress
          </Link>
          <span className="text-axal-faint dark:text-gray-500"> · read-only, as its admins see it</span>
        </p>
      )}
      <div className="mt-2">
        {enrolling ? (
          <PeopleSearch
            onFind={handlers.onFindUsers} taken={active.map((m) => m.uid)} takenLabel="Enrolled" actionLabel="Enrol" busy={busy}
            onPick={(uid) => handlers.onEnrol(uid).then((ok) => { if (ok) setEnrolling(false); })}
            onCancel={() => setEnrolling(false)}
          />
        ) : (
          <button type="button" className={SECONDARY} onClick={() => setEnrolling(true)} disabled={busy || !handlers.onEnrol || !handlers.onFindUsers} data-testid="button-program-enrol">Enrol</button>
        )}
      </div>
    </SectionCard>
  );
}
