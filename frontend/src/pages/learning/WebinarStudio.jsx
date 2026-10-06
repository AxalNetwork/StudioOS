import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Unrecorded } from '../../ui';
import { titleCase } from '../../lib/absence';
import { LearningEmpty, LearningLoading, LearningUnreadable, SectionCard, stateBlock } from './LearningStates';
import { DANGER, ErrorLine, Field, INPUT, PRIMARY, SECONDARY, StatusPill } from './studioParts';
import { readStudioItems } from './studioActions';
import {
  WEBINAR_STATUS_NOTICE, attendanceCounts, capacityLabel, formatWebinarDate, formatWebinarDayTime, formatWebinarWhen,
  seatsOf, studioWebinarHref, viewerZone, webinarForm, webinarHref, zoneOptions,
} from './webinarModel';
import {
  attachRecording, markAttendance, readStudioWebinar, readStudioWebinars, saveWebinar, setWebinarStatus,
} from './webinarReads';
import useLearningRead from './useLearningRead';

/**
 * The Super Admin's webinars (D560, #1161; the canvas's "Webinar scheduler"):
 * schedule one, publish, unpublish or cancel it, attach its recording, and see
 * and record who attended. Every call is `/api/admin/learning/webinars…`,
 * which is `requireSuperAdmin` on the Worker, and every write answers with
 * the whole webinar and its registrations, which replace what is drawn.
 *
 * WHAT IS OPEN LIVES IN THE STUDIO'S URL: `?webinar=<uid>` or `?new=webinar`.
 * A refusal is shown in the route's own words beside what was being changed,
 * and only in the editor it was made in.
 */

const CONFIRM = 'flex flex-wrap items-center gap-2 rounded-axal-md border border-red-200 bg-red-50/60 px-3 py-2 dark:border-red-900 dark:bg-red-950/30';
const MARK = 'rounded-axal-sm border px-2.5 py-1 text-[12px] font-semibold disabled:cursor-not-allowed';
const MARK_ON = `${MARK} border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300`;
const MARK_OFF = `${MARK} border-axal-hairline text-axal-ink hover:border-axal-violet/40 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200`;
const NOTE = 'text-[12.5px] text-axal-muted dark:text-gray-400';

/** The sentence the Cancel button asks before it cancels. */
export function cancelQuestion(registered) {
  const n = Number(registered);
  const who = registered === null || registered === undefined || !Number.isFinite(n)
    ? 'Its registered members see it'
    : n === 0 ? 'Nobody has registered yet; members see it'
      : n === 1 ? 'Its one registered member sees it'
        : `Its ${n} registered members see it`;
  return `Cancel this webinar? ${who} marked as cancelled, and nobody can register or join. You can publish it again.`;
}

/**
 * Publish, unpublish and cancel, by the stored status: publish anything not
 * published (the route needs a start and an end), unpublish anything not a
 * draft, and cancel only a published webinar, as the route allows. Cancelling
 * asks first.
 */
export function WebinarStatusActions({ status, registeredCount, onStatus, busy = false }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-2" data-testid="studio-webinar-status">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-axal-muted dark:text-gray-400">Status</span>
        <StatusPill status={status} />
        {status !== 'published' && (
          <button type="button" className={PRIMARY} onClick={() => onStatus('publish')} disabled={busy} data-testid="button-webinar-publish">Publish</button>
        )}
        {status !== 'draft' && (
          <button type="button" className={SECONDARY} onClick={() => onStatus('unpublish')} disabled={busy} data-testid="button-webinar-unpublish">Unpublish</button>
        )}
        {status === 'published' && !confirming && (
          <button type="button" className={DANGER} onClick={() => setConfirming(true)} disabled={busy} data-testid="button-webinar-cancel">Cancel webinar</button>
        )}
      </div>
      {confirming && (
        <div className={CONFIRM} data-testid="studio-confirm-cancel">
          <span className="text-[12.5px] text-red-800 dark:text-red-200">{cancelQuestion(registeredCount)}</span>
          <button type="button" className={DANGER} onClick={() => { setConfirming(false); onStatus('cancel'); }} disabled={busy} data-testid="button-webinar-cancel-confirm">Yes, cancel it</button>
          <button type="button" className={SECONDARY} onClick={() => setConfirming(false)} data-testid="button-webinar-cancel-keep">Keep it</button>
        </div>
      )}
    </div>
  );
}

/**
 * The schedule: title, abstract, host, the date and start time on the chosen
 * zone's clock, the length, the capacity (empty is no limit), the join link
 * and the visibility. The page keys this form on the webinar, so opening
 * another one starts from its stored fields.
 */
