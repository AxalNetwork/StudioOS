import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { dateBlock, timeLine, whereOf } from './myEventsModel';

export const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-axal-muted dark:text-gray-400';
export const viewerZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };

function DateTile({ event }) {
  const d = dateBlock(event);
  return (
    <div className="flex w-[58px] shrink-0 flex-col items-center rounded-[10px] border border-axal-hairline py-1.5 font-mono dark:border-gray-700">
      {d ? (<>
        <span className={`text-[10px] font-bold ${MUTED}`}>{d.month}</span>
        <span className={`text-[20px] font-extrabold leading-none ${INK}`}>{d.day}</span>
        <span className={`text-[10px] ${MUTED}`}>{d.weekday}</span>
      </>) : <span className={`px-1 text-center text-[10px] ${MUTED}`}>No date</span>}
    </div>
  );
}

export function EventLine({ event, to, sub = null, children }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <DateTile event={event} />
      <div className="flex min-w-0 flex-col gap-0.5">
        {to
          ? <Link to={to} className={`truncate text-[14px] font-extrabold hover:text-axal-violet ${INK}`} data-testid="my-events-open-drawer">{event.title || 'Not recorded'}</Link>
          : <span className={`truncate text-[14px] font-extrabold ${INK}`}>{event.title || 'Not recorded'}</span>}
        {sub ? <span className={`text-[12px] ${MUTED}`}>{sub}</span> : null}
        <span className={`text-[12px] ${MUTED}`}>{timeLine(event, viewerZone())}</span>
        <span className={`inline-flex items-center gap-1 text-[12px] ${MUTED}`}><MapPin size={12} /> {whereOf(event)}</span>
        {children}
      </div>
    </div>
  );
}
