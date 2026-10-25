import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminEvents, events as eventsApi } from '../../../lib/api';
import { EVENT_TYPES } from '../../../lib/eventTypes.js';
import { HBars, RunningTotal, Unreadable, Unrecorded, actionDanger, actionGhost } from '../../../ui';
import {
  GONE, READING, ROSTER_LINE, SEATS_CHART_LABEL, agendaRows, analyticsJoin, capacitySavedLine, countsFor, dateLabel, eventTiles,
  formatWord, funnelOf, historyRows, hostLine, invitationRows, isEventId, onPublicCalendar, paymentRows, publishGate, refusalText,
  registrantRows, reminderRows, seatsSeries, summaryBlock, summaryTiles, titleOf, typeWord, visibilityWord, whenLine,
} from './eventsDeskModel';
import { CancelDialog, CapacityDialog, FeatureDialog, UnpublishDialog } from './EventDialogs';
import { CARD, Card, Done, EYE, LINK, Pill, StatusPill, SUB } from './parts';

/**
 * D915 (#2368) — one event (EV7), at `/admin/events/:id`, inside the desk's
 * frame. R3 gives the event; R2's row gives its counts under Guard G; R5 gives
 * the agenda. Each block answers alone. The roster is not read: names and
 * emails stay on the host's roster, one link away.
 *
 * D922 (#2705) completes it from part 3's two reads (D918): the summary gives
 * the host line, the second row of tiles, both charts, who registered, the
 * invitations, the payments and the reminders, block by block; the history
 * gives the history. Every figure is a count; a block that failed says so with
 * Try again and the rest still draw (EV15a).
 */

/** A block's loading and failed states, so each card draws its own (EV15a). */
function BlockState({ block, what, onRetry, children }) {
  if (block.state === 'loading') return <span className="font-mono text-[12px] text-axal-muted dark:text-gray-400">{READING}</span>;
  if (block.state !== 'ready') return <Unreadable what={what} claim="That is not the same as none." onRetry={onRetry} />;
  return children;
}

/** A row of a figure and its label; a value nothing records carries its reason as a line. */
function FigureRow({ label, value, reason, unrecorded, testId }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-700" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-axal-ink dark:text-gray-100">{label}</span>
        {unrecorded
          ? <span className="font-mono text-[10.5px] font-bold uppercase tracking-[.05em] text-axal-muted dark:text-gray-400"><Unrecorded>{value}</Unrecorded></span>
          : <span className="font-mono text-[13px] font-semibold text-axal-ink dark:text-gray-100">{value}</span>}
      </div>
      {reason ? <span className={SUB}>{reason}</span> : null}
    </div>
  );
}

const GATE_TONE = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  wait: 'text-amber-800 dark:text-amber-300',
  muted: 'text-axal-muted dark:text-gray-400',
  last: 'font-bold text-axal-ink dark:text-gray-100',
};
const GATE_MARK = { ok: '✓', wait: '◷', muted: '·', last: '→' };

/**
 * "More actions": a disclosure, not an ARIA menu, because its items are plain
 * links. Escape, a click outside and focus moving out close it; Escape and
 * picking an item put focus back on ⋯. The list hangs from the actions row
 * (`relative` there), never from ⋯, so on a phone, where ⋯ wraps to the left,
 * it stays inside the gutters.
 */
