import React, { useId, useState } from 'react';
import { Pill } from '../../ui';
import { SectionCard } from './LearningStates';
import {
  ConfirmRow, DANGER, ErrorLine, Field, INPUT, MoveButtons, PRIMARY, SECONDARY, StatusActions,
} from './studioParts';
import { courseForm } from './studioActions';
import { byPosition, lessonKindLabel } from './learningModel';

const LEVELS = [['', 'Not set'], ['intro', 'Intro'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']];

/**
 * The course builder, for the Super Admin (D562 stage 2; D557's
 * `admin_learning.ts`): the course's own fields and resources, its status,
 * and its modules and lessons, each added, edited, deleted and moved up or
 * down. Every write answers with the whole course tree, which replaces what is
 * drawn, so the order on screen is always the order stored.
 *
 *   course    the tree from `GET /courses/:uid`, or null to create one
 *   items     the studio's item list, for choosing what a lesson opens
 *   exercises, exams  the studio's exercise and exam lists (D559's `GET
 *             /exercises` and `GET /exams`), for an exercise or exam lesson
 *   handlers  { onSaveCourse, onStatus, onAddModule, onRenameModule,
 *               onMoveModule, onDeleteModule, onAddLesson, onUpdateLesson,
 *               onMoveLesson, onDeleteLesson }, each resolving true once the
 *               write went through
 *   busy, error ({ where, message }: the route's own words), notice
 */
export default function StudioCourseBuilder({ course, items = [], exercises = [], exams = [], handlers, busy = false, error = null, notice = '' }) {
  const [form, setForm] = useState(() => courseForm(course));
  const ids = useId();
  const id = (name) => `${ids}-${name}`;
  const set = (name) => (event) => setForm((f) => ({ ...f, [name]: event.target.value }));
  const setResource = (i, name) => (event) => setForm((f) => ({
    ...f, resources: f.resources.map((r, j) => (j === i ? { ...r, [name]: event.target.value } : r)),
  }));
  return (
    <div className="space-y-4" data-testid="studio-course-builder">
      <SectionCard title={course ? 'Edit course' : 'New course'} meta={course ? `/learning/courses/${course.slug}` : 'created as a draft'} testid="studio-course-fields">
        {course && <div className="mb-4"><StatusActions status={course.status} what="course" onStatus={handlers.onStatus} busy={busy} /></div>}
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => { event.preventDefault(); handlers.onSaveCourse(form); }}
          data-testid="form-studio-course"
        >
          <Field id={id('title')} label="Title">
            <input id={id('title')} className={INPUT} value={form.title} onChange={set('title')} data-testid="input-course-title" />
          </Field>
          <Field id={id('slug')} label="Slug" hint="Lowercase letters, digits and hyphens: the course's address.">
            <input id={id('slug')} className={INPUT} value={form.slug} onChange={set('slug')} data-testid="input-course-slug" />
          </Field>
          <Field id={id('summary')} label="Summary" full>
            <textarea id={id('summary')} rows={2} className={INPUT} value={form.summary} onChange={set('summary')} />
          </Field>
          <Field id={id('cover')} label="Cover image link" hint="https.">
            <input id={id('cover')} type="url" className={INPUT} value={form.cover_url} onChange={set('cover_url')} />
          </Field>
          <Field id={id('minutes')} label="Estimated minutes">
            <input id={id('minutes')} inputMode="numeric" className={INPUT} value={form.estimated_minutes} onChange={set('estimated_minutes')} />
          </Field>
          <Field id={id('level')} label="Level">
            <select id={id('level')} className={INPUT} value={form.level} onChange={set('level')}>
              {LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field id={id('visibility')} label="Visibility" hint="Program-only content stays hidden from members until programs are live.">
            <select id={id('visibility')} className={INPUT} value={form.visibility} onChange={set('visibility')}>
              <option value="open">Open to every member</option>
              <option value="program">Program-only</option>
            </select>
          </Field>
          <fieldset className="space-y-2 sm:col-span-2" data-testid="studio-course-resources">
            <legend className="mb-1 text-[12px] font-semibold text-axal-ink dark:text-gray-200">Resources</legend>
            {form.resources.map((r, i) => (
              <div key={i} className="flex flex-col gap-2 sm:flex-row">
                <input aria-label={`Resource ${i + 1} title`} className={INPUT} value={r.title} onChange={setResource(i, 'title')} placeholder="Title" />
                <input aria-label={`Resource ${i + 1} link`} type="url" className={INPUT} value={r.url} onChange={setResource(i, 'url')} placeholder="https://…" />
                <button type="button" className={SECONDARY} onClick={() => setForm((f) => ({ ...f, resources: f.resources.filter((_, j) => j !== i) }))}>Remove</button>
              </div>
            ))}
            <button type="button" className={SECONDARY} onClick={() => setForm((f) => ({ ...f, resources: [...f.resources, { title: '', url: '' }] }))}>
              Add a resource
            </button>
            <p className="text-[11.5px] text-axal-faint dark:text-gray-500">Each one is a title and an https link, up to 50.</p>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="submit" className={PRIMARY} disabled={busy} data-testid="button-course-save">
              {busy ? 'Saving…' : course ? 'Save course' : 'Create draft'}
            </button>
            {notice && <span className="text-[12.5px] text-emerald-700 dark:text-emerald-300" role="status">{notice}</span>}
          </div>
          <div className="sm:col-span-2"><ErrorLine error={error?.where === 'course' ? error.message : ''} /></div>
        </form>
      </SectionCard>
      {course && <ModulesEditor course={course} items={items} exercises={exercises} exams={exams} handlers={handlers} busy={busy} error={error?.where === 'modules' ? error.message : ''} />}
    </div>
  );
}

function ModulesEditor({ course, items, exercises, exams, handlers, busy, error }) {
  const modules = byPosition(course.modules);
  const [title, setTitle] = useState('');
  return (
    <SectionCard title="Modules and lessons" meta={`${modules.length} module${modules.length === 1 ? '' : 's'}`} testid="studio-modules">
      <ErrorLine error={error} testid="studio-modules-error" />
      {modules.length === 0 && <p className="text-[12.5px] text-axal-muted dark:text-gray-400">No module yet. Add the first one below.</p>}
      <ol className="space-y-3">
        {modules.map((m, i) => (
          <ModuleBlock key={m.uid} course={course} module={m} index={i} count={modules.length} items={items} exercises={exercises} exams={exams} handlers={handlers} busy={busy} />
        ))}
      </ol>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => { event.preventDefault(); handlers.onAddModule(title).then((ok) => { if (ok) setTitle(''); }); }}
        data-testid="form-studio-add-module"
      >
        <input aria-label="New module title" className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New module title" />
        <button type="submit" className={PRIMARY} disabled={busy}>Add module</button>
      </form>
    </SectionCard>
  );
}

function ModuleBlock({ module, index, count, items, exercises, exams, handlers, busy }) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(module.title || '');
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);
  const lessons = byPosition(module.lessons);
  return (
    <li className="rounded-axal-md border border-axal-hairline p-3 dark:border-gray-800" data-testid={`studio-module-${module.uid}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {renaming ? (
          <form
            className="flex flex-1 flex-wrap gap-2"
            onSubmit={(event) => { event.preventDefault(); handlers.onRenameModule(module.uid, title).then((ok) => { if (ok) setRenaming(false); }); }}
          >
            <input aria-label="Module title" className={`${INPUT} min-w-[12rem] flex-1`} value={title} onChange={(e) => setTitle(e.target.value)} />
            <button type="submit" className={PRIMARY} disabled={busy}>Save</button>
            <button type="button" className={SECONDARY} onClick={() => { setRenaming(false); setTitle(module.title || ''); }}>Cancel</button>
          </form>
        ) : (
          <h3 className="text-[13px] font-bold text-axal-ink dark:text-gray-100">Module {index + 1} · {module.title}</h3>
        )}
        <span className="flex flex-wrap gap-1">
          {!renaming && <button type="button" className={SECONDARY} onClick={() => setRenaming(true)} disabled={busy}>Rename</button>}
          <MoveButtons index={index} count={count} label="module" busy={busy} onMove={(step) => handlers.onMoveModule(module.uid, step)} />
          <button type="button" className={DANGER} onClick={() => setConfirming(true)} disabled={busy} data-testid={`button-delete-module-${module.uid}`}>Delete</button>
        </span>
      </div>
      {confirming && (
        <div className="mt-2">
          <ConfirmRow
            text="Delete this module?"
            action="Delete module"
            busy={busy}
            onConfirm={() => { setConfirming(false); handlers.onDeleteModule(module.uid); }}
            onCancel={() => setConfirming(false)}
            testid={`studio-confirm-module-${module.uid}`}
          />
        </div>
      )}
      <ol className="mt-2 space-y-1.5">
        {lessons.map((l, i) => (
          <LessonLine key={l.uid} lesson={l} index={i} count={lessons.length} module={module} items={items} exercises={exercises} exams={exams} handlers={handlers} busy={busy} />
        ))}
      </ol>
      {lessons.length === 0 && <p className="mt-1 text-[12px] text-axal-muted dark:text-gray-400">No lesson in this module yet.</p>}
      <div className="mt-2">
        {adding ? (
          <LessonForm
            items={items} exercises={exercises} exams={exams} busy={busy} submitLabel="Add lesson"
            onSubmit={(form) => handlers.onAddLesson(module.uid, form).then((ok) => { if (ok) setAdding(false); })}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button type="button" className={SECONDARY} onClick={() => setAdding(true)} disabled={busy} data-testid={`button-add-lesson-${module.uid}`}>Add lesson</button>
        )}
      </div>
    </li>
  );
}

/** What a lesson opens, in words: the item's title, the exercise's or exam's, or the event's slug. */
export function refLabel(lesson, items, exercises = [], exams = []) {
  if (lesson.kind === 'webinar') return `the event “${lesson.ref_uid}”`;
  if (lesson.kind === 'exercise' || lesson.kind === 'exam') {
    const found = ((lesson.kind === 'exam' ? exams : exercises) || []).find((x) => x.uid === lesson.ref_uid);
    return found ? `the ${lesson.kind} “${found.title}”` : `${lesson.kind} ${lesson.ref_uid}`;
  }
  const item = (items || []).find((i) => i.uid === lesson.ref_uid);
  return item ? `“${item.title}”` : `item ${lesson.ref_uid}`;
}

function LessonLine({ lesson, index, count, module, items, exercises, exams, handlers, busy }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (editing) {
    return (
      <li>
        <LessonForm
          lesson={lesson} items={items} exercises={exercises} exams={exams} busy={busy} submitLabel="Save lesson"
          onSubmit={(form) => handlers.onUpdateLesson(lesson.uid, form).then((ok) => { if (ok) setEditing(false); })}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }
  return (
    <li className="space-y-1.5" data-testid={`studio-lesson-${lesson.uid}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Pill tone="neutral">{lessonKindLabel(lesson.kind)}</Pill>
          <span className="font-medium text-axal-ink dark:text-gray-100">{lesson.title}</span>
          <span className="text-axal-faint dark:text-gray-500">opens {refLabel(lesson, items, exercises, exams)}</span>
          {lesson.required === false && <Pill tone="neutral">Optional</Pill>}
        </span>
        <span className="flex flex-wrap gap-1">
          <button type="button" className={SECONDARY} onClick={() => setEditing(true)} disabled={busy}>Edit</button>
          <MoveButtons index={index} count={count} label="lesson" busy={busy} onMove={(step) => handlers.onMoveLesson(module, lesson.uid, step)} />
          <button type="button" className={DANGER} onClick={() => setConfirming(true)} disabled={busy} data-testid={`button-delete-lesson-${lesson.uid}`}>Delete</button>
        </span>
      </div>
      {confirming && (
        <ConfirmRow
          text="Delete this lesson?"
          action="Delete lesson"
          busy={busy}
          onConfirm={() => { setConfirming(false); handlers.onDeleteLesson(lesson.uid); }}
          onCancel={() => setConfirming(false)}
          testid={`studio-confirm-lesson-${lesson.uid}`}
        />
      )}
    </li>
  );
}

