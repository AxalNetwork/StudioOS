import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminEvents } from '../../../lib/api';
import { BoxShell, BoxTable, Failed, ListControls, MONO, Pager, Reading, SUB, useBoxRead, useSettled, MANAGE } from './CommunityLightbox';
import { EVENTS, EVENTS_LINE, EVENTS_TABS, eventRow, eventsPage, eventsQuery, eventsSummary, initialState, typesWithEvents } from './lightboxModel';
import { ByTypeParts, FunnelParts } from './page/cards';

/**
 * D934 (#2718) — CM3, Events: D918's paged list (#2701), 25 rows a page. The
 * Worker searches (title, host or venture), filters, sorts and pages, and
 * each row carries its own seats taken, attended and waitlisted, so D915's
 * Guard G is retired here and no analytics read is made.
 *
 * Fill and show-up are D915's words through its own functions
 * (`eventsDeskModel.js`), so this lightbox and the Events desk cannot
 * disagree. The host's name the list carries is never drawn. A title opens
 * the event in the Events console (`/admin/events/:id`); nothing is changed
 * here.
 *
 * D4820 part 4 (#4820, CM05): a summary strip and three tabs. The list is the
 * default; Participation is the funnel and By type is events by type, moved
 * here from the overview. The strip and both tabs are the Community read the
 * overview already holds (`community`), so they cannot disagree with it; only
 * the list makes a read of its own.
 */

const COLS = [
  { key: 'title', label: 'Title' },
  { key: 'type', label: 'Type' },
  { key: 'starts', label: 'Starts', mono: true },
  { key: 'status', label: 'Status' },
  { key: 'capacity', label: 'Capacity', mono: true },
  { key: 'registered', label: 'Registered', mono: true },
  { key: 'attended', label: 'Attended', mono: true },
  { key: 'waitlisted', label: 'Waitlisted', mono: true },
  { key: 'fill', label: 'Fill', mono: true },
  { key: 'showUp', label: 'Show-up', mono: true },
];

/** CM05's strip: each figure in its own state, never a zero for a part that was not read. */
function SummaryStrip({ items }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-axal-hairline bg-axal-hairline sm:grid-cols-3 lg:grid-cols-6 dark:border-gray-700 dark:bg-gray-700" data-testid="community-box-events-summary">
      {items.map((it) => (
        <div key={it.key} className="flex min-w-0 flex-col gap-0.5 bg-white px-3 py-2.5 dark:bg-gray-900" data-testid={`community-box-events-summary-${it.key}`}>
          <dt className="text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400">{it.label}</dt>
          {it.state === 'ready' ? (<>
            <dd className={`m-0 ${MONO} text-[17px] font-medium text-axal-ink dark:text-gray-100`}>{it.value}</dd>
            {it.sub ? <dd className={`m-0 ${SUB}`}>{it.sub}</dd> : null}
          </>) : <dd className={`m-0 text-[12.5px] ${it.state === 'unreadable' ? 'font-bold text-axal-destructive dark:text-red-400' : 'font-mono text-axal-muted dark:text-gray-400'}`}>
            {it.state === 'loading' ? 'Reading…' : it.state === 'unreadable' ? 'Unreadable' : it.note}
          </dd>}
        </div>
      ))}
    </dl>
  );
}

/** CM05's tabs, with the WAI-ARIA keys: arrows move and wrap, Home and End go to the ends, focus moves with the choice. */
function Tabs({ tab, setTab, count }) {
  const refs = useRef({});
  const move = (e) => {
    const i = EVENTS_TABS.findIndex((t) => t.key === tab);
    const to = e.key === 'ArrowRight' ? (i + 1) % EVENTS_TABS.length : e.key === 'ArrowLeft' ? (i - 1 + EVENTS_TABS.length) % EVENTS_TABS.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? EVENTS_TABS.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(EVENTS_TABS[to].key);
    refs.current[EVENTS_TABS[to].key]?.focus();
  };
  return (
    <div role="tablist" aria-label="Events details" className="flex gap-1 border-b border-axal-hairline dark:border-gray-800" onKeyDown={move} data-testid="community-box-events-tabs">
      {EVENTS_TABS.map((t) => (
        <button key={t.key} type="button" role="tab" id={`community-box-events-tab-${t.key}`} aria-selected={t.key === tab} aria-controls={`community-box-events-panel-${t.key}`}
          tabIndex={t.key === tab ? 0 : -1} ref={(el) => { refs.current[t.key] = el; }} onClick={() => setTab(t.key)} data-testid={`community-box-events-tab-${t.key}`}
          className={`-mb-px inline-flex min-h-[40px] max-lg:min-h-[44px] items-center gap-1.5 border-b-2 px-3 text-[13px] font-bold ${t.key === tab ? 'border-axal-violet text-axal-ink dark:border-violet-300 dark:text-gray-100' : 'border-transparent text-axal-muted dark:text-gray-400'}`}>
          {t.label}
          {count[t.key] != null ? <span className={`${MONO} text-[11px] text-axal-muted dark:text-gray-400`}>{count[t.key]}</span> : null}
        </button>
      ))}
    </div>
  );
}