export function WebinarScheduleForm({ webinar, zone, onSave, busy = false, error = '' }) {
  const [form, setForm] = useState(() => webinarForm(webinar, zone));
  const id = (name) => `studio-webinar-${name}`;
  const set = (name) => (event) => setForm((f) => ({ ...f, [name]: event.target.value }));
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => { event.preventDefault(); onSave?.(form); }}
      data-testid="form-studio-webinar"
    >
      <Field id={id('title')} label="Title" full>
        <input id={id('title')} className={INPUT} value={form.title} onChange={set('title')} data-testid="input-webinar-title" />
      </Field>
      <Field id={id('abstract')} label="Abstract" hint="What a member gets from it, on the webinar’s page." full>
        <textarea id={id('abstract')} rows={3} className={INPUT} value={form.abstract} onChange={set('abstract')} data-testid="input-webinar-abstract" />
      </Field>
      <Field id={id('host')} label="Host">
        <input id={id('host')} className={INPUT} value={form.host_name} onChange={set('host_name')} data-testid="input-webinar-host" />
      </Field>
      <Field id={id('visibility')} label="Visibility" hint="Program-only webinars stay hidden from members until a program can hold a webinar.">
        <select id={id('visibility')} className={INPUT} value={form.visibility} onChange={set('visibility')} data-testid="input-webinar-visibility">
          <option value="open">Open to every member</option>
          <option value="program">Program-only</option>
        </select>
      </Field>
      <Field id={id('date')} label="Date">
        <input id={id('date')} type="date" className={INPUT} value={form.date} onChange={set('date')} data-testid="input-webinar-date" />
      </Field>
      <Field id={id('time')} label="Start time">
        <input id={id('time')} type="time" className={INPUT} value={form.time} onChange={set('time')} data-testid="input-webinar-time" />
      </Field>
      <Field id={id('length')} label="Length" hint="Minutes. A webinar needs its start and length before it is published.">
        <input id={id('length')} className={INPUT} value={form.length} onChange={set('length')} inputMode="numeric" placeholder="60" data-testid="input-webinar-length" />
      </Field>
      <Field id={id('timezone')} label="Time zone" hint="The date and start time are read on this zone’s clock. Members see the time in their own zone, with this one beside it.">
        <input id={id('timezone')} list={id('zones')} className={INPUT} value={form.timezone} onChange={set('timezone')} placeholder="Europe/Zurich" data-testid="input-webinar-timezone" />
        <datalist id={id('zones')}>
          {zoneOptions().map((z) => <option key={z} value={z} />)}
        </datalist>
      </Field>
      <Field id={id('capacity')} label="Capacity" hint="Seats. Leave it empty for no limit.">
        <input id={id('capacity')} className={INPUT} value={form.capacity} onChange={set('capacity')} inputMode="numeric" data-testid="input-webinar-capacity" />
      </Field>
      <Field id={id('join')} label="Join link" hint="https. A registered member sees it from 15 minutes before the start until the end; it is never in a list or the calendar file.">
        <input id={id('join')} type="url" className={INPUT} value={form.join_url} onChange={set('join_url')} placeholder="https://…" data-testid="input-webinar-join-url" />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" className={PRIMARY} disabled={busy || !onSave} data-testid="button-webinar-save">
          {busy ? 'Saving…' : webinar ? 'Save changes' : 'Create draft'}
        </button>
      </div>
      <div className="sm:col-span-2"><ErrorLine error={error} testid="studio-webinar-error" /></div>
    </form>
  );
}

/**
 * The recording: a video item attached after the event. Members see it on the
 * webinar's page once it has ended, and only while the video is published;
 * until then the route says "Recording not available".
 *
 *   items   the studio's item list, as a read's state ({ status, rows })
 */
