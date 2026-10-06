import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { RailFrame, WorkerRail } from '../../ui';
import StudioContentTable from './StudioContentTable';
import StudioItemEditor from './StudioItemEditor';
import StudioCourseBuilder from './StudioCourseBuilder';
import {
  LearningEmpty, LearningHeader, LearningLoading, LearningUnreadable, SectionCard,
} from './LearningStates';
import { SECONDARY, PRIMARY } from './studioParts';
import {
  STATUS_NOTICE, addLesson, addModule, deleteLesson, deleteModule, moveLesson, moveModule, readStudioCourse,
  readStudioCourses, readStudioItems, renameModule, saveCourse, saveItem, setCourseStatus, setItemStatus,
  studioRows, updateLesson,
} from './studioActions';
import useLearningRead from './useLearningRead';

/**
 * `/learning/studio`: the Super Admin's authoring (D562 stage 2, D557's
 * `admin_learning.ts`). The route is `guard(['admin'], hqOnly(…))`, and every
 * call it makes is `requireSuperAdmin` on the Worker as well.
 *
 * WHAT IS OPEN LIVES IN THE URL: `?item=<uid>`, `?course=<uid>`, or
 * `?new=video|reading|course`. An open editor is the page; "All content"
 * goes back to the table. A link to one course's builder can be shared.
 *
 * Every write runs through `run`, which shows the route's refusal in the
 * route's own words beside what was being changed, and draws what the route
 * answered rather than what was sent.
 */

/** The content list and whatever is open, drawn from props. */
export function StudioView({ items, courses, editor, onRetryItems, onRetryCourses }) {
  if (editor) {
    return (
      <>
        <Link to="/learning/studio" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-axal-violet-deep hover:text-axal-violet dark:text-violet-300" data-testid="link-studio-all">
          <ChevronLeft size={14} aria-hidden="true" /> All content
        </Link>
        {editor}
      </>
    );
  }
  const both = items.status === 'unreadable' && courses.status === 'unreadable';
  const loading = items.status === 'loading' || courses.status === 'loading';
  const rows = studioRows(items.status === 'ready' ? items.rows : [], courses.status === 'ready' ? courses.rows : []);
  return (
    <>
      {!both && items.status === 'unreadable' && (
        <LearningUnreadable what="The item list" claim="This is not a claim that there are no videos or readings." onRetry={onRetryItems} />
      )}
      {!both && courses.status === 'unreadable' && (
        <LearningUnreadable what="The course list" claim="This is not a claim that there are no courses." onRetry={onRetryCourses} />
      )}
      <StudioContentTable
        status={both ? 'unreadable' : loading ? 'loading' : 'ready'}
        rows={rows}
        onRetry={() => { onRetryItems?.(); onRetryCourses?.(); }}
      />
      <p className="text-[12.5px] text-axal-muted dark:text-gray-400">
        <Link to="/learning/studio/programs" className="font-semibold text-axal-violet-deep underline hover:text-axal-violet dark:text-violet-300" data-testid="link-studio-programs">
          Regional programs
        </Link>
        {' '}group this content for a region, with their admins and members.
      </p>
    </>
  );
}

/** Which editor the address opens, as one key: `item:<uid>`, `course:<uid>`, `new:<kind>`, or '' for the table. */
export const targetOf = (key, value) => (key ? `${key}:${value}` : '');

/**
 * What the open editor shows of the last thing the studio said: a refusal or
 * a notice is shown only in the editor it was made in, so opening another
 * item never carries the last one's error over.
 */
export function sayingAt(said, target) {
  const here = Boolean(said) && said.at === target;
  return { error: here && said.error ? said.error : null, notice: here && said.notice ? said.notice : '' };
}

/** The header's three ways to start: a video, a reading, a course. */
function NewButtons() {
  return (
    <span className="flex flex-wrap gap-2" data-testid="studio-new">
      <Link to="/learning/studio?new=video" className={SECONDARY}>New video</Link>
      <Link to="/learning/studio?new=reading" className={SECONDARY}>New reading</Link>
      <Link to="/learning/studio?new=course" className={PRIMARY}>New course</Link>
    </span>
  );
}