export default function EventsLightbox({ onClose, now: at, community }) {
  const [now] = useState(() => at ?? Date.now());
  const [state, setState] = useState(() => initialState(EVENTS));
  // #4717: a search reads once the typing stops, not on every keystroke.
  const q = useSettled(state.q);
  const query = useMemo(() => eventsQuery({ ...state, q }), [state, q]);
  const { read, retry } = useBoxRead(() => adminEvents.list(query), 'box-events', JSON.stringify(query));
  const view = useMemo(() => (read.status === 'ready' ? eventsPage(read.data, state.page) : null), [read, state.page]);
  const failed = read.status === 'error' || (read.status === 'ready' && !view);
  const id = 'community-box-events';
  const [tab, setTab] = useState('list');
  const summary = useMemo(() => eventsSummary(community || {}), [community]);
  const ev = community?.ev;
  const weeks = community?.weeks;
  const count = { list: view ? view.total : null, 'by-type': typesWithEvents(ev?.byType) };

  return (
    <BoxShell id={id} title={EVENTS.title} sub={EVENTS_LINE} onClose={onClose} manage={<Link to="/admin/events" className={MANAGE}>Manage events →</Link>}>
      {(phone) => (
        <>
          <div className="flex flex-col gap-3 px-5 pt-4">
            <SummaryStrip items={summary} />
            <Tabs tab={tab} setTab={setTab} count={count} />
          </div>
          {tab === 'participation' ? (
            <div role="tabpanel" id={`${id}-panel-participation`} aria-labelledby={`${id}-tab-participation`} className="flex flex-col gap-3 px-5 py-4" data-testid={`${id}-panel-participation`}>
              {ev ? <FunnelParts ev={ev} showUp={community.fig?.['show-up']} weeks={weeks} onRetry={community.onRetry} /> : <Reading id={`${id}-participation`} />}
            </div>
          ) : null}
          {tab === 'by-type' ? (
            <div role="tabpanel" id={`${id}-panel-by-type`} aria-labelledby={`${id}-tab-by-type`} className="flex flex-col gap-3 px-5 py-4" data-testid={`${id}-panel-by-type`}>
              {ev ? <ByTypeParts ev={ev} weeks={weeks} onRetry={community.onRetry} /> : <Reading id={`${id}-by-type`} />}
            </div>
          ) : null}
          {tab === 'list' ? (
          <div role="tabpanel" id={`${id}-panel-list`} aria-labelledby={`${id}-tab-list`} data-testid={`${id}-panel-list`}>
          <ListControls id={id} spec={EVENTS} state={state} setState={setState} phone={phone} />
          {read.status === 'loading' && <Reading id={id} />}
          {failed && <Failed id={id} reason="The events could not be read. That is not the same as no events." onRetry={retry} />}
          {view && (
            <>
              <BoxTable id={id} cols={COLS} phone={phone} empty="No event matches."
                rows={view.rows.map((ev) => { const r = eventRow(ev, now); return { ...r, badge: r.featured ? 'Featured' : null }; })}
                phoneLine={(r) => `${r.starts} · ${r.type} · ${r.status}`}
                phoneValue={(r) => (r.capacity === 'No cap' ? `${r.registered} · no cap` : `${r.registered} / ${r.capacity}`)} />
              <Pager id={id} view={view} none={EVENTS.none} onPage={(page) => setState((s) => ({ ...s, page }))} />
            </>
          )}
          </div>
          ) : null}
        </>
      )}
    </BoxShell>
  );
}
