import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, ExternalLink, Video } from 'lucide-react';
import { Card, Pill, Unrecorded } from '../../ui';
import { SectionCard, stateBlock } from './LearningStates';
import { NOT_LIVE, durationLabel, formatDay, formatWhen, joinWindowOpen, parseInstant, webinarPhase } from './learningModel';

const PHASE_PILL = {
  upcoming: { tone: 'info', label: 'Upcoming' },
  live: { tone: 'danger', label: 'Live', dot: true },
  past: { tone: 'neutral', label: 'Ended' },
  cancelled: { tone: 'danger', label: 'Cancelled' },
  unknown: { tone: 'neutral', label: 'Time not recorded' },
};

const BUTTON = 'inline-flex items-center gap-1.5 rounded-axal-sm px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const SECONDARY = `${BUTTON} border border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep hover:border-axal-violet/40 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300`;

/**
 * One webinar, in each of its states: upcoming, live and past (D562; data
 * #1161).
 *
 * Props, in the shape #1161 plans:
 *   status        'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   webinar       { uid, title, abstract, host_name, starts_at, ends_at, timezone,
 *                   capacity, registered_count, join_url, recording_item_uid, status }
 *   registration  { registered, registered_at, attended } or null
 *   now           the clock in ms, a prop so a test can stand anywhere in the window
 *   icsHref       the `.ics` download; recordingHref the attached recording
 *   onRegister, onUnregister, busy
 *
 * THE JOIN LINK IS THE SERVER'S TO SEND. #1161 returns `join_url` only to a
 * registered member, from 15 minutes before the start to the end. This panel
 * draws it only when it arrived AND the window is open now, so a link read
 * earlier is not offered once the webinar has ended.
 */
export default function WebinarPanel({
  status, webinar, registration, now = Date.now(), icsHref, recordingHref,
  onRegister, onUnregister, busy = false, reason = NOT_LIVE.webinars, onRetry,
}) {
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the webinar',
    claim: 'This is not a claim that the webinar does not exist.',
    isEmpty: !webinar,
    empty: { title: 'No such webinar', body: 'This webinar does not exist, or it is not published yet.', cta: { label: 'Back to Learning', to: '/learning' } },
  });
  if (block) return <SectionCard title="Webinar" testid="webinar-panel">{block}</SectionCard>;

  const phase = webinarPhase(webinar, now);
  const pill = PHASE_PILL[phase];
  const registered = Boolean(registration?.registered);
  const start = parseInstant(webinar?.starts_at);
  const end = parseInstant(webinar?.ends_at);
  const length = start && end ? durationLabel((end.getTime() - start.getTime()) / 1000) : null;
  const capacity = Number(webinar?.capacity);
  const hasCapacity = webinar?.capacity !== null && webinar?.capacity !== undefined && Number.isFinite(capacity);
  const count = Number(webinar?.registered_count);
  const hasCount = webinar?.registered_count !== null && webinar?.registered_count !== undefined && Number.isFinite(count);
  const full = hasCapacity && hasCount && count >= capacity;
  const canJoin = registered && Boolean(webinar?.join_url) && joinWindowOpen(webinar, now);

  return (
    <Card padding="none" className="overflow-hidden" data-testid="webinar-panel" data-phase={phase}>
      <div className="flex items-center justify-between gap-3 border-b border-axal-hairline px-4 py-2.5 dark:border-gray-800">
        <span className="text-[10px] font-extrabold uppercase tracking-axal-label text-axal-faint dark:text-gray-500">Webinar</span>
        <span className="flex items-center gap-1.5">
          {registered && phase !== 'past' && phase !== 'cancelled' && <Pill tone="info">Registered</Pill>}
          <Pill tone={pill.tone} dot={pill.dot}>{pill.label}</Pill>
        </span>
      </div>
      <div className="space-y-3 p-4">
        <h2 className="text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{webinar?.title || 'Untitled webinar'}</h2>
        <p className="text-[12.5px] tabular-nums text-axal-muted dark:text-gray-400" data-testid="text-webinar-when">
          {formatWhen(webinar?.starts_at, webinar?.timezone) || <Unrecorded>Start time not recorded</Unrecorded>}
          {length && <> · {length}</>}
        </p>
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="text-webinar-host">
          Host {webinar?.host_name || <Unrecorded>not recorded</Unrecorded>}
          {' · '}capacity {hasCapacity ? capacity : <Unrecorded>not recorded</Unrecorded>}
          {' · '}{hasCount ? `${count} registered` : <Unrecorded>registrations not recorded</Unrecorded>}
        </p>
        {webinar?.abstract && <p className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">{webinar.abstract}</p>}
        <WebinarActions
          phase={phase} registered={registered} full={full} canJoin={canJoin} joinUrl={webinar?.join_url}
          icsHref={icsHref} recordingHref={recordingHref} onRegister={onRegister} onUnregister={onUnregister} busy={busy}
        />
        {phase === 'past' && registration?.attended != null && (
          <p className="text-[12px] text-axal-muted dark:text-gray-400">{registration.attended ? 'You attended.' : 'You were registered and did not attend.'}</p>
        )}
        {registered && registration?.registered_at && (
          <p className="text-[11.5px] text-axal-faint dark:text-gray-500">Registered {formatDay(registration.registered_at)}</p>
        )}
      </div>
    </Card>
  );
}

/** The one line under the actions: where the join link is, and when it comes. */
export function joinNote({ phase, registered, canJoin }) {
  if (canJoin) return 'Joining opens the host’s room in a new tab.';
  if (!registered) return phase === 'live' ? 'Register to receive the join link.' : 'Register to receive the join link, 15 minutes before the start.';
  return phase === 'live' ? 'No join link has been sent for this webinar.' : 'The join link appears here 15 minutes before the start.';
}

function WebinarActions({ phase, registered, full, canJoin, joinUrl, icsHref, recordingHref, onRegister, onUnregister, busy }) {
  if (phase === 'cancelled') {
    return <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="text-webinar-note">This webinar was cancelled.</p>;
  }
  if (phase === 'past') {
    return recordingHref ? (
      <Link to={recordingHref} className={SECONDARY} data-testid="link-webinar-recording">
        <Video size={14} aria-hidden="true" /> Watch the recording
      </Link>
    ) : (
      <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="text-webinar-note">Recording not available.</p>
    );
  }
  const register = !registered && (
    <button
      type="button"
      className={PRIMARY}
      onClick={onRegister}
      disabled={!onRegister || full || busy}
      title={!onRegister ? 'Registration opens when webinars are live.' : full ? 'This webinar is full.' : undefined}
      data-testid="button-webinar-register"
    >
      {full ? 'Full' : busy ? 'Registering…' : 'Register'}
    </button>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {canJoin && (
          <a href={joinUrl} target="_blank" rel="noopener noreferrer" className={PRIMARY} data-testid="link-webinar-join">
            <ExternalLink size={14} aria-hidden="true" /> Join
          </a>
        )}
        {register}
        {icsHref && (
          <a href={icsHref} download className={SECONDARY} data-testid="link-webinar-ics">
            <CalendarPlus size={14} aria-hidden="true" /> Add to calendar
          </a>
        )}
        {registered && phase === 'upcoming' && onUnregister && (
          <button type="button" className={SECONDARY} onClick={onUnregister} disabled={busy} data-testid="button-webinar-unregister">Unregister</button>
        )}
      </div>
      <p className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="text-webinar-note">
        {joinNote({ phase, registered, canJoin })}
      </p>
    </div>
  );
}
