/**
 * D8732 (#8732) — the Advisor Studio's Today card, built to boards SAV00 to
 * SAV09 of `design/incoming/Studio Home Advisor Page.dc.html`.
 *
 * Each booked session is one link to its Calendar item drawer
 * (`/calendar/item/advisor_booking/<id>`), carrying `state.from` (where Close
 * goes back to), `state.focus` (the row to focus on return), `state.scroll`
 * and `state.today` (what Today read, for the drawer's dated fallback). An
 * open slot is not a link: it is a group with its own label, chip and one
 * action, Manage availability, so it never reads as a booking. The words are
 * in `advisorTodayView.js`; this file only draws them.
 */
import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { TILE } from '../studio/studioLayoutModel';
import { listNames } from './advisorToday';
import { returnOf, rowState, todayView, unavailableLine } from './advisorTodayView';

const scrollY = () => (typeof window !== 'undefined' && Number.isFinite(window.scrollY) ? window.scrollY : null);

function Chip({ glyph, word, tone, testId }) {
  return <span className={`att-chip att-chip--${tone}`} data-testid={testId}><span aria-hidden="true">{glyph}</span>{word}</span>;
}

function DayLine({ view }) {
  return (
    <p className="att-day" data-testid="advisor-today-day">
      <b>{view.day}</b>
      <span>{view.from}{view.zone ? ` · ${view.zone}` : ''}</span>
    </p>
  );
}

function StaleLine({ view, onRefresh }) {
  if (!view.stale) return null;
  return (
    <div className="att-note att-note--stale" role="status" data-testid="status-advisor-today-stale">
      <Chip glyph="◔" word={`Stale · read ${view.stale.ago}`} tone="wait" />
      <span>Bookings may have changed since {view.stale.since}.</span>
      {onRefresh && <button type="button" className="att-btn" onClick={onRefresh} data-testid="button-refresh-advisor-today"><RefreshCw size={13} aria-hidden="true" /> Refresh</button>}
    </div>
  );
}

function BookedRow({ row, from }) {
  const navigate = useNavigate();
  const body = (
    <>
      <span className="att-when"><b>{row.time}</b>{row.minutes != null && <span>{row.minutes} min</span>}</span>
      <span className="att-what"><b>{row.who}</b><span>{row.detail}</span></span>
      <Chip glyph={row.status.glyph} word={row.status.word} tone={row.status.tone} testId={`status-today-row-${row.id || 'unknown'}`} />
      <span className="att-act" aria-hidden="true">{row.action} ›</span>
    </>
  );
  if (!row.href) return <li className="att-row" data-state={row.state} data-testid="row-advisor-today-unlinked">{body}</li>;
  // A plain click keeps the link's own behaviour for a new tab; the state takes the scroll at the moment of the click.
  const open = (e) => {
    if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(row.href, { state: rowState(row, from, scrollY()) });
  };
  return (
    <li>
      <Link to={row.href} state={rowState(row, from)} onClick={open} className="att-row" data-state={row.state}
        aria-label={row.label} data-today-focus={row.focus} data-testid={`link-${row.focus}`}>
        {body}
      </Link>
    </li>
  );
}

function SlotRow({ slot }) {
  return (
    <li className="att-row att-row--slot" role="group" aria-label={slot.label} data-testid={`group-advisor-today-${slot.key}`}>
      <span className="att-when"><b>{slot.time}</b>{slot.minutes != null && <span>{slot.minutes} min</span>}</span>
      <span className="att-what"><b>Open slot</b><span>{slot.detail}</span></span>
      <Chip glyph="◌" word="Not booked" tone="slot" />
      <Link to={slot.href} className="att-slot-act" data-testid="link-advisor-today-manage-availability">Manage availability</Link>
    </li>
  );
}

function ReadLine({ view }) {
  return <p className="att-read" data-testid="advisor-today-read">{view.readLine}</p>;
}

