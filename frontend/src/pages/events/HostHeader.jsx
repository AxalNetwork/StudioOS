// D1036 (#2877, part 6 of #2387) — the host pages' shared header (MEV12a) on
// /events/:id/edit and /events/:id/manage*, and /events/new's own (MEV12b).
// The tabs are written out one by one, each a literal link, so the
// reachability walk finds every door; Check-in is a tab only on the event's day.
import React from 'react';
import { Link } from 'react-router-dom';
import { NEW_EVENT_LINE, gateLine, onEventDay, pillsOf, primaryOf, whenLine } from './hostHeaderModel';

const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
const TONES = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
  bad: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  muted: 'border-axal-hairline bg-axal-ground text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
};
const PRIMARY = 'inline-flex min-h-[34px] items-center justify-center rounded-[9px] border border-violet-600 bg-violet-600 px-3.5 text-[13px] font-bold text-white hover:bg-violet-700 disabled:opacity-50';
const SECONDARY = 'inline-flex min-h-[34px] items-center justify-center rounded-[9px] border border-axal-hairline bg-white px-3.5 text-[13px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const TAB = 'inline-flex items-center gap-1.5 border-b-2 px-1 pb-2 text-[13px] font-semibold';
const tabClass = (on) => `${TAB} ${on ? 'border-violet-600 text-axal-ink dark:border-violet-400 dark:text-gray-100' : 'border-transparent text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`;
const current = (on) => (on ? 'page' : undefined);

function Pill({ tone = 'muted', children, testId }) {
  return <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${TONES[tone] || TONES.muted}`} data-testid={testId}>{children}</span>;
}

function Primary({ primary, onPublish, busy }) {
  if (!primary) return null;
  if (primary.kind === 'note') return <span className={`text-[12px] font-medium ${MUTED}`} data-testid="host-header-note">{primary.label}</span>;
  if (primary.kind === 'publish') {
    return <button type="button" className={PRIMARY} onClick={onPublish} disabled={busy} data-testid="event-publish">{primary.label}</button>;
  }
  return <Link className={PRIMARY} to={primary.to} data-testid="host-header-primary">{primary.label}</Link>;
}

/**
 * The header over an event's host pages. `pending` is Registrations' count:
 * a number, or null when the roster was not read (no number, never a 0).
 */
export default function HostHeader({ event, screen, pending, now = Date.now(), publishLabel = null, onPublish, busy = false }) {
  const id = event.id;
  const gate = gateLine(event);
  const checkIn = onEventDay(event, now);
  return (
    <header className="mb-5 flex flex-col gap-2.5" data-testid="host-header">
      <Link className={`${LINK} w-fit text-[12.5px]`} to="/my/events/hosting">‹ My events · Hosting</Link>
      <div className="flex flex-wrap items-start justify-between gap-3.5">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className={`m-0 text-[22px] font-extrabold tracking-[-.02em] ${INK}`}>{event.title || 'Untitled event'}</h1>
          <div className="flex flex-wrap gap-1.5">
            {pillsOf(event).map((p) => <Pill key={p.key} tone={p.tone} testId={`host-header-${p.key}`}>{p.text}</Pill>)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2"><Primary primary={primaryOf(event, { screen, now, publishLabel })} onPublish={onPublish} busy={busy} /></div>
      </div>
      <p className={`m-0 text-[13px] font-medium ${MUTED}`} data-testid="host-header-when">{whenLine(event, now)}</p>
      {gate ? (
        <p className={`m-0 flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-2 text-[12.5px] font-bold ${gate.tone === 'warn' ? TONES.warn : `border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900 ${INK}`}`} data-testid="host-header-gate">
          <span className={EYEBROW}>Publish gate</span>{gate.text}
        </p>
      ) : null}
      <nav aria-label={event.title || 'Event'} className="mt-1 flex flex-wrap gap-4 border-b border-axal-hairline dark:border-gray-800" data-testid="host-header-tabs">
        <Link className={tabClass(screen === 'details')} aria-current={current(screen === 'details')} to={`/events/${id}/edit`}>Details</Link>
        <Link className={tabClass(screen === 'eligibility')} aria-current={current(screen === 'eligibility')} to={`/events/${id}/manage`}>Who may register</Link>
        <Link className={tabClass(screen === 'registrations')} aria-current={current(screen === 'registrations')} to={`/events/${id}/manage/registrations`}>
          Registrations{typeof pending === 'number' ? <span className="rounded-full bg-violet-100 px-1.5 text-[11px] font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" title="Waiting for your decision" data-testid="host-header-pending">{pending.toLocaleString('en-US')}</span> : null}
        </Link>
        <Link className={tabClass(screen === 'agenda')} aria-current={current(screen === 'agenda')} to={`/events/${id}/manage/agenda`}>Agenda</Link>
        {checkIn ? <Link className={tabClass(screen === 'check-in')} aria-current={current(screen === 'check-in')} to={`/events/${id}/manage/check-in`}>Check-in</Link> : null}
      </nav>
    </header>
  );
}

/** `/events/new` (MEV12b): "‹ My events", "New event", Save draft and the visibility's own action, no tabs. */
export function NewEventHeader({ primaryLabel, onSaveDraft, onPrimary, busy = false }) {
  return (
    <header className="mb-5 flex flex-col gap-2.5" data-testid="host-header-new">
      <Link className={`${LINK} w-fit text-[12.5px]`} to="/my/events">‹ My events</Link>
      <div className="flex flex-wrap items-start justify-between gap-3.5">
        <h1 className={`m-0 text-[22px] font-extrabold tracking-[-.02em] ${INK}`}>New event</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={SECONDARY} onClick={onSaveDraft} disabled={busy} data-testid="event-save-draft">Save draft</button>
          {primaryLabel ? <button type="button" className={PRIMARY} onClick={onPrimary} disabled={busy} data-testid="event-publish">{primaryLabel}</button> : null}
        </div>
      </div>
      <p className={`m-0 text-[13px] font-medium ${MUTED}`}>{NEW_EVENT_LINE}</p>
    </header>
  );
}