/**
 * Add a lesson, or edit one. A lesson's kind is set when it is added and never
 * changed (`PATCH /lessons/:uid` takes none). A video or reading lesson opens
 * an item of that kind; a webinar lesson opens an event, by its slug (D557);
 * an exercise or exam lesson opens one of its own kind, by its uid (D559's
 * `checkRef`). Archived ones are left out of every choice.
 */
export function LessonForm({ lesson, items, exercises = [], exams = [], onSubmit, onCancel, busy, submitLabel }) {
  const [form, setForm] = useState(() => ({
    kind: lesson?.kind || 'video',
    title: lesson?.title || '',
    ref_uid: lesson?.ref_uid || '',
    required: lesson ? lesson.required !== false : true,
  }));
  const ids = useId();
  const id = (name) => `${ids}-${name}`;
  const assessment = form.kind === 'exercise' || form.kind === 'exam';
  const choices = assessment
    ? ((form.kind === 'exam' ? exams : exercises) || []).filter((x) => x.status !== 'archived' || x.uid === form.ref_uid)
    : (items || []).filter((i) => i.kind === form.kind && (i.status !== 'archived' || i.uid === form.ref_uid));
  return (
    <form
      className="grid gap-2 rounded-axal-md bg-axal-ground p-3 sm:grid-cols-2 dark:bg-gray-950/40"
      onSubmit={(event) => { event.preventDefault(); onSubmit(form); }}
      data-testid="form-studio-lesson"
    >
      {!lesson && (
        <Field id={id('kind')} label="Kind">
          <select id={id('kind')} className={INPUT} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value, ref_uid: '' }))} data-testid="select-lesson-kind">
            <option value="video">Video</option>
            <option value="reading">Reading</option>
            <option value="webinar">Webinar (an event)</option>
            <option value="exercise">Exercise</option>
            <option value="exam">Exam</option>
          </select>
        </Field>
      )}
      <Field id={id('title')} label="Title">
        <input id={id('title')} className={INPUT} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} data-testid="input-lesson-title" />
      </Field>
      {form.kind === 'webinar' ? (
        <Field id={id('ref')} label="Event slug" hint="The event this lesson opens.">
          <input id={id('ref')} className={INPUT} value={form.ref_uid} onChange={(e) => setForm((f) => ({ ...f, ref_uid: e.target.value }))} />
        </Field>
      ) : (
        <Field
          id={id('ref')}
          label={assessment ? lessonKindLabel(form.kind) : form.kind === 'reading' ? 'Reading' : 'Video'}
          hint={assessment ? `Members open a draft ${form.kind} only once it is published.` : undefined}
        >
          <select id={id('ref')} className={INPUT} value={form.ref_uid} onChange={(e) => setForm((f) => ({ ...f, ref_uid: e.target.value }))} data-testid="select-lesson-ref">
            <option value="">Choose one</option>
            {choices.map((i) => (
              <option key={i.uid} value={i.uid}>{i.title}{i.status !== 'published' ? ` (${i.status})` : ''}</option>
            ))}
          </select>
        </Field>
      )}
      <label className="flex items-center gap-2 text-[12.5px] text-axal-ink sm:col-span-2 dark:text-gray-200">
        <input type="checkbox" checked={form.required} onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))} className="accent-violet-600" />
        Required: it counts toward the course’s progress
      </label>
      {assessment && (
        <p className="text-[11.5px] text-axal-faint sm:col-span-2 dark:text-gray-500" data-testid="text-lesson-assessment-progress">
          Nothing marks an exercise or exam lesson complete yet, so a required one keeps the course below 100%.
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={PRIMARY} disabled={busy}>{submitLabel}</button>
        <button type="button" className={SECONDARY} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