/** The list, the partial gap with Retry after it, and the read line. */
function TodayList({ view, from, onRetry, onRefresh }) {
  const gap = [
    view.failed.length ? `Could not read your ${listNames(view.failed)}, so this list may be incomplete.` : '',
    view.pending.length ? `Still reading ${listNames(view.pending)}.` : '',
  ].filter(Boolean).join(' ');
  return (
    <div className="att" data-testid="advisor-today">
      <StaleLine view={view} onRefresh={onRefresh} />
      <DayLine view={view} />
      <ul className="att-list">
        {view.rows.map((row) => <BookedRow key={row.key} row={row} from={from} />)}
        {view.slots.map((slot) => <SlotRow key={slot.key} slot={slot} />)}
        {view.pending.includes('slots') && <li className="att-row att-row--reading" data-testid="advisor-today-reading-slots">Reading slots…</li>}
      </ul>
      {gap && (
        <div className="att-note att-note--partial" role="status" data-testid="status-advisor-today-partial">
          <Chip glyph="◐" word="Partial" tone="wait" />
          <span>{gap}</span>
          {view.failed.length > 0 && <button type="button" className="att-btn" onClick={onRetry} data-testid="button-retry-advisor-today"><RefreshCw size={13} aria-hidden="true" /> Retry</button>}
        </div>
      )}
      <ReadLine view={view} />
    </div>
  );
}

/**
 * The tile spec for StudioModules. `kind` is `todayState(today)`; `from` the
 * Studio address the drawer goes back to; `readAt` when Today was read.
 */
export function todayTile(today, kind, { now = new Date(), readAt = null, zone, from = '/studio', onRetry, onRefresh } = {}) {
  if (kind === 'loading') return { state: TILE.LOADING };
  const view = todayView(today, { now, readAt, zone });
  if (kind === 'unreadable') {
    // SAV06E: Unavailable, never an empty day; the dated Calendar link works without the reads.
    return {
      state: TILE.READY,
      body: (
        <div className="att" data-testid="advisor-today">
          <div className="att-note att-note--out" role="status" data-testid="status-advisor-today-unavailable">
            <Chip glyph="⊘" word="Unavailable" tone="out" />
            <span>{unavailableLine(view.failed)}</span>
          </div>
          <div className="att-actions">
            {onRetry && <button type="button" className="att-btn" onClick={onRetry} data-testid="button-retry-advisor-today"><RefreshCw size={13} aria-hidden="true" /> Try again</button>}
            <Link to={view.dayHref} className="att-link" data-testid="link-advisor-today-day">Open {view.dayShort} in Calendar ›</Link>
          </div>
        </div>
      ),
    };
  }
  if (kind === 'empty') {
    return {
      state: TILE.READY,
      note: 'Nothing scheduled',
      href: '/calendar',
      openLabel: 'Open calendar',
      body: (
        <div className="att" data-testid="advisor-today">
          <StaleLine view={view} onRefresh={onRefresh} />
          <DayLine view={view} />
          <p className="att-empty" data-testid="advisor-today-empty">
            No sessions or open slots are scheduled for today. Every source answered: bookings, calendar and slots.{view.nextLine ? ` ${view.nextLine}` : ''}
          </p>
          <ReadLine view={view} />
        </div>
      ),
    };
  }
  return {
    state: TILE.READY,
    note: view.note,
    href: '/calendar',
    openLabel: 'Open calendar',
    body: <TodayList view={view} from={from} onRetry={onRetry} onRefresh={onRefresh} />,
  };
}

/**
 * SAV03: back from the drawer, Studio puts the scroll where it was and focus
 * on the row that opened it, once Today has settled; on the Today heading if
 * that row has gone. Once per mount.
 */
export function useTodayReturn(state, settled) {
  const done = useRef(false);
  const { focus, scroll } = returnOf(state);
  useEffect(() => {
    if (done.current || !focus || !settled || typeof document === 'undefined') return;
    done.current = true;
    if (scroll !== null && typeof window !== 'undefined') window.scrollTo?.(0, scroll);
    const row = document.querySelector(`[data-today-focus="${focus}"]`);
    const heading = document.querySelector('[data-testid="studio-tile-today"] h3');
    const target = row || heading;
    if (!target) return;
    if (!row) target.setAttribute('tabindex', '-1');
    target.focus?.({ preventScroll: true });
  }, [focus, scroll, settled]);
}
