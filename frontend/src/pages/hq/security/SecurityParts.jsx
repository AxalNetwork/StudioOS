/**
 * D4708 part 3 (#4708) — the presentational parts the Security page's zones share, moved out of
 * `../SecurityPage.jsx` unchanged: a zone card, a tile, and a stated-absence list.
 */
import React from 'react';
import { Card, Unrecorded } from '../../../ui';
import StatusBadge from './StatusBadge.jsx';

export function Zone({ title, sub, children, tone = '' }) {
  return (
    <Card className={tone}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[14.5px] font-extrabold tracking-tight">{title}</h2>
        {sub && <span className="text-[11.5px] text-axal-muted">{sub}</span>}
      </div>
      {children}
    </Card>
  );
}

/**
 * D481 — a stated absence with its reason, for H23's tiles the platform does
 * not record (Accreditation lapsed, Failover test). Read from the payload so
 * the server and the page cannot disagree about what is missing.
 */
export function NotRecordedList({ items, testid }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-2 space-y-1.5" data-testid={testid}>
      {items.map((n) => (
        <li key={n.what} className="text-[11px] leading-relaxed text-axal-muted">
          <b className="text-axal-muted">{n.what}</b> — <Unrecorded />. {n.reason}
        </li>
      ))}
    </ul>
  );
}

// `unread` (D4801): an absent figure on the Access tiles is a store that could
// not be read, so it draws the vocabulary's Unavailable, never "Not recorded"
// and never 0. The other zones' tiles keep their words until their slice.
export function Stat({ label, value, note, tone = 'text-axal-ink dark:text-white', unread = false }) {
  return (
    <div className="rounded-xl border border-axal-hairline bg-axal-ground p-3">
      <div className="text-[8.5px] font-extrabold uppercase tracking-[.09em] text-axal-muted">{label}</div>
      <div className={`mt-1 text-lg font-extrabold tracking-tight tabular-nums ${tone}`}>{value ?? (unread ? <StatusBadge state="unavailable" /> : <Unrecorded />)}</div>
      {note && <div className="mt-0.5 text-[10px] text-axal-muted">{note}</div>}
    </div>
  );
}
