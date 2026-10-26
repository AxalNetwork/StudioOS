import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lightbox } from '../ui';
import { itemPath } from './calendarItemModel';
import {
  HOURS, QUICK_SETS, WEEKDAY_SHORT, byDay, cellItems, dayKey, dayLabel, familyCounts, isAllDay,
  layoutDay, monthCells, moveFocus, nowLine, weekDays,
} from './calendarGrid';

/**
 * D1210 (#3176) — the Calendar's month grid (CAL1), week time grid (CAL2), the
 * day popover (CAL12) and the Kinds panel (CAL6). Each draws the page's one
 * list (`items`, already narrowed by the Kinds filter); a day's count is that
 * list's, and a list the page could not read draws no count at all.
 */

const timeOf = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const cancelled = (ev) => ev?.status === 'cancelled';

/** One item as a chip: its kind's mark, its time and title, opening its drawer when it has a record. */
function Chip({ ev, from, compact = false }) {
  const label = `${isAllDay(ev) ? 'All day' : timeOf(ev.start_at)} · ${ev.title || 'Untitled'}`;
  const body = (
    <>
      <span className="cal-dot" data-kind={ev.kind} aria-hidden="true" />
      {!isAllDay(ev) && !compact ? <span className="cal-mono">{timeOf(ev.start_at)}</span> : null}
      <span className="cal-chip-title">{ev.title || 'Untitled'}</span>
    </>
  );
  const cls = `cal-gchip${cancelled(ev) ? ' is-cancelled' : ''}`;
  return ev.source_id != null
    ? <Link to={itemPath(ev.kind, ev.source_id)} state={{ from }} className={cls} title={label} data-testid={`cal-gchip-${ev.id}`}>{body}</Link>
    : <span className={cls} title={label} data-testid={`cal-gchip-${ev.id}`}>{body}</span>;
}

/** A grid of cells moved through with the arrow keys, Home and End (one roving tab stop). */
function useRoving(len, start) {
  const [at, setAt] = useState(start);
  const refs = useRef([]);
  const onKeyDown = (i) => (e) => {
    const next = moveFocus(i, e.key, len);
    if (next == null) return;
    e.preventDefault?.();
    setAt(next);
    refs.current[next]?.focus?.();
  };
  return { at, setAt, refs, onKeyDown };
}

