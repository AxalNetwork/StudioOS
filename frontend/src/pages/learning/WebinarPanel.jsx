import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, ExternalLink, Video } from 'lucide-react';
import { Card, Pill, Unrecorded } from '../../ui';
import { SectionCard, stateBlock } from './LearningStates';
import { NOT_LIVE, joinWindowOpen, parseInstant, webinarPhase } from './learningModel';
import {
  capacityLabel, formatWebinarDate, formatWebinarTime, formatWebinarWhen, ownZoneLine, seatsLeftLabel, seatsOf,
  webinarJoinNote, webinarLength,
} from './webinarModel';

const PHASE_PILL = {
  upcoming: { tone: 'info', label: 'Upcoming' },
  live: { tone: 'danger', label: 'Live', dot: true },
  past: { tone: 'neutral', label: 'Ended' },
  cancelled: { tone: 'danger', label: 'Cancelled' },
  draft: { tone: 'warn', label: 'Draft' },
  unknown: { tone: 'neutral', label: 'Time not recorded' },
};

const BUTTON = 'inline-flex items-center gap-1.5 rounded-axal-sm px-3 py-1.5 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const SECONDARY = `${BUTTON} border border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep hover:border-axal-violet/40 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300`;
const NOTE = 'text-[12.5px] text-axal-muted dark:text-gray-400';

/** The phases in which a member can still register, join or cancel: before the end. */
const OPEN = ['upcoming', 'live', 'unknown'];

/**
 * One webinar, in each of its states: upcoming, live, past, cancelled, and a
 * draft the Super Admin opens (D562; data D560, #1161).
 *
 * Props, in the shape `GET /api/learning/webinars/:uid` sends:
 *   status        'loading' | 'unreadable' | 'unrecorded' | 'ready'
 *   webinar       { uid, title, abstract, host_name, starts_at, ends_at, timezone,
 *                   capacity, registered_count, seats_left, status, phase,
 *                   recording_item_uid, join_url, join }
 *   registration  { registered, registered_at, attended } or null
 *   recording     the route's `recording`: { available: true, item_uid, href },
 *                 { available: false, reason }, or null before the end;
 *                 `recordingHref` is a link the caller resolved instead
 *   icsHref       the `.ics` download (`learningApi.webinarIcsHref`)
 *   now           the clock in ms, a prop so a test can stand anywhere in the window
 *   locale, timeZone  the viewer's own by default; a test pins them
 *   onRegister, onUnregister, busy
 *   actionError   a refusal, in the route's own words ("This webinar is full.")
 *
 * THE JOIN LINK IS THE SERVER'S TO SEND. D560 returns `join_url` only to a
 * registered member, from 15 minutes before the start to the end, and `join`
 * says why it is absent. This panel never builds one: it draws the link that
 * arrived, and only while the window is open now, so a link read earlier is
 * not offered once the webinar has ended.
 *
 * NULL CAPACITY IS NO LIMIT (D560), never zero seats. A capacity the route did
 * not send at all reads "not recorded".
 */
