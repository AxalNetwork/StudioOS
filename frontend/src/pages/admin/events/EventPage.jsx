import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminEvents, events as eventsApi } from '../../../lib/api';
import { Unreadable, Unrecorded, actionDanger, actionGhost } from '../../../ui';
import {
  GONE, HISTORY_REST, ROSTER_LINE, agendaRows, analyticsJoin, capacitySavedLine, countsFor, dateLabel, eventTiles,
  isEventId, onPublicCalendar, publishGate, refusalText, titleOf, visibilityWord, whenLine,
} from './eventsDeskModel';
import { CancelDialog, CapacityDialog, FeatureDialog, UnpublishDialog } from './EventDialogs';
import { CARD, Card, Done, EYE, LINK, Pill, StatusPill, SUB } from './parts';

/**
 * D915 (#2368) — one event (EV7), at `/admin/events/:id`, inside the desk's
 * frame. R3 gives the event; R2's row gives its counts under Guard G; R5 gives
 * the agenda. Each block answers alone. The roster is not read: names and
 * emails stay on the host's roster, one link away. The charts, the count cards
 * (payments, free seats, invitations, sources) and the rest of the history
 * wait for D915 parts 3 and 7.
 */

const GATE_TONE = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  wait: 'text-amber-800 dark:text-amber-300',
  muted: 'text-axal-muted dark:text-gray-400',
  last: 'font-bold text-axal-ink dark:text-gray-100',
};
const GATE_MARK = { ok: '✓', wait: '◷', muted: '·', last: '→' };

function Menu({ ev }) {
  const [open, setOpen] = useState(false);
  const item = 'block rounded-[7px] px-2.5 py-2 text-[13px] font-semibold text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800';
  return (
    <div className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={open} aria-label="More actions"
        onClick={() => setOpen((o) => !o)} className={`${actionGhost} min-w-[36px]`} data-testid="events-event-menu">⋯</button>
      {open ? (
        <div className={`${CARD} absolute right-0 top-11 z-10 flex w-[240px] flex-col gap-0.5 p-1.5 shadow-[0_12px_30px_rgba(24,24,27,.14)]`} data-testid="events-event-menu-list">
          <Link to={`/events/${ev.id}/manage`} className={item}>Open as host</Link>
          <a href={eventsApi.exportUrl(ev.id)} download className={item}>Download roster (CSV)</a>
          {onPublicCalendar(ev) && ev.slug ? <Link to={`/events/${encodeURIComponent(ev.slug)}`} className={item}>Open public page</Link> : null}
          <a href={eventsApi.icsUrl(ev.id)} download className={item}>Add to calendar</a>
        </div>
      ) : null}
    </div>
  );
}

function Gate({ ev }) {
  return (
    <div className={`${CARD} flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-3 py-2.5`} data-testid="events-event-gate">
      {publishGate(ev).map((s) => (
        <span key={s.text} className={`text-[12.5px] font-semibold ${GATE_TONE[s.tone]}`}>
          <span aria-hidden="true">{GATE_MARK[s.tone]} </span>{s.text}
        </span>
      ))}
    </div>
  );
}

