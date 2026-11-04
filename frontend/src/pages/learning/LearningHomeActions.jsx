/** D4481 (#4481) — home-only registration actions, webinar rows and the phone's course primary. */
import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pill, Unrecorded } from '../../ui';
import { LearningEmpty, LearningLoading, LearningUnreadable } from './LearningStates';
import { SECONDARY } from './studioParts';
import { webinarPhase } from './learningModel';
import { formatWebinarDayTime, seatsOf, viewerZone } from './webinarModel';
import { registerForWebinar } from './webinarReads';

export const HOME_SECONDARY = `${SECONDARY} min-h-[44px] sm:min-h-[32px]`;

/** Errors may carry a route's sentence; transport/internal Error.message is never product copy. */
export function homeRefusal(error, fallback) {
  return typeof error?.data?.message === 'string' && error.data.message.trim() ? error.data.message : fallback;
}

/** The record is newest first already. A video is not the course primary. */
export const inProgressCourses = (state) => state?.status === 'ready'
  ? (state.in_progress || []).filter((row) => row.subject_kind === 'course') : [];

/** The same registration write/state is shared by desktop and phone home rows. */
export function useHomeWebinarRegistration(setUpcoming) {
  const pending = useRef(new Set());
  const [busy, setBusy] = useState(new Set());
  const [errors, setErrors] = useState({});
  const onRegister = async (uid) => {
    if (pending.current.has(uid)) return;
    pending.current.add(uid);
    setBusy((old) => new Set([...old, uid]));
    setErrors((old) => ({ ...old, [uid]: null }));
    try {
      // The existing wrapper writes once, then reads current registration and seats.
      const fresh = await registerForWebinar(uid);
      setUpcoming((old) => old.status === 'ready' ? { ...old, rows: old.rows.map((row) => row.uid === uid
        ? { ...row, ...fresh.webinar, registered: fresh.registration?.registered === true } : row) } : old);
    } catch (error) {
      setErrors((old) => ({ ...old, [uid]: homeRefusal(error, 'Your registration could not be confirmed. Try again.') }));
    } finally {
      pending.current.delete(uid);
      setBusy((old) => new Set([...old].filter((value) => value !== uid)));
    }
  };
  return { onRegister, busy, errors };
}

export function HomePhonePrimary({ state, onBrowse }) {
  if (state?.status !== 'ready') return null;
  const course = inProgressCourses(state)[0];
  const classes = 'flex min-h-[44px] w-full items-center justify-center rounded-axal-sm bg-axal-violet px-4 py-2 text-center text-[14px] font-semibold text-white hover:bg-axal-violet-deep dark:bg-violet-400 dark:text-gray-950 dark:hover:bg-violet-300';
  if (course && !course.href) return <button type="button" disabled className={classes} data-testid="learning-phone-primary">Course link not recorded</button>;
  return course
    ? <Link to={course.href} className={classes} data-testid="learning-phone-primary"><span className="min-w-0 break-words">Continue {course.title || 'course'}</span></Link>
    : <button type="button" onClick={onBrowse} className={classes} data-testid="learning-phone-primary">Browse courses</button>;
}

/** No limit is a recorded fact; a missing seat figure is never zero. */
export function homeSeatsLine(row) {
  const seats = seatsOf(row);
  if (seats.limit === 'none') return 'No seat limit';
  if (seats.left === null) return 'Seats not recorded';
  return seats.full ? 'Full' : `${seats.left} seat${seats.left === 1 ? '' : 's'} left`;
}

export function HomeWebinarsList({ state, now = Date.now(), onRetry, actions = {}, limit = 3 }) {
  if (!state || ['loading', 'idle'].includes(state.status)) return <LearningLoading rows={3} what="the upcoming webinars" />;
  if (state.status !== 'ready') return <LearningUnreadable what="The upcoming webinars" claim="This is not a claim that none is scheduled." onRetry={onRetry} />;
  const rows = (state.rows || []).slice(0, limit);
  if (!rows.length) return <LearningEmpty title="No webinar scheduled" body="Webinars HQ schedules appear here, with a way to register." />;
  return <div data-testid="list-upcoming-webinars">
    <p className="mb-2 text-[11.5px] text-axal-muted dark:text-gray-400">Times in your zone, {viewerZone()}.</p>
    <ul className="divide-y divide-axal-hairline dark:divide-gray-800">{rows.map((row) => {
      const phase = webinarPhase(row, now), error = actions.errors?.[row.uid];
      return <li key={row.uid} className="space-y-1 py-3 first:pt-0" data-testid={`home-webinar-${row.uid}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link to={row.href || `/learning/webinars/${encodeURIComponent(row.uid)}`} className="break-words text-[13.5px] font-semibold text-axal-ink hover:text-axal-violet-deep dark:text-gray-100 dark:hover:text-violet-300">{row.title || 'Untitled webinar'}</Link>
            <p className="mt-1 font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{formatWebinarDayTime(row.starts_at) || 'Start not recorded'} · {homeSeatsLine(row)}</p>
          </div>
          <HomeWebinarAction row={row} phase={phase} actions={actions} />
        </div>
        {error && <p role="alert" className="text-[12px] text-red-700 dark:text-red-300" data-testid={`home-webinar-error-${row.uid}`}>{error}</p>}
      </li>;
    })}</ul>
  </div>;
}

/** Shared by the phone row and desktop list; the enclosing row owns its refusal. */
export function HomeWebinarAction({ row, phase, actions = {} }) {
  if (phase === 'cancelled') return <Pill tone="danger">Cancelled</Pill>;
  if (row.registered) return <Pill tone="ok">Registered</Pill>;
  if (phase === 'past') return <span className="text-[12px] text-axal-muted dark:text-gray-400">Ended</span>;
  if (seatsOf(row).full) return <Unrecorded>Full</Unrecorded>;
  const busy = actions.busy?.has(row.uid);
  return <button type="button" className={HOME_SECONDARY} disabled={busy || !actions.onRegister} onClick={() => actions.onRegister(row.uid)} data-testid={`home-webinar-register-${row.uid}`}>{busy ? 'Registering…' : 'Register'}</button>;
}