export default function WebinarPanel({
  status, webinar, registration, recording, now = Date.now(), locale, timeZone, icsHref, recordingHref,
  onRegister, onUnregister, busy = false, actionError = '', reason = NOT_LIVE.webinars, onRetry,
}) {
  const block = stateBlock({
    status, reason, onRetry,
    what: 'the webinar',
    claim: 'This is not a claim that the webinar does not exist.',
    isEmpty: !webinar,
    empty: { title: 'No such webinar', body: 'It does not exist, or it is not open to you.', cta: { label: 'All webinars', to: '/learning?tab=webinars' } },
  });
  if (block) return <SectionCard title="Webinar" testid="webinar-panel">{block}</SectionCard>;

  const phase = webinar?.status === 'draft' ? 'draft' : webinarPhase(webinar, now);
  const pill = PHASE_PILL[phase];
  const registered = Boolean(registration?.registered);
  const opts = { locale, timeZone };
  const seats = seatsOf(webinar);
  const length = webinarLength(webinar);
  const started = formatWebinarTime(webinar?.starts_at, opts);
  const ends = formatWebinarTime(webinar?.ends_at, opts);
  const when = phase === 'live' && started
    ? [`Started ${started}`, ends && `ends ${ends}`].filter(Boolean).join(' · ')
    : formatWebinarWhen(webinar?.starts_at, opts);
  const ownZone = ownZoneLine(webinar, opts);
  const capacity = capacityLabel(seats);
  const left = OPEN.includes(phase) ? seatsLeftLabel(seats) : null;
  const canJoin = registered && Boolean(webinar?.join_url) && joinWindowOpen(webinar, now);

  return (
    <Card padding="none" className="overflow-hidden" data-testid="webinar-panel" data-phase={phase}>
      <div className="flex items-center justify-between gap-3 border-b border-axal-hairline px-4 py-2.5 dark:border-gray-800">
        <span className="text-[10px] font-extrabold uppercase tracking-axal-label text-axal-faint dark:text-gray-500">Webinar</span>
        <span className="flex items-center gap-1.5">
          {registered && OPEN.includes(phase) && <Pill tone="info">Registered</Pill>}
          <Pill tone={pill.tone} dot={pill.dot}>{pill.label}</Pill>
        </span>
      </div>
      <div className="space-y-3 p-4">
        <h2 className="text-[16px] font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{webinar?.title || 'Untitled webinar'}</h2>
        <div className="space-y-0.5">
          <p className="text-[12.5px] tabular-nums text-axal-muted dark:text-gray-400" data-testid="text-webinar-when">
            {when || <Unrecorded>Start time not recorded</Unrecorded>}
            {phase !== 'live' && length && <> · {length}</>}
          </p>
          {ownZone && <p className="text-[11.5px] tabular-nums text-axal-faint dark:text-gray-500" data-testid="text-webinar-zone">{ownZone}</p>}
        </div>
        <p className="text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="text-webinar-host">
          Host {webinar?.host_name || <Unrecorded>not recorded</Unrecorded>}
          {' · '}{capacity || <Unrecorded>capacity not recorded</Unrecorded>}
          {' · '}{seats.count !== null ? `${seats.count} registered` : <Unrecorded>registrations not recorded</Unrecorded>}
          {left && <> · {left}</>}
        </p>
        {webinar?.abstract && <p className="whitespace-pre-line text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">{webinar.abstract}</p>}
        <WebinarActions
          phase={phase} webinar={webinar} registered={registered} full={seats.full} canJoin={canJoin} icsHref={icsHref}
          recording={recording} recordingHref={recordingHref} onRegister={onRegister} onUnregister={onUnregister} busy={busy}
        />
        {actionError && <p className="text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="text-webinar-refusal">{actionError}</p>}
        {phase === 'past' && registered && (
          <p className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="text-webinar-attended">
            {registration.attended === true || registration.attended === 1
              ? 'You attended.'
              : registration.attended === false || registration.attended === 0
                ? 'You were registered and did not attend.'
                : 'Your attendance is not recorded.'}
          </p>
        )}
        {registered && registration?.registered_at && (
          <p className="text-[11.5px] text-axal-faint dark:text-gray-500" data-testid="text-webinar-registered">Registered {formatWebinarDate(registration.registered_at, opts) || <Unrecorded>on a date not recorded</Unrecorded>}</p>
        )}
      </div>
    </Card>
  );
}

/**
 * The recording of a past webinar: the route's link when one is attached and
 * published, its reason when not. Only a path inside Learning is linked.
 */
function RecordingAction({ recording, recordingHref }) {
  const href = recording ? (recording.available ? recording.href : null) : recordingHref;
  if (typeof href === 'string' && href.startsWith('/learning/')) {
    return (
      <Link to={href} className={SECONDARY} data-testid="link-webinar-recording">
        <Video size={14} aria-hidden="true" /> Watch the recording
      </Link>
    );
  }
  return <p className={NOTE} data-testid="text-webinar-note">{(recording && recording.reason) || 'Recording not available.'}</p>;
}

function WebinarActions({ phase, webinar, registered, full, canJoin, icsHref, recording, recordingHref, onRegister, onUnregister, busy }) {
  if (phase === 'draft') {
    return <p className={NOTE} data-testid="text-webinar-note">This webinar is a draft. Members cannot see it until it is published.</p>;
  }
  if (phase === 'cancelled') {
    return <p className={NOTE} data-testid="text-webinar-note">This webinar was cancelled.</p>;
  }
  if (phase === 'past') return <RecordingAction recording={recording} recordingHref={recordingHref} />;
  const timed = Boolean(parseInstant(webinar?.starts_at) && parseInstant(webinar?.ends_at));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {canJoin && (
          <a href={webinar.join_url} target="_blank" rel="noopener noreferrer" className={PRIMARY} data-testid="link-webinar-join">
            <ExternalLink size={14} aria-hidden="true" /> Join
          </a>
        )}
        {!registered && (
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
        )}
        {icsHref && timed && (
          <a href={icsHref} download className={SECONDARY} data-testid="link-webinar-ics">
            <CalendarPlus size={14} aria-hidden="true" /> Add to calendar
          </a>
        )}
        {registered && onUnregister && (
          <button type="button" className={SECONDARY} onClick={onUnregister} disabled={busy} data-testid="button-webinar-unregister">
            {busy ? 'Cancelling…' : 'Cancel registration'}
          </button>
        )}
      </div>
      <p className="text-[12px] text-axal-muted dark:text-gray-400" data-testid="text-webinar-note">
        {webinarJoinNote({ webinar, phase, registered, canJoin })}
      </p>
    </div>
  );
}