function Menu({ ev }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const button = useRef(null);
  const listId = useId();
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus?.(); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const pick = () => { setOpen(false); button.current?.focus?.(); };
  const leave = (e) => { if (e.relatedTarget && wrap.current && !wrap.current.contains(e.relatedTarget)) setOpen(false); };
  const item = 'block rounded-[7px] px-2.5 py-2 text-[13px] font-semibold text-axal-ink hover:bg-axal-ground dark:text-gray-100 dark:hover:bg-gray-800';
  return (
    <div ref={wrap} onBlur={leave}>
      <button ref={button} type="button" aria-expanded={open} aria-controls={listId} aria-label="More actions"
        onClick={() => setOpen((o) => !o)} className={`${actionGhost} min-w-[36px]`} data-testid="events-event-menu">⋯</button>
      {open ? (
        <div id={listId} className={`${CARD} absolute right-0 top-full z-10 mt-1.5 flex w-[240px] max-w-full flex-col gap-0.5 p-1.5 shadow-[0_12px_30px_rgba(24,24,27,.14)]`} data-testid="events-event-menu-list">
          <Link to={`/events/${ev.id}/manage`} className={item} onClick={pick}>Open as host</Link>
          <a href={eventsApi.exportUrl(ev.id)} download className={item} onClick={pick} data-testid="events-event-menu-roster">Download roster (CSV)</a>
          {onPublicCalendar(ev) && ev.slug ? <Link to={`/events/${encodeURIComponent(ev.slug)}`} className={item} onClick={pick}>Open public page</Link> : null}
          <a href={eventsApi.icsUrl(ev.id)} download className={item} onClick={pick}>Add to calendar</a>
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
  // `{ line, at }`: a fresh object per write, so focus moves to the line every time.
  const [done, setDone] = useState(null);
  const doneRef = useRef(null);
  useEffect(() => { if (done) doneRef.current?.focus?.(); }, [done]);

  if (!isEventId(id)) return <EventGone />;
  if (reads.event.status === 'loading') return <p className="m-0 font-mono text-[12px] text-axal-muted dark:text-gray-400">Reading…</p>;
  if (reads.event.status === 'error') {
    if (Number(reads.event.error?.status) === 404) return <EventGone />;
    return <Unreadable what="This event" claim="That is not a claim that it no longer exists." onRetry={reads.reload} />;
  }
  const ev = reads.event.data?.event;
  if (!ev || typeof ev !== 'object') return <Unreadable what="This event" claim="The answer held no event." onRetry={reads.reload} />;

  const counts = countsFor(analyticsJoin(reads.analytics, 1), ev.id);
  const block = (key) => summaryBlock(reads.summary, key);
  const host = hostLine(block('host'));
  const type = typeWord(ev, EVENT_TYPES);
  const format = formatWord(ev);
  const seats = seatsSeries(block('seats_by_day'), ev, now);
  const funnel = funnelOf(block('registrations'), ev, now);
  const who = registrantRows(block('by_role'), block('by_source'));
  const invites = invitationRows(block('invitations'));
  const pays = paymentRows(block('payments'));
  const reminders = reminderRows(block('reminders'), ev, now);
  const history = historyRows(reads.history);
  const agenda = reads.agenda.status === 'ready' ? agendaRows(reads.agenda.data, ev) : null;
  const close = () => { if (!busy) { setDialog(null); setRefusal(null); } };
  // The Worker checks no status, so the actions wait for a read newer than the last write.
  const settling = Boolean(done) && (reads.event.at || 0) < done.at;

  const run = async (write, line) => {
    setBusy(true); setRefusal(null);
    try {
      const reply = await write();
      setDone({ line: typeof line === 'function' ? line(reply) : line, at: Date.now() });
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
              {type ? <Pill tone="violet">{type}</Pill> : null}
              {ev.featured ? <Pill tone="violet">★ Featured</Pill> : null}
            </span>
            {host ? (
              <p className="m-0 text-[13px] font-semibold leading-normal text-axal-ink dark:text-gray-100" data-testid="events-event-host">
                {host.recorded ? host.text : <Unrecorded>{host.text}</Unrecorded>}
              </p>
            ) : null}
            {block('host').state === 'unreadable' ? <Unreadable what="The host" claim="That is not a claim that it has none." onRetry={reads.reload} /> : null}
            <p className="m-0 text-[13px] leading-normal text-axal-muted dark:text-gray-400">{whenLine(ev)}</p>
            <p className="m-0 text-[13px] leading-normal text-axal-muted dark:text-gray-400" data-testid="events-event-place">
              {format ? `${format} · ` : null}
              {String(ev.location_text || '').trim() || <Unrecorded>Place not recorded</Unrecorded>}
            </p>
          </div>
          <div className="relative flex flex-wrap items-center gap-2" data-testid="events-event-actions">
            <button type="button" className={actionGhost} disabled={settling} onClick={() => setDialog('capacity')}>Change capacity</button>
            <button type="button" className={actionGhost} disabled={settling} onClick={() => setDialog('feature')}>{ev.featured ? 'Stop featuring' : 'Feature'}</button>
            {ev.status === 'published' ? <button type="button" className={actionGhost} disabled={settling} onClick={() => setDialog('unpublish')}>Unpublish</button> : null}
            {ev.status !== 'cancelled' ? <button type="button" className={actionDanger} disabled={settling} onClick={() => setDialog('cancel')}>Cancel event</button> : null}
            <Menu ev={ev} />
          </div>
        </div>
        <Gate ev={ev} />
        {done ? <Done focusRef={doneRef}><span>{done.line}</span></Done> : null}
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

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3" data-testid="events-event-tiles-2">
        {summaryTiles(reads.summary).map((t) => (
          <div key={t.key} className={`${CARD} flex min-w-0 flex-col gap-1.5 px-4 py-3.5`} data-testid={`events-event-tile-${t.key}`}>
            <span className={EYE}>{t.label}</span>
            {t.failed ? <Unreadable what={t.label} claim="That is not the same as none." onRetry={reads.reload} /> : (
              <>
                <span className={t.words
                  ? 'text-[15px] font-bold leading-snug text-axal-muted dark:text-gray-400'
                  : 'font-mono text-[24px] font-medium tracking-[-.02em] text-axal-ink dark:text-gray-100'}>{t.value}</span>
                {t.sub ? <span className={SUB}>{t.sub}</span> : null}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <Card title="Seats taken over time" testId="events-event-seats">
          <BlockState block={block('seats_by_day')} what="Seats over time" onRetry={reads.reload}>
            {seats ? (
              <>
                <span className={SUB}>{SEATS_CHART_LABEL}</span>
                {seats.points.length ? (
                  <div role="img" aria-label={seats.alt}>
                    <RunningTotal points={seats.points.map((p) => ({ label: dateLabel(p.day).replace(/ \d{4}$/, ''), value: p.total }))}
                      capacity={seats.capacity} today={seats.todayAfter ? 'after' : seats.today ? seats.points.findIndex((p) => p.day >= seats.today) : null} />
                  </div>
                ) : <p className={`m-0 ${SUB}`}>{seats.alt}</p>}
                {seats.undated ? <span className={SUB}>{`${seats.undated} seat holder${seats.undated === 1 ? ' has' : 's have'} no registration date and ${seats.undated === 1 ? 'is' : 'are'} not drawn.`}</span> : null}
              </>
            ) : null}
          </BlockState>
        </Card>
        <Card title="From sign-up to the door" testId="events-event-funnel">
          <BlockState block={block('registrations')} what="The registrations" onRetry={reads.reload}>
            {funnel ? (
              <>
                <div role="img" aria-label={funnel.steps.map((st) => `${st.label} ${st.text || st.value}`).join(', ')}>
                  <HBars rows={funnel.steps.map((st) => ({ label: st.label, value: st.value, text: st.text, dash: st.dash }))} testIdPrefix="events-funnel" />
                </div>
                <span className="flex flex-wrap gap-1.5" data-testid="events-event-funnel-beside">
                  {funnel.beside.map((b) => <Pill key={b.key}>{`${b.label} ${b.value}`}</Pill>)}
                </span>
                <span className={SUB}>Confirmed counts everyone confirmed, including those who attended.</span>
              </>
            ) : null}
          </BlockState>
        </Card>
      </div>

      <div className="grid gap-3.5 lg:grid-cols-3">
        <Card title="Who registered" testId="events-event-who">
          <span className={SUB}>Seats by profile and by how the seat was got.</span>
          <BlockState block={block('by_role')} what="Who registered" onRetry={reads.reload}>
            {who.profile ? <HBars rows={who.profile.map((r) => ({ label: r.label, value: r.value }))} testIdPrefix="events-who-profile" /> : null}
          </BlockState>
          <span className={EYE}>How the seat was got</span>
          <BlockState block={block('by_source')} what="How seats were got" onRetry={reads.reload}>
            {who.source ? <HBars rows={who.source.map((r) => ({ label: r.label, value: r.value }))} testIdPrefix="events-who-source" /> : null}
            {who.added ? <FigureRow label="Added by an admin" value="Not recorded" reason={who.added} unrecorded testId="events-who-added" /> : null}
          </BlockState>
        </Card>
        <Card title="Invitations" testId="events-event-invitations">
          <BlockState block={block('invitations')} what="The invitations" onRetry={reads.reload}>
            {invites ? (
              <div className="flex flex-col">
                <span className={EYE}>By status</span>
                {invites.status.map((r) => <FigureRow key={r.key} label={r.label} value={r.value} testId={`events-invite-${r.key}`} />)}
                <span className={`${EYE} pt-2`}>By source</span>
                {invites.source.map((r) => <FigureRow key={r.key} label={r.label} value={r.value} testId={`events-invite-src-${r.key}`} />)}
              </div>
            ) : null}
          </BlockState>
        </Card>
        <div className="flex flex-col gap-3.5">
          <Card title="Payments" testId="events-event-payments">
            <BlockState block={block('payments')} what="Ticket payments" onRetry={reads.reload}>
              {pays ? <div className="flex flex-col">{pays.map((r) => <FigureRow key={r.key} {...r} testId={`events-pay-${r.key}`} />)}</div> : null}
            </BlockState>
          </Card>
          <Card title="Reminders" testId="events-event-reminders">
            <BlockState block={block('reminders')} what="The reminders" onRetry={reads.reload}>
              {reminders ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {reminders.map((r) => (
                    <li key={r.key} className="flex gap-2 text-[13px]" data-testid={`events-reminder-${r.key}`}>
                      <span aria-hidden="true" className={r.sent ? 'font-extrabold text-emerald-700 dark:text-emerald-400' : 'text-axal-muted dark:text-gray-400'}>{r.sent ? '✓' : '◷'}</span>
                      <span className="flex flex-col"><span className="font-semibold text-axal-ink dark:text-gray-100">{r.label}</span><span className={SUB}>{r.line}</span></span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </BlockState>
          </Card>
        </div>
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
          <BlockState block={history} what="The history" onRetry={reads.reload}>
            {history.rows ? (
              <ol className="m-0 flex list-none flex-col gap-1 p-0">
                {history.rows.map((r) => (
                  <li key={r.key} className={`flex flex-col gap-0.5 rounded-[8px] py-1.5 text-[13px] ${r.amber ? 'border border-amber-300 bg-amber-50 px-2.5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'text-axal-ink dark:text-gray-100'}`}
                    data-testid={`events-history-${r.key}`}>
                    <span className="font-semibold">{r.amber ? <span aria-hidden="true">↻ </span> : null}{r.text}</span>
                    <span className={r.amber ? 'text-[12px]' : SUB}>{r.date}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </BlockState>
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
          onConfirm={(note) => run(() => adminEvents.unpublish(ev.id, note), `${title} is back with its host as a draft. The host is told${note ? ', with your note' : ''}.`)} />
      ) : null}
      {dialog === 'cancel' ? (
        <CancelDialog ev={ev} payments={block('payments')} busy={busy} refusal={refusal} onClose={close}
          onConfirm={(note) => run(() => adminEvents.cancel(ev.id, note), `${title} is cancelled.`)} />
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
