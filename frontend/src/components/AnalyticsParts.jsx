import React from 'react';
import { Card, Unrecorded } from '../ui';

/**
 * The pieces HQ's Analytics page (H15) and a branch's (S15) both draw — D210.
 * `TopologyParts.jsx` is the precedent: one render of a shape two tiers show,
 * with who is speaking as a prop, so the two screens cannot come to draw one
 * thing two ways.
 */

/**
 * The three ranges both canvases draw, keyed by the worker's own vocabulary.
 *
 * THE KEYS ARE `ANALYTICS_RANGES`'S, in `services/activeAccounts.ts`, and a
 * test reads that file to hold them together. A pill whose key the worker does
 * not know is answered with a 400 — which is the right answer for a typo, and
 * the wrong one for a button on the page.
 */
export const RANGE_PILLS = [
  { key: '8w', label: '8 weeks' },
  { key: 'quarter', label: 'Quarter' },
  { key: 'year', label: 'Year' },
];

/** The label a range prints, from the same list the pills are drawn from. */
export function rangeLabel(key) {
  return RANGE_PILLS.find((p) => p.key === key)?.label ?? null;
}

/**
 * The selected state is each tier's own accent — oxblood at HQ, steel on a
 * branch — on `SecurityPage`'s chip idiom.
 */
const SELECTED = {
  hq: 'border-rose-200 bg-rose-50 text-[#881337] dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200',
  branch: 'border-slate-300 bg-slate-100 text-[#334155] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100',
};
const UNSELECTED = 'border-axal-hairline bg-white text-axal-muted hover:bg-axal-ground dark:bg-gray-900 dark:hover:bg-gray-800';

export function RangePills({ value, onChange, tier = 'hq', testId }) {
  return (
    <div role="group" aria-label="Range" className="flex flex-wrap gap-1.5" data-testid={testId}>
      {RANGE_PILLS.map((p) => (
        <button
          key={p.key}
          type="button"
          aria-pressed={value === p.key}
          data-range={p.key}
          onClick={() => onChange(p.key)}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${value === p.key ? SELECTED[tier] : UNSELECTED}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One KPI. A figure the page does not have renders `<Unrecorded>` with its
 * reason — never a zero, never a bare dash — and `note` carries what the
 * figure is of, so a number never stands without its week.
 *
 * `unreadable` IS THE OTHER ABSENCE (D211). A store the page read and found
 * nothing in says "Not recorded"; a read that FAILED says "Unreadable", because
 * nothing is known either way and the two claims must not look alike
 * (`ui/Honesty.jsx`). The server says which: its payload marks a failed read.
 */
export function KpiTile({ label, value, delta, note, reason, unreadable = false, testId }) {
  const missing = value === null || value === undefined;
  return (
    <Card data-testid={testId} data-state={missing ? (unreadable ? 'unreadable' : 'not_recorded') : 'recorded'}>
      <div className="text-[9.5px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{label}</div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
        <span className="text-xl font-extrabold tracking-tight tabular-nums text-axal-ink">
          {missing && unreadable && <Unrecorded reason={reason}>Unreadable</Unrecorded>}
          {missing && !unreadable && <Unrecorded reason={reason} />}
          {!missing && value}
        </span>
        {delta && <span className="font-mono text-[11px] font-semibold tabular-nums text-axal-muted">{delta}</span>}
      </div>
      {note && <div className="mt-1 text-[10.5px] leading-snug text-axal-faint">{note}</div>}
    </Card>
  );
}

/**
 * A card the canvas draws over a store that does not exist. The heading is
 * drawn and the reason is PRINTED, not left in a tooltip: `<Unrecorded>` puts
 * its reason in `title=`, which a reader on a phone never sees.
 */
export function NotRecordedCard({ label, reason, testId }) {
  return (
    <Card data-testid={testId}>
      <div className="text-[13px] font-extrabold tracking-tight text-axal-ink">{label}</div>
      <div className="mt-1 text-[12px]"><Unrecorded reason={reason} /></div>
      {reason && <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">{reason}</p>}
    </Card>
  );
}

/** A signed whole-number change, `+3` / `−2` / `±0`, for a KPI's delta line. */
export function signed(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (n === 0) return '±0';
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/** A median decision age's band: amber above a day, red above two. */
export function ageTone(hours) {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) return null;
  if (hours > 48) return 'late';
  if (hours > 24) return 'slow';
  return null;
}
export const AGE_TONE_CLASS = {
  late: 'text-rose-700 dark:text-rose-300',
  slow: 'text-amber-700 dark:text-amber-300',
};

/**
 * Approval age by queue — medians where a decision is an event, reasons where
 * it is not. Drawn by a branch's S15 and, since D483, by HQ's H15, which
 * passes its own title and test-id prefix.
 */
export function ApprovalAgeList({
  rows, title = 'Approval age by queue', sub = 'median hours from submission to decision', prefix = 's15', children,
}) {
  return (
    <Card data-testid={`${prefix}-approval-age`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-extrabold tracking-tight text-axal-ink">{title}</h2>
        {sub && <span className="text-[11px] text-axal-faint">{sub}</span>}
      </div>
      {children}
      <ul className="divide-y divide-axal-hairline">
        {rows.map((q) => {
          const tone = q.available ? ageTone(q.median_hours) : null;
          return (
            <li key={q.key} className="py-2" data-testid={`${prefix}-age-row`} data-queue={q.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-semibold text-axal-ink">{q.label}</span>
                {!q.available && (
                  <span className="text-[12px]" data-state={q.unreadable ? 'unreadable' : 'not_recorded'}>
                    {q.unreadable ? <Unrecorded reason={q.reason}>Unreadable</Unrecorded> : <Unrecorded reason={q.reason} />}
                  </span>
                )}
                {q.available && q.median_hours === null && (
                  <span className="text-[12px] text-axal-muted">none decided</span>
                )}
                {q.available && q.median_hours !== null && (
                  <span
                    className={`font-mono text-[12.5px] font-bold tabular-nums ${tone ? AGE_TONE_CLASS[tone] : 'text-axal-ink'}`}
                    data-tone={tone || 'on_time'}
                  >
                    {q.median_hours}h
                  </span>
                )}
              </div>
              {q.available && q.median_hours !== null && (
                <p className="mt-0.5 text-[11px] text-axal-faint">
                  over {q.n} decision{q.n === 1 ? '' : 's'} in the last {q.window_days} days
                </p>
              )}
              {q.reason && <p className="mt-0.5 text-[11px] leading-relaxed text-axal-muted">{q.reason}</p>}
              {q.clock && (
                <p className="mt-0.5 text-[11px] text-axal-faint" data-testid={`${prefix}-age-clock`}>The clock is {q.clock}</p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-axal-faint">Amber above a day, red above two.</p>
    </Card>
  );
}