export function WebinarRecording({ webinar, items, onAttach, busy = false, error = '', onRetryItems }) {
  const [pick, setPick] = useState('');
  const current = webinar?.recording_item_uid || null;
  const rows = items?.status === 'ready' ? items.rows || [] : [];
  const videos = rows.filter((i) => i.kind === 'video' && i.status !== 'archived');
  const attached = current ? rows.find((i) => i.uid === current) : null;
  let picker;
  if (!items || items.status === 'loading' || items.status === 'idle') {
    picker = <LearningLoading rows={1} what="the videos" />;
  } else if (items.status !== 'ready') {
    picker = <LearningUnreadable what="The video list" claim="This is not a claim that there are no videos." onRetry={onRetryItems} />;
  } else if (!videos.length) {
    picker = (
      <p className={NOTE} data-testid="studio-webinar-no-video">
        No video to attach yet. <Link to="/learning/studio?new=video" className="font-semibold text-axal-violet-deep underline dark:text-violet-300">Add the recording as a video</Link>, then attach it here.
      </p>
    );
  } else {
    picker = (
      <div className="flex flex-wrap items-end gap-2">
        <Field id="studio-webinar-recording" label="Video">
          <select id="studio-webinar-recording" className={INPUT} value={pick} onChange={(e) => setPick(e.target.value)} data-testid="input-webinar-recording">
            <option value="">Choose a video…</option>
            {videos.map((v) => (
              <option key={v.uid} value={v.uid}>{v.title || 'Untitled video'}{v.status !== 'published' ? ` (${String(v.status || 'draft')})` : ''}</option>
            ))}
          </select>
        </Field>
        <button type="button" className={PRIMARY} onClick={() => onAttach?.(pick)} disabled={busy || !onAttach || !pick || pick === current} data-testid="button-webinar-attach">
          {current ? 'Replace' : 'Attach'}
        </button>
      </div>
    );
  }
  return (
    <SectionCard title="Recording" meta="attached after the event" testid="studio-webinar-recording">
      <div className="space-y-3">
        <p className={NOTE} data-testid="studio-webinar-recording-current">
          {current ? (
            <>
              Attached: <span className="font-semibold text-axal-ink dark:text-gray-100">{attached?.title || `item ${current}`}</span>
              {attached && attached.status !== 'published' && ` · ${titleCase(attached.status)}: members see “Recording not available” until it is published.`}
            </>
          ) : 'No recording attached. Once the webinar has ended, members see “Recording not available”.'}
        </p>
        {picker}
        {current && (
          <button type="button" className={SECONDARY} onClick={() => onAttach?.(null)} disabled={busy || !onAttach} data-testid="button-webinar-detach">Detach</button>
        )}
        <ErrorLine error={error} testid="studio-webinar-recording-error" />
      </div>
    </SectionCard>
  );
}

const MARKS = [
  { value: true, label: 'Attended', key: 'attended' },
  { value: false, label: 'Did not attend', key: 'absent' },
  { value: null, label: 'Not recorded', key: 'unrecorded' },
];

/**
 * Who registered, by name and uid (the route never sends an email), and
 * whether each attended: true, false, or not recorded, which is never
 * counted as absent.
 */