export default function LearningStudio({ sub }) {
  const [params, setParams] = useSearchParams();
  const itemUid = params.get('item');
  const courseUid = params.get('course');
  const creating = params.get('new');
  const [items, retryItems, setItems] = useLearningRead(readStudioItems, [], { scope: 'studio-items' });
  const [courses, retryCourses, setCourses] = useLearningRead(readStudioCourses, [], { scope: 'studio-courses' });
  const [course, retryCourse, setCourse] = useLearningRead(() => readStudioCourse(courseUid), [courseUid], { enabled: Boolean(courseUid), scope: 'studio-course' });
  const [busy, setBusy] = useState(false);
  // A refusal or a notice belongs to the editor it was made in (`at`).
  const [said, setSaid] = useState(null);
  const target = targetOf(creating ? 'new' : itemUid ? 'item' : courseUid ? 'course' : '', creating || itemUid || courseUid);
  const { error, notice } = sayingAt(said, target);
  const setNotice = (text, at = target) => setSaid({ notice: text, at });

  const open = (key, value) => setParams(() => {
    const next = new URLSearchParams();
    if (key) next.set(key, value);
    return next;
  });
  /** One write. Resolves true when it went through; a refusal is shown in the route's words. */
  const run = async (where, write, done) => {
    setBusy(true);
    setSaid(null);
    try {
      const result = await write();
      done(result);
      return true;
    } catch (err) {
      setSaid({ error: { where, message: err?.message || 'The studio could not save that.' }, at: target });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const upsert = (setter, row) => setter((s) => (s.status === 'ready' ? { ...s, rows: [row, ...s.rows.filter((r) => r.uid !== row.uid)] } : s));
  const showCourse = (tree) => {
    if (!tree) return;
    setCourse({ status: 'ready', course: tree });
    upsert(setCourses, tree);
  };

  const itemProps = (kind, uid) => ({
    onSave: (form) => run('item', () => saveItem({ uid, kind, form }), (stored) => {
      upsert(setItems, stored);
      if (uid) {
        setNotice('Saved.');
      } else {
        setNotice('Draft created.', targetOf('item', stored.uid));
        open('item', stored.uid);
      }
    }),
    onStatus: (action) => run('item', () => setItemStatus(uid, action), (stored) => {
      upsert(setItems, stored);
      setNotice(STATUS_NOTICE[action]);
    }),
    busy,
    error: error?.where === 'item' ? error.message : '',
    notice,
  });
  const courseHandlers = (current) => ({
    onSaveCourse: (form) => run('course', () => saveCourse({ uid: current?.uid, form }), (tree) => {
      showCourse(tree);
      if (current) {
        setNotice('Saved.');
      } else {
        setNotice('Draft created.', targetOf('course', tree.uid));
        open('course', tree.uid);
      }
    }),
    onStatus: (action) => run('course', () => setCourseStatus(current.uid, action), (tree) => { showCourse(tree); setNotice(STATUS_NOTICE[action]); }),
    onAddModule: (title) => run('modules', () => addModule(current.uid, title), showCourse),
    onRenameModule: (uid, title) => run('modules', () => renameModule(uid, title), showCourse),
    onMoveModule: (uid, step) => run('modules', () => moveModule(current, uid, step), showCourse),
    onDeleteModule: (uid) => run('modules', () => deleteModule(uid), showCourse),
    onAddLesson: (moduleUid, form) => run('modules', () => addLesson(moduleUid, form), showCourse),
    onUpdateLesson: (uid, form) => run('modules', () => updateLesson(uid, form), showCourse),
    onMoveLesson: (module, uid, step) => run('modules', () => moveLesson(module, uid, step), showCourse),
    onDeleteLesson: (uid) => run('modules', () => deleteLesson(uid), showCourse),
  });

  const itemRows = items.status === 'ready' ? items.rows : [];
  let editor = null;
  if (creating === 'video' || creating === 'reading') {
    editor = <StudioItemEditor key={`new-${creating}`} kind={creating} item={null} {...itemProps(creating, null)} />;
  } else if (creating === 'course') {
    editor = <StudioCourseBuilder key="new-course" course={null} items={itemRows} handlers={courseHandlers(null)} busy={busy} error={error} notice={notice} />;
  } else if (itemUid) {
    const item = itemRows.find((i) => i.uid === itemUid);
    editor = items.status === 'loading' ? <LearningLoading what="the item" />
      : items.status === 'unreadable' ? <LearningUnreadable what="The item list" claim="This is not a claim that the item does not exist." onRetry={retryItems} />
        : item ? <StudioItemEditor key={item.uid} item={item} kind={item.kind} {...itemProps(item.kind, item.uid)} />
          : <SectionCard title="Not found"><LearningEmpty title="No such item" body="No video or reading has that uid." /></SectionCard>;
  } else if (courseUid) {
    editor = course.status === 'loading' || course.status === 'idle' ? <LearningLoading what="the course" />
      : course.status === 'unreadable' ? <LearningUnreadable what="The course" claim="This is not a claim that it does not exist." onRetry={retryCourse} />
        : course.status === 'missing' ? <SectionCard title="Not found"><LearningEmpty title="No such course" body="No course has that uid." /></SectionCard>
          : <StudioCourseBuilder key={course.course.uid} course={course.course} items={itemRows} handlers={courseHandlers(course.course)} busy={busy} error={error} notice={notice} />;
  }

  const coverage = [
    items.status === 'ready' ? `${items.rows.length} ${items.rows.length === 1 ? 'video or reading' : 'videos and readings'}, drafts included` : null,
    courses.status === 'ready' ? `${courses.rows.length} course${courses.rows.length === 1 ? '' : 's'}, drafts included` : null,
  ].filter(Boolean);
  return (
    <RailFrame
      rail={(
        <WorkerRail
          workspace="Learning studio"
          role="super_admin"
          stance="Authoring view"
          note="Eadwyn reads back what this page has loaded. It does not publish, archive or edit anything: every write here is the Super Admin’s own."
          coverage={coverage}
        />
      )}
      data-testid="learning-studio"
    >
      <div className="space-y-4">
        <LearningHeader title="Learning studio" sub={sub} back={{ to: '/learning', label: 'Learning' }} action={<NewButtons />} />
        <StudioView items={items} courses={courses} editor={editor} onRetryItems={retryItems} onRetryCourses={retryCourses} />
      </div>
    </RailFrame>
  );
}