/** The month (CAL1): six Monday-first weeks; today ringed; three items a day, then "+N more", which opens the day. */
export function MonthGrid({ anchor, items, read, today = new Date(), from, onOpenDay, dots = false }) {
  const cells = useMemo(() => monthCells(anchor, today), [anchor, today]);
  const { days } = useMemo(() => byDay(items), [items]);
  // The one tab stop starts on today, or the 1st when today is not in this month.
  const todayAt = cells.findIndex((c) => c.isToday);
  const start = todayAt >= 0 ? todayAt : Math.max(0, cells.findIndex((c) => c.inMonth));
  const rove = useRoving(cells.length, start);
  return (
    <div className="cal-month" role="grid" aria-label={`${anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`} data-testid="cal-month">
      <div className="cal-month-head" role="row">
        {WEEKDAY_SHORT.map((d) => <span key={d} role="columnheader" className="cal-eb">{d}</span>)}
      </div>
      {Array.from({ length: 6 }, (_, w) => (
        <div key={w} className="cal-month-row" role="row">
          {cells.slice(w * 7, w * 7 + 7).map((c, j) => {
            const i = w * 7 + j;
            const list = days.get(c.key) || [];
            const { shown, more } = cellItems(list);
            return (
              <div key={c.key} role="gridcell" className={`cal-mcell${c.inMonth ? '' : ' is-out'}${c.isToday ? ' is-today' : ''}`} data-testid={`cal-mcell-${c.key}`}>
                <button type="button" className="cal-mday" tabIndex={rove.at === i ? 0 : -1}
                  ref={(n) => { rove.refs.current[i] = n; }} onKeyDown={rove.onKeyDown(i)} onFocus={() => rove.setAt(i)}
                  onClick={() => onOpenDay(c.date)} aria-label={dayLabel(c.date, read ? list.length : null)}
                  aria-current={c.isToday ? 'date' : undefined} data-testid={`cal-mday-${c.key}`}>
                  {c.date.getDate()}
                </button>
                {/* D1212 (CAL21b): on a phone a day shows dots only; its day opens the popover with the items. */}
                {dots ? (
                  <div className="cal-mdots" aria-hidden="true" data-testid={`cal-mdots-${c.key}`}>
                    {list.slice(0, 4).map((ev) => <span key={ev.id} className="cal-dot" data-kind={ev.kind} />)}
                  </div>
                ) : (
                  <div className="cal-mitems">
                    {shown.map((ev) => <Chip key={ev.id} ev={ev} from={from} compact />)}
                    {more ? <button type="button" className="cal-more" onClick={() => onOpenDay(c.date)} data-testid={`cal-more-${c.key}`}>+{more} more</button> : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** The week (CAL2): an all-day row over 07:00–21:00, overlapping items side by side, and the now line. */
export function WeekGrid({ anchor, items, read, now = new Date(), from, onOpenDay }) {
  const days = useMemo(() => weekDays(anchor), [anchor]);
  const { days: byKey } = useMemo(() => byDay(items), [items]);
  const todayIdx = days.findIndex((d) => dayKey(d) === dayKey(now));
  const rove = useRoving(7, todayIdx >= 0 ? todayIdx : 0);
  const hours = Array.from({ length: HOURS.to - HOURS.from }, (_, i) => HOURS.from + i);
  return (
    <div className="cal-week" data-testid="cal-week">
      <div className="cal-week-head" role="row">
        <span aria-hidden="true" />
        {days.map((d, i) => {
          const list = byKey.get(dayKey(d)) || [];
          return (
            <button key={dayKey(d)} type="button" role="columnheader" className={`cal-wday${i === todayIdx ? ' is-today' : ''}`}
              tabIndex={rove.at === i ? 0 : -1} ref={(n) => { rove.refs.current[i] = n; }} onKeyDown={rove.onKeyDown(i)} onFocus={() => rove.setAt(i)}
              onClick={() => onOpenDay(d)} aria-label={dayLabel(d, read ? list.length : null)} aria-current={i === todayIdx ? 'date' : undefined}
              data-testid={`cal-wday-${dayKey(d)}`}>
              <span className="cal-eb">{WEEKDAY_SHORT[i]}</span><b>{d.getDate()}</b>
            </button>
          );
        })}
      </div>
      <div className="cal-allday" data-testid="cal-allday">
        <span className="cal-eb">All day</span>
        {days.map((d) => (
          <div key={dayKey(d)} className="cal-allday-cell">
            {(byKey.get(dayKey(d)) || []).filter(isAllDay).map((ev) => <Chip key={ev.id} ev={ev} from={from} compact />)}
          </div>
        ))}
      </div>
      <div className="cal-week-body">
        <div className="cal-hours" aria-hidden="true">
          {hours.map((h) => <span key={h} className="cal-mono">{String(h).padStart(2, '0')}:00</span>)}
        </div>
        {days.map((d) => {
          const placed = layoutDay(byKey.get(dayKey(d)) || []);
          const line = nowLine(d, now);
          return (
            <div key={dayKey(d)} className="cal-wcol" data-testid={`cal-wcol-${dayKey(d)}`}>
              {line != null ? <span className="cal-now" style={{ top: `${line}%` }} data-testid="cal-now"><span className="sr-only">Now</span></span> : null}
              {placed.filter((p) => !p.hidden).map((p) => (
                <div key={p.ev.id} className={`cal-wev${cancelled(p.ev) ? ' is-cancelled' : ''}`} data-testid={`cal-wev-${p.ev.id}`}
                  style={{ top: `${p.top}%`, height: `${p.height}%`, left: `${(p.lane / p.of) * 100}%`, width: `${100 / p.of}%` }}>
                  <Chip ev={p.ev} from={from} />
                  {p.noEnd ? <span className="cal-wev-note">End not recorded</span> : null}
                  {p.clipped ? <span className="cal-wev-note">Runs outside 07:00–21:00</span> : null}
                </div>
              ))}
              {placed.some((p) => p.hidden) ? <span className="cal-wev-out" data-testid={`cal-wout-${dayKey(d)}`}>{placed.filter((p) => p.hidden).length} outside 07:00–21:00 · open the day</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The day popover (CAL12): every item that day, each opening its drawer. */
export function DayPopover({ date, items, read, from, onClose }) {
  const list = (byDay(items).days.get(dayKey(date))) || [];
  const title = date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <Lightbox label={title} title={title} sub={read ? dayLabel(date, list.length).split(', ')[1] : 'The calendar could not be read, so this day cannot be listed.'} onClose={onClose} testId="cal-day-popover" width={420}>
      {list.length ? (
        <ul className="cal-pop-list">
          {list.map((ev) => (
            <li key={ev.id} data-testid={`cal-pop-${ev.id}`}>
              <span className="cal-mono">{isAllDay(ev) ? 'All day' : timeOf(ev.start_at)}</span>
              <Chip ev={ev} from={from} />
            </li>
          ))}
        </ul>
      ) : read ? <p className="cal-foot" data-testid="cal-pop-empty">Nothing on this day.</p> : null}
    </Lightbox>
  );
}

/**
 * The Kinds panel (CAL6): three quick sets, the families with their kinds and
 * counts ("—" and "Could not be read" for a source that did not answer), Reset,
 * and Show [N] items, which writes `?kinds=`.
 */
export function KindsPanel({ families, kindLabel, counts, items, chosen, needs, onApply, onClose }) {
  const all = families.flatMap((f) => f.kinds);
  const [pick, setPick] = useState(() => new Set(chosen ? [...chosen] : all));
  const [onlyNeeds, setOnlyNeeds] = useState(needs);
  const fams = familyCounts(families, counts);
  const toggle = (kinds, on) => setPick((s) => { const n = new Set(s); for (const k of kinds) { if (on) n.add(k); else n.delete(k); } return n; });
  const showing = Array.isArray(items) ? items.filter((ev) => pick.has(ev.kind)).length : null;
  const quick = (key) => {
    if (key === 'needs') { setPick(new Set(all)); setOnlyNeeds(true); return; }
    setOnlyNeeds(false);
    setPick(new Set(all)); // Everything; Hide deadlines too, while Deadlines carry no kind
  };
  return (
    <div role="dialog" aria-label="Kinds" className="cal-kinds" data-testid="cal-kinds-panel">
      <div className="cal-kinds-quick">
        {QUICK_SETS.map((q) => (
          <button key={q.key} type="button" className="cal-chip" onClick={() => quick(q.key)} data-testid={`cal-quick-${q.key}`}
            aria-pressed={q.key === 'needs' ? onlyNeeds : !onlyNeeds && q.key === 'everything' && pick.size === all.length}>{q.label}</button>
        ))}
      </div>
      {fams.map((f) => {
        const on = f.kinds.length > 0 && f.kinds.every((k) => pick.has(k));
        return (
          <div key={f.key} className="cal-kinds-fam" data-testid={`cal-fam-${f.key}`}>
            <label className="cal-kinds-row">
              <input type="checkbox" checked={on} disabled={!f.kinds.length} onChange={(e) => toggle(f.kinds, e.target.checked)} data-testid={`cal-fam-box-${f.key}`} />
              <strong>{f.label}</strong>
              <span className="cal-mono">
                {!f.kinds.length ? 'Not read here yet' : f.total == null ? '' : `${f.total}${f.unread.length ? ` and ${f.unread.length} unread` : ''}`}
              </span>
            </label>
            {f.kinds.map((k) => (
              <label key={k} className="cal-kinds-row is-kind">
                <input type="checkbox" checked={pick.has(k)} onChange={(e) => toggle([k], e.target.checked)} data-testid={`cal-kind-box-${k}`} />
                <span className="cal-dot" data-kind={k} aria-hidden="true" />{kindLabel(k)}
                <span className={`cal-mono${counts?.[k] === '—' ? ' is-unread' : ''}`}>{counts?.[k] === '—' ? '— · Could not be read' : counts?.[k] ?? ''}</span>
              </label>
            ))}
          </div>
        );
      })}
      <div className="cal-kinds-foot">
        <span className="cal-mono">In the address: ?kinds=…</span>
        <button type="button" className="cal-btn cal-btn-q" onClick={() => { setPick(new Set(all)); setOnlyNeeds(false); }} data-testid="cal-kinds-reset">Reset</button>
        <button type="button" className="cal-btn cal-btn-p" disabled={pick.size === 0} onClick={() => { onApply(pick, onlyNeeds); onClose(); }} data-testid="cal-kinds-show">
          {showing == null ? 'Show these kinds' : `Show ${showing} ${showing === 1 ? 'item' : 'items'}`}
        </button>
      </div>
    </div>
  );
}