export default function EventPage({ id, reads, now }) {
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [done, setDone] = useState(null);

  if (!isEventId(id)) return <EventGone />;
  if (reads.event.status === 'loading') return <p className="m-0 font-mono text-[12px] text-axal-muted dark:text-gray-400">Reading…</p>;
  if (reads.event.status === 'error') {
    if (Number(reads.event.error?.status) === 404) return <EventGone />;
    return <Unreadable what="This event" claim="That is not a claim that it no longer exists." onRetry={reads.reload} />;
  }
  const ev = reads.event.data?.event;
  if (!ev || typeof ev !== 'object') return <Unreadable what="This event" claim="The answer held no event." onRetry={reads.reload} />;

  const counts = countsFor(analyticsJoin(reads.analytics, 1), ev.id);
  const agenda = reads.agenda.status === 'ready' ? agendaRows(reads.agenda.data, ev) : null;
  const close = () => { if (!busy) { setDialog(null); setRefusal(null); } };

  const run = async (write, line) => {
    setBusy(true); setRefusal(null);
    try {
      const reply = await write();
      setDone(typeof line === 'function' ? line(reply) : line);
      setDialog(null);
      reads.reload();
    } catch (e) {
      setRefusal(refusalText(e));
    } finally {
      setBusy(false);
    }
  };

  const title = titleOf(ev);
  return (
    <div className="flex flex-col gap-3.5" data-testid="events-event">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="m-0 text-[24px] font-extrabold leading-tight tracking-[-.02em] text-axal-ink dark:text-gray-100">{title}</h1>
            <span className="flex flex-wrap gap-1.5">
              <StatusPill status={ev.status} />
              <Pill>{visibilityWord(ev.visibility)}</Pill>
              {ev.featured ? <Pill tone="violet">★ Featured</Pill> : null}
            </span>
            <p className="m-0 text-[13px] leading-normal text-axal-muted dark:text-gray-400">{whenLine(ev)}</p>
            <p className="m-0 text-[13px] leading-normal text-axal-muted dark:text-gray-400">
              {String(ev.location_text || '').trim() || <Unrecorded>Place not recorded</Unrecorded>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" data-testid="events-event-actions">
            <button type="button" className={actionGhost} onClick={() => setDialog('capacity')}>Change capacity</button>
            <button type="button" className={actionGhost} onClick={() => setDialog('feature')}>{ev.featured ? 'Stop featuring' : 'Feature'}</button>
            {ev.status === 'published' ? <button type="button" className={actionGhost} onClick={() => setDialog('unpublish')}>Unpublish</button> : null}
            {ev.status !== 'cancelled' ? <button type="button" className={actionDanger} onClick={() => setDialog('cancel')}>Cancel event</button> : null}
            <Menu ev={ev} />
          </div>
        </div>
        <Gate ev={ev} />
        {done ? <Done><span>{done}</span></Done> : null}
      </header>

      {counts.state === 'unreadable' ? <Unreadable what="Seat counts" claim={counts.reason} onRetry={reads.reload} /> : null}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5" data-testid="events-event-tiles">
        {eventTiles(ev, counts, now).map((t) => (
          <div key={t.key} className={`${CARD} flex min-w-0 flex-col gap-1.5 px-4 py-3.5`} data-testid={`events-event-tile-${t.key}`}>
            <span className={EYE}>{t.label}</span>
            <span className={t.words
              ? 'text-[15px] font-bold leading-snug text-axal-muted dark:text-gray-400'
              : 'font-mono text-[24px] font-medium tracking-[-.02em] text-axal-ink dark:text-gray-100'}>{t.value}</span>
            {t.sub ? <span className={SUB}>{t.sub}</span> : null}
          </div>
        ))}
      </div>

      <p className="m-0 flex flex-wrap items-center gap-2.5 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="events-event-roster">
        {ROSTER_LINE}
        <Link to={`/events/${ev.id}/manage/registrations`} className={LINK}>Open roster as host</Link>
      </p>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Card title="Agenda" testId="events-event-agenda">
          {reads.agenda.status === 'loading' ? <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">Reading…</span> : null}
          {reads.agenda.status === 'error' || (reads.agenda.status === 'ready' && !agenda)
            ? <Unreadable what="The agenda" claim="That is not a claim that it has no items." onRetry={reads.reload} /> : null}
          {agenda && !agenda.length ? <p className={`m-0 ${SUB}`}>No agenda yet.</p> : null}
          {agenda && agenda.length ? (
            <ol className="m-0 flex list-none flex-col p-0">
              {agenda.map((it) => (
                <li key={it.id} className="flex gap-3 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-700">
                  <span className="w-[44px] flex-none font-mono text-[12px] font-bold text-axal-ink dark:text-gray-100">{it.time || <Unrecorded>No time</Unrecorded>}</span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{it.title}</span>
                    {it.who || it.where ? <span className={SUB}>{[it.who, it.where].filter(Boolean).join(' · ')}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          <Link to={`/events/${ev.id}/manage/agenda`} className={`${LINK} self-start`}>Edit as host ›</Link>
        </Card>
        <Card title="History" testId="events-event-history">
          <p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{`Created · ${dateLabel(ev.created_at)}`}</p>
          <span className="text-[12.5px]"><Unrecorded reason={HISTORY_REST.reason}>{HISTORY_REST.text}</Unrecorded></span>
        </Card>
      </div>

      {dialog === 'capacity' ? (
        <CapacityDialog ev={ev} counts={counts} busy={busy} refusal={refusal} onClose={close}
          onConfirm={(value) => run(() => adminEvents.setCapacity(ev.id, value), (reply) => capacitySavedLine(reply?.promoted))} />
      ) : null}
      {dialog === 'feature' ? (
        <FeatureDialog ev={ev} busy={busy} refusal={refusal} onClose={close}
          onConfirm={(next) => run(() => adminEvents.feature(ev.id, next), next ? `${title} is featured.` : `${title} is no longer featured.`)} />
      ) : null}
      {dialog === 'unpublish' ? (
        <UnpublishDialog ev={ev} busy={busy} refusal={refusal} onClose={close}
          onConfirm={() => run(() => adminEvents.unpublish(ev.id), `${title} is back with its host as a draft.`)} />
      ) : null}
      {dialog === 'cancel' ? (
        <CancelDialog ev={ev} busy={busy} refusal={refusal} onClose={close}
          onConfirm={() => run(() => adminEvents.cancel(ev.id), `${title} is cancelled.`)} />
      ) : null}
    </div>
  );
}

function EventGone() {
  return (
    <div className={`${CARD} flex flex-col items-start gap-2.5 p-6`} data-testid="events-event-gone">
      <span className="text-[15px] font-extrabold text-axal-ink dark:text-gray-100">{GONE}</span>
      <Link to="/admin/events/all" className={LINK}>All events</Link>
    </div>
  );
}