export function WebinarAttendance({ registrations, onMark, busy = false, error = '', locale, timeZone }) {
  const list = registrations || [];
  const counts = attendanceCounts(list);
  return (
    <SectionCard
      title="Registrations and attendance"
      meta={list.length ? `${counts.registered} registered · ${counts.attended} attended · ${counts.absent} did not attend · ${counts.unrecorded} not recorded` : null}
      testid="studio-webinar-attendance"
    >
      {list.length === 0 ? (
        <LearningEmpty title="No one has registered yet" body="Members who register appear here by name, for their attendance to be recorded after the webinar." />
      ) : (
        <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="studio-webinar-registrations">
          {list.map((r) => {
            const current = r.attended === true ? 'attended' : r.attended === false ? 'absent' : 'unrecorded';
            return (
              <li key={r.uid} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid={`registration-${r.uid}`}>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-axal-ink dark:text-gray-100">{r.name || <Unrecorded>Name not recorded</Unrecorded>}</span>
                  <span className="block text-[11.5px] tabular-nums text-axal-faint dark:text-gray-500">
                    Registered {formatWebinarDate(r.registered_at, { locale, timeZone }) || <Unrecorded>on a date not recorded</Unrecorded>}
                  </span>
                </span>
                <span role="group" aria-label={`Attendance: ${r.name || r.uid}`} className="inline-flex flex-wrap gap-1">
                  {MARKS.map((m) => {
                    const on = m.key === current;
                    return (
                      <button
                        key={m.key}
                        type="button"
                        aria-pressed={on}
                        className={on ? MARK_ON : MARK_OFF}
                        onClick={() => onMark?.(r.uid, m.value)}
                        disabled={busy || on || !onMark}
                        data-testid={`button-attendance-${r.uid}-${m.key}`}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <ErrorLine error={error} testid="studio-webinar-attendance-error" />
    </SectionCard>
  );
}

/**
 * One webinar's studio, drawn from props: the schedule and its status, the
 * recording and the attendance. `detail` is `{ webinar, registrations }`, the
 * shape every admin webinar route answers, or null to schedule a new one.
 * `said` is the studio's last word here: `{ where, error }` or `{ notice }`.
 */
export function WebinarEditor({ detail, items, handlers = {}, busy = false, said = {}, zone, locale, timeZone, onRetryItems }) {
  const webinar = detail?.webinar || null;
  const seats = seatsOf(webinar);
  const errorAt = (where) => (said?.where === where ? said.error || '' : '');
  const opts = { locale, timeZone };
  return (
    <div className="space-y-4" data-testid="studio-webinar">
      <SectionCard title={webinar ? 'Edit webinar' : 'New webinar'} meta={webinar ? `uid ${webinar.uid}` : 'scheduled as a draft'} testid="studio-webinar-editor">
        <div className="space-y-4">
          {said?.notice && <p className="text-[12.5px] text-emerald-700 dark:text-emerald-300" role="status" data-testid="studio-webinar-notice">{said.notice}</p>}
          {webinar && (
            <div className="space-y-2">
              <WebinarStatusActions status={webinar.status} registeredCount={webinar.registered_count} onStatus={(a) => handlers.onStatus?.(a)} busy={busy} />
              <ErrorLine error={errorAt('status')} testid="studio-webinar-status-error" />
              <p className={NOTE} data-testid="studio-webinar-summary">
                {formatWebinarWhen(webinar.starts_at, opts) || <Unrecorded>Start not recorded</Unrecorded>}
                {' · '}{capacityLabel(seats) || <Unrecorded>capacity not recorded</Unrecorded>}
                {' · '}{seats.count !== null ? `${seats.count} registered` : <Unrecorded>registrations not recorded</Unrecorded>}
                {' · '}
                <Link to={webinarHref(webinar.uid)} className="inline-flex items-center gap-1 font-semibold text-axal-violet-deep underline dark:text-violet-300" data-testid="link-webinar-member-page">
                  The member’s page <ExternalLink size={12} aria-hidden="true" />
                </Link>
              </p>
            </div>
          )}
          <WebinarScheduleForm webinar={webinar} zone={zone} onSave={handlers.onSave} busy={busy} error={errorAt('schedule')} />
        </div>
      </SectionCard>
      {webinar && (
        <WebinarRecording webinar={webinar} items={items} onAttach={handlers.onAttach} busy={busy} error={errorAt('recording')} onRetryItems={onRetryItems} />
      )}
      {webinar && (
        <WebinarAttendance registrations={detail.registrations} onMark={handlers.onMark} busy={busy} error={errorAt('attendance')} locale={locale} timeZone={timeZone} />
      )}
    </div>
  );
}

/**
 * The studio's webinar editor, `?webinar=<uid>` or `?new=webinar`: the
 * container. It reads the webinar (and, unless the studio passes its own, the
 * item list for the recording), makes each write, and draws what the route
 * answered. Scheduling a new one opens it at `?webinar=<uid>`.
 *
 *   uid       the webinar to open, or null to schedule one
 *   items     the studio's item read, when it has one ({ status, rows })
 *   onStored  called with the stored webinar after each write, for a list to update its row
 */
export default function WebinarStudio({ uid = null, items: sharedItems, onRetryItems, onStored }) {
  const [, setParams] = useSearchParams();
  const [detail, retryDetail, setDetail] = useLearningRead(() => readStudioWebinar(uid), [uid], { enabled: Boolean(uid), scope: 'studio-webinar' });
  const [ownItems, retryOwnItems] = useLearningRead(readStudioItems, [], { enabled: Boolean(uid) && !sharedItems, scope: 'studio-webinar-items' });
  const items = sharedItems || ownItems;
  const [busy, setBusy] = useState(false);
  // A refusal or a notice belongs to the webinar it was made on (`at`).
  const [said, setSaid] = useState(null);
  const target = uid ? `webinar:${uid}` : 'new:webinar';
  const here = said && said.at === target ? said : {};

  const run = async (where, write, done) => {
    setBusy(true);
    setSaid(null);
    try {
      done(await write());
    } catch (err) {
      setSaid({ at: target, where, error: err?.message || 'The studio could not save that.' });
    } finally {
      setBusy(false);
    }
  };
  const show = (next, notice) => {
    setDetail({ status: 'ready', ...next });
    onStored?.(next.webinar);
    setSaid(notice ? { at: target, notice } : null);
  };
  const handlers = {
    onSave: (form) => run('schedule', () => saveWebinar({ uid, form }), (next) => {
      if (uid) {
        show(next, 'Saved.');
        return;
      }
      onStored?.(next.webinar);
      setSaid({ at: `webinar:${next.webinar.uid}`, notice: 'Draft created.' });
      setParams(() => new URLSearchParams({ webinar: next.webinar.uid }));
    }),
    onStatus: (action) => run('status', () => setWebinarStatus(uid, action), (next) => show(next, WEBINAR_STATUS_NOTICE[action])),
    onAttach: (itemUid) => run('recording', () => attachRecording(uid, itemUid), (next) => show(next, itemUid ? 'Recording attached.' : 'Recording detached.')),
    onMark: (userUid, attended) => run('attendance', () => markAttendance(uid, userUid, attended), (next) => show(next, '')),
  };

  if (!uid) return <WebinarEditor key="new" detail={null} handlers={handlers} busy={busy} said={here} zone={viewerZone()} />;
  if (detail.status === 'loading' || detail.status === 'idle') return <LearningLoading what="the webinar" />;
  if (detail.status === 'unreadable') return <LearningUnreadable what="The webinar" claim="This is not a claim that it does not exist." onRetry={retryDetail} />;
  if (detail.status === 'missing') {
    return <SectionCard title="Not found" testid="studio-webinar-missing"><LearningEmpty title="No such webinar" body="No webinar has that uid." /></SectionCard>;
  }
  return (
    <WebinarEditor
      key={detail.webinar.uid}
      detail={detail}
      items={items}
      handlers={handlers}
      busy={busy}
      said={here}
      onRetryItems={sharedItems ? onRetryItems : retryOwnItems}
    />
  );
}

/**
 * Every webinar for the Super Admin, from `GET /api/admin/learning/webinars`:
 * the title (opening its editor), the status, the start in the viewer's zone,
 * the registrations against the capacity, and whether a recording is attached.
 */
export function WebinarStudioTable({ status, rows, onRetry, locale, timeZone }) {
  const all = rows || [];
  const block = stateBlock({
    status, onRetry,
    reason: 'Webinars are not live yet.',
    what: 'the webinar list',
    claim: 'This is not a claim that none has been scheduled.',
    isEmpty: all.length === 0,
    empty: { title: 'No webinar yet', body: 'A webinar starts as a draft; members see it once it is published.' },
  });
  const opts = { locale, timeZone };
  return (
    <SectionCard title="Webinars" meta={status === 'ready' && all.length ? `${all.length} webinar${all.length === 1 ? '' : 's'}, drafts included` : null} testid="studio-webinars">
      <div className="space-y-3">
        <Link to="/learning/studio?new=webinar" className={SECONDARY} data-testid="link-studio-new-webinar">New webinar</Link>
        {block || (
          <ul className="divide-y divide-axal-hairline dark:divide-gray-800" data-testid="studio-webinar-rows">
            {all.map((w) => {
              const seats = seatsOf(w);
              return (
                <li key={w.uid} className="grid grid-cols-2 gap-x-3 gap-y-1 py-2.5 text-[12.5px] sm:grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,0.9fr)_minmax(0,0.9fr)_8rem] sm:items-center" data-testid={`studio-webinar-row-${w.uid}`}>
                  <Link to={studioWebinarHref(w.uid)} className="col-span-2 font-semibold text-axal-ink hover:text-axal-violet-deep sm:col-span-1 dark:text-gray-100 dark:hover:text-violet-300" data-testid={`link-studio-webinar-${w.uid}`}>
                    {w.title || 'Untitled webinar'}
                  </Link>
                  <span><StatusPill status={w.status} /></span>
                  <span className="tabular-nums text-axal-muted dark:text-gray-400">{formatWebinarDayTime(w.starts_at, opts) || <Unrecorded>Start not recorded</Unrecorded>}</span>
                  <span className="text-axal-muted dark:text-gray-400">
                    {seats.count !== null ? `${seats.count} registered` : <Unrecorded>registrations not recorded</Unrecorded>}
                    {' · '}{capacityLabel(seats) || <Unrecorded>capacity not recorded</Unrecorded>}
                  </span>
                  <span className="text-axal-muted dark:text-gray-400">{w.recording_item_uid ? 'Recording attached' : 'No recording'}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

/** The studio's "Webinars" section, with its own read. */
export function WebinarStudioList() {
  const [state, retry] = useLearningRead(readStudioWebinars, [], { scope: 'studio-webinars' });
  const status = state.status === 'idle' ? 'loading' : state.status === 'missing' ? 'unreadable' : state.status;
  return <WebinarStudioTable status={status} rows={state.status === 'ready' ? state.rows : []} onRetry={retry} />;
}
